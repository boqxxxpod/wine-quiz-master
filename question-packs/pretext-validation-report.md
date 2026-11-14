# 事前テキスト：作成・検証記録（2026-11-14）

Issue #28の要点テキストから、練習問題風の三択・単一正答を235問作成しました。新問題集のIDは `pretext`、初期選択は `practice` です。

| 国 | 問題数 | 原文項目 | 設問・解説で対応 | 一部保留 | 全保留 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 日本 | 14 | 10 | 4 | 5 | 1 |
| フランス | 63 | 55 | 42 | 11 | 2 |
| イタリア | 37 | 22 | 20 | 2 | 0 |
| ドイツ | 7 | 8 | 5 | 2 | 1 |
| スペイン | 12 | 9 | 8 | 1 | 0 |
| ポルトガル | 15 | 14 | 13 | 1 | 0 |
| オーストリア | 10 | 10 | 7 | 2 | 1 |
| アメリカ | 16 | 17 | 10 | 2 | 5 |
| チリ | 12 | 12 | 7 | 3 | 2 |
| アルゼンチン | 8 | 7 | 3 | 4 | 0 |
| オーストラリア | 14 | 9 | 6 | 3 | 0 |
| ニュージーランド | 13 | 13 | 7 | 4 | 2 |
| 南アフリカ | 14 | 10 | 7 | 3 | 0 |

原文項目は見出しを除いた行単位の196件で、1項目に複数の知識を含みます。設問・解説で対応する139項目と、一部保留43項目、全保留14項目を分けています。未解決部分があるのは57項目です。完全網羅ではありません。

## 作問と原文の扱い

- 知識確認・空欄補充・組み合わせなどを新規作成し、アメリカは誤文選択3問を含めました。各問に正解の理由や混同しやすい知識の違いを説明しています。
- フランス5地域、イタリア3州、スペイン3地域の位置関係は文章問題です。提示されていない地図記号や画像は参照しません。
- 日本ワインの国内製造要件を補足し、AOCとAOP・DOCとDOPは対応関係を説明します。旧表示が廃止されたとはしていません。
- ガリシア、ビクトリア、ネッビオーロ、ミュジニー、プイィ・フュメ等の固有名詞を修正し、クナワラのテラロッサを石灰岩の上の赤い土と整理しました。アイスヴァインは凍結状態での圧搾と明記します。
- ロワール川の「1012ｍ」は単位誤記を記録し、厳密な長さを正答条件にしていません。1855年は赤の5段階格付けを扱い、対象地域・銘柄数は保留しました。
- 年度不明の生産・消費・輸出・輸入・採用割合や順位、サルタ全体を冷涼とする説明、セントラル・オタゴ等の最上級の断定は正答条件から外しました。
- 原文は [pretext-source.txt](pretext-source.txt) に保持し、各行と設問の双方向参照、採用・修正・保留の詳細を [pretext-coverage.json](pretext-coverage.json) に記録しています。

## 限定した公式資料の確認

次の資料は各scopeの事実を確認した記録です。全設問・全選択肢の外部確認ではありません。全問は `auto_checked`、`human_approved: false`、`external_fact_check_completed: false` を維持します。入力テキストとの照合や正答キーの検査は、人による最終校閲の完了を示しません。

