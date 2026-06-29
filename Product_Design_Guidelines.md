# 產品設計指引 (Product Design Guidelines)

> **版本**: 1.8.4
> **最後更新日期**: 2026-06-30
- **v1.8.4 (2026-06-30)**：解 v1.20.2 增量功能。doDiarize() 改為提交非同步 Job、VoiceprintJobManager 類別與 6 個 IPC、Voiceprint tab UI、speaker badge、voiceprint i18n keys、refreshJobList 同時載入 voiceprintJobList、stopJob/deleteJob/openJobLog 新增 voiceprint 分支、isModelCached 加檔案大小檢查 + resetModel。

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
- **錄音模式**（v1.17.0 重構）：
  - 控制列以 radio 單選群組切換「🎙️ 麥克風」/「🖥️ 混音錄音」，搭配單一「⏺ 開始錄音 / ⏹️ 停止錄音」按鈕
  - **麥克風錄音**：`navigator.mediaDevices.getUserMedia({ audio: true })` → MediaRecorder (WebM/Opus) → ffmpeg → whisper-cli
  - **混音錄音**：`getDisplayMedia({ audio: true })`（系統音效）+ `getUserMedia({ audio: true })`（麥克風）→ Web Audio API 混音 → MediaRecorder → ffmpeg → whisper-cli
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

## 應用程式圖示規範 (Application Icon Guidelines)
- **來源**：使用者提供 1024x1024 RGBA PNG（`assets/app_icon.png`）
- **Windows 圖示**：`assets/app.ico` — 多尺寸 ICO（16/24/32/48/64/96/128/256），使用 PIL 從來源 PNG 產生
- **視窗圖示**：`assets/icon.png`（256x256 PNG），開發模式 `BrowserWindow` 指向此路徑；生產模式指向 `dist/icon.png`（Vite 建置後複製）
- **Favicon**：`frontend/public/icon.png`（Vite 靜態資源），`index.html` 以 `<link rel="icon" type="image/png" href="/icon.png">` 引用
- **electron-builder 打包**：`package.json` 的 `build.win.icon` 指向 `../assets/app.ico`，打包時自動嵌入 .exe

## Code Sign 簽署規範 (Code Sign Guidelines)
- **憑證來源**：使用 PowerShell `New-SelfSignedCertificate` 產生的自簽憑證（`C:\Certs\recorder_selfsign.pfx`），Subject: `CN=Cheng-Feng Iron Factory, O=Cheng-Feng Iron Factory, C=TW`，效期 3 年
- **設定方式**：`frontend/package.json` 的 `win` 區塊設定：
  ```json
  "certificateFile": "C:/Certs/recorder_selfsign.pfx",
  "certificatePassword": "<密碼>",
  "signAndEditExecutable": true,
  "signtoolOptions": {
    "rfc3161TimeStampServer": "http://timestamp.digicert.com"
  }
  ```
- **簽署流程**：electron-builder 在打包時自動呼叫 Windows SDK 的 signtool.exe，對所有 .exe 進行數位簽署（主程式 Recorder.exe、whisper-cli.exe、ffmpeg.exe、elevate.exe）
- **時間戳記**：使用 RFC 3161 時間戳伺服器 `http://timestamp.digicert.com`，確保憑證過期後簽署仍可驗證
- **驗證方式**：`powershell Get-AuthenticodeSignature <exe路徑>` 檢查 Status 與 SignerCertificate
- **注意事項**：
  - 自簽憑證仍會觸發 Windows SmartScreen 警告，使用者需點選「More info → Run anyway」才能執行
  - 若正式發行給一般使用者，建議購買 EV 憑證（Extended Validation，約 USD 200-500/年），可立即獲得 SmartScreen 信任
  - 憑證密碼儲存於 `package.json` 的 `win.certificatePassword` 欄位，請勿將此檔案上傳至公開 repo（已納入 `.gitignore`）

