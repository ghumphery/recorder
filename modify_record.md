# 修改日誌 (Modify Record)

<!-- 請在下方以 append 方式新增記錄，保留歷史紀錄 -->
<!-- 格式：
## [YYYY-MM-DD HH:mm]
- **version**: x.x.x
- **修改要求**：...
- **修改規劃**：...
- **修改結果**：...
-->

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
