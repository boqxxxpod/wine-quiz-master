# ワインの手帖

日本語のワイン検定練習アプリです。FastAPI・SQLite・素のJavaScriptで構成し、出題・採点・解説表示は同梱データだけで動作します。

サーバー版とGitHub Pagesの開始画面で、**練習問題（230問・13か国）／教科書問題（662問・12か国）**を選べます。どちらもJSONファイル本体をアプリに同梱しており、Google Driveへの接続やファイルの手動読み込みは不要です。初期選択は従来どおり教科書問題です。

| 選択肢 | 同梱ファイル |
| --- | --- |
| 練習問題 | [wine-quiz-practice-20261031.json](question-packs/wine-quiz-practice-20261031.json) |
| 教科書問題 | [wine-quiz-highlighted.json](question-packs/wine-quiz-highlighted.json) |

教科書問題は、黄色マーカーに対応する従来653問を全フィールド・順序ごと保持し、原画像と公的な過去統計で根拠を確認できた9問を追加したものです。残っていた63項目のうち15項目を問題・解説で補完しています。

教科書の元知識864項目のうち、問題・解説で対応するのは816項目、関連特徴だけを扱うものは35項目、出題保留は13項目です。**未解決は48項目で、完全網羅ではありません。** 816項目は独立した問題数とも異なります。[ID別対応表](question-packs/coverage.json)、[検証レポート](question-packs/highlighted-validation-report.md)、[48項目の確認事項と必要な資料](question-packs/remaining-review-report.md) を参照してください。

## 問題集・範囲・出題数

出題数は**5・10・20・30・50・70・100・全問**から選びます。初期値は全問です。範囲は「すべて／国別」で、選択中の問題集から国と件数を表示します。問題集を切り替えると回答・得点・進捗を消し、範囲は「すべて」、出題数は「全問」に戻します。対象の問題数を超える固定値は選べません。範囲変更で指定数を超えた場合は全問へ戻り、読み込み中や0問では開始できません。

問題と選択肢をシャッフルして指定数を抽出し、一巡中は同じ問題を繰り返しません。回答後に解説・知識ID・出典位置・検証状態を表示します。選択したファイルの取得や検証に失敗すると、そのファイル名と理由を表示して出題を停止し、再読み込みできます。別JSONの手動読み込みにも対応し、不正な手動JSONでは直前の状態を保持します。手動ファイルを使用中は組み込み問題集の選択を解除し、「練習問題／教科書問題に戻す」で直前の組み込み問題集に戻れます。ページを再読み込みすると初期選択の教科書問題に戻ります。

| 範囲 | 練習問題 | 教科書問題 |
| --- | ---: | ---: |
| すべて | 230 | 662 |
| アメリカ | 18 | 45 |
| アルゼンチン | 10 | 20 |
| イタリア | 27 | 94 |
| ポルトガル | 12 | 42 |
| 南アフリカ | 11 | 21 |
| スペイン | 22 | 76 |
| 日本 | 21 | 61 |
| オーストリア | 11 | 24 |
| フランス | 50 | 201 |
| ドイツ | 14 | — |
| チリ | 10 | 18 |
| オーストラリア | 15 | 47 |
| ニュージーランド | 9 | 17 |

国別は各問題の `countries` から集計します。教科書問題の複数国に属する問題は各国に数えるため、国別合計666、全問662です。画面の件数は読み込んだデータから表示し、Pagesの読み込みモジュール等の版番号も両方の同梱データを含む公開ファイルの内容から決まります。

両問題集とも全問 `auto_checked` で、人による最終承認前です。練習問題は元資料226設問を三択230問に整理し、年度不明の統計への注記や表現を修正した記録を保持しています。最新統計への更新や外部の事実確認が完了した扱いにはしません。

教科書の新規解説は【要点】【解説】【整理】の3段構成です。元の要確認項目のうち採用する7項目は、原画像で修正案を確認し、[再確認記録](question-packs/remaining-review.json) を残しました。統計は原文の対象年を推定せず、公的な過去資料で確認できた年・条件を明記して補っています。

既存150問・500問の統合ファイルと分割版は保持しています。現行の確認用 [highlighted-batches](question-packs/highlighted-batches/) は14ファイル（50問×13、12問×1）で、結合すると662問の統合版と完全一致します。公開サイトに配信する問題集は上記の練習問題・教科書問題のJSON二件です。[問題集の説明](question-packs/README.md)、[公開手順](docs/github-pages.md) も参照してください。

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

両問題集の読み込み・全件の出題と採点、国別件数、問題集の切り替えとリセット、読み込み失敗時の復旧、手動インポートの保持、サーバー配信とPagesへの同梱を自動検証します。PRの `Validate quiz and application` でも継続して実行します。

実行結果と実ブラウザでの確認は [確認記録](docs/verification.md)、教科書問題の内容の保留や既存問題の制約は [検証レポート](question-packs/highlighted-validation-report.md) に記録しています。
