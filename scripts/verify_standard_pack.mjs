/** Verify the registered pilot pack selected as the default; never supply fallback data. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseQuestionPack, DEFAULT_PACK_FILENAME, DEFAULT_PACK_PATH } from '../static/pages.js';
import { countryCounts, questionsForCountry } from '../static/quiz.js';

const expectedCounts = new Map([
  ['フランス', 32], ['スペイン', 16], ['イタリア', 17], ['日本', 17],
  ['アメリカ', 11], ['オーストラリア', 11], ['ポルトガル', 11], ['オーストリア', 8],
  ['ニュージーランド', 7], ['アルゼンチン', 7], ['南アフリカ', 7], ['チリ', 7],
]);

try {
  const path = new URL(DEFAULT_PACK_PATH, new URL('../static/pages.js', import.meta.url));
  const text = await readFile(path, 'utf8');
  const original = JSON.parse(text);
  const { questions, metadata } = parseQuestionPack(text);
  assert.equal(questions.length, 150, '標準問題集の異なる問題 ID は150件必要です。');
  assert.deepEqual(metadata, original.metadata, '記録されたメタデータを改変せず保持してください。');
  assert.deepEqual(countryCounts(questions), expectedCounts, '実際の countries に基づく国別件数が登録データと一致しません。');
  const sharedId = 'Q-K0019-01';
  const shared = questions.find(question => question.id === sharedId);
  assert.ok(shared, `${sharedId} がありません。`);
  assert.deepEqual(new Set(shared.countries), new Set(['フランス', 'スペイン']));
  for (const country of ['フランス', 'スペイン']) {
    assert.equal(questionsForCountry(questions, country).filter(question => question.id === sharedId).length, 1);
  }
  for (const [country, count] of expectedCounts) {
    assert.equal(questionsForCountry(questions, country).length, count);
  }
  const batches = await Promise.all(Array.from({ length: 5 }, async (_, index) => {
    const filename = `pilot-${String(index + 1).padStart(2, '0')}.json`;
    const batch = JSON.parse(await readFile(new URL(`../question-packs/batches/${filename}`, import.meta.url), 'utf8'));
    assert.equal(batch.questions.length, 30, `${filename} は30問必要です。`);
    parseQuestionPack(JSON.stringify(batch));
    return batch.questions;
  }));
  assert.deepEqual(batches.flat(), original.questions, '統合150問と確認用の5バッチが一致しません。');
  for (const question of original.questions) {
    assert.doesNotMatch(`${question.question}\n${question.explanation}`, /教材/,
      `${question.question_id}: 教材への不要な準拠表現が残っています。`);
  }
  console.log(`${DEFAULT_PACK_FILENAME}: 全150問・12か国・共有問題・5バッチの一致と本文の準拠表現削除を確認しました（スペイン16問、原メタデータは保持）。`);
} catch (error) {
  console.error(`${DEFAULT_PACK_FILENAME} の検証に失敗しました: ${error.message}`);
  process.exitCode = 1;
}
