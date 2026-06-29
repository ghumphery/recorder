# Recorder — Offline AI Meeting Notes Tool

[![GitHub release](https://img.shields.io/github/v/release/ghumphery/recorder)](https://github.com/ghumphery/recorder/releases)
[![GitHub](https://img.shields.io/github/license/ghumphery/recorder)](https://github.com/ghumphery/recorder)

> 🌐 **Language / 語言 / 言語**: [繁體中文](readme.md) | [English](readme_en.md) | [日本語](readme_ja.md)

## 📝 Features

Recorder is a fully **offline** AI meeting notes application:

- 📂 **Audio Import** — Supports WAV / MP3 / Opus / OGG / FLAC / M4A (ffmpeg)
- 🤖 **Speech-to-Text** — Uses whisper.cpp CLI (CPU / Vulkan GPU acceleration, default small model)
- 🎙️ **Recording Mode** — Mic recording / Mix recording (system audio + mic) radio selection
- ✨ **LLM Post-processing** — Text optimization, multi-language translation (Chinese/English/Japanese), summarization (Ollama local/cloud, OpenRouter, SiliconFlow, Gemini)
- 🔑 **Independent API Keys** — Each AI provider stores its own API Key
- 🎮 **GPU Control** — Enable/disable Vulkan GPU acceleration and select GPU device
- ▶️ **Audio Playback** — Click transcript sentences to play corresponding audio segments
- 🗑️ **Delete Management** — Delete specific recordings and audio files
- 📄 **Export Transcript** — Export from recording history interface, plain text (.txt) or Markdown (.md) format
- 📦 **Model Management** — Manage Whisper models in settings panel (download/delete)
- 🔒 **Zero Network Dependency** — Download model once, then fully offline (no Flask / port 5199 / Python)

## 🚀 Development Mode

### Prerequisites

- Node.js 20+, npm
- Speech model (GGML tiny ~77MB, cached after first download)
- **ffmpeg.exe** (~149MB, not included in repo due to GitHub 100MB limit):
  - Download from [gyan.dev FFmpeg Builds](https://www.gyan.dev/ffmpeg/builds/) (`ffmpeg-release-essentials.zip`)
  - Extract `ffmpeg.exe` to the `ffmpeg/` folder in the project root

### Run

```bash
cd frontend
npm run electron:dev
```

### Download Release

Download the latest `Recorder-1.17.0-portable.exe` from [GitHub Releases](https://github.com/ghumphery/recorder/releases).

### Build from Source

```bash
cd frontend
npm run electron:build
# Output: frontend/dist-electron-build2/Recorder-1.17.0-portable.exe
```

### Run Packaged Version

```
frontend\dist-electron\win-unpacked\Recorder.exe
```

### Audio Playback Notes

- Click a transcript sentence to play from that segment's start time; playback continues naturally
- Click "⏹️ Stop" to stop playback immediately
- Switching to another recording or Review automatically stops the current audio
- When transcribing from the Audio Files list, a 16kHz mono WAV is saved to `reco_data` to ensure playback and transcription use the same audio file with aligned timestamps

## 🧰 System Requirements

- **OS**: Windows 10/11
- **CPU**: x64 with AVX2 support (2013+ CPUs)
- **RAM**: 4GB+ recommended
- **Storage**: ~300MB (excluding speech models: tiny 77MB / base 148MB / small 488MB)
- **GPU (optional)**: Vulkan 1.0+ GPU, configurable in settings
- **No Python required**: Pure Node.js + C++ CLI tools
- **Vulkan SDK**: Required only for custom Vulkan builds

## 🔒 Privacy & Security

- All recordings and transcripts are stored locally, never uploaded to cloud
- Only connects to Hugging Face for initial model download
- No backend server (no Flask, no port 5199), all processing via Electron IPC
- See `security.md` for detailed checklist (dev reference only, not in repo)

## 🎯 Usage Flow

1. Launch app → Click "Import" to select an audio file
2. ffmpeg automatically converts to 16kHz mono WAV
3. Select model (tiny/base/small)
4. Click "Transcribe" → wait for progress
5. Review transcript
6. Click "Export" to save (.txt or .md)

## ⚙️ Model Options

- **tiny** (77 MB) — Fastest, good for testing
- **base** (148 MB) — Balanced speed and accuracy
- **small** (488 MB) — Most accurate, best for high-quality meetings

## 📦 Version History

- **v1.15.0** — Replace application icons: top-left window icon and main .exe icon updated to microphone icon; multi-size .ico (16/24/32/48/64/96/128/256) and 256x256 PNG generated via PIL; `BrowserWindow` added `icon` property; `index.html` added favicon
- **v1.14.3** — Add LLM document management panel: list/review/delete documents generated from original transcripts (optimize/translate/summary), distinguished by generation time; translation supports any document (original/optimized/summary); auto-refresh Job panel on open
- **v1.14.2** — Fix LLM batch processing (optimize) "The user aborted a request" error caused by 30-second timeout: increased `callLLM()` AbortController timeout from 30s to 120s; added CSMA/CD-style exponential backoff retry (Slot Time=2s, max 16 retries), retry only on timeout, wait time = `Random(0, 2^k - 1) × Slot Time`
- **v1.14.1** — Fix "An object could not be cloned" error on "✨ Optimize": Vue reactive array (Proxy) cannot be serialized through Electron IPC; use `JSON.parse(JSON.stringify(...))` to convert to plain JSON before passing
- **v1.14.0** — LLM Job Manager async processing: token limit detection with auto batch splitting (CJK 1.5 token/char, ASCII 0.25 token/char estimation); per-sentence optimization preserving original timestamps (`[N] optimized text` format parsing); Job state machine `pending → running → completed/failed/cancelled`; frontend Job list panel with progress bar, log, cancel button
- **v1.13.2** — Fix UI bug caused by i18n refactoring: `mounted()` lifecycle hook was accidentally removed, causing AI provider and whisper model dropdowns to be empty; restored `mounted()` to call `fetchModels()`, `fetchLlmProviders()`, `loadSettings()`
- **v1.13.1** — Build latest portable exe (127 MB), fix Windows Defender `app.asar` lock issue
- **v1.13.0** — Multi-language UI support (zh-TW/en/ja): i18n language files, language selector on first launch and in settings panel; multi-language documentation (readme_en.md, readme_ja.md, modify_record_en.md, modify_record_ja.md)
- **v1.12.2** — Fix move dialog not showing subfolders: `loadAllFolders()` was never called; add `reco:listAllFolders` IPC for recursive folder scanning
- **v1.12.1** — Build latest portable exe (127 MB), fix Windows Defender `app.asar` lock issue
- **v1.12.0** — Tree directory management: folder create/delete/rename, multi-select batch move/delete; remove LLM buttons from recording list; fix label saving (recursive subdirectory scanning)
- **v1.11.0** — Label management: add/edit/delete labels, filter by label, search results with labels and jump-to-recording
- **v1.10.7** — Fix whisper timestamp inaccuracy causing playback repetition: remove auto-jump, continuous playback with highlight only
- **v1.10.6** — Fix next sentence playback repetition: event-driven sequential seek-and-play
- **v1.10.5** — Fix playback delay and repetition: `reviewRecording()` no longer calls `stopPlayback()`
- **v1.10.4** — Fix sentence playback repetition: check `audio.readyState` before seeking
- **v1.10.3** — Add stop playback button, auto-stop on switch, 300ms jump buffer, WAV path unification
- **v1.10.2** — Fix playback bugs: `loadedmetadata` event-driven play, no auto-play from history
- **v1.10.0** — Audio playback (click sentence to play), delete management, audio status indicators
- **v1.8.9** — Fix whisper hallucination: anti-hallucination parameters + deduplication post-processing
- **v1.8.4** — Fix segment recording only transcribing first segment
- **v1.8.3** — Permanent WAV storage in `C:\Users\<user>\recoder\reco_data\`
- **v1.8.2** — Fix title bar version display
- **v1.7.5** — Remove VAD real-time transcription
- **v1.5.4** — Unified model/log/settings storage in `C:\Users\<user>\recoder\`
- **v1.5.3** — Fix "An object could not be cloned" error; settings path to user directory
- **v1.5.2** — Fix "Save Settings" button not responding
- **v1.5.0** — Cross-version settings migration; Vulkan GPU toggle; recompile whisper-cli with Vulkan
- **v1.4.0** — Independent API Keys per provider; model download progress bar; portable mode paths
- **v1.3.3** — Fix LLM error handling; fix Ollama Cloud baseUrl
- **v1.3.1** — Add Ollama Cloud provider
- **v1.3.0** — LLM post-processing: optimize, translate, summarize
- **v1.2.0** — Remove Python + Flask backend; pure Node.js IPC architecture
- **v1.1.0** — Migrate from PyQt5 to Electron + Vue.js + Flask
- **v1.0.0 ~ v1.0.6** — Original PyQt5 + faster-whisper (ctranslate2)

## 📁 Project Structure

```
recorder/
├── frontend/                     # Electron + Vue.js frontend
│   ├── package.json              # Project config & version
│   ├── vite.config.js
│   ├── index.html
│   ├── src/
│   │   ├── main.js               # Vue app entry
│   │   ├── App.vue               # Main component (IPC calls)
│   │   └── i18n/                 # Multi-language support
│   │       ├── index.js
│   │       ├── zh-TW.js
│   │       ├── en.js
│   │       └── ja.js
│   ├── electron/
│   │   ├── main.js               # Electron main process (all backend logic)
│   │   └── preload.js            # preload script (IPC contextBridge)
│   └── dist-electron/            # electron-builder output
├── whisper_cli/                  # whisper-cli.exe + DLLs
├── model/                        # GGML speech models
├── whisper_cpp/                  # whisper.cpp source (for compilation)
├── assets/                       # Resource files
├── backup/                       # Source code backups
├── Product_Design_Guidelines.md
├── modify_record.md
├── readme.md
├── readme_en.md
└── readme_ja.md
```

## 🏗️ Architecture

```
User Action → Electron Vue.js (Frontend)
                 ↓ IPC (no HTTP, no port)
             Electron main.js (Node.js)
              ├── ffmpeg.exe → Audio conversion
              ├── whisper-cli.exe → Speech-to-text
              ├── https.get → Model download
              └── fs.writeFile → Export transcript