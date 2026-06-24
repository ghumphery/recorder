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
