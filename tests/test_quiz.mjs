import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseQuestionPack } from '../static/pages.js';

const code = await readFile(new URL('../static/quiz.js', import.meta.url), 'utf8');
const { QuizSession, shuffle, validQuestion, countryCounts, availableCountries, questionsForCountry } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

function question(id) {
  return {
    id, prompt: `テスト用 ${id}`, choices: [{ id: 'a', text: '甲' }, { id: 'b', text: '乙' }, { id: 'c', text: '丙' }],
    correct_choice_id: 'b', explanation: '検証用解説', quote: '検証用の引用', file_name: 'test.png', source_id: 'source-test', region_id: 'region-test',
  };
}

test('Fisher–Yates preserves every item and never mutates the source', () => {
  const original = [1, 2, 3, 4];
  const result = shuffle(original, () => 0);
  assert.deepEqual(original, [1, 2, 3, 4]);
  assert.deepEqual([...result].sort(), original);
  assert.notDeepEqual(result, original);
});

test('one complete round includes each saved question once', () => {
  const session = new QuizSession([question('1'), question('2'), question('3')], () => 0);
  const ids = [];
  while (session.current) {
    ids.push(session.current.id);
    assert.equal(session.next(), false, 'cannot skip an unanswered question');
    session.answer('b');
    assert.equal(session.next(), true);
  }
  assert.equal(new Set(ids).size, 3);
  assert.equal(session.score, 3);
  assert.equal(session.complete, true);
});

test('shuffled choices retain correct scoring and answer cannot be changed', () => {
  const session = new QuizSession([question('1')], () => 0);
  assert.deepEqual(session.current.choices.map(choice => choice.id), ['b', 'c', 'a']);
  assert.equal(session.answer('a').correct, false);
  assert.equal(session.answer('b'), null);
  assert.equal(session.selectedId, 'a');
  assert.equal(session.score, 0);
  assert.equal(session.answers.length, 1);
});

test('restart clears answers and shuffles a new full round', () => {
  let calls = 0;
  const session = new QuizSession([question('1'), question('2')], () => { calls += 1; return calls % 2 ? 0 : 0.9; });
  session.answer('b');
  session.next();
  session.answer('b');
  session.next();
  const priorCalls = calls;
  session.restart();
  assert.ok(calls > priorCalls);
  assert.equal(session.score, 0);
  assert.equal(session.index, 0);
  assert.equal(session.answered, false);
  assert.equal(session.total, 2);
  assert.ok(session.current);
});

test('rejects ambiguous answer IDs, invalid sources, and duplicate question IDs', () => {
  assert.equal(validQuestion({ ...question('bad'), choices: [{ id: 'b', text: '甲' }, { id: 'b', text: '乙' }, { id: 'c', text: '丙' }] }), false);
  assert.equal(validQuestion({ ...question('bad'), correct_choice_id: 'missing' }), false);
  assert.equal(validQuestion({ ...question('bad'), region_id: '' }), false);
  const session = new QuizSession([question('1'), question('1'), { ...question('bad'), quote: '' }]);
  assert.equal(session.total, 1);
  assert.equal(session.answer('not-a-choice'), null);
  assert.equal(session.answered, false);
});

test('empty data never displays a fictitious question', () => {
  const session = new QuizSession([]);
  assert.equal(session.current, null);
  assert.equal(session.complete, false);
  assert.equal(session.answer('a'), null);
});


// These rows are synthetic parser/session fixtures, not bundled study material.
function nativeQuestion(id, countries = ['フランス']) {
  return {
    id, question: `検証専用 ${id}`,
    options: [{ id: 'a', text: '検証 A' }, { id: 'b', text: '検証 B' }, { id: 'c', text: '検証 C' }],
    correct_option_id: 'b', explanation: 'テスト専用の解説',
    primary_country: countries[0], countries,
    sources: [{ image_filename: 'synthetic-fixture.png', page: 2, position: '上部', url: 'https://example.com/test' }],
    validation: { checked: true, notes: ['テスト専用記録'] },
  };
}

test('native questions need their own sources and countries without invented legacy IDs', () => {
  const row = nativeQuestion('native');
  assert.equal(validQuestion(row), true);
  const session = new QuizSession([row], () => 0);
  assert.equal(session.current.prompt, row.question);
  assert.deepEqual(session.current.choices.map(choice => choice.id), ['b', 'c', 'a']);
  assert.equal(session.answer('b').correct, true);
  assert.deepEqual(session.current.sources, row.sources);
  assert.equal(Object.hasOwn(session.current, 'quote'), false);
  assert.equal(Object.hasOwn(session.current, 'region_id'), false);
});

