/** Validate the real Issue #1 attachment before publishing; never supply fallback data. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseQuestionPack, DEFAULT_PACK_FILENAME } from '../static/pages.js';
import { countryCounts, questionsForCountry } from '../static/quiz.js';

const expectedCounts = new Map([
  ['フランス', 8], ['スペイン', 5], ['イタリア', 4], ['日本', 2],
  ['アメリカ', 2], ['オーストラリア', 2], ['ポルトガル', 2], ['オーストリア', 2],
  ['ニュージーランド', 1], ['アルゼンチン', 1], ['南アフリカ', 1], ['チリ', 1],
]);

try {
  const path = new URL(`../static/${DEFAULT_PACK_FILENAME}`, import.meta.url);
  const text = await readFile(path, 'utf8');
  assert.ok(Array.isArray(JSON.parse(text)), '標準問題集はトップレベルが配列の元 JSON を配置してください。');
  const { questions } = parseQuestionPack(text);
  assert.equal(questions.length, 30, '標準問題集の異なる問題 ID は30件必要です。');
  assert.deepEqual(countryCounts(questions), expectedCounts, '国別件数が Issue #1 の要求値と一致しません。');
  const sharedId = 'WQM-PILOT-0027';
  const shared = questions.find(question => question.id === sharedId);
  assert.ok(shared, `${sharedId} がありません。`);
  assert.deepEqual(new Set(shared.countries), new Set(['フランス', 'スペイン']));
  for (const country of ['フランス', 'スペイン']) {
    assert.equal(questionsForCountry(questions, country).filter(question => question.id === sharedId).length, 1);
  }
  console.log(`${DEFAULT_PACK_FILENAME}: 全30問・12か国の件数と共有問題の所属を確認しました。`);
} catch (error) {
  console.error(`${DEFAULT_PACK_FILENAME} の検証に失敗しました: ${error.message}`);
  process.exitCode = 1;
}
