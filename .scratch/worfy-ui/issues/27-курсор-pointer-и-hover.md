# 27 — Курсор pointer и понятное состояние hover у всех кликабельных элементов

Type: bug
Status: claimed 2026-10-24T22:42Z
Branch: worfy-ui/27
Blocked by: —
Source: владелец, 2026-10-25 (чат Mac-оркестратора). Код перечитан по main `d089cfea`.

## Что происходит

Владелец: во всём приложении у кнопок и похожих элементов при наведении нет курсора pointer. Само
состояние hover у кнопок тоже вводит в заблуждение и мешает работать: непонятно, что можно нажать, а
что нет.

В коде: `body` ставит `cursor: default` (`src/renderer/theme/tokens.css`, правило `body`), а базовое
правило `button` там же (`tokens.css:177`) задаёт только шрифт и цвет, без курсора. `cursor: pointer`
расставлен вручную: он есть в 14 файлах из 30 CSS-файлов renderer-а и в нескольких inline-стилях
`.tsx`. Поэтому одни кнопки показывают pointer, другие — нет; у hover то же самое: каждый компонент
рисует его сам.

## Что сделать

1. **Аудит.** Пройти CSS renderer-а и выписать в этот ticket (раздел «Итог») найденные случаи по
   областям: где у кликабельного элемента нет pointer, где нет видимого hover или `:focus-visible`,
   где hover есть у элемента, который не нажимается. Кликабельные элементы: `button`,
   `[role=button]`, `a[href]`, `summary`, `select`, `label` у checkbox-ов и radio, пункты меню
   (`[role=menuitem]`), вкладки (`[role=tab]`), chips и Stage chips, кнопки в шапке Node-а, иконки
   toolbar-а и selection toolbar, строки Command palette, кнопки шапки Browser-а, кнопки Session
   panel и sidebar-а.
2. **Одно общее правило курсора.** В базовом stylesheet (`src/renderer/theme/tokens.css` или
   `primitives.css`) одно правило ставит `cursor: pointer` всем элементам из шага 1. Отключённые
   (`:disabled`, `[aria-disabled=true]`) — `cursor: default` (или `not-allowed`, одно значение для
   всего приложения). Поля ввода текста (`input` текстовых типов, `textarea`, `contenteditable`)
   оставляют курсор text. Ручные `cursor: pointer`, которые повторяют общее правило, убрать.
3. **Не сломать курсоры Canvas.** Пустое место Canvas и области перетаскивания Node-ов держат свои
   курсоры (grab, grabbing, move — `src/renderer/canvas/canvas.css:85` и правила React Flow); рамки
   resize — свои. Общее правило не перебивает их: например, через `:where(...)` с нулевой
   специфичностью.
4. **Hover и focus-visible.** У каждого кликабельного элемента есть видимый hover и `:focus-visible`,
   которые читаются как «можно нажать» (смена фона или рамки из токенов темы, одинаковая по
   приложению). У элементов, которые не нажимаются (подписи, статичные chips, текст статуса), нет
   hover-эффекта, похожего на кнопку. Отключённая кнопка не меняет вид при наведении.

## Тесты

- Тест, который охраняет правило: e2e, который для набора кнопок из каждой области (шапка Node-а,
  selection toolbar, Command palette, sidebar, Session panel, шапка Browser-а, Settings) проверяет
  `getComputedStyle(el).cursor === 'pointer'`; для отключённой кнопки — не `pointer`; для поля ввода —
  `text`; для пустого места Canvas — `grab`. Или unit, который считает computed styles на образцах
  элементов с подключёнными CSS-файлами renderer-а.
- Тот же тест проверяет, что у статичного chip-а и подписи hover не меняет фон.

## Платформа

Изменения только в CSS, веток по платформе нет: вердикт Windows, скорее всего, только runner
(`scripts/windows-verdict-scope.mjs` решает по списку изменённых файлов). Особых замечаний для
Windows нет.

