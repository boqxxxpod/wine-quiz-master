import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePlaceData, placeCards, placeLessons, descendantIds, loadPlaceData, PlaceSession } from '../static/places.js';

const raw = JSON.parse(readFileSync(new URL('../question-packs/place-relations.json', import.meta.url), 'utf8'));
const parse = data => parsePlaceData(JSON.stringify(data));
const model = parse(raw), scope = 'bourgogne-selected';

test('real data: verified sources, existing knowledge IDs, selected coverage and exact counts', () => {
  const pack = JSON.parse(readFileSync(new URL('../question-packs/wine-quiz-highlighted.json', import.meta.url), 'utf8'));
  const coverage = JSON.parse(readFileSync(new URL('../question-packs/coverage.json', import.meta.url), 'utf8'));
  const known = new Set(coverage.entries.map(row => row.knowledge_id));
  const added = new Set(raw.supplemental_knowledge.map(row => row.id));
  for (const row of [...raw.places, ...raw.relations]) {
    for (const id of row.knowledge_ids) assert.ok(known.has(id) || added.has(id), id);
    assert.equal(row.verification.status, 'source_verified');
    assert.equal(row.verification.human_approved, false);
    assert.ok(row.source_ids.every(id => model.sources.has(id)));
  }
  assert.equal(pack.questions.length, 662);
  assert.equal(model.places.size, 15); assert.equal(model.relations.length, 15);
  assert.equal(placeCards(model, scope).length, 12);
  assert.equal(placeCards(model, scope, 'village_to_vineyard').length, 5);
  assert.equal(placeCards(model, scope, 'vineyard_to_village').length, 7);
  assert.equal(descendantIds(model, 'fr').size, 15);
});

test('multiple vineyards per village and a single shared vineyard with two correct villages', () => {
  const cards = placeCards(model, scope);
  const forward = cards.find(card => card.subject_id === 'morey-saint-denis');
  assert.equal(forward.answer_ids.length, 3); assert.match(forward.prompt, /3件/);
  const reverse = cards.find(card => card.subject_id === 'bonnes-mares');
  assert.deepEqual(reverse.answer_ids, ['chambolle-musigny', 'morey-saint-denis']);
  assert.match(reverse.prompt, /2村/); assert.notEqual(reverse.id, forward.id);
});

test('readable lessons group every vineyard under the correct village and retain stable notebook identity', () => {
  const lessons = placeLessons(model, scope);
  assert.equal(lessons.length, 5);
  assert.deepEqual(lessons.find(lesson => lesson.village.id === 'morey-saint-denis').vineyards.map(place => place.id), ['clos-de-tart', 'clos-de-la-roche', 'bonnes-mares']);
  assert.ok(lessons.every(lesson => lesson.id.startsWith('notebook:') && lesson.districts[0].id === 'cote-de-nuits'));
  const renamed = structuredClone(raw); renamed.places.find(place => place.id === 'chambertin').label_ja = '合成テスト用の表示名';
  assert.deepEqual(placeLessons(parse(renamed), scope).map(lesson => [lesson.id, lesson.signature]), lessons.map(lesson => [lesson.id, lesson.signature]));
  const changed = structuredClone(raw); changed.relations = changed.relations.filter(edge => edge.id !== 'morey-saint-denis--bonnes-mares');
  const changedLessons = placeLessons(parse(changed), scope);
  assert.notEqual(changedLessons.find(lesson => lesson.village.id === 'chambolle-musigny').signature,
    lessons.find(lesson => lesson.village.id === 'chambolle-musigny').signature);
  const moved = structuredClone(raw);
  moved.places.push({ ...moved.places.find(place => place.id === 'cote-de-nuits'), id: 'synthetic-subdistrict' });
  const parentEdge = moved.relations.find(edge => edge.child_id === 'gevrey-chambertin');
  moved.relations.push({ ...parentEdge, id: 'synthetic-subdistrict-parent', child_id: 'synthetic-subdistrict' });
  parentEdge.parent_id = 'synthetic-subdistrict';
  const movedLessons = placeLessons(parse(moved), scope);
  assert.notEqual(movedLessons[0].signature, lessons[0].signature);
  assert.equal(movedLessons[1].signature, lessons[1].signature);
});

