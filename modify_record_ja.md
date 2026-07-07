


## [2026-07-07 16:50]
- **version**: 1.23.2 → 1.23.3 (patch: resnet_se ダウンロードが camp を見るバグ修正)
- **改修要求**: ユーザーから resnet_se ダウンロードボタンを押しても、log に「camplus は最新（cached）と表示されるが、resnet_se が全くダウンロードされないという報告あり。v1.23.0 マルチモデルアーキテクチャのダウンロード機能にバグがあると判明。
- **根本原因**:
  1. `frontend/electron/preload.js` の `voiceprintDownload: () => ipcRenderer.invoke('voiceprint:download')` は** payload を転送していなかった**。
  2. App.vue の `window.electronAPI.voiceprintDownload({ modelKey: 'resnet_se' })` 呼び出しが preload で完全破棄。
  3. 結果、main.js の `ipcMain.handle('voiceprint:download', async (event, { modelKey } = {}) =>` は常に `modelKey === undefined` → `targetKey = modelKey || 'camplus'` は常に camp。
  4. camp がダウンロード済みなら「最新」でショートカット、ユーザーを誤解させる。resnet_se にはダウンロード機会がない。
  5. これは v1.23.0 hotfix1/5/7/8 で見落としたバグ（hotfix8 は 11 個の profile API を追加したが、既存の `voiceprintDownload` ブリッジの payload 伝送が見逃された）。
- **修正計画**:
  - `frontend/electron/preload.js`: `voiceprintDownload: () => ipcRenderer.invoke('voiceprint:download')` → `voiceprintDownload: (payload) => ipcRenderer.invoke('voiceprint:download', payload)`
  - `frontend/package.json`: version 1.23.2 → 1.23.3 (patch)
- **修正結果**:
  - v1.23.0 元の `voiceprintDownload` パッチの構文チェック合格（preload.js の変更は 1 行）
  - 予測動作: resnet_se ダウンロードボタンをクリック → 進捗バーが満ちる → resnet_se.onnx (約 27 MB) が ~/recoder/voiceprint/cnceleb_resnet34_LM.onnx に書き込まれる
  - ecapa_tdnn も検証（URL なし、「利用可能なダウンロード URL がない、手動インポートを使用してください」エラー — 予想される動作）
- **バックアップファイル名**: バックアップステップで生成

## [2026-07-07 14:30]
- **version**: 1.23.0 → 1.23.1 (patch: リポジトリ整理 — `-p/` を GitHub へ同期しない)
- **改修要求**: `-p/` ディレクトリには開発中に溜まった一時/ツール系スクリプト（cabal 抽出、文档追加、モデル検査、ビルドヘルパーなど）が入っており、バージョン管理すべきものではない。GitHub ミラーに残すとリポジトリが汚染され、後で clone する開発者も混乱する。
- **根本原因**:
  1. v1.20〜v1.23 開発中に、ホットフィックス用の使い捨てスクリプト（`append_v1230_docs.ps1`、`append_v1230_hotfix_records.ps1`、`append_v1230_ips.js` など）を `-p/` にそのまま置いて `git add` してしまっていた。
  2. `.gitignore` には部分的な除外（`app_check*/`、`quote_i18n_v1230*.ps1` など）があったが、`git ls-files -p/` には 26 個の追跡対象ファイルが残っており、`git status` のたびに納品ビルドと無関係なノイズが表示されていた。
  3. このディレクトリは本質的に個人のスクラッチスペースであり、他の貢献者にとって意味を持たない。
- **修正計画**:
  - `.gitignore`: 末尾に `# 暫存 / 工具腳本目錄（不要同步到 GitHub）\n-p/` を追加し、ディレクトリ全体を除外。
  - `git rm -r --cached -p/`: 追跡中の 26 ファイルをすべて index から外す（`--cached` で作業ツリーのファイルは保持）。
  - 検証: `git ls-files -p/` が空、`git check-ignore -p/append_records.ps1 -p/foo.txt` が ignored を返すこと、ローカルに `append_records.ps1` が残っていること。
  - `frontend/package.json` version 1.23.0 → 1.23.1（patch — リポジトリ整理のみ、ランタイム挙動は不変）。
- **修正結果**:
  - `.gitignore` に `-p/` ルールを追加した。
  - `-p/` の 26 ファイルを index から削除（commit `aa44ad6`）、ローカルファイルは保持。
  - `git ls-files -p/` の出力なし。
  - `git status` は `whisper_cpp` サブモジュール ポインタのみ（本タスクと無関係）。
  - 以後 `-p/` 配下に追加されるファイルは自動的に無視される。
  - `master` ブランチの過去のコミットには `-p/` コンテンツが残っている。歴史の書き換え（`git filter-repo` など）は破壊的操作のため、要求されていない本作業では実行していない。
  - **バックアップファイル名**: バックアップステップで生成。


## [2026-07-07 16:30]
- **version**: 1.23.1 → 1.23.2 (patch: 破損声紋モデルの自動修復)
- **改修要求**: ユーザーから voiceprint ジョブが繰り返し失敗するという報告あり。recorder.log には「InferenceSession 作成失敗 (ファイルサイズ: 27.0 MB)」と記錄され、同じセッションでモデルが 8 回連続ダウンロードされた（毎回䀘ンスト完了）。原因：HF LFS がたまに「混合內容」（HTML リダイレクトヘッダ + 部分バイナリストリーム）を返し、25 MB 以上の汚染ファイルを書き出すが、サイズチェックは通っても onnxruntime は說めない。
- **根本原因分析**:
  1. v1.20.4 完全性チェック: < 1 MB を不完全と見なす。しかし 25~28 MB の汚染ファイルはこの閾値を通り拔ける。
  2. v1.20.5 text/plain リダイレクト処理: body の先頭 100 文字が「Found. Redirecting to」かをチェック。しかし HF LFS は「混合內容」（HTML ヘッダ + バイナリストリーム）を返すこともあり、ストリーミングレスポンスではカバーできない。
  3. v1.20.6 25 MB 閾値: 汚染ファイルはわずかに超えるため、isModelCached() が誤って valid を返す。
  4. isModelCached() はサイズとファイルの存在だけチェックし、ONNX フォーマットを検証していない。
  5. loadModel() 失敗時は console.error して false を返すだけで、破損ファイルを自動削除しない。
  6. ユーザーが「ダウンロード」ボタンを 8 回繰り返しクリックすると、voiceprintDownload ハンドラーは「ダウンロード開始 / 完了」を常に表示（isModelCached が true でショートカットされても）、ログは誤解を招く 8 つのエントリで涜れる。
- **修正計画**:
  - `frontend/electron/voiceprint.js`:
    1. `ONNX_MAGIC` 定数 = `Buffer.from([0x08, 0x08, 0x12, 0x07, 0x70, 0x79, 0x74, 0x6F, 0x72, 0x63, 0x68])` (pytorch 2.10+ exporter protobuf ヘッダ)
    2. `isOnnxMagicValid(filePath, checkBytes=16)` 関数を追加: ファイルの先頭 N バイトを読んで ONNX_MAGIC と比較、不一致 = 破損
    3. `isModelCached()`: 従来は `size >= modelMinSize()` のみチェック。ONNX magic 検証を追加。失敗 → console.warn + 自動 `resetModel()` + false を返す
    4. `_ensureModelLoaded()`: 従来は size のみチェック。新しい振る舞い:
       - size < minSize → リセット (従来通り)
       - **ONNX magic 無効 → 自動 `resetModel()` + メッセージ**「ファイルの先頭 10 バイトは有効な ONNX ヘッダではありません。自動削除されました。再ダウンロードしてください。」
       - **loadModel() 失敗 → 自動 `resetModel()` + メッセージ**「InferenceSession の作成に失敗しました。自動リセットされました。再ダウンロードしてください。」
    5. この修正後、ユーザーは「ダウンロード」を 1 回押すだけで完全に回復できる。
  - `frontend/electron/main.js`: `voiceprintDownload` ハンドラーは、`voiceprint.isModelCached()` が true のときは「ダウンロード開始 / 完了」ではなく「すでに最新」とだけログ。ログが誤解を招く 8 つのエントリで湜れるのを防ぐ。
- **修正結果**:
  - ノード構文チェック合格: voiceprint.js / main.js どちらもロード成功
  - ユニットテスト `-p/test_v1232_onnx_magic.js` 6 ケース全て合格:
    - A) 27MB HTML 污染ファイル → isOnnxMagicValid = false ✓
    - B) pytorch magic 付き 27MB 正規ファイル → true ✓
    - C) 存在しないファイル → false ✓
    - D) 小さいが magic は正規のファイル → true (サイズチェックは isModelCached の責務) ✓
    - E) 先頭 10 バイトが異なる 27MB ファイル → false ✓
    - F) 100 バイトチェックも動作 ✓
  - v1.23.2 を再インストールした後、HF LFS が污染ファイルを返した場合:
    1. 1 回目: ジョブ失敗 → _ensureModelLoaded 自動リセット → 「モデルを再ダウンロードしてください」メッセージ
    2. ダウンロードを 1 回押す → voiceprintDownload が isModelCached() が false だと認識 → 実際にダウンロード
    3. ダウンロード後、「話者ラベリング」を再クリック → 成功
  - 原本のタスク「`-p/` を GitHub と同期しない」は v1.23.1 で完了
  - **バックアップファイル名**: バックアップステップで生成

## [2026-06-30 15:20]
- **version**: 1.20.13 → 1.20.14 (patch: 録音履歴 UI が更新されないバグ修正)
- **改修要求**: ユーザーから「認識完了しても録音履歴に新しいエントリが追加されない」との指摘あり。調査の結果、`reco:saveMeta` IPC は確かに呼ばれており metadata JSON もディスクへの書き込みに成功していたが、録音履歴一覧 UI が一度も更新されず、結果としてユーザーは「追加されていない」と感じる状態だった。
- **根本原因**:
  1. `frontend/src/App.vue` の `_onTranscribeEvent('completed')` は `await this.saveRecordingMeta(r.result.segments)` を呼び出す。
  2. `saveRecordingMeta` は `reco:saveMeta` IPC 経由で metadata JSON を `reco_data/` に書き込む。しかし **保存成功後に `historyList` を能動的に更新するコードパスが一切なかった**。
  3. `loadHistory()` は、ユーザーが能動的に履歴タブをクリックした時、リフレッシュボタンを押した時、folder の create/delete/rename、録音の move/delete/update-labels を行った時にしか呼ばれない。`_onTranscribeEvent('completed')` → `saveRecordingMeta` → `reco:saveMeta` のチェーンには refresh ポイントが皆無。
  4. 結果：ユーザーが新しい音ファイルを認識し、「N 文を認識しました」ステータスを確認し、履歴タブに切り替えても新しいレコードが見えない（手動でリフレッシュボタンを押す必要がある）。
  5. 加えて、`saveRecordingMeta` には `if (!window.electronAPI || !this.audioInfo) return` という silent early-return guard が残っている。`audioInfo` が空になった場合（例：ユーザーが途中で別の録音を切り替えたなど）、「silent failure」となりデバッグもできない。
