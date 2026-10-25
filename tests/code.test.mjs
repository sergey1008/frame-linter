// Запуск: node --test tests/
// code.js грузится в изолированный контекст с заглушкой figma: проверяем чистые функции без Figma.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const figmaStub = {
  showUI() {}, on() {}, notify() {}, mixed: Symbol('mixed'),
  ui: { postMessage() {}, resize() {}, reposition() {}, onmessage: null },
  clientStorage: { getAsync: async () => undefined, setAsync: async () => {} },
  root: { getPluginData: () => '' },
  currentPage: { selection: [], children: [] },
  viewport: { zoom: 1, bounds: { x: 0, y: 0, width: 1, height: 1 } },
};
const ctx = vm.createContext({ figma: figmaStub, __html__: '', console, setTimeout, clearTimeout, Math, JSON, Date });
vm.runInContext(fs.readFileSync(path.join(root, 'code.js'), 'utf8'), ctx, { filename: 'code.js' });
const plain = (v) => JSON.parse(JSON.stringify(v)); // массивы из vm-контекста иначе не равны обычным по прототипу
const get = (expr) => vm.runInContext(expr, ctx); // const-объявления доступны только через eval в контексте

test('toKebab', () => {
  const toKebab = get('toKebab');
  assert.equal(toKebab('Main Header'), 'main-header');
  assert.equal(toKebab('mainHeader_2'), 'main-header-2');
  assert.equal(toKebab('  Card!! '), 'card');
});

test('toPascal и toCamel: слова с заглавной и без пробелов', () => {
  const pascal = get('toPascal'), camel = get('toCamel');
  assert.equal(pascal('main header'), 'MainHeader');
  assert.equal(pascal('main-header_2'), 'MainHeader2');
  assert.equal(pascal('mainHeader'), 'MainHeader');
  assert.equal(camel('Main Header'), 'mainHeader');
  assert.equal(camel('!!!'), '');
});

test('шаблон PascalCase из настроек принимает MainHeader и отвергает остальные стили', () => {
  const html = fs.readFileSync(path.join(root, 'ui.html'), 'utf8');
  const m = /pascal: '([^']+)'/.exec(html);
  assert.ok(m, 'пресет pascal есть в ui.html');
  const re = new RegExp(m[1]);
  for (const ok of ['MainHeader', 'Card', 'Card2Item']) assert.ok(re.test(ok), ok);
  for (const bad of ['mainHeader', 'main-header', 'Main Header', 'Main_Header', '']) assert.ok(!re.test(bad), bad);
});

test('toPascalPath: части пути приводятся к CamelCase', () => {
  const f = get('toPascalPath');
  assert.equal(f('button primary'), 'ButtonPrimary');
  assert.equal(f('forms/text-input'), 'Forms/TextInput');
});

test('шаблоны компонентов и вариантов по умолчанию', () => {
  const { componentPattern, variantPattern } = get('DEFAULTS');
  const comp = new RegExp(componentPattern), variant = new RegExp(variantPattern);
  for (const ok of ['Button', 'Category/ButtonPrimary', 'Forms/Input Field']) assert.ok(comp.test(ok), ok);
  for (const bad of ['button', 'Category/button', '/Button', 'Button/']) assert.ok(!comp.test(bad), bad);
  for (const ok of ['Size=Large', 'Size=Large, State=Hover', 'Size=Large,State=Hover']) assert.ok(variant.test(ok), ok);
  for (const bad of ['Large', 'Size=', 'Size=A=B']) assert.ok(!variant.test(bad), bad);
});

test('дефолтные имена слоёв', () => {
  const re = get('DEFAULT_NAME_RE');
  for (const n of ['Frame 12', 'frame', 'Group 3', 'Rectangle 1234', 'Vector']) assert.ok(re.test(n), n);
  for (const n of ['Header', 'Frame Header', 'Group/Card']) assert.ok(!re.test(n), n);
});

