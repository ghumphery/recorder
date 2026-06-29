# 製品設計ガイドライン (Product Design Guidelines)

> **バージョン**: 1.8.2
> **最終更新日**: 2026-06-29

## 製品コアビジョンと哲学 (Product Vision & Philosophy)
- **コアバリュー**: 「オフライン、軽量、高精度の AI 会議記録ツール — すべての会話を追跡可能に。」
- **開発原則**
  - **オフラインファースト (Offline-first)**：すべての音声認識はローカル CPU で実行、ネットワーク不要（初回モデルダウンロードのみ接続が必要）。
  - **軽量・高効率**：主流 CPU に対応、メモリ使用量約 300MB、ffmpeg で 16kHz mono WAV に変換。
  - **ユーザー制御可能**：認識結果は手動で修正可能、エクスポート形式を選択可能。
  - **プライバシー保護**：すべてのデータはローカルに保存、クラウドにアップロードされない。

## アーキテクチャと技術仕様 (Architecture & Tech Guidelines)
- **言語**: JavaScript (Node.js, Electron) + HTML/CSS (Vue.js)
- **フロントエンドフレームワーク**: Electron (Chromium) + Vue 3 + Vite
- **バックエンド機構**: Electron main.js が Node.js IPC を介してすべてのバックエンドロジックを直接処理（独立したバックエンドサービスなし）
- **フロントエンド-バックエンド通信**: Electron IPC (`ipcMain` / `ipcRenderer` + `contextBridge`)
- **音声認識エンジン**: whisper.cpp CLI (`whisper-cli.exe`)、CPU (AVX2) および Vulkan GPU アクセラレーション対応
- **GPU アクセラレーション制御**: 2つのバックエンド（CPU / Vulkan）をサポート、設定パネルで GPU の有効/無効と GPU デバイス番号を選択可能；`useGpu=false` 時は `--no-gpu`、有効時は `-dev <番号>` を渡す
- **音声処理**: ffmpeg.exe（音声ファイルを 16kHz mono WAV に変換）
- **モデルダウンロード**: Node.js `https` モジュールで GGML 形式モデルを直接ダウンロード
- **簡体字→繁体字変換**: opencc-js（認識結果を簡体字中国語から自動的に繁体字中国語に変換）
- **録音モード**:
  - **マイク録音**: `navigator.mediaDevices.getUserMedia({ audio: true })` → MediaRecorder (WebM/Opus) → ffmpeg → whisper-cli
  - **オンライン会議ミックス**: `getDisplayMedia({ audio: true })`（システム音声）+ `getUserMedia({ audio: true })`（マイク）→ Web Audio API ミックス → MediaRecorder → ffmpeg → whisper-cli
- **バージョン管理**:
  - バージョンは `frontend/package.json` の `version` フィールドで定義
  - Electron ウィンドウタイトルはバージョンを動的に読み取り：`Recorder v{version} — AI 會議記錄`（`frontend/electron/main.js` の `BrowserWindow title` で設定）
  - 機能追加またはパッチ更新のたびにバージョン番号を増加（Major.Minor.Patch）
- **データフロー**:
  ```
  音声インポート → ffmpeg.exe で 16kHz mono WAV に変換
               → whisper-cli.exe で音声認識 (GGML モデル)
               → opencc-js で簡体字→繁体字変換
               → 繁体字中国語の文字起こしを表示
  ```
- **通信フロー**:
  ```
  ユーザー操作 → Vue.js コンポーネント → IPC → Electron main.js
                                               ├── ffmpeg.exe (変換)
                                               ├── whisper-cli.exe (認識)
                                               ├── opencc-js (簡体字→繁体字)
                                               ├── https.get (モデルダウンロード)
                                               └── fs.writeFile (エクスポート)
  ```
- **バージョニング**: セマンティックバージョニング (Major.Minor.Patch)
- **Python 不要**: 純粋な Node.js + C++ CLI ツール、Python 依存関係ゼロ
- **Flask / port 5199 不要**: すべてのバックエンドロジックは Electron main.js の IPC ハンドラで直接実行

