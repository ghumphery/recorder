## [2026-06-30 13:50]
- **version**: 1.20.11 → 1.20.12 (patch: log 補充)
- **修改要求**: 使用者反映「在 辨識 的 job log 沒有看到 針對 音檔 長度的確認 和 過大檔的切割 log」。WhisperJobManager 在跑 _executeTranscribe 時雖然有 log，但全部集中在「切片後續動作」(已切成 N 個 chunks、切片 N/M 辨識中…)，把「為什麼這次要不要切片」的決策鏈（音檔時長檢查、是否超過門檻、走哪條路徑）全部省略了，造成 job log 看不到決策依據、看不到降級原因。
- **修改規劃**:
  - 僅動 `frontend/electron/main.js` 的 `WhisperJobManager._executeTranscribe(job)` (約第 1091–1125 行)，補上 4 條 `this._log(job, ...)`：
    1. 行 1105：`音檔時長檢查: Xs (門檻 3600s，設定 chunkMinutes=Z)` — 在 `getAudioDuration()` 之後、永遠輸出
    2. 行 1114：`決策: 不切片 (原因)` — 在 `if (!shouldChunk)` 區塊頂端，涵蓋 4 種原因：chunkMinutes≤0、時長≤0 (ffmpeg 解析失敗)、時長<門檻、其他不滿足條件
    3. 行 1116：`進入直接辨識路徑 (runWhisper)` — 在 `_runSingleTranscribe` 之前
    4. 行 1130：`已切換為直接辨識路徑 (runWhisper)` — 在 catch 區塊 `切片失敗，降級為直接辨識` 之後
  - 不動前端 Vue 元件、audioChunker.js、設定檔、IPC、UI 文案
  - 不新增 i18n 字串（log 是後端寫進 job.log，前端 logModalJob.modal 直接顯示）
  - `frontend/package.json` version 1.20.11 → 1.20.12 (patch)
- **修改結果**:
  - 透過 `node --check` 確認 `frontend/electron/main.js` 語法 OK
  - 透過 PowerShell `Select-String` 確認 4 條新 log 行號皆位於正確區段（1105 / 1114 / 1116 / 1130）
  - 不切片分支現在能看到完整決策鏈；降級分支現在能看出「先切片失敗 → 改直接辨識」
  - 既有切片成功路徑 log (長音檔 Xs >= Ys、已切成 N 個 chunks、切片 N/M 辨識中…) 行為不變
- **驗證方式**: 重啟 App 對一個 ≤60 分鐘的音檔按「開始辨識」，打開該 job 的 log modal，應能看到 4 條新 log 依序出現；對 ≥60 分鐘的音檔則既有切片 log 與新增的音檔時長檢查 log 依序出現
- **備份檔名**: 將於備份步驟產生

## [2026-06-30 13:41]
- **version**: 不升（純文件補充，無程式碼變動）
- **修改要求**: 為「未來新增任何類型 Job」建立統一設計契約，避免新增 LLM/Whisper/Voiceprint 之外的 JobManager 時各自發明欄位、IPC channel 與 UI 設計，並補足現有 Product_Design_Guidelines.md 在 Jobs 模組方面的規範缺口。
- **修改規劃**:
  - `Product_Design_Guidelines.md`：在「功能模組與業務邏輯」章節最前（§13 之前）新增 §14「跨模組非同步 Job 架構規範（Job Manager Pattern）— 未來 Job 製作契約」
    - 14.1 目標與設計哲學（不阻塞 UI / 單一 in-flight / 雙軌 IPC / 可恢復 / 可取消）
    - 14.2 Job 物件統一結構（id/type/status/params/progress/result/error/log/時間戳）
    - 14.3 狀態機（pending → running → completed/failed/cancelled，不允許跳過）
    - 14.4 JobManager 抽象介面表（addJob/processNext/cancelJob/getStatus/listJobs/deleteJob + cancelAll/clearHistory 選用）+ 私有 helper（_generateId/_log/_sendUpdate/_persist）
    - 14.5 IPC channel 命名與簽名（<prefix>:jobSubmit/jobStatus/jobList/jobCancel/jobDelete + <prefix>:jobUpdate 推送）
    - 14.6 持久化規範（預設無，≥ 30 分 Job 用 ~/.recoder/jobs.json，cap 50）
    - 14.7 preload.js 暴露規範
    - 14.8 UI 與 i18n 規範（App.vue data + i18n key 強制）
    - 14.9 三個實作參考實例表（LlmJobManager/WhisperJobManager/VoiceprintJobManager）
  - `Product_Design_Guidelines_en.md`：翻譯同步 §14（位置：§11 之前）
  - `Product_Design_Guidelines_ja.md`：翻譯同步 §14（位置：v1.20.7 章節之前）
- **修改結果**:
  - 三語 Product_Design_Guidelines*.md 完成 §14，作為未來任何新 JobManager 的設計與維運契約
  - 既有 §11 (WhisperJobManager)、§12 (whisper-cli greedy) 等歷史章節保持原貌未被移動
  - 無 JS / JSON / i18n 變動（純文件），故版本號不升
  - 預期效益：未來新增任何 type 的 job 時，可對照 §14 清單逐項驗證，避免 IPC 與狀態機再次各自實現
- **備份檔名**: backup-202606301341.zip

## [2026-06-30 12:37]
- **version**: 1.20.10 → 1.20.11 (patch: hotfix)
- **修改要求**: 使用者回報聲紋模型下載反覆失敗，日誌持續輸出「下載不完整 (只收到 28283928 bytes)；HuggingFace 是否連線失敗？請重試。」，每次下載完全相同的位元數。
- **根因分析**: v1.20.7 加入 `MIN_MODEL_SIZE = 40 * 1024 * 1024` (40 MB) 作為最低有效大小門檻，但實測 `https://huggingface.co/welcomyou/campplus-3dspeaker-200k-onnx/resolve/main/campplus_cn_en_common_200k.onnx` 的真實檔案大小 = **28,283,928 bytes (約 26.97 MB)**，永遠 < 40 MB 因此被誤判「不完整」。已用 PowerShell `Invoke-WebRequest` 與 `node-fetch` HEAD/GET 多重驗證：
  - `Content-Length: 28283928`
  - `Content-Type: application/octet-stream`
  - 前 16 bytes = `08-08-12-07-70-79-74-6F-72-63-68-1A-06-32-2E-31`，這是 protobuf ONNX magic (pytorch 2.10.0 exporter)，含 `xvector / head/conv1 / ReduceMean` 等完整節點，**並非 LFS pointer 也非錯誤頁**。
  - HF LFS UI 雖然顯示「~50 MB」，是 repo metadata + LFS pointer 的總體感受，實際 .onnx binary 只有約 27 MB。當前 `xet-bridge-us` 是 xet CAS 服務，這個 bridge 此時回傳 28.28 MB 是正常 forward 下游真實 binary。
- **影響**:
  - 使用者連按「下載」按鈕，實際下載是成功的（28 MB 寫入 .downloading → rename 到正式檔），但因為 28 MB < 40 MB，判斷式 reject，下載流程給前端回傳「下載失敗」。
  - 損壞 file 可能留 28 MB 內容（其實內容是合法的），導致 `isModelCached()` 在 28 MB 不再被 reject 之前永遠是 false。
- **修正方案**:
  - `frontend/electron/voiceprint.js`：
    1. `MIN_MODEL_SIZE` 從 `40 * 1024 * 1024` 改為 `25 * 1024 * 1024`（真實約 27 MB，留約 7% buffer，避免誤判合法檔）。
    2. 加註詳細註解說明根因：哪個 HTTP 回應、哪個檔頭、什麼 byte 內容。
    3. 更新 downloadModel 的 docstring 改用 `>= MIN_MODEL_SIZE`，避免未來魔術數字漂移。
- **驗證**:
  - 已用 PowerShell `Invoke-WebRequest -OutFile` 下載到 `c:\temp\voiceprint-test.onnx` 並驗證 hex header = 合法 ONNX magic。
  - `diarizeAudio()` 的 `loadModel()` 流程已自動套用新門檻（共用常數）。
  - `isModelCached()` 已共用同一門檻，快取命中邏輯保持一致。
- **注意**:
  - 若仍有使用者下載後報「無效 InferenceSession」，請改用 onnxruntime 1.27.0 + Node.js 20+ 確認 native binary 是否被 asar unpack（v1.20.3 已加 `node_modules/onnxruntime-node/**/*` 至 `asarUnpack`）。
- **備份檔名**: backup-202606301237.zip
# 修改日誌 (Modify Record)

## [2026-06-30 12:15]
- **version**: 1.20.10
- **修改要求**：原本 v1.20.7/v1.20.9 已實作聲紋長音檔切片與說話者辨識，但「聲紋辨識還是無法辨識」問題未完全解決：跨 chunk 邊界的 segment (例如 seg.start=2900/end=3100 落在 chunk0 0~3000 與 chunk1 3000~6000 之間) 在 v1.20.9 中會被指給 chunk0，並只讀取 [2900, 3000) 部分而漏掉 [3000, 3100) 段，導致 embedding 計算不準確，最終聚類失敗。
- **修改規劃**：
  - `frontend/electron/voiceprint.js`：
    1. 移除 `segmentToChunk` 單一映射函式
    2. 新增 `findChunksForSegment(seg)`：回傳該 segment 跨越的所有 chunk indices
    3. 重構 `diarizeAudio()` 主迴圈：對 useChunks=true 的 segment，依序從各 chunk 抽取 subPcm，最後 `Buffer.concat()` 拼接
    4. `useChunks=false` 時維持原 `extractSegmentPcm(audioPath, seg.start, seg.end, audioDuration)` 邏輯
  - `frontend/package.json`：version 1.20.9 → 1.20.10 (Patch)
- **修改結果**：
  - 跨 chunk 邊界的 segment (例如 2900~3100 跨 chunk0/chunk1) 現在會完整讀取 200 秒 PCM，embedding 計算準確，聚類更可靠
  - 維持 v1.20.9 的非同步 Job / GPU 自動降級 / 進度回報等所有功能
  - 沒有語意改變，只是修正了 chunk 邊界 segment 的 PCM 拼接邏輯
- **備份檔名**: backup-202606301215.zip

## [2026-06-30 12:00]
- **version**: 1.20.9
- **修改要求**：
  1. voice to text 將大於 ≥ 60 分鐘的音檔自動切成 ≤ 50 分鐘的 WAV chunks，各別進行 voice to text，使用非同步 job 進行
  2. 切片粒度可由系統設定調整（default 50 min/chunk，保留「不分段」選項）
- **修改規劃**：
  - `frontend/electron/audioChunker.js` (新檔)：共用音檔切片模組，提供 `getAudioDuration() / splitLongAudio() / chunkLongAudioIfNeeded() / cleanupChunkDir() / cleanupStaleChunks()` 等 API，給 whisper (main.js) 與 voiceprint (voiceprint.js) 共用
  - `frontend/electron/voiceprint.js`：改為 require `audioChunker` 共用模組，移除重覆的 `getAudioDuration` / `splitLongAudio` 實作（保留 export 為向後相容）
  - `frontend/electron/main.js`：
    1. require `./audioChunker` 並在啟動時呼叫 `cleanupStaleChunks()` 清掉 `os.tmpdir()/recoder-chunks-*` 與 `voiceprint-chunk-*` 殘留
    2. `runWhisper(audioPath, modelSize, useGpu, gpuDevice, onProgress)` 新增 `onProgress(percent, elapsed, fallback)` 參數
    3. `WhisperJobManager._executeTranscribe(job)` 重構：若 `settings.whisperChunkMinutes > 0` 且音檔 ≥ 60 分鐘，呼叫 `audioChunker.splitLongAudio()` 切成多個 WAV chunks，依序跑 `runWhisper` 個別辨識，再把 segments 時間偏移加回原檔座標；chunk 跑完/失敗都 `cleanupChunkDir()` 刪除暫存
    4. 新增 `_runSingleTranscribe()` 與 `_loadSettings()` helper
  - `frontend/src/App.vue`：
    1. data 新增 `whisperChunkMinutes: 50`；`loadSettings()` / `saveSettings()` 同步此欄位
    2. 設定面板新增「🔪 轉寫長音檔切片」下拉選項（不切片 / 30 / 40 / 50 / 60 分鐘，default 50）
    3. Jobs 面板進度文字新增 `切片 N/M 辨識中 (X%)` 顯示（透過 `job.progress.currentChunk / totalChunks`）
  - `frontend/src/i18n/{zh-TW,en,ja}.js`：新增 `settings.whisperChunk / noChunk / min / whisperChunkTitle` 與 `jobs.chunkProgress` 三語翻譯
  - `frontend/package.json`：version 1.20.8 → 1.20.9 (Patch)
- **修改結果**：
  - 共用 `audioChunker.js` 模組建立，voiceprint.js 與 main.js 共用，移除重覆實作
  - WhisperJobManager 整合長音檔切片，支援 ≥ 60 分鐘音檔自動切成 ≤ 50 分鐘 chunks 各別 whisper，segments 時間戳正確對應原檔
  - 取消機制：job 進入 cancelled 狀態時，下一 chunk 不會繼續執行（throw Error 中斷），chunks 暫存目錄 `cleanupChunkDir()` 刪除
  - 系統設定新增「轉寫長音檔切片」選項，default 50 min/chunk，使用者可在 0/30/40/50/60 之間切換
  - Jobs 面板 UI 顯示切片狀態（currentChunk / totalChunks）
  - 三語 i18n 同步
  - 啟動時自動清掉 `os.tmpdir()/recoder-chunks-*` 殘留
- **備份檔名**: backup-202606301200.zip

## [2026-06-30 11:15]
- **version**: 1.20.8
- **修改要求**：
  1. UI 的狀態列在播放指定的錄音記錄時應顯示對應的音檔名稱，而不是音檔列表的第一個音檔名稱
  2. jobs 只顯示已完成的 job，應該從 job 開始執行就要存在，不然要如何執行 stop 等指令
- **修改規劃**：
  - `frontend/src/App.vue`：
    1. `playRecordingAudio(item)` 開頭將 `currentPlayingFilename` 設為 `item.filename || item.id`，並在播放時將 `statusText` 改為 `▶️ 播放: ` / `▶️ 播放中: `，停止時也還原成對應檔名
    2. `reviewRecording(id)` 一併更新 `currentPlayingFilename` 並用新的 i18n key `status.loadedWithName` 顯示 `✅ 已載入 {count} 句（{filename}）`，並移除檔案中重覆的舊版 `reviewRecording`
    3. 樂觀更新 (optimistic UI) — 五個任務起點立即把 pending job 用 `unshift` 寫入對應 list：轉寫 `transcribeJobList`、聲紋 `voiceprintJobList`、摘要/翻譯/優化 `jobList`，讓使用者一按下按鈕就能看到該 job 並能 stop
  - `frontend/src/i18n/{zh-TW,en,ja}.js`：新增 `status.loadedWithName` 三語鍵
    - zh-TW：`'✅ 已載入 {count} 句（{filename}）'`
    - en：`'✅ Loaded {count} sentences ({filename})'`
    - ja：`'✅ {count} 文を読み込みました（{filename}）'`
  - `frontend/package.json`：version 1.20.7 → 1.20.8 (Patch)
- **修改結果**：
  - `App.vue` 修改完成（playRecordingAudio、reviewRecording、五處樂觀更新）
  - `i18n/{zh-TW,en,ja}.js` 同步新增 `status.loadedWithName`
  - `package.json` version 升至 1.20.8
  - 編譯產出：`frontend/dist-electron-build4/Recorder-1.20.8-portable.exe`（179.9 MB，2026-06-30 10:58:53）
  - Code Sign 驗證通過：DigiCert RFC 3161 時間戳、Subject CN=Cheng-Feng Iron Factory
  - 備份檔名：`backup-202606301115.zip`（276.2 MB，來源 814.87 MB，6052 個檔案）

## [2026-06-30 10:01]
- **version**: 1.20.7
- **修改要求**：
  1. 聲紋模型如果已下載不重覆下載
  2. 待辨識音檔長度 > 60 分鐘時自動切成多個 ≤ 50 分鐘的 chunks 再進行說話者標註
  3. 解決聲紋辨識退化問題 (過短 / 靜音段造成全部段被誤判為 Speaker_1)
- **修改規劃**：
  - `frontend/electron/voiceprint.js`：
    1. `downloadModel()` 開頭先呼叫 `isModelCached()`，若已下載 (大小 ≥ 40MB) 直接 `resolve(true)`、推 100% 進度，避免重覆下載
    2. 新增 `getAudioDuration(audioPath)` 以 ffmpeg `-i` 解析 stderr 的 `Duration: HH:MM:SS` 取得音檔時長
    3. 新增 `splitLongAudio(audioPath)` 使用 ffmpeg `-f segment -segment_time 3000` 切成 ≤ 50 分鐘的 WAV chunks，回傳 `[{file, startOffset, endOffset}]` 結構
    4. `diarizeAudio()` 內若 `audioDuration >= 3600s` 啟動切片；segments 對應到 chunk 並以 chunk-local 時間切割 + 抽取 embedding；temp 目錄使用 `fs.rmSync` 清掉
    5. `extractSegmentPcm()` 過短 (<1.5s) 自動左右各延伸 0.5s padding；最低長度放寬為 0.3s
    6. `extractEmbedding()` 將 `numFrames < 5` 放寬為 `< 3`
    7. `clusterEmbeddings()` 改為兩段式: (a) 鄰近滑動視窗 median cosine ≥ 0.55 強制 union-find 合併 (b) 全域 centroid 跨組 cosine ≥ 0.5 貪婪合併
    8. 統一 `MIN_MODEL_SIZE = 40MB`，移除 `MIN_VALID_MODEL_SIZE` 與 `REAL_MIN_MODEL_SIZE` 三個重覆常數
    9. 新增 `getFfmpegPath()` 抽離路徑邏輯給 diarizeAudio / splitLongAudio / extractSegmentPcm 共用
  - `frontend/electron/main.js`：不改邏輯，已有的 progress callback 介面相容新流程
  - `frontend/package.json`：version 1.20.6 → 1.20.7 (Patch)
