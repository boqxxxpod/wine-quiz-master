import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const code = await readFile(new URL('../static/quiz.js', import.meta.url), 'utf8');
const { QuizSession, shuffle, validQuestion } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

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