## Electron + Vue.js 前端打包規範 (Frontend Packaging Guidelines)
- **前端框架**：Electron 33 + Vue 3 + Vite 6
- **CLI 工具整合**：electron-builder 的 `extraResources` 將 `whisper_cli/` 與 `ffmpeg/` 複製到產出中的 `resources/`
- **Electron main.js**：透過 IPC handler 直接在本機呼叫 CLI 工具 (`child_process.spawn`)
- **編譯工具**：electron-builder 25.1.8 (portable 模式)
- **編譯命令**：`cd frontend && npm run electron:build`（= `vite build && electron-builder --win portable`）
- **編譯輸出**：`frontend/dist-electron/Recorder-{version}-portable.exe` (含 Electron + Vue + whisper-cli + ffmpeg)
- **Windows Defender 注意**：若編譯時遇到 `app.asar` 被鎖定，可將 `directories.output` 改為 `dist-electron-build2` 繞過
- **編譯後驗證**：驗證產出檔案時**必須使用完整絕對路徑**進行檢查，例如 `dir c:\...\frontend\dist-electron-build2\Recorder-*.exe`。避免使用 `cd /d` 切換目錄後再用相對路徑檢查（跨磁碟切換時 cmd 的 `&&` 串接可能導致路徑解析錯誤，誤判檔案不存在）。建議使用 `dir /s <完整路徑>` 確保找到正確的檔案位置。
- **開發模式**：`cd frontend && npm run electron:dev`（啟動 Vite dev server + Electron）
- **排除項目**：`files` 中排除 `node_modules/electron`，避免干擾 Electron 內建模組

## 功能模組與業務邏輯 (Functional Modules & Business Logic)


### 13. v1.20.0 新增 — 首頁非同步 Job 管理面板
- **首頁控制列新增「📋 Jobs」按鈕**（背景 `#6A1B9A`），需 on-flight jobs 時右上角顯示紅色徽章計數。
- **Job 面板**（雙 tab）：
  - **🎙️ 轉譯 Tab**：來自 `WhisperJobManager.listJobs()`，每筆含 id（末 12 字）、type、狀態徽章、來源音檔名、起始/完成時間、進度條、錯誤訊息。
  - **🤖 LLM Tab**：來自 `LlmJobManager.listJobs()`，同樣結構。
- **每筆動作按鈕**：
  - **⏹ Stop**：僅在 pending / running，呼叫 `transcribeJobCancel` / `llmJobCancel`。
  - **📜 Show Log**：開啟獨立 modal（700×500 黑底等寬字體）顯示完整 log 與結束時間戳。
  - **🗑 Delete**：可刪除任何狀態；running 會先 `kill('SIGTERM')` 子進程 → 狀態轉 cancelled → 從 active 移除；queued 直接從 queue splice；history 從歷史 splice。
- **底部工具列**：`🔄 重新整理`、`🗑 全部清除`（whisper 全部刪除 + LLM 另可個別 delete）、`❌ 關閉`。
- **計算屬性**：`totalInFlightJobs`（pending + running 合計）、`totalJobs`（全部含歷史）、`currentJobList`（依 tab 決定）。
- **Live 同步**：訂閱既有 `onTranscribeEvent` 與 `onLlmJobUpdate`，任一事件都會刷新面板（限面板開啟時）。
- **新增 IPC**：`transcribe:jobDelete` / `llm:jobDelete`；preload 暴露 `transcribeJobDelete` / `llmJobDelete`。

### 11. v1.19.0 新增 — WhisperJobManager 非同步轉譯（後端）
`frontend/electron/main.js` 內的 `WhisperJobManager` 類別管理轉譯 job queue/active/history 三段式狀態；前端 `startTranscribe()` 改為 fire-and-forget，提交後立即回傳 `jobId`，背景執行；透過 `transcribe:event` 推送 `running / completed / failed / cancelled` 狀態；持久化至 `~/.recoder/jobs.json`（最近 50 筆）；App 關閉時 `cancelAll()` 統一取消 in-flight jobs。

