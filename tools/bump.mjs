// Поднимает версию плагина: node tools/bump.mjs 1.1.0 "что нового"
// Меняет PLUGIN_VERSION в code.js и version.json (его читают установленные плагины, чтобы показать «Доступна версия»).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const [version, ...rest] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/.test(version || '')) { console.error('Использование: node tools/bump.mjs 1.1.0 "что нового"'); process.exit(1); }

const codePath = path.join(root, 'code.js');
const code = fs.readFileSync(codePath, 'utf8');
if (!/const PLUGIN_VERSION = '[^']*';/.test(code)) throw new Error('В code.js нет PLUGIN_VERSION');
fs.writeFileSync(codePath, code.replace(/const PLUGIN_VERSION = '[^']*';/, `const PLUGIN_VERSION = '${version}';`));
fs.writeFileSync(path.join(root, 'version.json'), JSON.stringify({ version, notes: rest.join(' ') || '' }, null, 2) + '\n');
console.log(`Версия ${version}. Дальше: git commit, git tag v${version}, node tools/pack.mjs, релиз на GitHub.`);
