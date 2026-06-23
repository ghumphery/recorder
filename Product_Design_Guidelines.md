# 產品設計指引 (Product Design Guidelines)

> **版本**: 1.4.1
> **最後更新日期**: 2026-06-23

## 產品核心願景與哲學 (Product Vision & Philosophy)
- **核心價值**：一句話 — 「離線、輕量、精準的 AI 會議記錄工具，讓每一場對話都有跡可循。」
- **開發原則**
  - **離線優先 (Offline-first)**：所有語音辨識在本地 CPU 執行，無需網路（僅首次下載模型需連線）。
  - **輕量高效**：支援主流 CPU，記憶體佔用約 300MB，音檔以 ffmpeg 轉為 16kHz mono WAV。
  - **使用者可控**：辨識結果可手動校正，匯出格式可選。
  - **隱私保障**：所有資料僅存於本機，不上傳雲端。

## 架構與技術規範 (Architecture & Tech Guidelines)
- **語言**：JavaScript (Node.js, Electron) + HTML/CSS (Vue.js)
- **前端框架**：Electron (Chromium) + Vue 3 + Vite
- **後端機制**：Electron main.js 透過 Node.js IPC 直接處理所有後端邏輯（無獨立後端服務）
- **前後端通訊**：Electron IPC (`ipcMain` / `ipcRenderer` + `contextBridge`)
- **語音辨識引擎**：whisper.cpp CLI (`whisper-cli.exe`)，支援 CPU (AVX2) 及 Vulkan GPU 加速
- **GPU 加速控制**：支援兩種後端（CPU / Vulkan），可在設定面板啟用/停用 GPU 及選擇 GPU 裝置編號；`useGpu=false` 時傳遞 `--no-gpu`，啟用時傳遞 `-dev <編號>`
- **音訊處理**：ffmpeg.exe（音檔轉換為 16kHz mono WAV）
- **模型下載**：Node.js `https` 模組直接下載 GGML 格式模型
- **簡轉繁轉換**：opencc-js（辨識結果從簡體中文自動轉為繁體中文）
- **錄音模式**：
  - **麥克風錄音**：`navigator.mediaDevices.getUserMedia({ audio: true })` → MediaRecorder (WebM/Opus) → ffmpeg → whisper-cli
  - **線上會議混音**：`getDisplayMedia({ audio: true })`（系統音效）+ `getUserMedia({ audio: true })`（麥克風）→ Web Audio API 混音 → MediaRecorder → ffmpeg → whisper-cli
- **版本號管理**：
  - 版本號定義於 `frontend/package.json` 的 `version` 欄位
  - Electron 視窗標題動態讀取版本號：`Recorder v{version} — AI 會議記錄`（設定於 `frontend/electron/main.js` 的 `BrowserWindow title`）
  - 每次功能或修補更新須遞增版本號（Major.Minor.Patch）
- **資料流**：
  ```
  匯入音檔 → ffmpeg.exe 轉為 16kHz mono WAV
           → whisper-cli.exe 語音轉文字 (GGML 模型)
           → opencc-js 簡轉繁
           → 顯示繁體逐字稿
  ```
- **通訊流**：
  ```
  使用者操作 → Vue.js 元件 → IPC → Electron main.js
                                    ├── ffmpeg.exe (轉換)
                                    ├── whisper-cli.exe (辨識)
                                    ├── opencc-js (簡轉繁)
                                    ├── https.get (模型下載)
                                    └── fs.writeFile (匯出)
  ```
- **版本**：語意化版本 (Major.Minor.Patch)
- **無需 Python**：完全使用 Node.js + C++ CLI 工具，無任何 Python 依賴
- **無需 Flask / port 5199**：所有後端邏輯在 Electron main.js 的 IPC handler 中直接執行

