# Modify Record (English)

> Only records from v1.13.0 onward are maintained in this English version.

## [2026-06-24 10:25]
- **version**: 1.13.0
- **Requirement**: 1) Provide zh-TW/en/ja UI language, selectable on first launch (no settings file) or in settings panel; 2) Provide zh-TW/en/ja documentation files, update workrule.md for future multi-language documentation maintenance.
- **Plan**:
  1. Create i18n infrastructure: `frontend/src/i18n/` with zh-TW.js, en.js, ja.js language files and index.js loader
  2. Modify `App.vue`: replace all hardcoded Chinese text with `$t('key')` calls; add language selector dropdown in settings panel; show language selection dialog on first launch
  3. Create multi-language documentation: `readme_en.md`, `readme_ja.md`, `modify_record_en.md`, `modify_record_ja.md`
  4. Update `workrule.md` Section 4 to require multi-language documentation maintenance
  5. Version 1.12.2 → 1.13.0 (minor: new feature, backward compatible)
- **Result**:
  - `frontend/src/i18n/zh-TW.js` — ~200 key-value pairs for Traditional Chinese
  - `frontend/src/i18n/en.js` — ~200 key-value pairs for English
  - `frontend/src/i18n/ja.js` — ~200 key-value pairs for Japanese
  - `frontend/src/i18n/index.js` — `t(key, lang)` function + `LANGUAGES` export
  - `frontend/src/App.vue` — All UI text replaced with `$t()`; language selector in settings; first-launch language dialog
  - `readme_en.md` — English version of readme
  - `readme_ja.md` — Japanese version of readme
  - `modify_record_en.md` — English version of modify record (v1.13.0+ only)
  - `modify_record_ja.md` — Japanese version of modify record (v1.13.0+ only)
  - `.clinerules/workrule.md` — Section 4 updated with multi-language documentation requirements
  - `frontend/package.json` — Version updated to 1.13.0
- Backup: backup-202606241025.zip

## [2026-06-24 10:44]
- **version**: 1.13.1
- **Requirement**: Compile project, produce portable exe.
- **Plan**:
  1. Increment version 1.13.0 → 1.13.1
  2. Run electron-builder to compile
  3. Update documentation and backup
- **Result**:
  - `frontend/package.json`: Version updated to 1.13.1
  - Build output: `frontend/dist-electron-build2/Recorder-1.13.1-portable.exe` (127 MB)
  - Due to Windows Defender locking `dist-electron-build`, switched to `dist-electron-build2` output directory
- Backup: backup-202606241044.zip

## [2026-06-24 11:35]
- **version**: 1.13.2
- **Requirement**: Fix UI bug caused by i18n refactoring — AI provider and whisper model dropdowns were empty in settings.
- **Plan**:
  1. Root cause: `mounted()` lifecycle hook was accidentally removed during i18n refactoring, causing `fetchModels()`, `fetchLlmProviders()`, `loadSettings()` to never be called
  2. Fix: Restore `async mounted()` hook between `computed` and `methods` blocks
  3. Version 1.13.1 → 1.13.2 (patch: bug fix)
- **Result**:
  - `frontend/src/App.vue`: Restored `async mounted()` lifecycle hook, calling `fetchModels()`, `fetchLlmProviders()`, `loadSettings()` in sequence
  - `frontend/package.json`: Version updated to 1.13.2
  - Build output: `frontend/dist-electron-build2/Recorder-1.13.2-portable.exe` (127 MB)
  - Multi-language documentation: `Product_Design_Guidelines_en.md`, `Product_Design_Guidelines_ja.md` created; `readme_en.md`, `readme_ja.md` updated
- Backup: backup-202606241135.zip

