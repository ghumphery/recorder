# Recorder — オフライン AI 会議記録ツール

[![GitHub release](https://img.shields.io/github/v/release/ghumphery/recorder)](https://github.com/ghumphery/recorder/releases)
[![GitHub](https://img.shields.io/github/license/ghumphery/recorder)](https://github.com/ghumphery/recorder)

> 🌐 **言語 / Language / 語言**: [繁體中文](readme.md) | [English](readme_en.md) | [日本語](readme_ja.md)

## 📝 機能概要

Recorder は完全**オフライン**の AI 会議記録ツールです：

- 📂 **音声インポート** — WAV / MP3 / Opus / OGG / FLAC / M4A 対応 (ffmpeg)
- 🤖 **音声認識** — whisper.cpp CLI（CPU / Vulkan GPU アクセラレーション対応）
- 🎙️ **録音** — マイク録音 + オンライン会議ミックス（システム音声 + マイク）
- ✨ **LLM 後処理** — 文章最適化、多言語翻訳（中文/English/日本語）、要約（Ollama ローカル/クラウド、OpenRouter、SiliconFlow、Gemini）
- 🔑 **独立 API Key** — AI プロバイダーごとに個別の API Key を保存
- 🎮 **GPU 制御** — Vulkan GPU アクセラレーションの有効/無効、GPU デバイス選択
- ▶️ **音声再生** — 文字起こしの文をクリックして対応する音声を再生
- 🗑️ **削除管理** — 録音記録と音声ファイルの削除
- 📄 **文字起こし出力** — プレーンテキスト (.txt) または Markdown (.md) 形式
- 🔒 **ネットワーク不要** — モデルを一度ダウンロードすれば完全オフライン（Flask / port 5199 / Python 不要）

## 🚀 開発モード

### 前提条件

- Node.js 20+、npm
- 音声モデル（GGML tiny ~77MB、初回ダウンロード後キャッシュ）
- **ffmpeg.exe**（約 149MB、GitHub 100MB 制限のためリポジトリに含まず）：
  - [gyan.dev FFmpeg Builds](https://www.gyan.dev/ffmpeg/builds/) から `ffmpeg-release-essentials.zip` をダウンロード
  - 解凍して `ffmpeg.exe` をプロジェクトルートの `ffmpeg/` フォルダに配置

### 実行

```bash
cd frontend
npm run electron:dev
```

### リリース版のダウンロード

[GitHub Releases](https://github.com/ghumphery/recorder/releases) から最新の `Recorder-1.14.1-portable.exe` をダウンロード。

### ソースからビルド

```bash
cd frontend
npm run electron:build
# 出力: frontend/dist-electron-build2/Recorder-1.14.1-portable.exe
```

### パッケージ版の実行

```
frontend\dist-electron\win-unpacked\Recorder.exe
```

### 音声再生について

- 文字起こしの文をクリックすると、そのセグメントの開始位置から再生されます
- 「⏹️ 停止」ボタンで再生を停止できます
- 他の録音や Review に切り替えると自動的に停止します
- 音声ファイル一覧から文字起こしする際、16kHz mono WAV が `reco_data` に保存され、再生と文字起こしで同じ音声ファイルが使用されます

## 🧰 システム要件

- **OS**: Windows 10/11
- **CPU**: x64、AVX2 対応（2013 年以降の CPU）
- **RAM**: 4GB 以上推奨
- **ストレージ**: ~300MB（音声モデル別：tiny 77MB / base 148MB / small 488MB）
- **GPU（オプション）**: Vulkan 1.0+ GPU、設定で構成可能
- **Python 不要**: 純粋な Node.js + C++ CLI ツール
- **Vulkan SDK**: カスタム Vulkan ビルドの場合のみ必要

## 🔒 プライバシーとセキュリティ

- すべての録音と文字起こしデータはローカルに保存され、クラウドにアップロードされません
- 初回モデルダウンロード時のみ Hugging Face に接続
- バックエンドサーバー不要（Flask なし、port 5199 なし）、すべて Electron IPC で処理
- 詳細は `security.md` を参照（開発者向け、リポジトリには含まず）

## 🎯 使用方法

1. アプリ起動 → 「インポート」をクリックして音声ファイルを選択
2. ffmpeg が自動的に 16kHz mono WAV に変換
3. モデルを選択（tiny/base/small）
4. 「文字起こし」をクリック → 進捗を待つ
5. 文字起こしを確認
6. 「エクスポート」で保存（.txt または .md）

## ⚙️ モデルオプション

- **tiny** (77 MB) — 最速、テスト用
- **base** (148 MB) — 速度と精度のバランス
- **small** (488 MB) — 最高精度、高品質会議に最適

## 📦 バージョン履歴

- **v1.14.2** — LLM バッチ処理（optimize）で30秒タイムアウトによる「The user aborted a request」エラーを修正：`callLLM()` の AbortController タイムアウトを30秒から120秒に延長し、大規模バッチ処理に対応
- **v1.14.1** — 「✨ 最適化」で `An object could not be cloned` エラーを修正：Vue reactive 配列（Proxy）が Electron IPC でシリアライズできない問題を、`JSON.parse(JSON.stringify(...))` でプレーンな JSON に変換してから渡すことで修正
- **v1.14.0** — LLM Job Manager 非同期処理機構を導入：トークン制限検出と自動バッチ分割（CJK 1.5 トークン/文字、ASCII 0.25 トークン/文字推定）；タイムスタンプを保持した文単位の最適化（`[N] 最適化テキスト` 形式解析）；Job ステートマシン `pending → running → completed/failed/cancelled`；フロントエンド Job リストパネル（プログレスバー、ログ、キャンセルボタン）
- **v1.13.2** — i18n リファクタリングによる UI バグを修正：`mounted()` ライフサイクルフックが誤って削除され、AI プロバイダーと whisper モデルのドロップダウンが空になる問題を修正；`mounted()` を復元して `fetchModels()`、`fetchLlmProviders()`、`loadSettings()` を呼び出す
- **v1.13.1** — 最新 portable exe をビルド（127 MB）、Windows Defender の `app.asar` ロック問題を回避
- **v1.13.0** — 多言語 UI 対応（zh-TW/en/ja）：i18n 言語ファイル、初回起動時と設定パネルでの言語選択；多言語ドキュメント（readme_en.md, readme_ja.md, modify_record_en.md, modify_record_ja.md）
- **v1.12.2** — 移動ダイアログでサブフォルダが表示されない問題を修正
- **v1.12.1** — 最新 portable exe をビルド（127 MB）
- **v1.12.0** — ツリー型ディレクトリ管理：フォルダ作成/削除/名前変更、複数選択一括移動/削除
- **v1.11.0** — ラベル管理：追加/編集/削除、フィルター、検索結果にラベル表示とジャンプ
- **v1.10.7** — whisper タイムスタンプ不正確による再生重複を修正
- **v1.10.6** — 次文再生重複を修正：イベント駆動シーケンシャル seek-and-play
- **v1.10.5** — 再生遅延と重複を修正
- **v1.10.4** — 文再生重複を修正：`audio.readyState` チェック
- **v1.10.3** — 停止ボタン追加、切替時自動停止、300ms バッファ、WAV パス統一
- **v1.10.2** — 再生バグ修正：`loadedmetadata` イベント駆動再生
- **v1.10.0** — 音声再生、削除管理、音声ステータス表示
- **v1.8.9** — whisper 幻覚修正：反幻覚パラメータ + 重複除去後処理
- **v1.8.4** — 分割録音が最初のセグメントのみ文字起こしする問題を修正
- **v1.8.3** — WAV を `C:\Users\<user>\recoder\reco_data\` に永続保存
- **v1.8.2** — タイトルバーのバージョン表示を修正
- **v1.7.5** — VAD リアルタイム文字起こしを削除
- **v1.5.4** — model/log/settings を `C:\Users\<user>\recoder\` に統一
- **v1.5.3** — 「An object could not be cloned」エラーを修正
- **v1.5.2** — 「設定を保存」ボタンの応答なしを修正
- **v1.5.0** — クロスバージョン設定移行；Vulkan GPU トグル
- **v1.4.0** — プロバイダー別 API Key；モデルダウンロード進捗バー
- **v1.3.3** — LLM エラーハンドリング修正
- **v1.3.1** — Ollama Cloud プロバイダー追加
- **v1.3.0** — LLM 後処理：最適化、翻訳、要約
- **v1.2.0** — Python + Flask バックエンドを削除；純粋な Node.js IPC アーキテクチャ
- **v1.1.0** — PyQt5 から Electron + Vue.js + Flask へ移行
- **v1.0.0 ~ v1.0.6** — オリジナル PyQt5 + faster-whisper (ctranslate2)

## 📁 プロジェクト構造

```
recorder/
├── frontend/                     # Electron + Vue.js フロントエンド
│   ├── package.json              # プロジェクト設定とバージョン
│   ├── vite.config.js
│   ├── index.html
│   ├── src/
│   │   ├── main.js               # Vue アプリエントリ
│   │   ├── App.vue               # メインコンポーネント (IPC 呼び出し)
│   │   └── i18n/                 # 多言語対応
│   │       ├── index.js
│   │       ├── zh-TW.js
│   │       ├── en.js
│   │       └── ja.js
│   ├── electron/
│   │   ├── main.js               # Electron メインプロセス (全バックエンド処理)
│   │   └── preload.js            # preload スクリプト (IPC contextBridge)
│   └── dist-electron/            # electron-builder 出力
├── whisper_cli/                  # whisper-cli.exe + DLL
├── model/                        # GGML 音声モデル
├── whisper_cpp/                  # whisper.cpp ソース (コンパイル用)
├── assets/                       # リソースファイル
├── backup/                       # ソースコードバックアップ
├── Product_Design_Guidelines.md
├── modify_record.md
├── readme.md
├── readme_en.md
└── readme_ja.md
```

## 🏗️ アーキテクチャ

```
ユーザー操作 → Electron Vue.js (フロントエンド)
                 ↓ IPC (HTTP なし、ポートなし)
             Electron main.js (Node.js)
              ├── ffmpeg.exe → 音声変換
              ├── whisper-cli.exe → 音声認識
              ├── https.get → モデルダウンロード
              └── fs.writeFile → 文字起こし出力