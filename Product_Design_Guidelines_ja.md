# 製品設計ガイドライン (Product Design Guidelines)

> **バージョン**: 1.23.6
> **最終更新日**: 2026-07-08

## v1.23.6 (2026-07-08) — 声紋 GPU / DirectML (Vulkan) アクセラレーション対応

**問題**: v1.23.5 では設定パネルに「GPU 有效化」チェックボックスが表示されていたが、コードが `useGpu` フラグを声紋モジュールに伝えていなかったため、`loadModel()` は常に `executionProviders: ['cpu']` がハードコードされており、チェックボックスは実質的に無効だった。ユーザーから「vulkan GPU 在聲紋辨識 無法使用gpu，就算 enable vulkan 選項」という報告を受けた。

**修正**:
1. `voiceprint.js` の `loadModel(modelKey, useGpu)` を `useGpu ? ['dml', 'cpu'] : ['cpu']` に変更。DML は `onnxruntime-node` 1.27.0 がネイティブにサポートする唯一の GPU EP。Windows 11 + WDDM 2.9+ ドライバ上で Vulkan API コールに透過変換される。DML 失敗時 (例: v1.20.12 で記録された campplus AveragePool の `80070057`)、`loadModel` は自動的に CPU パスにリトライする。`_lastLoadProvider` / `_lastLoadUseGpu` キャッシュ変数を `loadModel` の前に移動（hoisting 順序バグ回避）、`getCurrentProvider()` を新設して実際の使用 EP を公開。
2. カスケード: `setActiveModel`、`_ensureModelLoaded`、`diarizeAudio`、`propagateSpeakers`、`identifySpeakers`、`buildProfile`、`buildProfileFromAudioFile` 全て `useGpu` を受け取って転送。`module.exports` に `getCurrentProvider` を追加。
3. `main.js` 7 個の voiceprint IPC ハンドラで `useGpu` 受け入れ: `voiceprint:status` (`provider` フィールドを返すように)、`voiceprint:download` (ダウンロード後に `setActiveModel(modelKey, useGpu)`)、`voiceprint:diarize` / `voiceprint:propagate` (`opts.useGpu` 経由) / `voiceprint:identifySpeakers` / `voiceprint:backfillAll` / `voiceprint:jobSubmit` (新規 `useGpu` フィールドをそのまま透過)。
4. `VoiceprintJobManager` の addJob / _executeJob も `useGpu` 受け入れ。バックグラウンド diarize ジョブも GPU 上で動作。
5. `App.vue` 5 箇所の voiceprint 呼び出しに `useGpu: this.useGpu` を付与（voiceprintDownload / voiceprintJobSubmit / voiceprintPropagate / voiceprintIdentifySpeakers / voiceprintBackfillAll）。`preload.js` は変更不要 — ペイロードパススルーは元々正しかった。
6. `frontend/package.json` 1.23.5 → 1.23.6。

**なぜ DirectML が Windows 唯一の選択肢か**: `onnxruntime-node` 1.27.0 には CUDA ビルドが含まれず、WebGPU / ROCm / OpenCL EP も提供されていない。DirectML が唯一のネイティブサポート GPU EP であり、AMD RX / Intel Arc / NVIDIA 全シリーズで動作する（CUDA toolkit 不要）。

**結果**: 声紋モジュールが GPU チェックボックスを尊重するようになった。DML 成功時は GPU で動作、失敗時は diarize / propagate / identify を中断せず CPU に自動フォールバック。

## v1.20.11 (2026-06-30) — 声紋モデルダウンロード hotfix
- `MIN_MODEL_SIZE` を `40 MB` から `25 MB` に引き下げ、「ダウンロード不完全(受信 28283928 bytes のみ)」繰り返し失敗を解消。
- **根本原因**: v1.20.7 で閾値が大きすぎ。実際の `campplus_cn_en_common_200k.onnx` は **28,283,928 bytes (≒26.97 MB)** — 先頭 16 bytes `08 08 12 07 70 79 74 6F 72 63 68 1A 06 32 2E 31` は正規 protobuf ONNX magic (pytorch 2.10.0 exporter)。
- `isModelCached()` と `diarizeAudio()` は同じ定数を共有し、将来のマジックナンバーの漂流を防止。

