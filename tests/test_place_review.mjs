import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parsePlaceData, placeCards } from '../static/places.js';
import { localDay, addDays, updatedReview, selectPlaceCards, reviewStats, retryCards, PlaceReviewStore } from '../static/place-review.js';

const model = parsePlaceData(readFileSync(new URL('../question-packs/place-relations.json', import.meta.url), 'utf8'));
const cards = placeCards(model, 'bourgogne-selected');
const clock = day => new Date(`${day}T12:00:00`);
const memory = () => ({ values: new Map(), getItem(key) { return this.values.get(key) ?? null; },
  setItem(key, value) { this.values.set(key, value); }, removeItem(key) { this.values.delete(key); } });

test('calendar arithmetic at month/year/leap boundaries and Japan/US local day boundaries', () => {
  assert.equal(addDays('2028-02-28', 1), '2028-02-29'); assert.equal(addDays('2028-02-29', 1), '2028-03-01');
  assert.equal(addDays('2026-12-31', 3), '2027-01-03'); assert.throws(() => addDays('2026-02-29', 1));
  for (const [TZ, expected] of [['Asia/Tokyo', '2026-11-01'], ['America/Los_Angeles', '2026-10-31']]) {
    const script = `import {localDay,addDays} from ${JSON.stringify(new URL('../static/place-review.js', import.meta.url).href)}; console.log(localDay(new Date('2026-10-31T23:30:00Z')),addDays('2026-03-07',3));`;
    assert.equal(execFileSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, TZ }, encoding: 'utf8' }).trim(), `${expected} 2026-03-10`);
  }
});

test('1/3/7/7 progression, due-date retrieval, and early/same-day review cannot advance it', () => {
  const card = cards[0]; let entry = updatedReview(null, card, 'remembered', clock('2026-11-01'));
  assert.equal(entry.due_on, '2026-11-02'); assert.equal(entry.stage, 1);
  entry = updatedReview(entry, card, 'remembered', clock('2026-11-01')); assert.equal(entry.stage, 1);
  entry = updatedReview(entry, card, 'remembered', clock('2026-11-02')); assert.equal(entry.due_on, '2026-11-05');
  entry = updatedReview(entry, card, 'remembered', clock('2026-11-03')); assert.equal(entry.stage, 2); assert.equal(entry.due_on, '2026-11-05');
  entry = updatedReview(entry, card, 'remembered', clock('2026-11-05')); assert.equal(entry.due_on, '2026-11-12'); assert.equal(entry.stage, 3);
  entry = updatedReview(entry, card, 'remembered', clock('2026-11-12')); assert.equal(entry.due_on, '2026-11-19'); assert.equal(entry.stage, 3);
});

test('failure resets every stage, persists same-day retry, and bounds repeat failures', () => {
  for (let stage = 0; stage <= 3; stage += 1) {
    const previous = { ...updatedReview(null, cards[0], 'remembered', clock('2026-10-31')), stage };
    const failed = updatedReview(previous, cards[0], 'forgotten', clock('2026-11-01'));
    assert.equal(failed.stage, 0); assert.equal(failed.due_on, '2026-11-02');
    assert.equal(retryCards(cards, { [cards[0].id]: failed }, clock('2026-11-01')).length, 1);
    const success = updatedReview(failed, cards[0], 'remembered', clock('2026-11-01'), true);
    assert.equal(success.due_on, '2026-11-02'); assert.equal(success.stage, 1);
    const failedAgain = updatedReview(failed, cards[0], 'forgotten', clock('2026-11-01'), true);
    assert.equal(retryCards(cards, { [cards[0].id]: failedAgain }, clock('2026-11-01')).length, 0);
    assert.equal(failedAgain.due_on, '2026-11-02');
  }
});

