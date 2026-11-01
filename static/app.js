import { QuizSession, countryCounts, questionsForCountry, PRACTICE_COUNTS, practiceAssetUrl, validMatchingAnswer } from './quiz.js?v=home-practice-20261101';
import { loadBundledQuestionPack, BUNDLED_PACKS, DEFAULT_PACK_ID } from './pages.js?v=home-practice-20261101';
import { initPlaceMaster } from './place-master.js?v=home-practice-20261101';

const $ = selector => document.querySelector(selector);
const state = { session: null, loadError: '', practiceQuestions: [], packMetadata: null, practiceLoading: false, bundledPackId: DEFAULT_PACK_ID, packLabel: '' };

function syncPackSelection() {
  for (const pack of BUNDLED_PACKS) {
    $(`#pack-${pack.id}`).checked = state.bundledPackId === pack.id;
  }
  const pack = BUNDLED_PACKS.find(item => item.id === state.bundledPackId);
  $('#retry-pack').textContent = `${pack.label}を再読み込み`;
}

function element(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== '') node.textContent = text;
  return node;
}

function button(text, className, handler) {
  const node = element('button', className, text);
  node.type = 'button';
  node.addEventListener('click', handler);
  return node;
}

function link(text, url, className = '') {
  const node = element('a', className, text);
  node.href = url;
  node.target = '_blank';
  node.rel = 'noopener noreferrer';
  return node;
}

function selectedCountry() {
  return $('#scope-country').checked ? $('#practice-country').value : null;
}

function selectedCount() {
  return $('#question-count').value === 'all' ? null : Number($('#question-count').value);
}

function alignCountToScope() {
  const total = questionsForCountry(state.practiceQuestions, selectedCountry()).length;
  const count = selectedCount();
  if (count !== null && (!PRACTICE_COUNTS.includes(count) || count > total)) $('#question-count').value = 'all';
  renderScope();
}

function renderScope(rebuildCountries = false) {
  const countries = countryCounts(state.practiceQuestions);
  const select = $('#practice-country');
  if (rebuildCountries) {
    select.replaceChildren(element('option', '', '国を選んでください'));
    select.firstElementChild.value = '';
    for (const country of [...countries.keys()].sort((a, b) => a.localeCompare(b, 'ja'))) {
      const option = element('option', '', `${country}（${countries.get(country)} 問）`);
      option.value = country;
      select.append(option);
    }
    select.value = '';
  }
  const country = selectedCountry();
  const total = country === '' ? 0 : questionsForCountry(state.practiceQuestions, country).length;
  const count = selectedCount();
  const invalidCount = count !== null && (!PRACTICE_COUNTS.includes(count) || count > total);
  const loading = state.practiceLoading;
  for (const pack of BUNDLED_PACKS) $(`#pack-${pack.id}`).disabled = loading;
  select.disabled = !$('#scope-country').checked || loading;
  for (const id of ['scope-all', 'scope-country']) $(`#${id}`).disabled = loading;
  $('#question-count').disabled = loading || total === 0;
  for (const option of $('#question-count').options) {
    option.disabled = option.value !== 'all' && Number(option.value) > total;
  }
  $('#question-count').setAttribute('aria-invalid', String(invalidCount && total > 0));
  $('#scope-all-count').textContent = `（${state.practiceQuestions.length} 問）`;
  $('#count-all-label').textContent = `全問（${total} 問）`;
  $('#scope-count').textContent = loading ? '問題集を読み込んでいます。'
    : state.loadError ? '問題集を読み込めないため、開始できません。'
      : country === '' ? '練習する国を選んでください。'
        : total === 0 ? 'この範囲には問題がありません。別の範囲か問題集を選んでください。'
          : `対象：${country ?? 'すべて'} · ${total} 問`;
  $('#count-error').textContent = invalidCount && total > 0 ? '選べる出題数から指定してください。' : '';
  $('#count-error').hidden = !invalidCount || total === 0;
  $('#start-practice').disabled = loading || Boolean(state.loadError) || total === 0 || invalidCount;
}

