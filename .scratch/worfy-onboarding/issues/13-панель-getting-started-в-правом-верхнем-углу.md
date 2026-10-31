# 13 — Панель Getting started в правом верхнем углу вместо раздела боковой панели

Type: task
Status: claimed 2026-10-31T00:18Z
Blocked by: —
Source: решения владельца 2026-10-31, Q11 (поправка spec-а, два Ticket-а в этом Epic-е), Q12 (место и размер панели, toast-ы её обходят), Q13 (слой панели, клики вне неё проходят, немодальная), Q14 (панель вместо раздела, свёрнутая — pill «Getting started · 3/6»), Q17 (существующий пользователь — без изменений); [spec.md](../spec.md), «Решения владельца 2026-10-31», «Тексты (черновик)», «Панель Getting started»

## Что происходит

- Getting started сейчас — раздел боковой панели `src/renderer/shell/sidebar/GettingStartedSection.tsx`
  (`export const order = 5`, `:43`; компонент — `:174`). Разделы находит `src/renderer/shell/registry.ts`
  по файлам, рамка — `src/renderer/shell/SidebarSection.tsx`. Тело раздела ограничено высотой 15 строк и
  прокручивается (`src/renderer/shell/sidebar-section.css:127-132`), поэтому шаг с подсказкой Stage-а,
  переключатель стоимости и пример доработки целиком не видны (Р10 spec-а уже сдвигал подсказку ради
  высоты раздела).
- В разделе: шесть шагов, кнопка у текущего (`actionOf`, `:243`), строка хода создания demo и ошибки,
  «Connect your own project», «Skip» (`:355`). Экран Done, переключатель стоимости и пример доработки —
  уже отдельные компоненты: `src/renderer/getting-started/DoneScreen.tsx`, `CostSwitch.tsx`,
  `ReviewExample.tsx`.
- Показан ли Getting started — `section: 'shown' | 'hidden'` в состоянии main
  (`src/shared/ipc/getting-started.ts:44`). Свёрнут ли раздел — app settings
  `sidebar.collapsed[GETTING_STARTED_SECTION_ID]` (`src/renderer/getting-started/store.ts:27`, `:76-84`).
  Открывает `openGettingStarted()` (`store.ts:76`); его зовут Command palette
  (`src/renderer/palette/commands.ts:312-320`), «Start Getting started» First run
  (`src/renderer/shell/FirstRun.tsx:52-58`) и «Open» уведомления существующему пользователю
  (`src/renderer/getting-started/notice.ts:29`).
- Существующий пользователь получает `section: 'hidden'` при первом чтении состояния (Р7 spec-а,
  `src/main/getting-started/state.ts`): раздел сам не открывается, только уведомление и Command palette.
- Toast-ы стоят в колонке у правого края под toolbar (`src/renderer/toast/toast.css:15-17`, z-index 120)
  и обходят элементы с `data-toast-keep-out` (`src/renderer/toast/ToastRegion.tsx:99`; место считает
  `src/renderer/toast/placement.ts`).
- Слои на `<body>`: First run — z-index 90 (`FirstRun.tsx:22`); Add project и Connect — 95
  (`src/renderer/shell/sidebar/ProjectsSection.tsx:58`, `src/renderer/projects/ConnectProject.tsx:65`);
  FolderBrowser — 96 (`src/renderer/projects/FolderBrowser.tsx:35`); Command palette — 100–101
  (`src/renderer/palette/CommandPalette.tsx:52`, `:68`); Settings — 110 (`SETTINGS_LAYER`,
  `src/renderer/settings/settings-window.ts:24`). Меню боковой панели и Canvas — тоже 90
  (`ProjectsSection.tsx:45`, `src/renderer/canvas/overlays/CanvasMenu.tsx:33`). Focus mode рисуется
  внутри своего stacking context-а в main area (`src/renderer/shell/shell.css:34-45`), поэтому слой на
  `<body>` выше него при любом z-index.
- Окна приложения монтируются в `src/renderer/shell/AppShell.tsx` (`<FirstRun />`, `:107`).

## Что делаем

1. `src/renderer/getting-started/GettingStartedPanel.tsx` (новый) — плавающая панель, `createPortal` в
   `<body>`. Место — правый верхний угол под toolbar (верх — `var(--toolbar-height)` и отступ, как у
   toast-ов). Ширина около 320 px. Высота — по содержимому, не больше 70 % высоты окна; внутренняя
   прокрутка появляется, только когда содержимое выше этого предела (маленькое окно). Монтируется в
   `AppShell.tsx` рядом с `<FirstRun />`.
