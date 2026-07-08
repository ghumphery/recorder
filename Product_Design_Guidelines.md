# 產品設計指引 (Product Design Guidelines)

> **版本**: 1.23.6
> **最後更新日期**: 2026-07-08
- **v1.23.6 (2026-07-08)**：patch — 修聲紋 GPU/DirectML (Vulkan) 加速。原 v1.23.5 UI 有「啟用 GPU」勾選框但程式碼未傳 useGpu flag 給 voiceprint 模組，造成 `loadModel()` 永遠 hardcoded `executionProviders: ['cpu']`，勾選無效。修正：(1) `voiceprint.js` `loadModel(modelKey, useGpu)` 改為 `useGpu ? ['dml', 'cpu'] : ['cpu']`，DML 失敗自動 fallback CPU（避免 v1.20.12 記錄的 campplus AveragePool 拋 80070057 報錯）；新增 `_lastLoadProvider` / `_lastLoadUseGpu` cache 變數（移至 loadModel 之前），cache hit 判斷包含 useGpu；新增 `getCurrentProvider()` 對外讀取當前 session 實際使用的 EP。(2) 級聯到 setActiveModel / _ensureModelLoaded / diarizeAudio / propagateSpeakers / identifySpeakers / buildProfile / buildProfileFromAudioFile 全部加 useGpu 參數並轉傳；module.exports 新增 `getCurrentProvider`。(3) main.js 7 個 voiceprint IPC handler 接受 useGpu：`voiceprint:status` 新增 `provider` 欄位回傳、`voiceprint:download` 下載後 setActiveModel 也帶 useGpu、`voiceprint:diarize` / `voiceprint:propagate` (用 opts.useGpu) / `voiceprint:identifySpeakers` / `voiceprint:backfillAll` / `voiceprint:jobSubmit`（新 useGpu 欄位透傳）。(4) `VoiceprintJobManager` addJob / _executeJob 接受 useGpu，背景 diarize job 也會走 GPU 加速。(5) App.vue 5 個呼叫點都帶 `useGpu: this.useGpu`（voiceprintDownload / voiceprintJobSubmit / voiceprintPropagate / voiceprintIdentifySpeakers / voiceprintBackfillAll）。(6) `frontend/package.json` 1.23.5 → 1.23.6。DirectML 是 onnxruntime-node 1.27.0 唯一原生支援的 GPU EP，在 Windows 11 + WDDM 2.9+ 驅動下會透過 Vulkan API 轉譯 GPU 運算，與 whisper.cpp 的 Vulkan 加速路徑一致。
- **v1.21.4 (2026-07-01)**：minor 演算法強化 — 強化多 seed centroid 計算 (trimmed mean + outlier rejection)。`propagateSpeakers()` 在 ≥3 個 seeds 時改為：先計算每個 seed 與其他 seed 的平均 cosine similarity，排序後去掉最高/最低各 ⌊n/4⌋ 個 outliers（最多各 1 個），再用剩餘 seeds 的 mean 作為 centroid；保留 `centroidInfo` 供 UI 顯示 `internalCoherence` (種子內部一致性 0~1)。解決「同一句重覆標記的 seed 拉偏 centroid」與「無關句子（背景音、咳嗽）拉偏 centroid」兩個問題；對大多數實際場景，3–5 個乾淨 seeds 已足夠，10+ 個 seeds 的邊際效益遞減。
- **v1.21.3 (2026-07-01)**：minor 新功能 — 逐字稿講者標籤顯示每一句的聲紋值。`diarizeAudio()` 與 `propagateSpeakers()` 在 result 中加入 `score` (cosine similarity 0~1)，App.vue speaker tag 旁顯示「[speaker] [score]」如「張三 85」表示 85% 相似度。
- **v1.21.2 (2026-06-30)**：hotfix — 修正講者標籤編輯後逐字稿變成無音檔狀態。`saveRecordingMeta()` 當 `currentAudioPath` 為空時主動從舊 metadata 載入保留 `audioPath`；`reviewRecording()` 不再強制將 `currentAudioPath` 設為 `null`，改為讀取 `r.meta.audioPath`，並自動呼叫 `loadAudioUrl` 載入音檔 URL。
- **v1.21.1 (2026-06-30)**：hotfix — 修正每次消取/編輯 speaker 都建立新 metadata 檔。`saveRecordingMeta()` 沿用既有 `currentRecordingId` 不再生新 ID；新增 `_scheduleSaveRecordingMeta()` 500ms debounce helper；`setSegmentSpeaker()` / `doPropagateSpeakers()` / `clearAllSpeakers()` 三處改用 debounced save。
- **v1.20.11 (2026-06-30)**：聲紋模型下載 hotfix。`MIN_MODEL_SIZE` 從 `40 MB` 改為 `25 MB`，解決使用者回報「下載不完整(只收到 28283928 bytes)」永不停止的問題。**根因**：v1.20.7 把門檻設太大，但實際 `campplus_cn_en_common_200k.onnx` 真實大小 = **28,283,928 bytes (约 26.97 MB)**——頭 16 bytes `08 08 12 07 70 79 74 6F 72 63 68 1A 06 32 2E 31` 為合法 protobuf ONNX magic(pytorch 2.10.0 exporter)。`isModelCached()` 與 `diarizeAudio()` 依賴同一常數，避免未來魔術數字漂移。
- **v1.20.7 (2026-06-30)**：聲紋標註三項修正。`downloadModel()` 開頭檢查 `isModelCached()` 避免重覆下載；`getAudioDuration()` 解析 ffmpeg stderr 取得音檔時長；`splitLongAudio()` 用 ffmpeg `-f segment -segment_time 3000` 切長音檔成 ≤50 分鐘 WAV chunks；`extractSegmentPcm()` 過短 segment 自動 ±0.5s padding 並放寬最低長度為 0.3s；`extractEmbedding()` numFrames 門檻 <5 → <3；`clusterEmbeddings()` 改為兩段式：鄰近滑動視窗 median cosine ≥ 0.55 union-find 強制合併 + 全域 centroid cosine ≥ 0.5 貪婪合併；統一 `MIN_MODEL_SIZE = 25MB` 移除重覆常數；新增 `getFfmpegPath()` 共用輔助函式。
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


### 14. 跨模組非同步 Job 架構規範（Job Manager Pattern）— 未來 Job 製作契約

> **定位**：本節是**未來新增任何類型 Job**時必須遵循的設計規約。§11~13 為歷史實例（v1.14.0 LlmJobManager / v1.19.0 WhisperJobManager / v1.20.0 Jobs UI），§14 才是跨類別適用的**契約層**。任何新的 JobManager 必須符合本節全部子節才能 merge 到 master。

