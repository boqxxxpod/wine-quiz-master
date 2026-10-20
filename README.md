# ワインの手帖

黄色のマーカー部分を根拠にした、日本語のワイン検定練習アプリです。FastAPI・SQLite・素のJavaScriptで構成し、出題・採点・解説表示は保存済みデータだけで動作します。

サーバー版とGitHub Pagesは、標準問題集 [wine-quiz-highlighted.json](question-packs/wine-quiz-highlighted.json)（653問）を初期画面で読み込みます。既存500問を保持して153問を追加しました。元の864項目のうち801項目を問題・解説に対応付け、39項目は安定した関連特徴のみ扱い、24項目は要確認・資料不足として保留しています。完全に864項目すべてを出題したという意味ではありません。[ID別対応表](question-packs/coverage.json) と [検証レポート](question-packs/highlighted-validation-report.md) に未解決の範囲を記録しています。

## 問題集・範囲・出題数

初期画面で問題集と「すべて／国別」を選び、出題数を**5・10・20・30・50・70・100・全問**から指定します。初期値は全問です。対象範囲の問題数を超える固定値は選べず、国を変更して指定数が超過した場合は全問に戻ります。対象が0問や読み込み中なら開始できません。

開始すると対象範囲から指定数をランダムに抽出し、問題と選択肢をシャッフルします。一巡中に重複は出ず、選択肢のIDで採点します。「同じ設定でもう一巡」は同じ範囲・出題数で再抽出し、得点・進捗をリセットします。「設定に戻る」で条件を変更できます。練習中にOpenAI APIは呼びません。

国別件数は、実際に読み込んだ問題の `countries` 配列を集計します。

| 範囲 | 件数 |
| --- | ---: |
| すべて | 653 |
| フランス | 198 |
| スペイン | 76 |
| イタリア | 94 |
| 日本 | 59 |
| アメリカ | 44 |
| オーストラリア | 46 |
| ポルトガル | 42 |
| オーストリア | 23 |
| ニュージーランド | 17 |
| アルゼンチン | 20 |
| 南アフリカ | 21 |
| チリ | 17 |

複数国に属する問題は国別では各国に一回ずつ含み、全問では一問として数えます。国別合計は657、統合版は653問です。画面のファイル名・全問数・国別件数を同じデータから表示します。Pagesでは読み込みモジュールにも内容に応じた版番号を付け、過去の150問用の処理が残るキャッシュ混在を防ぎます。

同梱ファイルの取得や検証に失敗した場合はファイル名と理由を表示して開始を止めます。手動で不正なJSONを選んだ場合は直前の問題集と設定・回答状況を保持します。別の問題集はこのタブだけで使用し、送信しません。「標準問題集に戻す」または再読み込みで653問の同梱版に戻ります。pilot形式、従来のネイティブ形式、承認済み書き出しの `version: 1` 形式に対応しています。

新しい解説は【要点】【解説】【整理】の3段構成です。全653問は `auto_checked` で、人による最終確認前の試験運用データです。回答後に元データの知識ID・ページ・検証状態を表示します。機械検証は原画像との全件照合や、人による内容の承認を保証しません。

既存の `wine-quiz-500.json`、`pilot-150.json` とその分割ファイルは変更せず残します。現在の確認用分割版は [highlighted-batches](question-packs/highlighted-batches/) の14ファイル（50問×13、3問×1）です。結合すると統合版の `questions` と完全一致します。公開成果物には標準の統合JSON一件だけを含めます。[問題集の説明](question-packs/README.md)、[公開手順](docs/github-pages.md) も参照してください。

## 起動

Python 3.11 以降、Node.js 22 以降（テスト用）、Tesseract の日本語辞書が必要です。

```sh
cd /workspace/wine-quiz-master
python -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
# Ubuntu / Debian で OCR を用意する場合
sudo apt-get install tesseract-ocr tesseract-ocr-jpn
cp .env.example .env
# .env にサーバー側設定を記入
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --env-file .env
```

ブラウザで `http://127.0.0.1:8000` を開きます。`--env-file` を使うには `python-dotenv` が必要です（requirements に含まれます）。`.env` を使わず OS の環境変数で設定することもできます。日本語辞書を別ディレクトリに置く場合は、`TESSDATA_PREFIX` にそのディレクトリの絶対パスを設定します。`tesseract --list-langs` に `jpn` があることを確認してください。

個人用にループバックで起動する構成です。インターネットへの公開・複数利用者での共有には認証と利用者ごとのデータ分離を別途用意してください。`ALLOWED_HOSTS` を広げるだけでは認証になりません。

## Google ドライブの接続

ChatGPT の Google Drive 接続と、このアプリのサーバー認証は別です。チャットで資料を読めてもアプリの継続同期には次の設定が必要です。

1. Google Cloud プロジェクトで **Google Drive API** を有効にします。
2. サービスアカウントを作成し、JSON 認証ファイルを公開フォルダ・Git の外に保存します。
3. `GOOGLE_APPLICATION_CREDENTIALS` に JSON の絶対パスを設定します。
4. 対象の「ワイン検定」フォルダを、サービスアカウントのメールアドレスへ **閲覧者** として共有します。
5. アプリを再起動し、管理APIの `POST /api/folders` に `{"folder_id":"対象ID"}` を送りフォルダを確認します。同名が複数あれば ID で明示的に選択します。ID は Drive のフォルダ URL の `folders/` に続く文字列です。
6. `POST /api/sync` に同じJSONを送り写真を保存し、`POST /api/process` に `{}` を送って読み取り・生成します。

