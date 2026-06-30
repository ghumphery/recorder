# Product Design Guidelines

> **Version**: 1.20.7
> **Last Updated**: 2026-06-30

## v1.20.7 (2026-06-30) — Voiceprint Tri-Fix
- `downloadModel()` now checks `isModelCached()` first to skip re-downloading the cached model
- `getAudioDuration()` parses ffmpeg stderr to read the audio length
- `splitLongAudio()` uses ffmpeg `-f segment -segment_time 3000` to slice long audio into ≤ 50-min WAV chunks
- `extractSegmentPcm()` pads short (<1.5s) segments with ±0.5s and lowers the floor to 0.3s
- `extractEmbedding()` loosens the `numFrames < 5` limit to `< 3`
- `clusterEmbeddings()` rewritten as a two-stage algorithm: neighbour sliding-window median cosine ≥ 0.55 union-find merge, then global centroid cosine ≥ 0.5 greedy merge
- Unified `MIN_MODEL_SIZE = 40MB`; removed duplicate model-size constants
- New shared `getFfmpegPath()` helper for diarizeAudio / splitLongAudio / extractSegmentPcm

## Product Vision & Philosophy
- **Core Value**: "An offline, lightweight, and accurate AI meeting notes tool — making every conversation traceable."
- **Development Principles**
  - **Offline-first**: All speech recognition runs locally on CPU, no network required (only initial model download needs internet).
  - **Lightweight & Efficient**: Supports mainstream CPUs, memory usage ~300MB, audio converted to 16kHz mono WAV via ffmpeg.
  - **User Controllable**: Recognition results can be manually corrected, export format selectable.
  - **Privacy Protection**: All data stored locally, never uploaded to cloud.

## Architecture & Tech Guidelines
- **Language**: JavaScript (Node.js, Electron) + HTML/CSS (Vue.js)
- **Frontend Framework**: Electron (Chromium) + Vue 3 + Vite
- **Backend Mechanism**: Electron main.js handles all backend logic directly via Node.js IPC (no separate backend service)
- **Frontend-Backend Communication**: Electron IPC (`ipcMain` / `ipcRenderer` + `contextBridge`)
- **Speech Recognition Engine**: whisper.cpp CLI (`whisper-cli.exe`), supports CPU (AVX2) and Vulkan GPU acceleration
- **GPU Acceleration Control**: Supports two backends (CPU / Vulkan), enable/disable GPU and select GPU device number in settings panel; passes `--no-gpu` when `useGpu=false`, passes `-dev <number>` when enabled
- **Audio Processing**: ffmpeg.exe (audio conversion to 16kHz mono WAV)
- **Model Download**: Node.js `https` module directly downloads GGML format models
- **Simplified to Traditional Chinese Conversion**: opencc-js (automatically converts recognition results from Simplified Chinese to Traditional Chinese)
- **Recording Modes**:
  - **Microphone Recording**: `navigator.mediaDevices.getUserMedia({ audio: true })` → MediaRecorder (WebM/Opus) → ffmpeg → whisper-cli
  - **Online Meeting Mix**: `getDisplayMedia({ audio: true })` (system audio) + `getUserMedia({ audio: true })` (microphone) → Web Audio API mix → MediaRecorder → ffmpeg → whisper-cli
- **Version Management**:
  - Version defined in `frontend/package.json` `version` field
  - Electron window title dynamically reads version: `Recorder v{version} — AI 會議記錄` (set in `frontend/electron/main.js` `BrowserWindow title`)
  - Each feature or patch update must increment version number (Major.Minor.Patch)
- **Data Flow**:
  ```
  Import audio → ffmpeg.exe convert to 16kHz mono WAV
              → whisper-cli.exe speech-to-text (GGML model)
              → opencc-js simplified to traditional Chinese
              → Display Traditional Chinese transcript
  ```
- **Communication Flow**:
  ```
  User Action → Vue.js Component → IPC → Electron main.js
                                          ├── ffmpeg.exe (conversion)
                                          ├── whisper-cli.exe (recognition)
                                          ├── opencc-js (simplified to traditional)
                                          ├── https.get (model download)
                                          └── fs.writeFile (export)
  ```
- **Versioning**: Semantic Versioning (Major.Minor.Patch)
- **No Python Required**: Pure Node.js + C++ CLI tools, zero Python dependencies
- **No Flask / port 5199**: All backend logic executed directly in Electron main.js IPC handlers