### 14. モジュール横断非同期 Job 架構仕様（Job Manager Pattern）— 未来の Job 作成契約

> **位置付け**: 本節は**未来に任何類型の Job** を新規追加する際に必ず遵守すべき設計規約です。§11〜13 は歷史實例（v1.14.0 LlmJobManager / v1.19.0 WhisperJobManager / v1.20.0 Jobs UI）であり、§14 はクラス横断適用の**契約層**です。新しい JobManager は本節のすべてのサブセクションを満たさなければ master に merge できません。

#### 14.1 目標と設計哲学
- **UI をブロックしない**：音声認識、LLM、話者ラベリングは背景で 5〜120 分走る可能性がある。呼び出し側は fire-and-forget で、ポタン押下後即座に jobId を返す。
- **同一マネージャで 1 in-flight 制限**：**同一種類の JobManager**（whisper など）は同時に 1 つだけ実行。**違う種類は並行可**（whisper が走っている間に LLM を走らせることは可能）。
- **IPC ブッシュ + ポーリング二重ルート**：レンダラー側は `*:jobUpdate` を購読してライブ進捗を受け取り、隨時 `*:jobStatus(jobId)` で再接続や状態確認が可能。
- **再開可能**：長時間タスク（≥ 30 分）は `~/.recoder/jobs.json` 永続化を推奨。短時間はメモリのままで可。
- **キャンセル可能**：running 中の Job は `cancelJob` で即座に停止できる必要があり（子プロセス kill + cancelled にマーク）、UI は新しい状態を反映しなければならない。

#### 14.2 Job オブジェクト統一スキーマ
新しい JobManager は以下のフィールドレイアウトを使用しなければならない：
```js
{
  id: string,                  // UUID v4 — cancel/query で使用
  type: 'transcribe'|'optimize'|'translate'|'summary'|'aiQuery'|'diarize'|<new_type>,
  status: 'pending'|'running'|'completed'|'failed'|'cancelled',
  params: object,              // サブミット時の入力
  progress: {                   // 任意フィールド、プログレスバーで使用
    percent: number(0-100),
    batch?: number, totalBatches?: number,
    currentChunk?: number, totalChunks?: number,
  },
  result: any,                 // 完了後の返り値（型ごとに形が異なる）
  error: string|null,          // status === 'failed' の時にセット
  log: string[],               // ログ蓄積（Modal ビュアーで使用）
  createdAt: ISO,
  startedAt: ISO|null,
  completedAt: ISO|null,
}
```

#### 14.3 ステートマシン（スキップ不可）
```
pending → running → completed
                    \→ failed
                    \→ cancelled
```
- `processNext()` が Job を取り出すと、いますぐ `running` に遷移して `startedAt` をスタンプする。
- **`pending → completed` は禁止** — 必ず `running` を経由する。
- どんな例外も catch し、必ず `status: 'failed'` に変換（`error` もセット）。
- UI からのキャンセル：running → cancelled（+ child kill）；pending → キューから除去し cancelled にマーク。