- **修改結果**：
  - `frontend/electron/voiceprint.js` 完成重構，匯出 `isModelCached / downloadModel / loadModel / resetModel / diarizeAudio / extractEmbedding / extractSegmentPcm / clusterEmbeddings / cosineSimilarity / getAudioDuration`
  - `frontend/package.json` version 升至 1.20.7
  - Node 端語法驗證通過：`require('./frontend/electron/voiceprint.js')` 載入成功，所有 10 個 exports 可訪問
  - 待後續測試: 已下載模型時再次呼叫 `downloadModel()` 不觸發 HTTPS 請求；65 分鐘音檔的 `diarizeAudio()` 可切片並產出結果
  - 備份檔名: backup-202606301001.zip

## [2026-06-16 00:57]
- **version**: 1.0.0
- **修改要求**：初始版本 — 建立 AI 會議記錄程式，支援離線錄音轉文字、說話者標註、單檔限制防過大。
- **修改規劃**：
  1. 建立專案結構 (recoder.py, transcriber.py, diarizer.py, ui/main_window.py, main.py)
  2. 使用 faster-whisper (tiny model, CPU int8) 做語音辨識
  3. 使用 Silero VAD + ECAPA-TDNN speaker embedding + Agglomerative Clustering 做說話者分離
  4. 使用 PyQt5 實作 GUI
  5. 錄音使用 sounddevice + pydub Opus 壓縮，限制最長 60 分鐘
- **修改結果**：
  - 完成全部核心模組開發：
    - `recorder.py` — 錄音模組 (sounddevice + pydub Opus 壓縮，支援最長 60 分鐘)
    - `transcriber.py` — 語音辨識模組 (faster-whisper, CPU int8, 支援 tiny/base/small)
    - `diarizer.py` — 說話者分離模組 (webrtcvad + librosa MFCC + sklearn clustering)
    - `ui/main_window.py` — PyQt5 GUI (錄音/匯入/辨識/匯出，說話者重新命名，彩色標註)
    - `main.py` — 程式入口
  - 建立專案文件 (Product_Design_Guidelines.md, readme.md, modify_record.md)
  - 安裝所有相依套件至 conda `airecoder` 環境
  - 所有 Python 檔案編譯驗證通過
  - 備份檔名: backup-202606160117.zip
  - PyInstaller 編譯成功：dist/Recoder/Recoder.exe (15.9 MB, --onedir 模式)
  - 移除不必要的 torch/torchaudio/speechbrain 依賴（faster-whisper 使用 ctranslate2，diarizer 使用 librosa+sklearn）
  - 更新 requirements.txt 移除未使用的套件
- 備份檔名: backup-202606161329.zip

## [2026-06-17 09:36]
- **version**: 1.0.1
- **修改要求**：修正 PyInstaller `--windowed` 模式下首次下載 faster-whisper 模型時，`tqdm` 因 `stdout`/`stderr` 為 `None` 而拋出 `'NoneType' object has no attribute 'write'` 的錯誤。
- **修改規劃**：
  1. 在 `transcriber.py` 的 `download_model()` 呼叫 `snapshot_download` 前，暫時將 `sys.stdout` 與 `sys.stderr` 重定向到 `io.StringIO()`，讓 `huggingface_hub` 內部進度條有合法的 file-like object 可寫。
  2. 下載完成後還原 `sys.stdout`/`sys.stderr`，避免影響後續 GUI 運作。
  3. 簡化下載度回呼，於下載結束後回呼 `1.0`。
  4. 將版本號遞增為 `1.0.1`。
  5. 建立 `security.md` 資安合規檢查清單。
  6. 更新 `readme.md` 版本歷史與 `Product_Design_Guidelines.md` 功能模組說明。
- **修改結果**：
  - `transcriber.py` 已加入 `io` 匯入與 stdout/stderr 重定向保護。
  - `main.py` 版本號更新為 `1.0.1`。
  - 新增 `security.md` 靜態檢清單。
  - PyInstaller 編譯成功：`dist/Recoder/Recoder.exe` (15.9 MB, --onedir --windowed 模式)
  - 執行檔啟動測試通過，可正常寫入 `app.log`
  - 完成原始碼備份: backup-202606170939.zip

## [2026-06-17 10:40]
- **version**: 1.0.2
- **修改要求**：修正語音辨識過程中程式閃退的問題。
- **修改規劃**：
  1. 建立獨立測試腳本，確認 `transcriber.transcribe()` 在非 GUI 環境可正常執行，排除模型或音檔本身問題。
  2. 將 `ui/main_window.py` 中的 `DownloadWorker` 與 `TranscriptionWorker` 從 `threading.Thread` 改為 `QThread`，避免背景執行緒與 Qt 主執行緒互動導致 C++ 層級崩潰閃退。
  3. 確保模型下載與語音辨識皆在 QThread 內執行。
  4. 將版本號遞增為 `1.0.2`。
  5. 更新專案文件與重新編譯。
- **修改結果**：
  - 獨立測試腳本確認 `transcriber.transcribe()` 可正常完成辨識（2 句，耗時 2.2 秒）。
  - `ui/main_window.py` 已移除 `threading` 匯入，改為 `QThread`。
  - 版本號更新為 `1.0.2`。
  - PyInstaller 重新編譯成功：`dist/Recoder/Recoder.exe` (15.9 MB)
  - 新版執行檔啟動測試通過，可正常寫入 `app.log`
  - 完成原始碼備份: backup-202606171043.zip

## [2026-06-17 11:04]
- **version**: 1.0.3
- **修改要求**：修正 PyInstaller 打包後執行檔在「開始辨識」載入 faster-whisper 模型時閃退的問題。
- **修改規劃**：
  1. 強化 `transcriber.py`：在 `WhisperModel` 建構與 `model.transcribe()` 前後加入詳細日誌，並暫時重定向 `sys.stdout`/`sys.stderr` 到 `io.StringIO()`，避免 PyInstaller `--windowed` 模式下 C++ 底層庫嘗試寫入 `None` 而直接崩潰。
  2. 強化 `ui/main_window.py`：
     - 修正 `WorkerSignals` 初始化，補上 `super().__init__(parent)` 並指定 `parent=self`。
     - 在 `TranscriptionWorker.run()` 整個執行期間重定向 stdout/stderr，並增加辨識進度日誌，提升閃退時的可追蹤性。
  3. 更新 `recoder.spec`：動態掃描 conda env 的 `Library/bin`，自動加入 `libiomp5md.dll`、VC++ runtime (`vcruntime140*.dll`、`msvcp140*.dll`)、OpenBLAS、MKL/TBB、GCC Fortran 等 faster-whisper / ctranslate2 / numpy / scipy / scikit-learn 所需的 DLL，並補充 hiddenimports。
  4. 更 `main.py` 版本號為 `1.0.3`。
  5. 執行完整功能測試與 PyInstaller 重新編譯。
  6. 更新專案文件與原始碼備份。
- **修改結果**：
  - 原始碼功能測試通過：`transcriber.transcribe()` 可正常載入模型並回傳結果，未發生崩潰。
  - 所有 Python 檔案 `py_compile` 語法檢查通過。
  - PyInstaller 重新編譯成功：`dist/Recoder/Recoder.exe`（約 15.9 MB 主程式，總輸出包含 ctranslate2.dll / libiomp5md.dll / OpenBLAS / VC++ runtime 等關鍵 DLL）。
  - 打包後執行檔啟動測試通過，`app.log` 正確寫入「Recoder 啟動」與 `MainWindow.__init__` 日誌。
  - 完成原始碼備份: backup-202606171106.zip

## [2026-06-17 11:20]
- **version**: 1.0.4
- **修改要求**：持續修正 PyInstaller 打包後執行檔在「開始辨識」載入 faster-whisper 模型時仍閃退的問題。v1.0.3 日誌仍停在「呼叫 WhisperModel 建構函式...」後即中斷。
- **修改規劃**：
  1. 進一步定位：使用 `ctypes.CDLL` 測試打包後的 `ctranslate2.dll`，發現載入失敗（Windows 錯誤碼 126 = ERROR_MOD_NOT_FOUND）。
  2. 比較原始碼環境與打包後的 `ctranslate2` 目錄，發現打包後缺少 `cudnn64_9.dll`。
  3. 更新 `recoder.spec`：除了 `Library/bin`，再自動掃描 conda env 的 `site-packages/ctranslate2/` 與 `site-packages/faster_whisper/`，將套件自帶的所有 `.dll` 加入打包。
  4. 將版本號遞增為 `1.0.4`。
  5. 重新 PyInstaller 編譯、還原模型與資源。
  6. 更新專案文件與原始碼備份。
- **修改結果**：
  - 已確認打包後 `dist/Recoder/_internal/cudnn64_9.dll` 存在。
  - 打包後 `dist/Recoder/_internal/ctranslate2/ctranslate2.dll` 載入測試通過（`ctypes.CDLL` 成功）。
  - 打包後執行檔啟動測試通過，`app.log` 正確寫入啟動日誌。
  - 所有 Python 檔案 `py_compile` 語法檢查通過。
  - 完成原始碼備份: backup-202606171123.zip

## [2026-06-17 11:37]
- **version**: 1.0.5
- **修改要求**：持續修正 PyInstaller 打包後執行檔在「開始辨識」載入 faster-whisper 模型時仍閃退的問題。v1.0.4 雖然已補齊 `cudnn64_9.dll` 且 console 模式測試可載入模型，但 `windowed` 模式下仍閃退。
- **修改規劃**：
  1. 建立最小化 console 模式 PyInstaller 測試執行檔，只執行 `WhisperModel()` 建構。
  2. 對比測試發現：console 模式正常，windowed 模式閃退。確認問題為 PyInstaller `--windowed` 模式下 C 層級 stdout/stderr file descriptor 無效，faster-whisper / ctranslate2 底層 C++ 程式碼寫入時導致進程直接崩潰。
  3. 修改 `main.py`：在程式啟動最早期（任何 GUI 或 model import 之前）使用 `os.dup2()` 將 fd 1/2 重定向到 `os.devnull`。
  4. 將版本號遞增為 `1.0.5`。
  5. 重新 PyInstaller 編譯、還原模型與資源。
  6. 更新專案文件與原始碼備份。
- **修改結果**：
  - console 模式最小化測試執行檔確認 `WhisperModel()` 在打包後可正常建構。
  - `main.py` 已加入 C 層級 fd 1/2 重定向保護（`os.dup2` 到 `os.devnull`）。
  - PyInstaller 重新編譯成功：`dist/Recoder/Recoder.exe`。
  - 所有 Python 檔案 `py_compile` 語法檢查通過。
  - 完成原始碼備份: backup-202606171139.zip

## [2026-06-17 12:26]
- **version**: 1.0.6
- **修改要求**：修正 PyInstaller 打包後執行檔「開始辨識」載入 faster-whisper 模型時仍閃退的問題。日誌顯示閃退發生在「呼叫 WhisperModel 建構函式...」之後，且 `main.py` 檔案被意外截斷，導致 v1.0.5 加入的 C 層級 stdout/stderr 重定向保護遺失。
- **修改規劃**：
  1. 從最近一次備份 `backup-202606171139.zip` 恢復完整 `main.py` 內容。
  2. 將版本號遞增為 `1.0.6`，確認 C 層級 fd 1/2 重定向到 `os.devnull` 的程式碼存在於程式最早期。
  3. 執行語法檢查與原始碼功能測試，確認 `transcriber.transcribe()` 可正常載入模型並回傳結果。
  4. 建立最小化 windowed 模式測試執行檔，直接載入 `WhisperModel`，驗證打包後不閃退。
  5. 重新使用 `recoder.spec` 打包正式執行檔 `dist/Recoder/Recoder.exe`，確認 model/ 目錄與關鍵 DLL（ctranslate2.dll、cudnn64_9.dll、libiomp5md.dll）齊全。
  6. 執行 security.md 機敏字串檢查。
  7. 更新專案文件並備份原始碼。
- **修改結果**：
  - `main.py` 已從備份恢復完整內容，包含 PyInstaller `--windowed` 模式下 C 層級 stdout/stderr file descriptor 重定向保護。
  - 所有 Python 檔案 `py_compile` 語法檢查通過。
  - 原始碼功能測試通過：`transcriber.transcribe('test_data/previews_demo.wav', model_size='tiny')` 成功辨識出 2 句。
  - 最小化 windowed 測試執行檔確認 `WhisperModel` 在打包後可正常載入，未閃退。
  - PyInstaller 重新編譯成功：`dist/Recoder/Recoder.exe`（15.9 MB，--onedir --windowed 模式）。
  - 打包後執行檔啟動測試通過，`app.log` 正確寫入啟動與 `MainWindow.__init__` 日誌。
  - security.md 機敏字串檢查通過，未發現 api_key/token/password/secret 等敏感字串。
  - 完成原始碼備份: backup-202606171226.zip

## [2026-06-17 16:27]
- **version**: 1.1.0
- **修改要求**：架構遷移 — 將 Recoder 從 PyQt5 GUI 遷移至 Electron + Vue.js + Flask 架構，解決 PyQt5 + ctranslate2 DLL 衝突導致的 PyInstaller windowed 模式閃退問題。
- **修改規劃**：
  1. 移除 PyQt5 依賴，改用 Electron (Chromium) 作為前端容器。
  2. 建立 Flask 後端 API 伺服器 (`backend/server.py`) ，提供 REST API + SSE 進度回呼。
  3. 建立 Vue.js 前端 (`frontend/`) ，包含控制列、狀態列、進度條、逐字稿顯示。
  4. 建立 Electron 主進程 (`frontend/electron/main.js`) ，生產模式啟動後端 exe。
  5. 使用 PyInstaller 獨立打包 Flask 後端（不含 PyQt5）。
  6. 使用 electron-builder 整合前後端為單一 portable exe。
- **修改結果**：
  - 完全移除 PyQt5，改為 Electron + Vue.js + Flask 架構。
  - 建立 Flask 後端伺服器（8 個 REST API + SSE 進度回呼）：`/api/status`、`/api/import`、`/api/models`、`/api/model/download`、`/api/transcribe`、`/api/transcribe/<id>/status`、`/api/transcribe/<id>/result`、`/api/export`。
  - 修正 `backend/server.py` 的 `sys.path.insert()` 在 PyInstaller frozen 模式下的路徑設置（使用 `sys.executable` 目錄作為基底）。
  - 後端 exe (`RecoderBackend.exe`) 可正確啟動 Flask 並監聽 port 5199，API `/api/status` 回應正常。
  - Vue 前端 Vite build 通過（11 modules，~69.74 KB JS + ~1.85 KB CSS）。
  - Electron 主進程支援開發模式（Python 腳本）與生產模式（extraResources 中的後端 exe）。
  - electron-builder 成功產出 `Recoder-1.1.0-portable.exe`（183 MB，含 Electron、Vue 前端、Python 後端）。
  - 執行 security.md 機敏字串檢查：未發現 api_key/token/password/secret。
  - 備份檔名: backup-202606171627.zip

## [2026-06-18 12:00]
- **version**: 1.2.0
- **修改要求**：簡化架構 — 完全移除 Python + Flask 後端，改為純 Node.js IPC 架構，前端直接呼叫 whisper-cli.exe (whisper.cpp) 與 ffmpeg.exe。
- **修改規劃**：
  1. 從原始碼編譯 whisper-cli.exe（MSVC + CMake，AVX2 優化），下載 GGML 格式模型（77 MB tiny）。
  2. 改寫 `transcriber.py` 為 `subprocess.run()` 呼叫 whisper-cli.exe，完全隔離進程。
  3. 改寫 `frontend/electron/main.js`：移除 Flask 啟動程式碼，改為 Node.js IPC handler 直接執行 ffmpeg、whisper-cli、模型下載。
  4. 改寫 `frontend/electron/preload.js` 與 `frontend/src/App.vue`：從 HTTP fetch + SSE 改為純 IPC 呼叫。
  5. 更新 `frontend/package.json`：加入 whisper_cli/ 與 ffmpeg/ 作為 extraResources，版本號 1.2.0。
  6. 更新 `Product_Design_Guidelines.md`、`readme.md`、`security.md` 反映新架構。
- **修改結果**：
  - whisper-cli.exe 編譯成功（485 KB，AVX2 + OpenMP 優化），搭配 4 個 DLL（whisper.dll、ggml.dll、ggml-base.dll、ggml-cpu.dll）。
  - 功能測試通過：`whisper-cli -m ggml-tiny.bin -f test.wav --output-json` 成功辨識 2 句，時間戳正確。
  - 完全移除 Flask 後端：Electron main.js 直接透過 IPC handler 呼叫 ffmpeg.exe（轉換）與 whisper-cli.exe（辨識）。
  - 完全移除 port 5199：不再需要 Flask HTTP 伺服器，前後端通訊改為 Electron IPC。
  - 完全移除 Python 依賴：不再需要 conda、PyInstaller、faster-whisper、ctranslate2。
  - electron-builder 的 unpacked 執行檔可正常產出（含 Electron + Vue + whisper-cli + ffmpeg）。
  - 備份檔名: backup-202606181200.zip

