# Recorder — AI 離線會議記錄工具

[![GitHub release](https://img.shields.io/github/v/release/ghumphery/recorder)](https://github.com/ghumphery/recorder/releases)
[![GitHub](https://img.shields.io/github/license/ghumphery/recorder)](https://github.com/ghumphery/recorder)

> 🌐 **語言 / Language / 言語**: [繁體中文](readme.md) | [English](readme_en.md) | [日本語](readme_ja.md)

## 📝 功能簡介

Recorder 是一款完全**離線**的 AI 會議記錄程式，支援：

- 📂 **音檔匯入** — 支援 WAV / MP3 / Opus / OGG / FLAC / M4A 等格式 (ffmpeg)
- 🤖 **語音轉文字** — 使用 whisper.cpp CLI（支援 CPU / Vulkan GPU 加速，預設 small 模型）
- 🎙️ **錄音模式** — 麥克風錄音 / 混音錄音（系統音效 + 麥克風）二選一
- ✨ **LLM 後處理** — 語句優化、多語言翻譯（中文/英文/日文）、重點整理（支援 Ollama 本地/雲端、OpenRouter、SiliconFlow、Gemini）
- 🔑 **獨立 API Key** — 每個 AI provider 可各自儲存 API Key
- 🎮 **GPU 控制** — 可選擇啟用/停用 Vulkan GPU 加速及指定 GPU 編號
- ▶️ **音檔播放** — 逐字稿句子點擊播放對應時段，歷史記錄標示音檔存在狀態
- 🗑️ **刪除管理** — 支援刪除特定錄音記錄與錄音檔
- 📄 **匯出逐字稿** — 從錄音記錄管理介面匯出，支援純文字 (.txt) 或 Markdown (.md) 格式
- 📦 **模型管理** — 在設定面板中管理 Whisper 模型（下載/刪除）
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

從 [GitHub Releases](https://github.com/ghumphery/recorder/releases) 下載最新版 `Recorder-1.21.4-portable.exe`，直接執行即可。

### 自行打包

```bash
cd frontend
npm run electron:build
# 產出：frontend/dist-electron-build5/Recorder-1.21.4-portable.exe
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

### v1.22.1 (2026-07-02) — ResNet-SE 模型可自動下載 (WeSpeaker 官方 ONNX)
- **解決 v1.22.0 限制**：原本 `resnet_se` 的 `url` 為空（公開鏡像 401/404），需手動匯入；本次找到 **WeSpeaker 官方 HuggingFace 鏡像**並補上 URL
- **採用模型**：`Wespeaker/wespeaker-cnceleb-resnet34-LM` (中文 CN-Celeb 訓練)
  - 大小 26.5 MB；256-dim embedding；80-dim fbank @ 16kHz
  - License：CC-BY-4.0
  - **input/output 張量名稱與 campplus 完全相同**（`feats` / `embs`），可與現有 voiceprint.js fbank pipeline 直接相容
  - 下載 URL：`https://huggingface.co/Wespeaker/wespeaker-cnceleb-resnet34-LM/resolve/main/cnceleb_resnet34_LM.onnx`
- **進階選擇**（仍需手動匯入）：`Wespeaker/wespeaker-voxceleb-resnet293-LM` 大模型（114 MB, 256-dim）
- **UI 改動**：零 — 既有「👥 聲紋模型管理」區塊的下載按鈕現在可以直接下載 resnet_se
- **用法**：設定面板 → 聲紋模型管理 → 找到 resnet_se → 點「下載」即開始下載 26.5 MB ONNX

### v1.22.0 (2026-07-02) — 多模型 Speaker Embedding 架構（camplus / ECAPA-TDNN / ResNet-SE）
- **新架構**：重構 `voiceprint.js` 為 `MODEL_REGISTRY` factory 模式，支援多個 ONNX speaker embedding 模型並行管理。
- **支援模型**（`voiceprint.*` i18n keys 新增）：
  - 🏆 **camplus**（預設）：192-dim x-vector，中文友善；提供下載來源
  - **ECAPA-TDNN**：192-dim；提供手動 ONNX 匯入
  - **ResNet-SE**：512-dim；提供手動 ONNX 匯入
- **UI 新增**：設定面板「👥 聲紋模型管理」區塊，列出模型清單、狀態、下載/匯入/設為預設按鈕。
- **IPC 新增**：`voiceprint:listModels`、`voiceprint:importModel`、`voiceprint:setActiveModel`、`voiceprint:openImportDialog`、`voiceprint:getCurrentModel`。
- **自動模型切換**：`loadModel()` 釋放舊 session 後載入新模型；後端用 `modelKey` 路由 `diarize` / `propagate`。
- **使用限制**：因公開 ONNX 鏡像檔 401/404，camplus 為唯一可自動下載的模型；其他模型需使用者手動匯入符合 schema 的 ONNX 檔。

### v1.21.4 (2026-07-01) — 強化多 seed centroid 計算（trimmed mean + outlier rejection）

**回應使用者提問：「針對短語句無法辨識區分說話人員，是否可以採用重覆複製同一句話來提高人員辨識？」**

- **改動**：`propagateSpeakers()` 改用 **trimmed mean centroid** 演算法（≥3 個 seeds 時）：
  1. 計算每個 seed 與其他 seed 的平均 cosine similarity 作為該 seed 的「內部一致性」
  2. 排序後去掉最高/最低各 ⌊n/4⌋ 個 outliers（最多各 1 個）
  3. 用剩餘 seeds 的 mean 作為 centroid
  4. 保留 `centroidInfo.{seedCount, usedCount, droppedCount, internalCoherence}` 供 UI 顯示
- **解決問題**：
  - ✅ **同句重覆標記** 拉偏 centroid — trimmed mean 自然降低極端值權重
  - ✅ **無關句子**（背景音/咳嗽/打字聲）拉偏 centroid — outlier rejection 直接排除
- **使用建議**：
  - 3–5 個 **發音內容明顯不同** 的句子是甜蜜點
  - 10+ 個 seeds 邊際效益遞減
  - ≤2 個 seeds 自動降級為 simple mean（避免過度裁切）
  - 觀察 `centroidInfo.internalCoherence`：> 0.7 表示 seed 一致性高；< 0.5 建議重選 seeds

### v1.21.3 (2026-06-30) — 逐字稿講者標籤顯示聲紋相似度

- `diarizeAudio()` 與 `propagateSpeakers()` 在 result 中加入 `score`（cosine similarity 0~1）
- App.vue speaker tag 旁顯示「[speaker] [score]」如「張三 85」表示 85% 相似度

### v1.21.2 (2026-06-30) — 修正講者標籤編輯後逐字稿變成無音檔狀態

- `saveRecordingMeta()` 當 `currentAudioPath` 為空時主動從舊 metadata 載入保留 `audioPath`
- `reviewRecording()` 不再強制將 `currentAudioPath` 設為 `null`，改為讀取 `r.meta.audioPath` 並自動呼叫 `loadAudioUrl` 載入音檔 URL

### v1.21.1 (2026-06-30) — 修正每次消取/編輯 speaker 都建立新 metadata 檔

- `saveRecordingMeta()` 沿用既有 `currentRecordingId` 不再生新 ID
- 新增 `_scheduleSaveRecordingMeta()` 500ms debounce helper
- `setSegmentSpeaker()` / `doPropagateSpeakers()` / `clearAllSpeakers()` 三處改用 debounced save

### v1.21.0 (2026-06-30) — 半監督式 speaker propagation（手動標註 → 推算所有句子）

- 新增「🪄 依標註推算所有句子」按鈕（紫色 #7B1FA2），半監督式 speaker 標註
- 逐字稿列表每個 segment 新增「+👤」按鈕 → 彈出 Speaker Editor Modal 輸入講者名稱
- 推算 panel 列出 seeds、可調門檻 slider 0.30~0.80、刪除單筆 seed、清除所有標記
- 解決短語句（< 1.5s）無法用無監督聚類區分不同 speaker 的問題

### v1.20.12 (2026-06-30) — 辨識 job log 補上音檔時長檢查與切割決策

- **問題**：在「辨識」的 job log 裡看不到「音檔長度」確認也看不到「是否要切割」的決策依據，使用者只能看到分割後的後續動作（已切成 N 個 chunks、切片 N/M 辨識中…），無法追蹤為何這次走哪條路徑。
- **改動**：在 `WhisperJobManager._executeTranscribe()` 補上 4 條決策鏈 log：
  1. 永遠輸出：`音檔時長檢查: Xs (門檻 3600s，設定 chunkMinutes=Z)`
  2. 不切片分支：`決策: 不切片 (設定為不切片/無法取得音檔時長/音檔長度 < 門檻/其他)`
  3. `進入直接辨識路徑 (runWhisper)`
  4. catch 區塊：`已切換為直接辨識路徑 (runWhisper)`
- **影響**：job log modal 現在能完整呈現「時長檢查 → 為何切片/不切片 → 走了哪條路徑」的決策鏈；既有切片成功路徑 log 行為不變。

### v1.20.11 (2026-06-30) — 聲紋模型下載 hotfix

**修正「下載不完整 (只收到 28283928 bytes)」反覆失敗問題**：

- **問題**：v1.20.7 把聲紋模型最低有效大小設為 40 MB，實際模型只有 ~27 MB（每次下載都收到完全相同的 28,283,928 bytes），永遠會被判為「不完整」而 reject
- **根因**：`MIN_MODEL_SIZE` 錯誤估計。HF LFS UI 雖顯示「~50 MB」，那是 repo metadata + LFS pointer 總體。實測 .onnx binary = 28,283,928 bytes，前 16 bytes = `08 08 12 07 pytorch` 為合法 ONNX protobuf magic
- **修正**：把 `MIN_MODEL_SIZE` 從 40 MB 改為 25 MB（保留 ~7% buffer，避免誤判 truncate/HTML 錯誤）。`isModelCached()` 與 `diarizeAudio()` 的負載模型檢查同步共用此常數
- **若仍有問題**：先用瀏覽器直接到 `https://huggingface.co/welcomyou/campplus-3dspeaker-200k-onnx/resolve/main/campplus_cn_en_common_200k.onnx` 手動下載，命名為 `campplus_cn_en_common_200k.onnx` 放到 `~/recoder/voiceprint/` 目錄即可

### v1.20.10 (2026-06-30) — 跨 chunk 邊界 segment 修正

- 修正跨 chunk 邊界 segment (例如 2900~3100 跨 chunk0/chunk1) 在 v1.20.9 中只讀取 [2900, 3000) 而漏掉 [3000, 3100) 的問題
- 改為 `findChunksForSegment()` 找出所有跨越的 chunks、依序抽取 subPcm、`Buffer.concat()` 拼接

### v1.20.9 (2026-06-30) — 共用 audioChunker 模組

- 抽取 `frontend/electron/audioChunker.js` 共用模組（getAudioDuration / splitLongAudio / chunkLongAudioIfNeeded / cleanupStaleChunks），給 whisper 與 voiceprint 共用
- WhisperJobManager 整合長音檔切片，設定面板新增「轉寫長音檔切片」選項（不切片 / 30 / 40 / 50 / 60 分鐘，預設 50）
- 啟動時自動清掉 `os.tmpdir()/recoder-chunks-*` 與 `voiceprint-chunk-*` 殘留

### v1.20.8 (2026-06-30) — UI 狀態列與 Jobs 樂觀更新

- 播放錄音時狀態列顯示對應檔名 (不再誤顯示音檔列表第一個)
- 五個 Job 起點立即把 pending job 寫入對應 list (transcribeJobList / voiceprintJobList / jobList)，按下按鈕就能看到並能 stop

### v1.20.7 (2026-06-30) — 聲紋標註三項修正

- **不下載重複**：聲紋模型若已下載 (≥25MB) 再呼叫 `downloadModel()` 直接走快取、不重發 HTTPS 請求
- **長音檔切片**：待辨識音檔 ≥60 分鐘時自動切成 ≤50 分鐘 WAV chunks 再進行說話者標註，避免 OOM/timeout
- **辨識容錯**：過短 (<1.5s) segment 自動 ±0.5s padding；embedding numFrames 限制 <5 放寬至 <3；改用兩段式聚類（鄰近滑動視窗合併 + 全域 centroid 聚類），協助辨識女聲/小女孩等高音差異較大的組合且避免全部歸類為 Speaker_1

### v1.19.0 (2026-06-29) — WhisperJobManager 非同步機制

**重大架構升級**：將語音轉文字從同步 IPC 改為背景非同步處理。

- **WhisperJobManager 類別**（後端）：管理 `jobQueue` / `activeJob` / `jobHistory` 三段式狀態
- **Fire-and-forget 模式**：`startTranscribe()` 立即回傳 `jobId`，UI 不再被 IPC 鎖住
- **同檔案 in-flight 防護**：避免重複觸發同音檔辨識
- **事件推送 (`transcribe:event`)**：running / completed / failed / cancelled 即時通知前端
- **持久化至 `~/.recoder/jobs.json`**：最近 50 筆 jobs 紀錄
- **App 關閉時 `cancelAll()`**：統一取消所有 in-flight jobs，避免殭屍進程
- **多工支援**：可排隊多個音檔依序背景執行
- **未阻塞 UI**：105 分鐘音檔轉譯期間可同時搜尋、檢視歷史、編輯其他錄音

### v1.18.0 (2026-06-29) — 5 beams 修正 + 進度估算

- **whisper-cli 改用 greedy 解碼（`-bs 1 -bo 1`）**：移除 beam search 預設值，CPU 模式加速 3~5 倍
- **進度估算 fallback**：當 whisper 尚未輸出時間戳時，使用「已耗時/音檔總長度」估算進度（修正 v1.17.4 進度卡 0% 的 bug）
- **錄音分段預設改為 30 分鐘**：移除「不分段」選項，新增「60 分鐘」選項
- **設定面板優化**：分段選項調整為 5/10/15/30/60 分鐘
- **i18n 三語言**：新增 `settings.min60` 翻譯 key

- **v1.16.0** — 新增聲紋說話者標註功能：基於 ONNX Runtime + DirectML GPU 加速，使用 campplus-zh-en 模型（~50MB，支援中英日）對每個 segment 抽取 speaker embedding 並聚類分群，自動標註 Speaker_1、Speaker_2...
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

## v1.23.0 — 監督式 Speaker Recognition + Profile Database

### 新增功能
- **👤 Speaker Profile Database**（持久化於 ~/recoder/speaker_profiles.json）：可為每個常用講者建立獨立 profile，跨錄音反覆使用。
- **🎯 監督式 Speaker Identification**：依據已建立的 profile 對錄音中的每句做 cosine similarity 匹配，標記講者姓名。
- **🔄 批次回溯標註（Backfill）**：建立新 profile 後一鍵套用所有歷史錄音，無需逐檔手動重做。
- **📂 從短音檔建立 Profile**：可用「重覆同一句話」的短音檔快速建立個人聲紋庫。
- **跨模型支援**：camplus (192-d)、ecapa_tdnn (192-d)、resnet_se (256-d) 各自儲存獨立 profile，避免維度混淆。

### 工作流程
1. 點 **👤 Create Profile** 開啟 Speaker Database panel。
2. 在轉寫稿上標記同一人 2-3 句 → 點 **💾 Build from Labels** 從現有錄音建立 profile，或 **📂 Build from Audio File** 從短音檔建立。
3. 切到目標錄音 → 點 **🎯 Identify Speakers (Supervised)** 一鍵識別。
4. 建立新 profile 後點 **🔄 Apply to All History** 批次回溯標註全部歷史錄音。

### 與 v1.21.0 半監督式差異
| 項目 | v1.21.0 半監督式 | v1.23.0 監督式 |
|------|------------------|------------------|
| 訓練資料 | 同錄音內的 seed 句子 | 跨錄音累積的 profile |
| 短句辨識 | 較差 | 較好（多次累積） |
| 跨錄音搜尋 | 不支援 | 支援（searchBySpeaker） |
| 持久化 | 否 | 是（speaker_profiles.json） |
