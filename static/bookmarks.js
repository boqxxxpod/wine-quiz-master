/** Browser-only question bookmarks, separate from all learning history. */
export const BOOKMARK_STORAGE_KEY = 'wineQuizMaster.bookmarks.v1';
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const identifier = value => typeof value === 'string' && Boolean(value.trim());
const unavailableMessage = 'しおりを保存できません。このタブ内のみ有効です。ブラウザの保存設定を確認してください。';

export class BookmarkStore {
  constructor(storage = undefined) {
    this.packs = new Map();
    this.warning = '';
    this.blocked = false;
    this.useBrowserStorage = storage === undefined;
    try {
      this.storage = this.useBrowserStorage ? globalThis.localStorage : storage;
      if (!this.storage) throw new Error();
    } catch {
      this.storage = null;
      this.warning = unavailableMessage;
    }
    if (!this.storage) return;
    let saved;
    try { saved = this.storage.getItem(BOOKMARK_STORAGE_KEY); }
    catch {
      this.blocked = true;
      this.warning = 'しおりを読み込めません。保存済みの記録は上書きせず、このタブ内のみで操作します。保存設定を確認するか、しおりをすべて削除して復旧してください。';
      return;
    }
    if (saved === null) return;
    try {
      const payload = JSON.parse(saved);
      if (!record(payload) || payload.schema_version !== 1 || !record(payload.packs) ||
        !Object.entries(payload.packs).every(([key, ids]) => identifier(key) && Array.isArray(ids) &&
          ids.every(identifier) && new Set(ids).size === ids.length)) throw new Error();
      for (const [key, ids] of Object.entries(payload.packs)) this.packs.set(key, new Set(ids));
    } catch {
      this.blocked = true;
      this.warning = 'しおりの保存形式・版を確認できません。保存済みの記録は上書きせず、このタブ内のみで操作します。「しおりをすべて削除」で復旧できます。';
    }
  }

  has(packKey, questionId) { return this.packs.get(packKey)?.has(questionId) ?? false; }

  count(packKey = undefined) {
    if (packKey !== undefined) return this.packs.get(packKey)?.size ?? 0;
    return [...this.packs.values()].reduce((sum, ids) => sum + ids.size, 0);
  }

  questions(packKey, questions) { return questions.filter(question => this.has(packKey, question.id)); }

  toggle(packKey, questionId) {
    if (!identifier(packKey) || !identifier(questionId)) throw new TypeError('問題集と問題のIDが必要です。');
    const ids = this.packs.get(packKey) ?? new Set();
    const bookmarked = !ids.has(questionId);
    if (bookmarked) ids.add(questionId); else ids.delete(questionId);
    if (ids.size) this.packs.set(packKey, ids); else this.packs.delete(packKey);
    this.save();
    return bookmarked;
  }

  save() {
    if (!this.storage || this.blocked) return false;
    try {
      this.storage.setItem(BOOKMARK_STORAGE_KEY, JSON.stringify({ schema_version: 1,
        packs: Object.fromEntries([...this.packs].map(([key, ids]) => [key, [...ids]])) }));
      this.warning = '';
      return true;
    } catch {
      this.warning = 'しおりを保存できません。今回の変更は再読み込み後に失われます。ブラウザの保存設定・空き容量を確認してください。';
      return false;
    }
  }

  clear() {
    try {
      // Access may become available after a browser permission change.
      if (!this.storage && this.useBrowserStorage) this.storage = globalThis.localStorage;
      if (!this.storage) throw new Error();
      this.storage.removeItem(BOOKMARK_STORAGE_KEY);
    } catch {
      this.warning = 'しおりを削除できませんでした。ブラウザの保存設定を確認して、もう一度お試しください。';
      return false;
    }
    this.packs.clear();
    this.blocked = false;
    this.warning = '';
    return true;
  }
}
