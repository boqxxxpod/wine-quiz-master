# ワイン検定：黄色マーカー知識対応版

標準問題集は **653問** です。既存500問を全フィールド・順序ごと保持し、未使用知識IDを使った153問を追加しました。追加問題は、同じ産地・分類などの知識をまとめることで255個の知識IDに対応します。

864項目のうち801項目は問題文または解説に対応し、39項目は年不明の数値・順位などを避けて関連特徴だけを扱います。24項目は出題保留です。**完全網羅と数えず、未解決を区別しています。** 詳細は [検証レポート](highlighted-validation-report.md) と [全ID対応表](coverage.json) を参照してください。

| ファイル | 内容 |
| --- | --- |
| [wine-quiz-highlighted.json](wine-quiz-highlighted.json) | 現在の標準653問。metadataとquestions |
| [highlighted-batches/](highlighted-batches/) | 14ファイル。50問×13と3問×1。順に結合すると統合版と完全一致 |
| [coverage.json](coverage.json) | 864項目の対応先・状態・保留理由、追加問題の根拠ID |
| [highlighted-validation-report.md](highlighted-validation-report.md) | 国・テーマ別件数、検証結果、未解決範囲 |
| [wine-quiz-500.json](wine-quiz-500.json) | 従来の500問。変更なし |
| `batches/wine-quiz-01.json`〜`wine-quiz-10.json` | 従来500問の確認用50問×10。変更なし |
| [pilot-150.json](pilot-150.json) | 修正済みの既存150問。変更なし |
| `batches/pilot-01.json`〜`pilot-05.json` | 既存150問の30問×5。変更なし |
| [validation-report.md](validation-report.md) | 旧500問版の検証記録。変更なし |

## 形式と根拠

各問のpilot形式は維持し、0始まりの `correct_index` と `options[correct_index]` に一致する `correct_answer` を保存します。IDは元の知識IDから作ります。追加153問の主知識IDは既存500問と重複せず、国・countries・source_pageは元資料から継承します。

新規解説は【要点】【解説】【整理】を改行した一文字列で、153〜273字、650字以内です。元知識、対応する周辺テキスト、確認済みの関連知識を根拠とし、必要な別ページは参照p.○で示します。統計の新規出題は対象年を示し、年不明の数字を新しく断定しません。

全653問は `auto_checked`、`human_approved: false` です。元資料で `needs_review=true` の9項目は追加問題と関連知識に使用しません。原画像との全件再照合や人による最終承認を済ませた状態ではありません。既存500問に残る確認事項も検証レポートに記録しています。

## 練習と公開範囲

アプリは標準653問を読み込み、出題数は5・10・20・30・50・70・100・全問から選びます。範囲は全問または国別です。国別件数の合計657は、複数国に属する問題をそれぞれの国に数えた値です。全問では各問題を一回だけ数えます。

統合版と分割版を同時に取り込むと同じ問題を含むため、用途に合わせてどちらか一つを使ってください。JSON読み込み上限は2 MB・2,000問です。手動読み込みはこのタブのみで使用します。

今回追加する問題集・対応表には原画像・画像名・Drive URL・周辺原文の全文を含めません。Pagesビルドとサーバーの公開対象は標準の `wine-quiz-highlighted.json` 一件に限定し、旧版・確認用バッチ・対応表・検証記録は配信しません。Gitリポジトリではレビューできるよう保存しています。
