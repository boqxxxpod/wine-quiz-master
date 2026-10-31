import { readFileSync } from 'node:fs';
import vm from 'node:vm';

class Node {
  constructor(tagName = '', text = '') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.style = {};
    this.listeners = new Map();
    this._text = text;
    this.value = '';
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.classList = {
      add: name => this.classList.toggle(name, true),
      remove: name => this.classList.toggle(name, false),
      contains: name => this.className.split(/\s+/).includes(name),
      toggle: (name, enabled = !this.classList.contains(name)) => {
        const names = new Set(this.className.split(/\s+/).filter(Boolean));
        if (enabled) names.add(name); else names.delete(name);
        this.className = [...names].join(' ');
        return enabled;
      },
    };
  }
  get id() { return this.attributes.get('id') ?? ''; }
  set id(value) { this.attributes.set('id', value); }
  get className() { return this.attributes.get('class') ?? ''; }
  set className(value) { this.attributes.set('class', value); }
  get textContent() { return this._text + this.children.map(node => node.textContent).join(''); }
  set textContent(value) { this._text = String(value); this.children = []; }
  get options() { return this.children.filter(node => node.tagName === 'OPTION'); }
  get firstElementChild() { return this.children.find(node => node.tagName) ?? null; }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);
    if (['name', 'value', 'type', 'href', 'rel', 'target'].includes(name)) this[name] = String(value);
    if (['checked', 'disabled', 'hidden'].includes(name)) this[name] = true;
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  append(...nodes) {
    for (let node of nodes) {
      if (typeof node === 'string') node = new Node('', node);
      node.parentElement = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes) { this.children = []; this._text = ''; this.append(...nodes); }
  addEventListener(name, listener) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(listener);
  }
  async dispatch(name) {
    const event = { target: this, currentTarget: this, preventDefault() {} };
    for (const listener of this.listeners.get(name) ?? []) await listener(event);
  }
  async click() { if (!this.disabled) await this.dispatch('click'); }
  root() { let node = this; while (node.parentElement) node = node.parentElement; return node; }
  focus() { this.root().activeElement = this; }
  scrollIntoView() { this.root().scrollTarget = this; }
  matches(selector) {
    const tag = selector.match(/^[a-z][\w-]*/i)?.[0];
    if (tag && this.tagName !== tag.toUpperCase()) return false;
    const id = selector.match(/#([\w-]+)/)?.[1];
    if (id && this.id !== id) return false;
    for (const [, name] of selector.matchAll(/\.([\w-]+)/g)) if (!this.classList.contains(name)) return false;
    for (const [, name, value] of selector.matchAll(/\[([\w-]+)(?:=["']?([^\]"']+)["']?)?\]/g)) {
      if (this.getAttribute(name) === null) return false;
      if (value !== undefined && this.getAttribute(name) !== value) return false;
    }
    if (selector.includes(':checked') && !this.checked) return false;
    return Boolean(this.tagName);
  }
  querySelectorAll(selector) {
    const descendants = [];
    const walk = node => { for (const child of node.children) { descendants.push(child); walk(child); } };
    walk(this);
    const parts = selector.trim().split(/\s+(?:>\s+)?/);
    return descendants.filter(node => {
      if (!node.matches(parts.at(-1))) return false;
      let parent = node.parentElement;
      for (let index = parts.length - 2; index >= 0; index -= 1) {
        while (parent && !parent.matches(parts[index])) parent = parent.parentElement;
        if (!parent) return false;
        parent = parent.parentElement;
      }
      return true;
    });
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}

function documentFromHtml(html) {
  const document = new Node('document');
  const stack = [document];
  const voidTags = new Set(['meta', 'link', 'input', 'br', 'img', 'hr']);
  for (const token of html.match(/<!--[\s\S]*?-->|<![^>]*>|<[^>]+>|[^<]+/g)) {
    if (token.startsWith('<!')) continue;
    if (token.startsWith('</')) { stack.pop(); continue; }
    if (token.startsWith('<')) {
      const name = token.match(/^<([\w-]+)/)?.[1];
      if (!name) continue;
      const node = new Node(name);
      for (const [, key, double, single, bare] of token.slice(name.length + 1, -1).matchAll(/([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
        node.setAttribute(key, double ?? single ?? bare ?? '');
      }
      stack.at(-1).append(node);
      if (!voidTags.has(name) && !token.endsWith('/>')) stack.push(node);
    } else stack.at(-1).append(new Node('', token));
  }
  document.createElement = name => new Node(name);
  document.createTextNode = text => new Node('', text);
  return document;
}

export { documentFromHtml };

export async function placeBrowser({ storage = new Map(), fetchPlace, failStorage = false } = {}) {
  const base = new URL('../../', import.meta.url);
  const document = documentFromHtml(readFileSync(new URL('static/index.html', base), 'utf8'));
  const requests = [], timers = [];
  let instant = '2026-11-01T12:00:00';
  class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [instant])); } }
  const localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => {
    if (failStorage) throw new Error('quota'); storage.set(key, value);
  }, removeItem: key => storage.delete(key) };
  const fetch = async input => {
    const url = new URL(String(input)); requests.push(url);
    if (url.pathname.endsWith('/place-relations.json') && fetchPlace) return fetchPlace(url);
    const path = url.pathname.replace('/wine-quiz-master/', '');
    const text = readFileSync(new URL(path, base), 'utf8');
    return { ok: true, text: async () => text };
  };
  const context = vm.createContext({ document, fetch, URL, TextEncoder, console, Date: ClockDate, localStorage,
    window: { addEventListener() {} }, setInterval(callback) { timers.push(callback); return 1; } });
  const modules = new Map();
  function loadModule(url) {
    if (modules.has(url.href)) return modules.get(url.href);
    const local = new URL(url); local.search = '';
    const sourceText = readFileSync(local, 'utf8'), names = [];
    for (const match of sourceText.matchAll(/\bexport\s+(?:async\s+)?(?:function|class|const|let)\s+(\w+)/g)) names.push(match[1]);
    let code = sourceText.replace(/^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?$/gm, (_, imports, source) =>
      `const {${imports.replace(/\s+as\s+/g, ': ')}} = __load(${JSON.stringify(new URL(source, url).href)});`)
      .replace(/\bexport\s+(?=(?:async\s+)?(?:function|class|const|let)\s)/g, '')
      .replaceAll('import.meta.url', JSON.stringify(`https://app.example/wine-quiz-master/static/${url.pathname.split('/').at(-1)}${url.search}`));
    const run = vm.runInContext(`(function(__load) { ${code}\nreturn { ${names.join(', ')} }; })`, context, { filename: local.pathname });
    const exports = run(value => loadModule(new URL(value))); modules.set(url.href, exports); return exports;
  }
  loadModule(new URL('static/app.js', base));
  for (let i = 0; i < 5; i += 1) await new Promise(resolve => setImmediate(resolve));
  return { document, requests, storage, $: selector => document.querySelector(selector),
    async choose(selector, value) { const field = document.querySelector(selector); field.value = value; await field.dispatch('change'); },
    changeDay(value) { instant = value; for (const timer of timers) timer(); } };
}
