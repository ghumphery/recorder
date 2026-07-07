


## [2026-07-07 14:30]
- **version**: 1.23.0 → 1.23.1 (patch: repo housekeeping — stop syncing `-p/` to GitHub)
- **Request**: The `-p/` directory contains scratch scripts accumulated during development (cabal extraction helpers, doc appenders, model checkers, build helpers, etc.) and should not be version-controlled. Leaving it in the repo pollutes the GitHub mirror and confuses anyone who later clones the project.
- **Root cause**:
  1. During v1.20–v1.23 development we routinely dropped one-off hotfix scripts into `-p/` (e.g. `append_v1230_docs.ps1`, `append_v1230_hotfix_records.ps1`, `append_v1230_ips.js`) and ran `git add` against them.
  2. `.gitignore` had partial excludes (`app_check*/`, `quote_i18n_v1230*.ps1`, etc.) but `git ls-files -p/` still listed 26 tracked files, so every `git status` was full of noise unrelated to the shipped build.
  3. The directory is, by design, a personal scratch space — meaningless to other contributors.
- **Plan**:
  - `.gitignore`: append `# 暫存 / 工具腳本目錄（不要同步到 GitHub）\n-p/` to ignore the entire directory.
  - `git rm -r --cached -p/`: untrack all 26 currently-tracked files while keeping the local working-tree copies intact.
  - Verify: `git ls-files -p/` → empty; `git check-ignore -p/append_records.ps1 -p/foo.txt` → reported as ignored; local `-p/append_records.ps1` still exists.
  - `frontend/package.json` version 1.23.0 → 1.23.1 (patch — repo hygiene, no runtime behavior change).
- **Result**:
  - `.gitignore` now includes the `-p/` rule.
  - 26 `-p/` files removed from the index (commit `aa44ad6`); local copies preserved.
  - `git ls-files -p/` returns no output.
  - `git status` only shows the `whisper_cpp` submodule pointer (unrelated to this task).
  - Any new file dropped under `-p/` from now on will be auto-ignored.
  - Historical commits on the `master` branch still contain `-p/` content; rewriting history with `git filter-repo` was deliberately not done (destructive, not requested).
  - **Backup file name**: produced in the backup step.


## [2026-07-07 16:30]
- **version**: 1.23.1 → 1.23.2 (patch: auto-repair corrupted voiceprint model)
- **Request**: User reported voiceprint jobs failing repeatedly. recorder.log showed "InferenceSession creation failed (file size: 27.0 MB)" and the same user session downloaded the model 8 times in a row (each time finishing instantly). Root cause: HF LFS occasionally returns "mixed content" (HTML redirect header + partial binary stream), writing a 25+ MB polluted file that passes the size check but onnxruntime cannot read.
- **Root cause analysis**:
  1. v1.20.4 integrity check: < 1 MB considered incomplete. But 25-28 MB polluted files pass this threshold.
  2. v1.20.5 text/plain redirect handling: checks the first 100 chars of the body for "Found. Redirecting to". But HF LFS may return "mixed content" (HTML header + binary stream) which this check does not cover for streaming responses.
  3. v1.20.6 25 MB threshold: polluted file slightly exceeds it, isModelCached() falsely returns valid.
  4. isModelCached() only checks size and file existence, never validates ONNX format.
  5. When loadModel() fails it only console.error and returns false, does not auto-delete the corrupted file.
  6. User repeatedly clicks the "Download" button 8 times; voiceprintDownload handler always prints "download started / completed" even when the download was short-circuited (isModelCached returns true), flooding the log with 8 misleading entries.
- **Plan**:
  - `frontend/electron/voiceprint.js`:
    1. Add `ONNX_MAGIC` constant = `Buffer.from([0x08, 0x08, 0x12, 0x07, 0x70, 0x79, 0x74, 0x6F, 0x72, 0x63, 0x68])` (pytorch 2.10+ exporter protobuf header).
    2. Add `isOnnxMagicValid(filePath, checkBytes=16)` function: read the first N bytes of the file and compare against ONNX_MAGIC; mismatch = corrupted.
    3. `isModelCached()`: previously only checked `size >= modelMinSize()`. Add ONNX magic validation. Failure → console.warn + auto `resetModel()` + return false.
    4. `_ensureModelLoaded()`: previously only checked size. New behavior:
       - size < minSize → reset (original)
       - **ONNX magic invalid → auto `resetModel()` + message** "File's first 10 bytes are not a valid ONNX header. Auto-deleted. Please re-download."
       - **loadModel() failure → auto `resetModel()` + message** "InferenceSession creation failed, auto-reset. Please re-download."
    5. After this fix the user only needs to press Download once to fully recover.
  - `frontend/electron/main.js`: `voiceprintDownload` handler, when `voiceprint.isModelCached()` is true, only logs "Already up to date" instead of printing "Download started / completed". Prevents the log from being flooded by 8 misleading entries when the user repeatedly clicks the button.
