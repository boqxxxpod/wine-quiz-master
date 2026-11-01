import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { placeBrowser } from './helpers/place-browser.mjs';

const raw = readFileSync(new URL('../question-packs/place-relations.json', import.meta.url), 'utf8');
const assetVersion = readFileSync(new URL('../static/index.html', import.meta.url), 'utf8').match(/app\.js\?v=([^"']+)/)[1];
const notebookKey = 'wineQuizMaster.placeNotebook.v1:bourgogne-places';
const legacyKey = 'wineQuizMaster.placeMaster.v1:bourgogne-places';

test('opening the material shows all five lessons and overview immediately without a question flow', async () => {
  const app = await placeBrowser(); assert.equal(app.requests.length, 1);
  assert.equal(app.requests[0].pathname, '/wine-quiz-master/question-packs/wine-quiz-practice-20261031.json');
  assert.equal(app.$('#pack-practice').checked, true);
  await app.$('#open-place-master').click();
  assert.equal(app.$('#view-setup').hidden, true); assert.equal(app.$('#view-place-master').hidden, false);
  assert.equal(app.requests.at(-1).pathname, '/wine-quiz-master/question-packs/place-relations.json');
  assert.equal(app.requests[0].searchParams.get('v'), assetVersion);
  assert.equal(app.requests.at(-1).searchParams.get('v'), assetVersion);
  assert.equal(app.$('#place-content').querySelectorAll('.notebook-lesson').length, 5);
  assert.match(app.$('#place-content').textContent, /村と畑の見取り図/);
  assert.match(app.$('#place-content').textContent, /コート・ド・ニュイ/);
  for (const label of ['ジュヴレ・シャンベルタン','シャンベルタン','モレ・サン・ドニ','クロ・ド・タール','クロ・ド・ラ・ロッシュ','ミュジニィ','ロマネ・コンティ']) assert.ok(app.$('#place-content').textContent.includes(label));
  for (const id of ['place-count','place-direction','place-start','place-reveal','place-remembered','place-next','place-stats']) assert.equal(app.$(`#${id}`), null, id);
  assert.equal(app.storage.size, 0); // Reading never records an assessment automatically.
  await app.$('#place-home').click(); await app.$('#start-practice').click();
  assert.equal(app.$('#view-practice').hidden, false); assert.equal(app.$('#view-place-master').hidden, true);
});

test('returning from the material preserves an explicitly selected textbook and its practice settings', async () => {
  const app = await placeBrowser();
  app.$('#pack-textbook').checked = true; await app.$('#pack-textbook').dispatch('change');
  await app.choose('#question-count', '5');
  const before = app.requests.length;
  await app.$('#open-place-master').click(); await app.$('#place-home').click();
  assert.equal(app.$('#pack-textbook').checked, true); assert.equal(app.$('#pack-practice').checked, false);
  assert.equal(app.$('#question-count').value, '5'); assert.match(app.$('#scope-all-count').textContent, /662/);
  assert.equal(app.requests.length, before + 1); // Only the place dataset was fetched.
  await app.$('#start-practice').click(); assert.match(app.$('#active-scope').textContent, /教科書問題.*5/);
});

test('vineyard covers hide the actual names and one reveal updates all references consistently', async () => {
  const app = await placeBrowser(); await app.$('#open-place-master').click(); await app.$('#place-mode-fields').click();
  assert.equal(app.$('#place-mode-fields').getAttribute('aria-pressed'), 'true');
  assert.equal(app.$('#place-content').textContent.includes('クロ・ド・タール'), false);
  assert.equal(app.$('#place-content').textContent.includes('ボンヌ・マール'), false);
  assert.ok(app.$('#place-content').textContent.includes('モレ・サン・ドニ'));
  const matches = () => app.$('#place-content').querySelectorAll('[data-cover-id="bonnes-mares"]');
  assert.ok(matches().length > 2); await matches()[0].click();
  assert.ok(matches().every(item => item.textContent === 'ボンヌ・マール' && item.getAttribute('aria-pressed') === 'true'));
  await matches()[0].click(); assert.ok(matches().every(item => item.textContent === '••••••'));
  assert.equal(app.storage.size, 0);
  await app.$('#place-mode-read').click(); assert.ok(app.$('#place-content').textContent.includes('ボンヌ・マール'));
});

test('village covers support reverse recall without leaking chapter names through links', async () => {
  const app = await placeBrowser(); await app.$('#open-place-master').click(); await app.$('#place-mode-villages').click();
  assert.equal(app.$('#place-content').textContent.includes('ジュヴレ・シャンベルタン'), false);
  assert.ok(app.$('#place-content').textContent.includes('シャンベルタン'));
  assert.equal(app.$('#place-content').querySelectorAll('a button').length, 0);
  const link = app.$('#place-content').querySelector('.notebook-contents a'); assert.match(link.textContent, /まとまり 1/);
  await link.click(); assert.equal(app.document.activeElement.id, 'lesson-gevrey-chambertin');
  await app.$('#place-home').click(); await app.$('#open-place-master').click();
  assert.equal(app.$('#place-mode-read').getAttribute('aria-pressed'), 'true');
});

test('material compares similar names and explicitly retains both villages of the shared vineyard', async () => {
  const app = await placeBrowser(); await app.$('#open-place-master').click();
  const comparisons = app.$('.notebook-comparisons');
  assert.match(comparisons.textContent, /村名と畑名を分ける/); assert.match(comparisons.textContent, /同じ「クロ」/);
  assert.match(comparisons.textContent, /ボンヌ・マールは、シャンボール・ミュジニィとモレ・サン・ドニにまたがる/);
  assert.equal(app.$('.notebook-overview').querySelectorAll('.notebook-group').length, 5);
  assert.ok(app.$('#place-content').querySelectorAll('.source-details a').every(link => link.rel === 'noopener noreferrer'));
});

test('reading marks use their own versioned storage and survive reload; overdue links update at midnight', async () => {
  const storage = new Map([[legacyKey, '{legacy-kept-verbatim']]), app = await placeBrowser({ storage });
  await app.$('#open-place-master').click(); await app.$('#review-gevrey-chambertin').click();
  let payload = JSON.parse(storage.get(notebookKey)); assert.equal(payload.schema_version, 1); assert.equal(Object.keys(payload.cards).length, 1);
  assert.equal(Object.values(payload.cards)[0].due_on, '2026-11-02'); assert.equal(storage.get(legacyKey), '{legacy-kept-verbatim');
  await app.$('#review-gevrey-chambertin').click(); payload = JSON.parse(storage.get(notebookKey)); assert.equal(Object.values(payload.cards)[0].stage, 1);
  const reloaded = await placeBrowser({ storage }); await reloaded.$('#open-place-master').click();
  assert.match(reloaded.$('#review-note-gevrey-chambertin').textContent, /2026-11-02/);
  reloaded.changeDay('2026-11-02T00:01:00'); assert.match(reloaded.$('#place-reading-status').textContent, /ジュヴレ・シャンベルタン/);
  await reloaded.$('#review-gevrey-chambertin').click();
  payload = JSON.parse(storage.get(notebookKey)); assert.equal(Object.values(payload.cards)[0].due_on, '2026-11-05');
});

test('reading-again marker links directly to the material and a reviewed mark clears it', async () => {
  const app = await placeBrowser(); await app.$('#open-place-master').click(); await app.$('#again-morey-saint-denis').click();
  assert.match(app.$('#place-reading-status').textContent, /モレ・サン・ドニ/);
  await app.$('#place-reading-status a').click(); assert.equal(app.document.activeElement.id, 'lesson-morey-saint-denis');
  await app.$('#review-morey-saint-denis').click(); assert.doesNotMatch(app.$('#place-reading-status').textContent, /モレ・サン・ドニ/);
});

test('reset confirms and removes only notebook records, preserving legacy and unrelated history', async () => {
  const storage = new Map([[legacyKey, 'legacy'], ['unrelated', 'keep']]), app = await placeBrowser({ storage });
  await app.$('#open-place-master').click(); await app.$('#review-vougeot').click();
  await app.$('#place-reset').click(); await app.$('#place-reset-cancel').click(); assert.ok(storage.has(notebookKey));
  await app.$('#place-reset').click(); await app.$('#place-reset-yes').click();
  assert.equal(storage.has(notebookKey), false); assert.equal(storage.get(legacyKey), 'legacy'); assert.equal(storage.get('unrelated'), 'keep');
});

test('invalid notebook records are preserved; reading remains available until an explicit reset', async () => {
  const storage = new Map([[notebookKey, '{broken']]), app = await placeBrowser({ storage });
  await app.$('#open-place-master').click(); assert.match(app.$('#place-storage-warning').textContent, /上書きしていません/);
  await app.$('#review-chambolle-musigny').click(); assert.equal(storage.get(notebookKey), '{broken');
  assert.equal(app.$('#place-content').querySelectorAll('.notebook-lesson').length, 5);
  await app.$('#place-reset').click(); await app.$('#place-reset-yes').click();
  await app.$('#review-chambolle-musigny').click(); assert.notEqual(storage.get(notebookKey), '{broken');
});

test('data and storage errors never block reading other packs; failed place load can be retried', async () => {
  let fail = true;
  const app = await placeBrowser({ failStorage: true, fetchPlace: async () => fail ? { ok: false, status: 404 } : { ok: true, text: async () => raw } });
  await app.$('#open-place-master').click(); assert.match(app.$('#place-content').textContent, /404/);
  fail = false; await app.$('#place-reload').click(); await app.$('#review-gevrey-chambertin').click();
  assert.match(app.$('#place-storage-warning').textContent, /保存できません/);
  assert.equal(app.$('#place-content').querySelectorAll('.notebook-lesson').length, 5);
  await app.$('#place-home').click(); await app.$('#start-practice').click(); assert.equal(app.$('#view-practice').hidden, false);
});
