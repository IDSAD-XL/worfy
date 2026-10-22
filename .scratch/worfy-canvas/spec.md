# worfy-canvas: организация Canvas — Epic frame-ы в K колонок, автоархив Session-ов, цвет по типу, группы по связям

Status: по решению владельца 2026-10-19 (11 вопросов исследования, все приняты как рекомендованы);
«Готово, когда», файлы Ticket-ов и Wave-ы — предложение этого docs-PR
Source: запрос владельца 2026-10-19 и исследование
[2026-10-19-организация-canvas.md](../../docs/research/2026-10-19-организация-canvas.md) (код
`ae7603f0`; ссылки `файл:строка` в Ticket-ах перечитаны по main `7dab925f`). ADR
[0075](../../docs/adr/0075-epic-frames-in-columns-and-done-shelf.md),
[0076](../../docs/adr/0076-auto-archive-of-finished-sessions.md),
[0077](../../docs/adr/0077-node-kind-tokens.md) — этот PR. Прежние решения:
[0011](../../docs/adr/0011-epic-frames-derived-nodes.md) (рамки — Derived Node-ы),
[0016](../../docs/adr/0016-trash-folder-per-entry-undo-in-renderer.md) (Trash и ⌘Z),
[0032](../../docs/adr/0032-epic-frames-avoid-nodes.md) (колонка рамок обходит Node-ы),
[0038](../../docs/adr/0038-nodes-never-overlap.md) (Node-ы не перекрываются),
[0053](../../docs/adr/0053-several-screens-on-one-project.md) (несколько экранов на Project),
[0066](../../docs/adr/0066-read-only-access-for-a-linked-machine.md) (read-only экран Linked machine).
Epic [worfy-ui](../worfy-ui/spec.md) — формат и соглашения; его Ticket 16 (внутренние toast-ы) нужен
Ticket-у 10.
Ticket-ы: Epic `worfy-canvas`, 13 Ticket-ов, нумерация с `01`, по порядку кандидатов раздела 5
исследования. Шапка — `Type:` / `Status:` / `Blocked by:` / `Source:` по `harness/bin/TICKETS.md`;
ожидание чужого Epic-а или владельца — `Status: blocked` с `Blocked reason:` и `Waits:`.

## Откуда

Запрос владельца 2026-10-19 (дословно — исследование, шапка): Epic-и при автолейауте уходят вниз
колонкой; на Canvas много Session-ов, которые давно закончились; Node-ы разных типов не различить;
хочется группировки по смыслу и связям. Снимок владельца — Windows-ПК открывает Project CanvasForAI с
Mac. Что видно:

- 11 Epic frame-ов — одна колонка высотой около трёх экранов (`stackFrames`,
  `src/renderer/canvas/epic-layout.ts:412`); три Epic-а готовы целиком и всё равно занимают место.
- Слева — длинная колонка Session Node-ов, почти все finished: Node остаётся навсегда
  (`src/renderer/canvas/overlays/SessionNodes.tsx:1-5`), убрать его может только пользователь.
- Все Node-ы, кроме Terminal, — одна поверхность (`src/renderer/theme/tokens.css:167`); Minimap серый.
- На дальнем zoom карточки нечитаемы.
- Binding (связь Session с Ticket-ом или Epic-ом) коду известен, но на место Node-а не влияет.

## Цель

Canvas Project-а с десятком Epic-ов и сотней Session-ов помещается в пару экранов и читается на
дальнем zoom: активная работа сверху, готовое — на полке, законченное — в архиве, тип Node-а виден по
цвету, связанные Node-ы находятся вместе.

Epic готов, когда:

1. Рамки Epic-ов стоят полосой из K колонок; 11 рамок Project-а CanvasForAI при «fit» занимают не
   больше 1,5 высоты экрана; раскладка одна на всех экранах и не зависит от размера окна (Ticket 01).
2. Готовые Epic-и — chip-ы на полке «Done» под рамками; клик разворачивает рамку (Ticket 02).
3. Наведение или выделение Ticket-а, Session, Subagent-а или Epic frame-а рисует линии Binding-а внутри
   его «семьи», ничего не приглушая (Ticket-ы 03, 17); «Show family» показывает семью целиком; работает
   на read-only экране (Ticket 03).
4. Minimap и шапки Node-ов окрашены по типу в обеих темах; контраст и симуляция нарушений цветового
   зрения проходят проверку скриптом (Ticket-ы 04, 05).