test('review queue: overdue, today, pending retry, new, future; review-only and count validation', () => {
  const entries = Object.create(null);
  entries[cards[0].id] = updatedReview(null, cards[0], 'remembered', clock('2026-10-29'));
  entries[cards[1].id] = updatedReview(null, cards[1], 'remembered', clock('2026-10-31'));
  entries[cards[2].id] = updatedReview(null, cards[2], 'forgotten', clock('2026-11-01'));
  entries[cards[3].id] = updatedReview(null, cards[3], 'remembered', clock('2026-11-01'));
  const options = { now: clock('2026-11-01'), random: () => 0.5 };
  const queue = selectPlaceCards(cards, entries, options);
  assert.deepEqual(queue.slice(0, 3).map(card => card.id), cards.slice(0, 3).map(card => card.id));
  assert.equal(queue.at(-1).id, cards[3].id); assert.equal(new Set(queue.map(card => card.id)).size, 12);
  assert.equal(selectPlaceCards(cards, entries, { ...options, target: 'review' }).length, 3);
  assert.equal(selectPlaceCards(cards, {}, { ...options, target: 'review' }).length, 0);
  assert.equal(selectPlaceCards(cards, entries, { ...options, count: 5 }).length, 5);
  for (const count of [0, -1, 4, 20, NaN]) assert.throws(() => selectPlaceCards(cards, entries, { ...options, count }));
  assert.deepEqual(reviewStats(cards, entries, clock('2026-11-01')), { total: 12, learned: 4, remembered: 3, needed: 3, today: 3 });
});

test('reloaded history remains directional, resets only its own key, and removes expired retry state from today counts', () => {
  const storage = memory(), store = new PlaceReviewStore(model, cards, () => storage);
  storage.setItem('other-application', 'keep');
  const forward = cards.find(card => card.subject_id === 'gevrey-chambertin');
  const reverse = cards.find(card => card.subject_id === 'chambertin');
  store.evaluate(forward, 'forgotten', clock('2026-11-01'));
  const loaded = new PlaceReviewStore(model, cards, () => storage);
  assert.equal(loaded.entries[reverse.id], undefined); assert.equal(loaded.entries[forward.id].last_result, 'forgotten');
  assert.equal(retryCards(cards, loaded.entries, clock('2026-11-02')).length, 0);
  assert.equal(reviewStats(cards, loaded.entries, clock('2026-11-02')).today, 1);
  assert.equal(loaded.reset(), true); assert.equal(storage.getItem('other-application'), 'keep'); assert.equal(storage.getItem(store.key), null);
});

test('data updates retain stable signatures, drop removed/changed cards, and introduce new ones as unlearned', () => {
  const storage = memory(), before = new PlaceReviewStore(model, cards, () => storage);
  for (const card of cards) before.evaluate(card, 'remembered', clock('2026-11-01'));
  const changed = cards.slice(1).map((card, i) => i ? card : { ...card, signature: 'new answer set' });
  changed.push({ ...cards[0], id: 'new-card' });
  const after = new PlaceReviewStore({ ...model, data_version: 'new-version' }, changed, () => storage);
  assert.equal(Object.keys(after.entries).length, 10); assert.equal(after.entries[cards[0].id], undefined);
  assert.equal(after.entries[changed[0].id], undefined); assert.equal(after.entries['new-card'], undefined);
  assert.equal(after.entries[changed[1].id].stage, 1);
});

test('corrupt and unknown-version history is preserved verbatim and never overwritten before explicit reset', () => {
  for (const payload of ['{broken', '{"schema_version":0}', '{"schema_version":99}',
    JSON.stringify({ schema_version: 1, dataset_id: model.dataset_id, data_version: 'v1', cards: { broken: {} } })]) {
    const storage = memory(), empty = new PlaceReviewStore(model, cards, () => storage); storage.setItem(empty.key, payload);
    const store = new PlaceReviewStore(model, cards, () => storage);
    assert.equal(store.blocked, true); assert.match(store.warning, /上書きしていません/);
    store.evaluate(cards[0], 'remembered', clock('2026-11-01')); assert.equal(storage.getItem(store.key), payload);
    store.reset(); store.evaluate(cards[0], 'remembered', clock('2026-11-01')); assert.notEqual(storage.getItem(store.key), payload);
  }
});

test('storage getter/read/write/reset errors leave learning usable with an explicit warning', () => {
  const absent = new PlaceReviewStore(model, cards, () => { throw new Error('denied'); });
  absent.evaluate(cards[0], 'remembered'); assert.equal(Object.keys(absent.entries).length, 1); assert.match(absent.warning, /保存できません/);
  const blockedRead = new PlaceReviewStore(model, cards, () => ({ getItem() { throw new Error('denied'); } })); assert.equal(blockedRead.blocked, true);
  const storage = memory(), store = new PlaceReviewStore(model, cards, () => storage);
  storage.setItem = () => { throw new Error('quota'); }; store.evaluate(cards[0], 'forgotten'); assert.match(store.warning, /失われます/);
  storage.removeItem = () => { throw new Error('denied'); }; assert.equal(store.reset(), false); assert.equal(Object.keys(store.entries).length, 1);
});
