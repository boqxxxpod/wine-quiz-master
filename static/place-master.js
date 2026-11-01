import { loadPlaceData, placeCards, PlaceSession, PLACE_COUNTS, safePlaceUrl } from './places.js?v=place-text-20261101';
import { PlaceReviewStore, localDay, reviewStats, selectPlaceCards, retryCards } from './place-review.js?v=place-text-20261101';

const kindLabels = { country: '国', region: '地方', district: '地区', village: '村', vineyard: '特級畑' };

/** Initialized without fetching; a broken place dataset cannot block ordinary quizzes. */
export function initPlaceMaster({ onHome, document: doc = globalThis.document, fetcher = globalThis.fetch,
  storageProvider = () => globalThis.localStorage, clock = () => new Date(), random = Math.random } = {}) {
  const $ = selector => doc.querySelector(selector);
  const root = $('#place-content');
  let model = null, store = null, session = null, phase = 'setup', opened = false, loading = false, observedDay = '';
  const settings = { scope: '', direction: 'mixed', target: 'all', count: null };
  const node = (tag, text = '', className = '') => {
    const element = doc.createElement(tag); if (text) element.textContent = text; if (className) element.className = className; return element;
  };
  const button = (label, id, action, primary = false) => {
    const element = node('button', label, `button ${primary ? 'button-primary' : 'button-secondary'}`);
    element.type = 'button'; if (id) element.id = id; element.addEventListener('click', action); return element;
  };
  const focus = selector => { $(selector)?.focus({ preventScroll: true }); };
  const allCards = () => model ? placeCards(model, settings.scope, settings.direction) : [];
  const updateWarning = () => {
    $('#place-storage-warning').textContent = store?.warning ?? '';
    $('#place-storage-warning').hidden = !store?.warning;
  };
  function updateStats() {
    if (!model) return;
    const stats = reviewStats(allCards(), store.entries, clock());
    const list = node('dl', '', 'place-stats');
    for (const [label, key] of [['学習済み', 'learned'], ['覚えた', 'remembered'], ['復習が必要', 'needed'], ['今日の復習', 'today']]) {
      const item = node('div'); const value = node('dd', `${stats[key]} 件`); value.id = `place-stat-${key}`;
      item.append(node('dt', label), value); list.append(item);
    }
    $('#place-stats').replaceChildren(list);
    updateWarning();
  }
  function currentQueue(count = settings.count) {
    return selectPlaceCards(allCards(), store.entries, { target: settings.target, count, now: clock(), random });
  }
  function updateSelection() {
    const total = currentQueue(null).length;
    if (settings.count !== null && settings.count > total) settings.count = null;
    const select = $('#place-count');
    if (select) {
      select.value = settings.count === null ? 'all' : String(settings.count);
      for (const option of select.options) {
        option.disabled = option.value !== 'all' && Number(option.value) > total;
        if (option.value === 'all') option.textContent = `全件（${total}件）`;
      }
      $('#place-available').textContent = total ? `対象：${total}件の方向別カード` : '対象のカードがありません。範囲・方向・学習対象を変更してください。';
      $('#place-start').disabled = total === 0;
      $('#place-scope-note').textContent = model.scopes.get(settings.scope).note;
    }
    updateStats();
  }
  function selectField(label, id, choices, selected, handler) {
    const field = node('div', '', 'field'); const name = node('label', label); name.setAttribute('for', id);
    const select = node('select'); select.id = id;
    for (const [value, title] of choices) { const option = node('option', title); option.value = value; select.append(option); }
    select.value = selected;
    select.addEventListener('change', () => { handler(select.value); updateSelection(); });
    field.append(name, select); return field;
  }
  function renderSetup() {
    phase = 'setup'; session = null;
    const form = node('section', '', 'setup-card');
    form.append(node('h2', '暗記する範囲を選ぶ'),
      selectField('国', 'place-country', [...new Set([...model.scopes.values()].map(scope => scope.country_id))]
        .map(id => [id, model.places.get(id).label_ja]), model.scopes.get(settings.scope).country_id, country => {
        const next = [...model.scopes.values()].find(scope => scope.country_id === country);
        settings.scope = next.id; renderSetup();
      }),
      selectField('地域', 'place-scope', [...model.scopes.values()].filter(scope => scope.country_id === model.scopes.get(settings.scope).country_id)
        .map(scope => [scope.id, scope.label_ja]), settings.scope, value => { settings.scope = value; }),
      selectField('出題方向', 'place-direction', [['village_to_vineyard', '村→畑'], ['vineyard_to_village', '畑→村'], ['mixed', '混合']], settings.direction, value => { settings.direction = value; }),
      selectField('学習対象', 'place-target', [['all', 'すべて'], ['review', '復習が必要な項目']], settings.target, value => { settings.target = value; }),
      selectField('出題数', 'place-count', [...PLACE_COUNTS.map(count => [String(count), `${count}問`]), ['all', '全件']], settings.count === null ? 'all' : String(settings.count), value => { settings.count = value === 'all' ? null : Number(value); }));
    const available = node('p', '', 'scope-count'); available.id = 'place-available'; available.setAttribute('role', 'status');
    const note = node('p', model.scopes.get(settings.scope).note, 'field-help'); note.id = 'place-scope-note';
    form.append(available, note,
      button('暗記を始める →', 'place-start', begin, true));
    const tree = node('section', '', 'setup-card place-tree-intro');
    tree.append(node('h2', 'つながりを見て覚える'), node('p', '地方・地区から村へ、村から特級畑へ。まずは名前のつながりをたどりましょう。'),
      button('階層を見る', 'place-show-tree', renderTree));
    root.replaceChildren(tree, form);
    $('#place-reset').hidden = false;
    updateSelection();
  }
  function sourceDetails(sourceIds, knowledgeIds = []) {
    const details = node('details', '', 'source-details'); details.append(node('summary', '出典・検証記録を確認'));
    const approval = [...model.places.values(), ...model.relations].every(row => row.verification.human_approved)
      ? 'データに人による最終承認を記録しています。' : '人による最終承認が未実施の項目を含みます。';
    details.append(node('p', `産地公式資料の該当箇所と関係を照合済みです。${approval}`, 'field-help'));
    if (knowledgeIds.length) details.append(node('p', `関連知識ID：${knowledgeIds.join('、')}`, 'field-help'));
    for (const id of sourceIds) {
      const source = model.sources.get(id); const paragraph = node('p');
      if (safePlaceUrl(source.url)) {
        const link = node('a', source.title); link.href = safePlaceUrl(source.url); link.target = '_blank'; link.rel = 'noopener noreferrer'; paragraph.append(link);
      } else paragraph.append(node('span', source.title));
      paragraph.append(node('span', ` — ${source.publisher}／${source.locator}／確認 ${source.checked_on}`)); details.append(paragraph);
    }
    return details;
  }
  function renderTree() {
    phase = 'tree';
    const box = node('section', '', 'setup-card place-tree');
    box.append(button('← 暗記の設定へ', 'place-tree-back', () => { renderSetup(); focus('#place-show-tree'); }),
      node('h2', '地域・村・畑のつながり'), node('p', model.scopes.get(settings.scope).note, 'field-help'));
    const branch = (id, incoming = null) => {
      const place = model.places.get(id), edges = model.children.get(id);
      const item = node('li');
      if (edges.length) {
        const details = node('details'); const summary = node('summary', `${place.label_ja}（${kindLabels[place.kind]}）`);
        details.append(summary); const list = node('ul'); for (const edge of edges) list.append(branch(edge.child_id, edge)); details.append(list); item.append(details);
      } else {
        item.append(node('strong', place.label_ja), node('span', `（${kindLabels[place.kind]}）`, 'field-help'));
        const villages = model.parents.get(id).map(edge => model.places.get(edge.parent_id).label_ja);
        if (villages.length > 1) item.append(node('p', `複数の村にまたがる畑：${villages.join('・')}`, 'field-help'));
        item.append(sourceDetails(incoming?.source_ids ?? place.source_ids, incoming?.knowledge_ids ?? place.knowledge_ids));
      }
      return item;
    };
    const list = node('ul'); list.append(branch(model.scopes.get(settings.scope).country_id)); box.append(list); root.replaceChildren(box);
    focus('#place-tree-back');
  }
  function begin() {
    updateSelection();
    const cards = currentQueue();
    if (!cards.length) { renderSetup(); return; }
    session = new PlaceSession(cards); phase = 'study'; renderCard();
  }
  function renderCard() {
    if (session.complete) { renderComplete(); return; }
    const card = session.current; const box = node('section', '', 'quiz-card place-card'); box.dataset.cardId = card.id;
    box.append(node('p', `${session.retry ? '今日の再確認' : '暗記'} ${session.index + 1} / ${session.total}`, 'question-count'));
    const progress = node('progress'); progress.max = session.total; progress.value = session.index;
    progress.setAttribute('aria-label', session.retry ? '今日の再確認の進み具合' : '暗記の進み具合');
    const prompt = node('h2', card.prompt, 'question-prompt'); prompt.id = 'place-prompt'; prompt.tabIndex = -1;
    box.append(progress, prompt, node('p', model.scopes.get(card.scope_id).note, 'field-help'));
    if (!session.revealed) box.append(node('p', '頭の中で答えを考えてから、正解を表示してください。', 'field-help'),
      button('正解を表示', 'place-reveal', () => { session.reveal(); renderCard(); focus('#place-answer-heading'); }, true));
    else {
      const answer = node('section', '', 'answer-panel'); answer.setAttribute('aria-label', '正解と自己評価');
      const heading = node('h3', '正解'); heading.id = 'place-answer-heading'; heading.tabIndex = -1;
      const list = node('ul', '', 'place-answer-list');
      for (const id of card.answer_ids) list.append(node('li', model.places.get(id).label_ja));
      answer.append(heading, list);
      if (!session.evaluated) {
        answer.append(node('p', 'すべて思い出せたか、自己評価してください。'),
          button('覚えた', 'place-remembered', () => evaluate('remembered'), true),
          button('まだ覚えていない', 'place-forgotten', () => evaluate('forgotten')));
      } else {
        const entry = store.entries[card.id];
        const feedback = node('p', `${entry.last_result === 'remembered' ? '覚えた' : 'まだ覚えていない'}を記録しました。次回の復習：${entry.due_on}${entry.pending_day === localDay(clock()) ? '（この後、今日の再確認も行います）' : ''}`);
        feedback.setAttribute('role', 'status'); answer.append(feedback,
          button(session.index + 1 === session.total ? '今回の結果へ' : '次のカード →', 'place-next', () => { session.next(); renderCard(); }, true));
      }
      answer.append(sourceDetails(card.source_ids, card.knowledge_ids)); box.append(answer);
    }
    box.append(button('暗記の設定に戻る', 'place-study-back', () => { renderSetup(); focus('#place-start'); }));
    root.replaceChildren(box); $('#place-reset').hidden = true;
    updateStats(); focus(session.evaluated ? '#place-next' : session.revealed ? '#place-answer-heading' : '#place-prompt');
  }
  function evaluate(result) {
    if (!session.evaluate(result)) return;
    store.evaluate(session.current, result, clock(), session.retry); renderCard();
  }
  function renderComplete() {
    phase = 'complete'; const box = node('section', '', 'completion-card');
    const heading = node('h2', 'ひと巡り、おつかれさまでした。'); heading.id = 'place-complete-heading'; heading.tabIndex = -1;
    box.append(heading, node('p', `${session.total}件のカードを自己評価しました。${session.retry ? '明日も復習しましょう。' : '復習日は回答日から1・3・7日です。'}`));
    const pending = retryCards(allCards(), store.entries, clock());
    if (pending.length) box.append(button(`今日の再確認（${pending.length}件）`, 'place-retry-today', () => {
      session = new PlaceSession(retryCards(allCards(), store.entries, clock()), true); phase = 'study'; renderCard();
    }, true));
    box.append(button('同じ設定でもう一巡', 'place-restart', begin),
      button('暗記の設定へ', 'place-complete-back', () => { renderSetup(); focus('#place-start'); }));
    root.replaceChildren(box); $('#place-reset').hidden = false; updateStats(); focus('#place-complete-heading');
  }
  async function load() {
    if (loading) return;
    loading = true; root.replaceChildren(node('p', '地名データを読み込んでいます。')); $('#place-reset').hidden = true;
    try {
      model = await loadPlaceData(fetcher); settings.scope = [...model.scopes.keys()][0];
      const cards = [...model.scopes.keys()].flatMap(id => placeCards(model, id));
      store = new PlaceReviewStore(model, cards, storageProvider); observedDay = localDay(clock());
      if (opened) renderSetup();
    } catch (error) {
      model = null;
      const message = node('p', error.message, 'field-error'); message.setAttribute('role', 'alert');
      root.replaceChildren(message, button('地名データを再読み込み', 'place-reload', load));
    } finally { loading = false; }
  }
  function resetConfirmation() {
    const panel = $('#place-reset-confirm'); panel.hidden = false; panel.replaceChildren(node('p', '地名マスターの全方向の学習履歴を削除します。元に戻せません。'));
    panel.append(button('履歴を削除する', 'place-reset-yes', () => {
      if (store.reset()) { panel.hidden = true; renderSetup(); focus('#place-reset'); }
      updateWarning();
    }), button('キャンセル', 'place-reset-cancel', () => { panel.hidden = true; focus('#place-reset'); }));
    focus('#place-reset-cancel');
  }
  $('#place-reset').addEventListener('click', resetConfirmation);
  $('#place-home').addEventListener('click', () => onHome());
  const refreshDay = () => {
    if (!opened || !model || localDay(clock()) === observedDay) return;
    observedDay = localDay(clock());
    if (phase === 'setup') updateSelection(); else if (phase === 'complete') renderComplete(); else updateStats();
  };
  globalThis.setInterval?.(refreshDay, 30_000);
  globalThis.window?.addEventListener('focus', refreshDay);
  doc.addEventListener('visibilitychange', refreshDay);
  return {
    get isOpen() { return opened; },
    async open() {
      opened = true; $('#view-setup').hidden = true; $('#view-practice').hidden = true; $('#view-place-master').hidden = false;
      $('#place-reset-confirm').hidden = true; focus('#place-heading');
      if (model) renderSetup(); else await load();
    },
    hide() { opened = false; session = null; $('#view-place-master').hidden = true; $('#place-reset-confirm').hidden = true; },
  };
}