## CLI Tools Guidelines
- **whisper-cli.exe**: whisper.cpp compiled CLI tool (~485 KB), requires `whisper.dll`, `ggml.dll`, `ggml-base.dll`, `ggml-cpu.dll`
- **ffmpeg.exe**: Audio/video processing tool (~130 MB), used to convert various audio formats to 16kHz mono WAV
- **Model Format**: GGML format, stored in `model/` directory, filename `ggml-{size}.bin`
- **whisper-cli Parameters**:
  - `-m <model>`: Model path
  - `-f <file>`: Audio file path
  - `--output-json -oj <file>`: JSON output file path
  - `-l <lang>`: Language (auto/zh/en)
  - `-t <n>`: Thread count
  - **Anti-hallucination Parameters** (enabled by default since v1.8.9):
    - `-ml 60`: Limit max characters per segment, prevent repeated text in silent sections
    - `-nth 0.7`: Increase no-speech threshold, filter hallucination output in silent sections
    - `-wt 0.03`: Increase word timestamp threshold, filter low-confidence words
    - `-bs 1 -bo 1`: Use greedy decoding (beam_size=1, best_of=1) to reduce hallucinations
    - `--suppress-nst`: Suppress non-speech tokens (e.g., [Music], (laughter))
    - `--no-fallback`: Disable temperature fallback, reduce repeated sampling
  - **Python Post-processing** (`transcriber._deduplicate_repeats()`): After recognition, use Jaccard similarity to remove adjacent highly similar duplicate segments, keeping the one with the longest time span
- **ffmpeg Parameters**: `-y -i <input> -ar 16000 -ac 1 -sample_fmt s16 <output>`

## Application Icon Guidelines
- **Source**: User-provided 1024x1024 RGBA PNG (`assets/app_icon.png`)
- **Windows Icon**: `assets/app.ico` — Multi-size ICO (16/24/32/48/64/96/128/256), generated from source PNG using PIL
- **Window Icon**: `assets/icon.png` (256x256 PNG), dev mode `BrowserWindow` points to this path; production mode points to `dist/icon.png` (copied by Vite build)
- **Favicon**: `frontend/public/icon.png` (Vite static asset), referenced in `index.html` via `<link rel="icon" type="image/png" href="/icon.png">`
- **electron-builder Packaging**: `package.json` `build.win.icon` points to `../assets/app.ico`, automatically embedded in .exe during build

## Code Sign Guidelines
- **Certificate Source**: Self-signed certificate generated via PowerShell `New-SelfSignedCertificate` (`C:\Certs\recorder_selfsign.pfx`), Subject: `CN=Cheng-Feng Iron Factory, O=Cheng-Feng Iron Factory, C=TW`, 3-year validity
- **Configuration**: Set in `frontend/package.json` `win` section:
  ```json
  "certificateFile": "C:/Certs/recorder_selfsign.pfx",
  "certificatePassword": "<password>",
  "signAndEditExecutable": true,
  "signtoolOptions": {
    "rfc3161TimeStampServer": "http://timestamp.digicert.com"
  }
  ```
- **Signing Process**: electron-builder automatically calls Windows SDK signtool.exe during packaging to sign all .exe files (main Recorder.exe, whisper-cli.exe, ffmpeg.exe, elevate.exe)
- **Timestamp**: Uses RFC 3161 timestamp server `http://timestamp.digicert.com` to ensure signatures remain verifiable after certificate expiration
- **Verification**: `powershell Get-AuthenticodeSignature <exe_path>` to check Status and SignerCertificate
- **Notes**:
  - Self-signed certificates still trigger Windows SmartScreen warnings; users must click "More info → Run anyway"
  - For public distribution, consider purchasing an EV certificate (Extended Validation, ~USD 200-500/year) for immediate SmartScreen trust
  - Certificate password is stored in `package.json` `win.certificatePassword` field; do not upload this file to public repos (already in `.gitignore`)

