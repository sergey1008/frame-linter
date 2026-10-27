// Frame Linter: проверка именования слоёв, использования токенов и именования компонентов.

const DEFAULTS = {
  scope: 'selection', // 'selection' | 'page'
  checkNames: true,
  checkTokens: true,
  checkComponents: true,
  suggestTokens: true,
  checkStructure: true,
  onlyDefaultNames: true,
  includeLibrary: true,
  libOff: [], // имена библиотек, которые не нужно подгружать
  checkCleanup: true,
  checkHandoff: true,
  saveVersion: true,
  live: false,
  spacingTolerance: 2,
  // Расстояния между рядами и навигацией, px
  navGap: 280, // от блока навигации до первого фрейма ряда
  frameGap: 280, // между соседними фреймами в ряду по горизонтали
  rowGap: 600, // между рядами фреймов по вертикали
  // Имена блоков (frame/group/auto-layout). Пусто = проверять только дефолтные имена вроде "Frame 12".
  blockPattern: '',
  // Имена компонентов: CamelCase и «/» разрешены, каждая часть с заглавной (Category/ButtonPrimary).
  componentPattern: '^[A-Z][A-Za-z0-9 ]*(/[A-Z][A-Za-z0-9 ]*)*$',
  // Свойства вариантов: Property=Value
  variantPattern: '^[A-Za-z][A-Za-z0-9 ]*=[^,=]+(, ?[A-Za-z][A-Za-z0-9 ]*=[^,=]+)*$',
  tokenChecks: { fills: true, strokes: true, text: true, effects: true, radius: true, spacing: true },
};

const DEFAULT_NAME_RE = /^(Frame|Group|Rectangle|Ellipse|Line|Vector|Polygon|Star|Section|Component|Instance|Slice|Boolean|Union|Subtract|Intersect|Exclude|Image)\s*\d*$/i;

// Версия плагина и репозиторий для проверки обновлений. Менять версию: node tools/bump.mjs 1.1.0 "что нового".
const PLUGIN_VERSION = '1.2.1';
const UPDATE_REPO = 'sergey1008/frame-linter';

figma.showUI(__html__, { width: 900, height: 660, themeColors: true });

// Свёрнутое окно и прижатие к краю: размер меняем сами, положение считаем от видимой области холста (в пикселях экрана).
const WIN = { collapsed: false, dock: null, size: { w: 900, h: 660 } };
const MINI = { w: 280, h: 48 };
// reposition принимает координаты холста, а не экрана: переводим желаемую позицию (пиксели от левого верхнего угла видимого холста) в координаты холста.
function applyDock() {
  if (!WIN.dock || typeof figma.ui.reposition !== 'function') return;
  try {
    const z = figma.viewport.zoom, b = figma.viewport.bounds;
    const vw = b.width * z, vh = b.height * z;
    const sz = WIN.collapsed ? MINI : WIN.size, m = 8;
    const px = { left: [m, m], right: [vw - sz.w - m, m], bottom: [(vw - sz.w) / 2, vh - sz.h - m] }[WIN.dock];
    const sx = Math.max(0, px[0]), sy = Math.max(0, px[1]);
    figma.ui.reposition(Math.round(b.x + sx / z), Math.round(b.y + sy / z));
  } catch (e) {}
}
function applyWin() {
  const sz = WIN.collapsed ? MINI : WIN.size;
  figma.ui.resize(sz.w, sz.h);
  applyDock();
  figma.ui.postMessage({ type: 'win', collapsed: WIN.collapsed, dock: WIN.dock });
}

(async () => {
  const saved = await figma.clientStorage.getAsync('settings-v6');
  const ui = (await figma.clientStorage.getAsync('ui-v1')) || {};
  let skipped = [], skippedValues = [];
  try { skipped = JSON.parse(figma.root.getPluginData('skipped') || '[]'); } catch (e) {}
  try { skippedValues = JSON.parse(figma.root.getPluginData('skippedValues') || '[]'); } catch (e) {}
  if (ui.w && ui.h) figma.ui.resize(clampSize(ui.w, ui.h).w, clampSize(ui.w, ui.h).h);
  if (ui.w && ui.h) WIN.size = clampSize(ui.w, ui.h);
  const winSaved = (await figma.clientStorage.getAsync('win-v1')) || {};
  WIN.dock = ['left', 'right', 'bottom'].includes(winSaved.dock) ? winSaved.dock : null;
  const dictMe = (await figma.clientStorage.getAsync('dict-v1')) || [];
  let dictFile = [];
  try { dictFile = JSON.parse(figma.root.getPluginData('spellDict') || '[]'); } catch (e) {}
  figma.ui.postMessage({ type: 'settings', settings: Object.assign({}, DEFAULTS, saved), ui, skipped, skippedValues, navDefaults: NAV_DEFAULTS, dict: { me: dictMe, file: dictFile }, version: PLUGIN_VERSION, repo: UPDATE_REPO });
  postSelection();
  applyWin();
})();

function clampSize(w, h) {
  return { w: Math.max(340, Math.min(900, Math.round(w) || 420)), h: Math.max(420, Math.min(1000, Math.round(h) || 620)) };
}

// ---------- Выделение, отмена, прогресс ----------
let selTimer = null;
function postSelection() {
  const sel = figma.currentPage.selection;
  // цепочка предков каждого выделенного слоя: по ней интерфейс понимает, лежит ли слой внутри уже проверенного фрейма или секции
  const chains = sel.map((n) => { const ids = []; for (let q = n; q && q.type !== 'PAGE' && q.type !== 'DOCUMENT'; q = q.parent) ids.push(q.id); return ids; });
  figma.ui.postMessage({ type: 'selection', count: sel.length, names: sel.map((n) => n.name), ids: sel.map((n) => n.id), chains });
}
figma.on('selectionchange', () => { clearTimeout(selTimer); selTimer = setTimeout(postSelection, 150); });
figma.on('currentpagechange', () => {
  lastRun = lastRun ? Object.assign(lastRun, { rootIds: null }) : null; // слои прошлой проверки остались на другой странице
  figma.ui.postMessage({ type: 'pageChanged' });
  postSelection();
});

let cancelled = false;
const CANCEL = { cancelled: true };
const tick = () => new Promise((r) => setTimeout(r, 0));

// Тост с кнопкой «Отменить»: откатывает последнюю правку плагина и перепроверяет.
function notifyUndo(text) {
  figma.notify(text, { timeout: 8000, button: { text: 'Отменить', action: () => { undoLast(); return false; } } });
}
async function undoLast() {
  try { figma.triggerUndo(); } catch (e) { figma.notify('Автоотмена недоступна — нажми Cmd+Z'); return; }
  quiet();
  figma.ui.postMessage({ type: 'undone' });
  await new Promise((r) => setTimeout(r, 400));
  if (lastRun) runAndPost(lastRun.s, lastRun.rootIds, false).catch(() => {});
}

function countNodes(node) {
  let n = 1;
  if ('children' in node && node.type !== 'INSTANCE') for (const c of node.children) n += countNodes(c);
  return n;
}

