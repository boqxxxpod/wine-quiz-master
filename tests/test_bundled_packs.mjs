import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BUNDLED_PACKS, parseQuestionPack, MAX_PACK_BYTES } from '../static/pages.js';
import { QuizSession, countryCounts, PRACTICE_COUNTS } from '../static/quiz.js';

const expectedPracticeCounts = {
  日本:21, フランス:50, イタリア:27, ドイツ:14, スペイン:22, ポルトガル:12, オーストリア:11,
  アメリカ:18, チリ:10, アルゼンチン:10, オーストラリア:15, ニュージーランド:9, 南アフリカ:11,
};
const banks = await Promise.all(BUNDLED_PACKS.map(async pack => {
  const text = await readFile(new URL(`../question-packs/${pack.filename}`, import.meta.url), 'utf8');
  return { ...pack, text, original:JSON.parse(text), parsed:parseQuestionPack(text) };
}));
const practice = banks.find(bank => bank.id === 'practice');

test('the bundled practice file contains the created 230 questions and exact 13-country counts', () => {
  assert.ok(Buffer.byteLength(practice.text) < MAX_PACK_BYTES);
  assert.equal(practice.parsed.questions.length, 230);
  assert.equal(practice.original.metadata.question_count, 230);
  assert.deepEqual(practice.original.metadata.country_counts, expectedPracticeCounts);
  assert.deepEqual(Object.fromEntries(countryCounts(practice.parsed.questions)), expectedPracticeCounts);
  assert.equal(new Set(practice.parsed.questions.map(row => row.knowledge_id)).size, 230);
  assert.equal(new Set(practice.parsed.questions.map(row => row.prompt)).size, 230);
  const textbookIds = new Set(banks.find(bank => bank.id === 'textbook').parsed.questions.map(row => row.id));
  for (const row of practice.parsed.questions) assert.equal(textbookIds.has(row.id), false);
});

test('practice parsing retains all editorial, answer-key, temporal, and review records', () => {
  const metadata = practice.original.metadata;
  assert.deepEqual(practice.parsed.metadata, metadata);
  assert.equal(metadata.human_approved, false);
  assert.equal(metadata.external_fact_check_completed, false);
  assert.match(metadata.qa_status, /auto_checked.*未完了/);
  assert.match(metadata.temporal_policy, /年不明/);
  assert.equal(metadata.original_numbered_item_count, 226);
  assert.equal(metadata.source_image_count, 27);
  const numberedItems = new Set();
  for (const [index, row] of practice.parsed.questions.entries()) {
    for (const [key, value] of Object.entries(practice.original.questions[index])) assert.deepEqual(row[key], value);
    assert.equal(row.choices.find(choice => choice.id === row.correct_choice_id).text, row.correct_answer);
    assert.equal(row.status, 'auto_checked');
    assert.equal(row.validation.answer_key_compared, true);
    assert.equal(row.validation.human_approved, false);
    assert.equal(row.validation.external_fact_check_completed, false);
    assert.ok(row.validation.editorial_note);
    const source = row.sources.find(source => source.role === 'question');
    numberedItems.add(`${row.country}:${source.question_number}`);
    assert.ok(row.sources.some(source => source.role === 'answer_key'));
  }
  assert.equal(numberedItems.size, 226);
  assert.ok(practice.parsed.questions.some(row => row.validation.temporal_note));
  assert.doesNotMatch(practice.text, /drive\.google\.com|"(?:file_id|folder_id|source_folder|file_name|image_filename|md5Checksum|source_url)"/);
});

for (const bank of banks) {
  test(`${bank.id}: every country and valid preset uses only this bank and preserves shuffled scoring`, () => {
    let seed = 10;
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
    const rows = bank.parsed.questions;
    const byId = new Map(rows.map(row => [row.id, row]));
    const counts = countryCounts(rows);
    for (const country of [null, ...counts.keys()]) {
      const available = country === null ? rows.length : counts.get(country);
      for (const count of [null, ...PRACTICE_COUNTS.filter(count => count <= available)]) {
        const session = new QuizSession(rows, random, country, count);
        const total = count ?? available;
        assert.equal(session.total, total);
        const seen = new Set();
        while (!session.complete) {
          const row = session.current;
          assert.equal(seen.has(row.id), false);
          seen.add(row.id);
          assert.ok(byId.has(row.id));
          if (country !== null) assert.ok(row.countries.includes(country));
          assert.equal(row.choices.find(choice => choice.id === row.correct_choice_id).text, byId.get(row.id).correct_answer);
          const wrong = session.answers.length === 0;
          const selected = row.choices.find(choice => (choice.id === row.correct_choice_id) !== wrong);
          assert.equal(session.answer(selected.id).correct, !wrong);
          assert.equal(session.answer(selected.id), null);
          assert.equal(session.next(), true);
        }
        assert.equal(seen.size, total);
        assert.equal(session.score, total - 1);
        const history = session.history;
        // Keep the random output fixed across a restart to catch an unguarded reshuffle.
        session.random = () => 0.999999;
        session.restart();
        assert.equal(session.total, total);
        assert.equal(session.score, 0);
        assert.equal(session.answers.length, 0);
        if (available > total) assert.equal(seen.has(session.current.id), false);
        else {
          assert.notEqual(session.current.id, history.firstId);
          assert.notEqual(session.current.id, history.lastId);
        }
        assert.ok(session.order.every(row => byId.has(row.id) && (country === null || row.countries.includes(country))));
      }
    }
  });
}