## CLI ツール仕様 (CLI Tools Guidelines)
- **whisper-cli.exe**: whisper.cpp コンパイル済み CLI ツール (~485 KB)、`whisper.dll`、`ggml.dll`、`ggml-base.dll`、`ggml-cpu.dll` が必要
- **ffmpeg.exe**: 音声/動画処理ツール (~130 MB)、各種音声フォーマットを 16kHz mono WAV に変換
- **モデル形式**: GGML 形式、`model/` ディレクトリに保存、ファイル名 `ggml-{size}.bin`
- **whisper-cli パラメータ**:
  - `-m <model>`: モデルパス
  - `-f <file>`: 音声ファイルパス
  - `--output-json -oj <file>`: JSON 出力ファイルパス
  - `-l <lang>`: 言語 (auto/zh/en)
  - `-t <n>`: スレッド数
  - **反幻覚パラメータ**（v1.8.9 以降デフォルト有効）:
    - `-ml 60`: セグメント最大文字数を制限、無音部分での繰り返しテキストを防止
    - `-nth 0.7`: no-speech 閾値を上げ、無音セクションの幻覚出力をフィルタリング
    - `-wt 0.03`: word timestamp 閾値を上げ、低信頼度の単語をフィルタリング
    - `-bs 1 -bo 1`: greedy デコードを使用（beam_size=1, best_of=1）して幻覚を低減
    - `--suppress-nst`: 非音声トークンを抑制（例：[音楽]、 (笑声)）
    - `--no-fallback`: 温度フォールバックを無効化、繰り返しサンプリングを低減
  - **Python 後処理**（`transcriber._deduplicate_repeats()`）：認識完了後、Jaccard 類似度を使用して隣接する高度に類似した重複セグメントを除去、最も長い時間範囲のものを保持
- **ffmpeg パラメータ**: `-y -i <input> -ar 16000 -ac 1 -sample_fmt s16 <output>`

## アプリケーションアイコン仕様 (Application Icon Guidelines)
- **ソース**: ユーザー提供の 1024x1024 RGBA PNG（`assets/app_icon.png`）
- **Windows アイコン**: `assets/app.ico` — マルチサイズ ICO（16/24/32/48/64/96/128/256）、PIL でソース PNG から生成
- **ウィンドウアイコン**: `assets/icon.png`（256x256 PNG）、開発モードの `BrowserWindow` はこのパスを参照；本番モードは `dist/icon.png`（Vite ビルドでコピー）を参照
- **ファビコン**: `frontend/public/icon.png`（Vite 静的アセット）、`index.html` で `<link rel="icon" type="image/png" href="/icon.png">` として参照
- **electron-builder パッケージング**: `package.json` の `build.win.icon` が `../assets/app.ico` を指し、ビルド時に .exe に自動埋め込み

## Code Sign 署名仕様 (Code Sign Guidelines)
- **証明書ソース**: PowerShell `New-SelfSignedCertificate` で生成した自己署名証明書（`C:\Certs\recorder_selfsign.pfx`）、Subject: `CN=Cheng-Feng Iron Factory, O=Cheng-Feng Iron Factory, C=TW`、有効期限 3 年
- **設定方法**: `frontend/package.json` の `win` セクションで設定：
  ```json
  "certificateFile": "C:/Certs/recorder_selfsign.pfx",
  "certificatePassword": "<パスワード>",
  "signAndEditExecutable": true,
  "signtoolOptions": {
    "rfc3161TimeStampServer": "http://timestamp.digicert.com"
  }
  ```
- **署名プロセス**: electron-builder がパッケージング時に Windows SDK の signtool.exe を自動呼び出し、すべての .exe ファイルにデジタル署名（メイン Recorder.exe、whisper-cli.exe、ffmpeg.exe、elevate.exe）
- **タイムスタンプ**: RFC 3161 タイムスタンプサーバー `http://timestamp.digicert.com` を使用し、証明書期限切れ後も署名が検証可能
- **検証方法**: `powershell Get-AuthenticodeSignature <exeパス>` で Status と SignerCertificate を確認
- **注意事項**：
  - 自己署名証明書でも Windows SmartScreen 警告が表示されるため、ユーザーは「More info → Run anyway」をクリックする必要がある
  - 一般公開用には EV 証明書（Extended Validation、約 USD 200-500/年）の購入を推奨。SmartScreen の即時信頼が得られる
  - 証明書パスワードは `package.json` の `win.certificatePassword` フィールドに保存。公開リポジトリにアップロードしないこと（`.gitignore` に含まれている）