async function componentNameFromSelection() {
  for (const n of figma.currentPage.selection) {
    if (n.type === 'INSTANCE') {
      const m = await n.getMainComponentAsync();
      if (m) return m.parent && m.parent.type === 'COMPONENT_SET' ? m.parent.name : m.name;
    } else if (n.type === 'COMPONENT_SET') return n.name;
    else if (n.type === 'COMPONENT') return n.parent && n.parent.type === 'COMPONENT_SET' ? n.parent.name : n.name;
  }
  return '';
}

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'run') {
    await figma.clientStorage.setAsync('settings-v6', msg.settings);
    // «Перепроверить»: те же корни, что и в прошлый раз, даже если выделение сменилось (например, после клика по замечанию)
    await runAndPost(msg.settings, msg.reuse && lastRun && lastRun.rootIds ? lastRun.rootIds : null);
    await setupLive(msg.settings);
  } else if (msg.type === 'dictSave') {
    const words = [...new Set((msg.words || []).map(String).filter(Boolean))].slice(0, 5000);
    if (msg.scope === 'file') { try { figma.root.setPluginData('spellDict', JSON.stringify(words)); quiet(); } catch (e) { figma.notify('Не удалось сохранить словарь файла'); } }
    else await figma.clientStorage.setAsync('dict-v1', words);
  } else if (msg.type === 'spellScan') {
    const items = []; let truncated = false;
    const roots = msg.scope === 'page' ? figma.currentPage.children.slice() : figma.currentPage.selection.slice();
    const hidden = (n) => { for (let q = n; q && q.type !== 'PAGE' && q.type !== 'DOCUMENT'; q = q.parent) if (q.visible === false) return true; return false; };
    const topName = (n) => { let q = n; while (q.parent && q.parent.type !== 'PAGE' && q.parent.type !== 'DOCUMENT' && q.parent.type !== 'SECTION') q = q.parent; return q.name; };
    const push = (n) => {
      if (n.type !== 'TEXT' || (n.name || '').startsWith('#') || hidden(n)) return;
      if (items.length >= 8000) { truncated = true; return; }
      const text = n.characters;
      if (text && text.trim()) items.push({ id: n.id, text, name: n.name, frame: topName(n) });
    };
    for (const r of roots) {
      if (isNavNode(r)) continue;
      if (r.type === 'TEXT') push(r);
      else if ('findAllWithCriteria' in r) r.findAllWithCriteria({ types: ['TEXT'] }).forEach(push);
    }
    figma.ui.postMessage({ type: 'spellTexts', items, truncated });
  } else if (msg.type === 'spellFix') {
    await checkpoint('исправление правописания', msg.items.length);
    const byNode = new Map();
    for (const it of msg.items) (byNode.get(it.id) || byNode.set(it.id, []).get(it.id)).push(it);
    let ok = 0, failed = 0; const ids = [];
    for (const [id, list] of byNode) {
      const node = await figma.getNodeByIdAsync(id);
      if (!node || node.removed || node.type !== 'TEXT') { failed += list.length; continue; }
      try {
        const fonts = new Set();
        for (const seg of node.getStyledTextSegments(['fontName'])) fonts.add(JSON.stringify(seg.fontName));
        for (const f of fonts) await figma.loadFontAsync(JSON.parse(f));
      } catch (e) { failed += list.length; continue; }
      list.sort((a, b) => b.start - a.start); // с конца, чтобы смещения не сбивались
      for (const it of list) {
        if (node.characters.slice(it.start, it.end) !== it.from) { failed++; continue; }
        try { node.deleteCharacters(it.start, it.end); node.insertCharacters(it.start, it.to, it.start > 0 ? 'BEFORE' : 'AFTER'); ok++; } catch (e) { failed++; }
      }
      ids.push(id);
    }
    quiet();
    const fresh = [];
    for (const id of ids) { const n = await figma.getNodeByIdAsync(id); if (n && !n.removed && n.type === 'TEXT') fresh.push({ id, text: n.characters, name: n.name }); }
    figma.ui.postMessage({ type: 'spellTexts', partial: true, ids, items: fresh });
    figma.ui.postMessage({ type: 'spellFixed', ok, failed });
    if (ok) notifyUndo(`Исправлено слов: ${ok}` + (failed ? `, пропущено: ${failed}` : ''));
  } else if (msg.type === 'saveSettings') {
    await figma.clientStorage.setAsync('settings-v6', msg.settings);
  } else if (msg.type === 'selectMany') {
    const nodes = [];
    for (const id of msg.ids) { const n = await figma.getNodeByIdAsync(id); if (n && !n.removed && n.type !== 'PAGE' && n.type !== 'DOCUMENT') nodes.push(n); }
    if (!nodes.length) return;
    let page = nodes[0];
    while (page && page.type !== 'PAGE') page = page.parent;
    if (page && page !== figma.currentPage) await figma.setCurrentPageAsync(page);
    const here = nodes.filter((n) => { let p = n; while (p && p.type !== 'PAGE') p = p.parent; return p === figma.currentPage; });
    ignoreSelUntil = Date.now() + 900;
    figma.currentPage.selection = here;
    figma.viewport.scrollAndZoomIntoView(here);
    figma.notify(`Выделено слоёв: ${here.length}` + (here.length < nodes.length ? `, остальные (${nodes.length - here.length}) на других страницах` : ''));
  } else if (msg.type === 'cancel') {
    cancelled = true;
  } else if (msg.type === 'saveUi') {
    await figma.clientStorage.setAsync('ui-v1', msg.ui);
  } else if (msg.type === 'saveSkipped') {
    try { figma.root.setPluginData('skipped', JSON.stringify((msg.keys || []).slice(-1500))); } catch (e) {}
  } else if (msg.type === 'saveSkippedValues') {
    // «Пропустить все»: помним правило и текст замечания, а не id слоёв (их могут быть тысячи)
    try { figma.root.setPluginData('skippedValues', JSON.stringify((msg.keys || []).slice(-300))); } catch (e) {}
  } else if (msg.type === 'skipToast') {
    // «Пропустить все» ничего не меняет в файле, но отмену даём так же, как у правок: кнопка в тосте Figma
    figma.notify(`Пропущено замечаний: ${msg.count}`, { timeout: 8000, button: { text: 'Отменить', action: () => { figma.ui.postMessage({ type: 'undoSkip', key: msg.key }); return false; } } });
  } else if (msg.type === 'preview') {
    let bytes = null;
    try {
      const n = await figma.getNodeByIdAsync(msg.id);
      if (n && !n.removed && 'exportAsync' in n) bytes = await n.exportAsync({ format: 'PNG', constraint: { type: 'WIDTH', value: 640 } });
    } catch (e) {}
    figma.ui.postMessage({ type: 'previewResult', id: msg.id, bytes });
  } else if (msg.type === 'navPick') {
    let n = figma.currentPage.selection[0] || null;
    if (n && n.type === 'INSTANCE') n = await n.getMainComponentAsync();
    if (n && n.type === 'COMPONENT_SET') n = n.defaultVariant;
    if (!n || n.type !== 'COMPONENT') figma.ui.postMessage({ type: 'navPicked', field: msg.field, error: 'Выдели на холсте инстанс нужного компонента (или сам компонент)' });
    else figma.ui.postMessage({ type: 'navPicked', field: msg.field, key: n.key, name: n.parent && n.parent.type === 'COMPONENT_SET' ? `${n.parent.name} · ${n.name}` : n.name });
  } else if (msg.type === 'win') {
    if (msg.action === 'collapse') WIN.collapsed = true;
    else if (msg.action === 'expand') WIN.collapsed = false;
    else if (msg.action === 'toggle') WIN.collapsed = !WIN.collapsed;
    else if (msg.action === 'dock') { WIN.dock = ['left', 'right', 'bottom'].includes(msg.dock) ? msg.dock : null; await figma.clientStorage.setAsync('win-v1', { dock: WIN.dock }); }
    applyWin();
  } else if (msg.type === 'resize') {
    const z = clampSize(msg.w, msg.h);
    if (!WIN.collapsed) WIN.size = z;
    figma.ui.resize(z.w, z.h);
  } else if (msg.type === 'pickComponent') {
    figma.ui.postMessage({ type: 'picked', which: msg.which, name: await componentNameFromSelection() });
  } else if (msg.type === 'moveNodes') {
    await checkpoint('сдвиг по расстояниям', msg.items.length);
    const r = await applyMoves(msg.items);
    quiet();
    figma.ui.postMessage({ type: 'moved', ids: r.done });
    notifyUndo(`Сдвинуто слоёв: ${r.done.length}` + (r.locked ? `, пропущено заблокированных: ${r.locked}` : ''));
  } else if (msg.type === 'layoutScan') {
    const sel = figma.currentPage.selection.slice();
    if (!sel.length) { figma.ui.postMessage({ type: 'layoutResult', scope: 'none', issues: null }); figma.notify('Выдели фреймы или секцию, чтобы проверить расстояния'); }
    else figma.ui.postMessage({ type: 'layoutResult', scope: 'selection', issues: layoutScan(msg.settings, sel) });
  } else if (msg.type === 'navPreview') {
    figma.ui.postMessage(Object.assign({ type: 'navPreviewResult' }, navPreview()));
  } else if (msg.type === 'navBuild') {
    let r;
    try { r = await navBuild(msg.opts || {}); } catch (e) { r = { ok: false, text: 'Не удалось построить навигацию: ' + (e.message || e) }; }
    figma.ui.postMessage({ type: 'navResult', ok: r.ok, text: r.text });
    if (r.ok) notifyUndo(r.text);
  } else if (msg.type === 'multiplyPreview') {
    figma.ui.postMessage(Object.assign({ type: 'multiplyPreviewResult' }, multiplyPreview(msg.data)));
  } else if (msg.type === 'live') {
    lastRun = lastRun ? Object.assign(lastRun, { s: msg.settings }) : { s: msg.settings, rootIds: null };
    await setupLive(msg.settings);
    if (msg.settings.live) await runAndPost(msg.settings, null);
  } else if (msg.type === 'remove') {
    await checkpoint('удаление слоёв', msg.ids.length);
    const done = [];
    for (const id of msg.ids) {
      const n = await figma.getNodeByIdAsync(id);
      if (n && !n.removed && !n.locked) { try { n.remove(); done.push(id); } catch (e) {} }
    }
    quiet();
    figma.ui.postMessage({ type: 'removed', ids: done });
    notifyUndo(`Удалено слоёв: ${done.length}`);
  } else if (msg.type === 'annotate') {
    const n = await annotateIssues(msg.items);
    figma.notify(`Аннотаций поставлено: ${n}`);
  } else if (msg.type === 'clearAnnotations') {
    const n = await clearAnnotations();
    figma.notify(`Аннотаций снято: ${n}`);
  } else if (msg.type === 'highlightSpacing') {
    const n = await highlightSpacing(msg.items);
    figma.notify(n ? `Подсвечено зон отступов: ${n}` : 'Нечего подсвечивать');
  } else if (msg.type === 'clearHighlight') {
    const n = await clearHighlight();
    figma.notify(`Подсветка снята: ${n}`);
  } else if (msg.type === 'reportToCanvas') {
    await reportToCanvas(msg.text);
  } else if (msg.type === 'setStatus') {
    let n = 0;
    for (const node of figma.currentPage.selection) {
      try { node.setSharedPluginData('framelinter', 'status', msg.status || ''); n++; } catch (e) {}
    }
    figma.notify(n ? `Статус «${msg.status || 'сброшен'}» у слоёв: ${n}` : 'Выдели фреймы, которым нужно поставить статус');
    figma.ui.postMessage({ type: 'statusSet', ids: figma.currentPage.selection.map((x) => x.id), status: msg.status || '' });
  } else if (msg.type === 'swap') {
    const r = await swapComponents(msg.rules, !!msg.dry);
    figma.ui.postMessage({ type: 'swapResult', dry: !!msg.dry, rows: r });
    if (!msg.dry) notifyUndo(`Заменено инстансов: ${r.reduce((a, x) => a + x.done, 0)}`);
  } else if (msg.type === 'multiply') {
    const r = await multiplyFrame(msg.data, Number(msg.gap) || 0);
    figma.ui.postMessage({ type: 'multiplyResult', text: r });
  } else if (msg.type === 'unwrap') {
    await checkpoint('удаление обёрток', msg.ids.length);
    const done = [], skipped = [];
    for (const id of msg.ids) {
      const r = await unwrapNode(id, msg.settings);
      if (r.ok) done.push(id); else skipped.push({ id, reason: r.reason });
    }
    figma.ui.postMessage({ type: 'unwrapped', done, skipped });
    notifyUndo(`Обёрток убрано: ${done.length}` + (skipped.length ? `, пропущено: ${skipped.length}` : ''));
  } else if (msg.type === 'bind') {
    await checkpoint('привязка токенов', msg.items.length);
    const r = await bindTokens(msg.items);
    figma.ui.postMessage({ type: 'bound', done: r.done });
    notifyUndo(`Токенов привязано: ${r.done.length}` + (r.failed ? `, не удалось: ${r.failed} (${r.why})` : ''));
  } else if (msg.type === 'refreshTokens') {
    tokenCache = null; tokenForce = true;
    try { await figma.clientStorage.setAsync('tok-v1', null); } catch (e) {}
    figma.notify('Кэш токенов сброшен — следующая проверка загрузит их заново');
  } else if (msg.type === 'listLibraries') {
    try {
      const cols = await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync();
      const m = new Map();
      for (const c of cols) m.set(c.libraryName, (m.get(c.libraryName) || 0) + 1);
      figma.ui.postMessage({ type: 'libraries', list: [...m].map(([name, collections]) => ({ name, collections })) });
    } catch (e) { figma.ui.postMessage({ type: 'libraries', list: [], error: e.message }); }
  } else if (msg.type === 'rename') {
    const done = await renameNodes([{ id: msg.id, name: msg.name }]);
    figma.ui.postMessage({ type: 'renamed', ids: done });
  } else if (msg.type === 'renameMany') {
    await checkpoint('переименование', msg.items.length);
    const done = await renameNodes(msg.items);
    figma.ui.postMessage({ type: 'renamed', ids: done });
    notifyUndo(`Переименовано: ${done.length}`);
  } else if (msg.type === 'openMain') {
    const inst = await figma.getNodeByIdAsync(msg.id);
    const main = inst && !inst.removed && inst.type === 'INSTANCE' ? await inst.getMainComponentAsync() : null;
    if (!main) { figma.notify('Главный компонент не найден — возможно, инстанс отсоединён'); return; }
    if (main.remote) {
      figma.notify(`Компонент «${main.name}» из библиотеки: в Figma ПКМ по инстансу → Go to main component`);
      ignoreSelUntil = Date.now() + 900;
      figma.currentPage.selection = [inst];
      return;
    }
    let page = main;
    while (page && page.type !== 'PAGE') page = page.parent;
    if (page && page !== figma.currentPage) await figma.setCurrentPageAsync(page);
    ignoreSelUntil = Date.now() + 900;
    figma.currentPage.selection = [main];
    figma.viewport.scrollAndZoomIntoView([main]);
  } else if (msg.type === 'select') {
    const node = await figma.getNodeByIdAsync(msg.id);
    if (!node || node.removed) {
      figma.notify('Слой не найден — возможно, он удалён. Запусти проверку заново');
      return;
    }
    let page = node;
    while (page && page.type !== 'PAGE') page = page.parent;
    if (page && page !== figma.currentPage) await figma.setCurrentPageAsync(page);
    ignoreSelUntil = Date.now() + 900;
    figma.currentPage.selection = [node];
    figma.viewport.scrollAndZoomIntoView([node]);
    if (node.visible === false || (node.parent && node.parent.visible === false)) figma.notify('Слой скрыт — выделен, но на холсте не виден');
  }
};

// ---------- Структурная «похожесть» блоков ----------
async function signature(node, depth) {
  depth = depth || 0;
  if (node.type === 'INSTANCE') {
    try { const m = await node.getMainComponentAsync(); return 'I:' + (m ? m.id : '?'); } catch (e) { return 'I:?'; }
  }
  let base = node.type;
  if ('layoutMode' in node && node.layoutMode !== 'NONE') base += ':' + node.layoutMode;
  if ('children' in node && node.children.length) {
    if (depth >= 3) return base + '[..' + node.children.length + ']';
    const parts = [];
    for (const c of node.children.slice(0, 20)) parts.push(await signature(c, depth + 1));
    return base + '[' + parts.join(',') + ']';
  }
  return base;
}
function hashStr(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return 'g' + (h >>> 0).toString(36);
}

async function renameNodes(items) {
  const done = [];
  for (const it of items) {
    const name = (it.name || '').trim();
    if (!name) continue;
    const node = await figma.getNodeByIdAsync(it.id);
    if (!node || node.removed || !('name' in node)) continue;
    node.name = name;
    done.push(it.id);
  }
  return done;
}

function rx(src) {
  try { return src ? new RegExp(src) : null; } catch (e) { return null; }
}

async function lint(s, rootIds, live) {
  let roots;
  if (rootIds) {
    roots = [];
    for (const id of rootIds) { const n = await figma.getNodeByIdAsync(id); if (n && !n.removed) roots.push(n); }
  } else if (s.scope === 'page') roots = figma.currentPage.children.slice();
  else roots = figma.currentPage.selection.slice();

  roots = roots.filter((r) => !isNavNode(r)); // блоки навигации не проверяем
  lastRun = { s, rootIds: s.scope === 'page' ? null : roots.map((r) => r.id) };

  if (!roots.length) {
    return { issues: [{ id: '', name: '', severity: 'info', rule: 'scope', message: s.scope === 'page' ? 'На странице нет слоёв' : 'Выдели фрейм на холсте или проверь всю страницу' }], frames: [] };
  }

  const ctx = {
    s,
    issues: [],
    sigs: {},
    blockRe: rx(s.blockPattern),
    compRe: rx(s.componentPattern),
    variantRe: rx(s.variantPattern),
    tokens: null,
    live: !!live,
    n: 0,
    total: 0,
  };
  cancelled = false;
  if (s.checkTokens && s.suggestTokens) {
    if (!live) figma.ui.postMessage({ type: 'progress', phase: 'tokens', text: 'Загружаю токены дизайн-системы…' });
    try { ctx.tokens = await loadTokens(!!s.includeLibrary, live, s.libOff || []); } catch (e) {
      if (e === CANCEL) throw e;
      figma.notify('Не удалось загрузить токены: ' + e.message);
    }
  }
  if (!live) {
    for (const r of roots) ctx.total += countNodes(r);
    figma.ui.postMessage({ type: 'progress', phase: 'walk', done: 0, total: ctx.total });
  }
  for (const r of roots) await walk(r, ctx);
  linkSimilar(ctx);
  // имя и тип главного компонента для замечаний внутри инстансов
  const mains = new Map();
  for (const i of ctx.issues) {
    if (!i.inInstance) continue;
    if (!mains.has(i.inInstance.id)) {
      let info = null;
      try {
        const inst = await figma.getNodeByIdAsync(i.inInstance.id);
        const m = inst && !inst.removed ? await inst.getMainComponentAsync() : null;
        if (m) info = { mainId: m.id, main: m.parent && m.parent.type === 'COMPONENT_SET' ? m.parent.name : m.name, remote: !!m.remote };
      } catch (e) {}
      mains.set(i.inInstance.id, info);
    }
    Object.assign(i.inInstance, mains.get(i.inInstance.id) || {});
  }
  const frames = roots.map((r) => {
    let st = '';
    try { st = r.getSharedPluginData('framelinter', 'status'); } catch (e) {}
    return { id: r.id, name: r.name, status: st };
  });
  const tokenStats = ctx.tokens ? { colors: ctx.tokens.filter((t) => t.type === 'COLOR').length, floats: ctx.tokens.filter((t) => t.type === 'FLOAT').length } : null;
  return { issues: ctx.issues, frames, tokenStats };
}

let lastRun = null;
let running = false;
async function runAndPost(s, rootIds, live) {
  if (running) { if (live) return; cancelled = true; }
  while (running) await tick();
  running = true;
  try {
    const r = await lint(s, rootIds, live);
    quiet();
    figma.ui.postMessage({ type: 'result', issues: r.issues, frames: r.frames, tokenStats: r.tokenStats, live: !!live });
  } catch (e) {
    if (e !== CANCEL) { figma.ui.postMessage({ type: 'failed', text: String((e && e.message) || e) }); }
    else figma.ui.postMessage({ type: 'cancelled' });
  } finally { running = false; }
}

