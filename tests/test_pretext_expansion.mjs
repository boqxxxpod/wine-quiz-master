import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseQuestionPack } from '../static/pages.js';
import { BookmarkStore } from '../static/bookmarks.js';
import { QuizSession } from '../static/quiz.js';

const read = name => readFile(new URL(`../question-packs/${name}`, import.meta.url), 'utf8');
const pack = JSON.parse(await read('wine-quiz-pretext.json'));
const reviewText = await read('pretext-expansion-review.json');
const review = JSON.parse(reviewText);
const coverage = JSON.parse(await read('pretext-coverage.json'));
const practice = parseQuestionPack(await read('wine-quiz-practice-20261031.json'));
const parsed = parseQuestionPack(JSON.stringify(pack));
const byQuestion = new Map(pack.questions.map(row => [row.question_id, row]));
const parsedByQuestion = new Map(parsed.questions.map(row => [row.id, row]));
const byEvidence = new Map(review.evidence.map(row => [row.id, row]));
const byItem = new Map(coverage.items.map(row => [row.id, row]));
const practiceIds = new Set(practice.questions.map(row => row.id));
const baseIds = new Set(review.metadata.base_question_ids);
const digest = value => createHash('sha256').update(value).digest('hex');

test('the expansion preserves all 235 stable questions except explicitly recorded field corrections', () => {
  assert.equal(review.metadata.base_commit, '6c924ef4ad128e9a6ee37ae6204a76f98dff6d2b');
  assert.equal(review.metadata.base_question_count, 235);
  assert.equal(baseIds.size, 235);
  const corrections = new Map(review.corrections.map(row => [row.question_id, row]));
  assert.equal(corrections.size, review.corrections.length);
  const restored = review.metadata.base_question_ids.map(id => {
    assert.ok(byQuestion.has(id), `lost existing question ${id}`);
    const row = structuredClone(byQuestion.get(id));
    const correction = corrections.get(id);
    if (correction) {
      assert.ok(correction.reason.trim());
      assert.ok(correction.evidence_ids.length > 0);
      for (const [key, value] of Object.entries(correction.after)) assert.deepEqual(row[key], value);
      Object.assign(row, correction.before);
      for (const key of correction.absent_before) delete row[key];
    }
    return row;
  });
  const baselineHash = '6242804053b4178797b6fbd282b5bcfd4d60d88aa50232785e517eac59567674';
  assert.equal(digest(JSON.stringify(restored)), baselineHash);
  assert.equal(review.metadata.base_questions_sha256, baselineHash);
  assert.equal(review.metadata.corrected_question_count, review.corrections.length);
  assert.equal(review.metadata.added_question_count, review.additions.length);
  assert.equal(pack.questions.length, 235 + review.additions.length);
  assert.equal(review.metadata.question_count, pack.questions.length);
});

test('the meaning comparison covers all 196 source items and links additions to reviewed textbook pages', () => {
  assert.equal(review.items.length, 196);
  assert.equal(new Set(review.items.map(row => row.id)).size, 196);
  const units = [];
  for (const item of review.items) {
    assert.ok(byItem.has(item.id));
    assert.equal(item.country, byItem.get(item.id).country);
    assert.ok(item.knowledge_units.length > 0, item.id);
    for (const unit of item.knowledge_units) {
      units.push(unit);
      assert.ok(unit.id.startsWith(item.id));
      assert.ok(unit.fact.trim());
      assert.ok(unit.reason.trim());
      assert.ok(['direct', 'supporting', 'name_only', 'absent'].includes(unit.practice_status));
      assert.ok(['already_in_practice', 'already_in_pretext', 'add', 'hold'].includes(unit.decision));
      for (const id of unit.practice_question_ids) assert.ok(practiceIds.has(id), id);
      for (const id of unit.pretext_question_ids) assert.ok(baseIds.has(id), id);
      for (const id of unit.evidence_ids) assert.ok(byEvidence.has(id), id);
      if (unit.decision === 'already_in_practice') assert.ok(unit.practice_question_ids.length > 0);
      if (unit.decision === 'already_in_pretext') assert.ok(unit.pretext_question_ids.length > 0);
      if (unit.decision === 'add') {
        assert.notEqual(unit.practice_status, 'direct', `${unit.id}: already directly tested`);
        assert.ok(unit.new_question_ids.length > 0);
      }
      for (const id of unit.new_question_ids) {
        assert.ok(byQuestion.has(id), id);
        assert.equal(baseIds.has(id), false);
        assert.ok(byQuestion.get(id).source_item_ids.includes(item.id));
      }
    }
  }
  assert.equal(new Set(units.map(row => row.id)).size, units.length);
  assert.equal(review.metadata.knowledge_unit_count, units.length);
  const decisions = Object.fromEntries(['already_in_practice', 'already_in_pretext', 'add', 'hold']
    .map(status => [status, units.filter(row => row.decision === status).length]));
  assert.deepEqual(review.metadata.decision_counts, decisions);
  const newIds = new Set(review.additions.map(row => row.question_id));
  assert.equal(newIds.size, review.additions.length);
  for (const id of newIds) {
    assert.equal(baseIds.has(id), false);
    const row = byQuestion.get(id);
    assert.ok(row, id);
    const pageEvidence = row.evidence_ids.map(evidenceId => byEvidence.get(evidenceId))
      .filter(evidence => evidence?.kind === 'textbook_page');
    assert.ok(pageEvidence.some(evidence => evidence.textbook_pages.length > 0), id);
    // A paragraph read directly from an original page may have no ID in the old transcription.
    // Require its explicit source page instead of inventing an unrelated knowledge ID.
    if (row.textbook_knowledge_ids.length === 0) {
      assert.ok(pageEvidence.some(evidence => evidence.knowledge_ids.length === 0 &&
        /未転記|独立.*ID|単独.*ID|原画像/.test(evidence.finding)), id);
    }
    assert.ok(units.some(unit => unit.decision === 'add' && unit.new_question_ids.includes(id)), id);
    for (const evidenceId of row.evidence_ids) assert.ok(byEvidence.has(evidenceId), evidenceId);
  }
});