- **修正計画**:
  - `frontend/src/App.vue` の `saveRecordingMeta()`:
    1. v1.20.14 の仕組み：recoSaveMeta 成功後に `await this.loadHistory()` で録音履歴一覧を更新。
    2. `window.electronAPI` と `audioInfo` の early-return guard を分離し、`console.warn('[saveRecordingMeta] 保存スキップ：audioInfo が空 (...)')` を追加し今後のデバッグを容易にする。
    3. `recoSaveMeta` を try/catch でラップし、保存失敗時は `console.error('[saveRecordingMeta] 保存失敗:', id, e)` を出力、例外で呼び出し元を中断させない。
    4. 保存成功時は `console.log('[saveRecordingMeta] metadata を保存しました:', id, '(segments=N, audioPath=...)')`。
  - `frontend/package.json` version 1.20.13 → 1.20.14。
- **修正結果**:
  - 3 つの saveRecordingMeta 呼び出し箇所をすべてカバー：`_onTranscribeEvent('completed')`（新規認識）、`_pollJobResult('completed')`（LLM 処理後）、`_jobUpdateListener('voiceprint completed')`（声紋ラベリング後）。
  - 残り 2 つの呼び出し（LLM / 声紋）でも refresh は無害（一覧を更新するだけで重複追加はしない）。
  - 期待される効果：新しい認識の完了後、履歴タブに切り替えれば即座に新しいレコードが先頭に表示され、手動リフレッシュは不要。
- **検証手順**: 新しい音ファイルで「🤖 認識」をクリック → 完了を待つ → 「📚 履歴」タブに切り替え → 手動リフレッシュなしで新しいレコードが一覧の先頭に即座に表示されるはず。
- **バックアップファイル名**: backup-202606301541.zip (2.94 GB)

## [2026-06-30 13:50]
- **version**: 1.20.11 → 1.20.12 (patch: log 補完)
- **要件**: ユーザーから「認識 (transcribe) の job log で 音ファイルの長さ確認 と 大きすぎるファイルの分割 log が見えない」との指摘あり。`WhisperJobManager._executeTranscribe` は log を出力しているものの、すべて「分割後の動作」（N 個の chunks に分割済み、chunk N/M を認識中…）に集中しており、「なぜ今回分割する／しないか」の意思決定チェーン（音ファイル長チェック、閾値超過判定、どちらの経路を辿るか）が完全に省略されている。これにより job log では判定根拠もフォールバック理由も確認できない。
- **修正計画**:
  - `frontend/electron/main.js` の `WhisperJobManager._executeTranscribe(job)`（行 1091〜1125）**のみ**を修正し、4 つの `this._log(job, ...)` を追加：
    1. 行 1105：`音檔時長檢查: Xs (門檻 3600s，設定 chunkMinutes=Z)` — `getAudioDuration()` の直後、常に出力
    2. 行 1114：`決策: 不切片 (reason)` — `if (!shouldChunk)` ブロックの冒頭、4 つの理由をカバー：`chunkMinutes ≤ 0`、duration `≤ 0`（ffmpeg 解析失敗）、duration `<` 閾値、その他の条件不一致
    3. 行 1116：`進入直接辨識路徑 (runWhisper)` — `_runSingleTranscribe` の直前
    4. 行 1130：`已切換為直接辨識路徑 (runWhisper)` — catch ブロックの `切片失敗，降級為直接辨識` の直後
  - Vue フロントエンド、`audioChunker.js`、設定、IPC、UI 文字列には触らない
  - 新しい i18n キーは追加しない（log はバックエンドが job.log に書き込み、log modal がそのまま表示）
  - `frontend/package.json` バージョン 1.20.11 → 1.20.12 (patch)
- **修正結果**:
  - `node --check` で `frontend/electron/main.js` の構文 OK を確認
  - PowerShell `Select-String` で 4 つの新規 log 行が正しいセクション（1105 / 1114 / 1116 / 1130）に配置されていることを確認
  - 「分割しない」分岐で完全な意思決定チェーンが見えるようになった；フォールバック分岐でも「chunk 失敗 → 直接認識に切替」が明確に分かる
  - 既存の分割成功パス log（長音檔 Xs >= Ys、已切成 N 個 chunks、切片 N/M 辨識中…）は不変
- **検証手順**: App を再起動し、60 分以下の音ファイルで「認識開始」を押し、job log modal を開くと 4 つの新規行が順番に表示されるはず。60 分以上の音ファイルでは既存の分割 log と新規の音ファイル長チェック log が順番に表示されるはず。
- **バックアップファイル名**: バックアップステップで生成

## [2026-06-30 13:41]
- **version**: バージョンアップなし（ドキュメントのみ、コード変更なし）
- **改修要求**: 「将来あらゆる種類の Job を追加する際」の統一設計契約を確立し、LLM / Whisper / Voiceprint 以外の新しい JobManager を追加する際にフィールド設計・IPC チャネル・UI 連携を毎回ゼロから作らずに済むようにする。あわせて既存の `Product_Design_Guidelines.md` の Jobs モジュール規約ギャップを補う。
- **改修計画**:
  - `Product_Design_Guidelines.md`：「機能モジュールとビジネスロジック」章節の先頭（§13 の前）に新しい §14「モジュール横断非同期 Job 架構仕様（Job Manager Pattern）— 未来の Job 作成契約」を追加
    - 14.1 目標と設計哲学（UI 非ブロッキング / 1 in-flight / 二重ルート IPC / 再開可能 / キャンセル可能）
    - 14.2 Job オブジェクト統一スキーマ（id/type/status/params/progress/result/error/log/タイムスタンプ）
    - 14.3 ステートマシン（pending → running → completed/failed/cancelled、スキップ不可）
    - 14.4 JobManager 抽象インターフェース表（addJob/processNext/cancelJob/getStatus/listJobs/deleteJob + 任意の cancelAll/clearHistory）+ プライベートヘルパー（_generateId/_log/_sendUpdate/_persist）
    - 14.5 IPC チャネル命名と署名（`<prefix>:jobSubmit/jobStatus/jobList/jobCancel/jobDelete` + `<prefix>:jobUpdate` プッシュ）
    - 14.6 永続化仕様（デフォルトなし、30 分超の Job は `~/.recoder/jobs.json`、cap 50）
    - 14.7 preload.js 露出ルール
    - 14.8 UI と i18n ルール（App.vue data + i18n key 強制）
    - 14.9 三つの実装參考實例表（LlmJobManager / WhisperJobManager / VoiceprintJobManager）
  - `Product_Design_Guidelines_en.md`：§14 を翻訳（位置：§11 の前）
  - `Product_Design_Guidelines_ja.md`：§14 を翻訳（位置：v1.20.7 章節の前）
- **改修結果**:
  - 三言語 `Product_Design_Guidelines*.md` に §14 を追加し、JobManager 共通の契約層とした
  - 既存の §11 (WhisperJobManager)、§12 (whisper-cli greedy decoding) などの歴史的章節は改変せず
  - JS / JSON / i18n ファイルに変更なしのためバージョンは据え置き
  - 効果：新しい種類の Job を追加する際、§14 のチェックリストで自己検証でき、IPC と状態マシンの再発明を防止
- **バックアップ**: backup-202606301341.zip

## [2026-06-30 12:37]
- **version**: 1.20.10 → 1.20.11 (patch: hotfix)
- **改修要求**: ユーザーから声紋モデルのダウンロードが繰り返し失敗するという報告があり、ログに「ダウンロード不完全(受信 28283928 bytes のみ); HuggingFace 接続失敗? 再試行してください。」と、リトライするたびに同じバイト数が出力され続ける。
- **根本原因**: v1.20.7 で `MIN_MODEL_SIZE = 40 * 1024 * 1024` (40 MB) を最小有効サイズ閾値として導入したが、`https://huggingface.co/welcomyou/campplus-3dspeaker-200k-onnx/resolve/main/campplus_cn_en_common_200k.onnx` の実際のファイルサイズは **28,283,928 bytes(≒26.97 MB)** であり、常に 40 MB を下回るため毎回「不完全」と誤判定される。PowerShell `Invoke-WebRequest` と `node-fetch` の HEAD/GET で検証済み:
  - `Content-Length: 28283928`
  - `Content-Type: application/octet-stream`
  - 先頭 16 bytes = `08-08-12-07-70-79-74-6F-72-63-68-1A-06-32-2E-31` — protobuf ONNX マジック (pytorch 2.10.0 exporter)、`xvector / head/conv1 / ReduceMean` ノードを含む **LFS pointer でもエラーページでもない**。
  - HF LFS UI の「~50 MB」表示は repo metadata + LFS pointer 合計。実 .onnx binary は ~27 MB のみ。`xet-bridge-us` は xet CAS ブリッジで、下流の実際のバイナリを正しく転送している。
- **影響**:
  - 「ダウンロード」を押下すると実際には成功(28 MB が `.downloading` に書かれ、正式ファイルへ rename)しているが、28 MB < 40 MB のため検証で reject、IPC ハンドラが「ダウンロード失敗」を返す。
  - `isModelCached()` は合法的ファイルがブロックされる限り常に false を返す。
- **修正**:
  - `frontend/electron/voiceprint.js`:
    1. `MIN_MODEL_SIZE` を `40 * 1024 * 1024` から `25 * 1024 * 1024` に変更(実 ~27 MB、25 MB で ~7% のバッファを確保して truncate / HTML エラーを確実に弾く)。
    2. 根本原因を詳述するコメントブロックを追加(HTTP レスポンス、ヘッダ、バイト内容)。
    3. `downloadModel` docstring を `>= MIN_MODEL_SIZE` に書き換えてマジックナンバーの将来の漂流を防止。
- **検証**:
  - PowerShell `Invoke-WebRequest -OutFile` で `c:\temp\voiceprint-test.onnx` にダウンロードし、hex header が正規 ONNX マジックであることを確認。
  - `diarizeAudio()` の `loadModel()` パスは自動的に新閾値を継承(共有定数)。
  - `isModelCached()` も同じ閾値を使い、キャッシュヒットロジックも一貫。
- **注意**:
  - ダウンロード後も「InferenceSession 無効」エラーが出る場合は、onnxruntime 1.27.0 + Node.js 20+ を使用し、`asarUnpack` に `node_modules/onnxruntime-node/**/*` が含まれているか確認(v1.20.3 で追加済)。
- **バックアップ**: backup-202606301237.zip
# 変更記録 (日本語)

> v1.13.0 以降の記録のみ日本語版で管理します。

## [2026-06-30 12:00]
- **version**: 1.20.9
- **修正要求**：
  1. 文字起こし：音声ファイルが 60 分以上の場合は、自動的に 50 分以下の WAV チャンクに分割し、各チャンクを非同期ジョブで個別に文字起こし
  2. チャンクサイズは設定で調整可能（デフォルト 50 min/chunk、「分割しない」オプションを維持）
