$dir = 'C:\Users\humphery\coding\recoder'

$zh = @"

## [2026-07-04 06:23] v1.23.0 hotfix1 / 5 / 7 / 8 修正
- **version**: 1.23.0 (hotfix 累積)
- **hotfix1（缺 UI 入口）**：使用者反饋「在 👤 Create Profile 找不到建立 profile 的地方」。原因：v1.23.0 主要功能已實作 Speaker Database panel 但忘了在 panel 內加入「💾 從標註建立 Profile」與「📂 從音檔建立 Profile」按鈕。修正：在 Speaker Database panel 頂端加入綠色 `profile-create-row` 區塊與 2 個建立按鈕 + 對應 `doBuildProfileFromSeeds` / `doBuildProfileFromAudioFile` methods + 200 個 profile 上限檢查。
- **hotfix5（IPC 回傳格式不匹配）**：使用者反饋「按了沒反應」時 throw JS 例外 `Cannot read property 'samples' of undefined`。原因：main.js 的 `voiceprint:profileBuildFromSeeds` handler 回傳 `{ success, profiles: [...], savedIds, count }`（陣列），但前端 `doBuildProfileFromSeeds` 用 `r.profile.samples.length` 讀取（單一物件），導致 JS 拋例外。修正：改用 `const p = (r.profiles && r.profiles[0]) || null; if (p) { ... }` 對應正確格式。
- **hotfix7（Electron 不支援 window.prompt）**：hotfix5 修好 IPC 格式後，使用者反饋「按了沒反應」仍存在。原因：Chromium 預設禁用 `window.prompt`（防止破壞性對話框），導致 `prompt()` 立即 return null，靜默退出。修正：App.vue 新增自製 `<div v-if="showPromptDialog">` modal + `_showPromptDialog(title, message, defaultValue)` Promise-based 函式 + `confirmPromptDialog` / `cancelPromptDialog` handlers，取代所有 `window.prompt()` 呼叫。
- **hotfix8（preload.js 漏 v1.23.0 11 個 API）**：使用者反饋「輸入 profile 名稱按確認後出現 ❌ 異常: window.electronAPI.voiceprintProfileBuildFromSeeds is not a function」。原因：先前 build 過程中 `frontend/electron/preload.js` 沒補上 v1.23.0 的 11 個 IPC API 與 1 個 event listener 暴露給 renderer。修正：在 preload.js 結尾加入 `voiceprintProfileList/Save/Rename/Delete/Stats` + `voiceprintProfileBuildFromSeeds/BuildFromAudioFile` + `voiceprintOpenAudioDialog/IdentifySpeakers/BackfillAll` + `voiceprintListAllSpeakerNames` + `recoSearchBySpeaker` + `onVoiceprintBackfillProgress` 等 14 個 API。
- **備份檔名**: backup-202607040623.zip
"@

$en = @"

