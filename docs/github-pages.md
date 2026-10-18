# GitHub Pages への公開

GitHub Pages は HTML/CSS/JavaScript 用の静的ホスティングです。Python サーバー、SQLite、Tesseract、Drive 認証、OpenAI API の処理は Pages 上では実行できません。

このアプリはサーバー版を残し、Pages では **承認済み問題集をファイルで読み込んで練習**します。読み込んだ内容は現在のタブのメモリだけに保持し、サーバー・GitHub・OpenAI・Google に送信しません。再読み込みやタブを閉じると消えます。

## 初回設定

1. [対象リポジトリの Settings → Pages](https://github.com/boqxxxpod/wine-quiz-master/settings/pages) を開きます。
2. **Build and deployment → Source → GitHub Actions** を選択します。
3. [Deploy GitHub Pages ワークフロー](https://github.com/boqxxxpod/wine-quiz-master/actions/workflows/pages.yml) を実行します。失敗済みの実行があれば **Re-run all jobs** を選びます。
4. deploy ジョブが成功したら、実行結果の `github-pages` 環境に表示される URL を開きます。

リポジトリが非公開の場合、GitHub Pages を使える Pro/Team/Enterprise の契約が必要です。ソースの非公開設定と公開サイトの閲覧制限は別です。リポジトリを自動で公開に変更することはありません。

初回の Pages 有効化は Pages と Administration の書き込み権限が必要です。通常の `GITHUB_TOKEN` では初回有効化できません。以後は `main` への push でビルド・公開が実行されます。初回設定がない場合は configure-pages ステップで停止します。

## 公開するファイル

```sh
python scripts/build_pages.py
```

`dist-pages/` に公開成果物を作ります。許可した `index.html` と `static/` のフロントエンドファイルだけをコピーし、実行モードを `pages` に固定します。ワークフローはこのディレクトリだけをアップロードします。

`.env`、Google 認証、原本写真、OCR、SQLite、生成問題、確認用スクリーンショット、`data/`、Python ソースを公開成果物に含めません。公開版の初期問題数は0件です。サンプルを実資料として表示しません。

## 問題集の読み込み

1. サーバー版で写真を取り込み、黄色部分を照合して生成問題を承認します。
2. サーバーの実行環境で次のコマンドを実行します。

```sh
.venv/bin/python scripts/export_questions.py
```

3. `data/exports/questions.json` を手元の端末へ保存し、Pages の **問題集を読み込む** で選択します。この JSON を Git に追加する必要はありません。

最新の写真版に対応する承認済み問題だけをエクスポートします。三択と正解ID、解説、写真ファイル名、黄色部分の引用を保持します。読み込み上限は2 MB・2,000問です。不正な問題集は全体を拒否し、すでに読み込んだ問題と回答状況を保持します。

Pages には原本写真を送らないため、画像・黄色マスクとの照合と承認はサーバー版で行います。現在の実資料はすべて要確認なので、エクスポートすると0問になります。

## 公開前の確認

Python 44件、JavaScript 13件が成功しました。`/wine-quiz-master/` 配下で1440px・360pxの3画面を確認し、API通信・JavaScriptエラー・HTTPエラー・横方向のはみ出しは0件でした。検証用の一時ファイルで読み込み、回答固定、一巡、採点、再開、不正ファイル時の状態保持、消去、再読み込み時のメモリ消去を確認しています。検証問題は実データにも公開成果物にも保存していません。

## 公式資料

- [GitHub Pages の静的ホスティング仕様](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- [GitHub Actions を公開元に指定する手順](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [configure-pages の初回有効化に必要な権限](https://github.com/actions/configure-pages/blob/v5/action.yml)