2. В панель переезжает всё, что сейчас в разделе, с тем же поведением: шесть шагов и кнопка текущего,
   строка хода создания и ошибки, подсказки Stage-й, переключатель стоимости, пример доработки,
   «Connect your own project», «Skip», экран Done. Тексты — из spec-а, «Тексты (черновик)».
   `data-testid` остаются: панель — `getting-started`, шаг — `getting-started-step` с `data-step`.
3. Слой и клики (Q13): z-index панели ниже 90 — под First run, Add project, Connect, FolderBrowser,
   Command palette, Settings и меню; выше Canvas, Session-ов и боковой панели. Панель немодальная: без
   backdrop, фокус не держит, клики вне её прямоугольника доходят до того, что под ней. Корень —
   `role="region"` с `aria-label="Getting started"`, не `dialog`.
4. Toast-ы обходят панель (Q12): корень панели и pill несут `data-toast-keep-out`. `ToastRegion.tsx` и
   `placement.ts` не меняются: колонка toast-ов уже обходит такие элементы.
5. Свёрнутая панель (Q14) — pill «Getting started · <n>/6» в том же углу, `n` — число отмеченных шагов.
   Кнопка сворачивания — в заголовке панели, tooltip «Collapse». Щелчок по pill разворачивает панель.
   Свёрнутость хранится там же, где сегодня свёрнутость раздела (app settings,
   `sidebar.collapsed['GettingStartedSection']`, ключ прежний), и переживает перезапуск.
   `data-testid` pill — `getting-started-pill`.
6. `openGettingStarted()` (`store.ts:76`) показывает панель, разворачивает её и переводит фокус в её
   заголовок. Command palette «Getting started», «Start Getting started» First run и «Open» уведомления
   зовут его, как сейчас; их код не меняется. «Skip» — как сейчас: `section: 'hidden'`, нет ни панели, ни
   pill, toast `info` с текстом spec-а.
7. Существующий пользователь (Q17): когда есть Project, панель сама не открывается — это уже так по Р7.
   Условие не меняется, его закрепляет test.
8. Раздел боковой панели убирается: файл `GettingStartedSection.tsx` удаляется, registry перестаёт его
   находить сам. Комментарии про «раздел» в `store.ts`, `src/shared/ipc/getting-started.ts`,
   `src/renderer/getting-started/hints.ts` и `commands.ts` переписываются на «панель». Канал
   `gettingStarted` и main (`src/main/getting-started/`) не меняются.
9. Доступность: шаги — `ol`, как сейчас; pill и кнопка сворачивания — кнопки, доступны по Tab.

## Готово, когда

- [ ] Unit test панели: шаги 1–2 отмечены — кнопка у шага 3; `section: 'hidden'` — ни панели, ни pill;
      «Skip» зовёт `setSection hidden`; свёрнутая — только pill «Getting started · 2/6», щелчок по ней
      разворачивает панель.
- [ ] Unit test: при `section: 'shown'` в боковой панели нет раздела Getting started.
- [ ] e2e: свежая папка данных, `WORFY_GETTING_STARTED_AUTO=1` — панель в правом верхнем углу: верх ниже
      toolbar, правый край у правого края окна, ширина 320 px с допуском в несколько px; раздела в
      боковой панели нет. Дальше — сценарий Ticket-а 07: «Create demo project», «Open the
      Orchestrator» с готовым вопросом без отправки, «Skip», Command palette «Getting started».
- [ ] e2e: щелчок по Canvas и по кнопке toolbar рядом с панелью срабатывает — панель не перехватывает
      клики вне своего прямоугольника.
- [ ] e2e: First run, Command palette и Settings поверх панели (`document.elementFromPoint` в точке
      панели отдаёт элемент диалога).
- [ ] e2e: toast при открытой панели стоит ниже неё и её не перекрывает.
- [ ] e2e: окно 1200×900 — на шаге 3 с подсказкой и переключателем стоимости внутренней прокрутки нет;
      наименьшее окно worfy — высота панели не больше 70 % окна, содержимое прокручивается внутри.
- [ ] e2e: свернуть — pill «Getting started · n/6»; перезапуск — снова pill; Command palette «Getting
      started» — панель развёрнута.
