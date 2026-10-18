# ワインの手帖

黄色のマーカー部分を根拠にした、日本語のワイン検定練習アプリです。FastAPI・SQLite・素の JavaScript で構成しています。出題・採点・解説表示は保存済みデータだけで動作し、OpenAI API を呼びません。

GitHub Pages の静的公開と、承認済み問題集の読み込みにも対応しています。公開方法・サーバー版との違いは [GitHub Pages の手順](docs/github-pages.md) を参照してください。

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
5. アプリを再起動し、「接続・設定」でフォルダを確認します。同名が複数あれば ID で明示的に選択します。ID は Drive のフォルダ URL の `folders/` に続く文字列です。
6. 「写真を同期」で写真を保存し、「資料を読み取り・問題を生成」を実行します。

個人の OAuth を使う場合は、`https://www.googleapis.com/auth/drive.readonly` スコープとオフラインアクセスで取得した `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`GOOGLE_REFRESH_TOKEN` をサーバー側に設定します。サービスアカウントを使う場合、これらの OAuth 設定は不要です。認証値をチャット・ブラウザの入力欄・JavaScript に記載しないでください。

403 は API の有効化・読み取りスコープ・フォルダ共有を、404 はフォルダ ID と閲覧権限を確認します。フォルダ直下の写真が対象です。サブフォルダは自動巡回しません。写真は1枚20 MiB、5,000万画素までです。

## luna の設定

正式な API モデル ID は **`gpt-6-luna`** です。画像入力・Structured Outputs・Responses API への対応は [OpenAI 公式モデル仕様](https://developers.openai.com/api/docs/models/gpt-6-luna)で確認しています（2026-10-18）。`luna` という短縮名や別モデルは送信しません。

```dotenv
OPENAI_API_KEY=サーバー側のAPIキー
OPENAI_MODEL=gpt-6-luna
```

設定後に再起動し、「luna を確認」→「利用可否を確認」を実行してください。`GET /v1/models/gpt-6-luna` の成功と ID の完全一致を確認します。この確認は画像生成・推論のテストではありません。実際の画像入力・課金枠・Responses API の利用可否は取り込み時の応答でも検査します。未設定、権限不足、モデル不一致、利用枠不足、通信・画像入力・出力形式のエラーでは API 処理を停止し、別モデルに切り替えません。

問題は取り込み時だけ、黄色の切り抜き・マスク・必要な OCR テキストを小さなバッチにまとめて生成します。原本全体は OpenAI に送信しません。出力トークンを制限し、API の自動再試行はしません。保存済みの同じ版の写真は再生成しません。

## 資料の確認と練習

黄色候補はローカルで検出し、元写真の座標・切り抜き・黄色マスク・OCR 結果を保存します。黄色の葉・写真などを含め、境界や文字が曖昧なものは「要確認」にします。日本語 OCR が未設定の場合も推測で補いません。画像入力モデルにも照合させ、読み取れない数値・名称を補わないようにしています。

生成問題はまず「承認待ち」になります。「資料と問題」で黄色部分・引用・唯一の正解を照合し、承認すると練習に使えます。三択・選択肢の重複・正解 ID が1つ・引用が抽出テキストに含まれることを保存時と承認時に検査します。意味の正確さは構造検査だけでは保証できないため、この確認を出題前に置いています。

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
.venv/bin/python -m unittest discover -s tests -v
node --test tests/test_quiz.mjs
node --test tests/test_pages.mjs
```

テストの写真・問題・API 応答は検証用の合成データです。利用者の実資料から生成した問題として表示しません。実写真13枚での確認結果、ブラウザ検証、未完了の接続確認は [確認結果](docs/verification.md) を参照してください。