5. Три уровня вида Node-а по zoom; на zoom 0.15 читаются имена Epic-ов и типы карточек (Ticket 06).
6. Законченные Session-ы уходят в архив сами по правилу ADR-0076; ничего не удаляется; их видно в
   истории Ticket-а или Epic-а и в popover «Archive»; после партии — toast с Undo; порог — в Settings
   (Ticket-ы 07–10).
7. Новая Session с Binding встаёт рядом со своим Epic-ом; команда «Arrange by Epic» собирает Session-ы
   у их Epic-ов одним шагом ⌘Z (Ticket-ы 11, 12).

Ticket 13 (ELK `rectpacking` для рамок) — только по решению владельца после снимка Ticket-а 01; в
условие готовности Epic-а он не входит.

## Решения владельца

2026-10-19. Владелец дословно: «Да на все 11 рекомендаций, заводи Epic worfy-canvas с ADR и
Ticket-ами.» Все 11 вопросов раздела 6 исследования приняты как рекомендованы; заново не решаются.
Номер — как здесь; Ticket-ы ссылаются на него («решение 4»).

1. **Раскладка рамок сама меняет K и переставляет рамки без жеста пользователя.** Рамки и так
   производные и двигаются сами; K меняется с гистерезисом (ADR-0075, пункты 1–3; Ticket 01).
2. **Порядок Epic-ов — постоянный внутри дня.** «Активные сначала» — при первом открытии Project-а за
   день и по команде «Re-pack» (ADR-0075, пункт 4; Ticket 01).
3. **Готовые Epic-и — на полку chip-ов** под рамками (ADR-0075, пункт 5; Ticket 02). **Уточнено ADR-0082
   (Ticket 21, владелец, 2026-10-22):** полка стоит под рамками такими, как они нарисованы, а не под запасом
   на открытые стопки done; запас остаётся в поиске места полосы.
4. **Порог автоархива по умолчанию — 24 ч простоя**, плюс «Ticket done и прошёл 1 ч». Выбор: Never,
   6 h, 24 h, 3 d, 7 d (ADR-0076, пункты 1, 7; Ticket-ы 07, 08).
5. **Куда уходят убранные Session-ы.** С Binding — в историю своего Ticket-а или Epic-а; без Binding —
   в popover «Archive». Не в Trash (ADR-0076, пункт 5; Ticket 09).
6. **Автоархив включён по умолчанию во всех Project-ах**, с toast-ом и Undo; выключается в Settings
   (ADR-0076, пункты 7, 8, 10; Ticket-ы 08, 10).
7. **Цвет по типу.** Orchestrator — пурпурный, Session — голубой, Subagent — голубой контур, Epic
   frame — жёлтый (охра в светлой теме), Ticket — нейтральный; Card, Note, Terminal, HANDOFF —
   нейтральные. Значения утверждаются после проверки контраста (ADR-0077, пункты 2, 4; Ticket 04).
8. **F-SPEC меняется, роли `kind-*` вводятся отдельным ADR.** Цвет типа — только полоса, иконка,
   Minimap и блок дальнего zoom (ADR-0077, пункты 1, 3; Ticket-ы 04–06).
9. **Session-ы к их Epic-у автоматически не двигаются.** Только место новой Session и команда «Arrange
   by Epic» (Ticket-ы 11, 12).
10. **«Arrange by Epic» перебивает ручное размещение**, но только по команде и одним шагом ⌘Z. Node-ы с
    `pinned` и Keep не двигаются (Ticket 12).
11. **Semantic zoom — параллельно с токенами**, не после: без него цвет на дальнем zoom помогает мало
    (ADR-0077, пункт 7; Ticket 06). **Отключено Ticket-ом 20 (владелец, 2026-10-21):** на любом zoom
    Node рисуется целиком.

## Как устроено

- **Рамки** (ADR-0075, ADR-0082; Ticket-ы 01, 02, 13, 21). `stackFrames` раскладывает рамки в K
  колонок, рамка `i` — в колонку `i mod K`; `frameColumnX` ищет место для всей полосы. K и порядок —
  чистые функции; их прошлые значения лежат в Layout одной записью `epic-arrangement`, поэтому все
  экраны считают одно и то же. Готовый свёрнутый Epic — chip на полке «Done» под полосой. Полка —
  `FRAME_GAP` под самой высокой колонкой по видимой высоте рамок; место полосы
  (`PlacedStrip.roomHeight`) по-прежнему считается с запасом на открытые стопки done (Ticket 21).
