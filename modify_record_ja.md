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