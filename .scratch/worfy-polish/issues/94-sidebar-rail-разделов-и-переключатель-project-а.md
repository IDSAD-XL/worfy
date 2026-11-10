# 94 — Sidebar: rail разделов, одна панель и переключатель Project-а «All» / один Project

Type: feature
Status: claimed 2026-11-10T13:46Z
PR: —
Branch: worfy-polish/94
Blocked by: —
Source: владелец 2026-11-10, снимок Stable и выбор варианта C прототипа (Card `card-d8349882`).

## Что происходит

Владелец о sidebar на снимке Stable: «читается плохо, и в верхнем левом углу пустое место; переделай вид и функцию,
красиво и стильно». Сейчас sidebar — столбец из семи секций одна под другой (Projects, Machines, Epics, Pipeline,
Pull requests, Sessions, ADR), каждая сворачивается заголовком; полоса под traffic lights пустая, кнопка sidebar
стоит в toolbar.

По прототипам (Card с тремя вариантами) владелец выбрал **вариант C**: узкая rail с иконками разделов и badges, справа
одна панель, которая показывает один раздел. Поверх C владелец добавил:

> «сверху всё ещё должен быть свитчер по проектам с возможностью выбрать «Все» или один какой-то конкретный. Он,
> соответственно, будет менять контент внутри сайдбара, чтобы у юзера был выбор, смешивать информацию о всех проектах в
> отображении или нет.»

## Что делаем

1. **Каркас варианта C.** Sidebar шириной 264 px: верхняя полоса высотой toolbar-а (место traffic lights, кнопка
   sidebar, переключатель Project-а), под ней rail 48 px с кнопкой на каждый раздел (иконка, badge, accent-полоса у
   выбранного) и панель: заголовок раздела, подпись области («All Projects» / имя Project-а), кнопки раздела, список.
   Внизу rail — Machines. Выбранный раздел помнится.
2. **Переключатель Project-а** в верхней полосе: «All» и каждый открытый Project. Секции, у которых данные всех
   Project-ов уже есть в renderer-е, фильтруются им. Секции, которым для всех Project-ов нужен новый IPC, в «All»
   показывают текущий Project с явной подписью; список таких секций и недостающего IPC — в «Итог».
3. **Кнопка sidebar** переезжает из toolbar в верхнюю полосу sidebar-а; когда sidebar скрыт, она в toolbar, как в
   прототипе. Cmd/Ctrl+B не меняется.
4. Всё из polish 98 остаётся: порядок Epic-ов по последней работе, возраст «3d», складка «Older · N» и её настройка.

## Готово, когда

- [ ] Фильтр переключателя и выбор раздела посчитаны чистыми функциями; unit test-ы на «All», один Project,
      Project, который закрыли, и сохранение выбора.
  - evidence: test-run pass · `pnpm test test/unit/sidebar-scope.test.tsx test/unit/epics-section-scope.test.tsx` exit 0 (in `pnpm test` exit 0) · mac - · 62c69717e
- [ ] Rail и панель: один раздел на экране, badges, клавиатура (стрелки по rail), имена для screen reader-а;
      unit test-ы sidebar-а обновлены там, где дизайн их меняет.
  - evidence: test-run pass · `pnpm test test/unit/sidebar-scope.test.tsx test/unit/sidebar-section.test.tsx test/unit/machines-section.test.tsx test/unit/focus-mode.test.tsx` exit 0 (in `pnpm test` exit 0) · mac - · 62c69717e
- [ ] Кнопка sidebar в верхней полосе sidebar-а, в toolbar — только пока sidebar скрыт; Cmd/Ctrl+B работает.
  - evidence: test-run pass · `pnpm test:e2e test/e2e/sidebar-rail.spec.ts test/e2e/focus-sidebar.spec.ts` exit 0 (in the 73-spec run, 243 passed) · mac dev · 62c69717e
- [ ] e2e spec rail и переключателя; все e2e spec-и, которые трогают sidebar, проходят.
  - evidence: test-run pass · `pnpm test:e2e` of the 73 specs that name the sidebar, show it with no Project or read the toolbar title, exit 0 after one fix of sidebar-rail.spec.ts, 243 passed · mac dev · 62c69717e
