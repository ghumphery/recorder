

## [2026-06-30 13:41]
- **version**: No bump (docs-only patch, no code changes)
- **Request**: Establish a unified design contract for "any future Job type" so that adding a new JobManager beyond LLM / Whisper / Voiceprint does not require reinventing field shapes, IPC channels, or UI bindings from scratch. Also closes a documentation gap in `Product_Design_Guidelines.md` regarding the Jobs module.
- **Plan**:
  - `Product_Design_Guidelines.md`: Insert new §14 "Cross-Module Async Job Architecture (Job Manager Pattern) — Contract for Future Jobs" at the top of the "Functional Modules & Business Logic" section (before §13). §14 covers:
    - 14.1 Goals and design philosophy (non-blocking UI / single in-flight / dual-channel IPC / recoverable / cancellable)
    - 14.2 Unified Job object schema (id/type/status/params/progress/result/error/log/timestamps)
    - 14.3 State machine (pending → running → completed/failed/cancelled, no skipping)
    - 14.4 Abstract JobManager interface table (addJob/processNext/cancelJob/getStatus/listJobs/deleteJob + optional cancelAll/clearHistory) + private helpers (_generateId/_log/_sendUpdate/_persist)
    - 14.5 IPC channel naming and signatures (`<prefix>:jobSubmit/jobStatus/jobList/jobCancel/jobDelete` + `<prefix>:jobUpdate` push)
    - 14.6 Persistence (default none; jobs ≥ 30 min use `~/.recoder/jobs.json`, cap 50)
    - 14.7 preload.js exposure rules
    - 14.8 UI & i18n rules (App.vue data + forced i18n keys)
    - 14.9 Reference-implementation table (LlmJobManager / WhisperJobManager / VoiceprintJobManager)
  - `Product_Design_Guidelines_en.md`: Translate §14 (location: before §11)
  - `Product_Design_Guidelines_ja.md`: Translate §14 (location: before v1.20.7 heading)
- **Result**:
  - All three `Product_Design_Guidelines*.md` gained §14 as the contract layer for any future JobManager.
  - Historical sections (§11 WhisperJobManager, §12 whisper-cli greedy decoding, …) were left in place — not renumbered.
  - No JS / JSON / i18n changes — version stays at 1.20.11.
  - Expected benefit: new job types can verify their design against the §14 checklist instead of designing each in isolation.
- **Backup**: backup-202606301341.zip

## [2026-06-30 12:37]
- **version**: 1.20.10 → 1.20.11 (patch: hotfix)
- **Request**: Users reported voiceprint model downloads keep failing. Logs consistently output "Download incomplete (received only 28283928 bytes); HuggingFace connection failed? Please retry." with the identical byte count every retry.
- **Root Cause**: v1.20.7 introduced `MIN_MODEL_SIZE = 40 * 1024 * 1024` (40 MB) as the minimum-valid-size threshold, but the actual file size at `https://huggingface.co/welcomyou/campplus-3dspeaker-200k-onnx/resolve/main/campplus_cn_en_common_200k.onnx` is **28,283,928 bytes (~26.97 MB)**, always below 40 MB, so every download is wrongly flagged "incomplete". Verified with PowerShell `Invoke-WebRequest` and `node-fetch` HEAD/GET requests:
  - `Content-Length: 28283928`
  - `Content-Type: application/octet-stream`
  - First 16 bytes = `08-08-12-07-70-79-74-6F-72-63-68-1A-06-32-2E-31` — protobuf ONNX magic (pytorch 2.10.0 exporter) with `xvector / head/conv1 / ReduceMean` nodes, **NOT an LFS pointer or error page**.
  - Although HF LFS UI shows "~50 MB", that is repo metadata + LFS pointer total. The actual .onnx binary is only ~27 MB. The current `xet-bridge-us` is the xet CAS bridge correctly forwarding the downstream real binary.
- **Impact**:
  - Pressing "Download" actually downloads successfully (28 MB written to `.downloading` then renamed), but since 28 MB < 40 MB the validation rejects and the IPC handler returns "download failed".
  - `isModelCached()` always returns false while the corrupt-limit check blocks legitimate files.
- **Fix**:
  - `frontend/electron/voiceprint.js`:
    1. `MIN_MODEL_SIZE` from `40 * 1024 * 1024` to `25 * 1024 * 1024` (real file is ~27 MB; 25 MB keeps ~7% buffer for safe rejection of truncated/HTML errors).
    2. Added detailed comment block listing the root cause: HTTP responses, headers, byte content.
    3. Updated `downloadModel` docstring to use `>= MIN_MODEL_SIZE` to prevent future magic-number drift.
