// Встраивает движок nspell и словари (русский, английский) в ui.html между маркерами SPELL-BEGIN / SPELL-END.
// Запуск из папки плагина:  cd tools && npm install && node build-spell.mjs
// Лицензии: nspell — MIT; dictionary-ru — BSD-3-Clause (A. Lebedev, LibreOffice); dictionary-en — MIT AND BSD.
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const dict = (name, f) => zlib.gzipSync(fs.readFileSync(path.join(here, 'node_modules', name, f)), { level: 9 }).toString('base64');

const engine = await build({
  stdin: { contents: "import nspell from 'nspell'; globalThis.nspellFactory = nspell;", resolveDir: here, loader: 'js' },
  bundle: true, minify: true, format: 'iife', platform: 'browser', write: false, target: 'es2020',
});
const code = engine.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const data = JSON.stringify({
  ruAff: dict('dictionary-ru', 'index.aff'), ruDic: dict('dictionary-ru', 'index.dic'),
  enAff: dict('dictionary-en', 'index.aff'), enDic: dict('dictionary-en', 'index.dic'),
});

const file = path.join(root, 'ui.html');
let html = fs.readFileSync(file, 'utf8');
const a = html.indexOf('<!--SPELL-BEGIN-->'), b = html.indexOf('<!--SPELL-END-->');
if (a < 0 || b < 0) throw new Error('В ui.html нет маркеров SPELL-BEGIN / SPELL-END');
html = html.slice(0, a) + '<!--SPELL-BEGIN-->\n<script id="spell-engine">' + code + '</script>\n<script id="spell-data" type="application/json">' + data + '</script>\n' + html.slice(b);
fs.writeFileSync(file, html);
console.log('ui.html обновлён: движок', Math.round(code.length / 1024), 'КБ, словари', Math.round(data.length / 1024), 'КБ');