## [2026-06-24 12:30]
- **version**: 1.14.0
- **Requirement**: Sentence optimization must reference original transcript timestamps — introduce LLM Job Manager async processing, token limit detection with batch splitting, per-sentence optimization preserving timestamp alignment.
- **Plan**:
  1. Create `LlmJobManager` class (main.js): manage queue, execution, cancellation, and history for all LLM operations; Job state machine `pending → running → completed/failed/cancelled`; push status changes via `llm:jobUpdate` IPC
  2. Token estimation and model context limit lookup (main.js):
     - `estimateTokens(text)`: estimate token count by character type (CJK 1.5 token/char, ASCII 0.25 token/char)
     - `getModelContextLimit(provider, model)`: lookup model context window limit (lookup table + Ollama API dynamic query + fallback 4096)
     - Auto batch split when exceeding limit (optimize by sentence, translate by character count, summary/AI query truncation)
  3. Per-sentence optimization (main.js + App.vue):
     - System prompt requires LLM to output in `[N] optimized text` format per sentence
     - `_parseOptimizedResult()` parses LLM output, maps back to original segments preserving timestamps
  4. Frontend UI integration (App.vue + preload.js):
     - LLM action bar adds "📋 Job" button and job list panel (progress bar, log, cancel button)
     - Real-time `llm:jobUpdate` event listener updates activeJobId and progress
     - New methods: `initJobListener()`, `refreshJobList()`, `cancelJob()`, `cancelActiveJob()`
  5. i18n: add job-related translation keys (zh-TW/en/ja)
  6. Update `Product_Design_Guidelines.md` v1.6.0 with LLM Job Manager and Token estimation docs
  7. Version 1.13.2 → 1.14.0 (minor: new feature, backward compatible)
- **Result**:
  - `frontend/electron/main.js`: Added `LlmJobManager` class, `estimateTokens()`, `getModelContextLimit()`, `KNOWN_MODEL_CONTEXTS` table, 4 job execution methods (optimize/translate/summary/aiQuery), 4 job IPC handlers (submit/status/list/cancel)
  - `frontend/electron/preload.js`: Added `llmJobSubmit`, `llmJobStatus`, `llmJobList`, `llmJobCancel`, `onLlmJobUpdate` bridge
  - `frontend/src/App.vue`: Added job management data/methods/UI panel/CSS styles; LLM action bar added Job button, batch progress display, cancel button
  - `frontend/src/i18n/zh-TW.js`: Added 7 job-related translation keys
  - `frontend/src/i18n/en.js`: Added 7 job-related translation keys
  - `frontend/src/i18n/ja.js`: Added 7 job-related translation keys
  - `frontend/package.json`: Version updated to 1.14.0
  - `Product_Design_Guidelines.md`: Updated to v1.6.0 with LLM Job Manager and Token estimation docs
- Backup: backup-202606241230.zip

## [2026-06-24 14:42]
- **version**: 1.14.0
- **Requirement**: Recompile project, produce portable exe.
- **Plan**:
  1. Run `npm run electron:build` (vite build + electron-builder --win portable)
  2. Verify output file
  3. Update documentation and backup
- **Result**:
  - Build successful: `frontend/dist-electron-build2/Recorder-1.14.0-portable.exe` (127 MB)
  - No code changes, recompile only
- Backup: backup-202606241442.zip

## [2026-06-24 14:58]
- **version**: 1.14.1
- **Requirement**: Fix "An object could not be cloned" error on "✨ Optimize" — Vue Proxy cannot be serialized through Electron IPC.
- **Plan**:
  1. Root cause: `doOptimize()` passes `segments: this.transcriptionResults` to `llmJobSubmit` IPC, but `this.transcriptionResults` is a Vue reactive array (Proxy object), which Structured Clone Algorithm cannot serialize
  2. Fix: Use `JSON.parse(JSON.stringify(...))` to convert Vue Proxy to plain JSON object before passing
  3. Version 1.14.0 → 1.14.1 (patch: bug fix)
- **Result**:
  - `frontend/src/App.vue`: `doOptimize()` changed to `segments: JSON.parse(JSON.stringify(this.transcriptionResults))`
  - `frontend/package.json`: Version updated to 1.14.1
- Backup: backup-202606241458.zip

## [2026-06-26 11:06]
- **version**: 1.14.2
- **Requirement**: Fix LLM batch processing (optimize) "The user aborted a request" error caused by 30-second timeout.
- **Plan**:
  1. Log analysis: `callLLM()` function had a 30-second AbortController timeout at line 139
  2. When processing large batches (e.g., 237 or 444 sentences), LLM API calls take longer than 30 seconds, triggering `controller.abort()`
  3. Fix: Increase timeout from 30 seconds to 120 seconds to accommodate large batch processing
  4. Version 1.14.1 → 1.14.2 (patch: bug fix)
- **Result**:
  - `frontend/electron/main.js`:
    - `callLLM()` AbortController timeout changed from 30000 to 120000
    - Added CSMA/CD-style exponential backoff retry: `LLM_SLOT_TIME=2000ms`, `LLM_MAX_RETRIES=16`; retry only on AbortError (timeout), wait time = `Random(0, 2^k - 1) × Slot Time` (k=min(attempt+1, 10)), throw final error after 16 consecutive timeouts
    - Extracted actual fetch logic into `_llmFetch()` helper function
  - `frontend/package.json`: Version updated to 1.14.2
