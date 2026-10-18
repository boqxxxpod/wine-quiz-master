import { QuizSession, countryCounts, questionsForCountry } from './quiz.js';
import { mode } from './runtime.js';
import { parseQuestionPack, loadDefaultQuestionPack, MAX_PACK_BYTES } from './pages.js';

const $ = selector => document.querySelector(selector);
const IS_PAGES = mode === 'pages';
const SERVER_ONLY = 'GitHub Pages では、Google ドライブ接続・黄色部分の読み取り・luna による生成・問題の承認を実行できません。ローカルの Python サーバー版で操作し、承認済みの問題集を書き出してください。';
const DEFAULT_PACK_NAME = 'wine_quiz_master_set_01.json';
const state = { status: null, sources: [], session: null, view: 'practice', sourceId: null, detail: null, busy: false, loadError: '', folders: [], practiceQuestions: [], packFileName: '', customPack: false, practiceLoading: true };
let toastTimer;

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

function imageUrl(sourceId, regionId = '', kind = 'original') {
  const query = new URLSearchParams({ kind });
  if (regionId) query.set('region', regionId);
  return `/api/images/${encodeURIComponent(sourceId)}?${query}`;
}

async function api(path, body) {
  if (IS_PAGES) {
    // Pages never contacts a server, including on refresh or disabled actions.
    if (body !== undefined) throw new Error(SERVER_ONLY);
    if (path === '/api/sources') return [];
    if (path === '/api/status') return {
      counts: { sources: 0, questions: 0, pending_review: 0, needs_review: 0, errors: 0 },
      drive: { configured: false, message: SERVER_ONLY },
      luna: { configured: false, model: 'gpt-6-luna', checked: false, available: false, message: 'GitHub Pages から OpenAI API は呼び出しません。luna の設定・利用権限の確認は、ローカルの Python サーバー版で行ってください。' },
      warnings: [],
    };
    throw new Error(SERVER_ONLY);
  }
  let response;
  try {
    response = await fetch(path, body === undefined ? { headers: { Accept: 'application/json' } } : {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body),
    });
  } catch {
    throw new Error('サーバーに接続できません。起動状態とネットワークを確認してください。');
  }
  let data;
  try { data = await response.json(); } catch {
    throw new Error(`サーバーの応答を読み取れませんでした（HTTP ${response.status}）。`);
  }
  if (!response.ok) {
    const detail = data.detail ?? data;
    const message = typeof detail === 'string' ? detail : detail.message ?? detail.reason ?? `処理に失敗しました（HTTP ${response.status}）。`;
    const setup = Array.isArray(detail.setup) ? `\n${detail.setup.join('\n')}` : '';
    throw new Error(`${message}${setup}`);
  }
  return data;
}

function toast(message, error = false) {
  const node = $('#toast');
  node.textContent = message;
  node.className = error ? 'toast error' : 'toast';
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, error ? 9000 : 4500);
}

function setNotice(message) {
  const node = $('#global-notice');
  node.textContent = message;
  node.hidden = !message;
}

function normalizeQuestion(question) {
  return { ...question, source_id: question.source_id ?? question.source?.id, file_name: question.file_name ?? question.source?.file_name };
}

function count(name) { return Number(state.status?.counts?.[name] ?? 0); }

function selectedCountry() {
  return $('#scope-country').checked ? $('#practice-country').value : null;
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
  }
  select.disabled = !$('#scope-country').checked || state.practiceLoading;
  const country = selectedCountry();
  const total = country === '' ? 0 : questionsForCountry(state.practiceQuestions, country).length;
  $('#scope-all-count').textContent = `（${state.practiceQuestions.length} 問）`;
  $('#scope-count').textContent = state.practiceLoading ? '問題集を読み込んでいます。'
    : state.loadError ? '問題集を読み込めないため、開始できません。'
      : country === '' ? '練習する国を選んでください。'
        : total === 0 ? 'この範囲には問題がないため、開始できません。'
          : `対象：${country ?? 'すべて'} · ${total} 問。開始すると回答・得点・進捗をリセットします。`;
  $('#start-practice').disabled = state.practiceLoading || Boolean(state.loadError) || total === 0;
  $('#scope-all').disabled = state.practiceLoading;
  $('#scope-country').disabled = state.practiceLoading;
  $('#active-scope').textContent = `今回の範囲：${state.session?.country ?? 'すべて'} · ${state.session?.total ?? 0} 問`;
}

