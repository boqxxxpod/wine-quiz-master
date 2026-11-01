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
const DEFAULT_PACK_PATH = '/question-packs/wine-quiz-practice-20261031.json';
const PRACTICE_PACK_PATH = DEFAULT_PACK_PATH;
const TEXTBOOK_PACK_PATH = '/question-packs/wine-quiz-highlighted.json';
const registeredStandardText = readFileSync(new URL('../question-packs/wine-quiz-highlighted.json', import.meta.url), 'utf8');
const registeredStandard = JSON.parse(registeredStandardText);
const registeredPracticeText = readFileSync(new URL(`..${PRACTICE_PACK_PATH}`, import.meta.url), 'utf8');
const registeredPractice = JSON.parse(registeredPracticeText);

async function startApp(mode, { pack = JSON.stringify(questions), status = 200, networkError = false, defaultFetcher,
  practicePack = pack, practiceStatus = status, practiceFetcher = defaultFetcher,
  textbookPack = registeredStandardText, textbookStatus = 200, textbookFetcher } = {}) {
  const document = documentFromHtml(readFileSync(new URL('../static/index.html', import.meta.url), 'utf8'));
  const requests = [];
  const fetch = async input => {
    const path = new URL(String(input), 'https://app.example/').pathname;
    requests.push(path);
    if (path === PRACTICE_PACK_PATH) {
      if (practiceFetcher) return practiceFetcher(requests.filter(item => item === path).length);
      if (networkError) throw new Error('Synthetic network error');
      return { ok: practiceStatus === 200, status: practiceStatus, text: async () => practicePack };
    }
    if (path === TEXTBOOK_PACK_PATH) {
      if (textbookFetcher) return textbookFetcher(requests.filter(item => item === path).length);
      return { ok: textbookStatus === 200, status: textbookStatus, text: async () => textbookPack };
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
    const fileUrl = new URL(url);
    fileUrl.search = '';
    let code = readFileSync(fileUrl, 'utf8');
    code = code.replace(/^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?$/gm, (_, names, source) =>
      `const {${names.replace(/\s+as\s+/g, ': ')}} = __load(${JSON.stringify(new URL(source, url).href)});`);
    code = code.replace(/\bexport\s+(?=(?:async\s+)?(?:function|class|const|let)\s)/g, '');
    for (const match of readFileSync(fileUrl, 'utf8').matchAll(/\bexport\s+(?:async\s+)?(?:function|class|const|let)\s+(\w+)/g)) exports.push(match[1]);
    code = code.replaceAll('import.meta.url', JSON.stringify(`https://app.example/static/${url.pathname.split('/').at(-1)}${url.search}`));
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

async function chooseCount(app, count) {
  app.$('#question-count').value = String(count);
  await app.$('#question-count').dispatch('change');
}

async function chooseBundledPack(app, id) {
  app.$(`#pack-${id}`).checked = true;
  await app.$(`#pack-${id}`).dispatch('change');
}

async function answerCorrectly(app) {
  const correct = app.document.querySelectorAll('.choice').find(node => node.textContent.includes('Synthetic choice b'));
  assert.ok(correct);
  await correct.click();
}

for (const mode of ['server', 'pages']) {
  test(`${mode}: switching real banks resets answers, country, counts, and available countries`, async () => {
    const app = await startApp(mode, { practicePack: registeredPracticeText });
    assert.equal(app.$('#pack-practice').checked, true);
    await chooseBundledPack(app, 'textbook');
    assert.equal(app.$('#pack-textbook').checked, true);
    await chooseCountry(app, 'フランス');
    await chooseCount(app, 100);
    await app.$('#start-practice').click();
    await app.$('.choice').click();
    await app.$('#back-to-setup').click();
    await chooseBundledPack(app, 'practice');
    assert.equal(app.$('#pack-practice').checked, true);
    assert.equal(app.$('#pack-textbook').checked, false);
    assert.equal(app.$('#scope-all').checked, true);
    assert.equal(app.$('#scope-country').checked, false);
    assert.equal(app.$('#practice-country').value, '');
    assert.equal(app.$('#question-count').value, 'all');
    assert.equal(app.$('#quiz-root').children.length, 0);
    assert.equal(app.$('#active-scope').textContent, '');
    assert.match(app.$('#pages-import-status').textContent, /練習問題.*226/);
    assert.ok(app.$('#pack-review-status').textContent.includes(registeredPractice.metadata.qa_status));
    assert.match(app.$('#scope-all-count').textContent, /226/);
    assert.equal(app.$('#practice-country').options.length, 14);
    for (const [country, count] of Object.entries(registeredPractice.metadata.country_counts)) {
      const option = app.$('#practice-country').options.find(option => option.value === country);
      assert.equal(option.textContent, `${country}（${count} 問）`);
    }
    await chooseCountry(app, 'ドイツ');
    assert.equal(app.$('#count-all-label').textContent, '全問（14 問）');
    assert.equal(app.$('#question-count').options.find(option => option.value === '20').disabled, true);
    await chooseCount(app, 10);
    await app.$('#start-practice').click();
    assert.match(app.$('#active-scope').textContent, /練習問題.*ドイツ.*10/);
    assert.equal(app.$('[role="progressbar"]').getAttribute('aria-valuenow'), '0');
    assert.equal(app.$('.answer-panel'), null);
    const row = registeredPractice.questions.find(row => row.question_id === app.$('.quiz-card').dataset.questionId);
    assert.equal(row.country, 'ドイツ');
    assert.match(app.$('.question-score').textContent, /正解 0 \/ 10 · 回答 0/);
    await app.$('.choice').click();
    await app.$('#back-to-setup').click();
    await chooseBundledPack(app, 'textbook');
    assert.equal(app.$('#pack-practice').checked, false);
    assert.equal(app.$('#pack-textbook').checked, true);
    assert.equal(app.$('#practice-country').options.some(option => option.value === 'ドイツ'), false);
    assert.equal(app.$('#practice-country').value, '');
    assert.equal(app.$('#question-count').value, 'all');
    assert.equal(app.$('#scope-all').checked, true);
    assert.equal(app.$('#quiz-root').children.length, 0);
    assert.match(app.$('#pages-import-status').textContent, /教科書問題.*662/);
    await app.$('#start-practice').click();
    assert.equal(app.$('[role="progressbar"]').getAttribute('aria-valuemax'), '662');
    assert.equal(app.$('[role="progressbar"]').getAttribute('aria-valuenow'), '0');
    assert.ok(registeredStandard.questions.some(row => row.question_id === app.$('.quiz-card').dataset.questionId));
    assert.deepEqual(app.requests, [PRACTICE_PACK_PATH, TEXTBOOK_PACK_PATH, PRACTICE_PACK_PATH, TEXTBOOK_PACK_PATH]);
  });

  test(`${mode}: matching blocks incomplete or repeated choices, grades once and resets on restart`, async () => {
    const row = registeredPractice.questions.find(row => row.question_type === 'matching');
    const app = await startApp(mode, { practicePack: JSON.stringify({ metadata: {}, questions: [row] }) });
    await app.$('#start-practice').click();
    const selects = app.document.querySelectorAll('.matching-select');
    assert.equal(app.$('.matching-submit').disabled, true);
    selects[0].value = 'D';
    await selects[0].dispatch('change');
    selects[1].value = 'D';
    await selects[1].dispatch('change');
    assert.equal(app.$('.matching-submit').disabled, true);
    assert.match(app.$('.matching-list .answer-hint').textContent, /同じ記号/);
    assert.equal(app.$('.answer-panel'), null);
    const wrong = { ...row.correct_matches, 1:'A', 2:'D' };
    for (const select of selects) {
      select.value = wrong[select.dataset.itemId];
      await select.dispatch('change');
    }
    assert.equal(app.$('.matching-submit').disabled, false);
    await app.$('.matching-submit').click();
    assert.equal(app.document.querySelectorAll('.match-incorrect').length, 2);
    assert.match(app.$('.question-score').textContent, /正解 0 \/ 1 · 回答 1/);
    for (const select of app.document.querySelectorAll('.matching-select')) {
      assert.equal(select.disabled, true);
      select.value = row.correct_matches[select.dataset.itemId];
      await select.dispatch('change');
    }
    assert.match(app.$('.question-score').textContent, /正解 0 \/ 1 · 回答 1/);
    await app.$('.next-row button').click();
    assert.match(app.$('.completion-score').textContent, /0.*1/);
    await app.$('.completion-card button').click();
    assert.ok(app.document.querySelectorAll('.matching-select').every(node => node.value === '' && !node.disabled));
    assert.equal(app.$('.matching-submit').disabled, true);
    assert.equal(app.$('.answer-panel'), null);
  });

  test(`${mode}: all 226 practice questions keep source numbering, explanations, evidence, and scoring`, async () => {
    const app = await startApp(mode, { practicePack: registeredPracticeText });
    await app.$('#start-practice').click();
    const seen = new Set();
    for (let index = 0; index < 226; index += 1) {
      const id = app.$('.quiz-card').dataset.questionId;
      assert.equal(seen.has(id), false);
      seen.add(id);
      const row = registeredPractice.questions.find(row => row.question_id === id);
      assert.ok(row);
      assert.equal(app.$('#question-prompt').textContent, row.question);
      if (row.question_type === 'matching') {
        const selects = app.document.querySelectorAll('.matching-select');
        assert.equal(selects.length, 5);
        assert.equal(app.$('.matching-submit').disabled, true);
        for (const select of selects) {
          select.value = row.correct_matches[select.dataset.itemId];
          await select.dispatch('change');
        }
        if (index === 0) {
          [selects[0].value, selects[1].value] = [selects[1].value, selects[0].value];
          await selects[0].dispatch('change');
          await selects[1].dispatch('change');
        }
        assert.equal(app.$('.matching-submit').disabled, false);
        await app.$('.matching-submit').click();
        assert.ok(app.document.querySelectorAll('.matching-select').every(node => node.disabled));
      } else {
        const image = row.source_image?.kind === 'original';
        assert.deepEqual(app.document.querySelectorAll('.choice-text').map(node => node.textContent),
          image ? ['画像の選択肢 1', '画像の選択肢 2', '画像の選択肢 3'] : row.options);
        assert.deepEqual(app.document.querySelectorAll('.choice-letter').map(node => node.textContent), row.options.map((_, i) => String(i + 1)));
        const choices = app.document.querySelectorAll('.choice');
        await choices[index === 0 ? (row.correct_index + 1) % choices.length : row.correct_index].click();
      }
      if (row.source_image) {
        assert.ok(app.$('.question-figure img').src.includes(`/question-packs/practice-assets/${row.source_image.filename}`));
        assert.equal(app.$('.question-figure img').alt, row.source_image.alt);
      }
      assert.ok(app.document.querySelectorAll('.choice').every(node => node.disabled));
      assert.equal(app.$('.explanation-body').textContent, row.explanation);
      assert.ok(app.$('.correct-answer').textContent.includes(row.correct_answer));
      for (const value of [row.knowledge_id, row.source_page, row.topic, row.status]) {
        assert.ok(app.$('.pilot-evidence').textContent.includes(String(value)));
      }
      assert.match(app.$('.pilot-review-note').textContent, /auto_checked.*人手確認前/);
      if (row.source_note) assert.ok(app.$('.source-note').textContent.includes(row.source_note));
      assert.equal(app.$('[role="progressbar"]').getAttribute('aria-valuenow'), String(index + 1));
      assert.match(app.$('.question-score').textContent, new RegExp(`正解 ${index} / 226 · 回答 ${index + 1}`));
      await app.$('.next-row button').click();
    }
    assert.equal(seen.size, 226);
    assert.match(app.$('.completion-score').textContent, /225.*226/);
    await app.$('.completion-card button').click();
    assert.equal(app.$('[role="progressbar"]').getAttribute('aria-valuenow'), '0');
    assert.equal(app.$('[role="progressbar"]').getAttribute('aria-valuemax'), '226');
    assert.match(app.$('#active-scope').textContent, /練習問題.*すべて.*226/);
    assert.deepEqual(app.requests, [PRACTICE_PACK_PATH]);
  });

  test(`${mode}: a pending bank fetch blocks other selections and discards the previous session`, async () => {
    let finish;
    const app = await startApp(mode, { textbookFetcher: () => new Promise(resolve => { finish = resolve; }) });
    await app.$('#start-practice').click(); await answerCorrectly(app); await app.$('#back-to-setup').click();
    const selecting = chooseBundledPack(app, 'textbook');
    assert.equal(app.$('#pack-practice').disabled, true);
    assert.equal(app.$('#pack-textbook').disabled, true);
    assert.equal(app.$('#start-practice').disabled, true);
    assert.equal(app.$('#quiz-root').children.length, 0);
    await chooseBundledPack(app, 'practice');
    assert.equal(app.$('#pack-practice').checked, false);
    assert.equal(app.$('#pack-textbook').checked, true);
    assert.deepEqual(app.requests, [PRACTICE_PACK_PATH, TEXTBOOK_PACK_PATH]);
    finish({ ok:true, text:async () => registeredStandardText }); await selecting;
    assert.equal(app.$('#pack-textbook').disabled, false);
    assert.equal(app.$('#start-practice').disabled, false);
    assert.match(app.$('#pages-import-status').textContent, /教科書問題.*662/);
  });

  for (const [failure, fetcher] of [
    ['HTTP 404', async () => ({ ok:false, status:404 })],
    ['network error', async () => { throw new Error('offline'); }],
    ['malformed JSON', async () => ({ ok:true, text:async () => '{broken' })],
  ]) {
    test(`${mode}: practice ${failure} stops practice and retries the selected bank`, async () => {
      const app = await startApp(mode, { practiceFetcher: call => call === 1 ? fetcher()
        : { ok:true, text:async () => registeredPracticeText } });
      assert.equal(app.$('#start-practice').disabled, true);
      assert.equal(app.$('#quiz-root').children.length, 0);
      assert.equal(app.$('#pack-practice').checked, true);
      assert.equal(app.$('#retry-pack').hidden, false);
      assert.match(app.$('#pages-import-error').textContent, /wine-quiz-practice-20261031\.json/);
      assert.equal(app.$('#retry-pack').textContent, '練習問題を再読み込み');
      assert.deepEqual(app.requests, [PRACTICE_PACK_PATH]);
      await app.$('#retry-pack').click();
      assert.equal(app.$('#retry-pack').hidden, true);
      assert.equal(app.$('#start-practice').disabled, false);
      assert.match(app.$('#pages-import-status').textContent, /練習問題.*226/);
      assert.deepEqual(app.requests, [PRACTICE_PACK_PATH, PRACTICE_PACK_PATH]);
    });
  }

  test(`${mode}: practice is the initial bank and the material entry follows the start button without file controls`, async () => {
    const app = await startApp(mode, { practicePack: registeredPracticeText });
    assert.deepEqual(app.requests, [PRACTICE_PACK_PATH]);
    assert.equal(app.$('#pack-practice').checked, true); assert.equal(app.$('#pack-textbook').checked, false);
    for (const selector of ['input[type="file"]', '#question-pack', '#clear-pack', '#import-help', '.pages-import-controls']) assert.equal(app.$(selector), null);
    const setup = app.$('#view-setup');
    assert.equal(setup.children.filter(child => child.tagName === 'SECTION').at(-1), app.$('.place-entry'));
    const buttons = setup.querySelectorAll('button');
    assert.ok(buttons.indexOf(app.$('#start-practice')) < buttons.indexOf(app.$('#open-place-master')));
    assert.equal(app.$('#view-setup').hidden, false); assert.equal(app.$('#view-practice').hidden, true);
    assert.equal(app.$('.choice'), null); assert.equal(app.$('.main-nav'), null);
    assert.equal(app.$('#view-sources'), null); assert.equal(app.$('#view-settings'), null); assert.equal(app.$('.study-aside'), null);
    assert.equal(app.$('#scope-all').checked, true); assert.equal(app.$('#question-count').value, 'all');
    assert.equal(app.$('#question-count').disabled, false);
    assert.deepEqual(app.$('#question-count').options.map(option => option.value), ['5', '10', '20', '30', '50', '70', '100', 'all']);
    assert.match(app.$('#scope-all-count').textContent, /226/); assert.equal(app.$('#practice-country').options.length, 14);
    for (const [country, count] of Object.entries(registeredPractice.metadata.country_counts)) {
      const option = app.$('#practice-country').options.find(node => node.value === country);
      assert.equal(option.textContent, `${country}（${count} 問）`);
    }
    const record = app.$('#pack-review-status'); assert.equal(record.hidden, false);
    assert.ok(record.textContent.includes(registeredPractice.metadata.qa_status)); assert.equal(record.querySelector('a'), null);
    assert.doesNotMatch(record.textContent, /承認済み|人手確認済み|校閲済み|事実確認済み/);
    await app.$('#start-practice').click();
    assert.equal(app.$('#view-setup').hidden, true); assert.equal(app.$('#view-practice').hidden, false);
    assert.match(app.$('#active-scope').textContent, /練習問題.*すべて.*226/);
    assert.equal(app.$('[role="progressbar"]').getAttribute('aria-valuemax'), '226');
    assert.equal(app.document.activeElement, app.$('#question-prompt')); assert.equal(app.document.scrollTarget, app.$('#view-practice'));
    assert.deepEqual(app.requests, [PRACTICE_PACK_PATH]);
  });

  test(`${mode}: a failed textbook selection retries textbook without falling back to practice`, async () => {
    const app = await startApp(mode, { textbookFetcher: call => call === 1 ? { ok: false, status: 404 }
      : { ok: true, text: async () => registeredStandardText } });
    await chooseBundledPack(app, 'textbook');
    assert.equal(app.$('#pack-textbook').checked, true); assert.equal(app.$('#start-practice').disabled, true);
    assert.equal(app.$('#retry-pack').textContent, '教科書問題を再読み込み');
    assert.match(app.$('#pages-import-error').textContent, /wine-quiz-highlighted\.json/);
    assert.deepEqual(app.requests, [PRACTICE_PACK_PATH, TEXTBOOK_PACK_PATH]);
    await app.$('#retry-pack').click(); assert.equal(app.$('#retry-pack').hidden, true);
    assert.match(app.$('#pages-import-status').textContent, /教科書問題.*662/);
    assert.equal(app.$('#start-practice').disabled, false);
    assert.deepEqual(app.requests, [PRACTICE_PACK_PATH, TEXTBOOK_PACK_PATH, TEXTBOOK_PACK_PATH]);
  });

  for (const [country, count] of [['フランス', 201], ['スペイン', 76], ['ポルトガル', 42]]) {
    test(`${mode}: a full ${country} round keeps pilot evidence and stable scoring through restart`, async () => {
      const app = await startApp(mode);
      await chooseBundledPack(app, 'textbook');
      await chooseCountry(app, country);
      assert.match(app.$('#scope-count').textContent, new RegExp(`${country}.*${count}`));
      await app.$('#start-practice').click();
      const seen = [];
      for (let index = 0; index < count; index += 1) {
        const id = app.$('.quiz-card').dataset.questionId;
        const row = registeredStandard.questions.find(question => question.question_id === id);
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
      assert.ok(seen.includes(country === 'ポルトガル' ? 'Q-K0491-01' : 'Q-K0019-01'));
      assert.match(app.$('.completion-score').textContent, new RegExp(`${count}.*${count}`));
      assert.equal(app.document.activeElement, app.$('.completion-card'));
      await app.$('.completion-card button').click();
      assert.equal(app.$('[role="progressbar"]').getAttribute('aria-valuemax'), String(count));
      assert.equal(app.$('[role="progressbar"]').getAttribute('aria-valuenow'), '0');
      assert.match(app.$('#active-scope').textContent, new RegExp(`${country}.*${count}`));
      assert.deepEqual(app.requests, [PRACTICE_PACK_PATH, TEXTBOOK_PACK_PATH]);
    });
  }

  test(`${mode}: every preset controls round length, completion, and restart`, async () => {
    const rows = Array.from({ length: 120 }, (_, index) => question(`fr-${index}`, ['フランス']));
    const app = await startApp(mode, { pack: JSON.stringify(rows) });
    await chooseCountry(app, 'フランス');
    for (const count of [5, 10, 20, 30, 50, 70, 100, 'all']) {
      await chooseCount(app, count);
      const total = count === 'all' ? rows.length : count;
      await app.$('#start-practice').click();
      assert.equal(app.$('#view-setup').hidden, true);
      assert.equal(app.$('[role="progressbar"]').getAttribute('aria-valuemax'), String(total));
      const seen = new Set();
      for (let index = 0; index < total; index += 1) {
        const id = app.$('.quiz-card').dataset.questionId;
        assert.ok(!seen.has(id));
        seen.add(id);
        await answerCorrectly(app);
        await app.$('.next-row button').click();
      }
      assert.match(app.$('.completion-score').textContent, new RegExp(`${total}.*${total}`));
      await app.$('.completion-card button').click();
      assert.equal(app.$('[role="progressbar"]').getAttribute('aria-valuemax'), String(total));
      assert.equal(app.$('[role="progressbar"]').getAttribute('aria-valuenow'), '0');
      await app.$('#back-to-setup').click();
      assert.equal(app.$('#question-count').value, String(count));
    }
    assert.deepEqual(app.requests, [DEFAULT_PACK_PATH]);
  });

  test(`${mode}: scope changes keep valid presets and reset excessive presets to all`, async () => {
    const rows = [
      ...Array.from({ length: 12 }, (_, index) => question(`fr-${index}`, ['フランス'])),
      ...Array.from({ length: 3 }, (_, index) => question(`sp-${index}`, ['スペイン'])),
    ];
    const app = await startApp(mode, { pack: JSON.stringify(rows) });
    await chooseCountry(app, 'フランス');
    await chooseCount(app, 10);
    await app.$('#start-practice').click();
    await answerCorrectly(app);
    await app.$('#back-to-setup').click();
    assert.equal(app.$('#practice-country').value, 'フランス');
    assert.equal(app.$('#question-count').value, '10');
    assert.equal(app.document.activeElement, app.$('#setup-heading'));
    await chooseCountry(app, 'スペイン');
    assert.equal(app.$('#question-count').value, 'all');
    assert.equal(app.$('#count-all-label').textContent, '全問（3 問）');
    assert.ok(app.$('#question-count').options.filter(option => option.value !== 'all').every(option => option.disabled));
    assert.equal(app.$('#start-practice').disabled, false);
    await chooseCount(app, 5);
    assert.equal(app.$('#start-practice').disabled, true, 'even a tampered over-limit selection cannot start');
    await chooseCount(app, 'all');
    await app.$('#start-practice').click();
    assert.equal(app.$('.answer-panel'), null);
    assert.equal(app.$('[role="progressbar"]').getAttribute('aria-valuenow'), '0');
    assert.equal(app.$('[role="progressbar"]').getAttribute('aria-valuemax'), '3');
    for (let index = 0; index < 3; index += 1) {
      await answerCorrectly(app);
      await app.$('.next-row button').click();
    }
    await app.document.querySelectorAll('.completion-card button')[1].click();
    assert.equal(app.$('#view-setup').hidden, false);
    assert.equal(app.$('#view-practice').hidden, true);
    await chooseCountry(app, 'フランス');
    assert.equal(app.$('#question-count').options.find(option => option.value === '10').disabled, false);
    await chooseCount(app, 10);
    app.$('#scope-all').checked = true;
    app.$('#scope-country').checked = false;
    await app.$('#scope-all').dispatch('change');
    assert.equal(app.$('#question-count').value, '10', 'valid presets survive a wider scope');
  });

  test(`${mode}: blank, unlisted, malformed, and excessive counts cannot start`, async () => {
    const app = await startApp(mode);
    for (const value of ['', 0, -1, 1.5, 1, 2, 5, 'NaN']) {
      await chooseCount(app, value);
      assert.equal(app.$('#start-practice').disabled, true, `invalid count ${value}`);
      assert.equal(app.$('#count-error').hidden, false);
      await app.$('#start-practice').click();
      assert.equal(app.$('#view-practice').hidden, true);
      assert.equal(app.$('.choice'), null);
    }
    await chooseCount(app, 'all');
    assert.equal(app.$('#start-practice').disabled, false);
    await chooseCountry(app, '');
    assert.equal(app.$('#start-practice').disabled, true);
    assert.equal(app.$('#question-count').disabled, true);
    await chooseCountry(app, '未登録の国');
    assert.equal(app.$('#start-practice').disabled, true);
    assert.equal(app.$('#question-count').disabled, true);
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

  test(`${mode}: repeated retries and selections cannot overlap a pending default fetch`, async () => {
    let finishFetch;
    const app = await startApp(mode, { defaultFetcher:call => call === 1
      ? { ok:false, status:404 } : new Promise(resolve => { finishFetch = resolve; }) });
    const retrying = app.$('#retry-pack').click();
    assert.equal(app.$('#retry-pack').disabled, true);
    assert.equal(app.$('#start-practice').disabled, true);
    await app.$('#retry-pack').dispatch('click'); await chooseBundledPack(app, 'textbook');
    assert.equal(app.$('#pack-practice').checked, true); assert.equal(app.$('#pack-textbook').checked, false);
    assert.deepEqual(app.requests, [PRACTICE_PACK_PATH, PRACTICE_PACK_PATH]);
    finishFetch({ ok:true, status:200, text:async () => JSON.stringify(questions) }); await retrying;
    assert.equal(app.$('#retry-pack').disabled, false); assert.equal(app.$('#retry-pack').hidden, true);
    assert.equal(app.$('#start-practice').disabled, false);
    assert.match(app.$('#pages-import-status').textContent, /wine-quiz-practice-20261031\.json.*4/);
    await app.$('#start-practice').click(); assert.equal(app.$('[role="progressbar"]').getAttribute('aria-valuemax'), '4');
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
      assert.match(app.$('#pages-import-error').textContent, /wine-quiz-practice-20261031\.json/);
      assert.equal(app.$('#retry-pack').hidden, false);
      assert.deepEqual(app.requests, [DEFAULT_PACK_PATH]);
    });
  }
}