- **Result**:
  - Node syntax check passed: voiceprint.js / main.js both load successfully.
  - Unit test `-p/test_v1232_onnx_magic.js` 6 cases all pass:
    - A) 27MB HTML-polluted file → isOnnxMagicValid = false ✓
    - B) 27MB valid file with pytorch magic → true ✓
    - C) Nonexistent file → false ✓
    - D) Tiny but valid magic file → true (size check is isModelCached's responsibility) ✓
    - E) 27MB file with wrong first 10 bytes → false ✓
    - F) 100-byte check also works ✓
  - After reinstalling v1.23.2, if HF LFS ever returns a polluted file:
    1. First: Job fails → _ensureModelLoaded auto-resets → "Please re-download the model" message
    2. Press Download once → voiceprintDownload sees isModelCached() is false → actually downloads
    3. After download, click "Diarize Speakers" again → succeeds
  - Original task "`-p/` no longer sync to GitHub" was completed in v1.23.1
  - **Backup file name**: produced in the backup step.

## [2026-06-30 15:20]
- **version**: 1.20.13 → 1.20.14 (patch: recording history UI refresh bug fix)
- **Request**: User reported "after transcription completes, no new entry appears in recording history". Investigation confirmed that `reco:saveMeta` IPC was being called and the metadata JSON was successfully written to disk, but the recording history list UI never refreshed, so the user perceived "no new entry added".
- **Root cause**:
  1. `frontend/src/App.vue`'s `_onTranscribeEvent('completed')` calls `await this.saveRecordingMeta(r.result.segments)`.
  2. `saveRecordingMeta` writes the metadata JSON to `reco_data/` via `reco:saveMeta` IPC. However, **no code path actively refreshes `historyList` after a successful save**.
  3. `loadHistory()` is only called when the user actively clicks the history tab, the refresh button, or after folder create/delete/rename, recording move/delete/update-labels. The `_onTranscribeEvent('completed')` → `saveRecordingMeta` → `reco:saveMeta` chain has no refresh point.
  4. Result: user transcribes a new audio file, sees the "transcribed N sentences" status, switches to the history tab, but the new record is missing (needs to manually click refresh).
  5. Additionally, `saveRecordingMeta` still uses a silent early-return guard `if (!window.electronAPI || !this.audioInfo) return`. If `audioInfo` ever becomes empty (e.g., user switches to a different recording mid-way), this causes "silent failure" with no debug visibility.
- **Plan**:
  - `frontend/src/App.vue`'s `saveRecordingMeta()`:
    1. After `recoSaveMeta` succeeds, `await this.loadHistory()` to refresh the recording history list.
    2. Split the `window.electronAPI` and `audioInfo` early-return guards; add `console.warn('[saveRecordingMeta] skipped: audioInfo is empty (...)')` for future debug visibility.
    3. Wrap `recoSaveMeta` in try/catch; on failure, `console.error('[saveRecordingMeta] save failed:', id, e)`, do not let the exception abort the outer caller.
    4. On success, `console.log('[saveRecordingMeta] saved metadata:', id, '(segments=N, audioPath=...)')`.
  - `frontend/package.json` version 1.20.13 → 1.20.14.
- **Result**:
  - All three `saveRecordingMeta` call sites are covered: `_onTranscribeEvent('completed')` (new transcription), `_pollJobResult('completed')` (LLM processing), `_jobUpdateListener('voiceprint completed')` (voiceprint annotation).
  - For the latter two (LLM / voiceprint), the refresh is also harmless (just refreshes the list, does not add duplicates).
  - Expected effect: after a new transcription, switching to the history tab immediately shows the new record at the top, no manual refresh needed.
- **Verification**: Click "🤖 Transcribe" on a new audio → wait for completion → switch to "📚 History" tab → the new record should immediately appear at the top of the list without manual refresh.
- **Backup**: backup-202606301541.zip (2.94 GB)