function showSetup(focus = true) {
  placeMaster.hide();
  $('#view-setup').hidden = false;
  $('#view-practice').hidden = true;
  renderScope();
  if (focus) {
    $('#setup-heading').focus({ preventScroll: true });
    $('#view-setup').scrollIntoView({ block: 'start' });
  }
}

function focusQuestion() {
  const target = $('#question-prompt') ?? $('.completion-card');
  target?.focus({ preventScroll: true });
  $('#view-practice').scrollIntoView({ block: 'start' });
}

function startPractice() {
  // Validate again when starting, even if a value changed without an input event.
  renderScope();
  if ($('#start-practice').disabled) return;
  state.session = new QuizSession(state.practiceQuestions, Math.random, selectedCountry(), selectedCount());
  $('#view-setup').hidden = true;
  $('#view-practice').hidden = false;
  renderPractice();
  focusQuestion();
}

function useQuestionPack(pack, fileName) {
  state.practiceQuestions = pack.questions;
  state.packMetadata = pack.metadata ?? null;
  state.packLabel = BUNDLED_PACKS.find(item => item.id === state.bundledPackId).label;
  state.loadError = '';
  state.practiceLoading = false;
  state.session = null;
  $('#scope-all').checked = true;
  $('#scope-country').checked = false;
  $('#question-count').value = 'all';
  syncPackSelection();
  $('#pages-import-status').textContent = `出題元：${state.packLabel}（${fileName}） · ${pack.questions.length} 問（組み込み問題集）`;
  const qa = state.packMetadata?.qa_status;
  $('#pack-review-status').textContent = typeof qa === 'string' ? `問題集の検証記録：${qa}` : '';
  $('#pack-review-status').hidden = typeof qa !== 'string' || !qa.trim();
  $('#pages-import-error').hidden = true;
  $('#quiz-root').replaceChildren();
  $('#active-scope').textContent = '';
  renderScope(true);
  if (!placeMaster.isOpen) showSetup(false);
}

async function loadBundledPack(packId = state.bundledPackId) {
  if (state.practiceLoading) { syncPackSelection(); return; }
  const pack = BUNDLED_PACKS.find(item => item.id === packId);
  if (!pack) { syncPackSelection(); return; }
  state.bundledPackId = pack.id;
  state.practiceLoading = true;
  $('#retry-pack').disabled = true;
  state.loadError = '';
  state.practiceQuestions = [];
  state.packMetadata = null;
  state.session = null;
  state.packLabel = pack.label;
  syncPackSelection();
  $('#pages-import-error').hidden = true;
  $('#pages-import-status').textContent = `${pack.label}（${pack.filename}）を読み込んでいます。`;
  $('#pack-review-status').hidden = true;
  $('#quiz-root').replaceChildren();
  $('#active-scope').textContent = '';
  showSetup(false);
  renderScope(true);
  try {
    useQuestionPack(await loadBundledQuestionPack(pack.id), pack.filename);
  } catch (error) {
    state.loadError = error.message;
    $('#pages-import-status').textContent = `出題元：${pack.label}（${pack.filename}） · 読み込み失敗`;
    $('#pages-import-error').textContent = error.message;
    $('#pages-import-error').hidden = false;
  } finally {
    state.practiceLoading = false;
    $('#retry-pack').hidden = !state.loadError;
    $('#retry-pack').disabled = false;
    renderScope();
  }
}

function renderCompletion() {
  const session = state.session;
  const card = element('div', 'completion-card');
  card.tabIndex = -1;
  card.append(element('div', 'completion-medallion', '✓'), element('h2', '', 'ひと巡り、おつかれさまでした。'));
  const score = element('div', 'completion-score', String(session.score));
  score.append(element('span', '', `/ ${session.total} 問正解`));
  const restart = button('同じ設定でもう一巡', 'button button-primary', () => {
    session.restart();
    renderPractice();
    focusQuestion();
  });
  card.append(score, element('p', '', '選んだ範囲から、もう一度ランダムに出題します。'), restart,
    button('設定を変更する', 'button button-secondary', showSetup));
  $('#quiz-root').replaceChildren(card);
}

