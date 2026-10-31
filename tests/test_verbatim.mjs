import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseQuestionPack } from '../static/pages.js';
import { QuizSession, validQuestion, practiceAssetUrl, PRACTICE_ASSETS } from '../static/quiz.js';

const original = JSON.parse(await readFile(new URL('../question-packs/wine-quiz-practice-20261031.json', import.meta.url), 'utf8'));
const review = JSON.parse(await readFile(new URL('../question-packs/practice-source-review.json', import.meta.url), 'utf8'));
const rows = parseQuestionPack(JSON.stringify(original)).questions;
const matching = original.questions.find(row => row.question_type === 'matching');
const binary = original.questions.find(row => row.country === 'オーストリア' && row.sources[0].question_number === '10');
const wrap = question => JSON.stringify({ metadata:{}, questions:[question] });
const canonical = value => Array.isArray(value) ? value.map(canonical) : value !== null && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const sha = value => createHash('sha256').update(value).digest('hex');

test('all original numbered units have an auditable source, answer and unchanged content fingerprint', async () => {
  assert.equal(review.questions.length, 226);
  assert.equal(new Set(review.questions.map(row => `${row.country}:${row.question_number}`)).size, 226);
  for (const [i, row] of original.questions.entries()) {
    const record = review.questions[i];
    assert.equal(record.question_id, row.question_id);
    assert.equal(record.country, row.country);
    assert.equal(record.question_number, row.sources[0].question_number);
    assert.equal(record.image_index, row.sources[0].image_index);
    assert.deepEqual(record.answer, row.correct_matches ?? row.correct_index + 1);
    const fields = Object.fromEntries(['question','options','question_type','matching_items','source_image','context']
      .filter(key => Object.hasOwn(row, key)).map(key => [key, row[key]]));
    assert.equal(sha(JSON.stringify(canonical(fields))), record.content_sha256, row.question_id);
    assert.equal(row.source_verbatim, true);
  }
  assert.deepEqual(rows.filter(row => row.source_image).map(row => row.source_image.filename).sort(), [...PRACTICE_ASSETS].sort());
  for (const [filename, record] of Object.entries(review.crops)) {
    assert.equal(sha(await readFile(new URL(`../question-packs/practice-assets/${filename}`, import.meta.url))), record.sha256);
  }
  assert.equal(rows.filter(row => row.validation.source_text_compared).length, 226);
  const pending = rows.filter(row => row.validation.transcription_pending);
  assert.equal(pending.length, 0);
  assert.deepEqual(pending.map(row => row.id), original.metadata.transcription_pending_question_ids);
  assert.deepEqual(pending.map(row => row.id), review.unresolved.map(row => row.question_id));
  assert.equal(original.metadata.transcribed_question_count, 226);
  assert.equal(original.metadata.original_image_question_count, 0);
  assert.equal(review.text_transcriptions[0].transcription_completed, true);
});

test('Italy 23–26 use complete original text and printed choices with no image dependency', () => {
  const expected = [
    ['ピエモンテ州で造られる白ワインのD.O.C.G.アスティに使われるブドウ品種を1つ選んでください。', ['モスカート・ビアンコ','アルネイス','コルテーゼ'], 0],
    ['ヴェネト州でコルヴィーナ主体の収穫したブドウを2～3カ月陰干しすることによりエキス分を濃縮させ、発酵させるワインに該当するものを1つ選んでください。', ['レチョート・ディ・ソアーヴェ','アマローネ・デッラ・ヴァルポリチェッラ','グラッパ'], 1],
    ['白ワインの名産地として有名なフリウリ・ヴェネツィア・ジューリア州で、果皮や種子と共に発酵しマセレーションするワインの名称に該当するものを1つ選んでください。', ['イエローワイン','オレンジワイン','グリーンワイン'], 1],
    ['トスカーナ州のD.O.C.G.ワインで長期熟成能力が高いブルネッロ・ディ・モンタルチーノの主要品種を1つ選んでください。', ['プリミティーヴォ','サンジョヴェーゼ','モンテプルチャーノ'], 1],
  ];
  expected.forEach(([prompt, options, correctIndex], i) => {
    const row = rows.find(row => row.id === `Q-PR20261031-IT-${String(i + 23).padStart(3, '0')}`);
    assert.equal(row.prompt, prompt);
    assert.deepEqual(row.options, options);
    assert.equal(row.correct_index, correctIndex);
    assert.equal(row.correct_answer, options[correctIndex]);
    assert.equal(row.source_image, undefined);
    assert.equal(row.validation.transcription_pending, false);
    assert.equal(row.validation.source_text_compared, true);
    assert.equal(row.sources[0].image_index, 10);
    const quiz = new QuizSession([row], () => 0);
    assert.equal(quiz.answer(`option-${correctIndex}`).correct, true);
  });
  for (const name of ['it-023.jpg','it-024.jpg','it-025.jpg','it-026.jpg']) {
    assert.throws(() => practiceAssetUrl(name), /未登録/);
  }
});

