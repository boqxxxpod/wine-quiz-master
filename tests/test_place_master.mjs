import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { placeBrowser } from './helpers/place-browser.mjs';

const raw = readFileSync(new URL('../question-packs/place-relations.json', import.meta.url), 'utf8');

test('ordinary quizzes load independently; place mode uses versioned subpath URL and returns home', async () => {
  const app = await placeBrowser();
  assert.equal(app.requests.length, 1); assert.ok(app.requests[0].pathname.endsWith('wine-quiz-highlighted.json'));
  assert.equal(app.$('#view-place-master').hidden, true);
  await app.$('#open-place-master').click();
  assert.equal(app.$('#view-setup').hidden, true); assert.equal(app.$('#view-place-master').hidden, false);
  assert.equal(app.requests.at(-1).pathname, '/wine-quiz-master/question-packs/place-relations.json');
  assert.equal(app.requests.at(-1).searchParams.get('v'), 'place-master-20261101');
  assert.equal(app.$('#place-stat-learned').textContent, '0 件');
  assert.ok(app.$('#place-count').options.find(option => option.value === '20').disabled);
  await app.$('#place-home').click(); assert.equal(app.$('#view-setup').hidden, false);
  await app.$('#start-practice').click(); assert.equal(app.$('#view-practice').hidden, false);
  assert.equal(app.$('#view-place-master').hidden, true);
});

test('flashcard reveal, single self-evaluation, persisted history and four counters', async () => {
  const storage = new Map(), app = await placeBrowser({ storage });
  await app.$('#open-place-master').click(); await app.choose('#place-count', '5'); await app.$('#place-start').click();
  assert.equal(app.$('#place-remembered'), null); assert.equal(app.$('#place-next'), null);
  await app.$('#place-reveal').click();
  const evaluation = app.$('#place-remembered'); await evaluation.click(); await evaluation.click();
  assert.equal(app.$('#place-stat-learned').textContent, '1 件'); assert.equal(app.$('#place-stat-remembered').textContent, '1 件');
  assert.equal(app.$('#place-stat-today').textContent, '0 件');
  const payload = JSON.parse([...storage.values()][0]); assert.equal(Object.keys(payload.cards).length, 1);
  assert.equal(Object.values(payload.cards)[0].stage, 1);
  const reloaded = await placeBrowser({ storage }); await reloaded.$('#open-place-master').click();
  assert.equal(reloaded.$('#place-stat-learned').textContent, '1 件');
  reloaded.changeDay('2026-11-02T00:01:00'); assert.equal(reloaded.$('#place-stat-today').textContent, '1 件');
});

test('direction/review selection clamps count, handles zero cards and refreshes at midnight', async () => {
  const app = await placeBrowser(); await app.$('#open-place-master').click();
  await app.choose('#place-count', '10'); await app.choose('#place-direction', 'village_to_vineyard');
  assert.equal(app.$('#place-count').value, 'all'); assert.match(app.$('#place-available').textContent, /5件/);
  await app.choose('#place-target', 'review'); assert.equal(app.$('#place-start').disabled, true);
  await app.choose('#place-target', 'all'); await app.$('#place-start').click();
  await app.$('#place-reveal').click(); await app.$('#place-remembered').click(); await app.$('#place-study-back').click();
  await app.choose('#place-direction', 'vineyard_to_village'); assert.equal(app.$('#place-stat-learned').textContent, '0 件');
  await app.choose('#place-direction', 'mixed'); app.changeDay('2026-11-02T00:01:00');
  await app.choose('#place-target', 'review'); assert.equal(app.$('#place-start').disabled, false); assert.match(app.$('#place-available').textContent, /1件/);
});

test('failed cards get a separate bounded retry round, then tomorrow remains due', async () => {
  const app = await placeBrowser(); await app.$('#open-place-master').click();
  await app.choose('#place-direction', 'village_to_vineyard'); await app.$('#place-start').click();
  for (let i = 0; i < 5; i += 1) {
    await app.$('#place-reveal').click(); await app.$(i === 0 ? '#place-forgotten' : '#place-remembered').click(); await app.$('#place-next').click();
  }
  assert.match(app.$('#place-retry-today').textContent, /1件/); await app.$('#place-retry-today').click();
  await app.$('#place-reveal').click(); await app.$('#place-forgotten').click(); await app.$('#place-next').click();
  assert.equal(app.$('#place-retry-today'), null); assert.equal(app.$('#place-stat-needed').textContent, '1 件');
  const payload = JSON.parse([...app.storage.values()][0]);
  const failed = Object.values(payload.cards).find(entry => entry.last_result === 'forgotten'); assert.equal(failed.due_on, '2026-11-02');
});

test('tree exposes Japanese hierarchy, all shared-vineyard parents and reference links', async () => {
  const app = await placeBrowser(); await app.$('#open-place-master').click(); await app.$('#place-show-tree').click();
  assert.match(app.$('#place-content').textContent, /フランス（国）/);
  assert.match(app.$('#place-content').textContent, /コート・ド・ニュイ（地区）/);
  assert.match(app.$('#place-content').textContent, /複数の村にまたがる畑/);
  assert.equal(app.$('#place-content').querySelectorAll('strong').filter(element => element.textContent === 'ボンヌ・マール').length, 2);
  assert.ok(app.$('#place-content').querySelectorAll('a').every(link => link.rel === 'noopener noreferrer'));
});

test('reset needs confirmation and deletes only place history; cancellation preserves it', async () => {
  const storage = new Map([['unrelated', 'keep']]), app = await placeBrowser({ storage });
  await app.$('#open-place-master').click(); await app.$('#place-start').click(); await app.$('#place-reveal').click(); await app.$('#place-remembered').click();
  await app.$('#place-study-back').click(); await app.$('#place-reset').click(); await app.$('#place-reset-cancel').click();
  assert.equal(storage.size, 2); await app.$('#place-reset').click(); await app.$('#place-reset-yes').click();
  assert.equal(storage.size, 1); assert.equal(storage.get('unrelated'), 'keep'); assert.equal(app.$('#place-stat-learned').textContent, '0 件');
});

test('data errors are local to place mode and retry succeeds; quota failure is visible', async () => {
  let fail = true;
  const app = await placeBrowser({ failStorage: true, fetchPlace: async () => fail ? { ok: false, status: 404 } : { ok: true, text: async () => raw } });
  await app.$('#open-place-master').click(); assert.match(app.$('#place-content').textContent, /404/);
  fail = false; await app.$('#place-reload').click(); await app.$('#place-start').click(); await app.$('#place-reveal').click(); await app.$('#place-remembered').click();
  assert.equal(app.$('#place-storage-warning').hidden, false); assert.match(app.$('#place-storage-warning').textContent, /保存できません/);
  await app.$('#place-home').click(); await app.$('#start-practice').click(); assert.equal(app.$('#view-practice').hidden, false);
});