- **Семья Node-а** (Ticket 03). Строится из Binding (`src/shared/binding/resolve.ts`) и дерева
  Subagent-ов (`src/renderer/canvas/sources/subagents.ts`). Подсветка — состояние своего окна, как
  подсветка Edge-ей (`src/renderer/canvas/edge-focus.ts`, ADR-0053): Node-ы не двигаются, Layout не
  меняется.
- **Цвет по типу** (ADR-0077; Ticket-ы 04–06). Роли `kind-*` в таблице Tokens F-SPEC и в
  `src/renderer/theme/tokens.css`; `minimapColor` каждого типа; полоса и иконка в шапке; на дальнем
  zoom — блок цвета типа. Статус — только на своих ролях и со словом.
- **Автоархив** (ADR-0076; Ticket-ы 07–10). Правило и таймер — в main; поле `archived` у Node-а
  Layout-а; архивный Node не на плоскости. История у Ticket-а и Epic-а — модули слотов `badges` и
  `actions` (`src/renderer/canvas/badges/index.ts:1-12`), popover «Archive» — рядом с Trash. Toast —
  общий компонент `worfy-ui` 16.
- **Группы по связям** (Ticket-ы 11, 12). Место новой Session с Binding — обобщение `shipTicketSpot`
  (`src/renderer/canvas/actions/TicketActions.tsx:34`): справа от полосы рамок, на высоте Ticket-а.
  «Arrange by Epic» устроен как «Tidy up» (`src/renderer/canvas/tidy.ts`): один `moveMany`, один шаг ⌘Z.

## Не в этом Epic-е

- **Epic как вложенный Canvas** (вариант 1e исследования) — ломает «весь Project на одном Canvas».
- **Док Session-ов внутри рамки** (4c) и **swimlanes** (4d) — две модели места для одного типа Node-а.
- **Edge bundling, Bubble Sets, поиск сообществ в графе** (4e) — пока Binding даёт группы явно.
- **Цвет группы, заданный пользователем.**
- **Цвет у Ticket, Card, Note, Terminal, HANDOFF** (решение 7).
- **Автоматическое перемещение Session-ов к Epic-у** без жеста (решение 9).
- **Удаление Session-ов автоматом.** Архив ничего не удаляет; Trash — только для удалений пользователя.

## Пересечения с другими Epic-ами

Сверка — по правилу раздела «Соглашения», пункт «Перед каждой Wave — открытые PR других Epic-ов».
На 2026-10-19:

- **`worfy-ui` 16** (внутренние toast-ы, `open`) — Ticket 10 ждёт его мержа (`Status: blocked`).
- **`worfy-ui` 12** (приёмка, правит `docs/design/F-SPEC.md`) — общий файл с Ticket-ами 04, 05, 06.
  Кто вливается вторым, перебазируется и сохраняет чужие строки.
- **PR #530 `worfy-polish/33`** (весь Ticket в режиме фокуса) правит `src/renderer/canvas/epic-layout.ts`,
  `src/renderer/canvas/epic-frame.css`, `src/renderer/canvas/nodes/TicketNode.tsx` и
  `test/unit/epic-layout.test.ts` — общие файлы с Ticket-ами 01, 05, 06, 13. Эти Ticket-ы ждут мержа
  #530.
- **PR #525 `worfy-windows/14`** правит `src/main/claude-home/registry.ts`. Ticket 07 этот файл не
  меняет, только читает.

## Риски

1. **Мысленная карта ломается при смене K.** Смягчают гистерезис и постоянный порядок внутри дня
   (ADR-0075).
2. **Широкая полоса чаще упирается в Node-ы** и уходит правее. Ticket 01 меряет это на снимке Project-а
   CanvasForAI; если пустота заметна — Ticket 13 (решает владелец).
3. **Пользователь не найдёт вчерашнюю Session.** Смягчают история у Ticket-а и Epic-а, поиск в
   popover «Archive», History в боковой панели. Таймер выключен, пока их нет (ADR-0076, пункт 10).
4. **Гонка таймера архива и `claude --resume`.** Session продолжили между чтением реестра и записью
   `archived`. Main снимает `archived`, как только Session снова живая (ADR-0076, пункт 6); test
   Ticket-а 07.