## Electron + Vue.js フロントエンドパッケージング仕様 (Frontend Packaging Guidelines)
- **フロントエンドフレームワーク**: Electron 33 + Vue 3 + Vite 6
- **CLI ツール統合**: electron-builder の `extraResources` が `whisper_cli/` と `ffmpeg/` を出力の `resources/` にコピー
- **Electron main.js**: IPC ハンドラを介して CLI ツールを直接呼び出し (`child_process.spawn`)
- **ビルドツール**: electron-builder 25.1.8 (portable モード)
- **ビルドコマンド**: `cd frontend && npm run electron:build`（= `vite build && electron-builder --win portable`）
- **ビルド出力**: `frontend/dist-electron/Recorder-{version}-portable.exe`（Electron + Vue + whisper-cli + ffmpeg を含む）
- **Windows Defender 注意**: ビルド中に `app.asar` がロックされた場合、`directories.output` を `dist-electron-build2` に変更して回避
- **ビルド後検証**: 出力ファイルの確認は**必ず絶対パス**を使用すること（例：`dir c:\...\frontend\dist-electron-build2\Recorder-*.exe`）。`cd /d` でドライブを切り替えてから相対パスで確認するのは避ける（cmd の `&&` チェーンがドライブ間でパス解決エラーを起こし、ファイルが存在しないと誤判定する可能性がある）。`dir /s <完全パス>` を使用して正しいファイル位置を確認すること。
- **開発モード**: `cd frontend && npm run electron:dev`（Vite dev server + Electron を起動）
- **除外項目**: `files` で `node_modules/electron` を除外、Electron 組み込みモジュールとの干渉を防止

## 機能モジュールとビジネスロジック (Functional Modules & Business Logic)


### 11. v1.19.0 新規 — WhisperJobManager 非同期文字起こし（バックエンド）
`frontend/electron/main.js` 内の `WhisperJobManager` クラスが jobQueue / activeJob / jobHistory の 3 段状態管理。フロントエンドの `startTranscribe()` は fire-and-forget になり、即座に `jobId` を返却してバックグラウンド実行。`transcribe:event` で running / completed / failed / cancelled を通知。`~/.recoder/jobs.json` に永続化（最新 50 件）。App 終了時に `cancelAll()` で in-flight ジョブを統一キャンセル。

### 12. v1.18.0 修正 — whisper-cli greedy デコード
`runWhisper()` の args に `-bs 1 -bo 1` を追加、全モード（CPU/GPU）で greedy デコードを使用し、CPU モードで 3~5 倍高速化。進捗プッシュフォールバック：`lastProgressPercent === 0` かつ音声総長 > 0 の場合、「経過時間 / 総時間」で進捗を推定。

### 1. 音声変換 (`electron/main.js` → ffmpeg)
- **機能**: ffmpeg.exe を使用してユーザーがインポートした音声ファイルを 16kHz mono WAV に変換
- **対応形式**: WAV、MP3、Opus、OGG、FLAC、M4A（ffmpeg がサポートするすべての形式）
- **出力**: 16kHz モノラル WAV、システム一時ディレクトリに保存
- **実装方法**: `child_process.spawn('ffmpeg.exe', args)`

### 2. 会議録音 (`frontend/src/App.vue` → MediaRecorder)
- **マイク録音 (🎙️)**
  - `navigator.mediaDevices.getUserMedia({ audio: true })` でマイクストリームを取得
  - `MediaRecorder` で WebM/Opus 形式で録音
  - 録音停止後、IPC `save:recorded` で blob を main.js に送信
  - main.js が一時ファイルに書き込み → ffmpeg で 16kHz WAV に変換 → 現在の音声として設定
- **オンライン会議ミックス (🖥️)**
  - `navigator.mediaDevices.getDisplayMedia({ audio: true })` でシステム音声をキャプチャ
  - 同時に `getUserMedia({ audio: true })` でマイクをキャプチャ
  - Web Audio API で両方を単一の AudioStream にミックス
  - 以降のフローはマイク録音と同じ