- Backup: backup-202606261106.zip

## [2026-06-26 12:33]
- **version**: 1.14.3
- **Requirement**:
  1. Provide LLM document management UI: list/review/delete documents generated from original transcripts (optimize, translate, summary, etc.)
  2. Translation supports translating any document (original transcript, optimized result, summary, etc.), with output documents categorized under the same original transcript, distinguished by generation time
  3. Auto-refresh job list when clicking the Job button
- **Plan**:
  1. Backend `main.js`:
     - `reco:saveMeta` add `documents` parameter to store document history array (id, type, source, target, content, createdAt)
     - Add `reco:deleteLlmDoc` IPC: delete specified document, sync cleanup of `llmResults` latest version
  2. `preload.js`: Add `recoDeleteLlmDoc` bridge
  3. Frontend `App.vue`:
     - Add `documents: []` data array and `showLlmDocPanel` variable
     - Add `_addDocument(type, content, source, target)` method, auto-add to document history after LLM operations complete
     - Add LLM document management panel (template): list all documents (type, source, target language, time, preview), support view and delete
     - Add `viewLlmDoc(doc)`: set document content as activeSource for display
     - Add `deleteLlmDoc(doc)`: call backend delete, sync frontend state
     - `toggleJobPanel()` method: auto-call `refreshJobList()` when toggling panel
     - Add "📄 Document Manager" button in LLM action bar
  4. i18n: Add 8 translation keys each for zh-TW/en/ja
  5. Version 1.14.2 → 1.14.3 (patch: new feature)
- **Result**:
  - `frontend/electron/main.js`: `reco:saveMeta` added `documents` parameter; added `reco:deleteLlmDoc` IPC
  - `frontend/electron/preload.js`: Added `recoDeleteLlmDoc` bridge
  - `frontend/src/App.vue`: Added document management panel, `_addDocument`, `viewLlmDoc`, `deleteLlmDoc`, `toggleJobPanel` methods
  - `frontend/src/i18n/zh-TW.js`, `en.js`, `ja.js`: Added 8 translation keys
  - `frontend/package.json`: Version updated to 1.14.3
- Backup: backup-202606261233.zip

## [2026-06-26 14:12]
- **version**: 1.14.4
- **Requirement**: Fix "❌ An object could not be cloned" error after completing speech-to-text transcription from History → Audio List → (select specific audio file) → Transcribe.
- **Plan**:
  1. Root cause: `saveRecordingMeta` method passes Vue reactive Proxy-wrapped `segments`, `llmResults`, `documents` directly to Electron IPC; V8 structured clone cannot serialize Proxy objects.
  2. Fix: Deep clone `segments`, `llmResults`, `documents` using `JSON.parse(JSON.stringify(...))` in `saveRecordingMeta` to detach from Vue Proxy wrapping.
  3. Reference: `doOptimize` method (App.vue:846) already uses the same technique to avoid this issue.
  4. Version 1.14.3 → 1.14.4 (patch: bug fix)
- **Result**:
  - `frontend/src/App.vue`: `saveRecordingMeta` method added `clonedSegments`, `clonedLlmResults`, `clonedDocuments` deep clone variables; IPC call parameters changed to use cloned objects.
  - `frontend/package.json`: Version updated to 1.14.4
- Backup: backup-202606261417.zip

## [2026-06-26 17:02]
- **version**: 1.15.0
- **Requirement**: Replace application icons (top-left window icon and main .exe icon) with the microphone icon provided by the user.
- **Plan**:
  1. User provided 1024x1024 RGBA PNG (`assets/app_icon.png`)
  2. Use PIL to generate multi-size .ico (16/24/32/48/64/96/128/256) → `assets/app.ico`
  3. Generate 256x256 PNG → `assets/icon.png`, copy to `frontend/public/icon.png` (Vite static asset)
  4. `frontend/electron/main.js`: Add `icon` property to `BrowserWindow` (dev mode → `assets/icon.png`, production → `dist/icon.png`)
  5. `frontend/index.html`: Add `<link rel="icon" type="image/png" href="/icon.png">` favicon
  6. `frontend/package.json`: `build.win.icon` already points to `../assets/app.ico` (no change needed)
  7. Version 1.14.4 → 1.15.0 (minor: new feature)
