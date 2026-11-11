# Готовые UI-библиотеки для worfy: что заменить, сколько работы, что выиграем

Сводка темы `ui-overhaul`, 2026-11-11. Код: main `e66d9cf4f`. Все источники прочитаны 2026-11-11.
Подробности, команды подсчёта и ссылки — в пяти заметках агентов:

- [notes/inventory-overlays.md](notes/inventory-overlays.md) — dialog, popover, menu, tooltip, toast,
  Command palette, клавиатура и фокус;
- [notes/inventory-foundation.md](notes/inventory-foundation.md) — CSS, design tokens, controls, test-ы,
  прежние решения;
- [notes/libs-foundations.md](notes/libs-foundations.md) — Radix, Base UI, shadcn/ui;
- [notes/libs-focused.md](notes/libs-focused.md) — Sonner, Vaul, cmdk, NumberFlow, skill pick-ui-library;
- [notes/libs-showcase.md](notes/libs-showcase.md) — Beautiful UI, RareUI, Magic UI, Aceternity UI, 21st.dev.

Версии npm, notice в README Vaul, changelog shadcn и счётчики в коде я перепроверил сам. Остальное взято
из заметок.

## Коротко

1. Полный overhaul на shadcn/ui с Tailwind я не советую. Цена — переписать весь CSS worfy и сотни test-ов.
   Результат — внешний вид shadcn. Запрет `docs/design/BRIEF.md:88` копировать вид чужого продукта
   владелец 2026-11-11 отменил, но довод цены остаётся. Решения владельца — в [map.md](map.md).
2. Самописного в worfy много в поведении, а не во внешнем виде. Есть 19 модальных dialog без общего
   компонента. У 13 из них нет focus trap, у 12 фокус не возвращается. Ещё 11 popover и 11 menu со своим
   позиционированием. Tooltip нет вовсе: около 335 атрибутов `title`.
3. Внешний вид у worfy свой и уже собран в систему. Это 85 design tokens и спецификация вида F-SPEC.
   Цвета вне токенов почти не встречаются.
4. Стоит взять **Base UI** как слой поведения под свой CSS. Base UI — headless компоненты от MUI, их
   делают авторы Radix и Floating UI. Он стабилен с 2025-12, обновляется каждый месяц, Tailwind ему не
   нужен. С July 2026 он же стоит по умолчанию в shadcn/ui.
5. Sonner, cmdk и Vaul не нужны. Свои toast-ы уже доступны с клавиатуры и screen reader-а и умеют больше
   Sonner. cmdk с 2025-03 без release-ов. Vaul официально не поддерживается.
6. NumberFlow — по желанию, для меняющихся чисел. Готовые коллекции эффектов (Magic UI, Aceternity UI,
   RareUI, 21st.dev) для UI приложения не годятся. Beautiful UI полезен как образец для чата.
7. Объём пути с Base UI — примерно 15–20 Ticket-ов вместе с чисткой кнопок и chip-ов. Полный overhaul
   на shadcn — примерно 35–45. Оценка грубая, расчёт в разделе «Два пути».

## Как устроен UI worfy сейчас

**Стек.** React 19.3, Electron 44, Vite 7, React Flow 12, zustand (`package.json`). UI-библиотеки компонентов
нет, Tailwind нет, набора иконок нет: 95 inline `<svg>`.

**Стили.** 42 файла CSS на 12 478 строк, все стили глобальные. Порядок держит соглашение: 1 184 класса с
префиксом `w-` в стиле BEM. Рядом 1 038 inline `style={…}` в 102 файлах `.tsx`.

**Design tokens.** 85 CSS custom properties в `src/renderer/theme/tokens.css`, 64 из них переопределены
для dark. CSS читает их 2 575 раз, TSX — 1 501 раз. Вне `tokens.css` всего 30 hex и 18 rgb(a).

**Свой вид записан.** Это `docs/design/F-SPEC.md`, «Direction F — Native frame, Graphite instrument»:
- chrome как в macOS, системные шрифты;
- inline stroke icons;
- в dark нет теней, только рамки в 1 px.

К нему есть правила:
- `docs/design/BRIEF.md:86-88`: доступная разметка; «no AI tropes (gradient washes…)»; «Do NOT copy the
  look of any existing product». Запреты на AI tropes и на чужой вид владелец отменил 2026-11-11;
- ADR-0077 (цвета по типу Node-а): контраст 3:1 для нетекстовых элементов.

