import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// This deliberately small DOM implements the browser operations used by the app.
// It keeps these interaction tests runnable with Node alone, like the model tests.
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
  focus() {}
  scrollIntoView() {}
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

const sources = [
  { title: 'Synthetic reference A', file_name: 'synthetic-paper.png', page: 7, position: '右上の検証箇所', url: 'https://example.com/reference-a' },
  { title: 'Synthetic reference B', publisher: '検証用出版社', url: 'http://example.com/reference-b', year: 2024 },
  { title: 'Synthetic unsafe reference', url: 'javascript:syntheticAttack()', note: '<img src=x onerror=syntheticAttack()>' },
];
function question(id, countries) {
  return {
    id, question: `Synthetic question ${id}`,
    options: ['a', 'b', 'c'].map(id => ({ id, text: `Synthetic choice ${id}` })),
    correct_option_id: 'b', explanation: '合成データの検証専用解説です。',
    primary_country: countries[0], countries, sources,
    validation: { status: 'recorded-unverified', notes: ['構文のみの検証記録'], checked_at: '2026-10-18' },
  };
}
const questions = [
  question('france', ['フランス']), question('italy', ['イタリア']),
  question('cross-country', ['フランス', 'イタリア']), question('spain', ['スペイン']),
];
const generatedQuestion = {
  id: 'generated', prompt: 'Unrelated server-generated question',
  choices: ['a', 'b', 'c'].map(id => ({ id, text: id })), correct_choice_id: 'a',
  explanation: 'Generated explanation', quote: 'Generated quote', source_id: 'generated-source', file_name: 'generated.png', region_id: 'generated-region',
};

async function startApp(mode, { pack = JSON.stringify(questions), status = 200, networkError = false } = {}) {
  const document = documentFromHtml(readFileSync(new URL('../static/index.html', import.meta.url), 'utf8'));
  const requests = [];
  const fetch = async input => {
    const path = new URL(String(input), 'https://app.example/').pathname;
    requests.push(path);
    if (path.endsWith('/wine_quiz_master_set_01.json')) {
      if (networkError) throw new Error('Synthetic network error');
      return { ok: status === 200, status, text: async () => pack, json: async () => JSON.parse(pack) };
    }
    const data = path === '/api/status' ? {
      counts: { questions: 99, sources: 88, pending_review: 0 }, drive: {}, luna: {}, warnings: [],
    } : path === '/api/questions' ? [generatedQuestion] : path === '/api/sources' ? [] : undefined;
    assert.notEqual(data, undefined, `unexpected network request ${path}`);
    return { ok: true, status: 200, json: async () => data };
  };
  const context = vm.createContext({
    document, fetch, URL, URLSearchParams, TextEncoder, console,
    location: { hash: '', href: 'https://app.example/' }, history: { replaceState() {} },
    window: { innerWidth: 1200, addEventListener() {} },
    // Toast lifetimes should not keep a test process open.
    setTimeout() { return 1; }, clearTimeout() {},
  });
  const modules = new Map();
  function loadModule(url) {
    if (url.pathname.endsWith('/runtime.js')) return { mode };
    if (modules.has(url.href)) return modules.get(url.href);
    const exports = [];
    let code = readFileSync(url, 'utf8');
    code = code.replace(/^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?$/gm, (_, names, source) =>
      `const {${names.replace(/\s+as\s+/g, ': ')}} = __load(${JSON.stringify(new URL(source, url).href)});`);
    code = code.replace(/\bexport\s+(?=(?:async\s+)?(?:function|class|const|let)\s)/g, '');
    for (const match of readFileSync(url, 'utf8').matchAll(/\bexport\s+(?:async\s+)?(?:function|class|const|let)\s+(\w+)/g)) exports.push(match[1]);
    code = code.replaceAll('import.meta.url', JSON.stringify(`https://app.example/static/${url.pathname.split('/').at(-1)}`));
    const evaluate = vm.runInContext(`(function(__load) { ${code}\nreturn { ${exports.join(', ')} }; })`, context, { filename: url.pathname });
    const result = evaluate(value => loadModule(new URL(value)));
    modules.set(url.href, result);
    return result;
  }
  loadModule(new URL('../static/app.js', import.meta.url));
  // Initialization intentionally starts asynchronously, like a module script.
  for (let turn = 0; turn < 5; turn += 1) await new Promise(resolve => setImmediate(resolve));
  return { document, requests, $: selector => document.querySelector(selector) };
}