// ---------- Страховка и живой режим ----------
let quietUntil = 0;
function quiet() { quietUntil = Date.now() + 1500; }
let ignoreSelUntil = 0;

async function checkpoint(title, count) {
  const on = lastRun ? lastRun.s.saveVersion !== false : true;
  if (!on || count < 2) return;
  try { await figma.saveVersionHistoryAsync('Frame Linter: ' + title, 'Автосохранение перед массовой правкой'); } catch (e) {}
}

let liveHooked = false, liveTimer = null;
async function setupLive(s) {
  if (!s.live || liveHooked) return;
  liveHooked = true;
  try { await figma.loadAllPagesAsync(); } catch (e) {}
  const kick = (selectionBased) => {
    if (!lastRun || !lastRun.s.live) return;
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => {
      const ids = selectionBased ? null : lastRun.rootIds;
      runAndPost(lastRun.s, ids, true).catch(() => {});
    }, 900);
  };
  figma.on('documentchange', () => { if (Date.now() < quietUntil) return; kick(false); });
  figma.on('selectionchange', () => {
    if (Date.now() < ignoreSelUntil || Date.now() < quietUntil) return;
    if (lastRun && lastRun.s.scope === 'selection' && figma.currentPage.selection.length) kick(true);
  });
}

// Похожие блоки получают общую группу и, если у кого-то уже есть корректное имя, — одно и то же предложение.
function linkSimilar(ctx) {
  const bad = new Set(ctx.issues.filter((i) => i.rule.startsWith('name/')).map((i) => i.id));
  const good = {};
  for (const id in ctx.sigs) {
    if (bad.has(id)) continue;
    const { sig, name } = ctx.sigs[id];
    good[sig] = good[sig] || {};
    good[sig][name] = (good[sig][name] || 0) + 1;
  }
  for (const i of ctx.issues) {
    const info = ctx.sigs[i.id];
    if (!info || !i.renamable || (i.rule !== 'name/default' && i.rule !== 'name/pattern')) continue;
    i.group = info.sig;
    const names = good[info.sig];
    if (names) {
      i.suggest = Object.keys(names).sort((a, b) => names[b] - names[a])[0];
      i.fromSimilar = true;
    }
  }
}

async function walk(node, ctx) {
  const { s } = ctx;
  if (isNavNode(node)) return; // блоки навигации не проверяем
  if (++ctx.n % 80 === 0) {
    await tick(); // отдаём управление, чтобы дошла «Отмена» и обновился прогресс
    if (cancelled) throw CANCEL;
    if (!ctx.live) figma.ui.postMessage({ type: 'progress', phase: 'walk', done: ctx.n, total: ctx.total });
  }
  // Скрытые слои: сообщаем о них и не заходим внутрь, чтобы не шуметь.
  if (s.checkCleanup && node.visible === false && node.parent && node.parent.type !== 'PAGE') {
    checkCleanup(node, ctx);
    return;
  }
  if (s.checkNames && (node.type === 'FRAME' || node.type === 'GROUP') && node.children.length) {
    ctx.sigs[node.id] = { sig: hashStr(await signature(node)), name: node.name };
  }
  if (s.checkNames) checkName(node, ctx);
  if (s.checkComponents) checkComponent(node, ctx);
  if (s.checkTokens) checkTokens(node, ctx);
  if (s.checkStructure) checkStructure(node, ctx);
  if (s.checkCleanup) checkCleanup(node, ctx);
  if (s.checkHandoff) checkHandoff(node, ctx);

  // Не лезем внутрь инстансов: их содержимое принадлежит главному компоненту.
  if ('children' in node && node.type !== 'INSTANCE') {
    for (const c of node.children) await walk(c, ctx);
  }
}

function add(ctx, node, severity, rule, message, rename, fixes) {
  const issue = { id: node.id, name: node.name, type: node.type, severity, rule, message };
  if (fixes) issue.fixes = fixes;
  let top = node;
  while (top.parent && top.parent.type !== 'PAGE' && top.parent.type !== 'DOCUMENT' && top.parent.type !== 'SECTION') top = top.parent;
  issue.frame = top.name;
  const path = [];
  for (let p = node.parent; p && p.type !== 'PAGE' && p.type !== 'DOCUMENT'; p = p.parent) path.unshift(String(p.name).slice(0, 40));
  issue.path = path.slice(-4);
  if (DEFAULT_NAME_RE.test(top.name)) {
    // верхний контейнер безымянный («Frame 034875») — показываем ближайший именованный фрейм внутри него
    const chain = [];
    for (let p = node; p && p !== top; p = p.parent) chain.unshift(p);
    const named = chain.find((x) => ['FRAME', 'COMPONENT', 'COMPONENT_SET', 'SECTION'].includes(x.type) && !DEFAULT_NAME_RE.test(x.name));
    if (named) issue.frameLabel = named.name;
  }
  if (rename) { issue.renamable = true; issue.suggest = rename.suggest || ''; }
  // слой внутри инстанса: правка станет локальным переопределением, правильнее чинить главный компонент
  // Содержимое инстансов walk() не обходит, поэтому замечания про токены (цвет, радиус, отступы…) чаще всего у самого инстанса: значение переопределено на нём.
  if (node.type === 'INSTANCE' && rule.startsWith('token/')) issue.inInstance = { id: node.id, name: node.name, self: true };
  else for (let a = node.parent; a && a.type !== 'PAGE' && a.type !== 'DOCUMENT'; a = a.parent) {
    if (a.type === 'INSTANCE') { issue.inInstance = { id: a.id, name: a.name }; break; }
  }
  ctx.issues.push(issue);
}

// ---------- Предложения имён ----------
function suggestDefault(node) {
  switch (node.type) {
    case 'FRAME':
      if (node.layoutMode === 'HORIZONTAL') return 'Row';
      if (node.layoutMode === 'VERTICAL') return 'Column';
      return 'Container';
    case 'GROUP': return 'Content';
    case 'SECTION': return 'Section';
    case 'RECTANGLE': return 'Background';
    case 'ELLIPSE': return 'Circle';
    case 'LINE': return 'Divider';
    case 'VECTOR': case 'BOOLEAN_OPERATION': return 'Icon';
    default: return '';
  }
}
const toKebab = (n) => n.trim().replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[\s_]+/g, '-').replace(/[^A-Za-z0-9-]/g, '').replace(/-+/g, '-').toLowerCase();
// Слова из имени: границы — любые не-буквы/цифры и переход из строчной в заглавную (mainHeader → main Header)
const nameWords = (n) => n.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).filter(Boolean);
const toPascal = (n) => nameWords(n).map((w) => w[0].toUpperCase() + w.slice(1)).join('');
const toCamel = (n) => { const p = toPascal(n); return p ? p[0].toLowerCase() + p.slice(1) : ''; };
function toPascalPath(n) {
  return n.split('/').map((part) =>
    part.split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('')
  ).filter(Boolean).join('/');
}

// ---------- Имена ----------
function checkName(node, ctx) {
  const isBlock = ['FRAME', 'GROUP', 'SECTION'].includes(node.type);
  if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') return; // см. checkComponent
  if (DEFAULT_NAME_RE.test(node.name)) {
    add(ctx, node, 'warn', 'name/default', `Дефолтное имя «${node.name}»`, { suggest: suggestDefault(node) });
    return;
  }
  if (isBlock && ctx.blockRe && !ctx.blockRe.test(node.name)) {
    // предлагаем первое имя из стандартных стилей, которое подходит под шаблон (kebab-case, camelCase, PascalCase)
    const suggest = [toKebab(node.name), toCamel(node.name), toPascal(node.name)].find((c) => c && ctx.blockRe.test(c)) || '';
    add(ctx, node, 'error', 'name/pattern', `Имя блока «${node.name}» не соответствует шаблону ${ctx.s.blockPattern}`, { suggest });
  }
  if (node.name !== node.name.trim() || /\s{2,}/.test(node.name)) {
    add(ctx, node, 'warn', 'name/whitespace', 'Лишние пробелы в имени', { suggest: node.name.trim().replace(/\s{2,}/g, ' ') });
  }
}

// ---------- Компоненты ----------
function checkComponent(node, ctx) {
  if (node.type === 'COMPONENT_SET') {
    if (ctx.compRe && !ctx.compRe.test(node.name)) {
      add(ctx, node, 'error', 'component/name', `Имя набора «${node.name}» не соответствует шаблону компонентов`, { suggest: toPascalPath(node.name) });
    }
  } else if (node.type === 'COMPONENT') {
    const inSet = node.parent && node.parent.type === 'COMPONENT_SET';
    if (inSet) {
      if (ctx.variantRe && !ctx.variantRe.test(node.name)) {
        add(ctx, node, 'error', 'component/variant', `Вариант «${node.name}» должен быть в формате Property=Value`, { suggest: '' });
      }
    } else if (ctx.compRe && !ctx.compRe.test(node.name)) {
      add(ctx, node, 'error', 'component/name', `Имя компонента «${node.name}» не соответствует шаблону`, { suggest: toPascalPath(node.name) });
    }
  }
}


// ---------- Лишние обёртки ----------
const EPS = 0.05;

// Кандидат: frame/group с единственным потомком не на верхнем уровне.
function isWrapperCandidate(node, s) {
  if (node.type !== 'FRAME' && node.type !== 'GROUP') return false;
  if (node.children.length !== 1) return false;
  const p = node.parent;
  if (!p || p.type === 'PAGE' || p.type === 'SECTION' || p.type === 'DOCUMENT' || p.type === 'BOOLEAN_OPERATION') return false;
  if (s.onlyDefaultNames && !DEFAULT_NAME_RE.test(node.name)) return false;
  return true;
}

// Возвращает причину, по которой удалять нельзя, или null, если безопасно.
function wrapperBlocker(node) {
  if (node.locked) return 'слой заблокирован';
  for (let a = node.parent; a && a.type !== 'PAGE'; a = a.parent) if (a.type === 'INSTANCE') return 'находится внутри инстанса';
  const c = node.children[0];
  if (node.opacity !== 1) return 'у обёртки есть прозрачность';
  if (node.blendMode !== 'PASS_THROUGH' && node.blendMode !== 'NORMAL') return 'у обёртки режим наложения';
  if (node.isMask || c.isMask) return 'участвует маска';
  if (hasVisible(node.effects)) return 'у обёртки есть эффекты';
  if (node.reactions && node.reactions.length) return 'у обёртки есть прототипные связи';
  if (node.componentPropertyReferences && Object.keys(node.componentPropertyReferences).length) return 'обёртка привязана к свойству компонента';
  if (node.rotation || c.rotation) return 'есть поворот';
  if (node.layoutPositioning === 'ABSOLUTE' || c.layoutPositioning === 'ABSOLUTE') return 'абсолютное позиционирование';
  if (Math.abs(node.width - c.width) > EPS || Math.abs(node.height - c.height) > EPS) return 'размер обёртки отличается от содержимого (отступы)';
  if (node.type === 'FRAME') {
    if (isMixed(node.fills) || hasVisible(node.fills)) return 'у обёртки есть заливка';
    if (hasVisible(node.strokes)) return 'у обёртки есть обводка';
    if (isMixed(node.cornerRadius) || node.cornerRadius > 0) return 'у обёртки есть скругление';
    if (Math.abs(c.x) > EPS || Math.abs(c.y) > EPS) return 'содержимое смещено внутри обёртки';
    const childClips = c.type === 'FRAME' && c.clipsContent;
    const leafPlain = !('children' in c) && !hasVisible(c.effects);
    if (node.clipsContent && !childClips && !leafPlain) return 'обёртка обрезает содержимое';
  }
  return null;
}

function checkStructure(node, ctx) {
  if (!isWrapperCandidate(node, ctx.s)) return;
  const reason = wrapperBlocker(node);
  add(ctx, node, reason ? 'info' : 'warn', 'structure/wrapper',
    reason ? `Лишняя обёртка, но автоматически не убрать: ${reason}` : 'Лишняя обёртка с одним потомком — можно убрать без изменения вида');
  ctx.issues[ctx.issues.length - 1].unwrap = { safe: !reason, reason: reason || '' };
}

function snapshot(root, skipId) {
  const map = new Map();
  let n = 0;
  const visit = (nd) => {
    if (n++ > 4000) throw new Error('too-big');
    if (nd.id !== skipId && 'width' in nd && nd.absoluteTransform) {
      const t = nd.absoluteTransform;
      map.set(nd.id, [t[0][2], t[1][2], nd.width, nd.height, nd.visible === false ? 0 : 1]);
    }
    if ('children' in nd) for (const ch of nd.children) visit(ch);
  };
  visit(root);
  return map;
}
function sameSnapshot(a, b) {
  for (const [id, v] of a) {
    const w = b.get(id);
    if (!w) return false;
    for (let i = 0; i < 5; i++) if (Math.abs(v[i] - w[i]) > EPS) return false;
  }
  return true;
}

