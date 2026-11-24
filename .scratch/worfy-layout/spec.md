# worfy-layout: View button-ы в header, на rail и в footer — расстановка перетаскиванием, footer с chip-ом версии

Status: черновик 2026-11-24. Решения владельца Q1–Q14 (grilling 2026-11-24 вечером) приняты и здесь не пересматриваются.
Дальше по Q8: critic → приёмка spec-а владельцем → Wave-ы; приёмка `worfy-acceptance` 10 этот Epic не держит.
Critic: [docs/product/critic/worfy-layout-2026-11-24.md](../../docs/product/critic/worfy-layout-2026-11-24.md) — Keep;
возражения 1 (`inert` в focus mode — Ticket 04) и 2 (бейджи Pull requests и Pipeline — Ticket 04) приняты, альтернатива
(делить 04 сразу) — нет: 04 делится, только если PR больше примерно 600 строк.
Source: скриншот владельца 2026-11-24 ~18:45 — шесть вкладок View switch не помещаются в header, «Can…» обрезан.
Владелец выбрал вариант 3 (часть кнопок уходит из header) со своим дизайном: footer, кнопки видов переносятся между
header, rail и footer перетаскиванием с подсветкой зон. Запись решений Orchestrator-а 2026-11-24 (вне репозитория).
[CONTEXT.md](../../CONTEXT.md) — термины Canvas, Layout, Session view, Pipeline, Run history, PR inbox, Acceptance,
Stable copy, Update, Available update, Harness, Machine, Linked machine, Health check, Settings.
Зависит от: [worfy-ui-kit](../worfy-ui-kit/spec.md) — ContextMenu, Popover, Tooltip, ToggleGroup
([ADR-0106](../../docs/adr/0106-base-ui-kit.md)); [worfy-update](../worfy-update/spec.md) — chip версии, toast-ы
Update; [worfy-acceptance](../worfy-acceptance/spec.md) — вид Acceptance и его счёт Ready to check (Ticket 10 приёмки
этот Epic не держит, Q8); [worfy-link](../worfy-link/spec.md) — маршрут каналов `local`.
Ticket-ы: Epic `worfy-layout`, 8 Ticket-ов в 6 Wave-ах, нумерация с `01`; файлов Ticket-ов ещё нет.

## Проблема

- В header шесть вкладок View switch: Canvas, Session, Pipeline, Runs, Pull requests, Acceptance
  (`viewOptions`, `src/renderer/shell/Toolbar.tsx:34-120`; `SegmentedControl`, `:165-174`). Рядом — заголовок Project-а,
  Limits (`toolbar/LimitsMeter.tsx`, `order` 100), колонка Harness в три строки (`toolbar/HarnessStatus.tsx`, `order`
  500; `shell.css:456-470`) и поле Command palette.
- Уже при 1400 px вкладки теряют подписи (`shell.css:376-383`), при 1100 px ужимаются Limits и поиск, а колонка Harness
  обрезается многоточием (`shell.css:384-407`). На скриншоте владельца при шести вкладках обрезан даже заголовок.
- Имена видов записаны дважды: в `viewOptions` и в `VIEW_NAMES` (`src/renderer/shell/AppShell.tsx:80-89`). Строки
  View в Command palette — третья копия (`viewCommands`, `src/renderer/palette/commands.ts:401-545`), и строки для
  Pipeline там нет.
- Footer нет: окно — ряд из sidebar и main area (`.w-shell`, `shell.css:3-7`).
- Расстановку видов нельзя поменять: какой вид важен, решает код, а не человек.

## Решение

- Кнопка вида — **View button** — одна из шести: Canvas, Session, Pipeline, Runs, Pull requests, Acceptance (Q2 (а)).
  Двигаются только они; секции rail, заголовок Project-а, Limits и поиск остаются на месте.
- Три зоны: **Header** (группа видов, как сейчас), **Sidebar** (блок под секциями rail, Q9, Q11), **Footer** (полоса
  ~28 px внизу окна, кнопки слева, Q7). По умолчанию (Q1, Q12): Header — Canvas, Session; Sidebar — Pull requests,
  Acceptance; Footer — Pipeline, Runs.
- Перенос и порядок: drag с подсветкой зон и точкой вставки (Q3, Q4); правый клик — «Move to → Header / Sidebar /
  Footer»; клавиатура. «Reset layout» — в меню кнопки и в Settings (Q6). Прятать кнопки нельзя (Q6).
- Расстановка одна на приложение этой Machine (Q5, «пока да»), хранится в app settings этого компьютера, и окно Linked
  machine показывает её же (Q13).
- Колонка Harness уходит из header. Справа в footer — компактный chip версии с точкой; клик открывает popover, где
  обновляются и приложение, и Harness (Q10, Q14).

### Набросок функции

**Путь владельца.**

1. Владелец обновил Stable copy. В header — заголовок Project-а, Canvas и Session с подписями, Limits, поиск. На rail
   под секциями — тонкая черта и две кнопки: Pull requests, Acceptance с бейджем. Внизу — footer: слева Pipeline и Runs,
   справа `v0.4.N` с янтарной точкой.
2. Владелец тянет Runs из footer в header. Пока он тянет, все три зоны подсвечены, а между Canvas и Session горит
   маркер вставки. Он отпускает — Runs стоит между ними, и в другом окне worfy тоже.
3. Правым кликом по Acceptance на rail он выбирает «Move to → Footer». Кнопка уходит в footer и несёт бейдж с собой,
   фокус остаётся на ней.
4. На кнопке в footer он жмёт ⌥← — Acceptance встаёт левее Pipeline.
5. Клик по chip-у версии открывает popover: версия и Update worfy, строка Harness с Update Harness, строка Codex,
   память. Esc закрывает его.
6. Если что-то пошло не так — «Reset layout» в меню любой View button или в Settings → General возвращает расстановку
   по умолчанию.

**Экран по умолчанию** (окно 1600 px; цифры и версии выдуманы).