- **Result**:
  - `assets/app.ico` — Multi-size Windows icon (153 KB, 8 sizes: 16/24/32/48/64/96/128/256)
  - `assets/icon.png` — 256x256 PNG icon (87 KB)
  - `frontend/public/icon.png` — Vite static asset, copied to `dist/icon.png` on build
  - `frontend/electron/main.js` — `createWindow()` added `icon` property with dev/production paths
  - `frontend/index.html` — Added favicon `<link>` tag
  - `frontend/package.json` — Version updated to 1.15.0
- Backup: backup-202606261702.zip

## [2026-06-29 12:30]
- **version**: 1.17.0
- **Requirement**: UI refactoring — 1) Rename "Mix" to "Mix Recording" on homepage; 2) Change "Mic Recording" and "Mix Recording" to a "Recording Mode" radio group with a single start/stop button; 3) Rename "Import" to "Audio Import"; 4) Move Whisper model selection and download management to the Settings panel; 5) Move "Export" from homepage to the Recording History management interface; 6) Change Whisper model default to `small` globally.
- **Plan**:
  1. Control bar: radio group (🎙️ Mic / 🖥️ Mix Recording) + single dynamic button (⏺ Start Recording / ⏹️ Stop Recording)
  2. Remove model dropdown, download button, and export button from homepage
  3. Settings panel: add "Whisper Model" section (dropdown + download button) + "Downloaded Models" list (with delete button)
  4. Recording History toolbar and search results: add "💾 Export" button
  5. Add IPC `model:delete` for model deletion
  6. Sync i18n updates across zh-TW/en/ja
  7. Version 1.16.0 → 1.17.0
- **Result**:
  - `frontend/src/App.vue` — Control bar refactored (radio + single button), settings panel added Whisper model management section, removed homepage export/model dropdown/download buttons, added export buttons to recording history toolbar and search results, `selectedModel` default changed to `'small'`, added `deleteModel()`/`exportFromToolbar()`/`exportFromHistory()` methods
  - `frontend/electron/main.js` — Added `model:delete` IPC handler (with path safety check), `models:list` response field `size_mb` changed to `sizeMB`
  - `frontend/electron/preload.js` — Exposed `deleteModel` bridge method
  - `frontend/src/i18n/zh-TW.js` — Added 15 i18n keys (recording mode, model management, export location, etc.), modified `control.mixRecord`/`control.import`/`control.mix`/`history.mix` values
  - `frontend/src/i18n/en.js` — Synced 15 new i18n keys
  - `frontend/src/i18n/ja.js` — Synced 15 new i18n keys
  - `frontend/package.json` — Version updated to 1.17.0
  - `Product_Design_Guidelines.md` — Updated to v1.8.0, documented UI refactoring changes
  - Backup: backup-202606291230.zip

## [2026-06-29 13:50]
- **version**: 1.17.1
- **Requirement**: Fix UI permanently stuck at "Transcribing..." when whisper runs for a long time. Root cause: whisper-cli.exe may hang on large audio files (GPU loading=0 but process doesn't exit), with no progress feedback, no cancel mechanism, and no timeout protection.
- **Plan**:
  1. Backend `runWhisper()`: add stderr progress parsing & push (every 5s), stall detection (auto-kill after 5min no output), absolute timeout (90min)
  2. Backend: add `activeWhisperProcs` Map for process tracking, `transcribe:start` in-flight protection, new `transcribe:cancel` IPC handler
  3. Frontend `startTranscribe()`: subscribe to `transcribe:progress` events, add cancel button & `cancelTranscribe()` method, add duplicate trigger protection
  4. preload: add `transcribeCancel`, `onTranscribeProgress` interfaces
  5. i18n: add 5 status strings + 1 control button string across 3 languages
  6. Version 1.17.0 → 1.17.1
- **Result**:
  - `frontend/electron/main.js` — `runWhisper()` refactored with progress push, stall detection, absolute timeout, in-flight protection, cancel IPC
  - `frontend/electron/preload.js` — added `transcribeCancel`, `onTranscribeProgress`
  - `frontend/src/App.vue` — progress subscription, cancel button, duplicate trigger protection, `_transcribingAudioPath` data field
  - `frontend/src/i18n/zh-TW.js` / `en.js` / `ja.js` — 6 new i18n keys each
  - `frontend/package.json` — version updated to 1.17.1
- Backup: backup-202606291350.zip