**Общих компонентов мало.**
- `Select`;
- `ActionMenu`;
- toast-система;
- hook `useDismiss`;
- `theme/primitives.tsx`: `StatusChip`, `ListRow`, `PrimaryButton`, `SegmentedControl`;
- `SettingSwitch`.

Остальное собрано в каждом месте заново.

| Часть | Сейчас | a11y |
|---|---|---|
| Модальные dialog | 19 реализаций, общего компонента нет; цвет backdrop скопирован в 17 файлов | partial: у 13 нет focus trap, у 12 нет возврата фокуса |
| Popover | 11 своих, общий только `useDismiss` | partial |
| Menu и context menu | 6 menu (в том числе «Modes») и 5 context menu в DOM | partial |
| Tooltip | своего нет, около 335 `title=` в 105 файлах | partial: с клавиатуры подсказка не видна |
| Toast | одна своя система | full |
| Command palette | своя, ranking общий с поиском по Canvas | partial: нет focus trap, `aria-modal`, возврата фокуса |
| Select | свой combobox | full |
| Кнопки | 7 копий primary, 4 danger, 6 одинаковых inline secondary, 10 link-style; высоты 20–28 px | full: нативные `<button>` |
| Группы | `SegmentedControl` и 3 копии, свои radio, 2 реализации tabs | стрелок нет у segmented control, у своих radio и у одних tabs |
| Chip и badge | около 15 своих компонентов | full |
| Числа | не анимируются, моноширинные цифры | — |

Источник таблицы: обе заметки inventory, сводки и разделы 1, 2, 4, 8.

**Позиционирование своё.** 52 вызова `getBoundingClientRect`. Переворачиваться вверх или вниз (flip)
умеют только `Select`, popover цитат и карточка Mind map. Единой шкалы z-index нет: 79 объявлений,
уровни от 20 до 3000.

**Клавиатура держится на соглашениях.** Центрального обработчика клавиатуры нет, `keydown` слушают 30
listener-ов. Модальность держат три guard-а на window в capture phase: Settings, Keyboard shortcuts и
Guide. Как закрывать по Esc, договорено через `preventDefault` и `defaultPrevented`. Фокус удерживают 8
listener-ов `focusin`. Подробно — inventory-overlays, раздел 10.

**Баги.** Из 147 commit-ов, которые трогали эти файлы, 17 исправляли поведение overlay. Повторяются две
темы:
- место и перекрытие: `Select`, selection toolbar ×4, toast-ы;
- порядок слоёв и клавиш под focus mode (×3).

**Test-ы.** 756 файлов vitest и 158 e2e specs. Элементы ищут в основном по `getByTestId` (5 145) и
`getByRole` (2 617). Классы `w-` встречаются 814 раз в 153 файлах test-ов. 18 unit test-ов читают сами
файлы CSS. В e2e есть 151 проверка вычисленного стиля и 389 проверок геометрии.

**Правила для зависимостей.**
- ADR об UI-библиотеке нет.
- Образец добавления пакета — ADR-0037 (раскладка рамки Epic-а через ELK): точная версия, лицензия
  записана, без install scripts.
- ADR-0090 (окно worfy Guide) отклонил библиотеку `motion`: «spec разрешает её только при заметной
  пользе».
- pnpm ставит версию не моложе суток.
- Лимита размера сборки нет, но есть бюджет старта 3 s (`test/e2e/start-budget.ts:6`).

**Cards** не делят с приложением ни стили, ни код. Библиотеку renderer-а внутри Card без шага сборки
не взять.

**Accessibility tooling** нет: ни `eslint-plugin-jsx-a11y`, ни axe.

## Библиотеки по одной