function safeSourceLink(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

const metadataLabels = {
  image: '画像', image_name: '画像名', image_file: '画像名', image_filename: '画像名',
  file_name: '画像名', filename: '画像名', page: 'ページ', page_number: 'ページ',
  position: '位置', location: '位置', url: 'URL', source_url: '出典URL',
  knowledge_id: '知識ID', source_page: '出典ページ', topic: 'テーマ',
};

function recordedMetadata(value) {
  if (value === null || typeof value !== 'object') {
    const url = safeSourceLink(value);
    return url ? link(value, url) : element('span', '', String(value));
  }
  const list = element('dl', 'recorded-metadata');
  for (const [key, item] of Object.entries(value)) {
    const content = element('dd');
    content.append(recordedMetadata(item));
    list.append(element('dt', '', Array.isArray(value) ? String(Number(key) + 1) : metadataLabels[key] ?? key), content);
  }
  return list;
}

function evidence(question) {
  const box = element('div', 'evidence');
  if (question.format === 'pilot') {
    box.classList.add('pilot-evidence');
    box.append(element('div', 'evidence-label', '問題集に記録された出典'), recordedMetadata({
      knowledge_id: question.knowledge_id,
      source_page: question.source_page,
      topic: question.topic,
    }));
    const description = question.status === 'auto_checked' ? '（機械検証済み・人手確認前）' : '';
    box.append(element('p', 'pilot-review-note', `検証記録：${question.status}${description}`),
      element('p', 'pages-evidence-note', '原画像の確認・外部の事実確認・人による校閲の完了を示すものではありません。'));
    if (question.sources) box.append(recordedMetadata(question.sources));
    if (question.validation) box.append(recordedMetadata(question.validation));
    return box;
  }
  if (Array.isArray(question.sources)) {
    box.append(element('div', 'evidence-label', `問題集に記録された出典（${question.sources.length} 件）`));
    for (const [index, source] of question.sources.entries()) {
      const item = element('div', 'pack-source');
      item.append(element('h3', '', `出典 ${index + 1}`), recordedMetadata(source));
      box.append(item);
    }
    if (question.validation !== undefined) {
      const record = element('details', 'validation-record');
      record.append(element('summary', '', '検証記録（問題集の記載）'),
        element('p', '', 'この記録は、原画像の確認・外部の事実確認・人による校閲の完了を示すものではありません。'),
        recordedMetadata(question.validation));
      box.append(record);
    }
    return box;
  }
  box.append(element('div', 'evidence-label', '根拠になった黄色部分'));
  const quote = element('p', 'evidence-quote');
  quote.append(document.createTextNode('「'), element('span', 'highlight-text', question.quote), document.createTextNode('」'));
  const file = element('div', 'evidence-file');
  file.append(element('span', '', `出典：${question.file_name}`));
  box.append(quote, file);
  box.append(element('p', 'pages-evidence-note', '原本写真はこの画面には読み込んでいません。'));
  return box;
}

function answerAndRender(value) {
  if (!state.session.answer(value)) return;
  renderPractice();
  $('.answer-summary').focus({ preventScroll: true });
  $('.answer-summary').scrollIntoView({ block: 'nearest' });
}

function matchingChoices(question, session) {
  const group = element('div', 'matching-list');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-labelledby', 'question-prompt');
  const selections = session.answered ? session.selectedId : Object.create(null);
  const submit = button('回答する', 'button button-primary matching-submit', () => answerAndRender(selections));
  const hint = element('p', 'answer-hint', '各番号に対応する A～E を選んでください。同じ記号は一度だけ使います。');
  hint.setAttribute('aria-live', 'polite');
  for (const item of question.matching_items) {
    const label = element('label', 'matching-row');
    label.append(element('span', '', `${item.id}. ${item.text}`));
    const select = element('select', 'matching-select');
    select.dataset.itemId = item.id;
    select.setAttribute('aria-label', `${item.id}. ${item.text} に対応するグラン・クリュ`);
    const empty = element('option', '', '選んでください');
    empty.value = '';
    select.append(empty);
    for (const choice of question.choices) {
      const option = element('option', '', `${choice.id}. ${choice.text}`);
      option.value = choice.id;
      select.append(option);
    }
    select.value = selections[item.id] ?? '';
    select.disabled = session.answered;
    select.addEventListener('change', () => {
      if (session.answered) return;
      selections[item.id] = select.value;
      submit.disabled = !validMatchingAnswer(question, selections);
      const values = Object.values(selections).filter(Boolean);
      hint.textContent = new Set(values).size !== values.length ? '同じ記号が選ばれています。各記号は一度だけ使ってください。'
        : 'すべて選んだら「回答する」を押してください。';
    });
    label.append(select);
    if (session.answered) {
      const correctId = question.correct_matches[item.id];
      const correct = selections[item.id] === correctId;
      label.append(element('span', correct ? 'match-correct' : 'match-incorrect', `${correct ? '✓' : '×'} 正答 ${correctId}. ${question.choices.find(choice => choice.id === correctId).text}`));
    }
    group.append(label);
  }
  submit.disabled = session.answered || !validMatchingAnswer(question, selections);
  if (!session.answered) group.append(hint, submit);
  return group;
}

function originalContent(question) {
  const content = element('div', 'original-content');
  if (question.context) {
    const context = element('aside', 'question-context');
    context.append(element('p', 'context-label', '関連する設問の原文（イタリア 問7-1）'),
      element('p', '', question.context.question));
    for (const [index, text] of question.context.options.entries()) context.append(element('p', '', `${index + 1}. ${text}`));
    content.append(context);
  }
  if (question.source_image) {
    const source = question.source_image;
    const url = practiceAssetUrl(source.filename);
    const figure = element('figure', `question-figure ${source.kind}`);
    const img = element('img');
    img.src = url.href;
    img.alt = source.alt;
    figure.append(img, link(source.kind === 'original' ? '原文画像を拡大' : '地図を拡大', url.href));
    if (source.kind === 'original') figure.append(element('figcaption', '', '原文画像で出題しています。画像内の選択肢の番号で回答してください。読みづらい場合は「原文画像を拡大」を開いてください。'));
    content.append(figure);
  }
  return content;
}

function renderPractice() {
  const session = state.session;
  if (!session?.total) { $('#quiz-root').replaceChildren(); return; }
  $('#active-scope').textContent = `${state.packLabel} · ${session.country ?? 'すべて'} · ${session.total} 問`;
  if (session.complete) { renderCompletion(); return; }
  const question = session.current;
  const card = element('div', 'quiz-card');
  card.dataset.questionId = question.id;
  const header = element('div', 'question-header');
  const questionCount = element('div', 'question-count');
  questionCount.append(element('span', '', '問題 '), element('strong', '', String(session.index + 1)), element('span', '', ` / ${session.total}`));
  header.append(questionCount, element('span', 'question-score', `正解 ${session.score} / ${session.total} · 回答 ${session.answers.length}`));
  const progress = element('div', 'progress-track');
  progress.setAttribute('role', 'progressbar');
  progress.setAttribute('aria-label', '今回の練習の進み具合');
  progress.setAttribute('aria-valuenow', String(session.answers.length));
  progress.setAttribute('aria-valuemin', '0');
  progress.setAttribute('aria-valuemax', String(session.total));
  const fill = element('div', 'progress-fill');
  fill.style.width = `${session.answers.length / session.total * 100}%`;
  progress.append(fill);
  const prompt = element('h2', 'question-prompt', question.prompt);
  prompt.id = 'question-prompt';
  prompt.tabIndex = -1;
  const matching = question.question_type === 'matching';
  const choices = matching ? matchingChoices(question, session) : element('div', 'choice-list');
  choices.setAttribute('role', 'group');
  choices.setAttribute('aria-labelledby', 'question-prompt');
  if (!matching) question.choices.forEach((choice, index) => {
    const correct = session.answered && choice.id === question.correct_choice_id;
    const wrong = session.answered && choice.id === session.selectedId && !correct;
    const choiceButton = button('', `choice${correct ? ' correct' : ''}${wrong ? ' incorrect' : ''}`, () => {
      answerAndRender(choice.id);
    });
    choiceButton.disabled = session.answered;
    choiceButton.append(element('span', 'choice-letter', question.source_verbatim ? String(index + 1) : String.fromCharCode(65 + index)),
      element('span', 'choice-text', question.source_image?.kind === 'original' ? `画像の選択肢 ${index + 1}` : choice.text));
    if (correct || wrong) {
      const marker = element('span', 'choice-state', correct ? '✓' : '×');
      marker.setAttribute('aria-label', correct ? '正しい回答' : '選んだ回答・不正解');
      choiceButton.append(marker);
    }
    choices.append(choiceButton);
  });
  card.append(header, progress, element('div', 'question-category', question.source_verbatim ? question.source_page : question.countries?.join('・') || '三択問題'),
    prompt, originalContent(question), choices);
  if (!session.answered) {
    if (!matching) card.append(element('p', 'answer-hint', '答えをひとつ選ぶと、正解と解説を表示します。'));
  }
  else {
    const answer = session.answers[session.answers.length - 1];
    const correctChoice = question.choices.find(choice => choice.id === question.correct_choice_id);
    const panel = element('section', 'answer-panel');
    panel.setAttribute('aria-label', '回答結果と解説');
    const summary = element('div', 'answer-summary');
    summary.tabIndex = -1;
    const verdict = element('div', `verdict${answer.correct ? '' : ' incorrect'}`, answer.correct ? '✓ 正解です。' : '× 不正解です。');
    const next = button(session.index + 1 === session.total ? '結果を見る' : '次の問題 →', 'button button-primary', () => {
      if (!session.next()) return;
      renderPractice();
      focusQuestion();
    });
    const row = element('div', 'next-row');
    row.append(next);
    summary.append(verdict, row);
    const correctAnswer = element('p', 'correct-answer', '正しい回答：');
    correctAnswer.append(element('strong', '', matching ? question.correct_answer
      : question.source_image?.kind === 'original' ? `画像の選択肢 ${question.correct_index + 1}` : correctChoice.text));
    const details = element('details', 'source-details');
    details.append(element('summary', '', '出典・検証記録を確認'), evidence(question));
    panel.append(summary, correctAnswer, element('h3', 'explanation-label', '解説'), element('p', 'explanation-body', question.explanation), details);
    const notes = [question.source_note, question.validation?.temporal_note].filter(Boolean);
    if (notes.length) panel.append(element('h3', 'explanation-label', '原資料への注記'), element('p', 'source-note', notes.join('\n')));
    card.append(panel);
  }
  $('#quiz-root').replaceChildren(card);
}

const placeMaster = initPlaceMaster({ onHome: () => showSetup() });
$('#open-place-master').addEventListener('click', () => placeMaster.open());
$('#back-to-setup').addEventListener('click', showSetup);
$('.brand').addEventListener('click', event => { event.preventDefault(); showSetup(); });
$('#retry-pack').addEventListener('click', () => loadBundledPack());
for (const pack of BUNDLED_PACKS) {
  $(`#pack-${pack.id}`).addEventListener('change', event => {
    if (event.target.checked) return loadBundledPack(pack.id);
  });
}
for (const id of ['scope-all', 'scope-country', 'practice-country']) {
  $(`#${id}`).addEventListener('change', alignCountToScope);
}
$('#question-count').addEventListener('change', () => renderScope());
$('#start-practice').addEventListener('click', startPractice);
loadBundledPack();