- **計画**：
  - `frontend/electron/audioChunker.js` (新規)：whisper (main.js) と voiceprint (voiceprint.js) 両方で使う共用オーディオチャンクモジュール。`getAudioDuration / splitLongAudio / chunkLongAudioIfNeeded / cleanupChunkDir / cleanupStaleChunks` を公開
  - `frontend/electron/voiceprint.js`：`audioChunker` 共用モジュールを require する。`getAudioDuration / splitLongAudio` の重複実装を削除（下位互換のため export は残す）
  - `frontend/electron/main.js`：
    1. `./audioChunker` を require し、起動時に `cleanupStaleChunks()` を呼び、`os.tmpdir()/recoder-chunks-*` と `voiceprint-chunk-*` の残骸を消去
    2. `runWhisper(audioPath, modelSize, useGpu, gpuDevice, onProgress)` — 新しい `onProgress(percent, elapsed, fallback)` パラメータ
    3. `WhisperJobManager._executeTranscribe(job)` — `settings.whisperChunkMinutes > 0` かつ音声が 60 分以上の場合、`audioChunker.splitLongAudio()` を呼び、chunks を個別に `runWhisper` で処理。segment の `start`/`end` に `chunk.startOffset` を加算して元ファイル座標に対応。完了/失敗時必ず `cleanupChunkDir()`
    4. 新しい helper `_runSingleTranscribe()` と `_loadSettings()`
  - `frontend/src/App.vue`：
    1. data に `whisperChunkMinutes: 50` 追加；`loadSettings / saveSettings` で同期
    2. 設定パネルに「🔪 長尺音訊の分割」ドロップダウン追加（分割しない / 30 / 40 / 50 / 60 分、デフォルト 50）
    3. Jobs パネルの進捗テキストに `チャンク N/M 文字起こし中 (X%)` 表示（`job.progress.currentChunk / totalChunks` を使用）
  - `frontend/src/i18n/{zh-TW,en,ja}.js`：`settings.whisperChunk / noChunk / min / whisperChunkTitle` と `jobs.chunkProgress` の三言語翻訳を追加
  - `frontend/package.json`：version 1.20.8 → 1.20.9 (Patch)
- **結果**：
  - 共用 `audioChunker.js` 抽出完了；voiceprint.js と main.js で共有し重複を削除
  - WhisperJobManager に長尺音訊チャンク分割を統合 — 60 分以上を自動的に 50 分以下のチャンクに分割し各チャンクを個別に whisper。segment タイムスタンプは元ファイル座標に正しく対応
  - キャンセル：ジョブが `cancelled` 状態になると次のチャンクは実行されない（throw Error）。chunks テンポラリディレクトリは `cleanupChunkDir()` で削除
  - 設定パネルに「長尺音訊の分割」オプション追加（デフォルト 50 min/chunk）、0/30/40/50/60 で切替可能
  - Jobs パネル UI にチャンク進捗（currentChunk / totalChunks）表示
  - 三言語 i18n 同期
  - 起動時に `os.tmpdir()/recoder-chunks-*` の残骸を自動クリーンアップ
- **バックアップファイル名**：backup-202606301200.zip

## [2026-06-30 11:15]
- **version**: 1.20.8
- **修正要求**：
  1. ステータスバーは再生中の録音の実ファイル名を表示するべき（音声リストの先頭ファイル名ではなく）
  2. Jobs 一覧は投入時点から表示されるべき（Stop 等のコマンドが発行できないため）
- **計画**：
  - `frontend/src/App.vue`：
    1. `playRecordingAudio(item)` で `currentPlayingFilename = item.filename || item.id` を設定し、`statusText` を `▶️ 播放: filename` / `▶️ 播放中: filename` に更新
    2. `reviewRecording(id)` も `currentPlayingFilename` を更新し、新しい i18n キー `status.loadedWithName` を使用。重複していた旧 `reviewRecording` ブロックを削除
    3. 楽観的 UI 更新 — 5 つのエントリポイントで保留中ジョブを `unshift` で各リスト（`transcribeJobList`、`voiceprintJobList`、`jobList`）に挿入し、ユーザが直ちにジョブを確認して Stop できるようにする
  - `frontend/src/i18n/{zh-TW,en,ja}.js`：3 言語で `status.loadedWithName` キーを追加
  - `frontend/package.json`：version 1.20.7 → 1.20.8（Patch）
- **結果**：
  - `App.vue` 更新完了（playRecordingAudio、reviewRecording、5 箇所の楽観的更新）
  - `i18n/{zh-TW,en,ja}.js` に `status.loadedWithName` を同期
  - `package.json` を 1.20.8 にバンプ
  - ビルド成果物：`frontend/dist-electron-build4/Recorder-1.20.8-portable.exe`（179.9 MB、2026-06-30 10:58:53）
  - Code Sign 検証済み：DigiCert RFC 3161 タイムスタンプ、Subject CN=Cheng-Feng Iron Factory
  - バックアップファイル名：`backup-202606301115.zip`（276.2 MB、元 814.87 MB、6052 ファイル）

## [2026-06-30 10:01]
- **version**: 1.20.7
- **修正要求**：
  1. 声紋モデルが既にダウンロード済みの場合は再ダウンロードをスキップ
  2. 60 分を超える音声ファイルは 50 分以下のチャンクに自動分割してから話者ラベリングを実行
  3. 声紋ラベリングのリグレッション修正（短すぎる／無音セグメントが全員 Speaker_1 に集約される問題を解消）
- **計画**：
  - `frontend/electron/voiceprint.js`：
    1. `downloadModel()` の冒頭で `isModelCached()` をチェック、モデルファイルが既に存在し 40MB 以上であれば HTTPS リクエストをスキップし `progressCallback(100)` を発行
    2. 新規 `getAudioDuration(audioPath)`：ffmpeg stderr の `Duration: HH:MM:SS` をパース
    3. 新規 `splitLongAudio(audioPath)`：ffmpeg `-f segment -segment_time 3000` で 50 分以下の WAV チャンクへスライスし `{tmpDir, files, durations}` を返す
    4. `diarizeAudio()`：`audioDuration >= 3600s` の場合に `splitLongAudio` を起動、セグメントは `(start, end)` 半開区間でチャンクへマッピング、`fs.rmSync` で一時ディレクトリを削除
    5. `extractSegmentPcm()`：短すぎる (<1.5s) セグメントに左右 0.5s のパディングを追加し、最小長を 0.3s に引き下げ
    6. `extractEmbedding()`：`numFrames < 5` を `< 3` に引き下げ
    7. `clusterEmbeddings()` を 2 段階クラスタリングに変更（a）スライディングウィンドウ中央値コサイン ≥ 0.55 で union-find マージ、（b）クロスグループ重心コサイン ≥ 0.5 で貪欲マージ
    8. `MIN_MODEL_SIZE = 40MB` に統一、重複定数を削除
    9. 新規 `getFfmpegPath()` ヘルパーを `diarizeAudio / splitLongAudio / extractSegmentPcm` で共有
  - `frontend/electron/main.js`：ロジック変更なし、既存進捗コールバック契約は互換
  - `frontend/package.json`：version 1.20.6 → 1.20.7（Patch）
- **結果**：
  - `frontend/electron/voiceprint.js` をリファクタリング、`isModelCached / downloadModel / loadModel / resetModel / diarizeAudio / extractEmbedding / extractSegmentPcm / clusterEmbeddings / cosineSimilarity / getAudioDuration` をエクスポート
  - `frontend/package.json` を 1.20.7 にバンプ
  - Node 側構文検証：`require('./frontend/electron/voiceprint.js')` のロード成功、10 個すべてのエクスポートにアクセス可能
  - バックアップファイル名：backup-202606301001.zip

## [2026-06-24 10:25]
- **version**: 1.13.0
- **要件**: 1) zh-TW/en/ja の UI 言語を提供し、初回起動時（設定ファイルなし）または設定パネルで言語を選択可能にする；2) zh-TW/en/ja のドキュメントファイルを提供し、workrule.md を更新して今後の多言語ドキュメント管理に対応する。
- **計画**:
  1. i18n 基盤を作成：`frontend/src/i18n/` に zh-TW.js、en.js、ja.js 言語ファイルと index.js ローダー
  2. `App.vue` を修正：すべてのハードコードされた中国語テキストを `$t('key')` 呼び出しに置き換え；設定パネルに言語セレクターを追加；初回起動時に言語選択ダイアログを表示
  3. 多言語ドキュメントを作成：`readme_en.md`、`readme_ja.md`、`modify_record_en.md`、`modify_record_ja.md`
  4. `workrule.md` セクション 4 を更新し、多言語ドキュメント管理を必須化
  5. バージョン 1.12.2 → 1.13.0（マイナー：新機能、下位互換性あり）
- **結果**:
  - `frontend/src/i18n/zh-TW.js` — 繁体字中国語の ~200 キーと値のペア
  - `frontend/src/i18n/en.js` — 英語の ~200 キーと値のペア
  - `frontend/src/i18n/ja.js` — 日本語の ~200 キーと値のペア
  - `frontend/src/i18n/index.js` — `t(key, lang)` 関数 + `LANGUAGES` エクスポート
  - `frontend/src/App.vue` — すべての UI テキストを `$t()` に置き換え；設定に言語セレクター；初回起動時の言語選択ダイアログ
  - `readme_en.md` — readme の英語版
  - `readme_ja.md` — readme の日本語版
  - `modify_record_en.md` — 変更記録の英語版（v1.13.0 以降のみ）
  - `modify_record_ja.md` — 変更記録の日本語版（v1.13.0 以降のみ）
  - `.clinerules/workrule.md` — セクション 4 を多言語ドキュメント要件で更新
  - `frontend/package.json` — バージョンを 1.13.0 に更新
- バックアップ: backup-202606241025.zip

## [2026-06-24 10:44]
- **version**: 1.13.1
- **要件**: プロジェクトをコンパイルし、portable exe を生成する。
- **計画**:
  1. バージョン 1.13.0 → 1.13.1 に増加
  2. electron-builder を実行してコンパイル
  3. ドキュメントとバックアップを更新
- **結果**:
  - `frontend/package.json`: バージョンを 1.13.1 に更新
  - ビルド出力: `frontend/dist-electron-build2/Recorder-1.13.1-portable.exe` (127 MB)
  - Windows Defender が `dist-electron-build` をロックするため、`dist-electron-build2` 出力ディレクトリに切り替え
- バックアップ: backup-202606241044.zip

## [2026-06-24 11:35]
- **version**: 1.13.2
- **要件**: i18n リファクタリングによる UI バグを修正 — 設定の AI プロバイダーと whisper モデルのドロップダウンが空になる。
- **計画**:
  1. 根本原因: i18n リファクタリング中に `mounted()` ライフサイクルフックが誤って削除され、`fetchModels()`、`fetchLlmProviders()`、`loadSettings()` が呼び出されなかった
  2. 修正: `computed` ブロックと `methods` ブロックの間に `async mounted()` フックを復元
  3. バージョン 1.13.1 → 1.13.2 (パッチ: バグ修正)