## CLI 工具規範 (CLI Tools Guidelines)
- **whisper-cli.exe**：whisper.cpp 編譯的 CLI 工具 (~485 KB)，需搭配 `whisper.dll`、`ggml.dll`、`ggml-base.dll`、`ggml-cpu.dll`
- **ffmpeg.exe**：音訊/視訊處理工具 (~130 MB)，用於將各種音檔格式轉換為 16kHz mono WAV
- **模型格式**：GGML 格式，存放於 `model/` 目錄，檔案名 `ggml-{size}.bin`
- **whisper-cli 參數**：
  - `-m <model>`：模型路徑
  - `-f <file>`：音檔路徑
  - `--output-json -oj <file>`：JSON 輸出檔路徑
  - `-l <lang>`：語言 (auto/zh/en)
  - `-t <n>`：執行緒數
  - **反 hallucination 參數**（長音訊防護，v1.8.9 起預設開啟）：
    - `-ml 60`：限制每段最大字元長度，避免長段無音訊時產生重複文字
    - `-nth 0.7`：提高 no-speech 閾值，過濾靜音區段的幻覺輸出
    - `-wt 0.03`：提高 word timestamp 閾值，過濾低信心字詞
    - `-bs 1 -bo 1`：改用 greedy 解碼（beam_size=1, best_of=1）減少幻覺
    - `--suppress-nst`：抑制非語音 token (如 [音樂]、(笑聲))
    - `--no-fallback`：禁用溫度回退，減少重複採樣
  - **Python 後處理**（`transcriber._deduplicate_repeats()`）：辨識完成後進一步以 Jaccard 相似度計算去除相鄰高度相似的重複 segment，保留時間跨度最長者
- **ffmpeg 參數**：`-y -i <input> -ar 16000 -ac 1 -sample_fmt s16 <output>`

## Electron + Vue.js 前端打包規範 (Frontend Packaging Guidelines)
- **前端框架**：Electron 33 + Vue 3 + Vite 6
- **CLI 工具整合**：electron-builder 的 `extraResources` 將 `whisper_cli/` 與 `ffmpeg/` 複製到產出中的 `resources/`
- **Electron main.js**：透過 IPC handler 直接在本機呼叫 CLI 工具 (`child_process.spawn`)
- **編譯工具**：electron-builder 25.1.8 (portable 模式)
- **編譯命令**：`cd frontend && npm run electron:build`（= `vite build && electron-builder --win portable`）
- **編譯輸出**：`frontend/dist-electron/Recorder-{version}-portable.exe` (含 Electron + Vue + whisper-cli + ffmpeg)
- **開發模式**：`cd frontend && npm run electron:dev`（啟動 Vite dev server + Electron）
- **排除項目**：`files` 中排除 `node_modules/electron`，避免干擾 Electron 內建模組

## 功能模組與業務邏輯 (Functional Modules & Business Logic)

### 1. 音檔轉換 (`electron/main.js` → ffmpeg)
- **功能**：使用 ffmpeg.exe 將使用者匯入的各種音檔格式轉換為 16kHz mono WAV
- **支援格式**：WAV、MP3、Opus、OGG、FLAC、M4A（ffmpeg 支援的所有格式）
- **輸出**：16kHz 單聲道 WAV，存放於系統暫存目錄
- **實現方式**：`child_process.spawn('ffmpeg.exe', args)`

### 2. 會議錄音 (`frontend/src/App.vue` → MediaRecorder)
- **麥克風錄音 (🎙️)**
  - 使用 `navigator.mediaDevices.getUserMedia({ audio: true })` 取得麥克風串流
  - 使用 `MediaRecorder` 以 WebM/Opus 格式錄製
  - 錄音停止後將 blob 透過 IPC `save:recorded` 傳送給 main.js
  - main.js 寫入暫存檔 → ffmpeg 轉為 16kHz WAV → 設定為當前音檔
- **線上會議混音 (🖥️)**
  - 使用 `navigator.mediaDevices.getDisplayMedia({ audio: true })` 擷取系統音效（會議軟體播放的聲音）
  - 同時使用 `getUserMedia({ audio: true })` 擷取麥克風
  - 使用 Web Audio API 將兩者混音為單一 AudioStream
  - 其餘流程同麥克風錄音
- **計時器**：錄音期間顯示即時計時器 (00:00 格式)，每秒更新
- **防呆**：錄音期間匯入音檔按鈕禁用，錄音中按鈕變為「停止錄音」可點擊停止
### 3. 語音辨識 (`electron/main.js` → whisper-cli.exe)
- **引擎**：whisper.cpp CLI，支援 CPU 優化 (AVX2、OpenMP)
- **模型**：GGML 格式，預設 `tiny` (~77MB)，可切換 `base` (~148MB)、`small` (~488MB)
- **模型下載**：透過 Node.js `https.get` 從 Hugging Face (`ggerganov/whisper.cpp`) 下載
- **簡轉繁**：使用 opencc-js 的 `Converter({ from: 'cn', to: 'tw' })` 將辨識結果從簡體中文轉為繁體中文
- **輸出格式**：
  ```json
  {
    "transcription": [
      {
        "offsets": { "from": 0, "to": 8080 },
        "text": " 辨識文字內容"
      }
    ]
  }
  ```