- [ ] Английская страница `docs/features/app-shell.md` (раздел Sidebar) и страницы секций описывают rail и
      переключатель; перевод `ru` не обязателен (`rules.md`, раздел «Язык»).
  - evidence: commit pass · Sidebar round 3: wordmark strip and a full-width Project switcher (worfy-polish 94) · - - · 62c69717e
- [ ] Снимки dev build-а: тёмная и светлая тема, «All» и один Project, fixture Project-ы.
  - evidence: owner-check pass · owner looked at the ten round-3 screenshots (both themes: Epics All and one Project, Sessions, Projects with a long name, open switcher menu) in Card «Sidebar polish 94» on 2026-11-10 and answered «принимаю» · mac dev · db33dd3d0c1b0da5322dfeead5595b8ca8f79472
- [ ] gate fast — exit 0; `ci-ok` на PR зелёный.
  - evidence: gate pass · `gate fast` exit 0 · mac - · 02c63b910

## Где в коде

- `src/renderer/shell/Sidebar.tsx` — каркас: верхняя полоса, rail (tablist), панель.
- `src/renderer/shell/ProjectSwitcher.tsx` — новый: переключатель Project-а.
- `src/renderer/shell/sidebar-scope.ts` — новый: ответ переключателя, открытый раздел, badges rail-а, их сохранение.
- `src/renderer/shell/registry.ts` — запись rail-а секции (`railTitle`, `RailIcon`, `railEnd`).
- `src/renderer/shell/SidebarSection.tsx`, `src/renderer/shell/sidebar-section.css` — рамка раздела в панели, без
  складки, с подписью Project-ов.
- `src/renderer/shell/sidebar/*Section.tsx` — иконки, порядок rail-а, badges, фильтр переключателя (Pipeline, Pull
  requests, Epics), подпись «только открытый Project» (Sessions, ADR).
- `src/renderer/shell/Toolbar.tsx`, `src/renderer/shell/AppShell.tsx`, `src/renderer/shell/sidebar-visibility.ts`,
  `src/renderer/shell/shell.css`, `src/renderer/theme/tokens.css` — кнопка sidebar, ширина 264 px.
- `test/unit/sidebar-scope.test.tsx`, `test/unit/epics-section-scope.test.tsx` — новые; `test/unit/sidebar-section.test.tsx`,
  `test/unit/machines-section.test.tsx`, `test/unit/focus-mode.test.tsx` — под новый дизайн.
- `test/e2e/sidebar-rail.spec.ts` — новый; `test/e2e/helpers.ts` и e2e spec-и, которые трогают sidebar.
- `src/shared/settings/app-settings.ts` — комментарий `sidebar.collapsed`.
- `.scratch/worfy-polish/issues/99-sidebar-all-для-sessions-adr-и-карточки-projects.md` — follow-up по IPC.
- `docs/features/app-shell.md` (раздел Sidebar), `docs/features/workflow.md`, `docs/features/pr-inbox.md`,
  `docs/features/projects.md`, `docs/features/link.md`, `docs/features/sessions.md`, `docs/features/focus-mode.md`,
  `docs/features/README.md`, `docs/features/product-session.md`.

## Итог

Код — ветка `worfy-polish/94`.

**Что изменилось.**
- **Каркас варианта C.** Sidebar шириной 264 px (было 240). Сверху полоса высотой toolbar-а: место traffic lights,
  кнопка «Hide sidebar», переключатель Project-а справа. Под ней rail 48 px — tablist «Sidebar sections» с кнопкой
  на каждый раздел (иконка, badge, accent-полоса у выбранного) и кнопкой Settings внизу. Справа одна панель: заголовок
  раздела, подпись области, ряд кнопок раздела, список. Порядок rail-а: Projects, Sessions, Pull requests, Pipeline,
  Epics, ADR, внизу Machines. Клавиатура — паттерн ARIA tabs: стрелки вверх/вниз, Home/End, roving tabindex, раздел
  открывается сразу при переходе (`src/renderer/shell/Sidebar.tsx`).