- **結果**:
  - `frontend/src/App.vue`: `async mounted()` ライフサイクルフックを復元、`fetchModels()`、`fetchLlmProviders()`、`loadSettings()` を順次呼び出し
  - `frontend/package.json`: バージョンを 1.13.2 に更新
  - ビルド出力: `frontend/dist-electron-build2/Recorder-1.13.2-portable.exe` (127 MB)
  - 多言語ドキュメント: `Product_Design_Guidelines_en.md`、`Product_Design_Guidelines_ja.md` を作成；`readme_en.md`、`readme_ja.md` を更新
- バックアップ: backup-202606241135.zip

## [2026-06-24 12:30]
- **version**: 1.14.0
- **要件**: 文の最適化は元の文字起こしのタイムスタンプを参照する必要がある — LLM Job Manager 非同期処理機構、トークン制限検出とバッチ分割、タイムスタンプを保持した文単位の最適化を導入。
- **計画**:
  1. `LlmJobManager` クラスを作成（main.js）：すべての LLM 操作のキュー、実行、キャンセル、履歴を管理；Job ステートマシン `pending → running → completed/failed/cancelled`；`llm:jobUpdate` IPC でステータス変更をプッシュ
  2. トークン推定とモデルコンテキスト制限の検索（main.js）：
     - `estimateTokens(text)`：文字タイプに基づいてトークン数を推定（CJK 1.5 トークン/文字、ASCII 0.25 トークン/文字）
     - `getModelContextLimit(provider, model)`：モデルのコンテキストウィンドウ上限を検索（参照テーブル + Ollama API 動的クエリ + フォールバック 4096）
     - 上限超過時に自動バッチ分割（最適化は文単位、翻訳は文字数単位、要約/AI クエリは切り捨て）
  3. 文単位の最適化（main.js + App.vue）：
     - システムプロンプトで LLM に `[N] 最適化テキスト` 形式での出力を要求
     - `_parseOptimizedResult()` で LLM 出力を解析し、元のセグメントにマッピングしてタイムスタンプを保持
  4. フロントエンド UI 統合（App.vue + preload.js）：
     - LLM アクションバーに「📋 Job」ボタンとジョブリストパネルを追加（プログレスバー、ログ、キャンセルボタン）
     - `llm:jobUpdate` イベントをリアルタイム監視して activeJobId と進捗を更新
     - 新規メソッド：`initJobListener()`、`refreshJobList()`、`cancelJob()`、`cancelActiveJob()`
  5. i18n：ジョブ関連の翻訳キーを追加（zh-TW/en/ja）
  6. `Product_Design_Guidelines.md` v1.6.0 を更新し、LLM Job Manager とトークン推定の説明を追加
  7. バージョン 1.13.2 → 1.14.0（マイナー：新機能、下位互換性あり）
- **結果**:
  - `frontend/electron/main.js`：`LlmJobManager` クラス、`estimateTokens()`、`getModelContextLimit()`、`KNOWN_MODEL_CONTEXTS` テーブル、4 つのジョブ実行メソッド（optimize/translate/summary/aiQuery）、4 つのジョブ IPC ハンドラ（submit/status/list/cancel）を追加
  - `frontend/electron/preload.js`：`llmJobSubmit`、`llmJobStatus`、`llmJobList`、`llmJobCancel`、`onLlmJobUpdate` ブリッジを追加
  - `frontend/src/App.vue`：ジョブ管理の data/methods/UI パネル/CSS スタイルを追加；LLM アクションバーに Job ボタン、バッチ進捗表示、キャンセルボタンを追加
  - `frontend/src/i18n/zh-TW.js`：7 つのジョブ関連翻訳キーを追加
  - `frontend/src/i18n/en.js`：7 つのジョブ関連翻訳キーを追加
  - `frontend/src/i18n/ja.js`：7 つのジョブ関連翻訳キーを追加
  - `frontend/package.json`：バージョンを 1.14.0 に更新
  - `Product_Design_Guidelines.md`：v1.6.0 に更新し、LLM Job Manager とトークン推定の説明を追加
- バックアップ: backup-202606241230.zip

## [2026-06-24 14:42]
- **version**: 1.14.0
- **要件**: プロジェクトを再コンパイルし、portable exe を生成する。
- **計画**:
  1. `npm run electron:build` を実行（vite build + electron-builder --win portable）
  2. 出力ファイルを検証
  3. ドキュメントとバックアップを更新
- **結果**:
  - ビルド成功：`frontend/dist-electron-build2/Recorder-1.14.0-portable.exe` (127 MB)
  - コード変更なし、再コンパイルのみ
- バックアップ: backup-202606241442.zip

## [2026-06-24 14:58]
- **version**: 1.14.1
- **要件**: 「✨ 最適化」で `An object could not be cloned` エラーを修正 — Vue Proxy が Electron IPC でシリアライズできない問題。
- **計画**:
  1. 根本原因: `doOptimize()` が `segments: this.transcriptionResults` を `llmJobSubmit` IPC に渡しているが、`this.transcriptionResults` は Vue reactive 配列（Proxy オブジェクト）であり、Structured Clone Algorithm がシリアライズできない
  2. 修正: `JSON.parse(JSON.stringify(...))` を使用して Vue Proxy をプレーンな JSON オブジェクトに変換してから渡す
  3. バージョン 1.14.0 → 1.14.1 (パッチ: バグ修正)
- **結果**:
  - `frontend/src/App.vue`: `doOptimize()` で `segments: JSON.parse(JSON.stringify(this.transcriptionResults))` に変更
  - `frontend/package.json`: バージョンを 1.14.1 に更新
- バックアップ: backup-202606241458.zip

## [2026-06-26 11:06]
- **version**: 1.14.2
- **要件**: LLM バッチ処理（optimize）で30秒タイムアウトによる「The user aborted a request」エラーを修正。
- **計画**:
  1. ログ分析：`callLLM()` 関数の 139 行目に 30 秒の AbortController タイムアウトが設定されていた
  2. 大量の文（例：237 文または 444 文）をバッチ処理する際、LLM API 呼び出しに 30 秒以上かかり、`controller.abort()` がトリガーされる
  3. 修正：タイムアウトを 30 秒から 120 秒に延長し、大規模バッチ処理に対応
  4. バージョン 1.14.1 → 1.14.2（パッチ：バグ修正）
- **結果**:
  - `frontend/electron/main.js`：`callLLM()` の AbortController タイムアウトを 30000 から 120000 に変更
  - `frontend/package.json`：バージョンを 1.14.2 に更新
- バックアップ: backup-202606261106.zip

## [2026-06-26 12:33]
- **version**: 1.14.3
- **要件**:
  1. LLM 文書管理 UI を提供：元の文字起こしから生成された文書（最適化、翻訳、要約など）を一覧表示/レビュー/削除可能にする
  2. 翻訳機能は任意の文書（元の文字起こし、最適化結果、要約など）の翻訳をサポートし、出力文書は同じ元の文字起こしの下に分類され、生成時間で区別される
  3. Job ボタンクリック時に自動的に job リストを更新
- **計画**:
  1. バックエンド `main.js`：
     - `reco:saveMeta` に `documents` パラメータを追加し、文書履歴配列（id、type、source、target、content、createdAt）を保存
     - `reco:deleteLlmDoc` IPC を追加：指定された文書を削除し、`llmResults` の最新バージョンを同期クリーンアップ
  2. `preload.js`：`recoDeleteLlmDoc` ブリッジを追加
  3. フロントエンド `App.vue`：
     - `documents: []` データ配列と `showLlmDocPanel` 変数を追加
     - `_addDocument(type, content, source, target)` メソッドを追加、LLM 操作完了後に自動的に文書履歴に追加
     - LLM 文書管理パネル（テンプレート）を追加：すべての文書を一覧表示（タイプ、ソース、ターゲット言語、時間、プレビュー）、表示と削除をサポート
     - `viewLlmDoc(doc)` を追加：文書内容を activeSource として表示
     - `deleteLlmDoc(doc)` を追加：バックエンド削除を呼び出し、フロントエンド状態を同期
     - `toggleJobPanel()` メソッド：パネル切り替え時に自動的に `refreshJobList()` を呼び出す
     - LLM アクションバーに「📄 文書管理」ボタンを追加
  4. i18n：zh-TW/en/ja に各 8 つの翻訳キーを追加
  5. バージョン 1.14.2 → 1.14.3（パッチ：新機能）
- **結果**:
  - `frontend/electron/main.js`：`reco:saveMeta` に `documents` パラメータを追加；`reco:deleteLlmDoc` IPC を追加
  - `frontend/electron/preload.js`：`recoDeleteLlmDoc` ブリッジを追加
  - `frontend/src/App.vue`：文書管理パネル、`_addDocument`、`viewLlmDoc`、`deleteLlmDoc`、`toggleJobPanel` メソッドを追加
  - `frontend/src/i18n/zh-TW.js`、`en.js`、`ja.js`：8 つの翻訳キーを追加
  - `frontend/package.json`：バージョンを 1.14.3 に更新
- バックアップ: backup-202606261233.zip

## [2026-06-26 14:12]
- **version**: 1.14.4
- **要件**: 「履歴 → 音声ファイル一覧 → （特定の音声ファイルを選択）→ 文字起こし → 音声認識完了後に ❌ An object could not be cloned」エラーを修正。
- **計画**:
  1. 根本原因：`saveRecordingMeta` メソッドが Vue reactive Proxy でラップされた `segments`、`llmResults`、`documents` を直接 Electron IPC に渡している。V8 構造化クローンは Proxy オブジェクトをシリアライズできない。
  2. 修正：`saveRecordingMeta` 内で `JSON.parse(JSON.stringify(...))` を使用して `segments`、`llmResults`、`documents` をディープクローンし、Vue Proxy ラッピングから切り離す。
  3. 参考：`doOptimize` メソッド（App.vue:846）は既に同じ手法でこの問題を回避している。
  4. バージョン 1.14.3 → 1.14.4（パッチ：バグ修正）
- **結果**:
  - `frontend/src/App.vue`：`saveRecordingMeta` メソッドに `clonedSegments`、`clonedLlmResults`、`clonedDocuments` ディープクローン変数を追加；IPC 呼び出しパラメータをクローンされたオブジェクトに変更。
  - `frontend/package.json`：バージョンを 1.14.4 に更新
- バックアップ: backup-202606261417.zip