- **タイマー**: 録音中にリアルタイムタイマー (00:00 形式) を表示、毎秒更新
- **誤操作防止**: 録音中はインポートボタンを無効化、録音ボタンは「停止」に変更してクリック可能
### 3. 音声認識 (`electron/main.js` → whisper-cli.exe)
- **エンジン**: whisper.cpp CLI、CPU 最適化対応 (AVX2、OpenMP)
- **モデル**: GGML 形式、デフォルト `tiny` (~77MB)、`base` (~148MB)、`small` (~488MB) に切替可能
- **モデルダウンロード**: Node.js `https.get` で Hugging Face (`ggerganov/whisper.cpp`) からダウンロード
- **簡体字→繁体字変換**: opencc-js の `Converter({ from: 'cn', to: 'tw' })` で認識結果を簡体字中国語から繁体字中国語に変換
- **出力形式**:
  ```json
  {
    "transcription": [
      {
        "offsets": { "from": 0, "to": 8080 },
        "text": " 認識テキスト"
      }
    ]
  }
  ```
- **出力**: 文ごとのテキスト + 開始/終了タイムスタンプ (秒)
- **多言語**: 中国語 (zh)、英語 (en) 対応、自動検出

### 4. LLM モジュール (`electron/main.js` → callLLM)
- **機能**: LLM API を使用してテキスト最適化、多言語翻訳（中国語/英語/日本語）、要約を実行
- **対応プロバイダー**:
  - **Ollama (ローカル)**: `http://127.0.0.1:11434/api/generate`、API Key 不要、デフォルトモデル `llama3`
  - **Ollama Cloud**: `https://ollama.com/v1/chat/completions`（OpenAI 互換）、API Key 必要、デフォルトモデル `llama3.2`
  - **OpenRouter**: `https://openrouter.ai/api/v1`、API Key 必要、デフォルトモデル `google/gemma-2-9b-it`
  - **SiliconFlow**: `https://api.siliconflow.cn/v1`、API Key 必要、デフォルトモデル `Qwen/Qwen2.5-7B-Instruct`
  - **Gemini**: `https://generativelanguage.googleapis.com/v1beta`、API Key 必要、デフォルトモデル `gemini-2.0-flash`
- **独立 API Key**: 各プロバイダーのキーは `settings.json` の `apiKeys` オブジェクトに個別に保存（`{ openrouter: '...', siliconflow: '...', gemini: '...', ollama_cloud: '...' }`）
- **クロスバージョン移行**: `settings.json` に `settingsVersion` フィールド；`migrateSettings()` が自動的に旧 `llmApiKey` を新 `apiKeys` オブジェクトに移行
- **翻訳ターゲット言語**: ドロップダウンで翻訳ターゲットを選択（🇯🇵 日本語 / 🇺🇸 英語 / 🇨🇳 中国語）、system prompt が動的に切り替わる
- **実装方法**: `callLLM(provider, apiKey, model, prompt, systemPrompt)` がプロバイダーに応じて対応する API にルーティング
- **3つの機能ボタン**: ✨ 最適化 / 🌐 翻訳（ターゲット言語選択付き） / 📋 要約、結果がある場合のみ表示

### 5. 音声再生と文クリック再生 (`frontend/src/App.vue` + `frontend/electron/main.js`)
- **機能**: 文字起こしの文をクリックして対応する音声セグメントを再生；履歴から読み込み時は自動再生せず、ユーザーが開始文を選択
- **実装方法**:
  - Electron がカスタムプロトコル `reco-file://` を登録、ローカル音声ファイルを安全に renderer プロセスに提供
  - IPC `reco:getAudioUrl` が音声パスを受け取り `reco-file://` URL を返す；IPC `reco:dataPath` でフロントエンドが正しい `reco_data` パスを取得
  - フロントエンドの隠し `<audio>` 要素；文クリック時に `audio.src` を設定、`loadedmetadata` イベントを待ってから `audio.currentTime = seg.start` を設定し `audio.play()` を呼び出し
  - `timeupdate` イベントで再生進捗を監視、`currentTime` に基づいてハイライト文（`playingSegmentIdx`）を更新；再生は自然に継続、自動ジャンプなし；最後の文の `end + 0.5` 秒を超えた場合のみ停止
  - 再生中の文をハイライト表示（`.segment-playing` 青背景 + ▶️ インジケーター）
  - パネルヘッダーに「▶️ 再生中」と「⏹️ 停止」ボタンを表示
  - `playSegment()` はイベント駆動のシーケンシャルフローを使用：`audio.pause()` → `pause` イベントを待つ → `currentTime` を設定 → `seeked` イベントを待つ → `play()`
  - `reviewRecording()` は `stopPlayback()` を呼び出さない（再生状態フラグのみリセット）
  - `playRecordingAudio()` は履歴から音声 URL と文字起こしを読み込み、文字起こしタブに切り替え、`playSegment(0)` を自動呼び出ししない
  - **テキストと音声の同期**: 音声ファイル一覧から文字起こしする際、`import:audio` が変換後の 16kHz mono WAV を `reco_data` ディレクトリに出力；メタデータの `audioPath` はこの WAV を指し、再生と文字起こしで同じ音声ファイルが使用されタイムスタンプが一致
