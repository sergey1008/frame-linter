// Собирает zip для коллег: node tools/pack.mjs → dist/frame-linter-vX.Y.Z.zip (внутри папка frame-linter с manifest.json, code.js, ui.html).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-linter-'));
const dir = path.join(tmp, 'frame-linter');
fs.mkdirSync(dir);
for (const f of ['manifest.json', 'code.js', 'ui.html']) fs.copyFileSync(path.join(root, f), path.join(dir, f));
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const out = path.join(root, 'dist', `frame-linter-v${version}.zip`);
fs.rmSync(out, { force: true });
execFileSync('zip', ['-qr', out, 'frame-linter'], { cwd: tmp });
fs.rmSync(tmp, { recursive: true, force: true });
console.log('Готово:', out);