## [2026-06-18 17:23]
- **version**: 1.3.1
- **修改要求**：提供設定 LLM API Key — Ollama 有提供 Cloud 服務，需要 API Key。
- **修改規劃**：
  1. 將 Ollama 拆分為兩個獨立提供商選項：「Ollama (本地)」與「Ollama Cloud」。
  2. Ollama (本地) 維持原有行為：`http://127.0.0.1:11434/api/generate`，免 API Key。
  3. Ollama Cloud 使用 OpenAI-compatible endpoint：`https://api.ollama.com/v1/chat/completions`，需 API Key。
  4. 前端 App.vue 的 `v-if="llmProvider !== 'ollama'"` 已正確涵蓋 ollama_cloud（顯示 API Key 輸入框），無需修改。
  5. 版本號 1.3.0 → 1.3.1。
- **修改結果**：
  - `frontend/electron/main.js` 的 `LLM_PROVIDERS` 新增 `ollama_cloud` 項目，預設模型 `llama3.2`。
  - `callLLM` 函數無需修改 — ollama_cloud 自動走 OpenAI-compatible 分支（`/chat/completions`）。
  - 前端設定面板下拉選單出現「Ollama Cloud」選項，選擇時 API Key 輸入框正常顯示。
  - 更新 `Product_Design_Guidelines.md`（版本 1.2.2，新增 LLM 功能模組說明）。
  - 更新 `readme.md`（功能簡介加入 LLM 後處理，版本歷史加入 v1.3.1）。
  - 更新 `modify_record.md`（本筆記錄）。
  - 備份檔名: backup-202606181723.zip

## [2026-06-18 17:38]
- **version**: 1.3.1
- **修改要求**：LLM 設定值（提供商、API Key、模型名稱）需要持久化儲存，重啟 App 後保留。
- **修改規劃**：
  1. 在 `frontend/electron/main.js` 新增 `settings:load` 與 `settings:save` 兩個 IPC handler。
  2. 設定檔存放於 `app.getPath('userData')/settings.json`（即 `%APPDATA%/Recoder/settings.json`）。
  3. 在 `frontend/electron/preload.js` 暴露 `loadSettings` 與 `saveSettings`。
  4. 在 `frontend/src/App.vue` 的 `mounted()` 中呼叫 `loadSettings()` 還原設定。
  5. 在提供商切換、API Key 輸入、模型名稱輸入、分段錄音選擇時自動呼叫 `saveSettings()`。
- **修改結果**：
  - 設定檔路徑：`%APPDATA%/Recoder/settings.json`
  - 儲存欄位：`llmProvider`、`llmApiKey`、`llmModel`、`segmentMinutes`
  - 每次修改設定後自動寫入檔案，重啟 App 自動還原。
  - Vite build 成功（11 modules, 623ms）。
  - electron-builder portable 打包成功：`Recoder-1.3.1-portable.exe`（121 MB）。
  - 備份檔名: backup-202606181738.zip

## [2026-06-18 18:03]
- **version**: 1.3.2
- **修改要求**：1) 所有操作需提供 log 記錄存放在 recorder.log  2) LLM 功能失敗需跳開建立錯誤處理  3) whisper 運算支援 Vulkan 加速
- **修改規劃**：
  1. 將 debugLog 改為 appLog，寫入 `app.getPath('userData')/recorder.log`
  2. 所有關鍵操作（ffmpeg、whisper、LLM、模型下載、匯入、錄音）加入 log
  3. callLLM 加入 HTTP status 檢查、API error 檢查、30 秒 timeout
  4. 使用 CMake -DGGML_VULKAN=1 重新編譯 whisper-cli.exe
  5. 版本號 1.3.1 → 1.3.2
- **修改結果**：
  - 日誌檔案：`%APPDATA%/Recoder/recorder.log`，格式 `[ISO時間] [LEVEL] [模組] 訊息`
  - LLM 錯誤處理：HTTP 非 2xx 拋出明確錯誤、API error 欄位檢查、30 秒 timeout
  - Vulkan 編譯成功：whisper-cli.exe + ggml-vulkan.dll 已複製到 whisper_cli/
  - Vite build 成功（11 modules, 751ms）
  - electron-builder portable 打包成功：`Recoder-1.3.2-portable.exe`（127 MB，含 Vulkan DLL）
  - 備份檔名: backup-202606181803.zip

## [2026-06-18 23:37]
- **version**: 1.3.3
- **修改要求**：修正 LLM 功能持續報錯 — OpenRouter 401 Missing Authentication header（未輸入 API Key 照樣發請求）與 Ollama Cloud 405 Method Not Allowed（Ollama Cloud baseUrl 錯誤）。
- **修改規劃**：
  1. 在 `callLLM` 函式中，非 Ollama 提供商若 apiKey 為空，直接拋出明確錯誤訊息，不再發送 HTTP 請求。
  2. 修正 `LLM_PROVIDERS.ollama_cloud.baseUrl` 從 `https://api.ollama.com/v1` 改為 `https://ollama.com/v1`（根據官方 SDK 範例）。
  3. 版本號 1.3.2 → 1.3.3。
- **修改結果**：
  - `frontend/electron/main.js` 新增 API Key 空值前置檢查（第 76-79 行）。
  - `frontend/electron/main.js` 修正 Ollama Cloud baseUrl（第 66 行）。
  - 版本號更新為 `1.3.3`。
  - 備份檔名: backup-202606182337.zip

## [2026-06-19 00:23]
- **version**: 1.4.0
- **修改要求**：三個功能改善 — 1) 每個 AI provider 獨立 API Key 可預先設定 2) 下載 whisper 模型時需有進度條 3) model/log/settings 存放於執行檔目錄
- **修改規劃**：
  1. API Key 獨立儲存：`settings.json` 改為儲存 `apiKeys: { openrouter, siliconflow, gemini, ollama_cloud }` 物件；前端設定面板每個 provider 顯示獨立的 API Key 輸入框與顯示/隱藏按鈕
  2. 下載進度條：`downloadFile` 加入 `progressCallback`，計算已接收 bytes 與 content-length 比例；`model:download` 透過 IPC 推送百分比；`preload.js` 暴露 `onDownloadProgress`；`App.vue` 在 mounted 註冊監聽器
  3. 路徑統一：新增 `exeDirPath()` 函式（開發模式=專案根目錄，生產模式=execPath 所在目錄）；log、settings.json、model/ 全部改用 `exeDirPath`；whisper_cli/ffmpeg 維持 `resourcePath`
  4. 版本號 1.3.3 → 1.4.0（次版號新增，向下相容的功能增強）
- **修改結果**：
  - `frontend/electron/main.js`：新增 `exeDirPath()`、`downloadFile` 進度回呼、`model:download` IPC 進度推送、model/log/settings 路徑改為 `exeDirPath`
  - `frontend/electron/preload.js`：新增 `onDownloadProgress` 監聽器
  - `frontend/src/App.vue`：`apiKeys` 物件儲存各 provider Key、設定面板每個 provider 獨立 Key 輸入框、下載進度監聽、`getLlmParams` 從 `apiKeys[llmProvider]` 取值
  - `frontend/package.json`：版本號更新為 1.4.0
  - Vite build 成功（11 modules, 676ms）
  - 備份檔名: backup-202606190023.zip

## [2026-06-19 10:50]
- **version**: 1.5.0 (hotfix)
- **修改要求**：確認 Vulkan 設定未生效 — whisper-cli.exe `backends = 1` 只有 CPU，`no GPU found`
- **修改規劃**：
  1. 診斷：舊的 whisper-cli.exe 雖有 `ggml-vulkan.dll` 但程式本身未編譯 Vulkan backend
  2. 重新編譯：`cmake .. -DGGML_VULKAN=1` → `cmake --build . --config Release --target whisper-cli`
  3. 複製新產出的 whisper-cli.exe + ggml-vulkan.dll + 其他 DLL 至 `whisper_cli/`
  4. 測試驗證 Vulkan 正確啟用
- **修改結果**：
  - CMake 成功找到 Vulkan SDK 1.4.341
  - 重新編譯後的 whisper-cli.exe `backends = 2`（CPU + Vulkan）
  - Vulkan0 裝置正確識別並使用（`using Vulkan0 backend`）
  - 更新 readme.md、Product_Design_Guidelines.md 文件
  - 重新打包：`Recoder-1.5.0-portable.exe`（127 MB）

## [2026-06-20 06:09]
- **version**: 1.5.2
- **修改要求**：修正「儲存設定」按鈕沒有反應的問題。
- **修改規劃**：
  1. 診斷：`frontend/src/App.vue` 的 `saveSettings()` 方法有三個缺陷：
     - `if (!window.electronAPI) return` — 無提示直接返回
     - `await window.electronAPI.saveSettings(...)` — 未檢查回傳值 `result.success`
     - `catch (e) { /* 靜默失敗 */ }` — 錯誤被完全吞掉
  2. 修復：加入 `window.electronAPI` 不存在時的提示、檢查 `result.success`、`catch` 區塊顯示錯誤訊息
  3. 版本號 1.5.1 → 1.5.2（patch 修復 bug）
- **修改結果**：
  - `frontend/src/App.vue` 的 `saveSettings()` 方法已修復：
    - `window.electronAPI` 不存在時顯示「⚠️ 通訊模組未載入，無法儲存設定」
    - 檢查 `result.success`，失敗時顯示「❌ 儲存失敗: ...」
    - `catch` 區塊顯示錯誤訊息而非靜默
  - 版本號更新為 `1.5.2`
  - 備份檔名: backup-202606200609.zip

## [2026-06-20 06:48]
- **version**: 1.5.3
- **修改要求**：1) 修正「❌ 儲存失敗: An object could not be cloned」— Vue Proxy 無法被 IPC 克隆 2) 設定檔路徑改為使用者目錄
- **修改規劃**：
  1. `frontend/src/App.vue`：`saveSettings()` 中 `apiKeys: this.apiKeys` 改為 `apiKeys: { ...this.apiKeys }`（Vue Proxy → 純物件）
  2. `frontend/electron/main.js`：`getSettingsPath()` 從 `exeDirPath('settings.json')` 改為 `path.join(os.homedir(), 'recoder', 'settings.json')`
  3. 版本號 1.5.2 → 1.5.3（patch 修復 bug + 路徑調整）
- **修改結果**：
  - `frontend/src/App.vue`：`apiKeys` 傳遞前 spread 為純物件，IPC 克隆不再失敗
  - `frontend/electron/main.js`：設定檔路徑改為 `C:\Users\<user>\recoder\settings.json`
  - 版本號更新為 `1.5.3`
  - 備份檔名: backup-202606200649.zip

## [2026-06-20 22:45]
- **version**: 1.5.4
- **修改要求**：把 model 和 log 也儲存到 `%USERPROFILE%/recoder/`
- **修改規劃**：
  1. 新增 `userDataPath()` 函式：`path.join(os.homedir(), 'recoder', ...parts)`
  2. `appLog()` 中的 `recorder.log` 路徑從 `exeDirPath` 改為 `userDataPath`
  3. `models:list`、`model:download`、`transcribe:start` 中的 model 路徑從 `exeDirPath` 改為 `userDataPath`
  4. 版本號 1.5.3 → 1.5.4
- **修改結果**：
  - `frontend/electron/main.js`：新增 `userDataPath()` 函式
  - `recorder.log` → `C:\Users\<user>\recoder\recorder.log`
  - `model/` → `C:\Users\<user>\recoder\model/`
  - `settings.json` → `C:\Users\<user>\recoder\settings.json`（維持不變）
  - 版本號更新為 `1.5.4`
  - 備份檔名: backup-202606202245.zip

## [2026-06-21 23:16]
- **version**: 1.7.1
- **修改要求**：修正即時錄音轉文字（VAD 即時辨識）時間戳錯誤 — 所有即時辨識結果的時間戳都從 `[00:00]` 開始，且出現重複的 `First...`、`[MUSIC PLAYING]` 等雜訊。
- **修改規劃**：
  1. 根因分析：`flushVadSentence()` 中 `vadSentenceStart` 從未更新（永遠為 0），導致所有 VAD 句子的時間偏移都為 0
  2. 次要問題：`flushVadSentence()` 是 async 但 VAD callback 沒有序列化，多個 whisper-cli 請求可能同時執行造成競態條件
  3. 修復方案：
     - 新增 `vadTotalDuration` 追蹤已處理的累積秒數，每次 flush 後更新
     - `flushVadSentence()` 使用 `vadTotalDuration` 作為時間偏移（而非 `vadSentenceStart`）
     - 加入 `vadBusy` flag 防止併發呼叫（序列化）
  4. 版本號 1.7.0 → 1.7.1（patch 修復 bug）
- **修改結果**：
  - `frontend/src/App.vue`：
    - `startRecording()` 初始化 `vadTotalDuration = 0`、`vadBusy = false`
    - `flushVadSentence()` 使用 `vadTotalDuration` 作為時間偏移，處理後更新 `vadTotalDuration += pcm.length / 16000`
    - `flushVadSentence()` 加入 `vadBusy` 序列化保護
  - 版本號更新為 `1.7.1`
  - 備份檔名: backup-202606212316.zip

## [2026-06-21 23:36]
- **version**: 1.7.2
- **修改要求**：提供手動下載語音轉文字模型的功能，讓使用者可以在錄音/匯入音檔之前就先下載好模型。
- **修改規劃**：
  1. 在控制列（模型選擇下拉選單旁）新增「⬇️ 下載」按鈕
  2. 按鈕僅在選取的模型未快取時啟用，已快取時顯示「✅ 已下載」並禁用
  3. 點擊後呼叫現有 `window.electronAPI.downloadModel()` IPC，顯示進度條
  4. 下載完成後自動刷新模型列表
  5. 版本號 1.7.1 → 1.7.2（patch 新增功能）
- **修改結果**：
  - `frontend/src/App.vue`：
    - 控制列新增 `.btn-download` 按鈕（橙色 #FF8F00）
    - 新增 `selectedModelCached` computed property 判斷當前選取模型是否已快取
    - 新增 `downloadModel()` 方法：檢查快取狀態、顯示進度條、呼叫 IPC、錯誤處理、刷新模型列表
    - 按鈕 `:disabled` 綁定：`busy || isRecording || selectedModelCached`
  - 版本號更新為 `1.7.2`
  - 備份檔名: backup-202606212336.zip

## [2026-06-21 23:57]
- **version**: 1.7.3
- **修改要求**：改善 VAD 即時辨識品質 — 將多個 VAD 句子累積到 10 秒才送 whisper-cli，避免短音訊片段導致英文雜訊。
- **修改規劃**：
  1. 新增 `vadAccumBuffer` 累積多個 VAD 句子的 PCM 資料
  2. 新增 `vadAccumStartTime` 記錄累積開始的時間點
  3. `flushVadSentence()` 改為累積模式：將 PCM 追加到 accum buffer，達到 10 秒（160000 samples @ 16kHz）才送辨識
  4. 新增 `flushAccumBuffer()` 方法：將累積的 PCM 送 whisper-cli 辨識
  5. `onRecordingStop()` 停止時 flush 剩餘累積 buffer
  6. 版本號 1.7.2 → 1.7.3（patch 改善功能）
- **修改結果**：
  - `frontend/src/App.vue`：
    - data() 新增 `vadAccumBuffer: []`、`vadAccumStartTime: 0`
    - `startRecording()` 初始化累積變數
    - `flushVadSentence()` 改為累積模式（不再直接送 whisper）
    - 新增 `flushAccumBuffer()` 方法（累積達 10 秒或停止時呼叫）
    - `onRecordingStop()` 停止時 flush 剩餘累積 buffer
  - 版本號更新為 `1.7.3`
  - 備份檔名: backup-202606212357.zip

## [2026-06-22 02:18]
- **version**: 1.7.5
- **修改要求**：移除 VAD 功能 — 即時語音活動偵測（VAD）在實際使用中辨識品質不佳，且增加錄音時的 CPU 負擔，決定移除。
- **修改規劃**：
  1. `frontend/src/App.vue`：移除所有 VAD 相關 data 變數（vadNode、vadBuffer、vadSpeaking、vadSilenceFrames、vadSentenceStart、vadSentenceCount、vadAccumBuffer、vadAccumStartTime、vadAccumBusy、vadTotalDuration、vadBusy、liveTranscribing、pendingSegments）
  2. `frontend/src/App.vue`：刪除 startVad()、downsample()、flushVadSentence()、flushAccumBuffer() 四個方法
  3. `frontend/src/App.vue`：startRecording() 移除 VAD 初始化與 startVad() 呼叫
  4. `frontend/src/App.vue`：cleanupRecording()、cleanupStreams() 移除 VAD 清理
  5. `frontend/src/App.vue`：onRecordingStop() 移除 VAD buffer flush 邏輯
  6. `frontend/src/App.vue`：模板移除 live-badge 與 live-hint
  7. `frontend/electron/main.js`：刪除 writePcmToWav() 函式與 transcribe:pcm IPC handler
  8. `frontend/electron/preload.js`：移除 transcribePcm API
  9. `Product_Design_Guidelines.md`：刪除 VAD 即時辨識段落
  10. 版本號 1.7.4 → 1.7.5（patch 移除功能）
- **修改結果**：
  - `frontend/electron/preload.js`：移除 `transcribePcm` 屬性
  - `frontend/electron/main.js`：刪除 `writePcmToWav()` 函式與 `transcribe:pcm` IPC handler
  - `frontend/src/App.vue`：完整重寫，移除所有 VAD 相關變數、方法、模板元素、CSS 樣式
  - `Product_Design_Guidelines.md`：版本更新至 1.3.2，刪除 VAD 即時辨識段落
  - `frontend/package.json`：版本號更新為 1.7.5
  - 備份檔名: backup-202606220218.zip