test('stable identity and signature survive renamed/reordered places; answer changes invalidate only related cards', () => {
  const changed = structuredClone(raw); changed.places.reverse(); changed.relations.reverse();
  changed.places.find(row => row.id === 'musigny').label_ja = '表示名の変更';
  const original = placeCards(model, scope), reordered = placeCards(parse(changed), scope);
  assert.deepEqual(reordered.map(card => [card.id, card.signature]), original.map(card => [card.id, card.signature]));
  changed.relations = changed.relations.filter(row => row.id !== 'morey-saint-denis--clos-de-la-roche');
  changed.places = changed.places.filter(row => row.id !== 'clos-de-la-roche');
  const after = placeCards(parse(changed), scope);
  assert.notEqual(after.find(card => card.subject_id === 'morey-saint-denis').signature, original.find(card => card.subject_id === 'morey-saint-denis').signature);
  assert.equal(after.find(card => card.subject_id === 'chambertin').signature, original.find(card => card.subject_id === 'chambertin').signature);
});

test('intermediate regions are data-driven; invalid graph, provenance and empty scope are rejected', () => {
  const approved = structuredClone(raw);
  approved.places[0].verification.human_approved = true;
  assert.equal(parse(approved).places.get('fr').verification.human_approved, true);
  const deeper = structuredClone(raw);
  deeper.places.push({ ...deeper.places.find(row => row.id === 'cote-de-nuits'), id: 'synthetic-subdistrict', label_ja: '合成テスト専用の地区' });
  const edge = deeper.relations.find(row => row.child_id === 'morey-saint-denis');
  deeper.relations.push({ ...edge, id: 'synthetic-parent', child_id: 'synthetic-subdistrict' }); edge.parent_id = 'synthetic-subdistrict';
  assert.equal(placeCards(parse(deeper), scope).length, 12);
  const mutations = [
    data => data.places.push(data.places[0]),
    data => { data.relations[0].child_id = 'missing'; },
    data => data.relations.push({ ...data.relations[0], id: 'duplicate-pair' }),
    data => { data.relations[0].child_id = data.relations[0].parent_id; },
    data => { data.relations[0].verification.status = 'auto_checked'; },
    data => { data.relations[0].source_ids = ['missing']; },
    data => { data.places[0].kind = 'invalid'; },
    data => { data.sources[0].url = 'javascript:alert(1)'; },
    data => { data.scopes[0].root_id = 'chambertin'; },
    data => { data.scopes[0].classification = 'missing'; },
  ];
  for (const mutate of mutations) { const data = structuredClone(raw); mutate(data); assert.throws(() => parse(data), /地名データ/); }
  const cycle = structuredClone(raw);
  cycle.places.push({ ...cycle.places[1], id: 'synthetic-region' });
  cycle.relations.push({ ...cycle.relations[0], id: 'cycle-a', parent_id: 'bourgogne', child_id: 'synthetic-region' },
    { ...cycle.relations[0], id: 'cycle-b', parent_id: 'synthetic-region', child_id: 'bourgogne' });
  assert.throws(() => parse(cycle), /循環/);
  assert.throws(() => parsePlaceData('{broken'), /JSON/);
});

test('card session requires reveal and one evaluation; a retry is a bounded separate round', () => {
  const session = new PlaceSession(placeCards(model, scope).slice(0, 1), true);
  assert.equal(session.evaluate('remembered'), false); assert.equal(session.next(), false);
  assert.equal(session.reveal(), true); assert.equal(session.evaluate('invalid'), false);
  assert.equal(session.evaluate('forgotten'), true); assert.equal(session.evaluate('remembered'), false);
  assert.equal(session.next(), true); assert.equal(session.complete, true); assert.equal(session.reveal(), false);
});

test('loader uses module-relative URL, no-store, and propagates errors instead of quiz fallback', async () => {
  await loadPlaceData(async (url, options) => {
    assert.ok(url.pathname.endsWith('/question-packs/place-relations.json'));
    assert.equal(options.cache, 'no-store'); return { ok: true, text: async () => JSON.stringify(raw) };
  });
  for (const fetcher of [async () => ({ ok: false, status: 404 }), async () => { throw new Error('offline'); },
    async () => ({ ok: true, text: async () => '{}' })]) await assert.rejects(loadPlaceData(fetcher), /place-relations.json/);
});
