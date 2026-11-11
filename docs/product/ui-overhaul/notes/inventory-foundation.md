# Инвентаризация основы UI: стили, primitives, тесты, решения, визуальные документы

Заметка агента для темы `ui-overhaul` (Product Session — проработка вопроса владельца о переходе UI на
готовые библиотеки компонентов). Дата: 2026-11-11. Репозиторий: main, коммит `e66d9cf4f`. Работа только
на чтение: файлы проекта не менялись, pnpm, сборка и тесты не запускались.

Overlays, меню, popover-ы, диалоги, toast-ы и Command palette здесь не разбираются: их инвентаризирует
другой агент.

**Как считалось.** Все числа получены системным grep (`command grep`, BSD grep 2.6.0) из корня
репозитория. Шелл-функция `grep` этой машины подменяет его на ugrep с учётом `.gitignore`. Для
воспроизводимости она не использовалась. Счёт идёт по тексту, поэтому комментарии тоже попадают в числа.
Если в команде есть `-o`, считаются вхождения. Если `-l` — файлы.

## Сводка

1. CSS: 42 файла, 12 478 строк, все в `src/renderer`. Самый большой — `session/session.css` (2 538 строк). Все стили глобальные: нет CSS modules, нет CSS-in-JS, нет `@layer`.
2. Изоляцию стилей держит только соглашение: 1 184 класса с префиксом `w-` в стиле BEM. Рядом с CSS живут inline styles: 1 038 props `style={…}` в 102 файлах `.tsx`.
3. Design tokens: 85 CSS custom properties в `theme/tokens.css`, 64 из них переопределены для dark. Токены читают 2 575 раз из CSS и 1 501 раз из TSX. Вне tokens.css в CSS всего 30 hex и 18 rgb(a).
4. Тема только системная, через `prefers-color-scheme`; свой переключатель запрещён тикетом. Шрифты системные. Иконки — inline SVG (95 `<svg>` в 46 файлах), набора иконок нет. Анимации — 10 `@keyframes` и 12 `transition`. z-index — 28 разных значений без шкалы.
5. Tailwind v4 встанет рядом только с `prefix(tw)`: класс `.w-md` совпадает с utility `w-md` (ширина 448 px). CSS приложения без `@layer` сильнее любого слоя Tailwind. Preflight сделал бы блочными все `<svg>`, которым CSS приложения не задаёт `display`.
6. Общих primitives три файла: `theme/primitives.tsx`, `theme/Select.tsx`, `settings/controls.tsx`. Остальное собрано на месте: 7 копий primary button, 6 toggle-кнопок, 5 meters, 2 tabs, 2 splitters, около 15 своих чипов. Keyboard support неровный: стрелок нет у segmented control, у своих radio и у tabs в `flight-recorder/DetailPanel.tsx`.
7. Тесты: 756 файлов vitest и 158 e2e specs. Селекторы: `getByTestId` 5 145, `getByRole` 2 617, `getByText` 317. Свои классы `w-` тесты называют 814 раз в 153 файлах. Ещё 18 unit tests читают сами файлы `.css`.
8. ADR об UI library, Tailwind или design system нет. Есть правила добавления зависимости (ADR-0037), отказ от библиотеки `motion` (ADR-0090), правила контраста (ADR-0077), `allowBuilds` и `engineStrict` в `pnpm-workspace.yaml`. Лимита размера сборки нет; есть бюджет старта 3 s.
9. Скриншотов в `docs/features` нет. Устареют 2 SVG карты в README, 4 HTML-макета и F-SPEC в `docs/design`, 973 скриншота evidence в тикетах (история приёмки). Визуальных регрессионных тестов с эталонами нет.
10. Card не делит с приложением ни стили, ни код. Библиотеку renderer-а в Card без шага сборки не взять — подтверждено. Accessibility tooling нет; в `.tsx` 671 атрибут `aria-*` и 305 `role="…"`.

## 1. Архитектура стилей

### 1.1 Файлы CSS

Команда: `find src/renderer -name '*.css' -print0 | xargs -0 wc -l | sort -rn | head -16`.

| # | Файл (от `src/renderer/`) | Строк |
|---|---|---|
| 1 | `session/session.css` | 2 538 |
| 2 | `pr-inbox/pr-inbox.css` | 867 |
| 3 | `product/mind-map.css` | 764 |
| 4 | `session/quote-comments.css` | 742 |
| 5 | `work-track/work-track.css` | 734 |
| 6 | `shell/shell.css` | 674 |
| 7 | `flight-recorder/flight-recorder.css` | 630 |
| 8 | `canvas/nodes/BrowserNode.css` | 514 |
| 9 | `guide/guide.css` | 470 |
| 10 | `canvas/epic-frame.css` | 441 |
| 11 | `autopilot/autopilot-modal.css` | 360 |
| 12 | `theme/tokens.css` | 329 |
| 13 | `pipeline/pipeline.css` | 312 |
| 14 | `focus/focus.css` | 305 |
| 15 | `markdown/markdown.css` | 287 |
| | 15 файлов | 9 967 |
| | остальные 27 файлов | 2 511 |
| | **всего 42 файла** | **12 478** |

- Вне `src/renderer` файлов CSS нет: `find src -name '*.css' -not -path 'src/renderer/*'` ничего не находит.
- Сторонний CSS подключён в двух местах каждый. `@xyflow/react/dist/style.css`: `canvas/Canvas.tsx:54`, `product/MindMap.tsx:22`. `@xterm/xterm/css/xterm.css`: `canvas/nodes/TerminalNode.tsx:4`, `projects/GithubAccount.tsx:18`.
- `main.tsx:4` подключает `theme/tokens.css` первым. Дальше каждый компонент подключает свой файл. Таких строк 83: `command grep -rEo --include='*.tsx' --include='*.ts' "import '[^']+\.css'" src/renderer | wc -l`.
- В `out/renderer/assets/` лежит один файл `index-ARRKVNxk.css` размером 158 944 байт. Это старая сборка от 2026-10-22. С тех пор Guide грузится отдельным chunk-ом через `lazy(() => import('./GuideWindow'))` (`guide/GuideHost.tsx:9`), так что файлов CSS в текущей сборке может быть два. Состав и размер текущей сборки не проверено.

### 1.2 Как ограничена область стилей

Все классы глобальные. Изоляцию держит соглашение об именах.

| Что | Число | Команда |
|---|---|---|
| Разных классов `.w-*` в CSS | 1 184 | `find src/renderer -name '*.css' -print0 \| xargs -0 command grep -Eoh '\.w-[a-zA-Z0-9_-]*' \| sort -u \| wc -l` |
| из них с `__` (элемент BEM) | 851 | тот же список, `command grep -c '__'` |
| из них с `--` (модификатор BEM) | 218 | тот же список, `command grep -c -- '--'` |
| блоков (без `__` и `--`) | 217 | разность |
| Классов `.react-flow*` / `.xterm*` (правки сторонних стилей) | 11 / 2 | та же команда с `'\.react-flow[a-zA-Z0-9_-]*'` и `'\.xterm[a-zA-Z0-9_-]*'` |
| Классов состояния `.is-*` | 17 | `… command grep -Eoh '\.is-[a-z-]+' \| sort -u \| wc -l` |
| Селекторов по `[data-…` / `[aria-…` в CSS | 159 / 78 | `… command grep -Eo '\[data-[a-z-]+' \| wc -l` |
| `:where(` / `!important` | 34 / 9 | `… command grep -o ':where('` |
| `@media` / `@container` / `@supports` | 20 / 6 / 0 | `… command grep -o '@media'` |
| `@layer` / `@import` / CSS nesting (`&`) | 0 / 0 / 0 | `… command grep -o '@layer'` |
| Файлов `*.module.css` (CSS modules) | 0 | `find src/renderer -name '*.module.css' \| wc -l` |
| CSS-in-JS, clsx, classnames | 0 | `command grep -rlE "styled-components\|@emotion\|stitches\|vanilla-extract" src/renderer package.json`; `command grep -rlE "from 'clsx'\|from 'classnames'" src/renderer` |
| Конфиг PostCSS | нет | `ls postcss.config.*` |
| `className=` в `.tsx` / из них `className={…}` | 1 568 / 100 | `command grep -rEo "className=" src/renderer --include='*.tsx' \| wc -l` |

Многоточие `…` в командах значит `find src/renderer -name '*.css' -print0 | xargs -0`.

**Inline styles.** Второй способ стилизации, наравне с CSS.

| Что | Число | Команда |
|---|---|---|
| Все props `style={…}` | 1 038 в 102 файлах | `command grep -rEo "style=\{" src/renderer --include='*.tsx' \| wc -l` (файлы: `-rlE`) |
| из них литерал `style={{…}}` | 209 в 65 файлах | `command grep -rEo "style=\{\{" src/renderer --include='*.tsx' \| wc -l` |
| Файлов с объектом `const styles = {…}` | 46 | `command grep -rlE "const styles[: ]" src/renderer --include='*.tsx' --include='*.ts' \| wc -l` |
| Упоминаний `CSSProperties` | 167 | `command grep -rEo "CSSProperties" src/renderer --include='*.tsx' --include='*.ts' \| wc -l` |