#### 14.1 目標與設計哲學
- **不阻塞 UI**：語音轉譯、LLM、聲紋三類任務都可能在背景跑 5~120 分鐘；呼叫端必須 fire-and-forget，按按鈕後立即收到 jobId。
- **單一 in-flight 限制**：**同一個** JobManager 種類（如 whisper）同時只跑 1 個；**不同類別可並行**（whisper 跑 1 個時可再按 LLM 或聲紋）。
- **IPC 推送 + 查詢雙軌**：渲染端訂閱 `*:jobUpdate` 即時進度更新 + 隨時可用 `*:jobStatus(jobId)` 重連或確認。
- **可恢復**：長任務（≥ 30 分鐘）宜支援 `~/.recoder/jobs.json` 持久化；短任務可僅依賴記憶體。
- **可取消**：running 中的 job 必須能透過 cancelJob 立即停掉（kill 子進程 + 標 cancelled），並讓 UI 反映新狀態。

#### 14.2 Job 物件統一結構（schema）
新 JobManager 必須使用以下欄位：
```js
{
  id: string,                  // UUID v4，owner 用於 cancel / query
  type: 'transcribe'|'optimize'|'translate'|'summary'|'aiQuery'|'diarize'|<new_type>,
  status: 'pending'|'running'|'completed'|'failed'|'cancelled',
  params: object,              // 提交時的 input（e.g. {audioPath, modelSize, ...}）
  progress: {                   // progress bar 顯示用，any field is optional
    percent: number(0~100),
    batch?: number, totalBatches?: number,
    currentChunk?: number, totalChunks?: number,
  },
  result: any,                 // 完成後的回傳，由型別決定形狀
  error: string|null,
  log: string[],               // 累積 log line（每筆 job 可在 Modal 顯示）
  createdAt: ISO,
  startedAt: ISO|null,
  completedAt: ISO|null,
}
```

#### 14.3 狀態機（不允許跳過）
```
pending → running → completed
                    \→ failed
                    \→ cancelled
```
- `pending` 一經被 `processNext()` 取出立刻轉 `running`。
- **不允許 `pending → completed`** 跳過 running；中間狀態必須經過。
- 任何拋出的例外 → catch 內轉 `failed`（寫到 `error`）。
- 使用者/UI 主動取消 → 從 running 走到 `cancelled`（並 kill 子進程）；從 pending 取消則直接從 queue 移除，並轉 `cancelled`。

#### 14.4 JobManager 抽象介面（必須實作）
| 方法 | 簽名 | 用途與實作要求 |
|---|---|---|
| `addJob(params)` | `→ Job` | 推入 `jobQueue`，立即回傳含 `id` 的 Job 物件；若該類別已在 in-flight，可先拒絕或併入 queue，由 JobManager 自行決策。 |
| `processNext()` | `async` | 內部迴圈：若無 in-flight，從 queue 取出 head、轉 `running`、設定 `startedAt`、呼叫 `_executeJob(job)`、寫入 `progress/result/error/completedAt`。**例外一定要 try/catch**並轉 `failed`。 |
| `cancelJob(jobId)` | `→ boolean` | pending：從 queue splice + 標 cancelled；running：呼叫 `child.kill('SIGTERM')` + 標 cancelled + 結束時間；其他狀態：傳回 false。 |
| `getStatus(jobId)` / `getJobStatus(jobId)` | `→ Job\|null` | 從 active/queue/history 任一陣列找。getJobStatus 是為 LLM 與聲紋與語意一致保留的別名。 |
| `listJobs()` | `→ Job[]` | 回傳全部（active + queue + history）供前端 Jobs 面板使用。 |
| `deleteJob(jobId)` | `→ boolean` | running：先 cancel；pending：queue splice；history：splice。回傳是否真的被刪。 |
| `cancelAll()` (可選) | `async` | **whisper 必須實作**：App `before-quit` 時呼呾為統一清场以避免殭屍進程；其他短任務可省略。 |
| `clearHistory()` (可選) | `void` | **whisper 必須實作**：批次清空，`jobs.action.clearAll` 按鈕使用。 |

**必須的私有 helper**：
- `_generateId()` — UUID v4（用 node 內建 `crypto.randomUUID()`）。
- `_log(job, message)` — 推入 `job.log` + 推到 appLog（用 `new Date().toISOString()` timestamp）。
- `_sendUpdate(job)` — 透過 `mainWindow.webContents.send('<prefix>:jobUpdate', job)` 推給 renderer。
- `_persist()` (可選) — 適用 whisper，將 `jobHistory` 寫入 `~/.recoder/jobs.json`，上限 50。App 啟動時呼叫 `_loadFromDisk()` 讀回。

#### 14.5 IPC Channel 命名與簽名（前端合約）
**每個新 JobManager 都必須**註冊以下 IPC（`<prefix>` 為類別前綴，如 `llm` / `transcribe` / `voiceprint`）：
```js
ipcMain.handle('<prefix>:jobSubmit', async (event, params) =>
  ({ success: true, jobId: this.addJob(params).id }))

ipcMain.handle('<prefix>:jobStatus', async (event, { jobId }) =>
  ({ success: true, job: this.getStatus(jobId) }))

ipcMain.handle('<prefix>:jobList', async () =>
  ({ success: true, jobs: this.listJobs() }))

ipcMain.handle('<prefix>:jobCancel', async (event, { jobId }) =>
  ({ success: true, cancelled: this.cancelJob(jobId) }))

ipcMain.handle('<prefix>:jobDelete', async (event, { jobId }) =>
  ({ success: true, deleted: this.deleteJob(jobId) }))
```

**推送事件**（renderer 在 preload 訂閱）：
```
event '<prefix>:jobUpdate'  → JobObject
```

例外：whisper 為向後相容使用 '<prefix>:event' （runWhisper 舊路徑仍受端畫使用）。新 JobManager 一律推薦 `jobUpdate` 命名。

#### 14.6 持久化規範
- **預設不需要**：記憶體即可，重啟後 pending/running 會丟失（可接受）。
- **長任務例外**（≥ 30 分鐘任務）：建議沿用 whisper 的 JSON 模式：
  - 檔案位置：`~/.recoder/jobs.json`（OS homedir 以下）
  - 上限：保留最近 50 筆。
  - 儲存時機：`_sendUpdate` 後呼呾 `_persist()`。
  - 讀取時機：App `ready` 後呼叫 `_loadFromDisk()`，把歷史 list 填入 `jobHistory`。
  - **schema**：可直接存列化為 JSON。陣列中 `params / result / log` 可能很大，建議只存最後 5 筆的 log。

