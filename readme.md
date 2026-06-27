# Recorder — AI 離線會議記錄工具

[![GitHub release](https://img.shields.io/github/v/release/ghumphery/recorder)](https://github.com/ghumphery/recorder/releases)
[![GitHub](https://img.shields.io/github/license/ghumphery/recorder)](https://github.com/ghumphery/recorder)

> 🌐 **語言 / Language / 言語**: [繁體中文](readme.md) | [English](readme_en.md) | [日本語](readme_ja.md)

## 📝 功能簡介

Recorder 是一款完全**離線**的 AI 會議記錄程式，支援：

- 📂 **匯入音檔** — 支援 WAV / MP3 / Opus / OGG / FLAC / M4A 等格式 (ffmpeg)
- 🤖 **語音轉文字** — 使用 whisper.cpp CLI（支援 CPU / Vulkan GPU 加速）
- 🎙️ **錄音支援** — 麥克風錄音 + 線上會議混音（系統音效 + 麥克風）
- ✨ **LLM 後處理** — 語句優化、多語言翻譯（中文/英文/日文）、重點整理（支援 Ollama 本地/雲端、OpenRouter、SiliconFlow、Gemini）
- 🔑 **獨立 API Key** — 每個 AI provider 可各自儲存 API Key
- 🎮 **GPU 控制** — 可選擇啟用/停用 Vulkan GPU 加速及指定 GPU 編號
- ▶️ **音檔播放** — 逐字稿句子點擊播放對應時段，歷史記錄標示音檔存在狀態
- 🗑️ **刪除管理** — 支援刪除特定錄音記錄與錄音檔
- 📄 **匯出逐字稿** — 純文字 (.txt) 或 Markdown (.md) 格式
- 🔒 **零網路依賴** — 模型下載一次後，完全離線執行（無需 Flask / port 5199 / Python）

## 🚀 開發模式執行

### 前置需求

- Node.js 20+、npm
- 語音模型（GGML tiny ~77MB，首次下載後快取）
- **ffmpeg.exe**（約 149MB，因超過 GitHub 100MB 限制未納入 repo，請自行下載）：
  - 從 [gyan.dev FFmpeg Builds](https://www.gyan.dev/ffmpeg/builds/) 下載 `ffmpeg-release-essentials.zip`
  - 解壓縮後將 `ffmpeg.exe` 放置於專案根目錄的 `ffmpeg/` 資料夾中

### 執行

```bash
cd frontend
npm run electron:dev
```

### 下載打包版

從 [GitHub Releases](https://github.com/ghumphery/recorder/releases) 下載最新版 `Recorder-1.15.0-portable.exe`，直接執行即可。

### 自行打包

```bash
cd frontend
npm run electron:build
# 產出：frontend/dist-electron-build2/Recorder-1.15.0-portable.exe
```

### 直接運行打包版

```
frontend\dist-electron\win-unpacked\Recorder.exe
```

### 音檔播放注意事項

- 點擊逐字稿句子會從該句的起始時間開始播放，播放會自然延續到後續句子（不自動跳句）
- 播放中可點擊「⏹️ 停止播放」按鈕立即停止
- 切換到其他錄音記錄或 Review 時會自動停止舊音檔
- 從「音檔列表」進行辨識時，程式會同時產生一份 16kHz mono WAV 保存到 `reco_data`，確保播放與辨識使用同一份音檔、時間戳對齊

## 🧰 系統需求

- **作業系統**：Windows 10/11
- **CPU**：x64，支援 AVX2 指令集 (2013 年後 CPU 皆支援)
- **記憶體**：建議 4GB 以上
- **硬碟空間**：約 300MB (不含語音模型，模型 tiny 77MB / base 148MB / small 488MB)
- **GPU（選用）**：支援 Vulkan 1.0+ 的 GPU，可在設定中啟用/停用及選擇 GPU 編號
- **無需 Python**：完全使用 Node.js + C++ CLI 工具
- **Vulkan SDK**：若需自行編譯 Vulkan 版本，需安裝 [Vulkan SDK](https://vulkan.lunarg.com/)

## 🔒 資安與隱私

- 所有錄音與轉譯資料僅存於本機，不上傳雲端
- 僅在首次下載語音模型時連線 Hugging Face
- 無後端伺服器 (無 Flask、無 port 5199)，所有處理在 Electron IPC 中完成
- 詳細檢查清單請參閱 `security.md`（僅供開發參考，未納入 repo）

## 🎯 使用流程

1. 開啟程式 → 點擊「匯入音檔」選擇已錄好的音訊檔案
2. ffmpeg 自動轉換為 16kHz mono WAV
3. 選擇辨識模型 (tiny/base/small)，越大越準但越慢
4. 點擊「開始辨識」→ 等待進度完成
5. 檢視逐字稿
6. 點擊「匯出」儲存結果 (.txt 或 .md)

## ⚙️ 模型選項

- **tiny** (77 MB) — 最快，適合即時測試
- **base** (148 MB) — 平衡速度與準確度
- **small** (488 MB) — 最準確，適合高品質會議記錄

## 📦 版本歷史

- **v1.15.2** — 補完 LLM 文件管理功能：LLM 優化/翻譯/摘要完成後自動存入 documents 歷史陣列，支援檢視、刪除、持久化儲存；關閉 App 重新開啟後仍可檢視歷史 LLM 文件
- **v1.15.1** — 製作個人自簽 code sign 憑證，對 portable.exe 進行數位簽署；更新設計指引與 workrule.md 加入 Code Sign 簽署規範
- **v1.15.0** — 更換應用程式圖示：左上角視窗 icon 與主程式 .exe icon 更新為麥克風圖示；使用 PIL 產生多尺寸 .ico（16/24/32/48/64/96/128/256）與 256x256 PNG；`BrowserWindow` 加入 `icon` 屬性；`index.html` 加入 favicon
- **v1.14.3** — 新增 LLM 文件管理面板：可 list/review/delete 原始逐字稿延伸生成的文件（優化/翻譯/摘要），以生成時間區分；翻譯功能支援對任何文件（原始/優化/摘要）進行翻譯；Job 面板開啟時自動 refresh
- **v1.14.2** — 修正 LLM 分批處理（optimize）因 30 秒 timeout 導致「The user aborted a request」錯誤：`callLLM()` 的 AbortController timeout 從 30 秒增加至 120 秒；加入 CSMA/CD 風格 exponential backoff retry 機制（Slot Time=2s，最多 16 次重試），僅對 timeout 進行重試，等待時間 = `Random(0, 2^k - 1) × Slot Time`
- **v1.14.1** — 修正「✨ 優化」報錯 `An object could not be cloned`：Vue reactive 陣列（Proxy）無法通過 Electron IPC 序列化，傳遞前以 `JSON.parse(JSON.stringify(...))` 轉為純 JSON 物件
- **v1.14.0** — 導入 LLM Job Manager 非同步處理機制：Token 限制偵測與自動分批處理（CJK 1.5 token/字、ASCII 0.25 token/字估算）；逐句優化保留原始時間戳對齊（`[N] 優化文字` 格式解析）；Job 狀態機 `pending → running → completed/failed/cancelled`；前端 Job 列表面板含進度條、log、取消按鈕
- **v1.13.2** — 修正多語言重構造成的介面 bug：`mounted()` 生命週期鉤子被意外移除，導致設定中的 AI 供應商選單與 whisper 模型選單空白；補回 `mounted()` 依序呼叫 `fetchModels()`、`fetchLlmProviders()`、`loadSettings()`
- **v1.13.1** — 編譯產出最新版 portable exe（127 MB），修正 Windows Defender 鎖定 `app.asar` 的編譯問題
- **v1.13.0** — 多語言 UI 支援（繁體中文/English/日本語）：i18n 語言檔（zh-TW.js/en.js/ja.js），首次啟動顯示語言選擇對話框，設定面板可切換介面語言；多語言文件（readme_en.md、readme_ja.md、modify_record_en.md、modify_record_ja.md）；更新 workrule.md 加入多語言文件維護規範
- **v1.12.2** — 修正「移動所選」對話框無法顯示子目錄的問題：`loadAllFolders()` 從未被呼叫導致 `allFolders` 永遠為空；新增後端 `reco:listAllFolders` IPC 遞迴掃描所有子目錄；點擊「移動所選」時先載入 folder 列表再顯示彈窗
- **v1.12.1** — 編譯產出最新版 portable exe（127 MB），修正 Windows Defender 鎖定 `app.asar` 的編譯問題
- **v1.12.0** — 樹狀目錄管理：錄音記錄改為樹狀檢視（folder create/delete/rename），支援多選批次移動/刪除；移除錄音記錄列表的 LLM 按鈕（優化/翻譯/摘要）；修復 label 儲存（遞迴掃描子目錄）
- **v1.11.0** — 新增 Label 管理功能：錄音記錄可新增/修改/刪除標籤（🏷️ 按鈕），支援依 label 篩選記錄列表；搜尋結果顯示 labels 並支援「📖 跳轉」到真實錄音記錄的相對句子位置；AI 查詢 context 加入 labels 資訊
- **v1.10.7** — 修正 whisper 時間戳不精確導致播放重複：移除自動跳句機制，改為連續播放僅更新高亮句子。根本原因是 whisper 的 `seg.end` 可能比實際語音結束時間早，自動跳句會導致句子結尾被截斷並重複播放下句開頭
- **v1.10.6** — 修正下一句開頭重複播放：`seekAndPlay()` 改為事件驅動序列化流程，先等待 `pause` 事件完成暫停，再設定 `currentTime` 並等待 `seeked` 事件完成 seek，最後才呼叫 `play()`，確保舊緩衝區內容不會洩漏造成重複播放
- **v1.10.5** — 修正播放延遲與開頭重複問題：1) `reviewRecording()` 不再呼叫 `stopPlayback()`，避免清除已載入的音檔 URL，解決點擊播放需等待 10~30 秒的問題；2) `seekAndPlay()` 先 `pause()` 再 seek，避免舊緩衝區內容在 seek 完成前洩漏，解決下一句開頭重複播放的問題
- **v1.10.4** — 修正特定句子播放時，第二句之後每句開頭會重複播放前幾個字的問題：`playSegment()` 改為檢查 `audio.readyState`，已載入中繼資料時直接 seek 不重設 `src`，避免瀏覽器重載音檔造成開頭重複
- **v1.10.3** — 修正音檔播放問題並新增停止播放功能：1) 新增「⏹️ 停止播放」按鈕；2) 切換逐字稿（Review / 播放其他錄音）前自動停止舊音檔；3) 自動跳到下一句的判斷加入 300ms 緩衝，避免語音未完就提前跳句；4) 從音檔列表辨識時，將轉換後的 WAV 保存到 `reco_data`，讓 metadata 儲存與播放都使用同一份音檔，解決文字與語音時間戳不對齊的問題
- **v1.10.2** — 修正音檔播放相關 bug：1) 點擊句子播放時，改在音檔 `loadedmetadata` 完成後才設定 `currentTime` 並播放，解決播放失敗或只播一小段的問題；2) 從歷史記錄播放時不再自動從第 0 句開始，改為僅載入音檔與逐字稿，讓使用者自行選擇起始句子
- **v1.10.0** — 新增音檔播放功能（逐字稿句子點擊播放對應時段）、刪除管理（錄音記錄/音檔）、錄音記錄標示音檔存在狀態
- **v1.8.9** — 修正長音訊辨識時 whisper 模型產生 hallucination 重複文字的 bug：加入 whisper-cli 反幻覺參數（`-ml 60`/`-nth 0.7`/`-wt 0.03`/`-bs 1`/`--suppress-nst`/`--no-fallback`）與 Python 端 `_deduplicate_repeats()` 後處理去重邏輯
- **v1.8.4** — 修正「混音 + 分段錄音」模式下語音轉文字只進行第一段的 bug：將分段索引作為參數傳入 `transcribeBlob`，避免非同步競態條件
- **v1.8.3** — 錄音分段儲存的原始音檔（WAV）永久保留至 `C:\Users\<user>\recoder\reco_data\`
- **v1.8.2** — 修正 title bar 未顯示版本號：攔截 `page-title-updated` 事件，防止 HTML `<title>` 覆蓋 Electron 視窗標題
- **v1.7.5** — 移除 VAD 即時辨識功能：簡化錄音流程，錄音完成後再進行完整辨識
- **v1.5.4** — model、log、settings 統一儲存至 `C:\Users\<user>\recoder\`（新增 `userDataPath()` 函式）
- **v1.5.3** — 修正「An object could not be cloned」錯誤（Vue Proxy 透過 spread 轉為純物件傳遞）；設定檔路徑改為 `C:\Users\<user>\recoder\settings.json`
- **v1.5.2** — 修正「儲存設定」按鈕沒有反應的問題：加入 `window.electronAPI` 不存在時的提示、檢查 `result.success`、`catch` 區塊顯示錯誤訊息而非靜默
- **v1.5.0** — 跨版本設定檔自動遷移（舊版 llmApiKey 轉為新版 apiKeys 物件）；Vulkan GPU 啟用/停用開關及選擇 GPU 編號；重新編譯 whisper-cli.exe 啟用 Vulkan backend
- **v1.4.0** — 重大增強：每個 AI provider 獨立 API Key 可預先設定；模型下載進度條；model/log/settings 存放於執行檔目錄（portable 模式適用）
- **v1.3.3** — 修正 LLM 錯誤處理：非 Ollama 提供商未輸入 API Key 時顯示明確錯誤訊息；修正 Ollama Cloud baseUrl 正確為 `https://ollama.com/v1`
- **v1.3.1** — 新增 Ollama Cloud 提供商：將 Ollama 拆分為「Ollama (本地)」與「Ollama Cloud」兩個選項，Ollama Cloud 使用 OpenAI-compatible API 需 API Key
- **v1.3.0** — 新增 LLM 後處理功能：支援語句優化、中日翻譯、重點整理；支援 Ollama、OpenRouter、SiliconFlow、Gemini 四種提供商
- **v1.2.0** — 完全移除 Python + Flask 後端：改為純 Node.js IPC 架構，直接呼叫 whisper-cli.exe (whisper.cpp) 與 ffmpeg.exe，無需 port 5199、無需 Python 環境
- **v1.1.0** — 架構遷移：從 PyQt5 完全遷移至 Electron + Vue.js + Flask 架構，後端獨立打包為 RecoderBackend.exe
- **v1.0.0 ~ v1.0.6** — 舊版 PyQt5 + faster-whisper (ctranslate2)，多次迭代解決 DLL 衝突問題