- [国税庁70年史：果実酒等の製法品質表示基準・ワインの表示ルール](https://www.nta.go.jp/about/introduction/torikumi/70th_html/02_1.htm)：日本ワインの定義。本文の国際交渉・ワインの表示ルール抜粋を確認。 国産ぶどうのみを原料とし、日本国内で製造された果実酒である。原文では不足する国内製造・原料の限定を補う。
- [National Tax Agency: Information on GIs protected in Japan](https://www.nta.go.jp/english/taxes/liquor_administration/geographical/02.htm)：ワインGI山梨・北海道の指定日。指定一覧の該当行を確認。 山梨（ぶどう酒）は2013年7月16日、北海道（ぶどう酒）は2018年6月28日。他のワインGIも掲載されており、この2産地を全指定産地と扱わない。
- [CIVB Bordeaux.com: The 1855 Wines Classifications](https://www.bordeaux.com/en/classifications/classifications-1855/)：1855年格付けの契機、赤の段階数、現在の対象産地・銘柄数。ページの説明部分を確認。 1855年パリ万博でナポレオン3世が分類を求めたこと、赤が5段階であることを確認。現在の赤の対象はメドック60とグラーヴ1。原文の「1855年にメドック60」という当初対象・数の断定までは支持しない。
- [DGCCRF: Étiquetage des vins : savoir lire les étiquettes](https://www.economie.gouv.fr/dgccrf/les-fiches-pratiques/etiquetage-des-vins-savoir-lire-les-etiquettes)：フランスのAOPと伝統表示AOCの関係。必須表示の説明を確認。 AOP等の表示を伝統表示appellation d’origine contrôlée等で置き換えられる。AOCが使用不可になったという意味の一律廃止・全面移行とは扱わない。
- [IVDP: Guia para embalagem, apresentação e designação — Capítulo 4, Validações](https://www.ivdp.pt/pt/comunicacao/guias-tematicos/embalagem-apresentacao-e-designacao/guia-para-embalagem-apresentacao-e-designacao/capitulo-4-validacoes/)：ポルトガルのDOP／DOC表記。2022年12月22日付ガイドのDOP Douroの必須表示を確認。 DOP DouroでDenominação de Origem Protegida/DOP、Denominação de Origem/DO、Denominação de Origem Controlada/DOCの表示が列挙されている。DOCが使用できなくなったと断定しない。
- [Instituto dos Vinhos do Douro e Porto: Master of Port案内](https://ivdp.pt/en)：1756年とドウロの歴史上の位置付け。Master of Port Benelux案内（2024年7月30日）の説明を確認。 IVDPはドウロを1756年に由来する世界最古の区画・規制された産地と説明する。対象を区画・規制された産地に限定して根拠とし、あらゆる世界最初の原産地管理法という広い法制度史の主張には使わない。
- [New Zealand MFAT: EU–NZ FTA, Annex 9-E, Wine and Spirits](https://www.mfat.govt.nz/assets/Trade-agreements/EU-NZ-FTA/Annexes/Annex-9-E-Wine-and-Spirits.pdf)：第11条の単一品種・ヴィンテージ表示について85%以上の条件（PDFの10〜11ページ）を確認。 EU–NZの輸出入では単一品種・ヴィンテージ表示はそれぞれ85%以上が条件。この出典は国内全般の地域表示規則や2007ヴィンテージからの適用開始年を直接確定する根拠としては用いない。MPI・法令本文は取得拒否で未確認。
- [New Zealand Winegrowers: Wine Standards Management Plan Code of Practice, Version 2 (October 2011), Appendix 2](https://www.nzwine.com/media/6741/nzw_wsmp_cop_v2.pdf)：業界団体公式PDFの冊子23ページ（PDF22番目のページ）の品種・ヴィンテージ・地域表示、2007年以降の適用説明を確認。 2007年以降のワインで単一品種・ヴィンテージ・地域を表示する場合、その表示内容に85%以上由来する条件を確認。品種・年・地域を組み合わせて表示する場合は、その組み合わせで85%以上とする説明もある。2007年の適用開始に関する当時の業界公式資料として使える。現在の全規則を確認した意味ではない。
- [Chile SAG: Resolución Exenta 7787/2025 (2025-09-29)](https://www.sag.gob.cl/sites/default/files/Resoluci%C3%B3n%207787_2025.pdf)：第20条の国内未発生の検疫有害動植物リスト（PDF2ページの前文および22ページの該当種）を確認。SAGの未発生害虫ページが最新改正としてこの文書を案内している。 チリ本土・島嶼部に未発生とするリストに、Viteus (=Daktulosphaira) vitifoliae（ブドウネアブラムシ、フィロキセラ）がVitis spp.の害虫として掲載されている。チリが未発生の産地という採用箇所を支持する。過去から将来まで永久に未発生という意味ではない。

## 全保留の項目

一部保留を含む全詳細は対応表の `held_details` を参照してください。

- `PRETEXT-JP-S005`（日本）：甲州が最多、次がマスカット・ベーリーAという順位。
- `PRETEXT-FR-S025`（フランス）：ボルドーに次ぐ2位、赤80％、ロゼ13％の数値は保留。
- `PRETEXT-FR-S035`（フランス）：フランスの全IGPワインの80％という割合は保留。
- `PRETEXT-DE-S007`（ドイツ）：カビネット、シュペートレーゼ、貴腐ワイン、格付け畑の各発祥地という主張の個別確認が必要。
- `PRETEXT-AT-S001`（オーストリア）：白ブドウ栽培面積の約7割という割合。
- `PRETEXT-US-S001`（アメリカ）：ワイン生産量の世界第4位は対象年・集計資料が不明。現在の順位として出題しない。
- `PRETEXT-US-S002`（アメリカ）：消費量世界最大は対象年・数量の集計条件が不明。現在の順位として出題しない。
- `PRETEXT-US-S003`（アメリカ）：生産量と消費量の比較は対象年不明で、「他の国とは異なる」という排他的な説明も成立するとは限らないため保留。
- `PRETEXT-US-S004`（アメリカ）：カリフォルニアの生産比率80％は対象年・集計対象が不明。
- `PRETEXT-US-S013`（アメリカ）：ワシントン州の栽培面積全米第2位は対象年・ワイン用ブドウと全ブドウの区分が不明。
- `PRETEXT-CL-S001`（チリ）：日本の国別輸入量第1位は対象年・容器区分等の集計条件が不明。
- `PRETEXT-CL-S005`（チリ）：赤ワイン比率75％以上は対象年と集計対象が不明。
- `PRETEXT-NZ-S002`（ニュージーランド）：全輸出量の70％以上という割合は、対象年・輸出量の単位や品種別集計の根拠が不明のため保留。
- `PRETEXT-NZ-S003`（ニュージーランド）：スクリューキャップ採用率99％以上という割合は対象年・調査範囲が不明のため保留。

## 検証

既存パーサーでの全問読み込み、正答・解説・出典、ID・選択肢の一意性、原文196項目と設問の双方向参照、国別件数を自動検査します。既存の問題集別・国別・出題数別の全件採点検査に新問題集を含め、初期値、切り替え、しおりの分離、失敗後の再試行、サーバー配信とPages同梱を確認します。

全自動テストと実ブラウザの実施結果は [アプリの確認記録](../docs/verification.md) を参照してください。原文・対応表・本レポートはサーバー配信とPages成果物に含めません。