## Готово, когда

- [ ] В «Итоге» — список случаев из аудита по областям.
- [ ] Курсор pointer задаёт одно общее правило в базовом stylesheet; ручных дублей `cursor: pointer`
      не осталось (их число в `src/renderer` указано в «Итоге» до и после).
- [ ] Наведение на любую кнопку из списка шага 1 показывает pointer; на отключённую — не pointer; поле
      ввода — курсор text.
- [ ] Пустое место Canvas — grab, перетаскивание Node-а и рамки resize — свои курсоры, как до
      изменения.
- [ ] У каждого кликабельного элемента есть видимый hover и `:focus-visible`; у некликабельных нет
      hover-эффекта кнопки.
- [ ] Тест из раздела «Тесты» зелёный и краснеет, если убрать общее правило.

## Итог

Ветка `worfy-ui/27`. Аудит сделан двумя способами: чтением CSS и inline-стилей renderer-а и временным
e2e-обходом собранного приложения (светлая и тёмная тема): в каждом состоянии — Canvas, выделенная
Note, Focus mode, Pipeline, Command palette, все разделы Settings, Session view — для каждого
видимого элемента-контрола записаны computed `cursor` и вид до и под указателем. Обход в репозиторий
не вошёл; охраняющий test — `test/e2e/controls.spec.ts`.

### Аудит: что было до изменения

**Нет pointer** (явный `cursor: default` у кнопки или курсор от `body`):
- Sidebar: «Add project», строки `.w-row` (проекты, разделы Settings, пункты меню).
- Toolbar: `.w-toolbar__icon-button` (Hide sidebar, Install Harness), `.w-segmented__item` (Canvas / Pipeline).
- Шапка Node-а: `.w-terminal__button` (явный `default`).
- Шапка Browser-а: `.w-browser-frame__nav-button`, `__open-button`, `__profile` (явный `default`).
- Selection toolbar: кнопка Focus (`.w-focus-entry`).
- Settings: `.w-setting-switch`, все `.w-action` (явный `default`: Close, Sign in…, действия Epic frame, Run wave и др.), `.w-select` и строки списка `.w-select-option` (явный `default`).
- Session view: `.w-session__button` (явный `default`; Back, Hide tools), `.w-composer__attach`, pickers (`.w-select`), `.w-tr__earlier-button`, `.w-tr__fold-line` (явный `default`), `.w-tr__tool-line`, `.w-slash__item` (явный `default`), `.w-permission__button`, `.w-primary`.
- Epic frame и Focus mode: `.w-epic__button`, `.w-focus__button`, `.w-focus__icon-button`.

**Отключённые**: курсор был разный — `default` (done shelf chip, Resume в архиве, вариант вопроса,
selection toolbar, Transcript у Subagent, строка Subagents rail, Resume в истории, неактивная строка
palette) или `not-allowed` (действия на read-only экране, F-SPEC). Теперь у всех `not-allowed`.

**Нет видимого hover**: toggle разделов sidebar, «Add project», текущая строка проекта, текущий
segment, palette trigger, New conversation у Orchestrator, Trash, Pin и Delete selection toolbar,
строки Command palette, switch в Settings, Hide tools и Attach files в Session view; по чтению CSS —
`.w-archive__button`, `.w-archive__action`, `.w-badge-button`, `.w-browser-frame__asleep`,
`.w-composer__send`, `.w-epic__stack`, `.w-permission__button`, `.w-primary`, кнопка-chip вопроса,
`.w-queue__chip`, `.w-select-option`, `.w-selection-toolbar__tag-remove`, `.w-session__button`,
`.w-tr__fold-line`, `.w-tr__tool-line`, `.w-trash__restore`; строки sidebar с inline `background`
(Sessions, Epics, ADR) — inline-стиль перебивал `.w-row:hover`.

