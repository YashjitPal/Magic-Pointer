const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, dialog, screen, nativeImage, nativeTheme, shell, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const { spawn } = require('child_process');

let overlayWindow = null;
let tray = null;
let nativeWatcher = null;
let isMagicPointerActive = false;
let sensitivityLevel = 0;
let isDarkMode = true;
// Target AI Desktop App ('gemini' default; auto-switches to 'claude' or 'chatgpt' if Gemini is not installed)
let targetApp = 'gemini';
// MagicCue is bundled with the app (1.2 MB entity classifier pack) and enabled by default!
let magicCueEnabled = true;
// Optional Multimodal Vision + Suggestion AI (~500 MB total int8 ONNX):
// 1. Xenova/vit-gpt2-image-captioning (~237 MB int8 ONNX) — Vision-Language model that generates rich scene descriptions
// 2. Xenova/LaMini-Flan-T5-248M (~265 MB int8 ONNX) — 248M instruction-tuned T5 model (>3x larger than 77M)
// Off by default until the user downloads & enables it; falls back to instant default suggestions when not downloaded!
let llmSuggestionsEnabled = false;
let llmModelDownloaded = false;
let isLlmDownloading = false;
let updateTrayMenuFn = null;
const pendingCropCallbacks = new Map();
let cachedDetectedWindows = [];
let latestScreenshotInfo = null;
let latestOcrInfo = null;

const llmModelsBaseDir = path.join(app.getPath('userData'), 'odml_models');
const LLM_DOWNLOAD_SPECS = [
  // 1. Instruction-Tuned Suggestion LLM: Xenova/LaMini-Flan-T5-248M (~265 MB int8 ONNX)
  { repo: 'Xenova/LaMini-Flan-T5-248M', dir: 'LaMini-Flan-T5-248M', rel: 'config.json', size: 1541 },
  { repo: 'Xenova/LaMini-Flan-T5-248M', dir: 'LaMini-Flan-T5-248M', rel: 'generation_config.json', size: 147 },
  { repo: 'Xenova/LaMini-Flan-T5-248M', dir: 'LaMini-Flan-T5-248M', rel: 'tokenizer.json', size: 2422262 },
  { repo: 'Xenova/LaMini-Flan-T5-248M', dir: 'LaMini-Flan-T5-248M', rel: 'tokenizer_config.json', size: 2457 },
  { repo: 'Xenova/LaMini-Flan-T5-248M', dir: 'LaMini-Flan-T5-248M', rel: 'special_tokens_map.json', size: 2201 },
  { repo: 'Xenova/LaMini-Flan-T5-248M', dir: 'LaMini-Flan-T5-248M', rel: 'onnx/encoder_model_quantized.onnx', size: 110502358 },
  { repo: 'Xenova/LaMini-Flan-T5-248M', dir: 'LaMini-Flan-T5-248M', rel: 'onnx/decoder_model_merged_quantized.onnx', size: 164739632 },
  // 2. Vision-Language Image Captioner: Xenova/vit-gpt2-image-captioning (~237 MB int8 ONNX)
  { repo: 'Xenova/vit-gpt2-image-captioning', dir: 'vit-gpt2-image-captioning', rel: 'config.json', size: 4888 },
  { repo: 'Xenova/vit-gpt2-image-captioning', dir: 'vit-gpt2-image-captioning', rel: 'generation_config.json', size: 184 },
  { repo: 'Xenova/vit-gpt2-image-captioning', dir: 'vit-gpt2-image-captioning', rel: 'preprocessor_config.json', size: 378 },
  { repo: 'Xenova/vit-gpt2-image-captioning', dir: 'vit-gpt2-image-captioning', rel: 'tokenizer.json', size: 2107928 },
  { repo: 'Xenova/vit-gpt2-image-captioning', dir: 'vit-gpt2-image-captioning', rel: 'tokenizer_config.json', size: 456 },
  { repo: 'Xenova/vit-gpt2-image-captioning', dir: 'vit-gpt2-image-captioning', rel: 'special_tokens_map.json', size: 131 },
  { repo: 'Xenova/vit-gpt2-image-captioning', dir: 'vit-gpt2-image-captioning', rel: 'vocab.json', size: 798156 },
  { repo: 'Xenova/vit-gpt2-image-captioning', dir: 'vit-gpt2-image-captioning', rel: 'onnx/encoder_model_quantized.onnx', size: 87453213 },
  { repo: 'Xenova/vit-gpt2-image-captioning', dir: 'vit-gpt2-image-captioning', rel: 'onnx/decoder_model_merged_quantized.onnx', size: 158599996 },
  // 3. Fast 1,000-Class Object Classifier: Xenova/resnet-50 (~25 MB int8 ONNX)
  { repo: 'Xenova/resnet-50', dir: 'resnet-50', rel: 'config.json', size: 69632 },
  { repo: 'Xenova/resnet-50', dir: 'resnet-50', rel: 'preprocessor_config.json', size: 512 },
  { repo: 'Xenova/resnet-50', dir: 'resnet-50', rel: 'onnx/model_quantized.onnx', size: 25787392 }
];