async function unwrapNode(id, s) {
  const node = await figma.getNodeByIdAsync(id);
  if (!node || node.removed) return { ok: false, reason: 'слой не найден' };
  if (!isWrapperCandidate(node, s)) return { ok: false, reason: 'структура изменилась' };
  const blocker = wrapperBlocker(node);
  if (blocker) return { ok: false, reason: blocker };

  const c = node.children[0];
  const parent = node.parent;
  const index = parent.children.indexOf(node);
  const parentAuto = 'layoutMode' in parent && parent.layoutMode !== 'NONE';

  let top = node;
  while (top.parent && top.parent.type !== 'PAGE') top = top.parent;
  let before;
  try { before = snapshot(top, node.id); }
  catch (e) { top = parent; try { before = snapshot(top, node.id); } catch (e2) { return { ok: false, reason: 'слишком большая структура для безопасной проверки' }; } }

  const g = (o, k) => { try { return o[k]; } catch (e) { return undefined; } };
  const saved = {
    x: c.x, y: c.y, grow: g(c, 'layoutGrow'), align: g(c, 'layoutAlign'),
    sh: g(c, 'layoutSizingHorizontal'), sv: g(c, 'layoutSizingVertical'), cons: g(c, 'constraints'),
  };
  const wasVisible = node.visible;
  let ok = false;
  try {
    node.visible = false;
    parent.insertChild(index + 1, c);
    if (parentAuto) {
      for (const [prop, w] of [['layoutSizingHorizontal', g(node, 'layoutSizingHorizontal')], ['layoutSizingVertical', g(node, 'layoutSizingVertical')]]) {
        try {
          if (w === 'FILL') c[prop] = 'FILL';
          else if (c[prop] === 'FILL') c[prop] = 'FIXED';
        } catch (e) {}
      }
    } else {
      if (node.type === 'FRAME') { c.x = node.x + saved.x; c.y = node.y + saved.y; } else { c.x = saved.x; c.y = saved.y; }
      try { if (node.type === 'FRAME' && node.constraints && saved.cons) c.constraints = node.constraints; } catch (e) {}
    }
    ok = sameSnapshot(before, snapshot(top, node.id));
  } catch (e) { ok = false; }

  if (!ok) {
    try {
      node.insertChild(0, c);
      if (!(node.type === 'FRAME' && node.layoutMode !== 'NONE')) { c.x = saved.x; c.y = saved.y; }
      for (const [k, v] of [['layoutGrow', saved.grow], ['layoutAlign', saved.align], ['layoutSizingHorizontal', saved.sh], ['layoutSizingVertical', saved.sv], ['constraints', saved.cons]]) {
        if (v !== undefined) { try { c[k] = v; } catch (e) {} }
      }
    } catch (e) {}
    node.visible = wasVisible;
    return { ok: false, reason: 'геометрия изменилась — изменение отменено' };
  }
  node.remove();
  return { ok: true };
}

// ---------- Токены ----------
const isMixed = (v) => v === figma.mixed;
const hasVisible = (arr) => Array.isArray(arr) && arr.some((p) => p.visible !== false);

function paintsUnbound(paints) {
  // Градиенты/картинки токеном не покрываются — проверяем только SOLID.
  return paints.filter((p) => p.visible !== false && p.type === 'SOLID' && !(p.boundVariables && p.boundVariables.color));
}

// ----- Загрузка токенов дизайн-системы (переменные) -----
let tokenCache = null;

// ---------- Токены ----------
const TOK_TTL = 12 * 3600 * 1000; // библиотечные токены хранятся между запусками, «Обновить токены» сбрасывает
let tokenForce = false;
const tokenKeyById = new Map(); // id → key: у токенов из кэша id может быть неактуальным, тогда переменную импортируем по ключу

async function resolveValue(v, getVar, getCol) {
  getVar = getVar || ((id) => figma.variables.getVariableByIdAsync(id));
  getCol = getCol || ((id) => figma.variables.getVariableCollectionByIdAsync(id));
  const modeOf = async (x) => {
    try { const col = await getCol(x.variableCollectionId); if (col) return col.defaultModeId; } catch (e) {}
    return Object.keys(x.valuesByMode)[0];
  };
  let cur = v;
  let val = cur.valuesByMode[await modeOf(cur)];
  for (let n = 0; n < 10 && val && typeof val === 'object' && val.type === 'VARIABLE_ALIAS'; n++) {
    cur = await getVar(val.id);
    if (!cur) return null;
    val = cur.valuesByMode[await modeOf(cur)];
  }
  return val;
}

// Превращает переменные в записи токенов. Запросы к коллекциям и переменным запоминаются: один запрос коллекции стоит ~30 мс.
async function buildTokenEntries(vars, extraById) {
  const colMemo = new Map(), varMemo = new Map();
  vars.forEach((v) => varMemo.set(v.id, Promise.resolve(v)));
  if (extraById) extraById.forEach((v, id) => varMemo.set(id, Promise.resolve(v)));
  const getCol = (id) => { if (!colMemo.has(id)) colMemo.set(id, figma.variables.getVariableCollectionByIdAsync(id).catch(() => null)); return colMemo.get(id); };
  const getVar = (id) => { if (!varMemo.has(id)) varMemo.set(id, figma.variables.getVariableByIdAsync(id).catch(() => null)); return varMemo.get(id); };
  const list = [];
  for (const v of vars) {
    // у переменных из библиотек флаг hiddenFromPublishing приходит true, хотя они опубликованы — скрытыми считаем только локальные
    if ((v.hiddenFromPublishing && !v.remote) || (v.resolvedType !== 'COLOR' && v.resolvedType !== 'FLOAT')) continue;
    const value = await resolveValue(v, getVar, getCol);
    if (value == null || typeof value === 'object' && v.resolvedType !== 'COLOR') continue;
    const col0 = await getCol(v.variableCollectionId);
    const others = [];
    for (const mid of Object.keys(v.valuesByMode)) {
      if (col0 && mid === col0.defaultModeId) continue;
      let val = v.valuesByMode[mid];
      for (let n = 0; n < 10 && val && typeof val === 'object' && val.type === 'VARIABLE_ALIAS'; n++) {
        const t2 = await getVar(val.id);
        val = t2 ? t2.valuesByMode[Object.keys(t2.valuesByMode)[0]] : null;
      }
      if (val != null) others.push(val);
    }
    const colName = col0 ? col0.name : '';
    list.push({
      id: v.id, key: v.key, remote: !!v.remote, name: v.name, collection: colName, type: v.resolvedType, scopes: v.scopes, value, others,
      primitive: /(^|\/)(primitive|primitives|base|core|ref|palette)s?(\/|$)/i.test(colName + '/' + v.name),
    });
  }
  return list;
}

// Импорт переменных библиотек пачками: подряд — ~200 мс на переменную, параллельно — ~12 мс.
async function importLibraryVariables(cols, live) {
  const keys = [];
  for (const c of cols) {
    const lvs = await figma.teamLibrary.getVariablesInLibraryCollectionAsync(c.key);
    for (const lv of lvs) if (lv.resolvedType === 'COLOR' || lv.resolvedType === 'FLOAT') keys.push(lv.key);
  }
  const limited = keys.slice(0, 1500);
  if (keys.length > 1500) figma.notify('Загружено не больше 1500 токенов');
  const out = []; let done = 0;
  for (let i = 0; i < limited.length; i += 40) {
    if (cancelled) throw CANCEL;
    const got = await Promise.all(limited.slice(i, i + 40).map((k) => figma.variables.importVariableByKeyAsync(k).catch(() => null)));
    got.forEach((v) => { if (v) out.push(v); });
    done += got.length;
    if (!live) figma.ui.postMessage({ type: 'progress', phase: 'tokens', text: `Загружаю токены дизайн-системы… ${done} из ${limited.length}` });
  }
  return out;
}

async function loadTokens(includeLib, live, libOff) {
  const cacheKey = (includeLib ? 'lib:' + (libOff || []).slice().sort().join('|') : 'local');
  if (tokenCache && tokenCache.key === cacheKey) return tokenCache.list;
  // локальные переменные файла — всегда свежие, их мало
  const locals = await buildTokenEntries(await figma.variables.getLocalVariablesAsync());
  let libList = [];
  if (includeLib) {
    try {
      const cols = (await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync()).filter((c) => !(libOff || []).includes(c.libraryName));
      const sig = cols.map((c) => c.key).sort().join('|');
      const stored = tokenForce ? null : await figma.clientStorage.getAsync('tok-v1');
      if (stored && stored.sig === sig && Date.now() - stored.ts < TOK_TTL && Array.isArray(stored.list)) libList = stored.list;
      else {
        const vars = await importLibraryVariables(cols, live);
        libList = await buildTokenEntries(vars);
        try { await figma.clientStorage.setAsync('tok-v1', { sig, ts: Date.now(), list: libList }); } catch (e) {}
      }
      tokenForce = false;
    } catch (e) { if (e === CANCEL) throw e; figma.notify('Библиотеки недоступны: ' + e.message); }
  }
  const list = locals.concat(libList);
  tokenKeyById.clear(); list.forEach((t) => { if (t.key) tokenKeyById.set(t.id, t.key); });
  tokenCache = { key: cacheKey, list };
  if (!live) figma.notify(`Токенов загружено: ${list.length}`);
  return list;
}

const toHex = (c) => '#' + [c.r, c.g, c.b].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
const scopeOk = (t, kinds) => t.scopes.includes('ALL_SCOPES') || kinds.some((k) => t.scopes.includes(k));
const sortCands = (a, b) => a.d - b.d || (a.primitive - b.primitive) || a.name.localeCompare(b.name);

const TAG_LABEL = { scope: ' · scope переменной не подходит', mode: ' · значение в другом режиме' };
const TAG_ORDER = { '': 0, mode: 1, scope: 2 };
const colorDist = (a, b) => Math.sqrt(['r', 'g', 'b'].reduce((acc, k) => acc + Math.pow((a[k] - b[k]) * 255, 2), 0));
const isColorVal = (v) => v && typeof v === 'object' && 'r' in v;

function colorCands(ctx, color, kinds) {
  if (!ctx.tokens) return [];
  const out = [];
  for (const t of ctx.tokens) {
    if (t.type !== 'COLOR') continue;
    const okScope = scopeOk(t, kinds);
    let best = null;
    if (isColorVal(t.value)) {
      const d = colorDist(t.value, color);
      if (d <= 20) best = { d, tag: okScope ? '' : 'scope', val: t.value };
    }
    if (!best || best.tag === 'scope') {
      for (const ov of t.others || []) {
        if (!isColorVal(ov)) continue;
        const d = colorDist(ov, color);
        if (d <= 20 && (!best || d < best.d)) { best = { d, tag: okScope ? 'mode' : 'scope', val: ov }; }
      }
    }
    if (best) out.push({ id: t.id, name: t.name, collection: t.collection, label: toHex(best.val) + (TAG_LABEL[best.tag] || ''), exact: best.tag === '' && best.d <= 1.5, d: best.d, tag: best.tag, primitive: t.primitive });
  }
  return out.sort((a, b) => TAG_ORDER[a.tag] - TAG_ORDER[b.tag] || sortCands(a, b)).slice(0, 5);
}
function floatCands(ctx, num, kinds) {
  if (!ctx.tokens) return [];
  const tol = Number(ctx.s.spacingTolerance) || 2;
  const out = [];
  for (const t of ctx.tokens) {
    if (t.type !== 'FLOAT' || typeof t.value !== 'number') continue;
    const d = Math.abs(t.value - num);
    if (d > tol) continue;
    const tag = scopeOk(t, kinds) ? '' : 'scope';
    out.push({ id: t.id, name: t.name, collection: t.collection, label: t.value + 'px' + (TAG_LABEL[tag] || ''), exact: tag === '' && d === 0, d, tag, primitive: t.primitive });
  }
  return out.sort((a, b) => TAG_ORDER[a.tag] - TAG_ORDER[b.tag] || sortCands(a, b)).slice(0, 5);
}
const strip = (c) => c.map(({ d, primitive, tag, ...rest }) => rest);

function fixColor(ctx, prop, label, paints, kinds, group) {
  const p = paintsUnbound(paints)[0];
  const hex = toHex(p.color);
  return { prop, label: `${label} ${hex}`, value: hex, color: p.color, group: `${group}:${hex}`, cands: strip(colorCands(ctx, p.color, kinds)) };
}
// Кандидаты и ближайшие токены считаются один раз на значение: у тысяч слоёв они одинаковые.
function floatInfo(ctx, num, kinds) {
  const key = num + '|' + kinds.join();
  ctx.fmemo = ctx.fmemo || new Map();
  if (!ctx.fmemo.has(key)) {
    const cands = strip(floatCands(ctx, num, kinds));
    ctx.fmemo.set(key, { cands, near: cands.length ? [] : nearFloat(ctx, num, kinds) });
  }
  return ctx.fmemo.get(key);
}
// Ближайшие токены снизу и сверху, когда в допуске ничего нет: только подсказка, привязать их кнопкой нельзя.
function nearFloat(ctx, num, kinds) {
  if (!ctx.tokens) return [];
  let below = null, above = null;
  for (const t of ctx.tokens) {
    if (t.type !== 'FLOAT' || typeof t.value !== 'number' || !scopeOk(t, kinds)) continue;
    if (t.value < num) { if (!below || t.value > below.value || (t.value === below.value && t.primitive < below.primitive)) below = t; }
    else if (t.value > num) { if (!above || t.value < above.value || (t.value === above.value && t.primitive < above.primitive)) above = t; }
  }
  return [below, above].filter(Boolean).map((t) => ({ name: t.name, label: t.value + 'px', diff: Math.round((t.value - num) * 100) / 100 }));
}
function fixNum(ctx, prop, label, num, kinds, group) {
  const info = floatInfo(ctx, num, kinds);
  return { prop, label: `${label} ${num}px`, value: num, group: `${group}:${num}`, cands: info.cands, near: info.near };
}

const FILL_KINDS = ['ALL_FILLS', 'FRAME_FILL', 'SHAPE_FILL'];
const TEXT_KINDS = ['ALL_FILLS', 'TEXT_FILL'];