test('all 57 previously unresolved items retain their history and an explicit recheck result', () => {
  assert.equal(review.metadata.previous_rechecks.length, 57);
  assert.equal(review.rechecks.length, 57);
  assert.equal(new Set(review.rechecks.map(row => row.id)).size, 57);
  const previous = new Map(review.metadata.previous_rechecks.map(row => [row.id, row]));
  assert.equal([...previous.values()].filter(row => row.status === 'partial').length, 43);
  assert.equal([...previous.values()].filter(row => row.status === 'held').length, 14);
  for (const row of review.rechecks) {
    const before = previous.get(row.id);
    assert.ok(before, row.id);
    assert.equal(row.previous_status, before.status);
    assert.equal(row.previous_held_details, before.held_details);
    assert.ok(row.finding.trim());
    assert.ok(row.decision.trim());
    assert.equal(typeof row.remaining_held_details, 'string');
    if (byItem.get(row.id).country !== 'ドイツ') {
      assert.ok(row.textbook_pages.length > 0, row.id);
      assert.ok(row.reviewed_evidence_ids.length > 0, row.id);
      if (row.textbook_knowledge_ids.length === 0) {
        assert.equal(row.fact_resolution, 'unresolved', row.id);
        assert.equal(row.new_question_ids.length, 0, row.id);
        assert.ok(row.remaining_held_details.trim(), row.id);
      }
    } else {
      assert.equal(row.fact_resolution, 'source_missing');
      assert.ok(row.remaining_held_details.trim());
      assert.equal(row.new_question_ids.length, 0);
    }
    for (const id of row.reviewed_evidence_ids) assert.ok(byEvidence.has(id), id);
    for (const id of row.new_question_ids) assert.ok(review.additions.some(q => q.question_id === id));
  }
  assert.doesNotMatch(reviewText, /drive\.google\.com|sediment:\/\/|IMG\d{8,}|"(?:download_url|b64_string)"/);
  assert.doesNotMatch(JSON.stringify(pack), /drive\.google\.com|sediment:\/\/|IMG\d{8,}|"(?:download_url|b64_string)"/);
});

test('new and corrected questions preserve ID-based scoring and existing bookmark identities', () => {
  const storage = new Map();
  const store = new BookmarkStore({ getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) });
  const ids = [...review.additions.map(row => row.question_id), ...review.corrections.map(row => row.question_id)];
  assert.ok(ids.length > 0);
  for (const id of ids) {
    const original = byQuestion.get(id);
    const session = new QuizSession([parsedByQuestion.get(id)], () => 0.25);
    const correct = session.current.choices.find(choice => choice.id === session.current.correct_choice_id);
    assert.equal(correct.text, original.correct_answer);
    assert.equal(session.answer(correct.id).correct, true);
    store.toggle('bundled:pretext', id);
    assert.equal(store.has('bundled:pretext', id), true);
    assert.equal(store.has('bundled:practice', id), false);
  }
});