- Больше всего inline styles в диалогах и формах. Числа `style={`: `projects/ConnectProject.tsx` 77, `shell/ProjectSettings.tsx` 57, `machines/LinkMachineDialog.tsx` 54, `harness/MigrationForm.tsx` 44, `browser/BrowserProfiles.tsx` 44, `canvas/nodes/SessionNode.tsx` 42.
- Пример: `projects/ConnectProject.tsx:66-67`, `const styles = { backdrop: { position: 'fixed', inset: 0, zIndex: 95, …, background: 'rgba(0, 0, 0, 0.25)' }`.
- Inline styles тоже берут токены: в TSX/TS 1 501 вхождение `var(--` (раздел 1.3).

### 1.3 Design tokens

**Где.** Один файл: `src/renderer/theme/tokens.css`.

- Светлый набор — блок `:root` (`tokens.css:9-128`).
- Тёмный набор — `@media (prefers-color-scheme: dark)` (`tokens.css:130`).
- Значения взяты из `docs/design/F-SPEC.md`: светлые из палитры E, тёмные из палитры Graphite (`tokens.css:1-7`).

**Сколько.**

- 149 объявлений, 85 разных имён: `command grep -Eo '^[[:space:]]*--[a-zA-Z0-9-]+:' src/renderer/theme/tokens.css | wc -l`; разные — то же с `sed -E 's/^[[:space:]]*//' | sort -u | wc -l`.
- В dark переопределено 64 имени: `sed -n '/prefers-color-scheme: dark/,/^}/p' src/renderer/theme/tokens.css | command grep -Eo '^[[:space:]]*--[a-zA-Z0-9-]+:' | wc -l`.
- Семейства по первому слову имени: `span` 20, `text` 8, `kind` 7, `radius` 5, `space` 4, `ready`/`working`/`blocked` по 3, `toolbar` 3, `terminal` 3, `sidebar` 3, `shadow` 3, остальные по 1–2.
- Ещё 49 разных custom properties объявлены прямо в CSS компонентов. Это локальные переменные.

**Именование.** Имена — роли, а не значения.

- Цвета: `--bg`, `--surface`, `--surface-raised`, `--border-strong`, `--text-muted`, `--primary`, `--ready-text`, `--blocked-ring`, `--kind-session-tint`, `--span-gate`.
- Шкалы: `--text-11 … --text-20` (размер шрифта), `--space-1 … --space-4` (4–16 px), `--radius-window`, `--radius-popover`, `--radius-node`, `--radius-button`, `--radius-chip`.
- Слово `text` занято дважды: `--text`, `--text-secondary`, `--text-muted` — цвета, `--text-11…20` — размеры.
- Токенов для z-index, длительностей анимации и line-height нет.

**Насколько последовательно используются.**

| Что | В CSS всего | в tokens.css | в CSS компонентов | в TSX/TS |
|---|---|---|---|---|
| `var(--…)` | 2 575 | 12 | 2 563 | 1 501 |
| hex | 151 | 121 | 30 | 4 |
| `rgb()` / `rgba()` | 27 | 9 | 18 | 16 |
| `hsl()` | 0 | 0 | 0 | — |
| `color-mix()` | 54 | 0 | 54 | — |
| литералы `px` | 1 741 | 30 | 1 711 | — |

Команды для CSS: `find src/renderer -name '*.css' -print0 | xargs -0 command grep -Eo '<шаблон>' | wc -l` с шаблонами `'var\(--'`, `'#[0-9a-fA-F]{3,8}\b'`, `'rgba?\('`, `'hsla?\('`, `'color-mix\('`, `'[0-9.]+px'`. Для TSX/TS: `command grep -rEo "var\(--" src/renderer --include='*.tsx' --include='*.ts' | wc -l`; hex — шаблон `"['\"\`]#[0-9a-fA-F]{3,8}['\"\`]"`.

- Hex вне tokens.css: `product/mind-map.css` 12, `guide/guide.css` 6, `autopilot/autopilot-modal.css` 4, по 2 в `session/session.css`, `markdown/markdown.css`, `flight-recorder/flight-recorder.css`, `canvas/badges/evidence.css`.
- По свойствам (CSS компонентов):

| Свойство | Через токен | Числом в px |
|---|---|---|
| `font-size` | 314 | 55 |
| `border-radius` | 162 | 77 |
| `padding` / `margin` / `gap` | 311 (`var(--space…`) | 428 |
| `font-family` | 39 (+2 `inherit`) | 0 |

Команды: `… command grep -Eo 'font-size:[[:space:]]*var\('` и `'font-size:[[:space:]]*[0-9.]+px'`; так же для `border-radius`; для отступов `'(padding|margin|gap)(-[a-z]+)?:[^;]*var\(--space'` и `'(padding|margin|gap)(-[a-z]+)?:[^;]*[0-9]px'`. В TSX `fontSize: 'var(…)'` — 274, `fontSize:` числом — 3.

- Цвета почти полностью идут через токены. Размеры шрифта и радиусы — в основном. Отступы чаще заданы числом.
- Единственный токен без `var()` вне tokens.css — `--terminal-dim`. Его читает JS: `canvas/nodes/TerminalNode.tsx:109`.
- Токены держат тесты. `test/e2e/theme.spec.ts:6-7`: ожидаемые значения переписаны руками из таблицы Tokens в F-SPEC. Файл tokens.css читают ещё 7 unit tests (раздел 3.5).

### 1.4 Темы

- Две темы: светлая (палитра E) и тёмная (палитра Graphite) (`tokens.css:1-4`).
- Переключение только системное. Блок `@media (prefers-color-scheme: dark)` есть в `tokens.css:130` и ещё 8 раз в 5 файлах компонентов: `guide/guide.css:452`, `pr-inbox/pr-inbox.css:156`, `product/mind-map.css:38`, `:478`, `:628`, `autopilot/autopilot-modal.css:12`, `session/quote-comments.css:11`. Плюс `color-scheme: light dark` (`tokens.css:10`).
- Своего переключателя нет. Комментарий `tokens.css:2-4`: «so there is no theme switch of our own». Тикет `.scratch/worfy-mvp/issues/03-окно-macos-и-темы.md:101-102`: «Переключателя темы нет, хотя в макетах F есть кнопка Appearance: тикет запрещает свой переключатель, тема всегда системная».
- JS читает тему в двух местах, для палитры xterm: `canvas/nodes/TerminalNode.tsx:398`, `projects/GithubAccount.tsx:279` (`matchMedia('(prefers-color-scheme: dark)')`).
- Main process берёт тему для рамки окна: `src/main/window.ts:131` (`nativeTheme.shouldUseDarkColors`).
- Нет `data-theme` и нет `nativeTheme.themeSource`: `command grep -rnE "themeSource|data-theme" src` ничего не находит.

### 1.5 Шрифты

- Только системные. `--font-ui: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif` (`tokens.css:13`). `--font-mono: ui-monospace, 'SF Mono', Menlo, monospace` (`tokens.css:14`).
- F-SPEC задаёт то же и пишет «No Google Fonts» (`docs/design/F-SPEC.md:10-12`).
- `@font-face` — 0, файлов шрифтов в `src` — 0: `command grep -rn '@font-face' src | wc -l`; `find src -iname '*.woff*' -o -iname '*.ttf' -o -iname '*.otf'`.
- Все 41 объявление `font-family` в CSS компонентов идут через токены: 21 `var(--font-ui)`, 18 `var(--font-mono)`, 2 `inherit`.
- Шрифта Windows в стеке нет: `command grep -c 'Segoe' src/renderer/theme/tokens.css` даёт 0. На Windows стек доходит до generic `sans-serif`. Какой шрифт это даёт на PC, не проверено.
- Числа и id набираются моноширинным с `tabular-nums`: класс `.w-mono` (`tokens.css:318-321`).

### 1.6 Иконки

- Набора иконок в зависимостях нет (`package.json`, поля `dependencies` и `devDependencies`).
- Иконки — inline SVG прямо в JSX: 95 `<svg` в 46 файлах `.tsx` (`command grep -rEo '<svg[ >]' src/renderer --include='*.tsx' | wc -l`).
- Больше всего SVG: `shell/Toolbar.tsx` 6, `session/QuoteCommentParts.tsx` 5, `product/MindMap.tsx` 5, по 4 в `theme/primitives.tsx`, `shell/toolbar/HarnessStatus.tsx`, `shell/ProjectSwitcher.tsx`, `session/composer/Modes.tsx`, `session/Transcript.tsx`.
- 31 компонент-функция с именем `…Icon` в 19 файлах: `command grep -rEo "function [A-Z][A-Za-z]*Icon[A-Za-z]*\(" src/renderer --include='*.tsx' | wc -l`.
- Общий модуль иконок есть только для типов Node: `canvas/kind-icons.tsx` (69 строк, `KindIcon` на `:28`, `KindBand` на `:67`).
- Символы Unicode вместо иконок: `×` 18, `▸` 10, `✕` 5, `✓` 5, `▾` 2, `↗` 1. В подписях клавиш: `⌘` 67, `⇧` 7, `⌥` 3.
- Файлов `.svg` и `.png` в `src/renderer` нет.
- F-SPEC требует «SF-Symbols-like inline stroke icons» (`docs/design/F-SPEC.md:5`).