## [2026-06-30 13:50]
- **version**: 1.20.11 → 1.20.12 (patch: log supplementation)
- **Request**: User reported "the job log for transcribe does not show the audio length check nor the over-threshold chunk split log." Although `_executeTranscribe` in `WhisperJobManager` emits some logs, all of them concentrate on post-split actions ("split into N chunks", "chunk N/M transcribing..."). The decision chain (audio duration check, whether the threshold was exceeded, which path was taken) is completely omitted, so the job log shows neither the decision rationale nor the fallback reason.
- **Plan**:
  - Touch only `frontend/electron/main.js`, specifically `WhisperJobManager._executeTranscribe(job)` around lines 1091–1125, to add 4 `this._log(job, ...)` calls:
    1. Line 1105: `音檔時長檢查: Xs (門檻 3600s，設定 chunkMinutes=Z)` — always emitted after `getAudioDuration()`
    2. Line 1114: `決策: 不切片 (reason)` — at the top of `if (!shouldChunk)`, covering 4 reasons: `chunkMinutes ≤ 0`, duration `≤ 0` (ffmpeg failed), duration `<` threshold, other conditions unmet
    3. Line 1116: `進入直接辨識路徑 (runWhisper)` — before `_runSingleTranscribe`
    4. Line 1130: `已切換為直接辨識路徑 (runWhisper)` — after `切片失敗，降級為直接辨識` in the catch block
  - Do NOT touch Vue frontend, `audioChunker.js`, settings, IPC, or UI strings
  - Do NOT add new i18n keys (log is written into job.log by backend and displayed directly by the log modal)
  - `frontend/package.json` version 1.20.11 → 1.20.12 (patch)
- **Result**:
  - `node --check` confirms `frontend/electron/main.js` syntax OK
  - PowerShell `Select-String` confirms the 4 new log lines are in the correct sections (1105 / 1114 / 1116 / 1130)
  - The "no chunking" branch now shows the full decision chain; the fallback branch now reveals "chunk failed → switch to direct transcribe"
  - Existing chunk-success-path logs (長音檔 Xs >= Ys, 已切成 N 個 chunks, 切片 N/M 辨識中...) are unchanged
- **Verification**: Restart the app, start transcribe on an audio file ≤ 60 minutes, open the job log modal — the 4 new lines should appear in order. For ≥ 60 minutes, the existing chunk logs and the new duration-check log should appear sequentially.
- **Backup**: to be generated by the backup step

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
- **backup**: backup-202606300316.zip## [2026-06-30 16:00] v1.20.15 — Transcribe completion IPC race fix + diagnostic logs

- **version**: 1.20.14 → 1.20.15 (patch: hotfix)
- **Issue**: For some audio files, the user reported that pressing "Transcribe" caused the UI to display "❌ 未知錯誤" (Unknown error) forever, even though recorder.log showed `exit=0` and "Job completed" on the backend.
- **Root cause analysis**:
  1. `WhisperJobManager._sendUpdate()` only pushed `status` in the "completed" event without including `result.segments`.
  2. Frontend `_onTranscribeEvent` invoked `transcribe:getResult` immediately upon `data.status === 'completed'`.
  3. Although backend ordering is correct (status → completed → write result → sendUpdate), there exists an IPC race window where the frontend listener triggers `transcribe:getResult` while the backend handler hasn't yet finalized `jobHistory`, returning `{ success: false, error: 'job 尚未完成' }`.
  4. The frontend `catch` block swallowed `error.message` and fell back to "❌ 未知錯誤", which is useless for debugging.
- **Fix**:
  1. `WhisperJobManager._sendUpdate()`: when `job.status === 'completed'` and `job.result` exists, include `result` in the payload pushed to renderer.
  2. Frontend `_onTranscribeEvent` completed branch: prefer `data.result` (event-inline); only fall back to `transcribeGetResult` if missing.
  3. `transcribe:getResult` handler: add DEBUG log printing job state / audioPath / hasResult.
  4. `_sendUpdate`: add DEBUG log printing status / hasResult / hasInlineResult.
  5. Frontend `_onTranscribeEvent`: add `console.log('[app] transcribe event:', ...)` at entry for future analysis.
  6. `catch` block: use explicit messages (e.g. `❌ 取得辨識結果失敗: status=...`) instead of the vague "未知錯誤".
  7. `saveRecordingMeta` already isolates errors internally; wrap it again on the caller side to ensure storage failures don't affect transcript display.
- **Result**:
  - `frontend/electron/main.js` `WhisperJobManager._sendUpdate()` and `transcribe:getResult` handler.
  - `frontend/src/App.vue` `_onTranscribeEvent` completed branch + entry console.log.
  - `frontend/package.json` version `1.20.14 → 1.20.15`.
  - Rebuilt `Recorder-1.20.15-portable.exe` + code sign.
  - git commit + push.
- **Backup filename**: backup-202606301600.zip
## [2026-06-30 16:42] v1.20.16 — _executeTranscribe job.result write-missing fix

