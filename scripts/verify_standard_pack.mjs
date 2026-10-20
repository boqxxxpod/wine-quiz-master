/** Verify the highlighted pack, coverage ledger, and immutable historical packs. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { parseQuestionPack, DEFAULT_PACK_FILENAME, DEFAULT_PACK_PATH, MAX_PACK_BYTES } from '../static/pages.js';
import { countryCounts, questionsForCountry, PRACTICE_COUNTS } from '../static/quiz.js';

const expectedCounts = new Map([
  ['フランス', 198], ['スペイン', 76], ['イタリア', 94], ['日本', 59],
  ['アメリカ', 44], ['オーストラリア', 46], ['ポルトガル', 42], ['オーストリア', 23],
  ['ニュージーランド', 17], ['アルゼンチン', 20], ['南アフリカ', 21], ['チリ', 17],
]);
const reviewIds = new Set(['K0058', 'K0111', 'K0112', 'K0518', 'K0539', 'K0560', 'K0625', 'K0718', 'K0719']);
const expectedStatuses = {
  direct: 643, grouped: 100, related: 58, adapted: 39,
  deferred_source_year: 10, deferred_review: 9, deferred_ambiguity: 5,
};
const readJson = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
function sortedKeys(value) {
  if (Array.isArray(value)) return value.map(sortedKeys);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortedKeys(value[key])]));
  }
  return value;
}
const countsObject = rows => Object.fromEntries(countryCounts(rows));

try {
  assert.equal(DEFAULT_PACK_FILENAME, 'wine-quiz-highlighted.json');
  assert.deepEqual(PRACTICE_COUNTS, [5, 10, 20, 30, 50, 70, 100]);
  const path = new URL(DEFAULT_PACK_PATH, new URL('../static/pages.js', import.meta.url));
  const text = await readFile(path, 'utf8');
  assert.ok(Buffer.byteLength(text) <= MAX_PACK_BYTES, '統合問題集が2MBを超えています。');
  const original = JSON.parse(text);
  const { questions, metadata } = parseQuestionPack(text);
  const pilot = await readJson('../question-packs/pilot-150.json');
  const previous = await readJson('../question-packs/wine-quiz-500.json');
  assert.equal(questions.length, 653);
  assert.equal(metadata.total_questions, 653);
  assert.equal(metadata.original_questions, 150);
  assert.equal(metadata.previous_questions, 500);
  assert.equal(metadata.added_questions, 153);
  assert.equal(metadata.new_questions, 503);
  assert.equal(metadata.batch_count, 14);
  assert.equal(metadata.choice_count, 3);
  assert.equal(metadata.validation_status, 'auto_checked');
  assert.equal(metadata.human_approved, false);
  assert.equal(previous.questions.length, 500);
  assert.deepEqual(original.questions.slice(0, 500), previous.questions, '既存500問の全フィールド・順序を保持してください。');
  assert.deepEqual(original.questions.slice(0, 150), pilot.questions, '既存150問を保持してください。');
  assert.deepEqual(metadata.original_metadata, pilot.metadata);
  const baselineHash = createHash('sha256').update(JSON.stringify(sortedKeys(pilot.questions))).digest('hex');
  assert.equal(baselineHash, '73425381d2651372a374c4a189861652746a17392046ad1dc64c131ccb5431e1');
  assert.equal(metadata.original_150_questions_sha256, baselineHash);
  assert.equal(new Set(original.questions.map(q => q.knowledge_id)).size, 653);
  assert.equal(new Set(original.questions.map(q => q.question_id)).size, 653);
  assert.equal(new Set(original.questions.map(q => q.question.trim())).size, 653);
  assert.deepEqual(metadata, original.metadata);
  assert.deepEqual(countryCounts(questions), expectedCounts);
  assert.deepEqual(metadata.country_counts, countsObject(original.questions));
  assert.equal(Object.values(metadata.country_counts).reduce((sum, count) => sum + count, 0), 657);
  const topicCounts = {};
  for (const q of original.questions) topicCounts[q.topic] = (topicCounts[q.topic] ?? 0) + 1;
  assert.deepEqual(metadata.topic_counts, topicCounts);
  for (const [country, count] of expectedCounts) assert.equal(questionsForCountry(questions, country).length, count);

  for (const [folder, batchCount, total, size, expected] of [
    ['highlighted-batches', 14, 653, 50, original.questions],
    ['batches', 10, 500, 50, previous.questions],
  ]) {
    const batches = await Promise.all(Array.from({ length: batchCount }, async (_, index) => {
      const filename = 'wine-quiz-' + String(index + 1).padStart(2, '0') + '.json';
      const batch = await readJson('../question-packs/' + folder + '/' + filename);
      assert.equal(batch.questions.length, Math.min(size, total - index * size));
      assert.equal(batch.metadata.total_questions, batch.questions.length);
      assert.equal(batch.metadata.batch_number, index + 1);
      assert.deepEqual(batch.metadata.country_counts, countsObject(batch.questions));
      parseQuestionPack(JSON.stringify(batch));
      return batch.questions;
    }));
    assert.deepEqual(batches.flat(), expected, folder + ' の結合結果が統合版と一致しません。');
  }
  const pilotBatches = await Promise.all(Array.from({ length: 5 }, async (_, index) => {
    const filename = 'pilot-' + String(index + 1).padStart(2, '0') + '.json';
    const batch = await readJson('../question-packs/batches/' + filename);
    assert.equal(batch.questions.length, 30);
    parseQuestionPack(JSON.stringify(batch));
    return batch.questions;
  }));
  assert.deepEqual(pilotBatches.flat(), pilot.questions);

  const ledger = await readJson('../question-packs/coverage.json');
  assert.equal(ledger.entries.length, 864);
  assert.deepEqual(ledger.entries.map(e => e.knowledge_id), Array.from({ length: 864 }, (_, i) => 'K' + String(i + 1).padStart(4, '0')));
  const byKnowledge = new Map(ledger.entries.map(e => [e.knowledge_id, e]));
  const byQuestion = new Map(original.questions.map(q => [q.question_id, q]));
  const statusCounts = {};
  for (const entry of ledger.entries) {
    assert.ok(Object.hasOwn(expectedStatuses, entry.status));
    assert.ok(typeof entry.reason === 'string' && entry.reason.trim());
    statusCounts[entry.status] = (statusCounts[entry.status] ?? 0) + 1;
    assert.equal(entry.status === 'deferred_review', reviewIds.has(entry.knowledge_id));
    if (entry.status.startsWith('deferred')) assert.deepEqual(entry.question_ids, []);
    else assert.ok(entry.question_ids.length > 0);
    for (const id of entry.question_ids) assert.ok(byQuestion.has(id), id + ' がありません。');
  }
  assert.deepEqual(sortedKeys(statusCounts), sortedKeys(expectedStatuses));
  const summary = ledger.metadata.summary;
  assert.deepEqual(metadata.coverage, summary);
  assert.deepEqual(sortedKeys(summary.status_counts), sortedKeys(expectedStatuses));
  assert.equal(summary.fully_represented_items, 801);
  assert.equal(summary.adapted_items, 39);
  assert.equal(summary.deferred_items, 24);
  assert.equal(summary.question_count, 653);
  assert.equal(summary.added_questions, 153);
  assert.equal(summary.source_items, 864);
  assert.equal(summary.source_needs_review, 9);
  assert.equal(ledger.metadata.source_sha256, metadata.source_sha256);
  assert.equal(Object.keys(ledger.question_support).length, 153);

  const oldIds = new Set(previous.questions.map(q => q.knowledge_id));
  const newSupportIds = new Set();
  const answerCounts = [0, 0, 0];
  for (const [index, q] of original.questions.entries()) {
    assert.equal(q.question_id, 'Q-' + q.knowledge_id + '-01');
    assert.equal(q.status, 'auto_checked');
    assert.equal(q.version, 1);
    assert.equal(q.options.length, 3);
    assert.equal(new Set(q.options.map(option => option.trim().replace(/\s+/g, ' '))).size, 3);
    assert.equal(q.correct_answer, q.options[q.correct_index]);
    assert.ok(!reviewIds.has(q.knowledge_id));
    assert.doesNotMatch(q.question + '\n' + q.explanation, /教材/);
    answerCounts[q.correct_index] += 1;
    if (index >= 150) {
      assert.match(q.explanation, /^【要点】[^\n]+\n【解説】[^\n]+\n【整理】[^\n]+$/u);
      assert.ok([...q.explanation].length <= 650);
    }
    if (index < 500) continue;
    assert.ok(!oldIds.has(q.knowledge_id));
    const source = byKnowledge.get(q.knowledge_id);
    assert.equal(q.country, source.country);
    assert.deepEqual(q.countries, source.countries);
    assert.equal(q.source_page, source.source_page);
    const support = ledger.question_support[q.question_id];
    assert.ok(support);
    assert.equal(support.knowledge_ids[0], q.knowledge_id);
    assert.ok(byQuestion.has(support.explanation_reference_question_id));
    for (const kid of support.knowledge_ids) {
      assert.ok(!oldIds.has(kid), kid + ' は既存500問で使用済みです。');
      assert.ok(!newSupportIds.has(kid), kid + ' の追加問題での使用が重複しています。');
      assert.ok(!reviewIds.has(kid));
      const entry = byKnowledge.get(kid);
      assert.ok(entry && !entry.status.startsWith('deferred'));
      assert.ok(entry.question_ids.includes(q.question_id));
      newSupportIds.add(kid);
    }
  }
  assert.deepEqual(answerCounts, [218, 218, 217]);
  assert.deepEqual(metadata.correct_index_counts, { 0: 218, 1: 218, 2: 217 });
  assert.doesNotMatch(text, /https?:\/\/|drive\.google\.com|IMG\d+|"surrounding_text"|"source_knowledge"|"sources"/);
  assert.doesNotMatch(JSON.stringify(ledger), /https?:\/\/|drive\.google\.com|IMG\d+|"surrounding_text"|"source_knowledge"|"sources"/);
  console.log(DEFAULT_PACK_FILENAME + ': 653問・既存500問保持・153問追加・864項目の対応分類・14バッチ一致・2MB以内を確認しました。');
} catch (error) {
  console.error(DEFAULT_PACK_FILENAME + ' の検証に失敗しました: ' + error.message);
  process.exitCode = 1;
}
