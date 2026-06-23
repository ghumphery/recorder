const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  getVersion: () => ipcRenderer.invoke('get:version'),
  openFileDialog: () => ipcRenderer.invoke('dialog:openFile'),
  saveFileDialog: (n) => ipcRenderer.invoke('dialog:saveFile', n),
  importAudio: (p) => ipcRenderer.invoke('import:audio', p),
  saveRecorded: (p) => ipcRenderer.invoke('save:recorded', p),
  listModels: () => ipcRenderer.invoke('models:list'),
  downloadModel: (s) => ipcRenderer.invoke('model:download', s),
  transcribe: (p) => ipcRenderer.invoke('transcribe:start', p),
  transcribeSegment: (p) => ipcRenderer.invoke('transcribe:segment', p),
  exportSave: (p) => ipcRenderer.invoke('export:save', p),
  getLlmProviders: () => ipcRenderer.invoke('llm:providers'),
  llmOptimize: (p) => ipcRenderer.invoke('llm:optimize', p),
  llmTranslate: (p) => ipcRenderer.invoke('llm:translate', p),
  llmSummary: (p) => ipcRenderer.invoke('llm:summary', p),
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (s) => ipcRenderer.invoke('settings:save', s),
  onDownloadProgress: (callback) => {
    ipcRenderer.on('model:download-progress', (event, data) => callback(data))
  },
  // 錄音歷史與全文檢索
  recoSaveMeta: (p) => ipcRenderer.invoke('reco:saveMeta', p),
  recoList: () => ipcRenderer.invoke('reco:list'),
  recoSearch: (p) => ipcRenderer.invoke('reco:search', p),
  recoAiQuery: (p) => ipcRenderer.invoke('reco:aiQuery', p),
})
