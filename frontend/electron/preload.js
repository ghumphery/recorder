const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  getVersion: () => ipcRenderer.invoke('get:version'),
  openFileDialog: () => ipcRenderer.invoke('dialog:openFile'),
  openDirDialog: () => ipcRenderer.invoke('dialog:openDir'),
  saveFileDialog: (n) => ipcRenderer.invoke('dialog:saveFile', n),
  importAudio: (p) => ipcRenderer.invoke('import:audio', p),
  saveRecorded: (p) => ipcRenderer.invoke('save:recorded', p),
  listModels: () => ipcRenderer.invoke('models:list'),
  downloadModel: (s) => ipcRenderer.invoke('model:download', s),
  deleteModel: (s) => ipcRenderer.invoke('model:delete', s),
  transcribe: (p) => ipcRenderer.invoke('transcribe:start', p),
  transcribeSegment: (p) => ipcRenderer.invoke('transcribe:segment', p),
  transcribeCancel: (p) => ipcRenderer.invoke('transcribe:cancel', p),
  onTranscribeProgress: (callback) => {
    const handler = (event, data) => callback(data)
    ipcRenderer.on('transcribe:progress', handler)
    return () => ipcRenderer.removeListener('transcribe:progress', handler)
  },
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
  // LLM Job 管理
  llmJobSubmit: (p) => ipcRenderer.invoke('llm:jobSubmit', p),
  llmJobStatus: (p) => ipcRenderer.invoke('llm:jobStatus', p),
  llmJobList: () => ipcRenderer.invoke('llm:jobList'),
  llmJobCancel: (p) => ipcRenderer.invoke('llm:jobCancel', p),
  onLlmJobUpdate: (callback) => {
    ipcRenderer.on('llm:jobUpdate', (event, data) => callback(data))
  },
  // 錄音歷史與全文檢索
  recoSaveMeta: (p) => ipcRenderer.invoke('reco:saveMeta', p),
  recoList: (p) => ipcRenderer.invoke('reco:list', p || {}),
  recoSearch: (p) => ipcRenderer.invoke('reco:search', p),
  recoAiQuery: (p) => ipcRenderer.invoke('reco:aiQuery', p),
  // 音檔列表、載入 Meta、LLM 處理、批次辨識新音檔
  recoListAudioFiles: () => ipcRenderer.invoke('reco:listAudioFiles'),
  recoLoadMeta: (p) => ipcRenderer.invoke('reco:loadMeta', p),
  recoLlmProcess: (p) => ipcRenderer.invoke('reco:llmProcess', p),
  recoBatchTranscribeNew: (p) => ipcRenderer.invoke('reco:batchTranscribeNew', p),
  onBatchNewProgress: (callback) => {
    ipcRenderer.on('reco:batch-progress', (event, data) => callback(data))
  },
  // 刪除錄音記錄
  recoDeleteMeta: (p) => ipcRenderer.invoke('reco:deleteMeta', p),
  // 批次刪除
  recoBatchDelete: (p) => ipcRenderer.invoke('reco:batchDelete', p),
  // 刪除音檔
  recoDeleteAudio: (p) => ipcRenderer.invoke('reco:deleteAudio', p),
  // 取得音檔 URL（自訂 protocol）
  recoGetAudioUrl: (p) => ipcRenderer.invoke('reco:getAudioUrl', p),
  // 取得 reco_data 路徑
  recoGetDataPath: () => ipcRenderer.invoke('reco:dataPath'),
  // Label 管理
  recoUpdateLabels: (p) => ipcRenderer.invoke('reco:updateLabels', p),
  recoListLabels: () => ipcRenderer.invoke('reco:listLabels'),
  // 樹狀目錄管理
  recoCreateFolder: (p) => ipcRenderer.invoke('reco:createFolder', p),
  recoDeleteFolder: (p) => ipcRenderer.invoke('reco:deleteFolder', p),
  recoRenameFolder: (p) => ipcRenderer.invoke('reco:renameFolder', p),
  recoMoveRecordings: (p) => ipcRenderer.invoke('reco:moveRecordings', p),
   recoListAllFolders: () => ipcRenderer.invoke('reco:listAllFolders'),
   // LLM 文件管理
   recoDeleteLlmDoc: (p) => ipcRenderer.invoke('reco:deleteLlmDoc', p),
   // 聲紋說話者標註
   voiceprintStatus: () => ipcRenderer.invoke('voiceprint:status'),
   voiceprintDownload: () => ipcRenderer.invoke('voiceprint:download'),
   voiceprintDiarize: (p) => ipcRenderer.invoke('voiceprint:diarize', p),
   onVoiceprintDownloadProgress: (callback) => {
     ipcRenderer.on('voiceprint:download-progress', (event, data) => callback(data))
   },
   onVoiceprintProgress: (callback) => {
     ipcRenderer.on('voiceprint:progress', (event, data) => callback(data))
   },
})