### 12. v1.18.0 修正 — whisper-cli greedy 解碼
`runWhisper()` 的 args 加入 `-bs 1 -bo 1`，所有模式（CPU/GPU）都使用 greedy 解碼，CPU 模式加速 3~5 倍。進度推送 fallback：當 `lastProgressPercent === 0` 且音檔總長 > 0，改用「已耗時/音檔總長」估算進度。

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
- **LLM Job Manager（v1.14.0 新增）**：
  - **LlmJobManager 類別**：管理所有 LLM 操作的佇列、執行、取消與歷史記錄
  - **Job 物件結構**：`{ id, type, status, progress, createdAt, startedAt, completedAt, error, result, log }`
  - **狀態機**：`pending → running → completed/failed/cancelled`
  - **佇列機制**：同時只執行 1 個 job，其餘排隊等待
  - **即時推送**：透過 `llm:jobUpdate` IPC 主動推送 job 狀態變更給前端
  - **前端 UI**：LLM 動作列新增「📋 Job」按鈕，點擊顯示 job 列表面板（含進度條、log、取消按鈕）
- **Token 估算與分批處理（v1.14.0 新增）**：
  - **`estimateTokens(text)`**：根據字元類型估算 token 數（CJK 1.5 token/字，ASCII 0.25 token/字）
  - **`getModelContextLimit(provider, model)`**：查詢模型 context window 上限
    - 優先比對 `KNOWN_MODEL_CONTEXTS` 對照表（含 Ollama、OpenRouter、SiliconFlow、Gemini 常見模型）
    - Ollama 可透過 `POST /api/show` 動態查詢模型資訊
    - 查無資料時 fallback 至 4096
  - **分批策略**：
    - 優化（optimize）：按句子切分，每批保留 80% context window 給輸入
    - 翻譯（translate）：按字元數切分，保留 70% context window
    - 摘要（summary）：超過上限時截斷開頭
    - AI 查詢（aiQuery）：超過上限時截斷 context
  - **逐句優化**：system prompt 要求 LLM 以 `[編號] 優化文字` 格式逐句輸出，前端解析後對應回原始 segment 保留時間戳

### 5. 音檔播放與逐句點擊播放 (`frontend/src/App.vue` + `frontend/electron/main.js`)
- **功能**：支援逐字稿句子點擊播放對應時段的原始錄音內容；從歷史記錄載入音檔後不自動播放，由使用者自行選擇起始句子
- **實作方式**：
  - Electron 註冊自訂 protocol `reco-file://`，安全地將本機音檔提供給 renderer 進程
  - IPC `reco:getAudioUrl` 接收音檔路徑，回傳 `reco-file://` URL；新增 IPC `reco:dataPath` 讓前端取得正確的 `reco_data` 路徑
  - 前端隱藏 `<audio>` 元素；點擊句子時先設定 `audio.src`，待 `loadedmetadata` 事件觸發後再設定 `audio.currentTime = seg.start` 並呼叫 `audio.play()`，確保音檔中繼資料已載入
  - `timeupdate` 事件監聽播放進度，根據 `currentTime` 更新當前高亮句子（`playingSegmentIdx`），播放自然延續不自動跳句；只有超過最後一句的 `end + 0.5` 秒才停止播放
  - 播放中的句子高亮顯示（`.segment-playing` 藍色背景 + ▶️ 指示器）
  - 面板標題在播放中顯示「▶️ 播放中」與「⏹️ 停止播放」按鈕，點擊可呼叫 `stopPlayback()` 立即停止
  - `playSegment()` 採用事件驅動序列化流程：`audio.pause()` → 等 `pause` 事件 → 設定 `currentTime` → 等 `seeked` 事件 → `play()`，避免舊緩衝區內容在 seek 完成前洩漏造成開頭重複播放
  - `reviewRecording()` 不再呼叫 `stopPlayback()`（僅重置播放狀態旗標），避免清除已載入的音檔 URL 導致播放延遲 10~30 秒
  - `playRecordingAudio()` 從歷史記錄載入音檔 URL 與逐字稿後，切換到逐字稿 tab，不再自動呼叫 `playSegment(0)`
  - **文字與語音對齊**：從音檔列表辨識時，`import:audio` 將原始音檔轉換後的 16kHz mono WAV 輸出到 `reco_data` 目錄；metadata 儲存的 `audioPath` 即為此 WAV，確保播放與辨識使用同一份音檔、時間戳一致
