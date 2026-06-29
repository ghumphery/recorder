# 変更記録 (日本語)

> v1.13.0 以降の記録のみ日本語版で管理します。

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