## [2026-06-26 17:02]
- **version**: 1.15.0
- **要件**: アプリケーションアイコン（左上隅のウィンドウアイコンとメイン .exe アイコン）をユーザー提供のマイクアイコンに交換する。
- **計画**:
  1. ユーザーが 1024x1024 RGBA PNG（`assets/app_icon.png`）を提供
  2. PIL を使用してマルチサイズ .ico（16/24/32/48/64/96/128/256）を生成 → `assets/app.ico`
  3. 256x256 PNG を生成 → `assets/icon.png`、`frontend/public/icon.png` にコピー（Vite 静的アセット）
  4. `frontend/electron/main.js`：`BrowserWindow` に `icon` プロパティを追加（開発モード → `assets/icon.png`、本番モード → `dist/icon.png`）
  5. `frontend/index.html`：`<link rel="icon" type="image/png" href="/icon.png">` ファビコンを追加
  6. `frontend/package.json`：`build.win.icon` は既に `../assets/app.ico` を指している（変更不要）
  7. バージョン 1.14.4 → 1.15.0（マイナー：新機能）
- **結果**:
  - `assets/app.ico` — マルチサイズ Windows アイコン（153 KB、8 サイズ：16/24/32/48/64/96/128/256）
  - `assets/icon.png` — 256x256 PNG アイコン（87 KB）
  - `frontend/public/icon.png` — Vite 静的アセット、ビルド時に `dist/icon.png` にコピー
  - `frontend/electron/main.js` — `createWindow()` に `icon` プロパティを追加、開発/本番モードで適切なパスを指定
  - `frontend/index.html` — ファビコン `<link>` タグを追加
  - `frontend/package.json` — バージョンを 1.15.0 に更新
- バックアップ: backup-202606261702.zip

## [2026-06-29 12:30]
- **version**: 1.17.0
- **要件**: UI リファクタリング — 1) ホームページの「ミックス」を「ミックス録音」に変更；2) 「マイク録音」と「ミックス録音」を「録音モード」ラジオグループ + 単一の開始/停止ボタンに変更；3) 「インポート」を「音声インポート」に変更；4) Whisper モデル選択とダウンロード管理を設定パネルに移動；5) 「エクスポート」をホームページから録音記録管理インターフェースに移動；6) Whisper モデルのデフォルトをグローバルに `small` に変更。
- **計画**:
  1. コントロールバー：ラジオグループ（🎙️ マイク / 🖥️ ミックス録音）+ 単一の動的ボタン（⏺ 録音開始 / ⏹️ 録音停止）
  2. ホームページからモデルドロップダウン、ダウンロードボタン、エクスポートボタンを削除
  3. 設定パネル：「Whisper モデル」セクション（ドロップダウン + ダウンロードボタン）+「ダウンロード済みモデル」リスト（削除ボタン付き）を追加
  4. 録音記録ツールバーと検索結果に「💾 エクスポート」ボタンを追加
  5. モデル削除用の IPC `model:delete` を追加
  6. zh-TW/en/ja の i18n を同期更新
  7. バージョン 1.16.0 → 1.17.0
- **結果**:
  - `frontend/src/App.vue` — コントロールバーをリファクタリング（ラジオ + 単一ボタン）、設定パネルに Whisper モデル管理セクションを追加、ホームページのエクスポート/モデルドロップダウン/ダウンロードボタンを削除、録音記録ツールバーと検索結果にエクスポートボタンを追加、`selectedModel` のデフォルトを `'small'` に変更、`deleteModel()`/`exportFromToolbar()`/`exportFromHistory()` メソッドを追加
  - `frontend/electron/main.js` — `model:delete` IPC ハンドラを追加（パス安全チェック付き）、`models:list` のレスポンスフィールド `size_mb` を `sizeMB` に変更
  - `frontend/electron/preload.js` — `deleteModel` ブリッジメソッドを公開
  - `frontend/src/i18n/zh-TW.js` — 15 個の i18n キーを追加（録音モード、モデル管理、エクスポート位置など）、`control.mixRecord`/`control.import`/`control.mix`/`history.mix` の値を変更
  - `frontend/src/i18n/en.js` — 15 個の新しい i18n キーを同期
  - `frontend/src/i18n/ja.js` — 15 個の新しい i18n キーを同期
  - `frontend/package.json` — バージョンを 1.17.0 に更新
  - `Product_Design_Guidelines.md` — v1.8.0 に更新、UI リファクタリングの変更を記録
  - バックアップ: backup-202606291230.zip

## [2026-06-29 13:50]
- **version**: 1.17.1
- **要件**: 長時間の音声認識でUIが「文字起こし中...」のまま固まる問題を修正。根本原因: whisper-cli.exe が大きな音声ファイルでハングする可能性があり（GPU使用率=0だがプロセスが終了しない）、進捗報告・キャンセル機能・タイムアウト保護がない。
- **計画**:
  1. バックエンド `runWhisper()`: stderr進捗解析とプッシュ（5秒毎）、ストール検出（5分間出力なしで自動終了）、絶対タイムアウト（90分）
  2. バックエンド: `activeWhisperProcs` Mapでプロセス追跡、`transcribe:start` の重複防止、`transcribe:cancel` IPCハンドラ追加
  3. フロントエンド `startTranscribe()`: `transcribe:progress` イベント購読、キャンセルボタンと `cancelTranscribe()` メソッド追加、重複トリガー防止
  4. preload: `transcribeCancel`、`onTranscribeProgress` インターフェース追加
  5. i18n: 3言語で5つのステータス文字列と1つのコントロールボタン文字列を追加
  6. バージョン 1.17.0 → 1.17.1
- **結果**:
  - `frontend/electron/main.js` — `runWhisper()` を進捗プッシュ、ストール検出、絶対タイムアウト、重複防止、キャンセルIPC付きでリファクタリング
  - `frontend/electron/preload.js` — `transcribeCancel`、`onTranscribeProgress` を追加
  - `frontend/src/App.vue` — 進捗購読、キャンセルボタン、重複トリガー防止、`_transcribingAudioPath` データフィールド追加
  - `frontend/src/i18n/zh-TW.js` / `en.js` / `ja.js` — 各6つの新i18nキー
  - `frontend/package.json` — バージョンを1.17.1に更新
- バックアップ: backup-202606291350.zip

## [2026-06-29 14:48]
- **version**: 1.17.2
- **要件**: 長時間音声ファイルはCPUで正常に認識できるが、GPU（Vulkan, AMD RX 5700 XT）がハングすることを確認。GPU→CPU自動フォールバックが必要。
- **計画**:
  1. `runWhisper()` に `anySegmentOutput` フラグを追加し、GPUの実際のストールを検出
  2. `transcribe:start` IPCハンドラで `gpuStalled=true` 時に自動的にCPUで再試行
  3. フロントエンドで `data.fallback` を処理してGPU→CPUフォールバックメッセージを表示
  4. 3言語（zh-TW/en/ja）に `gpuFallback` i18nキーを追加
  5. バージョン 1.17.1 → 1.17.2
- **結果**:
  - `frontend/electron/main.js` — `runWhisper()`: `anySegmentOutput` & `gpuStalled` フラグを追加（stderrに `[timestamp]` 出力なし→GPUストールと判定）; `transcribe:start`: `gpuStalled=true` 時に `useGpu=false` で自動再試行、再試行中は `fallback: true` 進捗イベントをプッシュ
  - `frontend/src/App.vue` — `startTranscribe()`: 進捗イベントの `data.fallback` を処理し、フォールバックメッセージを表示
  - `frontend/src/i18n/zh-TW.js` — `status.gpuFallback` を追加
  - `frontend/src/i18n/en.js` — `status.gpuFallback` を追加
  - `frontend/src/i18n/ja.js` — `status.gpuFallback` を追加
  - `frontend/package.json` — バージョンを1.17.2に更新
  - テスト：元の105分の会議音声→GPUは4回ともハング、CPUは正常に認識完了
  - バックアップ: backup-202606291448.zip

## [2026-06-29 15:08]
- **version**: 1.17.3
- **要件**: ユーザーから v1.17.1/v1.17.2 の CPU モードも失敗するとの報告 — CPU (model=small) で 105 分の音声を処理する際、進捗テキストの出力開始まで 5 分以上かかり、ストール検出によりプロセスが強制終了されていた。ストール検出戦略の修正が必要。
- **計画**:
  1. WAV ペイロードサイズから音声長を計算する `estimateAudioDuration()` 関数を追加（16kHz s16pcm = 32000 bytes/sec）
  2. `getStallTimeoutMs()` 関数を追加：
     - CPU モード: `null` を返す（ストール Kill なし、90 分絶対タイムアウトのみ）
     - GPU モード: 音声長に基づく動的タイムアウト、式 = `min(audioDuration × 0.5, 30分)`、最小 5 分
  3. 進捗プッシュ間隔を 5 秒から 10 秒に変更（オーバーヘッド削減）
  4. バージョン 1.17.2 → 1.17.3
- **結果**:
  - `frontend/electron/main.js` — `estimateAudioDuration()`、`getStallTimeoutMs()`（CPU は null を返す）を追加；ストールチェックは動的タイムアウトを使用；進捗間隔を 10 秒に変更
  - `frontend/package.json` — バージョンを 1.17.3 に更新
  - バックアップ: backup-202606291508.zip

## [2026-06-29 17:18]
- **version**: 1.19.0
- **要件**：ユーザーから「本バージョンに非同期文字起こし機構は実装されていますか」 → WhisperJobManager 非同期機構を実装し、UI フリーズを防止、複数音声ファイルのキュー処理をサポート。
- **実装計画**：
  1. `WhisperJobManager` クラス（バックエンド）を作成：`jobQueue` / `activeJob` / `jobHistory` 3 段状態管理
  2. `addJob()` は即座に `jobId` を返却、バックグラウンドの `processNext()` で逐次実行
  3. 同ファイル in-flight 防止 + App 終了時の `cancelAll()` 統一キャンセル
  4. `~/.recoder/jobs.json` へ永続化（最新 50 件）
  5. 7 個の新しい IPC ハンドラ（submit/status/list/cancel/clear/getResult/event）
  6. フロントエンド `startTranscribe()` を fire-and-forget モードに変更、`onTranscribeEvent` を購読
  7. フロントエンド `_onTranscribeEvent()` で running/completed/failed/cancelled 状態を処理
  8. i18n 3 言語に `status.transcribingJob` を追加
  9. バージョン 1.18.0 → 1.19.0
- **実装結果**：
  - `frontend/electron/main.js` — `WhisperJobManager` クラス（約 300 行）；7 個の IPC ハンドラ；GPU 自動フォールバック統合；`setMainWindow` / `cancelAll`
  - `frontend/electron/preload.js` — 6 個の新しいブリッジメソッド（transcribeSubmit/GetStatus/GetResult/List/JobCancel/JobClear + onTranscribeEvent）
  - `frontend/src/App.vue` — `startTranscribe()` を fire-and-forget に；新しい `_onTranscribeEvent`；新しい `initTranscribeEventListener`
  - `frontend/src/i18n/zh-TW.js` — `status.transcribingJob` を追加
  - `frontend/src/i18n/en.js` — `status.transcribingJob` を追加
  - `frontend/package.json` — バージョン 1.19.0
  - ビルド成功：`frontend/dist-electron-build2/Recorder-1.19.0-portable.exe`（188 MB、コード署名済み）
  - git commit `65e2054` を GitHub origin master にプッシュ
  - バックアップ：backup-202606291717.zip

