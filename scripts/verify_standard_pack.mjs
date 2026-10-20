/** Check the default 500-question pack and the unchanged 150-question baseline. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { parseQuestionPack, DEFAULT_PACK_FILENAME, DEFAULT_PACK_PATH, MAX_PACK_BYTES } from '../static/pages.js';
import { countryCounts, questionsForCountry } from '../static/quiz.js';

const expectedCounts = new Map([
  ['フランス', 149], ['スペイン', 61], ['イタリア', 66], ['日本', 49],
  ['アメリカ', 34], ['オーストラリア', 35], ['ポルトガル', 33], ['オーストリア', 17],
  ['ニュージーランド', 14], ['アルゼンチン', 14], ['南アフリカ', 17], ['チリ', 13],
]);
const reviewIds = new Set(['K0058', 'K0111', 'K0112', 'K0518', 'K0539', 'K0560', 'K0625', 'K0718', 'K0719']);

function sortedKeys(value) {
  if (Array.isArray(value)) return value.map(sortedKeys);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortedKeys(value[key])]));
  }
  return value;
}

function countsObject(rows) { return Object.fromEntries(countryCounts(rows)); }

try {
  assert.equal(DEFAULT_PACK_FILENAME, 'wine-quiz-500.json');
  const path = new URL(DEFAULT_PACK_PATH, new URL('../static/pages.js', import.meta.url));
  const text = await readFile(path, 'utf8');
  assert.ok(Buffer.byteLength(text) <= MAX_PACK_BYTES, '統合問題集が2MBを超えています。');
  const original = JSON.parse(text);
  const { questions, metadata } = parseQuestionPack(text);
  const pilot = JSON.parse(await readFile(new URL('../question-packs/pilot-150.json', import.meta.url), 'utf8'));
  assert.equal(questions.length, 500);
  assert.equal(metadata.total_questions, 500);
  assert.equal(metadata.original_questions, 150);
  assert.equal(metadata.new_questions, 350);
  assert.equal(metadata.validation_status, 'auto_checked');
  assert.equal(metadata.human_approved, false);
  assert.deepEqual(original.questions.slice(0, 150), pilot.questions, '修正済みの既存150問を全フィールド・順序ごと保持してください。');
  assert.deepEqual(metadata.original_metadata, pilot.metadata);
  const baselineHash = createHash('sha256').update(JSON.stringify(sortedKeys(pilot.questions))).digest('hex');
  assert.equal(metadata.original_150_questions_sha256, baselineHash);
  assert.equal(new Set(original.questions.map(question => question.knowledge_id)).size, 500);
  assert.equal(new Set(original.questions.map(question => question.question_id)).size, 500);
  assert.deepEqual(metadata, original.metadata);
  assert.deepEqual(countryCounts(questions), expectedCounts);
  assert.deepEqual(metadata.country_counts, countsObject(original.questions));
  assert.equal(Object.values(metadata.country_counts).reduce((sum, count) => sum + count, 0), 502);

  for (const [sharedId, countries] of [
    ['Q-K0019-01', ['フランス', 'スペイン']],
    ['Q-K0491-01', ['スペイン', 'ポルトガル']],
  ]) {
    const shared = questions.find(question => question.id === sharedId);
    assert.ok(shared, `${sharedId} がありません。`);
    assert.deepEqual(new Set(shared.countries), new Set(countries));
    for (const country of countries) {
      assert.equal(questionsForCountry(questions, country).filter(question => question.id === sharedId).length, 1);
    }
  }
  for (const [country, count] of expectedCounts) assert.equal(questionsForCountry(questions, country).length, count);

  const batches = await Promise.all(Array.from({ length: 10 }, async (_, index) => {
    const filename = `wine-quiz-${String(index + 1).padStart(2, '0')}.json`;
    const batch = JSON.parse(await readFile(new URL(`../question-packs/batches/${filename}`, import.meta.url), 'utf8'));
    assert.equal(batch.questions.length, 50, `${filename} は50問必要です。`);
    assert.equal(batch.metadata.total_questions, 50);
    assert.equal(batch.metadata.batch_number, index + 1);
    assert.deepEqual(batch.metadata.country_counts, countsObject(batch.questions));
    parseQuestionPack(JSON.stringify(batch));
    return batch.questions;
  }));
  assert.deepEqual(batches.flat(), original.questions, '統合500問と確認用の10バッチが一致しません。');

  const pilotBatches = await Promise.all(Array.from({ length: 5 }, async (_, index) => {
    const filename = `pilot-${String(index + 1).padStart(2, '0')}.json`;
    const batch = JSON.parse(await readFile(new URL(`../question-packs/batches/${filename}`, import.meta.url), 'utf8'));
    assert.equal(batch.questions.length, 30);
    parseQuestionPack(JSON.stringify(batch));
    return batch.questions;
  }));
  assert.deepEqual(pilotBatches.flat(), pilot.questions);

  const oldIds = new Set(pilot.questions.map(question => question.knowledge_id));
  const answerCounts = [0, 0, 0];
  for (const [index, question] of original.questions.entries()) {
    assert.equal(question.question_id, `Q-${question.knowledge_id}-01`);
    assert.equal(question.status, 'auto_checked');
    assert.equal(question.options.length, 3);
    assert.equal(new Set(question.options.map(option => option.trim().replace(/\s+/g, ' '))).size, 3);
    assert.equal(question.correct_answer, question.options[question.correct_index]);
    assert.ok(!reviewIds.has(question.knowledge_id), `${question.knowledge_id} は要確認のため使用できません。`);
    assert.doesNotMatch(`${question.question}\n${question.explanation}`, /教材/);
    answerCounts[question.correct_index] += 1;
    if (index >= 150) {
      assert.ok(!oldIds.has(question.knowledge_id));
      assert.match(question.explanation, /^【要点】[^\n]+\n【解説】[^\n]+\n【整理】[^\n]+$/u);
      assert.ok([...question.explanation].length <= 650);
    }
  }
  assert.deepEqual(answerCounts, [167, 167, 166]);
  assert.doesNotMatch(text, /https?:\/\/|drive\.google\.com|IMG\d+|"surrounding_text"|"source_knowledge"|"sources"/);
  console.log(`${DEFAULT_PACK_FILENAME}: 500問・500知識ID・既存150問保持・350問追加・12か国・共有2問・50問×10分割・2MB以内を確認しました。`);
} catch (error) {
  console.error(`${DEFAULT_PACK_FILENAME} の検証に失敗しました: ${error.message}`);
  process.exitCode = 1;
}
