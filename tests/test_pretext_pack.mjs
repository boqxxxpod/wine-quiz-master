import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseQuestionPack } from '../static/pages.js';
import { countryCounts } from '../static/quiz.js';

const read = name => readFile(new URL(`../question-packs/${name}`, import.meta.url), 'utf8');
const original = JSON.parse(await read('wine-quiz-pretext.json'));
const bank = parseQuestionPack(JSON.stringify(original));
const coverage = JSON.parse(await read('pretext-coverage.json'));
const source = await read('pretext-source.txt');
const countries = ['日本', 'フランス', 'イタリア', 'ドイツ', 'スペイン', 'ポルトガル', 'オーストリア',
  'アメリカ', 'チリ', 'アルゼンチン', 'オーストラリア', 'ニュージーランド', '南アフリカ'];
const byQuestion = new Map(bank.questions.map(row => [row.id, row]));
const byItem = new Map(coverage.items.map(item => [item.id, item]));

test('pretext is an independent, honestly labelled 13-country bank with consistent counts', async () => {
  assert.equal(bank.metadata.title, '事前テキスト');
  assert.equal(bank.metadata.question_count, bank.questions.length);
  assert.deepEqual(bank.metadata.country_counts, Object.fromEntries(countryCounts(bank.questions)));
  assert.deepEqual(Object.keys(bank.metadata.country_counts).sort(), [...countries].sort());
  assert.equal(new Set(bank.questions.map(row => row.knowledge_id)).size, bank.questions.length);
  assert.equal(new Set(bank.questions.map(row => row.prompt.replace(/\s+/g, ''))).size, bank.questions.length);
  for (const filename of ['wine-quiz-practice-20261031.json', 'wine-quiz-highlighted.json']) {
    const existing = parseQuestionPack(await read(filename));
    for (const row of existing.questions) assert.equal(byQuestion.has(row.id), false);
  }
  for (const row of bank.questions) {
    assert.equal(row.question_type, 'single_choice');
    assert.equal(row.source_verbatim, false);
    assert.equal(row.status, 'auto_checked');
    assert.equal(row.validation.structure_checked, true);
    assert.equal(row.validation.source_text_compared, true);
    assert.equal(row.validation.human_approved, false);
    assert.equal(row.validation.external_fact_check_completed, false);
    assert.equal(Object.hasOwn(row, 'source_image'), false);
    assert.equal(Object.hasOwn(row.validation, 'answer_key_compared'), false);
    assert.ok(row.validation.editorial_note.trim());
    assert.equal(row.choices.find(choice => choice.id === row.correct_choice_id).text, row.correct_answer);
  }
  assert.equal(bank.metadata.human_approved, false);
  assert.equal(bank.metadata.external_fact_check_completed, false);
});

test('every source item has a traceable outcome and every question is supported in both directions', () => {
  assert.equal(coverage.items.length, 196);
  assert.equal(byItem.size, coverage.items.length);
  const digest = createHash('sha256').update(source).digest('hex');
  assert.equal(coverage.metadata.source_sha256, digest);
  assert.equal(bank.metadata.source_sha256, digest);
  assert.equal(bank.metadata.source_item_count, coverage.items.length);
  const lines = source.split(/\r?\n/);
  const statuses = { question: 0, explanation: 0, partial: 0, held: 0 };
  for (const item of coverage.items) {
    assert.ok(Object.hasOwn(statuses, item.status), item.id);
    statuses[item.status]++;
    assert.equal(lines[item.source_line - 1].trim(), item.source_text);
    assert.ok(countries.includes(item.country));
    assert.ok(item.note.trim(), item.id);
    assert.equal(new Set(item.question_ids).size, item.question_ids.length);
    if (item.status === 'held') assert.deepEqual(item.question_ids, []);
    else assert.ok(item.question_ids.length > 0, item.id);
    if (['partial', 'held'].includes(item.status)) assert.ok(item.held_details?.trim(), item.id);
    for (const id of item.question_ids) {
      assert.ok(byQuestion.has(id), `${item.id}: missing ${id}`);
      assert.ok(byQuestion.get(id).source_item_ids.includes(item.id), `${item.id}: missing reverse reference`);
    }
  }
  assert.deepEqual(coverage.metadata.status_counts, statuses);
  assert.deepEqual(bank.metadata.coverage_status_counts, statuses);
  assert.ok(statuses.partial + statuses.held > 0, 'unresolved statistics must remain visible');
  for (const row of bank.questions) {
    assert.ok(row.source_item_ids.length > 0, row.id);
    assert.equal(new Set(row.source_item_ids).size, row.source_item_ids.length);
    for (const id of row.source_item_ids) {
      const item = byItem.get(id);
      assert.ok(item, `${row.id}: missing ${id}`);
      assert.equal(item.country, row.country);
      assert.ok(item.question_ids.includes(row.id), `${row.id}: missing reverse reference`);
    }
  }
  for (const reference of coverage.references) {
    assert.match(reference.url, /^https:\/\//);
    assert.ok(reference.scope.trim());
    assert.ok(reference.finding.trim());
    assert.ok(reference.source_item_ids.length > 0);
    for (const id of reference.source_item_ids) assert.ok(byItem.has(id), id);
  }
});

test('pretext includes US error selection and traceable geography questions for all three countries', () => {
  const errors = bank.questions.filter(row => row.country === 'アメリカ' && /誤っている.*1つ/.test(row.prompt));
  assert.ok(errors.length > 0);
  for (const row of errors) assert.match(row.explanation, /正しく|誤り|ではなく|反対|異な|逆/);
  for (const country of ['フランス', 'イタリア', 'スペイン']) {
    const item = coverage.items.find(item => item.country === country && /^(?:・地図|地理)/.test(item.source_text));
    assert.ok(item, country);
    assert.equal(item.status, 'question');
    assert.ok(item.question_ids.some(id => /位置|北|南|東|西|内陸|沿岸/.test(byQuestion.get(id).prompt)));
  }
});