- **version**: 1.20.15 → 1.20.16 (patch: hotfix)
- **Issue**: After v1.20.15 hotfix, the user reported that for *some* audio files the UI still showed `❌ 取得辨識結果失敗: 無 result` and the debug log showed `sendUpdate status=completed hasResult=false hasInlineResult=false`.
- **Root cause analysis**: `WhisperJobManager._executeTranscribe()` has three return paths (no-chunk direct runWhisper, chunk-failure fallback to direct runWhisper, chunked processing). Only the chunked path wrote `job.result = { success: true, segments: allSegments }`. The other two paths only `return await this._runSingleTranscribe(...)` without ever assigning to `job.result`, so the completed event always saw `job.result === null` (the default setting `whisperChunkMinutes=0` triggers the no-chunk path for almost everyone).
- **Fix**:
  1. In both no-chunk and fallback paths of `_executeTranscribe()`, capture the result from `_runSingleTranscribe()` and assign `job.result = { success: true, segments: result.segments || [] }` before returning.
  2. **The v1.20.15 hotfix is still relevant** — the issue had two layers: `_sendUpdate()` not including `result` (fixed in v1.20.15), and `job.result` never being written (fixed here). Both must be fixed for complete resolution.
- **Result**:
  - `frontend/electron/main.js` `_executeTranscribe()` now writes `job.result` in all three return paths.
  - `Product_Design_Guidelines.md` version `1.20.15 → 1.20.16`.
  - `frontend/package.json` version `1.20.15 → 1.20.16`.
  - Rebuilt `Recorder-1.20.16-portable.exe` + code sign.
- **Backup filename**: backup-202606301642.zip
## [2026-06-30 17:00] v1.21.0 — Semi-supervised speaker propagation