// Фигма сама рисует фиолетовую обводку #8A38F5 у компонентов и наборов вариантов — это не дизайн.
const FIGMA_COMPONENT_STROKE = { r: 0x8a / 255, g: 0x38 / 255, b: 0xf5 / 255 };
function isFigmaComponentStroke(node, p) {
  return (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') && p.type === 'SOLID'
    && Math.abs(p.color.r - FIGMA_COMPONENT_STROKE.r) + Math.abs(p.color.g - FIGMA_COMPONENT_STROKE.g) + Math.abs(p.color.b - FIGMA_COMPONENT_STROKE.b) < 0.02;
}

function checkTokens(node, ctx) {
  const t = ctx.s.tokenChecks;

  // Fills
  if (t.fills && 'fills' in node) {
    if (node.type === 'TEXT') {
      if (isMixed(node.fills)) {
        const segs = node.getStyledTextSegments(['fills', 'fillStyleId']);
        if (segs.some((g) => !g.fillStyleId && paintsUnbound(g.fills).length)) add(ctx, node, 'error', 'token/fill', 'Цвет текста без стиля/переменной (часть диапазонов)');
      } else if (!node.fillStyleId && paintsUnbound(node.fills).length) {
        add(ctx, node, 'error', 'token/fill', 'Цвет текста не привязан к стилю или переменной', null, [fixColor(ctx, 'fills', 'Цвет текста', node.fills, TEXT_KINDS, 'textfill')]);
      }
    } else if (!isMixed(node.fills) && !node.fillStyleId && paintsUnbound(node.fills).length) {
      add(ctx, node, 'error', 'token/fill', 'Заливка не привязана к стилю или переменной', null, [fixColor(ctx, 'fills', 'Заливка', node.fills, FILL_KINDS, 'fill')]);
    }
  }

  // Strokes
  if (t.strokes && 'strokes' in node && !isMixed(node.strokes) && !node.strokeStyleId) {
    const strokes = node.strokes.filter((p) => !isFigmaComponentStroke(node, p));
    if (paintsUnbound(strokes).length) {
      add(ctx, node, 'error', 'token/stroke', 'Обводка не привязана к стилю или переменной', null, [fixColor(ctx, 'strokes', 'Обводка', strokes, ['STROKE_COLOR'], 'stroke')]);
    }
  }

  // Text style
  if (t.text && node.type === 'TEXT') {
    const bv = node.boundVariables || {};
    const hasVars = bv.fontSize || bv.fontFamily || bv.lineHeight;
    if (isMixed(node.textStyleId)) {
      const segs = node.getStyledTextSegments(['textStyleId']);
      if (segs.some((g) => !g.textStyleId)) add(ctx, node, 'error', 'token/text', 'Часть текста без текстового стиля');
    } else if (!node.textStyleId && !hasVars) {
      add(ctx, node, 'error', 'token/text', 'Нет текстового стиля');
    }
  }

  // Effects
  if (t.effects && 'effects' in node && hasVisible(node.effects) && !node.effectStyleId) {
    const bound = node.effects.every((e) => e.boundVariables && Object.keys(e.boundVariables).length);
    if (!bound) add(ctx, node, 'error', 'token/effect', 'Эффект (тень/блюр) без стиля');
  }

  // Radius
  if (t.radius && 'cornerRadius' in node) {
    const bv = node.boundVariables || {};
    const radiusBound = bv.topLeftRadius || bv.topRightRadius || bv.bottomLeftRadius || bv.bottomRightRadius;
    const r = node.cornerRadius;
    if (!radiusBound && isMixed(r)) add(ctx, node, 'warn', 'token/radius', 'Радиусы углов разные и не привязаны к переменным');
    else if (!radiusBound && r > 0) add(ctx, node, 'warn', 'token/radius', 'Радиус скругления не привязан к переменной', null, [fixNum(ctx, 'radius', 'Радиус', r, ['CORNER_RADIUS'], 'radius')]);
  }

  // Spacing: gap и padding у auto-layout
  if (t.spacing && 'layoutMode' in node && node.layoutMode !== 'NONE') {
    const bv = node.boundVariables || {};
    const fixes = [];
    const need = (val, key, label) => { if (val > 0 && !bv[key]) fixes.push(fixNum(ctx, key, label, val, ['GAP'], 'space')); };
    // gap «Auto» = SPACE_BETWEEN: itemSpacing хранит старое значение, но не используется
    if (node.layoutMode === 'GRID') {
      // в grid gap лежит в gridRowGap/gridColumnGap, а itemSpacing — остаток от прошлой раскладки
      need(node.gridRowGap, 'gridRowGap', 'gap (rows)');
      need(node.gridColumnGap, 'gridColumnGap', 'gap (columns)');
    } else {
      if (node.primaryAxisAlignItems !== 'SPACE_BETWEEN') need(node.itemSpacing, 'itemSpacing', 'gap');
      if (node.layoutWrap === 'WRAP' && node.counterAxisAlignContent !== 'SPACE_BETWEEN') need(node.counterAxisSpacing, 'counterAxisSpacing', 'gap (cross)');
    }
    need(node.paddingLeft, 'paddingLeft', 'padding-left');
    need(node.paddingRight, 'paddingRight', 'padding-right');
    need(node.paddingTop, 'paddingTop', 'padding-top');
    need(node.paddingBottom, 'paddingBottom', 'padding-bottom');
    if (fixes.length) add(ctx, node, 'error', 'token/spacing', `Отступы без переменных: ${fixes.map((f) => f.label).join(', ')}`, null, fixes);
  }
}

// ----- Применение токенов -----
const closeColor = (a, b) => Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b) < 0.01;

async function bindTokens(items) {
  const done = [];
  const reasons = new Map(); // причина → сколько раз
  const fail = (why) => reasons.set(why, (reasons.get(why) || 0) + 1);
  for (const it of items) {
    try {
      const node = await figma.getNodeByIdAsync(it.id);
      let v = await figma.variables.getVariableByIdAsync(it.varId).catch(() => null);
      if (!v && tokenKeyById.get(it.varId)) { try { v = await figma.variables.importVariableByKeyAsync(tokenKeyById.get(it.varId)); } catch (e) {} }
      if (!node || node.removed) { fail('слой удалён'); continue; }
      if (!v) { fail('переменная не найдена (обнови токены)'); continue; }
      if (it.prop === 'fills' || it.prop === 'strokes') {
        const paints = node[it.prop];
        if (isMixed(paints)) { fail('у слоя разные заливки/обводки'); continue; }
        node[it.prop] = paints.map((p) =>
          p.type === 'SOLID' && p.visible !== false && !(p.boundVariables && p.boundVariables.color) && closeColor(p.color, it.color)
            ? figma.variables.setBoundVariableForPaint(p, 'color', v) : p);
      } else if (it.prop === 'radius') {
        for (const k of ['topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius']) node.setBoundVariable(k, v);
      } else {
        node.setBoundVariable(it.prop, v);
      }
      done.push({ id: it.id, prop: it.prop });
    } catch (e) { fail(String((e && e.message) || e).slice(0, 80)); }
  }
  const failed = [...reasons.values()].reduce((a, n) => a + n, 0);
  const why = [...reasons].sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r}: ${n}`).join('; ');
  return { done, failed, why };
}


// ---------- Чистка: скрытые, пустые, дубли ----------
function inComponent(node) {
  if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') return true;
  for (let a = node.parent; a && a.type !== 'PAGE'; a = a.parent) if (a.type === 'COMPONENT' || a.type === 'COMPONENT_SET') return true;
  return false;
}
function markRemovable(ctx) { ctx.issues[ctx.issues.length - 1].removable = true; }

function checkCleanup(node, ctx) {
  const isRootNode = !node.parent || node.parent.type === 'PAGE';
  if (node.visible === false && !isRootNode) {
    const refs = node.componentPropertyReferences;
    if (inComponent(node) || (refs && refs.visible)) {
      add(ctx, node, 'info', 'cleanup/hidden', 'Скрытый слой внутри компонента (может управляться свойством) — массово не удаляю');
      ctx.issues[ctx.issues.length - 1].manualRemove = true; // можно удалить вручную по одному
    } else {
      add(ctx, node, 'warn', 'cleanup/hidden', 'Скрытый слой');
      markRemovable(ctx);
    }
    return;
  }

  // Пустые контейнеры без видимого оформления
  if ((node.type === 'FRAME' || node.type === 'GROUP') && node.children.length === 0 && !inComponent(node)) {
    const plain = node.type === 'GROUP' || (!isMixed(node.fills) && !hasVisible(node.fills) && !hasVisible(node.strokes) && !hasVisible(node.effects));
    if (plain) {
      const spacer = node.parent && 'layoutMode' in node.parent && node.parent.layoutMode !== 'NONE';
      add(ctx, node, spacer ? 'info' : 'warn', 'cleanup/empty', spacer ? 'Пустой контейнер в auto-layout (возможно, распорка) — не удаляю автоматически' : 'Пустой контейнер без оформления');
      if (!spacer) markRemovable(ctx);
      else ctx.issues[ctx.issues.length - 1].manualRemove = true; // распорку решает удалить человек
    }
  }

  // Дубли: одинаковые листовые слои друг на друге
  if ('children' in node && node.type !== 'INSTANCE' && node.children.length > 1 && !(('layoutMode' in node) && node.layoutMode !== 'NONE')) {
    const seen = new Map();
    for (const c of node.children) {
      if ('children' in c || !('width' in c)) continue;
      let key;
      try {
        key = JSON.stringify([c.type, Math.round(c.x * 100), Math.round(c.y * 100), Math.round(c.width * 100), Math.round(c.height * 100),
          isMixed(c.fills) ? 'm' : c.fills, 'strokes' in c && !isMixed(c.strokes) ? c.strokes : 'm', c.type === 'TEXT' ? c.characters : '', c.visible, c.opacity]);
      } catch (e) { continue; }
      if (seen.has(key)) {
        add(ctx, c, 'warn', 'cleanup/duplicate', `Дубль слоя «${seen.get(key).name}» (лежит поверх с теми же параметрами)`);
        markRemovable(ctx);
      } else seen.set(key, c);
    }
  }
}

// ---------- Подготовка к хендоффу ----------
function checkHandoff(node, ctx) {
  if (node.type !== 'TEXT') return;
  if (node.hasMissingFont) add(ctx, node, 'error', 'handoff/font', 'У текста отсутствует шрифт (в файле он не доступен)');
  else if (node.characters.trim() === '') {
    add(ctx, node, 'warn', 'handoff/emptytext', 'Пустой текстовый слой');
    markRemovable(ctx);
  }
}

// ---------- Аннотации на холсте ----------
const FL = '[FL] ';
async function annotateIssues(items) {
  const byId = new Map();
  for (const it of items.slice(0, 300)) { if (!it.id) continue; (byId.get(it.id) || byId.set(it.id, []).get(it.id)).push(it.message); }
  let n = 0;
  for (const [id, msgs] of byId) {
    try {
      const node = await figma.getNodeByIdAsync(id);
      if (!node || node.removed || !('annotations' in node)) continue;
      const keep = node.annotations.filter((a) => !(a.label || '').startsWith(FL));
      node.annotations = keep.concat([{ label: FL + msgs.join(' • ') }]);
      n++;
    } catch (e) {}
  }
  quiet();
  return n;
}
async function clearAnnotations() {
  let roots = [];
  if (lastRun && lastRun.rootIds) { for (const id of lastRun.rootIds) { const r = await figma.getNodeByIdAsync(id); if (r) roots.push(r); } }
  if (!roots.length) roots = figma.currentPage.children.slice();
  let n = 0;
  const clean = (node) => {
    if ('annotations' in node && node.annotations.some((a) => (a.label || '').startsWith(FL))) {
      try { node.annotations = node.annotations.filter((a) => !(a.label || '').startsWith(FL)); n++; } catch (e) {}
    }
  };
  for (const r of roots) { clean(r); if ('findAll' in r) r.findAll((x) => { clean(x); return false; }); }
  quiet();
  return n;
}

// ---------- Подсветка отступов без токенов ----------
const HL_NAME = '[FL] Подсветка отступов';
async function clearHighlight() {
  let n = 0;
  for (const page of figma.root.children) {
    for (const c of page.children) if (c.name === HL_NAME) { try { c.remove(); n++; } catch (e) {} }
  }
  quiet();
  return n;
}
// items: [{ id, props: ['paddingLeft', 'itemSpacing', ...] }]
async function highlightSpacing(items) {
  await clearHighlight();
  const zones = [];
  const zone = (x, y, w, h) => { if (w > 0 && h > 0) zones.push({ x, y, w, h }); };
  for (const it of items.slice(0, 300)) {
    const node = await figma.getNodeByIdAsync(it.id);
    if (!node || node.removed || node.type === 'PAGE' || node.type === 'DOCUMENT' || !node.absoluteBoundingBox) continue;
    const b = node.absoluteBoundingBox, props = new Set(it.props || []);
    if (props.has('paddingLeft')) zone(b.x, b.y, node.paddingLeft, b.height);
    if (props.has('paddingRight')) zone(b.x + b.width - node.paddingRight, b.y, node.paddingRight, b.height);
    if (props.has('paddingTop')) zone(b.x, b.y, b.width, node.paddingTop);
    if (props.has('paddingBottom')) zone(b.x, b.y + b.height - node.paddingBottom, b.width, node.paddingBottom);
    // gap между соседями; при SPACE_BETWEEN расстояние считает сам Figma — пропускаем
    if (props.has('itemSpacing') && node.layoutMode !== 'GRID' && node.primaryAxisAlignItems !== 'SPACE_BETWEEN' && 'children' in node) {
      const kids = node.children.filter((c) => c.visible !== false && c.layoutPositioning !== 'ABSOLUTE' && c.absoluteBoundingBox);
      for (let i = 0; i < kids.length - 1; i++) {
        const a = kids[i].absoluteBoundingBox, c = kids[i + 1].absoluteBoundingBox;
        if (node.layoutMode === 'HORIZONTAL') zone(a.x + a.width, b.y, c.x - (a.x + a.width), b.height);
        else zone(b.x, a.y + a.height, b.width, c.y - (a.y + a.height));
      }
    }
  }
  if (!zones.length) return 0;
  const root = figma.createFrame();
  root.name = HL_NAME; root.fills = []; root.clipsContent = false; root.resize(1, 1);
  root.x = 0; root.y = 0;
  for (const z of zones) {
    const r = figma.createRectangle();
    r.name = 'gap/padding';
    r.fills = [{ type: 'SOLID', color: { r: 1, g: 0.1, b: 0.2 }, opacity: 0.35 }];
    r.strokes = [{ type: 'SOLID', color: { r: 1, g: 0.1, b: 0.2 } }]; r.strokeWeight = 1;
    root.appendChild(r);
    r.x = z.x; r.y = z.y; r.resize(Math.max(z.w, 0.01), Math.max(z.h, 0.01));
  }
  root.locked = true;
  quiet();
  return zones.length;
}

// ---------- Отчёт на холст ----------
async function reportToCanvas(text) {
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  const t = figma.createText();
  t.fontName = { family: 'Inter', style: 'Regular' };
  t.fontSize = 14;
  t.characters = text;
  t.name = 'Frame Linter — отчёт';
  const kids = figma.currentPage.children.filter((c) => c !== t);
  const right = kids.length ? Math.max(...kids.map((c) => c.x + c.width)) : 0;
  t.x = right + 80;
  t.y = kids.length ? Math.min(...kids.map((c) => c.y)) : 0;
  figma.currentPage.selection = [t];
  figma.viewport.scrollAndZoomIntoView([t]);
  quiet();
  figma.notify('Отчёт размещён на холсте');
}

// ---------- Замена компонентов ----------
async function findTargetComponent(spec, localIndex) {
  if (spec.startsWith('key:')) {
    const key = spec.slice(4).trim();
    try { return await figma.importComponentByKeyAsync(key); } catch (e) {}
    try { const set = await figma.importComponentSetByKeyAsync(key); return set.defaultVariant; } catch (e) {}
    return null;
  }
  const hit = localIndex.get(spec);
  if (!hit) return null;
  return hit.type === 'COMPONENT_SET' ? hit.defaultVariant : hit;
}

async function swapComponents(rules, dry) {
  let roots = [];
  if (lastRun && lastRun.rootIds && lastRun.s.scope === 'selection') { for (const id of lastRun.rootIds) { const r = await figma.getNodeByIdAsync(id); if (r) roots.push(r); } }
  if (!roots.length) roots = figma.currentPage.selection.length ? figma.currentPage.selection.slice() : figma.currentPage.children.slice();

  await figma.loadAllPagesAsync();
  const localIndex = new Map();
  for (const c of figma.root.findAllWithCriteria({ types: ['COMPONENT', 'COMPONENT_SET'] })) {
    if (c.type === 'COMPONENT' && c.parent && c.parent.type === 'COMPONENT_SET') continue;
    if (!localIndex.has(c.name)) localIndex.set(c.name, c);
  }

  const instances = [];
  for (const r of roots) {
    if (r.type === 'INSTANCE') instances.push(r);
    if ('findAllWithCriteria' in r) instances.push(...r.findAllWithCriteria({ types: ['INSTANCE'] }));
  }

  const rows = rules.map((r) => ({ from: r[0], to: r[1], found: 0, done: 0, target: null, error: '' }));
  const plan = rows.map(() => []);
  for (const inst of instances) {
    let main = null;
    try { main = await inst.getMainComponentAsync(); } catch (e) {}
    if (!main) continue;
    const full = main.name;
    const setName = main.parent && main.parent.type === 'COMPONENT_SET' ? main.parent.name : null;
    rows.forEach((row, i) => { if (row.from === full || row.from === setName) plan[i].push(inst); });
  }
  if (!dry) await checkpoint('замена компонентов', instances.length);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    row.found = plan[i].length;
    const target = await findTargetComponent(row.to, localIndex);
    row.target = target ? target.name : null;
    if (!target) { row.error = 'Новый компонент не найден (ищу локальные по имени или key:КЛЮЧ)'; continue; }
    if (dry) continue;
    for (const inst of plan[i]) {
      try {
        const oldProps = inst.componentProperties;
        inst.swapComponent(target);
        for (const k in oldProps) {
          if (oldProps[k].type !== 'VARIANT') continue;
          try { inst.setProperties({ [k]: oldProps[k].value }); } catch (e) {}
        }
        row.done++;
      } catch (e) { row.error = String(e.message || e); }
    }
  }
  quiet();
  return rows.map(({ from, to, found, done, target, error }) => ({ from, to, found, done, target, error }));
}

// ---------- Размножение фрейма по данным ----------
function parseTable(text) {
  text = text.trim();
  if (!text) return [];
  if (text[0] === '[') {
    const arr = JSON.parse(text);
    return arr.map((o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.trim(), v == null ? '' : String(v)])));
  }
  const first = text.split('\n')[0];
  const delim = first.includes('\t') ? '\t' : first.includes(';') && !first.includes(',') ? ';' : ',';
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  row.push(cur); rows.push(row);
  const head = rows[0].map((h) => h.trim());
  return rows.slice(1).filter((r) => r.some((c) => c.trim())).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
}

async function setTextValue(t, value) {
  const fonts = t.fontName === figma.mixed ? t.getStyledTextSegments(['fontName']).map((x) => x.fontName) : [t.fontName];
  for (const f of fonts) await figma.loadFontAsync(f);
  t.characters = String(value);
}

async function multiplyFrame(data, gap) {
  const tpl = figma.currentPage.selection[0];
  if (!tpl || !('clone' in tpl) || !('findAll' in tpl)) return 'Выдели один шаблонный фрейм (внутри текстовые слои с именами вида #title, #price)';
  let rows;
  try { rows = parseTable(data); } catch (e) { return 'Не удалось разобрать данные: ' + e.message; }
  if (!rows.length) return 'Нет строк данных: нужна шапка и хотя бы одна строка (CSV/TSV) либо JSON-массив';
  rows = rows.slice(0, 200);
  await checkpoint('размножение по данным', rows.length);

  const parentAuto = tpl.parent && 'layoutMode' in tpl.parent && tpl.parent.layoutMode !== 'NONE';
  const clones = [];
  const unmatched = new Set(Object.keys(rows[0]));
  let filled = 0;
  for (let i = 0; i < rows.length; i++) {
    const c = tpl.clone();
    const keys = Object.keys(rows[i]);
    c.name = `${tpl.name} — ${rows[i][keys[0]] || i + 1}`;
    if (!parentAuto) { c.x = tpl.x + (i + 1) * (tpl.width + gap); c.y = tpl.y; }
    const texts = c.findAll((n) => n.type === 'TEXT' && n.name.startsWith('#'));
    for (const t of texts) {
      const key = keys.find((k) => k.toLowerCase() === t.name.slice(1).trim().toLowerCase());
      if (key === undefined) continue;
      unmatched.delete(key);
      try { await setTextValue(t, rows[i][key]); filled++; } catch (e) {}
    }
    clones.push(c);
  }
  figma.currentPage.selection = clones;
  figma.viewport.scrollAndZoomIntoView(clones);
  quiet();
  const msgParts = [`Создано копий: ${clones.length}, подставлено значений: ${filled}`];
  if (unmatched.size) msgParts.push(`Для колонок нет текстовых слоёв #имя: ${[...unmatched].join(', ')}`);
  const msg = msgParts.join('. ');
  notifyUndo(msg);
  return msg;
}