#### 14.4 JobManager 抽象インターフェース（必須実装）
| メソッド | シグネチャ | 必須実装項目 |
|---|---|---|
| `addJob(params)` | `→ Job` | `jobQueue` に push し、新しい Job を返す（`id` 付き）。同種類で既に 1 in-flight の場合、キューに入るか拒絶するかを自マネージャが決めるが、契約をドキュメント化必須。 |
| `processNext()` | `async` | 内部ループ：in-flight がなければ head を取り出し、`running` に反転し `startedAt` をセットし `_executeJob(job)` を起動し、`progress/result/error/completedAt` を書く。例外は**必ず** try/catch し `failed` に変換する。 |
| `cancelJob(jobId)` | `→ boolean` | `pending`：queue splice + cancelled にマーク。`running`：`child.kill('SIGTERM')` + cancelled + 完了時刻スタンプ。他状態：`false` 返却。 |
| `getStatus(jobId)` / `getJobStatus(jobId)` | `→ Job\|null` | active / queue / history を横断して検索。`getJobStatus` は LLM と話者ラベリングの命名一貫性のための別名。 |
| `listJobs()` | `→ Job[]` | 全部返す（active + queue + history）、Jobs パネルでレンダリングされる。 |
| `deleteJob(jobId)` | `→ boolean` | running：最初に cancel。pending：queue splice。history：splice。実際に削除したかどうかを返す。 |
| `cancelAll()` (optional) | `async` | **Whisper は必須** — `before-quit` で呼び出し、子プロセスが reap されゾンビを残さない。短時間 Job は省略可。 |
| `clearHistory()` (optional) | `void` | **Whisper は必須** — 一括クリア、「clearAll」UI ボタンで使用。 |

**必須プライベートヘルパー**：
- `_generateId()` — UUID v4、Node 內建 `crypto.randomUUID()` を使用。
- `_log(job, message)` — `job.log` に push + `appLog` に転送（ISO タイムスタンプ）。
- `_sendUpdate(job)` — `mainWindow.webContents.send('<prefix>:jobUpdate', job)`。
- `_persist()` (optional) — Whisper で使用、`jobHistory` を `~/.recoder/jobs.json` に書き込む、上限 50。`_loadFromDisk()` は `app.ready` で呼出して `jobHistory` を復元。

#### 14.5 IPC チャネル命名と署名（レンダラ契約）
新しい JobManager は必ず以下の IPC を登錄する必要がある（`<prefix>` は種類のプレフィックス： `llm`、`transcribe`、`voiceprint` など）：
```js
ipcMain.handle('<prefix>:jobSubmit', async (event, params) =>
  ({ success: true, jobId: this.addJob(params).id }))

ipcMain.handle('<prefix>:jobStatus', async (event, { jobId }) =>
  ({ success: true, job: this.getStatus(jobId) }))

ipcMain.handle('<prefix>:jobList', async () =>
  ({ success: true, jobs: this.listJobs() }))

ipcMain.handle('<prefix>:jobCancel', async (event, { jobId }) =>
  ({ success: true, cancelled: this.cancelJob(jobId) }))

ipcMain.handle('<prefix>:jobDelete', async (event, { jobId }) =>
  ({ success: true, deleted: this.deleteJob(jobId) }))
```

**ブッシュイベント**（preload で購読）：
```
event '<prefix>:jobUpdate'  → JobObject
```

例外：Whisper はレガシー互換のため `<prefix>:event` チャネルを使う（既存レンダラーが使用中）。新しい JobManager は常に `jobUpdate` を使うことを推奨。

#### 14.6 永続化仕様
- **デフォルトは永続化なし**：メモリのみ。再起動後 `pending`/`running` Job は失われる（許容）。
- **長時間 Job（≥ 30 分）**は Whisper の JSON パターンを推奨：
  - 保存先：`~/.recoder/jobs.json`（OS ホームディレクトリ下）
  - 上限：最新 50 件を保存
  - 保存タイミング：`_sendUpdate()` 後に `_persist()` を呼ぶ
  - 読み込みタイミング：`app.ready` で `_loadFromDisk()` を呼び出して `jobHistory` をリストア
  - **スキーマ**：JSON に列化、ただし `params / result / log` は巨大になり得るので `log` は最新 5 行のみ保存