## Electron + Vue.js Frontend Packaging Guidelines
- **Frontend Framework**: Electron 33 + Vue 3 + Vite 6
- **CLI Tool Integration**: electron-builder's `extraResources` copies `whisper_cli/` and `ffmpeg/` to `resources/` in output
- **Electron main.js**: Calls CLI tools directly via IPC handlers (`child_process.spawn`)
- **Build Tool**: electron-builder 25.1.8 (portable mode)
- **Build Command**: `cd frontend && npm run electron:build` (= `vite build && electron-builder --win portable`)
- **Build Output**: `frontend/dist-electron/Recorder-{version}-portable.exe` (includes Electron + Vue + whisper-cli + ffmpeg)
- **Windows Defender Note**: If `app.asar` is locked during build, change `directories.output` to `dist-electron-build2` to bypass
- **Post-build Verification**: **Always use absolute paths** to verify build output, e.g. `dir c:\...\frontend\dist-electron-build2\Recorder-*.exe`. Avoid using `cd /d` to switch drives then checking with relative paths (cmd's `&&` chaining across drives may cause path resolution errors, falsely reporting files as missing). Use `dir /s <full path>` to ensure correct file location.
- **Development Mode**: `cd frontend && npm run electron:dev` (starts Vite dev server + Electron)
- **Exclusions**: `files` excludes `node_modules/electron` to avoid interfering with Electron built-in modules

## Functional Modules & Business Logic


### 11. v1.19.0 new — WhisperJobManager async transcription (backend)
The `WhisperJobManager` class in `frontend/electron/main.js` manages three-state machine: jobQueue / activeJob / jobHistory. Frontend `startTranscribe()` is now fire-and-forget, returns `jobId` immediately, and runs in background. Uses `transcribe:event` to push running / completed / failed / cancelled states. Persists to `~/.recoder/jobs.json` (last 50 records). On App close, `cancelAll()` cancels all in-flight jobs.

### 12. v1.18.0 fix — whisper-cli greedy decoding
`runWhisper()` args now include `-bs 1 -bo 1`, using greedy decoding for all modes (CPU/GPU), achieving 3-5x CPU speedup. Progress push fallback: when `lastProgressPercent === 0` and audio total duration > 0, fall back to "elapsed / total duration" estimation.

### 1. Audio Conversion (`electron/main.js` → ffmpeg)
- **Function**: Uses ffmpeg.exe to convert user-imported audio files to 16kHz mono WAV
- **Supported Formats**: WAV, MP3, Opus, OGG, FLAC, M4A (all ffmpeg-supported formats)
- **Output**: 16kHz mono WAV, stored in system temp directory
- **Implementation**: `child_process.spawn('ffmpeg.exe', args)`

### 2. Meeting Recording (`frontend/src/App.vue` → MediaRecorder)
- **Microphone Recording (🎙️)**
  - Uses `navigator.mediaDevices.getUserMedia({ audio: true })` to get microphone stream
  - Records using `MediaRecorder` in WebM/Opus format
  - Sends blob via IPC `save:recorded` to main.js after recording stops
  - main.js writes to temp file → ffmpeg converts to 16kHz WAV → sets as current audio
- **Online Meeting Mix (🖥️)**
  - Uses `navigator.mediaDevices.getDisplayMedia({ audio: true })` to capture system audio
  - Simultaneously uses `getUserMedia({ audio: true })` to capture microphone
  - Uses Web Audio API to mix both into a single AudioStream
  - Rest of flow same as microphone recording
- **Timer**: Shows real-time timer (00:00 format) during recording, updates every second
- **Foolproof**: Import button disabled during recording, recording button changes to "Stop Recording" clickable
### 3. Speech Recognition (`electron/main.js` → whisper-cli.exe)
- **Engine**: whisper.cpp CLI, supports CPU optimization (AVX2, OpenMP)
- **Models**: GGML format, default `tiny` (~77MB), switchable to `base` (~148MB), `small` (~488MB)
- **Model Download**: Via Node.js `https.get` from Hugging Face (`ggerganov/whisper.cpp`)
- **Simplified to Traditional**: Uses opencc-js `Converter({ from: 'cn', to: 'tw' })` to convert recognition results from Simplified Chinese to Traditional Chinese
- **Output Format**:
  ```json
  {
    "transcription": [
      {
        "offsets": { "from": 0, "to": 8080 },
        "text": " recognition text"
      }
    ]
  }
  ```
- **Output**: Sentence-by-sentence text + start/end timestamps (seconds)
- **Multi-language**: Supports Chinese (zh), English (en), auto-detection

### 4. LLM Module (`electron/main.js` → callLLM)
- **Function**: Uses LLM API for text optimization, multi-language translation (Chinese/English/Japanese), summarization
- **Supported Providers**:
  - **Ollama (Local)**: `http://127.0.0.1:11434/api/generate`, no API Key required, default model `llama3`
  - **Ollama Cloud**: `https://ollama.com/v1/chat/completions` (OpenAI-compatible), API Key required, default model `llama3.2`
  - **OpenRouter**: `https://openrouter.ai/api/v1`, API Key required, default model `google/gemma-2-9b-it`
  - **SiliconFlow**: `https://api.siliconflow.cn/v1`, API Key required, default model `Qwen/Qwen2.5-7B-Instruct`
  - **Gemini**: `https://generativelanguage.googleapis.com/v1beta`, API Key required, default model `gemini-2.0-flash`
- **Independent API Keys**: Each provider's key stored separately in `settings.json` `apiKeys` object (`{ openrouter: '...', siliconflow: '...', gemini: '...', ollama_cloud: '...' }`)
- **Cross-version Migration**: `settings.json` has `settingsVersion` field; `migrateSettings()` automatically migrates old `llmApiKey` to new `apiKeys` object
- **Translation Target Language**: Dropdown to select translation target (🇯🇵 Japanese / 🇺🇸 English / 🇨🇳 Chinese), system prompt switches dynamically
- **Implementation**: `callLLM(provider, apiKey, model, prompt, systemPrompt)` routes to corresponding API based on provider
- **Three Function Buttons**: ✨ Optimize / 🌐 Translate (with target language selection) / 📋 Summarize, only shown when results exist

### 5. Audio Playback & Sentence Click Play (`frontend/src/App.vue` + `frontend/electron/main.js`)
- **Function**: Supports clicking transcript sentences to play corresponding audio segments; does not auto-play when loading from history, user selects starting sentence
- **Implementation**:
  - Electron registers custom protocol `reco-file://` to safely provide local audio files to renderer process
  - IPC `reco:getAudioUrl` receives audio path, returns `reco-file://` URL; IPC `reco:dataPath` lets frontend get correct `reco_data` path
  - Frontend hidden `<audio>` element; sets `audio.src` when clicking sentence, waits for `loadedmetadata` event then sets `audio.currentTime = seg.start` and calls `audio.play()`
  - `timeupdate` event monitors playback progress, updates highlighted sentence (`playingSegmentIdx`) based on `currentTime`; playback continues naturally without auto-jump; only stops when exceeding last sentence's `end + 0.5` seconds
  - Playing sentence highlighted (`.segment-playing` blue background + ▶️ indicator)
  - Panel header shows "▶️ Playing" and "⏹️ Stop" button during playback
  - `playSegment()` uses event-driven sequential flow: `audio.pause()` → wait for `pause` event → set `currentTime` → wait for `seeked` event → `play()`
  - `reviewRecording()` no longer calls `stopPlayback()` (only resets playback state flags)
  - `playRecordingAudio()` loads audio URL and transcript from history, switches to transcript tab, no longer auto-calls `playSegment(0)`
  - **Text-Audio Alignment**: When transcribing from audio file list, `import:audio` outputs converted 16kHz mono WAV to `reco_data` directory; metadata `audioPath` is this WAV, ensuring playback and transcription use the same audio file with aligned timestamps
- **Security**: Custom protocol only allows reading files under `recoDataPath()`, preventing path traversal attacks

### 6. Label Management (`frontend/electron/main.js` + `frontend/src/App.vue`)
- **Function**: Recordings can add/edit/delete labels, filter recording list by label; search results show labels and support jumping to relative sentence position
- **Implementation**:
  - Metadata JSON adds `labels: []` field (backward compatible, defaults to empty array for old JSON)
  - All IPC changed to recursive subdirectory scanning (`scanJsonFiles()`), supporting tree directory structure
  - IPC `reco:updateLabels` recursively scans all JSON → finds matching recordingId → updates labels → writes back
  - IPC `reco:listLabels` recursively scans all JSON, returns unique label list
  - `reco:list` supports `labelFilter` parameter, only returns recordings with that label
  - `reco:search` search results include `labels`, keyword matching label returns all segments of that recording
  - `reco:aiQuery` context includes labels info (`--- Recording: xxx (Labels: A, B) ---`)
- **Frontend UI**:
  - Each recording shows labels (colored tag `.label-tag`)
  - Each recording has "🏷️" button, clicking opens label editor (add/delete labels)
  - Label filter dropdown above history area
  - Search results show labels and "📖 Jump" button
  - `jumpToSearchResult()` method: loads transcript → loads audio URL → finds corresponding segment → plays

### 7. Tree Directory Management (`frontend/electron/main.js` + `frontend/src/App.vue`)
- **Function**: Recordings use tree directory management, supports folder create/delete/rename/move, and multi-select batch move/delete
- **Data Model**: Uses actual filesystem directories as folder structure, multi-level subdirectories under `reco_data/`
- **Backend IPC**:
  - `reco:saveMeta` adds `folder` parameter, writes to specified subdirectory
  - `reco:list` changed to receive `{ folder }` parameter, returns `{ folders, recordings }` tree structure
  - `reco:createFolder` creates subdirectory (with security check `isPathSafe()`)
  - `reco:deleteFolder` recursively deletes directory (`fs.rmSync` recursive)
  - `reco:renameFolder` renames directory (`fs.renameSync`)
  - `reco:moveRecordings` moves multiple JSON + audio files to target directory
  - `reco:batchDelete` batch deletes multiple recordings including audio
- **Frontend UI**:
  - Breadcrumb navigation showing current path, clickable to go up
  - Folder management buttons: 📁 New Folder / ✏️ Rename / 🗑️ Delete Folder
  - Folder list: click to enter subdirectory
  - Each recording has checkbox (multi-select mode)
  - Bottom toolbar: 📁 Move Selected / 🗑️ Batch Delete / ☑️ Select All / ⬜ Deselect All
  - Move dialog: select target folder

### 7. Delete Management (`frontend/electron/main.js` + `frontend/src/App.vue`)
- **Delete Recording**: IPC `reco:deleteMeta` deletes `{recordingId}.json`, frontend confirms before execution
- **Delete Audio**: IPC `reco:deleteAudio` deletes specified audio file, with security check (only allows files under `recoDataPath()`)
- **Frontend UI**:
  - Each recording shows 🟢 Has Audio / 🔴 No Audio status
  - ▶️ Play button (only clickable when audio exists)
  - 🗑️ Delete button (red, shows confirm dialog)
  - Audio file list also has 🗑️ Delete button

### 8. Frontend Vue.js Component (`frontend/src/App.vue`)
- **Framework**: Vue 3 + Vite 6
- **Communication**: Via `window.electronAPI` (contextBridge exposed by preload script) calling Electron IPC
- **Main UI Elements**:
  - 🎙️ Microphone Record button (red) — Records local microphone, sends via IPC `save:recorded`
  - 🖥️ Online Meeting Mix button (orange) — Records system audio + microphone mix
  - 📂 Import Audio button — Via IPC `dialog:openFile` → `import:audio` for ffmpeg conversion
  - Model selection dropdown (tiny/base/small) — Data from IPC `models:list`
  - 🤖 Start Transcribe button — Via IPC `transcribe:start` calling whisper-cli
  - 💾 Export button — Via IPC `dialog:saveFile` → `export:save`
  - Recording timer — Shows real-time recording time and mode (mic/mix)
  - Transcript display area — Traditional Chinese, with timestamps and statistics
- **State Management**: Uses Vue `data()` for frontend state:
  - `isRecording` / `recordingMode` — Recording state
  - `audioLoaded` — Audio imported
  - `busy` — Operation in progress (buttons disabled)
  - `showProgress` — Progress bar display
  - `transcriptionResults` — Recognition results array
  - `statusText` — Status bar message
- **Operation Flow**:
  1. 🎙️ Click "Microphone Record" or 🖥️ Click "Online Meeting Mix" → Authorize device → Start recording
  2. Recording button changes to "⏹️ Stop Recording", click to stop → MediaRecorder stops → ffmpeg converts → Set audio
  3. Select recognition model → 🤖 Click "Start Transcribe" → Check model cache → Download if needed → Call whisper-cli → opencc simplified to traditional
  4. Display Traditional Chinese transcript after completion
  5. 💾 Click "Export" → Electron save dialog → Write file

## UI/UX & Interaction Principles
- **Error Handling**: Frontend shows `statusText` status bar message on IPC failure, does not crash
- **Foolproof Mechanisms** (via Vue `v-if` / `:disabled` attribute):
  - All operation buttons disabled when `busy` is true
  - Import and transcribe buttons disabled when `isRecording` is true
  - Current recording button changes to "⏹️ Stop Recording" clickable
  - "Start Transcribe" button disabled when `!audioLoaded`
  - "Export" button disabled when `!hasResult`
- **Progress Feedback**: Progress bar shown during model download and recognition
- **Recording Authorization**: Browser automatically requests microphone/screen permission on first recording click, shows clear error message on denial
- **Window Title**: Format `Recoder v{version} — AI 會議記錄`, dynamically reads `frontend/package.json` `version` field
- **UI Language**: Supports Traditional Chinese (zh-TW), English (en), Japanese (ja), switchable in settings panel or on first launch
- **Colors**: Microphone recording red (#e53935), Mix recording orange (#FF6F00), Import gray (#607D8B), Transcribe blue (#2196F3), Export green (#4CAF50)
- **Electron Window**: Minimum size 720x500, default 960x720