function checkLlmModelDownloaded() {
  try {
    return LLM_DOWNLOAD_SPECS.every((item) => {
      const full = path.join(llmModelsBaseDir, item.dir, ...item.rel.split('/'));
      return fs.existsSync(full) && fs.statSync(full).size > 10;
    });
  } catch (_) {
    return false;
  }
}

function getLlmModelDirFileUrl() {
  return `file:///${llmModelsBaseDir.replace(/\\/g, '/')}/`;
}

function isTargetAppInstalled(id) {
  try {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const winApps = path.join(localAppData, 'Microsoft', 'WindowsApps');
    let winAppsEntries = [];
    try {
      if (fs.existsSync(winApps)) {
        winAppsEntries = fs.readdirSync(winApps);
      }
    } catch (_) {}

    if (id === 'gemini') {
      const candidates = [
        path.join(localAppData, 'Google', 'Gemini', 'Gemini.exe'),
        path.join(localAppData, 'Google', 'Gemini', 'GeminiAppLauncher.exe'),
        path.join(localAppData, 'Programs', 'Gemini', 'Gemini.exe'),
        path.join(localAppData, 'Gemini', 'Gemini.exe'),
        'C:\\Program Files\\Google\\Gemini\\Gemini.exe',
        'C:\\Program Files (x86)\\Google\\Gemini\\Gemini.exe'
      ];
      return candidates.some((p) => fs.existsSync(p));
    }
    if (id === 'claude') {
      if (winAppsEntries.some((name) => /^claude(-desktop)?\.exe$|^Claude_/i.test(name))) {
        return true;
      }
      const candidates = [
        path.join(localAppData, 'AnthropicClaude', 'claude.exe'),
        path.join(localAppData, 'Programs', 'Claude', 'Claude.exe'),
        path.join(localAppData, 'Programs', 'claude', 'claude.exe')
      ];
      return candidates.some((p) => fs.existsSync(p));
    }
    if (id === 'chatgpt') {
      if (winAppsEntries.some((name) => /^chatgpt(-desktop)?\.exe$|^OpenAI\.Codex/i.test(name))) {
        return true;
      }
      const candidates = [
        path.join(localAppData, 'Programs', 'ChatGPT', 'ChatGPT.exe'),
        path.join(localAppData, 'ChatGPT', 'ChatGPT.exe'),
        path.join(localAppData, 'OpenAI', 'ChatGPT', 'ChatGPT.exe')
      ];
      return candidates.some((p) => fs.existsSync(p));
    }
  } catch (_) {}
  return false;
}

function getTargetAppsAvailability() {
  return {
    gemini: isTargetAppInstalled('gemini'),
    claude: isTargetAppInstalled('claude'),
    chatgpt: isTargetAppInstalled('chatgpt')
  };
}

function resolveDefaultOrValidTargetApp(preferred = 'gemini') {
  const avail = getTargetAppsAvailability();
  const norm = ['gemini', 'claude', 'chatgpt'].includes(preferred) ? preferred : 'gemini';
  if (avail[norm]) return norm;
  // Default priority: Gemini -> Claude -> ChatGPT
  if (avail.gemini) return 'gemini';
  if (avail.claude) return 'claude';
  if (avail.chatgpt) return 'chatgpt';
  return norm;
}

function getTargetAppDisplayName(id) {
  if (id === 'claude') return 'Claude';
  if (id === 'chatgpt') return 'ChatGPT';
  return 'Gemini';
}

function loadPersistedSettings() {
  try {
    llmModelDownloaded = checkLlmModelDownloaded();
    const cfgPath = path.join(app.getPath('userData'), 'magic_pointer_settings.json');
    let savedTargetApp = 'gemini';
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (typeof cfg.magicCueEnabled === 'boolean') {
        magicCueEnabled = cfg.magicCueEnabled;
      }
      if (typeof cfg.llmSuggestionsEnabled === 'boolean') {
        llmSuggestionsEnabled = cfg.llmSuggestionsEnabled && llmModelDownloaded;
      }
      if (typeof cfg.targetApp === 'string' && ['gemini', 'claude', 'chatgpt'].includes(cfg.targetApp)) {
        savedTargetApp = cfg.targetApp;
      }
    }
    targetApp = resolveDefaultOrValidTargetApp(savedTargetApp);
  } catch (_) {
    targetApp = resolveDefaultOrValidTargetApp('gemini');
  }
}

function savePersistedSettings() {
  try {
    const cfgPath = path.join(app.getPath('userData'), 'magic_pointer_settings.json');
    fs.writeFileSync(
      cfgPath,
      JSON.stringify({ magicCueEnabled, llmSuggestionsEnabled, llmModelDownloaded, targetApp }, null, 2),
      'utf8'
    );
  } catch (_) {}
}