- **安全限制**：自訂 protocol 僅允許讀取 `recoDataPath()` 下的檔案，防止路徑遍歷攻擊

### 6. Label 管理 (`frontend/electron/main.js` + `frontend/src/App.vue`)
- **功能**：錄音記錄可新增/修改/刪除標籤（label），支援依 label 篩選記錄列表；搜尋結果顯示 labels 並支援跳轉到真實錄音記錄的相對句子位置
- **實作方式**：
  - Metadata JSON 新增 `labels: []` 欄位（向後相容，舊 JSON 無此欄位時預設空陣列）
  - 所有 IPC 改為遞迴掃描子目錄（`scanJsonFiles()`），支援樹狀目錄結構
  - IPC `reco:updateLabels` 遞迴掃描所有 JSON → 找到對應 recordingId → 更新 labels → 寫回
  - IPC `reco:listLabels` 遞迴掃描所有 JSON，回傳不重複的 label 清單
  - `reco:list` 支援 `labelFilter` 參數，僅回傳含該 label 的記錄
  - `reco:search` 搜尋結果附加 `labels`，keyword 匹配 label 時回傳該錄音的所有 segment
  - `reco:aiQuery` context 中加入 labels 資訊（`--- 錄音: xxx (標籤: A, B) ---`）
- **前端 UI**：
  - 錄音記錄列表每筆顯示 labels（彩色 tag `.label-tag`）
  - 每筆新增「🏷️」按鈕，點擊彈出 label 編輯視窗（新增/刪除 label）
  - 歷史記錄區上方新增 label 篩選下拉選單
  - 搜尋結果每筆顯示 labels 與「📖 跳轉」按鈕
  - `jumpToSearchResult()` 方法：載入逐字稿 → 載入音檔 URL → 找到對應 segment → 播放

### 7. 樹狀目錄管理 (`frontend/electron/main.js` + `frontend/src/App.vue`)
- **功能**：錄音記錄改為樹狀目錄管理，支援 folder 建立/刪除/重新命名/移動，以及多選批次移動/刪除
- **資料模型**：使用實際檔案系統目錄作為 folder 結構，`reco_data/` 下可建立多層子目錄
- **後端 IPC**：
  - `reco:saveMeta` 新增 `folder` 參數，寫入指定子目錄
  - `reco:list` 改為接收 `{ folder }` 參數，回傳 `{ folders, recordings }` 樹狀結構
  - `reco:createFolder` 建立子目錄（含安全檢查 `isPathSafe()`）
  - `reco:deleteFolder` 遞迴刪除目錄（`fs.rmSync` recursive）
  - `reco:renameFolder` 重新命名目錄（`fs.renameSync`）
  - `reco:moveRecordings` 移動多筆 JSON + 音檔到目標目錄
  - `reco:batchDelete` 批次刪除多筆記錄含音檔
- **前端 UI**：
  - Breadcrumb 導覽列顯示目前路徑，可點擊回到上層
  - Folder 管理按鈕：📁 新增目錄 / ✏️ 重新命名 / 🗑️ 刪除目錄
  - Folder 列表：點擊進入子目錄
  - 每筆錄音記錄新增 checkbox（多選模式）
  - 底部工具列：📁 移動所選 / 🗑️ 批次刪除 / ☑️ 全選 / ⬜ 取消全選
  - 移動操作彈窗：選擇目標 folder

