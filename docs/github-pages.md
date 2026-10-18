# GitHub Pages への公開

GitHub Pages は HTML/CSS/JavaScript 用の静的ホスティングです。Python サーバー、SQLite、Tesseract、Drive 認証、OpenAI API の処理は Pages 上では実行できません。

このアプリはサーバー版を残し、Pages でも **同梱問題集を自動で読み込んで練習**します。初期表示ではサーバー版と同じ `static/wine_quiz_master_set_01.json` を取得し、「すべて」の範囲で練習を開始します。問題への回答や手動で読み込んだ内容は現在のタブのメモリに保持し、外部サービスに送信しません。再読み込みすると回答状況と手動読み込みは消え、同梱問題集を再取得します。同梱データの検証記録は、原画像との照合や人による承認が済んだ証拠とは扱いません。

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

`dist-pages/` に公開成果物を作ります。許可した `index.html`、`static/` のフロントエンドファイル、`static/wine_quiz_master_set_01.json` だけをコピーし、実行モードを `pages` に固定します。JSON は公開対象をこの1ファイルに限定しており、`static/` 内のほかの JSON は自動では含みません。ワークフローはこのディレクトリだけをアップロードします。

`.env`、Google 認証、原本写真、OCR、SQLite、個別に生成した問題、確認用スクリーンショット、`data/`、Python ソースを公開成果物に含めません。同梱 JSON がない場合はビルドを失敗させ、空の問題集に置き換えません。ビルド失敗時には直前の完成済み成果物を保持します。シンボリックリンクを通じて別ファイルを公開することも拒否します。

**元データの確認待ち:** この変更の検証時点では、Issue #1 の元ファイルは提供されていません。`static/wine_quiz_master_set_01.json` に元データを改変せず追加するまで Pages ビルドは失敗します。実際の30問の内容・国別件数は未検証です。合成テストデータを公開用問題集として追加しません。

## 出題範囲

「すべて」は全問題を ID ごとに1回だけ出します。「国別」は国を1つ選択し、`countries.includes(選択国)` を満たす問題だけを出します。選択した範囲の件数を表示し、開始時に回答・得点・進捗をリセットします。「もう一巡」は同じ範囲を再シャッフルし、一巡中の重複を防ぎます。選択肢もシャッフルし、元データが指定する正解を ID で維持します。

要求値は、すべて30問、フランス8問、スペイン5問、イタリア4問、日本・アメリカ・オーストラリア・ポルトガル・オーストリア各2問、ニュージーランド・アルゼンチン・南アフリカ・チリ各1問です。`WQM-PILOT-0027` はフランスとスペインの両方の `countries` に属し、両国の範囲に含まれます。「すべて」では1問なので、国別件数の合計31問とは一致しません。

初期ファイルの取得や検証に失敗した場合は、対象ファイル名と理由を表示し、出題を停止します。未知の形式、不正な正解 ID、重複 ID などは問題集全体を拒否します。

## 別の問題集を手動で読み込む

サーバー版と Pages のどちらでも、練習画面の「別の問題集 JSON」で標準形式のファイルまたは従来の `version: 1` 形式を読み込めます。「標準問題集に戻す」は手動ファイルを取り除き、同梱問題集を再取得して進捗をリセットします。

サーバーで生成・承認した問題を練習する手順は次のとおりです。承認しても同梱問題集には自動追加されません。

1. サーバー版で写真を取り込み、黄色部分を照合して生成問題を承認します。
2. サーバーの実行環境で次のコマンドを実行します。

```sh
.venv/bin/python scripts/export_questions.py
```

3. `data/exports/questions.json` を手元の端末へ保存し、サーバー版または Pages の **別の問題集 JSON** で選択します。この JSON を Git に追加する必要はありません。

最新の写真版に対応する承認済み問題だけをエクスポートします。三択と正解ID、解説、写真ファイル名、黄色部分の引用を保持します。読み込み上限は2 MB・2,000問です。不正な問題集は全体を拒否し、すでに読み込んだ問題と回答状況を保持します。

従来形式に国情報がない場合は「すべて」で練習します。ファイルの選択に失敗したり、不正な内容だったりした場合は、直前に読み込んだ問題集名・問題・回答状況を保持してエラーを表示します。Pages には原本写真を送らないため、画像・黄色マスクとの照合と承認はサーバー版で行います。従来の写真取り込みで保存されている実資料は要確認で、同梱問題集とは別です。

## 公開前の確認

次のテストで Python 46件、JavaScript 42件（問題集・出題ロジック22件、サーバー版・Pages の画面操作20件）が成功しています。画面操作は Node.js 上の合成 DOM による検証で、実ブラウザによる表示検証とは別です。

```sh
.venv/bin/python -m unittest discover -s tests -v
node --test tests/*.mjs
# 元ファイル配置後に実行。元ファイルがない場合は明示的に失敗します。
node scripts/verify_standard_pack.mjs
```

テストでは合成データで、読み込み、国別の絞り込み、共有問題の扱い、回答固定、一巡、採点、再開、不正ファイル時の状態保持、公開許可ファイルだけの同梱を確認しています。元ファイルの提供後に、実データの30問・全ての国別件数・`WQM-PILOT-0027` の両国への所属を確認し、`/wine-quiz-master/` 配下の公開成果物でも初期読み込みを検証してください。合成テストの成功を実データ確認の代わりにはしません。

Chromium では、合成問題4問を含む一時成果物を `/wine-quiz-master/` 配下で配信し、両モードの1440px・360pxで国別出題、採点、一巡後の再開、複数出典を確認しました。JavaScript エラーと横方向のはみ出しは0件、Pages の API 通信も0件でした。合成問題とスクリーンショットは公開成果物や Git には追加していません。

## 公式資料

- [GitHub Pages の静的ホスティング仕様](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- [GitHub Actions を公開元に指定する手順](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [configure-pages の初回有効化に必要な権限](https://github.com/actions/configure-pages/blob/v5/action.yml)
