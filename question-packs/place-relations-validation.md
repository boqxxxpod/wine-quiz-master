# 地名マスターの資料照合記録

確認日：2026-11-01（JST）。データ版：`2026-11-01.1`、形式版：1。

既存の黄色マーカー由来の教科書問題と `coverage.json` の知識IDを候補の起点にし、下記の産地公式・自治体資料を実際に取得して、該当する所在・格付けを照合した。問題文からの自動推定だけで採用していない。原教本p.19の画像を今回再読したという意味ではなく、独立した公開資料による照合である。資料の刊行年は推定せず、統計・面積・生産量・所有者は学習データに追加していない。

`source_verified` は指定資料との関係照合の完了を表す。人による最終承認は未実施で、各記録の `human_approved` は `false`。既存問題集の `auto_checked` やcoverageのdirect/groupedとは別の状態である。

## 採用範囲

国1、地方1、地区1、村5、特級畑7の**15地名・15関係**。村→畑5カード、畑→村7カード、混合12カード。全ブルゴーニュ・各村の全特級畑の網羅ではない。全問で「収録対象」の条件を表示する。

| 関係 | 既存知識ID | 確認資料・位置 |
| --- | --- | --- |
| フランス → ブルゴーニュ → コート・ド・ニュイ | K0072 | [BIVB：Locating the Bourgogne region](https://www.bourgogne-wines.com/wine-and-terroir/locating-the-bourgogne-region/locating-the-bourgogne-region,3202,14763.html) のFrance内の位置と産地一覧 |
| コート・ド・ニュイ → ジュヴレ・シャンベルタン → シャンベルタン | K0080・K0084 | JSONの `bivb-chambertin`：Appellations Grands Crus／Producing commune |
| コート・ド・ニュイ → モレ・サン・ドニ → クロ・ド・タール／クロ・ド・ラ・ロッシュ | K0081・K0085 | [BIVB公式PDF](https://www.bourgogne-wines.com/wine-and-terroir/bourgogne-and-its-appellations/gallery_files/site/321/402/79294/79359.pdf) p.1冒頭の格付けと生産村 |
| コート・ド・ニュイ → シャンボール・ミュジニィ → ミュジニィ | K0082・K0086 | JSONの `bivb-musigny`：Appellation Grand Cru／Commune de production／Situation |
| コート・ド・ニュイ → ヴージョ → クロ・ド・ヴージョ | K0087 | JSONの `bivb-vougeot`：Appellation Grand Cru／Producing commune／Location |
| コート・ド・ニュイ → ヴォーヌ・ロマネ → ロマネ・コンティ | K0083・K0088 | JSONの `bivb-romanee`：Appellations Grands Crus／Producing commune／Location |
| シャンボール・ミュジニィ **および** モレ・サン・ドニ → ボンヌ・マール | K0082・PM-ADD-0001 | BIVB公式PDF p.1のBonnes-Maresの両村への所在説明と、[Chambolle-Musigny自治体](https://chambollemusigny.fr/oenotourisme/appellation)のGrand Cru欄を相互照合 |

完全なURL・書誌・確認箇所・確認方法は `place-relations.json` の `sources` および各ノード・関係の `verification` に保持する。公開資料の原文全体や地図画像は複製しない。

## 表記・新しい関係

- ミュジニィ（Musigny）を表示名とし、既存問題の「ミュジニー」を別名に保持した。どちらも同じ地名IDを参照する。既存クイズJSONは変更していない。
- 練習問題FR-046の原文「シャンベルタン村」は新マスターの村名として採用していない。村はGevrey-Chambertin、畑はChambertinと公式の生産村欄で区別した。
- クロ・ド・ラ・ロッシュは既存Q-K0085-01の解説にあるため、その知識IDを関連付けた。独立した既存設問があるとは扱わない。
- 既存Q-K0082-01の解説にはボンヌ・マールのChambolle側の紹介がある。Morey側を欠落させた単一正解を作らないため、公式資料で追加確認した関係に専用知識ID `PM-ADD-0001` と追加理由を記録した。架空のK番号は付けていない。
- 村ノードは地理的な村を表す。村名A.O.C.の生産域と行政村の境界を同一視したデータではない。畑ノードはGrand Cruとして紹介された地理的な畑・呼称を学習用に表し、格付けは別属性にしている。

## 今回採用しない範囲

コート・ド・ボーヌ（K0090〜K0093）、他の地区・各村の残りの畑・一級畑は初期収録外。今回の照合一覧に含まれない関係を推測で補っていない。今後追加する際に所在・表記・複数村の有無・正解集合を照合し、出典と追加理由を記録する。既存coverageの816項目対応／48項目未解決という評価は変更しない。

保存形式v1が初版で、既知の旧保存形式はまだ存在しない。不明な版は移行を推測せず保護し、利用者が確認して専用履歴をリセットできる。将来既知の旧版ができた際に明示的な移行を追加する。