- **Запись rail-а секции.** Модуль секции может экспортировать `railTitle`, `RailIcon` и `railEnd`
  (`src/renderer/shell/registry.ts`); неверное значение — ошибка при сборе секций, как у `order`.
- **Badges** идут через store `setRailBadge` (`src/renderer/shell/sidebar-scope.ts`): Sessions — число live
  Session-ов, Pull requests — число групп «needs review / needs answer / needs fix», Pipeline — точка, когда есть
  Ticket-ы blocked или waiting, Machines — точка online / «certificate changed».
- **Переключатель Project-а** (`src/renderer/shell/ProjectSwitcher.tsx`): pill «Sidebar shows: …», меню
  `menuitemradio` — «All Projects» и каждый Project Machine-ы окна с веткой. Выбор Project-а открывает его
  (`openProject`); отказ показан строкой с role alert. Pipeline, Pull requests и Epics фильтруются им
  (`projectsInScope`). Epics в «All» — открытый Project первым, потом каждый другой с Epic-ами, под своим именем;
  клик по Epic-у другого Project-а открывает этот Project, потом центрирует Epic.
- **Sessions и ADR** в «All» показывают открытый Project и говорят об этом строкой
  «<имя> only: this list does not show other Projects.» (только когда Project-ов больше одного).
- **Сохранение.** Раздел и ответ переключателя — в localStorage окна (`worfy.sidebar.section`,
  `worfy.sidebar.scope`). Окно держит свой выбор, пока открыто; новое окно и перезапуск берут последний выбор любого окна.
- **Кнопка sidebar** — в верхней полосе sidebar-а; в toolbar только «Show sidebar», пока sidebar скрыт;
  View ▸ Toggle Sidebar и Cmd/Ctrl+B не менялись. В focus mode кнопка остаётся в полосе focus mode.
- **Sessions:** «New session» (главная, с выбором vendor-а) и «Product Session» стоят рядом в ряду под
  заголовком; в заголовке остались число live и History.
- Всё из polish 98 на месте: порядок по последней работе, «3d», «Older · N» per Project и её настройка.

**Что убрано или заменено.**
- Складка секций заголовком и её запись `sidebar.collapsed[<SectionId>]` в app settings: раздел теперь выбирают
  на rail-е. Старые записи остаются в файле и больше не читаются; складка «Older» Epics-а читается как раньше.
- Кнопка sidebar в toolbar, пока sidebar показан.
- Высоты секций 3–15 строк (`rowHeight`, `defaultCollapsed` у `SidebarSection`): раздел занимает всю панель.
- Видимая подпись «New Product Session» — теперь «Product Session»; имя для screen reader-а то же
  («New Product Session»).
- Две границы e2e из-за +24 px ширины: `codex-session.spec.ts` — ширина имени модели не меньше 12 px вместо 20
  на 1280 px; `session-controls.spec.ts` — Send на строке pickers с 1240 px вместо 1220.

**Решено без владельца.**
- Сохранение — per window через localStorage, а не per Project и не в app settings: открытый Project и так один
  на Machine, а выбор вида — дело окна.
- В «All» Projects-панель не фильтруется (это список Project-ов), Machines тоже.
- Badge Sessions — число live, а не busy, как в прототипе: busy по всем Session-ам renderer не знает без нового IPC.
- Панель Projects оставила существующие строки, а не карточки прототипа «N busy · N PR need you · N waits»:
  для них нужны живые данные каждого Project-а (тот же IPC, что ниже).
- Pill Machine-ы справа сверху прототипа заменён переключателем Project-а; Machines остаётся разделом rail-а.
- Settings — кнопка внизу rail-а (как в прототипе), открывает тот же диалог.