- **Verification**:
  - PowerShell `Invoke-WebRequest -OutFile` downloaded to `c:\temp\voiceprint-test.onnx`; hex header confirmed as legal ONNX magic.
  - `diarizeAudio()` `loadModel()` path automatically inherits the new threshold (shared constant).
  - `isModelCached()` uses the same threshold, so cache-hit logic stays consistent.
- **Note**:
  - If users still hit "Invalid InferenceSession" after download, ensure onnxruntime 1.27.0 + Node.js 20+ and that `node_modules/onnxruntime-node/**/*` is in `asarUnpack` (added in v1.20.3).
- **Backup**: backup-202606301237.zip
# Modify Record (English)

> Only records from v1.13.0 onward are maintained in this English version.

## [2026-06-30 12:00]
- **version**: 1.20.9
- **Requirements**:
  1. Transcribe: when audio file ≥ 60 minutes, automatically split into ≤ 50-minute WAV chunks, transcribe each independently via async job
  2. Chunk size adjustable in Settings (default 50 min/chunk, with "No chunking" option preserved)
- **Plan**:
  - `frontend/electron/audioChunker.js` (new): shared audio-chunking module exposing `getAudioDuration / splitLongAudio / chunkLongAudioIfNeeded / cleanupChunkDir / cleanupStaleChunks` for both whisper (main.js) and voiceprint (voiceprint.js)
  - `frontend/electron/voiceprint.js`: require `audioChunker` shared module, remove duplicated `getAudioDuration / splitLongAudio` (keep export for backward-compat)
  - `frontend/electron/main.js`:
    1. require `./audioChunker` and call `cleanupStaleChunks()` on startup to wipe leftover `os.tmpdir()/recoder-chunks-*` and `voiceprint-chunk-*`
    2. `runWhisper(audioPath, modelSize, useGpu, gpuDevice, onProgress)` — new `onProgress(percent, elapsed, fallback)` parameter
    3. `WhisperJobManager._executeTranscribe(job)` — if `settings.whisperChunkMinutes > 0` AND audio ≥ 60 min, call `audioChunker.splitLongAudio()`, transcribe chunks individually via `runWhisper`, then add `chunk.startOffset` back to each segment. Always `cleanupChunkDir()` after run (success or fail)
    4. new helpers `_runSingleTranscribe()` and `_loadSettings()`
  - `frontend/src/App.vue`:
    1. data: `whisperChunkMinutes: 50`; sync via `loadSettings / saveSettings`
    2. Settings panel: new "🔪 Transcribe chunking" dropdown (no chunking / 30 / 40 / 50 / 60 min, default 50)
    3. Jobs panel: new progress text `Chunk N/M transcribing (X%)` using `job.progress.currentChunk / totalChunks`
  - `frontend/src/i18n/{zh-TW,en,ja}.js`: new `settings.whisperChunk / noChunk / min / whisperChunkTitle` and `jobs.chunkProgress` translations
  - `frontend/package.json`: version 1.20.8 → 1.20.9 (Patch)
- **Outcome**:
  - Shared `audioChunker.js` extracted; voiceprint.js and main.js share it, removing duplication
  - WhisperJobManager integrates long-audio chunking — audio files ≥ 60 min are split into ≤ 50 min chunks and each is independently whisper'd; segment timestamps correctly mapped back to the original file
  - Cancellation: when a job enters `cancelled` state, the next chunk is not executed (throw Error); chunk temp directory is deleted via `cleanupChunkDir()`
  - Settings panel adds "Transcribe chunking" option (default 50 min/chunk), users can switch 0/30/40/50/60
  - Jobs panel UI shows chunk progress (currentChunk / totalChunks)
  - 3-language i18n synced
  - Startup auto-cleans leftover `os.tmpdir()/recoder-chunks-*`
- **Backup filename**: backup-202606301200.zip

## [2026-06-30 11:15]
- **version**: 1.20.8
- **Requirements**:
  1. The status bar must show the actual filename of the recording being played, not the first filename from the audio list.
  2. The Jobs list should contain entries from the moment a job is submitted (so Stop and other commands can target the in-flight job), not only after completion.