5. **Голубой Session рядом с синим working**, жёлтый Epic рядом с лаймовым ready под протанопией.
   Снято местом цвета: тип — полоса и иконка, статус — chip со словом (ADR-0077, пункты 3, 5).
6. **Производительность на дальнем zoom.** `onlyRenderVisibleElements`
   (проп `<ReactFlow>` в `src/renderer/canvas/Canvas.tsx`) не помогает, когда видно всё. Ticket 06 упрощал Node-ы на
   дальнем zoom и проверял, что смена zoom внутри уровня их не перерисовывает; Ticket 20 (владелец,
   2026-10-21) это убрал вместе с semantic zoom. Защиты от этого риска сейчас нет; из упрощений остался
   только порог Card `LIVE_ZOOM_MIN` = 0.4 (ниже него — заголовок без iframe).
7. **Read-only экран Linked machine** (ADR-0066). Команды, которые двигают или убирают Node-ы
   («Re-pack», «Archive finished sessions now», «Arrange by Epic», Restore, Undo в toast-е), там
   недоступны. Каждый такой Ticket проверяет это test-ом.

## Соглашения для Ticket-ов этого Epic-а

Как в [worfy-ui](../worfy-ui/spec.md), раздел «Соглашения для Ticket-ов этого Epic-а»: сначала падающий
test, только чтение чужих файлов, ручные пункты «(вручную)», снимки UI в двух темах (`snapshotThemes`,
`test/e2e/snapshots.ts`), e2e — в своих spec-файлах, мерж — Orchestrator, набором после `wave-gate`
(ADR-0065). Отличия:

- **Начало** — сразу; Ticket-ы 01, 05, 06 и 13 ждут мержа PR #530 (общие файлы).
- **Кто ведёт** — Session на Mac, Wave-ами (`/worfy:epic-wave`).
- **Ветки** — `worfy-canvas/<NN>`; worktree — `.claude/worktrees/<NN>`, если путь занят —
  `.claude/worktrees/cv-<NN>`.
- **Платформенный PR** (ADR-0056, пункт 2; ADR-0071). Ticket-ы 01–06, 09, 11, 12, 13 меняют только
  renderer и `src/shared` — не платформенные. Ticket-ы 07, 08 и 10 меняют main (таймер, Layout store,
  IPC) без кода окон, процессов и путей ОС; платформенные ли они — по списку путей ADR-0071, пункт 5,
  при PR.
- **Автоматическое — мимо ⌘Z, жест пользователя — шаг ⌘Z** (ADR-0016). Каждый Ticket, который пишет в
  Layout, называет в «Готово, когда», что из его операций — шаг ⌘Z, а что нет, и проверяет это test-ом.
- **Несколько экранов** (ADR-0053). Ticket, который меняет место Node-ов или Layout, проверяет e2e с
  двумя окнами одного Project-а: оба видят одно и то же.
- **Read-only экран** (ADR-0066). Команды записи там недоступны; test на это — в каждом таком Ticket-е.
- **`docs/design/F-SPEC.md`** правят Ticket-ы 04 (таблица Tokens), 05 (шапка Node-а), 06 (уровни
  zoom) и 02 (полка «Done»), каждый — свой раздел. Они идут в разных Wave-ах.
- **Цвета — только роли таблицы Tokens.** Ни один Ticket не вводит цвет вне `kind-*` и прежних ролей.
- **ADR.** ADR-0075, 0076, 0077 — этот PR. ADR-0082 (Done shelf под видимыми рамками) — PR #724,
  Ticket 21. Ticket-у, который найдёт новое решение с признаками ADR, номер выдаёт Orchestrator.
  Принятые ADR не правятся.
- **Unit-test-ы с DOM — `.test.tsx`** (jsdom), остальные — `.test.ts` (node), как в `vitest.config.ts`.
- **Язык.** Документы — русские, термины — латиницей из `CONTEXT.md`; названия действий UI («Re-pack»,
  «Show family», «Archive finished sessions now», «Arrange by Epic», «Keep») — английские; код,
  комментарии, коммиты и PR — английские.

## Порядок

ADR-0075–0077 и термины Done shelf, Archive и Family — этот PR.

- **Фаза 1** — 01, 03, 04 сразу: у них нет блокеров и общих файлов. 02 — после 01: полка стоит под
  полосой из K колонок, и оба правят `sources/epics.ts`.