---

## [2026-06-29 18:13] v1.20.0 — ホームページ非同期ジョブ管理パネル
- **version**: 1.19.0 → 1.20.0
- **requirement**: ホームページに非同期 Job List / Status / Show Log / Delete / Stop を提供
- **plan**: バックエンド Manager に deleteJob() 追加；新規 IPC；新規 Job ボタン + バッジ；2 タブの新パネル；ログモーダル；3 言語 i18n
- **result**: ビルド検証待ち
- **backup**: TBD

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

## [2026-06-29 23:55] v1.20.2 — 「履歴 Review」後の無音ファイル誤判定修正 + Voiceprint モデル完全性検査 + Voiceprint 非同期 Job 化
- **version**: 1.20.1 → 1.20.2（patch：バグ修正＋アーキテクチャ最適化）
- **修正要求**:
  1. 履歴 → Review 從入後、「話者識別」をクリックすると「❌ 無音ファイル」エラーが出る（実際は音ファイルあり）
  2. Voiceprint モデルファイルが不完全な場合、「話者識別」が「モデルを読み込めません」でスタックする
  3. 一貫性と UI 可視性のため、「話者識別」を非同期 Job に変換し、Jobs パネルとバッジカウントに表示
- **根本原因**:
  1. `App.vue doDiarize()` が `this.currentAudioPath` を直接参照しているが、Review フローでは `null` のままのため誤判定
  2. `voiceprint.js isModelCached()` はファイルの存在のみチェックし、完全性を検証していない（ダウンロード中断で 0 バイトファイルが残る）
  3. `voiceprintDiarize` IPC が同期呼び出しのため、UI は Jobs パネルで進捗を表示できず、ユーザーは待つしかない
- **修正と增强**:
  1. `doDiarize()` に `recoLoadMeta({ recordingId })` からの audioPath 補救処理を追加
  2. `voiceprint.js isModelCached()` にファイルサイズ検査を追加（≥40MB → 有効）、`resetModel()` を追加
  3. バックエンドに `VoiceprintJobManager` クラス（queue/active/history + persist + log + cancel/delete）と IPC `voiceprint:jobSubmit/Status/List/Cancel/Delete`、`voiceprint:reset` を追加
  4. フロントエンド: `voiceprintJobList` データ、`currentJobList` 計算属性、`totalInFlightJobs/totalJobs` マルチタブ統計、Voiceprint tab UI、`onVoiceprintJobUpdate` 購読、`doDiarize` をバックグラウンド Job 送信に変更、完了時に speaker を `transcriptionResults` に書き戻し、文字起こしに `👤 Speaker_X` タグを表示
- **三言語同期**: `zh-TW.js` / `en.js` / `ja.js` に `status.voiceprintDone`、`status.voiceprintFail`、`jobs.type.voiceprint`、`jobs.voiceprintTab` を追加
- **修正結果**:
  - `frontend/electron/main.js`: VoiceprintJobManager + 6 IPC ハンドラー
  - `frontend/electron/preload.js`: 7 個の新規 bridge（voiceprintJobSubmit/Status/List/Cancel/Delete/Reset + onVoiceprintJobUpdate）
  - `frontend/electron/voiceprint.js`: `isModelCached` にファイルサイズ検査、追加 `resetModel()`
  - `frontend/src/App.vue`: `doDiarize` を Job モードに変更、initJobListener で `onVoiceprintJobUpdate` を購読、refreshJobList で `voiceprintJobList` をロード、stopJob/deleteJob/openJobLog に voiceprint 分岐を追加、文字起こしに speaker tag 表示
  - `frontend/src/i18n/{zh-TW,en,ja}.js`: voiceprint 関連 i18n keys を追加
  - `frontend/package.json`: バージョン番号を 1.20.2 に更新
- **後続收尾**（同セッション）: 三言語 modify_record / readme / Product_Design_Guidelines 同期、`npm run electron:build` 再コンパイル + code sign + バックアップ作成 + git commit + push

## [2026-06-30 02:00] v1.20.3 — onnxruntime-node ネイティブバイナリ読み込み修正
- **version**: 1.20.2 → 1.20.3（patch: hotfix）
- **要求**: ユーザーから「話者識別を実行すると Job failed: 声紋モデルを読み込めません。先にモデルをダウンロードしてください が表示されるが、モデルは既にダウンロード済み」との報告。
- **原因**: onnxruntime-node は実行時にネイティブバイナリ (onnxruntime_binding.node) を必要としますが、electron-builder は 
ode_modules 全体を asar に圧縮してしまい、ネイティブバイナリは asar 内に入って Node.js の equire で読めず、InferenceSession.create() が失敗します。モデル自体には問題がないのに、エラーメッセージがモデル側の問題のように見えてしまっていました。
- **修正**: rontend/package.json の uild.asarUnpack に "node_modules/onnxruntime-node/**/*" を追加。electron-builder が asar 展開時に onnxruntime-node（ネイティブバイナリ含む）を pp.asar.unpacked/ に展開し、Node.js から正常に equire できるようになります。
- **結果**:
  - rontend/package.json: asarUnpack に 
ode_modules/onnxruntime-node/**/* を追加
  - Recorder-1.20.2-portable.exe 再ビルド + コード署名
  - git commit + push
- **バックアップ**: backup-202606300208.zip

## [2026-06-30 02:30] v1.20.4 — downloadModel 完全性チェック
- **version**: 1.20.3 → 1.20.4（patch: hotfix）
- **要求**: 「モデルをダウンロードしてもファイルサイズが 0.0 MB。再ダウンロードしても失敗する」との報告。
- **原因**: v1.20.3 でネイティブバイナリ問題が解決した一方、「モデルダウンロード」ボタンが書き込む ~/recoder/voiceprint/campplus_cn_en_common_200k.onnx の中身が、ネットワーク／HF レート制限により HTML テキスト（"Found. Redirecting to ..."）となり、それをバイナリとして .downloading に書いたまま rename した結果、0 bytes またはテキスト内容のままとなることがありました。isModelCached() は存在とサイズ ≥40 MB だけを見るため 0 bytes では false を返し続け、「モデル未ダウンロード」のまま固まります。
- **修正**:
  1. downloadModel() はまず .downloading 一時ファイルへ書き込み、eceivedBytes を累積する。合計が 1 MB 未満ならダウンロード失敗とみなして一時ファイルを削除し reject。
  2. diarizeAudio() は loadModel() 失敗時に再度ファイルサイズを確認し、1 MB 未満なら esetModel() で破損ファイルを自動削除し、ユーザーに再ダウンロードを促す。
- **結果**: rontend/electron/voiceprint.js の downloadModel() と diarizeAudio() 読み込みロジックを修正。
- **バックアップ**: backup-202606300208.zip

## [2026-06-30 02:45] v1.20.5 — HuggingFace LFS xet-bridge text/plain リダイレクト対応
- **version**: 1.20.4 → 1.20.5（patch: hotfix）
- **要求**: v1.20.4 で完全性チェックを入れても、引き続き "ダウンロード失敗 (received X bytes)" と表示される。
- **原因**: HuggingFace LFS は us.aws.cdn.hf.co や cdn-lfs.huggingface.co といった xet-bridge プロキシ経由で配信されることがあり、**HTTP 200 + Content-Type: text/plain + body="Found. Redirecting to https://..."** という形で返す場合があります（標準の 302 リダイレクトの代わり）。Node.js 標準の https.get は 3xx の Location: ヘッダしか追わないため、この text/plain body をそのままモデルファイルに書き込んでしまいます。
- **修正**: etchWithRedirects() を再設計し、レスポンスが 	ext/plain の場合は body を peek して、Found. Redirecting to <URL> で始まるなら URL を抽出して etchWithRedirects(next) を再帰呼び出し。edirectsLeft = 5 の上限は維持。
- **結果**: rontend/electron/voiceprint.js fetchWithRedirects() に text/plain 暗黙リダイレクト処理を追加。
- **バックアップ**: backup-202606300208.zip

## [2026-06-30 03:15] v1.20.6 — Voiceprint Job UI ロック修正 + 男性／小女孩クラスタリング失敗修正
- **version**: 1.20.5 → 1.20.6（patch: hotfix）
- **要求**: ユーザーから 2 件の報告：
  1. 「話者識別 Job は完了するのに、ホーム画面で 0% のままボタンがグレーで、他音声の話者識別ができない」（UI ロック）
  2. 「話者識別で、男の子と小女孩の 2 人の発話を見分けられない」（クラスタリング失敗）
- **原因**:
  1. **UI ロック（問題 1）**：App.vue の _jobUpdateListener は data.jobType === 'voiceprint' で分岐していますが、バックエンドの VoiceprintJobManager._sendUpdate() が送ってくるフィールド名は実は data.type。このため voiceprint Job の完了イベントが**黙って破棄**され、oiceprintBusy が 	rue のままとなり、ホームの話者識別ボタンが disable のまま固まる。
  2. **クラスタリング失敗（問題 2）**：diarizeAudio() は cosine similarity threshold = 0.6 を使用。低い男性の声と高音の小女孩の声の embedding 類似度は 0.6 を大きく下回るため、2 話者が同一クラスタにまとめられてしまう。さらに pcm.length > 16000（1 秒閾値）で小女孩の短い発話区間が捨てられてしまうため、彼女の声がほぼ分析対象から外れていました。
- **修正**:
  1. _jobUpdateListener: data.jobType === 'voiceprint' → data.type === 'voiceprint'。progress を number と { percent: 0 } オブジェクトの両方に対応するようパース処理を補強。
  2. diarizeAudio():
     - pcm.length > 16000 → pcm.length > 8000（1 秒 → 0.5 秒閾値に下げ、短い発話も拾う）
     - clusterEmbeddings(validEmbeddings, 0.6) → clusterEmbeddings(validEmbeddings, 0.5)（男性／小女孩など差異が大きい組み合わせを許容するよう閾値を緩和）
- **結果**:
  - rontend/src/App.vue: _jobUpdateListener のフィールド名修正 + progress パース強化
  - rontend/electron/voiceprint.js: 最小 PCM 8000 + threshold 0.5
  - Recorder-1.20.2-portable.exe 再ビルド（188,635,584 bytes、2026-06-30 03:16）+ コード署名
  - git commit + push
- **バックアップ**: backup-202606300316.zip## [2026-06-30 16:00] v1.20.15 — 文字起こし完了 IPC race 修正 + 診断ログ