- **Plan**:
  - `frontend/src/App.vue`:
    1. `playRecordingAudio(item)` now sets `currentPlayingFilename = item.filename || item.id` and updates `statusText` to `▶️ 播放: filename` / `▶️ 播放中: filename`.
    2. `reviewRecording(id)` updates `currentPlayingFilename` and uses the new `status.loadedWithName` i18n key. The legacy duplicate `reviewRecording` block was removed.
    3. Optimistic UI updates — five entry points unshift a pending job into the matching list (`transcribeJobList`, `voiceprintJobList`, `jobList`) so the user can immediately see the job and invoke Stop.
  - `frontend/src/i18n/{zh-TW,en,ja}.js`: new `status.loadedWithName` key in three languages.
  - `frontend/package.json`: version 1.20.7 → 1.20.8 (Patch).
- **Outcome**:
  - `App.vue` updated (playRecordingAudio, reviewRecording, five optimistic updates).
  - `i18n/{zh-TW,en,ja}.js` synchronized with `status.loadedWithName`.
  - `package.json` bumped to 1.20.8.
  - Build output: `frontend/dist-electron-build4/Recorder-1.20.8-portable.exe` (179.9 MB, 2026-06-30 10:58:53).
  - Code sign verified: DigiCert RFC 3161 timestamp, Subject CN=Cheng-Feng Iron Factory.
  - Backup filename: `backup-202606301115.zip` (276.2 MB compressed from 814.87 MB source, 6052 files).

## [2026-06-30 10:01]
- **version**: 1.20.7
- **Requirements**:
  1. Skip re-downloading the voiceprint model if it is already cached
  2. For audio files > 60 minutes, automatically split into chunks of ≤ 50 minutes before running speaker diarization
  3. Fix the speaker-diarization regression (over-short / silent segments collapsed into a single `Speaker_1`)
- **Plan**:
  - `frontend/electron/voiceprint.js`:
    1. `downloadModel()` checks `isModelCached()` first; if the model file already exists and is ≥ 40MB it skips the HTTPS request and emits `progressCallback(100)`.
    2. New `getAudioDuration(audioPath)` parses `Duration: HH:MM:SS` from ffmpeg stderr.
    3. New `splitLongAudio(audioPath)` uses ffmpeg `-f segment -segment_time 3000` to slice the audio into ≤ 50-min WAV chunks, returning `{tmpDir, files, durations}`.
    4. `diarizeAudio()` activates `splitLongAudio` when `audioDuration >= 3600s`; segments are mapped to chunks via `(start, end)` half-open intervals; the temp directory is removed via `fs.rmSync`.
    5. `extractSegmentPcm()` pads too-short (<1.5s) segments by ±0.5s and lowers the minimum length to 0.3s.
    6. `extractEmbedding()` lowers `numFrames < 5` to `< 3`.
    7. `clusterEmbeddings()` becomes a two-stage clusterer: (a) sliding-window median cosine ≥ 0.55 forces union-find merging, (b) cross-group centroid cosine ≥ 0.5 greedily merges clusters.
    8. Unified `MIN_MODEL_SIZE = 40MB`; removed duplicate constants.
    9. New `getFfmpegPath()` helper shared by `diarizeAudio / splitLongAudio / extractSegmentPcm`.
  - `frontend/electron/main.js`: no logic change; existing progress callback contract remains compatible.
  - `frontend/package.json`: version 1.20.6 → 1.20.7 (Patch).
- **Outcome**:
  - `frontend/electron/voiceprint.js` refactored; exports `isModelCached / downloadModel / loadModel / resetModel / diarizeAudio / extractEmbedding / extractSegmentPcm / clusterEmbeddings / cosineSimilarity / getAudioDuration`.
  - `frontend/package.json` bumped to 1.20.7.
  - Node-side syntax verified: `require('./frontend/electron/voiceprint.js')` loads successfully and all 10 exports are accessible.
  - Backup filename: backup-202606301001.zip

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

## [2026-06-29 14:48]
- **version**: 1.17.2
- **Requirement**: Verified that original long audio file transcribes correctly on CPU, but GPU (Vulkan, AMD RX 5700 XT) hangs. Need automatic GPU→CPU fallback.
- **Plan**:
  1. Add `anySegmentOutput` flag in `runWhisper()` to detect real GPU stall
  2. Auto-retry with CPU in `transcribe:start` IPC handler when `gpuStalled=true`
  3. Frontend handles `data.fallback` to show degradation message
  4. Add `gpuFallback` i18n key in zh-TW/en/ja
  5. Version bump 1.17.1 → 1.17.2