#### 14.7 preload.js 露出ルール
新しい JobManager ごとに `frontend/electron/preload.js` に以下のブロックを追加する：
```js
xxxJobSubmit: (params) => ipcRenderer.invoke('<prefix>:jobSubmit', params),
xxxJobStatus: (p) => ipcRenderer.invoke('<prefix>:jobStatus', p),
xxxJobList: () => ipcRenderer.invoke('<prefix>:jobList'),
xxxJobCancel: (p) => ipcRenderer.invoke('<prefix>:jobCancel', p),
xxxJobDelete: (p) => ipcRenderer.invoke('<prefix>:jobDelete', p),
onXxxJobUpdate: (cb) => {
  const h = (event, data) => cb(data)
  ipcRenderer.on('<prefix>:jobUpdate', h)
  return () => ipcRenderer.removeListener('<prefix>:jobUpdate', h)
},
```

#### 14.8 UI と i18n ルール
- **`frontend/src/App.vue`**：
  - data に `xxxJobList: []` を追加、`mounted` で1回 load
  - `window.electronAPI.onXxxJobUpdate(...)` を購読して `xxxJobList` を更新
  - `totalInFlightJobs` 計算プロパティは **全種類**の `pending + running` を集約
  - Jobs パネルに `<絵文字> <種類>` タブを追加してそのリストを表示
  - Stop / Show Log / Delete などのアクションボタンはステータスを一貫させるため **必ず** 関連 list を再取得する
- **三言語 i18n** — `frontend/src/i18n/{zh-TW,en,ja}.js` に以下を追加：
  - `jobs.type.<type>` — 例：`jobs.type.optimize` = '✨ 最適化'
  - `jobs.status.<status>` — 例：`jobs.status.running` = '🟡 実行中'
  - `jobs.action.{stop|showLog|delete|clearAll|refresh|close}`
  - `jobs.tab.<種類>` / `jobs.panelTitle`
- **App.vue でハードコードした絵文字+ロケール文字列は禁止**。すべての UI 文字列は i18n key を通す。

#### 14.9 三つの実装參考實例（合格例・例外象の兩方）
| JobManager | 導入 | 主な用途 | 永続化 | IPC チャネルプレフィックス |
|---|---|---|---|---|
| LlmJobManager | v1.14.0 | optimize / translate / summary / aiQuery | 無し（メモリ） | `llm:` |
| WhisperJobManager | v1.19.0 | 音声轉寫（チャンク対応） | ✅ `~/.recoder/jobs.json` | `transcribe:` |
| VoiceprintJobManager | v1.20.2 | 話者ラベリング | 無し（メモリ） | `voiceprint:` |

新しい種類（例：vMix ミックス、ジョブ一括集約、バッチ LLM）は上表と本節サブセクション両方に従わなければならない。

## v1.20.7 (2026-06-30) — 声紋ラベリング三項目修正
- `downloadModel()` の冒頭で `isModelCached()` をチェックし、キャッシュ済みモデルの再ダウンロードをスキップ
- `getAudioDuration()` は ffmpeg stderr をパースして音声長を取得
- `splitLongAudio()` は ffmpeg `-f segment -segment_time 3000` を使用して長音ファイルを 50 分以下の WAV チャンクへ分割
- `extractSegmentPcm()` は短すぎる (<1.5s) セグメントに ±0.5s のパディングを追加し、最小長を 0.3s に引き下げ
- `extractEmbedding()` は `numFrames < 5` の閾値を `< 3` に緩和
- `clusterEmbeddings()` を 2 段階アルゴリズムに書き換え：近傍スライディングウィンドウ中央値コサイン ≥ 0.55 で union-find マージ、その後グローバル重心コサイン ≥ 0.5 で貪欲マージ
- `MIN_MODEL_SIZE = 25MB` に統一、重複するモデルサイズ定数を削除
- diarizeAudio / splitLongAudio / extractSegmentPcm で共有する新たな `getFfmpegPath()` ヘルパーを追加

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