// Предпросмотр размножения: сколько копий получится и какие поля совпали с колонками.
function multiplyPreview(data) {
  const tpl = figma.currentPage.selection[0];
  if (!tpl || !('clone' in tpl) || !('findAll' in tpl)) return { ok: false, level: 'warn', text: 'Выдели один шаблонный фрейм' };
  if (!String(data).trim()) return { ok: false, level: 'info', text: 'Вставь данные — покажу, сколько копий получится' };
  let rows;
  try { rows = parseTable(data); } catch (e) { return { ok: false, level: 'error', text: 'Не удалось разобрать данные: ' + e.message }; }
  if (!rows.length) return { ok: false, level: 'warn', text: 'Нужна шапка и хотя бы одна строка данных' };
  const fields = [...new Set(tpl.findAll((n) => n.type === 'TEXT' && n.name.startsWith('#')).map((t) => t.name.slice(1).trim().toLowerCase()))];
  const cols = Object.keys(rows[0]);
  const low = cols.map((c) => c.toLowerCase());
  const missing = fields.filter((f) => !low.includes(f));
  const unused = cols.filter((c) => !fields.includes(c.toLowerCase()));
  const parts = [`Будет копий: ${Math.min(rows.length, 200)}${rows.length > 200 ? ` (из ${rows.length}, лимит 200)` : ''}`];
  parts.push(fields.length ? `Полей в шаблоне: ${fields.map((f) => '#' + f).join(', ')}` : 'В шаблоне нет текстовых слоёв с именами вида #title — копии будут без подстановки');
  if (missing.length) parts.push(`Нет колонки для: ${missing.map((f) => '#' + f).join(', ')}`);
  if (unused.length) parts.push(`Колонки без слоя: ${unused.join(', ')}`);
  const level = !fields.length || missing.length || unused.length ? 'warn' : 'ok';
  return { ok: true, level, text: parts.join('. ') };
}

// ---------- Навигация по ряду ----------
// Выделенные фреймы группируются в ряды (по вертикали). Слева от ряда создаётся блок «Ряд» + «Навигация»
// со ссылками на каждый фрейм, а над каждым фреймом — кнопка возврата к навигации ряда.
const NAV_NS = 'framelinter';
const NAV_TYPES = ['FRAME', 'COMPONENT', 'COMPONENT_SET', 'SECTION'];
const isNavNode = (n) => { try { return !!n.getSharedPluginData(NAV_NS, 'nav'); } catch (e) { return false; } };
const navRowOf = (n) => { try { return n.getSharedPluginData(NAV_NS, 'navRow'); } catch (e) { return ''; } };

// Геометрия в координатах страницы: фреймы могут лежать внутри секций.
const bb = (n) => n.absoluteBoundingBox || { x: n.x, y: n.y, width: n.width, height: n.height };
// Узлы, среди которых ищем фреймы рядов: верхний уровень страницы и содержимое секций.
function navTopNodes() {
  const out = [];
  for (const c of figma.currentPage.children) { out.push(c); if (c.type === 'SECTION') out.push(...c.children); }
  return out;
}
// Готовый вручную блок навигации (фрейм с LinkCard внутри) не считаем «фреймом ряда».
const looksLikeNavBlock = (n) => n.type === 'FRAME' && n.children.some((c) => c.name === 'LinkCard');
const navFrameKids = (sec) => sec.children.filter((c) => NAV_TYPES.includes(c.type) && !isNavNode(c) && !looksLikeNavBlock(c));

function navCollect() {
  const frames = [];
  let skipped = 0;
  const inPlace = (n) => n.parent === figma.currentPage || (n.parent && n.parent.type === 'SECTION' && n.parent.parent === figma.currentPage);
  for (const n of figma.currentPage.selection) {
    if (isNavNode(n) || looksLikeNavBlock(n)) continue;
    // выделена секция с фреймами внутри — берём её фреймы
    if (n.type === 'SECTION' && navFrameKids(n).length) { frames.push(...navFrameKids(n)); continue; }
    if (NAV_TYPES.includes(n.type) && inPlace(n)) frames.push(n); else skipped++;
  }
  return { frames: [...new Set(frames)], skipped };
}

// Фрейм попадает в ряд, если его вертикальный центр лежит в диапазоне ряда.
function navRows(frames) {
  const rows = [];
  for (const f of frames.slice().sort((a, b) => bb(a).y - bb(b).y || bb(a).x - bb(b).x)) {
    const g = bb(f), cy = g.y + g.height / 2;
    const row = rows.find((r) => cy >= r.top && cy <= r.bottom);
    if (row) { row.items.push(f); row.top = Math.min(row.top, g.y); row.bottom = Math.max(row.bottom, g.y + g.height); }
    else rows.push({ items: [f], top: g.y, bottom: g.y + g.height });
  }
  rows.forEach((r) => r.items.sort((a, b) => bb(a).x - bb(b).x || bb(a).y - bb(b).y));
  return rows.sort((a, b) => a.top - b.top);
}

function navRowName(items, idx, total, custom) {
  if (custom) return total > 1 ? `${custom} ${idx + 1}` : custom;
  const firsts = items.map((f) => f.name.split('/')[0].trim());
  if (items.length > 1 && items.some((f) => f.name.includes('/')) && firsts.every((x) => x === firsts[0])) return firsts[0];
  return `Ряд ${idx + 1}`;
}

function navRemoveRows(rowIds, all) {
  let removed = 0;
  for (const c of navTopNodes()) {
    const r = isNavNode(c) ? c.getSharedPluginData(NAV_NS, 'nav') : '';
    if (r && (all || rowIds.has(r))) { c.remove(); removed++; }
  }
  for (const c of navTopNodes()) if (navRowOf(c) && (all || rowIds.has(navRowOf(c)))) c.setSharedPluginData(NAV_NS, 'navRow', '');
  return removed;
}

function navPreview() {
  const { frames } = navCollect();
  return { ok: frames.length > 0, level: 'info', text: '' };
}

// Компоненты навигации: по умолчанию пусто, ключи/имена/ссылки задаёт пользователь («Из выделения»).
const NAV_DEFAULTS = {
  descKey: '', // DescriptionCard — название ряда
  linkCardKey: '', // LinkCard — блок «Навигация» со слотом ссылок
  linkKey: '', // ButtonLink — запасной, если в слоте нет ссылок
  btnKey: '', // Button — кнопка «Вернуться к навигации» над фреймом
  arrow16: '', // 16/ArrowLeft
  arrow20: '', // 20/ArrowLeft
  arrow24: '', // 24/ArrowLeft — для large-кнопки
};
const NAV_COL_GAP = 280; // между блоком навигации и первым фреймом ряда
const NAV_CARD_GAP = 40; // между DescriptionCard и LinkCard
const NAV_BTN_GAP = 37; // между кнопкой и фреймом

