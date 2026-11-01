import { loadPlaceData, placeLessons, safePlaceUrl } from './places.js?v=place-notebook-20261101';
import { PlaceReviewStore, localDay, dueToday } from './place-review.js?v=place-notebook-20261101';

const NOTEBOOK_PREFIX = 'wineQuizMaster.placeNotebook.v1:';
const kindLabels = { country: '国', region: '地方', district: '地区', village: '村', vineyard: '特級畑' };

/** Reading, comparison and optional name covers share the same visible material. */
export function initPlaceMaster({ onHome, document: doc = globalThis.document, fetcher = globalThis.fetch,
  storageProvider = () => globalThis.localStorage, clock = () => new Date() } = {}) {
  const $ = selector => doc.querySelector(selector);
  const root = $('#place-content');
  let model = null, store = null, scopeId = '', opened = false, loading = false, observedDay = '', mode = 'read';
  const revealed = new Set();
  const node = (tag, text = '', className = '') => {
    const element = doc.createElement(tag); if (text) element.textContent = text; if (className) element.className = className; return element;
  };
  const button = (label, id, action, primary = false) => {
    const element = node('button', label, `button ${primary ? 'button-primary' : 'button-secondary'}`);
    element.type = 'button'; if (id) element.id = id; element.addEventListener('click', action); return element;
  };
  const focus = selector => $(selector)?.focus({ preventScroll: true });
  const lessons = () => placeLessons(model, scopeId);
  function nameText(element, label) {
    element.replaceChildren();
    const parts = label.split('・');
    parts.forEach((part, i) => {
      element.append(node('span', `${part}${i < parts.length - 1 ? '・' : ''}`, 'notebook-name-part'));
      if (i < parts.length - 1) element.append(node('wbr'));
    });
  }
  function updateWarning() {
    $('#place-storage-warning').textContent = store?.warning ?? '';
    $('#place-storage-warning').hidden = !store?.warning;
  }
  function jump(id) {
    const target = $(`#lesson-${id}`); target?.focus({ preventScroll: true }); target?.scrollIntoView({ block: 'start' });
  }
  function lessonLink(lesson, label = null) {
    const link = node('a', '', 'notebook-lesson-link'); link.href = `#lesson-${lesson.village.id}`;
    const title = label ?? (mode === 'villages' ? `まとまり ${lessons().findIndex(item => item.id === lesson.id) + 1}` : lesson.village.label_ja);
    if (mode === 'villages' || label) link.append(node('span', title)); else link.append(name(lesson.village));
    link.addEventListener('click', event => { event.preventDefault(); jump(lesson.village.id); }); return link;
  }
  function name(place) {
    const coverable = (mode === 'fields' && place.kind === 'vineyard') || (mode === 'villages' && place.kind === 'village');
    if (!coverable) { const text = node('span', '', 'notebook-name'); nameText(text, place.label_ja); text.dataset.placeId = place.id; return text; }
    const visible = revealed.has(place.id);
    const control = button(visible ? place.label_ja : '••••••', '', () => {
      if (revealed.has(place.id)) revealed.delete(place.id); else revealed.add(place.id);
      for (const item of root.querySelectorAll(`[data-cover-id="${place.id}"]`)) updateCover(item, place);
    });
    control.setAttribute('data-cover-id', place.id); control.classList.add('notebook-cover');
    updateCover(control, place); return control;
  }
  function updateCover(control, place) {
    const visible = revealed.has(place.id);
    if (visible) nameText(control, place.label_ja); else control.textContent = '••••••';
    control.setAttribute('aria-label', visible ? `${place.label_ja}を隠す` : `${kindLabels[place.kind]}名を表示`);
    control.setAttribute('aria-pressed', String(visible));
  }
  function sourceDetails(sourceIds) {
    const details = node('details', '', 'source-details'); details.append(node('summary', '出典・収録範囲を読む'));
    const approved = [...model.places.values(), ...model.relations].every(row => row.verification.human_approved);
    details.append(node('p', `産地公式・自治体資料の所在関係を照合した部分収録です。${approved ? 'データに人による最終承認を記録しています。' : '人による最終承認が未実施の項目を含みます。'}`, 'field-help'));
    for (const id of sourceIds) {
      const source = model.sources.get(id), paragraph = node('p');
      if (safePlaceUrl(source.url)) {
        const link = node('a', source.title); link.href = safePlaceUrl(source.url); link.target = '_blank'; link.rel = 'noopener noreferrer'; paragraph.append(link);
      } else paragraph.append(node('span', source.title));
      paragraph.append(node('span', ` — ${source.publisher}／${source.locator}／確認 ${source.checked_on}`)); details.append(paragraph);
    }
    return details;
  }
  function sharedNote(vineyard) {
    const villages = model.parents.get(vineyard.id).map(edge => model.places.get(edge.parent_id));
    if (villages.length < 2) return null;
    const note = node('p', '', 'notebook-shared'); note.append(name(vineyard), node('span', 'は、'));
    villages.forEach((village, i) => { if (i) note.append(node('span', 'と')); note.append(name(village)); });
    note.append(node('span', 'にまたがる畑です。両方の村と結び付けて覚えます。')); return note;
  }
  function renderOverview(items) {
    const overview = node('section', '', 'notebook-overview'); overview.setAttribute('aria-labelledby', 'place-overview-heading');
    const heading = node('h2', '村と畑の見取り図'); heading.id = 'place-overview-heading';
    overview.append(heading, node('p', 'まずは村ごとのまとまりを見比べます。村の名前から、その下の畑へ目を移して読んでみましょう。', 'notebook-intro'));
    const scope = model.scopes.get(scopeId), path = [];
    let cursor = model.places.get(scope.root_id);
    while (cursor) { path.unshift(cursor); cursor = model.places.get(model.parents.get(cursor.id)[0]?.parent_id); }
    const hierarchy = node('ol', '', 'notebook-hierarchy');
    for (const place of path) { const item = node('li'); item.append(node('span', kindLabels[place.kind], 'notebook-level'), node('strong', place.label_ja)); hierarchy.append(item); }
    overview.append(hierarchy);
    const districts = [...new Map(items.flatMap(lesson => lesson.districts).map(place => [place.id, place])).values()];
    overview.append(node('p', `収録地区：${districts.map(place => place.label_ja).join('・')}`, 'notebook-districts'));
    const groups = node('div', '', 'notebook-groups');
    for (const lesson of items) {
      const group = node('div', '', 'notebook-group'); group.append(node('p', '村', 'notebook-level'), name(lesson.village));
      const list = node('ul'); for (const place of lesson.vineyards) { const item = node('li'); item.append(name(place)); list.append(item); }
      group.append(list); groups.append(group);
    }
    overview.append(groups); return overview;
  }
  function renderComparisons(items) {
    const box = node('section', '', 'notebook-comparisons'); box.append(node('h2', '似た名前を、並べて整理する'));
    const sameName = [];
    for (const lesson of items) for (const vineyard of lesson.vineyards) {
      if (lesson.village.label_ja.includes(vineyard.label_ja)) sameName.push([lesson.village, vineyard]);
    }
    if (sameName.length) {
      const note = node('div', '', 'notebook-comparison'); note.append(node('h3', '村名と畑名を分ける'));
      for (const [village, vineyard] of sameName) { const pair = node('p'); pair.append(node('span', '村：'), name(village), node('span', ' → 特級畑：'), name(vineyard)); note.append(pair); }
      note.append(node('p', '名前が似ていても、村と畑は異なる階層です。前後の地名と一緒に読みます。', 'field-help')); box.append(note);
    }
    const uniqueVineyards = [...new Map(items.flatMap(lesson => lesson.vineyards).map(place => [place.id, place])).values()];
    const clos = uniqueVineyards.filter(place => place.label_ja.startsWith('クロ・'));
    if (clos.length > 1) {
      const note = node('div', '', 'notebook-comparison'); note.append(node('h3', '同じ「クロ」でも、村を取り違えない'));
      for (const vineyard of clos) {
        const pair = node('p'); pair.append(name(vineyard), node('span', ' → '));
        model.parents.get(vineyard.id).forEach((edge, i) => { if (i) pair.append(node('span', '・')); pair.append(name(model.places.get(edge.parent_id))); }); note.append(pair);
      }
      box.append(note);
    }
    for (const vineyard of uniqueVineyards) { const note = sharedNote(vineyard); if (note) box.append(note); }
    return box;
  }
  function renderSchedule(items) {
    const schedule = $('#place-reading-status');
    const today = localDay(clock());
    const due = items.filter(lesson => dueToday(store.entries[lesson.id], today));
    schedule.replaceChildren();
    if (due.length) {
      schedule.append(node('p', '今日、もう一度目を通すまとまり', 'notebook-level'));
      const links = node('div', '', 'notebook-review-links'); for (const lesson of due) links.append(lessonLink(lesson)); schedule.append(links);
    } else schedule.append(node('p', '気になるまとまりから、何度でも読み返せます。', 'field-help'));
  }
  function renderLesson(lesson, index) {
    const section = node('section', '', 'notebook-lesson'); section.setAttribute('data-lesson-id', lesson.village.id);
    const heading = node('h2', '', 'notebook-village'); heading.id = `lesson-${lesson.village.id}`; heading.tabIndex = -1;
    heading.append(node('span', String(index + 1).padStart(2, '0'), 'notebook-number'), name(lesson.village));
    const regions = node('p', '', 'notebook-level');
    lesson.districts.forEach((place, i) => { if (i) regions.append(node('span', '・')); regions.append(node('span', `${place.label_ja}（${kindLabels[place.kind]}）`)); });
    section.append(regions, heading, node('p', `この村と結び付けて覚える、収録対象の特級畑${lesson.vineyards.length}件。`, 'notebook-intro'));
    const list = node('ul', '', 'notebook-vineyards');
    for (const vineyard of lesson.vineyards) {
      const item = node('li'); item.append(node('span', '特級畑', 'notebook-level'), name(vineyard));
      const note = sharedNote(vineyard); if (note) item.append(note); list.append(item);
    }
    section.append(list);
    const anchor = node('p', '', 'notebook-memory-line'); anchor.append(node('span', 'ひとまとまりで読む：'), name(lesson.village), node('span', ' → '));
    lesson.vineyards.forEach((place, i) => { if (i) anchor.append(node('span', ' ／ ')); anchor.append(name(place)); }); section.append(anchor);
    const entry = store.entries[lesson.id];
    const record = node('p', entry ? `見直した日：${localDay(new Date(entry.reviewed_at))} · 次に読む目安：${entry.due_on}` : '読み終えたら、次に読む日の目安を残せます。', 'field-help');
    record.id = `review-note-${lesson.village.id}`;
    const actions = node('div', '', 'notebook-lesson-actions');
    actions.append(button('見直した', `review-${lesson.village.id}`, () => {
      store.evaluate(lesson, 'remembered', clock());
      renderReader(`#review-${lesson.village.id}`);
      $('#place-action-status').textContent = '見直した日と、次に読む日の目安を記録しました。';
    }), button('今日もう一度読む', `again-${lesson.village.id}`, () => {
      store.evaluate(lesson, 'forgotten', clock());
      renderReader(`#again-${lesson.village.id}`);
      $('#place-action-status').textContent = '今日読み直すまとまりに追加しました。';
    }));
    section.append(record, actions, sourceDetails(lesson.source_ids)); return section;
  }
  function renderReader(focusTo = null) {
    const items = lessons(), scope = model.scopes.get(scopeId);
    const reader = node('div', '', 'place-notebook');
    const toolbar = node('div', '', 'notebook-tools');
    const label = node('label', '読む地域'); label.setAttribute('for', 'place-scope');
    const select = node('select'); select.id = 'place-scope';
    for (const scope of model.scopes.values()) { const option = node('option', scope.label_ja); option.value = scope.id; select.append(option); }
    select.value = scopeId; select.addEventListener('change', () => { scopeId = select.value; mode = 'read'; revealed.clear(); renderReader('#place-scope'); });
    toolbar.append(label, select); reader.append(toolbar);
    const introduction = node('section', '', 'notebook-guide');
    introduction.append(node('p', 'READ · CONNECT · RECALL', 'eyebrow'), node('h2', '全体をつかみ、ひとまとまりずつ覚える。'));
    const steps = node('ol');
    for (const text of ['見取り図で、地域・村・畑のつながりを見る。', '村ごとのページを読み、似た名前を比べて整理する。', '慣れたら名前を隠して思い出し、日を空けて読み直す。']) steps.append(node('li', text));
    const fieldCount = new Set(items.flatMap(lesson => lesson.vineyards.map(place => place.id))).size;
    introduction.append(steps, node('p', `${items.length}村・${fieldCount}特級畑の部分収録です。各村のすべての畑を網羅していません。`, 'field-help')); reader.append(introduction);
    const view = node('fieldset', '', 'notebook-view'); view.append(node('legend', '教材の読み方'));
    for (const [value, title] of [['read', '名前を見ながら読む'], ['fields', '畑名を隠して読む'], ['villages', '村名を隠して読む']]) {
      const control = button(title, `place-mode-${value}`, () => { mode = value; revealed.clear(); renderReader(`#place-mode-${value}`); });
      control.setAttribute('aria-pressed', String(mode === value)); view.append(control);
    }
    const help = node('p', mode === 'read' ? '地名はすべて表示しています。自分のペースで読み進められます。' : '隠れた名前の部分を押すと表示できます。もう一度押すと隠れます。', 'field-help');
    view.append(help); reader.append(view);
    const status = node('div'); status.id = 'place-reading-status'; reader.append(status);
    reader.append(renderOverview(items));
    const layout = node('div', '', 'notebook-layout');
    const contents = node('nav', '', 'notebook-contents'); contents.setAttribute('aria-label', '村ごとの教材目次');
    contents.append(node('h2', '村ごとに読む')); const links = node('ol');
    for (const lesson of items) { const item = node('li'); item.append(lessonLink(lesson)); links.append(item); } contents.append(links);
    const chapters = node('div', '', 'notebook-chapters'); items.forEach((lesson, i) => chapters.append(renderLesson(lesson, i)));
    layout.append(contents, chapters); reader.append(layout, renderComparisons(items));
    root.replaceChildren(reader); $('#place-reset').hidden = false;
    renderSchedule(items); updateWarning();
    if (focusTo) focus(focusTo);
  }
  async function load() {
    if (loading) return;
    loading = true; root.replaceChildren(node('p', '教材を読み込んでいます。')); $('#place-reset').hidden = true;
    try {
      model = await loadPlaceData(fetcher); scopeId = [...model.scopes.keys()][0];
      const units = [...model.scopes.keys()].flatMap(id => placeLessons(model, id));
      store = new PlaceReviewStore(model, units, storageProvider, NOTEBOOK_PREFIX); observedDay = localDay(clock());
      if (opened) renderReader();
    } catch (error) {
      model = null;
      const message = node('p', error.message, 'field-error'); message.setAttribute('role', 'alert');
      root.replaceChildren(message, button('教材を再読み込み', 'place-reload', load));
    } finally { loading = false; }
  }
  function resetConfirmation() {
    const panel = $('#place-reset-confirm'); panel.hidden = false; panel.replaceChildren(node('p', '教材の見直し記録を削除します。元に戻せません。'));
    panel.append(button('見直し記録を削除する', 'place-reset-yes', () => {
      if (store.reset()) { panel.hidden = true; $('#place-action-status').textContent = ''; renderReader('#place-reset'); }
      updateWarning();
    }), button('キャンセル', 'place-reset-cancel', () => { panel.hidden = true; focus('#place-reset'); })); focus('#place-reset-cancel');
  }
  $('#place-reset').addEventListener('click', resetConfirmation);
  $('#place-home').addEventListener('click', () => onHome());
  const refreshDay = () => {
    if (!opened || !model || localDay(clock()) === observedDay) return;
    observedDay = localDay(clock()); renderSchedule(lessons());
  };
  globalThis.setInterval?.(refreshDay, 30_000);
  globalThis.window?.addEventListener('focus', refreshDay); doc.addEventListener('visibilitychange', refreshDay);
  return {
    get isOpen() { return opened; },
    async open() {
      opened = true; mode = 'read'; revealed.clear(); $('#view-setup').hidden = true; $('#view-practice').hidden = true; $('#view-place-master').hidden = false;
      $('#place-reset-confirm').hidden = true; $('#place-action-status').textContent = ''; focus('#place-heading');
      if (model) renderReader(); else await load();
    },
    hide() { opened = false; $('#view-place-master').hidden = true; $('#place-reset-confirm').hidden = true; },
  };
}
