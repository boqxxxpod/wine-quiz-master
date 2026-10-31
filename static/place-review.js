/** Calendar-based review and versioned, browser-only persistence. No DOM or API. */
export const PLACE_STORAGE_PREFIX = 'wineQuizMaster.placeMaster.v1:';
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const results = ['remembered', 'forgotten'];

export function localDay(now = new Date()) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('学習日時が不正です。');
  return `${String(now.getFullYear()).padStart(4, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function dayDate(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day ?? '')) throw new Error('復習日が不正です。');
  const [year, month, date] = day.split('-').map(Number), result = new Date(0);
  result.setHours(12, 0, 0, 0); result.setFullYear(year, month - 1, date);
  if (localDay(result) !== day) throw new Error('復習日が不正です。');
  return result;
}

export function addDays(day, count) {
  const date = dayDate(day); date.setDate(date.getDate() + count); return localDay(date);
}

export function dueToday(entry, today) {
  return Boolean(entry && (entry.due_on <= today || (entry.pending_day === today && entry.retry_done_on !== today)));
}

export function needsReview(entry, today) {
  return Boolean(entry && (entry.last_result === 'forgotten' || dueToday(entry, today)));
}

export function reviewStats(cards, entries, now = new Date()) {
  const today = localDay(now), existing = cards.map(card => entries[card.id]).filter(Boolean);
  return { total: cards.length, learned: existing.length, remembered: existing.filter(entry => entry.last_result === 'remembered').length,
    needed: existing.filter(entry => needsReview(entry, today)).length, today: existing.filter(entry => dueToday(entry, today)).length };
}

export function updatedReview(previous, card, result, now = new Date(), retry = false) {
  if (!results.includes(result)) throw new Error('自己評価を選んでください。');
  const today = localDay(now), prior = previous?.signature === card.signature ? previous : null;
  const entry = { signature: card.signature, stage: prior?.stage ?? 0, last_result: result, reviewed_at: now.toISOString(),
    due_on: prior?.due_on ?? addDays(today, 1), promoted_on: prior?.promoted_on ?? null,
    failed_on: prior?.failed_on ?? null, pending_day: null, retry_done_on: retry ? today : prior?.retry_done_on ?? null };
  if (result === 'forgotten') {
    entry.stage = 0; entry.failed_on = today; entry.due_on = addDays(today, 1);
    entry.pending_day = entry.retry_done_on === today ? null : today;
  } else if (prior?.failed_on === today) {
    // A successful same-day retry still needs tomorrow's retrieval.
    entry.stage = 1; entry.due_on = addDays(today, 1); entry.promoted_on = today;
  } else if (!prior || (prior.promoted_on !== today && prior.due_on <= today)) {
    entry.stage = Math.min(entry.stage + 1, 3); entry.promoted_on = today;
    entry.due_on = addDays(today, [1, 3, 7][entry.stage - 1]);
  }
  return entry;
}

function shuffle(items, random) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) { const j = Math.floor(random() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; }
  return copy;
}

export function selectPlaceCards(cards, entries, { target = 'all', count = null, now = new Date(), random = Math.random } = {}) {
  if (!['all', 'review'].includes(target)) throw new Error('学習対象が不正です。');
  const today = localDay(now), available = cards.filter(card => target === 'all' || needsReview(entries[card.id], today));
  if (count !== null && (![5, 10, 20].includes(count) || count > available.length)) throw new Error('対象件数以内の出題数を選んでください。');
  const buckets = [[], [], [], [], []];
  for (const card of available) {
    const entry = entries[card.id];
    const priority = !entry ? 3 : entry.due_on < today ? 0 : entry.due_on === today ? 1 : dueToday(entry, today) ? 2 : 4;
    buckets[priority].push(card);
  }
  return buckets.flatMap(bucket => shuffle(bucket, random)).slice(0, count ?? available.length);
}

export function retryCards(cards, entries, now = new Date()) {
  const today = localDay(now);
  return cards.filter(card => entries[card.id]?.pending_day === today && entries[card.id]?.retry_done_on !== today);
}

function validEntry(entry) {
  if (!record(entry) || typeof entry.signature !== 'string' || !Number.isInteger(entry.stage) || entry.stage < 0 || entry.stage > 3 ||
    !results.includes(entry.last_result) || typeof entry.reviewed_at !== 'string' || !Number.isFinite(Date.parse(entry.reviewed_at))) return false;
  try {
    dayDate(entry.due_on);
    for (const key of ['promoted_on', 'failed_on', 'pending_day', 'retry_done_on']) if (entry[key] !== null) dayDate(entry[key]);
    return true;
  } catch { return false; }
}

export class PlaceReviewStore {
  constructor(model, cards, storageProvider = () => globalThis.localStorage) {
    this.model = model; this.cards = cards; this.entries = Object.create(null); this.warning = ''; this.blocked = false;
    this.key = `${PLACE_STORAGE_PREFIX}${model.dataset_id}`;
    try { this.storage = storageProvider(); if (!this.storage) throw new Error(); }
    catch { this.warning = '履歴を保存できません。この回の学習のみ有効です。ブラウザの保存設定を確認してください。'; }
    this.load();
  }
  load() {
    if (!this.storage) return;
    let saved;
    try { saved = this.storage.getItem(this.key); }
    catch { this.blocked = true; this.warning = '履歴を読み込めません。この回のみ学習できます。保存設定を確認してください。'; return; }
    if (saved === null) return;
    try {
      const payload = JSON.parse(saved);
      if (!record(payload) || payload.schema_version !== 1 || payload.dataset_id !== this.model.dataset_id ||
        typeof payload.data_version !== 'string' || !record(payload.cards) || !Object.values(payload.cards).every(validEntry)) throw new Error();
      this.entries = Object.create(null);
      let changed = payload.data_version !== this.model.data_version;
      for (const card of this.cards) {
        const entry = Object.hasOwn(payload.cards, card.id) ? payload.cards[card.id] : null;
        if (entry?.signature === card.signature) this.entries[card.id] = entry;
        else if (entry) changed = true;
      }
      if (Object.keys(payload.cards).length !== Object.keys(this.entries).length) changed = true;
      if (changed) this.save();
    } catch {
      this.blocked = true;
      this.warning = '保存履歴の形式・版を確認できません。元の履歴は上書きしていません。この回のみ学習するか、「履歴をリセット」で復旧できます。';
    }
  }
  save() {
    if (!this.storage || this.blocked) return false;
    try {
      this.storage.setItem(this.key, JSON.stringify({ schema_version: 1, dataset_id: this.model.dataset_id,
        data_version: this.model.data_version, cards: this.entries }));
      this.warning = ''; return true;
    } catch { this.warning = '履歴を保存できません。今回の変更は再読み込み後に失われます。保存設定・空き容量を確認してください。'; return false; }
  }
  evaluate(card, result, now = new Date(), retry = false) {
    if (!this.cards.some(item => item.id === card.id && item.signature === card.signature)) throw new Error('現在の地名データにないカードです。');
    this.entries[card.id] = updatedReview(this.entries[card.id], card, result, now, retry); this.save();
    return this.entries[card.id];
  }
  reset() {
    try { if (this.storage) this.storage.removeItem(this.key); }
    catch { this.warning = '保存履歴を削除できませんでした。ブラウザの保存設定を確認してください。'; return false; }
    this.entries = Object.create(null); this.blocked = false;
    this.warning = this.storage ? '' : '履歴を保存できません。この回の学習のみ有効です。';
    return true;
  }
}
