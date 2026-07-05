$dir = 'C:\Users\humphery\coding\recoder'

# ── readme.md (zh-TW) ──
$readmeZh = @"

## v1.23.0 — 監督式 Speaker Recognition + Profile Database

### 新增功能
- **👤 Speaker Profile Database**（持久化於 `~/recoder/speaker_profiles.json`）：可為每個常用講者建立獨立 profile，跨錄音反覆使用。
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
"@
Add-Content -Path "$dir\readme.md" -Value "`n$readmeZh" -Encoding UTF8

# ── readme_en.md ──
$readmeEn = @"

## v1.23.0 — Supervised Speaker Recognition + Profile Database

### New Features
- **👤 Speaker Profile Database** (persisted at `~/recoder/speaker_profiles.json`): Create independent profiles for each frequently used speaker, reusable across recordings.
- **🎯 Supervised Speaker Identification**: Cosine similarity match each segment against all established profiles.
- **🔄 Batch Backfill**: After creating a new profile, apply it to all historical recordings with one click.
- **📂 Build Profile from Audio File**: Quickly build voiceprint library using short audio with repeated phrases.
- **Cross-model Support**: campplus (192-d), ecapa_tdnn (192-d), resnet_se (256-d) each store independent profiles to avoid dimension mixing.

### Workflow
1. Click **👤 Create Profile** to open Speaker Database panel.
2. Mark 2-3 segments of the same speaker on transcripts → click **💾 Build from Labels** to build from current recording, or **📂 Build from Audio File** to build from a short audio file.
3. Switch to target recording → click **🎯 Identify Speakers (Supervised)** for one-click identification.
4. After creating a new profile, click **🔄 Apply to All History** to batch backfill all historical recordings.

### Differences from v1.21.0 Semi-supervised
| Item | v1.21.0 Semi-supervised | v1.23.0 Supervised |
|------|--------------------------|----------------------|
| Training data | Seed segments within same recording | Cross-recording accumulated profile |
| Short-utterance | Weaker | Stronger (cumulative) |
| Cross-recording search | Not supported | Supported (searchBySpeaker) |
| Persistence | No | Yes (speaker_profiles.json) |
"@
Add-Content -Path "$dir\readme_en.md" -Value "`n$readmeEn" -Encoding UTF8

# ── readme_ja.md ──
$readmeJa = @"

## v1.23.0 — 教師あり Speaker Recognition + Profile Database

### 新機能
- **👤 Speaker Profile Database**（`~/recoder/speaker_profiles.json` に永続化）：よく使う話者ごとに独立した profile を作成し、録音を跨いで再利用。
- **🎯 教師あり Speaker Identification**：確立された全 profile に対して各 segment の cosine 類似度で照合。
- **🔄 一括バックフィル**：新規 profile 作成後、ワンクリックで全履歴録音に適用。
- **📂 短音声ファイルから Profile 作成**：同じフレーズを繰り返す短音声で迅速に声紋ライブラリを構築。
- **マルチモデル対応**：camplus (192-d)、ecapa_tdnn (192-d)、resnet_se (256-d) はそれぞれ独立 profile を保存、次元混在を防止。

### ワークフロー
1. **👤 Create Profile** をクリックして Speaker Database パネルを開く。
2. 転写結果で同一話者の 2-3 segment をマーク → **💾 Build from Labels** で現録音から構築、または **📂 Build from Audio File** で短音声から構築。
3. 対象録音を切替 → **🎯 Identify Speakers (Supervised)** をクリックして一括識別。
4. 新規 profile 作成後、**🔄 Apply to All History** をクリックして全履歴録音を一括バックフィル。

### v1.21.0 半教師ありとの違い
| 項目 | v1.21.0 半教師あり | v1.23.0 教師あり |
|------|---------------------|-------------------|
| 学習データ | 同一録音内の seed segment | 録音を跨いだ累積 profile |
| 短文認識 | 弱 | 強（累積効果） |
| 録音跨ぎ検索 | 非対応 | 対応（searchBySpeaker） |
| 永続化 | なし | あり（speaker_profiles.json） |
"@
Add-Content -Path "$dir\readme_ja.md" -Value "`n$readmeJa" -Encoding UTF8

# ── Product_Design_Guidelines.md ──
$pdgZh = @"

## 17. Speaker Profile Database（v1.23.0）

### 設計動機
- v1.21.0 半監督式 propagation 對短句（< 3s）辨識率不足，需要在同一錄音內重複出現同一人的多個句子才能建立可靠 centroid。
- 使用者提出「重覆複製同一句話」可作為訓練樣本的需求。
- 需要跨錄音、跨時段反覆使用的持久化 speaker reference。

### 設計原則
- **持久化 JSON**：存於 `~/recoder/speaker_profiles.json`，按 modelKey 分組避免不同 embedding 維度混淆。
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
   - 透過 `onVoiceprintBackfillProgress` 事件回報進度
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
- **progress 顯示**：backfill 進行中時 status bar 顯示 `Backfilling 3/15`

### 已知限制
- profile 必須與其 modelKey 一致使用；切換 model 後舊 profile 不可用
- 短音檔建立 profile 時若 < 1.5s 可能 centroid 不穩定（顯示低 coherence 提示使用者重做）
- 跨資料夾 backfill 不自動限速，可能 CPU 短時間高負載
"@
Add-Content -Path "$dir\Product_Design_Guidelines.md" -Value "`n$pdgZh" -Encoding UTF8

Write-Host "OK: readme × 3 + Product_Design_Guidelines §17 appended"