## [2026-06-22 10:07]
- **version**: 1.8.2
- **修改要求**：程式 title bar 要包含程式 version 資訊。
- **修改規劃**：
  1. 根因分析：`frontend/electron/main.js` 的 `createWindow()` 已設定 `title: \`Recoder v${app.getVersion()} — AI 會議記錄\``，但 Electron 預設行為是 HTML 頁面載入後 `document.title` 會覆蓋 `BrowserWindow` 的 `title` 設定。
  2. 修復方案：在 `createWindow()` 中攔截 `page-title-updated` 事件，阻止 HTML 標題覆蓋。
  3. 版本號 1.8.1 → 1.8.2（patch 修復 bug）。
- **修改結果**：
  - `frontend/electron/main.js`：`createWindow()` 加入 `mainWindow.on('page-title-updated', (event) => { event.preventDefault() })`，確保視窗標題不被 HTML `<title>` 覆蓋。
  - `frontend/package.json`：版本號更新為 `1.8.2`。
  - `Product_Design_Guidelines.md`：版本更新至 1.3.3。
  - 備份檔名: backup-202606221007.zip

## [2026-06-22 11:42]
- **version**: 1.8.3
- **修改要求**：錄音分段儲存的原始音檔（WAV）要永久保留，不要存在系統暫存目錄。
- **修改規劃**：
  1. 根因分析：`save:recorded` IPC handler 將錄音原始檔（webm）與轉換後的 WAV 都寫入 `os.tmpdir()`（系統暫存目錄），程式關閉後可能被清理。
  2. 修復方案：將寫入路徑從 `os.tmpdir()` 改為 `recoDataPath()`（即 `C:\Users\<user>\recoder\reco_data\`），與逐字稿 JSON 放在同一目錄。
  3. 版本號 1.8.2 → 1.8.3（patch 改善功能）。
- **修改結果**：
  - `frontend/electron/main.js`：`save:recorded` IPC handler 中 `tmpDir` 改為 `recoDir = recoDataPath()`，原始 webm 與轉換後的 WAV 都永久保存在 `C:\Users\<user>\recoder\reco_data\`。
  - `frontend/package.json`：版本號更新為 `1.8.3`。
  - 備份檔名: backup-202606221142.zip

## [2026-06-22 12:26]
- **version**: 1.8.4
- **修改要求**：修正「混音 + 分段錄音」模式下，語音轉文字只進行第一段的 bug。
- **修改規劃**：
  1. 根因分析：`transcribeBlob()` 是非同步方法，內部使用 `this.currentSegment` 計算分段索引，但 `saveSegment()` 在呼叫 `transcribeBlob` 後立即更新 `this.currentSegment`，導致非同步回調執行時讀到錯誤的索引值。
  2. 修復方案：將分段索引 `segIdx` 在呼叫 `transcribeBlob` 時作為參數傳入，而非在非同步回調中讀取可變的 `this.currentSegment`。
  3. 同時改善錯誤處理：失敗時更新 `statusText` 讓使用者能看到錯誤訊息。
  4. 版本號 1.8.3 → 1.8.4（patch 修復 bug）。
- **修改結果**：
  - `frontend/src/App.vue`：
    - `saveSegment()`：在呼叫 `transcribeBlob` 前計算 `segIdx = this.segmentBlobs.length - 1`，作為第三個參數傳入
    - `transcribeBlob(blob, mt, segIdx)`：接收 `segIdx` 參數，不再讀取 `this.currentSegment`；加入完整的錯誤處理（儲存失敗、辨識失敗、無結果、異常）
    - `onRecordingStop()`：最後一段也傳入正確的 `segIdx`
  - `frontend/package.json`：版本號更新為 `1.8.4`。
  - 備份檔名: backup-202606221226.zip

## [2026-06-22 13:08]
- **version**: 1.8.5
- **修改要求**：修正「混音 + 分段錄音」模式下，第二段之後 ffmpeg.exe 找不到（ENOENT）的問題。
- **修改規劃**：
  1. 根因分析：`save:recorded` IPC handler 被多個分段同時呼叫（`transcribeBlob` 沒有 await，多段並行），每個呼叫都透過 `resourcePath('ffmpeg', 'ffmpeg.exe')` 取得 ffmpeg 路徑後 spawn。在 portable 模式下（app 解壓縮到暫存目錄執行），並行 spawn 可能造成資源競爭，導致第二個 spawn 時路徑暫時無效。
  2. 修復方案：在 `convertAudio()` 中加入 ffmpeg 序列化佇列（Promise 鏈），確保同一時間只有一個 ffmpeg 進程在啟動；加入 `fs.existsSync` 防禦性檢查與最多 3 次重試機制。
  3. 版本號 1.8.4 → 1.8.5（patch 修復 bug）。
- **修改結果**：
  - `frontend/electron/main.js`：
    - 新增 `ffmpegQueue = Promise.resolve()` 序列化佇列
    - `convertAudio()` 改為透過佇列序列化執行，避免並行 spawn 造成 ENOENT
    - 加入 `fs.existsSync(ffmpeg)` 防禦性檢查
    - 加入最多 3 次重試機制（間隔 500ms）
  - `frontend/package.json`：版本號更新為 `1.8.5`。
  - 編譯成功：`frontend/dist-electron/Recoder-1.8.5-portable.exe`（127 MB）
  - 備份檔名: backup-202606221308.zip

## [2026-06-22 14:02]
- **version**: 1.8.6
- **修改要求**：修正「混音 + 分段錄音」模式下，第二段之後 webm 檔案損壞（Invalid data found when processing input）的問題。
- **修改規劃**：
  1. 根因分析：MediaRecorder 的 `ondataavailable` 區塊無法直接拼接成有效的 webm 檔案。第一個 chunk 包含 EBML header，但後續 chunks 只有純資料區塊。`saveSegment()` 取 `audioChunks` 做 blob，但第二個分段觸發時 `audioChunks` 已被清空過，只包含沒有 header 的純資料 chunks → 無效檔案。
  2. 修復方案：在每個分段邊界停止並重啟 MediaRecorder，確保每個分段都是一個完整的錄音 session（有 header 的有效 webm）。
  3. 版本號 1.8.5 → 1.8.6（patch 修復 bug）。
- **修改結果**：
  - `frontend/src/App.vue`：
    - 新增 `_segmentStop`、`_segmentCount`、`_segmentMimeType` 狀態變數
    - 新增 `onRecorderStop()` 統一的 onstop 處理器：根據 `_segmentStop` 旗標判斷是分段停止還是使用者停止
    - `saveSegment()` 改為呼叫 `mediaRecorder.stop()`（觸發 onstop → 建立完整 blob → 辨識 → 重啟）
    - `stopRecording()` 設定 `_segmentStop = false` 後呼叫 `mediaRecorder.stop()`
    - 移除舊的 `onRecordingStop()` 方法
  - `frontend/package.json`：版本號更新為 `1.8.6`。
  - 編譯成功：`frontend/dist-electron/Recoder-1.8.6-portable.exe`（127 MB）
  - 備份檔名: backup-202606221402.zip

## [2026-06-22 15:07]
- **version**: 1.8.7
- **修改要求**：修正「混音 + 分段錄音」模式下，第二段之後分段時間逐漸縮減的問題（設定 5 分鐘但後續分段只有 2 分鐘、1 分鐘...）。
- **修改規劃**：
  1. 根因分析：v1.8.6 在每個分段邊界停止 → 轉寫（ffmpeg + whisper，耗時 20~30 秒）→ 重啟 MediaRecorder。但 `recordingSeconds` 計時器在轉寫期間持續遞增，導致下一個分段邊界提前觸發（`recordingSeconds % (segmentMinutes * 60) === 0` 在錯誤的時間點成立）。
  2. 修復方案：新增 `_segmentElapsed` 變數獨立追蹤當前分段內的實際錄音秒數，每次重啟 MediaRecorder 時歸零。分段邊界判斷改用 `_segmentElapsed >= segmentMinutes * 60`，不再依賴全域 `recordingSeconds`。
  3. 版本號 1.8.6 → 1.8.7（patch 修復 bug）。
- **修改結果**：
  - `frontend/src/App.vue`：
    - data() 新增 `_segmentElapsed: 0`
    - `startMediaRecorder()`：重置 `_segmentElapsed = 0`
    - 計時器 callback：同時遞增 `recordingSeconds`（顯示用）和 `_segmentElapsed`（邊界判斷用）
    - 邊界判斷：`_segmentElapsed >= this.segmentMinutes * 60` 取代 `recordingSeconds % (segmentMinutes * 60) === 0`
  - `frontend/package.json`：版本號更新為 `1.8.7`。
  - 編譯成功：`frontend/dist-electron/Recoder-1.8.7-portable.exe`（127 MB）
  - 備份檔名: backup-202606221507.zip

## [2026-06-22 15:56]
- **version**: 1.8.8
- **修改要求**：修正「混音 + 分段錄音」模式下，第二段之後計時速度變快的問題。
- **修改規劃**：
  1. 根因分析：`startMediaRecorder()` 每次被呼叫時都建立一個新的 `setInterval` 計時器，但舊的計時器沒有被清除。分段邊界觸發時，舊的 `setInterval` 仍然在背景執行，導致多個計時器同時 tick，計時速度加倍。
  2. 修復方案：在 `startMediaRecorder()` 開頭加入 `if (this.recordingTimer) clearInterval(this.recordingTimer)` 清除舊計時器。
  3. 版本號 1.8.7 → 1.8.8（patch 修復 bug）。
- **修改結果**：
  - `frontend/src/App.vue`：`startMediaRecorder()` 開頭新增 `if (this.recordingTimer) clearInterval(this.recordingTimer)`
  - `frontend/package.json`：版本號更新為 `1.8.8`。
  - 編譯成功：`frontend/dist-electron/Recoder-1.8.8-portable.exe`（127 MB）
  - 備份檔名: backup-202606221556.zip
 

## [2026-06-22 16:30]
- **version**: 1.8.9
- **修改要求**：修復長音訊辨識時出現大量重複 segment 的異常 (whisper.cpp hallucination)。
  - 用戶回報：5 分鐘英文演講影片，從 00:25 之後每 2 秒重複同一句 "About two months ago, Eric and I wrote a blog post about how we build effective agents."
- **修改規劃**：
  1. whisper 在靜音/音樂片段會產生 hallucination 重複文字，是已知模型缺陷
  2. 在 whisper-cli 命令列加入反 hallucination 參數：
     - `-ml 60` 限制每段最大長度
     - `-nth 0.7` 提高 no-speech 閾值
     - `-wt 0.03` 提高 word timestamp 閾值
     - `-bs 1 -bo 1` 改用 greedy 解碼
     - `--suppress-nst` 抑制非語音 token
     - `--no-fallback` 禁用溫度回退
  3. 加入 Python 端後處理：`_deduplicate_repeats()` 偵測相鄰高度相似 segment 並合併
- **修改結果**：
  - 修改 `transcriber.py`：加入反 hallucination 命令列參數 + 後處理去重邏輯
  - 單元測試 4 個情境全通過 (英文重複、英文短句、不相似句子、中文重複)
  - 端對端測試：中文 200 秒音檔正常產出 103 段，0 個相鄰重複
  - 同步更新版本號：`frontend/package.json` 1.8.8 → 1.8.9、`backend/server.py` 1.0.7 → 1.8.9



## [2026-06-22 16:40] - 算法改進
- **version**: 1.8.9
- **修改要求**：_deduplicate_repeats 演算法在子集場景下的精進。
- **修改規劃**：
  - 加入子集檢查條件：Jaccard ≥ 0.7 且其中一段是另一段子集時才視為重複
  - 避免誤刪主題不同但有重疊詞彙的句子
- **修改結果**：
  - 修改 `transcriber.py` `_deduplicate_repeats()` 演算法
  - 完整單元測試 6 個情境全通過（含用戶真實場景 11 段 → 5 段）

## [2026-06-23 09:22]
- **version**: 1.8.10
- **修改要求**：將程式碼放置到 GitHub 公開 repo。
- **修改規劃**：
  1. 建立 `.gitignore` 排除：`__pycache__/`、`*.pyc`、`frontend/node_modules/`、`frontend/dist/`、`frontend/dist-electron/`、`*.log`、`backup/`、`build/`、`.vscode/`、`Thumbs.db`、`.DS_Store`、`.env`、`backend/`（已棄用）、`ffmpeg/`（超過 GitHub 100MB 限制）
  2. `git rm --cached` 清理已追蹤的應忽略檔案（`__pycache__/`、`app.log`、`frontend/dist-electron/`、`frontend/dist/`、`backend/`）
  3. 更新 `readme.md`：加入 ffmpeg.exe 下載說明（gyan.dev 連結），移除 `backend/` 專案結構
  4. 更新 `frontend/package.json` 版本號 1.8.9 → 1.8.10
- **修改結果**：
  - `.gitignore` 已建立，排除規則如上
  - 已清理 git 追蹤的應忽略檔案（`__pycache__/`、`app.log`、`frontend/dist-electron/`、`frontend/dist/`、`backend/`）
  - `readme.md` 已更新：前置需求加入 ffmpeg.exe 下載說明，專案結構移除 `backend/`
  - `frontend/package.json` 版本號更新為 `1.8.10`
  - 後續操作：需在 GitHub 建立公開 repo → `git remote add origin <URL>` → `git push` → 在 GitHub Releases 上傳 `Recoder-1.8.9-portable.exe`
  - 備份檔名: backup-202606230922.zip

## [2026-06-23 09:56]
- **version**: 1.8.10
- **修改要求**：優化程式碼，移除舊有用不到的 Python 程式碼（PyQt5/Flask/faster-whisper 時代）。
- **修改規劃**：
  1. 刪除舊 Python 模組：`main.py`、`diarizer.py`、`recorder.py`、`logger.py`、`transcriber.py`
  2. 刪除 PyInstaller 相關：`recoder.spec`、`recoder_console_test.spec`、`test_full_windowed.spec`、`test_min_ct2.spec`、`rthook_no_pyqt5_path.py`
  3. 刪除測試腳本：`test_full_windowed.py`、`test_min_ct2.py`
  4. 刪除舊 GUI：`ui/` 目錄（PyQt5）
  5. 刪除舊後端：`backend/` 目錄（Flask）
  6. 刪除不再需要的 `requirements.txt`、根目錄 `package-lock.json`
  7. 更新 `readme.md` 專案結構（移除 `ffmpeg/`、`backend/`、`ui/`）
- **修改結果**：
  - 已刪除 12 個檔案 + 2 個目錄（`ui/`、`backend/`）
  - `readme.md` 專案結構已更新
  - GitHub push 成功（`2fb62f7`）

## [2026-06-23 12:17]
- **version**: 1.9.2
- **修改要求**：歷史記錄頁面重構 — 移除「📂 批次轉 txt」按鈕，歷史記錄頁面改為兩個子 Tab（📚 錄音記錄 + 🎵 音檔列表），錄音記錄每筆增加「🔄 重建」按鈕，音檔列表每筆有「🤖 辨識」按鈕。
- **修改規劃**：
  1. 控制列刪除「📂 批次轉 txt」按鈕
  2. 後端 main.js 新增 `reco:listAudioFiles`（掃描 reco_data 中所有音檔）與 `reco:rebuild`（讀取 JSON → 找對應 WAV → runWhisper → 更新 JSON）IPC
  3. preload.js 新增 `recoListAudioFiles`、`recoRebuild`；移除 `batchTranscribe`、`onBatchProgress`
  4. 前端 App.vue 歷史記錄區塊改為子 Tab 切換（historySubTab），錄音記錄每筆加入「🔄 重建」按鈕，音檔列表顯示檔名/大小/日期 +「🤖 辨識」按鈕
  5. 移除 batchBusy/batchProgress data、startBatchTranscribe 方法、onBatchProgress 監聽器
  6. 版本號 1.9.1 → 1.9.2
- **修改結果**：
  - `frontend/electron/main.js`：新增 `reco:listAudioFiles` 與 `reco:rebuild` IPC handler
  - `frontend/electron/preload.js`：新增 `recoListAudioFiles`、`recoRebuild`；移除 `batchTranscribe`、`onBatchProgress`
  - `frontend/src/App.vue`：移除批次轉 txt 按鈕/方法/data/監聽器；歷史記錄區塊新增子 Tab 切換、重建按鈕、音檔列表
  - `frontend/package.json`：版本號更新為 `1.9.2`
  - 備份檔名: backup-202606231217.zip

## [2026-06-23 12:17] (hotfix)
- **version**: 1.9.2
- **修改要求**：修正音檔列表辨識傳完整路徑而非僅檔名 — `transcribeAudioFile()` 傳入 `f.name`（僅檔名）給 `import:audio` IPC，後端需要完整路徑才能 stat 檔案。
- **修改規劃**：
  1. `reco:listAudioFiles` 回傳的每個 file 物件新增 `path: path.join(dir, e.name)`
  2. 前端 template 中 `transcribeAudioFile(f.name)` → `transcribeAudioFile(f.path)`
- **修改結果**：
  - `frontend/electron/main.js`：`reco:listAudioFiles` 回傳新增 `path` 欄位
  - `frontend/src/App.vue`：音檔列表按鈕傳入 `f.path` 而非 `f.name`
  - Git commit `508dde3`

## [2026-06-23 13:08]
- **version**: 1.9.3
- **修改要求**：1) 錄音記錄移除重建，增加 Review/語句優化/翻譯/重點整理功能 2) 音檔列表提供全部辨識，僅針對沒有 metadata 檔案的音檔
- **修改規劃**：
  1. 後端 main.js 新增 `reco:loadMeta`（載入完整 JSON）、`reco:llmProcess`（LLM 處理並存回 JSON）、`reco:batchTranscribeNew`（批次辨識無 metadata 的新音檔）
  2. preload.js 新增對應 API；移除 `recoRebuild`
  3. 前端錄音記錄列表移除「🔄 重建」按鈕，新增「📖 Review」「✨ 優化」「🌐 翻譯」「📋 摘要」四個按鈕
  4. 前端音檔列表 header 新增「🤖 全部辨識」按鈕，僅辨識無對應 JSON 的音檔
  5. 版本號 1.9.2 → 1.9.3
- **修改結果**：
  - `frontend/electron/main.js`：新增 `reco:loadMeta`、`reco:llmProcess`、`reco:batchTranscribeNew` IPC handler
  - `frontend/electron/preload.js`：新增 `recoLoadMeta`、`recoLlmProcess`、`recoBatchTranscribeNew`、`onBatchNewProgress`；移除 `recoRebuild`
  - `frontend/src/App.vue`：錄音記錄移除重建按鈕，新增 Review/優化/翻譯/摘要按鈕；音檔列表新增全部辨識按鈕
  - `frontend/package.json`：版本號更新為 `1.9.3`
  - Vite build 成功（11 modules, 623ms）
  - electron-builder 產出 `Recoder-1.9.3-portable.exe`（127 MB）
  - Git commit `601eb85`
  - 備份檔名: backup-202606231308.zip

## [2026-06-23 14:02]
- **version**: 1.10.0
- **修改要求**：
  1. 支援刪除特定錄音記錄
  2. 支援刪除特定錄音檔
  3. 支援針對逐字稿指定句子(時段)播放對應的原始錄音檔相對錄音內容
  4. 於錄音記錄標示是否在在原始錄音檔，並可選擇播放對應錄音檔
- **修改規劃**：
  1. `frontend/electron/main.js`：
     - `reco:saveMeta` 新增 `audioPath` 參數寫入 JSON
     - `reco:list` 回傳 `hasAudio`（檢查 audioPath 是否存在）與 `audioPath`
     - 新增 `reco:deleteMeta` IPC（刪除 JSON）
     - 新增 `reco:deleteAudio` IPC（安全檢查：僅允許 recoDataPath 下的檔案）
     - 新增 `reco:getAudioUrl` IPC（回傳自訂 protocol URL）
     - 註冊自訂 protocol `reco-file://` 安全提供本機音檔給 renderer
  2. `frontend/electron/preload.js`：新增 `recoDeleteMeta`、`recoDeleteAudio`、`recoGetAudioUrl`
  3. `frontend/src/App.vue`：
     - 新增隱藏 `<audio>` 播放器
     - 逐字稿區每句可點擊播放對應時段
     - 歷史記錄列表顯示 🟢 有音檔 / 🔴 無音檔 狀態 + ▶️ 播放按鈕 + 🗑️ 刪除按鈕
     - 音檔列表每筆加入 🗑️ 刪除按鈕
     - `saveRecordingMeta()` 傳入 `audioPath`