```text
┌─ ● ● ●  worfy        ⇤ ┬─ worfy-app · main ── [▦ Canvas][▭ Session] ─────── Limits 5h ▮▮▯ 62% ─ [⌕ Search or run… ⌘K] ┐
│ [ All Projects ▾ ]     │                                                                                              │
├──┬─────────────────────┤                                                                                              │
│▣ │ Projects            │                                                                                              │
│◎ │  …                  │                            main area: Canvas                                                 │
│⑂ │                     │                                                                                              │
│☑ │                     │                                                                                              │
│▥ │                     │                                                                                              │
│≡ │                     │                                                                                              │
│Ⓐ │                     │                                                                                              │
│──│  ← черта блока View button-ов                                                                                     │
│⑂·│  ← Pull requests view (бейдж 2)                                                                                   │
│☑3│  ← Acceptance view (бейдж 3)                                                                                      │
│  │                     │                                                                                              │
│♥ │                     │                                                                                              │
│▢ │ (Machines)          │                                                                                              │
│⚙ │                     │                                                                                              │
├──┴─────────────────────┴──────────────────────────────────────────────────────────────────────────────────────────────┤
│ [▥ Pipeline •] [◷ Runs]                                                                               [v0.4.2140 ●] │
└───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Во время drag** (тянем Runs из footer; рамки зон подсвечены, `┃` — маркер вставки).

```text
header:  worfy-app · main  ╔[▦ Canvas]┃[▭ Session]╗   Limits …   [⌕ Search or run…]
rail:    ║ ⑂ ║                      ← зона Sidebar подсвечена
         ║ ☑ ║