| Библиотека | Что это | Версия, дата | Для worfy |
|---|---|---|---|
| Base UI | headless компоненты, MUI | `@base-ui/react` 1.9.0, 2026-10-09 | **да**, как слой поведения под свой CSS |
| Radix | headless компоненты, WorkOS | `radix-ui` 1.8.1, 2026-10-12 | возможно, но слабее Base UI для нас |
| shadcn/ui | код компонентов на Tailwind v4, CLI копирует его в проект | CLI 4.23.0, 2026-10-27 | нет: нужен Tailwind и даёт чужой вид |
| Sonner | toast-ы | 2.0.8, 2026-08-09 | нет: свои toast-ы умеют больше |
| Vaul | drawer для телефона | 1.1.2, 2024-12-14 | нет: не поддерживается |
| cmdk | command menu (⌘K) | 1.1.1, 2025-03-14 | нет: стоит, тянет Radix, свой ranking всё равно нужен |
| NumberFlow | анимация смены чисел | `@number-flow/react` 0.6.2, 2026-07-18 | по желанию |
| pick-ui-library | skill со списком библиотек Emil Kowalski | commit 2026-11-09 | как справка; решение лучше записать в ADR |
| Beautiful UI | 21 компонент для интерфейсов агентов, MIT | repo с 2026-07 | как образец для чата, переносить в свой CSS |
| Magic UI | анимации для landing page | активен | нет для UI; Pro нельзя в публичный repo |
| Aceternity UI | эффекты для landing page | — | нет: нет открытой лицензии, слабая a11y |
| RareUI | декоративные эффекты | commit 2026-04-06 | нет |
| 21st.dev | marketplace компонентов разных авторов | — | только как каталог идей |

Все библиотеки из таблицы принимают React 19 в peer dependencies (npm registry).

**Base UI.**
- Stable с v1.0.0 (2025-12-11); за 12 месяцев 11 stable release-ов и 1 857 commit-ов.
- В команде авторы Radix (Colm Tuite, Jenna Smith) и Floating UI.
- Работает с обычным CSS и нашими классами. Состояние приходит в data-атрибутах (`data-open`,
  `data-checked`), место — в CSS variables (`--anchor-width`, `--available-height`).
- Есть Dialog, Alert Dialog, Popover, Menu, Context Menu, Tooltip, Select, Combobox, Tabs, Radio, Toggle
  Group, Switch, Slider, Meter, Toast, Drawer.
- Понимает `ownerDocument`, то есть другой document.
- Размер min+gzip: Dialog 20.9 KB, Menu 56.3 KB, весь пакет 166 KB. У Radix 13.2, 30.3 и 74 KB.
- Источник: libs-foundations, разделы 2 и 4.