#### 14.7 preload.js 暴露規範
每個新 JobManager 需在 `frontend/electron/preload.js` 加入：
```js
xxxJobSubmit: (params) => ipcRenderer.invoke('<prefix>:jobSubmit', params),
xxxJobStatus: (p) => ipcRenderer.invoke('<prefix>:jobStatus', p),
xxxJobList: () => ipcRenderer.invoke('<prefix>:jobList'),
xxxJobCancel: (p) => ipcRenderer.invoke('<prefix>:jobCancel', p),
xxxJobDelete: (p) => ipcRenderer.invoke('<prefix>:jobDelete', p),
onXxxJobUpdate: (cb) => {
  const h = (event, data) => cb(data)
  ipcRenderer.on('<prefix>:jobUpdate', h)
  return () => ipcRenderer.removeListener('<prefix>:jobUpdate', h)
},
```

#### 14.8 UI 與 i18n 規範
- **`frontend/src/App.vue`**：
  - data 新增 `xxxJobList: []`，在 `mounted` 初始 load 一次。
  - 訂閱 `window.electronAPI.onXxxJobUpdate(...)` 更新 `xxxJobList`。
  - 計算屬性 `totalInFlightJobs` 累加所有類別的 pending+running。
  - Jobs 面板（参§13）新增 `<emoji> <類型>` tab，顯示該 list。
  - 未來有任何 action 按鈕（Stop / Show Log / Delete）必額走 refresh 別 list，以免狀態不一致。
- **三語 i18n** — 在 `frontend/src/i18n/{zh-TW,en,ja}.js` 新增：
  - `jobs.type.<type>` — 例：`jobs.type.optimize` = '✨ 語句優化'
  - `jobs.status.<status>` — 例：`jobs.status.running` = '🟡 執行中'
  - `jobs.action.{stop|showLog|delete|clearAll|refresh|close}`
  - `jobs.tab.<類型>` / `jobs.panelTitle`
- **不允許**使用 hard-code emoji + 中文字串在 App.vue；所有顯示文字都須走 i18n key。

### 15. v1.21.0 新增 — 半監督式 speaker propagation

> **定位**：本節是 v1.21.0 帶來的**使用者介入式**說話者標註功能。涵蓋原則、演算法、UI 互動、IPC 契約。

#### 15.1 背景與需求
- 無監督聚類（v1.20.2 的 `diarizeAudio`）在短語句（< 1.5s）依賴中位數 cosine 推斷，但實務上幾乎一定會將差異極大的 speaker 推入同一 group（v1.20.6 root cause）。
- 「同句重覆」**不能**提升辨識率 — campplus x-vector 學的是「發聲人特徵」，非語意內容；多個同樣句子的 embedding 全部都極相似，並無新資訊。
- **可提升品質的正確作法**：讓使用者**明示標註幾句是誰** → 系統用這些 seeds 的平均 embedding 作為 centroid，再比對其它未標段。

#### 15.2 演算法
- 輸入：`audioPath` 、 `segments` (Array<{start, end, text, speaker}> )、 `seeds` (Array<{idx, name}> )、 `threshold` (default 0.5)
- 階段 1：抽取所有 segments 的 192-dim x-vector embedding (reuse `_extractAllEmbeddings`)
- 階段 2：對每個 seed 取其 segment 的 embedding → 同 speaker 全部取 L2-normalize 平均成 centroid
- 階段 3：對每個未標 segment：
  - 計算與每個 centroid 的 cosine similarity
  - 取最高者，若 ≥ `threshold` → 標為該 name；否則留空
- 階段 4：保留所有使用者原 seeds（不覆寫）；未被標到的 segment 以前後 speaker 填補

#### 15.3 演算法關鍵常數（對齊 voiceprint.js）
- `PROPAGATE_MIN_THRESHOLD = 0.5`：低於此 cosine 視為不確定
- seed embedding 必須在 `_extractAllEmbeddings` 內至少有一個有效樣本（numFrames ≥ 3）
- 整個過程仍可吃長音檔切片 (60min/chunk) 與長度過短 padding (±0.5s) 機制

#### 15.4 IPC 契約
- 與 `voiceprint:diarize` 拆分，這是**同步**接口（預期 5-15s 完成）：
  ```js
  ipcMain.handle('voiceprint:propagate', async (event, { audioPath, segments, seeds, threshold }) => {
    const result = await voiceprint.propagateSpeakers(audioPath, segments, seeds, { threshold })
    return { success: true, segments: result }
  })
  ```
- preload 暴露 `voiceprintPropagate: (params) => ipcRenderer.invoke('voiceprint:propagate', params)`
- **不另建 JobManager**：該操作本來就秒回，無必要過 queue；若量大，後續可加。

#### 15.5 共用 helper 重構
- 提取 `_extractAllEmbeddings(audioPath, segments, progressCallback)` — 計算嵌入 + 跨 chunk 拼接
- 提取 `_ensureModelLoaded()` — 模型磁碟存在 + 大小檢查 + InferenceSession 建立；供 `diarizeAudio` 與 `propagateSpeakers` 共用
- diarizeAudio 與 propagateSpeakers 改為 20-30 行高階函式，所有 PCM/fbank/embed 細節下沉至 helper

#### 15.6 前端 UI 互動
- 逐字稿列表中**每個 segment** 新增一顆「+👤」小按鈕（未標）或可點擊的 speaker-tag（已標）
- 點擊後彈出 **Speaker Editor Modal**（`showSpeakerEditor=true`）：輸入「講者名稱」→ 確定後寫入 `transcriptionResults[i].speaker` 與 `seedMap[i]`
- 控制列新增「🪄 依標註推算所有句子」按鈕（紫色 #7B1FA2）
- 點擊後彈出 **半監督式推算 Panel**：
  - 列出目前所有 seeds（idx、name、時間、原文 30字）
  - 可调門檻 slider 0.30 ~ 0.80（預設 0.5）
  - 「刪除單筆 seed」 、「清除所有標記」 、「依標註推算」 動作按鈕
- 推算完成後在逐字稿列表反映所有 segments.speaker；同樣手動點的 seed 不被覆寫

#### 15.7 與既有功能的關係
- 「🪄 半監督式推算」**不是取代**「👥 標註說話者」（v1.20.2） — 兩者並存：
  - `diarizeAudio` （無監督）以**聚類**為主
  - `propagateSpeakers` （半監督）以**種子**為主