- **輸出**：逐句文字 + 起始/結束時間戳 (秒)
- **多語言**：支援中文 (zh)、英文 (en)，自動偵測

### 4. LLM 功能模組 (`electron/main.js` → callLLM)
- **功能**：透過 LLM API 對辨識結果進行語句優化、多語言翻譯（中文/英文/日文）、重點整理
- **支援提供商**：
  - **Ollama (本地)**：`http://127.0.0.1:11434/api/generate`，免 API Key，預設模型 `llama3`
  - **Ollama Cloud**：`https://ollama.com/v1/chat/completions`（OpenAI-compatible），需 API Key，預設模型 `llama3.2`
  - **OpenRouter**：`https://openrouter.ai/api/v1`，需 API Key，預設模型 `google/gemma-2-9b-it`
  - **SiliconFlow**：`https://api.siliconflow.cn/v1`，需 API Key，預設模型 `Qwen/Qwen2.5-7B-Instruct`
  - **Gemini**：`https://generativelanguage.googleapis.com/v1beta`，需 API Key，預設模型 `gemini-2.0-flash`
- **獨立 API Key**：每個 provider 的 Key 獨立儲存於 `settings.json` 的 `apiKeys` 物件（`{ openrouter: '...', siliconflow: '...', gemini: '...', ollama_cloud: '...' }`）
- **跨版本遷移**：`settings.json` 含 `settingsVersion` 欄位；`migrateSettings()` 自動將舊版 `llmApiKey` 遷移至新版 `apiKeys` 物件
- **翻譯目標語言**：下拉選單選擇翻譯目標（🇯🇵 日文 / 🇺🇸 英文 / 🇨🇳 中文），system prompt 動態切換
- **實作方式**：`callLLM(provider, apiKey, model, prompt, systemPrompt)` 依提供商路由至對應 API
- **三個功能按鈕**：✨語句優化 / 🌐翻譯（含目標語言選擇） / 📋重點整理，僅在有辨識結果時顯示

### 5. 音檔播放與逐句點擊播放 (`frontend/src/App.vue` + `frontend/electron/main.js`)
- **功能**：支援逐字稿句子點擊播放對應時段的原始錄音內容；從歷史記錄載入音檔後不自動播放，由使用者自行選擇起始句子
- **實作方式**：
  - Electron 註冊自訂 protocol `reco-file://`，安全地將本機音檔提供給 renderer 進程
  - IPC `reco:getAudioUrl` 接收音檔路徑，回傳 `reco-file://` URL；新增 IPC `reco:dataPath` 讓前端取得正確的 `reco_data` 路徑
  - 前端隱藏 `<audio>` 元素；點擊句子時先設定 `audio.src`，待 `loadedmetadata` 事件觸發後再設定 `audio.currentTime = seg.start` 並呼叫 `audio.play()`，確保音檔中繼資料已載入
  - `timeupdate` 事件監聽播放進度，自動跳至下一句（`currentTime >= seg.end + 0.3` 時，保留 300ms 緩衝避免語音未完就提前跳句）
  - 播放中的句子高亮顯示（`.segment-playing` 藍色背景 + ▶️ 指示器）
  - 面板標題在播放中顯示「▶️ 播放中」與「⏹️ 停止播放」按鈕，點擊可呼叫 `stopPlayback()` 立即停止
  - `reviewRecording()` 與 `playRecordingAudio()` 載入新逐字稿前會先呼叫 `stopPlayback()`，避免舊音檔繼續播放
  - `playRecordingAudio()` 從歷史記錄載入音檔 URL 與逐字稿後，切換到逐字稿 tab，不再自動呼叫 `playSegment(0)`
  - **文字與語音對齊**：從音檔列表辨識時，`import:audio` 將原始音檔轉換後的 16kHz mono WAV 輸出到 `reco_data` 目錄；metadata 儲存的 `audioPath` 即為此 WAV，確保播放與辨識使用同一份音檔、時間戳一致
- **安全限制**：自訂 protocol 僅允許讀取 `recoDataPath()` 下的檔案，防止路徑遍歷攻擊