画面は練習専用です。写真の取り込み・問題の承認はサーバー管理APIとして残していますが、画面からの導線はありません。POSTは `Content-Type: application/json` が必要です。状態は `GET /api/status`、資料一覧・詳細は `GET /api/sources`・`GET /api/sources/{source_id}` で確認できます。

個人の OAuth を使う場合は、`https://www.googleapis.com/auth/drive.readonly` スコープとオフラインアクセスで取得した `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`GOOGLE_REFRESH_TOKEN` をサーバー側に設定します。サービスアカウントを使う場合、これらの OAuth 設定は不要です。認証値をチャット・ブラウザの入力欄・JavaScript に記載しないでください。

403 は API の有効化・読み取りスコープ・フォルダ共有を、404 はフォルダ ID と閲覧権限を確認します。フォルダ直下の写真が対象です。サブフォルダは自動巡回しません。写真は1枚20 MiB、5,000万画素までです。

## luna の設定

正式な API モデル ID は **`gpt-6-luna`** です。画像入力・Structured Outputs・Responses API への対応は [OpenAI 公式モデル仕様](https://developers.openai.com/api/docs/models/gpt-6-luna)で確認しています（2026-10-18）。`luna` という短縮名や別モデルは送信しません。

```dotenv
OPENAI_API_KEY=サーバー側のAPIキー
OPENAI_MODEL=gpt-6-luna
```

設定後に再起動し、管理APIの `POST /api/check-model` に `{}` を送ってください。`GET /v1/models/gpt-6-luna` の成功と ID の完全一致を確認します。この確認は画像生成・推論のテストではありません。実際の画像入力・課金枠・Responses API の利用可否は取り込み時の応答でも検査します。未設定、権限不足、モデル不一致、利用枠不足、通信・画像入力・出力形式のエラーでは API 処理を停止し、別モデルに切り替えません。

問題は取り込み時だけ、黄色の切り抜き・マスク・必要な OCR テキストを小さなバッチにまとめて生成します。原本全体は OpenAI に送信しません。出力トークンを制限し、API の自動再試行はしません。保存済みの同じ版の写真は再生成しません。

## 資料の確認と練習

黄色候補はローカルで検出し、元写真の座標・切り抜き・黄色マスク・OCR 結果を保存します。黄色の葉・写真などを含め、境界や文字が曖昧なものは「要確認」にします。日本語 OCR が未設定の場合も推測で補いません。画像入力モデルにも照合させ、読み取れない数値・名称を補わないようにしています。

生成問題はまず「承認待ち」になります。管理APIの資料詳細と `GET /api/images/{source_id}`（切り抜き・マスクは `?region=領域ID&kind=crop` または `kind=mask`）で黄色部分・引用・唯一の正解を照合し、`POST /api/questions/{question_id}/review` に `{"approved":true}` を送って承認します。`scripts/export_questions.py` で JSON に書き出し、初期画面の「別の問題集 JSON」で選ぶと練習に使えます。承認した問題が標準の出題元に自動追加されることはありません。三択・選択肢の重複・正解 ID が1つ・引用が抽出テキストに含まれることを保存時と承認時に検査します。意味の正確さは構造検査だけでは保証できないため、この確認を出題前に置いています。

問題と選択肢はそれぞれシャッフルし、正解は選択肢 ID で判定します。一巡までは同じ問題を出さず、回答後の変更を防ぎ、最後まで解いたら再シャッフルできます。利用可能な問題が0件なら実際の理由と次の設定を表示します。デモ問題は通常の問題データに含めません。

## 保存・差分処理

`DATA_DIR`（既定 `data/`）に SQLite、原本、抽出画像を保存します。ファイル ID と MD5・更新日時・サイズから版を判定し、新規・変更された写真だけ処理します。写真の変更・削除・フォルダ切り替えを確認した時点で旧問題を無効にします。同期に失敗した場合は、既存資料を削除せず同期エラーを表示します。データのバックアップはサーバー停止中に `DATA_DIR` 全体をコピーしてください。

`.env`、認証 JSON、`data/`、`.venv/` は Git 管理外です。資料の原本・OCR・生成結果も Git に含めません。秘密値は API のステータスやエラーに返しません。

チャットの Drive コネクタで取得した原本を引き継ぐ場合は、ローカル管理用の `scripts/import_manifest.py` も使えます。manifest は `file_id`、`file_name`、`path`、`mime_type`、`modified_time`、`folder_id` を含む配列です。これは認証を代替する機能ではなく、取得済み原本のインポート専用です。

```sh
.venv/bin/python scripts/import_manifest.py data/imports/manifest.json
```

## 検証

```sh
python -m unittest discover -s tests -v
node --test tests/*.mjs
node scripts/verify_standard_pack.mjs
python scripts/build_pages.py
```

2026-10-20の[GitHub Actions CI](https://github.com/boqxxxpod/wine-quiz-master/actions/runs/39374246122)（コード・データのコミット `c1cfb30cd7314173feb078a329d40c5c8fcda971`）で、Python 50件、Node.js 68件が成功しました。全件データ検証とPagesビルドも成功しています。 PRの `Validate quiz and application` で継続的に検証します。新しい画面テストは8つの出題数での一巡と再開、国別件数が選択数より少なくなる場合、読み込み失敗と手動インポートの保持を含みます。

今回の実ブラウザでの再検証は行っていません。自動テストの合成DOMと出題処理で確認します。過去の実ブラウザ確認と未完了事項は [確認記録](docs/verification.md)、内容の保留や既存問題の制約は [検証レポート](question-packs/highlighted-validation-report.md) に記録しています。
