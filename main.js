const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, dialog, screen, nativeImage, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

let overlayWindow = null;
let tray = null;
let nativeWatcher = null;
let isMagicPointerActive = false;
let sensitivityLevel = 2;
let isDarkMode = true;
const pendingCropCallbacks = new Map();
let cachedDetectedWindows = [];
let latestScreenshotInfo = null;
let latestOcrInfo = null;

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

    pendingCropCallbacks.set(reqId, (ok) => {
      clearTimeout(timer);
      if (ok && fs.existsSync(outPath)) {
        try {
          const data = fs.readFileSync(outPath);
          resolve({
            filePath: outPath,
            dataUrl: `data:image/png;base64,${data.toString('base64')}`,
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

  overlayWindow.setBounds({ x, y, width, height });
  overlayWindow.setIgnoreMouseEvents(false);
  overlayWindow.setAlwaysOnTop(true, 'screen-saver', 1);
  // Show without stealing OS focus from Chrome/YouTube/Twitter so hardware video planes and
  // focus-dependent web players don't pause or blank out when the pointer appears!
  overlayWindow.showInactive();

  overlayWindow.webContents.send('magic-pointer:activate', {
    x: dipCursor.x,
    y: dipCursor.y,
    source,
    isDarkMode,
    sensitivityLevel,
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
            deactivateMagicPointer();
          } else {
            activateMagicPointer(msg.x, msg.y, 'hotkey');
          }
        } else if (msg.type === 'esc') {
          if (isMagicPointerActive && overlayWindow && !overlayWindow.isDestroyed()) {
            overlayWindow.webContents.send('magic-pointer:esc-key');
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
            cb(!!msg.ok);
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
        label: 'Open Gemini in Chrome Floating Head (Alt+G)',
        click: () => {
          const exePath = getNativeWatcherExePath();
          spawn(exePath, ['--alt-g'], { windowsHide: true });
        }
      },
      {
        label: 'Gemini in Chrome Selection Mode (Ctrl+Alt+G)',
        click: () => {
          const exePath = getNativeWatcherExePath();
          spawn(exePath, ['--ctrl-alt-g'], { windowsHide: true });
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
  }
});

ipcMain.on('magic-pointer:set-sensitivity', (_event, lvl) => {
  const num = Number(lvl);
  sensitivityLevel = Math.max(0, Math.min(3, Number.isFinite(num) ? num : 2));
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
  deactivateMagicPointer();

  const payloadFile = path.join(os.tmpdir(), `magic_pointer_send_${Date.now()}.txt`);
  const lines = [];
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

  const exePath = path.join(__dirname, 'native', 'MagicCursorNative.exe');
  spawn(exePath, ['--send', payloadFile], {
    windowsHide: true,
    detached: true,
    stdio: 'ignore'
  }).unref();

  return { ok: true };
});

ipcMain.handle('magic-pointer:trigger-chrome-shortcut', async (_event, mode) => {
  deactivateMagicPointer();
  const exePath = path.join(__dirname, 'native', 'MagicCursorNative.exe');
  const flag = mode === 'ctrl-alt-g' ? '--ctrl-alt-g' : '--alt-g';
  spawn(exePath, [flag], {
    windowsHide: true,
    detached: true,
    stdio: 'ignore'
  }).unref();
  return { ok: true };
});

app.whenReady().then(() => {
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