- **修改結果**：
  - `frontend/electron/main.js`：修改 `reco:saveMeta`、`reco:list`；新增 `reco:deleteMeta`、`reco:deleteAudio`、`reco:getAudioUrl`、`registerRecoFileProtocol()`
  - `frontend/electron/preload.js`：新增 3 個 bridge 方法
  - `frontend/src/App.vue`：新增音檔播放（逐句點擊播放、自動跳下一句）、刪除記錄/音檔、音檔狀態標示
  - `frontend/package.json`：版本號更新為 `1.10.0`
  - 備份檔名: backup-202606231402.zip

## [2026-06-23 15:13]
- **version**: 1.10.2
- **修改要求**：修正音檔播放相關 bug：1) 點擊句子播放時經常失敗或只播一小段；2) 從歷史記錄播放時總是自動從第 0 句開始，無法讓使用者選擇起始句子。
- **修改規劃**：
  1. `frontend/src/App.vue` 的 `playSegment(idx)`：將 `audio.currentTime = seg.start` 與 `audio.play()` 移到 `loadedmetadata` 事件回調中執行，避免在音檔中繼資料尚未載入時操作 currentTime 與播放。
  2. `frontend/src/App.vue` 的 `playRecordingAudio(item)`：移除 `this.$nextTick(() => { this.playSegment(0) })` 自動播放邏輯，僅呼叫 `loadAudioUrl()` 載入音檔 URL，再呼叫 `reviewRecording()` 載入逐字稿並切換到逐字稿 tab。
  3. 版本號 `1.10.1` → `1.10.2`（patch 修復 bug）。
  4. 更新 `readme.md`、`Product_Design_Guidelines.md`、`modify_record.md`。
- **修改結果**：
  - `frontend/src/App.vue`：`playSegment()` 已改為在 `loadedmetadata` 回調中設定 currentTime 並播放；`playRecordingAudio()` 已移除自動播放，僅載入音檔與逐字稿。
  - `frontend/package.json`：版本號更新為 `1.10.2`。
  - Vite build 成功（11 modules, ~736ms）。
  - electron-builder 產出 `frontend/dist-electron/Recorder-1.10.2-portable.exe`。
- 完成原始碼備份: backup-202606231515.zip
- Git commit `a0b67c2` 並 push 至 GitHub origin master。

## [2026-06-23 15:45]
- **version**: 1.10.3
- **修改要求**：修正音檔播放的多項問題：1) 缺少停止播放按鈕；2) 語音未完就提前跳到下一句；3) 切換其他逐字稿時舊音檔仍在播放；4) 從音檔列表辨識後，播放使用的原始音檔與 whisper 辨識的 WAV 時間戳不對齊。
- **修改規劃**：
  1. `frontend/src/App.vue`：
     - 在原始逐字稿 panel header 新增「⏹️ 停止播放」按鈕（`nowPlaying === true` 時顯示），點擊呼叫 `stopPlayback()`
     - `onAudioTimeUpdate()` 自動跳句條件改為 `currentTime >= seg.end + 0.3`，保留 300ms 緩衝
     - `reviewRecording()` 與 `playRecordingAudio()` 開頭加入 `this.stopPlayback()`，避免舊音檔繼續播放
     - `transcribeAudioFile()` 傳入 `outputDir` 給 `import:audio`，讓轉換後的 WAV 輸出到 `reco_data`
     - `saveRecordingMeta()` 移除 `_originalAudioPath` 優先邏輯，一律使用 `currentAudioPath`（即 WAV）
     - 新增 `getRecoDataPath()` 透過 IPC 取得正確的 `reco_data` 路徑
  2. `frontend/electron/main.js`：
     - `import:audio` IPC handler 改為接收 `{ filePath, outputDir }`，當 `outputDir` 存在時將轉換後的 WAV 寫入該目錄
     - 新增 `reco:dataPath` IPC handler 回傳 `recoDataPath()`
  3. `frontend/electron/preload.js`：新增 `recoGetDataPath` bridge 方法
  4. 版本號 `1.10.2` → `1.10.3`（patch 修復 bug + 小功能新增）。
  5. 更新 `readme.md`、`Product_Design_Guidelines.md`、`modify_record.md`。
- **修改結果**：
  - `frontend/src/App.vue`：已新增停止播放按鈕、跳句緩衝、切換時自動停止、WAV 路徑統一
  - `frontend/electron/main.js`：`import:audio` 支援 `outputDir`，新增 `reco:dataPath`
  - `frontend/electron/preload.js`：新增 `recoGetDataPath`
  - `frontend/package.json`：版本號更新為 `1.10.3`
  - Vite build 成功（11 modules, ~716ms）
  - electron-builder 產出 `frontend/dist-electron/Recorder-1.10.3-portable.exe`（127,478,541 bytes）
- 完成原始碼備份: backup-202606231548.zip

## [2026-06-23 16:25]
- **version**: 1.10.4
- **修改要求**：修正特定句子播放時，第一句正常，但第二句之後每句開頭會重複播放前幾個字的問題。
- **修改規劃**：
  1. 根因分析：`playSegment()` 每次被呼叫時都重新設定 `audio.src = this.currentAudioUrl`，即使音檔早已載入且正在播放。瀏覽器偵測到 `src` 變更（即使 URL 相同）會重新載入音檔元素，短暫從頭播放，直到 `loadedmetadata` 事件觸發後才 seek 到正確位置。
  2. 修復方案：在 `playSegment()` 中檢查 `audio.readyState >= 1`（中繼資料已載入），若已載入則直接 seek + play，不重新設定 `src`，避免重載造成的開頭重複。
  3. 版本號 `1.10.3` → `1.10.4`（patch 修復 bug）。
- **修改結果**：
  - `frontend/src/App.vue`：`playSegment()` 已改為先檢查 `readyState`，已載入時直接 seek，不重設 `src`
  - `frontend/package.json`：版本號更新為 `1.10.4`
  - Vite build 成功（11 modules, ~738ms）
  - electron-builder 產出 `frontend/dist-electron/Recorder-1.10.4-portable.exe`（127,477,709 bytes）
- 完成原始碼備份: backup-202606231629.zip
- Git commit `591bf3c..` 並 push 至 GitHub origin master

## [2026-06-23 16:50]
- **version**: 1.10.5
- **修改要求**：修正播放延遲與開頭重複問題：1) 點擊播放需等待 10~30 秒才有反應；2) 切換錄音後播放的還是上一個音檔內容；3) 下一句開頭重複播放仍未改善。
- **修改規劃**：
  1. `frontend/src/App.vue` 的 `reviewRecording()`：移除 `this.stopPlayback()` 呼叫，改為僅重置播放狀態旗標（`nowPlaying = false`、`playingSegmentIdx = -1`），不觸碰 `audio.src`，避免清除已載入的音檔 URL
  2. `frontend/src/App.vue` 的 `seekAndPlay()`：在設定 `currentTime` 前先呼叫 `audio.pause()`，立即停止舊音訊輸出，避免舊緩衝區內容在 seek 完成前洩漏
  3. 版本號 `1.10.4` → `1.10.5`（patch 修復 bug）。
- **修改結果**：
  - `frontend/src/App.vue`：`reviewRecording()` 不再呼叫 `stopPlayback()`；`seekAndPlay()` 先 `pause()` 再 seek
  - `frontend/package.json`：版本號更新為 `1.10.5`
  - Vite build 成功（11 modules, ~661ms）
  - electron-builder 產出 `frontend/dist-electron/Recorder-1.10.5-portable.exe`（127,478,590 bytes）
- 完成原始碼備份: （待補）
- Git commit `7145108` 並 push 至 GitHub origin master

## [2026-06-23 17:20]
- **version**: 1.10.6
- **修改要求**：修正下一句開頭重複播放的問題（控制語音和句子放的同步機制有問題，導致播了一小段語音後又重新播放）。
- **修改規劃**：
  1. 根因分析：`seekAndPlay()` 中 `pause()` 和 `currentTime` 設定都是非同步操作，瀏覽器在音訊硬體完全停止輸出前就開始播放新位置，導致舊緩衝區短暫洩漏（聽到前一句尾端或檔案開頭）。
  2. 修復方案：`seekAndPlay()` 改為事件驅動序列化流程：
     - 若已在目標位置且正在播放，不需操作（直接返回）
     - 若已暫停，直接設定 `currentTime` 並等待 `seeked` 事件 → `play()`
     - 若正在播放中，先呼叫 `pause()` 並等待 `pause` 事件完成 → 設定 `currentTime` 並等待 `seeked` 事件 → `play()`
  3. 版本號 `1.10.5` → `1.10.6`（patch 修復 bug）。
- **修改結果**：
  - `frontend/src/App.vue`：`seekAndPlay()` 改為事件驅動序列化流程（pause 事件 → seek → seeked 事件 → play）
  - `frontend/package.json`：版本號更新為 `1.10.6`
  - Vite build 成功（11 modules, ~716ms）
  - electron-builder 產出 `frontend/dist-electron/Recorder-1.10.6-portable.exe`（127,478,795 bytes）
  - `Product_Design_Guidelines.md` 更新音檔播放模組說明，加入事件驅動序列化流程、`reviewRecording` 不觸碰 `audio.src` 等內容
  - `readme.md` 版本歷史新增 v1.10.6 說明，版本號更新為 1.10.6
- 完成原始碼備份: （待補）
- Git commit `20b7470` 並 push 至 GitHub origin master

## [2026-06-23 22:10]
- **version**: 1.10.7
- **修改要求**：修正 whisper 時間戳不精確導致播放重複的問題 — 自動跳句機制會在句子結尾截斷語音並重複播放下句開頭。
- **修改規劃**：
   1. 根因分析：whisper 的 `seg.end` 時間戳可能比實際語音結束時間早。當 `onAudioTimeUpdate()` 偵測到 `currentTime >= seg.end` 時自動呼叫 `playSegment(idx+1)` 跳到下一句的 `seg.start`，但此時實際語音仍在播放句子 N 的結尾。跳句後 seek 到 `seg[N+1].start`，導致句子 N 的結尾被截斷，且句子 N+1 的開頭幾個字被播放了兩次（一次是自然連續播放，一次是 seek 後重播）。
   2. 修復方案：移除自動跳句機制，改為連續播放僅更新高亮句子：
      - `onAudioTimeUpdate()` 改為根據 `currentTime` 遍歷 `transcriptionResults` 更新 `playingSegmentIdx` 高亮，不再呼叫 `playSegment()`
      - 只有超過最後一句的 `end + 0.5` 秒才呼叫 `onAudioEnded()` 停止播放
      - `seekAndPlay()` 保留 v1.10.6 的事件驅動序列化流程（pause 事件 → seek → seeked 事件 → play）
   3. 版本號 `1.10.6` → `1.10.7`（patch 修復 bug）。
- **修改結果**：
   - `frontend/src/App.vue`：`onAudioTimeUpdate()` 移除自動跳句，改為連續播放僅更新高亮
   - `frontend/package.json`：版本號更新為 `1.10.7`
   - Vite build 成功（11 modules, ~696ms）
   - electron-builder 產出 `frontend/dist-electron/Recorder-1.10.7-portable.exe`
   - `readme.md` 版本歷史新增 v1.10.7 說明，版本號更新為 1.10.7
   - `Product_Design_Guidelines.md` 音檔播放模組說明更新（移除自動跳句描述）
- 完成原始碼備份: backup-202606232215.zip
- Git commit `5ffaa86` 並 push 至 GitHub origin master

## [2026-06-24 05:40]
- **version**: 1.11.0
- **修改要求**：三項功能需求：1) 錄音記錄可新增/修改/篩選/列出全部/刪除 label；2) 搜尋/AI 查詢支援 label 資訊，可依 label 條列錄音記錄；3) 搜尋結果可跳轉到真實錄音記錄的相對句子位置。
- **修改規劃**：
   1. `frontend/electron/main.js`：
      - `reco:saveMeta` 新增 `labels` 參數寫入 JSON（向後相容，舊 JSON 無 labels 時預設空陣列）
      - `reco:list` 回傳每筆記錄的 `labels`，支援 `labelFilter` 參數篩選
      - `reco:search` 搜尋結果附加 `labels`，keyword 匹配 label 時回傳該錄音的所有 segment
      - `reco:aiQuery` context 中加入 labels 資訊
      - 新增 `reco:updateLabels` IPC（讀取 JSON → 更新 labels → 寫回）
      - 新增 `reco:listLabels` IPC（掃描所有 JSON，回傳不重複 label 清單）
   2. `frontend/electron/preload.js`：新增 `recoUpdateLabels`、`recoListLabels` bridge
   3. `frontend/src/App.vue`：
      - 錄音記錄列表每筆顯示 labels（彩色 tag）與「🏷️」編輯按鈕
      - 新增 label 編輯彈窗（新增/刪除 label）
      - 歷史記錄區上方新增 label 篩選下拉選單
      - 搜尋結果顯示 labels 與「📖 跳轉」按鈕
      - 新增 `jumpToSearchResult()` 方法：載入逐字稿 → 載入音檔 URL → 找到對應 segment → 播放
      - 新增 `loadAllLabels()`、`editLabels()`、`closeLabelEditor()`、`addLabel()`、`removeLabel()`、`saveLabels()` 方法
   4. 版本號 `1.10.7` → `1.11.0`（次版號新增功能）。
- **修改結果**：
   - `frontend/electron/main.js`：修改 `reco:saveMeta`、`reco:list`、`reco:search`、`reco:aiQuery`；新增 `reco:updateLabels`、`reco:listLabels`
   - `frontend/electron/preload.js`：新增 `recoUpdateLabels`、`recoListLabels`
   - `frontend/src/App.vue`：新增 label 管理 UI、label 篩選、搜尋結果跳轉功能
   - `frontend/package.json`：版本號更新為 `1.11.0`
   - Vite build 成功（11 modules, ~900ms）
   - electron-builder 產出 `frontend/dist-electron/Recorder-1.11.0-portable.exe`（127,481,035 bytes）
   - `readme.md` 版本歷史新增 v1.11.0 說明，版本號更新為 1.11.0
- 完成原始碼備份: backup-202606240003.zip
- Git commit `802801d` 並 push 至 GitHub origin master