function startPractice() {
  if ($('#start-practice').disabled) return;
  state.session = new QuizSession(state.practiceQuestions, Math.random, selectedCountry());
  updateStatus();
  renderScope();
  renderPractice();
  $('#main-content').focus({ preventScroll: true });
}

function useQuestionPack(pack, fileName, custom = false) {
  state.practiceQuestions = pack.questions;
  state.packFileName = fileName;
  state.customPack = custom;
  state.loadError = '';
  state.practiceLoading = false;
  $('#scope-all').checked = true;
  $('#scope-country').checked = false;
  state.session = new QuizSession(state.practiceQuestions);
  $('#pages-import-status').textContent = `出題元：${fileName} · ${pack.questions.length} 問${custom ? '（このタブのみ）' : '（標準問題集）'}`;
  $('#pages-import-error').hidden = true;
  $('#clear-pack').disabled = !custom;
  renderScope(true);
  updateStatus();
  renderSources();
  renderPractice();
}

async function loadDefaultPack() {
  state.practiceLoading = true;
  state.loadError = '';
  state.practiceQuestions = [];
  state.session = null;
  state.customPack = false;
  state.packFileName = DEFAULT_PACK_NAME;
  $('#question-pack').disabled = true;
  $('#clear-pack').disabled = true;
  $('#pages-import-error').hidden = true;
  $('#pages-import-status').textContent = `${DEFAULT_PACK_NAME} を読み込んでいます。`;
  renderScope(true);
  renderPractice();
  try {
    useQuestionPack(await loadDefaultQuestionPack(), DEFAULT_PACK_NAME);
  } catch (error) {
    state.loadError = error.message;
    $('#pages-import-status').textContent = `出題元：${DEFAULT_PACK_NAME} · 読み込み失敗`;
    $('#pages-import-error').textContent = error.message;
    $('#pages-import-error').hidden = false;
  } finally {
    state.practiceLoading = false;
    $('#question-pack').disabled = false;
    renderScope();
    updateStatus();
    renderPractice();
  }
}

function showView(view, focus = true) {
  if (!['practice', 'sources', 'settings'].includes(view)) return;
  state.view = view;
  for (const section of document.querySelectorAll('.view')) section.hidden = section.id !== `view-${view}`;
  for (const item of document.querySelectorAll('.nav-item')) {
    const active = item.dataset.view === view;
    item.classList.toggle('active', active);
    if (active) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
  }
  $('#current-view-label').textContent = { practice: '練習する', sources: '資料と問題', settings: '接続・設定' }[view];
  history.replaceState(null, '', `#${view}`);
  if (focus) $('#main-content').focus({ preventScroll: true });
}

