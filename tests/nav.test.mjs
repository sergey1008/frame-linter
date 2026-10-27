// Сборка навигации в двух режимах на поддельном Figma: «Мои компоненты» (так работал плагин раньше) и «Простой вид».
// Запуск: node --test tests/nav.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let seq = 0;

class N {
  constructor(type, name = '') {
    Object.assign(this, { type, name, id: `${++seq}:1`, children: [], parent: null, x: 0, y: 0, width: 100, height: 40, removed: false, visible: true, reactions: [], fills: [], layoutMode: 'NONE', characters: '', componentProperties: {} });
    this._pd = {};
  }
  appendChild(c) { if (c.parent) c.parent.children.splice(c.parent.children.indexOf(c), 1); c.parent = this; this.children.push(c); }
  insertChild(i, c) { this.appendChild(c); this.children.splice(this.children.indexOf(c), 1); this.children.splice(i, 0, c); }
  remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; this.removed = true; }
  resize(w, h) { this.width = w; this.height = h; }
  findOne(fn) { for (const c of this.children) { if (fn(c)) return c; const r = c.findOne(fn); if (r) return r; } return null; }
  findAll(fn) { const out = []; for (const c of this.children) { if (fn(c)) out.push(c); out.push(...c.findAll(fn)); } return out; }
  getSharedPluginData(ns, k) { return this._pd[ns + k] || ''; }
  setSharedPluginData(ns, k, v) { this._pd[ns + k] = v; }
  get absoluteBoundingBox() { return { x: this.x, y: this.y, width: this.width, height: this.height }; }
  async setReactionsAsync(r) { this.reactions = r; }
  setRangeHyperlink() {}
  setProperties(p) { for (const k in p) this.componentProperties[k].value = p[k]; }
  async getMainComponentAsync() { return this.main || null; }
  clone() { const c = new N(this.type, this.name); c.main = this.main; c.componentProperties = JSON.parse(JSON.stringify(this.componentProperties)); c.characters = this.characters; this.children.forEach((k) => c.appendChild(k.clone())); return c; }
  createInstance() { const i = this.clone(); i.type = 'INSTANCE'; i.main = this; return i; }
}
const comp = (name, props, kids) => { const c = new N('COMPONENT', name); c.componentProperties = props || {}; (kids || []).forEach((k) => c.appendChild(k)); return c; };
const text = (s) => { const t = new N('TEXT', 'text'); t.characters = s; return t; };

function setup() {
  const page = new N('PAGE', 'Page');
  const lib = {
    desc: comp('DescriptionCard', { 'isListSlot#1': { type: 'BOOLEAN', value: true } }, [text('Название ряда')]),
    link: comp('ButtonLink', { 'label#1': { type: 'TEXT', value: 'Ссылка' } }, [text('Ссылка')]),
    btn: comp('Button', { 'hasIconBefore#1': { type: 'BOOLEAN', value: false }, 'hasIconAfter#2': { type: 'BOOLEAN', value: true }, 'VALiconBeforeMedium#3': { type: 'INSTANCE_SWAP', value: '' } }, [text('Button')]),
    arrow: comp('ArrowLeft'),
  };
  const slot = new N('SLOT', 'LinksSlot'); slot.appendChild(lib.link.createInstance());
  lib.card = comp('LinkCard', {}, [slot]);
  const keys = {
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa': lib.desc, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb': lib.card,
    'cccccccccccccccccccccccccccccccccccccccc': lib.link, 'dddddddddddddddddddddddddddddddddddddddd': lib.btn,
    'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee': lib.arrow, 'ffffffffffffffffffffffffffffffffffffffff': lib.arrow, '1111111111111111111111111111111111111111': lib.arrow,
  };
  const figma = {
    showUI() {}, on() {}, notify() {}, mixed: Symbol('mixed'),
    ui: { postMessage() {}, resize() {}, reposition() {}, onmessage: null },
    clientStorage: { getAsync: async () => undefined, setAsync: async () => {} },
    root: { getPluginData: () => '', findAllWithCriteria: () => [] },
    currentPage: page, viewport: { zoom: 1, bounds: { x: 0, y: 0, width: 1, height: 1 }, scrollAndZoomIntoView() {} },
    createFrame: () => new N('FRAME', 'Frame'), createText: () => { const t = new N('TEXT', 'Text'); t.fontName = { family: 'Inter', style: 'Regular' }; return t; },
    loadFontAsync: async () => {}, loadAllPagesAsync: async () => {}, saveVersionHistoryAsync: async () => {},
    importComponentByKeyAsync: async (k) => { if (!keys[k]) throw new Error('нет компонента'); return keys[k]; },
    importComponentSetByKeyAsync: async () => { throw new Error('нет набора'); },
    getNodeByIdAsync: async () => null,
  };
  const ctx = vm.createContext({ figma, __html__: '', console, setTimeout, clearTimeout, Math, JSON, Date, Object, Array, Set, Map, Promise });
  vm.runInContext(fs.readFileSync(path.join(root, 'code.js'), 'utf8'), ctx, { filename: 'code.js' });
  const frames = ['Login', 'Signup', 'Reset'].map((n, i) => { const f = new N('FRAME', n); Object.assign(f, { x: i * 500, y: 0, width: 400, height: 300 }); page.appendChild(f); return f; });
  page.selection = frames; // выделение
  return { page, frames, build: (opts) => vm.runInContext('navBuild', ctx)(opts) };
}
const wrapperOf = (page) => page.children.find((c) => c.getSharedPluginData('framelinter', 'navRole') === 'panel');
const backs = (page) => page.children.filter((c) => c.getSharedPluginData('framelinter', 'navRole') === 'back');
const hasClick = (n, dest) => n.reactions.some((r) => r.trigger.type === 'ON_CLICK' && r.actions[0].destinationId === dest);

