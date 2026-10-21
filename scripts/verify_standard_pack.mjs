/** Verify the highlighted pack, coverage ledger, and immutable historical packs. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { parseQuestionPack, DEFAULT_PACK_FILENAME, DEFAULT_PACK_PATH, MAX_PACK_BYTES } from '../static/pages.js';
import { countryCounts, questionsForCountry, PRACTICE_COUNTS } from '../static/quiz.js';

const expectedCounts = new Map([
  ['フランス', 201], ['スペイン', 76], ['イタリア', 94], ['日本', 61],
  ['アメリカ', 45], ['オーストラリア', 47], ['ポルトガル', 42], ['オーストリア', 24],
  ['ニュージーランド', 17], ['アルゼンチン', 20], ['南アフリカ', 21], ['チリ', 18],
]);
const reviewIds = new Set(['K0058', 'K0111', 'K0112', 'K0518', 'K0539', 'K0560', 'K0625', 'K0718', 'K0719']);
const clearedReviewIds = new Set(['K0111', 'K0112', 'K0539', 'K0560', 'K0625', 'K0718', 'K0719']);
const unresolvedReviewIds = new Set(['K0058', 'K0518']);
const expectedStatuses = {
  direct: 653, grouped: 102, related: 61, adapted: 35,
  deferred_source_year: 7, deferred_review: 1, deferred_ambiguity: 5,
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
  assert.equal(questions.length, 662);
  assert.equal(metadata.total_questions, 662);
  assert.equal(metadata.original_questions, 150);
  assert.equal(metadata.previous_questions, 653);
  assert.equal(metadata.added_questions, 9);
  assert.equal(metadata.new_questions, 512);
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
  const previous653Hash = createHash('sha256').update(JSON.stringify(sortedKeys(original.questions.slice(0, 653)))).digest('hex');
  assert.equal(previous653Hash, '56f91fbc858bdc7de4d38f4e405cd1d9760adc7dee893349036abc0e87e1ff35', '既存653問の全フィールド・順序を保持してください。');
  assert.equal(metadata.previous_653_questions_sha256, previous653Hash);
  assert.equal(metadata.previous_653_preserved, true);
  assert.equal(new Set(original.questions.map(q => q.knowledge_id)).size, 662);
  assert.equal(new Set(original.questions.map(q => q.question_id)).size, 662);
  assert.equal(new Set(original.questions.map(q => q.question.trim())).size, 662);
  assert.deepEqual(metadata, original.metadata);
  assert.deepEqual(countryCounts(questions), expectedCounts);
  assert.deepEqual(metadata.country_counts, countsObject(original.questions));
  assert.equal(Object.values(metadata.country_counts).reduce((sum, count) => sum + count, 0), 666);
  const topicCounts = {};
  for (const q of original.questions) topicCounts[q.topic] = (topicCounts[q.topic] ?? 0) + 1;
  assert.deepEqual(metadata.topic_counts, topicCounts);
  for (const [country, count] of expectedCounts) assert.equal(questionsForCountry(questions, country).length, count);

  for (const [folder, batchCount, total, size, expected] of [
    ['highlighted-batches', 14, 662, 50, original.questions],
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
    assert.equal(entry.status === 'deferred_review', entry.knowledge_id === 'K0518');
    if (unresolvedReviewIds.has(entry.knowledge_id)) assert.ok(entry.status.startsWith('deferred'));
    if (entry.status.startsWith('deferred')) assert.deepEqual(entry.question_ids, []);
    else assert.ok(entry.question_ids.length > 0);
    for (const id of entry.question_ids) assert.ok(byQuestion.has(id), id + ' がありません。');
  }
  assert.deepEqual(sortedKeys(statusCounts), sortedKeys(expectedStatuses));
  const summary = ledger.metadata.summary;
  assert.deepEqual(metadata.coverage, summary);
  assert.deepEqual(sortedKeys(summary.status_counts), sortedKeys(expectedStatuses));
  assert.equal(summary.fully_represented_items, 816);
  assert.equal(summary.adapted_items, 35);
  assert.equal(summary.deferred_items, 13);
  assert.equal(summary.remaining_items, 48);
  assert.equal(summary.question_count, 662);
  assert.equal(summary.previous_questions, 653);
  assert.equal(summary.added_questions, 9);
  assert.equal(summary.source_items, 864);
  assert.equal(summary.source_needs_review, 9);
  assert.equal(ledger.metadata.source_sha256, metadata.source_sha256);
  assert.equal(Object.keys(ledger.question_support).length, 153);
  const review = await readJson('../question-packs/remaining-review.json');
  assert.equal(review.metadata.reviewed_items, 63);
  assert.equal(review.metadata.source_image_count, 35);
  assert.equal(review.metadata.resolved_items, 15);
  assert.equal(review.metadata.pending_items, 48);
  assert.equal(review.metadata.added_questions, 9);
  assert.equal(review.metadata.total_questions, 662);
  assert.equal(review.metadata.validation_status, 'auto_checked');
  assert.equal(review.metadata.human_approved, false);
  assert.equal(review.metadata.source_sha256, metadata.source_sha256);
  assert.equal(review.entries.length, 63);
  assert.equal(new Set(review.entries.map(e => e.knowledge_id)).size, 63);
  const reviewByKnowledge = new Map(review.entries.map(e => [e.knowledge_id, e]));
  const referenceIds = new Set(review.references.map(e => e.reference_id));
  for (const entry of review.entries) {
    const current = byKnowledge.get(entry.knowledge_id);
    assert.ok(current);
    assert.equal(entry.source_image_rechecked, true);
    assert.equal(entry.effective_needs_review, entry.source_needs_review_original && entry.outcome !== 'resolved');
    assert.ok(entry.source_pages.length);
    assert.equal(entry.status, current.status);
    assert.deepEqual(entry.question_ids, current.question_ids);
    const resolved = !current.status.startsWith('deferred') && current.status !== 'adapted';
    assert.equal(entry.outcome, resolved ? 'resolved' : 'pending');
    assert.equal(entry.eligible_after_recheck, resolved);
    if (!resolved) assert.ok(entry.next_action.trim());
    for (const ref of entry.reference_ids) assert.ok(referenceIds.has(ref));
  }
  assert.equal(review.entries.filter(e => e.outcome === 'resolved').length, 15);
  assert.equal(review.entries.filter(e => e.outcome === 'pending').length, 48);
  for (const kid of clearedReviewIds) {
    const entry = reviewByKnowledge.get(kid);
    assert.equal(entry.source_needs_review_original, true);
    assert.equal(entry.source_image_rechecked, true);
    assert.equal(entry.outcome, 'resolved');
    assert.equal(entry.effective_needs_review, false);
    assert.equal(entry.review_resolution, 'source_rechecked');
    assert.ok(entry.verified_knowledge.trim());
    assert.ok(entry.reference_ids.some(ref => ref.startsWith('SOURCE-P')));
  }
  assert.equal(summary.source_review_resolved, clearedReviewIds.size);
  assert.equal(summary.source_review_open, unresolvedReviewIds.size);

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
    assert.ok(!unresolvedReviewIds.has(q.knowledge_id));
    if (reviewIds.has(q.knowledge_id)) assert.ok(clearedReviewIds.has(q.knowledge_id));
    assert.doesNotMatch(q.question + '\n' + q.explanation, /教材/);
    answerCounts[q.correct_index] += 1;
    if (index >= 150) {
      assert.match(q.explanation, /^【要点】[^\n]+\n【解説】[^\n]+\n【整理】[^\n]+$/u);
      assert.ok([...q.explanation].length <= 650);
    }
    if (index < 500 || index >= 653) continue;
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
  const addedIds = ['K0006', 'K0008', 'K0111', 'K0560', 'K0568', 'K0625', 'K0718', 'K0784', 'K0861'];
  assert.deepEqual(original.questions.slice(653).map(q => q.knowledge_id), addedIds);
  const supplements = ledger.supplemental_question_support;
  assert.equal(Object.keys(supplements).length, 9);
  const previousIds = new Set(original.questions.slice(0, 653).map(q => q.knowledge_id));
  for (const q of original.questions.slice(653)) {
    assert.ok(!previousIds.has(q.knowledge_id));
    const source = byKnowledge.get(q.knowledge_id);
    assert.equal(q.country, source.country);
    assert.deepEqual(q.countries, source.countries);
    assert.equal(q.source_page, source.source_page);
    const evidence = supplements[q.question_id];
    assert.ok(evidence);
    assert.equal(evidence.knowledge_ids[0], q.knowledge_id);
    assert.equal(evidence.validation_status, 'auto_checked');
    assert.equal(evidence.human_approved, false);
    assert.ok(evidence.verified_scope.trim() && evidence.source_locator.trim());
    assert.ok(evidence.single_answer_check.trim() && evidence.semantic_duplicate_check.trim());
    for (const ref of evidence.reference_ids) assert.ok(referenceIds.has(ref));
    for (const kid of evidence.knowledge_ids) {
      assert.equal(reviewByKnowledge.get(kid).outcome, 'resolved');
      assert.ok(byKnowledge.get(kid).question_ids.includes(q.question_id));
      assert.ok(!unresolvedReviewIds.has(kid));
    }
  }
  for (const [kid, year] of [['K0006', '2017'], ['K0008', '2017'], ['K0111', '2017'], ['K0568', '2017'], ['K0784', '2017'], ['K0861', '2018']]) {
    assert.ok(byQuestion.get('Q-' + kid + '-01').question.includes(year));
  }
  assert.deepEqual(answerCounts, [221, 221, 220]);
  assert.deepEqual(metadata.correct_index_counts, { 0: 221, 1: 221, 2: 220 });
  assert.doesNotMatch(text, /https?:\/\/|drive\.google\.com|IMG\d+|"surrounding_text"|"source_knowledge"|"sources"/);
  assert.doesNotMatch(JSON.stringify(ledger), /https?:\/\/|drive\.google\.com|IMG\d+|"surrounding_text"|"source_knowledge"|"sources"/);
  assert.doesNotMatch(JSON.stringify(review), /drive\.google\.com|IMG\d+|"surrounding_text"|"source_knowledge"/);
  console.log(DEFAULT_PACK_FILENAME + ': 662問・既存653問保持・9問追加・63項目中15項目補完／48項目保留・14バッチ一致・2MB以内を確認しました。');
} catch (error) {
  console.error(DEFAULT_PACK_FILENAME + ' の検証に失敗しました: ' + error.message);
  process.exitCode = 1;
}