async function chooseCountry(app, country) {
  app.$('#scope-all').checked = false;
  app.$('#scope-country').checked = true;
  await app.$('#scope-country').dispatch('change');
  app.$('#practice-country').value = country;
  await app.$('#practice-country').dispatch('change');
}

async function importPack(app, text, name = 'synthetic-import.json') {
  app.$('#question-pack').files = [{ name, size: Buffer.byteLength(text), text: async () => text }];
  await app.$('#question-pack').dispatch('change');
}

for (const mode of ['server', 'pages']) {
  test(`${mode}: automatically loads the bundled pack and derives all/country counts`, async () => {
    const app = await startApp(mode);
    assert.equal(app.requests.filter(path => path.endsWith('/wine_quiz_master_set_01.json')).length, 1);
    if (mode === 'pages') assert.equal(app.requests.some(path => path.startsWith('/api/')), false);
    assert.equal(app.$('#scope-all').checked, true);
    assert.equal(app.$('#scope-all').name, 'practice-scope');
    assert.equal(app.$('#scope-all').value, 'all');
    assert.equal(app.$('#scope-country').name, 'practice-scope');
    assert.equal(app.$('#scope-country').value, 'country');
    assert.match(app.$('#scope-count').textContent, /4/);
    assert.match(app.$('#active-scope').textContent, /すべて/);
    assert.match(app.$('#question-prompt').textContent, /^Synthetic question /);
    assert.doesNotMatch(app.$('#quiz-root').textContent, /Unrelated server-generated/);
    const options = app.$('#practice-country').options;
    assert.deepEqual(options.filter(option => option.value).map(option => option.value).sort(), ['イタリア', 'スペイン', 'フランス'].sort());
    for (const [country, count] of [['フランス', 2], ['イタリア', 2], ['スペイン', 1]]) {
      await chooseCountry(app, country);
      assert.match(app.$('#scope-count').textContent, new RegExp(String(count)));
    }
  });

  test(`${mode}: starting a selected scope resets answers and restarting retains that scope`, async () => {
    const app = await startApp(mode);
    await app.$('.choice').click();
    assert.ok(app.$('.answer-panel'));
    await chooseCountry(app, 'フランス');
    assert.match(app.$('#active-scope').textContent, /すべて/);
    await app.$('#start-practice').click();
    assert.equal(app.$('.answer-panel'), null);
    assert.equal(app.$('[role="progressbar"]').getAttribute('aria-valuenow'), '0');
    assert.equal(app.$('[role="progressbar"]').getAttribute('aria-valuemax'), '2');
    assert.match(app.$('#active-scope').textContent, /フランス/);
    const seen = [];
    for (let index = 0; index < 2; index += 1) {
      seen.push(app.$('#question-prompt').textContent);
      const correct = app.document.querySelectorAll('.choice').find(node => node.textContent.includes('Synthetic choice b'));
      await correct.click();
      await app.$('.next-row button').click();
    }
    assert.deepEqual(seen.sort(), ['Synthetic question cross-country', 'Synthetic question france']);
    assert.ok(app.$('.completion-card'));
    assert.match(app.$('.completion-score').textContent, /2.*2/);
    await app.$('.completion-card button').click();
    assert.equal(app.$('.completion-card'), null);
    assert.equal(app.$('[role="progressbar"]').getAttribute('aria-valuenow'), '0');
    assert.equal(app.$('[role="progressbar"]').getAttribute('aria-valuemax'), '2');
    assert.match(app.$('#active-scope').textContent, /フランス/);
  });

  test(`${mode}: explanations retain every source and recorded validation with safe links`, async () => {
    const app = await startApp(mode);
    await app.$('.choice').click();
    const panel = app.$('.answer-panel');
    for (const source of sources) for (const value of Object.values(source)) {
      assert.ok(panel.textContent.includes(String(value)), `missing source field ${value}`);
    }
    for (const value of ['recorded-unverified', '構文のみの検証記録', '2026-10-18']) assert.ok(panel.textContent.includes(value));
    assert.doesNotMatch(panel.textContent, /ファクトチェック済み|事実確認済み|検証済みの正答/);
    const links = panel.querySelectorAll('a');
    assert.ok(links.some(node => node.href === sources[0].url));
    assert.ok(links.some(node => node.href === sources[1].url));
    for (const node of links) {
      assert.match(node.href, /^https?:\/\//);
      assert.equal(node.target, '_blank');
      assert.ok(node.rel.includes('noopener'));
    }
    assert.equal(panel.querySelector('img'), null, 'source metadata must be rendered as text');
  });

  test(`${mode}: invalid manual import preserves the active scope and answered session`, async () => {
    const app = await startApp(mode);
    await chooseCountry(app, 'フランス');
    await app.$('#start-practice').click();
    await app.$('.choice').click();
    const prompt = app.$('#question-prompt').textContent;
    const label = app.$('#active-scope').textContent;
    await importPack(app, JSON.stringify([questions[0], { ...questions[1], correct_option_id: 'absent' }]));
    assert.equal(app.$('#question-prompt').textContent, prompt);
    assert.equal(app.$('#active-scope').textContent, label);
    assert.ok(app.$('.answer-panel'));
    assert.equal(app.$('[role="progressbar"]').getAttribute('aria-valuenow'), '1');
    assert.equal(app.$('#pages-import-error').hidden, false);
    assert.equal(app.$('#question-pack').disabled, false);
    assert.equal(app.$('#clear-pack').disabled, true);
  });

  test(`${mode}: an empty imported pack disables start and restoring the default resets the session`, async () => {
    const app = await startApp(mode);
    await importPack(app, '[]');
    assert.equal(app.$('.choice'), null);
    assert.equal(app.$('#start-practice').disabled, true);
    assert.equal(app.$('#clear-pack').disabled, false);
    assert.match(app.$('#pages-import-status').textContent, /synthetic-import\.json.*0/);
    await app.$('#clear-pack').click();
    assert.equal(app.requests.filter(path => path.endsWith('/wine_quiz_master_set_01.json')).length, 2);
    assert.ok(app.$('.choice'));
    assert.equal(app.$('#start-practice').disabled, false);
    assert.equal(app.$('#scope-all').checked, true);
    assert.equal(app.$('#scope-country').checked, false);
    assert.match(app.$('#active-scope').textContent, /すべて.*4/);
    assert.equal(app.$('[role="progressbar"]').getAttribute('aria-valuenow'), '0');
    assert.equal(app.$('#clear-pack').disabled, true);
    assert.equal(app.$('#pages-import-error').hidden, true);
  });

  test(`${mode}: an empty bundled pack has an explicit empty state and no generated fallback`, async () => {
    const app = await startApp(mode, { pack: '[]' });
    assert.equal(app.$('.choice'), null);
    assert.equal(app.$('#start-practice').disabled, true);
    assert.match(app.$('#scope-count').textContent, /問題がない/);
    assert.doesNotMatch(app.$('#quiz-root').textContent, /Unrelated server-generated/);
  });

  for (const [name, options] of [
    ['missing file', { status: 404 }], ['network failure', { networkError: true }],
    ['invalid JSON', { pack: '{broken JSON' }],
    ['partly invalid pack', { pack: JSON.stringify([questions[0], { ...questions[1], correct_option_id: 'absent' }]) }],
  ]) {
    test(`${mode}: ${name} is visible and never falls back to generated questions`, async () => {
      const app = await startApp(mode, options);
      assert.equal(app.$('.choice'), null);
      assert.ok(app.$('#start-practice').disabled);
      assert.match(app.$('#quiz-root').textContent, /wine_quiz_master_set_01\.json/);
      assert.doesNotMatch(app.$('#quiz-root').textContent, /Synthetic question|Unrelated server-generated/);
    });
  }
}