- 若使用者已透過 `diarizeAudio` 得到 Speaker_1/2 標註，也可手動將某句改成「張三」後用 propagate 將其餘張三聚到同一 group（但實際上現有實作不支援既有 speaker name 反推 — 需後續增強）。
- v1.21.0 為初始版本，僅支援「手動標 seeds → 推算」一個流程，後續可加：
  - 跨錄音 speaker profile 持久化
  - 「以現有 diarize 結果為半監督 seeds」一鍵轉換
  - 自動偵測短句子作為「建議 seeds」提示使用者快速確認

#### 15.8 v1.21.4 強化 — Trimmed Mean Centroid 與 Outlier Rejection

**回應使用者提問**：「針對短語句無法辨識區分說話人員，是否可以採用重覆複製同一句話來提高人員辨識？」

**結論**：**可以提升，但有條件**。`campplus` x-vector 學的是「發聲人特徵」非語意內容：
- **同句重覆** 拉偏 centroid（多個同樣句子的 embedding 高度相似，並無新資訊）
- **無關句子**（背景音、咳嗽、打字聲）拉偏 centroid（內含非語音成分）
- 3–5 個 **不同發音內容** 的句子是甜蜜點；10+ 個 seeds 邊際效益遞減

**演算法升級**（`propagateSpeakers()`）：

```js
// 步驟 1：計算每個 seed 的「內部一致性」— 與其他 seed 的平均 cosine similarity
const avgSimPerEmb = embs.map((e, i) => {
  let s = 0, c = 0
  for (let j = 0; j < embs.length; j++) {
    if (i === j) continue
    s += cosineSimilarity(e, embs[j])
    c++
  }
  return c > 0 ? s / c : 1
})

// 步驟 2：內部一致性 1.0 = 所有 seed 完全一致 = 全是同一人同句重覆
//         內部一致性 0.3 = seeds 互不一致 = 有人混了其他聲音
const internalCoherence = ssum / embs.length

// 步驟 3：≥3 seeds 時去掉最高/最低各 ⌊n/4⌋ 個 outliers（最多各 1 個）
const dropN = Math.min(1, Math.floor(seedCount / 4))
const sorted = avgSimPerEmb.map((s, i) => ({ s, i })).sort((a, b) => a.s - b.s)
const dropSet = new Set([
  ...sorted.slice(0, dropN).map(x => x.i),    // 最低（背景音/咳嗽）
  ...sorted.slice(-dropN).map(x => x.i)       // 最高（同句重覆）
])
const used = embs.filter((_, i) => !dropSet.has(i))

// 步驟 4：用剩餘 seeds 的 mean 作為 centroid
const avg = new Float32Array(dim)
for (const e of used) for (let i = 0; i < dim; i++) avg[i] += e[i]
// L2-normalize
```

**特殊情況降級**：
- 1–2 個 seeds → simple mean（不裁切，避免過度裁切）
- 3 個 seeds → 最多去掉 1 個 outlier
- ≥4 個 seeds → 上下各 1 個 outlier
- ≤2 個 outliers 從未被裁切（最多扣 2 個）

**centroidInfo 資料結構**（供 UI 顯示）：
```js
{
  seedCount: 5,            // 原始 seeds 數量
  usedCount: 3,            // 實際用於 centroid 的 seeds 數量
  droppedCount: 2,         // 被裁掉的 outliers 數量
  internalCoherence: 0.78  // 0~1，越高表示 seeds 一致性越高
}
```

**UI 建議**：
- 顯示 `internalCoherence` 在推算 panel 上
- `> 0.7` = seeds 品質好（綠色）
- `0.5~0.7` = 可接受（黃色）
- `< 0.5` = 建議重選 seeds（紅色）

**v1.21.4 對同句重覆 / 無關句子的處理**：
- 同句重覆：所有 seed 的 pairwise cosine 接近 1.0（高度相似）→ 排序後落於「最高」分組 → 被裁掉 1 個 → 剩餘 seeds 表現等同「多句不同發音」
- 無關句子（背景音）：embedding 偏離其他同 speaker 的 seed → pairwise cosine 低 → 排序後落於「最低」分組 → 被裁掉 1 個
- 兩種 outlier 同時存在時，trimmed mean 可一次解決

#### 14.9 三個實作參考實例（他見什麼是合格、什麼是例外）
| JobManager | 引入 | 主要用途 | 持久化 | IPC channel 前綴 |
|---|---|---|---|---|
| LlmJobManager | v1.14.0 | optimize / translate / summary / aiQuery | 無（記憶體） | `llm:` |
| WhisperJobManager | v1.19.0 | 音檔轉譯（支援 chunk） | ✅ `~/.recoder/jobs.json` | `transcribe:` |
| VoiceprintJobManager | v1.20.2 | 說話者標註 | 無（記憶體） | `voiceprint:` |

未來新增類型（例如 JJB 混合/拼接/揮入 vMix）必額參照上表 + 本節全部子節。

### 16. v1.22.0 新增 — 多模型 Speaker Embedding 架構（MODEL_REGISTRY factory pattern）
**為解決問題**：原 v1.20.2 架構只能有一個聲紋模型（camplus），所有相關邏輯（download / load / diarize / propagate）以 hard-code 互連，使用者要換模型（如 ECAPA-TDNN、ResNet-SE）必須修改原始碼；同時 v1.21.0 限定使用者只能標記已有語者、不能讓使用者選用不同架構的 embedding 模型。

#### 16.1 MODEL_REGISTRY 設計
- **單一真相來源**：`voiceprint.js` 頂端定義 `MODEL_REGISTRY` 物件，記錄所有支援模型的 metadata。
- **語意架構**：每個 entry 含 `key`（唯一識別）/ `url`（下載來源，可空）/ `filename` / `minSize` / `dim`（輸出向量維度）/ `fbankConfig`（FBank 參數）/ `inputName` / `outputName`（ONNX 張量名，可空，載入時動態探查）/ `defaultModel`（是否預設啟用）/ `descriptionKey`（i18n key）。
- **現有 models**：
  - 🏆 `camplus`：192-dim x-vector，預設啟用，HF URL 有效可自動下載
  - `ecapa_tdnn`：192-dim，架構類似 TDNN + attentive stats pooling，url 為空（需手動 ONNX 匯入）
  - `resnet_se`：512-dim，ResNet + SE block，url 為空（需手動 ONNX 匯入）
- **設計原因**：以物件映射方式記錄所有型號相關參數，使下游 `diarize / propagate / loadModel` 都以 `modelKey` 路由，無需判斷 if-else 分支。
- **未來擴充**：新增 embedding 架構只需在 REGISTRY 加一筆 entry + 下載 URL + 匯入驗證。不需動到 main.js、App.vue。

