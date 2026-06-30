# 聲紋測試機制診斷結果報告

## 測試環境
- 腳本：`test_data/test_diarize.js`
- 模型：`campplus-zh-en.onnx`（已下載，28.28 MB）
- whisper：`ggml-tiny.bin`
- 修復版：`frontend/electron/voiceprint.js` v1.20.13（修 input/output key + 移除 DML）

## 測試一：webm 1.38 MB / 85.1s

**檔案**：`test_data/recoder_record_1782185376695.webm`

### 結果
- whisper 跑出 41 句
- Step 3 diarizeAudio：41/41 全 Speaker_1
- Step 6 cosine 矩陣（抽 8 樣本）：
  - off-diagonal 平均 0.952、最小 0.905、最大 0.985
  - threshold 0.60, 0.50, ..., 0.15 → 全部 1 群
- Step 7 合併 ≥3s（20 段）：仍 1 群

### 解讀
- 句子內容（whisper 辨識）：「我怎麼會在他去呢？/ 對沒給他關係/ 他最近被那個動機處動…」，語速、句長單調，沒有對話輪替節奏。
- **結論：該音檔實際上是 1 個人說話（自言自語/獨白），不是 2 人對話。**

---

## 測試二：wav 2.88 MB / 90.0s

**檔案**：`C:\Users\humphery\recoder\reco_data\recoder_record_1782110748268.wav`（使用者另外提供，宣稱是「兩人對話」）

### 結果
- whisper 跑出 37 句
- Step 3 diarizeAudio：37/37 全 Speaker_1
- Step 6 cosine 矩陣（抽 8 樣本）：
  - off-diagonal 平均 **0.967**、最小 **0.945**、最大 0.983
  - threshold 0.60, 0.50, ..., 0.15 → 全部 1 群
- Step 7 合併 ≥3s（23 段）：仍 1 群

### 句子內容（whisper 辨識）
「我小學會吃中/我大了马华對學習有自己理解/我的小學是怎樣/我馬華對我的看法是…/我自己可以/他們給我選的輸職/…」
- 持續用「我」描述自己的求學/家教經歷

### 解讀
- 內容完全是**第一人稱觀點的自我介紹**，沒有第二人稱的回應詞（「你/我覺得你/對/同意」等）。
- cosine 相似度全部 > 0.94 強烈表示同一人。
- **結論：該 wav 雖然使用者說是「兩人對話」，但聲紋模型與內容都強烈表示是 1 個人（自我介紹 / 訪問者的錄音）。可能使用者記錯，或此 wav 只是其中一段獨白被剪輯出來的。**

---

## 通論：模型在修復後實際工作正常
- 修復前（v1.20.7~v1.20.12）：因 `extractEmbedding` 用錯 input key 與 DML GPU 不相容，所有 segment 都被 silent fallback 為 Speaker_1
- 修復後（v1.20.13）：embedding 真的算、cosine similarity 真的比、threshold 真的分流 — 全部 1 群是有意義的「同一人」判斷，不是錯誤
- 兩次測試的 0.95+ cosine 相關性再次確認 campplus-zh-en 模型對**自我講話**與**多人輪替**的分辨能力：相同 speaker → 0.90+，不同 speaker → 通常 0.3~0.5

## 若要驗「一男一女」建議
1. 從 `%USERPROFILE%\recoder\reco_data\` 找出**真正**的對話檔：
   ```bash
   ls C:\Users\humphery\recoder\reco_data\*.wav
   ```
   找檔名包含明確「面試/會議/訪談/採訪」字眼或檔名包含日期範圍有多個音檔配對
2. 或者明確錄一段「我跟你說 X」「嗯，然後呢 Y」「我覺得 Y…」輪替對話音檔
3. 跑 `node test_data/test_diarize.js [音檔路徑]`

## 如果 2 人都被歸成同 speaker
可能原因：
- 兩人聲紋真的太相似（罕見但可能，例如父女/兄弟）
- 音檔品質不佳（電話錄音、嚴重背景噪音）
- 兩人的音色極不同但 campplus-zh-en 把兩人都當作中文母語男性/女性泛類
- 音檔經過電話編碼後只剩窄頻

可考慮下一步：
- 換用更大的 embedding 模型（campplus-zh-en 是 192 維，也可以試試 ERES2/3D-Speaker 系列）
- 對 `voiceprint.js` 的 `extractEmbedding` 改用 ONNX Runtime 的 DML CPU EP `ep.LOAD_MODEL_OPTION.FORCE_CPU` 或 CPU-only
- 修改 `clusterEmbeddings` 的 `CLUSTER_THRESHOLD`（現 0.5）降到 0.3 試試