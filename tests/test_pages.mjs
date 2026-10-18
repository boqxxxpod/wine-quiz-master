import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuestionPack, MAX_PACK_BYTES, MAX_PACK_QUESTIONS } from '../static/pages.js';

const question = (id = 'question-1') => ({
  id, prompt: 'JSON 形式を検証するためのテストです。',
  choices: [{ id: 'a', text: 'テスト選択肢 A' }, { id: 'b', text: 'テスト選択肢 B' }, { id: 'c', text: 'テスト選択肢 C' }],
  correct_choice_id: 'b', explanation: '検証専用の解説です。',
  source_id: 'test-source', file_name: '検証専用.png', region_id: 'test-region', quote: '検証専用の引用',
});
const pack = questions => JSON.stringify({ version: 1, questions });

test('valid approved exports preserve scoring and provenance and discard other fields', () => {
  const original = question();
  const result = parseQuestionPack(pack([{ ...original, status: 'approved', extra: 'not retained', choices: original.choices.map(choice => ({ ...choice, extra: 'not retained' })) }]));
  assert.deepEqual(result, { version: 1, questions: [original] });
});

test('nested source data from the API is normalized', () => {
  const original = question();
  const row = { ...original, source: { id: original.source_id, file_name: original.file_name } };
  delete row.source_id;
  delete row.file_name;
  assert.deepEqual(parseQuestionPack(pack([row])).questions[0], original);
});

test('rejects malformed and unsupported exports', () => {
  for (const value of ['not JSON', 'null', '[]', '{}', '{"version":2,"questions":[]}', '{"version":1,"questions":{}}']) {
    assert.throws(() => parseQuestionPack(value));
  }
  assert.deepEqual(parseQuestionPack(pack([])), { version: 1, questions: [] });
});

test('rejects duplicate question IDs and ambiguous choices', () => {
  assert.throws(() => parseQuestionPack(pack([question(), question()])), /問題 ID/);
  const repeatedText = question();
  repeatedText.choices[1].text = ` ${repeatedText.choices[0].text} `;
  assert.throws(() => parseQuestionPack(pack([repeatedText])), /同じ内容/);
  const repeatedId = question();
  repeatedId.choices[1].id = 'a';
  assert.throws(() => parseQuestionPack(pack([repeatedId])), /三択/);
  assert.throws(() => parseQuestionPack(pack([{ ...question(), correct_choice_id: 'missing' }])), /三択/);
});

test('rejects missing provenance and questions explicitly awaiting review', () => {
  for (const key of ['quote', 'file_name', 'source_id', 'region_id', 'explanation']) {
    assert.throws(() => parseQuestionPack(pack([{ ...question(), [key]: '' }])));
    assert.throws(() => parseQuestionPack(pack([{ ...question(), [key]: '   ' }])));
  }
  assert.throws(() => parseQuestionPack(pack([{ ...question(), status: 'pending_review' }])), /承認済み/);
});

test('rejects the entire pack if any entry is invalid without mutating existing data', () => {
  const previous = parseQuestionPack(pack([question('previous')]));
  const before = JSON.stringify(previous);
  assert.throws(() => parseQuestionPack(pack([question('new'), { ...question('bad'), quote: '' }])));
  assert.equal(JSON.stringify(previous), before);
});

test('enforces UTF-8 byte size and question count limits', () => {
  assert.throws(() => parseQuestionPack('あ'.repeat(Math.ceil(MAX_PACK_BYTES / 3))), /2 MB/);
  assert.throws(() => parseQuestionPack(pack(Array.from({ length: MAX_PACK_QUESTIONS + 1 }, (_, index) => question(String(index))))), /2,000/);
});
