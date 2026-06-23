<template>
  <div class="app">
    <!-- 設定列 -->
    <div class="settings-bar" v-if="showSettings">
      <div class="setting-row">
        <label>AI 提供商：</label>
        <select v-model="llmProvider" @change="onProviderChange">
          <option v-for="p in llmProviders" :key="p.key" :value="p.key">{{ p.name }}</option>
        </select>
        <input v-model="llmModel" placeholder="模型名稱（留空用預設）" class="model-input" />
      </div>
      <div class="setting-row" v-for="p in llmProviders" :key="p.key">
        <label v-if="p.key !== 'ollama'" style="min-width:140px">{{ p.name }} API Key：</label>
        <input v-if="p.key !== 'ollama'" v-model="apiKeys[p.key]" :type="showApiKey[p.key] ? 'text' : 'password'" :placeholder="`輸入 ${p.name} API Key`" class="api-key-input" />
        <button v-if="p.key !== 'ollama' && p.key === llmProvider" class="btn btn-small" @click="showApiKey[p.key] = !showApiKey[p.key]" style="min-width:50px">{{ showApiKey[p.key] ? '隱藏' : '顯示' }}</button>
      </div>
      <div class="setting-row">
        <label>分段錄音（分鐘）：</label>
        <select v-model="segmentMinutes">
          <option :value="0">不分段</option>
          <option :value="5">5 分鐘</option>
          <option :value="10">10 分鐘</option>
          <option :value="15">15 分鐘</option>
          <option :value="30">30 分鐘</option>
        </select>
      </div>
      <div class="setting-row">
        <label>GPU 加速：</label>
        <label class="toggle-label">
          <input type="checkbox" v-model="useGpu" />
          <span class="toggle-text">{{ useGpu ? '啟用 (Vulkan)' : '停用 (CPU)' }}</span>
        </label>
        <label v-if="useGpu" style="font-size:12px;white-space:nowrap">GPU 編號：</label>
        <input v-if="useGpu" v-model="gpuDevice" type="number" min="0" max="9" step="1" placeholder="0" class="device-input" />
      </div>
      <div class="setting-row">
        <label>工作目錄（reco_data）：</label>
        <span class="reco-dir-path">{{ recoDir || '預設: C:\\Users\\...\\recoder\\reco_data' }}</span>
        <button class="btn btn-small" @click="selectRecoDir" style="background:#1565C0">📁 選擇目錄</button>
      </div>
      <div class="setting-row" style="justify-content:flex-end;gap:6px">
        <button class="btn btn-small btn-save" @click="saveSettings">💾 儲存設定</button>
        <button class="btn btn-small" @click="showSettings = false">關閉</button>
      </div>
    </div>

    <!-- 控制列 -->
    <div class="control-bar">
      <button class="btn btn-settings" @click="showSettings = !showSettings">⚙️</button>

      <button v-if="isRecording && recordingMode === 'mic'" class="btn btn-record" @click="stopRecording">⏹️ 停止錄音</button>
      <button v-else class="btn btn-record" @click="toggleRecording('mic')" :disabled="busy || (isRecording && recordingMode !== 'mic')">🎙️ 麥克風錄音</button>

      <button v-if="isRecording && recordingMode === 'mix'" class="btn btn-mix" @click="stopRecording">⏹️ 停止錄音</button>
      <button v-else class="btn btn-mix" @click="toggleRecording('mix')" :disabled="busy || (isRecording && recordingMode !== 'mix')">🖥️ 混音</button>

      <span v-if="isRecording" class="recording-indicator">
        <span class="rec-dot"></span>
        {{ recordingMode === 'mix' ? '混音' : '麥克風' }} {{ recordingTime }}
        <span v-if="segmentMinutes > 0" class="seg-badge">分段{{ currentSegment }}/{{ segmentMinutes }}分</span>
      </span>

      <button class="btn btn-import" @click="importAudio" :disabled="busy || isRecording">📂 匯入</button>

      <div class="model-select">
        <select v-model="selectedModel" :disabled="busy || isRecording">
          <option v-for="m in models" :key="m.name" :value="m.name">{{ m.name }} {{ m.cached ? '✅' : '⬇️' }}</option>
        </select>
      </div>

      <button class="btn btn-download" @click="downloadModel" :disabled="busy || isRecording || selectedModelCached" :title="selectedModelCached ? '模型已下載' : '手動下載模型'">
        {{ selectedModelCached ? '✅ 已下載' : '⬇️ 下載' }}
      </button>

      <button class="btn btn-transcribe" @click="startTranscribe" :disabled="busy || !audioLoaded || isRecording">🤖 辨識</button>
      <button class="btn btn-export" @click="exportResult" :disabled="busy || !hasResult">💾 匯出</button>
      <button class="btn btn-batch" @click="startBatchTranscribe" :disabled="busy || batchBusy || isRecording">📂 批次轉 txt</button>
    </div>

    <!-- LLM 動作列 -->
    <div class="llm-bar" v-if="hasResult">
      <span class="source-label">來源：</span>
      <select v-model="activeSource" class="source-select" :disabled="llmBusy">
        <option value="original">📝 原始逐字稿</option>
        <option value="optimized" v-if="llmResults.optimized">✨ 優化結果</option>
        <option value="translated" v-if="llmResults.translated">🌐 翻譯結果</option>
        <option value="summary" v-if="llmResults.summary">📋 重點整理</option>
      </select>
      <button class="btn btn-llm" @click="doOptimize" :disabled="llmBusy">✨ 語句優化</button>
      <button class="btn btn-llm" @click="doTranslate" :disabled="llmBusy">🌐 翻譯</button>
      <select v-model="translateTarget" class="lang-select" :disabled="llmBusy">
        <option value="ja">🇯🇵 日文</option>
        <option value="en">🇺🇸 英文</option>
        <option value="zh">🇨🇳 中文</option>
      </select>
      <button class="btn btn-llm" @click="doSummary" :disabled="llmBusy">📋 重點整理</button>
      <span class="sep"></span>
      <button class="btn btn-undo" @click="undo" :disabled="llmBusy || !canUndo" title="復原">↩️</button>
      <button class="btn btn-undo" @click="redo" :disabled="llmBusy || !canRedo" title="取消復原">↪️</button>
      <span v-if="llmBusy" class="llm-spinner">⏳ LLM 處理中...</span>
    </div>

    <div class="status-bar" :class="{ error: statusError }">{{ statusText }}</div>
    <div v-if="showProgress" class="progress-container">
      <div class="progress-bar"><div class="progress-fill" :style="{ width: progressPercent + '%' }"></div></div>
      <div class="progress-text">{{ progressPercent }}%</div>
    </div>
    <div v-if="audioInfo" class="audio-info">📄 {{ audioInfo.filename }}</div>

    <!-- Tab 切換 -->
    <div class="tab-bar">
      <button class="tab-btn" :class="{ active: activeTab === 'transcript' }" @click="activeTab = 'transcript'">📝 逐字稿</button>
      <button class="tab-btn" :class="{ active: activeTab === 'history' }" @click="activeTab = 'history'; loadHistory()">📚 歷史記錄</button>
    </div>

    <!-- 主要內容區：逐字稿 -->
    <div class="content-area" v-if="activeTab === 'transcript'">
      <div class="panel" v-if="hasResult && activeSource === 'original'">
        <div class="panel-header">📝 原始逐字稿（{{ transcriptionResults.length }} 句）</div>
        <div class="panel-body">
          <div v-for="(seg, idx) in transcriptionResults" :key="idx" class="segment">
            <span class="timestamp">[{{ formatTime(seg.start) }} - {{ formatTime(seg.end) }}]</span>
            <span class="text">{{ seg.text }}</span>
          </div>
        </div>
      </div>

      <div class="panel" v-if="activeSource !== 'original' && activeSourceContent">
        <div class="panel-header">{{ activeSourceTitle }}</div>
        <div class="panel-body">
          <pre class="llm-content">{{ activeSourceContent }}</pre>
        </div>
      </div>

      <div v-if="!hasResult && !busy && !isRecording" class="empty-hint">
        🎙️ 麥克風錄音 / 🖥️ 混音錄音 / 📂 匯入音檔 → 🤖 開始辨識
      </div>
    </div>

    <!-- 主要內容區：歷史記錄 -->
    <div class="content-area" v-if="activeTab === 'history'">
      <div class="history-panel">
        <div class="history-toolbar">
          <input v-model="searchKeyword" placeholder="🔍 搜尋關鍵字..." class="search-input" @keyup.enter="doSearch" />
          <button class="btn btn-small btn-search" @click="doSearch">搜尋</button>
          <span class="sep"></span>
          <input v-model="aiQuestion" placeholder="🤖 用 AI 查詢（如：上週討論了什麼？）" class="ai-input" @keyup.enter="doAiQuery" />
          <button class="btn btn-small btn-ai" @click="doAiQuery" :disabled="aiBusy">查詢</button>
        </div>

        <!-- 搜尋結果 -->
        <div v-if="searchResults.length > 0" class="search-results">
          <div class="panel-header">🔍 搜尋結果（{{ searchResults.length }} 筆）</div>
          <div class="panel-body">
            <div v-for="(r, idx) in searchResults" :key="idx" class="segment">
              <span class="timestamp">[{{ r.filename }}] [{{ formatTime(r.start) }} - {{ formatTime(r.end) }}]</span>
              <span class="text">{{ r.text }}</span>
            </div>
          </div>
        </div>

        <!-- AI 查詢結果 -->
        <div v-if="aiResult" class="search-results">
          <div class="panel-header">🤖 AI 查詢結果</div>
          <div class="panel-body">
            <pre class="llm-content">{{ aiResult }}</pre>
          </div>
        </div>

        <!-- 錄音列表 -->
        <div v-if="!searchKeyword && !aiQuestion" class="recording-list">
          <div class="panel-header">📚 錄音記錄（{{ historyList.length }} 筆）</div>
          <div class="panel-body">
            <div v-for="(item, idx) in historyList" :key="idx" class="history-item">
              <div class="history-info">
                <span class="history-date">{{ item.recordedAt }}</span>
                <span class="history-mode">{{ item.recordingMode === 'mix' ? '🖥️ 混音' : '🎙️ 麥克風' }}</span>
                <span class="history-duration">{{ formatTime(item.duration) }}</span>
                <span class="history-segments">{{ item.segmentCount }} 句</span>
              </div>
            </div>
            <div v-if="historyList.length === 0" class="empty-hint">尚無錄音記錄</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  data() {
    return {
      appVersion: '',
      showSettings: false,
      models: [], selectedModel: 'tiny',
      audioLoaded: false, hasResult: false, busy: false,
      showProgress: false, progressPercent: 0,
      statusText: '就緒', statusError: false,
      audioInfo: null, transcriptionResults: [], currentAudioPath: null,
      // 錄音
      isRecording: false, recordingMode: null, recordingTime: '00:00',
      mediaRecorder: null, audioChunks: [], recordingTimer: null,
      recordingSeconds: 0, audioContext: null, recordingStream: null,
      segmentMinutes: 0, currentSegment: 0, segmentBlobs: [],
      _segmentStop: false, _segmentCount: 0, _segmentMimeType: '', _segmentElapsed: 0,
      // LLM
      llmProviders: [], llmProvider: 'ollama', llmModel: '',
      apiKeys: {}, showApiKey: {},
      llmBusy: false,
      llmResults: { optimized: '', translated: '', summary: '' },
      llmHistory: { optimized: [], translated: [], summary: [] },
      llmRedo: { optimized: [], translated: [], summary: [] },
      activeSource: 'original',
      translateTarget: 'ja',
      // GPU
      useGpu: true,
      gpuDevice: '0',
      // 歷史記錄
      activeTab: 'transcript',
      historyList: [],
      searchKeyword: '',
      searchResults: [],
      aiQuestion: '',
      aiResult: '',
      aiBusy: false,
      currentRecordingId: null,
      // 工作目錄
      recoDir: '',
      // 批次轉 txt
      batchBusy: false,
      batchProgress: { current: 0, total: 0, file: '' },
    }
  },
  computed: {
    totalDuration() {
      if (!this.transcriptionResults.length) return '0:00'
      const last = this.transcriptionResults[this.transcriptionResults.length - 1]
      return `${Math.floor(last.end / 60)}:${String(Math.floor(last.end % 60)).padStart(2, '0')}`
    },
    activeSourceContent() {
      if (this.activeSource === 'original') return ''
      return this.llmResults[this.activeSource] || ''
    },
    activeSourceTitle() {
      const titles = { optimized: '✨ 語句優化結果', translated: '🌐 翻譯結果', summary: '📋 會議重點整理' }
      return titles[this.activeSource] || ''
    },
    canUndo() {
      const t = this.activeSource
      return t !== 'original' && this.llmHistory[t] && this.llmHistory[t].length > 0
    },
    selectedModelCached() {
      const m = this.models.find(x => x.name === this.selectedModel)
      return m ? m.cached : false
    },
    canRedo() {
      const t = this.activeSource
      return t !== 'original' && this.llmRedo[t] && this.llmRedo[t].length > 0
    },
  },
  async mounted() {
    try { if (window.electronAPI) this.appVersion = await window.electronAPI.getVersion() } catch (e) {}
    if (window.electronAPI && window.electronAPI.onDownloadProgress) {
      window.electronAPI.onDownloadProgress((data) => {
        if (data && data.percent !== undefined) this.progressPercent = data.percent
      })
    }
    if (window.electronAPI && window.electronAPI.onBatchProgress) {
      window.electronAPI.onBatchProgress((data) => {
        if (data) this.batchProgress = data
      })
    }
    await this.fetchModels()
    await this.fetchLlmProviders()
    await this.loadSettings()
  },
  beforeUnmount() { this.cleanupRecording() },
  methods: {
    formatTime(s) { return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}` },
    async fetchModels() {
      try { if (window.electronAPI) { const d = await window.electronAPI.listModels(); this.models = d.models } }
      catch (e) { this.statusText = `⚠️ ${e.message}`; this.statusError = true }
    },
    async downloadModel() {
      if (!window.electronAPI) return
      const model = this.models.find(m => m.name === this.selectedModel)
      if (model && model.cached) {
        this.statusText = `✅ ${this.selectedModel} 模型已下載`; this.statusError = false
        return
      }
      this.busy = true; this.showProgress = true; this.progressPercent = 0
      this.statusText = `⬇️ 下載模型 ${this.selectedModel}...`; this.statusError = false
      try {
        const r = await window.electronAPI.downloadModel(this.selectedModel)
        if (r.success) {
          this.statusText = `✅ ${this.selectedModel} 模型下載完成`; this.progressPercent = 100
          await this.fetchModels()
        } else {
          this.statusText = `❌ 下載失敗: ${r.error}`; this.statusError = true
        }
      } catch (e) {
        this.statusText = `❌ 下載失敗: ${e.message}`; this.statusError = true
      } finally {
        this.busy = false
        setTimeout(() => { if (!this.busy) this.showProgress = false }, 2000)
      }
    },
    async fetchLlmProviders() {
      try {
        if (window.electronAPI) {
          const d = await window.electronAPI.getLlmProviders()
          this.llmProviders = d.providers
          for (const p of this.llmProviders) {
            if (!this.apiKeys[p.key]) this.apiKeys[p.key] = ''
            if (this.showApiKey[p.key] === undefined) this.showApiKey[p.key] = false
          }
        }
      } catch (e) {}
    },
    async loadSettings() {
      try {
        if (!window.electronAPI) return
        const s = await window.electronAPI.loadSettings()
        if (s.llmProvider) this.llmProvider = s.llmProvider
        if (s.apiKeys) this.apiKeys = { ...s.apiKeys }
        if (s.llmModel) this.llmModel = s.llmModel
        if (s.segmentMinutes !== undefined) this.segmentMinutes = s.segmentMinutes
        if (s.useGpu !== undefined) this.useGpu = s.useGpu
        if (s.gpuDevice !== undefined) this.gpuDevice = s.gpuDevice
        if (s.recoDir) this.recoDir = s.recoDir
        for (const p of this.llmProviders) {
          if (this.showApiKey[p.key] === undefined) this.showApiKey[p.key] = false
        }
      } catch (e) { /* 靜默失敗 */ }
    },
    async selectRecoDir() {
      if (!window.electronAPI) return
      const dir = await window.electronAPI.openDirDialog()
      if (dir) {
        this.recoDir = dir
        this.saveSettings()
      }
    },
    async startBatchTranscribe() {
      if (!window.electronAPI) return
      this.batchBusy = true
      this.batchProgress = { current: 0, total: 0, file: '' }
      this.statusText = '📂 批次轉 txt 開始...'
      this.statusError = false
      try {
        const r = await window.electronAPI.batchTranscribe({
          modelSize: this.selectedModel,
          useGpu: this.useGpu,
          gpuDevice: this.gpuDevice,
        })
        if (r.success) {
          const ok = r.results.filter(x => x.txt).length
          const fail = r.results.filter(x => x.error).length
          this.statusText = `✅ 批次完成：${ok} 成功${fail > 0 ? `，${fail} 失敗` : ''}`
        } else {
          this.statusText = `❌ 批次失敗: ${r.error}`
          this.statusError = true
        }
      } catch (e) {
        this.statusText = `❌ 批次異常: ${e.message}`
        this.statusError = true
      } finally {
        this.batchBusy = false
      }
    },
    async saveSettings() {
      if (!window.electronAPI) {
        this.statusText = '⚠️ 通訊模組未載入，無法儲存設定'
        this.statusError = true
        return
      }
      try {
        const result = await window.electronAPI.saveSettings({
          llmProvider: this.llmProvider,
          apiKeys: { ...this.apiKeys },
          llmModel: this.llmModel,
          segmentMinutes: this.segmentMinutes,
          useGpu: this.useGpu,
          gpuDevice: this.gpuDevice,
        })
        if (result.success) {
          this.statusText = '✅ 設定已儲存（settings.json）'; this.statusError = false
          setTimeout(() => { if (this.statusText === '✅ 設定已儲存（settings.json）') this.statusText = '就緒' }, 2000)
        } else {
          this.statusText = `❌ 儲存失敗: ${result.error || '未知錯誤'}`
          this.statusError = true
        }
      } catch (e) {
        this.statusText = `❌ 儲存失敗: ${e.message}`
        this.statusError = true
      }
    },
    onProviderChange() {
      const p = this.llmProviders.find(x => x.key === this.llmProvider)
      if (p) this.llmModel = p.defaultModel
      this.saveSettings()
    },

    // ── 錄音 ──
    cleanupRecording() {
      if (this.recordingTimer) clearInterval(this.recordingTimer)
      if (this.recordingStream) this.recordingStream.getTracks().forEach(t => t.stop())
      if (this.audioContext) this.audioContext.close().catch(() => {})
      this.mediaRecorder = null; this.recordingStream = null; this.segmentBlobs = []
    },
    async toggleRecording(mode) {
      if (this.isRecording) { this.stopRecording(); return }
      await this.startRecording(mode)
    },
    async startRecording(mode) {
      try {
        this.audioChunks = []; this.recordingSeconds = 0; this.recordingTime = '00:00'
        this.recordingMode = mode; this.segmentBlobs = []; this.currentSegment = 0
        this.transcriptionResults = []; this.hasResult = false
        this.currentRecordingId = null
        this._segmentStop = false; this._segmentCount = 0; this._segmentMimeType = ''
        let finalStream
        if (mode === 'mix') {
          this.statusText = '請選擇畫面（勾選分享音訊）'; this.statusError = false
          const ss = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: { width: 1, height: 1, frameRate: 1 } })
          let ms
          try { ms = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true } }) } catch (e) { console.warn('無麥克風:', e.message) }
          this.audioContext = new (window.AudioContext || window.webkitAudioContext)()
          const dest = this.audioContext.createMediaStreamDestination()
          this.audioContext.createMediaStreamSource(ss).connect(dest)
          if (ms) this.audioContext.createMediaStreamSource(ms).connect(dest)
          finalStream = dest.stream; this.recordingStream = finalStream
          this._systemStream = ss; this._micStream = ms
        } else {
          const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
          finalStream = s; this.recordingStream = s; this._systemStream = null; this._micStream = null
        }
        this.startMediaRecorder(finalStream, mode)
      } catch (e) {
        this.cleanupRecording(); this.isRecording = false; this.recordingMode = null
        this.statusText = `❌ ${e.name === 'NotAllowedError' ? '使用者拒絕授權' : e.message}`; this.statusError = true
      }
    },
    startMediaRecorder(stream, mode) {
      if (this.recordingTimer) clearInterval(this.recordingTimer)
      const mt = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
      this._segmentMimeType = mt
      this._segmentElapsed = 0
      this.mediaRecorder = new MediaRecorder(stream, { mimeType: mt })
      this.mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) this.audioChunks.push(e.data) }
      this.mediaRecorder.onstop = async () => { await this.onRecorderStop(mode) }
      this.mediaRecorder.start(1000); this.isRecording = true
      this.statusText = mode === 'mix' ? '🔴 混音錄音中...' : '🔴 麥克風錄音中...'
      this.recordingTimer = setInterval(() => {
        this.recordingSeconds++
        this._segmentElapsed++
        const m = Math.floor(this.recordingSeconds / 60); const s = this.recordingSeconds % 60
        this.recordingTime = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
        if (this.segmentMinutes > 0 && this._segmentElapsed >= this.segmentMinutes * 60) {
          this.saveSegment()
        }
      }, 1000)
    },
    // 分段邊界：停止 MediaRecorder → onRecorderStop 會處理 blob → 辨識 → 重啟
    saveSegment() {
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        this._segmentStop = true
        this.mediaRecorder.stop()
      }
    },
    // 統一的 onstop 處理器
    async onRecorderStop(mode) {
      const isSegment = this._segmentStop
      this._segmentStop = false

      // 從 audioChunks 建立完整 blob（包含 header，是有效的 webm）
      const blob = new Blob(this.audioChunks, { type: this._segmentMimeType })
      this.audioChunks = []

      if (isSegment) {
        // 分段停止：辨識此 blob，然後重啟 MediaRecorder
        const segIdx = this._segmentCount
        this._segmentCount++
        this.currentSegment = this._segmentCount
        this.statusText = `🔴 分段 ${this.currentSegment} 儲存中...`
        await this.transcribeBlob(blob, this._segmentMimeType, segIdx)
        // 重啟 MediaRecorder（使用同一個 stream）
        if (this.recordingStream && this.isRecording) {
          this.startMediaRecorder(this.recordingStream, mode)
        }
      } else {
        // 使用者停止：清理並處理最終結果
        this.cleanupStreams(mode)
        this.isRecording = false
        this.statusText = '正在處理錄音...'
        this.statusError = false

        try {
          if (this.segmentMinutes > 0) {
            // 分段模式：最後一段 blob 已經在 audioChunks 中，直接辨識
            if (blob.size > 0) {
              const segIdx = this._segmentCount
              this._segmentCount++
              this.currentSegment = this._segmentCount
              await this.transcribeBlob(blob, this._segmentMimeType, segIdx)
            }
            this.statusText = `✅ 錄音完成，共 ${this.transcriptionResults.length} 句`
            this.currentAudioPath = null
            this.audioLoaded = true
            this.audioInfo = { filename: `${mode === 'mix' ? '混音' : '麥克風'}錄音（分段）` }
          } else {
            // 非分段模式：儲存完整錄音
            if (blob.size > 0 && window.electronAPI) {
              const buf = Array.from(new Uint8Array(await blob.arrayBuffer()))
              const label = mode === 'mix' ? '混音' : '麥克風'
              const result = await window.electronAPI.saveRecorded({ buffer: buf, ext: 'webm' })
              if (result.success) {
                this.currentAudioPath = result.path; this.audioLoaded = true
                this.audioInfo = { filename: `${label}錄音.webm` }
                this.hasResult = false; this.transcriptionResults = []
                this.statusText = `✅ ${label}錄音完成 (${this.recordingTime})`
              } else { this.statusText = `❌ 處理失敗: ${result.error}`; this.statusError = true }
            }
          }
        } catch (e) {
          console.warn('錄音停止處理失敗:', e)
          this.statusText = `❌ 處理失敗: ${e.message}`
          this.statusError = true
        }
      }
    },
    async transcribeBlob(blob, mt, segIdx) {
      if (!window.electronAPI) return
      try {
        const buf = Array.from(new Uint8Array(await blob.arrayBuffer()))
        const ext = mt.includes('opus') ? 'webm' : 'webm'
        const result = await window.electronAPI.saveRecorded({ buffer: buf, ext })
        if (result.success) {
          const r = await window.electronAPI.transcribeSegment({
            audioPath: result.path,
            modelSize: this.selectedModel,
            useGpu: this.useGpu,
            gpuDevice: this.gpuDevice,
          })
          if (r.success && r.segments && r.segments.length > 0) {
            const offsetSec = segIdx * this.segmentMinutes * 60
            const shifted = r.segments.map(s => ({
              start: s.start + offsetSec,
              end: s.end + offsetSec,
              text: s.text,
              speaker: '',
            }))
            this.transcriptionResults.push(...shifted)
            if (!this.hasResult) this.hasResult = true
            this.statusText = `✅ 分段 ${segIdx + 1} 辨識完成（${r.segments.length} 句）`
          } else if (r.success && (!r.segments || r.segments.length === 0)) {
            this.statusText = `⚠️ 分段 ${segIdx + 1} 無辨識結果`
          } else {
            this.statusText = `❌ 分段 ${segIdx + 1} 辨識失敗: ${r.error || '未知錯誤'}`
            this.statusError = true
          }
        } else {
          this.statusText = `❌ 分段 ${segIdx + 1} 儲存失敗: ${result.error || '未知錯誤'}`
          this.statusError = true
        }
      } catch (e) {
        this.statusText = `❌ 分段 ${segIdx + 1} 處理異常: ${e.message}`
        this.statusError = true
      }
    },
    cleanupStreams(mode) {
      if (this._systemStream) { this._systemStream.getTracks().forEach(t => t.stop()); this._systemStream = null }
      if (this._micStream) { this._micStream.getTracks().forEach(t => t.stop()); this._micStream = null }
      if (this.recordingStream && mode !== 'mix') this.recordingStream.getTracks().forEach(t => t.stop())
      if (this.audioContext) { this.audioContext.close().catch(() => {}); this.audioContext = null }
      if (this.recordingTimer) { clearInterval(this.recordingTimer); this.recordingTimer = null }
      this.recordingStream = null; this.mediaRecorder = null
    },
    stopRecording() {
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        this._segmentStop = false
        this.mediaRecorder.stop()
      } else {
        this.cleanupRecording(); this.isRecording = false; this.recordingMode = null
      }
    },

    // ── 匯入 ──
    async importAudio() {
      let fp = null
      if (window.electronAPI) fp = await window.electronAPI.openFileDialog()
      else fp = prompt('請輸入路徑：')
      if (!fp) return
      this.busy = true; this.statusText = '載入中...'; this.statusError = false
      try {
        if (!window.electronAPI) return
        const d = await window.electronAPI.importAudio(fp)
        if (d.success) { this.audioLoaded = true; this.currentAudioPath = d.path; this.audioInfo = d; this.hasResult = false; this.transcriptionResults = []; this.statusText = `✅ ${d.filename}` }
        else { this.statusText = `❌ ${d.error}`; this.statusError = true }
      } catch (e) { this.statusText = `❌ ${e.message}`; this.statusError = true }
      finally { this.busy = false }
    },

    // ── 辨識 ──
    async startTranscribe() {
      if (!this.audioLoaded || !this.currentAudioPath) return
      const model = this.models.find(m => m.name === this.selectedModel)
      if (model && !model.cached) {
        if (!window.electronAPI) return
        this.statusText = `下載模型 ${this.selectedModel}...`; this.showProgress = true; this.progressPercent = 0; this.busy = true
        try {
          const r = await window.electronAPI.downloadModel(this.selectedModel)
          if (!r.success) throw new Error(r.error)
        } catch (e) { this.statusText = `❌ ${e.message}`; this.statusError = true; this.showProgress = false; this.busy = false; return }
        await this.fetchModels()
      }
      this.busy = true; this.showProgress = true; this.progressPercent = 0
      this.statusText = '辨識中...'; this.statusError = false
      try {
        if (!window.electronAPI) return
        const r = await window.electronAPI.transcribe({ audioPath: this.currentAudioPath, modelSize: this.selectedModel, useGpu: this.useGpu, gpuDevice: this.gpuDevice })
        if (r.success) {
          this.transcriptionResults = r.segments; this.hasResult = true; this.showProgress = false
          this.statusText = `✅ 共 ${r.segments.length} 句`; this.progressPercent = 100
          this.llmResults = { optimized: '', translated: '', summary: '' }
          this.llmHistory = { optimized: [], translated: [], summary: [] }
          this.llmRedo = { optimized: [], translated: [], summary: [] }
          this.activeSource = 'original'
          await this.saveRecordingMeta(r.segments)
        } else { this.statusText = `❌ ${r.error}`; this.statusError = true; this.showProgress = false }
      } catch (e) { this.statusText = `❌ ${e.message}`; this.statusError = true; this.showProgress = false }
      finally { this.busy = false }
    },
    async saveRecordingMeta(segments, llmResults) {
      if (!window.electronAPI || !this.audioInfo) return
      const now = new Date()
      const id = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}-${String(now.getSeconds()).padStart(2,'0')}_${this.recordingMode || 'import'}`
      const duration = segments.length > 0 ? segments[segments.length-1].end : 0
      await window.electronAPI.recoSaveMeta({
        recordingId: id,
        filename: `${id}.webm`,
        recordingMode: this.recordingMode || 'import',
        recordedAt: now.toISOString(),
        duration,
        modelSize: this.selectedModel,
        segments,
        llmResults: llmResults || this.llmResults,
      })
    },

    // ── LLM ──
    pushHistory(type) {
      if (this.llmResults[type]) { this.llmHistory[type].push(this.llmResults[type]) }
      this.llmRedo[type] = []
    },
    undo() {
      const t = this.activeSource
      if (t === 'original' || !this.llmHistory[t] || !this.llmHistory[t].length) return
      this.llmRedo[t].push(this.llmResults[t])
      this.llmResults[t] = this.llmHistory[t].pop()
    },
    redo() {
      const t = this.activeSource
      if (t === 'original' || !this.llmRedo[t] || !this.llmRedo[t].length) return
      this.llmHistory[t].push(this.llmResults[t])
      this.llmResults[t] = this.llmRedo[t].pop()
    },
    getActiveText() {
      if (this.activeSource === 'original') {
        return this.transcriptionResults.map(s => `[${this.formatTime(s.start)}] ${s.text}`).join('\n')
      }
      return this.llmResults[this.activeSource] || ''
    },
    getLlmParams() {
      const text = this.getActiveText()
      const apiKey = this.apiKeys[this.llmProvider] || ''
      return { provider: this.llmProvider, apiKey, model: this.llmModel, text }
    },
    async doOptimize() {
      if (!window.electronAPI) return
      this.pushHistory('optimized')
      this.llmBusy = true; this.statusText = '✨ 正在優化語句...'
      try {
        const r = await window.electronAPI.llmOptimize(this.getLlmParams())
        if (r.success) { this.llmResults.optimized = r.result; this.activeSource = 'optimized' }
        else { this.statusText = `❌ ${r.error}`; this.statusError = true }
      } catch (e) { this.statusText = `❌ ${e.message}`; this.statusError = true }
      finally { this.llmBusy = false; this.statusText = '✅ 語句優化完成'; this.saveRecordingMeta(this.transcriptionResults) }
    },
    async doTranslate() {
      if (!window.electronAPI) return
      this.pushHistory('translated')
      const labels = { ja: '🇯🇵 日文', en: '🇺🇸 英文', zh: '🇨🇳 中文' }
      this.llmBusy = true; this.statusText = `🌐 正在翻譯成 ${labels[this.translateTarget] || this.translateTarget}...`
      try {
        const params = this.getLlmParams()
        params.target = this.translateTarget
        const r = await window.electronAPI.llmTranslate(params)
        if (r.success) { this.llmResults.translated = r.result; this.activeSource = 'translated' }
        else { this.statusText = `❌ ${r.error}`; this.statusError = true }
      } catch (e) { this.statusText = `❌ ${e.message}`; this.statusError = true }
      finally { this.llmBusy = false; this.statusText = '✅ 翻譯完成'; this.saveRecordingMeta(this.transcriptionResults) }
    },
    async doSummary() {
      if (!window.electronAPI) return
      this.pushHistory('summary')
      this.llmBusy = true; this.statusText = '📋 正在提取重點...'
      try {
        const r = await window.electronAPI.llmSummary(this.getLlmParams())
        if (r.success) { this.llmResults.summary = r.result; this.activeSource = 'summary' }
        else { this.statusText = `❌ ${r.error}`; this.statusError = true }
      } catch (e) { this.statusText = `❌ ${e.message}`; this.statusError = true }
      finally { this.llmBusy = false; this.statusText = '✅ 重點整理完成'; this.saveRecordingMeta(this.transcriptionResults) }
    },

    // ── 匯出 ──
    async exportResult() {
      if (!this.hasResult) return
      const defaultName = this.activeSource === 'original' ? '會議記錄.txt' : `${this.activeSource}.txt`
      let fp = null
      if (window.electronAPI) fp = await window.electronAPI.saveFileDialog(defaultName)
      else fp = prompt('請輸入路徑：')
      if (!fp) return
      this.busy = true; this.statusText = '匯出中...'; this.statusError = false
      try {
        if (!window.electronAPI) return
        const fmt = fp.endsWith('.md') ? 'md' : 'txt'
        let results
        if (this.activeSource === 'original') {
          results = [...this.transcriptionResults]
        } else {
          const text = this.llmResults[this.activeSource] || ''
          results = [{ start: 0, end: 0, text }]
        }
        const r = await window.electronAPI.exportSave({ format: fmt, results, filePath: fp })
        if (r.success) this.statusText = `✅ ${fp}`
        else { this.statusText = `❌ ${r.error}`; this.statusError = true }
      } catch (e) { this.statusText = `❌ ${e.message}`; this.statusError = true }
      finally { this.busy = false }
    },

    // ── 歷史記錄 ──
    async loadHistory() {
      if (!window.electronAPI) return
      try {
        const r = await window.electronAPI.recoList()
        if (r.success) this.historyList = r.list
      } catch (e) { console.warn('載入歷史記錄失敗:', e) }
    },
    async doSearch() {
      if (!this.searchKeyword.trim() || !window.electronAPI) return
      this.searchResults = []
      this.aiResult = ''
      try {
        const r = await window.electronAPI.recoSearch({ keyword: this.searchKeyword.trim() })
        if (r.success) this.searchResults = r.results
        else this.statusText = `❌ 搜尋失敗: ${r.error}`
      } catch (e) { console.warn('搜尋失敗:', e) }
    },
    async doAiQuery() {
      if (!this.aiQuestion.trim() || !window.electronAPI) return
      this.aiBusy = true
      this.searchResults = []
      this.aiResult = ''
      this.statusText = '🤖 AI 查詢中...'
      try {
        const r = await window.electronAPI.recoAiQuery({
          provider: this.llmProvider,
          apiKey: this.apiKeys[this.llmProvider] || '',
          model: this.llmModel,
          question: this.aiQuestion.trim(),
        })
        if (r.success) this.aiResult = r.result
        else this.statusText = `❌ AI 查詢失敗: ${r.error}`
      } catch (e) { this.statusText = `❌ AI 查詢失敗: ${e.message}` }
      finally { this.aiBusy = false; this.statusText = '就緒' }
    },
  },
}
</script>

