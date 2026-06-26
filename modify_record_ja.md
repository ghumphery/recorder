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