**Следующий шаг: IPC для «All» в Sessions и ADR** — отдельный Ticket worfy-polish 99 (Sessions и ADR по всем Project-ам, карточки Projects с живым состоянием, badge busy).
- Sessions: `claudeHome.live` / `claudeHome.sessions` берут один `projectRoot` и держат watcher до
  `claudeHome.close`; Session-ы worfy читаются из `layout.get` и `sessions.views` открытого Project-а. Нужен один
  сводный ответ main «live / busy Session-ы каждого Project-а» и путь renderer-а «открыть Project, потом Session».
  Тот же ответ даст карточки Projects и badge busy.
- ADR: `docs.open` per projectId держит watcher. Нужен разовый список ADR каждого Project-а без watcher-а.

**Test-ы, изменённые под дизайн.** Unit: `sidebar-section.test.tsx` (переписан: нет складки и высот),
`machines-section.test.tsx` (раздел на rail-е вместо складки, badge), `focus-mode.test.tsx` (первая кнопка
sidebar-а теперь tab rail-а). e2e: `sidebar-sections.spec.ts` переписан под rail; `helpers.ts` получил
`showSidebarSection`, `expandMachines` / `collapseMachines` идут через rail; остальные spec-и, которые трогают
sidebar, сначала открывают нужный раздел, `focus-sidebar.spec.ts` — tabs вместо складки.

**Раунд 2 (review #1786: REJECTED).**
- «Show sidebar» в toolbar исчезает при нажатии: теперь focus переходит на «Hide sidebar» в верхней полосе sidebar-а, а
  не на <body> (`SidebarFocusKeeper` в `src/renderer/shell/AppShell.tsx` ведёт оба направления). Focus, который был не на
  кнопке sidebar-а, остаётся на месте.
- Переключатель ставит «один Project» только после того, как Project открылся. При отказе остаётся прежний ответ.
  Ответ `openProject` на старый выбор (пользователь успел выбрать «All Projects») ничего не меняет.
- Без открытого Project-а Epics, Sessions и ADR показывают заголовок и строку «Open a Project to see its …»
  (`NoProjectSection` в `src/renderer/shell/SidebarSection.tsx`).
- Badge Sessions — число live в нейтральном тоне (`.cnt.muted` прототипа), а не в тоне working (busy).
- В tablist остались только tabs: Settings и промежутки вынесены из него; секции низа rail-а прижимает `margin-top: auto`.
- Chevron переключателя больше не сжимается при длинном имени Project-а.
- Комментарий `sidebar.collapsed` в `src/shared/settings/app-settings.ts`, страницы `link.md`, `product-session.md`,
  `sessions.md`, `app-shell.md` описывают новый sidebar.
- Скриншоты: к Epics («All» и один Project) добавлены Sessions со строкой «… only», Projects с длинным именем в pill и
  открытое меню переключателя; обе темы, pointer отведён.

**Раунд 3 (отзыв владельца на скриншоты, 2026-11-10).** Владелец: «вот сюда надпись Worfy, и сама кнопка сайдбара от
чего-то где-то… по центру. Некрасиво.» Он выбрал раскладку верха sidebar-а:
- строка 1 — полоса высотой toolbar-а, которая двигает окно: 80 px под traffic lights (только macOS; на Windows и Linux
  8 px), wordmark «worfy», кнопка «Hide sidebar» у правого края;
- строка 2 — переключатель Project-а на всю ширину sidebar-а (с боковыми отступами 8 px), chevron справа; длинное имя
  помещается целиком;
- дальше rail и панель, как были. Меню и строка отказа переключателя открываются под ним на всю его ширину.

**Решено без владельца (раунд 3).**
- Wordmark — текст «worfy» шрифтом интерфейса, 13 px, semibold, не ссылка: своего логотипа или wordmark-а в renderer-е
  нет (нет ни в Getting started, ни в About).
- Заголовок toolbar-а, пока sidebar показан, — только имя Project-а («No Project open», если Project не открыт): рядом
  с wordmark-ом «worfy» не повторяется. Пока sidebar скрыт, wordmark-а на экране нет, и заголовок по-прежнему
  «worfy — <Project>».
- Скриншот с рамкой окна (traffic lights) не сделан: Playwright снимает только содержимое окна, а снимать экран через
  систему агенту нельзя (правило ручных проверок step 6).