### 1.7 Анимация

- Только CSS и одна покадровая JS-анимация. Библиотек анимации нет.
- 10 `@keyframes` в 6 файлах:
  - `getting-started/highlight.css:15` `w-getting-started-ring`;
  - `machines/machines.css:46` `w-machines-dot-pulse`;
  - `session/session.css:656` `w-product-agent-blink`, `:668` `w-session-spin`, `:958` `w-pmsg-dot`;
  - `session/quote-comments.css:73` `w-quote-pop-in`, `:80` `w-quote-shake`, `:89` `w-quote-block-flash`;
  - `shell/shell.css:510` `w-update-spin`;
  - `toast/toast.css:111` `w-toast-in`.
- 19 объявлений `animation:`. 12 объявлений `transition:` в 4 файлах: `guide/guide.css` 6, `session/session.css` 4, `settings/settings.css` 1, `product/mind-map.css` 1. Inline `transition` в TSX — 0.
- JS: точки на схемах Guide бегут по `requestAnimationFrame` (`guide/scene/motion.ts:1-7`). Всего `requestAnimationFrame(` — 12 вызовов в 8 файлах. Что делают остальные 7 файлов, не проверено.
- Web Animations API (`.animate(`) — 0 вызовов.
- `prefers-reduced-motion`: 10 media queries в 7 файлах CSS (`getting-started/highlight.css:27`, `machines/machines.css:58`, `session/session.css:435`, `:662`, `:678`, `:969`, `session/quote-comments.css:732`, `guide/guide.css:465`, `shell/shell.css:526`, `toast/toast.css:123`). И 2 проверки в TS: `guide/scene/motion.ts:14`, `canvas/overlays/SelectionToolbar.tsx:273`.
- Команды: `… command grep -Eo '@keyframes [a-zA-Z0-9_-]+'`, `… command grep -Eo '(^|[ ;{])transition(-[a-z]+)?:'`, `… command grep -o 'prefers-reduced-motion'`.

### 1.8 z-index

- Шкалы и токенов нет: `command grep -c -- '--z-' src/renderer/theme/tokens.css` даёт 0.
- 46 объявлений `z-index:` в CSS и 37 `zIndex:` в TSX/TS.
- 28 разных значений: −1, 0, 1, 2, 3, 4, 5, 6, 10, 20, 30, 80, 90, 95, 96, 100, 101, 105, 110, 120, 130, 300, 305, 310, 320, 1000, 2000, 3000.
- Именованных констант три: `SETTINGS_LAYER = 110` (`settings/settings-window.ts:24`), `MACHINE_DIALOG_LAYER = 120` (`machines/machine-dialogs.ts:29`), `PINNED_Z_INDEX = 1000` (`canvas/pinning.ts:38`).
- Верх стопки. 3000: список `Select` (`theme/select.css:60`) и `session/session.css:2460`. 2000: `canvas/overlays/BindingDrop.tsx:72`. 1000: `focus/focus.css:11`, `canvas/overlays/archive.css:61`, `BindingDrop.tsx:56`.
- Модальные backdrop-ы заданы inline: 90 (`shell/FirstRun.tsx:22`), 95 (`projects/ConnectProject.tsx:67`, `projects/RemoveProject.tsx:12`, `pr-inbox/DraftThread.tsx:432`, `shell/sidebar/ProjectsSection.tsx:89`), 96 (`projects/FolderBrowser.tsx:35`), 100 (`harness/CodexHooksStep.tsx:23`, `harness/MigrationForm.tsx:43`, `browser/BrowserProfiles.tsx:28`, `palette/CommandPalette.tsx:57`), 110 (`projects/EditProfile.tsx:50`).
- Ещё: toast 120 (`toast/toast.css:17`), окно Autopilot 120 (`autopilot/autopilot-modal.css:23`), Update и What's new 130 (`update/UpdateChip.tsx:79`, `update/WhatsNew.tsx:46`), комментарии к цитатам 300–320 (`session/quote-comments.css:116`, `:160`, `:215`, `:436`).
- Команды: `… command grep -Eoh 'z-index:[[:space:]]*[^;]+' | sort | uniq -c`; `command grep -rEoh "zIndex: *[^,} ]+" src/renderer --include='*.tsx' --include='*.ts' | sort | uniq -c`.

### 1.9 Tailwind v4 рядом с этим CSS: факты

