$content = @"

## [2026-06-30 23:45] v1.21.2 — 修正講者標籤編輯後逐字稿變成無音檔狀態

- **version**: 1.21.1 → 1.21.2（patch: hotfix）
- **修改要求**: 使用者反映 v1.21.1 後，「從歷史記錄 Review 進入逐字稿 → 編輯講者標籤」會使該記錄在歷史列表中變成「無音檔」狀態（原本明明有音檔）。
- **根因分析**:
  1. `reviewRecording()` 進入時將 `this.currentAudioPath = null` 與 `this.audioLoaded = false`。
  2. 講者標籤編輯（`setSegmentSpeaker()`）觸發 `_scheduleSaveRecordingMeta()` → `saveRecordingMeta()`。
  3. `saveRecordingMeta()` 第 1156 行寫死 `const audioPath = this.currentAudioPath || ''`，`null` 進來後變成空字串。
  4. IPC `recoSaveMeta` 被叫起時傳入 `audioPath: ''` 覆寫原本 metadata 中的 `audioPath` 欄位為空字串。
  5. 下次 `reco:list` 讀歷史時 `hasAudio` 判斷變成 false，逐字稿在歷史中變成「無音檔」狀態。
- **修正方案**:
  1. `frontend/src/App.vue` `saveRecordingMeta()`：當 `currentAudioPath` 為空且 `currentRecordingId` 存在時，主動呼叫 `recoLoadMeta` 從舊 metadata 載入原本的 `audioPath` 保留，避免覆寫。
  2. `frontend/src/App.vue` `reviewRecording()`：不再將 `currentAudioPath` 強制設為 `null`，改為讀取 `r.meta.audioPath` 或 `null`；同時在進入時若 `audioPath` 存在則主動呼叫 `loadAudioUrl` 載入音檔 URL，讓「Review」進入後逐字稿可點擊播放。
  3. `frontend/package.json`: version 1.21.1 → 1.21.2
  4. `Product_Design_Guidelines.md` 版本號 / 修改日期一併更新
  5. 三語 modify_record 新增本條目
- **修改結果**:
  - 從歷史 Review 進入逐字稿後，無論編輯幾次講者標籤、推算、清除，音檔連結 (`audioPath`) 都不會被洗掉。
  - 「有音檔」狀態記號在歷史列表中永久保持。
  - Review 進入後逐字稿可點擊播放（原來需手動先點「▶️ 播放」才會載入音檔，現自動載入）。
- **備份檔名**: 將於備份步驟產生
"@
Add-Content -Path "c:\Users\humphery\coding\recoder\modify_record.md" -Value $content -Encoding utf8
Add-Content -Path "c:\Users\humphery\coding\recoder\modify_record_en.md" -Value $content -Encoding utf8
Add-Content -Path "c:\Users\humphery\coding\recoder\modify_record_ja.md" -Value $content -Encoding utf8
Write-Host "Done appending v1.21.2 entries"