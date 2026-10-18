import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuestionPack, loadDefaultQuestionPack, DEFAULT_PACK_FILENAME, MAX_PACK_BYTES, MAX_PACK_QUESTIONS } from '../static/pages.js';

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
  for (const value of ['not JSON', 'null', '{}', '{"version":2,"questions":[]}', '{"version":1,"questions":{}}']) {
    assert.throws(() => parseQuestionPack(value));
  }
  assert.deepEqual(parseQuestionPack(pack([])), { version: 1, questions: [] });
  assert.deepEqual(parseQuestionPack('[]'), { version: 1, questions: [] });
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


// Deliberately synthetic fixtures; no missing attachment content is approximated.
const nativeQuestion = (id = 'synthetic-native') => ({
  id, type: 'single_choice', question: '新形式を検証するためのテストです。',
  options: [{ id: 'a', text: '検証 A' }, { id: 'b', text: '検証 B' }, { id: 'c', text: '検証 C' }],
  correct_option_id: 'b', explanation: 'テスト専用の解説です。',
  primary_country: 'フランス', countries: ['フランス', 'イタリア'],
  sources: [
    { image_filename: 'synthetic-test-1.png', page: 3, position: { x: 10, y: 20 }, url: 'https://example.com/first', extra: { notes: ['検証用'] } },
    { filename: 'synthetic-test-2.png', page: 4, position: '中央', url: 'https://example.com/second' },
  ],
  validation: { checked: false, result: 'test-only', notes: ['記録をそのまま保持'], detail: { reviewer: null } },
});

test('native arrays preserve every source and validation field without invented provenance', () => {
  const original = nativeQuestion();
  const result = parseQuestionPack(JSON.stringify([original]));
  const normalized = result.questions[0];
  assert.deepEqual(normalized, {
    ...original, prompt: original.question, choices: original.options, correct_choice_id: original.correct_option_id,
  });
  for (const key of ['quote', 'file_name', 'source_id', 'region_id']) assert.equal(Object.hasOwn(normalized, key), false);
  assert.equal(normalized.validation.checked, false, 'recorded validation is metadata, not an approval gate');
});

test('native questions allow absent optional type and validation metadata', () => {
  const row = nativeQuestion();
  delete row.type;
  delete row.validation;
  assert.equal(parseQuestionPack(JSON.stringify([row])).questions.length, 1);
});

test('native malformed records reject the entire file rather than silently dropping questions', () => {
  const previous = parseQuestionPack(JSON.stringify([nativeQuestion('previous')]));
  const before = JSON.stringify(previous);
  const invalid = [
    null,
    { ...nativeQuestion(), options: [null, { id: 'b', text: 'B' }, { id: 'c', text: 'C' }] },
    { ...nativeQuestion(), options: nativeQuestion().options.map(option => ({ ...option, id: 'a' })) },
    { ...nativeQuestion(), correct_option_id: 'missing' },
    { ...nativeQuestion(), explanation: ' ' },
    { ...nativeQuestion(), sources: [] },
    { ...nativeQuestion(), sources: [null] },
    { ...nativeQuestion(), sources: [{}] },
    { ...nativeQuestion(), countries: [] },
    { ...nativeQuestion(), countries: ['イタリア'] },
    { ...nativeQuestion(), countries: ['フランス', ' '] },
    { ...nativeQuestion(), validation: null },
    { ...nativeQuestion(), type: 'multi_choice' },
    { ...nativeQuestion(), question_type: 'multi_choice' },
  ];
  for (const bad of invalid) {
    assert.throws(() => parseQuestionPack(JSON.stringify([nativeQuestion('valid-first'), bad])), /ファイル全体/);
  }
  assert.equal(JSON.stringify(previous), before);
  assert.throws(() => parseQuestionPack(JSON.stringify([nativeQuestion(), nativeQuestion()])), /問題 ID/);
  const repeatedText = nativeQuestion();
  repeatedText.options[1].text = ` ${repeatedText.options[0].text} `;
  assert.throws(() => parseQuestionPack(JSON.stringify([repeatedText])), /同じ内容/);
});

test('default loading resolves the bundle beside the module, including nested site deployments', async () => {
  let requested;
  const expected = new URL(`../static/${DEFAULT_PACK_FILENAME}`, import.meta.url);
  const result = await loadDefaultQuestionPack(async url => {
    requested = url;
    return { ok: true, text: async () => JSON.stringify([nativeQuestion()]) };
  });
  assert.equal(String(requested), String(expected));
  assert.equal(result.questions.length, 1);
});

test('default loading reports HTTP, network and parse errors without substituting test data', async () => {
  for (const fetcher of [
    async () => ({ ok: false, status: 404 }),
    async () => { throw new Error('network offline'); },
    async () => ({ ok: true, text: async () => 'invalid JSON' }),
    async () => ({ ok: true, text: async () => JSON.stringify([nativeQuestion(), nativeQuestion()]) }),
  ]) {
    await assert.rejects(loadDefaultQuestionPack(fetcher), error => error.message.includes(DEFAULT_PACK_FILENAME));
  }
  const empty = await loadDefaultQuestionPack(async () => ({ ok: true, text: async () => '[]' }));
  assert.deepEqual(empty.questions, []);
});