- **Result**:
  - `frontend/electron/main.js` — `runWhisper()`: added `anySegmentOutput` & `gpuStalled` flags (no `[timestamp]` output on stderr → GPU stall); `transcribe:start`: when `gpuStalled=true`, auto-retry with `useGpu=false`, pushes `fallback: true` progress events during retry
  - `frontend/src/App.vue` — `startTranscribe()` handles `data.fallback` in progress events to show degradation message
  - `frontend/src/i18n/zh-TW.js` — added `status.gpuFallback`
  - `frontend/src/i18n/en.js` — added `status.gpuFallback`
  - `frontend/src/i18n/ja.js` — added `status.gpuFallback`
  - `frontend/package.json` — version updated to 1.17.2
  - Tested: original 105-minute meeting audio → GPU hangs all 4 times, CPU completes correctly
  - Backup: backup-202606291448.zip

## [2026-06-29 15:08]
- **version**: 1.17.3
- **Requirement**: User feedback that v1.17.1/v1.17.2 CPU mode also fails — CPU (model=small) takes longer than 5 minutes to start outputting progress on a 105-minute audio, causing the stall detection to kill the process prematurely. Need to fix stall detection strategy.
- **Plan**:
  1. Add `estimateAudioDuration()` function to calculate audio length from WAV payload size (16kHz s16pcm = 32000 bytes/sec)
  2. Add `getStallTimeoutMs()` function:
     - CPU mode: returns `null` (no stall killing, only rely on 90-min absolute timeout)
     - GPU mode: dynamic timeout based on audio duration, formula = `min(audioDuration × 0.5, 30min)`, min 5 min
  3. Change progress push interval from 5s to 10s to reduce overhead
  4. Version bump 1.17.2 → 1.17.3
- **Result**:
  - `frontend/electron/main.js` — Added `estimateAudioDuration()`, `getStallTimeoutMs()` (CPU returns null); stall check uses dynamic timeout; progress interval changed to 10s
  - `frontend/package.json` — version updated to 1.17.3
  - Backup: backup-202606291508.zip

## [2026-06-29 17:18]
- **version**: 1.19.0
- **Requirement**: User feedback "Does this version have async transcription?" — Confirmed implementing WhisperJobManager async mechanism to prevent UI from being stuck and support queueing multiple audio files.
- **Implementation Plan**:
  1. Create `WhisperJobManager` class (backend): manage `jobQueue` / `activeJob` / `jobHistory` three-state machine
  2. `addJob()` returns `jobId` immediately, background `processNext()` runs serially
  3. Same-file in-flight protection + `cancelAll()` on App close
  4. Persist to `~/.recoder/jobs.json` (last 50 records)
  5. 7 new IPC handlers (submit/status/list/cancel/clear/getResult/event)
  6. Frontend `startTranscribe()` fire-and-forget mode, subscribe to `onTranscribeEvent`
  7. Frontend `_onTranscribeEvent()` handles running/completed/failed/cancelled states
  8. i18n three languages add `status.transcribingJob`
  9. Version bump 1.18.0 → 1.19.0
- **Results**:
  - `frontend/electron/main.js` — `WhisperJobManager` class (~300 lines); 7 IPC handlers; GPU auto-fallback integration; `setMainWindow` / `cancelAll`
  - `frontend/electron/preload.js` — 6 new bridge methods (transcribeSubmit/GetStatus/GetResult/List/JobCancel/JobClear + onTranscribeEvent)
  - `frontend/src/App.vue` — `startTranscribe()` fire-and-forget; new `_onTranscribeEvent`; new `initTranscribeEventListener`
  - `frontend/src/i18n/zh-TW.js` — add `status.transcribingJob`
  - `frontend/src/i18n/en.js` — add `status.transcribingJob`
  - `frontend/package.json` — version 1.19.0
  - Build success: `frontend/dist-electron-build2/Recorder-1.19.0-portable.exe` (188 MB, code signed)
  - git commit `65e2054` pushed to GitHub origin master
  - Backup: backup-202606291717.zip

---

