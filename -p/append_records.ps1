$zh = @'

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
'@

$en = @'

## [2026-06-29 22:04] v1.20.1 — Fix bug: voice-to-text result not saved to "Recording History"
- **version**: 1.20.0 → 1.20.1 (patch bug fix)
- **Issue**: User reported "After voice-to-text completes, the result is not saved to Recording History", and the recording cannot be seen under the "Recording History" tab on the home page.
- **Root Cause**:
  1. In `frontend/src/App.vue`, the IPC event callback registered by `initTranscribeEventListener()` was `() => { if (this.showJobPanel) this.refreshJobList() }`, which did not accept the `data` argument at all.
  2. `preload.js`'s `onTranscribeEvent` correctly forwards the IPC `data` to the renderer via `callback(data)`, but the above callback did not accept or handle it.
  3. As a result, `_onTranscribeEvent(data)` was never executed, and `saveRecordingMeta()` inside the `completed` branch was never called — so recording metadata was never written to `reco_data/`.
- **Side Effects**: The progress bar, `busy` flag, and Job status would never update; the recording would not appear in the "Recording History" list.
- **Fix**: Changed the callback to `(data) => { this._onTranscribeEvent(data) }`, so that `data` from the event is properly handled by `_onTranscribeEvent`.
- **Result**:
  - `frontend/src/App.vue`: `initTranscribeEventListener()` callback corrected to `(data) => { this._onTranscribeEvent(data) }`
  - `frontend/package.json`: Version bumped to 1.20.1
- **Backup**: backup-202606292204.zip
'@

$ja = @'

## [2026-06-29 22:04] v1.20.1 — voice-to-text 完了後結果が「録音履歴」に保存されないバグを修正
- **version**: 1.20.0 → 1.20.1（patch バグ修正）
- **修正要求**: ユーザーから「voice-to-text 完了後、結果が録音履歴に保存されない」との報告。ホームページの「録音履歴」タブにも該当録音が表示されない。
- **根本原因**:
  1. `frontend/src/App.vue` の `initTranscribeEventListener()` で登録された IPC イベントコールバックが `() => { if (this.showJobPanel) this.refreshJobList() }` となっており、`data` 引数を一切受け取っていなかった。
  2. `preload.js` の `onTranscribeEvent` は IPC の `data` を `callback(data)` で正しく renderer に渡しているが、上記コールバックがそれを処理していなかった。
  3. その結果、`_onTranscribeEvent(data)` は一度も実行されず、`completed` 分岐内の `saveRecordingMeta()` も永遠に呼ばれず、録音履歴 metadata は `reco_data/` に書き込まれなかった。
- **副次影響**: プログレスバー、`busy` フラグ、Job ステータスが一切更新されず、録音は「録音履歴」リストに表示されない。
- **修正方法**: コールバックを `(data) => { this._onTranscribeEvent(data) }` に変更し、イベント内の `data` が `_onTranscribeEvent` で正しく処理されるようにした。
- **修正結果**:
  - `frontend/src/App.vue`: `initTranscribeEventListener()` のコールバックを `(data) => { this._onTranscribeEvent(data) }` に修正
  - `frontend/package.json`: バージョン番号を 1.20.1 に更新
- **バックアップファイル名**: backup-202606292204.zip
'@

Add-Content -Path 'c:\Users\humphery\coding\recoder\modify_record.md' -Value $zh -Encoding UTF8
Add-Content -Path 'c:\Users\humphery\coding\recoder\modify_record_en.md' -Value $en -Encoding UTF8
Add-Content -Path 'c:\Users\humphery\coding\recoder\modify_record_ja.md' -Value $ja -Encoding UTF8
Write-Host "All three modify_record files updated successfully."