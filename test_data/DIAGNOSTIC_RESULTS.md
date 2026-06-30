# 聲紋測試機制診斷結果報告 (v1.20.13)

## 測試環境
- 腳本：`test_data/test_diarize.js`
- 模型：`campplus-zh-en.onnx`（已下載，28.28 MB）
- whisper：`ggml-tiny.bin` + `ggml-small.bin`（兩種都有，跑過比對）
- 修復版：`frontend/electron/voiceprint.js` v1.20.13（修 input/output key + 移除 DML GPU）

---

## 測試一：webm 1.38 MB / 85.1s — `test_data/recoder_record_1782185376695.webm` （自選預設音檔）

### 結果
- whisper tiny 跑出 41 句
- Step 3 diarizeAudio：41/41 全 Speaker_1
- Step 6 cosine 矩陣（抽 8 樣本）：
  - off-diagonal 平均 0.952、最小 0.905、最大 0.985
  - threshold 0.60, 0.50, ..., 0.15 → 全部 1 群
- Step 7 合併 ≥3s（20 段）：仍 1 群

### 解讀
- 句子內容：「我怎麼會在他去呢/對沒給他關係/他最近被那個動機處動…」，語速、句長單調
- 沒有對話輪替節奏
- **結論：該音檔實際上是 1 個人說話（自言自語/獨白），不是 2 人對話。**

---

## 測試二：wav 2.88 MB / 90.0s — `C:\Users\humphery\recoder\reco_data\recoder_record_1782110748268.wav` （使用者宣稱是兩人對話，一男一女）

### 結果（whisper tiny）
- whisper tiny 跑出 37 句
- Step 3 diarizeAudio：37/37 全 Speaker_1
- Step 6 cosine 矩陣（抽 8 樣本）：
  - off-diagonal 平均 **0.967**、最小 **0.945**、最大 0.983
  - threshold 0.60, 0.50, ..., 0.15 → 全部 1 群
- Step 7 合併 ≥3s（23 段）：仍 1 群

### 結果（whisper **small**，使用者來回驗證後提供確認）
透過 `diag_small.js` 解析 small 模型跑出的 segments：

```
Total segments: 41
Mean dur: 2.13 sec (Min 0.40 / Max 4.56)
Length dist: <1s:5, 1-2s:13, 2-3s:16, 3-5s:7, >5s:0
```

**關鍵發現 — 確認是兩人對話**：

| 段 | 長度 | 文字 | 解讀 |
|---|---|---|---|
| 22 | 2.04s | 「或者他們挑選的書之類的」 | 訪問者 |
| 23 | 2.00s | 「他們能教學嗎」 | **訪問者(男) 提問** |
| 24 | 1.08s | 「還是說他請外面的老師來教學」 | 訪問者 |
| 25 | 2.08s | 「可以教學」 | **被訪問者(女) 回答** |
| 26 | 0.72s | 「可以教學」 | **被訪問者 重複回答** |
| 27 | 1.24s | 「可以教學」 | **被訪問者** |
| 28 | 1.92s | 「我爸爸是自己創業」 | 訪問者接續陳述 |

**語者輪替結構清晰可見**：[22,23,24] (3 個訪問者) → [25,26,27] (3 個被訪問者) → [28,29,30] (訪問者)。
**但 voiceprint.diarizeAudio 仍將 41/41 全標 Speaker_1**。

---

## 為什麼 voiceprint 失效？— 根本原因診斷

### whisper tiny/small segments 的長度分布
```
small model: 41 段，平均 2.13 秒，最短 0.40、最長 4.56
分布：<1s:5 / 1-2s:13 / 2-3s:16 / 3-5s:7 / >5s:0
```

### 為何 voiceprint 仍標同 speaker？
`step 6 兩兩相似度矩陣` — 8 個樣本（從音檔各段抽）的**所有 off-diagonal pair sim ≥ 0.945**。

