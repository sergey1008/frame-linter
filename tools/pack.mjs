// Сборка: node tools/pack.mjs → dist/frame-linter-vX.Y.Z.zip для коллег (с проверкой обновлений через GitHub).
//         node tools/pack.mjs --community → dist/community/ для Figma Community (без проверки обновлений и networkAccess).
// Внутри — папка frame-linter с manifest.json, code.js, ui.html.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const community = process.argv.includes('--community');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8'));
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

// Из UI убираем запрос к GitHub целиком: остаётся только подпись версии.
function stripUpdateCheck(html) {
  const re = /async function checkUpdate\(cur, repo\) \{[\s\S]*?\n\}\n/;
  if (!re.test(html)) throw new Error('В ui.html не найдена checkUpdate');
  return html.replace(re, "function checkUpdate(cur) { $('verTxt').textContent = 'v' + cur; }\n");
}

// Community: Figma сама раздаёт обновления, поэтому без запросов к GitHub.
function communityFiles() {
  const code = read('code.js');
  if (!/const UPDATE_REPO = '[^']*';/.test(code)) throw new Error('В code.js нет UPDATE_REPO');
  const manifest = JSON.parse(read('manifest.json'));
  delete manifest.networkAccess;
  return {
    'manifest.json': JSON.stringify(manifest, null, 2) + '\n',
    'code.js': code.replace(/const UPDATE_REPO = '[^']*';/, "const UPDATE_REPO = '';"),
    'ui.html': stripUpdateCheck(read('ui.html')),
  };
}
const files = community ? communityFiles() : { 'manifest.json': read('manifest.json'), 'code.js': read('code.js'), 'ui.html': read('ui.html') };
const write = (dir) => { fs.mkdirSync(dir, { recursive: true }); for (const [f, s] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), s); };

if (community) {
  const out = path.join(root, 'dist', 'community');
  fs.rmSync(out, { recursive: true, force: true });
  write(out);
  console.log(`Готово: ${out} (v${version}). В Figma: Plugins → Development → Import plugin from manifest → этот manifest.json, затем Publish.`);
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-linter-'));
  write(path.join(tmp, 'frame-linter'));
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  const out = path.join(root, 'dist', `frame-linter-v${version}.zip`);
  fs.rmSync(out, { force: true });
  execFileSync('zip', ['-qr', out, 'frame-linter'], { cwd: tmp });
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('Готово:', out);
}