## 📁 專案結構

```
recorder/
├── frontend/                     # Electron + Vue.js 前端
│   ├── package.json              # 專案設定與版本號
│   ├── vite.config.js
│   ├── index.html
│   ├── src/
│   │   ├── main.js               # Vue 應用入口
│   │   ├── App.vue               # 主介面元件 (IPC 呼叫後端)
│   │   └── i18n/                 # 多語言支援
│   │       ├── index.js
│   │       ├── zh-TW.js
│   │       ├── en.js
│   │       └── ja.js
│   ├── electron/
│   │   ├── main.js               # Electron 主進程 (所有後端邏輯)
│   │   └── preload.js            # preload script (IPC contextBridge)
│   └── dist-electron/            # electron-builder 產出
├── whisper_cli/                  # whisper-cli.exe + DLL
├── model/                        # GGML 語音模型
├── whisper_cpp/                  # whisper.cpp 原始碼 (編譯用)
├── assets/                       # 資源檔
├── backup/                       # 原始碼備份
├── Product_Design_Guidelines.md
├── modify_record.md
├── modify_record_en.md
├── modify_record_ja.md
├── readme.md
├── readme_en.md
└── readme_ja.md
```

## 🏗️ 架構概覽

```
使用者操作 → Electron Vue.js (前端)
                 ↓ IPC (無 HTTP、無 port)
             Electron main.js (Node.js)
              ├── ffmpeg.exe → 音檔轉換
              ├── whisper-cli.exe → 語音轉文字
              ├── https.get → 模型下載
              └── fs.writeFile → 匯出逐字稿