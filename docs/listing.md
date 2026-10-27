# Frame Linter — карточка в Figma Community

Одно описание на двух языках: английский первым, русский ниже.

## Name
Frame Linter

## Tagline
Lint frames: naming, tokens, components, structure, navigation, spelling

## Categories
Design systems (основная), Productivity

## Tags
lint, qa, design system, tokens, naming, spellcheck, navigation, prototype, handoff

## Description

**Frame Linter checks your designs before handoff and fixes common issues in one click.**

**Check**
- Finds issues in layer names, token bindings (color, spacing), component usage, structure and file clutter (empty layers, redundant wrappers).
- Issues are grouped by rule. A side panel shows a layer preview, the reason and quick actions: bind to a token, rename, unwrap, delete.
- Fix identical issues in bulk: Select all, Bind all, Skip all. Fixed issues stay in the list marked with ✓. Every action can be undone.
- Layers inside instances are not edited silently: the plugin offers to open the main component.

**Navigation**
- Builds a block of links to the frames in a row and a "Back to navigation" button above each frame, with prototype click-through.
- "Simple view" draws the block itself, no components needed. Or plug in your own design-system components ("From selection").
- Checks spacing between frames.

**Spelling**
- Checks Russian and English text in the selected frames. Runs locally, nothing is sent anywhere.
- Personal and per-file dictionaries.

**Tools**
- Bulk component replacement.
- Duplicate a frame from data.

**How to use:** select frames or a section and click Check. Navigation, spelling and spacing checks work on the current selection.

**Permissions:** the plugin reads connected libraries (`teamlibrary`) to verify token and component bindings. It makes no network requests and sends no data anywhere.

The interface is in Russian.

—

**Frame Linter проверяет макеты перед передачей в разработку и исправляет типовые проблемы в один клик.**

**Проверка**
- Находит замечания по именам слоёв, привязке к токенам (цвет, отступы), использованию компонентов, структуре и мусору в файле (пустые слои, лишние обёртки).
- Замечания сгруппированы по правилам. В боковой панели есть превью слоя, причина и быстрые действия: привязать к токену, переименовать, убрать обёртку, удалить.
- Одинаковые замечания правятся пачкой: «Выделить все», «Привязать ко всем», «Пропустить все». Исправленные остаются в списке с отметкой ✓. Любое действие можно отменить.
- Слои внутри инстансов не правятся «молча»: плагин предлагает открыть главный компонент.

**Навигация**
- Строит блок ссылок на фреймы ряда и кнопку «Вернуться к навигации» над каждым фреймом, с переходами по клику в прототипе.
- «Простой вид» рисует блок сам, компоненты не нужны. Либо подключите свои компоненты из дизайн-системы («Из выделения»).
- Проверяет расстояния между фреймами.

**Правописание**
- Проверяет русские и английские тексты в выделенных фреймах. Работает локально, ничего не отправляется наружу.
- Личный словарь и словарь файла.

**Инструменты**
- Массовая замена компонентов.
- Размножение фрейма по данным.

**Как пользоваться:** выделите фреймы или секцию и нажмите «Проверить». Навигация, правописание и проверка расстояний работают с текущим выделением.

**Разрешения:** плагин читает подключённые библиотеки (`teamlibrary`), чтобы проверять привязку к токенам и компонентам. Сетевых запросов нет, данные никуда не передаются.

Интерфейс на русском языке.

## What's new (release notes)
Initial release. Design checks, frame navigation, spellchecking and bulk tools. / Первая публикация: проверка макетов, навигация, правописание и массовые инструменты.
