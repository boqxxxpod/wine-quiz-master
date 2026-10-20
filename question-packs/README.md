# ワイン検定：黄色マーカー知識対応版

標準問題集は**662問**です。従来653問（既存500問・150問を含む）を全フィールド・順序ごと保持し、未使用の主知識IDから9問を追加しました。残る63項目を原画像35枚と公的過去統計で確認し、15項目を補完しました。

864項目のうち816項目は問題・解説に対応、35項目は関連特徴のみ、13項目は保留です。未解決は48項目で、完全網羅と数えません。816項目には複数の知識を一問や解説で扱うものを含み、独立した設問数ではありません。

| ファイル | 内容 |
| --- | --- |
| [wine-quiz-highlighted.json](wine-quiz-highlighted.json) | 現行662問。metadataとquestions |
| [highlighted-batches/](highlighted-batches/) | 50問×13、12問×1。順に結合すると統合版と完全一致 |
| [coverage.json](coverage.json) | 864項目の対応先・状態・根拠ID |
| [remaining-review.json](remaining-review.json) | 再確認した63項目の判断・出典・未解決の具体的な確認事項 |
| [remaining-review-report.md](remaining-review-report.md) | 確認結果と、出版社・講師へ渡せる48項目の一覧 |
| [highlighted-validation-report.md](highlighted-validation-report.md) | 現行版の件数・検証・制約 |
| [validation-653.md](validation-653.md) | 653問版の当時の検証記録 |
| [wine-quiz-500.json](wine-quiz-500.json) | 従来500問とbatches/wine-quiz-01〜10は変更なし |
| [pilot-150.json](pilot-150.json) | 既存150問とbatches/pilot-01〜05は変更なし |
| [validation-report.md](validation-report.md) | 500問版の当時の記録。変更なし |

pilot形式を維持し、正答キーは0始まりで正答文字列と一致します。主知識ID・問題IDは一意、国・countries・source_pageは元資料から継承します。追加9問は三択・単一正答、解説は【要点】【解説】【整理】の3行、206〜225字です。年・比較条件・地理的な範囲を問題文に示します。

原文で対象年が不明な統計を、近隣の文章の年で補っていません。公的な過去資料で同じ事実を確認できたものは、その資料の年・範囲に限定して追加しました。元の統計年を確定したという意味ではありません。

全問 `auto_checked`、`human_approved: false` です。元資料のneeds_reviewフラグ自体は変更せず、原画像で修正案を確認できた7項目は別の再確認記録を根拠に採用します。残る2項目は保留です。従来問題に残る注意点や、人による内容承認が未実施であることも引き継ぎます。

アプリの出題数は5・10・20・30・50・70・100・全問、範囲は全問または国別です。国別合計666は複数国の問題を各国に数えた値で、全問では662問です。統合版と分割版は同じ問題を含むため、取り込みにはどちらか一つを使います。上限は2 MB・2,000問です。

原画像・画像名・Drive URL・周辺原文の全文は成果物に含めません。Pagesとサーバーの公開対象は標準の統合JSON一件で、対応表・再確認記録・バッチ・旧版はGitリポジトリでの確認用です。