test('country scopes include cross-country questions once and persist across restart', () => {
  const rows = [
    nativeQuestion('france', ['フランス']),
    nativeQuestion('italy', ['イタリア']),
    nativeQuestion('shared', ['フランス', 'イタリア']),
    nativeQuestion('shared', ['フランス', 'イタリア']),
  ];
  assert.deepEqual([...countryCounts(rows)], [['フランス', 2], ['イタリア', 2]]);
  assert.deepEqual(new Set(availableCountries(rows)), new Set(['フランス', 'イタリア']));
  assert.deepEqual(questionsForCountry(rows, 'イタリア').map(row => row.id), ['italy', 'shared']);
  const session = new QuizSession(rows, () => 0, 'フランス');
  const ids = [];
  while (session.current) {
    ids.push(session.current.id);
    session.answer('b');
    session.next();
  }
  assert.equal(session.total, 2);
  assert.deepEqual(new Set(ids), new Set(['france', 'shared']));
  assert.equal(session.score, 2);
  session.restart();
  assert.equal(session.country, 'フランス');
  assert.equal(session.total, 2);
  assert.equal(session.score, 0);
  assert.equal(session.answered, false);
  session.restart('イタリア');
  assert.equal(session.total, 2);
  assert.deepEqual(new Set(session.order.map(row => row.id)), new Set(['italy', 'shared']));
  session.restart(null);
  assert.equal(session.total, 3);
});

test('a country with no questions stays empty without falling back to another range', () => {
  const session = new QuizSession([nativeQuestion('one')], () => 0, '未登録の国');
  assert.equal(session.total, 0);
  assert.equal(session.current, null);
  assert.equal(session.complete, false);
  session.restart();
  assert.equal(session.total, 0);
});

test('null and malformed options are rejected safely by validation and sessions', () => {
  const native = nativeQuestion('invalid');
  for (const row of [null, undefined, 3, [], { ...question('bad'), choices: [null, {}, {}] },
    { ...native, options: [null, {}, {}] }, { ...native, sources: [null] },
    { ...native, countries: ['フランス', null] }, { ...native, validation: null }]) {
    assert.equal(validQuestion(row), false);
    assert.equal(new QuizSession([row]).total, 0);
  }
  assert.equal(new QuizSession(null).total, 0);
  assert.deepEqual([...countryCounts(null)], []);
  assert.deepEqual(questionsForCountry(null), []);
});

test('registered pilot data derives country membership from rows and scores every shuffled scope by stable IDs', async () => {
  const text = await readFile(new URL('../question-packs/pilot-150.json', import.meta.url), 'utf8');
  const original = JSON.parse(text);
  const { questions, metadata } = parseQuestionPack(text);
  const expectedCounts = new Map([
    ['フランス', 32], ['スペイン', 16], ['イタリア', 17], ['日本', 17],
    ['アメリカ', 11], ['オーストラリア', 11], ['ポルトガル', 11], ['オーストリア', 8],
    ['ニュージーランド', 7], ['アルゼンチン', 7], ['南アフリカ', 7], ['チリ', 7],
  ]);
  assert.deepEqual(countryCounts(questions), expectedCounts);
  assert.equal(metadata.country_counts['スペイン'], 15, 'recorded count is preserved');
  assert.equal(countryCounts(questions).get('スペイン'), 16, 'actual memberships determine the range');
  const originalsById = new Map(original.questions.map(row => [row.question_id, row]));
  for (const [country, count] of [[null, 150], ...expectedCounts]) {
    const session = new QuizSession(questions, () => 0, country);
    const ids = [];
    assert.equal(session.total, count);
    while (session.current) {
      const row = session.current;
      assert.equal(validQuestion(row), true);
      if (country !== null) assert.ok(row.countries.includes(country));
      ids.push(row.id);
      const source = originalsById.get(row.id);
      const correct = row.choices.find(choice => choice.text === source.correct_answer);
      assert.ok(correct);
      assert.equal(session.answer(correct.id).correct, true, `${row.id} remains correctly scored after shuffling`);
      assert.equal(session.answer(correct.id), null);
      session.next();
    }
    assert.equal(new Set(ids).size, count);
    assert.equal(session.score, count);
    assert.equal(session.complete, true);
    if (country === 'フランス' || country === 'スペイン') assert.ok(ids.includes('Q-K0019-01'));
    session.restart();
    assert.equal(session.country, country);
    assert.equal(session.total, count);
    assert.equal(session.score, 0);
    assert.equal(session.answers.length, 0);
  }
  const rawSession = new QuizSession(original.questions, () => 0);
  assert.equal(rawSession.total, 150, 'raw pilot rows normalize before ID deduplication');
  assert.equal(rawSession.current.format, 'pilot');
  assert.deepEqual(original, JSON.parse(text), 'source rows are never mutated by normalization or play');
});