## [2026-06-24 08:12]
- **version**: 1.12.0
- **修改要求**：1) 錄音記錄改為樹狀目錄管理（folder create/delete/rename/move），解決未來太多錄音記錄在一層的效能問題；2) 支援多個錄音記錄一起移動/刪除；3) 修復 label 可以新增但不能儲存的問題；4) 移除錄音記錄列表的優化/翻譯/摘要按鈕，改為顯示 label 資訊。
- **修改規劃**：
   1. `frontend/electron/main.js`：
      - 新增 `scanJsonFiles()` 遞迴掃描函式，支援子目錄
      - `reco:saveMeta` 新增 `folder` 參數，寫入指定子目錄
      - `reco:list` 改為接收 `{ folder }` 參數，回傳 `{ folders, recordings }` 樹狀結構
      - `reco:search`、`reco:aiQuery`、`reco:listLabels`、`reco:loadMeta`、`reco:llmProcess`、`reco:deleteMeta`、`reco:updateLabels` 全部改為遞迴掃描子目錄
      - 新增 `reco:createFolder` IPC（建立子目錄）
      - 新增 `reco:deleteFolder` IPC（遞迴刪除目錄）
      - 新增 `reco:renameFolder` IPC（重新命名目錄）
      - 新增 `reco:moveRecordings` IPC（移動多筆 JSON + 音檔到目標目錄）
      - 新增 `reco:batchDelete` IPC（批次刪除多筆記錄含音檔）
   2. `frontend/electron/preload.js`：新增 `recoCreateFolder`、`recoDeleteFolder`、`recoRenameFolder`、`recoMoveRecordings`、`recoBatchDelete` bridge
   3. `frontend/src/App.vue`：
      - 錄音記錄列表改為樹狀檢視：breadcrumb 導覽列 + folder 列表 + 錄音記錄
      - Folder 管理按鈕：📁 新增目錄 / ✏️ 重新命名 / 🗑️ 刪除目錄
      - 每筆錄音記錄新增 checkbox（多選模式）
      - 底部工具列：📁 移動所選 / 🗑️ 批次刪除 / ☑️ 全選 / ⬜ 取消全選
      - 移動操作彈窗：選擇目標 folder
      - 移除錄音記錄列表的 ✨優化 / 🌐翻譯 / 📋摘要 按鈕
   4. 版本號 `1.11.0` → `1.12.0`（次版號新增功能）。
- **修改結果**：
   - `frontend/electron/main.js`：修改 7 個 IPC + 新增 5 個 IPC，全部支援子目錄遞迴掃描
   - `frontend/electron/preload.js`：新增 5 個 bridge
   - `frontend/src/App.vue`：大幅重構歷史記錄區塊，新增樹狀檢視、folder 管理、多選批次操作
   - `frontend/package.json`：版本號更新為 `1.12.0`
   - Vite build 成功（11 modules, 884ms）
   - `readme.md` 版本歷史新增 v1.12.0 說明，版本號更新為 1.12.0
- Git commit `309cb5d` 並 push 至 GitHub origin master

## [2026-06-24 09:46]
- **version**: 1.12.1
- **修改要求**：編譯產出最新版 portable exe。
- **修改規劃**：
  1. 遞增版本號 1.12.0 → 1.12.1（patch）
  2. 執行 `npm run electron:build` 編譯 portable exe
  3. 更新 modify_record.md、readme.md、Product_Design_Guidelines.md
  4. 備份原始碼
- **修改結果**：
  - `frontend/package.json`：版本號更新為 `1.12.1`
  - Vite build 成功（11 modules, ~683ms）
  - electron-builder 產出 `frontend/dist-electron-build/Recorder-1.12.1-portable.exe`（127,483,206 bytes）
  - 編譯過程中遇到 Windows Defender 鎖定 `app.asar` 問題，透過切換輸出路徑（`dist-electron-build2`）繞過
  - `readme.md` 版本號更新為 1.12.1
  - `Product_Design_Guidelines.md` 版本更新至 1.5.1
- 完成原始碼備份: backup-202606240946.zip

## [2026-06-24 10:03]
- **version**: 1.12.2
- **修改要求**：修正「移動所選」對話框無法顯示子目錄的問題 — 點擊「📁 移動所選」時，彈窗只顯示「📁 根目錄」，無法選取在根目錄下建立的子目錄。
- **修改規劃**：
  1. 根因分析：`loadAllFolders()` 方法從未被呼叫，導致 `allFolders` 永遠是空陣列 `[]`
  2. 修復方案：
     - 後端 `electron/main.js`：新增 `reco:listAllFolders` IPC handler，使用遞迴掃描一次回傳所有子目錄
     - `preload.js`：新增 `recoListAllFolders` bridge
     - `App.vue`：`loadAllFolders()` 改為呼叫後端 `recoListAllFolders`（取代前端多次 IPC 遞迴）
     - `App.vue`：新增 `openMoveDialog()` 方法，點擊「移動所選」時先呼叫 `loadAllFolders()` 再顯示彈窗
  3. 版本號 1.12.1 → 1.12.2（patch 修復 bug）
- **修改結果**：
  - `frontend/electron/main.js`：新增 `reco:listAllFolders` IPC handler（遞迴掃描所有子目錄）
  - `frontend/electron/preload.js`：新增 `recoListAllFolders` bridge
  - `frontend/src/App.vue`：`loadAllFolders()` 改為呼叫後端 API；新增 `openMoveDialog()` 方法；模板按鈕改為 `@click="openMoveDialog"`
  - `frontend/package.json`：版本號更新為 `1.12.2`
  - `readme.md` 版本號更新為 1.12.2
  - `Product_Design_Guidelines.md` 版本更新至 1.5.2
- 完成原始碼備份: backup-202606241003.zip

## [2026-06-24 10:25]
- **version**: 1.13.0
- **修改要求**：1) 提供 中/英/日 操作介面，可在第一次啟動（無設定檔）或系統設定介面設定操作介面語言；2) 說明文件提供 中/英/日 版本，更新 workrule.md 未來文件更新須提供多語言版本。
- **修改規劃**：
  1. 建立 i18n 基礎架構：`frontend/src/i18n/` 目錄，包含 zh-TW.js、en.js、ja.js 語言檔及 index.js 載入器
  2. 修改 `App.vue`：所有硬編碼中文文字改為 `$t('key')` 呼叫；設定面板新增語言下拉選單；首次啟動（無 uiLanguage 設定）顯示語言選擇對話框
  3. 建立多語言文件：`readme_en.md`、`readme_ja.md`、`modify_record_en.md`、`modify_record_ja.md`
  4. 更新 `workrule.md` 第 4 節，加入多語言文件維護規範
  5. 版本號 1.12.2 → 1.13.0（次版號新增功能，向下相容）
- **修改結果**：
  - `frontend/src/i18n/zh-TW.js` — ~200 條 key-value 繁體中文語言檔
  - `frontend/src/i18n/en.js` — ~200 條 key-value 英文語言檔
  - `frontend/src/i18n/ja.js` — ~200 條 key-value 日文語言檔
  - `frontend/src/i18n/index.js` — `t(key, lang)` 函式 + `LANGUAGES` 匯出
  - `frontend/src/App.vue` — 所有 UI 文字改為 `$t()` 動態載入；設定面板新增語言選擇；首次啟動語言選擇對話框
  - `readme_en.md` — readme 英文版
  - `readme_ja.md` — readme 日文版
  - `modify_record_en.md` — 修改日誌英文版（僅 v1.13.0 以後）
  - `modify_record_ja.md` — 修改日誌日文版（僅 v1.13.0 以後）
  - `.clinerules/workrule.md` — 第 4 節更新，加入多語言文件維護規範
  - `frontend/package.json` — 版本號更新為 1.13.0
- 完成原始碼備份: backup-202606241025.zip

## [2026-06-24 10:44]
- **version**: 1.13.1
- **修改要求**：編譯專案，產出 portable exe。
- **修改規劃**：
  1. 遞增版本號 1.13.0 → 1.13.1
  2. 執行 electron-builder 編譯
  3. 更新文件與備份
- **修改結果**：
  - `frontend/package.json`：版本號更新為 1.13.1
  - 編譯輸出：`frontend/dist-electron-build2/Recorder-1.13.1-portable.exe` (127 MB)
  - 因 Windows Defender 鎖定 `dist-electron-build`，改用 `dist-electron-build2` 輸出目錄
- 完成原始碼備份: backup-202606241044.zip

## [2026-06-24 11:35]
- **version**: 1.13.2
- **修改要求**：修正多語言重構造成的介面 bug — 設定中的 AI 供應商選單與 whisper 模型選單空白。
- **修改規劃**：
  1. 根因分析：i18n 多語言重構時，`App.vue` 的 `mounted()` 生命週期鉤子被意外移除，導致 `fetchModels()`、`fetchLlmProviders()`、`loadSettings()` 三個初始化方法從未被呼叫
  2. 修復方案：在 `computed` 區塊與 `methods` 區塊之間補回 `async mounted()` 鉤子
  3. 版本號 1.13.1 → 1.13.2（patch 修復 bug）
- **修改結果**：
  - `frontend/src/App.vue`：補回 `async mounted()` 生命週期鉤子，依序呼叫 `fetchModels()`、`fetchLlmProviders()`、`loadSettings()`
  - `frontend/package.json`：版本號更新為 1.13.2
  - 編譯輸出：`frontend/dist-electron-build2/Recorder-1.13.2-portable.exe` (127 MB)
- 完成原始碼備份: backup-202606241135.zip

## [2026-06-24 12:30]
- **version**: 1.14.0
- **修改要求**：話句優化必須引用原始逐字稿時間記號 — 導入 LLM Job Manager 非同步處理機制、Token 限制偵測與分批處理、逐句優化保留時間戳對齊。
- **修改規劃**：
  1. 建立 `LlmJobManager` 類別（main.js）：管理所有 LLM 操作的佇列、執行、取消與歷史記錄；Job 狀態機 `pending → running → completed/failed/cancelled`；透過 `llm:jobUpdate` IPC 主動推送狀態變更
  2. Token 估算與模型 Context Limit 查詢（main.js）：
     - `estimateTokens(text)`：根據字元類型估算 token 數（CJK 1.5 token/字，ASCII 0.25 token/字）
     - `getModelContextLimit(provider, model)`：查詢模型 context window 上限（對照表 + Ollama API 動態查詢 + fallback 4096）
     - 超過上限時自動分批處理（優化按句子切分、翻譯按字元數切分、摘要/AI 查詢截斷）
  3. 逐句優化（main.js + App.vue）：
     - system prompt 要求 LLM 以 `[編號] 優化文字` 格式逐句輸出
     - `_parseOptimizedResult()` 解析 LLM 輸出，對應回原始 segment 保留時間戳
  4. 前端 UI 整合（App.vue + preload.js）：
     - LLM 動作列新增「📋 Job」按鈕與 job 列表面板（含進度條、log、取消按鈕）
     - 即時監聽 `llm:jobUpdate` 事件更新 activeJobId 與進度
     - 新增 `initJobListener()`、`refreshJobList()`、`cancelJob()`、`cancelActiveJob()` 方法
  5. i18n 新增 job 相關翻譯 key（zh-TW/en/ja）
  6. 更新 `Product_Design_Guidelines.md` 版本 1.6.0，新增 LLM Job Manager 與 Token 估算說明
  7. 版本號 1.13.2 → 1.14.0（次版號新增功能，向下相容）
- **修改結果**：
  - `frontend/electron/main.js`：新增 `LlmJobManager` 類別、`estimateTokens()`、`getModelContextLimit()`、`KNOWN_MODEL_CONTEXTS` 對照表、4 個 job 執行方法（optimize/translate/summary/aiQuery）、4 個 job IPC handler（submit/status/list/cancel）
  - `frontend/electron/preload.js`：新增 `llmJobSubmit`、`llmJobStatus`、`llmJobList`、`llmJobCancel`、`onLlmJobUpdate` bridge
  - `frontend/src/App.vue`：新增 job 管理 data/methods/UI 面板/CSS 樣式；LLM 動作列新增 Job 按鈕、批次進度顯示、取消按鈕
  - `frontend/src/i18n/zh-TW.js`：新增 7 條 job 相關翻譯 key
  - `frontend/src/i18n/en.js`：新增 7 條 job 相關翻譯 key
  - `frontend/src/i18n/ja.js`：新增 7 條 job 相關翻譯 key
  - `frontend/package.json`：版本號更新為 1.14.0
  - `Product_Design_Guidelines.md`：版本更新至 1.6.0，新增 LLM Job Manager 與 Token 估算說明
- 備份檔名: backup-202606241230.zip

## [2026-06-24 14:42]
- **version**: 1.14.0
- **修改要求**：重新編譯專案，產出 portable exe。
- **修改規劃**：
  1. 執行 `npm run electron:build`（vite build + electron-builder --win portable）
  2. 驗證輸出檔案
  3. 更新文件與備份
- **修改結果**：
  - 編譯成功：`frontend/dist-electron-build2/Recorder-1.14.0-portable.exe` (127 MB)
  - 無程式碼變更，僅重新編譯
- 備份檔名: backup-202606241442.zip

## [2026-06-24 14:58]
- **version**: 1.14.1
- **修改要求**：修正「✨ 優化」功能報錯 `An object could not be cloned` — Vue Proxy 無法透過 Electron IPC 序列化。
- **修改規劃**：
  1. 根因分析：`doOptimize()` 傳遞 `segments: this.transcriptionResults` 給 `llmJobSubmit` IPC，但 `this.transcriptionResults` 是 Vue reactive 陣列（Proxy 物件），Structured Clone Algorithm 無法序列化 Proxy
  2. 修復方案：傳遞前使用 `JSON.parse(JSON.stringify(...))` 將 Vue Proxy 轉為純 JSON 物件
  3. 版本號 1.14.0 → 1.14.1（patch 修復 bug）
- **修改結果**：
  - `frontend/src/App.vue`：`doOptimize()` 中 `segments: JSON.parse(JSON.stringify(this.transcriptionResults))`
  - `frontend/package.json`：版本號更新為 1.14.1
- 備份檔名: backup-202606241458.zip

## [2026-06-26 11:06]
- **version**: 1.14.2
- **修改要求**：修正 LLM 分批處理（optimize）時因 30 秒 timeout 導致「The user aborted a request」錯誤。
- **修改規劃**：
  1. 分析日誌：`callLLM()` 函數在第 139 行設定了 30 秒的 AbortController timeout
  2. 分批處理大量句子（如 237 句或 444 句）時，LLM API 呼叫需要超過 30 秒才能完成，導致 `controller.abort()` 被觸發
  3. 修復方案：將 timeout 從 30 秒增加到 120 秒，以容納大型批次處理
  4. 版本號 1.14.1 → 1.14.2（patch 修復 bug）
- **修改結果**：
  - `frontend/electron/main.js`：
    - `callLLM()` 的 AbortController timeout 從 30000 改為 120000
    - 加入 CSMA/CD 風格 exponential backoff retry 機制：`LLM_SLOT_TIME=2000ms`、`LLM_MAX_RETRIES=16`；僅對 AbortError（timeout）進行重試，等待時間 = `Random(0, 2^k - 1) × Slot Time`（k=min(attempt+1, 10)），連續 16 次 timeout 後拋出最終錯誤
    - 將實際 fetch 邏輯抽取為 `_llmFetch()` 獨立函式
  - `frontend/package.json`：版本號更新為 1.14.2
  - 備份檔名: backup-202606261106.zip

## [2026-06-26 12:33]
- **version**: 1.14.3
- **修改要求**：
  1. 提供 LLM 文件管理介面：可 list/review/delete 原始逐字稿所延伸生成的文件（語句優化、翻譯、重點整理等）
  2. 翻譯功能支援對任何文件（原始逐字稿、優化結果、摘要等）進行翻譯，產出文件歸類於同一原始逐字稿下，以生成時間區分
  3. 按 Job 按鈕時自動 refresh job 列表
- **修改規劃**：
  1. 後端 `main.js`：
     - `reco:saveMeta` 新增 `documents` 參數，儲存文件歷史陣列（含 id、type、source、target、content、createdAt）
     - 新增 `reco:deleteLlmDoc` IPC：刪除指定 document，同步清理 `llmResults` 最新版
  2. `preload.js`：新增 `recoDeleteLlmDoc` bridge
  3. 前端 `App.vue`：
     - 新增 `documents: []` data 陣列與 `showLlmDocPanel` 變數
     - 新增 `_addDocument(type, content, source, target)` 方法，LLM 操作完成後自動加入文件歷史
     - 新增 LLM 文件管理面板（模板）：列出所有文件（類型、來源、目標語言、時間、預覽），支援檢視與刪除
     - 新增 `viewLlmDoc(doc)`：將文件內容設為 activeSource 顯示
     - 新增 `deleteLlmDoc(doc)`：呼叫後端刪除，同步更新前端狀態
     - `toggleJobPanel()` 方法：切換面板時自動呼叫 `refreshJobList()`
     - LLM 動作列新增「📄 文件管理」按鈕
  4. i18n：zh-TW/en/ja 各新增 8 條翻譯 key
  5. 版本號 1.14.2 → 1.14.3（patch 新增功能）
- **修改結果**：
  - `frontend/electron/main.js`：`reco:saveMeta` 新增 `documents` 參數；新增 `reco:deleteLlmDoc` IPC
  - `frontend/electron/preload.js`：新增 `recoDeleteLlmDoc` bridge
  - `frontend/src/App.vue`：新增文件管理面板、`_addDocument`、`viewLlmDoc`、`deleteLlmDoc`、`toggleJobPanel` 方法
  - `frontend/src/i18n/zh-TW.js`、`en.js`、`ja.js`：新增 8 條翻譯 key
  - `frontend/package.json`：版本號更新為 1.14.3
   - 備份檔名: backup-202606261233.zip