<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Microsoft JhengHei','Segoe UI',sans-serif; background: #fafafa; color: #333; }
.app { display: flex; flex-direction: column; height: 100vh; padding: 8px; gap: 6px; }

.settings-bar { display: flex; flex-direction: column; gap: 6px; background: #f0f0f0; border-radius: 6px; padding: 8px 12px; }
.setting-row { display: flex; align-items: center; gap: 8px; }
.setting-row label { font-size: 12px; font-weight: bold; white-space: nowrap; }
.api-key-input { width: 200px; padding: 4px 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 12px; }
.model-input { width: 200px; padding: 4px 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 12px; }
.setting-row select { padding: 4px 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 12px; }

.control-bar { display: flex; align-items: center; gap: 6px; background: #f5f5f5; border-radius: 6px; padding: 6px 10px; flex-wrap: wrap; }
.btn { padding: 6px 14px; border: none; border-radius: 5px; font-size: 13px; font-weight: bold; cursor: pointer; color: white; transition: background .2s; white-space: nowrap; }
.btn:disabled { background: #ccc !important; cursor: not-allowed; }
.btn-small { padding: 4px 10px; font-size: 11px; background: #888; }
.btn-small:hover { background: #666; }
.btn-settings { background: #78909C; padding: 6px 10px; font-size: 14px; }
.btn-settings:hover { background: #546E7A; }
.btn-save { background: #43A047; }
.btn-save:hover { background: #2E7D32; }
.btn-record { background: #e53935; }
.btn-record:hover:not(:disabled) { background: #c62828; }
.btn-mix { background: #FF6F00; }
.btn-mix:hover:not(:disabled) { background: #E65100; }
.btn-import { background: #607D8B; }
.btn-import:hover:not(:disabled) { background: #455A64; }
.btn-download { background: #FF8F00; }
.btn-download:hover:not(:disabled) { background: #E65100; }
.btn-transcribe { background: #2196F3; }
.btn-transcribe:hover:not(:disabled) { background: #1976D2; }
.btn-export { background: #4CAF50; }
.btn-export:hover:not(:disabled) { background: #388E3C; }
.btn-llm { background: #9C27B0; padding: 5px 12px; font-size: 12px; }
.btn-llm:hover:not(:disabled) { background: #7B1FA2; }
.btn-llm:disabled { background: #CE93D8 !important; }
.btn-undo { background: #FF8F00; padding: 5px 10px; font-size: 14px; min-width: 36px; }
.btn-undo:hover:not(:disabled) { background: #E65100; }
.btn-search { background: #1565C0; }
.btn-search:hover { background: #0D47A1; }
.btn-ai { background: #6A1B9A; }
.btn-ai:hover { background: #4A148C; }

.llm-bar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.llm-spinner { font-size: 12px; color: #9C27B0; font-weight: bold; }
.sep { width: 1px; height: 20px; background: #ccc; margin: 0 2px; }
.source-label { font-size: 12px; font-weight: bold; color: #555; white-space: nowrap; }
.source-select { padding: 4px 8px; border: 1px solid #9C27B0; border-radius: 4px; font-size: 12px; background: white; color: #9C27B0; font-weight: bold; }
.lang-select { padding: 4px 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 12px; background: white; }

.recording-indicator { display: flex; align-items: center; gap: 6px; color: #e53935; font-weight: bold; font-size: 13px; }
.rec-dot { width: 8px; height: 8px; background: #e53935; border-radius: 50%; animation: blink 1s infinite; }
.seg-badge { background: #fff3e0; color: #e65100; padding: 1px 6px; border-radius: 10px; font-size: 11px; }
@keyframes blink { 0%,100% { opacity:1 } 50% { opacity:.3 } }
.model-select select { padding: 4px 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 12px; background: white; }
.status-bar { padding: 4px 10px; border-radius: 4px; background: #e3f2fd; font-size: 12px; color: #1565C0; }
.status-bar.error { background: #ffebee; color: #c62828; }
.progress-container { display: flex; align-items: center; gap: 8px; }
.progress-bar { flex:1; height: 16px; background: #e0e0e0; border-radius: 8px; overflow: hidden; }
.progress-fill { height:100%; background: #2196F3; border-radius: 8px; transition: width .3s; }
.progress-text { font-size: 12px; min-width: 36px; color: #666; }
.audio-info { padding: 6px 10px; background: #e8f5e9; border-radius: 4px; font-size: 12px; color: #2e7d32; }

.tab-bar { display: flex; gap: 0; background: #f5f5f5; border-radius: 6px; padding: 2px; }
.tab-btn { padding: 6px 16px; border: none; border-radius: 4px; font-size: 13px; font-weight: bold; cursor: pointer; background: transparent; color: #666; transition: all .2s; }
.tab-btn.active { background: white; color: #1565C0; box-shadow: 0 1px 3px rgba(0,0,0,.1); }
.tab-btn:hover:not(.active) { background: #e0e0e0; }

.content-area { flex:1; display: flex; gap: 8px; overflow: hidden; }
.panel { flex:1; display: flex; flex-direction: column; min-width: 0; }
.panel-header { padding: 6px 10px; background: #f5f5f5; border-radius: 6px 6px 0 0; font-size: 12px; font-weight: bold; color: #555; }
.panel-body { flex:1; overflow-y: auto; padding: 8px; background: white; border: 1px solid #ddd; border-radius: 0 0 6px 6px; line-height: 1.7; font-size: 13px; }
.segment { margin-bottom: 6px; }
.timestamp { color: #888; font-size: 11px; margin-right: 4px; }
.text { font-size: 13px; }
.llm-content { white-space: pre-wrap; font-family: inherit; font-size: 13px; line-height: 1.8; }
.empty-hint { flex:1; display: flex; align-items: center; justify-content: center; color: #999; font-size: 14px; padding: 20px; }

.history-panel { flex:1; display: flex; flex-direction: column; gap: 8px; }
.history-toolbar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.search-input { flex:1; min-width: 150px; padding: 6px 10px; border: 1px solid #1565C0; border-radius: 4px; font-size: 12px; }
.ai-input { flex:2; min-width: 200px; padding: 6px 10px; border: 1px solid #6A1B9A; border-radius: 4px; font-size: 12px; }
.search-results { flex:1; display: flex; flex-direction: column; min-height: 100px; }
.recording-list { flex:1; display: flex; flex-direction: column; min-height: 100px; }
.history-item { padding: 6px 0; border-bottom: 1px solid #eee; }
.history-info { display: flex; gap: 10px; align-items: center; font-size: 12px; }
.history-date { color: #555; font-weight: bold; }
.history-mode { color: #666; }
.history-duration { color: #888; }
.history-segments { color: #1565C0; }
</style>