### 7. 刪除管理 (`frontend/electron/main.js` + `frontend/src/App.vue`)
- **刪除錄音記錄**：IPC `reco:deleteMeta` 刪除 `{recordingId}.json`，前端 confirm 確認後執行
- **刪除音檔**：IPC `reco:deleteAudio` 刪除指定音檔，含安全檢查（僅允許 `recoDataPath()` 下的檔案）
- **前端 UI**：
  - 錄音記錄列表每筆顯示 🟢 有音檔 / 🔴 無音檔 狀態標示
  - ▶️ 播放按鈕（僅在有音檔時可點擊）
  - 🗑️ 刪除按鈕（紅色，點擊後彈出 confirm 對話框）
  - 音檔列表每筆也有 🗑️ 刪除按鈕

### 10. 聲紋說話者標註 (`frontend/electron/voiceprint.js` + `frontend/electron/main.js`)
- **功能**：基於 ONNX Runtime 對每個 segment 抽取 speaker embedding，透過 cosine similarity 聚類分群，自動標註 Speaker_1、Speaker_2...
- **模型**：`campplus-zh-en.onnx`（~50MB，200k 說話者訓練，支援中英日，Apache-2.0）
- **推理引擎**：`onnxruntime-node`（優先 DirectML GPU，fallback CPU）
- **特徵抽取**：80-dim fbank + CMVN（純 JS 實作，無 Python 依賴）
- **分群演算法**：Cosine similarity + 貪婪聚類（threshold=0.6）
- **音檔切割**：ffmpeg 依 segment 時間區間切割為獨立 WAV
- **處理流程**：
  ```
  segments → ffmpeg 切割每個 segment 的 PCM
          → 80-dim fbank 特徵抽取
          → ONNX Runtime 抽取 192 維 embedding
          → Cosine similarity 計算相鄰段落相似度
          → 貪婪聚類分群
          → 標註 Speaker_1, Speaker_2, ...
          → 寫入 segments[].speaker
  ```
- **後端 IPC**：
  - `voiceprint:status` — 檢查模型是否已下載
  - `voiceprint:download` — 下載聲紋模型（含進度推送）
  - `voiceprint:diarize` — 執行說話者標註（含進度推送）
- **前端 UI**：
  - LLM 動作列新增「👥 標註說話者」按鈕（橙色 #FF5722）
  - 首次使用提示下載模型（~50MB）
  - 處理中顯示進度百分比
  - 完成後逐字稿每句顯示 Speaker 標籤
- **GPU 加速**：`onnxruntime-node` 支援 DirectML EP（Windows），與現有 Vulkan GPU 加速機制一致

### 9. LLM 文件管理 (`frontend/src/App.vue` + `frontend/electron/main.js`)
- **功能**：將 LLM 優化/翻譯/摘要結果自動存入 documents 歷史陣列，支援檢視、刪除、持久化儲存
- **資料模型**：每筆 document 物件結構 `{ id, type, source, target?, content, createdAt }`
  - `type`：`optimize` / `translate` / `summary`
  - `source`：`original` / `optimized` / `translated` / `summary`（表示從哪個來源產生）
  - `target`：僅翻譯時有值（`ja` / `en` / `zh`）
  - `content`：LLM 結果文字內容