1. **Слои каскада.** В CSS приложения нет ни одного `@layer`. Сторонний CSS React Flow тоже без слоёв (0 `@layer` в `node_modules/@xyflow/react/dist/style.css`). Tailwind v4 кладёт свои стили в слои `theme, base, components, utilities` ([tailwindcss.com/docs/preflight](https://tailwindcss.com/docs/preflight)). По правилам каскада обычное объявление без слоя сильнее объявления в слое, какая бы ни была специфичность. Значит, любое правило приложения перебьёт utility Tailwind на том же свойстве того же элемента. Обойти это можно только `!important` (в Tailwind — модификатор `!`).
2. **Правила controls в tokens.css.** Блоки `:where(…)` (`tokens.css:248`, `:268`, `:284`, `:305`) задают всем кнопкам, ссылкам, `[role='tab']`, `[role='switch']` и другим controls `cursor`, подсветку под указателем через `box-shadow` и кольцо фокуса через `outline` (комментарий `tokens.css:239-247`). Специфичность у них нулевая, но они вне слоя. Поэтому `tw:shadow-*` на кнопке пропадёт под указателем, а стиль фокуса из Tailwind (`tw:outline-*`) уступит кольцу `--accent` приложения. `test/e2e/controls.spec.ts` проверяет эти правила во всех областях окна.
3. **Совпадение имени класса.** Корень Markdown — класс `.w-md` (`markdown/Markdown.tsx:176`; 65 селекторов в CSS). В Tailwind v4 `w-md` — utility `width: var(--container-md); /* 28rem (448px) */` ([tailwindcss.com/docs/width](https://tailwindcss.com/docs/width)). `.w-md` в `markdown/markdown.css:3-11` ширину не задаёт. Без префикса Tailwind найдёт строку `'w-md'` в исходниках, и каждый блок Markdown станет шириной 448 px. Другие классы `w-*` с именами utility ширины не совпали: проверка по списку `auto`, `px`, `full`, `screen`, `dvw`, `dvh`, `lvw`, `lvh`, `svw`, `svh`, `min`, `max`, `fit`, `3xs…7xl` и числам нашла только `.w-md` (`… command grep -Eoh '\.w-(auto|px|full|screen|min|max|fit|[0-9.]+|3xs|2xs|xs|sm|md|lg|xl|[2-7]xl|dvw|dvh|lvw|lvh|svw|svh)([^a-zA-Z0-9_-]|$)' | sort | uniq -c`).
4. **Префикс.** `@import "tailwindcss" prefix(tw);` даёт классы вида `tw:text-red-500`. Префикс получают и классы, и CSS-переменные Tailwind ([tailwindcss.com/docs/styling-with-utility-classes](https://tailwindcss.com/docs/styling-with-utility-classes)). Так снимается и совпадение `w-md`, и совпадение имён переменных.
5. **Preflight** (слой `base`). Всем элементам: `margin: 0; padding: 0; box-sizing: border-box; border: 0 solid`. Заголовкам — `font-size` и `font-weight: inherit`. `ol, ul, menu` — `list-style: none`. `img, svg, video, canvas, audio, iframe, embed, object` — `display: block; vertical-align: middle` (там же, docs/preflight). В приложении нет общего правила `*` для `box-sizing`: есть 106 объявлений `box-sizing` в отдельных правилах. 95 inline `<svg>` стали бы блочными везде, где CSS приложения не задаёт им `display`. Preflight можно не подключать: импортировать только `theme.css` и `utilities.css` (docs/preflight).
6. **Имена токенов.** В Tailwind пространство `--text-*` — размеры шрифта (utility `text-xl`), `--font-*` — семейства, `--radius-*`, `--shadow-*`, `--spacing-*` — свои шкалы ([tailwindcss.com/docs/theme](https://tailwindcss.com/docs/theme)). У worfy `--text`, `--text-secondary`, `--text-muted` — цвета, а `--text-11…20` — размеры. В теме Tailwind по умолчанию есть свой `--font-mono` с другим значением; у worfy он тоже есть (`tokens.css:14`), и значение worfy вне слоя победит. Перенос токенов worfy в `@theme` потребует переименований.
7. **Сборка.** Конфига PostCSS нет. CSS собирает Vite 7 через electron-vite 5. Совместимость плагина `@tailwindcss/vite` с electron-vite 5 не проверено.
8. **CSP renderer-а** (`src/renderer/index.html:5`): `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; …`. Собранный файл CSS проходит. Шрифты и картинки с CDN не пройдут: `font-src` не задан и наследует `default-src 'self'`.
9. **Тесты.** Тесты называют свои классы `w-` 814 раз (раздел 3). Замена классов BEM на строки utility сломает эти места.

## 2. Form controls и layout primitives

Пути в этом разделе — от `src/renderer/`. Библиотек компонентов нет: в `package.json` нет `@radix-ui`, `@base-ui`, `@headlessui`, `react-aria`, `@floating-ui`, `cmdk`. Общий слой своих компонентов — три файла: `theme/primitives.tsx` (144 строки: `StatusChip`, `ListRow`, `PrimaryButton`, `SegmentedControl`), `theme/Select.tsx` (414 строк), `settings/controls.tsx` (61 строка: `SettingRow`, `SettingSwitch`).

Число вызовов компонента: `command grep -rEo "<Имя([^a-zA-Z]|$)" src/renderer --include='*.tsx' | wc -l` без файла, где он объявлен (`-rlE` — файлы). Шаблон `([^a-zA-Z]|$)` нужен, чтобы попал и JSX, перенесённый на новую строку.

| Вид | Общий? | Реализации | Вызовы | a11y |
|---|---|---|---|---|
| Buttons | частично | `PrimaryButton` (`theme/primitives.tsx:95-102`, `.w-primary` в `theme/primitives.css:106`); `.w-action` (`canvas/actions/actions.css:2`); 26 классов кнопок по областям; 6 одинаковых объектов `secondary` в inline styles | 348 `<button` в 107 файлах; `PrimaryButton` 9 в 7 файлах; `.w-action` — 72 строки в 22 файлах | full: нативные `<button>`, у всех задан `type` (346 `button` + 2 `submit`); одно кольцо фокуса на все (`theme/tokens.css:284-303`) |
| Text inputs, textarea | нет | 24 текстовых `<input>`, 6 `<textarea>`; общий класс один — `.w-connect-input` (`projects/connect-project.css:4-8`); 10 объектов `input:` в inline styles | 40 `<input` в 28 файлах; 6 `<textarea` в 6 файлах | partial: подписи есть (`<label>`, `htmlFor` или `aria-label`); общее кольцо фокуса полей не касается (`theme/tokens.css:284-299`), вид фокуса у полей трёх разных видов; `find/CanvasFind.tsx:194` убирает outline |
| Select | да | `theme/Select.tsx` — свой combobox со списком listbox | 18 в 13 файлах; один нативный `<select>` (`flight-recorder/RunHistoryView.tsx:85`) | full по ARIA: `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant` (`theme/Select.tsx:383-390`). Список — popover, его разбирает другой агент |
| Checkbox | нет (нативный) | `projects/FolderBrowser.tsx:212`, `browser/BrowserProfiles.tsx:224`, `autopilot/QueueList.tsx:132`; кнопка с ролью `checkbox` в `session/QuestionCard.tsx:213-215` | 3 + 1 | full: нативные, с `<label>` или `aria-label`; у QuestionCard есть `aria-checked` (`:215`) |
| Switch / toggle | switch — да | `SettingSwitch` (`settings/controls.tsx:43-61`, CSS `settings/settings.css:137-185`); 6 своих toggle-кнопок с `aria-pressed` | `SettingSwitch` 17 в 9 файлах; toggle-кнопки — 11 вызовов | switch full: `role="switch"`, `aria-checked`, `aria-label` (`settings/controls.tsx:47-50`), но описание строки со switch не связано (`SettingRow`, `controls.tsx:19-29`, нет id и `aria-describedby`). Toggle partial: 3 из 6 меняют вместе подпись и `aria-pressed` (`shell/sidebar-visibility.ts:91`, `:98`; `canvas/overlays/SelectionToolbar.tsx:146-149`; `canvas/nodes/SessionNode.tsx:255-256`) |
| Radio | нет | нативные в 4 файлах (`projects/GithubAccount.tsx:182`, `projects/ConnectProject.tsx:368`, `canvas/nodes/BrowserSidebar.tsx:41`, `getting-started/CostSwitch.tsx:51`); свои `role="radio"` в 2 файлах (`autopilot/StartAutopilotModal.tsx:519`, `session/QuestionCard.tsx:213`) | 8 `<input type="radio">`; 2 свои группы | нативные full; свои partial: стрелок нет (в `autopilot/StartAutopilotModal.tsx` 0 совпадений `Arrow` и `onKeyDown`) |
| Slider | нет (нативный ×2) | `settings/GeneralSection.tsx:69`, `session/composer/Pickers.tsx:352` | 2 | full: `aria-label` и `aria-valuetext`; у второго свой трек и бегунок WebKit (`session/session.css:1911-1945`) |
| Tabs | нет (×2) | `shell/Sidebar.tsx` (tablist на `:153`); `flight-recorder/DetailPanel.tsx:489-509` | 2 | Sidebar full: roving `tabIndex`, ↑/↓/Home/End, `aria-controls`, tabpanel с `aria-labelledby`. DetailPanel partial: стрелок нет, tabpanel без `aria-labelledby` (`:509`) |
| Segmented control | да + 3 копии | `SegmentedControl` (`theme/primitives.tsx:123-144`, CSS `theme/primitives.css:134-170`); свои копии: режим Autopilot (`autopilot/StartAutopilotModal.tsx:514-530`), язык Guide (`guide/GuideWindow.tsx:161-173`), шаги схемы Guide (`guide/scene/LivingScene.tsx:327-343`) | 7 в 5 файлах | full по ролям: `role="group"` и кнопки с `aria-pressed` (`theme/primitives.tsx:125-134`); стрелок нет |
| Disclosure | нет | `Disclosure`, `ToolRow`, `FoldedTools` (`session/Transcript.tsx:374-442`); ещё 14 своих складок; 2 `<details>` (`guide/GuideWindow.tsx:62`, `projects/ConnectProject.tsx:644`); 5 разных шевронов | 17 мест с `aria-expanded` у складок + 2 `<details>` | partial: `aria-controls` только у 3 из 17 (например `shell/sidebar/EpicsSection.tsx:211`) |
| Scroll areas | нет | нативный `overflow`; полосу правят 3 места: `shell/shell.css:89`, `product/mind-map.css:55`, `focus/focus.css:88` | — | нативные |
| Splitters | нет (×2) | `session/SplitDivider.tsx` (128 строк); разделители Focus mode (`focus/FocusMode.tsx:581-596`); размер Node меняет `NodeResizer` React Flow через `canvas/NodeResizeClamp.tsx:66` | 1 + 1; `NodeResizeClamp` упоминают 10 файлов | SplitDivider full: `role="separator"`, `aria-value*`, `tabIndex`, ←/→/Home/End (`session/SplitDivider.tsx:86-126`). Focus mode none с клавиатуры: только `role` и `aria-orientation`, нет `tabIndex` и клавиш. `NodeResizer` не проверено |
| Progress / meters | нет (×5) | `limits/LimitBar.tsx:21-29`; `session/composer/ContextMeter.tsx` (115 строк); прогресс Epic-а из 12 сегментов (`canvas/nodes/EpicFrameNode.tsx:30`); недельный meter Autopilot (`autopilot/StartAutopilotModal.tsx:311`); полоса размера PR (`pr-inbox/PrInboxView.tsx:353-358`) | по 1 | от partial до full: LimitBar — `role="meter"` без `aria-valuetext` (`:25`); ContextMeter — с `aria-valuetext` (`:82`); Epic и Autopilot — `role="img"` с текстом в `aria-label`; полоса PR — `aria-hidden`, цифры текстом |
| Badges / chips | частично | `StatusChip` (`theme/primitives.tsx:52-59`); голая разметка `.w-chip` — 28 строк в 13 файлах; около 15 своих компонентов чипов и бейджей; своя копия с тем же именем `StatusChip` в `shell/FirstRunChecks.tsx:124` | `StatusChip` из theme — 27 в 19 файлах | full для статичного текста: цвет всегда с иконкой и подписью (`theme/primitives.tsx:47-58`) |
| kbd hints | нет | 9 стилей `kbd` в 7 файлах CSS; один форматтер подписи (`platform.ts:130`) | 16 `<kbd` в 9 файлах | не применимо; `aria-keyshortcuts` — 4 в `.tsx` |
| Spinners | нет (×2) | кольцо CSS `.w-update-spinner` (`shell/shell.css:510-530`); SVG-дуга `Spinner` (`session/Transcript.tsx:147-154`, keyframes `session/session.css:668-682`) | 2 (`update/UpdateChip.tsx:220`, `shell/FirstRunChecks.tsx:82`) + 3 | full: `aria-hidden`, рядом текст, при reduced motion стоят |
| Avatars | нет (×2) | `Avatar` (`pr-inbox/PrInboxView.tsx:118-132`); буква Y или A в чате (`.w-pmsg__avatar`, `session/session.css:773`) | 2 + 3 | partial: `aria-hidden`; в строке списка PR логин только в `title` |
| Числа, которые часто меняются | — | только перерисовка, без анимации | — | цифры моноширинные: `.w-mono` (154 вхождения в TSX) и 12 `tabular-nums` в CSS |

### 2.1 Дубли по видам

- **Buttons.** 6 визуальных ролей, ни у одной кроме primary нет общего компонента.
  - Primary — 7 копий: `theme/primitives.css:106` (`.w-primary`), `canvas/actions/actions.css:18` (`.w-action--primary`), `autopilot/autopilot-modal.css:345`, `session/quote-comments.css:394`, `pr-inbox/pr-inbox.css:655`, `session/session.css:1573` (`.w-composer__send`) и inline в `shell/sidebar/SessionsSection.tsx:109`. Последняя берёт `--accent`, а не `--primary`.
  - Danger — 4 копии: `autopilot/autopilot-modal.css:352`, `session/quote-comments.css:424`, `session/session.css:2181`, inline в `browser/BrowserProfiles.tsx:88`.
  - Secondary — 6 одинаковых inline-объектов `secondary`: `browser/BrowserProfiles.tsx:79`, `harness/CodexHooksStep.tsx:57`, `harness/MigrationForm.tsx:88`, `machines/LinkMachineDialog.tsx:76`, `machines/machine-dialogs.ts:62`, `shell/ProjectSettings.tsx:82`. Одинаковость проверена: после сжатия пробелов у всех шести одна сумма md5.
  - Link-style — 10 копий, 5 в CSS и 5 inline. Одна из них ставит `cursor` сама (`shell/FirstRunConcepts.tsx:33`), против правила `theme/tokens.css:238-247`.
  - Icon-only — не меньше 10 классов, например `.w-toolbar__icon-button`, `.w-sidebar__icon-button`, `.w-focus__icon-button`. `aria-label` у всех не проверено.
  - Высота кнопок разная: 20 px (`canvas/actions/actions.css:4`), 22 (`shell/sidebar/MachinesSection.tsx:53`), 24 (`.w-qbtn`, `session/quote-comments.css:370`), 26 (`--w-session-button-height`, `session/session.css:176`), 28 (`--row-height`, `theme/tokens.css:31`).
- **Text inputs.** Вид фокуса трёх видов: outline `--accent` (`projects/connect-project.css:4-8`), рамка `--accent` без outline (`canvas/nodes/BrowserNode.css:81-84`), рамка `--primary` со свечением (`session/session.css:1467-1470`). Поля на inline styles получают кольцо браузера по умолчанию.
- **Autosize.** Растёт с текстом только composer чата: `session/MessageInput.tsx:193-199`, предел `MAX_HEIGHT = 200` (`:95`).
- **Toggle-кнопки с `aria-pressed`** — 6 реализаций: `SidebarToggle` (`shell/sidebar-visibility.ts:90-110`), `HideToolsButton` (`session/HideToolsButton.tsx:9-28`), «Problems only» (`flight-recorder/Timeline.tsx:531`), два toggle Mind map (`product/MindMap.tsx:1233`, `:1240`), `KeepButton` (`canvas/nodes/SessionNode.tsx:255`), Pin (`canvas/overlays/SelectionToolbar.tsx:146`). Нажатое состояние оформлено в каждом месте по-своему, например `session/session.css:198` (`.w-session__toggle`), `flight-recorder/flight-recorder.css:468` (`.w-fr-button.is-on`), `product/mind-map.css:104` (`.w-mind__toggle[aria-pressed='true']`).
- **Meters.** `LimitBar` и `ContextMeter` держат одну и ту же таблицу цветов дважды: `limits/LimitBar.tsx:7-11` и `session/composer/ContextMeter.tsx:26-30`.
- **Chips.** Свои компоненты: `Chip` трижды (`projects/ConnectProject.tsx:161`, `autopilot/StartAutopilotModal.tsx:214`, `canvas/badges/ChecksBadges.tsx:34`), `TicketChip` и `FactChip` (`pr-inbox/PrInboxView.tsx:154`, `:167`), `StateChip` и `RepoChip` (`canvas/nodes/TicketNode.tsx:45`, `:70`), `GateBadge`, `TempBadge`, `PullBadges` (`canvas/badges/ChecksBadges.tsx:48-62`), `VendorBadge` (`session/VendorBadge.tsx:38`), `DriveBadge` (`canvas/nodes/BrowserNode.tsx:254`), `NodeChips` (`product/NodeChips.tsx:18`), `AttachmentChips` (`session/MessageInput.tsx:149`), `DocumentChip` и `ImageChip` (`session/MessageAttachments.tsx:44`, `:59`). Команда: `command grep -rnE "^(export )?function [A-Za-z]*(Chip|Badge|Chips)[A-Za-z]*\(" src/renderer --include='*.tsx'`.
- **kbd.** 9 стилей: `focus/focus.css:98`, `:121`, `:256`, `autopilot/autopilot-modal.css:327`, `session/session.css:231`, `shell/shell.css:643`, `pr-inbox/pr-inbox.css:704`, `shortcuts/shortcuts.css:81`, `session/quote-comments.css:60` (`.w-qkbd`).
- **Spinners.** Иконка «working» у `StatusChip` рисует ту же дугу, что `Spinner` (`theme/primitives.tsx:18-21` и `session/Transcript.tsx:150-152`), но не вращается.
- **Цвет вне tokens.css.** Токены `--danger` и `--danger-text` объявлены в `autopilot/autopilot-modal.css:7-17`, а читает их и `session/session.css:833`. Всегда ли этот файл загружен вместе с session.css, не проверено.

### 2.2 Числа, которые часто меняются

- Ничего не анимируется. Кода count-up нет: `command grep -rEil 'countUp|animateNumber|NumberFlow|[^a-z]tween' src/renderer | wc -l` даёт 0. Ни один из 12 `transition` не стоит на цифре, полосе или кольце.
- Значения просто перерисовываются. От прыжков ширины их держат моноширинные цифры (`.w-mono`, `theme/tokens.css:318-321`).
- Часы: `useTicking` раз в секунду (`update/store.ts:173-181`), `useNow` раз в `REDRAW_MS` (`limits/useLimits.ts:43-50`), обратный отсчёт Auto-continue раз в секунду (`session/composer/ContinueCountdown.tsx:75`).
- Отсчёт Auto-continue стоит внутри `role="status"` (`session/composer/ContinueCountdown.tsx:104`). Screen reader может читать каждый тик; не проверено.

### 2.3 Tooltip

- 335 атрибутов `title=` в 105 файлах — это tooltip браузера (`command grep -rEo --include='*.tsx' ' title=' src/renderer | wc -l`; в число входят и props компонентов с именем `title`).
- Своего компонента tooltip нет. Есть только две функции, которые собирают текст: `valueTooltip` (`limits/LimitBar.tsx`) и `alwaysTooltip` (`session/PermissionCard.tsx`).

## 3. Связь тестов с DOM и классами

### 3.1 Наборы тестов

| Набор | Конфиг | Шаблон | Файлов |
|---|---|---|---|
| vitest `node` | `vitest.config.ts`, project `node` | `test/unit/**/*.test.ts` | 287 |
| vitest `contract` | project `contract` | `test/contract/**/*.test.ts` | 263 |
| vitest `jsdom` (testing-library) | project `jsdom`, `test/setup-dom.ts` | `test/unit/**/*.test.tsx`, `test/contract/**/*.test.tsx` | 202 + 4 = 206 |
| Playwright e2e | `playwright.config.ts` (`testDir: 'test/e2e'`) | `**/*.spec.ts` | 158 specs + 31 helper-файла `.ts` |
| Playwright acceptance | `playwright.acceptance.config.ts` (`testDir: 'test/acceptance'`) | `**/*.spec.ts` | 1 (`e3.spec.ts`) |

- Команды: `find test/unit -name '*.test.ts' | wc -l` и так далее для каждого шаблона; `find test/e2e -name '*.ts' -not -name '*.spec.ts' | wc -l`.
- Тестов внутри `src` нет: `find src -name '*.test.*' -o -name '*.spec.*'` пусто.
- В jsdom tests нет `@testing-library/jest-dom` и `user-event`: в `devDependencies` только `@testing-library/dom` и `@testing-library/react`. Проверки идут через обычный `expect` vitest (`test/setup-dom.ts`).
- Acceptance run не входит в CI и gate (`playwright.acceptance.config.ts:7-8`).

### 3.2 Как тесты выбирают элементы

e2e — все 189 файлов `.ts` в `test/e2e` (specs и helpers). jsdom — 206 файлов `.test.tsx`.

| Способ | e2e | jsdom |
|---|---|---|
| `getByRole` (в jsdom и `query`/`find`/`All`) | 1 051 | 1 566 |
| `getByTestId` (то же) | 2 644 | 2 501 |
| `locator('[data-testid…')` / `querySelector('[data-testid…')` | 408 | 74 |
| `getByText` (то же) | 63 | 254 |
| `getByLabel` / `ByLabelText` | 30 | 43 |
| `getByTitle` / `getByPlaceholder` | 0 / 0 | 1 / 0 |
| `locator('.класс…')` | 543: 339 `w-`, 173 `react-flow`, 26 `xterm`, 5 прочих | — |
| `locator('[атрибут…')` кроме `data-testid` | 97 | — |
| `locator('#id')` | 4 | — |
| `querySelector` / `querySelectorAll` | 193 (внутри `evaluate`) | 424: 120 с класса, 74 `data-testid`, 70 по атрибуту, 160 по тегу и прочие |
| `toHaveClass` / `classList.` | 19 / 4 | 0 / 71 |
| Свои классы `w-` в любом месте файла | 475 в 92 файлах | 321 в 60 файлах |
| Проверки `aria-*` (`toHaveAttribute`/`getAttribute('aria-…')`) | 257 | 451 |
| `toHaveCSS` / `getComputedStyle` | 151 в 46 файлах | 7 |
| `boundingBox` / `getBoundingClientRect` | 389 в 90 файлах | — |

Команды.

- e2e: `command grep -rEo '<шаблон>' test/e2e --include='*.ts' | wc -l` с шаблонами `'getByRole\('`, `'getByTestId\('`, `'getByText\('`, `'getByLabel\('`, `"locator\(['\"\`]\."`, `"locator\(['\"\`]\["`, `'querySelector(All)?\('`, `'toHaveClass\('`, `'toHaveCSS\(|getComputedStyle\('`, `'boundingBox\(|getBoundingClientRect\('`.
- Разбивка `locator('.…')` по префиксу: `command grep -rEoh "locator\(['\"\`]\.[a-zA-Z_-]+" test/e2e --include='*.ts' | sed -E "s/locator\(['\"\`]\.//" | awk '{ if ($0 ~ /^w-/) k="w-"; else if ($0 ~ /^react-flow/) k="react-flow"; else if ($0 ~ /^xterm/) k="xterm"; else k="other"; print k}' | sort | uniq -c`.
- jsdom: `find test/unit test/contract -name '*.test.tsx' -print0 | xargs -0 command grep -Eo '(get|query|find)(All)?ByRole\(' | wc -l`, так же для `ByTestId`, `ByText`, `ByLabelText`, `ByTitle`.
- Свои классы: `command grep -rEo "[.'\"\` ]w-[a-z][a-zA-Z0-9_-]*" test/e2e --include='*.ts' | wc -l`. Для jsdom — тот же шаблон по файлам `.test.tsx`. В node tests ещё 18 таких ссылок, все в `test/unit/wheel-router.test.ts`. Итого 814 ссылок в 153 файлах.
- Роли в запросах. jsdom: `button` 724, `option` 68, `group` 53, `textbox` 39, `listbox` 32, `switch` 21, `combobox` 17, `radio` 13, `checkbox` 10, `tab` 9, `meter` 9, `radiogroup` 6, `separator` 2, `tablist` 1, `slider` 1. e2e: `button` 498, `textbox` 64, `group` 41, `switch` 39, `option` 32, `combobox` 13, `listbox` 11, `tab` 10, `radio` 8, `meter` 6, `checkbox` 6, `tablist` 5, `slider` 4, `separator` 1. Команда: `command grep -rEoh "getByRole\(['\"](checkbox|switch|radio|…)['\"]" test/e2e --include='*.ts' | sort | uniq -c`.
- В renderer 982 атрибута `data-testid=` в 156 файлах, 851 разный литерал, плюс 179 props `testId`: `command grep -rEo --include='*.tsx' 'data-testid=' src/renderer | wc -l`. Test id — главный контракт между тестами и DOM.

### 3.3 Что сломается при смене DOM или имён классов primitive-а

| Вид selector-а | Сколько | Когда ломается |
|---|---|---|
| Свои классы `.w-*` | 814 ссылок в 153 файлах | При любом переименовании класса: строки utility Tailwind, своя разметка библиотеки |
| Тег и структура (`'button'`, `'input'`, `':scope > [data-item]'`, `'pre > code'`) | 160 в jsdom; 48 `locator(тег)` и 14 `querySelector(тег)` в e2e | При смене тегов и вложенности. Пример: `<input type="checkbox">` заменён на `<button role="checkbox">` |
| Роль и accessible name (`getByRole`) | 2 617 | Только если роль или имя меняются. Пример: `SegmentedControl` сейчас — кнопки с `aria-pressed` (`theme/primitives.tsx:125-136`). Какую роль дадут сегментам компоненты конкретной библиотеки, не проверено |
| Атрибуты `aria-*`, в том числе состояния (`aria-pressed`, `aria-checked`, `aria-selected`, `aria-expanded`) | 708 проверок (257 + 451) | Если состояние уйдёт в другой атрибут, например в `data-state`, или имя — в другой атрибут |
| `data-testid` | 5 145 вызовов `getByTestId`, 482 селектора `[data-testid` | Выживает, если библиотека передаёт атрибут тому же элементу. Риск там, где библиотека рисует свою обёртку или portal |
| Computed style и геометрия | 151 + 389 в e2e | При любом визуальном изменении, даже без смены DOM |
| Чтение файлов `.css` в unit tests | 18 файлов | При переносе, переименовании или переписывании файла CSS |
| `getByText` | 317 | Только при смене текста |
| Классы React Flow и xterm | 322 ссылки | Смена primitives их не трогает |

Команда для классов React Flow и xterm: `command grep -rEo "\.(react-flow|xterm)[a-zA-Z0-9_-]*" test --include='*.ts' --include='*.tsx' | wc -l`.

### 3.4 Десять файлов тестов, сильнее всего связанных с классами CSS

Мера — число вхождений своих классов `w-`. Команда: `command grep -rEo "[.'\"\` ]w-[a-z][a-zA-Z0-9_-]*" test --include='*.ts' --include='*.tsx' | cut -d: -f1 | sort | uniq -c | sort -rn | head -10`.

| # | Файл | Вхождений `w-` | Примечание |
|---|---|---|---|
| 1 | `test/e2e/interface-scale.spec.ts` | 26 | размеры toolbar, sidebar, шапок |
| 2 | `test/e2e/session-controls.spec.ts` | 25 | |
| 3 | `test/unit/mind-map-view.test.tsx` | 24 | ещё 15 классов React Flow |
| 4 | `test/unit/ticket-card.test.tsx` | 23 | читает 4 файла CSS |
| 5 | `test/e2e/focus-sidebar.spec.ts` | 23 | |
| 6 | `test/e2e/product-session.spec.ts` | 21 | |
| 7 | `test/unit/wheel-router.test.ts` | 18 | цепочки классов от `.w-canvas` до Node |
| 8 | `test/e2e/session-view.spec.ts` | 17 | |
| 9 | `test/e2e/epic-frame.spec.ts` | 17 | |
| 10 | `test/unit/harness-status.test.tsx` | 15 | читает `shell/shell.css` |

Следом идут `test/e2e/pin-tags.spec.ts` (15, и ещё 17 классов React Flow) и `test/e2e/pr-inbox.spec.ts` (14).

### 3.5 Тесты, которые читают сами файлы CSS

18 файлов в `test/unit` читают исходный текст CSS через `readFileSync` и проверяют в нём правила и токены:

- `tokens.css`: `contrast.test.ts`, `kind-tokens.test.ts`, `shadow-tokens.test.ts`, `flight-recorder-span-tokens.test.ts`, `guide-scene-colours.test.tsx` (ещё `guide/guide.css`), `terminal-theme.test.tsx`, `window-options.test.ts`;
- файлы компонентов: `ticket-card.test.tsx` (`canvas/epic-frame.css`, `pipeline/stepper.css`, `canvas/badges/checks-badges.css`, `theme/primitives.css`), `review-threads-badge.test.tsx`, `minimap-paint.test.tsx`, `pr-inbox-view.test.tsx`, `modes-menu.test.tsx` (`session/session.css`), `quote-comments-ui.test.tsx`, `update-chip.test.tsx` и `harness-status.test.tsx` (`shell/shell.css`), `pipeline-board.test.tsx`, `node-kind-header.test.tsx` (`focus/focus.css`, `canvas/node-chrome.css`);
- все файлы CSS renderer-а: `canvas-zoom.test.tsx`.

Как найдено: файлы с `readFileSync` или `readdirSync`, где есть строка `.css'`; из 26 найденных 8 упоминают CSS только в путях или комментариях и не считаются.

Ещё два e2e test завязаны на сам слой стилей: `test/e2e/theme.spec.ts` (цвета против F-SPEC) и `test/e2e/controls.spec.ts` (курсор, подсветка, кольцо фокуса во всех областях, в обеих темах).

## 4. Прежние решения и правила

### 4.1 ADR

Решения об UI library, component library, design system, Tailwind, Radix или shadcn нет нигде. Проверка: `command grep -rliF '<слово>' docs --include='*.md'` для `Tailwind`, `Radix`, `shadcn`, `component library`, `UI library`, `design system`, `a11y` — 0 файлов в `docs/` (кроме самой темы `ui-overhaul`), 0 в `CONTEXT.md`, `HANDOFF.md` и `.scratch/`. Раздел «Decisions so far» в `docs/product/ui-overhaul/map.md` пуст.

ADR, которые касаются вопроса:

| ADR | Название | Что важно для overhaul |
|---|---|---|
| ADR-0004 | «Стек: Electron, TypeScript, React, React Flow, Claude Agent SDK» | Стек зафиксирован, UI library в нём нет. tldraw отклонён в том числе из-за «лицензия SDK с ключом для production» (`docs/adr/0004-stack-electron-ts-react-flow-agent-sdk.md:11`) |
| ADR-0037 | «Внутренность рамки Epic-а раскладывает ELK в Web Worker renderer-а…» | Образец добавления зависимости: точная версия в `dependencies`, лицензия проверена и записана, install-скриптов нет (`docs/adr/0037-epic-frame-layout-by-elk.md:18-22`). Цена размера записана: «+1,6 MB в сборке приложения (chunk worker-а)» (`:81`) |
| ADR-0090 | «worfy Guide: окно со своим чанком, тексты на двух языках в JSON, анимация схем через requestAnimationFrame» | Библиотека анимации отклонена: «подсветка — CSS-переходы … библиотеки `motion` нет» (`docs/adr/0090-guide-window-and-two-languages.md:59`); «Библиотека `motion`. Отклонено: spec разрешает её только при заметной пользе» (`:84`). Тяжёлый код Guide вынесен в свой chunk |
| ADR-0077 | «Цвет по типу Node-а: роли `kind-*` в таблице Tokens F-SPEC — только полоса, иконка, Minimap и блок дальнего zoom, никогда не текст статуса» | Правила контраста: 3:1 для нетекстовых элементов в обеих темах, WCAG 1.4.11 (`docs/adr/0077-node-kind-tokens.md:50`). Чужая палитра библиотеки упрётся в эти правила |
| ADR-0017 | «Канонические термины английские; принятые ADR правятся только в терминах» | Слова интерфейса берутся из `docs/design/BRIEF.md` (`docs/adr/0017-english-canonical-terms.md:6`). Тексты готовых компонентов должны совпасть с этим словарём |
| ADR-0043 | «qmd — часть Harness: …» | Пример записи лицензии зависимости: «лицензия MIT» (`docs/adr/0043-qmd-is-part-of-harness.md:15`) |

### 4.2 Дизайн-документы

- `docs/design/F-SPEC.md:1` — «Direction F — "Native frame, Graphite instrument"». Это действующая спецификация вида.
  - `:5`: chrome из macOS — «segmented controls, toggles, pill badges», «SF-Symbols-like inline stroke icons».
  - `:10-12`: системные шрифты, «No Google Fonts», шкала размеров 11/12/13/15/20.
  - `:15-16`: радиусы 10/10/8/4/6 px, сетка 4/8 px; в dark «NO shadows, 1px borders only».
  - `:44`: «Always pair status color with a text label or icon. Contrast ≥ 4.5:1 for text.»
  - `:72`, `:180`: правила accessible name и `aria-*` для отдельных controls («the shared action button», «the shared Select»).
- `docs/design/BRIEF.md` — бриф, по которому делались макеты F.
  - `:86`: «Accessible markup: real `<button>` / `<a href="#">` / `<input>` with `<label>`, `aria-label` on icon-only buttons. Text contrast ≥ 4.5:1 (captions too).»
  - `:87`: «no AI tropes (gradient washes, left-border accent cards, emoji, Inter/Roboto/Arial)».
  - `:88`: «Do NOT copy the look of any existing product (Linear, Figma, tldraw, Morphy, etc.). Original.»
- Тема: `.scratch/worfy-mvp/issues/03-окно-macos-и-темы.md:17-19` и `:101-102` — только системная, свой переключатель запрещён.
- Reduce motion для отдельных элементов: `.scratch/worfy-ui/spec.md:162` («`prefers-reduced-motion` убирает пульсацию»). Общего правила или теста для Reduce motion нет.

### 4.3 Правила для зависимостей

- **Install scripts.** `pnpm-workspace.yaml:3-9`: `allowBuilds` перечисляет пакеты, чьи install scripts запускаются (`electron`, `esbuild`, `node-pty` — да, `electron-winstaller` — нет). Любой другой пакет со скриптом валит `pnpm install` с `ERR_PNPM_IGNORED_BUILDS` (комментарий `:3-4`).
- **Версия Node.** `pnpm-workspace.yaml:17`: `engineStrict: true`. Пакет, чей `engines` не принимает Node установки, ломает `pnpm install` (комментарий `:11-16`).
- **Возраст версии.** Ключа `minimumReleaseAge` в `pnpm-workspace.yaml` нет. Файла `.npmrc` нет. Комментарий `.github/dependabot.yml:7-8`: «The cooldown of one day matches pnpm 11, which by default does not install a version younger than a day». Там же `cooldown: default-days: 1` (`:26-27`). Значение по умолчанию в самом pnpm 11 отдельно не проверено.
- На деле сутки действуют и в CI. Память Orchestrator-а `resume-2026-11-10-stable-update.md:16`: PR #1787 был красным «only by pnpm minimumReleaseAge (1 day; 0.3.322 published 2026-11-10T01:58Z)», и там же правило «Never add minimumReleaseAgeExclude». Значит, свежий релиз библиотеки ставится не раньше чем через сутки.
- **Dependabot** следит только за `@anthropic-ai/claude-agent-sdk` (`.github/dependabot.yml:20-21`).
- **Лицензии.** Allowlist лицензий нет. Лицензию записывают в ADR при добавлении пакета (ADR-0037, ADR-0043).
- **Поставка.** Отдельного правила supply chain в виде ADR нет. Рядом есть правило из памяти Orchestrator-а: в workflows нельзя `pull_request_target` и секреты (строка индекса памяти про `ci-cost.md`; к зависимостям относится косвенно).

### 4.4 Размер сборки и время старта

- Лимита размера сборки нет: в `electron.vite.config.ts` и `package.json` нет `chunkSizeWarningLimit`, `manualChunks`, `size-limit` (`command grep -nE "chunkSizeWarningLimit|manualChunks|size-limit" electron.vite.config.ts package.json`).
- Есть бюджет старта. `test/e2e/start-budget.ts:6`: `START_MS = 3_000`. На GitHub Actions — `START_RATIO = 6` от эталонного старта (`:16`), не больше `RUNNER_START_CAP_MS = 7_300` (`:24`). Его проверяет `test/e2e/epic-frame.spec.ts:1113`: «an Auberge-sized Project is interactive within 3 s…».
- Старая сборка в `out/renderer/assets/` (2026-10-22): `index-*.js` 3 287 307 байт, `index-*.css` 158 944 байт, `elk-worker.min-*.js` 1 595 334 байт. Размер текущей сборки не проверено.

### 4.5 qmd

Запросы шли в коллекции `worfy-docs`, `worfy-tickets`, `worfy-memory` и в коллекцию другого проекта владельца.

- `worfy-tickets/worfy-ui/spec.md` — epic интерфейса и настроек (закрыт, 28/28). Решения о Select, палитре и toast-ах; вопрос библиотеки не решает.
- Прецедент из другого проекта того же владельца, не worfy: другой проект, `docs/adr/0025-frontend-foundation.md` — «Основа фронтенда: Tailwind v4 с токенами темы, shadcn как исходники в репозитории, доменные сборки руками» (решено 2026-08-22). Заголовок взят из выдачи qmd; сам файл не открывался.

### 4.6 Чего нет

- ADR о CSS-архитектуре: префикс `w-`, BEM и inline styles нигде не записаны как решение.
- Правила «писать CSS руками» или «без UI library». Это отсутствие выбора, а не запрет.
- ADR о теме. Запрет переключателя есть только в тикете `worfy-mvp/03`.
- Общего правила accessibility в ADR. Есть правила контраста (ADR-0077, F-SPEC) и строка брифа `BRIEF.md:86`.
- Лимита размера бандла, allowlist лицензий, ADR о supply chain.
- `CLAUDE.md` и `AGENTS.md` в репозитории.

## 5. Визуальные документы

| Где | Что | Сколько | Устареет при overhaul |
|---|---|---|---|
| `docs/features/*.md` и `docs/features/ru/*.md` | страницы фич, 34 + 34 | 0 картинок (`![…](…)` — 0, `<img` — 0) | нет картинок; текст с описанием вида не проверялся |
| `docs/images/` | `map-of-worfy-light.svg`, `map-of-worfy-dark.svg` | 2 | да; их рисует `scripts/map-of-worfy-svg.mjs` из сцены Guide, `tokens.css` и `guide.css` (комментарий скрипта, строки 7-8), а `test/unit/map-of-worfy-svg.test.tsx` сверяет их с текущими цветами |
| `README.md:5-10` | `<picture>` с этими двумя SVG | 1 место | вместе с ними |
| `docs/design/` | `F-SPEC.md` (249 строк), `BRIEF.md` (88 строк), 4 HTML-макета `F-canvas-light/dark.dc.html`, `F-session-light/dark.dc.html` (66–68 KB каждый) | 6 файлов | да, это и есть описание текущего вида; `test/e2e/theme.spec.ts` сверяет цвета с таблицей F-SPEC |
| Guide (`src/renderer/guide/topics/`) | 14 тем, в каждой живая схема `Scene.tsx`, в 13 ещё `Flow.tsx` | 14 схем | частично: схемы — блоки и стрелки, не копии controls; цвета идут из `tokens.css` и `guide.css`, их проверяет `test/unit/guide-scene-colours.test.tsx` |
| `.scratch/*/evidence/` | скриншоты-доказательства закрытых тикетов | 973 файла (967 PNG, 5 WebP, 1 WebM) | да, но это история приёмки, а не документация |
| `build/` | `icon.png`, `brand/icon.svg`, `brand/mark.svg` | 3 | нет, это иконка и знак приложения |

Итого при смене вида устареет: 2 SVG карты (их можно перерисовать скриптом), 6 файлов `docs/design`, цвета 14 схем Guide. Схемы берут токены и обновятся сами. Их test проверяет по текущим файлам CSS правила: ΔE ≥ 15 от цветов статуса, контраст 3:1 для блоков и 4.5:1 для текста (`test/unit/guide-scene-colours.test.tsx:6-10`). Новая палитра должна пройти эти правила. Ещё 973 файла evidence перестанут совпадать с приложением; это записи о приёмке тикетов, их никто не обновляет.

Команды:

- `git ls-files | command grep -iE '\.(png|jpe?g|gif|webp|svg|mp4|webm)$' | wc -l` — 980 файлов картинок в git; разбивка по папкам — `awk -F/` по первым двум частям пути.
- `command grep -rEo '!\[[^]]*\]\([^)]+\)' docs --include='*.md' | wc -l` — 0; `command grep -rEo '<img ' docs --include='*.md' | wc -l` — 0.
- Сцены Guide не импортируют компоненты приложения: темы импортируют только `../../scene/LivingScene` и `../../scene/model` (`command grep -rhoE "from '(\.\./)+[a-z-]+/[A-Za-z/-]+'" src/renderer/guide/topics | sort | uniq -c`).

**Тесты по скриншотам.**

- Эталонов визуальной регрессии нет. `toHaveScreenshot` — 0. `toMatchSnapshot` — 1 вызов: `test/e2e/browser-layer.spec.ts:437`. Там эталон пишется в том же test из снимка обычного окна (`:433-435`) и удаляется после сравнения (`:438-440`). Сохранённых эталонов в репозитории нет: папок `*-snapshots` и `__snapshots__` в `test/` нет.
- Helper `snapshotThemes` (`test/e2e/snapshots.ts:36`) снимает окно в светлой и тёмной теме для ревьюера. Он ничего не проверяет. Вызовов — 120 в 55 spec-файлах (`command grep -rEo 'snapshotThemes\(' test/e2e --include='*.spec.ts' | wc -l`).
- Что ломается от overhaul среди тестов на вид: `theme.spec.ts`, `controls.spec.ts`, 151 проверка computed style и 389 проверок геометрии в e2e, 18 unit tests над текстом CSS, `map-of-worfy-svg.test.tsx`, `guide-scene-colours.test.tsx`.

## 6. Card runtime

Вывод: **подтверждено.** Card не делит с приложением ни код стилей, ни компоненты. Библиотеку, принятую в renderer, внутри Card без шага сборки использовать нельзя.

- `src/card-runtime/` — один файл `worfy-card.ts` (138 строк). Это функция, которую протокол вставляет текстом в `<head>` каждого HTML Card-а (`worfy-card.ts:1-4`).
- Функция обязана быть самодостаточной: «no imports, nothing from the module around it» (`worfy-card.ts:6-8`). Стилей и классов в ней нет.
- Вставку делает `src/main/cards/protocol.ts:105-109` (`CARD_RUNTIME_SCRIPT`, тег `<script data-worfy-runtime>`). CSS приложения и токены в Card не попадают. В main-коде Card-ов нет ни `tokens.css`, ни переменных `--surface`, ни `prefers-color-scheme`.
- CSP Card-а (`src/main/cards/protocol.ts:53-64`): `script-src 'self' 'unsafe-inline'`, `style-src 'self' 'unsafe-inline'`, `connect-src https:`. Скрипты и стили — только из файлов самого Card-а и inline. Скрипт с CDN не загрузится.
- Card — iframe с `sandbox={CARD_SANDBOX}` (`src/renderer/canvas/nodes/CardNode.tsx:139`), где `CARD_SANDBOX = 'allow-scripts allow-same-origin'` (`:38`), на своём origin `worfy-card://…`.
- Документация: «There is no build step: the files run as they are» (`docs/features/cards.md:13`); «Run scripts and styles from its own files and inline» (`:41`).
- Единственный путь библиотеки в Card — агент кладёт готовый собранный файл библиотеки в папку Card-а. Копию из бандла renderer-а Card не видит. Для компонентов React нужен ещё и сам React в Card-е.
- Общий модуль `src/shared/cards/bridge.ts` — протокол сообщений, не стили.

## 7. Accessibility: исходный уровень

**Tooling нет.**

- `eslint-plugin-jsx-a11y` нет: в `package.json` 0 совпадений с `jsx-a11y|axe-core|@axe-core|vitest-axe|jest-axe|pa11y|lighthouse`.
- В `eslint.config.js` подключены только `@eslint/js`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`, `typescript-eslint`, `globals` и своё правило `noCyrillic` (`eslint.config.js:4-10`).
- axe в тестах нет: `command grep -rlE 'axe-core|@axe-core|AxeBuilder|checkA11y|injectAxe' test | wc -l` даёт 0.
- Что есть вместо: `test/unit/contrast.test.ts` (контраст текста по tokens.css), `test/e2e/controls.spec.ts` (видимое кольцо фокуса и курсоры), массовые запросы `getByRole` в тестах (2 617, раздел 3.2). Запрос по роли косвенно проверяет роль и accessible name.

**Разметка в `.tsx`.**

| Что | Число | Команда |
|---|---|---|
| Атрибуты `aria-*` | 671 в 133 файлах | `command grep -rEo --include='*.tsx' 'aria-[a-z]+=' src/renderer \| wc -l` |
| `role="…"` литералом | 305 в 104 файлах | `command grep -rEo --include='*.tsx' 'role="[a-z]+"' src/renderer \| wc -l` |
| `role={…}` выражением | 11 | `command grep -rEo --include='*.tsx' 'role=\{' src/renderer \| wc -l` |
| `tabIndex=` | 35 | `command grep -rEo --include='*.tsx' 'tabIndex=' src/renderer \| wc -l` |
| `onKeyDown=` | 59 | то же с `'onKeyDown='` |
| `title=` (tooltip браузера) | 335 в 105 файлах | то же с `' title='` |

- `aria-*` по видам: `aria-label` 279, `aria-hidden` 170, `aria-expanded` 32, `aria-disabled` 27, `aria-labelledby` 23, `aria-modal` 20, `aria-invalid` 18, `aria-describedby` 15, `aria-current` 12, `aria-live` 10, `aria-pressed` 9, `aria-haspopup` 9, `aria-controls` 8, `aria-checked` 8, `aria-busy` 7, `aria-selected` 5, `aria-keyshortcuts` 4, `aria-orientation` 3, по 2 `aria-valuenow`/`-valuemin`/`-valuemax`/`-valuetext`/`aria-activedescendant`, по 1 `aria-owns` и `aria-description`.
- `role` по видам (литералы): `alert` 99, `status` 39, `dialog` 38, `group` 24, `menuitem` 22, `menu` 15, `img` 9, `separator` 7, `presentation` 6, `menuitemradio` 4, `listbox` 4, `alertdialog` 4, `tab` 3, `region` 3, `radiogroup` 3, `option` 3, `note` 3, `menuitemcheckbox` 3, по 2 `tabpanel`, `tablist`, `search`, `log`, `combobox`, по 1 `toolbar`, `switch`, `radio`, `navigation`, `meter`, `button`.
- Числа выше — нижняя граница. Часть ролей и `aria-*` задана объектом и разворачивается в props: 3 роли ARIA (`'meter'`, `'menu'`, `'menuitem'`) и 24 ключа `'aria-…':`, например `session/composer/ContextMeter.tsx:82`. Команды: `command grep -rEo "role: '[a-z]+'" src/renderer --include='*.tsx' --include='*.ts'`; `command grep -rEo "'aria-[a-z]+':" src/renderer --include='*.tsx' --include='*.ts' | wc -l`.
- Правила controls в `tokens.css:248-315` дают кольцо фокуса `:focus-visible` всем controls сразу, включая элементы с `role='tab'`, `role='switch'`, `role='option'`.

## Не проверено

- Размер текущей сборки renderer-а (в `out/` лежит сборка от 2026-10-22).
- Совместимость `@tailwindcss/vite` с electron-vite 5.
- Какую роль дают сегментам и переключателям компоненты конкретных библиотек (Radix, Base UI).
- Какой шрифт получает UI на Windows из generic `sans-serif`.
- Что делают 7 из 8 файлов с `requestAnimationFrame`, кроме Guide.
- Значение `minimumReleaseAge` по умолчанию в pnpm 11 по документации pnpm. Известно из комментария `dependabot.yml:7-8` и из красного CI у PR #1787.
- Содержимое ADR-0025 другого проекта владельца (только заголовок из qmd).