### 6. 刪除管理 (`frontend/electron/main.js` + `frontend/src/App.vue`)
- **刪除錄音記錄**：IPC `reco:deleteMeta` 刪除 `{recordingId}.json`，前端 confirm 確認後執行
- **刪除音檔**：IPC `reco:deleteAudio` 刪除指定音檔，含安全檢查（僅允許 `recoDataPath()` 下的檔案）
- **前端 UI**：
  - 錄音記錄列表每筆顯示 🟢 有音檔 / 🔴 無音檔 狀態標示
  - ▶️ 播放按鈕（僅在有音檔時可點擊）
  - 🗑️ 刪除按鈕（紅色，點擊後彈出 confirm 對話框）
  - 音檔列表每筆也有 🗑️ 刪除按鈕

### 7. 前端 Vue.js 元件 (`frontend/src/App.vue`)
- **框架**：Vue 3 + Vite 6
- **通訊方式**：透過 `window.electronAPI` (preload script 暴露的 contextBridge) 呼叫 Electron IPC
- **主介面元素**：
  - 🎙️ 麥克風錄音按鈕（紅色） — 僅錄製本機麥克風，透過 IPC `save:recorded` 送出
  - 🖥️ 線上會議混音按鈕（橙色） — 錄製系統音效 + 麥克風混音
  - 📂 匯入音檔按鈕 — 透過 IPC `dialog:openFile` → `import:audio` 進行 ffmpeg 轉換
  - 模型選擇下拉選單 (tiny/base/small) — 資料來自 IPC `models:list`
  - 🤖 開始辨識按鈕 — 透過 IPC `transcribe:start` 呼叫 whisper-cli
  - 💾 匯出按鈕 — 透過 IPC `dialog:saveFile` → `export:save`
  - 錄音計時器 — 顯示即時錄音時間與模式（麥克風/混音）
  - 逐字稿顯示區 — 繁體中文，含時間戳和統計資訊
- **狀態管理**：使用 Vue `data()` 管理前端狀態：
  - `isRecording` / `recordingMode` — 錄音中狀態
  - `audioLoaded` — 已匯入音檔
  - `busy` — 操作中（按鈕禁用）
  - `showProgress` — 進度條顯示
  - `transcriptionResults` — 辨識結果陣列
  - `statusText` — 狀態列訊息
- **操作流程**：
  1. 🎙️ 點擊「麥克風錄音」或 🖥️ 點擊「線上會議混音」→ 授權裝置 → 開始錄製
  2. 錄音中按鈕變為「⏹️ 停止錄音」，點擊停止 → MediaRecorder 停止 → ffmpeg 轉換 → 設定音檔
  3. 選擇辨識模型 → 🤖 點擊「開始辨識」→ 檢查模型快取 → 需要則下載 → 呼叫 whisper-cli → opencc 簡轉繁
  4. 辨識完成後顯示繁體中文逐字稿
  5. 💾 點擊「匯出」→ Electron 存檔對話框 → 寫入檔案

## UI/UX 與交互規範 (UI/UX & Interaction Principles)
- **錯誤處理**：IPC 呼叫失敗時，前端顯示 `statusText` 狀態列訊息，不崩潰
- **防呆機制**（透過 Vue `v-if` / `:disabled` 屬性控制按鈕）：
  - `busy` 為 true 時，所有操作按鈕禁用
  - `isRecording` 為 true 時，匯入和辨識按鈕禁用
  - 錄音中當前按鈕變為「⏹️ 停止錄音」可點擊
  - `!audioLoaded` 時，「開始辨識」按鈕禁用
  - `!hasResult` 時，「匯出」按鈕禁用
- **進度回饋**：模型下載和辨識期間顯示進度條
- **錄音授權**：首次點擊錄音時瀏覽器自動請求麥克風/畫面權限，拒絕時顯示明確錯誤訊息
- **視窗標題**：格式為 `Recoder v{版本號} — AI 會議記錄`，動態讀取 `frontend/package.json` 的 `version` 欄位
- **介面語言**：繁體中文
- **色彩**：麥克風錄音紅色 (#e53935)、混音錄音橙色 (#FF6F00)、匯入灰色 (#607D8B)、辨識藍色 (#2196F3)、匯出綠色 (#4CAF50)
- **Electron 視窗**：最小尺寸 720x500，預設 960x720