footer:  ╔[▥ Pipeline] [◷ Runs]╗                                         [v0.4.2140 ●]
```

Пустая зона во время drag показывает место размером с одну кнопку — «Drop here»; без drag пустая зона ничего не
рисует.

**Меню View button** (правый клик, клик двумя пальцами на touchpad или Shift+F10).

```text
┌ Move to            ▸ ┐┌ ✓ Header  ┐
│──────────────────────││   Sidebar │
│ Reset layout         ││   Footer  │
└──────────────────────┘└───────────┘
```

**Popover chip-а версии** (открывается вверх от chip-а).

```text
┌──────────────────────────────────────────────────────┐
│ worfy v0.4.2140 · update v0.4.2152 ready             │
│                [ Restart now ] [ What's new ]        │
│──────────────────────────────────────────────────────│
│ Harness 1.8.0 → 1.9.0                 [ Update ]     │
│ Codex: approve hooks                  [ Open ]       │
│──────────────────────────────────────────────────────│
│ Memory 512 MB                                         │
└──────────────────────────────────────────────────────┘
```

**Окно 1100 px и уже**: header — только иконки видов; footer — только иконки с бейджем, подпись — tooltip; chip — только
версия.

## Истории пользователя

1. Как владелец, я хочу, чтобы в header было место для заголовка Project-а, Limits и поиска, и шесть вкладок его не
   съедали.
2. Как владелец, я хочу сам решать, где стоит каждая View button: в header, на rail или в footer.
3. Как владелец, я хочу перетаскивать кнопку и видеть, куда она встанет, до того как отпущу её.
4. Как владелец, я хочу переносить кнопки без мыши: меню «Move to» и клавиши.
5. Как владелец, я хочу одним действием вернуть расстановку по умолчанию.
6. Как владелец, я хочу видеть по точке на chip-е версии, что ждёт обновления приложение или Harness, и обновлять оба
   из одного popover.
7. Как владелец, я хочу, чтобы окно Linked machine выглядело так же, как мои окна на этом компьютере.
8. Как владелец, я хочу открыть любой вид из Command palette, где бы ни стояла его кнопка.

## Решения владельца (2026-11-24)

| Q | Решение |
|---|---|
| Q1 | В header остаются Canvas и Session; Pipeline и Runs по умолчанию — в новый footer; Pull requests и Acceptance — на rail. |
| Q2 | (а) Двигаются только шесть View button-ов; секции rail, заголовок Project-а, Limits и поиск остаются. |
| Q3 | Drag и правый клик «Move to → Header / Sidebar / Footer» (клавиатура и touchpad). |
| Q4 | Порядок внутри зоны — тем же drag; пока тянешь, зоны и точка вставки подсвечены. |
| Q5 | «Пока да»: одна расстановка на приложение этой Machine, не на Project. |
| Q6 | «Reset layout» в меню кнопки и в Settings; прятать кнопки в этом Epic-е нельзя; Command palette открывает любой вид. |
| Q7 | Footer ~28 px на всю ширину окна, кнопки слева (иконка, подпись, бейдж), версия справа, середина пустая. |
| Q8 | Spec → critic → приёмка владельцем → Wave-ы; приёмка `worfy-acceptance` 10 не держит Epic. |
| Q9 | View button на rail переключает main area (бейдж, активное состояние), от секций её отделяет тонкая черта. |
| Q10 | Колонка Harness в 28 px не влезает → компактный chip версии с точкой; клик — popover, где обновляются приложение и Harness. |
| Q11 | Один блок View button-ов в верхней группе rail, под секциями; нижняя группа (Machines, Health check, Settings) не меняется. |
| Q12 | View button Pipeline (tooltip «Pipeline board») по умолчанию в footer; секция rail Pipeline («Pipeline») остаётся. |
| Q13 | Расстановка всегда из app settings этого компьютера, и в окне Linked machine тоже. |
| Q14 | Точка chip-а: нет / янтарная (Update приложения или Harness) / красная (Harness нужны Install, Retry или Move). Строки popover: версия приложения и Update / Restart to update, состояние Harness и его кнопки, строка Codex, память. Esc и клик снаружи закрывают. Toast-ы Update не меняются. |

## Решения по реализации

Имена новых файлов — предложение.

- **Реестр видов** (`src/renderer/shell/views.tsx`). Один список на все восемь `ShellView` (`Toolbar.tsx:24`); он
  заменяет `viewOptions` и `VIEW_NAMES`, а строки View в Command palette строятся из него. У каждой записи:
  - `id` — значение `ShellView`; у Runs это `history`, как сейчас;
  - `area` — имя main area для `aria-label` (`Run history`, `Code story`, `Changes` — как в `VIEW_NAMES`);
  - `button` — только у шести View button-ов, у `story` и `changes` его нет:
    - `label` — видимая подпись: Canvas, Session, Pipeline, Runs, Pull requests, Acceptance;
    - `title` — tooltip: «Canvas», «Session view», «Pipeline board» (Q12), «Run history», «Pull requests of the open
      Project», «Checks that wait for you» (это tooltip вкладки Acceptance сейчас). Решено без владельца: у
      Pull requests и Acceptance tooltip-ы отличаются от одноимённых секций rail;
    - `Icon` — иконки из `viewOptions`, без изменений;
    - `needsProject` с причиной для tooltip-а неактивной кнопки: Runs — «Open a Project to see its Runs», Pull
      requests — «Open a Project to see its pull requests». Как сейчас (`Toolbar.tsx:79-80`, `:94-95`);
    - `useBadge()` — счёт или точка, tone и текст для tooltip-а и screen reader;
    - `open(project)` — по умолчанию `setView(id)` (`src/renderer/session/navigation.ts:46`). Runs — `openRunHistory(project.id)`
      (`Toolbar.tsx:170-173`), Acceptance — `openAcceptance()`, Pull requests — `openPrInboxOf(project.id, project.id)`,
      как строки palette сейчас.
- **Бейджи** — решено без владельца: бейдж считает то, что показывает сам вид.
  - Acceptance — счёт Ready to check по всем Project-ам (`useReadyCount`, `src/renderer/acceptance/useAcceptance.ts:131`),
    как сейчас на вкладке.
  - Pull requests — счёт pull request-ов открытого Project-а, которым нужен ты (группы `PR_NEED_YOU`, как у секции,
    `sidebar/PullRequestsSection.tsx:49`).
  - Pipeline — точка, пока Ticket открытого Project-а `blocked` или ждёт кого-то (правило секции,
    `sidebar/PipelineSection.tsx:52`).
  - Canvas, Session, Runs — без бейджа.
  - Счёт берётся из того же источника, что читает сам вид: виды смонтированы всегда (`AppShell.tsx:121-150`). Новых
    вызовов gh и git нет. `useRailBadge` секций (`sidebar-scope.ts:118-125`) для этого не годится: секции размонтированы,
    пока sidebar спрятан (`AppShell.tsx:115`).
- **Модель расстановки** (`src/shared/layout/view-buttons.ts`, без React).
  - `VIEW_BUTTON_IDS` — шесть id. `VIEW_ZONES = ['header', 'rail', 'footer']`.
  - `ViewButtons = { header: id[], rail: id[], footer: id[] }`. `DEFAULT_VIEW_BUTTONS`: header `canvas, session`; rail
    `pull-requests, acceptance`; footer `pipeline, history` (Q1, Q12).
  - Чистые функции: `repairViewButtons(raw)`, `moveWithin(layout, zone, from, to)`, `moveToZone(layout, id, zone,
    index?)` (без `index` — в конец зоны), `isDefault(layout)`.
  - Правило ремонта при чтении — решено без владельца. Неизвестный id (вид, убранный в новой сборке, или id из сборки
    новее) отбрасывается. Повтор id — первый остаётся. Отсутствующий id (вид, добавленный позже) встаёт в конец своей
    зоны по умолчанию. Не та форма — расстановка по умолчанию. Каждый из шести id всегда ровно в одной зоне (Q6: прятать
    нельзя).
- **Хранение** — app settings этой Machine (Q5).
  - Поле `viewButtons` в `appSettingsSchema` (`src/shared/settings/app-settings.ts:292`), необязательное: нет поля —
    расстановка по умолчанию, как у `productSession` и `prInboxNotify`. Строгая схема — `z.enum` id. Функция
    `viewButtonsOf(settings)`.
  - Файл читается мягко (`appSettingsFileSchema`, `src/main/settings/store.ts:128`): `z.unknown().transform(repairViewButtons)
    .optional().catch(undefined)`, как `autoContinue` (`:181-185`). Испорченное поле не делает весь
    `app-settings.json` unreadable и не сбрасывает остальные настройки.
  - Patch (`appSettingsPatchSchema`, `:348`): `viewButtons` — вся расстановка целиком или `null`. `null` — Reset layout:
    поле убирается. Store чинит пришедшую расстановку тем же `repairViewButtons`, `merge` (`store.ts:330`) и сравнение
    ревизий её знают.
  - Имя поля — не «layout», решено без владельца: в CONTEXT.md **Layout** — положение Node-ов на Canvas. Подпись UI
    «Reset layout» остаётся, как решил владелец (Q6): рядом с View button-ами она понятна.
  - Все окна этой Machine слышат перемену через `appSettings.changed` (`src/renderer/settings/useAppSettings.ts:41`).
- **Окно Linked machine (Q13) — нового пути чтения не нужно.** Каналы `appSettings.get`, `appSettings.set` и
  `appSettings.changed` помечены `local` (`src/shared/ipc/app-settings.ts:12-18`). Из окна Linked machine канал `local`
  идёт в main этого компьютера (`routeOf`, `src/renderer/ipc.ts:60-63`), не на Linked machine. Так что окно Linked machine
  уже читает и пишет app settings этого компьютера. Epic закрепляет это test-ом (раздел «Решения по test-ам») и
  комментарием у `viewButtonsOf`. Отдельный канал не вводится.
- **Отрисовка: одна кнопка, три вида** (`src/renderer/shell/ViewZone.tsx`, `ViewButton.tsx`).
  - Активное состояние — у кнопки открытого вида в любой зоне. У `story` и `changes` кнопки нет, и ни одна кнопка не
    активна.
  - **Header** — та же группа, что сейчас: kit ToggleGroup с видом `SegmentedControl`, `aria-label="View"`, иконка,
    подпись и бейдж. Порядок — из `viewButtons.header`. Бейдж Acceptance переезжает из `w-acc-tab__count`
    (`Toolbar.tsx:109-113`, `acceptance.css`) в общий вид бейджа. Нет кнопок — нет группы, заголовок Project-а
    остаётся.
  - **Sidebar (rail)** — блок `role="group" aria-label="Views"` под секциями верхней группы. Тонкая черта сверху (Q9),
    кнопка 34 × 34 px, как `w-sidebar__rail-button`, иконка 18 px, бейдж — `RailBadgeMark` (`Sidebar.tsx:44-54`),
    tooltip справа. Блок — не часть tablist секций (`Sidebar.tsx:267-269`): нажатие переключает main area, а не панель
    секции. По порядку CSS блок стоит после верхних секций и до Health check (`shell.css:100-113`, `order`).
    Отдельный Tab stop, ↑ и ↓ ходят внутри блока. Пустая зона — без черты и без блока. Rail уже прокручивается
    (`shell.css:88`): при шести кнопках на rail в окне 800×520 нижняя группа доступна прокруткой.
  - **Footer** — кнопки 22 px высотой: иконка 13 px, подпись, бейдж; `aria-label` — подпись, tooltip — `title`.
  - Неактивная кнопка (нужен Project) — тусклая, причина в tooltip-е, во всех трёх зонах.
- **Ширина окна** — решено без владельца.
  - Header: при 1–3 кнопках подписи видны до 1100 px. При 4–6 кнопках правило 1400 px остаётся: только иконки
    (`shell.css:376-383`, условие по `data-count` группы). При 1100 px и уже — только иконки при любом числе кнопок.
  - Footer: подписи видны шире 1100 px; при 1100 px и уже — иконка и бейдж, подпись в tooltip-е.
  - Rail: всегда только иконки.
  - Правило 1100 px про колонку Harness (`shell.css:384-389`, многоточие) уходит вместе с колонкой.
- **Sidebar спрятан** (Cmd/Ctrl+B) — решено без владельца, вопрос A. Rail тогда не нарисован, и его View button-ы
  рисуются в конце группы header после тонкой черты. Расстановка не меняется. Эти кнопки — не зона для drop. Меню и
  клавиши у них работают так же.
- **Footer** (`src/renderer/shell/footer/Footer.tsx`).
  - Окно становится колонкой: сверху ряд sidebar + main area (`.w-shell__body`), снизу `<footer className="w-footer"
    aria-label="Footer">` на всю ширину окна (Q7). Высота — `--footer-height: 28px` (`theme/tokens.css`).
  - Слева кнопки зоны Footer, середина пустая, справа chip версии.
  - Масштаб интерфейса: footer растёт вместе с окном — решено без владельца. Под ним нет кнопок окна, поэтому деление
    на `--interface-scale`, как у `--toolbar-height` (`settings/interface-scale.ts:28-30`), ему не нужно.
  - Footer — не область перетаскивания окна (`-webkit-app-region` не ставится) и `data-toast-keep-out`
    (`src/renderer/toast/ToastRegion.tsx:109`): toast у правого края не закрывает chip.
  - Windows и Linux: окно в системной рамке со своим title bar (`src/main/window-frame.ts`). Footer там тот же; правок
    title bar нет.
  - Focus mode рисует свой слой в `.w-shell__main` (`AppShell.tsx:118`). Footer вне этого слоя и остаётся видимым.
    View button-ы footer и блока rail в focus mode получают `inert`, как header под слоем: под слоем вид не виден, и
    переключать его незачем. Chip версии остаётся рабочим. Решено без владельца. `inert` ставит Ticket 04, где у footer
    и rail появляются View button-ы; Ticket 03 отвечает только за footer и chip в focus mode.
  - Пустой footer показывает только chip версии.
- **Chip версии и popover** (`src/renderer/shell/footer/VersionChip.tsx`, `version-dot.ts`).
  - Колонка Harness уходит из header: `toolbar/HarnessStatus.tsx` переезжает в `src/renderer/harness/HarnessStatus.tsx` и
    больше не toolbar-item (glob `./toolbar/*.tsx`, `Toolbar.tsx:11`). Компонент остаётся, его рисует ещё Settings →
    Pipeline (`src/renderer/settings/PipelineSection.tsx:230`). Ссылки на старый путь в темах Guide
    (`src/renderer/guide/topics/harness/topic.json`, `en.json`, `ru.json`) правятся в том же PR.
  - Chip — кнопка с текстом версии (`numberedVersion`). Пока идёт сборка Update — её шаг, как сейчас
    (`src/renderer/update/UpdateChip.tsx`), с многоточием и полным текстом в tooltip-е. Справа точка (Q14).
  - Правило точки — чистая функция `versionDot(update, harness, migration, failure)` (решено без владельца, где Q14
    молчит):
    - красная — «Harness unavailable», Harness `not-installed` или `error`, когда кнопка есть (`canInstall`), или
      предложен «Move old Harness…»;
    - янтарная — сигнал Update приложения, как точка chip-а сейчас (`dot` из `updateSignal`, `UpdateChip.tsx:48-60`,
      тихий Available update точки не даёт); или Harness `outdated` с акцентной «Update Harness»; или у строки Codex есть
      кнопка или «Codex: approve hooks»;
    - нет — иначе. «Replace Harness» (тот же semver) точки не даёт, как сейчас кнопка без акцента. Dev-запуск без
      `canInstall` точки не даёт.
  - Tooltip и `aria-label` chip-а — версия и причина точки: «worfy v0.4.N — Harness needs Install».
  - Popover — kit Popover (`src/renderer/theme/kit/Popover.tsx`), над chip-ом, Esc и клик снаружи закрывают (Q14).
    Строки:
    1. Приложение: версия и действия меню chip-а сейчас (`UpdateChip.tsx:192`) — Update worfy, Restart now, Restart
       when idle, What's new. Меню chip-а сливается со строкой; «Later» не нужен: popover закрывается Esc.
    2. Harness: строка `HarnessLine` с её кнопками — Install, Update Harness, Replace Harness, Retry, Move old Harness….
    3. Codex: строка `CodexLine` с её кнопкой — пока Harness есть у Claude Code, по правилу `codexPartOf`.
    4. Память: `AppMemory`, пока включён `memoryIndicator`. Подпись в Settings → General «Memory in the toolbar» → «Memory
       in the version popover» — решено без владельца.
  - Окна согласия, MigrationForm и CodexHooksStep открываются, как сейчас. Логика `HarnessStatus` — подписки
    `harness.changed`, `harnessMigration.changed` и сам открывающийся шаг Codex hooks (`opensHooksStep`) — живёт в chip-е,
    который смонтирован всегда, а не в popover-е. Иначе шаг перестанет открываться сам.
  - Toast-ы Update не меняются (Q14). Каналы Harness и Update — `local`: в окне Linked machine chip показывает этот
    компьютер, как сейчас.
- **Меню View button** (kit ContextMenu, `src/renderer/theme/kit/ContextMenu.tsx`).
  - Пункты: «Move to ▸ Header / Sidebar / Footer» (текущая зона отмечена и неактивна), черта, «Reset layout» (неактивен,
    пока расстановка по умолчанию).
  - Открывается правым кликом, кликом двумя пальцами на touchpad и Shift+F10 на кнопке в фокусе (решено без владельца:
    у Mac нет клавиши меню).
  - После «Move to» кнопка встаёт в конец зоны, фокус переходит на неё в новой зоне. Пока sidebar спрятан, «Sidebar» в
    меню работает: кнопка встаёт в конец зоны rail и видна в header после черты.
- **Клавиши.** ⌥←/⌥→ (Alt+←/→ на Windows) в header и footer, ⌥↑/⌥↓ на rail двигают кнопку внутри зоны. Фокус остаётся на
  ней после перерисовки — образец `QueueList` (`src/renderer/autopilot/QueueList.tsx:65-80`). На краю зоны ничего не
  происходит: в другую зону кнопку переносит только меню. В header обработчик стоит раньше стрелок ToggleGroup, чтобы
  ⌥← не двигал фокус.
- **Drag** — native HTML5 DnD, как `QueueList` (`QueueList.tsx:82-131`); библиотеки нет.
  - `draggable` на каждой View button. `dataTransfer` несёт тип `application/x-worfy-view-button` с id. Drop
    принимается только в окне, где drag начался (id лежит в модуле окна) — решено без владельца.
  - Пока идёт drag, у `.w-shell` стоит `data-view-drag`, и все видимые зоны подсвечены (`data-drop-zone`). Зона под
    курсором ярче. Маркер вставки — вертикальная черта в header и footer, горизонтальная на rail, в промежутке, над
    которым курсор. Промежуток считается по середине кнопки, как `gapAt` (`QueueList.tsx:82-86`).
  - Drop — `moveToZone` или `moveWithin` и один `setAppSettings({ viewButtons })`.
  - Esc отменяет: Chromium заканчивает native drag с `dropEffect = 'none'`, `dragend` снимает подсветку, расстановка не
    меняется. Отпустить вне зоны — то же самое.
  - Header — область перетаскивания окна (`-webkit-app-region: drag`, `shell.css:368`). Такая область не получает
    `dragover`. Поэтому группа видов header всегда `no-drag`, а пока стоит `data-view-drag` — весь header тоже.
  - Неактивная кнопка (нужен Project) тоже тянется: расстановка от Project-а не зависит.
- **Command palette** (Q6). Строки View строятся из реестра, их id и тексты остаются: `view:canvas` «Switch to
  Canvas», `view:session` «Switch to Session», `open-run-history` «Open Run history», `view:pull-requests` «Pull
  requests», `view:acceptance` «Acceptance». Новая строка `view:pipeline` «Pipeline board»: сейчас Pipeline из palette не
  открыть. Строки «Reset layout» в palette нет — Q6 называет меню и Settings.
- **Settings → General** (`src/renderer/settings/GeneralSection.tsx`): строка «View buttons» с кнопкой «Reset layout»
  (неактивна, пока расстановка по умолчанию).
- **Термины в CONTEXT.md** (раздел App):
  - **View button** — кнопка, которая переключает main area на один из шести видов (Canvas, Session, Pipeline, Runs, Pull
    requests, Acceptance). Стоит в одной из трёх зон: Header, Sidebar (rail), Footer. Расстановка — в app settings этой
    Machine. _Avoid_: вкладка, tab, View switch (как имя всего набора).
  - **Footer** — полоса внизу окна под sidebar и main area: View button-ы зоны Footer и chip версии с popover-ом
    приложения и Harness. _Avoid_: status bar, нижняя панель.
  - Header в коде и документах остаётся toolbar (`Toolbar.tsx`, `w-toolbar`); «Header» — имя зоны в меню «Move to» (Q3).
- **ADR не нужен.** Расстановка — ещё одно поле app settings, а app settings уже в инвентаре
  [ADR-0005](../../docs/adr/0005-worfy-own-state-inventory.md). Маршрут `local` уже задан
  [ADR-0053](../../docs/adr/0053-several-screens-on-one-project.md).
- **Тексты UI — английские** ([ADR-0074](../../docs/adr/0074-harness-neutral-by-language-and-project.md)), документы — en
  и ru.

## Решения по test-ам

- Хороший test проверяет то, что видит человек: где стоит кнопка, что подсвечено, что лежит в `app-settings.json`,
  какой вид открылся. Как устроены компоненты внутри, test не проверяет.
- **Без моделей и без сети.** Агент — `WORFY_AGENT=fake`. Update — снимок, который test шлёт в окно как
  `worfy:update.changed` (так делает `test/e2e/toolbar.spec.ts`). Harness в e2e — «not installed», как сейчас.
- **Seam 1 — unit, модель** (`test/unit/view-buttons.test.ts`): `repairViewButtons` (неизвестный id, повтор,
  пропуск, не та форма), `moveWithin`, `moveToZone` с индексом и без, `isDefault`. Правило точки
  (`test/unit/version-dot.test.ts`): каждая строка правила, «Replace Harness» и dev-запуск без точки. Реестр
  (`test/unit/view-registry.test.tsx`): шесть кнопок, причины неактивности, Runs зовёт `openRunHistory` с id Project-а.
  Palette: строка у каждого из шести видов, `view:pipeline` есть.
- **Seam 2 — contract, store** (`test/contract/app-settings.test.ts`). `app-settings.json` с испорченным `viewButtons`
  читается: расстановка починена, остальные поля целы, файл не уходит в `unreadable`. Patch `null` убирает поле. Ревизия
  растёт. Плюс unit-проверка маршрута: `routeOf('appSettings.get') === 'this-machine'` — это якорь Q13.
- **Seam 3 — unit, компоненты в jsdom** (`test/unit/view-zones.test.tsx`): три вида кнопки, активная кнопка, бейдж,
  пустые зоны. Меню зовёт `setAppSettings` с ожидаемой расстановкой. ⌥-стрелки двигают кнопку, фокус остаётся. Drag —
  `fireEvent.dragStart`, `dragOver`, `drop`, `dragEnd` с DataTransfer-stub, как `test/unit/queue-list.test.tsx`; `dragEnd`
  без drop ничего не меняет (Esc).
- **Seam 4 — e2e в настоящем Electron.**
  - `test/e2e/view-buttons.spec.ts` (новый): расстановка по умолчанию; drag Runs из footer в header (Playwright
    `dragTo`) с подсветкой зон и маркером в середине drag; «Move to» и Reset из меню; ⌥←; расстановка переживает
    перезапуск; второе окно видит перемену; окна 800×520, 1100, 1280 и 1600 px — ничего не выходит за окно; снимки обеих
    тем.
  - `test/e2e/footer.spec.ts` (новый): footer под sidebar и main area на всю ширину; chip; popover со строками; Esc и
    клик снаружи закрывают; точка красная при «Harness not installed», янтарная при Update; Install из popover открывает
    окно согласия; focus mode — footer виден, chip работает (Ticket 03); View button-ы footer и rail `inert` (Ticket 04).
  - `test/e2e/linked-opening.spec.ts` — случай Q13: на этом компьютере Runs в header, на Linked machine — по умолчанию;
    окно Linked machine показывает Runs в header.
- **Test-ы, которые сейчас закрепляют header и rail и меняются в Ticket-ах 03 и 04:**
  - e2e: `toolbar`, `sidebar-rail`, `sidebar-sections`, `limits-vendors`, `limits`, `update-toolbar`, `focus-sidebar`,
    `interface-scale`, `window`, `acceptance`, `linked-acceptance`, `pipeline`, `flight-recorder`, `work-track`,
    `pr-inbox`, `message-draft`, а также `codex-hooks-step`, `first-run`, `harness-install`, `harness-migrate`, `launch`,
    `memory`, `packaged`, `settings` (они ищут `app-version`, `harness-action`, `harness-column` или `getByRole('banner')`);
  - unit: `toolbar-runs`, `shell`, `shell-discovery`, `sidebar-scope`, `sidebar-all-projects`, `health-rail-button`,
    `limits-meter`, `harness-status`, `update-chip`, `acceptance-view`, `pr-inbox-view`, `focus-mode`, `kit-tooltip`, а
    также `app-memory`, `settings-pipeline`, `version-number-screen`, `whats-new-view`, `kit-groups`, `session-view`.
- **Какие e2e запускает PR.** `src/renderer/shell/`, `src/shared/settings/` и `src/main/settings/` не описаны в
  `scripts/e2e-specs.table.json`, поэтому PR Ticket-а кода запускает все spec-файлы e2e. Docs PR (Ticket 07 без
  `src/`) — без e2e.
- **Сначала падающий test** в каждом Ticket-е кода: красный на старом поведении, это пишется в «Итог».
- Платных eval-ов нет; настоящие Claude и Codex test-ы не запускают.

## Не в этом Epic-е

- Прятать View button-ы и расстановка на каждый Project (Q5 «пока», Q6).
- Перенос секций rail, Limits, поиска и заголовка Project-а (Q2).
- Новые виды и бейджи у Canvas, Session и Runs.
- Расстановка, которая переезжает между Machine-ами.
- Счёт Acceptance 261 (старые приёмки ушли в Ticket-ы при `worfy-acceptance` 08): владелец его не обсуждал, этот Epic
  счёт не меняет.

## Ticket-ы

8 Ticket-ов. Каждый — один PR со своими test-ами. «Готово, когда» каждого кончается пунктом: `pnpm lint`,
`pnpm typecheck`, `pnpm test` — exit 0, `ci-ok` зелёный на head PR.

1. **01 — Реестр видов и строки palette.** `src/renderer/shell/views.tsx`; header строит шесть сегментов из реестра в
   нынешнем порядке и с нынешним видом; строки View в palette — из реестра, новая `view:pipeline` «Pipeline board».
   `VIEW_NAMES` пока остаётся: `AppShell.tsx` правит Ticket 03, а `VIEW_NAMES` убирает 04. Бейдж в реестре только у
   Acceptance, как сейчас на вкладке; бейджи Pull requests и Pipeline (`useBadge` из источников видов) — Ticket 04.
   Агент. Blocked by: —.
   Готово, когда:
   - [ ] Реестр задаёт id, подпись, tooltip, иконку, причину неактивности, бейдж и действие у шести видов; `viewOptions`
         удалён; header выглядит как раньше (`toolbar.spec.ts`, `toolbar-runs`).
   - [ ] В Command palette есть строка у каждого из шести видов, `view:pipeline` открывает доску Pipeline.
   - [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
2. **02 — Модель расстановки в app settings.** `src/shared/layout/view-buttons.ts` (id, зоны, расстановка по умолчанию,
   ремонт, перемещения), поле `viewButtons` в схеме, мягкое чтение файла, patch с `null`, `merge` store; без UI.
   Агент. Blocked by: —.
   Готово, когда:
   - [ ] Unit-test-ы модели и contract-test store из раздела test-ов зелёные; испорченное поле не сбрасывает остальные
         настройки.
   - [ ] Unit-проверка `routeOf('appSettings.get') === 'this-machine'` есть.
   - [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
3. **03 — Footer и chip версии.** Окно-колонка, `Footer.tsx` пока только с chip-ом справа; колонка Harness уходит из
   header; `VersionChip`, `versionDot`, popover из четырёх строк; шаг Codex hooks открывается сам, как раньше; подпись
   памяти в Settings; `--footer-height`; toast keep-out; в focus mode footer виден и chip работает; темы Guide с новым
   путём. Агент. Blocked by: —.
   Готово, когда:
   - [ ] Footer на всю ширину окна под sidebar и main area, 28 px при масштабе 100 %; в header нет колонки Harness.
   - [ ] Точка chip-а красная, янтарная и без точки по правилу; popover закрывается Esc и кликом снаружи; Install,
         Update Harness, Retry, Move old Harness… и Update worfy работают из popover (`footer.spec.ts`).
   - [ ] Test-ы header, которые искали версию и Harness, ищут их в footer.
   - [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
4. **04 — Три зоны по расстановке.** `ViewZone`, `ViewButton` в трёх видах; header, блок rail с чертой и левая часть
   footer читают `viewButtons` (по умолчанию из Q1); активное состояние; бейджи из источников видов; правила 1400 и
   1100 px по зонам; пустые зоны; View button-ы rail в header, пока sidebar спрятан; `VIEW_NAMES` → реестр; Linked
   machine (Q13) в `linked-opening.spec.ts`. Если PR выходит больше примерно 600 строк кода, 04 делится на два Ticket-а:
   header с footer и rail. Агент. Blocked by: 01, 02, 03.
   Готово, когда:
   - [ ] По умолчанию: header — Canvas, Session; rail — Pull requests, Acceptance под чертой; footer — Pipeline, Runs.
   - [ ] Кнопка открытого вида активна в любой зоне; бейджи Acceptance, Pull requests и Pipeline видны в любой зоне, и
         при спрятанном sidebar тоже.
   - [ ] В окнах 800×520, 1100, 1280 и 1600 px ни одна зона не выходит за окно; снимки обеих тем приложены.
   - [ ] Окно Linked machine показывает расстановку этого компьютера.
   - [ ] В focus mode View button-ы всех трёх зон `inert`, chip версии работает.
   - [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
5. **05 — Меню «Move to», Reset layout и клавиши.** Kit ContextMenu на View button (правый клик, Shift+F10), Reset
   layout в меню и в Settings → General, ⌥-стрелки, фокус после перемещения. Агент. Blocked by: 04.
   Готово, когда:
   - [ ] «Move to» переносит кнопку в конец зоны, фокус на ней; Reset layout возвращает расстановку по умолчанию во всех
         окнах; ⌥←/⌥→ и ⌥↑/⌥↓ двигают кнопку внутри зоны.
   - [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
6. **06 — Drag.** Native HTML5 DnD между зонами и внутри зоны, подсветка зон, маркер вставки, место «Drop here» в пустой
   зоне, Esc и отпускание вне зоны отменяют, `no-drag` header-а на время drag. Агент. Blocked by: 05.
   Готово, когда:
   - [ ] Drag Runs из footer в header между Canvas и Session ставит его туда (`view-buttons.spec.ts`); пока он идёт, три
         зоны подсвечены и маркер виден; `dragEnd` без drop ничего не меняет.
   - [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
7. **07 — Документация en и ru.** `docs/features/app-shell.md` и `docs/features/ru/app-shell.md`: вступление (View
   button-ы в трёх зонах вместо View switch; сейчас там пять видов, без Acceptance), новый раздел Footer и раздел View
   buttons (Behaviour, Windows, On a Linked machine, How it works, Implementation), Sidebar (блок на rail). Правки страниц
   `updates`, `harness`, `focus-mode`, `acceptance`, `pr-inbox`, `flight-recorder`, `work-track`, `workflow` и их ru.
   Термины View button и Footer в `CONTEXT.md`. Тексты тем Guide про toolbar (`src/renderer/guide/topics/harness/`,
   `sessions/`, `the-window-and-your-data/`, en и ru). Агент. Blocked by: 03, 04, 05, 06.
   Готово, когда:
   - [ ] Страницы en и ru говорят одно и то же; ни одна не называет колонку Harness в header или шесть вкладок.
   - [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
8. **08 — Приёмка владельцем.** На Mac Stable и на ПК; ручные пункты раздела «Готово, когда». Владелец. Blocked by:
   01–07; `blocked --waits owner`.

## Волны

| Wave | Ticket-ы | Blocked by | Почему так |
|---|---|---|---|
| 1 | 01, 02, 03 | — | реестр (`src/renderer/shell/views.tsx`, `Toolbar.tsx`, `palette/commands.ts`), модель (`src/shared/layout/`, `src/shared/settings/`, `src/main/settings/`), footer и chip (`AppShell.tsx`, `shell.css`, `shell/footer/`, `harness/`, `update/`, `settings/GeneralSection.tsx`): общих файлов нет |
| 2 | 04 | 01, 02, 03 | зоны нужны реестр, модель и footer |
| 3 | 05 | 04 | меню и клавиши живут в `ViewButton.tsx` и `ViewZone.tsx` из 04 |
| 4 | 06 | 05 | drag правит те же `ViewButton.tsx` и `ViewZone.tsx` |
| 5 | 07 | 03, 04, 05, 06 | документация по сделанному |
| 6 | 08 | 01–07 | приёмка |

Wave — Ticket-ы, которые можно брать параллельно: блокеры закрыты, общих файлов нет. Wave, которую берут в работу,
вычисляется заново в момент запуска (CONTEXT.md, термин Wave); таблица — прогноз по Blocked by и спискам файлов. 05 и 06
идут друг за другом, потому что правят одни файлы, а не потому что одно нужно другому.

## Риски

- **Header — область перетаскивания окна.** Electron не шлёт `dragover` в область `-webkit-app-region: drag`. Без
  `no-drag` на время drag drop в header не сработает. 06 закрывает это e2e-test-ом drop в header.
- **Esc во время native drag в e2e.** Playwright отпускает drag сам, Esc посреди drag он нажать не даёт. Отмену
  проверяют unit-test (`dragEnd` без drop) и ручной пункт приёмки.
- **Две одинаковые иконки на rail.** По умолчанию на rail рядом стоят секция Pull requests и View button Pull requests,
  секция Acceptance и View button Acceptance с тем же счётом. Иконки одни и те же (`sidebar/PullRequestsSection.tsx:21`,
  `sidebar/AcceptanceSection.tsx:22` против `Toolbar.tsx:83-115`). Различают их черта блока, tooltip-ы и действие
  (панель секции или main area). Вопрос A ниже.
- **Бейджи при спрятанном sidebar.** Бейджи секций ставятся из эффектов самих секций и пропадают, когда sidebar
  спрятан. Поэтому View button-ы берут счёт из источников видов, а не из `useRailBadge`.
- **Шаг Codex hooks.** Он открывается сам только из toolbar-item-а (`opensHooksStep`, `HarnessStatus.tsx:462-464`). Если
  при переезде логика попадёт в popover, который смонтирован только открытым, шаг перестанет открываться.
  `codex-hooks-step.spec.ts` это поймает.
- **Высота main area.** Footer забирает 28 px у Canvas, Session view и sidebar. Окно 800×520 — самое тесное; 04
  проверяет его снимком.
- **Много e2e-test-ов меняются.** Около двадцати e2e ищут версию и Harness в header или вкладки в View switch. 03 и
  04 правят их в том же PR; Ticket, где правка test-ов больше правки кода, — сигнал делить 04.
- **Сборка новее и сборка старее.** Mac Stable и dev-копия могут читать один `app-settings.json`. Ремонт при чтении не
  даёт неизвестному id сломать файл, но расстановку, записанную сборкой с новым видом, старая сборка сохранит без него.

## Вопросы владельцу

Решения Q1–Q14 приняты 2026-11-24 и не открываются снова. Два вопроса новые: код показал то, чего grilling не
касался. Ни один не держит Wave 1; ответ нужен до Wave 2 (Ticket 04).

- **A. View button-ы rail, пока sidebar спрятан.** Cmd/Ctrl+B убирает sidebar целиком (`AppShell.tsx:115`), а с ним
  Pull requests и Acceptance по умолчанию.
  (а) Пока sidebar спрятан, кнопки зоны Sidebar стоят в конце header после тонкой черты; расстановка не меняется.
  Рекомендация: вид не теряется, и ничего не надо настраивать заново.
  (б) Они пропадают, вид открывается только из Command palette.
  (в) Они на это время уходят в footer.
- **B. Одинаковые иконки на rail.** Секция Pull requests и View button Pull requests, секция Acceptance и View button
  Acceptance стоят рядом с одной иконкой; у Acceptance ещё и одинаковый счёт.
  (а) Так и оставить: черта блока, разные tooltip-ы («Pull requests of the open Project», «Checks that wait for you»)
  и разное действие.
  (б) У View button-ов на rail — своя метка на иконке (уголок «окно»), чтобы их было видно отличными сразу.
  (в) У View button-а на rail нет бейджа, пока рядом стоит одноимённая секция со своим.
  Рекомендация: (б) и (в) вместе — две одинаковые иконки с одним счётом рядом читаются как ошибка, метка различает
  их сразу, а второй бейдж ничего не добавляет. Другой путь — оставить Pull requests и Acceptance в header по
  умолчанию, но тогда header снова тесный (Q1).

## Готово, когда

- [ ] Реестр видов — один источник имён, иконок, tooltip-ов и действий; `viewOptions` и `VIEW_NAMES` удалены; у
      каждого из шести видов есть строка Command palette.
- [ ] Расстановка хранится полем `viewButtons` в app settings этой Machine; испорченное поле чинится при чтении;
      Reset layout убирает поле.
- [ ] По умолчанию: header — Canvas, Session; rail — Pull requests, Acceptance под чертой; footer — Pipeline, Runs.
- [ ] Drag, «Move to» и клавиши переносят и упорядочивают кнопки; Esc и drop вне зоны ничего не меняют.
- [ ] Footer на всю ширину окна, chip версии с точкой по Q14 и popover с четырьмя строками; колонки Harness в header
      нет.
- [ ] Окно Linked machine показывает расстановку этого компьютера (`linked-opening.spec.ts`).
- [ ] Страницы Feature en и ru, термины View button и Footer в `CONTEXT.md`.
- [ ] (вручную) Сделай: обнови Stable и открой worfy → Должно быть: в header Canvas и Session с подписями; на rail под
      чертой Pull requests и Acceptance с бейджем; в footer слева Pipeline и Runs, справа chip версии.
  - needs: mac stable
- [ ] (вручную) Сделай: перетащи Runs из footer в header между Canvas и Session → Должно быть: пока тянешь, три зоны
      подсвечены и между Canvas и Session виден маркер; после drop Runs стоит там и после перезапуска worfy.
  - needs: mac stable
- [ ] (вручную) Сделай: начни тянуть Pipeline и нажми Esc → Должно быть: подсветка ушла, Pipeline на прежнем месте.
  - needs: mac stable
- [ ] (вручную) Сделай: клик двумя пальцами на touchpad по Acceptance на rail → Move to → Footer → Должно быть:
      Acceptance в footer с бейджем, фокус на ней.
  - needs: mac stable
- [ ] (вручную) Сделай: в footer на Acceptance нажми ⌥← → Должно быть: Acceptance встала левее соседней кнопки, фокус
      остался на ней.
  - needs: mac stable
- [ ] (вручную) Сделай: Settings → General → Reset layout → Должно быть: расстановка по умолчанию во всех окнах worfy.
  - needs: mac stable
- [ ] (вручную) Сделай: клик по chip-у версии, когда есть Update или Harness ждёт обновления → Должно быть: точка
      янтарная; popover с версией и Update worfy, строкой Harness с кнопкой, строкой Codex и памятью; Esc закрывает его.
  - needs: mac stable
- [ ] (вручную) Сделай: на ПК открой worfy и окно Linked machine Mac → Должно быть: footer внизу под системным title bar
      и меню, обе расстановки — как на ПК.
  - needs: windows stable
- [ ] (вручную) Владелец принял Epic.