#### 16.2 動態 ONNX session 管理
- `loadModel(modelKey)` 呼叫 ort.InferenceSession.create() 之前先釋放舊 session：`if (currentSession) { await currentSession.release(); currentSession = null; }`
- `inputName` / `outputName` 動態探查：ONNX 載入後讀 `session.inputNames[0]` / `session.outputNames[0]` 作為後續 inference 使用的 input/output key。避免被 dead code 警告標記，並保持「不同模型的 input/output 名稱不同」的可撗性。
- **`_ensureModelLoaded(modelKey)` 參數化**：在 diarize / propagate 進場時都以 `modelKey` 呼叫，後端明以 modelKey 為「現在需要哪個 embedding 模型」的唯一重現。

#### 16.3 檔案名稱隔離（避免不同模型互相覆蓋）
- **現實問題**：camplus 原本下載到 `~/recoder/voiceprint/camplus_cn_en_common_200k.onnx`。若 ecapa_tdnn 同名下載就會覆蓋。
- **設計**：以 `modelKey` 為路徑前綴，例如 `voiceprint/ecapa_tdnn/model.onnx`、`voiceprint/resnet_se/model.onnx`，camplus 仍保持原本路徑提供向下相容。
- **isModelCached(modelKey)** 動態检查各 modelKey 對應的快取檔案是否存在 + 大小是否超過 minSize。

#### 16.4 UI 設計原則
- **設定面板「👥 聲紋模型管理」區塊**：類比 v1.13.0 後 Whisper 模型管理的 UI 模式，列出每個模型的：
  - 狀態（✅ 已下載 / ⬇️ 可下載 / 📦 需手動匯入）
  - dim 標註（192-dim / 512-dim）
  - descriptionKey i18n 描述文字
  - 動作按鈕：下載（僅有 url 的型號才顯示）、匯入（`voiceprintOpenImportDialog` 檔案選擇）、設為預設（僅已下載且非現在預設才顯示）
  - 預設徽章：當 `m.key === currentVoiceprintModel` 時顯示「🟣 使用中」
- **紫色 `#7B1FA2`** 主題色與 v1.21.0 推算 panel 呼應，視覺上「聲紋相關」以紫色統一。

#### 16.5 IPC 契約
| Channel | 方向 | Payload | 回傳 | 用途 |
|---|---|---|---|---|
| `voiceprint:listModels` | renderer→main | 無 | `{ models, currentModel }` | 列出 REGISTRY + 快取狀態 + 現在預設 |
| `voiceprint:download` | renderer→main | `{ modelKey }` | `{ success, path? , error? }` | 下載指定模型 |
| `voiceprint:importModel` | renderer→main | `{ sourcePath, modelKey }` | `{ success, path? }` | 從本地 .onnx 匯入到指定 modelKey 路徑 |
| `voiceprint:setActiveModel` | renderer→main | `{ modelKey }` | `{ success, modelKey }` | 切換現在預設 embedding 模型 |
| `voiceprint:openImportDialog` | renderer→main | 無 | `{ success, path? , canceled? }` | 開啟檔案選擇 dialog 過濾 .onnx |
| `voiceprint:getCurrentModel` | renderer→main | 無 | `{ modelKey }` | 查詢現在預設 |

#### 16.6 設計決策與本上錯
- **為什麼 ecapa_tdnn/resnet_se url 為空？** HF、ModelScope、speechbrain 3 個平台的官方 ONNX 鏡像都回 401（需登入）或 404（已下架）。camplus 是 welcomyou/3dspeaker project 提供的公開 ONNX，是唯一在公開平台可下載的型號。
- **手動匯入是什麼？** 使用者若有自己的 .onnx（符合「輸入是 fbank features / 輸出是 1D embedding」schema），可點「📥 匯入」並選本機檔，後端會拷貝到 `voiceprint/<modelKey>/model.onnx` 並儲存快取。
- **為什麼 modelKey 儲存為 `state.voiceprint.currentModel`，不重新 hard-code？** 提供向下相容：舊客戶端就算不跳過這個 IPC 也會以 `camplus` 為 default 運行（`_ensureModelLoaded` 勍 codepath default）。

#### 16.7 未來 Roadmap
- **自動選擇模型**：`recommendVoiceprintModel()` 以音檔平均長度 / 句數推論合適模型。App.vue 已有 prototype、僅返 model key 字串，後期可作為「快速賦予預設」按鈕。
- **模型下載重試**：當某個 modelKey 的 ONNX 下載失敗（例如 URL 移除 / network 問題），可提示使用者改用手動匯入。
- **多架構熱切換**：同一個音檔可依使用者選擇不同 embedding 模型推算多次，輸出 A/B 比較結果。

#### 16.8 v1.22.1 — ResNet-SE 補上可下載 URL (WeSpeaker 官方 ONNX)
**v1.22.0 留下的唯一限制**：resnet_se 為「實驗性，需手動匯入」。2026-07-02 進一步研究 HuggingFace 後發現 **WeSpeaker 官方開源 ONNX** 公開且可下載，本次 release 補上。

**採用的模型**：
- **`Wespeaker/wespeaker-cnceleb-resnet34-LM`** — WeSpeaker 官方 PyAnnote 改版，中文 CN-Celeb 訓練，26.5 MB，256-dim
  - License：CC-BY-4.0
  - 下載 URL：`https://huggingface.co/Wespeaker/wespeaker-cnceleb-resnet34-LM/resolve/main/cnceleb_resnet34_LM.onnx`
- ONNX 張量介面：`feats` (1, T, 80) → `embs` (1, 256) — **與 campplus 完全相同**
  - 可直接套用現有 `computeFbank()` pipeline (80-dim @ 16kHz)，不需改 fbank 邏輯

**研究過程**：
- HF API `https://huggingface.co/api/models?search=wespeaker-resnet` 取得 30+ 個候選
- 用 `curl -L` 實際下載驗證：Wespeaker 系列 4 個模型都回 HTTP 200
- 過濾項目：
  - ⏬ 有 ONNX (排除 PyTorch 原生模型)
  - ✅ 公開可下載 (排除 modelId 為 `pyannote/...` 的衍生，因需要同意授權)
  - ✅ 與 campplus fbank 介面相容 (Wespeaker 預設 80-bin @ 16kHz)
  - ✅ 包含中文訓練資料 (CN-Celeb)

**最終選用 Wespeaker-cnceleb** 原因：
- 與 campplus 同樣以中文為重 (CN-Celeb dataset)
- 256-dim 比 campplus 192-dim 多一點語者特徵豐富度
- 26.5 MB 檔案大小適中 (不用像 ResNet293 114 MB)
- 2.5–3 倍語者數據 (中文) → 中文短句辨識可能比 campplus 更精確

