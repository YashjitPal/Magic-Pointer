const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('magicPointerAPI', {
  onActivate: (cb) => ipcRenderer.on('magic-pointer:activate', (_e, data) => cb(data)),
  onDeactivate: (cb) => ipcRenderer.on('magic-pointer:deactivate', () => cb()),
  onEscKey: (cb) => ipcRenderer.on('magic-pointer:esc-key', () => cb()),
  onScreenshotReady: (cb) => ipcRenderer.on('magic-pointer:screenshot', (_e, data) => cb(data)),
  onOcrReady: (cb) => ipcRenderer.on('magic-pointer:ocr', (_e, data) => cb(data)),
  onCursorMove: (cb) => ipcRenderer.on('magic-pointer:cursor', (_e, data) => cb(data)),
  onSensitivityChange: (cb) => ipcRenderer.on('magic-pointer:sensitivity', (_e, lvl) => cb(lvl)),
  onThemeChange: (cb) => ipcRenderer.on('magic-pointer:theme', (_e, dark) => cb(dark)),
  onMagicCueStateChange: (cb) => ipcRenderer.on('magic-pointer:magic-cue-state', (_e, state) => cb(state)),
  onMagicCueDownloadProgress: (cb) => ipcRenderer.on('magic-pointer:magic-cue-download-progress', (_e, prog) => cb(prog)),
  dismiss: () => ipcRenderer.send('magic-pointer:dismiss'),
  focusOverlay: () => ipcRenderer.send('magic-pointer:focus-overlay'),
  setSensitivity: (lvl) => ipcRenderer.send('magic-pointer:set-sensitivity', lvl),
  setTheme: (dark) => ipcRenderer.send('magic-pointer:set-theme', dark),
  getMagicCueState: () => ipcRenderer.invoke('magic-pointer:get-magic-cue-state'),
  setMagicCueEnabled: (enabled) => ipcRenderer.invoke('magic-pointer:set-magic-cue-enabled', enabled),
  downloadMagicCuePack: () => ipcRenderer.invoke('magic-pointer:download-magic-cue-pack'),
  executeMagicCue: (payload) => ipcRenderer.invoke('magic-pointer:execute-magic-cue', payload),
  cropAOI: (rect) => ipcRenderer.invoke('magic-pointer:crop-aoi', rect),
  saveTextAoi: (payload) => ipcRenderer.invoke('magic-pointer:save-text-aoi', payload),
  getWindows: () => ipcRenderer.invoke('magic-pointer:get-windows'),
  pickFiles: () => ipcRenderer.invoke('magic-pointer:pick-files'),
  sendToGemini: (payload) => ipcRenderer.invoke('magic-pointer:send-to-gemini', payload),
  triggerChromeShortcut: (mode) => ipcRenderer.invoke('magic-pointer:trigger-chrome-shortcut', mode)
});