// Почему ключ не импортировался (текст ошибки Figma) — показываем в сообщении «Не найден компонент».
const navWhy = {};
// Компонент по ключу (библиотека) либо локальный по ключу/имени.
async function navComponent(spec, cache, localAll) {
  spec = String(spec || '').trim().replace(/^key:/, '');
  if (!spec) return null;
  if (cache[spec]) return cache[spec];
  let c = null;
  // Ссылка Figma на компонент или его инстанс из ЭТОГО файла (узел из чужого файла плагин по ссылке не откроет — для него нужен ключ или «Из выделения»).
  const link = /figma\.com\/(?:design|file)\/[^/?#]+[^?#]*\?[^#]*node-id=([0-9]+)[-:]([0-9]+)/i.exec(spec);
  if (link) {
    try {
      let n = await figma.getNodeByIdAsync(`${link[1]}:${link[2]}`);
      if (n && n.type === 'INSTANCE') n = await n.getMainComponentAsync();
      if (n && n.type === 'COMPONENT_SET') n = n.defaultVariant;
      if (n && n.type === 'COMPONENT') c = n;
    } catch (e) {}
    if (c) cache[spec] = c;
    return c;
  }
  if (/^[0-9a-f]{40}$/i.test(spec)) {
    try { c = await figma.importComponentByKeyAsync(spec); } catch (e) { navWhy[spec] = (e && e.message) || String(e); }
    if (!c) { try { c = (await figma.importComponentSetByKeyAsync(spec)).defaultVariant; } catch (e) {} }
  }
  if (!c) {
    const all = await localAll();
    c = all.find((x) => x.key === spec) || all.find((x) => x.name === spec) || null;
    if (c && c.type === 'COMPONENT_SET') c = c.defaultVariant;
  }
  if (c) cache[spec] = c;
  return c;
}

async function navLoadFonts(textNode) {
  const fonts = textNode.fontName === figma.mixed ? textNode.getStyledTextSegments(['fontName']).map((x) => x.fontName) : [textNode.fontName];
  for (const f of fonts) await figma.loadFontAsync(f);
}

// Текст в инстансе: через текстовое свойство компонента, а если его нет — прямо в слое.
async function navSetText(inst, textNode, value) {
  if (textNode) await navLoadFonts(textNode);
  const props = inst.componentProperties || {};
  const key = Object.keys(props).find((k) => props[k].type === 'TEXT');
  if (key) inst.setProperties({ [key]: value });
  else if (textNode) textNode.characters = value;
}

// Клик в прототипе: заготовленный у вас ON_CLICK без цели получает цель, остальные связи (hover) остаются.
async function navSetClick(node, destId) {
  try {
    const keep = (node.reactions || [])
      .filter((r) => !(r.trigger && r.trigger.type === 'ON_CLICK'))
      .map((r) => ({ trigger: r.trigger, actions: r.actions || (r.action ? [r.action] : []) }));
    keep.push({ trigger: { type: 'ON_CLICK' }, actions: [{ type: 'NODE', destinationId: destId, navigation: 'NAVIGATE', transition: null, preserveScrollPosition: false }] });
    await node.setReactionsAsync(keep);
    return true;
  } catch (e) { return false; }
}

// Гиперссылка на слой — якорь, который работает прямо на холсте.
function navSetHyperlink(textNode, destId) {
  try { textNode.setRangeHyperlink(0, textNode.characters.length, { type: 'NODE', value: destId }); return true; } catch (e) { return false; }
}

// Кнопка «назад»: слева ArrowLeft нужного размера, правая иконка выключена.
async function navSetBackIcons(btn, cfg, cache, localAll, warns) {
  const props = btn.componentProperties;
  const next = {};
  for (const k of Object.keys(props)) {
    if (k.startsWith('hasIconBefore')) next[k] = true;
    else if (k.startsWith('hasIconAfter')) next[k] = false;
    else if (props[k].type === 'INSTANCE_SWAP' && k.startsWith('VALiconBefore')) {
      const c = await navComponent(/Large/.test(k) ? cfg.arrow24 : /Small/.test(k) ? cfg.arrow16 : cfg.arrow20, cache, localAll);
      if (c) next[k] = c.id; else warns.add('не найдена иконка ArrowLeft (проверь, что библиотека иконок подключена)');
    }
  }
  try { btn.setProperties(next); } catch (e) { warns.add('не удалось поменять иконки кнопки: ' + ((e && e.message) || e)); }
}

// ---------- «Простой вид»: блок навигации из обычных фреймов и текста, если нужных компонентов в дизайн-системе нет ----------
const SIMPLE_C = { ink: { r: 0.17, g: 0.176, b: 0.18 }, link: { r: 0, g: 0.373, b: 0.976 }, line: { r: 0.9, g: 0.906, b: 0.922 }, white: { r: 1, g: 1, b: 1 } };
const simplePaint = (c) => [{ type: 'SOLID', color: c }];
async function simpleLoadFonts() {
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Medium' });
}
function simpleText(str, size, medium, color, underline) {
  const t = figma.createText();
  t.fontName = { family: 'Inter', style: medium ? 'Medium' : 'Regular' };
  t.fontSize = size; t.characters = str; t.fills = simplePaint(color);
  if (underline) t.textDecoration = 'UNDERLINE';
  return t;
}
// Заголовок ряда: помечен как часть навигации, поэтому при пересборке текст сохраняется так же, как у компонента
function simpleDesc() {
  const f = figma.createFrame();
  f.name = 'Заголовок ряда'; f.fills = []; f.layoutMode = 'VERTICAL';
  f.resize(320, 10); f.primaryAxisSizingMode = 'AUTO'; f.counterAxisSizingMode = 'FIXED';
  const t = simpleText('Название ряда', 24, true, SIMPLE_C.ink);
  t.name = 'Название'; f.appendChild(t);
  t.layoutSizingHorizontal = 'FILL'; t.textAutoResize = 'HEIGHT';
  f.setSharedPluginData(NAV_NS, 'navPart', 'desc');
  return f;
}
// Блок со ссылками: по одной строке на фрейм ряда
function simpleCard(n) {
  const f = figma.createFrame();
  f.name = 'Навигация'; f.layoutMode = 'VERTICAL'; f.itemSpacing = 10;
  f.paddingLeft = f.paddingRight = 20; f.paddingTop = f.paddingBottom = 16;
  f.cornerRadius = 12; f.fills = simplePaint(SIMPLE_C.white); f.strokes = simplePaint(SIMPLE_C.line); f.strokeWeight = 1;
  f.resize(320, 10); f.primaryAxisSizingMode = 'AUTO'; f.counterAxisSizingMode = 'FIXED';
  for (let i = 0; i < n; i++) {
    const l = figma.createFrame();
    l.name = 'Ссылка'; l.fills = []; l.layoutMode = 'HORIZONTAL'; l.primaryAxisSizingMode = 'AUTO'; l.counterAxisSizingMode = 'AUTO';
    l.appendChild(simpleText('Ссылка', 14, false, SIMPLE_C.link, true));
    f.appendChild(l);
  }
  return f;
}
// Кнопка возврата над фреймом
function simpleBack() {
  const f = figma.createFrame();
  f.name = 'Кнопка возврата'; f.layoutMode = 'HORIZONTAL'; f.primaryAxisSizingMode = 'AUTO'; f.counterAxisSizingMode = 'AUTO';
  f.paddingLeft = f.paddingRight = 14; f.paddingTop = f.paddingBottom = 8; f.cornerRadius = 8;
  f.fills = simplePaint(SIMPLE_C.white); f.strokes = simplePaint(SIMPLE_C.line); f.strokeWeight = 1;
  f.appendChild(simpleText('Вернуться к навигации', 14, true, SIMPLE_C.ink));
  return f;
}
const isNavDesc = (k) => (k.getSharedPluginData(NAV_NS, 'navPart') === 'desc') || (k.type === 'INSTANCE' && k.name === 'DescriptionCard');

async function navBuild(opts) {
  const { frames: picked } = navCollect();
  if (!picked.length) return { ok: false, text: 'Выдели фреймы одного ряда (на странице или внутри секции) либо саму секцию с фреймами' };
  // Если ряд уже имел навигацию, берём в пересборку и остальные его фреймы, чтобы не потерять их кнопки.
  const oldRows = new Set(picked.map(navRowOf).filter(Boolean));
  const frames = picked.slice();
  if (oldRows.size) for (const c of navTopNodes()) if (!frames.includes(c) && !isNavNode(c) && oldRows.has(navRowOf(c))) frames.push(c);

  // Компоненты находим до любых правок, чтобы не оставить файл в полусобранном виде.
  const cfg = Object.assign({}, NAV_DEFAULTS);
  for (const k in (opts.comp || {})) if (opts.comp[k] && String(opts.comp[k]).trim()) cfg[k] = String(opts.comp[k]).trim();
  const cache = {};
  let localList = null;
  const localAll = async () => {
    if (!localList) { await figma.loadAllPagesAsync(); localList = figma.root.findAllWithCriteria({ types: ['COMPONENT', 'COMPONENT_SET'] }); }
    return localList;
  };
  // Режим по умолчанию — «Простой вид» (рисует блок сам, компонентов не требует); «Мои компоненты» — только если выбран явно.
  const simple = opts.mode !== 'components';
  let descC = null, cardC = null, btnC = null;
  if (simple) await simpleLoadFonts();
  else {
    descC = await navComponent(cfg.descKey, cache, localAll);
    cardC = await navComponent(cfg.linkCardKey, cache, localAll);
    btnC = await navComponent(cfg.btnKey, cache, localAll);
  }
  const missing = simple ? [] : [[descC, 'название ряда', cfg.descKey], [cardC, 'блок «Навигация»', cfg.linkCardKey], [btnC, 'кнопка над фреймом', cfg.btnKey]].filter(([c]) => !c).map(([, n, k]) => !k ? `${n} (поле пустое)` : /^https?:/i.test(String(k).trim()) ? `${n} (в поле ссылка: узел из другого файла по ссылке не открывается — нажми «Из выделения» на инстансе компонента)` : `${n} («${String(k).slice(0, 12)}…»${navWhy[String(k).trim().replace(/^key:/, '')] ? ': ' + navWhy[String(k).trim().replace(/^key:/, '')] : ''})`);
  if (missing.length) return { ok: false, text: `Не найден компонент: ${missing.join(', ')}. Выбери «Простой вид» в настройках навигации, чтобы плагин нарисовал блок сам, или укажи ключ, имя локального компонента или ссылку на компонент из этого файла. Проще всего: выдели на холсте инстанс нужного компонента и нажми «Из выделения» у его поля (библиотека должна быть подключена к файлу)` };

  await checkpoint('навигация по рядам', frames.length);
  // Пересборка: заполненный DescriptionCard переносим в новый блок, а не создаём заново.
  const oldFrameRow = new Map();
  for (const f of frames) { const r = navRowOf(f); if (r) oldFrameRow.set(f.id, r); }
  const keep = new Map(); // rowId -> { desc, name, home, used }
  for (const c of navTopNodes()) {
    if (!isNavNode(c) || c.getSharedPluginData(NAV_NS, 'navRole') !== 'panel') continue;
    const rid = c.getSharedPluginData(NAV_NS, 'nav');
    if (!oldRows.has(rid)) continue;
    const d = c.children.find(isNavDesc) || null;
    const home = c.parent;
    if (d) home.appendChild(d); // временно выносим, чтобы он не удалился вместе со старым блоком
    keep.set(rid, { desc: d, name: c.name, home, used: false });
  }
  navRemoveRows(oldRows, false);

  const rows = navRows(frames);
  const wrappers = [];
  const warns = new Set();
  const created = []; // всё созданное в этом запуске — удаляем, если сборка упала
  // При откате перенесённые DescriptionCard возвращаем в секцию, чтобы не потерять ваш текст.
  const cleanup = () => {
    for (const k of keep.values()) if (k.desc && !k.desc.removed && k.desc.parent !== k.home) { try { k.home.appendChild(k.desc); } catch (e) {} }
    for (const n of created) { try { n.remove(); } catch (e) {} }
  };
  let linkC = null;
  try {
  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri];
    const rowId = Math.random().toString(36).slice(2, 10);
    const votes = {};
    for (const f of row.items) { const r = oldFrameRow.get(f.id); if (r && keep.has(r) && !keep.get(r).used) votes[r] = (votes[r] || 0) + 1; }
    const oldId = Object.keys(votes).sort((a, b) => votes[b] - votes[a])[0] || null;
    const old = oldId ? keep.get(oldId) : null;
    if (old) old.used = true;
    // Имя слоя: своё из поля, иначе прежнее (вдруг вы его переименовали), иначе автоимя.
    const name = opts.name ? navRowName(row.items, ri, rows.length, opts.name) : (old && old.name) || navRowName(row.items, ri, rows.length, '');
    const parent = row.items[0].parent; // страница или секция
    // Геометрия фрейма в координатах родителя (секции или страницы): у фреймов того же родителя это просто x/y.
    const pb = parent.type === 'SECTION' ? bb(parent) : { x: 0, y: 0 };
    const geo = (f) => (f.parent === parent ? { x: f.x, y: f.y, w: f.width, h: f.height } : { x: bb(f).x - pb.x, y: bb(f).y - pb.y, w: bb(f).width, h: bb(f).height });
    const setPos = async (node, x, y) => {
      node.x = x; node.y = y;
      if (Math.abs(node.x - x) > 1 || Math.abs(node.y - y) > 1) {
        await tick();
        node.relativeTransform = [[1, 0, x], [0, 1, y]];
      }
      return Math.abs(node.x - x) <= 1 && Math.abs(node.y - y) <= 1;
    };

    // Блок ряда: DescriptionCard (название) + LinkCard (ссылки), как в ваших макетах.
    const wrapper = figma.createFrame();
    wrapper.name = name; wrapper.fills = []; wrapper.layoutMode = 'VERTICAL'; wrapper.itemSpacing = NAV_CARD_GAP;
    parent.appendChild(wrapper);
    const reused = !!(old && old.desc && !old.desc.removed);
    const desc = reused ? old.desc : (simple ? simpleDesc() : descC.createInstance());
    wrapper.appendChild(desc);
    const card = simple ? simpleCard(row.items.length) : cardC.createInstance(); wrapper.appendChild(card);
    wrapper.resize(card.width, 10);
    wrapper.layoutSizingHorizontal = 'FIXED'; wrapper.layoutSizingVertical = 'HUG';
    desc.layoutSizingHorizontal = 'FILL'; card.layoutSizingHorizontal = 'FILL';
    wrapper.setSharedPluginData(NAV_NS, 'nav', rowId);
    wrapper.setSharedPluginData(NAV_NS, 'navRole', 'panel');
    created.push(wrapper);
    // Слева от ряда, верх вровень с рядом, ровно NAV_COL_GAP до первого фрейма. Координаты — внутри родителя.
    const gs = row.items.map(geo);
    const wx = Math.min(...gs.map((g) => g.x)) - wrapper.width - NAV_COL_GAP, wy = Math.min(...gs.map((g) => g.y));
    if (!(await setPos(wrapper, wx, wy))) warns.add(`не удалось поставить блок «${name}» на место (x=${Math.round(wrapper.x)}, y=${Math.round(wrapper.y)}, нужно x=${Math.round(wx)}, y=${Math.round(wy)})`);

    // DescriptionCard: слот списка выключаем, остальное как в компоненте — название ряда заполняют вручную.
    // Перенесённый DescriptionCard не трогаем: в нём уже ваш текст.
    const slotProp = reused || simple ? null : Object.keys(desc.componentProperties).find((k) => k.startsWith('isListSlot'));
    if (slotProp) { try { desc.setProperties({ [slotProp]: false }); } catch (e) { warns.add('не удалось выключить слот в DescriptionCard'); } }

    // Ссылки: в простом виде они уже есть в блоке, иначе размножаем ссылку в слоте под число фреймов.
    let links;
    if (simple) links = card.children.slice();
    else {
      const slot = card.findOne((n) => n.type === 'SLOT' && n.name === 'LinksSlot') || card.findOne((n) => n.type === 'SLOT');
      if (!slot) { cleanup(); return { ok: false, text: 'В компоненте «Навигация» нет слота для ссылок (ожидал слот LinksSlot)' }; }
      if (!slot.children.length) {
        linkC = linkC || await navComponent(cfg.linkKey, cache, localAll);
        if (!linkC) { cleanup(); return { ok: false, text: 'В слоте блока навигации нет ссылок, а запасной компонент ссылки не найден' }; }
        slot.appendChild(linkC.createInstance());
      }
      while (slot.children.length > row.items.length) slot.children[slot.children.length - 1].remove();
      // clone() внутри слота слот не пополняет — создаём новые ссылки из главного компонента образца.
      const tpl = slot.children[0];
      if (slot.children.length < row.items.length && tpl.type === 'INSTANCE') {
        const main = await tpl.getMainComponentAsync();
        if (!main) { cleanup(); return { ok: false, text: 'Не удалось найти компонент ссылки в слоте навигации' }; }
        const props = {};
        for (const [k, v] of Object.entries(tpl.componentProperties)) if (v.type !== 'VARIANT') props[k] = v.value;
        for (let guard = 0; slot.children.length < row.items.length && guard < row.items.length + 5; guard++) {
          const inst = main.createInstance();
          slot.appendChild(inst);
          try { inst.setProperties(props); } catch (e) {}
        }
      }
      links = slot.children.slice(0, row.items.length);
      if (links.length < row.items.length) warns.add(`в слоте только ${links.length} ссылок из ${row.items.length}`);

    }

    for (let i = 0; i < row.items.length; i++) {
      const f = row.items[i], link = links[i];
      const st = opts.showStatus ? f.getSharedPluginData(NAV_NS, 'status') : '';
      const textual = simple || link.type === 'INSTANCE';
      const tn = textual ? link.findOne((n) => n.type === 'TEXT') : null;
      if (textual) await navSetText(link, tn, st ? `${f.name} · ${st}` : f.name);
      if (tn && !navSetHyperlink(tn, f.id)) warns.add('не удалось поставить гиперссылку на текст');
      if (!(await navSetClick(link, f.id))) warns.add('не удалось поставить клик в прототипе');
      f.setSharedPluginData(NAV_NS, 'navRow', rowId);
    }

    const hit = parent.children.some((o) => o !== wrapper && !row.items.includes(o) && !isNavNode(o) && wrapper.x < o.x + o.width && wrapper.x + wrapper.width > o.x && wrapper.y < o.y + o.height && wrapper.y + wrapper.height > o.y);
    if (hit) warns.add(`блок «${name}» пересекается с другими слоями слева от ряда`);
    wrappers.push(wrapper);

    // Кнопка «Вернуться к навигации» над каждым фреймом, по правому краю.
    for (const f of row.items) {
      const btn = simple ? simpleBack() : btnC.createInstance();
      parent.appendChild(btn);
      const bt = btn.findOne((n) => n.type === 'TEXT');
      await navSetText(btn, bt, (simple ? '← ' : '') + (opts.label || 'Вернуться к навигации'));
      if (!simple) await navSetBackIcons(btn, cfg, cache, localAll, warns);
      const g = geo(f);
      if (!(await setPos(btn, g.x + g.w - btn.width, g.y - NAV_BTN_GAP - btn.height))) warns.add('не удалось поставить кнопку над фреймом «' + f.name + '»');
      if (bt && !navSetHyperlink(bt, wrapper.id)) warns.add('не удалось поставить гиперссылку на кнопку');
      if (!(await navSetClick(btn, wrapper.id))) warns.add('не удалось поставить клик на кнопку');
      btn.setSharedPluginData(NAV_NS, 'nav', rowId);
      btn.setSharedPluginData(NAV_NS, 'navRole', 'back');
      created.push(btn);
    }
  }
  } catch (e) {
    cleanup();
    return { ok: false, text: 'Не удалось построить навигацию, недособранное удалено: ' + ((e && e.message) || e) + ([...keep.values()].some((k) => k.desc) ? '. Заполненные DescriptionCard остались в секции' : '') };
  }
  let aligned = '';
  if (opts.align && opts.layout) {
    try {
      const items = layoutScan(opts.layout, frames).flatMap((i) => (i.layoutFix ? i.layoutFix.items : []));
      if (items.length) { const r = await applyMoves(items); aligned = `Выровнено слоёв: ${r.done.length}`; }
      else aligned = 'Расстояния уже в порядке';
    } catch (e) { warns.add('не удалось выровнять расстояния'); }
  }
  const orphan = [...keep.values()].filter((k) => k.desc && !k.used && !k.desc.removed);
  if (orphan.length) warns.add(`осталось DescriptionCard без ряда: ${orphan.length} (лежит в секции, текст сохранён)`);
  quiet();
  figma.viewport.scrollAndZoomIntoView(wrappers.concat(frames));
  const done = [`Навигация готова: рядов ${rows.length}, ссылок ${frames.length}`];
  if (aligned) done.push(aligned);
  if (warns.size) done.push('Внимание: ' + [...warns].join('; '));
  return { ok: true, text: done.join('. ') };
}