## [2026-06-26 14:12]
- **version**: 1.14.4
- **修改要求**：修正「歷史記錄 → 音檔列表 → 選特定音檔 → 辨識 → 完成語音轉文字後出現 ❌ An object could not be cloned」的錯誤。
- **修改規劃**：
  1. 問題根源：`saveRecordingMeta` 方法將 Vue reactive Proxy 包裹的 `segments`、`llmResults`、`documents` 直接傳遞給 Electron IPC，V8 結構化克隆無法序列化 Proxy 物件。
  2. 修復方式：在 `saveRecordingMeta` 中對 `segments`、`llmResults`、`documents` 使用 `JSON.parse(JSON.stringify(...))` 深度克隆，使其脫離 Vue Proxy 包裹。
  3. 參考：`doOptimize` 方法（App.vue:846）已使用相同手法避免此問題。
  4. 版本號 1.14.3 → 1.14.4（patch 修復）
- **修改結果**：
  - `frontend/src/App.vue`：`saveRecordingMeta` 方法新增 `clonedSegments`、`clonedLlmResults`、`clonedDocuments` 深度克隆變數，並將 IPC 呼叫參數改為使用克隆後的物件。
  - `frontend/package.json`：版本號更新為 1.14.4
  - 備份檔名: backup-202606261417.zip
  - 編譯成功：`frontend/dist-electron-build2/Recorder-1.14.4-portable.exe`（127 MB）

## [2026-06-26 17:02]
- **version**: 1.15.0
- **修改要求**：更換應用程式圖示（左上角 icon 與主程式 .exe icon）為使用者提供的麥克風圖示。
- **修改規劃**：
  1. 使用者提供 1024x1024 RGBA PNG 圖檔（`assets/app_icon.png`）
  2. 使用 PIL 產生多尺寸 .ico（16/24/32/48/64/96/128/256）→ `assets/app.ico`
  3. 產生 256x256 PNG → `assets/icon.png`，複製到 `frontend/public/icon.png`（Vite 靜態資源）
  4. `frontend/electron/main.js`：`BrowserWindow` 加入 `icon` 屬性（開發模式指向 `assets/icon.png`，生產模式指向 `dist/icon.png`）
  5. `frontend/index.html`：加入 `<link rel="icon" type="image/png" href="/icon.png">` favicon
  6. `frontend/package.json`：`build.win.icon` 已指向 `../assets/app.ico`（無需修改）
  7. 版本號 1.14.4 → 1.15.0（次版號新增功能）
- **修改結果**：
  - `assets/app.ico` — 多尺寸 Windows 圖示（153 KB，含 16/24/32/48/64/96/128/256 八種尺寸）
  - `assets/icon.png` — 256x256 PNG 圖示（87 KB）
  - `frontend/public/icon.png` — Vite 靜態資源，建置後複製到 `dist/icon.png`
  - `frontend/electron/main.js` — `createWindow()` 加入 `icon` 屬性，開發/生產模式各自指向正確路徑
  - `frontend/index.html` — 加入 favicon `<link>` 標籤
  - `frontend/package.json` — 版本號更新為 1.15.0
  - 備份檔名: backup-202606261702.zip

## [2026-06-26 17:17]
- **version**: 1.15.0
- **修改要求**：修正編譯後驗證流程 — `cd /d` 跨磁碟切換後 cmd 的 `&&` 串接導致路徑解析錯誤，誤判檔案不存在；將此注意事項寫入 workrule.md 和 Product_Design_Guidelines.md 三語言版本。
- **修改規劃**：
  1. `.clinerules/workrule.md` 第 2 節新增「編譯後驗證注意事項」：規定驗證產出檔案必須使用完整絕對路徑，避免 `cd /d` 跨磁碟切換造成的路徑解析錯誤
  2. `Product_Design_Guidelines.md` / `_en.md` / `_ja.md` 打包規範章節同步新增「編譯後驗證」段落
  3. 同步 GitHub（git add / commit / push）
- **修改結果**：
  - `.clinerules/workrule.md` — 新增編譯後驗證注意事項（完整絕對路徑檢查、`dir /s` 建議、背景執行緒注意）
  - `Product_Design_Guidelines.md` / `_en.md` / `_ja.md` — 三語言同步新增編譯後驗證段落
  - 已同步至 GitHub

## [2026-06-26 17:36]
- **version**: 1.15.1
- **修改要求**：製作個人自簽 code sign 憑證，並對 portable.exe 進行數位簽署。
- **修改規劃**：
  1. 使用 PowerShell `New-SelfSignedCertificate` 產生自簽 code sign 憑證（RSA 2048, CodeSigning EKU, 3 年效期）
  2. 匯出為 `.pfx` 儲存至 `C:\Certs\recorder_selfsign.pfx`
  3. 修改 `frontend/package.json` 加入 `win.certificateFile`、`certificatePassword`、`signAndEditExecutable`、`signtoolOptions.rfc3161TimeStampServer`
  4. 重新編譯 portable exe（electron-builder 自動呼叫 signtool 簽署所有 .exe）
  5. 驗證簽署結果（Get-AuthenticodeSignature）
  6. 更新文件與 GitHub 同步
- **修改結果**：
  - `C:\Certs\recorder_selfsign.pfx` — 自簽 code sign 憑證（Subject: CN=Cheng-Feng Iron Factory, O=Cheng-Feng Iron Factory, C=TW, 效期至 2029-06-26）
  - `frontend/package.json` — 加入 code sign 設定（certificateFile, certificatePassword, signAndEditExecutable, signtoolOptions）
  - `frontend/dist-electron-build2/Recorder-1.15.1-portable.exe` — 已簽署的 portable exe（127 MB）
  - 所有內含 .exe（whisper-cli.exe、ffmpeg.exe、Recorder.exe、elevate.exe）均已成功簽署
  - 備份檔名: backup-202606261736.zip

## [2026-06-26 22:16]
- **version**: 1.15.1
- **修改要求**：更新設計指引和 workrule.md，加入「完成 portable.exe 後需使用個人 code sign 並進行 portable.exe 簽署」的規範。
- **修改規劃**：
  1. `.clinerules/workrule.md` 第 2 節新增「Code Sign 簽署規範」段落
  2. `Product_Design_Guidelines.md` / `_en.md` / `_ja.md` 新增「Code Sign 簽署規範」章節
  3. 同步 GitHub
- **修改結果**：
  - `.clinerules/workrule.md` — 新增 Code Sign 簽署規範（憑證位置、密碼設定、簽署流程、驗證方式、時間戳記、SmartScreen 注意事項）
  - `Product_Design_Guidelines.md` / `_en.md` / `_ja.md` — 三語言同步新增 Code Sign 簽署規範章節（憑證來源、設定方式、簽署流程、時間戳記、驗證方式、注意事項）
  - 已同步至 GitHub

## [2026-06-27 13:48]
- **version**: 1.15.2
- **修改要求**：補完「LLM 文件管理」功能 — 點擊 📄 文件管理按鈕後面板顯示「尚無 LLM 文件」的空殼問題。
- **修改規劃**：
  1. `frontend/src/App.vue` — `reviewRecording()` 載入時從 `meta.documents` 還原 documents 陣列
  2. `frontend/src/App.vue` — `_pollJobResult()` LLM Job 完成時呼叫 `_addDocument()` 將結果存入 documents
  3. `frontend/src/App.vue` — `startTranscribe()` 重置時清空 documents 陣列
  4. 版本遞增 1.15.1 → 1.15.2
  5. 更新文件（modify_record.md、Product_Design_Guidelines.md、readme.md）
  6. 原始碼備份
- **修改結果**：
  - `frontend/src/App.vue` — 3 處修改：
    - `reviewRecording()` 行 603 後新增 `this.documents = r.meta.documents || []`
    - `_pollJobResult()` 行 887 後新增 `_addDocument()` 呼叫（含 type/source/target 對應）
    - `startTranscribe()` 行 804 後新增 `this.documents = []`
  - 後端 IPC 無需修改（`reco:saveMeta` 已支援 `documents` 欄位，`reco:deleteLlmDoc` 已存在）
  - i18n 無需修改（zh-TW/en/ja 翻譯 key 已完整）
  - 功能驗證：LLM 優化/翻譯/摘要完成後自動新增文件記錄，關閉重開後仍可檢視
  - 備份檔名: backup-202606271348.zip

## [2026-06-29 11:39]
- **version**: 1.16.0
- **修改要求**：新增聲紋說話者標註功能 — 基於 ONNX Runtime + DirectML GPU 加速，對每個 segment 抽取 speaker embedding 並聚類分群。
- **修改規劃**：
  1. 安裝 `onnxruntime-node` 套件（支援 DirectML GPU 加速）
  2. 建立 `frontend/electron/voiceprint.js` 核心模組（模型下載、fbank 特徵抽取、ONNX 推理、cosine similarity 聚類）
  3. `frontend/electron/main.js` 加入 `voiceprint` require + 3 個 IPC handler（status/download/diarize）
  4. `frontend/electron/preload.js` 加入 5 個 bridge 方法（含進度監聽）
  5. `frontend/src/App.vue` 加入「👥 標註說話者」按鈕 + `doDiarize()` 方法
  6. 版本遞增 1.15.2 → 1.16.0
  7. 更新文件、編譯、簽署、同步 GitHub
- **修改結果**：
  - `frontend/electron/voiceprint.js` — 新增聲紋核心模組（~350 行）：
    - `campplus-zh-en.onnx` 模型下載（~50MB，200k 說話者訓練，支援中英日）
    - 80-dim fbank 特徵抽取（純 JS 實作，無 Python 依賴）
    - ONNX Runtime 推理（優先 DML GPU，fallback CPU）
    - Cosine similarity + 貪婪聚類分群（threshold=0.6）
    - ffmpeg 依 segment 時間區間切割音訊
  - `frontend/electron/main.js` — 加入 `voiceprint` require + 3 個 IPC handler
  - `frontend/electron/preload.js` — 加入 5 個 bridge 方法
  - `frontend/src/App.vue` — 加入「👥 標註說話者」按鈕（橙色 #FF5722）+ `doDiarize()` 方法（含模型下載檢查、進度監聽、結果寫入 segments[].speaker）
  - `frontend/package.json` — 版本號更新為 1.16.0，加入 `onnxruntime-node` 依賴
  - 編譯成功：`frontend/dist-electron-build2/Recorder-1.16.0-portable.exe`（188 MB，已 code sign）
   - 備份檔名: backup-202606291139.zip

## [2026-06-29 12:30]
- **version**: 1.17.0
- **修改要求**：UI 重構 — 1) 首頁「混音」改為「混音錄音」；2) 將「麥克風錄音」和「混音錄音」改為「錄音模式」radio 二選一 + 單一「開始錄音」按鈕；3) 「匯入」改為「音檔匯入」；4) Whisper 模型選擇與下載管理移至系統設定介面；5) 首頁「匯出」移至錄音記錄管理介面；6) Whisper 模型預設值全域改為 small。
- **修改規劃**：
  1. 控制列改為 radio 單選群組（🎙️ 麥克風 / 🖥️ 混音錄音）+ 單一動態切換按鈕（⏺ 開始錄音 / ⏹️ 停止錄音）
  2. 移除首頁的模型下拉選單、下載按鈕、匯出按鈕
  3. 設定面板新增「Whisper 模型」區段（下拉選單 + 下載按鈕）+「已下載模型管理」列表（含刪除按鈕）
  4. 錄音記錄工具列與搜尋結果新增「💾 匯出」按鈕
  5. 新增 IPC `model:delete` 支援模型刪除
  6. 三語言 i18n 同步更新（zh-TW/en/ja）
  7. 版本遞增 1.16.0 → 1.17.0
- **修改結果**：
  - `frontend/src/App.vue` — 控制列重構（radio + 單一按鈕）、設定面板新增 Whisper 模型管理區段、移除首頁匯出/模型下拉/下載按鈕、錄音記錄工具列與搜尋結果新增匯出按鈕、`selectedModel` 預設值改為 `'small'`、新增 `deleteModel()`/`exportFromToolbar()`/`exportFromHistory()` 方法
  - `frontend/electron/main.js` — 新增 `model:delete` IPC handler（含路徑安全檢查）、`models:list` 回傳欄位 `size_mb` 改為 `sizeMB`
  - `frontend/electron/preload.js` — 暴露 `deleteModel` bridge 方法
  - `frontend/src/i18n/zh-TW.js` — 新增 15 個 i18n keys（錄音模式、模型管理、匯出位置等）、修改 `control.mixRecord`/`control.import`/`control.mix`/`history.mix` 等值
  - `frontend/src/i18n/en.js` — 同步新增 15 個 i18n keys
  - `frontend/src/i18n/ja.js` — 同步新增 15 個 i18n keys
  - `frontend/package.json` — 版本號更新為 1.17.0
  - `Product_Design_Guidelines.md` — 更新至 v1.8.0，記錄 UI 重構變更
   - 備份檔名: backup-202606291230.zip

## [2026-06-29 13:50]
- **version**: 1.17.1
- **修改要求**：修正語音辨識長時間執行時 UI 永久卡在「辨識中...」的問題。根因：whisper-cli.exe 處理大音檔時可能 hang（GPU loading=0 但程序不退出），且無進度回報、無取消機制、無超時保護，導致使用者只能重啟應用。
- **修改規劃**：
  1. 後端 `runWhisper()` 加入 stderr 進度解析與推送（每 5 秒）、卡住偵測（5 分鐘無輸出自動終止）、絕對超時保護（90 分鐘）
  2. 後端新增 `activeWhisperProcs` Map 追蹤子進程，`transcribe:start` 加入同檔案 in-flight 防護，新增 `transcribe:cancel` IPC handler
  3. 前端 `startTranscribe()` 訂閱 `transcribe:progress` 事件更新進度條與狀態文字，新增取消按鈕與 `cancelTranscribe()` 方法，加入重複觸發防護
  4. preload 新增 `transcribeCancel`、`onTranscribeProgress` 介面
  5. i18n 三語言新增 5 個狀態字串（進度百分比、忙碌提示、取消中、已取消）及 1 個控制按鈕字串
  6. 版本遞增 1.17.0 → 1.17.1
- **修改結果**：
  - `frontend/electron/main.js` — `runWhisper()` 重構：加入 `activeWhisperProcs` Map、進度定時推送（`transcribe:progress`）、stderr 停滯偵測（30 秒檢查一次，5 分鐘無輸出自動 kill）、絕對超時（90 分鐘）、`transcribe:start` 同檔案 in-flight 防護、新增 `transcribe:cancel` IPC handler
  - `frontend/electron/preload.js` — 新增 `transcribeCancel`、`onTranscribeProgress`（含 unsubscribe 回傳）
  - `frontend/src/App.vue` — `startTranscribe()` 加入重複觸發防護、訂閱進度事件更新 `progressPercent` 與狀態文字、`cancelTranscribe()` 方法、進度條旁新增取消按鈕、data 新增 `_transcribingAudioPath`
  - `frontend/src/i18n/zh-TW.js` — 新增 `control.cancelTranscribe`、`status.transcribingPercent`、`status.transcribingBusy`、`status.transcribingCancel`、`status.transcribingCancelled`
  - `frontend/src/i18n/en.js` — 同步新增 6 個 i18n keys
  - `frontend/src/i18n/ja.js` — 同步新增 6 個 i18n keys
  - `frontend/package.json` — 版本號更新為 1.17.1
  - 備份檔名: backup-202606291350.zip

## [2026-06-29 14:48]
- **version**: 1.17.2
- **修改要求**：實測驗證原始檔案可正常 CPU 辨識，GPU (Vulkan, AMD RX 5700 XT) 會 hang，需要 GPU→CPU 自動降級機制
- **修改規劃**：
  1. `runWhisper()` 加入 `anySegmentOutput` 判斷 GPU 是否真正卡住
  2. `transcribe:start` IPC handler 偵測 `gpuStalled` 旗標 → 自動以 CPU 重試
  3. 前端處理 `data.fallback` 顯示降級提示
  4. i18n 三語言新增 `gpuFallback` 字串
  5. 版本遞增 1.17.1 → 1.17.2
- **修改結果**：
  - `frontend/electron/main.js` — `runWhisper()` 加入 `anySegmentOutput` 與 `gpuStalled` 標記（stderr 無任何 `[timestamp]` 輸出即判定 GPU stall）；`transcribe:start` 偵測 `gpuStalled=true` 時自動以 `useGpu=false` 重試一次，重試期間推送 `fallback: true` 進度事件通知前端
  - `frontend/src/App.vue` — `startTranscribe()` 進度訂閱加入 `data.fallback` 判斷，顯示降級訊息
  - `frontend/src/i18n/zh-TW.js` — 新增 `status.gpuFallback`
  - `frontend/src/i18n/en.js` — 新增 `status.gpuFallback`
  - `frontend/src/i18n/ja.js` — 新增 `status.gpuFallback`
  - `frontend/package.json` — 版本號更新為 1.17.2
  - 實測驗證：原始 105 分鐘會議錄音，GPU 模式下 4 次全部 hang，CPU 模式完整正常辨識
  - 備份檔名: backup-202606291448.zip

## [2026-06-29 15:08]
- **version**: 1.17.3
- **修改要求**：使用者回饋 v1.17.1/v1.17.2 的 CPU 模式也失敗 — CPU (model=small) 處理 105 分鐘音檔超過 5 分鐘才開始輸出進度文字，被停滯偵測強制終止。需要修正停滯偵測策略。
- **修改規劃**：
  1. 加入 `estimateAudioDuration()` 函式，根據 WAV payload 大小與 16kHz s16pcm 碼率推算音檔時長
  2. 加入 `getStallTimeoutMs()` 函式：
     - CPU 模式：回傳 `null`（完全不停滯 kill，只靠 90 分鐘絕對超時保護）
     - GPU 模式：根據音檔時長動態計算上限，公式 = `min(audioDuration × 0.5, 30min)`，下限 5 分鐘
  3. 進度推送間隔從 5 秒改為 10 秒，降低開銷
  4. 版本遞增 1.17.2 → 1.17.3
