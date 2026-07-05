# Recorder — オフライン AI 会議記録ツール

[![GitHub release](https://img.shields.io/github/v/release/ghumphery/recorder)](https://github.com/ghumphery/recorder/releases)
[![GitHub](https://img.shields.io/github/license/ghumphery/recorder)](https://github.com/ghumphery/recorder)

> 🌐 **言語 / Language / 語言**: [繁體中文](readme.md) | [English](readme_en.md) | [日本語](readme_ja.md)

## 📝 機能概要

Recorder は完全**オフライン**の AI 会議記録ツールです：

- 📂 **音声インポート** — WAV / MP3 / Opus / OGG / FLAC / M4A 対応 (ffmpeg)
- 🤖 **音声認識** — whisper.cpp CLI（CPU / Vulkan GPU アクセラレーション対応、デフォルト small モデル）
- 🎙️ **録音モード** — マイク録音 / ミックス録音（システム音声 + マイク）ラジオ選択
- ✨ **LLM 後処理** — 文章最適化、多言語翻訳（中文/English/日本語）、要約（Ollama ローカル/クラウド、OpenRouter、SiliconFlow、Gemini）
- 🔑 **独立 API Key** — AI プロバイダーごとに個別の API Key を保存
- 🎮 **GPU 制御** — Vulkan GPU アクセラレーションの有効/無効、GPU デバイス選択
- ▶️ **音声再生** — 文字起こしの文をクリックして対応する音声を再生
- 🗑️ **削除管理** — 録音記録と音声ファイルの削除
- 📄 **文字起こし出力** — 録音記録管理インターフェースからエクスポート、プレーンテキスト (.txt) または Markdown (.md) 形式
- 📦 **モデル管理** — 設定パネルで Whisper モデルを管理（ダウンロード/削除）
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

[GitHub Releases](https://github.com/ghumphery/recorder/releases) から最新の `Recorder-1.21.4-portable.exe` をダウンロード。

### ソースからビルド

```bash
cd frontend
npm run electron:build
# 出力: frontend/dist-electron-build5/Recorder-1.21.4-portable.exe
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

### v1.22.1 (2026-07-02) — ResNet-SE が自動ダウンロード可能に（WeSpeaker 公式 ONNX）
- **v1.22.0 の制限を修正**：これまで `resnet_se` の `url` は空で（公開ミラーが 401/404 を返す）、手動インポートが必要でした。今回は **WeSpeaker 公式 HuggingFace ミラー**を追加し、URL を補完しました。
- **採用モデル**：`Wespeaker/wespeaker-cnceleb-resnet34-LM`（中国語 CN-Celeb でトレーニング）
  - サイズ 26.5 MB；256-dim embedding；80-dim fbank @ 16kHz
  - ライセンス：CC-BY-4.0
  - **input/output テンソル名が campplus と完全一致**（`feats` / `embs`）、既存の voiceprint.js fbank パイプラインと直接互換
  - ダウンロード URL：`https://huggingface.co/Wespeaker/wespeaker-cnceleb-resnet34-LM/resolve/main/cnceleb_resnet34_LM.onnx`
- **上級者向けオプション**（引き続き手動インポート）：`Wespeaker/wespeaker-voxceleb-resnet293-LM` 大モデル（114 MB, 256-dim）
- **UI 変更**：なし — 既存の「声紋モデル管理」セクションのダウンロードボタンが resnet_se に対して直接動作するようになりました
- **使い方**：設定パネル → 声紋モデル管理 → resnet_se を探す →「ダウンロード」をクリックして 26.5 MB ONNX を取得

### v1.22.0 (2026-07-02) — 複数モデル Speaker Embedding アーキテクチャ（camplus / ECAPA-TDNN / ResNet-SE）
- **新アーキテクチャ**：`voiceprint.js` を `MODEL_REGISTRY` ファクトリパターンにリファクタし、複数の ONNX speaker embedding モデルを並列管理できるようになりました。
- **対応モデル**（新しい `voiceprint.*` i18n キー）：
  - 🏆 **camplus**（デフォルト）：192-dim x-vector、中国語に親和性が高い、自動ダウンロード対応
  - **ECAPA-TDNN**：192-dim、手動 ONNX インポートのみ
  - **ResNet-SE**：512-dim、手動 ONNX インポートのみ
- **UI 追加**：設定パネルに「👥 声紋モデル管理」セクションを追加。モデル一覧・ステータス・ダウンロード/インポート/デフォルト設定ボタンを表示。
- **IPC 追加**：`voiceprint:listModels`、`voiceprint:importModel`、`voiceprint:setActiveModel`、`voiceprint:openImportDialog`、`voiceprint:getCurrentModel`。
- **自動モデル切替**：`loadModel()` は古いセッションを解放してから新しいモデルを読み込みます。バックエンドは `modelKey` で `diarize` / `propagate` をルーティングします。
- **使用上の注意**：公開 ONNX ミラーが 401/404 を返すため、自動ダウンロードできるのは camplus のみです。他のモデルを使用するにはスキーマに一致する ONNX ファイルを手動でインポートする必要があります。

### v1.21.4 (2026-07-01) — 複数 seed centroid 計算を強化（trimmed mean + 外れ値除外）

**ユーザーの質問に対応：「短い文章で話者識別ができない場合、同じ文章を重複コピーして話者識別精度を向上させることはできますか？」**

- **変更点**：`propagateSpeakers()` を **trimmed mean centroid** アルゴリズムに変更（≥3 個の seed 時）：
  1. 各 seed と他の seed の平均コサイン類似度を「内部一貫性」として計算
  2. 一貫性でソートし、上下各 ⌊n/4⌋ 個の外れ値（最大各 1 個）を除外
  3. 残った seed の平均を centroid として使用
  4. `centroidInfo.{seedCount, usedCount, droppedCount, internalCoherence}` を保持し UI で表示
- **解決した問題**：
  - ✅ **同じ文章の重複 seed** が centroid を偏らせる → trimmed mean が自然に極端値の重みを下げる
  - ✅ **無関係な文章**（背景音/咳/タイピング音）が centroid を偏らせる → 外れ値除外で直接排除
- **使用推奨**：
  - 3〜5 個の **発音内容が明確に異なる** 文章がスイートスポット
  - 10+ 個の seed は逓減する
  - ≤2 個の seed は自動的に simple mean にフォールバック（過剰トリミング防止）
  - `centroidInfo.internalCoherence` を観察：> 0.7 は seed の一貫性高、< 0.5 は seed を選び直す

### v1.21.3 (2026-06-30) — 文字起こしの話者タグに声紋類似度を表示

- `diarizeAudio()` と `propagateSpeakers()` の結果に `score`（コサイン類似度 0〜1）を追加
- App.vue の話者タグに `[話者] [スコア]`（例「山田 85」= 85% 類似）と表示

### v1.21.2 (2026-06-30) — 話者タグ編集後の「音声なし」状態を修正

- `saveRecordingMeta()` は `currentAudioPath` が空のとき、前の metadata から `audioPath` を読み込んで保持
- `reviewRecording()` は `currentAudioPath` を `null` に強制せず、`r.meta.audioPath` を読み込んで `loadAudioUrl` を自動呼び出し

### v1.21.1 (2026-06-30) — 話者編集/クリア毎に新しい metadata ファイルが作成される問題を修正

- `saveRecordingMeta()` は新しい ID を生成せず、既存の `currentRecordingId` を再利用
- 新 `_scheduleSaveRecordingMeta()` 500ms debounce ヘルパーを追加
- `setSegmentSpeaker()` / `doPropagateSpeakers()` / `clearAllSpeakers()` の 3 箇所で debounced save を使用

### v1.21.0 (2026-06-30) — 半教師あり話者伝播（手動ラベル → 全文章を推論）

- 新「🪄 ラベルから全文章を推論」ボタン（紫 #7B1FA2）で半教師あり話者ラベリング
- 文字起こしリストの各セグメントに「+👤」ボタンを追加 → Speaker Editor Modal で話者名を入力
- 推論パネルに全 seed を表示、閾値スライダー 0.30〜0.80、seed 単体削除、全ラベルクリア
- 短い文章（< 1.5s）が教師なしクラスタリングで区別できない問題を解決

### v1.20.12 (2026-06-30) — 文字起こし job log に音声長チェックと分割判定を追加

- **問題**：「文字起こし」の job log で音声長の確認や分割判定が表示されず、分割後の動作（「N 個の chunks に分割済み」「chunk N/M 認識中…」）しか見えず、どの経路を選択したか追跡できなかった。
- **修正**：`WhisperJobManager._executeTranscribe()` に判定チェーン用 log を 4 件追加：
  1. 常に出力：`音檔時長檢查: Xs (門檻 3600s，設定 chunkMinutes=Z)`
  2. 「分割しない」分岐：`決策: 不切片 (設定で分割しない / 音声長取得不可 / 音声長 < 閾値 / その他)`
  3. `進入直接辨識路徑 (runWhisper)`
  4. catch ブロック：`已切換為直接辨識路徑 (runWhisper)`
- **効果**：job log モーダルで「音声長チェック → 分割する／しない → どの経路か」の判定チェーンが完全に表示されるようになった。既存の分割成功パス log は不変。

### v1.20.11 (2026-06-30) — 声紋モデルダウンロード hotfix

**「ダウンロード不完全(受信 28283928 bytes のみ)」の繰り返し失敗を修正**:

- **問題**: v1.20.7 で `MIN_MODEL_SIZE` を 40 MB に設定したが、実モデルは ~27 MB(毎回同じ 28,283,928 bytes)しかないため、サイズ検証が常に「不完全」として reject していた。
- **根本原因**: `MIN_MODEL_SIZE` の見積もりが誤っていた。HF LFS UI は「~50 MB」と表示されるが、これは repo metadata + LFS pointer の合計。実 .onnx binary = 28,283,928 bytes、先頭 16 bytes (`08 08 12 07 pytorch`) は正規 ONNX protobuf magic。
- **修正**: `MIN_MODEL_SIZE` を 40 MB から 25 MB に引き下げ(~7% のバッファで truncate / HTML エラーは引き続き reject)。`isModelCached()` と `diarizeAudio()` のモデルロード検査は同じ定数を共有。
- **手動回避策**: ダウンロードが失敗する場合は `https://huggingface.co/welcomyou/campplus-3dspeaker-200k-onnx/resolve/main/campplus_cn_en_common_200k.onnx` を手動ダウンロード→`campplus_cn_en_common_200k.onnx` にリネーム→`~/recoder/voiceprint/` に配置。

### v1.20.10 (2026-06-30) — チャンク境界を跨ぐセグメント修正

- v1.20.9 でチャンク境界を跨ぐセグメント(例: 2900~3100 で chunk0/chunk1 を跨ぐ)が [2900, 3000) のみ読み込み [3000, 3100) をサイレントに落としていたバグを修正。
- 新 `findChunksForSegment()` で跨がる全チャンクを列挙、subPcm を `Buffer.concat()` で連結。

### v1.20.9 (2026-06-30) — audioChunker 共有モジュール

- 新 `frontend/electron/audioChunker.js`(getAudioDuration / splitLongAudio / chunkLongAudioIfNeeded / cleanupStaleChunks)を whisper と voiceprint で共有。
- WhisperJobManager に長時間音声チャンク処理を統合、設定パネルに「長音ファイル分割」セレクタ(オフ / 30 / 40 / 50 / 60 分、デフォルト 50)を追加。
- 起動時に `os.tmpdir()/recoder-chunks-*` と `voiceprint-chunk-*` の残留を自動削除。

### v1.20.8 (2026-06-30) — UI ステータスバー & オプティミスティック Jobs

- 再生中のステータスバーが実際のファイル名を表示(以前は常に音声ファイルリストの最初の 1 件を表示していた)。
- 5 つのジョブ作成ポイントで `pending` ジョブを対応するリスト(transcribeJobList / voiceprintJobList / jobList)に即挿入、ボタン押下直後に停止可能。

### v1.20.7 (2026-06-30) — 声紋ラベリング三項目修正

- **再ダウンロード回避**：声紋モデルが既にキャッシュ済み (≥25MB) の場合、`downloadModel()` を呼び出しても HTTPS リクエストを発行せず `progressCallback(100)` を直接返す
- **長音ファイルの分割**：60 分以上の音声ファイルは話者ラベリング前に 50 分以下の WAV チャンクへ自動分割し、OOM / タイムアウトを防止
- **クラスタリング耐性**：短すぎる (<1.5s) セグメントは ±0.5s パディング、embedding の `numFrames` 閾値を `<5` から `<3` に緩和、クラスタリングは 2 段階方式（隣接スライディングウィンドウマージ + グローバル重心コサインマージ）に変更し、小女孩などの高音も `Speaker_1` への集約ではなく別話者として分離

### v1.19.0 (2026-06-29) — WhisperJobManager 非同期機構

**メジャーアーキテクチャアップグレード**：音声テキスト変換を同期 IPC からバックグラウンド非同期処理に変更。

- **WhisperJobManager クラス**（バックエンド）：`jobQueue` / `activeJob` / `jobHistory` の 3 段状態管理
- **Fire-and-forget モード**：`startTranscribe()` は即座に `jobId` を返却、UI は IPC でブロックされない
- **同ファイル in-flight 防止**：同じ音声ファイルの重複トリガーを防止
- **イベントプッシュ（`transcribe:event`）**：running / completed / failed / cancelled をフロントエンドに通知
- **`~/.recoder/jobs.json` への永続化**：最新 50 件のジョブ記録
- **App 終了時の `cancelAll()`**：全 in-flight ジョブを統一キャンセル、ゾンビプロセスを防止
- **マルチタスク対応**：複数音声ファイルをキューに入れて順次バックグラウンド実行
- **UI ブロックなし**：105 分の音声転写中でも検索・履歴閲覧・他録音の編集が同時に可能

### v1.18.0 (2026-06-29) — 5 beams 修正 + 進捗推定

- **whisper-cli greedy デコード（`-bs 1 -bo 1`）**：デフォルトのビームサーチを削除、CPU モードで 3~5 倍高速化
- **進捗推定フォールバック**：whisper がまだタイムスタンプを出力していない場合、`elapsed/total_duration` で進捗を推定（v1.17.4 の進捗 0% 詰まりバグを修正）
- **録音セグメントデフォルトを 30 分に変更**：「セグメントなし」オプションを削除、「60 分」オプションを追加
- **設定パネル最適化**：セグメントオプションを 5/10/15/30/60 分に調整
- **i18n 3 言語**：`settings.min60` 翻訳キーを追加

- **v1.15.0** — アプリケーションアイコンを交換：左上隅のウィンドウアイコンとメイン .exe アイコンをマイクアイコンに更新；PIL でマルチサイズ .ico（16/24/32/48/64/96/128/256）と 256x256 PNG を生成；`BrowserWindow` に `icon` プロパティを追加；`index.html` にファビコンを追加
- **v1.14.3** — LLM 文書管理パネルを追加：元の文字起こしから生成された文書（最適化/翻訳/要約）を一覧表示/レビュー/削除可能、生成時間で区別；翻訳は任意の文書（元/最適化/要約）に対応；Job パネルを開くときに自動更新
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

## v1.23.0 — 教師あり Speaker Recognition + Profile Database

### 新機能
- **👤 Speaker Profile Database**（~/recoder/speaker_profiles.json に永続化）：よく使う話者ごとに独立した profile を作成し、録音を跨いで再利用。
- **🎯 教師あり Speaker Identification**：確立された全 profile に対して各 segment の cosine 類似度で照合。
- **🔄 一括バックフィル**：新規 profile 作成後、ワンクリックで全履歴録音に適用。
- **📂 短音声ファイルから Profile 作成**：同じフレーズを繰り返す短音声で迅速に声紋ライブラリを構築。
- **マルチモデル対応**：camplus (192-d)、ecapa_tdnn (192-d)、resnet_se (256-d) はそれぞれ独立 profile を保存、次元混在を防止。

### ワークフロー
1. **👤 Create Profile** をクリックして Speaker Database パネルを開く。
2. 転写結果で同一話者の 2-3 segment をマーク → **💾 Build from Labels** で現録音から構築、または **📂 Build from Audio File** で短音声から構築。
3. 対象録音を切替 → **🎯 Identify Speakers (Supervised)** をクリックして一括識別。
4. 新規 profile 作成後、**🔄 Apply to All History** をクリックして全履歴録音を一括バックフィル。

### v1.21.0 半教師ありとの違い
| 項目 | v1.21.0 半教師あり | v1.23.0 教師あり |
|------|---------------------|-------------------|
| 学習データ | 同一録音内の seed segment | 録音を跨いだ累積 profile |
| 短文認識 | 弱 | 強（累積効果） |
| 録音跨ぎ検索 | 非対応 | 対応（searchBySpeaker） |
| 永続化 | なし | あり（speaker_profiles.json） |
