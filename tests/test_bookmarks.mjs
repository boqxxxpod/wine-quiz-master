import test from 'node:test';
import assert from 'node:assert/strict';
import { BookmarkStore, BOOKMARK_STORAGE_KEY } from '../static/bookmarks.js';

function memory() {
  const values = new Map();
  return { values, getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}

test('bookmarks restore per pack, toggle repeatedly, and do not alter questions', () => {
  const storage = memory(), store = new BookmarkStore(storage);
  assert.equal(store.warning, '');
  assert.equal(store.toggle('bundled:textbook', 'same-id'), true);
  assert.equal(store.has('bundled:practice', 'same-id'), false);
  store.toggle('bundled:practice', 'same-id');
  store.toggle('bundled:practice', 'deleted-question');
  const loaded = new BookmarkStore(storage);
  assert.equal(loaded.count(), 3);
  assert.equal(loaded.count('bundled:practice'), 2);
  const questions = Object.freeze([Object.freeze({ id: 'same-id' }), Object.freeze({ id: 'new-id' })]);
  assert.deepEqual(loaded.questions('bundled:practice', questions), [questions[0]]);
  assert.equal(loaded.toggle('bundled:textbook', 'same-id'), false);
  assert.equal(loaded.count(), 2);
  assert.equal(new BookmarkStore(storage).has('bundled:practice', 'same-id'), true);
  assert.equal(new BookmarkStore(storage).has('bundled:textbook', 'same-id'), false);
});

test('pack and question IDs cannot collide with object prototype keys', () => {
  const storage = memory(), store = new BookmarkStore(storage);
  for (const key of ['__proto__', 'constructor', 'toString']) {
    store.toggle(key, '__proto__');
    store.toggle(key, 'constructor');
  }
  const restored = new BookmarkStore(storage);
  assert.equal(restored.count(), 6);
  for (const key of ['__proto__', 'constructor', 'toString']) {
    assert.equal(restored.has(key, '__proto__'), true);
    assert.equal(restored.has(key, 'constructor'), true);
  }
  assert.throws(() => store.toggle('', 'id'), TypeError);
  assert.throws(() => store.toggle('pack', null), TypeError);
});

test('clearing removes only the bookmark key across all packs', () => {
  const storage = memory(), store = new BookmarkStore(storage);
  storage.setItem('wineQuizMaster.placeNotebook.v1:bourgogne-places', 'keep notebook');
  storage.setItem('unrelated', 'keep unrelated');
  store.toggle('bundled:textbook', 'q'); store.toggle('custom:other', 'q');
  assert.equal(store.clear(), true);
  assert.equal(store.count(), 0);
  assert.equal(storage.getItem(BOOKMARK_STORAGE_KEY), null);
  assert.equal(storage.getItem('wineQuizMaster.placeNotebook.v1:bourgogne-places'), 'keep notebook');
  assert.equal(storage.getItem('unrelated'), 'keep unrelated');
  assert.equal(new BookmarkStore(storage).count(), 0);
});

test('unavailable storage keeps memory operations and a visible warning', () => {
  const store = new BookmarkStore(null);
  assert.match(store.warning, /保存できません/);
  assert.equal(store.toggle('pack', 'q'), true);
  assert.equal(store.count(), 1);
  assert.match(store.warning, /このタブ内のみ/);
  assert.equal(store.clear(), false);
  assert.equal(store.count(), 1);
});

test('browser storage getter errors never stop normal practice', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('denied'); } });
  try {
    const store = new BookmarkStore();
    store.toggle('pack', 'q');
    assert.match(store.warning, /保存できません/);
    assert.equal(store.has('pack', 'q'), true);
    const storage = memory();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
    assert.equal(store.clear(), true);
    assert.equal(store.warning, '');
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  }
});

test('write and delete failures retain in-memory state and report failure until recovery', () => {
  const storage = memory(), store = new BookmarkStore(storage), originalSet = storage.setItem, originalRemove = storage.removeItem;
  store.toggle('pack', 'saved');
  storage.setItem = () => { throw new Error('quota'); };
  store.toggle('pack', 'unsaved');
  assert.equal(store.count(), 2);
  assert.match(store.warning, /再読み込み後に失われます/);
  assert.equal(new BookmarkStore(storage).has('pack', 'unsaved'), false);
  storage.removeItem = () => { throw new Error('denied'); };
  assert.equal(store.clear(), false); assert.equal(store.count(), 2);
  assert.match(store.warning, /削除できませんでした/);
  storage.setItem = originalSet;
  store.toggle('pack', 'third');
  assert.equal(store.warning, '');
  assert.equal(new BookmarkStore(storage).count(), 3);
  storage.removeItem = originalRemove;
  assert.equal(store.clear(), true);
  assert.equal(store.count(), 0);
});

test('unreadable storage is not overwritten and can be explicitly cleared after recovery', () => {
  const storage = memory(); storage.setItem(BOOKMARK_STORAGE_KEY, 'preserve');
  const originalGet = storage.getItem;
  storage.getItem = () => { throw new Error('read denied'); };
  const store = new BookmarkStore(storage);
  store.toggle('pack', 'new');
  assert.match(store.warning, /読み込めません/);
  assert.equal(storage.values.get(BOOKMARK_STORAGE_KEY), 'preserve');
  storage.getItem = originalGet;
  assert.equal(store.clear(), true);
  store.toggle('pack', 'new');
  assert.equal(new BookmarkStore(storage).has('pack', 'new'), true);
});

for (const saved of ['{broken', 'null', '[]', '{"schema_version":2,"packs":{}}',
  '{"schema_version":1,"packs":{"pack":["q","q"]}}',
  '{"schema_version":1,"packs":{"pack":[null]}}', '{"schema_version":1,"packs":[]}']) {
  test(`invalid or unsupported bookmark data is preserved until explicit clear: ${saved}`, () => {
    const storage = memory(); storage.setItem(BOOKMARK_STORAGE_KEY, saved);
    const store = new BookmarkStore(storage);
    assert.match(store.warning, /保存形式・版/);
    store.toggle('pack', 'memory-only');
    assert.equal(store.has('pack', 'memory-only'), true);
    assert.equal(storage.getItem(BOOKMARK_STORAGE_KEY), saved);
    assert.match(store.warning, /上書きせず/);
    assert.equal(store.clear(), true); assert.equal(store.warning, '');
    assert.equal(store.count(), 0);
    store.toggle('pack', 'persisted');
    assert.equal(new BookmarkStore(storage).has('pack', 'persisted'), true);
  });
}