- **修改結果**：
  - `frontend/electron/main.js` — 加入 `estimateAudioDuration()`、`getStallTimeoutMs()`（CPU 回傳 null）；停滯檢查使用動態 timeout；改進度間隔為 10 秒
  - `frontend/package.json` — 版本號更新為 1.17.3
  - 備份檔名: backup-202606291508.zip

## [2026-06-29 15:48]
- **version**: 1.17.4
- **修改要求**：使用者回饋 Vulkan GPU 花了 681 秒完成辨識，但 UI 一直顯示 0%（921s），確認進度百分比計算 bug。
- **修改規劃**：
  1. 根因分析：`lastProgressPercent = Math.min(Math.round((endSec / Math.max(endSec, 1)) * 100), 99)` — 分子分母相同（都是 `endSec`），永遠等於 100% 後被 clamp 到 99%。當第一個 segment 時間戳出現時，UI 直接跳到 99%，在此之前一直顯示 0%。
  2. 修復方案：用 `estimateAudioDuration(audioPath)` 推算的音檔總長度 `totalDurationSec` 作為分母，計算真實進度：`endSec / totalDurationSec * 100`。
  3. 版本遞增 1.17.3 → 1.17.4
- **修改結果**：
  - `frontend/electron/main.js` — `runWhisper()` 中進度計算改為 `endSec / totalDurationSec * 100`
  - `frontend/package.json` — 版本號更新為 1.17.4
  - 備份檔名: backup-202606291548.zip

## [2026-06-29 16:32]
- **version**: 1.18.0
- **修改要求**：
  1. 使用者回饋 v1.17.4 在超過 700s 被強制中斷，log 顯示 `5 beams + best of 5` 導致 CPU 極慢
  2. 錄音分段改為 default 30 分鐘，移除「不分段」選項，新增 60 分鐘選項
  3. 進度百分比在大型音檔仍可能卡在 0%（whisper 尚未輸出時間戳時）
- **修改規劃**：
  1. `runWhisper()` args 加入 `-bs 1 -bo 1`（greedy 解碼），所有 GPU/CPU 模式都使用，預估 CPU 加速 3~5 倍
  2. `segmentMinutes` 預設值從 0 改為 30；設定面板移除「不分段」選項，新增「60 分鐘」選項
  3. 進度推送定時器中，若 `lastProgressPercent === 0` 且 `totalDurationSec > 0`，改用已耗時 / 音檔總長度估算進度
  4. 版本遞增 1.17.4 → 1.18.0
- **修改結果**：
  - `frontend/electron/main.js` — `runWhisper()` args 加入 `-bs 1 -bo 1`；進度推送加入 elapsed/totalDuration 估算 fallback
  - `frontend/src/App.vue` — `segmentMinutes` 預設值改為 30；設定面板移除不分段選項，新增 60 分鐘
  - `frontend/src/i18n/zh-TW.js` — 新增 `settings.min60`
  - `frontend/src/i18n/en.js` — 新增 `settings.min60`
  - `frontend/package.json` — 版本號更新為 1.18.0
  - 備份檔名: backup-202606291632.zip
## [2026-06-29 17:18]
- **version**: 1.19.0
- **修改要求**：使用者回饋「這版本有建立辨識非同步機制嗎」 — 確認要實作 WhisperJobManager 非同步機制，讓 UI 不再卡住、可排隊多個音檔
- **修改規劃**：
  1. 建立 `WhisperJobManager` 類別（後端）：管理 `jobQueue` / `activeJob` / `jobHistory` 三段式狀態
  2. `addJob()` 立即回傳 `jobId`，背景 `processNext()` 串行執行
  3. 同檔案 in-flight 防護 + App 關閉時 `cancelAll()` 統一取消
  4. 持久化至 `~/.recoder/jobs.json`（最近 50 筆）
  5. 新增 7 個 IPC handlers（submit/status/list/cancel/clear/getResult/event）
  6. 前端 `startTranscribe()` 改為 fire-and-forget 模式，訂閱 `onTranscribeEvent` 事件
  7. 前端 `_onTranscribeEvent()` 處理 running/completed/failed/cancelled 狀態
  8. i18n 三語言新增 `status.transcribingJob`
  9. 版本遞增 1.18.0 → 1.19.0
- **修改結果**：
  - `frontend/electron/main.js` — `WhisperJobManager` 類別（~300 行）；7 個 IPC handlers；GPU 自動 fallback 整合；`setMainWindow` / `cancelAll`
  - `frontend/electron/preload.js` — 新增 6 個 bridge 方法（transcribeSubmit/GetStatus/GetResult/List/JobCancel/JobClear + onTranscribeEvent）
  - `frontend/src/App.vue` — `startTranscribe()` 改為 fire-and-forget；新增 `_onTranscribeEvent` 處理事件；新增 `initTranscribeEventListener`
  - `frontend/src/i18n/zh-TW.js` — 新增 `status.transcribingJob`
  - `frontend/src/i18n/en.js` — 新增 `status.transcribingJob`
  - `frontend/package.json` — 版本號更新為 1.19.0
  - 編譯成功：`frontend/dist-electron-build2/Recorder-1.19.0-portable.exe`（188 MB，已 code sign）
  - git commit `65e2054` 並 push 至 GitHub origin master
  - 備份檔名: backup-202606291717.zip

---

## [2026-06-29 18:13] v1.20.0 — 首頁非同步 Job 管理面板

- **版本號**：1.19.0 → 1.20.0
- **修改要求**：在首頁提供非同步 Job List / Status / Show Log / Delete / Stop 功能
- **修改規劃**：
  - 後端 WhisperJobManager 與 LlmJobManager 新增 deleteJob() 方法（支援 active / queued / history 三種狀態）
  - 新增 IPC 	ranscribe:jobDelete 與 llm:jobDelete
  - WhisperJobManager._executeTranscribe 補上 job._proc 指派，使刪除 in-flight job 可終止子進程
  - 前端控制列新增「📋 Jobs」按鈕 + in-flight 徽章
  - 新 Job 面板：雙 tab（轉譯 / LLM），每筆含 ⏹ Stop / 📜 Show Log / 🗑 Delete
  - 獨立 Log Modal：黑底等寬字體，完整 log + 結束時間戳
  - 三語言 i18n（zh-TW / en / ja）新增 jobs: 區塊
- **修改結果：編譯成功（`frontend/dist-electron-build2/Recorder-1.20.0-portable.exe` 188 MB，code sign 已手動補簽成功），備份 `backup-202606291823.zip`
- **備份檔名：backup-202606291823.zip

## [2026-06-29 22:04] v1.20.1 — voice to text 完成後結果未存到「錄音記錄」bug 修正
- **version**: 1.20.0 → 1.20.1（patch 修復 bug）
- **修改要求**：使用者回報「voice to text 完成後結果沒有存到錄音記錄」，亦無法在首頁「錄音記錄」標籤看到該筆錄音。
- **根因分析**：
  1. `frontend/src/App.vue` 的 `initTranscribeEventListener()` 註冊的 IPC 事件回呼是 `() => { if (this.showJobPanel) this.refreshJobList() }`，完全沒有接收 `data` 參數。
  2. `preload.js` 的 `onTranscribeEvent` 是正確地把 IPC `data` 透過 `callback(data)` 傳給前端，但上述回呼並未接收處理。
  3. 結果是 `_onTranscribeEvent(data)` 從未被執行、`completed` 分支內的 `saveRecordingMeta()` 亦永遠不會被呼叫，錄音記錄 metadata 永遠不會被儲入 `reco_data/`。
- **次要影響**：進度條、`busy` flag、Job 狀態全部不會更新；該錄音記錄不會出現在「錄音記錄」列表。
- **修正方案**：把回呼改為 `(data) => { this._onTranscribeEvent(data) }`，使事件中的 `data` 能正確進入 `_onTranscribeEvent` 處理。
- **修改結果**：
  - `frontend/src/App.vue`：`initTranscribeEventListener()` 修正為 `(data) => { this._onTranscribeEvent(data) }`
  - `frontend/package.json`：版本號更新為 1.20.1
- **備份檔名**: backup-202606292204.zip

## [2026-06-29 23:55] v1.20.2 — 「歷史記錄 Review」無音檔誤判 + 聲紋模型檢查改進 + Voiceprint Job 化
- **version**: 1.20.1 → 1.20.2（patch：修复 bug + 架構優化）
- **修改要求**：
  1. 從「歷史記錄 Review」進入後，點「標註說話者」出錯「❌ 無音檔，無法進行說話者標註」（實際有音檔）
  2. 「標註說話者」若模型檔不完整會陷入「無法載入聲紋模型」狀態
  3. 為求一致性與 UI 可觀察性，將「標註說話者」改為非同步 Job、列入 Jobs 面板與 Jobs 徽章統計
- **根因分析**：
  1. `App.vue` `doDiarize()` 直接使用 `this.currentAudioPath`，「Review」進來時該變數為 `null`，導致「無音檔」誤判
  2. `voiceprint.js` `isModelCached()` 只檢查檔案存在，未驗證完整性（下載中斷 / 損壞會烙下 size 0 的檔案）
  3. `voiceprintDiarize` IPC 是同步调用，前端在處理期間無法加入 Jobs 面板，使用者也要等待
- **修正與增強**：
  1. `App.vue doDiarize()` 补上 `recoLoadMeta` 補救，從 `currentRecordingId` 取得 `audioPath`
  2. `voiceprint.js` `isModelCached()` 加檔案大小檢查（≥ 40MB → 視為有效），新增 `resetModel()`
  3. 後端新增 `VoiceprintJobManager` 類別（包含 queue/active/history、persist、log、delete、cancel）與 IPC `voiceprint:jobSubmit/Status/List/Cancel/Delete`、`voiceprint:reset`
  4. 前端 `App.vue`：`voiceprintJobList` 資料、`currentJobList` 計算屬性、`totalInFlightJobs/totalJobs` 多 tab 統計、Voiceprint tab UI、訂閱 `onVoiceprintJobUpdate`、`doDiarize` 改為背景 Job 提交、完成時寫回 speaker 到 `transcriptionResults`、逐字稿顯示 `👤 Speaker_X` 標籤
- **三語言同步**：`zh-TW.js` / `en.js` / `ja.js` 新增 `status.voiceprintDone`、`status.voiceprintFail`、`jobs.type.voiceprint`、`jobs.voiceprintTab`
- **修改結果**：
  - `frontend/electron/main.js`：VoiceprintJobManager + 6 個 IPC handlers
  - `frontend/electron/preload.js`：7 個新 bridge（voiceprintJobSubmit/Status/List/Cancel/Delete/Reset + onVoiceprintJobUpdate）
  - `frontend/electron/voiceprint.js`：`isModelCached` 加檔案大小檢查；新增 `resetModel()`
  - `frontend/src/App.vue`：`doDiarize` 改為 Job 模式；initJobListener 訂閱 `onVoiceprintJobUpdate`；refreshJobList 增載 `voiceprintJobList`；stopJob/deleteJob/openJobLog 新增 voiceprint 分支；逐字稿 speaker tag 顯示
  - `frontend/src/i18n/{zh-TW,en,ja}.js`：新增 voiceprint 相關 i18n keys
  - `frontend/package.json`：版本號更新為 1.20.2
- **後續收尾**（同 session）：三語言 modify_record / readme / Product_Design_Guidelines 同步、`npm run electron:build` 重新編譯 + code sign + 建立備份 + git commit + push

## [2026-06-30 02:00] v1.20.3 — onnxruntime-node native binary 載入修正
- **version**: 1.20.2 → 1.20.3（patch: hotfix）
- **修改要求**: 使用者回報執行「標註說話者」後 Job failed: 無法載入聲紋模型，請先下載模型，但模型實際已下載。
- **根因分析**: onnxruntime-node 透過 native binary (onnxruntime_binding.node) 載入 ONNX 模型。electron-builder 把 
ode_modules 整個壓進 asar，native binary 放在 asar 內無法被 Node.js require 載入，導致 InferenceSession.create() 失敗。模型檔本身沒問題，但 loadModel() 拋出的錯誤訊息模糊地讓使用者誤以為是模型問題。
- **修正方案**: 在 rontend/package.json 的 uild.asarUnpack 加入 "node_modules/onnxruntime-node/**/*"，讓 electron-builder 在打包時把 onnxruntime-node 的所有檔案（含 native binary）解到 pp.asar.unpacked/，Node.js 才能正確 require。
- **修改結果**:
  - rontend/package.json: asarUnpack 加入 
ode_modules/onnxruntime-node/**/*
  - 重新編譯 Recorder-1.20.2-portable.exe + code sign
  - git commit + push
- **備份檔名**: backup-202606300208.zip

## [2026-06-30 02:30] v1.20.4 — downloadModel 完整性檢查
- **version**: 1.20.3 → 1.20.4（patch: hotfix）
- **修改要求**: 使用者回報模型檔下載後是 0.0 MB，再次點「下載」後仍失敗。
- **根因分析**: v1.20.3 修好 native binary 載入後，使用者按下「下載模型」實際下載到 ~/recoder/voiceprint/campplus_cn_en_common_200k.onnx，但因為某些網路/HF 限流情境，response body 是 HTML 文字（"Found. Redirecting to ..."），被當作二進位寫入 .downloading 檔，rename 後即得到 0 bytes 或文字型內容。isModelCached() 只檢查檔案存在與大小 ≥ 40MB 的時候才 OK，但若是 0 bytes 也會回傳 false 永遠卡在「模型未下載」。
- **修正方案**:
  1. downloadModel(): 寫入 .downloading 暫存，成功後才 rename 到正式檔；過程中累積 receivedBytes，總計 < 1 MB 視為下載不完整，刪除檔案並回傳失敗。
  2. diarizeAudio() 在 loadModel() 失敗時再次確認檔案大小；若 size < 1 MB，呼叫 esetModel() 自動刪除損壞檔案，要求使用者重新下載。
- **修改結果**: rontend/electron/voiceprint.js 的 downloadModel() 與 diarizeAudio() 載入邏輯
- **備份檔名**: backup-202606300208.zip

## [2026-06-30 02:45] v1.20.5 — HuggingFace LFS xet-bridge text/plain 重新導向處理
- **version**: 1.20.4 → 1.20.5（patch: hotfix）
- **修改要求**: 即使 v1.20.4 加入了完整性檢查，下載仍然報「下載不完整 (只收到 ... bytes)」。
- **根因分析**: HuggingFace LFS 會透過 us.aws.cdn.hf.co 或 cdn-lfs.huggingface.co 等 xet-bridge 服務下發，**有時返回 HTTP 200 + Content-Type: text/plain + body="Found. Redirecting to https://..."** 而非標準的 302 重新導向。Node.js 原生 https.get 預期 3xx 才有 Location header，無法處理這種 text/plain body 的 "隱性 redirect"，於是直接寫入 text content 當作模型檔。
- **修正方案**: 重寫 etchWithRedirects()，除了 3xx Location header 之外，新增 Content-Type: text/plain 的 peek body 解析：若 body 開頭是 Found. Redirecting to <URL>，把 URL 抓出來遞迴呼叫 etchWithRedirects(next)。整個函式對 edirectsLeft = 5 有上限保護。
- **修改結果**: rontend/electron/voiceprint.js 的 etchWithRedirects() 新增 text/plain 隱性 redirect 處理
- **備份檔名**: backup-202606300208.zip

## [2026-06-30 03:15] v1.20.6 — Voiceprint Job UI 永不重置 + 男聲/小女孩聚類失敗修正
- **version**: 1.20.5 → 1.20.6（patch: hotfix）
- **修改要求**: 使用者回報兩個問題：
  1. 「speaker 辨識 job 完成，但首頁顯示為 0%，按鈕為灰色不能再進行其它 speaker 辨識」（UI 卡死）
  2. 「speaker 辨識無法識別音檔有兩人再說話，一個男人和一個小女孩」（聚類失敗）
- **根因分析**:
  1. **UI 卡死（問題 1）**：App.vue 的 _jobUpdateListener 邏輯判斷分支用的是 data.jobType === 'voiceprint'，但後端 VoiceprintJobManager._sendUpdate() 發送的欄位名稱其實是 data.type。這造成 voiceprint Job 完成事件**默默被忽略**，oiceprintBusy 永遠停在 	rue，導致首頁按鈕一直 disable。
  2. **聚類失敗（問題 2）**: diarizeAudio() 用的 cosine similarity threshold = 0.6，男聲（低沉）與小女孩（高亢）的 embedding 相似度往往 < 0.6，所以兩個不同 speaker 的段落全部被歸到同一群或亂歸。此外 pcm.length > 16000 的 1 秒下限過濾掉了小女孩短促的發聲段落，導致她整段被忽略。
- **修正方案**:
  1. _jobUpdateListener: data.jobType === 'voiceprint' → data.type === 'voiceprint'；同時加強 progress 解析，同時相容 number 與 { percent: 0 } 物件兩種型態。
  2. diarizeAudio():
     - pcm.length > 16000 → pcm.length > 8000（1 秒降至 0.5 秒，捕捉短促的小聲發聲）
     - clusterEmbeddings(validEmbeddings, 0.6) → clusterEmbeddings(validEmbeddings, 0.5)（放寬聚類閾值以容納差異較大的聲紋組合）
- **修改結果**:
  - rontend/src/App.vue: _jobUpdateListener 修正欄位 + progress 解析加強
  - rontend/electron/voiceprint.js: 最小 PCM 8000 + threshold 0.5
  - 重新編譯 Recorder-1.20.2-portable.exe（188,635,584 bytes，2026/6/30 03:16）+ code sign
  - git commit + push
- **備份檔名**: backup-202606300316.zip