- **Фаза 2** — 05 и 06 после 04: им нужны токены `kind-*`. 05 — после 02 по общему F-SPEC, 06 — после
  05 по общим файлам шапки.
- **Фаза 3** — 07 без блокеров, но его Wave — после 02 (общий `src/shared/layout/derived.ts`). 08 и 09 —
  после 07. 10 — после 07, 08, 09 и мержа `worfy-ui` 16. Фазы 2 и 3 идут параллельно.
- **Фаза 4** — 11 после 01 (полоса рамок), 12 после 01 и 11 (то же правило места).
- **13** — только по решению владельца после снимка 01.

## Волны

Wave — Ticket-ы, которые можно брать параллельно: все блокеры закрыты, общих файлов в «Где в коде»
нет. Таблица — план. Wave, которую берут в работу, вычисляется заново в момент запуска (CONTEXT.md,
термин Wave). Заголовок раздела и шапка таблицы остаются русскими: это формат, который читает skill
`epic-wave`.

| Тикет | Файлы из «Где в коде» | Волна |
| --- | --- | --- |
| 01 | `src/renderer/canvas/epic-layout.ts`, `src/renderer/canvas/epic-arrangement.ts`, `src/renderer/canvas/sources/epics.ts`, `src/shared/layout/derived.ts`, `src/renderer/palette/commands.ts`, `src/renderer/canvas/overlays/CanvasMenu.tsx`, `test/unit/epic-layout.test.ts`, `test/unit/epic-arrangement.test.ts`, `test/unit/palette-commands.test.tsx`, `test/unit/canvas-menu.test.tsx`, `test/e2e/epic-columns.spec.ts` | 1 |
| 02 | `src/renderer/canvas/sources/epics.ts`, `src/shared/layout/derived.ts`, `src/renderer/canvas/nodes/DoneShelfNode.tsx`, `src/renderer/canvas/done-shelf.css`, `docs/design/F-SPEC.md`, `test/unit/done-shelf.test.tsx`, `test/e2e/done-shelf.spec.ts` | 2 |
| 03 | `src/renderer/canvas/family.ts`, `src/renderer/canvas/edge-focus.ts`, `src/renderer/canvas/overlays/EdgeFocus.tsx`, `src/renderer/canvas/NodeChrome.tsx`, `src/renderer/canvas/node-chrome.css`, `src/renderer/canvas/overlays/SelectionToolbar.tsx`, `test/unit/family.test.ts`, `test/unit/edge-focus.test.tsx`, `test/e2e/family.spec.ts` | 1 |
| 04 | `docs/design/F-SPEC.md`, `src/renderer/theme/tokens.css`, `src/renderer/canvas/nodes/SessionNode.tsx`, `src/renderer/canvas/nodes/SubagentNode.tsx`, `src/renderer/canvas/nodes/OrchestratorNode.tsx`, `src/renderer/canvas/nodes/EpicFrameNode.tsx`, `src/renderer/canvas/overlays/MiniMapOverlay.tsx`, `test/unit/kind-tokens.test.ts`, `test/e2e/minimap-kinds.spec.ts` | 1 |
| 05 | `docs/design/F-SPEC.md`, `src/renderer/canvas/NodeChrome.tsx`, `src/renderer/canvas/node-chrome.css`, `src/renderer/canvas/kind-icons.tsx`, `src/renderer/canvas/nodes/SessionNode.tsx`, `src/renderer/canvas/nodes/SubagentNode.tsx`, `src/renderer/canvas/nodes/OrchestratorNode.tsx`, `src/renderer/canvas/nodes/EpicFrameNode.tsx`, `src/renderer/canvas/epic-frame.css`, `test/unit/node-kind-header.test.tsx`, `test/e2e/node-kinds.spec.ts` | 3 |
| 06 (отключено Ticket-ом 20, владелец, 2026-10-21) | `docs/design/F-SPEC.md`, `src/renderer/canvas/zoom-level.ts`, `src/renderer/canvas/NodeChrome.tsx`, `src/renderer/canvas/node-chrome.css`, `src/renderer/canvas/nodes/EpicFrameNode.tsx`, `src/renderer/canvas/epic-frame.css`, `src/renderer/canvas/nodes/CardNode.tsx`, `src/renderer/canvas/nodes/TicketNode.tsx`, `test/unit/zoom-level.test.tsx`, `test/e2e/semantic-zoom.spec.ts` | 4 |
| 07 | `src/shared/layout/types.ts`, `src/shared/layout/derived.ts`, `src/main/layout/store.ts`, `src/main/layout/archive.ts`, `src/main/index.ts`, `src/main/ipc/claude-home.ts`, `src/renderer/claude-home/session-nodes.ts`, `src/renderer/session/navigation.ts`, `test/unit/archive-rule.test.ts`, `test/contract/layout-archive.test.ts`, `test/unit/session-nodes.test.tsx` | 3 |
| 08 | `src/shared/settings/app-settings.ts`, `src/main/layout/archive.ts`, `src/shared/ipc/layout.ts`, `src/main/ipc/layout.ts`, `src/renderer/settings/CanvasSection.tsx`, `src/renderer/palette/commands.ts`, `src/renderer/canvas/nodes/SessionNode.tsx`, `test/contract/app-settings.test.ts`, `test/unit/settings-canvas.test.tsx`, `test/unit/palette-commands.test.tsx`, `test/e2e/session-archive.spec.ts` | 4 |
| 09 | `src/renderer/canvas/archive-list.ts`, `src/renderer/canvas/badges/SessionHistory.tsx`, `src/renderer/canvas/actions/EpicSessionHistory.tsx`, `src/renderer/canvas/overlays/ArchivePopover.tsx`, `src/renderer/canvas/overlays/archive.css`, `test/unit/archive-list.test.ts`, `test/unit/archive-popover.test.tsx`, `test/e2e/session-archive-history.spec.ts` | 4 |
| 10 | `src/main/layout/archive.ts`, `src/shared/ipc/layout.ts`, `src/shared/settings/app-settings.ts`, `src/renderer/canvas/overlays/ArchiveToast.tsx`, `test/unit/archive-toast.test.tsx`, `test/contract/layout-archive.test.ts`, `test/e2e/session-archive-toast.spec.ts` | 5 |
| 11 | `src/renderer/canvas/session-spot.ts`, `src/renderer/canvas/actions/TicketActions.tsx`, `src/renderer/claude-home/session-nodes.ts`, `src/renderer/canvas/overlays/SessionNodes.tsx`, `test/unit/session-spot.test.ts`, `test/unit/session-nodes.test.tsx` | 2 |
| 12 | `src/renderer/canvas/arrange-by-epic.ts`, `src/renderer/palette/commands.ts`, `src/renderer/canvas/overlays/CanvasMenu.tsx`, `test/unit/arrange-by-epic.test.ts`, `test/unit/palette-commands.test.tsx`, `test/unit/canvas-menu.test.tsx`, `test/e2e/arrange-by-epic.spec.ts` | 3 |
| 13 | `src/renderer/canvas/epic-layout.ts`, `src/renderer/canvas/sources/epics.ts`, `src/renderer/canvas/elk/client.ts`, `src/renderer/canvas/elk/pack.ts`, `test/unit/epic-layout.test.ts` | — |