**Radix.**
- Поддерживается, но 237 из 287 commit-ов за год сделал один человек.
- С 2025-08-13 по 2026-06-06 не было ни одного stable release.
- Combobox нет.
- Открыт [#4261](https://github.com/radix-ui/primitives/issues/4261): focus trap отбирает фокус у
  соседнего frame в Electron-приложении.
- shadcn пишет, что Radix не deprecated: «Radix is a mature, tested library»
  ([changelog](https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default)).

**shadcn/ui.**
- С July 2026 по умолчанию ставит Base UI: «Base UI is the default component library in shadcn/ui»
  (тот же changelog).
- Стек в проекте: Tailwind v4, `class-variance-authority`, `lucide-react`, `tw-animate-css`. Без
  Tailwind официально не работает.
- Скопированный код сам не обновляется. `shadcn add --diff` только показывает разницу.
- Автор признал, что приложения на shadcn стали выглядеть одинаково (libs-foundations, раздел 3).
- Tailwind v4 встанет рядом с нашим CSS только с `prefix(tw)`:
  - наш класс `.w-md` (`src/renderer/markdown/markdown.css:3`) совпадает с utility Tailwind `w-md`;
  - наш CSS не в `@layer`, поэтому перебивает любой слой Tailwind;
  - Preflight меняет `display` у `<svg>`.
- CLI определяет Vite по `vite.config.*`, а у нас файл `electron.vite.config.ts`.

**Sonner.**
- Совпадает с нашей системой: 3 toast-а на экране, 4 000 ms, пауза при наведении.
- Не умеет того, что есть у нас:
  - toast только в своём Project;
  - очередь sticky toast-ов сверх трёх;
  - раскладку в обход отмеченных областей и открытых меню;
  - `role="alert"` для ошибок.
- Добавляет горячую клавишу Alt+T на `document`.
- Открыты утечки памяти [#605](https://github.com/emilkowalski/sonner/issues/605) и
  [#782](https://github.com/emilkowalski/sonner/issues/782).
- Заменил бы только отрисовку, store остался бы своим.

**Vaul.** В README: «This repo is unmaintained» (https://github.com/emilkowalski/vaul). Автор делал
его для телефонов и планшетов. Если drawer понадобится, он есть в Base UI.

**cmdk.**
- Repo переехал в `dip/cmdk`. За 12 месяцев нет ни release, ни merged PR.
- Тянет 4 пакета Radix, virtualization нет.
- Свой фильтр `commandScore` пришлось бы заменить нашим ranking-ом, асинхронной группой
  «In transcripts» и неактивными строками с причиной.
- `vimBindings` по умолчанию включён, а на Windows и Linux Ctrl+K открывает саму палитру.

**NumberFlow.**
- Активен: 7 release-ов за год.
- Это custom element с shadow DOM, анимация через Web Animations API, `prefers-reduced-motion`
  учитывается по умолчанию.
- Где пригодился бы: проценты limits, context meter, стоимость.
- Сам Emil Kowalski советует анимировать число, только когда значение правда изменилось, и не
  анимировать Command palette (libs-focused, раздел emilkowalski/skills).

**pick-ui-library**
([SKILL.md](https://github.com/emilkowalski/skills/blob/715c1807e08c497cfd1dc4feb450a2a3300ef2a9/skills/pick-ui-library/SKILL.md)).
- Список из одной библиотеки на задачу. Для primitives — base-ui. Ещё cmdk, Sonner, NumberFlow, motion,
  Virtuoso, zustand, clsx и cva.
- Radix и shadcn не упомянуты.
- Ставится в `.claude/skills/`, вызывается только явно (`/pick-ui-library`).
- Ограничений worfy skill не знает: Electron, свой CSS, уже готовые свои toast-ы и палитра.

**Beautiful UI.**
- 21 компонент под MIT для интерфейсов агентов: Thinking, Streaming Text, Tool Chips, Approval Card,
  Prompt Bar, Diff Table, Selection Actions.
- Нужен Tailwind v4 и общий `foundation.css`, который меняет стили `html` и `body`.
- Иконки Sidebar Nav платные.
- Годится как образец для chat Session, если переносить в свой CSS.

**Magic UI, Aceternity UI, RareUI, 21st.dev.**
- Почти всё здесь — эффекты для landing page.
- Доля компонентов, похожих на UI приложения: Magic UI 8 из 79, Aceternity около 16 %, RareUI 4 из 21.
- Платные уровни Magic UI и Aceternity нельзя положить в публичный repo.
- У Aceternity нет открытой лицензии. Его modal без роли dialog, Esc и focus trap.
- В 21st.dev лицензию выбирает автор. В выборке из 40 компонентов у 8 пригодной лицензии нет.
- Такие эффекты противоречили `BRIEF.md:87`, но этот запрет владелец отменил 2026-11-11. Для Guide ADR-0090
  уже отказался от `motion`.

## Что можно заменить и чем

| Наша часть | Чем заменить | Что выиграем | Цена и риск |
|---|---|---|---|
| 19 модальных dialog и 4 inline `alertdialog` | Base UI Dialog, Alert Dialog | focus trap и возврат фокуса везде; меньше копий Esc и backdrop | три guard-а (Settings, Shortcuts, Guide) переносить одним шагом, иначе два focus trap спорят |
| 11 popover и hover card | Base UI Popover, Preview Card | flip и сдвиг у края окна, одно поведение outside click | клик внутри `<webview>` до document не доходит ([Base UI #5410](https://github.com/mui/base-ui/issues/5410)) |
| 6 menu и 5 context menu в DOM | Base UI Menu, Context Menu | typeahead, стрелки, подменю, место у края | menu открывается на press и мешает drag ([Base UI #6150](https://github.com/mui/base-ui/issues/6150)); Node-ы Canvas перетаскиваются |
| около 335 `title=` | Base UI Tooltip | подсказка видна с клавиатуры, своя задержка и вид | 335 мест; начать с 46 подсказок «почему неактивно» (`writeAction`) |
| `SegmentedControl` и 3 копии, свои radio, tabs в `DetailPanel.tsx` | Toggle Group, Radio Group, Tabs | стрелки и roving focus | мало |
| Command palette | Base UI Dialog как оболочка, ranking свой | focus trap, `aria-modal`, возврат фокуса | мало |
| `Select` | Base UI Select или Combobox | почти ничего: наш уже full | лучше не трогать |
| Toast-ы | Sonner | почти ничего | потеря своих правил, Alt+T, утечки |
| Меню приложения, 8 native-диалогов, OS notification | — | — | web-библиотека их не заменит |
| Selection toolbar и кнопка Focus на Canvas | — | — | своя раскладка внутри zoom, библиотека не заменит |
| Кнопки и chip-ы | свой `Button` и `Chip` с вариантами, без библиотеки | один вид и одна высота | свои 2 Ticket-а |

## Два пути и их объём

**Путь A: полный overhaul на shadcn/ui с Tailwind.** shadcn сам стоит на Base UI. Поэтому путь A — это
весь путь B и ещё:
- Tailwind v4 с `prefix(tw)` и решение о Preflight: 1–2 Ticket-а;
- перевод 42 файлов CSS (12 478 строк) и 1 038 inline styles на utilities: по области приложения на
  Ticket, около 15–20;
- переделка test-ов: 814 ссылок на классы в 153 файлах, 18 test-ов, которые читают CSS, 540 проверок
  стиля и геометрии в e2e;
- приёмка нового вида владельцем по каждой области.

Итого около 35–45 Ticket-ов. Вид в конце будет как у shadcn. Чтобы сохранить F-SPEC, каждый
скопированный компонент придётся перекрашивать.

Честный плюс пути A: агенты хорошо знают shadcn и Tailwind, и код из 21st.dev и Magic UI можно будет
вставлять почти как есть. Сколько времени сейчас уходит на новые экраны, неизвестно: такой метрики нет.

**Путь B: Base UI под свой CSS.** Набросок epic-а, имя условное:

| # | Ticket | Объём |
|---|---|---|
| 1 | Spike: Base UI Dialog, Popover, Menu, Tooltip рядом с xterm и `<webview>`, в Node Canvas, под focus mode; размер сборки и бюджет старта 3 s | 1 |
| 2 | ADR о выборе и правилах обёрток; шкала z-index в `tokens.css`; один helper «открытые слои»; проверка `defaultPrevented` в Esc поля ввода (`MessageInput.tsx:344`); закрытие по blur окна | 1–2 |
| 3 | Обёртка Dialog; Settings, Keyboard shortcuts и Guide одним шагом, без трёх guard-ов | 1–2 |
| 4 | Остальные 16 dialog и 4 `alertdialog`, пачками по областям | 3 |
| 5 | Обёртка Popover; 11 popover и hover card | 2 |
| 6 | Обёртки Menu и Context Menu; `ActionMenu`, «Modes», 4 menu, 5 context menu | 2 |
| 7 | Command palette в обёртке Dialog | 1 |
| 8 | Обёртка Tooltip; сначала 46 подсказок «почему неактивно» и кнопки-иконки | 1–2 |
| 9 | Toggle Group, Radio Group, Tabs вместо своих групп | 1 |

Итого 13–16 Ticket-ов. Без библиотеки к ним хорошо ложатся ещё два шага:
- свои `Button` и `Chip` с вариантами — 2 Ticket-а;
- `eslint-plugin-jsx-a11y` и проверка axe в e2e — 1 Ticket.

Вместе 15–20.

**Путь C: ничего не брать.** Можно только почистить своё: кнопки, chip-ы, стрелки в группах, focus trap
в 13 dialog. Это 4–6 Ticket-ов. Дублей поведения останется столько же, а новые dialog и popover так и
будут копировать код друг у друга.

## Что выиграем и что потеряем на пути B

Выиграем:
- работу с клавиатуры и screen reader-ом во всех dialog, menu и popover: focus trap, возврат фокуса,
  стрелки, typeahead, tooltip с клавиатуры;
- меньше багов места и перекрытия — самой частой темы исправлений overlay;
- одну модель Esc и слоёв вместо 30 listener-ов и трёх guard-ов;
- новые dialog и menu собираются из готовой обёртки, а не копией соседнего файла;
- внешний вид не меняется: F-SPEC и tokens остаются.

Потеряем или заплатим:
- новую зависимость с ежемесячными release-ами; её надо обновлять;
- десятки килобайт в сборке, влияние на старт не измерено;
- правки test-ов: 105 файлов unit и contract импортируют модули этих компонентов, 86 из 158 e2e specs
  находят их по роли или `data-testid`. Где роль и `data-testid` сохранятся, test-ы выживут. Проверки
  классов и геометрии придётся править;
- риски Electron, которые надо проверить в spike: клик в `<webview>`, фокус рядом с xterm, drag Node-а с
  кнопкой menu, Esc под focus mode.

## Чего мы не знаем

- Аналитики нет. Сколько пользователей работает с клавиатуры или со screen reader-ом, неизвестно.
- Как Base UI ведёт себя с `<webview>` и xterm, вживую не проверено. Issue на GitHub описывают iframe, а
  `<webview>` — отдельный процесс.
- Размер сборки и время старта с Base UI не измерены.
- Сколько времени сейчас уходит на UI новых функций — метрики нет.