test('parseTable: CSV, TSV, «;» и JSON', () => {
  const parse = get('parseTable');
  assert.deepEqual(JSON.parse(JSON.stringify(parse('title,price\nКофе,120\nЧай,90'))), [{ title: 'Кофе', price: '120' }, { title: 'Чай', price: '90' }]);
  assert.deepEqual(JSON.parse(JSON.stringify(parse('a\tb\n1\t2'))), [{ a: '1', b: '2' }]);
  assert.deepEqual(JSON.parse(JSON.stringify(parse('a;b\n1;2'))), [{ a: '1', b: '2' }]);
  assert.deepEqual(JSON.parse(JSON.stringify(parse('[{"a":1,"b":null}]'))), [{ a: '1', b: '' }]);
});

test('parseTable: кавычки, запятые внутри ячейки, CRLF, пустые строки', () => {
  const parse = get('parseTable');
  const rows = JSON.parse(JSON.stringify(parse('name,note\r\n"Иванов, И.","он сказал ""да"""\r\n\r\n')));
  assert.deepEqual(rows, [{ name: 'Иванов, И.', note: 'он сказал "да"' }]);
  assert.deepEqual(plain(parse('   ')), []);
});

test('toHex и colorDist', () => {
  assert.equal(get('toHex')({ r: 1, g: 0, b: 0.5 }), '#FF0080');
  const dist = get('colorDist');
  assert.equal(dist({ r: 0, g: 0, b: 0 }, { r: 0, g: 0, b: 0 }), 0);
  assert.ok(Math.abs(dist({ r: 0, g: 0, b: 0 }, { r: 1, g: 0, b: 0 }) - 255) < 1e-9);
});

test('rx: невалидное выражение не бросает', () => {
  const rx = get('rx');
  assert.equal(rx(''), null);
  assert.equal(rx('['), null);
  assert.ok(rx('^a').test('abc'));
});

// Узел-заглушка с геометрией для навигации
const box = (name, x, y, w, h) => ({ name, absoluteBoundingBox: { x, y, width: w, height: h } });

test('navRows: фреймы группируются в ряды по вертикальному центру и сортируются слева направо', () => {
  const navRows = get('navRows');
  const a = box('A', 0, 0, 100, 100), b = box('B', 300, 10, 100, 80), c = box('C', 0, 500, 100, 100), d = box('D', 300, 520, 100, 60);
  const rows = navRows([d, b, c, a]);
  assert.equal(rows.length, 2);
  assert.deepEqual(plain(rows[0].items.map((f) => f.name)), ['A', 'B']);
  assert.deepEqual(plain(rows[1].items.map((f) => f.name)), ['C', 'D']);
  assert.ok(rows[0].top < rows[1].top);
});

test('navRowName: общий префикс, своё имя, нумерация', () => {
  const name = get('navRowName');
  const items = [{ name: 'Auth/Login' }, { name: 'Auth/Signup' }];
  assert.equal(name(items, 0, 1, ''), 'Auth');
  assert.equal(name([{ name: 'A' }, { name: 'B' }], 1, 2, ''), 'Ряд 2');
  assert.equal(name(items, 0, 2, 'Поток'), 'Поток 1');
  assert.equal(name(items, 0, 1, 'Поток'), 'Поток');
});

test('в ui.html нет повторных объявлений функций верхнего уровня', () => {
  const html = fs.readFileSync(path.join(root, 'ui.html'), 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(scripts.length > 0);
  const seen = new Map();
  for (const src of scripts) for (const m of src.matchAll(/^(?:async )?function (\w+)/gm)) seen.set(m[1], (seen.get(m[1]) || 0) + 1);
  const dups = [...seen].filter(([, n]) => n > 1).map(([f]) => f);
  assert.deepEqual(dups, []);
});

test('в ui.html нет копий шаблонов компонентов и вариантов из code.js', () => {
  const html = fs.readFileSync(path.join(root, 'ui.html'), 'utf8');
  const { componentPattern, variantPattern } = get('DEFAULTS');
  assert.ok(!html.includes(`'${componentPattern}'`));
  assert.ok(!html.includes(`'${variantPattern}'`));
});
