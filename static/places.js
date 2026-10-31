/** Place learning has its own data model; quiz packs and scoring stay independent. */
export const PLACE_DIRECTIONS = Object.freeze(['village_to_vineyard', 'vineyard_to_village']);
export const PLACE_COUNTS = Object.freeze([5, 10, 20]);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && Boolean(value.trim());
const identifier = value => text(value) && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value);
const strings = values => Array.isArray(values) && values.every(text) && new Set(values).size === values.length;
const kinds = ['country', 'region', 'district', 'village', 'vineyard'];

export function safePlaceUrl(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; }
  catch { return null; }
}

/** Reject the entire dataset, including unverified edges, before making cards. */
export function parsePlaceData(input) {
  let data;
  try {
    if (typeof input !== 'string' || new TextEncoder().encode(input).length > 2_000_000) throw new Error();
    data = JSON.parse(input);
  } catch { throw new Error('地名データのJSONを読み取れません（上限2 MB）。'); }
  const fail = message => { throw new Error(`地名データ：${message}`); };
  if (!record(data) || data.schema_version !== 1 || !identifier(data.dataset_id) || !text(data.data_version) ||
    !['places', 'relations', 'sources', 'scopes'].every(key => Array.isArray(data[key]) && data[key].length > 0)) fail('形式・版・必須項目を確認してください。');
  const index = (rows, label) => {
    const result = new Map();
    for (const row of rows) {
      if (!record(row) || !identifier(row.id) || result.has(row.id)) fail(`${label}のIDが不正または重複しています。`);
      result.set(row.id, row);
    }
    return result;
  };
  const places = index(data.places, '地名'), sources = index(data.sources, '出典');
  index(data.relations, '関係');
  const scopes = index(data.scopes, '範囲');
  for (const source of sources.values()) {
    if (!['title', 'publisher', 'locator', 'checked_on'].every(key => text(source[key])) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(source.checked_on) || (source.url !== undefined && !safePlaceUrl(source.url))) fail('出典の書誌・位置・確認日・URLを確認してください。');
  }
  const evidence = row => {
    const v = row.verification;
    if (!strings(row.knowledge_ids) || row.knowledge_ids.length === 0 || !strings(row.source_ids) || row.source_ids.length === 0 ||
      row.source_ids.some(id => !sources.has(id)) || !record(v) || v.status !== 'source_verified' ||
      !text(v.method) || !text(v.scope) || !/^\d{4}-\d{2}-\d{2}$/.test(v.checked_on ?? '') || typeof v.human_approved !== 'boolean') fail('地名・関係の知識ID、出典または資料照合記録が不足しています。');
  };
  for (const place of places.values()) {
    if (!text(place.label_ja) || !kinds.includes(place.kind) || !strings(place.aliases) ||
      (place.kind === 'vineyard' && !identifier(place.classification))) fail('地名の表記・種別・格付けを確認してください。');
    evidence(place);
  }
  const children = new Map([...places.keys()].map(id => [id, []]));
  const parents = new Map([...places.keys()].map(id => [id, []]));
  const pairs = new Set();
  for (const relation of data.relations) {
    const parent = places.get(relation.parent_id), child = places.get(relation.child_id);
    const pair = `${relation.parent_id}/${relation.child_id}`;
    if (!parent || !child || parent === child || pairs.has(pair) || relation.relation_type !== 'contains') fail('関係の参照先・重複・自己参照を確認してください。');
    const sameLayer = ['region', 'district'].includes(parent.kind) && parent.kind === child.kind;
    if ((!sameLayer && kinds.indexOf(parent.kind) >= kinds.indexOf(child.kind)) ||
      (child.kind === 'vineyard' && parent.kind !== 'village')) fail('階層種別と親子関係が一致しません。');
    evidence(relation);
    pairs.add(pair); children.get(parent.id).push(relation); parents.get(child.id).push(relation);
  }
  const visited = new Set(), visiting = new Set();
  const visit = id => {
    if (visiting.has(id)) fail('親子関係が循環しています。');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const edge of children.get(id)) visit(edge.child_id);
    visiting.delete(id); visited.add(id);
  };
  for (const id of places.keys()) visit(id);
  for (const place of places.values()) {
    if (place.kind !== 'country' && parents.get(place.id).length === 0) fail('親のない地名があります。');
  }
  const model = { ...data, places, sources, scopes, children, parents };
  for (const scope of scopes.values()) {
    if (!text(scope.label_ja) || places.get(scope.country_id)?.kind !== 'country' ||
      !['region', 'district'].includes(places.get(scope.root_id)?.kind) || !identifier(scope.classification) ||
      scope.coverage !== 'selected' || !text(scope.note) || !descendantIds(model, scope.country_id).has(scope.root_id)) fail('学習範囲を確認してください。');
    if (placeCards(model, scope.id).length === 0) fail('学習範囲の正解集合が空です。');
  }
  return model;
}