**MODEL_REGISTRY 更新內容**：
```js
resnet_se: {
  key: 'resnet_se',
  label: 'resnet_se',
  url: 'https://huggingface.co/Wespeaker/wespeaker-cnceleb-resnet34-LM/resolve/main/cnceleb_resnet34_LM.onnx',
  filename: 'cnceleb_resnet34_LM.onnx',
  minSize: 25 * 1024 * 1024,
  dim: 256,                    // 從 512 改為 256
  fbankConfig: { numBins: 80, ... },
  inputName: 'feats',          // 從 null 改為 'feats'
  outputName: 'embs',          // 從 null 改為 'embs'
  ...
}
```

**進階選項**（仍手動匯入）：
- `Wespeaker/wespeaker-voxceleb-resnet293-LM` (114 MB, 256-dim, 英文 VoxCeleb) — 大模型
- `Wespeaker/wespeaker-voxceleb-resnet34-LM` (26.5 MB, 256-dim, 英文 VoxCeleb) — 同 cnceleb 大小，但純英文

**驗證步驟**：
1. `curl -L -o cnceleb_resnet34.onnx <URL>` → HTTP 200, 26,530,309 bytes
2. onnxruntime-node `InferenceSession.create()` 成功
3. 跑 fake fbank forward (1, 200, 80) → output (1, 256) 成功
4. 確認 input/output 張量名 = ['feats', 'embs'] (與 campplus 完全相容)

**效果**：
- 原本「需手動匯入」的 ResNet-SE 現在與 camplus 並列，使用者在設定面板點「下載」就能自動取得
- ECAPA-TDNN 仍維持手動匯入（其 fbank 介面是 mean+std normalization，與 campplus 用的 CMVN 不同；套用會產生錯誤結果。需獨立 pipeline。）

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
- **模型**：`campplus-zh-en.onnx`（~50MB，200k 說話者訓練，支援中英日，Apache-2.0）；v1.22.0 起支援多模型架構 MODEL_REGISTRY（camplus / ecapa_tdnn / resnet_se）
- **推理引擎**：`onnxruntime-node` 1.27.0。**v1.23.6 起** Execution Provider 改為參數化：`useGpu=true` 時 EP 陣列 `['dml', 'cpu']` 優先嘗試 DirectML（Vulkan 後端），失敗自動 fallback CPU；`useGpu=false` 時直接 `['cpu']`。
- **特徵抽取**：80-dim fbank + CMVN（純 JS 實作，無 Python 依賴）
- **分群演算法**：Cosine similarity + 貪婪聚類（threshold=0.6）
- **音檔切割**：ffmpeg 依 segment 時間區間切割為獨立 WAV
- **處理流程**：
  ```
  segments → ffmpeg 切割每個 segment 的 PCM
          → 80-dim fbank 特徵抽取
          → ONNX Runtime 抽取 192 維 embedding (EP: dml 或 cpu)
          → Cosine similarity 計算相鄰段落相似度
          → 貪婪聚類分群
          → 標註 Speaker_1, Speaker_2, ...
          → 寫入 segments[].speaker
  ```
- **後端 IPC**（v1.23.6 起所有 IPC 都接受 useGpu 參數）：
  - `voiceprint:status` — 檢查模型是否已下載，回傳 `{ cached, models, currentModel, provider }`（`provider` 為 `'dml'` 或 `'cpu'`，v1.23.6 新增）
  - `voiceprint:download` — 下載聲紋模型（含進度推送），`{ modelKey, useGpu }` → 下載後自動 `setActiveModel(modelKey, useGpu)`
  - `voiceprint:diarize` — 執行說話者標註（含進度推送），`{ audioPath, segments, useGpu }`
  - `voiceprint:propagate` — 半監督式標註（v1.21.0），`{ audioPath, segments, seeds, threshold, useGpu }` (useGpu 在 options.useGpu)
  - `voiceprint:identifySpeakers` — 監督式識別（v1.23.0），`{ audioPath, segments, modelKey, threshold, useGpu }`
  - `voiceprint:backfillAll` — 批次回溯（v1.23.0），`{ modelKey, threshold, useGpu }`
  - `voiceprint:jobSubmit` — 背景 Job 提交（v1.20.2），`{ audioPath, segments, recordingId, useGpu }`
  - `voiceprint:profileList / Save / Rename / Delete / Stats / BuildFromSeeds / BuildFromAudioFile` — Profile Database CRUD（v1.23.0）
  - `voiceprint:listModels / importModel / setActiveModel / openImportDialog / getCurrentModel` — 多模型管理（v1.22.0）
- **前端 UI**：
  - LLM 動作列新增「👥 標註說話者」按鈕（橙色 #FF5722）
  - 首次使用提示下載模型（~50MB）
  - 處理中顯示進度百分比
  - 完成後逐字稿每句顯示 Speaker 標籤
- **GPU 加速（v1.23.6）**：直接拿設定面板的 `useGpu` flag 傳給所有 voiceprint 操作。`onnxruntime-node` 1.27.0 唯一原生支援的 GPU EP 是 DirectML（DML），在 Windows 11 + WDDM 2.9+ 驅動下會自動透過 Vulkan API 轉譯 GPU 運算。與 whisper.cpp 的 Vulkan 加速路徑同源。失敗自動 fallback CPU（v1.20.12 記錄的 campplus AveragePool 拋 80070057 不會阻斷使用）。使用者可從 `voiceprint:status` 的 `provider` 欄位看到當前 session 實際使用的 EP。

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

## 17. Speaker Profile Database（v1.23.0）

### 設計動機
- v1.21.0 半監督式 propagation 對短句（< 3s）辨識率不足，需要在同一錄音內重複出現同一人的多個句子才能建立可靠 centroid。
- 使用者提出「重覆複製同一句話」可作為訓練樣本的需求。
- 需要跨錄音、跨時段反覆使用的持久化 speaker reference。

### 設計原則
- **持久化 JSON**：存於 ~/recoder/speaker_profiles.json，按 modelKey 分組避免不同 embedding 維度混淆。
- **跨模型支援**：每個 profile 必須標註 modelKey (camplus / ecapa_tdnn / resnet_se)；identify 階段只能用同 modelKey 的 profile。
- **資料上限**：MAX_PROFILES = 200，避免無限制增長。
- **不加密**：與其他本地資料（reco_data）一致，僅本機存取。