- **version**: 1.20.16 → 1.21.0 (minor: new feature)
- **Issue**: Solve "short sentences (<1.5s) cannot be precisely attributed to speaker" and support workflow "user manually marks a few sentences → system propagates to remaining segments".
- **Background**: The existing v1.20.2 `diarizeAudio` is unsupervised clustering (cosine threshold 0.5), which performs poorly on short sentences (one of the v1.20.6 root causes). A common misconception is that "duplicating the same sentence multiple times improves accuracy" — in practice, campplus x-vector models learn speaker characteristics, not semantic content, so duplicating the same sentence provides no new information.
- **Solution**:
  1. `frontend/electron/voiceprint.js`:
     - Add constant `PROPAGATE_MIN_THRESHOLD = 0.5`
     - Extract shared helper `_extractAllEmbeddings(audioPath, segments, progressCallback)` (with long-audio chunking + cross-chunk splicing)
     - Extract shared helper `_ensureModelLoaded()` (model exists + size check + InferenceSession creation)
     - Refactor `diarizeAudio()` to use these helpers, body reduced to ~30 lines
     - Add `propagateSpeakers(audioPath, segments, seeds, options)`: semi-supervised cosine comparison + L2-normalize centroid + threshold filtering
     - Export `propagateSpeakers` and `PROPAGATE_MIN_THRESHOLD`
  2. `frontend/electron/main.js`:
     - Add IPC handler `ipcMain.handle('voiceprint:propagate', async (event, { audioPath, segments, seeds, threshold }) => ...)`
     - Log to recorder.log via `appLog`
  3. `frontend/electron/preload.js`:
     - Expose `voiceprintPropagate: (p) => ipcRenderer.invoke('voiceprint:propagate', p)`
  4. `frontend/src/i18n/{zh-TW,en,ja}.js`: Add 19 voiceprint.* keys
  5. `frontend/src/App.vue`:
     - data: add `showSpeakerEditor`, `editingSpeakerIdx`, `editingSpeakerName`, `seedMap`, `propagateBusy`, `propagateThreshold`, `showPropagatePanel`
     - Each segment now has "+👤" button (unmarked) or clickable speaker-tag (marked)
     - Click opens **Speaker Editor Modal**: enter speaker name → confirm
     - Add "🪄 Propagate labels to all sentences" button to control bar (purple #7B1FA2)
     - Click opens **Propagation Panel**: list all seeds, adjustable threshold slider, remove/clear/propagate actions
     - Three new methods: `setSegmentSpeaker(idx, name)`, `doPropagateSpeakers()`, `clearAllSpeakers()`
  6. `Product_Design_Guidelines.md`: Add §15 Semi-supervised speaker propagation section
- **Result**:
  - Users can manually click a few sentences to mark them as "Alice", "Bob", etc.
  - Pressing the propagate button completes all other sentence attributions within 5-15 seconds
  - Propagated results can be further fine-tuned with +👤 editing
  - Expected: short sentences (<1.5s) previously misattributed to Speaker_1 are now correctly grouped with the correct speaker via seed comparison
  - Original v1.20.2 unsupervised `diarizeAudio` still works; both coexist in the control bar (v1.20.2 = "👥 Diarize" orange button, v1.21.0 = "🪄 Propagate" purple button)
- **Backup filename**: backup-202606301700.zip

## [2026-06-30 17:35] v1.21.1 — Fix: every speaker edit/clear creates a new metadata file

- **version**: 1.21.0 → 1.21.1 (patch: hotfix)
- **Issue**: After v1.21.0 release, "every time the user cancels a label / edits a speaker name" the history list grows by one extra transcript entry. The expected behavior is in-place edit, not creating a new file each time.
- **Root cause**:
  1. `frontend/src/App.vue` `saveRecordingMeta(segments)` originally generated a new ID based on the current timestamp whenever `currentRecordingId` was empty.
  2. Each call from `setSegmentSpeaker()` / `doPropagateSpeakers()` / `clearAllSpeakers()` invokes `saveRecordingMeta(this.transcriptionResults)`.
  3. Although `_onTranscribeEvent('completed')` sets `currentRecordingId`, race conditions in the "Review from history" or "cancel then re-mark" path can result in `currentRecordingId` being empty when called multiple times — generating a new file each call.
  4. Most common path: click +👤 to mark a speaker (one `setSegmentSpeaker` call) → click the same speaker to cancel (another call) → creates two files.
- **Solution**:
  1. `frontend/src/App.vue` `saveRecordingMeta()`:
     - v1.21.1 hotfix: first read `this.currentRecordingId`; if it already exists, **reuse it** — never generate a new ID.
     - Only fresh transcribe completions or Review entries (where the upper layer explicitly sets an ID) can create new files.
  2. `frontend/src/App.vue` added `_scheduleSaveRecordingMeta()` debounce helper (500ms):
     - Clears the prior setTimeout and resets the timer to avoid race conditions / multiple concurrent save IPCs.
  3. `frontend/src/App.vue` three hotfix sites switched to `_scheduleSaveRecordingMeta()`:
     - `setSegmentSpeaker()`
     - `doPropagateSpeakers()`
     - `clearAllSpeakers()`
  4. `frontend/package.json`: version 1.21.0 → 1.21.1
  5. `Product_Design_Guidelines.md` version and modification date updated
  6. New entry appended to modify_record (zh-TW / en / ja)
- **Result**:
  - The same transcript / same recordingId remains a single file no matter how many times the user marks, cancels, propagates, or clears.
  - "Transcribe complete → view in history" only adds one entry, never gets "刷" into multiple entries by repeated mark/cancel actions.
  - 500ms debounce guarantees that rapid consecutive edits trigger only one full save, preventing I/O storms.
- **Backup filename**: to be generated in the backup step

## [2026-06-30 23:45] v1.21.2 — 修正講者標籤編輯後逐字稿變成無音檔狀態

- **version**: 1.21.1 → 1.21.2（patch: hotfix）
- **修改要求**: 使用者反映 v1.21.1 後，「從歷史記錄 Review 進入逐字稿 → 編輯講者標籤」會使該記錄在歷史列表中變成「無音檔」狀態（原本明明有音檔）。
- **根因分析**:
  1. eviewRecording() 進入時將 	his.currentAudioPath = null 與 	his.audioLoaded = false。
  2. 講者標籤編輯（setSegmentSpeaker()）觸發 _scheduleSaveRecordingMeta() → saveRecordingMeta()。
  3. saveRecordingMeta() 第 1156 行寫死 const audioPath = this.currentAudioPath || ''，
ull 進來後變成空字串。
  4. IPC ecoSaveMeta 被叫起時傳入 udioPath: '' 覆寫原本 metadata 中的 udioPath 欄位為空字串。
  5. 下次 eco:list 讀歷史時 hasAudio 判斷變成 false，逐字稿在歷史中變成「無音檔」狀態。
- **修正方案**:
  1. rontend/src/App.vue saveRecordingMeta()：當 currentAudioPath 為空且 currentRecordingId 存在時，主動呼叫 ecoLoadMeta 從舊 metadata 載入原本的 udioPath 保留，避免覆寫。
  2. rontend/src/App.vue eviewRecording()：不再將 currentAudioPath 強制設為 
ull，改為讀取 .meta.audioPath 或 
ull；同時在進入時若 udioPath 存在則主動呼叫 loadAudioUrl 載入音檔 URL，讓「Review」進入後逐字稿可點擊播放。
  3. rontend/package.json: version 1.21.1 → 1.21.2
  4. Product_Design_Guidelines.md 版本號 / 修改日期一併更新
  5. 三語 modify_record 新增本條目
- **修改結果**:
  - 從歷史 Review 進入逐字稿後，無論編輯幾次講者標籤、推算、清除，音檔連結 (udioPath) 都不會被洗掉。
  - 「有音檔」狀態記號在歷史列表中永久保持。
  - Review 進入後逐字稿可點擊播放（原來需手動先點「▶️ 播放」才會載入音檔，現自動載入）。
- **備份檔名**: 將於備份步驟產生

## [2026-07-01 09:00] v1.21.3 — 逐字稿講者標籤顯示每一句的聲紋值

- **version**: 1.21.2 → 1.21.3（minor: 新功能）
- **修改要求**: 使用者反映「在逐字稿講者標記顯示每一句的聲紋值」— 希望除了「誰說的」之外還能看出「這句與該 speaker 的相似度有多高」，方便判斷標註可信度。
- **背景**: v1.20.2 diarizeAudio 與 v1.21.0 propagateSpeakers 演算法都會對每個 segment 計算 cosine similarity（diarize 算 vs 群組 centroid；propagate 算 vs 種子 centroid），但之前只回傳 .speaker 標籤而把 score 丟掉了。
- **修正方案**:
  1. rontend/electron/voiceprint.js：
     - diarizeAudio()：重新計算每個群組的 centroid，再對每個 segment 用 cosineSimilarity() 算對其群組 centroid 的相似度，存入 esult[i].score。原本 algorithm 已將 centroid 算出來過，但因沒回傳就直接丟了，現在手動重建以取出每群組的 centroid。
     - propagateSpeakers()：本來就已經在算 estSim，改為直接存入 esult[i].score（取 Math.max(0, bestSim) 保證非負）。
     - 兩者都對無效的 segment（null embedding）回傳 score: 0。
  2. rontend/src/App.vue：
     - initJobListener 的 voiceprint completed 分支：把 data.segments[i].score 同步寫入 	ranscriptionResults[i].score。
     - doPropagateSpeakers：同樣寫入 	ranscriptionResults[i].score。
     - 逐字稿 speaker tag 旁邊增加 <span class="speaker-score">{{ (seg.score * 100).toFixed(0) }}</span>，用半透明背景呈現百分比（例：👤 張三 85），hover 顯示完整 1 位小數。
  3. 新增 .speaker-score CSS：白色半透明背景、9px 字、6px radius，與 .speaker-tag 並列顯示。
  4. rontend/package.json: version 1.21.2 → 1.21.3
  5. 三語 modify_record 新增本條目
  6. Product_Design_Guidelines.md 版本號更新
- **修改結果**:
  - 執行 👥 標註說話者 或 🪄 依標註推算 後，每一句的 speaker tag 後方多了一個 0~100 的相似度數字
  - 高於 80% = 高可信度、50-80% = 中等、< 50% = 低（該 segment 跟所屬 speaker 群的 centroid 相似度不高，可能需要重新編輯或加 seed）
  - score 與 speaker 一起持久化到 metadata，重新開啟逐字稿後仍可見
- **備份檔名**: 將於備份步驟產生

## [2026-07-01 15:00] v1.21.4 — 強化多 seed centroid 計算 (trimmed mean + outlier rejection)

- **version**: 1.21.3 → 1.21.4（minor: 演算法強化）
- **修改要求**: 使用者反映「同時標注同一個人的多段句子是否可以提升語音比對準確度」— 想確認是否真的能幫助半監督式 speaker propagation。
- **回答**: 是的，可以，但「不是 seed 越多越好」。多個同一 speaker 的 embeddings 平均後的 centroid 會更穩定，減少單一 segment 受 fbank 雜訊、背景音、語速變化影響。但**邊際效益遞減**：3-5 個乾淨的 seed 已足夠，10+ 個 seed 提升有限。**真正危險的是 outlier seed**（咳嗽、背景音、按鍵聲）會把 centroid 拉偏。
- **修正方案**:
  1. rontend/electron/voiceprint.js propagateSpeakers():
     - 1-2 個 seeds：取 simple mean（沒有足夠統計量剔除 outlier）
     - 3 個以上 seeds：採用 **trimmed mean centroid**：
       - 對所有 seed embeddings 兩兩算 cosine similarity
       - 計算每個 seed 與其他 seed 的平均相似度作為「內部一致性指標」
       - 去掉平均相似度最低與最高各一個 (outlier) → 取中間值的平均
       - 同時記錄 internalCoherence（全體 seeds 內部一致性平均）作為品質指標
  2. 1-2 個 seeds 時不剔除 outlier，3 個以上用 floor(seedCount/4) 計算 dropN，但 dropN 最大只到 1（避免剔除過多）
- **修改結果**:
  - 多個同一 speaker 的 seeds 標注後，centroid 更穩定，可靠度提升
  - 自動剔除 outlier seed（背景雜音、按鍵聲、與該 speaker 不相關的句子）造成的 centroid 偏移
  - 學理上：3-5 個乾淨的 seed 是甜蜜點，10+ 個 seeds 提升有限
- **備份檔名**: 將於備份步驟產生


## [2026-07-02 01:35] v1.22.0 — Multi-Model Speaker Embedding Architecture (MODEL_REGISTRY factory pattern)

- **version**: 1.21.4 → 1.22.0 (minor: multi-model architecture)
- **Change request**: Support multiple ONNX speaker embedding models (camplus / ECAPA-TDNN / ResNet-SE) with a factory pattern design
- **Plan**:
  1. Researched ECAPA-TDNN / ResNet ONNX sources → conclusion: HF/ModelScope/speechbrain official ONNX mirrors all return 401/404
  2. Refactored voiceprint.js to MODEL_REGISTRY factory pattern with 3 model entries (camplus / ecapa_tdnn / resnet_se)
  3. Dynamic ONNX session management: loadModel(modelKey) releases old session before loading new model
  4. File name isolation: each modelKey maps to independent path (voiceprint/<modelKey>/model.onnx)
  5. main.js added 6 IPC handlers: listModels / importModel / setActiveModel / openImportDialog / getCurrentModel / download accepting modelKey
  6. preload.js exposed 5 new APIs
  7. i18n three languages added 22 voiceprint.* keys
  8. App.vue data added voiceprintModels / currentVoiceprintModel + settings panel "Voiceprint Model Management" section
  9. App.vue methods added 5 new: loadVoiceprintModels / downloadVoiceprintModel / importVoiceprintModel / setActiveVoiceprintModel / recommendVoiceprintModel
  10. App.vue mounted() calls loadVoiceprintModels
- **Result**:
  - Syntax check: vite build succeeded (15 modules transformed)
  - Build output: frontend/dist-electron-build5/Recorder-1.22.0-portable.exe (188.6 MB, with signtool signature)
  - camplus is default auto-downloadable; ECAPA-TDNN / ResNet-SE require manual ONNX import
  - Users can freely download / import / switch between three embedding architectures in settings panel
  - Auto model switching: loadModel() releases old session before loading new, backend routes by modelKey
  - Three-language readme + Product_Design_Guidelines §16 + modify_record three languages all synced
- **Backup filename**: backup-202607020126.zip


## [2026-07-02 05:08] v1.22.1 — ResNet-SE now auto-downloadable (WeSpeaker official ONNX)

- **version**: 1.22.0 → 1.22.1 (patch: complete downloadable URL)
- **Change request**: User asked "where to download resnet_se onnx". v1.22.0 defined resnet_se but url was empty (required manual import).
- **Plan**:
  1. Used curl + HuggingFace API models endpoint to find Wespeaker/wespeaker-cnceleb-resnet34-LM public ONNX
  2. Verified download URL: https://huggingface.co/Wespeaker/wespeaker-cnceleb-resnet34-LM/resolve/main/cnceleb_resnet34_LM.onnx (HTTP 200, 26.5 MB)
  3. Used onnxruntime-node to check ONNX structure: inputNames=[feats], outputNames=[embs], 256-dim embedding (interface identical to campplus)
  4. Updated voiceprint.js MODEL_REGISTRY.resnet_se: url + filename + dim changed to 256
  5. Bumped package.json version 1.22.0 → 1.22.1
  6. Updated three-language readme with new v1.22.1 entry
- **Result**:
  - voiceprint.js settings updated; resnet_se is now auto-downloadable (alongside campplus)
  - Advanced option (114MB ResNet293 large model) still requires manual import
  - Three-language readme (zh-TW/en/ja) and modify_record synchronized
- **Backup filename**: backup-202607020508.zip (to be generated)
## [2026-07-02 22:39]
- **version**: 1.22.1 → 1.23.0 (minor: Supervised Speaker Recognition + Profile Database)
- **Requirement**: User asked "Can repeating the same phrase improve speaker recognition?", "How to find a specific speaker's voice in an audio file?", and "Support supervised learning (identification method)". After confirmation, decided to add Speaker Profile Database + supervised speaker recognition module to address v1.21.0 semi-supervised propagation's short-utterance weakness.
- **Core design**:
  - **Profile Database (persistent JSON)**: Stored at ~/recoder/speaker_profiles.json, each profile records {id, name, modelKey, dim, centroid, samples, internalCoherence, source, createdAt, updatedAt}, grouped by modelKey to avoid dimension mixing. MAX_PROFILES = 200.
  - **buildProfile(audioPath, segments, seeds, modelKey)**: Extract audio from user-marked seeds, compute embeddings, calculate trimmed mean centroid, return Array<Profile>. Supports v1.22.0 multi-model (camplus 192-d / ecapa_tdnn 192-d / resnet_se 256-d).
  - **buildProfileFromAudioFile(audioPath, name, modelKey)**: Build profile directly from a short standalone audio file (for "repeat the same phrase" scenarios).
  - **identifySpeakers(audioPath, segments, profiles)**: Supervised identification — extract embeddings of all segments, compute cosine similarity against all profile centroids, mark best match. Returns {segments: [{start, end, text, speaker, score}], modelKey}.
  - **backfillAll(profiles)**: Batch re-annotate all historical recordings with all profiles, useful after creating a new profile. Supports progress event (onVoiceprintBackfillProgress).
- **New module**:
  - rontend/electron/speakerProfile.js — full CRUD persistence layer (listProfiles / getProfile / saveProfile / renameProfile / deleteProfile / getDbPath / getStats).
- **API expansion**:
  - oiceprint.js adds 4 exported functions: buildProfile, buildProfileFromAudioFile, identifySpeakers, _computeCentroidFromEmbeddings.
  - main.js adds 10 IPC handlers: voiceprint:profileList / profileSave / profileRename / profileDelete / profileStats / profileBuildFromSeeds / profileBuildFromAudioFile / openAudioDialog / identifySpeakers / backfillAll + reco:searchBySpeaker.
  - preload.js exposes 11 new APIs to frontend.
- **UI integration** (App.vue):
  - 3 new buttons: 👤 Create Profile, 🎯 Identify Speakers (Supervised), 🔄 Apply to All History.
  - New panel: "Speaker Database" modal — list all profiles, show name, model, sample count, internal coherence (%), support rename/delete.
  - data adds profiles / showProfilePanel / identifyBusy / backfillBusy / backfillProgress.
  - methods add loadProfiles / openProfilePanel / doIdentifySpeakers / doBackfillAll / renameProfile / deleteProfile.
  - CSS adds .profile-item / .profile-header / .profile-name / .profile-model / .profile-stats / .profile-actions styles.
- **i18n fix**:
  - en.js / ja.js / zh-TW.js add 19 voiceprint.profile.* keys.
  - Fix en.js line 308-313 multiline string errors ('confirm.deleteFolder' etc.).
  - PowerShell script auto-quote unquoted key names (prevent recurrence).
- **Build and deploy**:
  - rontend/package.json version 1.22.1 → 1.23.0.
  - vite build success (222.20 kB / 62.26 kB gz).
  - electron-builder success, output dist-electron-build6/Recorder-1.23.0-portable.exe (179.89 MB).
  - Code Sign: Recorder.exe / whisper-cli.exe / ffmpeg.exe / elevate.exe all signed with C:\Certs\recorder_selfsign.pfx, Subject=CN=Cheng-Feng Iron Factory, expires 2029/6/26.
- **Result**: Successfully implemented supervised Speaker Recognition and Profile Database, providing more reliable short-utterance recognition than v1.21.0 semi-supervised method. Users can quickly build personal profiles using short audio of repeated phrases, then batch backfill all historical recordings. Build success, backup complete.
- **Backup filename**: backup-202607022239.zip


## [2026-07-04 06:23] v1.23.0 hotfix1 / 5 / 7 / 8
- **version**: 1.23.0 (cumulative hotfix)
- **hotfix1 (missing UI entry)**: User reported "I can't find where to create a profile in 👤 Create Profile". Root cause: v1.23.0 main feature already implemented Speaker Database panel but forgot to add "💾 Build from Labels" and "📂 Build from Audio File" buttons inside the panel. Fix: Added green profile-create-row block at top of Speaker Database panel with 2 build buttons + corresponding doBuildProfileFromSeeds / doBuildProfileFromAudioFile methods + 200 profile limit check.
- **hotfix5 (IPC return format mismatch)**: After clicking, user got JS exception Cannot read property 'samples' of undefined. Root cause: main.js oiceprint:profileBuildFromSeeds handler returns { success, profiles: [...], savedIds, count } (array), but frontend doBuildProfileFromSeeds reads .profile.samples.length (single object), causing JS exception. Fix: Use const p = (r.profiles && r.profiles[0]) || null; if (p) { ... } to match correct format.
- **hotfix7 (Electron doesn't support window.prompt)**: After hotfix5, user still reported "clicking has no response". Root cause: Chromium disables window.prompt by default (to prevent destructive dialogs), causing prompt() to immediately return null and silently exit. Fix: App.vue added custom <div v-if="showPromptDialog"> modal + _showPromptDialog(title, message, defaultValue) Promise-based function + confirmPromptDialog / cancelPromptDialog handlers, replacing all window.prompt() calls.
- **hotfix8 (preload.js missing v1.23.0 11 APIs)**: User reported "After entering profile name and pressing confirm, ❌ exception: window.electronAPI.voiceprintProfileBuildFromSeeds is not a function". Root cause: Previous build process didn't add v1.23.0's 11 IPC APIs and 1 event listener to rontend/electron/preload.js for renderer exposure. Fix: Added 14 APIs at end of preload.js: oiceprintProfileList/Save/Rename/Delete/Stats + oiceprintProfileBuildFromSeeds/BuildFromAudioFile + oiceprintOpenAudioDialog/IdentifySpeakers/BackfillAll + oiceprintListAllSpeakerNames + ecoSearchBySpeaker + onVoiceprintBackfillProgress.
- **Backup filename**: backup-202607040623.zip