// ---------- Расстояния: навигация ↔ фреймы, ряд ↔ ряд ----------
function layoutScan(settings, roots) {
  const ctx = { s: settings, issues: [] };
  checkLayout(roots, ctx);
  return ctx.issues;
}
async function applyMoves(items) {
  const done = [];
  let locked = 0;
  for (const it of items) {
    const n = await figma.getNodeByIdAsync(it.id);
    if (!n || n.removed || !('x' in n)) continue;
    if (n.locked) { locked++; continue; }
    n.x += it.dx || 0; n.y += it.dy || 0; done.push(it.id);
  }
  return { done: [...new Set(done)], locked };
}

function layoutFrames(roots) {
  const out = [];
  for (const r of roots) {
    if (isNavNode(r) || looksLikeNavBlock(r)) continue;
    if (r.type === 'SECTION') out.push(...navFrameKids(r));
    else if (NAV_TYPES.includes(r.type)) out.push(r);
  }
  return [...new Set(out)];
}

function checkLayout(roots, ctx) {
  const num = (v) => { const n = Number(String(v == null ? '' : v).replace(',', '.')); return String(v == null ? '' : v).trim() === '' || !isFinite(n) ? null : n; };
  const navGap = num(ctx.s.navGap), rowGap = num(ctx.s.rowGap), frameGap = num(ctx.s.frameGap);
  if (navGap == null && rowGap == null && frameGap == null) return;
  const TOL = 1;
  const r1 = (x) => Math.round(x * 10) / 10;
  const frames = layoutFrames(roots);
  if (!frames.length) return;
  const rows = navRows(frames);
  const all = navTopNodes();
  const panels = all.filter((n) => isNavNode(n) && n.getSharedPluginData(NAV_NS, 'navRole') === 'panel');
  const manual = all.filter((n) => !isNavNode(n) && looksLikeNavBlock(n)); // блоки, собранные вручную
  const buttons = all.filter((n) => (isNavNode(n) && n.getSharedPluginData(NAV_NS, 'navRole') === 'back') || (n.type === 'INSTANCE' && n.name === 'Button'));

  // Кнопка «Вернуться к навигации» принадлежит фрейму, если стоит над ним и не выходит за его ширину.
  const buttonsOf = (f) => {
    const g = bb(f);
    return buttons.filter((b) => {
      const k = bb(b);
      return k.x >= g.x - TOL && k.x + k.width <= g.x + g.width + TOL && k.y + k.height <= g.y + TOL && k.y + k.height >= g.y - 300;
    });
  };
  const moves = (nodes, dx, dy) => nodes.map((n) => ({ id: n.id, dx, dy }));

  // Сначала для каждого ряда находим его блок навигации и кнопки.
  for (const row of rows) {
    row.minX = Math.min(...row.items.map((f) => bb(f).x));
    const rowIds = new Set(row.items.map(navRowOf).filter(Boolean));
    row.nav = panels.find((p) => rowIds.has(p.getSharedPluginData(NAV_NS, 'nav'))) || null;
    if (!row.nav) { // ручной блок: ближайший слева в полосе этого ряда
      let bestRight = -Infinity;
      for (const c of manual) {
        const g = bb(c);
        if (g.y < row.bottom && g.y + g.height > row.top && g.x + g.width <= row.minX + TOL && g.x + g.width > bestRight) { row.nav = c; bestRight = g.x + g.width; }
      }
    }
    row.btns = new Map(row.items.map((f) => [f.id, buttonsOf(f)]));
  }

  for (const row of rows) {
    // Между соседними фреймами ряда: правим этот фрейм и все правее вместе с их кнопками.
    if (frameGap != null) {
      for (let i = 1; i < row.items.length; i++) {
        const a = bb(row.items[i - 1]), b = bb(row.items[i]);
        const gap = b.x - (a.x + a.width);
        if (Math.abs(gap - frameGap) > TOL) {
          const d = r1(frameGap - gap);
          const rest = row.items.slice(i);
          add(ctx, row.items[i], 'warn', 'layout/frame-gap', `Расстояние до предыдущего фрейма ряда: ${r1(gap)}px, нужно ${frameGap}px (сдвинуть ${d > 0 ? 'вправо' : 'влево'} на ${Math.abs(d)}px)`);
          ctx.issues[ctx.issues.length - 1].layoutFix = {
            label: `Сдвинуть фрейм и ${rest.length > 1 ? 'ещё ' + (rest.length - 1) + ' правее' : 'его кнопку'} на ${d}px`,
            items: rest.flatMap((f) => moves([f].concat(row.btns.get(f.id) || []), d, 0)),
          };
        }
      }
    }
    // От навигации до первого фрейма: сдвигаем только блок.
    if (navGap != null && row.nav) {
      const g = bb(row.nav), right = g.x + g.width, gap = row.minX - right;
      if (Math.abs(gap - navGap) > TOL) {
        const d = r1(row.minX - navGap - right);
        add(ctx, row.nav, 'warn', 'layout/nav-gap', `Расстояние от навигации до фреймов ряда: ${r1(gap)}px, нужно ${navGap}px`);
        ctx.issues[ctx.issues.length - 1].layoutFix = { label: `Сдвинуть блок на ${d}px`, items: moves([row.nav], d, 0) };
      }
    }
  }

  // Между рядами: двигаем ряд целиком (фреймы, кнопки, навигация) и все ряды ниже.
  if (rowGap != null) {
    for (let i = 1; i < rows.length; i++) {
      const gap = rows[i].top - rows[i - 1].bottom;
      if (Math.abs(gap - rowGap) > TOL) {
        const d = r1(rowGap - gap);
        const below = rows.slice(i);
        const nodes = [];
        for (const r of below) { r.items.forEach((f) => nodes.push(f, ...(r.btns.get(f.id) || []))); if (r.nav) nodes.push(r.nav); }
        add(ctx, rows[i].items[0], 'warn', 'layout/row-gap', `Расстояние до ряда выше: ${r1(gap)}px, нужно ${rowGap}px (сдвинуть ряд ${d > 0 ? 'вниз' : 'вверх'} на ${Math.abs(d)}px)`);
        ctx.issues[ctx.issues.length - 1].layoutFix = {
          label: `Сдвинуть этот ряд${below.length > 1 ? ' и ещё ' + (below.length - 1) + ' ниже' : ''} на ${d}px`,
          items: moves([...new Set(nodes)], 0, d),
        };
      }
    }
  }
}