export function descendantIds(model, rootId) {
  const result = new Set();
  const visit = id => { if (result.has(id)) return; result.add(id); for (const edge of model.children.get(id) ?? []) visit(edge.child_id); };
  visit(rootId);
  return result;
}

/** Labels/order are intentionally absent from the answer signature. */
export function placeCards(model, scopeId, direction = 'mixed') {
  const scope = model.scopes.get(scopeId);
  if (!scope || !['mixed', ...PLACE_DIRECTIONS].includes(direction)) throw new Error('学習範囲・出題方向を選んでください。');
  const included = descendantIds(model, scope.root_id);
  const edges = model.relations.filter(edge => included.has(edge.parent_id) && included.has(edge.child_id) &&
    model.places.get(edge.parent_id).kind === 'village' && model.places.get(edge.child_id).classification === scope.classification);
  const cards = [];
  for (const current of PLACE_DIRECTIONS.filter(item => direction === 'mixed' || direction === item)) {
    const forward = current === 'village_to_vineyard', groups = new Map();
    for (const edge of edges) {
      const subject = forward ? edge.parent_id : edge.child_id;
      if (!groups.has(subject)) groups.set(subject, []);
      groups.get(subject).push(edge);
    }
    for (const [subjectId, relations] of groups) {
      const answerIds = [...new Set(relations.map(edge => forward ? edge.child_id : edge.parent_id))].sort();
      const relationIds = relations.map(edge => edge.id).sort();
      const label = model.places.get(subjectId).label_ja;
      cards.push({
        id: `${model.dataset_id}:${scope.id}:${current}:${subjectId}`, direction: current, subject_id: subjectId,
        answer_ids: answerIds, relation_ids: relationIds, scope_id: scope.id,
        source_ids: [...new Set(relations.flatMap(edge => edge.source_ids))],
        knowledge_ids: [...new Set(relations.flatMap(edge => edge.knowledge_ids))],
        signature: JSON.stringify([scope.id, scope.root_id, scope.classification, scope.coverage, current, subjectId, answerIds,
          relations.map(edge => [edge.id, edge.parent_id, edge.child_id, edge.relation_type]).sort((a, b) => a[0].localeCompare(b[0]))]),
        prompt: forward ? `${label}にある、収録対象の特級畑をすべて挙げてください（${answerIds.length}件）。`
          : `${label}がある村をすべて挙げてください（収録対象の${answerIds.length}村）。`,
      });
    }
  }
  return cards.sort((a, b) => a.id.localeCompare(b.id));
}

export async function loadPlaceData(fetcher = globalThis.fetch) {
  const url = new URL('../question-packs/place-relations.json', import.meta.url);
  const version = new URL(import.meta.url).searchParams.get('v');
  if (version) url.searchParams.set('v', version);
  try {
    const response = await fetcher(url, { cache: 'no-store' });
    if (!response?.ok) throw new Error(`HTTP ${response?.status ?? '不明'}`);
    return parsePlaceData(await response.text());
  } catch (error) { throw new Error(`place-relations.json を読み込めません。${error.message}`); }
}

export class PlaceSession {
  constructor(cards, retry = false) {
    this.cards = [...cards]; this.retry = retry; this.index = 0; this.revealed = false; this.evaluated = false;
  }
  get current() { return this.cards[this.index] ?? null; }
  get total() { return this.cards.length; }
  get complete() { return this.index >= this.total; }
  reveal() { if (!this.current) return false; this.revealed = true; return true; }
  evaluate(result) {
    if (!this.current || !this.revealed || this.evaluated || !['remembered', 'forgotten'].includes(result)) return false;
    this.evaluated = true; return true;
  }
  next() {
    if (!this.evaluated || !this.current) return false;
    this.index += 1; this.revealed = false; this.evaluated = false; return true;
  }
}