## [2026-06-29 18:13] v1.20.0 — Async Job Management Panel on Home Page
- **version**: 1.19.0 → 1.20.0
- **requirement**: Provide async Job List / Status / Show Log / Delete / Stop on home page
- **plan**: Add deleteJob() to backend managers; new IPCs; new Job button + badge; new panel with 2 tabs; log modal; i18n for 3 languages
- **result: build OK (Recorder-1.20.0-portable.exe 188 MB, code sign manually applied), backup backup-202606291823.zip
- **backup**: TBD

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

## [2026-06-29 23:55] v1.20.2 — Fix "No Audio" false-positive after Review + Voiceprint model integrity check + Voiceprint async Job
- **version**: 1.20.1 → 1.20.2 (patch: bug fix + architecture improvement)
- **requirement**:
  1. After entering from History → Review, click "Diarize" raises "❌ No audio file" (although the audio actually exists).
  2. If the voiceprint model file is corrupted/incomplete, "👥 Diarize" sticks at "Cannot load voiceprint model".
  3. For consistency and UI observability, "Diarize" should be converted to an async Job and exposed in the Jobs panel + badge.
- **root cause**:
  1. `App.vue doDiarize()` reads `this.currentAudioPath` directly, but Review flow leaves it `null`, causing the false-positive.
  2. `voiceprint.js isModelCached()` only checks file existence, not integrity (interrupted download leaves a 0-byte file).
  3. `voiceprintDiarize` IPC is synchronous, so the UI cannot show progress in the Jobs panel while it runs.
- **fix and enhancement**:
  1. `doDiarize()` recovers audioPath via `recoLoadMeta({ recordingId })`.
  2. `voiceprint.js isModelCached()` adds file-size check (≥40 MB → valid) and a new `resetModel()`.
  3. Backend: new `VoiceprintJobManager` class (queue/active/history + persist + log + cancel/delete) plus IPCs `voiceprint:jobSubmit/Status/List/Cancel/Delete` and `voiceprint:reset`.
  4. Frontend: `voiceprintJobList` data, `currentJobList` computed, `totalInFlightJobs/totalJobs` multi-tab stats, Voiceprint tab, subscribe `onVoiceprintJobUpdate`, `doDiarize` becomes background submission, segments get a `speaker` field on completion and transcript shows `👤 Speaker_X` tag.
- **i18n sync**: Added `status.voiceprintDone`, `status.voiceprintFail`, `jobs.type.voiceprint`, `jobs.voiceprintTab` in zh-TW/en/ja.
- **result**:
  - `frontend/electron/main.js`: VoiceprintJobManager + 6 IPC handlers.
  - `frontend/electron/preload.js`: 7 new bridges (voiceprintJobSubmit/Status/List/Cancel/Delete/Reset + onVoiceprintJobUpdate).
  - `frontend/electron/voiceprint.js`: file-size check on `isModelCached`, new `resetModel()`.
  - `frontend/src/App.vue`: Diarize → Job mode, voiceprint event subscription, voiceprint tab, speaker badge in transcript, voiceprint branches in stopJob/deleteJob/openJobLog.
  - `frontend/src/i18n/{zh-TW,en,ja}.js`: new voiceprint i18n keys.
  - `frontend/package.json`: version bumped to 1.20.2.
- **follow-up** (same session): sync modify_record / readme / Product_Design_Guidelines 3 languages, rebuild `npm run electron:build`, code sign, backup, git commit + push.

## [2026-06-30 02:00] v1.20.3 — onnxruntime-node native binary load fix
- **version**: 1.20.2 → 1.20.3 (patch: hotfix)
- **requirement**: User reported Job failed: Cannot load voiceprint model, please download the model first after running Diarize, even though the model was already present.
- **root cause**: onnxruntime-node requires its native binary (onnxruntime_binding.node) at runtime. electron-builder packs the entire 
ode_modules into asar, so the native binary is trapped inside asar and equire('onnxruntime-node') fails inside InferenceSession.create(). The model itself was fine, but the error message misled the user into thinking it was a model issue.
- **fix**: Added 
ode_modules/onnxruntime-node/**/* to uild.asarUnpack in rontend/package.json. electron-builder then unpacks onnxruntime-node (including the native binary) to pp.asar.unpacked/, where Node.js can equire it normally.
- **result**:
  - rontend/package.json: asarUnpack includes 
ode_modules/onnxruntime-node/**/*
  - Rebuilt Recorder-1.20.2-portable.exe + code sign
  - git commit + push
- **backup**: backup-202606300208.zip