- [ ] e2e: существующий пользователь (папка данных с Project-ом) — после запуска нет ни панели, ни pill;
      «Open» уведомления — панель открыта.
- [ ] Снимки в светлой и тёмной теме: панель с отмеченными шагами 1–2; шаг 5 с примером доработки;
      экран Done; pill; наименьшее окно.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
      `[gate] green (full)` (оркестратор перед merge).

## Тесты

- Unit `test/unit/getting-started-panel.test.tsx` (новый, вместо `test/unit/getting-started-section.test.tsx`),
  `test/unit/getting-started-notice.test.tsx`, `test/unit/first-run-concepts.test.tsx`,
  `test/unit/palette-commands.test.tsx`, `test/unit/sidebar-section.test.tsx`.
- e2e `test/e2e/getting-started.spec.ts` (`:103` меряет прокрутку `.w-sidebar-section__body`),
  `test/e2e/getting-started-entry.spec.ts`, `test/e2e/getting-started-hints.spec.ts`,
  `test/e2e/getting-started-done.spec.ts`, `test/e2e/sidebar-sections.spec.ts` (`EMPTY_ABOVE`, `:30`).
- Сначала падающий: unit test, где при `section: 'shown'` ждут панель `getting-started` вне боковой
  панели и pill после сворачивания.
- Прогнать все unit и contract test-ы модуля: `test/unit/getting-started-*.test.ts(x)`,
  `test/contract/getting-started-*.test.ts`, и перечисленные выше.

## Где в коде

- `src/renderer/getting-started/GettingStartedPanel.tsx` (новый)
- `src/renderer/shell/sidebar/GettingStartedSection.tsx` (удаляется)
- `src/renderer/shell/AppShell.tsx` (`:107`)
- `src/renderer/getting-started/store.ts` (`:27`, `:76-84`)
- `src/renderer/getting-started/hints.ts` (комментарий)
- `src/renderer/palette/commands.ts` (комментарий, `:312`)
- `src/shared/ipc/getting-started.ts` (комментарии, `:43`)
- `test/unit/getting-started-panel.test.tsx` (новый)
- `test/unit/getting-started-section.test.tsx` (удаляется)
- `test/e2e/getting-started.spec.ts`
- `test/e2e/getting-started-entry.spec.ts`
- `test/e2e/getting-started-hints.spec.ts`
- `test/e2e/getting-started-done.spec.ts`
- `test/e2e/sidebar-sections.spec.ts`

Только читать: `src/renderer/toast/ToastRegion.tsx`, `src/renderer/toast/placement.ts`,
`src/renderer/toast/toast.css`, `src/renderer/getting-started/DoneScreen.tsx`,
`src/renderer/getting-started/CostSwitch.tsx`, `src/renderer/getting-started/ReviewExample.tsx`,
`src/renderer/getting-started/notice.ts`, `src/renderer/shell/FirstRun.tsx`,
`src/renderer/shell/registry.ts`.

## Итог

- Панель — `src/renderer/getting-started/GettingStartedPanel.tsx` (файл раздела перенесён сюда, `git mv`):
  `createPortal` в `<body>`, z-index 80, `role="region"`, `data-toast-keep-out` у панели и у pill, высота до
  `70vh`, прокручивается только тело. Свёрнутость — прежний ключ `sidebar.collapsed.GettingStartedSection`;
  сворачивание и pill пишут его сами, `openGettingStarted()` больше не пишет app settings — панель
  разворачивает pill и переводит фокус в заголовок (`h2`, `tabIndex=-1`). Константа
  `GETTING_STARTED_SECTION_ID` переименована в `GETTING_STARTED_COLLAPSED_KEY` (значение то же).
- Файлы вне следа: `docs/features/onboarding.md` (английская страница фичи: панель вместо раздела; без
  этого `pnpm lint` красный — `check-feature-docs.mjs` ловил путь удалённого файла).
- e2e: `getting-started.spec.ts` — угол и ширина панели, нет раздела в боковой панели, клики рядом с
  панелью доходят до Canvas и toolbar, First run / Command palette / Settings поверх панели, окно 1200×900
  без прокрутки на шаге 4 с подсказкой и переключателем стоимости, наименьшее окно, pill и перезапуск;
  `getting-started-done.spec.ts` — toast удаления ниже панели; `getting-started-entry.spec.ts` —
  существующий пользователь без панели и pill, «Open» уведомления открывает панель.