- **セキュリティ**: カスタムプロトコルは `recoDataPath()` 以下のファイルのみ読み取り可能、パストラバーサル攻撃を防止

### 6. ラベル管理 (`frontend/electron/main.js` + `frontend/src/App.vue`)
- **機能**: 録音記録にラベルの追加/編集/削除、ラベルによるフィルタリング；検索結果にラベルを表示し、該当する文の位置にジャンプ可能
- **実装方法**:
  - メタデータ JSON に `labels: []` フィールドを追加（後方互換性あり、旧 JSON では空配列がデフォルト）
  - すべての IPC を再帰的サブディレクトリスキャン（`scanJsonFiles()`）に変更、ツリー型ディレクトリ構造に対応
  - IPC `reco:updateLabels` がすべての JSON を再帰スキャン → 該当 recordingId を検索 → labels を更新 → 書き戻し
  - IPC `reco:listLabels` がすべての JSON を再帰スキャン、重複しないラベルリストを返す
  - `reco:list` が `labelFilter` パラメータをサポート、該当ラベルの録音のみ返す
  - `reco:search` 検索結果に `labels` を含める、キーワードがラベルに一致する場合は該当録音の全セグメントを返す
  - `reco:aiQuery` コンテキストにラベル情報を含める（`--- 録音: xxx (ラベル: A, B) ---`）
- **フロントエンド UI**:
  - 各録音記録にラベルを表示（カラータグ `.label-tag`）
  - 各録音に「🏷️」ボタン、クリックでラベルエディタを開く（ラベルの追加/削除）
  - 履歴エリア上部にラベルフィルタードロップダウン
  - 検索結果にラベルと「📖 ジャンプ」ボタンを表示
  - `jumpToSearchResult()` メソッド：文字起こしを読み込み → 音声 URL を読み込み → 該当セグメントを検索 → 再生

### 7. ツリー型ディレクトリ管理 (`frontend/electron/main.js` + `frontend/src/App.vue`)
- **機能**: 録音記録をツリー型ディレクトリで管理、フォルダの作成/削除/名前変更/移動、複数選択一括移動/削除をサポート
- **データモデル**: 実際のファイルシステムディレクトリをフォルダ構造として使用、`reco_data/` 以下に多階層サブディレクトリを作成可能
- **バックエンド IPC**:
  - `reco:saveMeta` に `folder` パラメータを追加、指定サブディレクトリに書き込み
  - `reco:list` を `{ folder }` パラメータを受け取るように変更、`{ folders, recordings }` ツリー構造を返す
  - `reco:createFolder` がサブディレクトリを作成（セキュリティチェック `isPathSafe()` 付き）
  - `reco:deleteFolder` がディレクトリを再帰削除（`fs.rmSync` recursive）
  - `reco:renameFolder` がディレクトリ名を変更（`fs.renameSync`）
  - `reco:moveRecordings` が複数の JSON + 音声ファイルをターゲットディレクトリに移動
  - `reco:batchDelete` が複数の録音記録を音声ファイルごと一括削除
- **フロントエンド UI**:
  - 現在のパスを表示するブレッドクラムナビゲーション、クリックで上位に移動
  - フォルダ管理ボタン：📁 新規フォルダ / ✏️ 名前変更 / 🗑️ フォルダ削除
  - フォルダリスト：クリックでサブディレクトリに入る
  - 各録音記録にチェックボックス（複数選択モード）
  - 下部ツールバー：📁 選択を移動 / 🗑️ 一括削除 / ☑️ すべて選択 / ⬜ 選択解除
  - 移動ダイアログ：ターゲットフォルダを選択

