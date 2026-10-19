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
  console.log(`${DEFAULT_PACK_FILENAME}: 全150問・12か国の件数と共有問題の所属を確認しました（スペイン16問、原メタデータは保持）。`);
} catch (error) {
  console.error(`${DEFAULT_PACK_FILENAME} の検証に失敗しました: ${error.message}`);
  process.exitCode = 1;
}