// Ключи задаются пользователем (в плагине по умолчанию пусто); здесь — те, что подставлены в поддельную Figma выше.
const COMP = { descKey: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', linkCardKey: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', linkKey: 'cccccccccccccccccccccccccccccccccccccccc', btnKey: 'dddddddddddddddddddddddddddddddddddddddd', arrow16: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', arrow20: 'ffffffffffffffffffffffffffffffffffffffff', arrow24: '1111111111111111111111111111111111111111' };

test('«Мои компоненты»: блок собирается из компонентов', async () => {
  const { page, frames, build } = setup();
  const r = await build({ mode: 'components', label: 'Назад', comp: COMP });
  assert.equal(r.ok, true, r.text);
  const w = wrapperOf(page);
  assert.ok(w, 'блок ряда создан');
  const [desc, card] = w.children;
  assert.equal(desc.name, 'DescriptionCard'); assert.equal(desc.componentProperties['isListSlot#1'].value, false, 'слот списка выключен');
  const slot = card.findOne((n) => n.type === 'SLOT');
  assert.equal(slot.children.length, 3, 'по ссылке на фрейм');
  slot.children.forEach((l, i) => { assert.equal(l.componentProperties['label#1'].value, frames[i].name); assert.ok(hasClick(l, frames[i].id)); });
  const b = backs(page);
  assert.equal(b.length, 3, 'кнопка над каждым фреймом');
  b.forEach((x) => { assert.equal(x.type, 'INSTANCE'); assert.ok(hasClick(x, w.id)); assert.equal(x.componentProperties['hasIconAfter#2'].value, false); });
});

test('«Простой вид»: компоненты не нужны, блок рисуется из фреймов и текста', async () => {
  const { page, frames, build } = setup();
  const r = await build({ mode: 'simple', label: 'К навигации', comp: {} });
  assert.equal(r.ok, true, r.text);
  const w = wrapperOf(page);
  const [desc, card] = w.children;
  assert.equal(desc.getSharedPluginData('framelinter', 'navPart'), 'desc');
  assert.equal(card.children.length, 3);
  card.children.forEach((l, i) => { assert.equal(l.findOne((n) => n.type === 'TEXT').characters, frames[i].name); assert.ok(hasClick(l, frames[i].id)); });
  const b = backs(page);
  assert.equal(b.length, 3);
  b.forEach((x) => { assert.equal(x.type, 'FRAME'); assert.equal(x.findOne((n) => n.type === 'TEXT').characters, '← К навигации'); assert.ok(hasClick(x, w.id)); });
});

test('без режима работает «Простой вид», компоненты не нужны', async () => {
  const { page, build } = setup();
  const r = await build({ label: 'x', comp: {} });
  assert.equal(r.ok, true, r.text);
  assert.equal(wrapperOf(page).children[0].type, 'FRAME');
});

test('нет компонентов в «Мои компоненты»: понятная ошибка и подсказка про простой вид', async () => {
  const { page, build } = setup();
  const r = await build({ mode: 'components', comp: { descKey: 'нет такого', linkCardKey: 'нет такого', btnKey: 'нет такого' } });
  assert.equal(r.ok, false);
  assert.match(r.text, /Простой вид/);
  assert.equal(wrapperOf(page), undefined, 'ничего не создано');
});

for (const mode of ['components', 'simple']) {
  test(`пересборка (${mode}): заполненное название ряда сохраняется, блоки не дублируются`, async () => {
    const { page, build } = setup();
    assert.equal((await build({ mode, comp: COMP })).ok, true);
    const first = wrapperOf(page);
    const title = first.children[0];
    title.findOne((n) => n.type === 'TEXT').characters = 'Мой заголовок';
    assert.equal((await build({ mode, comp: COMP })).ok, true);
    const wrappers = page.children.filter((c) => c.getSharedPluginData('framelinter', 'navRole') === 'panel');
    assert.equal(wrappers.length, 1, 'старый блок заменён, а не продублирован');
    assert.equal(backs(page).length, 3);
    assert.equal(wrappers[0].children[0], title, 'тот же узел заголовка перенесён в новый блок');
    assert.equal(title.findOne((n) => n.type === 'TEXT').characters, 'Мой заголовок');
  });
}