### 核心流程
1. **buildProfile(audioPath, segments, seeds, modelKey)**
   - 從使用者標註的 seed segments 擷取對應音檔
   - 對每段提取 embedding（依 modelKey 呼叫對應 ONNX）
   - 計算 trimmed mean centroid（v1.21.4 算法）
   - 計算 internalCoherence（移除 outliers 後的平均 pairwise cosine）
   - 持久化至 speaker_profiles.json
2. **buildProfileFromAudioFile(audioPath, name, modelKey)**
   - 從獨立短音檔建立（無需既有轉寫稿）
   - 該音檔可包含一人多句或一人一句重複錄音
3. **identifySpeakers(audioPath, segments, profiles)**
   - 提取整段音檔所有 segment embedding
   - 對每個 profile centroid 計算 cosine similarity
   - 標記最佳匹配（無論相似度高低都標記，便於人工 review）
4. **backfillAll(profiles)**
   - 掃描所有歷史錄音
   - 逐一呼叫 identifySpeakers
   - 透過 onVoiceprintBackfillProgress 事件回報進度
   - 自動儲存更新後的 segments

### 與 v1.21.0 半監督式的取捨
- v1.21.0 適合「快速標註單一錄音」，門檻低但不持久
- v1.23.0 適合「建立常用講者庫」，門檻高（需要先建立 profile）但效果穩定
- 兩者並存：使用者可先用 v1.21.0 propagation 快速標註，再針對重要講者用 v1.23.0 建立 profile 並 backfill

### 介面規範
- **3 個新按鈕**（LLM bar）：
  - 👤 Create Profile（綠色 #00897B）：開啟 Speaker Database panel
  - 🎯 Identify Speakers（粉色 #D81B60）：對當前錄音做 supervised 識別
  - 🔄 Apply to All History（紫色 #5E35B1）：批次回溯標註
- **Speaker Database panel**：560px 寬 modal，列出所有 profile，顯示名稱、modelKey 標籤、樣本數、coherence %，可重新命名/刪除
- **progress 顯示**：backfill 進行中時 status bar 顯示 Backfilling 3/15

### 已知限制
- profile 必須與其 modelKey 一致使用；切換 model 後舊 profile 不可用
- 短音檔建立 profile 時若 < 1.5s 可能 centroid 不穩定（顯示低 coherence 提示使用者重做）
- 跨資料夾 backfill 不自動限速，可能 CPU 短時間高負載

## 18. v1.23.6 新增 — 聲紋 GPU/DirectML (Vulkan) 加速架構

### 動機與現狀
- v1.20.2 首次實作聲紋說話者標註時，`onnxruntime-node` 在 Windows 下唯一可用的 GPU EP 是 DirectML (DML)。
- 但 v1.20.6–v1.23.5 期間 `voiceprint.js` 的 `loadModel()` 函式 `executionProviders` 寫死為 `['cpu']`，GPU 加速實際上從未走過。
- 設定面板的「啟用 GPU」勾選雖然會把 `useGpu` 寫入 settings，但 `App.vue` 從未把這個 flag 傳給 voiceprint 操作，造成「勾了沒用」的體驗。
- v1.23.6 修正這個一致性问题：把 `useGpu` 串流從前端到後端到 ONNX InferenceSession EP 選擇全線打通。

### 架構總覽

```
Settings UI (useGpu checkbox)
       ↓ this.useGpu
App.vue voiceprintDownload() / jobSubmit() / propagate() / identify() / backfill()
       ↓ useGpu: this.useGpu
main.js voiceprint:* IPC handler (7 個加 useGpu 參數)
       ↓ useGpu
voiceprintJobManager.addJob({useGpu}) / _executeJob(...)
       ↓ useGpu
voiceprint.js loadModel(modelKey, useGpu)
       ↓ useGpu
ort.InferenceSession.create(mp, { executionProviders: useGpu ? ['dml', 'cpu'] : ['cpu'] })
       ↓ GPU
DirectML (DML) → Vulkan API → WDDM 2.9+ driver → GPU
       ↓ CPU (fallback)
onnxruntime CPU EP
```

### 函數簽名變更

`voiceprint.js`：
| 函式 | 變更 |
|---|---|
| `loadModel(modelKey, useGpu=false)` | 改為接受 `useGpu` 參數，動態決定 EP 陣列；新增 `_lastLoadProvider` / `_lastLoadUseGpu` cache 變數 |
| `setActiveModel(modelKey, useGpu=false)` | 改為接受 `useGpu`，轉傳給 `loadModel` |
| `_ensureModelLoaded(modelKey, useGpu=false)` | 改為接受 `useGpu`，轉傳給 `loadModel` |
| `diarizeAudio(audioPath, segments, progressCb, useGpu=false)` | 改為接受 `useGpu`，轉傳給 `_ensureModelLoaded` |
| `propagateSpeakers(audioPath, segments, seeds, options={useGpu, threshold})` | 改為從 `options.useGpu` 讀取 |
| `identifySpeakers(audioPath, segments, profiles, options={useGpu, threshold})` | 改為從 `options.useGpu` 讀取 |
| `buildProfile(audioPath, segments, seeds, modelKey, useGpu=false)` | 改為接受 `useGpu` |
| `buildProfileFromAudioFile(audioPath, name, modelKey, useGpu=false)` | 改為接受 `useGpu` |
| `getCurrentProvider()` | **新增** — 對外讀取當前 session 實際使用的 EP (`'dml'` / `'cpu'`) |

`module.exports`：
- 新增 `getCurrentProvider`

### EP 選擇策略（loadModel 內部）

```js
const providers = useGpu ? ['dml', 'cpu'] : ['cpu']
let newSession = null, usedProvider = null, lastErr = null
for (const ep of providers) {
  try {
    newSession = await ort.InferenceSession.create(mp, {
      executionProviders: [ep],
      graphOptimizationLevel: 'all',
    })
    usedProvider = ep
    break
  } catch (e) {
    lastErr = e
    console.warn(`[voiceprint] loadModel(${modelKey}) 嘗試 EP '${ep}' 失敗: ${e.message}${ep === 'dml' ? ' — 將 fallback CPU' : ''}`)
    if (ep === 'cpu') throw e  // CPU 也失敗就放棄
  }
}
```

### IPC 契約變更

| Channel | Payload 變更 |
|---|---|
| `voiceprint:status` | 無變更 payload；回傳新增 `provider` 欄位 |
| `voiceprint:download` | 新增 `useGpu?: boolean`；下載後 `setActiveModel(modelKey, useGpu)` |
| `voiceprint:diarize` | 新增 `useGpu?: boolean` |
| `voiceprint:propagate` | 新增 `useGpu?: boolean` (傳入 `options.useGpu`) |
| `voiceprint:identifySpeakers` | 新增 `useGpu?: boolean` |
| `voiceprint:backfillAll` | 新增 `useGpu?: boolean` |
| `voiceprint:jobSubmit` | 新增 `useGpu?: boolean` |