function updateStatus() {
  const packSources = new Set(state.practiceQuestions.flatMap(question => Array.isArray(question.sources)
    ? question.sources.map(source => JSON.stringify(source)) : [question.source_id]));
  const sourceCount = IS_PAGES ? packSources.size : count('sources');
  $('#stat-questions').replaceChildren(document.createTextNode(String(state.session?.total ?? 0)), element('small', '', ' 問'));
  $('#stat-sources').replaceChildren(document.createTextNode(String(sourceCount)), element('small', '', IS_PAGES ? ' 件' : ' 枚'));
  $('#stat-review').replaceChildren(document.createTextNode(String(count('pending_review'))), element('small', '', ' 問'));
  $('#nav-source-count').textContent = String(sourceCount);
  const drive = state.status?.drive ?? {};
  const driveBadge = $('#drive-badge');
  driveBadge.textContent = drive.configured ? '設定あり' : '未接続';
  driveBadge.className = `badge ${drive.configured ? 'good' : 'warning'}`;
  $('#drive-status').textContent = drive.message ?? (drive.configured ? '認証設定があります。フォルダのアクセス権を確認してから、写真を同期してください。' : 'Google ドライブの認証が未設定です。下の接続手順に沿って、サーバーを設定してください。');
  $('#drive-status').className = `connection-message ${drive.configured ? 'good' : ''}`;
  if (drive.folder_id && !$('#folder-id').value) $('#folder-id').value = drive.folder_id;
  const luna = state.status?.luna ?? {};
  const available = luna.available === true;
  $('#model-id').textContent = luna.model ?? 'gpt-6-luna';
  $('#model-badge').textContent = available ? '利用可能' : luna.checked ? '利用不可' : luna.configured ? '未検証' : '未設定';
  $('#model-badge').className = `badge ${available ? 'good' : 'warning'}`;
  $('#model-status').textContent = luna.message ?? luna.reason ?? (available ? 'このアカウントの利用権限を確認しました。画像入力に対応する luna を使用します。' : 'API キーをサーバーに設定し、luna の利用可否を確認してください。利用できるまで問題生成を停止します。');
  $('#model-status').className = `connection-message ${available ? 'good' : ''}`;
  if (luna.image_input === false) $('#model-status').textContent += '\n画像入力を確認できないため、問題生成を停止します。';
  $('#source-summary').textContent = `${count('sources')} 枚の写真 · ${count('questions')} 問を保存 · ${count('pending_review')} 問が確認待ち`;
  if (IS_PAGES) {
    driveBadge.textContent = 'サーバー版のみ';
    driveBadge.className = 'badge neutral';
    $('#model-badge').textContent = 'サーバー版のみ';
    $('#model-badge').className = 'badge neutral';
    $('#source-summary').textContent = `${state.practiceQuestions.length} 問を読み込み · 出典は回答後に表示 · 原本写真は未読み込み`;
  }
}

function paperIllustration() {
  const art = element('div', 'empty-illustration');
  art.setAttribute('aria-hidden', 'true');
  const paper = element('div', 'paper-sheet');
  for (const name of ['paper-line', 'paper-line', 'paper-line marked', 'paper-line short', 'paper-line']) paper.append(element('span', name));
  art.append(paper, element('span', 'empty-spark', '✦'));
  return art;
}

function renderEmpty() {
  const card = element('div', 'empty-card');
  const top = element('div', 'empty-card-top');
  top.append(element('span', '', 'YOUR FIRST QUESTION'), element('span', '', 'まだ、白紙の一ページ'));
  card.append(top, paperIllustration());
  const heading = state.practiceLoading ? '問題集を読み込んでいます。'
    : state.loadError ? '問題を読み込めませんでした。' : 'この範囲には問題がありません。';
  const description = state.practiceLoading ? `${DEFAULT_PACK_NAME} の読み込みを待っています。`
    : state.loadError || '出題範囲を変更するか、別の問題集を選んでください。0 問の練習は開始できません。';
  card.append(element('h2', '', heading), element('p', 'empty-description', description));
  if (!state.practiceLoading) {
    const actionButton = button(state.loadError ? '標準問題集を再読み込み' : '別の問題集を選ぶ', 'button button-primary',
      () => state.loadError ? loadDefaultPack() : $('#question-pack').click());
    card.append(actionButton);
  }
  $('#quiz-root').replaceChildren(card);
}