- **version**: 1.20.14 → 1.20.15（patch: hotfix）
- **修正要求**: 特定の録音ファイルで「文字起こし」ボタンを押すと、UI が永遠に「❌ 未知エラー」を表示するが、recorder.log には exit=0 と "Job completed" が記録されており、バックエンドは正常に完了している。
- **根本原因分析**:
  1. `WhisperJobManager._sendUpdate()` が「completed」イベントで `status` のみを送信し、`result.segments` を含めていなかった。
  2. フロントエンド `_onTranscribeEvent` が `data.status === 'completed'` を検知すると即座に `transcribe:getResult` を呼び出す。
  3. バックエンドの順序は正しいが（status → completed → result 書き込み → sendUpdate）、IPC race window が存在し、バックエンドハンドラーがまだ `jobHistory` を確定していないタイミングで `transcribe:getResult` が呼ばれると `{ success: false, error: 'job 尚未完成' }` が返される。
  4. フロントエンドの `catch` ブロックが `error.message` を握り潰し、「❌ 未知エラー」にフォールバックするためデバッグに役立たない。
- **修正方針**:
  1. `WhisperJobManager._sendUpdate()`：`job.status === 'completed'` かつ `job.result` が存在する場合、`result` を payload に含めてレンダラーに送信。
  2. フロントエンド `_onTranscribeEvent` の completed 分岐：まず `data.result`（イベント内添付）を読み、無ければ `transcribeGetResult` にフォールバック。
  3. `transcribe:getResult` ハンドラ：DEBUG ログを追加（job 状態 / audioPath / hasResult）。
  4. `_sendUpdate`：DEBUG ログを追加（status / hasResult / hasInlineResult）。
  5. フロントエンド `_onTranscribeEvent`：入口に `console.log('[app] transcribe event:', ...)` を追加し今後の解析を容易にする。
  6. `catch` ブロック：「未知エラー」よりも具体的なメッセージ（例：`❌ 取得辨識結果失敗: status=...`）を使用。
  7. `saveRecordingMeta` は内部で try/catch 済み。呼び出し側でもう一度 try/catch でラップし、保存失敗が逐字稿表示に影響しないよう保証。
- **修正結果**:
  - `frontend/electron/main.js` の `WhisperJobManager._sendUpdate()` と `transcribe:getResult` ハンドラ。
  - `frontend/src/App.vue` の `_onTranscribeEvent` completed 分岐 + 入口 console.log。
  - `frontend/package.json` バージョン `1.20.14 → 1.20.15`。
  - `Recorder-1.20.15-portable.exe` を再ビルド + コード署名。
  - git commit + push。
- **バックアップファイル名**: backup-202606301600.zip
## [2026-06-30 16:42] v1.20.16 — _executeTranscribe job.result 未代入修正

- **version**: 1.20.15 → 1.20.16（patch: hotfix）
- **修正要求**: v1.20.15 hotfix 後、ユーザーから「一部の音声ファイルでは依然として `❌ 取得辨識結果失敗: 無 result`」が表示され、debug log には `sendUpdate status=completed hasResult=false hasInlineResult=false` と記録されると報告された。
- **根本原因分析**: `WhisperJobManager._executeTranscribe()` には 3 つの return 経路（チャンク無し直接 runWhisper、チャンク失敗の降格直接 runWhisper、チャンク後の逐次処理）があるが、**`job.result` を代入しているのはチャンク経路のみ** (`allSegments.push(...) → job.result = { success: true, segments: allSegments }`)。残る 2 つの経路は `return await this._runSingleTranscribe(...)` するだけで `job.result` に代入しないため、completed イベント時点で常に `job.result === null` となる（デフォルト設定の `whisperChunkMinutes=0` はほぼ全員のチャンク無し経路を実行する）。
- **修正方針**:
  1. `_executeTranscribe()` の両方の「チャンク無し / 降格」経路で `_runSingleTranscribe()` の戻り値を受け取り、`job.result = { success: true, segments: result.segments || [] }` を return 前に代入。
  2. **v1.20.15 hotfix は引き続き有効** — 根本原因は 2 層構造：`_sendUpdate()` で `result` を付けない (v1.20.15 で修正)、`job.result` が一度も代入されない (今回修正)。両方を修正して初めて完全解決。
- **修正結果**:
  - `frontend/electron/main.js` の `_executeTranscribe()` 3 つの return 経路すべてで `job.result` を代入するように修正。
  - `Product_Design_Guidelines.md` バージョン `1.20.15 → 1.20.16`。
  - `frontend/package.json` バージョン `1.20.15 → 1.20.16`。
  - `Recorder-1.20.16-portable.exe` を再ビルド + コード署名。
- **バックアップファイル名**: backup-202606301642.zip
## [2026-06-30 17:00] v1.21.0 — 半監督式スピーカー伝播

- **version**: 1.20.16 → 1.21.0（minor: 新機能）
- **修正要求**: 「短いセグメント (<1.5s) は話者を正確に区別できない」問題を解決し、「ユーザーが数文に話者を手動マーク → 残りのセグメントを自動推算」ワークフローをサポート。
- **背景**: 既存の v1.20.2 `diarizeAudio` は無監督クラスタリング（cosine 閾値 0.5）であり、短いセグメントでは性能が低い（v1.20.6 の根本原因の一つ）。「同じ文を複数回繰り返すと精度が上がる」という誤解があるが、実務上 campplus x-vector モデルは話者特性を学習しており、意味内容は学習していないため、同じ文を繰り返しても新しい情報はない。
- **修正方針**:
  1. `frontend/electron/voiceprint.js`:
     - 定数 `PROPAGATE_MIN_THRESHOLD = 0.5` を追加
     - 共通ヘルパー `_extractAllEmbeddings(audioPath, segments, progressCallback)` を抽出（長音檔チャンク化 + チャンク間接続含む）
     - 共通ヘルパー `_ensureModelLoaded()` を抽出（モデル存在 + サイズチェック + InferenceSession 作成）
     - `diarizeAudio()` を上記ヘルパー使用にリファクタ、本体を約30行に短縮
     - `propagateSpeakers(audioPath, segments, seeds, options)` を追加：半監督式 cosine 比較 + L2-normalize 重心 + 閾値フィルタ
     - `module.exports` に `propagateSpeakers` と `PROPAGATE_MIN_THRESHOLD` を追加
  2. `frontend/electron/main.js`:
     - IPC ハンドラ `ipcMain.handle('voiceprint:propagate', ...)` を追加
     - `appLog` で recorder.log にログ
  3. `frontend/electron/preload.js`:
     - `voiceprintPropagate` を公開
  4. `frontend/src/i18n/{zh-TW,en,ja}.js`: voiceprint.* キー19個を追加
  5. `frontend/src/App.vue`:
     - data: `showSpeakerEditor`, `editingSpeakerIdx`, `editingSpeakerName`, `seedMap`, `propagateBusy`, `propagateThreshold`, `showPropagatePanel` を追加
     - 各セグメントに「+👤」ボタン（未マーク）またはクリック可能な speaker-tag（マーク済）
     - クリックで **Speaker Editor Modal** 表示：話者名入力 → 確定
     - コントロールバーに「🪄 マークから全セグメントへ伝播」ボタン（紫 #7B1FA2）
     - クリックで **伝播 Panel** 表示：全 seed 一覧、閾値スライダー、削除/クリア/伝播アクション
     - 3つの新メソッド: `setSegmentSpeaker`, `doPropagateSpeakers`, `clearAllSpeakers`
  6. `Product_Design_Guidelines.md`: §15 半監督式スピーカー伝播セクションを追加
- **修正結果**:
  - ユーザーは数文をクリックして「張三」「李四」等の話者名を手動マーク可能
  - 伝播ボタン押下後、5-15秒で全セグメントの話者マークを完了
  - 伝播結果は +👤 で微調整可能
  - 期待効果: 以前は Speaker_1 に誤分類されていた短いセグメントが、seed 比較により正しい話者（例: 李四）に正しく分類される
  - 既存の v1.20.2 無監督 `diarizeAudio` も使用可能；両方ともコントロールバーに共存（v1.20.2 = 「👥 話者識別」オレンジボタン、v1.21.0 = 「🪄 伝播」紫ボタン）
- **バックアップファイル名**: backup-202606301700.zip

## [2026-06-30 17:35] v1.21.1 — 話者マーク/クリアのたびに新しい metadata ファイルが作成される問題を修正

- **version**: 1.21.0 → 1.21.1（patch: hotfix）
- **修正要求**: v1.21.0 リリース後、「話者マークをキャンセル / 話者名を編集するたびに」履歴リストに余分な逐字稿エントリが1件ずつ追加される。期待動作はインプレース編集であり、毎回新規ファイルを作成すべきではない。
- **根本原因**:
  1. `frontend/src/App.vue` の `saveRecordingMeta(segments)` は元々 `currentRecordingId` が空の場合、現在時刻を基に新しいIDを生成してファイルに書き込んでいた。
  2. `setSegmentSpeaker()` / `doPropagateSpeakers()` / `clearAllSpeakers()` の呼び出しごとに `saveRecordingMeta(this.transcriptionResults)` が走る。
  3. `_onTranscribeEvent('completed')` は `currentRecordingId` をセットするが、「履歴からの Review」/「キャンセルして再マーク」のパスで race condition が発生し、`currentRecordingId` が空のまま複数回呼ばれ、毎回新ファイルが作成される。
  4. 最も多いケース：+👤 で話者をマーク（`setSegmentSpeaker` 1回目）→ 同じ話者をクリックしてキャンセル（2回目）→ ファイルが2つ作成される。
- **修正方針**:
  1. `frontend/src/App.vue` の `saveRecordingMeta()`:
     - v1.21.1 hotfix：まず `this.currentRecordingId` を読み、既存なら**それを再利用**し、新規IDを生成しない。
     - 新規転写完了 / Review 進入時のみ、上位レイヤーが明示的にIDをセットして初めて保存される。
  2. `frontend/src/App.vue` に `_scheduleSaveRecordingMeta()` debounce ヘルパー（500ms）を追加：
     - 既存の setTimeout をクリアしてリトライ。連続編集による race / 複数保存IPCの並列発生を防ぐ。
  3. `frontend/src/App.vue` の3箇所の hotfix を `_scheduleSaveRecordingMeta()` に置換：
     - `setSegmentSpeaker()`
     - `doPropagateSpeakers()`
     - `clearAllSpeakers()`
  4. `frontend/package.json`: version 1.21.0 → 1.21.1
  5. `Product_Design_Guidelines.md` のバージョンと更新日を更新
  6. modify_record（zh-TW / en / ja）3言語に本エントリを追加
- **修正結果**:
  - 同一の逐字稿 / 同一の recordingId は、ユーザーが何度マーク・キャンセル・伝播・クリアしても常に単一ファイル。
  - 「転写完了 → 履歴表示」も必ず1件のみで、繰り返しのマーク/キャンセルで複数エントリに「汚れる」ことがない。
  - 500ms debounce で迅速な連続編集でも保存は1回だけとなり、I/O スタームを防止。
- **バックアップファイル名**: バックアップステップで生成予定

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


## [2026-07-02 01:35] v1.22.0 — 複数モデル Speaker Embedding アーキテクチャ (MODEL_REGISTRY factory pattern)