### VoiceprintJobManager 變更

- `addJob({ ..., useGpu })` — 接受 useGpu 欄位並存入 job 物件
- `_executeJob(job)` — 從 `job.useGpu` 讀取並傳給 `voiceprint.diarizeAudio(..., useGpu)`
- 背景 diarize job 因此也會走 GPU 加速，與手動 submit 行為一致

### App.vue 變更

5 個 voiceprint 操作呼叫點都帶 `useGpu: this.useGpu`：
```js
await window.electronAPI.voiceprintDownload({ modelKey, useGpu: this.useGpu })
await window.electronAPI.voiceprintJobSubmit({ audioPath, segments, recordingId, useGpu: this.useGpu })
await window.electronAPI.voiceprintPropagate({ audioPath, segments, seeds, threshold, useGpu: this.useGpu })
await window.electronAPI.voiceprintIdentifySpeakers({ audioPath, segments, profiles: ..., useGpu: this.useGpu })
await window.electronAPI.voiceprintBackfillAll({ profiles: ..., useGpu: this.useGpu })
```

`preload.js` 不用改 — payload pass-through 已正確。

### DirectML vs CUDA vs WebGPU

- **DirectML (DML)**：onnxruntime-node 1.27.0 在 Windows 下唯一原生支援的 GPU EP。在 Windows 11 + WDDM 2.9+ 驅動下會自動透過 **Vulkan API** 轉譯 GPU 運算。**不需 CUDA toolkit 或 NVIDIA 顯卡**，AMD RX / Intel Arc / NVIDIA 全系列都能用。
- **CUDA**：onnxruntime-node 不支援（需要 nvidia/cuda-onnxruntime 特殊 build）。Recorder 不走這條。
- **WebGPU**：onnxruntime-node 不支援（WebGPU 是瀏覽器端的 EP，Node.js side 沒有）。Recorder 不走這條。
- **ROCm / OpenCL**：onnxruntime-node 也不支援。DirectML 是唯一選項。

### 失敗自動 fallback 行為

- DML 失敗時（例如 v1.20.12 記錄的 campplus ONNX AveragePool 算子拋 `80070057 參數錯誤`），`loadModel()` 自動 retry CPU 端。
- 整體 diarize / propagate / identify 不會因此失敗，只會跑得稍慢。
- `getCurrentProvider()` 回傳 `'cpu'` 表示實際走了 fallback 路徑。
- 使用者可從 recorder.log (`recorder.log` 在 `~/.recoder/`) 看到 `[voiceprint] loadModel(camplus) 嘗試 EP 'dml' 失敗: ... — 將 fallback CPU` 警告。

### 設計決策紀錄

- **為什麼不做 ONNX Runtime EP priority 全開（`['cuda', 'dml', 'cpu']`）？** 因為 onnxruntime-node 1.27.0 build 不含 CUDA support，列出 cuda EP 會導致不必要的 `EP_NOT_FOUND` 警告日誌。只列 `['dml', 'cpu']` 兩個候選即可。
- **為什麼不寫成「總是用 DML 失敗就 throw」？** 因為部分使用者環境的 DML 驅動可能在邊緣狀態（例如 VDD 重啟後、顯卡被其它程式佔用）。提供 fallback 提升使用體驗。
- **為什麼在 loadModel 內部控制 EP 選擇？** 讓 `useGpu` 變成「語意 flag」而非「EP 字串」，未來若 onnxruntime-node 新增其它 EP（如 DirectX 12、WebGPU Node binding）只需改 loadModel 內部幾行，不需改 API 契約。
- **為什麼 cache key 包含 `_lastLoadUseGpu`？** 因為 ONNX InferenceSession 不能同時存在兩個（不同 EP 會 conflict）。當使用者切換 useGpu 時需要重新載入。cache key 確保下次 `useGpu` 變動時 force reload。

### 與 whisper Vulkan 加速的關係

whisper-cli.exe 的 Vulkan 加速路徑是 **whisper.cpp 內建的 ggml-vulkan backend**，透過 `ggml-vulkan.dll` 直接呼叫 Vulkan API。
voiceprint 的 DML 加速路徑是 **onnxruntime-node 透過 DML 內部呼叫 Vulkan API**。
兩者最終都走 Vulkan → WDDM → GPU 驅動，但 API 進入點不同（whisper 自帶、voiceprint 透過 DML）。**理論上若 GPU 驅動有問題，兩個會一起出問題；好的話兩個都受惠。**

### 與 v1.20.12 / v1.20.13 的關係

- v1.20.12 記錄：「DML GPU AveragePool 算子與 campplus 模型不相容，抛 80070057」
- v1.20.13 暫時解法：把 executionProviders 改為 `['cpu']` 完全避開
- v1.23.6 改進：改為 `['dml', 'cpu']` 嘗試 DML，失敗自動 fallback。雖然 AveragePool 80070057 仍可能發生（DML driver bug），但至少 DML driver 更新 / 不同顯卡可能可成功。多數 AMD / Intel 內顯 + Windows 11 24H2+ 環境下 DML 跑 campplus 應該是 OK 的。

### 未來 Roadmap

- **`voiceprint:status` 顯示 `provider`**：UI 可在 speaker panel 旁顯示「目前使用 DML/Vulkan」徽章。
- **GPU device 選擇**：v1.20.6 whisper 已有 `gpuDevice` 設定，voiceprint 可參考。但 onnxruntime-node 的 DML EP 不直接支援 device 選擇（總是使用預設 GPU）。可考慮加入 `onnxruntime-node/dml-directml` 第三方程式庫。
- **多 GPU 支援**：DML 多卡環境下可加入 `deviceId` 參數（v1.0 onnxruntime-DirectML API 有，但 v1.27.0 預設不暴露）。
- **WebGPU 評估**：未來 onnxruntime-node 若新增 WebGPU backend（Node 20+ 已內建 WebGPU），可作為 WDDM 2.9 不滿足時的替代方案。

## 輸出限制
- **不要刪除舊有核心邏輯**：更新是「增量」或「修正」，除非新功能取代了舊功能，否則不可遺漏舊有的規範。
- **保持簡潔與具體**：寫出具體的技術與設計指導，避免空泛的形容詞。
- **高可讀性**：使用 Markdown 的標題、粗體、條列式，確保開發者能在 3 分鐘內讀完變更重點。