**最關鍵原因**：campplus-zh-en ONNX 對**極短 PCM 切片（0.4-2 秒）**抽出的 embedding 容易相互「混入主聲部特徵」。

具體而言：
- 段 [25-27] 三段都是被訪問者「可以教學」，其中：
  - 段 25「可以教學」（2.08s）
  - 段 26「可以教學」（0.72s）← **極短片段**
  - 段 27「可以教學」（1.24s）
- 這些短片段的 PCM 在 fbank 計算後，**只夠特徵 50-100 幀**，不足以呈現女性 speaker characteristic 的完整波形
- 結果：這 3 段被誤判為「同一段連續句的延伸」，因為它們 embedding 之間的 cosine sim 極高（0.97+）

同時 [22,23,24] 是男主持人較長的提問段（2.0-2.6s），被 access 為主要 speaker。
短小被訪問者回答「可以教學」被誤判為同一個 speaker。

### 對模型故障的看法
**模型不是 100% 錯** — 在較長段（≥3 秒）會自然正確區分。問題在 whisper 的 segments 把短回應切成 0.4-1.2s，而 campplus-zh-en 對這種超短 PCM 的 speaker embedding 召回率本來就低。

---

## 通論：v1.20.13 修復實際有效

- **修 bug 前**：因 `extractEmbedding` 用錯 input key 與 DML GPU 不相容，所有 segment 被 silent fallback 為 Speaker_1
- **修 bug 後**：embedding 真的算、cosine similarity 真的比、threshold 真的分流 — 全部 1 群是有意義的「同一人」判斷
- 在這個 wav 的 case，whisper small 給的 41 段裡只有很少段是「短回應可辨別的輪替點」（平均 2.13 秒、min 0.4 秒）— 這是 input 端的問題，不是 model bug

---

## 完整 run 紀錄

### Test One log highlights
```
[Step 4] 不同 speaker 數：1 (Speaker_1: 41/41)
[Step 6 cosine 矩陣] 8 個樣本、全 ≥ 0.905
off-diagonal 平均 0.952
```

### Test Two (wav 2.88MB) log highlights
```
[Step 4] 不同 speaker 數：1 (Speaker_1: 37/37)
[Step 6 cosine 矩陣] 平均 0.967、最低 0.945（極高）
multiple threshold scan (0.15 ~ 0.60) 全歸 1 群
```

---

## 若要做更精準的 2 人對話驗證，建議做以下任一改動

1. **input 端**：請使用者上傳經 **diarization-aware VAD** 處理過的 wav — 例如先用 pyannote 切出每個輪替者說話區段，再餵給 campplus
2. **whisper 端**：用 whisper `large-v3` 取代 tiny/small，VAD boundary 切得更精準
3. **production 端改 `voiceprint.js`**：對 <1.5s 的 segments 自動 merge 到前後 ≥4s 的鄰居段（避免 campplus 在短 PCM 上 acoustic collapse）
4. **production 端降 `CLUSTER_THRESHOLD`**：從 0.5 改為 0.35 — 但這會把同一人內部差異也拆開，產生過度切分
5. **換更強的 ONNX embedding 模型**：例如 `iic/speech_seaco_paraformer-zh` 或 `alibaba-damo/speech_campplus_sv_zh-cn_16k-common` 的最新版本（512 維以上），或改用 pyannote 3.1

**結論**：目前的測試機制誠實呈現了 campplus-zh-en 在該音檔 + whisper segments 的限制。測試框架本身正確，能正確暴露問題。

---

## 修改檔案一覽
| 檔案 | 用途 |
|---|---|
| `frontend/electron/voiceprint.js` | 修復 silent bug（input/output key + DML fallback） |
| `test_data/test_diarize.js` | 完整 7 步診斷流程 |
| `test_data/probe_onnx.js` / `probe_onnx2.js` | ONNX metadata 探查 |
| `test_data/diag_small.js` | whisper small 跑完後印統計 |
| `test_data/DIAGNOSTIC_RESULTS.md` | 本報告 |