Правило плана. Ticket стоит в первой Wave, где закрыты все его блокеры (`Blocked by`). Если у двух
Ticket-ов одной Wave общий файл, Ticket с большим номером уходит в следующую Wave.

- **Wave 1 — 01, 03, 04.** Блокеров нет, общих файлов нет. 07 тоже без блокеров, но делит с 01
  `src/shared/layout/derived.ts`.
- **Wave 2 — 02, 11.** 02 — `Blocked by: 01`; 11 — `Blocked by: 01`. 05 (`Blocked by: 04`) делит с 02
  `docs/design/F-SPEC.md`, 07 делит с 02 `derived.ts` — обе уходят дальше.
- **Wave 3 — 05, 07, 12.** 12 — `Blocked by: 01, 11`. Общих файлов нет. 06 (`Blocked by: 04`) делит с 05
  шапку Node-а и F-SPEC — уходит дальше.
- **Wave 4 — 06, 08, 09.** 08 и 09 — `Blocked by: 07`. Общих файлов нет.
- **Wave 5 — 10.** `Blocked by: 07, 08, 09` и мерж `worfy-ui` 16 (`Status: blocked`).
- **13 — без Wave.** `Status: blocked`, ждёт решения владельца по снимку Ticket-а 01.

Пересечения проверены правилом `filesOverlap` (`src/shared/workflow/waves.ts`) вручную, по таблице.
Если исполнителю нужен файл вне своего списка, он дописывает его в «Где в коде» при claim.