## [2026-06-30 02:30] v1.20.4 — downloadModel integrity check
- **version**: 1.20.3 → 1.20.4 (patch: hotfix)
- **requirement**: User reported the downloaded model file is 0.0 MB; clicking "Download" again still fails.
- **root cause**: After v1.20.3 fixed the native binary issue, the "Download model" button actually wrote ~/recoder/voiceprint/campplus_cn_en_common_200k.onnx, but some networks / HF rate-limit responses return HTML text bodies ("Found. Redirecting to ...") that get written verbatim into the .downloading file. After rename, the final model is 0 bytes or text content. isModelCached() only checks existence + size ≥ 40 MB, so a 0-byte result still returns false and the UI is stuck on "Model not downloaded".
- **fix**:
  1. downloadModel() writes to a .downloading temp file first, accumulating eceivedBytes. If the total is < 1 MB it's treated as a failed download: the temp file is deleted and the function rejects.
  2. diarizeAudio() re-checks the file size if loadModel() fails; if size < 1 MB, esetModel() is invoked to delete the broken file and the user is prompted to re-download.
- **result**: rontend/electron/voiceprint.js downloadModel() and diarizeAudio() loading logic.
- **backup**: backup-202606300208.zip

## [2026-06-30 02:45] v1.20.5 — HuggingFace LFS xet-bridge text/plain redirect handling
- **version**: 1.20.4 → 1.20.5 (patch: hotfix)
- **requirement**: Even with the integrity check in v1.20.4, downloads still fail with "Incomplete download (only received X bytes)".
- **root cause**: HuggingFace LFS serves through xet-bridge proxies such as us.aws.cdn.hf.co or cdn-lfs.huggingface.co. Sometimes these return **HTTP 200 + Content-Type: text/plain + body="Found. Redirecting to https://..."** instead of a standard 302 redirect. Node's native https.get only follows 3xx with a Location: header, so the text body was written straight into the model file as if it were binary content.
- **fix**: Rewrote etchWithRedirects() to peek the body when the response is 	ext/plain. If the body starts with Found. Redirecting to <URL>, the URL is extracted and etchWithRedirects(next) recurses. The whole function still has edirectsLeft = 5 as an upper bound to prevent loops.
- **result**: rontend/electron/voiceprint.js fetchWithRedirects() now handles implicit text/plain redirects.
- **backup**: backup-202606300208.zip

## [2026-06-30 03:15] v1.20.6 — Voiceprint Job UI lock-up fix + male/child speaker clustering fix
- **version**: 1.20.5 → 1.20.6 (patch: hotfix)
- **requirement**: User reported two issues:
  1. "The Diarize Job completes, but the homepage shows 0% and the button stays grey — I can't run another Diarize" (UI lock-up).
  2. "The Diarize Job cannot distinguish two speakers in the audio: a man and a little girl" (clustering failure).
- **root cause**:
  1. **UI lock-up (issue 1)**: App.vue _jobUpdateListener checks data.jobType === 'voiceprint', but the backend VoiceprintJobManager._sendUpdate() actually sends the field name data.type. As a result, completion events for voiceprint jobs are silently dropped, oiceprintBusy stays 	rue forever, and the homepage Diarize button stays disabled.
  2. **Clustering failure (issue 2)**: diarizeAudio() uses clusterEmbeddings(..., 0.6). A low male voice and a high-pitched little girl typically have cosine similarity well below 0.6, so the two speakers end up merged into a single cluster. Also, pcm.length > 16000 (1 s floor) filtered out short utterances from the little girl and she effectively disappeared from the analysis.
- **fix**:
  1. _jobUpdateListener: data.jobType === 'voiceprint' → data.type === 'voiceprint'; also tolerate progress as either a number or an { percent: 0 } object.
  2. diarizeAudio():
     - pcm.length > 16000 → pcm.length > 8000 (1 s → 0.5 s, to keep short utterances).
     - clusterEmbeddings(validEmbeddings, 0.6) → clusterEmbeddings(validEmbeddings, 0.5) (loosen threshold to cover the wider male/child gap).
- **result**:
  - rontend/src/App.vue: _jobUpdateListener fixed field name + progress parser hardened.
  - rontend/electron/voiceprint.js: minimum PCM 8000 + threshold 0.5.
  - Rebuilt Recorder-1.20.2-portable.exe (188,635,584 bytes, 2026-06-30 03:16) + code sign.
  - git commit + push.
- **backup**: backup-202606300316.zip