- **觸發點**：`_pollJobResult()` 完成時自動呼叫 `_addDocument()`，將 LLM 結果寫入 documents
- **持久化**：`saveRecordingMeta()` 將 `documents` 陣列一併寫入 JSON（`reco:saveMeta` IPC）
- **載入**：`reviewRecording()` 從 `meta.documents` 還原 documents 陣列
- **重置**：`startTranscribe()` 新辨識時清空 documents
- **檢視**：`viewLlmDoc()` 將文件內容設為 `llmResults[type]` 並切換 `activeSource`
- **刪除**：`deleteLlmDoc()` 呼叫 `reco:deleteLlmDoc` IPC 從 JSON 中移除指定 docId，同步清理 `llmResults`
- **前端 UI**：
  - LLM 動作列新增「📄 文件管理」按鈕（藍色 #1565C0）
  - 面板顯示所有 documents 列表（類型、來源、目標語言、時間、內容預覽 80 字）
  - 每筆提供「檢視」與「🗑️ 刪除」按鈕
  - 空列表時顯示「尚無 LLM 文件」

### 8. 前端 Vue.js 元件 (`frontend/src/App.vue`)
- **框架**：Vue 3 + Vite 6
- **通訊方式**：透過 `window.electronAPI` (preload script 暴露的 contextBridge) 呼叫 Electron IPC
- **主介面元素**（v1.17.0 重構）：
  - ⚙️ 設定按鈕 — 開啟/關閉設定面板（含 Whisper 模型管理、LLM 設定、GPU 設定）
  - 錄音模式 radio 群組 — 🎙️ 麥克風 / 🖥️ 混音錄音（二選一）
  - ⏺ 開始錄音 / ⏹️ 停止錄音按鈕（紅色/橙色，依模式動態切換）
  - 📂 音檔匯入按鈕 — 透過 IPC `dialog:openFile` → `import:audio` 進行 ffmpeg 轉換
  - 🤖 開始辨識按鈕 — 透過 IPC `transcribe:start` 呼叫 whisper-cli
  - 錄音計時器 — 顯示即時錄音時間與模式（麥克風/混音錄音）
  - 逐字稿顯示區 — 繁體中文，含時間戳和統計資訊
  - **Whisper 模型管理**（移至設定面板）：下拉選單 (tiny/base/small，預設 small) + 下載按鈕 + 已下載模型列表（含刪除按鈕）
  - **💾 匯出按鈕**（移至錄音記錄工具列與搜尋結果）：透過 IPC `dialog:saveFile` → `export:save`
- **狀態管理**：使用 Vue `data()` 管理前端狀態：
  - `isRecording` / `recordingMode` — 錄音中狀態
  - `audioLoaded` — 已匯入音檔
  - `busy` — 操作中（按鈕禁用）
  - `showProgress` — 進度條顯示
  - `transcriptionResults` — 辨識結果陣列
  - `statusText` — 狀態列訊息
- **操作流程**（v1.17.0 重構）：
  1. 選擇錄音模式（radio 切換 🎙️ 麥克風 / 🖥️ 混音錄音）→ 點擊「⏺ 開始錄音」→ 授權裝置 → 開始錄製
  2. 錄音中按鈕變為「⏹️ 停止錄音」，點擊停止 → MediaRecorder 停止 → ffmpeg 轉換 → 設定音檔
  3. 在設定面板選擇辨識模型（預設 small）→ 🤖 點擊「開始辨識」→ 檢查模型快取 → 需要則下載 → 呼叫 whisper-cli → opencc 簡轉繁
  4. 辨識完成後顯示繁體中文逐字稿
  5. 切換至「📚 歷史記錄」→ 工具列點擊「💾 匯出」或搜尋結果點擊「💾 匯出此段」→ Electron 存檔對話框 → 寫入檔案

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
- **介面語言**：支援繁體中文 (zh-TW)、English (en)、日本語 (ja)，可在設定面板切換或首次啟動時選擇
- **色彩**：麥克風錄音紅色 (#e53935)、混音錄音橙色 (#FF6F00)、匯入灰色 (#607D8B)、辨識藍色 (#2196F3)、匯出綠色 (#4CAF50)、設定灰色 (#78909C)
- **Electron 視窗**：最小尺寸 720x500，預設 960x720