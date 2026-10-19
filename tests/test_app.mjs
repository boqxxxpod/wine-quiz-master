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
const DEFAULT_PACK_PATH = '/question-packs/pilot-150.json';
const registeredPilotText = readFileSync(new URL('../question-packs/pilot-150.json', import.meta.url), 'utf8');
const registeredPilot = JSON.parse(registeredPilotText);

async function startApp(mode, { pack = JSON.stringify(questions), status = 200, networkError = false, defaultFetcher } = {}) {
  const document = documentFromHtml(readFileSync(new URL('../static/index.html', import.meta.url), 'utf8'));
  const requests = [];
  const fetch = async input => {
    const path = new URL(String(input), 'https://app.example/').pathname;
    requests.push(path);
    if (path === DEFAULT_PACK_PATH) {
      if (defaultFetcher) return defaultFetcher(requests.length);
      if (networkError) throw new Error('Synthetic network error');
      return { ok: status === 200, status, text: async () => pack, json: async () => JSON.parse(pack) };
    }
    assert.fail(`unexpected network request ${path}`);
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

async function chooseCount(app, count) {
  app.$('#count-all').checked = false;
  app.$('#count-custom').checked = true;
  app.$('#question-count').value = String(count);
  await app.$('#count-custom').dispatch('change');
  await app.$('#question-count').dispatch('input');
}

async function answerCorrectly(app) {
  const correct = app.document.querySelectorAll('.choice').find(node => node.textContent.includes('Synthetic choice b'));
  assert.ok(correct);
  await correct.click();
}

for (const mode of ['server', 'pages']) {
  test(`${mode}: setup loads the standard pack without starting a round or calling APIs`, async () => {
    const app = await startApp(mode, { pack: registeredPilotText });
    assert.deepEqual(app.requests, [DEFAULT_PACK_PATH]);
    assert.equal(app.$('#view-setup').hidden, false);
    assert.equal(app.$('#view-practice').hidden, true);
    assert.equal(app.$('.choice'), null);
    assert.equal(app.$('.main-nav'), null);
    assert.equal(app.$('#view-sources'), null);
    assert.equal(app.$('#view-settings'), null);
    assert.equal(app.$('.study-aside'), null);
    assert.equal(app.$('#count-all').checked, true);
    assert.equal(app.$('#question-count').disabled, true);
    assert.equal(app.$('#question-count').max, '150');
    assert.match(app.$('#scope-all-count').textContent, /150/);
    for (const [country, count] of [['フランス', 32], ['スペイン', 16]]) {
      const option = app.$('#practice-country').options.find(node => node.value === country);
      assert.ok(option.textContent.includes(String(count)), 'country membership is derived from rows');
    }
    const record = app.$('#pack-review-status');
    assert.equal(record.hidden, false);
    assert.ok(record.textContent.includes(registeredPilot.metadata.qa_status));
    assert.equal(record.querySelector('a'), null);
    assert.doesNotMatch(record.textContent, /承認済み|人手確認済み|校閲済み|事実確認済み/);
    await app.$('#start-practice').click();
    assert.equal(app.$('#view-setup').hidden, true);
    assert.equal(app.$('#view-practice').hidden, false);
    assert.match(app.$('#active-scope').textContent, /すべて.*150/);
    assert.equal(app.$('[role="progressbar"]').getAttribute('aria-valuemax'), '150');
    assert.equal(app.document.activeElement, app.$('#question-prompt'));
    assert.equal(app.document.scrollTarget, app.$('#view-practice'));
    assert.deepEqual(app.requests, [DEFAULT_PACK_PATH]);
  });

  for (const [country, count] of [['フランス', 32], ['スペイン', 16]]) {
    test(`${mode}: a full ${country} round keeps pilot evidence and stable scoring through restart`, async () => {
      const app = await startApp(mode, { pack: registeredPilotText });
      await chooseCountry(app, country);
      assert.match(app.$('#scope-count').textContent, new RegExp(`${country}.*${count}`));
      await app.$('#start-practice').click();
      const seen = [];
      for (let index = 0; index < count; index += 1) {
        const id = app.$('.quiz-card').dataset.questionId;
        const row = registeredPilot.questions.find(question => question.question_id === id);
        assert.ok(row.countries.includes(country));
        seen.push(id);
        assert.equal(app.$('#question-prompt').textContent, row.question);
        assert.deepEqual(app.document.querySelectorAll('.choice-text').map(node => node.textContent).sort(), [...row.options].sort());
        const correct = app.document.querySelectorAll('.choice').find(node => node.querySelector('.choice-text').textContent === row.correct_answer);
        await correct.click();
        assert.ok(app.document.querySelectorAll('.choice').every(node => node.disabled));
        const evidence = app.$('.pilot-evidence');
        for (const value of [row.knowledge_id, row.source_page, row.topic, row.status]) assert.ok(evidence.textContent.includes(String(value)));
        assert.match(app.$('.pilot-review-note').textContent, /auto_checked.*機械検証済み・人手確認前/);
        assert.doesNotMatch(evidence.textContent, /承認済み|人手確認済み|校閲済み|事実確認済み|undefined/);
        assert.equal(app.$('.explanation-body').textContent, row.explanation);
        assert.equal(app.$('[role="progressbar"]').getAttribute('aria-valuenow'), String(index + 1));
        assert.match(app.$('.question-score').textContent, new RegExp(`正解 ${index + 1} / ${count} · 回答 ${index + 1}`));
        await app.$('.next-row button').click();
      }
      assert.equal(new Set(seen).size, count);
      assert.ok(seen.includes('Q-K0019-01'));
      assert.match(app.$('.completion-score').textContent, new RegExp(`${count}.*${count}`));
      assert.equal(app.document.activeElement, app.$('.completion-card'));
      await app.$('.completion-card button').click();
      assert.equal(app.$('[role="progressbar"]').getAttribute('aria-valuemax'), String(count));
      assert.equal(app.$('[role="progressbar"]').getAttribute('aria-valuenow'), '0');
      assert.match(app.$('#active-scope').textContent, new RegExp(`${country}.*${count}`));
      assert.deepEqual(app.requests, [DEFAULT_PACK_PATH]);
    });
  }

  test(`${mode}: custom count controls the scoped round, completion, and restart`, async () => {
    const app = await startApp(mode);
    await chooseCountry(app, 'フランス');
    await chooseCount(app, 1);
    assert.equal(app.$('#question-count').max, '2');
    await app.$('#start-practice').click();
    assert.equal(app.$('#view-setup').hidden, true);
    assert.match(app.$('#active-scope').textContent, /フランス.*1/);
    assert.ok(['france', 'cross-country'].includes(app.$('.quiz-card').dataset.questionId));
    assert.equal(app.$('[role="progressbar"]').getAttribute('aria-valuemax'), '1');
    await answerCorrectly(app);
    assert.match(app.$('.next-row button').textContent, /結果を見る/);
    await app.$('.next-row button').click();
    assert.match(app.$('.completion-score').textContent, /1.*1/);
    await app.$('.completion-card button').click();
    assert.equal(app.$('[role="progressbar"]').getAttribute('aria-valuemax'), '1');
    assert.equal(app.$('[role="progressbar"]').getAttribute('aria-valuenow'), '0');
    assert.match(app.$('.question-score').textContent, /正解 0 \/ 1 · 回答 0/);
    assert.match(app.$('#active-scope').textContent, /フランス.*1/);
    assert.ok(['france', 'cross-country'].includes(app.$('.quiz-card').dataset.questionId));
    assert.deepEqual(app.requests, [DEFAULT_PACK_PATH]);
  });

  test(`${mode}: returning to setup preserves choices and a new start resets answers and score`, async () => {
    const app = await startApp(mode);
    await chooseCountry(app, 'フランス');
    await chooseCount(app, 2);
    await app.$('#start-practice').click();
    await answerCorrectly(app);
    await app.$('#back-to-setup').click();
    assert.equal(app.$('#view-practice').hidden, true);
    assert.equal(app.$('#view-setup').hidden, false);
    assert.equal(app.$('#practice-country').value, 'フランス');
    assert.equal(app.$('#question-count').value, '2');
    assert.equal(app.document.activeElement, app.$('#setup-heading'));
    await chooseCountry(app, 'スペイン');
    assert.equal(app.$('#question-count').max, '1');
    assert.equal(app.$('#question-count').value, '1', 'scope change clamps the previous count to available questions');
    assert.equal(app.$('#start-practice').disabled, false);
    await chooseCount(app, 2);
    assert.equal(app.$('#start-practice').disabled, true, 'manual over-limit input still cannot start');
    await chooseCount(app, 1);
    await app.$('#start-practice').click();
    assert.equal(app.$('.quiz-card').dataset.questionId, 'spain');
    assert.equal(app.$('.answer-panel'), null);
    assert.equal(app.$('[role="progressbar"]').getAttribute('aria-valuenow'), '0');
    assert.equal(app.$('[role="progressbar"]').getAttribute('aria-valuemax'), '1');
    assert.match(app.$('.question-score').textContent, /正解 0 \/ 1 · 回答 0/);
    await answerCorrectly(app);
    await app.$('.next-row button').click();
    const configure = app.document.querySelectorAll('.completion-card button')[1];
    await configure.click();
    assert.equal(app.$('#view-setup').hidden, false);
    assert.equal(app.$('#view-practice').hidden, true);
  });

  test(`${mode}: blank, zero, negative, fractional, and excessive counts cannot start`, async () => {
    const app = await startApp(mode);
    for (const value of ['', 0, -1, 1.5, 5, 'NaN']) {
      await chooseCount(app, value);
      assert.equal(app.$('#start-practice').disabled, true, `invalid count ${value}`);
      assert.equal(app.$('#count-error').hidden, false);
      await app.$('#start-practice').click();
      assert.equal(app.$('#view-practice').hidden, true);
      assert.equal(app.$('.choice'), null);
    }
    await chooseCount(app, 4);
    assert.equal(app.$('#start-practice').disabled, false);
    await chooseCountry(app, '');
    assert.equal(app.$('#start-practice').disabled, true);
    await chooseCountry(app, '未登録の国');
    assert.equal(app.$('#start-practice').disabled, true);
    assert.equal(app.$('#question-count').max, '0');
  });

  test(`${mode}: full explanations remain intact and next is before long explanation and provenance`, async () => {
    const longExplanation = '長い解説でも全文を読むことができます。'.repeat(200);
    const app = await startApp(mode, { pack: JSON.stringify([{ ...questions[0], explanation: longExplanation }]) });
    await app.$('#start-practice').click();
    await answerCorrectly(app);
    const panel = app.$('.answer-panel');
    assert.equal(app.document.activeElement, app.$('.answer-summary'));
    assert.equal(app.document.scrollTarget, app.$('.answer-summary'));
    assert.equal(panel.firstElementChild, app.$('.answer-summary'));
    assert.equal(app.$('.explanation-body').textContent, longExplanation);
    assert.ok(app.$('.answer-summary').querySelector('.next-row button'));
    assert.equal(app.$('.source-details').getAttribute('open'), null);
    for (const source of sources) for (const value of Object.values(source)) assert.ok(panel.textContent.includes(String(value)));
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
    assert.equal(panel.querySelector('img'), null);
    await app.$('.next-row button').click();
    assert.ok(app.$('.completion-card'));
    assert.deepEqual(app.requests, [DEFAULT_PACK_PATH]);
  });

  test(`${mode}: invalid manual import preserves source, settings, and answered session`, async () => {
    const app = await startApp(mode, { pack: registeredPilotText });
    await chooseCountry(app, 'フランス');
    await chooseCount(app, 2);
    await app.$('#start-practice').click();
    await app.$('.choice').click();
    const questionId = app.$('.quiz-card').dataset.questionId;
    const label = app.$('#active-scope').textContent;
    await app.$('#back-to-setup').click();
    const packLabel = app.$('#pages-import-status').textContent;
    await importPack(app, JSON.stringify([questions[0], { ...questions[1], correct_option_id: 'absent' }]));
    assert.equal(app.$('.quiz-card').dataset.questionId, questionId);
    assert.equal(app.$('#active-scope').textContent, label);
    assert.equal(app.$('#pages-import-status').textContent, packLabel);
    assert.ok(app.$('.answer-panel'));
    assert.equal(app.$('[role="progressbar"]').getAttribute('aria-valuenow'), '1');
    assert.equal(app.$('#practice-country').value, 'フランス');
    assert.equal(app.$('#question-count').value, '2');
    assert.equal(app.$('#pages-import-error').hidden, false);
    assert.equal(app.$('#question-pack').disabled, false);
    assert.equal(app.$('#clear-pack').disabled, true);
    assert.ok(app.$('#pack-review-status').textContent.includes(registeredPilot.metadata.qa_status));
  });

  test(`${mode}: valid imports and restoring default return to setup and reset range and count`, async () => {
    const app = await startApp(mode);
    await chooseCountry(app, 'フランス');
    await chooseCount(app, 2);
    await importPack(app, JSON.stringify([questions[3]]));
    assert.match(app.$('#pages-import-status').textContent, /synthetic-import\.json.*1/);
    assert.equal(app.$('#count-all').checked, true);
    assert.equal(app.$('#scope-all').checked, true);
    assert.equal(app.$('#question-count').max, '1');
    assert.equal(app.$('#view-setup').hidden, false);
    assert.equal(app.$('.choice'), null);
    await app.$('#start-practice').click();
    assert.equal(app.$('.quiz-card').dataset.questionId, 'spain');
    await app.$('#back-to-setup').click();
    await importPack(app, '[]');
    assert.equal(app.$('.choice'), null);
    assert.equal(app.$('#start-practice').disabled, true);
    assert.equal(app.$('#clear-pack').disabled, false);
    await app.$('#clear-pack').click();
    assert.equal(app.requests.filter(path => path === DEFAULT_PACK_PATH).length, 2);
    assert.equal(app.$('.choice'), null);
    assert.equal(app.$('#start-practice').disabled, false);
    assert.equal(app.$('#scope-all').checked, true);
    assert.equal(app.$('#scope-country').checked, false);
    assert.equal(app.$('#count-all').checked, true);
    assert.equal(app.$('#question-count').max, '4');
    assert.equal(app.$('#clear-pack').disabled, true);
    assert.equal(app.$('#pages-import-error').hidden, true);
    await app.$('#start-practice').click();
    assert.equal(app.$('[role="progressbar"]').getAttribute('aria-valuenow'), '0');
    assert.equal(app.$('[role="progressbar"]').getAttribute('aria-valuemax'), '4');
  });

  test(`${mode}: pending manual imports disable controls until validation finishes`, async () => {
    const app = await startApp(mode);
    let finish;
    app.$('#question-pack').files = [{ name:'slow.json', size:10, text:() => new Promise(resolve => { finish = resolve; }) }];
    const importing = app.$('#question-pack').dispatch('change');
    assert.equal(app.$('#question-pack').disabled, true);
    assert.equal(app.$('#clear-pack').disabled, true);
    assert.equal(app.$('#start-practice').disabled, true);
    finish(JSON.stringify(questions));
    await importing;
    assert.equal(app.$('#question-pack').disabled, false);
    assert.equal(app.$('#start-practice').disabled, false);
  });

  test(`${mode}: retry after an initial failure cannot overlap a pending custom import`, async () => {
    const app = await startApp(mode, { status:404 });
    assert.equal(app.$('#retry-pack').hidden, false);
    assert.equal(app.$('#retry-pack').disabled, false);
    let finishFile;
    app.$('#question-pack').files = [{ name:'custom.json', size:10,
      text:() => new Promise(resolve => { finishFile = resolve; }) }];
    const importing = app.$('#question-pack').dispatch('change');
    assert.equal(app.$('#retry-pack').disabled, true);
    await app.$('#retry-pack').click();
    // Programmatic events can bypass disabled buttons; the shared load guard must also hold.
    await app.$('#retry-pack').dispatch('click');
    await app.$('#clear-pack').dispatch('click');
    assert.deepEqual(app.requests, [DEFAULT_PACK_PATH]);
    finishFile(JSON.stringify([questions[3]]));
    await importing;
    assert.equal(app.$('#retry-pack').disabled, false);
    assert.equal(app.$('#retry-pack').hidden, true);
    assert.match(app.$('#pages-import-status').textContent, /custom\.json.*1/);
    await app.$('#start-practice').click();
    assert.equal(app.$('.quiz-card').dataset.questionId, 'spain');
    assert.deepEqual(app.requests, [DEFAULT_PACK_PATH]);
  });

  test(`${mode}: repeated retries and imports cannot overlap a pending default fetch`, async () => {
    let finishFetch;
    const app = await startApp(mode, { defaultFetcher:call => call === 1
      ? { ok:false, status:404 }
      : new Promise(resolve => { finishFetch = resolve; }) });
    const retrying = app.$('#retry-pack').click();
    assert.equal(app.$('#retry-pack').disabled, true);
    assert.equal(app.$('#question-pack').disabled, true);
    assert.equal(app.$('#start-practice').disabled, true);
    await app.$('#retry-pack').dispatch('click');
    await app.$('#clear-pack').dispatch('click');
    app.$('#question-pack').files = [{ name:'racing.json', size:10,
      text:() => assert.fail('custom file must not be read during a default fetch') }];
    await app.$('#question-pack').dispatch('change');
    assert.deepEqual(app.requests, [DEFAULT_PACK_PATH, DEFAULT_PACK_PATH]);
    finishFetch({ ok:true, status:200, text:async () => JSON.stringify(questions) });
    await retrying;
    assert.equal(app.$('#retry-pack').disabled, false);
    assert.equal(app.$('#retry-pack').hidden, true);
    assert.equal(app.$('#question-pack').disabled, false);
    assert.equal(app.$('#start-practice').disabled, false);
    assert.match(app.$('#pages-import-status').textContent, /pilot-150\.json.*4/);
    await app.$('#start-practice').click();
    assert.equal(app.$('[role="progressbar"]').getAttribute('aria-valuemax'), '4');
  });

  for (const [name, options] of [
    ['missing default pack', { status:404 }],
    ['network failure', { networkError:true }],
    ['invalid JSON', { pack:'{broken JSON' }],
    ['partly invalid pack', { pack:JSON.stringify([questions[0], { ...questions[1], correct_option_id:'absent' }]) }],
  ]) {
    test(`${mode}: ${name} is visible in setup and never falls back to generated questions`, async () => {
      const app = await startApp(mode, options);
      assert.equal(app.$('#view-setup').hidden, false);
      assert.equal(app.$('#view-practice').hidden, true);
      assert.equal(app.$('.choice'), null);
      assert.ok(app.$('#start-practice').disabled);
      assert.equal(app.$('#pages-import-error').hidden, false);
      assert.match(app.$('#pages-import-error').textContent, /pilot-150\.json/);
      assert.equal(app.$('#retry-pack').hidden, false);
      assert.deepEqual(app.requests, [DEFAULT_PACK_PATH]);
    });
  }
}