function downloadFileWithRedirects(url, destPath, onBytes) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tempPath = `${destPath}.part`;

    const request = (currentUrl, redirectsLeft = 5) => {
      https
        .get(currentUrl, { headers: { 'User-Agent': 'MagicPointer/1.0' } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            if (redirectsLeft <= 0) return reject(new Error('Too many redirects'));
            const nextUrl = new URL(res.headers.location, currentUrl).href;
            return request(nextUrl, redirectsLeft - 1);
          }
          if (res.statusCode !== 200) {
            res.resume();
            return reject(new Error(`HTTP ${res.statusCode} for ${currentUrl}`));
          }
          const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
          let receivedBytes = 0;
          const fileStream = fs.createWriteStream(tempPath);
          res.on('data', (chunk) => {
            receivedBytes += chunk.length;
            if (onBytes) onBytes(chunk.length, receivedBytes, totalBytes);
          });
          res.pipe(fileStream);
          fileStream.on('finish', () => {
            fileStream.close(() => {
              try {
                if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
                fs.renameSync(tempPath, destPath);
                resolve();
              } catch (err) {
                reject(err);
              }
            });
          });
          fileStream.on('error', (err) => {
            try { fs.unlinkSync(tempPath); } catch (_) {}
            reject(err);
          });
        })
        .on('error', (err) => {
          try { fs.unlinkSync(tempPath); } catch (_) {}
          reject(err);
        });
    };
    request(url);
  });
}

// High-refresh-rate GPU & zero-throttling flags for 120fps+ smooth animations
app.commandLine.appendSwitch('enable-transparent-visuals');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

function sendWatcherCommand(cmd) {
  if (nativeWatcher && nativeWatcher.stdin && nativeWatcher.stdin.writable) {
    try {
      nativeWatcher.stdin.write(`${cmd}\n`);
    } catch (_) {}
  }
}