**Hover-правило без исключения для отключённых** (отключённая кнопка меняла бы вид под указателем): `.w-row` (неактивные пункты Canvas menu), `.w-shelf__chip`,
`.w-question__option`, `.w-epic__button`, `.w-focus__button`, `.w-focus-entry`, `.w-focus__icon-button`,
`.w-terminal__button`, `.w-toolbar__icon-button`, `.w-session-find__button`,
`.w-browser-frame__open-button`, `.w-browser-frame__profile`.

**Hover или pointer у некликабельного**: строки архива (`.w-archive__row`) и корзины
(`.w-trash__entry`) — `li` с фоном при наведении, нажимается только кнопка в строке; панель ADR
(`section role=dialog`) целиком с `cursor: pointer`; фон selection toolbar между кнопками — pointer,
унаследованный от pane React Flow.

**Нет своего `:focus-visible`** (было только кольцо браузера): `.w-action`, `.w-epic__button`,
`.w-focus__*`, `.w-terminal__button`, `.w-toolbar__icon-button`, `.w-trash__*`,
`.w-selection-toolbar__*`, `.w-select-option`, palette trigger и все кнопки с inline-стилями.

### Что сделано

- `src/renderer/theme/tokens.css` — правила контролов (`:where(...)`, нулевая специфичность): pointer;
  hover — полупрозрачная вуаль `--hover-veil` (inset box-shadow `--hover-shadow`, видна и поверх
  inline `background`); `:focus-visible` — кольцо `2px var(--accent)`; отключённые
  (`:disabled`, `[aria-disabled=true]`) — `not-allowed` и без вуали. Поля ввода текста в список не
  входят и держат курсор браузера (text).
- Ручных `cursor: pointer` в `src/renderer` было **44** (25 в CSS, 19 inline в `.tsx`), стало **1** —
  общее правило; плюс `cursor: pointer` миникарты (`minimap.css`, это `div` React Flow, не контрол из
  списка). Убраны и явные `cursor: default` у кнопок, и дубли курсора у отключённых.
- Компоненты со своим box-shadow получили hover «своя тень + вуаль»: `.w-primary`, текущий segment,
  Trash, Archive, `.w-session__button`, `.w-composer__send`, done stack Epic frame.
- Hover-правила компонентов не срабатывают на отключённых (`:where(:not(:disabled, [aria-disabled='true']))`).
- У строк архива и корзины hover убран; у панели ADR — pointer; фон selection toolbar — `default`.
- Контраст вуали: `test/unit/contrast.test.ts` — фон под вуалью отличается от фона не меньше 1,07:1,
  текст на нём держит 4,5:1, в обеих темах (светлая — 4 % чёрного, тёмная — 6 % белого).

### Canvas

Пустое место Canvas до изменения — **не grab, а pointer**: Canvas работает в режиме выделения
перетаскиванием (`selectionOnDrag`, `panOnDrag={[1]}`), и React Flow ставит pane-у
`.react-flow__pane.selection { cursor: pointer }`. Курсоры Canvas не тронуты: test проверяет, что
pane остался pointer, заголовок Note — grab, текст Note — text. Вопрос владельцу: оставить pointer на
пустом Canvas или поставить `default` (pointer там — тот же «ложный» сигнал, на который жалоба).

### Проверки

- `test/e2e/controls.spec.ts` (светлая и тёмная тема): pointer и смена вида под указателем у
  контролов sidebar, toolbar, шапки Node-а, шапки Browser-а, selection toolbar, Settings, Session view;
  Back Browser-а без истории — `not-allowed` и без смены вида; статус Orchestrator и заголовок раздела
  Settings — без pointer и без смены вида; поле palette, текст Note и поле сообщения — text; кольцо
  фокуса с клавиатуры; обход всех видимых контролов в каждой области — pointer или `not-allowed`.
- Mutation testing: удалить правило pointer, вуаль, правило `not-allowed` или кольцо фокуса — test
  красный в каждом случае.