test('original diagrams, two choices and the unsplit five pairs retain their relationships', () => {
  assert.equal(matching.question_id, 'Q-PR20261031-FR-046');
  assert.equal(rows.filter(row => row.country === 'フランス' && row.sources[0].question_number === '46').length, 1);
  assert.equal(matching.question, '以下の1～5の村のグラン・クリュ名A～Eを線で結んでください。');
  assert.deepEqual(matching.options, ['クロ・ド・タール','ロマネ・コンティ','ミュジニィ','シャンベルタン','クロ・ド・ヴージョ']);
  assert.deepEqual(matching.correct_matches, {1:'D',2:'A',3:'C',4:'E',5:'B'});
  assert.deepEqual(binary.options, ['正しい','正しくない']);
  assert.equal(binary.correct_index, 0);
  const italy = rows.find(row => row.id === 'Q-PR20261031-IT-7-2');
  assert.equal(italy.prompt, 'また、地図では①～③のどの位置か1つ選び番号を解答欄に記入してください。');
  assert.deepEqual(italy.options, ['①','②','③']);
  assert.equal(italy.context.question, rows.find(row => row.id === 'Q-PR20261031-IT-7-1').prompt);
  assert.equal(rows.filter(row => row.source_image?.kind === 'diagram').length, 3);
  const japan = rows.find(row => row.country === '日本' && row.sources[0].question_number === '12');
  assert.match(japan.prompt, /収穫地名/);
  assert.ok(japan.source_note);
  const germany = rows.find(row => row.country === 'ドイツ' && row.sources[0].question_number === '8');
  assert.match(germany.prompt, /ベライヒ/);
  assert.ok(germany.source_note.includes('アンバウゲビーテ'));
});

test('matching requires all five unique answers, grades one point and freezes a submitted snapshot', () => {
  const session = new QuizSession([matching], () => 0);
  for (const invalid of [null,'D',{}, {1:'D'}, {...matching.correct_matches,5:'D'}, {...matching.correct_matches,5:'Z'}, {...matching.correct_matches,6:'A'}]) {
    assert.equal(session.answer(invalid), null);
    assert.equal(session.answers.length, 0);
    assert.equal(session.next(), false);
  }
  const selection = {...matching.correct_matches};
  const result = session.answer(selection);
  selection['1'] = 'A';
  assert.equal(result.correct, true);
  assert.equal(result.choiceId['1'], 'D');
  assert.equal(Object.isFrozen(result.choiceId), true);
  assert.equal(session.score, 1);
  assert.equal(session.answer(selection), null);
  assert.equal(session.next(), true);
  assert.equal(session.complete, true);
  session.restart();
  assert.equal(session.score, 0);
  const wrong = {...matching.correct_matches,1:'A',2:'D'};
  assert.equal(session.answer(wrong).correct, false);
  assert.equal(session.score, 0, 'partially correct matches remain one original question');
});

test('source numbering is preserved across shuffles and binary scoring has no added distractor', () => {
  for (const random of [() => 0, () => .5, () => .999]) {
    const session = new QuizSession([binary,matching], random);
    while (!session.complete) {
      const row = session.current;
      assert.deepEqual(row.choices.map(choice => choice.text), row.options);
      assert.equal(session.answer(row.correct_matches ?? row.correct_choice_id).correct, true);
      session.next();
    }
    assert.equal(session.score, 2);
  }
});

test('malformed matching or original assets reject the whole import and legacy pilot remains three-choice', () => {
  for (const row of [
    {...matching,source_verbatim:false}, {...matching,question_type:'unsupported'},
    {...matching,matching_items:matching.matching_items.slice(1)},
    {...matching,matching_items:matching.matching_items.map(item => ({...item,id:'1'}))},
    {...matching,correct_matches:{...matching.correct_matches,5:'Z'}},
    {...matching,correct_matches:{...matching.correct_matches,5:'D'}},
    {...matching,correct_answer:'1-A'}, {...matching,correct_matches:null},
    {...binary,source_verbatim:false},
    {...binary,source_image:{filename:'https://example.com/image.png',kind:'diagram',alt:'unsafe'}},
    {...binary,source_image:{filename:'../private.jpg',kind:'diagram',alt:'unsafe'}},
    {...binary,source_image:{filename:'fr-002.png',kind:'unknown',alt:'unsafe'}},
    {...binary,context:{question:'context',options:[]}},
  ]) {
    assert.equal(validQuestion(row), false);
    assert.throws(() => parseQuestionPack(wrap(row)), /ファイル全体/);
  }
});

test('image resolution stays relative to nested Pages roots and shares the module cache version', () => {
  assert.equal(practiceAssetUrl('fr-002.png','https://example.com/repo/static/quiz.js?v=one').href,
    'https://example.com/repo/question-packs/practice-assets/fr-002.png?v=one');
  for (const path of ['../private.jpg','https://example.com/image.png','it-023.jpg?query=1','unknown.png']) {
    assert.throws(() => practiceAssetUrl(path), /未登録/);
  }
});