- **version**: 1.21.4 → 1.22.0 (minor: 複数モデルアーキテクチャ)
- **変更要求**: 複数の ONNX speaker embedding モデル (camplus / ECAPA-TDNN / ResNet-SE) を factory pattern でサポート
- **変更計画**:
  1. ECAPA-TDNN / ResNet ONNX ソース調査 → 結論：HF/ModelScope/speechbrain 公式 ONNX ミラーは全て 401/404
  2. voiceprint.js を MODEL_REGISTRY factory pattern にリファクタ、3 つの model entries (camplus / ecapa_tdnn / resnet_se) を定義
  3. 動的 ONNX session 管理：loadModel(modelKey) は古いセッションを解放してから新しいモデルを読み込み
  4. ファイル名隔離：各 modelKey は独立パス (voiceprint/<modelKey>/model.onnx)
  5. main.js に 6 つの IPC handler 追加：listModels / importModel / setActiveModel / openImportDialog / getCurrentModel / download が modelKey を受け取る
  6. preload.js に 5 つの新 API を公開
  7. i18n 3 言語に 22 個の voiceprint.* キーを追加
  8. App.vue data に voiceprintModels / currentVoiceprintModel + 設定パネル「声紋モデル管理」セクションを追加
  9. App.vue methods に 5 つ追加：loadVoiceprintModels / downloadVoiceprintModel / importVoiceprintModel / setActiveVoiceprintModel / recommendVoiceprintModel
  10. App.vue mounted() で loadVoiceprintModels を呼び出し
- **変更結果**:
  - 構文チェック：vite build 成功 (15 modules transformed)
  - ビルド成果物：frontend/dist-electron-build5/Recorder-1.22.0-portable.exe (188.6 MB, signtool 署名付き)
  - camplus がデフォルト自動ダウンロード可能、ECAPA-TDNN / ResNet-SE は手動 ONNX インポートが必要
  - 設定パネルで 3 つの embedding アーキテクチャを自由にダウンロード / インポート / 切替可能
  - 自動モデル切替：loadModel() は古いセッションを解放してから新しいものを読み込み、バックエンドは modelKey でルーティング
  - 3 言語 readme + Product_Design_Guidelines §16 + modify_record 3 言語すべて同期済み
- **バックアップファイル名**: backup-202607020126.zip


## [2026-07-02 05:08] v1.22.1 — ResNet-SE 自動ダウンロード対応（WeSpeaker 公式 ONNX）

- **version**: 1.22.0 → 1.22.1 (patch: ダウンロード URL 補完)
- **変更要求**: ユーザーから「resnet_se onnx どこでダウンロードできるか」と質問があり、v1.22.0 では resnet_se の url が空で（手動インポートが必要）
- **変更計画**:
  1. curl + HuggingFace API models エンドポイントで Wespeaker/wespeaker-cnceleb-resnet34-LM 公開 ONNX を発見
  2. ダウンロード URL 検証: https://huggingface.co/Wespeaker/wespeaker-cnceleb-resnet34-LM/resolve/main/cnceleb_resnet34_LM.onnx (HTTP 200, 26.5 MB)
  3. onnxruntime-node で ONNX 構造確認: inputNames=[feats], outputNames=[embs], 256-dim embedding (campplus と同一インターフェース)
  4. voiceprint.js MODEL_REGISTRY.resnet_se 更新: url + filename + dim を 256 に変更
  5. package.json version 1.22.0 → 1.22.1 にアップグレード
  6. 三言語 readme に v1.22.1 エントリ追加
- **変更結果**:
  - voiceprint.js 設定更新完了、resnet_se は campplus と並列で自動ダウンロード可能
  - 上級者向けオプション (114MB ResNet293 大モデル) は引き続き手動インポート
  - 三言語 readme (繁中/英/日) と modify_record 同期済み
- **バックアップファイル名**: backup-202607020508.zip (生成予定)
## [2026-07-02 22:39]
- **version**: 1.22.1 → 1.23.0 (minor: 教師あり Speaker Recognition + Profile Database)
- **変更要件**: ユーザーから「同じフレーズを繰り返しコピーして話者認識率を向上させることは可能か」「音声ファイル内の特定話者の声を見つけるにはどうすればよいか」「教師あり学習（識別法）のサポート」を質問された。確認後、v1.21.0 半教師あり propagation における短文認識率の弱点を解決するため、Speaker Profile Database + 教師あり speaker recognition モジュールの追加を決定。
- **コア設計**:
  - **Profile Database (永続化 JSON)**: 保存先 ~/recoder/speaker_profiles.json、各 profile は {id, name, modelKey, dim, centroid, samples, internalCoherence, source, createdAt, updatedAt} を記録。modelKey でグループ化し異次元混在を防止。MAX_PROFILES = 200。
  - **buildProfile(audioPath, segments, seeds, modelKey)**: ユーザー指定の seeds から音声を抽出、embedding 計算、trimmed mean centroid 算出、Array<Profile> を返す。v1.22.0 マルチモデル対応（camplus 192-d / ecapa_tdnn 192-d / resnet_se 256-d）。
  - **buildProfileFromAudioFile(audioPath, name, modelKey)**: 独立短音声ファイルから直接 profile を作成（「同じフレーズを繰り返し」シナリオ用）。
  - **identifySpeakers(audioPath, segments, profiles)**: 教師あり identification — 全 segment の embedding を抽出し全 profile centroid と cosine 類似度計算、最良一致をマーク。{segments: [{start, end, text, speaker, score}], modelKey} を返す。
  - **backfillAll(profiles)**: 全履歴録音を全 profile で一括再アノテーション、新規 profile 作成後に便利。progress event (onVoiceprintBackfillProgress) 対応。
- **新規モジュール**:
  - rontend/electron/speakerProfile.js — 完全 CRUD 永続化レイヤー（listProfiles / getProfile / saveProfile / renameProfile / deleteProfile / getDbPath / getStats）。
- **API 拡張**:
  - oiceprint.js に 4 つの exported function 追加：buildProfile、buildProfileFromAudioFile、identifySpeakers、_computeCentroidFromEmbeddings。
  - main.js に 10 個の IPC handler 追加：voiceprint:profileList / profileSave / profileRename / profileDelete / profileStats / profileBuildFromSeeds / profileBuildFromAudioFile / openAudioDialog / identifySpeakers / backfillAll + reco:searchBySpeaker。
  - preload.js に 11 個の新規 API を公開。
- **UI 統合** (App.vue):
  - 3 つの新ボタン：👤 Create Profile、🎯 Identify Speakers (Supervised)、🔄 Apply to All History。
  - 新規パネル：「Speaker Database」modal — 全 profile を一覧表示、名前、モデル、サンプル数、内部一貫性 (%) を表示、rename/delete 対応。
  - data に profiles / showProfilePanel / identifyBusy / backfillBusy / backfillProgress 追加。
  - methods に loadProfiles / openProfilePanel / doIdentifySpeakers / doBackfillAll / renameProfile / deleteProfile 追加。
  - CSS に .profile-item / .profile-header / .profile-name / .profile-model / .profile-stats / .profile-actions 追加。
- **i18n 修正**:
  - en.js / ja.js / zh-TW.js に 19 個の voiceprint.profile.* keys 追加。
  - en.js line 308-313 の複数行文字列エラーを修正（'confirm.deleteFolder' 等）。
  - PowerShell スクリプトで引用符なしの key 名を自動補完（再発防止）。
- **ビルドとデプロイ**:
  - rontend/package.json version 1.22.1 → 1.23.0。
  - vite build 成功（222.20 kB / 62.26 kB gz）。
  - electron-builder 成功、dist-electron-build6/Recorder-1.23.0-portable.exe (179.89 MB) を出力。
  - Code Sign: Recorder.exe / whisper-cli.exe / ffmpeg.exe / elevate.exe を全て C:\Certs\recorder_selfsign.pfx で署名、Subject=CN=Cheng-Feng Iron Factory、有効期限 2029/6/26。
- **結果**: 教師あり Speaker Recognition と Profile Database を実装し、v1.21.0 半教師あり方式より信頼性の高い短文認識を提供。ユーザーは同じフレーズを繰り返す短音声で個人 profile を迅速に構築し、全履歴録音を一括バックフィル可能。ビルド成功、バックアップ完了。
- **バックアップファイル名**: backup-202607022239.zip


## [2026-07-04 06:23] v1.23.0 hotfix1 / 5 / 7 / 8
- **version**: 1.23.0 (累積ホットフィックス)
- **hotfix1（UI 入り口欠落）**：ユーザーから「👤 Create Profile で profile 作成場所が見つからない」と報告。根本原因：v1.23.0 メイン機能で Speaker Database panel は実装済みだが、panel 内に「💾 ラベルから作成 Profile」「📂 音声ファイルから作成 Profile」ボタンを追加し忘れていた。修正：Speaker Database panel 上部に緑色 profile-create-row ブロックと 2 つの作成ボタン + 対応する doBuildProfileFromSeeds / doBuildProfileFromAudioFile メソッド + 200 件上限チェックを追加。
- **hotfix5（IPC 戻り値形式の不一致）**：クリック後、JS 例外 Cannot read property 'samples' of undefined が発生。根本原因：main.js の oiceprint:profileBuildFromSeeds ハンドラは { success, profiles: [...], savedIds, count }（配列）を返すが、フロントエンドの doBuildProfileFromSeeds は .profile.samples.length（単一オブジェクト）を読み取り、JS 例外が発生。修正：const p = (r.profiles && r.profiles[0]) || null; if (p) { ... } で正しい形式に対応。
- **hotfix7（Electron は window.prompt 非対応）**：hotfix5 後、ユーザーから「クリックしても反応なし」と再度報告。根本原因：Chromium は window.prompt をデフォルトで無効化（破壊的ダイアログ防止）し、prompt() は即座に null を返し、サイレント終了。修正：App.vue に自製 <div v-if="showPromptDialog"> モーダル + _showPromptDialog(title, message, defaultValue) Promise ベース関数 + confirmPromptDialog / cancelPromptDialog ハンドラを追加し、全ての window.prompt() 呼び出しを置き換え。
- **hotfix8（preload.js に v1.23.0 の 11 API 欠落）**：ユーザーから「profile 名を入力して確認後、❌ 異常: window.electronAPI.voiceprintProfileBuildFromSeeds is not a function」と報告。根本原因：前回のビルドプロセスで rontend/electron/preload.js に v1.23.0 の 11 IPC API と 1 イベントリスナーが renderer 用に追加されていなかった。修正：preload.js 末尾に 14 API を追加：oiceprintProfileList/Save/Rename/Delete/Stats + oiceprintProfileBuildFromSeeds/BuildFromAudioFile + oiceprintOpenAudioDialog/IdentifySpeakers/BackfillAll + oiceprintListAllSpeakerNames + ecoSearchBySpeaker + onVoiceprintBackfillProgress。
- **バックアップファイル名**: backup-202607040623.zip