## [2026-07-04 06:23] v1.23.0 hotfix1 / 5 / 7 / 8
- **version**: 1.23.0 (cumulative hotfix)
- **hotfix1 (missing UI entry)**: User reported "I can't find where to create a profile in 👤 Create Profile". Root cause: v1.23.0 main feature already implemented Speaker Database panel but forgot to add "💾 Build from Labels" and "📂 Build from Audio File" buttons inside the panel. Fix: Added green `profile-create-row` block at top of Speaker Database panel with 2 build buttons + corresponding `doBuildProfileFromSeeds` / `doBuildProfileFromAudioFile` methods + 200 profile limit check.
- **hotfix5 (IPC return format mismatch)**: After clicking, user got JS exception `Cannot read property 'samples' of undefined`. Root cause: main.js `voiceprint:profileBuildFromSeeds` handler returns `{ success, profiles: [...], savedIds, count }` (array), but frontend `doBuildProfileFromSeeds` reads `r.profile.samples.length` (single object), causing JS exception. Fix: Use `const p = (r.profiles && r.profiles[0]) || null; if (p) { ... }` to match correct format.
- **hotfix7 (Electron doesn't support window.prompt)**: After hotfix5, user still reported "clicking has no response". Root cause: Chromium disables `window.prompt` by default (to prevent destructive dialogs), causing `prompt()` to immediately return null and silently exit. Fix: App.vue added custom `<div v-if="showPromptDialog">` modal + `_showPromptDialog(title, message, defaultValue)` Promise-based function + `confirmPromptDialog` / `cancelPromptDialog` handlers, replacing all `window.prompt()` calls.
- **hotfix8 (preload.js missing v1.23.0 11 APIs)**: User reported "After entering profile name and pressing confirm, ❌ exception: window.electronAPI.voiceprintProfileBuildFromSeeds is not a function". Root cause: Previous build process didn't add v1.23.0's 11 IPC APIs and 1 event listener to `frontend/electron/preload.js` for renderer exposure. Fix: Added 14 APIs at end of preload.js: `voiceprintProfileList/Save/Rename/Delete/Stats` + `voiceprintProfileBuildFromSeeds/BuildFromAudioFile` + `voiceprintOpenAudioDialog/IdentifySpeakers/BackfillAll` + `voiceprintListAllSpeakerNames` + `recoSearchBySpeaker` + `onVoiceprintBackfillProgress`.
- **Backup filename**: backup-202607040623.zip
"@

$ja = @"

## [2026-07-04 06:23] v1.23.0 hotfix1 / 5 / 7 / 8
- **version**: 1.23.0 (累積ホットフィックス)
- **hotfix1（UI 入り口欠落）**：ユーザーから「👤 Create Profile で profile 作成場所が見つからない」と報告。根本原因：v1.23.0 メイン機能で Speaker Database panel は実装済みだが、panel 内に「💾 ラベルから作成 Profile」「📂 音声ファイルから作成 Profile」ボタンを追加し忘れていた。修正：Speaker Database panel 上部に緑色 `profile-create-row` ブロックと 2 つの作成ボタン + 対応する `doBuildProfileFromSeeds` / `doBuildProfileFromAudioFile` メソッド + 200 件上限チェックを追加。
- **hotfix5（IPC 戻り値形式の不一致）**：クリック後、JS 例外 `Cannot read property 'samples' of undefined` が発生。根本原因：main.js の `voiceprint:profileBuildFromSeeds` ハンドラは `{ success, profiles: [...], savedIds, count }`（配列）を返すが、フロントエンドの `doBuildProfileFromSeeds` は `r.profile.samples.length`（単一オブジェクト）を読み取り、JS 例外が発生。修正：`const p = (r.profiles && r.profiles[0]) || null; if (p) { ... }` で正しい形式に対応。
- **hotfix7（Electron は window.prompt 非対応）**：hotfix5 後、ユーザーから「クリックしても反応なし」と再度報告。根本原因：Chromium は `window.prompt` をデフォルトで無効化（破壊的ダイアログ防止）し、`prompt()` は即座に null を返し、サイレント終了。修正：App.vue に自製 `<div v-if="showPromptDialog">` モーダル + `_showPromptDialog(title, message, defaultValue)` Promise ベース関数 + `confirmPromptDialog` / `cancelPromptDialog` ハンドラを追加し、全ての `window.prompt()` 呼び出しを置き換え。
- **hotfix8（preload.js に v1.23.0 の 11 API 欠落）**：ユーザーから「profile 名を入力して確認後、❌ 異常: window.electronAPI.voiceprintProfileBuildFromSeeds is not a function」と報告。根本原因：前回のビルドプロセスで `frontend/electron/preload.js` に v1.23.0 の 11 IPC API と 1 イベントリスナーが renderer 用に追加されていなかった。修正：preload.js 末尾に 14 API を追加：`voiceprintProfileList/Save/Rename/Delete/Stats` + `voiceprintProfileBuildFromSeeds/BuildFromAudioFile` + `voiceprintOpenAudioDialog/IdentifySpeakers/BackfillAll` + `voiceprintListAllSpeakerNames` + `recoSearchBySpeaker` + `onVoiceprintBackfillProgress`。
- **バックアップファイル名**: backup-202607040623.zip
"@

Add-Content -Path "$dir\modify_record.md" -Value "`n$zh" -Encoding utf8
Add-Content -Path "$dir\modify_record_en.md" -Value "`n$en" -Encoding utf8
Add-Content -Path "$dir\modify_record_ja.md" -Value "`n$ja" -Encoding utf8

Write-Host "OK: modify_record x3 appended"