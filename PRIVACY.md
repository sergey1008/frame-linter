# Privacy / Конфиденциальность

## English

**Frame Linter** (Figma plugin) runs entirely inside Figma and does not send data anywhere.

- **Network:** the Figma Community version makes no network requests and declares no network access. The spelling dictionary is bundled with the plugin.
- **What it reads:** layers, text, variables, styles and connected libraries of the current selection (or page, for the Check tab), to run checks and apply the fixes you request. Content is processed locally in the plugin and is never transmitted.
- **What it stores:** settings, the personal dictionary, window position and skipped issues are saved locally with `figma.clientStorage`. Navigation blocks and a few markers are written into the file itself as plugin data on the layers the plugin creates.
- **No collection:** no analytics, telemetry, advertising, accounts or sign-in. No access to your profile or e-mail.
- **Third parties:** none.

Questions: open an issue at https://github.com/sergey1008/frame-linter/issues

## Русский

**Frame Linter** (плагин Figma) целиком работает внутри Figma и никуда не отправляет данные.

- **Сеть:** версия из Figma Community не делает сетевых запросов и не запрашивает сетевой доступ. Словарь правописания встроен в плагин.
- **Что читает:** слои, тексты, переменные, стили и подключённые библиотеки выделенного (в «Проверке» ещё страницы) — чтобы выполнять проверки и применять правки, которые вы запросили. Содержимое обрабатывается локально и не передаётся.
- **Что хранит:** настройки, личный словарь, положение окна и пропущенные замечания — локально через `figma.clientStorage`. Блоки навигации и служебные метки записываются в сам файл как данные плагина на слоях, которые создаёт плагин.
- **Ничего не собирается:** нет аналитики, телеметрии, рекламы, аккаунтов и входа. Нет доступа к профилю и почте.
- **Третьи лица:** нет.

Вопросы: https://github.com/sergey1008/frame-linter/issues