function cropDesktopRegionAsync(rect) {
  return new Promise((resolve) => {
    const scaleFactor = screen.getPrimaryDisplay().scaleFactor || 1;
    const x = Math.round(rect.x * scaleFactor);
    const y = Math.round(rect.y * scaleFactor);
    const w = Math.max(8, Math.round(rect.width * scaleFactor));
    const h = Math.max(8, Math.round(rect.height * scaleFactor));
    const reqId = `crop_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const outPath = path.join(os.tmpdir(), `magic_pointer_${reqId}.png`);

    const timer = setTimeout(() => {
      pendingCropCallbacks.delete(reqId);
      resolve(null);
    }, 1800);

    pendingCropCallbacks.set(reqId, (ok, ocrText) => {
      clearTimeout(timer);
      if (ok && fs.existsSync(outPath)) {
        try {
          const data = fs.readFileSync(outPath);
          resolve({
            filePath: outPath,
            dataUrl: `data:image/png;base64,${data.toString('base64')}`,
            ocrText: ocrText || '',
            width: rect.width,
            height: rect.height
          });
          return;
        } catch (_) {}
      }
      resolve(null);
    });

    sendWatcherCommand(`CROP:${reqId}|${x}|${y}|${w}|${h}|${outPath}`);
  });
}

function createOverlayWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { x, y, width, height } = primaryDisplay.bounds;
  const winIconPath = path.join(__dirname, 'extracted_assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png');

  overlayWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    icon: fs.existsSync(winIconPath) ? winIconPath : undefined,
    enableLargerThanScreen: true,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    fullscreenable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  overlayWindow.setBounds({ x, y, width, height });
  overlayWindow.setAlwaysOnTop(true, 'screen-saver', 1);
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Pure click-through when idle (do NOT use { forward: true } as it causes DWM mouse-hook lag across Windows!)
  overlayWindow.setIgnoreMouseEvents(true);

  overlayWindow.loadFile('index.html');

  overlayWindow.on('blur', () => {
    // Exact port of MainActivityPeer.onWindowFocusChanged(false) -> scheduleDismissal (MainActivityPeer.java:1520-1670):
    // When another app or screenshot tool (Snipping Tool, Alt+Tab, etc.) takes foreground focus,
    // automatically turn off Magic Pointer!
    setTimeout(() => {
      if (isMagicPointerActive && overlayWindow && !overlayWindow.isDestroyed() && !overlayWindow.isFocused()) {
        deactivateMagicPointer();
      }
    }, 120);
  });

  overlayWindow.once('ready-to-show', () => {
    overlayWindow.setBounds({ x, y, width, height });
    overlayWindow.showInactive();
    try {
      const hwndBuf = overlayWindow.getNativeWindowHandle();
      const hwndVal = hwndBuf.length >= 8 ? hwndBuf.readBigInt64LE(0).toString() : hwndBuf.readInt32LE(0).toString();
      sendWatcherCommand(`HWND:${hwndVal}`);
    } catch (_) {}
    if (process.argv.includes('--activate') || !process.argv.includes('--background')) {
      const cursorPt = screen.getCursorScreenPoint();
      activateMagicPointer(cursorPt.x, cursorPt.y, 'launch');
    }
  });
}

function activateMagicPointer(rawX, rawY, source = 'shake') {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;

  if (!isMagicPointerActive && source !== 'shake') {
    // Ask the persistent C# watcher to take a 5ms in-RAM BitBlt snapshot before overlay appears
    sendWatcherCommand('SNAPSHOT');
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const { x, y, width, height } = primaryDisplay.bounds;
  const dipCursor = screen.getCursorScreenPoint();
  isMagicPointerActive = true;
  sendWatcherCommand('ACTIVE:1');

  overlayWindow.setIgnoreMouseEvents(false);
  // Show and focus the already-fullscreen, already-alwaysOnTop overlay window with zero redundant DWM bounds/level calls!
  overlayWindow.show();
  overlayWindow.focus();

  overlayWindow.webContents.send('magic-pointer:activate', {
    x: dipCursor.x,
    y: dipCursor.y,
    source,
    isDarkMode,
    sensitivityLevel,
    targetApp,
    targetAppAvailability: getTargetAppsAvailability(),
    magicCueEnabled,
    llmSuggestionsEnabled,
    llmModelDownloaded,
    llmModelDirUrl: getLlmModelDirFileUrl(),
    detectedWindows: cachedDetectedWindows
  });
}

function deactivateMagicPointer() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  isMagicPointerActive = false;
  sendWatcherCommand('ACTIVE:0');
  overlayWindow.setIgnoreMouseEvents(true);
  overlayWindow.webContents.send('magic-pointer:deactivate');
}

function getNativeWatcherExePath() {
  const v4Path = path.join(__dirname, 'native', 'MagicCursorNative_v4.exe');
  if (fs.existsSync(v4Path)) return v4Path;
  const v3Path = path.join(__dirname, 'native', 'MagicCursorNative_v3.exe');
  if (fs.existsSync(v3Path)) return v3Path;
  const v2Path = path.join(__dirname, 'native', 'MagicCursorNative_v2.exe');
  if (fs.existsSync(v2Path)) return v2Path;
  return path.join(__dirname, 'native', 'MagicCursorNative.exe');
}

function startNativeWatcher() {
  const exePath = getNativeWatcherExePath();
  if (!fs.existsSync(exePath)) {
    console.error('MagicCursorNative executable not found at:', exePath);
    return;
  }

  nativeWatcher = spawn(exePath, [], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'ignore']
  });

  if (overlayWindow && !overlayWindow.isDestroyed()) {
    try {
      const hwndBuf = overlayWindow.getNativeWindowHandle();
      const hwndVal = hwndBuf.length >= 8 ? hwndBuf.readBigInt64LE(0).toString() : hwndBuf.readInt32LE(0).toString();
      sendWatcherCommand(`HWND:${hwndVal}`);
    } catch (_) {}
  }

  let buffer = '';
  nativeWatcher.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.type === 'shake') {
          activateMagicPointer(msg.x, msg.y, 'shake');
        } else if (msg.type === 'hotkey') {
          if (isMagicPointerActive) {
            if (overlayWindow && !overlayWindow.isDestroyed()) {
              overlayWindow.webContents.send('magic-pointer:esc-key');
            } else {
              deactivateMagicPointer();
            }
          } else {
            activateMagicPointer(msg.x, msg.y, 'hotkey');
          }
        } else if (msg.type === 'esc') {
          if (isMagicPointerActive && overlayWindow && !overlayWindow.isDestroyed()) {
            overlayWindow.webContents.send('magic-pointer:esc-key');
          }
        } else if (msg.type === 'focus_lost') {
          if (isMagicPointerActive) {
            deactivateMagicPointer();
          }
        } else if (msg.type === 'move') {
          if (isMagicPointerActive && overlayWindow && !overlayWindow.isDestroyed()) {
            const scaleFactor = screen.getPrimaryDisplay().scaleFactor || 1;
            overlayWindow.webContents.send('magic-pointer:cursor', {
              x: Math.round(msg.x / scaleFactor),
              y: Math.round(msg.y / scaleFactor)
            });
          }
        } else if (msg.type === 'cropped') {
          const cb = pendingCropCallbacks.get(msg.id);
          if (cb) {
            pendingCropCallbacks.delete(msg.id);
            cb(!!msg.ok, msg.ocrText || '');
          }
        } else if (msg.type === 'windows') {
          const scaleFactor = screen.getPrimaryDisplay().scaleFactor || 1;
          cachedDetectedWindows = Array.isArray(msg.rects)
            ? msg.rects.map((r) => ({
                x: Math.round(r.x / scaleFactor),
                y: Math.round(r.y / scaleFactor),
                width: Math.round(r.width / scaleFactor),
                height: Math.round(r.height / scaleFactor),
                category: r.category || 'WINDOW',
                title: r.title || ''
              }))
            : [];
        } else if (msg.type === 'screenshot') {
          const scaleFactor = screen.getPrimaryDisplay().scaleFactor || 1;
          latestScreenshotInfo = {
            path: msg.path,
            width: msg.width,
            height: msg.height,
            scaleFactor,
            timestamp: Date.now()
          };
          if (overlayWindow && !overlayWindow.isDestroyed()) {
            overlayWindow.webContents.send('magic-pointer:screenshot', latestScreenshotInfo);
          }
        } else if (msg.type === 'ocr') {
          const scaleFactor = screen.getPrimaryDisplay().scaleFactor || 1;
          latestOcrInfo = {
            screenW: Math.round((msg.screenW || 1920) / scaleFactor),
            screenH: Math.round((msg.screenH || 1080) / scaleFactor),
            scaleFactor,
            lines: Array.isArray(msg.lines)
              ? msg.lines.map((l) => ({
                  text: l.text || '',
                  words: Array.isArray(l.words)
                    ? l.words.map((w) => ({
                        text: w.text || '',
                        x: Math.round(w.x / scaleFactor),
                        y: Math.round(w.y / scaleFactor),
                        w: Math.max(2, Math.round(w.w / scaleFactor)),
                        h: Math.max(2, Math.round(w.h / scaleFactor))
                      }))
                    : []
                }))
              : []
          };
          if (overlayWindow && !overlayWindow.isDestroyed()) {
            overlayWindow.webContents.send('magic-pointer:ocr', latestOcrInfo);
          }
        }
      } catch (_) {}
    }
  });

  nativeWatcher.on('exit', () => {
    setTimeout(() => {
      if (!app.isQuitting) startNativeWatcher();
    }, 800);
  });
}

function getTrayIconImage() {
  const useDarkTaskbarIcon = nativeTheme ? nativeTheme.shouldUseDarkColors : true;
  const icoName = useDarkTaskbarIcon ? 'icon.ico' : 'icon_light.ico';
  const pngName = useDarkTaskbarIcon ? 'tray_icon_dark.png' : 'tray_icon_light.png';
  const icoPath = path.join(__dirname, 'extracted_assets', icoName);
  const pngPath = path.join(__dirname, 'extracted_assets', pngName);
  const fallbackPng = path.join(__dirname, 'extracted_assets', 'icon.png');

  if (process.platform === 'win32' && fs.existsSync(icoPath)) {
    return nativeImage.createFromPath(icoPath);
  }
  if (fs.existsSync(pngPath)) {
    const img = nativeImage.createFromPath(pngPath);
    if (process.platform === 'darwin') img.setTemplateImage(true);
    return img;
  }
  return nativeImage.createFromPath(fallbackPng);
}

function createTray() {
  const shortcutLabel = process.platform === 'darwin' ? 'Cmd+G' : 'Win+G';
  tray = new Tray(getTrayIconImage());
  tray.setToolTip(`Googlebook Magic Pointer (Shake Cursor or ${shortcutLabel})`);

  if (nativeTheme) {
    nativeTheme.on('updated', () => {
      if (tray && !tray.isDestroyed()) {
        tray.setImage(getTrayIconImage());
      }
    });
  }

  const updateMenu = () => {
    const contextMenu = Menu.buildFromTemplate([
      {
        label: `Spawn Magic Pointer (Shake Cursor / ${shortcutLabel})`,
        click: () => {
          const pt = screen.getCursorScreenPoint();
          activateMagicPointer(pt.x, pt.y, 'tray');
        }
      },
      {
        label: 'Open Wiggle Sensitivity & Tutorial',
        click: () => {
          const pt = screen.getCursorScreenPoint();
          activateMagicPointer(pt.x, pt.y, 'tutorial');
        }
      },
      { type: 'separator' },
      {
        label: `Target AI App: ${getTargetAppDisplayName(targetApp)}`,
        submenu: [
          { id: 'gemini', name: 'Gemini (Default)' },
          { id: 'claude', name: 'Claude' },
          { id: 'chatgpt', name: 'ChatGPT' }
        ].map((item) => {
          const installed = isTargetAppInstalled(item.id);
          return {
            label: `${item.name}${installed ? ' · Installed' : ' · Not Installed'}`,
            type: 'radio',
            checked: targetApp === item.id,
            click: () => {
              targetApp = item.id;
              savePersistedSettings();
              if (overlayWindow && !overlayWindow.isDestroyed()) {
                overlayWindow.webContents.send('magic-pointer:target-app', {
                  targetApp,
                  availability: getTargetAppsAvailability()
                });
              }
              updateMenu();
            }
          };
        })
      },
      {
        label: `Open ${getTargetAppDisplayName(targetApp)} Desktop App (Companion Window)`,
        click: () => {
          sendWatcherCommand(`OPEN_AI:${targetApp}`);
        }
      },
      { type: 'separator' },
      {
        label: `Wiggle Sensitivity: Speed ${sensitivityLevel} (Level ${sensitivityLevel + 1})`,
        submenu: [0, 1, 2, 3].map((lvl) => ({
          label: `Speed ${lvl} — Level ${lvl + 1} ${lvl === 0 ? '(Lowest)' : lvl === 1 ? '(Medium-Low)' : lvl === 2 ? '(Default)' : '(Highest)'}`,
          type: 'radio',
          checked: sensitivityLevel === lvl,
          click: () => {
            sensitivityLevel = lvl;
            sendWatcherCommand(`SENSITIVITY:${lvl}`);
            if (overlayWindow && !overlayWindow.isDestroyed()) {
              overlayWindow.webContents.send('magic-pointer:sensitivity', lvl);
            }
            updateMenu();
          }
        }))
      },
      {
        label: 'Dark Theme',
        type: 'checkbox',
        checked: isDarkMode,
        click: (item) => {
          isDarkMode = item.checked;
          if (overlayWindow && !overlayWindow.isDestroyed()) {
            overlayWindow.webContents.send('magic-pointer:theme', isDarkMode);
          }
        }
      },
      {
        label: 'Magic Cue Smart Actions (Bundled)',
        type: 'checkbox',
        checked: magicCueEnabled,
        click: (item) => {
          magicCueEnabled = item.checked;
          savePersistedSettings();
          if (overlayWindow && !overlayWindow.isDestroyed()) {
            overlayWindow.webContents.send('magic-pointer:magic-cue-state', {
              enabled: magicCueEnabled,
              downloaded: true
            });
          }
          updateMenu();
        }
      },
      {
        label: llmModelDownloaded
          ? 'Smart Suggestion AI (On-Device 500 MB Vision + 248M LLM)'
          : 'Smart Suggestion AI (Download Required — 500 MB)',
        type: 'checkbox',
        checked: llmSuggestionsEnabled,
        click: (item) => {
          if (!llmModelDownloaded) {
            item.checked = false;
            const pt = screen.getCursorScreenPoint();
            activateMagicPointer(pt.x, pt.y, 'llm-setup');
            updateMenu();
            return;
          }
          llmSuggestionsEnabled = item.checked;
          savePersistedSettings();
          if (overlayWindow && !overlayWindow.isDestroyed()) {
            overlayWindow.webContents.send('magic-pointer:llm-state', {
              enabled: llmSuggestionsEnabled,
              downloaded: llmModelDownloaded,
              modelDirUrl: getLlmModelDirFileUrl()
            });
          }
          updateMenu();
        }
      },
      { type: 'separator' },
      {
        label: 'Quit Magic Pointer',
        click: () => {
          app.isQuitting = true;
          app.quit();
        }
      }
    ]);
    tray.setContextMenu(contextMenu);
  };
  updateTrayMenuFn = updateMenu;

  updateMenu();
  tray.on('click', () => {
    const pt = screen.getCursorScreenPoint();
    activateMagicPointer(pt.x, pt.y, 'tray');
  });
}

// IPC Handlers
ipcMain.on('magic-pointer:dismiss', () => {
  deactivateMagicPointer();
});

ipcMain.on('magic-pointer:focus-overlay', () => {
  if (overlayWindow && !overlayWindow.isDestroyed() && isMagicPointerActive) {
    overlayWindow.focus();
    sendWatcherCommand('FOCUS');
  }
});

ipcMain.on('magic-pointer:set-sensitivity', (_event, lvl) => {
  const num = Number(lvl);
  sensitivityLevel = Math.max(0, Math.min(3, Number.isFinite(num) ? num : 0));
  sendWatcherCommand(`SENSITIVITY:${sensitivityLevel}`);
});

ipcMain.on('magic-pointer:set-theme', (_event, dark) => {
  isDarkMode = !!dark;
});

ipcMain.handle('magic-pointer:crop-aoi', async (_event, rect) => {
  return await cropDesktopRegionAsync(rect);
});

ipcMain.handle('magic-pointer:save-text-aoi', async (_event, payload) => {
  try {
    if (!payload || !payload.dataUrl) return null;
    const b64 = String(payload.dataUrl).replace(/^data:image\/\w+;base64,/, '');
    const outPath = path.join(os.tmpdir(), `magic_pointer_text_${Date.now()}_${Math.floor(Math.random() * 10000)}.png`);
    fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));
    return { filePath: outPath, dataUrl: payload.dataUrl };
  } catch (_) {
    return null;
  }
});

ipcMain.handle('magic-pointer:copy-text', async (_event, text) => {
  try {
    clipboard.writeText(String(text || ''));
    return { ok: true };
  } catch (_) {
    return { ok: false };
  }
});

ipcMain.handle('magic-pointer:get-windows', async () => {
  sendWatcherCommand('GET_WINDOWS');
  return cachedDetectedWindows;
});

ipcMain.handle('magic-pointer:pick-files', async () => {
  if (!overlayWindow) return [];
  const res = await dialog.showOpenDialog(overlayWindow, {
    title: 'Add content to Magic Pointer',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Images & Documents', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'pdf', 'txt', 'md', 'csv', 'json'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  if (res.canceled || !res.filePaths.length) return [];

  return res.filePaths.map((fp) => {
    const ext = path.extname(fp).toLowerCase();
    const isImage = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(ext);
    let dataUrl = null;
    if (isImage) {
      try {
        const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : `image/${ext.slice(1)}`;
        dataUrl = `data:${mime};base64,${fs.readFileSync(fp).toString('base64')}`;
      } catch (_) {}
    }
    return {
      filePath: fp,
      fileName: path.basename(fp),
      isImage,
      dataUrl
    };
  });
});

ipcMain.handle('magic-pointer:send-to-gemini', async (_event, payload) => {
  const avail = getTargetAppsAvailability();
  const anyInstalled = !!(avail.gemini || avail.claude || avail.chatgpt);
  if (!anyInstalled) {
    // If no supported AI desktop app is downloaded at all, keep Magic Pointer open and
    // show the top-right Material You Settings card with the "No supported AI app is downloaded" prompt!
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('magic-pointer:target-app', {
        targetApp,
        availability: avail,
        openNoAppPrompt: true
      });
    }
    return { ok: false, noAppInstalled: true, availability: avail };
  }

  deactivateMagicPointer();

  const resolvedApp = resolveDefaultOrValidTargetApp((payload && payload.targetApp) || targetApp);
  if (resolvedApp !== targetApp) {
    targetApp = resolvedApp;
    savePersistedSettings();
    if (updateTrayMenuFn) updateTrayMenuFn();
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('magic-pointer:target-app', {
        targetApp,
        availability: getTargetAppsAvailability()
      });
    }
  }

  const payloadFile = path.join(os.tmpdir(), `magic_pointer_send_${Date.now()}.txt`);
  const lines = [];
  lines.push(`TARGET_APP:${resolvedApp}`);
  const promptB64 = Buffer.from(payload.prompt || '', 'utf8').toString('base64');
  lines.push(`PROMPT_B64:${promptB64}`);

  if (Array.isArray(payload.attachments)) {
    for (const att of payload.attachments) {
      if (att.filePath && fs.existsSync(att.filePath)) {
        lines.push(`${att.isImage !== false ? 'IMAGE' : 'FILE'}:${att.filePath}`);
      }
    }
  }

  fs.writeFileSync(payloadFile, lines.join('\n'), 'utf8');

  // Send via the persistent nativeWatcher stdin pipe (which holds the foreground focus token)
  // AND wrap Console.OutputEncoding in try/catch if spawned standalone as fallback!
  if (nativeWatcher && nativeWatcher.stdin && nativeWatcher.stdin.writable) {
    sendWatcherCommand(`SEND:${payloadFile}`);
  } else {
    const exePath = getNativeWatcherExePath();
    spawn(exePath, ['--send', payloadFile], {
      windowsHide: true
    }).unref();
  }

  return { ok: true, targetApp: resolvedApp };
});

ipcMain.handle('magic-pointer:get-target-app', async () => {
  targetApp = resolveDefaultOrValidTargetApp(targetApp);
  return {
    targetApp,
    availability: getTargetAppsAvailability()
  };
});

ipcMain.handle('magic-pointer:set-target-app', async (_event, nextApp) => {
  if (typeof nextApp === 'string' && ['gemini', 'claude', 'chatgpt'].includes(nextApp)) {
    targetApp = nextApp;
    savePersistedSettings();
    if (updateTrayMenuFn) updateTrayMenuFn();
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('magic-pointer:target-app', {
        targetApp,
        availability: getTargetAppsAvailability()
      });
    }
  }
  return {
    ok: true,
    targetApp,
    availability: getTargetAppsAvailability()
  };
});

ipcMain.handle('magic-pointer:download-target-app', async (_event, appId) => {
  deactivateMagicPointer();
  const id = String(appId || 'gemini').toLowerCase();
  try {
    if (id === 'gemini') {
      const localSetup = path.join(os.homedir(), 'Downloads', 'GeminiSetup.exe');
      if (fs.existsSync(localSetup)) {
        await shell.openPath(localSetup);
        return { ok: true, launchedLocalInstaller: true };
      }
      await shell.openExternal('https://gemini.google.com/app');
      return { ok: true };
    }
    if (id === 'claude') {
      const localClaudeSetup = path.join(os.homedir(), 'Downloads', 'Claude Setup.exe');
      if (fs.existsSync(localClaudeSetup)) {
        await shell.openPath(localClaudeSetup);
        return { ok: true, launchedLocalInstaller: true };
      }
      await shell.openExternal('https://claude.ai/download');
      return { ok: true };
    }
    if (id === 'chatgpt') {
      await shell.openExternal('https://openai.com/chatgpt/desktop/');
      return { ok: true };
    }
  } catch (_) {}
  return { ok: false };
});

ipcMain.handle('magic-pointer:get-magic-cue-state', async () => {
  return { enabled: magicCueEnabled, downloaded: true };
});

ipcMain.handle('magic-pointer:set-magic-cue-enabled', async (_event, enabled) => {
  magicCueEnabled = !!enabled;
  savePersistedSettings();
  if (updateTrayMenuFn) updateTrayMenuFn();
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('magic-pointer:magic-cue-state', {
      enabled: magicCueEnabled,
      downloaded: true
    });
  }
  return { ok: true, enabled: magicCueEnabled, downloaded: true };
});

ipcMain.handle('magic-pointer:get-llm-state', async () => {
  llmModelDownloaded = checkLlmModelDownloaded();
  return {
    enabled: llmSuggestionsEnabled && llmModelDownloaded,
    downloaded: llmModelDownloaded,
    downloading: isLlmDownloading,
    modelDirUrl: getLlmModelDirFileUrl()
  };
});

ipcMain.handle('magic-pointer:set-llm-enabled', async (_event, enabled) => {
  llmModelDownloaded = checkLlmModelDownloaded();
  if (enabled && !llmModelDownloaded) {
    return { ok: false, needsDownload: true, enabled: false, downloaded: false };
  }
  llmSuggestionsEnabled = !!enabled;
  savePersistedSettings();
  if (updateTrayMenuFn) updateTrayMenuFn();
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('magic-pointer:llm-state', {
      enabled: llmSuggestionsEnabled,
      downloaded: llmModelDownloaded,
      modelDirUrl: getLlmModelDirFileUrl()
    });
  }
  return {
    ok: true,
    enabled: llmSuggestionsEnabled,
    downloaded: llmModelDownloaded,
    modelDirUrl: getLlmModelDirFileUrl()
  };
});

ipcMain.handle('magic-pointer:download-llm-model', async () => {
  if (isLlmDownloading) return { ok: false, error: 'Already downloading' };
  isLlmDownloading = true;
  const sendProgress = (pct, status) => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('magic-pointer:llm-download-progress', { pct, status });
    }
  };
  try {
    const totalExpectedBytes = LLM_DOWNLOAD_SPECS.reduce((acc, s) => acc + s.size, 0);
    let completedFilesBytes = 0;

    for (let i = 0; i < LLM_DOWNLOAD_SPECS.length; i++) {
      const spec = LLM_DOWNLOAD_SPECS[i];
      const destPath = path.join(llmModelsBaseDir, spec.dir, ...spec.rel.split('/'));
      if (fs.existsSync(destPath) && fs.statSync(destPath).size > 10) {
        completedFilesBytes += fs.statSync(destPath).size;
        continue;
      }
      const url = `https://huggingface.co/${spec.repo}/resolve/main/${spec.rel}`;
      const fileLabel = `${spec.dir}/${path.basename(spec.rel)}`;

      sendProgress(
        Math.min(99, Math.round((completedFilesBytes / totalExpectedBytes) * 100)),
        `Downloading ${fileLabel} (${i + 1}/${LLM_DOWNLOAD_SPECS.length})...`
      );

      await downloadFileWithRedirects(url, destPath, (_chunkLen, fileReceived) => {
        const curTotal = completedFilesBytes + fileReceived;
        const pct = Math.min(99, Math.max(1, Math.round((curTotal / totalExpectedBytes) * 100)));
        const mbDone = (curTotal / (1024 * 1024)).toFixed(1);
        const mbTotal = (totalExpectedBytes / (1024 * 1024)).toFixed(1);
        sendProgress(pct, `Downloading Vision + Suggestion AI (${mbDone} / ${mbTotal} MB)...`);
      });

      const actualSize = fs.existsSync(destPath) ? fs.statSync(destPath).size : spec.size;
      completedFilesBytes += actualSize;
    }

    isLlmDownloading = false;
    llmModelDownloaded = checkLlmModelDownloaded();
    llmSuggestionsEnabled = llmModelDownloaded;
    savePersistedSettings();
    sendProgress(100, 'On-Device Vision + Suggestion AI installed and enabled!');
    if (updateTrayMenuFn) updateTrayMenuFn();
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('magic-pointer:llm-state', {
        enabled: llmSuggestionsEnabled,
        downloaded: llmModelDownloaded,
        modelDirUrl: getLlmModelDirFileUrl()
      });
    }
    return {
      ok: true,
      enabled: llmSuggestionsEnabled,
      downloaded: llmModelDownloaded,
      modelDirUrl: getLlmModelDirFileUrl()
    };
  } catch (err) {
    isLlmDownloading = false;
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle('magic-pointer:execute-magic-cue', async (_event, actionPayload) => {
  // Exact port of PromptBoxStateFragmentPeer.sendPendingIntentAndFinish (PromptBoxStateFragmentPeer.java:633-641):
  // Executes the MagicCue RemoteAction PendingIntent and finishes Magic Pointer with clearSelectionAndFinish(false)!
  deactivateMagicPointer();
  if (actionPayload && actionPayload.url) {
    try {
      await shell.openExternal(actionPayload.url);
    } catch (_) {}
  }
  return { ok: true };
});

app.whenReady().then(() => {
  loadPersistedSettings();
  createOverlayWindow();
  createTray();
  startNativeWatcher();

  const toggleMagicPointerByHotkey = () => {
    if (isMagicPointerActive) {
      deactivateMagicPointer();
    } else {
      const pt = screen.getCursorScreenPoint();
      activateMagicPointer(pt.x, pt.y, 'hotkey');
    }
  };

  // Register Command+G on macOS and Super+G (Windows+G) + Alt+M on Windows/Linux
  if (process.platform === 'darwin') {
    try { globalShortcut.register('Command+G', toggleMagicPointerByHotkey); } catch (_) {}
  } else {
    try { globalShortcut.register('Super+G', toggleMagicPointerByHotkey); } catch (_) {}
  }
  try { globalShortcut.register('Alt+M', toggleMagicPointerByHotkey); } catch (_) {}
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  sendWatcherCommand('ACTIVE:0');
  if (nativeWatcher) {
    try { nativeWatcher.kill(); } catch (_) {}
  }
});
