<template>
  <div class="app">
    <!-- 首次啟動語言選擇 -->
    <div v-if="showLangSelect" class="label-editor-overlay">
      <div class="label-editor-panel" style="width:420px">
        <div class="panel-header">{{ $t('langSelect.title') }}</div>
        <div class="panel-body" style="text-align:center">
          <p style="margin-bottom:12px;font-size:13px">{{ $t('langSelect.desc') }}</p>
          <div class="lang-select-buttons">
            <button v-for="l in languages" :key="l.key" class="btn btn-lang" :class="{ selected: uiLanguage === l.key }" @click="uiLanguage = l.key">{{ l.label }}</button>
          </div>
          <div class="label-editor-actions" style="margin-top:16px">
            <button class="btn btn-save" @click="confirmLangSelect">💾 {{ $t('langSelect.start') }}</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 設定列 -->
    <div class="settings-bar" v-if="showSettings">
      <div class="setting-row">
        <label>{{ $t('settings.uiLanguage') }}</label>
        <select v-model="uiLanguage" @change="onLangChange" class="lang-select-small">
          <option v-for="l in languages" :key="l.key" :value="l.key">{{ l.label }}</option>
        </select>
      </div>
      <div class="setting-row">
        <label>{{ $t('settings.aiProvider') }}</label>
        <select v-model="llmProvider" @change="onProviderChange">
          <option v-for="p in llmProviders" :key="p.key" :value="p.key">{{ p.name }}</option>
        </select>
        <input v-model="llmModel" :placeholder="$t('settings.modelName')" class="model-input" />
      </div>
      <div class="setting-row" v-for="p in llmProviders" :key="p.key">
        <label v-if="p.key !== 'ollama'" style="min-width:140px">{{ p.name }} {{ $t('settings.apiKey') }}</label>
        <input v-if="p.key !== 'ollama'" v-model="apiKeys[p.key]" :type="showApiKey[p.key] ? 'text' : 'password'" :placeholder="$t('settings.apiKeyPlaceholder', { name: p.name })" class="api-key-input" />
        <button v-if="p.key !== 'ollama' && p.key === llmProvider" class="btn btn-small" @click="showApiKey[p.key] = !showApiKey[p.key]" style="min-width:50px">{{ showApiKey[p.key] ? $t('settings.hide') : $t('settings.show') }}</button>
      </div>
      <div class="setting-row">
        <label>{{ $t('settings.segmentMinutes') }}</label>
        <select v-model="segmentMinutes">
          <option :value="0">{{ $t('settings.noSegment') }}</option>
          <option :value="5">{{ $t('settings.min5') }}</option>
          <option :value="10">{{ $t('settings.min10') }}</option>
          <option :value="15">{{ $t('settings.min15') }}</option>
          <option :value="30">{{ $t('settings.min30') }}</option>
        </select>
      </div>
      <div class="setting-row">
        <label>{{ $t('settings.gpuAccel') }}</label>
        <label class="toggle-label">
          <input type="checkbox" v-model="useGpu" />
          <span class="toggle-text">{{ useGpu ? $t('settings.gpuEnabled') : $t('settings.gpuDisabled') }}</span>
        </label>
        <label v-if="useGpu" style="font-size:12px;white-space:nowrap">{{ $t('settings.gpuDevice') }}</label>
        <input v-if="useGpu" v-model="gpuDevice" type="number" min="0" max="9" step="1" placeholder="0" class="device-input" />
      </div>
      <div class="setting-row">
        <label>{{ $t('settings.workDir') }}</label>
        <span class="reco-dir-path">{{ recoDir || $t('settings.workDirDefault') }}</span>
        <button class="btn btn-small" @click="selectRecoDir" style="background:#1565C0">{{ $t('settings.selectDir') }}</button>
      </div>
      <!-- Whisper 模型管理 -->
      <div class="setting-section-title">{{ $t('settings.whisperModel') }}</div>
      <div class="setting-row">
        <select v-model="selectedModel" class="model-select">
          <option v-for="m in models" :key="m.name" :value="m.name">{{ m.name }} {{ m.cached ? $t('control.modelDownloaded') : $t('control.modelNotDownloaded') }}</option>
        </select>
        <button class="btn btn-small btn-download" @click="downloadModel" :disabled="busy || selectedModelCached" :title="selectedModelCached ? $t('control.downloadTitle') : $t('control.downloadTitleAlt')">
          {{ selectedModelCached ? $t('control.downloadBtn') : $t('control.downloadBtnAlt') }}
        </button>
      </div>
      <div class="setting-section-title">{{ $t('settings.modelManager') }}</div>
      <div class="model-list">
        <div v-for="m in models" :key="m.name" class="model-item">
          <span class="model-name">ggml-{{ m.name }}.bin</span>
          <span class="model-size" v-if="m.sizeMB">{{ $t('settings.modelSize', { size: m.sizeMB }) }}</span>
          <span class="model-status">{{ m.cached ? '✅' : '⬇️' }}</span>
          <button v-if="m.cached" class="btn btn-tiny" @click="deleteModel(m.name)" style="background:#e53935">{{ $t('settings.modelDelete') }}</button>
        </div>
      </div>
      <div class="setting-row" style="justify-content:flex-end;gap:6px">
        <button class="btn btn-small btn-save" @click="saveSettings">{{ $t('settings.save') }}</button>
        <button class="btn btn-small" @click="showSettings = false">{{ $t('settings.close') }}</button>
      </div>
    </div>

    <!-- 控制列 -->
    <div class="control-bar">
      <button class="btn btn-settings" @click="showSettings = !showSettings">⚙️</button>
      <span class="recording-mode-label">{{ $t('control.recordingMode') }}</span>
      <label class="radio-label" :class="{ disabled: isRecording }">
        <input type="radio" value="mic" v-model="recordingMode" :disabled="isRecording" />
        {{ $t('control.micMode') }}
      </label>
      <label class="radio-label" :class="{ disabled: isRecording }">
        <input type="radio" value="mix" v-model="recordingMode" :disabled="isRecording" />
        {{ $t('control.mixMode') }}
      </label>
      <button v-if="isRecording" class="btn" :class="recordingMode === 'mix' ? 'btn-mix' : 'btn-record'" @click="stopRecording">{{ $t('control.stopRecording') }}</button>
      <button v-else class="btn" :class="recordingMode === 'mix' ? 'btn-mix' : 'btn-record'" @click="startRecording(recordingMode)" :disabled="busy">{{ $t('control.startRecord') }}</button>
      <span v-if="isRecording" class="recording-indicator">
        <span class="rec-dot"></span>
        {{ recordingMode === 'mix' ? $t('control.mix') : $t('control.mic') }} {{ recordingTime }}
        <span v-if="segmentMinutes > 0" class="seg-badge">{{ $t('control.segment', { num: currentSegment, min: segmentMinutes }) }}</span>
      </span>
      <button class="btn btn-import" @click="importAudio" :disabled="busy || isRecording">{{ $t('control.import') }}</button>
      <button class="btn btn-transcribe" @click="startTranscribe" :disabled="busy || !audioLoaded || isRecording">{{ $t('control.transcribe') }}</button>
    </div>

    <!-- LLM 動作列 -->
    <div class="llm-bar" v-if="hasResult">
      <span class="source-label">{{ $t('llm.source') }}</span>
      <select v-model="activeSource" class="source-select" :disabled="llmBusy">
        <option value="original">{{ $t('llm.original') }}</option>
        <option value="optimized" v-if="llmResults.optimized">{{ $t('llm.optimized') }}</option>
        <option value="translated" v-if="llmResults.translated">{{ $t('llm.translated') }}</option>
        <option value="summary" v-if="llmResults.summary">{{ $t('llm.summary') }}</option>
      </select>
      <button class="btn btn-llm" @click="doOptimize" :disabled="llmBusy">{{ $t('llm.optimize') }}</button>
      <button class="btn btn-llm" @click="doTranslate" :disabled="llmBusy">{{ $t('llm.translate') }}</button>
      <select v-model="translateTarget" class="lang-select" :disabled="llmBusy">
        <option value="ja">🇯🇵 日本語</option>
        <option value="en">🇺🇸 English</option>
        <option value="zh">🇨🇳 中文</option>
      </select>
      <button class="btn btn-llm" @click="doSummary" :disabled="llmBusy">{{ $t('llm.summarize') }}</button>
      <span class="sep"></span>
      <button class="btn btn-undo" @click="undo" :disabled="llmBusy || !canUndo" :title="$t('llm.undoTitle')">{{ $t('llm.undo') }}</button>
      <button class="btn btn-undo" @click="redo" :disabled="llmBusy || !canRedo" :title="$t('llm.redoTitle')">{{ $t('llm.redo') }}</button>
      <button class="btn btn-small" @click="toggleJobPanel" style="background:#6A1B9A" :title="$t('llm.jobPanelTitle')">{{ $t('llm.jobPanel') }}</button>
      <button class="btn btn-small" @click="showLlmDocPanel = !showLlmDocPanel" style="background:#1565C0" :title="$t('llm.docManager')">{{ $t('llm.docManager') }}</button>
      <button class="btn btn-small" @click="doDiarize" :disabled="voiceprintBusy || !hasResult" style="background:#FF5722" :title="$t('voiceprint.diarize')">{{ $t('voiceprint.diarize') }}</button>
      <span v-if="voiceprintBusy" class="llm-spinner" style="color:#FF5722">
        <span>{{ $t('voiceprint.processing') }} {{ voiceprintProgress }}%</span>
      </span>
      <span v-if="llmBusy" class="llm-spinner">
        <span v-if="activeJobProgress.totalBatches > 1">{{ $t('llm.batchProgress', { batch: activeJobProgress.batch, total: activeJobProgress.totalBatches }) }}</span>
        <span v-else>{{ $t('llm.processing') }}</span>
      </span>
      <button v-if="llmBusy && activeJobId" class="btn btn-tiny" @click="cancelActiveJob" style="background:#e53935;padding:2px 6px;font-size:10px;margin-left:2px">{{ $t('llm.cancel') }}</button>
    </div>

    <!-- LLM 文件管理面板 -->
    <div v-if="showLlmDocPanel" class="label-editor-overlay" @click.self="showLlmDocPanel = false">
      <div class="label-editor-panel" style="width:550px">
        <div class="panel-header">{{ $t('llm.docManagerTitle') }}</div>
        <div class="panel-body" style="max-height:400px;overflow-y:auto">
          <div v-if="documents.length === 0" class="empty-hint">{{ $t('llm.docEmpty') }}</div>
          <div v-for="(doc, idx) in documents" :key="doc.id" class="job-item">
            <div class="job-header">
              <span class="job-type">{{ doc.type === 'optimize' ? '✨ 優化' : doc.type === 'translate' ? '🌐 翻譯' : doc.type === 'summary' ? '📋 摘要' : doc.type }}</span>
              <span class="job-id" v-if="doc.source">({{ $t('llm.docSource' + (doc.source === 'original' ? 'Original' : doc.source === 'optimized' ? 'Optimized' : 'Summary')) }})</span>
              <span class="job-id" v-if="doc.target">→ {{ doc.target === 'ja' ? '🇯🇵' : doc.target === 'en' ? '🇺🇸' : '🇨🇳' }} {{ doc.target }}</span>
              <span class="job-id">{{ doc.createdAt ? doc.createdAt.slice(11, 19) : '' }}</span>
            </div>
            <div class="job-log" style="margin-top:4px">
              <div class="job-log-line">{{ (doc.content || '').slice(0, 80) }}{{ (doc.content || '').length > 80 ? '...' : '' }}</div>
            </div>
            <div class="label-editor-actions" style="margin-top:4px">
              <button class="btn btn-tiny" @click="viewLlmDoc(doc)" style="background:#1565C0">{{ $t('llm.docView') }}</button>
              <button class="btn btn-tiny" @click="deleteLlmDoc(doc)" style="background:#e53935">{{ $t('llm.docDelete') }}</button>
            </div>
          </div>
        </div>
        <div class="label-editor-actions">
          <button class="btn btn-small" @click="showLlmDocPanel = false">{{ $t('llm.jobClose') }}</button>
        </div>
      </div>
    </div>

    <!-- LLM Job 列表面板 -->
    <div v-if="showJobPanel" class="label-editor-overlay" @click.self="showJobPanel = false">
      <div class="label-editor-panel" style="width:600px">
        <div class="panel-header">{{ $t('llm.jobPanelTitle') }}</div>
        <div class="panel-body" style="max-height:400px;overflow-y:auto">
          <div v-if="jobList.length === 0" class="empty-hint">{{ $t('llm.jobEmpty') }}</div>
          <div v-for="job in jobList" :key="job.id" class="job-item" :class="'job-' + job.status">
            <div class="job-header">
              <span class="job-id">{{ job.id }}</span>
              <span class="job-type">{{ job.type }}</span>
              <span class="job-status" :class="'job-status-' + job.status">{{ job.status }}</span>
              <button v-if="job.status === 'pending' || job.status === 'running'" class="btn btn-tiny" @click="cancelJob(job.id)" style="background:#e53935">{{ $t('llm.cancel') }}</button>
            </div>
            <div v-if="job.progress.totalBatches > 0" class="job-progress">
              <div class="progress-bar" style="height:8px;margin:4px 0">
                <div class="progress-fill" :style="{ width: job.progress.percent + '%' }"></div>
              </div>
              <span class="job-progress-text">{{ $t('llm.batchProgress', { batch: job.progress.batch, total: job.progress.totalBatches }) }}</span>
            </div>
            <div v-if="job.error" class="job-error">❌ {{ job.error }}</div>
            <div class="job-log" v-if="job.log && job.log.length > 0">
              <div v-for="(line, li) in job.log.slice(-5)" :key="li" class="job-log-line">{{ line }}</div>
            </div>
          </div>
        </div>
        <div class="label-editor-actions">
          <button class="btn btn-small" @click="refreshJobList">{{ $t('llm.jobRefresh') }}</button>
          <button class="btn btn-small" @click="showJobPanel = false">{{ $t('llm.jobClose') }}</button>
        </div>
      </div>
    </div>

    <div class="status-bar" :class="{ error: statusError }">{{ statusText }}</div>
    <div v-if="showProgress" class="progress-container">
      <div class="progress-bar"><div class="progress-fill" :style="{ width: progressPercent + '%' }"></div></div>
      <div class="progress-text">{{ progressPercent }}%</div>
      <button v-if="busy && _transcribingAudioPath" class="btn btn-small" @click="cancelTranscribe" style="background:#e53935;margin-left:8px">{{ $t('control.cancelTranscribe') }}</button>
    </div>
    <div v-if="audioInfo" class="audio-info">📄 {{ audioInfo.filename }}</div>

    <!-- Tab 切換 -->
    <div class="tab-bar">
      <button class="tab-btn" :class="{ active: activeTab === 'transcript' }" @click="activeTab = 'transcript'">{{ $t('tab.transcript') }}</button>
      <button class="tab-btn" :class="{ active: activeTab === 'history' }" @click="activeTab = 'history'; loadHistory(); loadAllLabels()">{{ $t('tab.history') }}</button>
    </div>

    <!-- 隱藏音訊播放器 -->
    <audio ref="audioPlayer" style="display:none" @timeupdate="onAudioTimeUpdate" @ended="onAudioEnded"></audio>

    <!-- 主要內容區：逐字稿 -->
    <div class="content-area" v-if="activeTab === 'transcript'">
      <div class="panel" v-if="hasResult && activeSource === 'original'">
        <div class="panel-header">
          {{ $t('transcript.header', { count: transcriptionResults.length }) }}
          <span v-if="nowPlaying" class="playing-badge">{{ $t('transcript.playing') }}</span>
          <button v-if="nowPlaying" class="btn btn-small btn-stop-playback" @click="stopPlayback" :title="$t('transcript.stopPlayback')">{{ $t('transcript.stopPlayback') }}</button>
        </div>
        <div class="panel-body">
          <div v-for="(seg, idx) in transcriptionResults" :key="idx" class="segment" :class="{ 'segment-playing': playingSegmentIdx === idx }" @click="playSegment(idx)" :title="currentAudioUrl ? $t('transcript.clickToPlay') : ''">
            <span class="timestamp">[{{ formatTime(seg.start) }} - {{ formatTime(seg.end) }}]</span>
            <span class="text">{{ seg.text }}</span>
            <span v-if="playingSegmentIdx === idx" class="play-indicator">▶️</span>
          </div>
        </div>
      </div>
      <div class="panel" v-if="activeSource !== 'original' && activeSourceContent">
        <div class="panel-header">{{ activeSourceTitle }}</div>
        <div class="panel-body"><pre class="llm-content">{{ activeSourceContent }}</pre></div>
      </div>
      <div v-if="!hasResult && !busy && !isRecording" class="empty-hint">
        {{ $t('transcript.empty') }}
      </div>
    </div>

    <!-- 主要內容區：歷史記錄 -->
    <div class="content-area" v-if="activeTab === 'history'">
      <div class="history-panel">
        <div class="history-toolbar">
          <input v-model="searchKeyword" :placeholder="$t('history.searchPlaceholder')" class="search-input" @keyup.enter="doSearch" />
          <button class="btn btn-small btn-search" @click="doSearch">{{ $t('history.search') }}</button>
          <span class="sep"></span>
          <input v-model="aiQuestion" :placeholder="$t('history.aiPlaceholder')" class="ai-input" @keyup.enter="doAiQuery" />
          <button class="btn btn-small btn-ai" @click="doAiQuery" :disabled="aiBusy">{{ $t('history.aiQuery') }}</button>
        </div>

        <!-- 搜尋結果 -->
        <div v-if="searchResults.length > 0" class="search-results">
          <div class="panel-header">{{ $t('history.searchResults', { count: searchResults.length }) }}</div>
          <div class="panel-body">
            <div v-for="(r, idx) in searchResults" :key="idx" class="segment search-result-item">
              <span class="timestamp">[{{ r.filename }}] [{{ formatTime(r.start) }} - {{ formatTime(r.end) }}]</span>
              <span class="text">{{ r.text }}</span>
              <span v-if="r.labels && r.labels.length > 0" class="search-labels">
                <span v-for="l in r.labels" :key="l" class="label-tag label-tag-sm">{{ l }}</span>
              </span>
              <button class="btn btn-tiny btn-jump" @click="jumpToSearchResult(r)" :title="'📖 ' + r.filename">{{ $t('history.jumpTo') }}</button>
              <button class="btn btn-tiny" @click="exportFromHistory(r)" style="background:#4CAF50">{{ $t('history.exportSearchItem') }}</button>
            </div>
          </div>
        </div>

        <!-- AI 查詢結果 -->
        <div v-if="aiResult" class="search-results">
          <div class="panel-header">{{ $t('history.aiResult') }}</div>
          <div class="panel-body"><pre class="llm-content">{{ aiResult }}</pre></div>
        </div>

        <!-- Label 篩選列 -->
        <div v-if="!searchKeyword && !aiQuestion" class="label-filter-bar">
          <span class="label-filter-label">{{ $t('history.labelFilter') }}</span>
          <select v-model="labelFilter" @change="loadHistory" class="label-filter-select">
            <option value="">{{ $t('history.all') }}</option>
            <option v-for="l in allLabels" :key="l" :value="l">{{ l }}</option>
          </select>
          <button class="btn btn-small btn-refresh" @click="loadHistory" style="margin-left:4px">{{ $t('history.refresh') }}</button>
        </div>

        <!-- 子 Tab 切換 -->
        <div v-if="!searchKeyword && !aiQuestion" class="history-sub-tabs">
          <button class="sub-tab-btn" :class="{ active: historySubTab === 'records' }" @click="historySubTab = 'records'; loadHistory()">{{ $t('history.subTabRecords') }}</button>
          <button class="sub-tab-btn" :class="{ active: historySubTab === 'audio' }" @click="historySubTab = 'audio'; loadAudioFiles()">{{ $t('history.subTabAudio') }}</button>
        </div>

        <!-- 錄音記錄（樹狀檢視） -->
        <div v-if="!searchKeyword && !aiQuestion && historySubTab === 'records'" class="recording-list">
          <!-- Breadcrumb 導覽列 -->
          <div class="folder-breadcrumb">
            <span class="breadcrumb-item" @click="navigateToFolder('')" :class="{ active: currentFolder === '' }">{{ $t('history.root') }}</span>
            <template v-for="(part, i) in folderBreadcrumbs" :key="i">
              <span class="breadcrumb-sep">/</span>
              <span class="breadcrumb-item" @click="navigateToFolder(part.path)" :class="{ active: currentFolder === part.path }">{{ part.name }}</span>
            </template>
          </div>

          <!-- Folder 管理工具列 -->
          <div class="folder-toolbar">
            <button class="btn btn-small btn-folder-new" @click="showNewFolderDialog = true">{{ $t('history.newFolder') }}</button>
            <button v-if="currentFolder" class="btn btn-small btn-folder-rename" @click="showRenameFolderDialog = true">{{ $t('history.renameFolder') }}</button>
            <button v-if="currentFolder" class="btn btn-small btn-folder-delete" @click="deleteCurrentFolder">{{ $t('history.deleteFolder') }}</button>
            <span class="sep"></span>
            <button v-if="selectedRecordings.size > 0" class="btn btn-small btn-move" @click="openMoveDialog">{{ $t('history.moveSelected', { count: selectedRecordings.size }) }}</button>
            <button v-if="selectedRecordings.size > 0" class="btn btn-small btn-batch-delete" @click="batchDeleteSelected">{{ $t('history.batchDelete', { count: selectedRecordings.size }) }}</button>
            <button v-if="historyList.length > 0" class="btn btn-small" @click="selectAll" style="background:#888">{{ $t('history.selectAll') }}</button>
            <button v-if="selectedRecordings.size > 0" class="btn btn-small" @click="deselectAll" style="background:#888">{{ $t('history.deselectAll') }}</button>
            <span class="sep"></span>
            <button class="btn btn-small btn-export" @click="exportFromToolbar" :disabled="!hasResult" style="background:#4CAF50">{{ $t('history.exportFromToolbar') }}</button>
          </div>

          <!-- Folder 列表 -->
          <div v-if="folderList.length > 0" class="folder-list">
            <div v-for="f in folderList" :key="f" class="folder-item" @click="navigateToFolder(currentFolder ? currentFolder + '/' + f : f)">
              📁 {{ f }}
            </div>
          </div>

          <!-- 錄音記錄列表 -->
          <div class="panel-header">{{ $t('history.recordings', { count: historyList.length }) }}</div>
          <div class="panel-body">
            <div v-for="(item, idx) in historyList" :key="idx" class="history-item">
              <div class="history-info">
                <input type="checkbox" :checked="selectedRecordings.has(item.id)" @change="toggleSelectRecording(item.id)" class="recording-checkbox" />
                <span class="history-date">{{ item.recordedAt }}</span>
                <span class="history-mode">{{ item.recordingMode === 'mix' ? $t('history.mix') : $t('history.mic') }}</span>
                <span class="history-duration">{{ formatTime(item.duration) }}</span>
                <span class="history-segments">{{ item.segmentCount }} 句</span>
                <span class="audio-status" :class="item.hasAudio ? 'audio-ok' : 'audio-missing'">{{ item.hasAudio ? $t('history.hasAudio') : $t('history.noAudio') }}</span>
                <button class="btn btn-small btn-play" @click="playRecordingAudio(item)" :disabled="busy || !item.hasAudio" :title="item.hasAudio ? $t('history.play') : $t('history.noAudio')">{{ $t('history.play') }}</button>
                <button class="btn btn-small btn-review" @click="reviewRecording(item.id)" :disabled="busy">{{ $t('history.review') }}</button>
                <button class="btn btn-small btn-label" @click="editLabels(item)" :disabled="busy">{{ $t('history.label') }}</button>
                <button class="btn btn-small btn-delete" @click="deleteRecording(item)" :disabled="busy">{{ $t('history.delete') }}</button>
              </div>
              <div class="history-labels" v-if="item.labels && item.labels.length > 0">
                <span v-for="l in item.labels" :key="l" class="label-tag">{{ l }}</span>
              </div>
            </div>
            <div v-if="historyList.length === 0" class="empty-hint">{{ $t('history.empty') }}</div>
          </div>
        </div>

        <!-- Label 編輯彈窗 -->
        <div v-if="showLabelEditor" class="label-editor-overlay" @click.self="closeLabelEditor">
          <div class="label-editor-panel">
            <div class="panel-header">{{ $t('labelEditor.title', { id: editingLabelId }) }}</div>
            <div class="panel-body">
              <div class="label-editor-input-row">
                <input v-model="newLabelInput" :placeholder="$t('labelEditor.placeholder')" class="label-input" @keyup.enter="addLabel" />
                <button class="btn btn-small btn-add-label" @click="addLabel">{{ $t('labelEditor.add') }}</button>
              </div>
              <div class="label-editor-list">
                <div v-for="(l, i) in editingLabels" :key="i" class="label-editor-item">
                  <span class="label-tag">{{ l }}</span>
                  <button class="btn btn-tiny btn-remove-label" @click="removeLabel(i)">✕</button>
                </div>
                <div v-if="editingLabels.length === 0" class="empty-hint">{{ $t('labelEditor.empty') }}</div>
              </div>
              <div class="label-editor-actions">
                <button class="btn btn-small btn-save" @click="saveLabels">{{ $t('labelEditor.save') }}</button>
                <button class="btn btn-small" @click="closeLabelEditor">{{ $t('labelEditor.cancel') }}</button>
              </div>
            </div>
          </div>
        </div>

        <!-- 新增目錄彈窗 -->
        <div v-if="showNewFolderDialog" class="label-editor-overlay" @click.self="showNewFolderDialog = false">
          <div class="label-editor-panel" style="width:350px">
            <div class="panel-header">{{ $t('folderNew.title') }}</div>
            <div class="panel-body">
              <input v-model="newFolderName" :placeholder="$t('folderNew.placeholder')" class="label-input" @keyup.enter="createFolder" />
              <div class="label-editor-actions" style="margin-top:8px">
                <button class="btn btn-small btn-save" @click="createFolder">{{ $t('folderNew.create') }}</button>
                <button class="btn btn-small" @click="showNewFolderDialog = false; newFolderName = ''">{{ $t('folderNew.cancel') }}</button>
              </div>
            </div>
          </div>
        </div>

        <!-- 重新命名目錄彈窗 -->
        <div v-if="showRenameFolderDialog" class="label-editor-overlay" @click.self="showRenameFolderDialog = false">
          <div class="label-editor-panel" style="width:350px">
            <div class="panel-header">{{ $t('folderRename.title') }}</div>
            <div class="panel-body">
              <input v-model="renameFolderName" :placeholder="$t('folderRename.placeholder')" class="label-input" @keyup.enter="renameFolder" />
              <div class="label-editor-actions" style="margin-top:8px">
                <button class="btn btn-small btn-save" @click="renameFolder">{{ $t('folderRename.save') }}</button>
                <button class="btn btn-small" @click="showRenameFolderDialog = false; renameFolderName = ''">{{ $t('folderRename.cancel') }}</button>
              </div>
            </div>
          </div>
        </div>

        <!-- 移動彈窗 -->
        <div v-if="showMoveDialog" class="label-editor-overlay" @click.self="showMoveDialog = false">
          <div class="label-editor-panel" style="width:400px">
            <div class="panel-header">{{ $t('moveDialog.title', { count: selectedRecordings.size }) }}</div>
            <div class="panel-body">
              <div class="move-folder-list">
                <div class="move-folder-item" @click="moveToFolder('')" :class="{ selected: moveTargetFolder === '' }">{{ $t('moveDialog.root') }}</div>
                <div v-for="f in allFolders" :key="f" class="move-folder-item" @click="moveToFolder(f)" :class="{ selected: moveTargetFolder === f }">📁 {{ f }}</div>
              </div>
              <div class="label-editor-actions" style="margin-top:8px">
                <button class="btn btn-small btn-save" @click="executeMove">{{ $t('moveDialog.move') }}</button>
                <button class="btn btn-small" @click="showMoveDialog = false; moveTargetFolder = ''">{{ $t('moveDialog.cancel') }}</button>
              </div>
            </div>
          </div>
        </div>

        <!-- 音檔列表 -->
        <div v-if="!searchKeyword && !aiQuestion && historySubTab === 'audio'" class="recording-list">
          <div class="panel-header">
            {{ $t('history.audioList', { count: audioFiles.length }) }}
            <button class="btn btn-small btn-batch-all" @click="batchTranscribeNew" :disabled="busy || batchNewBusy" style="margin-left:8px">{{ $t('history.batchTranscribeAll') }}</button>
          </div>
          <div class="panel-body">
            <div v-for="(f, idx) in audioFiles" :key="idx" class="history-item">
              <div class="history-info">
                <span class="history-date">{{ f.name }}</span>
                <span class="history-mode">{{ (f.size / 1024).toFixed(1) }} KB</span>
                <span class="history-duration">{{ f.ext }}</span>
                <span class="history-segments">{{ f.mtime.slice(0, 19).replace('T', ' ') }}</span>
                <button class="btn btn-small btn-transcribe-audio" @click="transcribeAudioFile(f.path)" :disabled="busy">{{ $t('history.transcribeAudio') }}</button>
                <button class="btn btn-small btn-delete" @click="deleteAudioFile(f)" :disabled="busy">{{ $t('history.delete') }}</button>
              </div>
            </div>
            <div v-if="audioFiles.length === 0" class="empty-hint">{{ $t('history.audioEmpty') }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { t, LANGUAGES } from './i18n/index.js'

export default {
  data() {
    return {
      appVersion: '',
      showSettings: false,
      showLangSelect: false,
      languages: LANGUAGES,
      uiLanguage: 'zh-TW',
      models: [], selectedModel: 'small',
      audioLoaded: false, hasResult: false, busy: false,
      showProgress: false, progressPercent: 0,
      statusText: '就緒', statusError: false,
      audioInfo: null, transcriptionResults: [], currentAudioPath: null,
      // 錄音
      isRecording: false, recordingMode: 'mic', recordingTime: '00:00',
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
      useGpu: true, gpuDevice: '0',
      // 歷史記錄
      activeTab: 'transcript',
      historyList: [],
      searchKeyword: '', searchResults: [],
      aiQuestion: '', aiResult: '', aiBusy: false,
      currentRecordingId: null,
      recoDir: '',
      historySubTab: 'records',
      audioFiles: [], batchNewBusy: false,
      // 音檔播放
      currentAudioUrl: '', nowPlaying: false, playingSegmentIdx: -1,
      // Label 管理
      allLabels: [], labelFilter: '',
      showLabelEditor: false, editingLabelId: '', editingLabels: [], newLabelInput: '',
      // 樹狀目錄
      currentFolder: '', folderList: [],
      selectedRecordings: new Set(),
      showNewFolderDialog: false, newFolderName: '',
      showRenameFolderDialog: false, renameFolderName: '',
      showMoveDialog: false, moveTargetFolder: '', allFolders: [],
      // 聲紋說話者標註
      voiceprintBusy: false,
      voiceprintProgress: 0,
      voiceprintModelCached: false,
      // LLM 文件管理
      showLlmDocPanel: false,
      documents: [],
      // LLM Job 管理
      showJobPanel: false,
      activeJobId: null,
      activeJobProgress: { batch: 0, totalBatches: 0, percent: 0 },
      jobList: [],
      _jobUpdateListener: null,
      _transcribingAudioPath: null,
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
      const titles = { optimized: this.$t('llm.optimized'), translated: this.$t('llm.translated'), summary: this.$t('llm.summary') }
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
    folderBreadcrumbs() {
      if (!this.currentFolder) return []
      const parts = this.currentFolder.split('/')
      return parts.map((name, i) => ({ name, path: parts.slice(0, i + 1).join('/') }))
    },
  },
  async mounted() {
    await this.fetchModels()
    await this.fetchLlmProviders()
    await this.loadSettings()
    this.initJobListener()
  },
  methods: {
    $t(key, params) {
      let text = t(key, this.uiLanguage)
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          text = text.replace(`{${k}}`, v)
        }
      }
      return text
    },
    formatTime(s) { return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}` },
    async fetchModels() {
      try { if (window.electronAPI) { const d = await window.electronAPI.listModels(); this.models = d.models } }
      catch (e) { this.statusText = `⚠️ ${e.message}`; this.statusError = true }
    },
    async downloadModel() {
      if (!window.electronAPI) return
      const model = this.models.find(m => m.name === this.selectedModel)
      if (model && model.cached) { this.statusText = this.$t('status.modelCached', { model: this.selectedModel }); this.statusError = false; return }
      this.busy = true; this.showProgress = true; this.progressPercent = 0
      this.statusText = this.$t('status.downloading', { model: this.selectedModel }); this.statusError = false
      try {
        const r = await window.electronAPI.downloadModel(this.selectedModel)
        if (r.success) { this.statusText = this.$t('status.downloaded', { model: this.selectedModel }); this.progressPercent = 100; await this.fetchModels() }
        else { this.statusText = this.$t('status.downloadFail', { error: r.error }); this.statusError = true }
      } catch (e) { this.statusText = this.$t('status.downloadFail', { error: e.message }); this.statusError = true }
      finally { this.busy = false; setTimeout(() => { if (!this.busy) this.showProgress = false }, 2000) }
    },
    async deleteModel(name) {
      if (!window.electronAPI) return
      if (!confirm(this.$t('settings.modelDeleteConfirm', { name }))) return
      try {
        const r = await window.electronAPI.deleteModel(name)
        if (r.success) { this.statusText = this.$t('settings.modelDeleted'); await this.fetchModels() }
        else { this.statusText = this.$t('settings.modelDeleteFail', { error: r.error }); this.statusError = true }
      } catch (e) { this.statusText = this.$t('settings.modelDeleteFail', { error: e.message }); this.statusError = true }
    },
    async fetchLlmProviders() {
      try {
        if (window.electronAPI) {
          const d = await window.electronAPI.getLlmProviders(); this.llmProviders = d.providers
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
        if (s.uiLanguage) this.uiLanguage = s.uiLanguage
        if (s.llmProvider) this.llmProvider = s.llmProvider
        if (s.apiKeys) this.apiKeys = { ...s.apiKeys }
        if (s.llmModel) this.llmModel = s.llmModel
        if (s.segmentMinutes !== undefined) this.segmentMinutes = s.segmentMinutes
        if (s.useGpu !== undefined) this.useGpu = s.useGpu
        if (s.gpuDevice !== undefined) this.gpuDevice = s.gpuDevice
        if (s.recoDir) this.recoDir = s.recoDir
        for (const p of this.llmProviders) { if (this.showApiKey[p.key] === undefined) this.showApiKey[p.key] = false }
        // 首次啟動：無 uiLanguage 設定時顯示語言選擇
        if (!s.uiLanguage) this.showLangSelect = true
      } catch (e) {}
    },
    confirmLangSelect() {
      this.showLangSelect = false
      this.saveSettings()
    },
    onLangChange() {
      this.saveSettings()
    },
    async selectRecoDir() {
      if (!window.electronAPI) return
      const dir = await window.electronAPI.openDirDialog()
      if (dir) { this.recoDir = dir; this.saveSettings() }
    },
    async loadAudioFiles() {
      if (!window.electronAPI) return
      try { const r = await window.electronAPI.recoListAudioFiles(); if (r.success) this.audioFiles = r.files }
      catch (e) { console.warn('載入音檔列表失敗:', e) }
    },
    async reviewRecording(id) {
      if (!window.electronAPI) return
      this.nowPlaying = false; this.playingSegmentIdx = -1; this.busy = true
      this.statusText = this.$t('status.loading', { id }); this.statusError = false
      try {
        const r = await window.electronAPI.recoLoadMeta({ recordingId: id })
        if (r.success && r.meta && r.meta.segments) {
          this.transcriptionResults = r.meta.segments; this.hasResult = true
          this.llmResults = r.meta.llmResults || { optimized: '', translated: '', summary: '' }
          this.documents = r.meta.documents || []
          this.llmHistory = { optimized: [], translated: [], summary: [] }
          this.llmRedo = { optimized: [], translated: [], summary: [] }
          this.activeSource = 'original'; this.currentAudioPath = null; this.audioLoaded = false
          this.audioInfo = { filename: r.meta.filename || id }; this.activeTab = 'transcript'
          this.currentRecordingId = id
          this.statusText = this.$t('status.loaded', { count: r.meta.segments.length })
        } else { this.statusText = this.$t('status.loadFail', { error: r.error || '無資料' }); this.statusError = true }
      } catch (e) { this.statusText = this.$t('status.loadError', { message: e.message }); this.statusError = true }
      finally { this.busy = false }
    },
    async llmProcessRecording(id, type) {
      if (!window.electronAPI) return
      this.llmBusy = true
      const labels = { optimize: '✨ 優化', translate: '🌐 翻譯', summary: '📋 摘要' }
      this.statusText = this.$t('status.llmProcess', { label: labels[type] || type, id }); this.statusError = false
      try {
        const r = await window.electronAPI.recoLlmProcess({ recordingId: id, provider: this.llmProvider, apiKey: this.apiKeys[this.llmProvider] || '', model: this.llmModel, type })
        if (r.success) { this.statusText = this.$t('status.llmDone', { label: labels[type] || type }) }
        else { this.statusText = this.$t('status.llmFail', { label: labels[type] || type, error: r.error }); this.statusError = true }
      } catch (e) { this.statusText = this.$t('status.llmError', { label: labels[type] || type, message: e.message }); this.statusError = true }
      finally { this.llmBusy = false }
    },
    async batchTranscribeNew() {
      if (!window.electronAPI) return
      this.batchNewBusy = true; this.statusText = this.$t('status.batchTranscribing'); this.statusError = false
      try {
        const r = await window.electronAPI.recoBatchTranscribeNew({ modelSize: this.selectedModel, useGpu: this.useGpu, gpuDevice: this.gpuDevice })
        if (r.success) {
          const ok = r.results.filter(x => x.id).length; const fail = r.results.filter(x => x.error).length
          this.statusText = this.$t('status.batchDone', { ok, fail: fail > 0 ? `，${fail} 失敗` : '' }); await this.loadAudioFiles()
        } else { this.statusText = this.$t('status.batchFail', { error: r.error }); this.statusError = true }
      } catch (e) { this.statusText = this.$t('status.batchError', { message: e.message }); this.statusError = true }
      finally { this.batchNewBusy = false }
    },
    async transcribeAudioFile(fileName) {
      if (!window.electronAPI) return
      this.busy = true; this.statusText = `🤖 辨識 ${fileName}...`; this.statusError = false
      try {
        this.activeTab = 'transcript'; this.audioInfo = { filename: fileName }; this.audioLoaded = true
        this.currentAudioPath = null; this.hasResult = false; this.transcriptionResults = []
        const outputDir = this.recoDir || await this.getRecoDataPath()
        const importResult = await window.electronAPI.importAudio({ filePath: fileName, outputDir })
        if (importResult.success) { this.currentAudioPath = importResult.path; this.audioInfo = importResult; await this.startTranscribe() }
        else { this.statusText = `❌ 無法載入音檔: ${importResult.error}`; this.statusError = true }
      } catch (e) { this.statusText = `❌ 辨識異常: ${e.message}`; this.statusError = true }
      finally { this.busy = false }
    },
    async saveSettings() {
      if (!window.electronAPI) { this.statusText = this.$t('status.commError'); this.statusError = true; return }
      try {
        const result = await window.electronAPI.saveSettings({ uiLanguage: this.uiLanguage, llmProvider: this.llmProvider, apiKeys: { ...this.apiKeys }, llmModel: this.llmModel, segmentMinutes: this.segmentMinutes, useGpu: this.useGpu, gpuDevice: this.gpuDevice })
        if (result.success) { this.statusText = this.$t('status.saved'); this.statusError = false; setTimeout(() => { if (this.statusText === this.$t('status.saved')) this.statusText = this.$t('status.ready') }, 2000) }
        else { this.statusText = this.$t('status.saveFail', { error: result.error || '未知錯誤' }); this.statusError = true }
      } catch (e) { this.statusText = this.$t('status.saveFail', { error: e.message }); this.statusError = true }
    },
    onProviderChange() { const p = this.llmProviders.find(x => x.key === this.llmProvider); if (p) this.llmModel = p.defaultModel; this.saveSettings() },

    // ── 錄音 ──
    cleanupRecording() {
      if (this.recordingTimer) clearInterval(this.recordingTimer)
      if (this.recordingStream) this.recordingStream.getTracks().forEach(t => t.stop())
      if (this.audioContext) this.audioContext.close().catch(() => {})
      this.mediaRecorder = null; this.recordingStream = null; this.segmentBlobs = []
    },
    async startRecording(mode) {
      try {
        this.audioChunks = []; this.recordingSeconds = 0; this.recordingTime = '00:00'
        this.recordingMode = mode; this.segmentBlobs = []; this.currentSegment = 0
        this.transcriptionResults = []; this.hasResult = false; this.currentRecordingId = null
        this._segmentStop = false; this._segmentCount = 0; this._segmentMimeType = ''
        let finalStream
        if (mode === 'mix') {
          this.statusText = '請選擇畫面（勾選分享音訊）'; this.statusError = false
          const ss = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: { width: 1, height: 1, frameRate: 1 } })
          let ms; try { ms = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true } }) } catch (e) { console.warn('無麥克風:', e.message) }
          this.audioContext = new (window.AudioContext || window.webkitAudioContext)()
          const dest = this.audioContext.createMediaStreamDestination()
          this.audioContext.createMediaStreamSource(ss).connect(dest)
          if (ms) this.audioContext.createMediaStreamSource(ms).connect(dest)
          finalStream = dest.stream; this.recordingStream = finalStream; this._systemStream = ss; this._micStream = ms
        } else {
          const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
          finalStream = s; this.recordingStream = s; this._systemStream = null; this._micStream = null
        }
        this.startMediaRecorder(finalStream, mode)
      } catch (e) { this.cleanupRecording(); this.isRecording = false; this.statusText = e.name === 'NotAllowedError' ? this.$t('status.denied') : `❌ ${e.message}`; this.statusError = true }
    },
    startMediaRecorder(stream, mode) {
      if (this.recordingTimer) clearInterval(this.recordingTimer)
      const mt = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
      this._segmentMimeType = mt; this._segmentElapsed = 0
      this.mediaRecorder = new MediaRecorder(stream, { mimeType: mt })
      this.mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) this.audioChunks.push(e.data) }
      this.mediaRecorder.onstop = async () => { await this.onRecorderStop(mode) }
      this.mediaRecorder.start(1000); this.isRecording = true
      this.statusText = this.$t('status.recording', { mode: mode === 'mix' ? this.$t('status.recordingMix') : this.$t('status.recordingMic') })
      this.recordingTimer = setInterval(() => {
        this.recordingSeconds++; this._segmentElapsed++
        const m = Math.floor(this.recordingSeconds / 60); const s = this.recordingSeconds % 60
        this.recordingTime = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
        if (this.segmentMinutes > 0 && this._segmentElapsed >= this.segmentMinutes * 60) { this.saveSegment() }
      }, 1000)
    },
    saveSegment() { if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') { this._segmentStop = true; this.mediaRecorder.stop() } },
    async onRecorderStop(mode) {
      const isSegment = this._segmentStop; this._segmentStop = false
      const blob = new Blob(this.audioChunks, { type: this._segmentMimeType }); this.audioChunks = []
      if (isSegment) {
        const segIdx = this._segmentCount; this._segmentCount++; this.currentSegment = this._segmentCount
        this.statusText = this.$t('status.segmentSaving', { num: this.currentSegment })
        await this.transcribeBlob(blob, this._segmentMimeType, segIdx)
        if (this.recordingStream && this.isRecording) { this.startMediaRecorder(this.recordingStream, mode) }
      } else {
        this.cleanupStreams(mode); this.isRecording = false; this.statusText = '正在處理錄音...'; this.statusError = false
        try {
          if (this.segmentMinutes > 0) {
            if (blob.size > 0) { const segIdx = this._segmentCount; this._segmentCount++; this.currentSegment = this._segmentCount; await this.transcribeBlob(blob, this._segmentMimeType, segIdx) }
            this.statusText = this.$t('status.recordDoneSeg', { count: this.transcriptionResults.length }); this.currentAudioPath = null; this.audioLoaded = true
            this.audioInfo = { filename: `${mode === 'mix' ? '混音錄音' : '麥克風'}錄音（分段）` }
          } else {
            if (blob.size > 0 && window.electronAPI) {
              const buf = Array.from(new Uint8Array(await blob.arrayBuffer()))
              const label = mode === 'mix' ? '混音錄音' : '麥克風'
              const result = await window.electronAPI.saveRecorded({ buffer: buf, ext: 'webm' })
              if (result.success) { this.currentAudioPath = result.path; this.audioLoaded = true; this.audioInfo = { filename: `${label}.webm` }; this.hasResult = false; this.transcriptionResults = []; this.statusText = this.$t('status.recordDone', { label, time: this.recordingTime }); await this.startTranscribe() }
              else { this.statusText = this.$t('status.recordFail', { error: result.error }); this.statusError = true }
            }
          }
        } catch (e) { console.warn('錄音停止處理失敗:', e); this.statusText = this.$t('status.recordFail', { error: e.message }); this.statusError = true }
      }
    },
    async transcribeBlob(blob, mt, segIdx) {
      if (!window.electronAPI) return
      try {
        const buf = Array.from(new Uint8Array(await blob.arrayBuffer())); const ext = mt.includes('opus') ? 'webm' : 'webm'
        const result = await window.electronAPI.saveRecorded({ buffer: buf, ext })
        if (result.success) {
          const r = await window.electronAPI.transcribeSegment({ audioPath: result.path, modelSize: this.selectedModel, useGpu: this.useGpu, gpuDevice: this.gpuDevice })
          if (r.success && r.segments && r.segments.length > 0) {
            const offsetSec = segIdx * this.segmentMinutes * 60
            const shifted = r.segments.map(s => ({ start: s.start + offsetSec, end: s.end + offsetSec, text: s.text, speaker: '' }))
            this.transcriptionResults.push(...shifted); if (!this.hasResult) this.hasResult = true
            this.statusText = this.$t('status.segmentDone', { num: segIdx + 1, count: r.segments.length })
          } else if (r.success && (!r.segments || r.segments.length === 0)) { this.statusText = this.$t('status.segmentNoResult', { num: segIdx + 1 }) }
          else { this.statusText = this.$t('status.segmentFail', { num: segIdx + 1, error: r.error || '未知錯誤' }); this.statusError = true }
        } else { this.statusText = this.$t('status.segmentSaveFail', { num: segIdx + 1, error: result.error || '未知錯誤' }); this.statusError = true }
      } catch (e) { this.statusText = this.$t('status.segmentError', { num: segIdx + 1, message: e.message }); this.statusError = true }
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
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') { this._segmentStop = false; this.mediaRecorder.stop() }
      else { this.cleanupRecording(); this.isRecording = false }
    },

    // ── 匯入 ──
    async importAudio() {
      let fp = null
      if (window.electronAPI) fp = await window.electronAPI.openFileDialog()
      else fp = prompt('請輸入路徑：')
      if (!fp) return
      this.busy = true; this.statusText = this.$t('status.importing'); this.statusError = false
      try {
        if (!window.electronAPI) return
        const outputDir = this.recoDir || await this.getRecoDataPath()
        const d = await window.electronAPI.importAudio({ filePath: fp, outputDir })
        if (d.success) { this.audioLoaded = true; this.currentAudioPath = d.path; this.audioInfo = d; this.hasResult = false; this.transcriptionResults = []; this.statusText = this.$t('status.imported', { name: d.filename }) }
        else { this.statusText = this.$t('status.importFail', { error: d.error }); this.statusError = true }
      } catch (e) { this.statusText = this.$t('status.importFail', { error: e.message }); this.statusError = true }
      finally { this.busy = false }
    },
    async getRecoDataPath() {
      if (!window.electronAPI) return ''
      try { const r = await window.electronAPI.recoGetDataPath(); return r.path || '' } catch (e) { return '' }
    },

    // ── 辨識 ──
    async startTranscribe() {
      if (!this.audioLoaded || !this.currentAudioPath) return
      // 重複觸發防護
      if (this.busy && this._transcribingAudioPath === this.currentAudioPath) {
        this.statusText = this.$t('status.transcribingBusy'); this.statusError = true
        return
      }
      const model = this.models.find(m => m.name === this.selectedModel)
      if (model && !model.cached) {
        if (!window.electronAPI) return
        this.statusText = this.$t('status.downloading', { model: this.selectedModel }); this.showProgress = true; this.progressPercent = 0; this.busy = true
        try { const r = await window.electronAPI.downloadModel(this.selectedModel); if (!r.success) throw new Error(r.error) }
        catch (e) { this.statusText = this.$t('status.downloadFail', { error: e.message }); this.statusError = true; this.showProgress = false; this.busy = false; return }
        await this.fetchModels()
      }
      this.busy = true; this.showProgress = true; this.progressPercent = 0; this.statusText = this.$t('status.transcribing'); this.statusError = false
      this._transcribingAudioPath = this.currentAudioPath
      // 訂閱進度事件
      const unsubProgress = window.electronAPI ? window.electronAPI.onTranscribeProgress((data) => {
        if (data.audioPath === this._transcribingAudioPath) {
          this.progressPercent = data.percent || 0
          if (data.fallback) {
            this.statusText = data.message || this.$t('status.gpuFallback')
          } else {
            this.statusText = this.$t('status.transcribingPercent', { percent: data.percent || 0, elapsed: data.elapsed || '' })
          }
        }
      }) : null
      try {
        if (!window.electronAPI) return
        const r = await window.electronAPI.transcribe({ audioPath: this.currentAudioPath, modelSize: this.selectedModel, useGpu: this.useGpu, gpuDevice: this.gpuDevice })
        if (r.success) {
          this.transcriptionResults = r.segments; this.hasResult = true; this.showProgress = false
          this.statusText = this.$t('status.transcribed', { count: r.segments.length }); this.progressPercent = 100
          this.llmResults = { optimized: '', translated: '', summary: '' }
          this.documents = []
          this.llmHistory = { optimized: [], translated: [], summary: [] }
          this.llmRedo = { optimized: [], translated: [], summary: [] }; this.activeSource = 'original'
          await this.saveRecordingMeta(r.segments)
        } else { this.statusText = this.$t('status.transcribeFail', { error: r.error }); this.statusError = true; this.showProgress = false }
      } catch (e) { this.statusText = this.$t('status.transcribeFail', { error: e.message }); this.statusError = true; this.showProgress = false }
      finally {
        this.busy = false
        this._transcribingAudioPath = null
        if (unsubProgress) unsubProgress()
      }
    },
    async cancelTranscribe() {
      if (!window.electronAPI || !this._transcribingAudioPath) return
      this.statusText = this.$t('status.transcribingCancel'); this.statusError = false
      try {
        await window.electronAPI.transcribeCancel({ audioPath: this._transcribingAudioPath })
        this.statusText = this.$t('status.transcribingCancelled'); this.showProgress = false; this.busy = false
        this._transcribingAudioPath = null
      } catch (e) { this.statusText = this.$t('status.transcribeFail', { error: e.message }); this.statusError = true }
    },
    _addDocument(type, content, source, target) {
      const doc = {
        id: `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type,
        source: source || 'original',
        content,
        createdAt: new Date().toISOString(),
      }
      if (target) doc.target = target
      this.documents.push(doc)
      return doc
    },
    async saveRecordingMeta(segments, llmResults) {
      if (!window.electronAPI || !this.audioInfo) return
      const now = new Date()
      const id = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}-${String(now.getSeconds()).padStart(2,'0')}_${this.recordingMode || 'import'}`
      const duration = segments.length > 0 ? segments[segments.length-1].end : 0
      const audioPath = this.currentAudioPath || ''
      const clonedSegments = JSON.parse(JSON.stringify(segments))
      const clonedLlmResults = JSON.parse(JSON.stringify(llmResults || this.llmResults))
      const clonedDocuments = JSON.parse(JSON.stringify(this.documents))
      await window.electronAPI.recoSaveMeta({ recordingId: id, filename: `${id}.webm`, recordingMode: this.recordingMode || 'import', recordedAt: now.toISOString(), duration, modelSize: this.selectedModel, segments: clonedSegments, llmResults: clonedLlmResults, audioPath, documents: clonedDocuments })
      this.currentRecordingId = id
    },

    // ── LLM ──
    pushHistory(type) { if (this.llmResults[type]) { this.llmHistory[type].push(this.llmResults[type]) }; this.llmRedo[type] = [] },
    undo() { const t = this.activeSource; if (t === 'original' || !this.llmHistory[t] || !this.llmHistory[t].length) return; this.llmRedo[t].push(this.llmResults[t]); this.llmResults[t] = this.llmHistory[t].pop() },
    redo() { const t = this.activeSource; if (t === 'original' || !this.llmRedo[t] || !this.llmRedo[t].length) return; this.llmHistory[t].push(this.llmResults[t]); this.llmResults[t] = this.llmRedo[t].pop() },
    getActiveText() { if (this.activeSource === 'original') { return this.transcriptionResults.map(s => `[${this.formatTime(s.start)}] ${s.text}`).join('\n') }; return this.llmResults[this.activeSource] || '' },
    getLlmParams() { const text = this.getActiveText(); const apiKey = this.apiKeys[this.llmProvider] || ''; return { provider: this.llmProvider, apiKey, model: this.llmModel, text } },
    async doOptimize() {
      if (!window.electronAPI) return; this.pushHistory('optimized'); this.llmBusy = true; this.statusText = this.$t('status.optimizing')
      try {
        const apiKey = this.apiKeys[this.llmProvider] || ''
        const r = await window.electronAPI.llmJobSubmit({
          type: 'optimize',
          params: { provider: this.llmProvider, apiKey, model: this.llmModel, segments: JSON.parse(JSON.stringify(this.transcriptionResults)) }
        })
        if (r.success) {
          this.activeJobId = r.jobId
          this._pollJobResult(r.jobId, 'optimized')
        } else { this.statusText = this.$t('status.llmFail', { label: '✨ 優化', error: r.error }); this.statusError = true; this.llmBusy = false }
      } catch (e) { this.statusText = this.$t('status.llmError', { label: '✨ 優化', message: e.message }); this.statusError = true; this.llmBusy = false }
    },
    async _pollJobResult(jobId, type) {
      const maxAttempts = 600
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise(r => setTimeout(r, 500))
        try {
          const status = await window.electronAPI.llmJobStatus({ jobId })
          if (!status.success || !status.job) continue
          const job = status.job
          if (job.status === 'completed') {
            if (type === 'optimized') {
              if (Array.isArray(job.result) && job.result.length > 0) {
                const lines = job.result.map((s, i) => {
                  const t = this.formatTime(s.start)
                  const e = this.formatTime(s.end)
                  const optText = s.optimizedText || s.text
                  return `[${t} - ${e}] ${optText}`
                })
                this.llmResults.optimized = lines.join('\n')
              } else {
                this.llmResults.optimized = job.result || ''
              }
            } else if (type === 'translated') {
              this.llmResults.translated = job.result || ''
            } else if (type === 'summary') {
              this.llmResults.summary = job.result || ''
            }
            this.activeSource = type
            const typeToJobType = { optimized: 'optimize', translated: 'translate', summary: 'summary' }
            const jobType = typeToJobType[type] || type
            const source = type === 'translated' ? 'translated' : type
            const target = type === 'translated' ? this.translateTarget : null
            this._addDocument(jobType, this.llmResults[type], source, target)
            this.llmBusy = false
            this.activeJobId = null
            this.activeJobProgress = { batch: 0, totalBatches: 0, percent: 0 }
            this.statusText = this.$t('status.llmDone', { label: type === 'optimized' ? '✨ 優化' : type === 'translated' ? '🌐 翻譯' : '📋 摘要' })
            this.saveRecordingMeta(this.transcriptionResults)
            return
          } else if (job.status === 'failed') {
            this.llmBusy = false
            this.activeJobId = null
            this.activeJobProgress = { batch: 0, totalBatches: 0, percent: 0 }
            this.statusText = this.$t('status.llmFail', { label: type, error: job.error || '未知錯誤' })
            this.statusError = true
            return
          } else if (job.status === 'cancelled') {
            this.llmBusy = false
            this.activeJobId = null
            this.activeJobProgress = { batch: 0, totalBatches: 0, percent: 0 }
            this.statusText = this.$t('status.ready')
            return
          }
          if (job.progress) {
            this.activeJobProgress = job.progress
          }
        } catch (e) {}
      }
      this.llmBusy = false
      this.activeJobId = null
      this.activeJobProgress = { batch: 0, totalBatches: 0, percent: 0 }
      this.statusText = this.$t('status.llmFail', { label: type, error: '處理超時' })
      this.statusError = true
    },
    async doTranslate() {
      if (!window.electronAPI) return; this.pushHistory('translated')
      const langLabels = { ja: '🇯🇵 日本語', en: '🇺🇸 English', zh: '🇨🇳 中文' }; this.llmBusy = true; this.statusText = this.$t('status.translating', { lang: langLabels[this.translateTarget] || this.translateTarget })
      try {
        const apiKey = this.apiKeys[this.llmProvider] || ''
        const text = this.getActiveText()
        const r = await window.electronAPI.llmJobSubmit({
          type: 'translate',
          params: { provider: this.llmProvider, apiKey, model: this.llmModel, text, target: this.translateTarget }
        })
        if (r.success) {
          this.activeJobId = r.jobId
          this._pollJobResult(r.jobId, 'translated')
        } else { this.statusText = this.$t('status.llmFail', { label: '🌐 翻譯', error: r.error }); this.statusError = true; this.llmBusy = false }
      } catch (e) { this.statusText = this.$t('status.llmError', { label: '🌐 翻譯', message: e.message }); this.statusError = true; this.llmBusy = false }
    },
    async doSummary() {
      if (!window.electronAPI) return; this.pushHistory('summary'); this.llmBusy = true; this.statusText = this.$t('status.summarizing')
      try {
        const apiKey = this.apiKeys[this.llmProvider] || ''
        const text = this.getActiveText()
        const r = await window.electronAPI.llmJobSubmit({
          type: 'summary',
          params: { provider: this.llmProvider, apiKey, model: this.llmModel, text }
        })
        if (r.success) {
          this.activeJobId = r.jobId
          this._pollJobResult(r.jobId, 'summary')
        } else { this.statusText = this.$t('status.llmFail', { label: '📋 摘要', error: r.error }); this.statusError = true; this.llmBusy = false }
      } catch (e) { this.statusText = this.$t('status.llmError', { label: '📋 摘要', message: e.message }); this.statusError = true; this.llmBusy = false }
    },

    // ── LLM Job 管理 ──
    initJobListener() {
      if (!window.electronAPI) return
      if (this._jobUpdateListener) return
      this._jobUpdateListener = (data) => {
        if (data.status === 'running' || data.status === 'pending') {
          this.activeJobId = data.id
          this.activeJobProgress = data.progress || { batch: 0, totalBatches: 0, percent: 0 }
        }
        if (data.status === 'completed' || data.status === 'failed' || data.status === 'cancelled') {
          this.activeJobId = null
          this.activeJobProgress = { batch: 0, totalBatches: 0, percent: 0 }
          this.llmBusy = false
          if (data.status === 'completed') {
            this.statusText = this.$t('status.llmDone', { label: data.type === 'optimize' ? '✨ 優化' : data.type === 'translate' ? '🌐 翻譯' : data.type === 'summary' ? '📋 摘要' : '🤖 查詢' })
          } else if (data.status === 'failed') {
            this.statusText = this.$t('status.llmFail', { label: data.type || '', error: data.error || '未知錯誤' })
            this.statusError = true
          }
        }
        if (this.showJobPanel) this.refreshJobList()
      }
      window.electronAPI.onLlmJobUpdate(this._jobUpdateListener)
    },
    async refreshJobList() {
      if (!window.electronAPI) return
      try {
        const r = await window.electronAPI.llmJobList()
        if (r.success) this.jobList = r.jobs
      } catch (e) {}
    },
    async cancelJob(jobId) {
      if (!window.electronAPI) return
      try {
        await window.electronAPI.llmJobCancel({ jobId })
        await this.refreshJobList()
      } catch (e) {}
    },
    async cancelActiveJob() {
      if (this.activeJobId) await this.cancelJob(this.activeJobId)
    },

    // ── LLM 文件管理 ──
    toggleJobPanel() {
      this.showJobPanel = !this.showJobPanel
      if (this.showJobPanel) this.refreshJobList()
    },
    viewLlmDoc(doc) {
      const typeMap = { optimize: 'optimized', translate: 'translated', summary: 'summary' }
      const targetType = typeMap[doc.type] || doc.type
      this.llmResults[targetType] = doc.content
      this.activeSource = targetType
      this.showLlmDocPanel = false
    },
    async deleteLlmDoc(doc) {
      if (!window.electronAPI || !this.currentRecordingId) return
      if (!confirm(this.$t('llm.docDeleteConfirm'))) return
      try {
        const r = await window.electronAPI.recoDeleteLlmDoc({ recordingId: this.currentRecordingId, docId: doc.id })
        if (r.success) {
          const idx = this.documents.findIndex(d => d.id === doc.id)
          if (idx >= 0) this.documents.splice(idx, 1)
          const typeMap = { optimize: 'optimized', translate: 'translated', summary: 'summary' }
          const targetType = typeMap[doc.type] || doc.type
          if (this.llmResults[targetType] === doc.content) {
            this.llmResults[targetType] = ''
            if (this.activeSource === targetType) this.activeSource = 'original'
          }
          this.statusText = this.$t('status.llmDocDeleted')
        } else {
          this.statusText = this.$t('status.llmDocDeleteFail', { error: r.error })
          this.statusError = true
        }
      } catch (e) {
        this.statusText = this.$t('status.llmDocDeleteFail', { error: e.message })
        this.statusError = true
      }
    },

    // ── 聲紋說話者標註 ──
    async doDiarize() {
      if (!window.electronAPI || !this.hasResult || !this.currentAudioPath) {
        this.statusText = '❌ 無音檔或逐字稿，無法進行說話者標註'
        this.statusError = true
        return
      }
      try {
        const status = await window.electronAPI.voiceprintStatus()
        if (!status.cached) {
          if (!confirm('聲紋模型尚未下載（約 50MB），是否立即下載？')) return
          this.voiceprintBusy = true
          this.voiceprintProgress = 0
          this.statusText = '正在下載聲紋模型...'
          if (window.electronAPI.onVoiceprintDownloadProgress) {
            window.electronAPI.onVoiceprintDownloadProgress((data) => {
              this.voiceprintProgress = data.percent
            })
          }
          const dl = await window.electronAPI.voiceprintDownload()
          if (!dl.success) {
            this.statusText = `❌ 下載失敗: ${dl.error}`
            this.statusError = true
            this.voiceprintBusy = false
            return
          }
        }
      } catch (e) {
        this.statusText = `❌ 檢查模型狀態失敗: ${e.message}`
        this.statusError = true
        return
      }

      this.voiceprintBusy = true
      this.voiceprintProgress = 0
      this.statusText = '正在進行說話者標註...'
      this.statusError = false

      if (window.electronAPI.onVoiceprintProgress) {
        window.electronAPI.onVoiceprintProgress((data) => {
          this.voiceprintProgress = data.percent
        })
      }

      try {
        const segments = this.transcriptionResults.map(s => ({ start: s.start, end: s.end, text: s.text }))
        const r = await window.electronAPI.voiceprintDiarize({ audioPath: this.currentAudioPath, segments })
        if (r.success && r.segments) {
          for (let i = 0; i < r.segments.length; i++) {
            if (this.transcriptionResults[i]) {
              this.transcriptionResults[i].speaker = r.segments[i].speaker || ''
            }
          }
          this.statusText = `✅ 說話者標註完成：${r.segments.length} 句`
          await this.saveRecordingMeta(this.transcriptionResults)
        } else {
          this.statusText = `❌ 說話者標註失敗: ${r.error || '未知錯誤'}`
          this.statusError = true
        }
      } catch (e) {
        this.statusText = `❌ 說話者標註異常: ${e.message}`
        this.statusError = true
      } finally {
        this.voiceprintBusy = false
        this.voiceprintProgress = 0
      }
    },

    // ── 匯出 ──
    async exportResult() {
      if (!this.hasResult) return
      const defaultName = this.activeSource === 'original' ? '會議記錄.txt' : `${this.activeSource}.txt`
      let fp = null; if (window.electronAPI) fp = await window.electronAPI.saveFileDialog(defaultName); else fp = prompt('請輸入路徑：')
      if (!fp) return
      this.busy = true; this.statusText = this.$t('status.exporting'); this.statusError = false
      try {
        if (!window.electronAPI) return; const fmt = fp.endsWith('.md') ? 'md' : 'txt'
        let results; if (this.activeSource === 'original') { results = [...this.transcriptionResults] } else { const text = this.llmResults[this.activeSource] || ''; results = [{ start: 0, end: 0, text }] }
        const r = await window.electronAPI.exportSave({ format: fmt, results, filePath: fp })
        if (r.success) this.statusText = this.$t('status.exported', { path: fp }); else { this.statusText = this.$t('status.exportFail', { error: r.error }); this.statusError = true }
      } catch (e) { this.statusText = this.$t('status.exportFail', { error: e.message }); this.statusError = true }
      finally { this.busy = false }
    },
    async exportFromToolbar() {
      if (!this.hasResult) {
        alert(this.$t('history.exportNeedReview'))
        return
      }
      await this.exportResult()
    },
    async exportFromHistory(r) {
      if (!window.electronAPI) return
      await this.reviewRecording(r.recordingId)
      try { const meta = await window.electronAPI.recoLoadMeta({ recordingId: r.recordingId }); if (meta.success && meta.meta && meta.meta.audioPath) { await this.loadAudioUrl(meta.meta.audioPath) } }
      catch (e) { console.warn('載入音檔 URL 失敗:', e) }
      await this.exportResult()
    },

    // ── 歷史記錄（樹狀目錄） ──
    async loadHistory() {
      if (!window.electronAPI) return
      try {
        const params = { folder: this.currentFolder || undefined }
        if (this.labelFilter && this.labelFilter.trim()) params.labelFilter = this.labelFilter.trim()
        const r = await window.electronAPI.recoList(params)
        if (r.success) { this.historyList = r.recordings; this.folderList = r.folders || [] }
      } catch (e) { console.warn('載入歷史記錄失敗:', e) }
    },
    async loadAllLabels() {
      if (!window.electronAPI) return
      try { const r = await window.electronAPI.recoListLabels(); if (r.success) this.allLabels = r.labels }
      catch (e) { console.warn('載入標籤列表失敗:', e) }
    },
    async loadAllFolders() {
      if (!window.electronAPI) return
      try {
        const r = await window.electronAPI.recoListAllFolders()
        if (r.success) { this.allFolders = r.folders || [] }
      } catch (e) {}
    },
    async openMoveDialog() {
      await this.loadAllFolders()
      this.showMoveDialog = true
    },
    navigateToFolder(folderPath) {
      this.currentFolder = folderPath
      this.selectedRecordings = new Set()
      this.loadHistory()
    },
    async createFolder() {
      if (!this.newFolderName.trim() || !window.electronAPI) return
      try {
        const r = await window.electronAPI.recoCreateFolder({ folderName: this.newFolderName.trim(), parentFolder: this.currentFolder || undefined })
        if (r.success) { this.statusText = this.$t('status.folderCreated'); this.showNewFolderDialog = false; this.newFolderName = ''; await this.loadHistory() }
        else { this.statusText = this.$t('status.folderCreateFail', { error: r.error }); this.statusError = true }
      } catch (e) { this.statusText = this.$t('status.folderCreateFail', { error: e.message }); this.statusError = true }
    },
    async deleteCurrentFolder() {
      if (!this.currentFolder || !window.electronAPI) return
      if (!confirm(this.$t('confirm.deleteFolder', { name: this.currentFolder }))) return
      try {
        const r = await window.electronAPI.recoDeleteFolder({ folderPath: this.currentFolder })
        if (r.success) { this.statusText = this.$t('status.folderDeleted'); this.currentFolder = ''; await this.loadHistory(); await this.loadAllLabels() }
        else { this.statusText = this.$t('status.folderDeleteFail', { error: r.error }); this.statusError = true }
      } catch (e) { this.statusText = this.$t('status.folderDeleteFail', { error: e.message }); this.statusError = true }
    },
    async renameFolder() {
      if (!this.renameFolderName.trim() || !this.currentFolder || !window.electronAPI) return
      try {
        const r = await window.electronAPI.recoRenameFolder({ folderPath: this.currentFolder, newName: this.renameFolderName.trim() })
        if (r.success) { this.statusText = this.$t('status.folderRenamed'); this.showRenameFolderDialog = false; this.renameFolderName = ''; this.currentFolder = ''; await this.loadHistory() }
        else { this.statusText = this.$t('status.folderRenameFail', { error: r.error }); this.statusError = true }
      } catch (e) { this.statusText = this.$t('status.folderRenameFail', { error: e.message }); this.statusError = true }
    },
    toggleSelectRecording(id) {
      const s = new Set(this.selectedRecordings)
      if (s.has(id)) s.delete(id); else s.add(id)
      this.selectedRecordings = s
    },
    selectAll() { this.selectedRecordings = new Set(this.historyList.map(item => item.id)) },
    deselectAll() { this.selectedRecordings = new Set() },
    async moveToFolder(target) { this.moveTargetFolder = target },
    async executeMove() {
      if (!window.electronAPI || this.selectedRecordings.size === 0) return
      try {
        const ids = Array.from(this.selectedRecordings)
        const r = await window.electronAPI.recoMoveRecordings({ recordingIds: ids, targetFolder: this.moveTargetFolder || undefined })
        if (r.success) { this.statusText = this.$t('status.moved', { count: r.moved }); this.showMoveDialog = false; this.moveTargetFolder = ''; this.selectedRecordings = new Set(); await this.loadHistory(); await this.loadAllLabels() }
        else { this.statusText = this.$t('status.moveFail', { error: r.error }); this.statusError = true }
      } catch (e) { this.statusText = this.$t('status.moveFail', { error: e.message }); this.statusError = true }
    },
    async batchDeleteSelected() {
      if (!window.electronAPI || this.selectedRecordings.size === 0) return
      if (!confirm(this.$t('confirm.batchDelete', { count: this.selectedRecordings.size }))) return
      try {
        const ids = Array.from(this.selectedRecordings)
        const r = await window.electronAPI.recoBatchDelete({ recordingIds: ids })
        if (r.success) { this.statusText = this.$t('status.batchDeleted', { count: r.deleted }); this.selectedRecordings = new Set(); await this.loadHistory(); await this.loadAllLabels() }
        else { this.statusText = this.$t('status.batchDeleteFail', { error: r.error }); this.statusError = true }
      } catch (e) { this.statusText = this.$t('status.batchDeleteFail', { error: e.message }); this.statusError = true }
    },
    async doSearch() {
      if (!this.searchKeyword.trim() || !window.electronAPI) return
      this.searchResults = []; this.aiResult = ''
      try { const r = await window.electronAPI.recoSearch({ keyword: this.searchKeyword.trim() }); if (r.success) this.searchResults = r.results; else this.statusText = `❌ 搜尋失敗: ${r.error}` }
      catch (e) { console.warn('搜尋失敗:', e) }
    },
    async doAiQuery() {
      if (!this.aiQuestion.trim() || !window.electronAPI) return
      this.aiBusy = true; this.searchResults = []; this.aiResult = ''; this.statusText = this.$t('status.aiQuerying')
      try {
        const r = await window.electronAPI.recoAiQuery({ provider: this.llmProvider, apiKey: this.apiKeys[this.llmProvider] || '', model: this.llmModel, question: this.aiQuestion.trim() })
        if (r.success) this.aiResult = r.result; else this.statusText = this.$t('status.aiQueryFail', { error: r.error })
      } catch (e) { this.statusText = this.$t('status.aiQueryFail', { error: e.message }) }
      finally { this.aiBusy = false; this.statusText = this.$t('status.ready') }
    },

    // ── Label 管理 ──
    editLabels(item) { this.editingLabelId = item.id; this.editingLabels = item.labels ? [...item.labels] : []; this.newLabelInput = ''; this.showLabelEditor = true },
    closeLabelEditor() { this.showLabelEditor = false; this.editingLabelId = ''; this.editingLabels = []; this.newLabelInput = '' },
    addLabel() {
      const label = this.newLabelInput.trim(); if (!label) return
      if (this.editingLabels.includes(label)) { this.statusText = this.$t('status.labelExists', { label }); this.statusError = true; return }
      this.editingLabels.push(label); this.newLabelInput = ''
    },
    removeLabel(idx) { this.editingLabels.splice(idx, 1) },
    async saveLabels() {
      if (!window.electronAPI) return
      try {
        const r = await window.electronAPI.recoUpdateLabels({ recordingId: this.editingLabelId, labels: [...this.editingLabels] })
        if (r.success) { this.statusText = this.$t('status.labelUpdated'); this.closeLabelEditor(); await this.loadHistory(); await this.loadAllLabels() }
        else { this.statusText = this.$t('status.labelUpdateFail', { error: r.error }); this.statusError = true }
      } catch (e) { this.statusText = this.$t('status.labelUpdateError', { message: e.message }); this.statusError = true }
    },

    // ── 搜尋結果跳轉 ──
    async jumpToSearchResult(r) {
      if (!window.electronAPI) return
      await this.reviewRecording(r.recordingId)
      try { const meta = await window.electronAPI.recoLoadMeta({ recordingId: r.recordingId }); if (meta.success && meta.meta && meta.meta.audioPath) { await this.loadAudioUrl(meta.meta.audioPath) } }
      catch (e) { console.warn('載入音檔 URL 失敗:', e) }
      if (this.currentAudioUrl && this.transcriptionResults.length > 0) {
        const idx = this.transcriptionResults.findIndex(s => Math.abs(s.start - r.start) < 0.1)
        if (idx >= 0) { this.$nextTick(() => { this.playSegment(idx) }) }
      }
    },

    // ── 音檔播放 ──
    async loadAudioUrl(audioPath) {
      if (!window.electronAPI || !audioPath) { this.currentAudioUrl = ''; return }
      try { const r = await window.electronAPI.recoGetAudioUrl({ audioPath }); if (r.success) { this.currentAudioUrl = r.url } else { this.currentAudioUrl = ''; this.statusText = `❌ 無法載入音檔: ${r.error}`; this.statusError = true } }
      catch (e) { this.currentAudioUrl = ''; console.warn('載入音檔 URL 失敗:', e) }
    },
    playSegment(idx) {
      if (!this.currentAudioUrl || !this.transcriptionResults[idx]) return
      const seg = this.transcriptionResults[idx]; const audio = this.$refs.audioPlayer; if (!audio) return
      const seekAndPlay = () => {
        if (Math.abs(audio.currentTime - seg.start) < 0.05 && !audio.paused) { return }
        const doSeekAndPlay = () => {
          const onSeeked = () => { audio.removeEventListener('seeked', onSeeked); audio.play().then(() => { this.nowPlaying = true; this.playingSegmentIdx = idx }).catch(e => { console.warn('播放失敗:', e); this.statusText = this.$t('status.playFail'); this.statusError = true }) }
          audio.addEventListener('seeked', onSeeked); audio.currentTime = seg.start
        }
        if (audio.paused) { doSeekAndPlay() } else { const onPaused = () => { audio.removeEventListener('pause', onPaused); doSeekAndPlay() }; audio.addEventListener('pause', onPaused); audio.pause() }
      }
      if (audio.readyState >= 1) { seekAndPlay(); return }
      const onLoaded = () => { audio.removeEventListener('loadedmetadata', onLoaded); seekAndPlay() }
      audio.addEventListener('loadedmetadata', onLoaded); audio.src = this.currentAudioUrl
    },
    onAudioTimeUpdate() {
      const audio = this.$refs.audioPlayer; if (!audio || !this.nowPlaying) return
      const currentTime = audio.currentTime
      for (let i = 0; i < this.transcriptionResults.length; i++) { const s = this.transcriptionResults[i]; if (currentTime >= s.start && currentTime < s.end) { if (this.playingSegmentIdx !== i) this.playingSegmentIdx = i; break } }
      const lastSeg = this.transcriptionResults[this.transcriptionResults.length - 1]; if (lastSeg && currentTime >= lastSeg.end + 0.5) { this.onAudioEnded() }
    },
    onAudioEnded() { this.nowPlaying = false; this.playingSegmentIdx = -1 },
    stopPlayback() { const audio = this.$refs.audioPlayer; if (audio) { audio.pause(); audio.src = '' }; this.nowPlaying = false; this.playingSegmentIdx = -1 },

    // ── 刪除錄音記錄 ──
    async deleteRecording(item) {
      if (!window.electronAPI) return
      if (!confirm(this.$t('confirm.deleteRecording', { name: item.filename || item.id }))) return
      this.statusText = this.$t('status.deleting', { id: item.id }); this.statusError = false
      try { const r = await window.electronAPI.recoDeleteMeta({ recordingId: item.id }); if (r.success) { this.statusText = this.$t('status.deleted'); await this.loadHistory(); await this.loadAllLabels() } else { this.statusText = this.$t('status.deleteFail', { error: r.error }); this.statusError = true } }
      catch (e) { this.statusText = this.$t('status.deleteError', { message: e.message }); this.statusError = true }
    },

    // ── 刪除音檔 ──
    async deleteAudioFile(file) {
      if (!window.electronAPI) return
      if (!confirm(this.$t('confirm.deleteAudio', { name: file.name }))) return
      this.statusText = this.$t('status.audioDeleting', { name: file.name }); this.statusError = false
      try { const r = await window.electronAPI.recoDeleteAudio({ audioPath: file.path }); if (r.success) { this.statusText = this.$t('status.audioDeleted'); await this.loadAudioFiles() } else { this.statusText = this.$t('status.audioDeleteFail', { error: r.error }); this.statusError = true } }
      catch (e) { this.statusText = this.$t('status.audioDeleteError', { message: e.message }); this.statusError = true }
    },

    // ── 從歷史記錄播放音檔 ──
    async playRecordingAudio(item) {
      if (!item.audioPath || !item.hasAudio) { this.statusText = this.$t('status.noAudio'); this.statusError = true; return }
      this.stopPlayback(); await this.loadAudioUrl(item.audioPath)
      if (this.currentAudioUrl) { await this.reviewRecording(item.id) }
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
.setting-section-title { font-size: 12px; font-weight: bold; color: #555; margin-top: 4px; padding-top: 4px; border-top: 1px solid #ddd; }
.api-key-input { width: 200px; padding: 4px 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 12px; }
.model-input { width: 200px; padding: 4px 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 12px; }
.setting-row select { padding: 4px 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 12px; }
.lang-select-small { padding: 4px 8px; border: 1px solid #1565C0; border-radius: 4px; font-size: 12px; background: white; font-weight: bold; color: #1565C0; }
.model-list { display: flex; flex-direction: column; gap: 4px; padding: 4px 0; }
.model-item { display: flex; align-items: center; gap: 8px; font-size: 12px; padding: 2px 0; }
.model-name { font-family: monospace; color: #333; min-width: 140px; }
.model-size { color: #888; min-width: 60px; }
.model-status { min-width: 24px; }

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

.recording-mode-label { font-size: 12px; font-weight: bold; color: #555; white-space: nowrap; }
.radio-label { font-size: 12px; cursor: pointer; display: flex; align-items: center; gap: 3px; padding: 2px 6px; border-radius: 4px; }
.radio-label:hover { background: #e0e0e0; }
.radio-label.disabled { opacity: 0.5; cursor: not-allowed; }
.radio-label input[type="radio"] { accent-color: #1565C0; }

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

.history-sub-tabs { display: flex; gap: 0; background: #f5f5f5; border-radius: 6px; padding: 2px; }
.sub-tab-btn { padding: 5px 14px; border: none; border-radius: 4px; font-size: 12px; font-weight: bold; cursor: pointer; background: transparent; color: #666; transition: all .2s; }
.sub-tab-btn.active { background: white; color: #1565C0; box-shadow: 0 1px 3px rgba(0,0,0,.1); }
.sub-tab-btn:hover:not(.active) { background: #e0e0e0; }
.btn-review { background: #1565C0; }
.btn-review:hover:not(:disabled) { background: #0D47A1; }
.btn-batch-all { background: #43A047; }
.btn-batch-all:hover:not(:disabled) { background: #2E7D32; }
.btn-transcribe-audio { background: #2196F3; }
.btn-transcribe-audio:hover:not(:disabled) { background: #1976D2; }

.history-panel { flex:1; display: flex; flex-direction: column; gap: 8px; }
.history-toolbar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.search-input { flex:1; min-width: 150px; padding: 6px 10px; border: 1px solid #1565C0; border-radius: 4px; font-size: 12px; }
.ai-input { flex:2; min-width: 200px; padding: 6px 10px; border: 1px solid #6A1B9A; border-radius: 4px; font-size: 12px; }
.search-results { flex:1; display: flex; flex-direction: column; min-height: 100px; }
.recording-list { flex:1; display: flex; flex-direction: column; min-height: 100px; }
.history-item { padding: 6px 0; border-bottom: 1px solid #eee; }
.history-info { display: flex; gap: 10px; align-items: center; font-size: 12px; flex-wrap: wrap; }
.history-date { color: #555; font-weight: bold; }
.history-mode { color: #666; }
.history-duration { color: #888; }
.history-segments { color: #1565C0; }
.audio-status { font-size: 11px; font-weight: bold; white-space: nowrap; }
.audio-ok { color: #2e7d32; }
.audio-missing { color: #c62828; }
.btn-play { background: #43A047; }
.btn-play:hover:not(:disabled) { background: #2E7D32; }
.btn-delete { background: #e53935; }
.btn-delete:hover:not(:disabled) { background: #c62828; }
.btn-stop-playback { background: #e53935; margin-left: 8px; }
.btn-stop-playback:hover { background: #c62828; }
.segment-playing { background: #e3f2fd; border-radius: 4px; padding: 2px 4px; cursor: pointer; }
.segment-playing:hover { background: #bbdefb; }
.segment { cursor: default; }
.segment[title] { cursor: pointer; }
.segment:hover[title] { background: #f5f5f5; border-radius: 4px; }
.play-indicator { margin-left: 6px; font-size: 11px; color: #1565C0; }
.playing-badge { margin-left: 8px; font-size: 11px; color: #e53935; font-weight: bold; animation: blink 1s infinite; }

/* Label 相關樣式 */
.label-filter-bar { display: flex; align-items: center; gap: 6px; padding: 4px 0; }
.label-filter-label { font-size: 12px; font-weight: bold; color: #555; white-space: nowrap; }
.label-filter-select { padding: 3px 6px; border: 1px solid #FF8F00; border-radius: 4px; font-size: 12px; background: white; }
.btn-label { background: #FF8F00; }
.btn-label:hover:not(:disabled) { background: #E65100; }
.history-labels { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 4px; padding-left: 2px; }
.label-tag { display: inline-block; background: #fff3e0; color: #e65100; padding: 1px 8px; border-radius: 10px; font-size: 10px; font-weight: bold; border: 1px solid #ffe0b2; }
.label-tag-sm { font-size: 9px; padding: 0 5px; }
.search-labels { display: inline-flex; gap: 2px; margin-left: 4px; }
.search-result-item { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.btn-jump { background: #1565C0; padding: 2px 6px; font-size: 10px; border: none; border-radius: 3px; cursor: pointer; color: white; white-space: nowrap; }
.btn-jump:hover { background: #0D47A1; }
.btn-tiny { padding: 2px 6px; font-size: 10px; border: none; border-radius: 3px; cursor: pointer; color: white; white-space: nowrap; }

/* Label 編輯彈窗 */
.label-editor-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.label-editor-panel { width: 400px; max-height: 80vh; display: flex; flex-direction: column; background: white; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.2); }
.label-editor-input-row { display: flex; gap: 6px; margin-bottom: 8px; }
.label-input { flex: 1; padding: 6px 10px; border: 1px solid #FF8F00; border-radius: 4px; font-size: 12px; }
.btn-add-label { background: #FF8F00; }
.btn-add-label:hover { background: #E65100; }
.label-editor-list { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; max-height: 200px; overflow-y: auto; }
.label-editor-item { display: flex; align-items: center; gap: 6px; padding: 4px 0; }
.btn-remove-label { background: #e53935; padding: 1px 5px; font-size: 10px; border: none; border-radius: 3px; cursor: pointer; color: white; }
.btn-remove-label:hover { background: #c62828; }
.label-editor-actions { display: flex; gap: 6px; justify-content: flex-end; }

/* 樹狀目錄樣式 */
.folder-breadcrumb { display: flex; align-items: center; gap: 2px; padding: 4px 0; font-size: 12px; flex-wrap: wrap; }
.breadcrumb-item { color: #1565C0; cursor: pointer; font-weight: bold; padding: 2px 4px; border-radius: 3px; }
.breadcrumb-item:hover { background: #e3f2fd; }
.breadcrumb-item.active { color: #333; cursor: default; }
.breadcrumb-sep { color: #999; margin: 0 2px; }
.folder-toolbar { display: flex; align-items: center; gap: 4px; padding: 4px 0; flex-wrap: wrap; }
.btn-folder-new { background: #43A047; }
.btn-folder-new:hover { background: #2E7D32; }
.btn-folder-rename { background: #FF8F00; }
.btn-folder-rename:hover { background: #E65100; }
.btn-folder-delete { background: #e53935; }
.btn-folder-delete:hover { background: #c62828; }
.btn-move { background: #1565C0; }
.btn-move:hover { background: #0D47A1; }
.btn-batch-delete { background: #c62828; }
.btn-batch-delete:hover { background: #b71c1c; }
.folder-list { display: flex; gap: 6px; flex-wrap: wrap; padding: 4px 0; }
.folder-item { padding: 4px 12px; background: #e8f5e9; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: bold; color: #2e7d32; border: 1px solid #c8e6c9; }
.folder-item:hover { background: #c8e6c9; }
.recording-checkbox { width: 14px; height: 14px; cursor: pointer; accent-color: #1565C0; }
.move-folder-list { display: flex; flex-direction: column; gap: 4px; max-height: 200px; overflow-y: auto; }
.move-folder-item { padding: 6px 10px; cursor: pointer; font-size: 12px; border-radius: 4px; }
.move-folder-item:hover { background: #f0f0f0; }
.move-folder-item.selected { background: #e3f2fd; color: #1565C0; font-weight: bold; }

/* Job 列表面板樣式 */
.job-item { padding: 8px; margin-bottom: 6px; border-radius: 4px; border: 1px solid #eee; }
.job-item.job-running { border-color: #9C27B0; background: #f3e5f5; }
.job-item.job-completed { border-color: #4CAF50; background: #e8f5e9; }
.job-item.job-failed { border-color: #e53935; background: #ffebee; }
.job-item.job-cancelled { border-color: #888; background: #f5f5f5; }
.job-item.job-pending { border-color: #FF8F00; background: #fff8e1; }
.job-header { display: flex; align-items: center; gap: 8px; font-size: 11px; flex-wrap: wrap; }
.job-id { color: #888; font-family: monospace; font-size: 10px; }
.job-type { font-weight: bold; color: #333; font-size: 11px; text-transform: capitalize; }
.job-status { font-size: 10px; font-weight: bold; padding: 1px 6px; border-radius: 8px; }
.job-status-pending { background: #fff3e0; color: #e65100; }
.job-status-running { background: #e1bee7; color: #6A1B9A; }
.job-status-completed { background: #c8e6c9; color: #2e7d32; }
.job-status-failed { background: #ffcdd2; color: #c62828; }
.job-status-cancelled { background: #e0e0e0; color: #555; }
.job-progress { margin: 4px 0; }
.job-progress-text { font-size: 10px; color: #666; }
.job-error { font-size: 11px; color: #c62828; margin-top: 4px; }
.job-log { margin-top: 4px; }
.job-log-line { font-size: 10px; color: #888; font-family: monospace; }

/* 語言選擇按鈕 */
.lang-select-buttons { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
.btn-lang { background: #e0e0e0; color: #333; padding: 8px 20px; font-size: 14px; border: 2px solid transparent; border-radius: 6px; cursor: pointer; transition: all .2s; }
.btn-lang:hover { background: #bbdefb; }
.btn-lang.selected { background: #1565C0; color: white; border-color: #0D47A1; }
</style>