### 7. 削除管理 (`frontend/electron/main.js` + `frontend/src/App.vue`)
- **録音記録の削除**: IPC `reco:deleteMeta` が `{recordingId}.json` を削除、フロントエンドで確認後に実行
- **音声ファイルの削除**: IPC `reco:deleteAudio` が指定音声ファイルを削除、セキュリティチェック付き（`recoDataPath()` 以下のファイルのみ許可）
- **フロントエンド UI**:
  - 各録音記録に 🟢 音声あり / 🔴 音声なし ステータス表示
  - ▶️ 再生ボタン（音声がある場合のみクリック可能）
  - 🗑️ 削除ボタン（赤色、クリックで確認ダイアログ表示）
  - 音声ファイル一覧にも 🗑️ 削除ボタン

### 8. フロントエンド Vue.js コンポーネント (`frontend/src/App.vue`)
- **フレームワーク**: Vue 3 + Vite 6
- **通信方法**: `window.electronAPI`（preload スクリプトが公開する contextBridge）を介して Electron IPC を呼び出し
- **メイン UI 要素**:
  - 🎙️ マイク録音ボタン（赤色） — ローカルマイクを録音、IPC `save:recorded` で送信
  - 🖥️ オンライン会議ミックスボタン（橙色） — システム音声 + マイクミックスを録音
  - 📂 音声インポートボタン — IPC `dialog:openFile` → `import:audio` で ffmpeg 変換
  - モデル選択ドロップダウン (tiny/base/small) — IPC `models:list` からデータ取得
  - 🤖 文字起こし開始ボタン — IPC `transcribe:start` で whisper-cli を呼び出し
  - 💾 エクスポートボタン — IPC `dialog:saveFile` → `export:save`
  - 録音タイマー — リアルタイム録音時間とモード（マイク/ミックス）を表示
  - 文字起こし表示エリア — 繁体字中国語、タイムスタンプと統計情報付き
- **状態管理**: Vue `data()` を使用してフロントエンド状態を管理：
  - `isRecording` / `recordingMode` — 録音状態
  - `audioLoaded` — 音声インポート済み
  - `busy` — 操作中（ボタン無効）
  - `showProgress` — 進捗バー表示
  - `transcriptionResults` — 認識結果配列
  - `statusText` — ステータスバーメッセージ
- **操作フロー**:
  1. 🎙️ 「マイク録音」または 🖥️ 「オンライン会議ミックス」をクリック → デバイス認証 → 録音開始
  2. 録音ボタンが「⏹️ 停止」に変更、クリックで停止 → MediaRecorder 停止 → ffmpeg 変換 → 音声設定
  3. 認識モデルを選択 → 🤖 「文字起こし」をクリック → モデルキャッシュ確認 → 必要に応じてダウンロード → whisper-cli 呼び出し → opencc 簡体字→繁体字変換
  4. 完了後、繁体字中国語の文字起こしを表示
  5. 💾 「エクスポート」をクリック → Electron 保存ダイアログ → ファイル書き込み

## UI/UX とインタラクション仕様 (UI/UX & Interaction Principles)
- **エラー処理**: IPC 呼び出し失敗時、フロントエンドは `statusText` ステータスバーメッセージを表示、クラッシュしない
- **誤操作防止機構**（Vue `v-if` / `:disabled` 属性による制御）：
  - `busy` が true のとき、すべての操作ボタンを無効化
  - `isRecording` が true のとき、インポートと文字起こしボタンを無効化
  - 録音中のボタンは「⏹️ 停止」に変更、クリック可能
  - `!audioLoaded` のとき、「文字起こし」ボタンを無効化
  - `!hasResult` のとき、「エクスポート」ボタンを無効化
- **進捗フィードバック**: モデルダウンロードと認識中に進捗バーを表示
- **録音認証**: 初回録音クリック時にブラウザが自動的にマイク/画面許可を要求、拒否時は明確なエラーメッセージを表示
- **ウィンドウタイトル**: 形式 `Recoder v{バージョン番号} — AI 會議記錄`、`frontend/package.json` の `version` フィールドを動的に読み取り
- **UI 言語**: 繁体字中国語 (zh-TW)、English (en)、日本語 (ja) に対応、設定パネルまたは初回起動時に切替可能
- **色**: マイク録音赤 (#e53935)、ミックス録音橙 (#FF6F00)、インポート灰 (#607D8B)、文字起こし青 (#2196F3)、エクスポート緑 (#4CAF50)
- **Electron ウィンドウ**: 最小サイズ 720x500、デフォルト 960x720