function renderCompletion() {
  const session = state.session;
  const card = element('div', 'completion-card');
  card.append(element('div', 'completion-medallion', '✓'), element('p', 'eyebrow', 'ONE ROUND, WELL DONE'), element('h2', '', 'ひと巡り、おつかれさまでした。'), element('p', '', 'もう一度、順番を変えて。知識を少しずつ確かなものに。'));
  const score = element('div', 'completion-score', String(session.score));
  score.append(element('span', '', `/ ${session.total} 問正解`));
  const restart = button('シャッフルして、もう一巡', 'button button-primary', () => {
    session.restart();
    renderPractice();
    $('#main-content').focus({ preventScroll: true });
  });
  restart.append(element('span', '', '↻'));
  card.append(score, restart);
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

function evidence(question, includeImage = !IS_PAGES) {
  const box = element('div', 'evidence');
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
  if (includeImage && !IS_PAGES) file.append(link('写真で確かめる ↗', imageUrl(question.source_id, question.region_id, 'crop')));
  box.append(quote, file);
  if (IS_PAGES) box.append(element('p', 'pages-evidence-note', '原本写真と黄色部分の照合は、サーバー版で確認できます。'));
  return box;
}

function renderPractice() {
  const session = state.session;
  if (!session?.total) { renderEmpty(); return; }
  if (session.complete) { renderCompletion(); return; }
  const question = session.current;
  const card = element('div', 'quiz-card');
  const header = element('div', 'question-header');
  const questionCount = element('div', 'question-count');
  questionCount.append(element('span', '', 'QUESTION'), element('strong', '', String(session.index + 1).padStart(2, '0')), element('span', '', `/ ${String(session.total).padStart(2, '0')}`));
  header.append(questionCount, element('span', 'question-score', `正解 ${session.score} / 回答 ${session.answers.length}`));
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
  const choices = element('div', 'choice-list');
  choices.setAttribute('role', 'group');
  choices.setAttribute('aria-labelledby', 'question-prompt');
  question.choices.forEach((choice, index) => {
    const correct = session.answered && choice.id === question.correct_choice_id;
    const wrong = session.answered && choice.id === session.selectedId && !correct;
    const choiceButton = button('', `choice${correct ? ' correct' : ''}${wrong ? ' incorrect' : ''}`, () => {
      // Lock synchronously before a second click can arrive; rerender disables every choice.
      if (!session.answer(choice.id)) return;
      renderPractice();
      $('.answer-panel')?.focus({ preventScroll: true });
    });
    choiceButton.disabled = session.answered;
    choiceButton.append(element('span', 'choice-letter', String.fromCharCode(65 + index)), element('span', 'choice-text', choice.text));
    if (correct || wrong) {
      const marker = element('span', 'choice-state', correct ? '✓' : '×');
      marker.setAttribute('aria-label', correct ? '正しい回答' : '選んだ回答・不正解');
      choiceButton.append(marker);
    }
    choices.append(choiceButton);
  });
  card.append(header, progress, element('div', 'question-category', `${state.packFileName} · ${question.countries?.join('・') || '国情報なし'}`), prompt, choices);
  if (!session.answered) card.append(element('p', 'answer-hint', '答えをひとつ選んでください。回答後に解説を表示します。'));
  else {
    const answer = session.answers[session.answers.length - 1];
    const correctChoice = question.choices.find(choice => choice.id === question.correct_choice_id);
    const panel = element('div', 'answer-panel');
    panel.tabIndex = -1;
    panel.setAttribute('aria-label', '回答結果と解説');
    const verdict = element('div', `verdict${answer.correct ? '' : ' incorrect'}`);
    verdict.append(element('span', 'verdict-symbol', answer.correct ? '✓' : '×'), document.createTextNode(answer.correct ? '正解です。' : '不正解です。次につなげましょう。'));
    const correctAnswer = element('p', 'correct-answer', '正しい回答：');
    correctAnswer.append(element('strong', '', correctChoice.text));
    const next = button('次の問題', 'button button-primary', () => {
      if (!session.next()) return;
      renderPractice();
      $('#main-content').focus({ preventScroll: true });
      if (window.innerWidth < 760) $('#view-practice').scrollIntoView({ behavior: 'instant', block: 'start' });
    });
    next.append(element('span', '', '→'));
    const row = element('div', 'next-row');
    row.append(next);
    panel.append(verdict, correctAnswer, element('div', 'explanation-label', 'EXPLANATION / 解説'), element('p', 'explanation-body', question.explanation), evidence(question), row);
    card.append(panel);
  }
  $('#quiz-root').replaceChildren(card);
}

function sourceStatus(source) {
  if (source.active === false || source.status === 'removed') return { text: '対象外', type: 'neutral' };
  if (source.status === 'error' || source.generation_error) return { text: '処理を確認', type: 'error' };
  if (Number(source.needs_review_count) > 0 || ['needs_review', 'review'].includes(source.status)) return { text: '要確認', type: 'warning' };
  if (Number(source.questions_count) > 0) return { text: '問題あり', type: 'good' };
  return { text: { downloaded: '読取待ち', pending: '読取待ち', extracted: '生成待ち', processed: '読取済み', synced: '同期済み' }[source.status] ?? '確認中', type: 'neutral' };
}

function renderSources() {
  const list = $('#source-list');
  list.replaceChildren();
  if (IS_PAGES) {
    list.append(element('p', 'empty-inline', `出題元：${state.packFileName || DEFAULT_PACK_NAME}\n読み込んだ問題集：${state.practiceQuestions.length} 問\n原本写真はこのページに読み込んでいません。`));
    const detail = $('#source-detail');
    detail.replaceChildren(element('h2', 'detail-title', '問題集の出典は、回答後に。'), element('p', 'empty-inline', '各問題の回答後に、解説と記録されたすべての出典を表示します。標準問題集の原画像・引用・抽出領域は作成していません。検証記録は原画像の確認や校閲の完了を意味しません。'), element('p', 'source-reason', SERVER_ONLY));
    return;
  }
  if (!state.sources.length) {
    list.append(element('p', 'empty-inline', 'まだ資料がありません。接続・設定から Google ドライブの写真を同期してください。'));
    return;
  }
  for (const source of state.sources) {
    const item = button('', `source-item${state.sourceId === source.id ? ' active' : ''}`, () => loadSource(source.id));
    item.setAttribute('aria-label', `${source.file_name} の詳細`);
    const info = element('div', 'source-info');
    info.append(element('span', 'source-name', source.file_name));
    const status = sourceStatus(source);
    const meta = element('div', 'source-meta');
    meta.append(element('span', `badge ${status.type}`, status.text), element('span', '', `${Number(source.regions_count ?? 0)} 箇所 · ${Number(source.questions_count ?? 0)} 問`));
    info.append(meta);
    item.append(element('span', 'source-file-icon', '▧'), info);
    list.append(item);
  }
}

function sourcePhoto(sourceId, regionId, kind, alt, className) {
  const photo = element('img', className);
  photo.src = imageUrl(sourceId, regionId, kind);
  photo.alt = alt;
  photo.loading = 'lazy';
  photo.addEventListener('error', () => {
    const missing = element('p', 'source-reason', '画像を表示できません。写真の同期状態を確認してください。');
    photo.replaceWith(missing);
  });
  return photo;
}

function renderReviewQuestion(rawQuestion, detail) {
  const question = normalizeQuestion({ ...rawQuestion, source_id: detail.id, file_name: detail.file_name });
  const approved = question.status === 'approved';
  const rejected = question.status === 'rejected';
  const invalidated = question.status === 'invalidated';
  const pending = question.status === 'pending_review';
  const card = element('div', `review-question${approved ? ' approved' : rejected || invalidated ? ' rejected' : ''}`);
  card.append(element('span', `badge ${approved ? 'good' : rejected || invalidated ? 'neutral' : 'warning'}`, approved ? '承認済み・書き出し可' : rejected ? '不採用' : invalidated ? '旧版・無効' : '確認待ち'));
  card.append(element('h4', '', question.prompt));
  const choices = element('ol', 'review-choices');
  choices.type = 'A';
  for (const choice of question.choices ?? []) choices.append(element('li', '', choice.text));
  const correct = question.choices?.find(choice => choice.id === question.correct_choice_id);
  card.append(choices, element('p', 'review-answer', `正しい回答：${correct?.text ?? '確認できません'}`), element('p', 'review-explanation', question.explanation ?? '解説がありません。'));
  if (question.quote) card.append(evidence(question, !invalidated));
  if (invalidated) card.append(element('p', 'review-instruction', '写真が更新されたため無効になった旧版の問題です。現在の写真との対応はありません。'));
  if (pending) {
    card.append(element('p', 'review-instruction', '黄色部分の引用・読み取りと一致し、正解がひとつであることを確認してください。'));
    const actions = element('div', 'review-actions');
    actions.append(button('根拠を確認して承認', 'button button-primary', () => reviewQuestion(question.id, true)), button('この問題は使わない', 'button button-secondary', () => reviewQuestion(question.id, false)));
    card.append(actions);
  }
  return card;
}

function renderSourceDetail(detail) {
  const root = $('#source-detail');
  root.replaceChildren();
  const status = sourceStatus(detail);
  root.append(element('h2', 'detail-title', detail.file_name));
  const meta = element('div', 'detail-status');
  meta.append(element('span', `badge ${status.type}`, status.text), link('元の写真を開く ↗', imageUrl(detail.id)));
  root.append(meta);
  const reasons = [detail.reason, detail.generation_error].filter(Boolean);
  if (reasons.length) root.append(element('p', 'source-reason', [...new Set(reasons)].join('\n')));
  if (detail.downloaded !== false) {
    const photoLink = link('', imageUrl(detail.id), 'detail-photo-link');
    photoLink.append(sourcePhoto(detail.id, '', 'original', `${detail.file_name} の原本`, 'detail-photo'));
    root.append(photoLink, element('p', 'detail-photo-caption', '写真をタップすると原本を開きます。'));
  }
  root.append(element('h3', 'detail-subheading', `黄色部分と読み取り（${detail.regions?.length ?? 0} 箇所）`));
  if (!detail.regions?.length) root.append(element('p', 'empty-inline', '黄色部分の抽出結果はまだありません。未処理、または黄色の範囲を確定できていない資料です。'));
  for (const [index, region] of (detail.regions ?? []).entries()) {
    const card = element('div', 'region-card');
    const regionHead = element('div', 'region-heading');
    regionHead.append(element('span', '', `黄色部分 ${String(index + 1).padStart(2, '0')}`));
    if (region.status) regionHead.append(element('span', `badge ${region.status === 'needs_review' ? 'warning' : 'neutral'}`, region.status === 'needs_review' ? '読取を確認' : region.status === 'ready' ? '読取済み' : '抽出済み'));
    card.append(regionHead, sourcePhoto(detail.id, region.id, 'crop', `${detail.file_name} の黄色部分 ${index + 1}`, 'region-image'), element('div', 'ocr-label', '読み取った文字'));
    card.append(element('p', 'ocr-text', region.text ?? region.ocr_text ?? region.quote ?? '文字を確定できませんでした。推測による補完は行っていません。'));
    if (region.reason) card.append(element('p', 'source-reason', region.reason));
    const tools = element('div', 'region-tools');
    tools.append(link('切り出しを開く ↗', imageUrl(detail.id, region.id, 'crop')), link('黄色の検出範囲を見る ↗', imageUrl(detail.id, region.id, 'mask')));
    card.append(tools);
    const questions = (detail.questions ?? []).filter(question => question.region_id === region.id);
    for (const question of questions) card.append(renderReviewQuestion(question, detail));
    root.append(card);
  }
  const unmatched = (detail.questions ?? []).filter(question => !(detail.regions ?? []).some(region => region.id === question.region_id));
  if (unmatched.length) {
    root.append(element('h3', 'detail-subheading', '保存された問題'));
    for (const question of unmatched) root.append(renderReviewQuestion(question, detail));
  }
}

async function loadSource(sourceId) {
  state.sourceId = sourceId;
  renderSources();
  $('#source-detail').replaceChildren(element('p', 'empty-inline', '資料の根拠を読み込んでいます…'));
  try {
    const detail = await api(`/api/sources/${encodeURIComponent(sourceId)}`);
    if (state.sourceId !== sourceId) return;
    state.detail = detail;
    renderSourceDetail(detail);
  } catch (error) {
    $('#source-detail').replaceChildren(element('p', 'source-reason', error.message));
    toast(error.message, true);
  }
}

async function loadData() {
  const results = await Promise.allSettled([api('/api/status'), api('/api/sources')]);
  const errors = [];
  if (results[0].status === 'fulfilled') state.status = results[0].value;
  else errors.push(results[0].reason.message);
  if (results[1].status === 'fulfilled') state.sources = Array.isArray(results[1].value) ? results[1].value : results[1].value.sources ?? [];
  else errors.push(results[1].reason.message);
  const warnings = (state.status?.warnings ?? []).filter(warning => !warning.includes('利用可能な承認済み問題がありません'));
  setNotice([...new Set([...errors, ...warnings])].join('\n'));
  updateStatus();
  renderSources();
}

function setBusy(busy, activeId = '', label = '') {
  state.busy = busy;
  for (const id of ['find-folders', 'sync-drive', 'process-sources', 'check-model']) {
    const node = $(`#${id}`);
    node.disabled = busy || IS_PAGES;
    node.setAttribute('aria-busy', String(busy && id === activeId));
  }
  for (const node of document.querySelectorAll('.review-actions button')) node.disabled = busy || IS_PAGES;
  const active = activeId && $(`#${activeId}`);
  if (active) {
    if (busy) { active.dataset.originalText = active.textContent; active.textContent = label; }
    else if (active.dataset.originalText) { active.textContent = active.dataset.originalText; delete active.dataset.originalText; }
  }
}

function operationResult(message, error = false) {
  const node = $('#operation-result');
  node.textContent = message;
  node.className = `operation-result${error ? ' error' : ''}`;
  node.hidden = false;
}

async function perform(id, loadingText, path, body, fallback) {
  if (state.busy) return;
  setBusy(true, id, loadingText);
  try {
    const result = await api(path, body);
    const extra = (result.errors ?? []).map(error => typeof error === 'string' ? error : error.message ?? error.reason ?? '').filter(Boolean);
    const message = [result.message ?? result.reason ?? fallback, ...extra].filter(Boolean).join('\n');
    const failed = result.ok === false || result.available === false || extra.length > 0;
    operationResult(message, failed);
    toast(message, failed);
    await loadData();
    if (state.sourceId) await loadSource(state.sourceId);
    return result;
  } catch (error) {
    operationResult(error.message, true);
    toast(error.message, true);
  } finally { setBusy(false, id); }
}

function renderFolders(result) {
  const root = $('#folder-results');
  root.replaceChildren();
  root.hidden = false;
  state.folders = result.folders ?? [];
  if (result.selected?.id) $('#folder-id').value = result.selected.id;
  root.append(element('p', '', result.message ?? (state.folders.length > 1 ? '同名フォルダが複数あります。対象を選んでから同期してください。' : state.folders.length ? 'フォルダを確認しました。対象の ID を確認して写真を同期してください。' : '「ワイン検定」フォルダを確認できません。フォルダ ID と共有設定を確認してください。')));
  for (const folder of state.folders) {
    const option = element('label', 'folder-option');
    const radio = element('input');
    radio.type = 'radio';
    radio.name = 'drive-folder';
    radio.value = folder.id;
    radio.checked = $('#folder-id').value === folder.id;
    radio.addEventListener('change', () => { $('#folder-id').value = folder.id; });
    const text = element('span');
    text.append(element('strong', '', folder.name), element('code', '', folder.id));
    option.append(radio, text);
    root.append(option);
  }
}

async function findFolders() {
  if (state.busy) return;
  setBusy(true, 'find-folders', '確認しています…');
  try {
    const folderId = $('#folder-id').value.trim();
    const result = await api('/api/folders', folderId ? { folder_id: folderId } : {});
    renderFolders(result);
  } catch (error) {
    $('#folder-results').hidden = false;
    $('#folder-results').replaceChildren(element('p', '', error.message));
    toast(error.message, true);
  } finally { setBusy(false, 'find-folders'); }
}

async function reviewQuestion(id, approved) {
  if (state.busy) return;
  setBusy(true);
  try {
    await api(`/api/questions/${encodeURIComponent(id)}/review`, { approved });
    toast(approved ? '承認しました。問題集を書き出し、練習画面で JSON を選ぶと練習できます。' : 'この問題を書き出し対象から外しました。');
    await loadData();
    if (state.sourceId) await loadSource(state.sourceId);
  } catch (error) { toast(error.message, true); }
  finally { setBusy(false); }
}

function initializePages() {
  if (!IS_PAGES) return;
  $('#pages-import').hidden = false;
  $('.topbar-badge').textContent = 'GitHub Pages · 練習用';
  $('.topbar-badge').classList.add('pages-mode-badge');
  $('#stat-sources').parentElement.querySelector('span').textContent = '参照した資料';
  $('.sidebar-footer').replaceChildren(element('span', 'status-dot'), document.createTextNode(' 読み込んだ問題で練習'));
  $('#folder-id').disabled = true;
  $('#folder-id').placeholder = 'サーバー版で指定してください';
  $('#refresh-sources').hidden = true;
  $('.import-bottom > p').textContent = SERVER_ONLY;
  $('#process-sources').textContent = 'サーバー版で取り込み・生成';
  setBusy(false);
}

async function importQuestionPack() {
  const input = $('#question-pack');
  const file = input.files?.[0];
  if (!file || state.practiceLoading) return;
  input.disabled = true;
  $('#clear-pack').disabled = true;
  $('#pages-import-error').hidden = true;
  try {
    if (file.size > MAX_PACK_BYTES) throw new Error('問題集は 2 MB 以下の JSON ファイルを選んでください。');
    const pack = parseQuestionPack(await file.text());
    // Commit only after validating the whole file. Failed imports retain the active session and source label.
    useQuestionPack(pack, file.name, true);
    toast(`${pack.questions.length} 問を読み込みました。`);
  } catch (error) {
    $('#pages-import-error').textContent = `${file.name} を読み込めませんでした。${error.message}\n現在の出題元・問題・回答状況を保持しています。`;
    $('#pages-import-error').hidden = false;
  } finally {
    input.value = '';
    input.disabled = false;
    $('#clear-pack').disabled = !state.customPack;
  }
}

for (const item of document.querySelectorAll('[data-view]')) item.addEventListener('click', () => showView(item.dataset.view));
for (const item of document.querySelectorAll('[data-open-view]')) item.addEventListener('click', () => showView(item.dataset.openView));
$('.brand').addEventListener('click', event => { event.preventDefault(); showView('practice'); });
$('#find-folders').addEventListener('click', findFolders);
$('#sync-drive').addEventListener('click', async () => {
  const folderId = $('#folder-id').value.trim();
  if (!folderId && state.folders.length > 1) { toast('対象フォルダを選ぶか、フォルダ ID を入力してください。', true); $('#folder-id').focus(); return; }
  const result = await perform('sync-drive', '写真を同期しています…', '/api/sync', folderId ? { folder_id: folderId } : {}, '写真の同期が完了しました。');
  if (result?.folders) renderFolders(result);
});
$('#process-sources').addEventListener('click', () => perform('process-sources', '資料を処理しています…', '/api/process', {}, '資料の処理が完了しました。資料と問題の画面で根拠を確認してください。'));
$('#check-model').addEventListener('click', () => perform('check-model', '利用権限を確認しています…', '/api/check-model', {}, 'モデルの確認が完了しました。'));
$('#refresh-sources').addEventListener('click', async () => { await loadData(); if (state.sourceId) await loadSource(state.sourceId); toast('保存された資料の状態を更新しました。'); });
$('#question-pack').addEventListener('change', importQuestionPack);
$('#clear-pack').addEventListener('click', loadDefaultPack);
$('#scope-all').addEventListener('change', () => renderScope());
$('#scope-country').addEventListener('change', () => renderScope());
$('#practice-country').addEventListener('change', () => renderScope());
$('#start-practice').addEventListener('click', startPractice);
window.addEventListener('hashchange', () => showView(location.hash.slice(1) || 'practice', false));
initializePages();
showView(location.hash.slice(1) || 'practice', false);
loadData();
loadDefaultPack();
