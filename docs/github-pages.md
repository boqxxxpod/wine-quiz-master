# GitHub Pages への公開

GitHub Pages は HTML/CSS/JavaScript 用の静的ホスティングです。Python サーバー、SQLite、Tesseract、Drive 認証、OpenAI API の処理は Pages 上では実行できません。

このアプリはサーバー版を残し、Pages でも **同梱653問を自動で読み込み**ます。初期画面で `question-packs/wine-quiz-highlighted.json` を取得し、問題集・出題範囲・出題数を選んでから練習画面に進みます。初期値は「すべて」「全問」で、読み込んだだけでは出題を開始しません。サーバー版も同じファイルと練習専用の2画面UIを使用し、タブや資料・接続設定への導線はありません。問題への回答や手動で読み込んだ内容は現在のタブのメモリに保持し、外部サービスに送信しません。再読み込みすると回答状況と手動読み込みは消え、同梱問題集を再取得します。

653問は全て `auto_checked` の試験運用データで、人による最終確認前です。既存500問を保持し、153問を追加しています。元の864項目のうち801項目は問題または解説に対応し、39項目は関連特徴のみ扱い、24項目は保留です。全項目を完全網羅したという意味ではありません。対応先と理由は [知識ID別の対応表](../question-packs/coverage.json) に記録しています。構造・正答キーの機械検証は、誤答の意味上の一意性や原資料との照合・承認を保証しません。回答後は元データの `knowledge_id`・`source_page` を出典として表示します。

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

`dist-pages/` に公開成果物を作ります。許可した `index.html`、`static/` のフロントエンドファイル、`question-packs/wine-quiz-highlighted.json` だけをコピーし、実行モードを `pages` に固定します。JSON は元ファイルのバイト列を保ち、公開対象をこの1ファイルに限定します。旧500問版・旧150問版や確認用バッチ、対応表、検証レポートは含みません。ワークフローはこのディレクトリだけをアップロードします。サーバー版も `/question-packs/wine-quiz-highlighted.json` だけを公開し、問題集ディレクトリ全体は公開しません。

`.env`、Google 認証、原本写真、OCR、SQLite、個別に生成した問題、確認用スクリーンショット、`data/`、Python ソースを公開成果物に含めません。同梱 JSON がない場合はビルドを失敗させ、空の問題集に置き換えません。ビルド失敗時には直前の完成済み成果物を保持します。シンボリックリンクを通じて別ファイルを公開することも拒否します。

## 出題範囲

「すべて」は全問題を対象とし、「国別」は国を1つ選択して `countries.includes(選択国)` を満たす問題だけを対象にします。初期画面に対象件数を表示し、出題数は5・10・20・30・50・70・100・全問から選べます。範囲の件数を超える固定値は無効にします。範囲を変えて選択数が超過した場合は全問に戻します。開始時にも値を検証し、不正値や0問では開始できません。

開始時は対象から指定数をランダムに抽出し、回答・得点・進捗をリセットして練習画面に進みます。進捗・得点の分母・終了判定は指定数です。「もう一巡」は同じ範囲と出題数で再抽出・シャッフルし、一巡中の重複を防ぎます。選択肢もシャッフルし、元データが指定する正解を ID で維持します。「設定に戻る」で条件を変更して、新しい練習を開始できます。解説は省略せず表示し、結果の近くに次へ進むボタンを固定しています。

実際の問題を集計した件数は、すべて653問、アメリカ44問、アルゼンチン20問、イタリア94問、ポルトガル42問、南アフリカ21問、スペイン76問、日本59問、オーストリア23問、フランス198問、チリ17問、オーストラリア46問、ニュージーランド17問です。複数国に属する問題があるため国別の合計は657ですが、「すべて」では各IDを1問として数えます。画面の出題範囲と件数は読み込んだ問題の `countries` から決定します。既存150問の元メタデータは `metadata.original_metadata` に保持しています。

ビルドでは公開ファイルの内容から版番号を作り、HTMLの入口だけでなく、app.jsからpages.js・quiz.jsへのモジュール読み込みにも同じ版を付けます。問題集の取得URLにも版を伝え、JSONを再取得します。新しい画面に旧150問用のモジュールが混在して、件数が食い違う状態を防ぐためです。サーバー版の直接配信にも版付きモジュールを使います。

初期ファイルの取得や検証に失敗した場合は、対象ファイル名と理由を表示し、出題を停止します。未知の形式、不正な正解 ID、重複 ID などは問題集全体を拒否します。

## 別の問題集を手動で読み込む

サーバー版と Pages のどちらでも、初期画面の「別の問題集 JSON」で pilot 形式、従来のネイティブ30問形式、承認済み書き出しの `version: 1` 形式を読み込めます。「標準問題集に戻す」は手動ファイルを取り除き、同梱653問を再取得して進捗をリセットします。

サーバーで生成・承認した問題を練習する手順は次のとおりです。承認しても同梱問題集には自動追加されません。

1. サーバー管理APIで写真を取り込み、黄色部分を照合して生成問題を承認します（[管理APIの手順](../README.md#google-ドライブの接続)）。練習画面には取り込み・承認の操作はありません。
2. サーバーの実行環境で次のコマンドを実行します。

```sh
.venv/bin/python scripts/export_questions.py
```

3. `data/exports/questions.json` を手元の端末へ保存し、サーバー版または Pages の **別の問題集 JSON** で選択します。この JSON を Git に追加する必要はありません。

最新の写真版に対応する承認済み問題だけをエクスポートします。三択と正解ID、解説、写真ファイル名、黄色部分の引用を保持します。読み込み上限は2 MB・2,000問です。不正な問題集は全体を拒否し、すでに読み込んだ問題と回答状況を保持します。

従来形式に国情報がない場合は「すべて」で練習します。ファイルの選択に失敗したり、不正な内容だったりした場合は、直前に読み込んだ問題集名・問題・回答状況を保持してエラーを表示します。Pages には原本写真を送らないため、画像・黄色マスクとの照合と承認はサーバー版で行います。従来の写真取り込みで保存されている実資料は要確認で、同梱問題集とは別です。

## 公開前の確認

2026-10-20の[GitHub Actions CI](https://github.com/boqxxxpod/wine-quiz-master/actions/runs/39374246122)（コード・データのコミット `c1cfb30cd7314173feb078a329d40c5c8fcda971`）で、Python 50件、Node.js 68件が成功しました。全件データ検証とPagesビルドも成功しています。 PRの `Validate quiz and application` ワークフローで次を実行します。Node.jsの画面操作テストは合成DOM上で行い、8つの出題数での一巡・再開・範囲変更を確認します。

```sh
python -m unittest discover -s tests -v
node --test tests/*.mjs
node scripts/verify_standard_pack.mjs
python scripts/build_pages.py
```

データ検証は653問・既存500問と150問の保持・国別件数・14バッチ一致・864項目の対応分類・2 MB以内を含みます。Pagesの統合JSONは元と同じバイト列です。旧版・分割版・対応表・原画像が公開成果物に含まれないこと、内容の更新で読み込みモジュールの版も変わることをテストします。

今回の実ブラウザでの再検証は行っていません。過去の画面サイズ別の確認は [確認記録](verification.md) に残しています。自動テストの成功は問題内容の人による最終承認を意味しません。未解決の知識と既存問題に残る制約は [検証レポート](../question-packs/highlighted-validation-report.md) に記録しています。

## 公式資料

- [GitHub Pages の静的ホスティング仕様](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- [GitHub Actions を公開元に指定する手順](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [configure-pages の初回有効化に必要な権限](https://github.com/actions/configure-pages/blob/v5/action.yml)
