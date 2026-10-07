# worfy-week: неделя работы владельца из worfy

Status: принят владельцем 2026-10-07 (ответы на вопросы 3 и 4; Canvas — ответы на вопросы 14–29)
Source: [roadmap.md](../../docs/roadmap.md), E2, условие «владелец неделю работает из worfy»;
[CONTEXT.md](../../CONTEXT.md); ADR [0020](../../docs/adr/0020-profile-shared-and-personal-parts.md);
HANDOFF 2026-10-06, «Ждёт владельца»; Epic [worfy-daily](../worfy-daily/spec.md) — формат и соглашения.
Ticket-ы: Epic `worfy-week`, нумерация с `01`. Шапка — тот же диалект, что у worfy-daily
(`Type:` / `Status:` / `Blocked by:` / `Source:`), чтобы её читали `epic-status`, `ticket` и
вычисление Wave в worfy (`src/shared/workflow/waves.ts`).

## Цель

Владелец неделю работает из worfy каждый день без трения. Трение — всё, из-за чего приходится
уйти из worfy в терминал или браузер или что мешает работать в самом worfy. Каждый такой дефект,
найденный за неделю, становится Ticket-ом этого Epic-а. Wave-ы Epic-а ведёт Autopilot.

Epic готов, когда:

1. Неделя работы владельца из worfy прошла — это условие 4 готовности E2
   ([worfy-daily spec.md](../worfy-daily/spec.md), «Цель»; в roadmap — последнее условие E2).
2. Каждый дефект недели стал Ticket-ом `worfy-week`: он закрыт, или владелец сам отложил его.
3. Wave-ы Epic-а прошли в Autopilot. Точка, где понадобился человек, — дефект (CONTEXT.md,
   Autopilot) и тоже Ticket.

## Как устроено

- Как в worfy-daily: worfy только показывает workflow и запускает его теми же инструментами
  ([ADR-0002](../../docs/adr/0002-worfy-is-a-view-over-the-workflow.md)). В репозиторий Project и
  в `~/.claude` worfy не пишет ([ADR-0005](../../docs/adr/0005-worfy-own-state-inventory.md)).
  Profile читается только через `~/.claude/bin/profile`.
- Wave-ы ведёт Orchestrator worfy в Autopilot на Stable copy. Между прогонами Stable copy
  обновляется по README, раздел «Stable copy».
- Состав Epic-а растёт по ходу недели. Новый Ticket берёт следующий свободный номер. В `Source` —
  когда и на чём нашли дефект.
- Ticket-ы 01 и 02 — дефекты, известные к началу недели. Ticket-ы 03–07 — Canvas после раунда
  дизайна: Edge-и между Node-ами, раскладка рамок Epic-ов, Node-ы без перекрытий, snapping
  (прилипание при перетаскивании) и «Tidy up». Решения владельца по ним — раздел «Решения владельца
  по Canvas», Wave-ы — таблица «Волны».
- Ticket-ы 08–12 — первые дефекты недели: второй круг ручных проверок 2026-10-07
  ([PR #93](https://github.com/IDSAD-XL/worfy/pull/93), a3a2c50). Улики — в подразделах «Ручная
  проверка 2026-10-07» Ticket-ов, на которых их нашли; ссылки — в `Source` каждого.
- Первый длинный прогон Autopilot над этим Epic-ом может впервые упереться в Limits. Тогда
  проверится условие 3 готовности E2 ([worfy-daily spec.md](../worfy-daily/spec.md), «Цель»;
  Ticket 05 `worfy-daily`): прогон ждёт сброса и продолжает сам.

## Этапы

1. **Дефекты, известные к началу недели** — 01, 02.
   - 01: бейджи PR и CI идут от аккаунта GitHub Project-а — часть ADR-0020, нужная сейчас.
   - 02: ⌘Z после двух жестов над одним Node возвращает его на исходное место.
2. **Canvas после раунда дизайна** — 03–07.
   - 03: рамку Epic-а раскладывает ELK (библиотека `elkjs`) в Web Worker — порядок Ticket-ов без
     пересечений Edge-ей, Edge-и Blocked by ортогонально по коридорам между колонками; Ticket-ы и
     деревья Subagent-ов не перетаскиваются, их сохранённые смещения снимаются. Новый ADR.
   - 04: Node-ы не перекрываются — main поправляет каждую операцию Layout до ближайшего свободного
     места, MCP-tools отвечают настоящими координатами, Derived Node-ы уступают, перекрытия в
     сохранённых Layout-ах снимаются один раз. Новый ADR.
   - 05: Edge-и тонкие и бледные; цепочка Ticket-а — при наведении и выделении; Edge-и от done
     Ticket-ов скрыты; линии Binding постоянно видны только у живых агентов.
   - 06: snapping при перетаскивании — сетка 8 px, направляющие выравнивания и равных промежутков,
     контур места, куда встанет Node; ⌘ выключает snapping.
   - 07: команда «Tidy up» в палитре ⌘K и в контекстном меню Canvas; один ⌘Z её отменяет.
3. **Дефекты недели** — по мере находок. Первые — 08–12, из второго круга ручных проверок
   2026-10-07.
   - 08: ⌘Z после перетаскивания рамки Epic-а возвращает рамку, а не отменяет прошлый шаг;
     сворачивание рамки — тоже шаг ⌘Z.
   - 09: перетаскивание и изменение размера Node-а не зависают, когда курсор попадает на iframe Card.
   - 10: тёмная тема — стопка done со второй карточкой, кольцо акцента у выделенного Node-а и
     Ticket-а; токены теней не `none`.
   - 11: открытая стопка done не опускает открытые колонки рамки — done Ticket-ы не участвуют в
     раскладке ELK. Новый ADR.
   - 12: мелкие подписи — источник Session в History, подсказки Remove и Hide, имена tool-ов в превью
     Subagent-а, модель в шапке Session view, окно About в `pnpm dev`.

## Решения владельца по Canvas

Раунд дизайна Canvas, ответы владельца 2026-10-07 на вопросы 14–29, все приняты. Ticket-ы 03–07
ссылаются на них номерами.

- **14. Edge-и Blocked by.** Все тонкие и бледные. Наведение или выделение Ticket-а подсвечивает
  его цепочку: кто его блокирует и кого блокирует он. Edge-и от done Ticket-ов по умолчанию скрыты.
- **15. Форма Edge-а** — ортогональная, со скруглёнными углами. Edge идёт по коридорам между
  колонками и никогда не проходит через Node Ticket-а.
- **16. Порядок в колонке уровня** — с минимизацией пересечений (эвристика layered layout). Ready
  Ticket-ы отмечены цветом или chip-ом, а не местом в колонке.
- **17. Ticket-ы внутри рамки и деревья Subagent-ов не перетаскиваются,** их место вычисляется.
  Рамка Epic двигается только целиком. Сохранённые смещения Ticket-ов и деревьев снимаются один раз
  при обновлении; смещения рамок остаются.
- **18. Snapping при перетаскивании Node-ов пользователя** (Session, Card, Note, Terminal,
  Orchestrator, HANDOFF, рамка Epic целиком): сетка 8 px; направляющие выравнивания — края и центры
  соседей ближе 6 px, тонкая линия; направляющие равных промежутков. Пока зажат ⌘, всё это выключено.
- **19. Команда «Tidy up»** (палитра ⌘K и контекстное меню Canvas) раскладывает Node-ы пользователя
  без перекрытий; один ⌘Z её отменяет. Node-ы, которые ставит сам worfy (новая Session,
  Orchestrator, HANDOFF), всегда встают на свободное место — это закрывает долг с (40, 40).
- **20. Edge-и Binding** постоянно видны только у живых Session-ов, остальные — при наведении или
  выделении. Форма та же, ортогональная.
- **21. Термины Edge и Derived Node** — уже в [CONTEXT.md](../../CONTEXT.md).
- **Новое требование владельца: Node-ы никогда не перекрываются.**
- **22. Бросок на другой Node.** Перетаскиваемый Node встаёт на ближайшее свободное место, соседи
  не двигаются. Во время перетаскивания контур показывает, куда он встанет. Сначала snapping, потом
  поиск свободного места.
- **23. Изменение размера в соседа** — край останавливается у соседа с зазором.
- **24. Правило «без перекрытий» живёт в main** — одно место для каждой операции Layout: создание,
  перемещение, изменение размера, MCP `create_card` и `create_note` с x, y. Main сдвигает Node на
  ближайшее свободное место, ответ MCP-tool-а несёт настоящие координаты. Renderer только показывает,
  куда Node встанет.
- **25. Участники:** Node-ы пользователя, Orchestrator, HANDOFF, рамки Epic-ов целиком, дерево
  Subagent-ов одним блоком. Не участвуют: закреплённые Node-ы (слой поверх экрана), скрытые Node-ы,
  Ticket-ы внутри рамки. Зазор — не меньше 16 px.
- **26. Derived Node-ы уступают Node-ам пользователя.** Рамки по-прежнему уходят колонкой правее
  Node-ов пользователя ([ADR-0032](../../docs/adr/0032-epic-frames-avoid-nodes.md)), деревья
  Subagent-ов сдвигаются сами. Node-ы пользователя сами не двигаются — только своим перетаскиванием,
  изменением размера или «Tidy up».
- **27. Перекрытия в сохранённых Layout-ах** снимаются один раз, при первом запуске новой версии,
  наименьшими перемещениями: двигается Node, созданный позже. Каждое перемещение — в лог; отмены нет.
- **28. ELK (`elkjs`)** считает раскладку Epic-а — layered, минимизация пересечений, ортогональная
  маршрутизация Edge-ей в обход Node-ов — в Web Worker; его rectangle packing раскладывает «Tidy up».
  Новый ADR: зависимость и кто размещает Derived Node-ы; дополняет
  [ADR-0011](../../docs/adr/0011-epic-frames-derived-nodes.md) в части смещений, ADR-0032 остаётся.
  Лицензию записать: пакет выходит под «EPL-2.0 OR GPL-3.0-or-later», worfy берёт EPL-2.0.
- **29. Производительность.** Бюджет e2e для Project размера Auction сохраняется. Раскладка
  считается в worker-е, до готовности видны прежние места. Анимации в первой версии нет.

## Не в этом Epic-е

- **E3 — Harness как часть worfy** ([roadmap](../../docs/roadmap.md)). В том числе остаток
  ADR-0020: выбор аккаунта GitHub в UI при подключении Project, `GH_TOKEN` в окружении Session-ов
  агентов, Profile из двух частей. Ticket 01 берёт из ADR-0020 только аккаунт из нынешнего Profile
  для вызовов `gh`, которые делает сам worfy.
- Раздел Autopilot в [F-SPEC.md](../../docs/design/F-SPEC.md) — E3 (решение владельца 2026-10-07).
- Долги из HANDOFF, раздел «Риски и долги», которые не мешают работать каждый день. Вынос
  `LayoutChannel` из `Canvas.tsx` ради одного мутанта — долг, а не Ticket (решение владельца
  2026-10-07).
- E4 — подпись Developer ID и нотаризация.
- Анимация смены мест на Canvas (переход 150 ms) — отдельный Ticket позже, если понадобится
  (решение 29 владельца 2026-10-07).

## Риски и открытые технические вопросы

1. **Токен GitHub не должен утечь** (Ticket 01). Токен из `gh auth token` живёт только в окружении
   дочернего процесса `gh`: не в логе, не в журнале прогона, не в ответе IPC renderer-у.
2. **Аккаунт есть в Profile, а входа в gh под ним нет** (Ticket 01). `gh auth token -u <аккаунт>`
   падает. Бейдж называет причину, а не идёт молча от глобального аккаунта gh.
3. **Что делает ⌘Z, пока жест ещё идёт** (Ticket 02). Шаг жеста встанет в историю раньше, чем жест
   кончится. Ticket решает и записывает решение в «Итог».
4. **Объём Epic-а заранее неизвестен.** Дефекты недели приходят по ходу. Таблица «Волны» — план,
   а Wave, которую берут в работу, вычисляется заново в момент запуска (CONTEXT.md, Wave).
5. **Worker под `file://` и CSP** (Ticket 03). Renderer грузится с `file://`
   (`src/main/window.ts:142`), CSP — `script-src 'self'` без `worker-src`
   (`src/renderer/index.html:5`). Worker из `blob:` запрещён, module worker с `file://` может не
   запуститься. Worker — отдельный файл сборки; проверка — e2e против собранного приложения, не
   только `pnpm dev`. В test-ах jsdom Worker-а нет: ELK там вызывается напрямую.
6. **Бюджет производительности** (Ticket-ы 03–07). e2e `test/e2e/epic-frame.spec.ts:779` на Project
   размера Auction: interactive ≤ 3 с; с `WORFY_PERF=1` — медиана ≥ 55 fps, самый долгий кадр
   ≤ 100 ms. ELK считает в worker-е; до первого ответа рамка рисуется прежним синхронным расчётом.
   Каждый Ticket пишет цифры до и после в «Итог».
7. **Перетаскивание нескольких Node-ов и поправка main** (Ticket 04). Если main поправляет каждый
   `move` выделения отдельно, первый Node ложится на ещё не сдвинутого соседа из того же выделения и
   уезжает не туда. Поэтому перетаскивание — одна групповая операция, которую main проверяет целиком.
8. **Derived Node-ы двигают друг друга по кругу** (Ticket 04). Порядок уступок строгий: Node-ы
   Layout-а не двигаются; дерево Subagent-ов обходит их и деревья раньше себя; рамки обходят Node-ы,
   деревья и рамки раньше себя. Расчёт дважды подряд даёт тот же ответ — это проверяет test.
9. **Контур места в renderer-е и поправка main расходятся** (Ticket-ы 04, 06). Одна чистая функция
   в `src/shared/layout/free-place.ts` для обоих, детерминированный выбор между равными местами,
   test на общей фикстуре.
10. **Снятие смещений и перекрытий при обновлении не отменяется** (Ticket-ы 03, 04). Нормализация
    при чтении `layout.json` идемпотентна, каждое изменение — строка в логе; ⌘Z её не видит.
11. **Контракт MCP-tools меняется** (Ticket 04, ADR-0003). Агент получает место, отличное от
    запрошенного; описания tools и инструкция агенту говорят, что настоящие x, y — в ответе.

## Соглашения для Ticket-ов этого Epic-а

Как в [worfy-daily](../worfy-daily/spec.md), раздел «Соглашения для Ticket-ов этого Epic-а»:
сначала падающий test, виды test-ов, только чтение чужих файлов, ручные пункты «(вручную)», снимки UI
в двух темах, Autopilot над worfy — только на Stable copy. Отличия:

- **Ветки** — `worfy-week/<NN>`; worktree — по Profile.
- **ADR** — следующий свободный номер в момент взятия Ticket-а (сейчас 0037). Номера заранее не
  держатся: по плану ADR Ticket-а 03 получит 0037, ADR Ticket-а 04 — 0038, но если номер к взятию
  занят, берётся следующий свободный.
- **e2e Canvas-Ticket-ов — в своих spec-файлах** (`test/e2e/no-overlap.spec.ts`, `edges.spec.ts`,
  `snapping.spec.ts`, `tidy-up.spec.ts`), чтобы Ticket-ы одной Wave не делили файлов. Прежний
  spec-файл меняет только тот Ticket, у которого он в «Где в коде».
- **Проверка перед мержем** — `GATE_SCOPE=all gate.sh full` на ветке (правило `rules.md`
  Profile-а worfy). CI на PR — только lint, typecheck, unit и contract test-ы.
- **Ручные проверки** Orchestrator проводит одним блоком, когда владельца нет за Mac-ом (решение
  владельца 2026-10-07). Не сделанный пункт — «не проверено: …» в «Итог» и пункт в HANDOFF,
  раздел «Ждёт владельца».

## Волны

Wave — Ticket-ы, которые можно брать параллельно: все блокеры закрыты, общих файлов в «Где в коде»
нет. Таблица — план. Wave, которую берут в работу, вычисляется заново в момент запуска (CONTEXT.md,
термин Wave). Заголовок раздела и шапка таблицы остаются русскими: это формат, который читает skill
`epic-wave`.

| Тикет | Файлы из «Где в коде» | Волна |
| --- | --- | --- |
| 01 | `src/main/ipc/checks.ts`, `src/main/github/prs.ts`, `src/main/workflow/profile.ts`, `test/contract/github-prs.test.ts`, `test/contract/workflow-profile.test.ts` | 1 |
| 02 | `src/renderer/canvas/history.ts`, `test/unit/history.test.ts` | 1 |
| 03 | `package.json`, `pnpm-lock.yaml`, `src/renderer/canvas/epic-layout.ts`, `src/renderer/canvas/elk/`, `src/renderer/canvas/edge-types/RoutedEdge.tsx`, `src/renderer/canvas/extensions.ts`, `src/renderer/canvas/Canvas.tsx`, `src/renderer/canvas/edges/blocking.ts`, `src/renderer/canvas/sources/epics.ts`, `src/renderer/canvas/sources/subagents.ts`, `src/renderer/canvas/nodes/EpicFrameNode.tsx`, `src/renderer/canvas/nodes/TicketNode.tsx`, `src/renderer/canvas/epic-frame.css`, `src/shared/layout/derived.ts`, `src/main/layout/upgrade.ts`, `src/main/layout/store.ts`, `test/unit/epic-layout.test.ts`, `test/unit/epic-canvas.test.tsx`, `test/unit/subagent-nodes.test.tsx`, `test/contract/layout-store.test.ts`, `test/e2e/epic-frame.spec.ts`, `test/e2e/subagent-tree.spec.ts` | 2 |
| 04 | `src/shared/layout/free-place.ts`, `src/shared/layout/types.ts`, `src/main/layout/store.ts`, `src/main/layout/upgrade.ts`, `src/shared/canvas/tools.ts`, `src/main/mcp/agent-instructions.md`, `src/renderer/canvas/Canvas.tsx`, `src/renderer/canvas/history.ts`, `src/renderer/canvas/epic-layout.ts`, `src/renderer/canvas/sources/epics.ts`, `src/renderer/canvas/sources/subagents.ts`, `test/unit/free-place.test.ts`, `test/contract/layout-store.test.ts`, `test/contract/canvas-tools.test.ts`, `test/contract/layout-pin-tag.test.ts`, `test/unit/history.test.ts`, `test/unit/canvas.test.tsx`, `test/unit/epic-layout.test.ts`, `test/unit/subagent-nodes.test.tsx`, `test/e2e/no-overlap.spec.ts` | 3 |
| 05 | `src/renderer/canvas/edge-focus.ts`, `src/renderer/canvas/overlays/EdgeFocus.tsx`, `src/renderer/canvas/edge-types/RoutedEdge.tsx`, `src/renderer/canvas/edge-types/StepEdge.tsx`, `src/renderer/canvas/edges/blocking.ts`, `src/renderer/canvas/edges/bindings.ts`, `src/renderer/canvas/edges/subagents.ts`, `src/renderer/canvas/sources/workflow-bindings.ts`, `src/renderer/canvas/epic-frame.css`, `test/unit/edge-focus.test.tsx`, `test/unit/binding-canvas.test.tsx`, `test/e2e/edges.spec.ts`, `test/e2e/epic-frame.spec.ts`, `test/e2e/binding.spec.ts` | 3 |
| 06 | `src/renderer/canvas/snapping.ts`, `src/renderer/canvas/overlays/SnapGuides.tsx`, `src/renderer/canvas/NodeResizeClamp.tsx`, `src/renderer/canvas/Canvas.tsx`, `src/renderer/canvas/canvas.css`, `src/renderer/canvas/nodes/CardNode.tsx`, `src/renderer/canvas/nodes/NoteNode.tsx`, `src/renderer/canvas/nodes/SessionNode.tsx`, `src/renderer/canvas/nodes/OrchestratorNode.tsx`, `src/renderer/canvas/nodes/HandoffNode.tsx`, `src/renderer/canvas/nodes/TerminalNode.tsx`, `test/unit/snapping.test.ts`, `test/unit/canvas.test.tsx`, `test/e2e/snapping.spec.ts` | 4 |
| 07 | `src/renderer/canvas/tidy.ts`, `src/renderer/canvas/elk/`, `src/renderer/canvas/overlays/CanvasMenu.tsx`, `src/renderer/palette/commands.ts`, `src/renderer/find/canvas-requests.ts`, `src/renderer/find/CanvasFind.tsx`, `test/unit/tidy.test.ts`, `test/unit/palette-commands.test.tsx`, `test/unit/canvas-menu.test.tsx`, `test/e2e/tidy-up.spec.ts` | 4 |
| 08 | `src/renderer/canvas/sources/epics.ts`, `src/renderer/canvas/nodes/EpicFrameNode.tsx`, `src/renderer/canvas/extensions.ts`, `src/renderer/canvas/Canvas.tsx`, `src/renderer/canvas/history.ts`, `src/renderer/canvas/useLayout.ts`, `test/unit/epic-canvas.test.tsx`, `test/unit/history.test.ts`, `test/e2e/epic-frame-undo.spec.ts` | 5 |
| 09 | `src/renderer/canvas/canvas.css`, `src/renderer/canvas/NodeResizeClamp.tsx`, `src/renderer/canvas/nodes/CardNode.tsx`, `test/unit/node-resize-clamp.test.tsx`, `test/e2e/card-drag.spec.ts` | 5 |
| 10 | `src/renderer/theme/tokens.css`, `test/unit/shadow-tokens.test.ts`, `test/e2e/theme-shadows.spec.ts` | 5 |
| 11 | `src/renderer/canvas/elk/layout.ts`, `test/unit/epic-layout.test.ts`, `test/e2e/done-stack.spec.ts` | 5 |
| 12 | `src/renderer/session/HistoryPopover.tsx`, `src/renderer/canvas/nodes/SessionNode.tsx`, `src/shared/transcript/subagents.ts`, `src/renderer/session/SessionView.tsx`, `src/renderer/session/store.ts`, `src/main/dock-icon.ts`, `test/unit/history-popover.test.tsx`, `test/unit/session-node-remove.test.tsx`, `test/unit/subagents.test.ts`, `test/unit/session-view.test.tsx`, `test/unit/dock-icon.test.ts` | 5 |

Общих файлов у 01 и 02 нет, блокеров нет: оба в Wave 1.

Ticket-ы Canvas (03–07) — по `Blocked by` и спискам файлов:

- **Wave 2 — 03.** Блокеров нет, общих файлов с 01 и 02 нет. Вычисление Wave допустило бы его и
  рядом с ними, но Wave 1 уже идёт без него.
- **Wave 3 — 04 и 05.** Оба ждут 03; 04 ждёт ещё 02, потому что меняет `history.ts`. Общих файлов
  у них нет: 04 — main, общий модуль места, `Canvas.tsx`, `history.ts`, источники рамок и деревьев;
  05 — типы и источники Edge-ей, overlay наведения, `epic-frame.css` и spec-файлы e2e Edge-ей.
- **Wave 4 — 06 и 07.** 06 ждёт 04 (общий модуль места, групповое перемещение), 07 — 03 и 04
  (worker ELK, групповое перемещение). Общих файлов у них нет: 06 — `Canvas.tsx`, `canvas.css`,
  Node-ы с изменением размера; 07 — палитра, контекстное меню, запросы Canvas-у, папка `elk/`.

Ticket-ы дефектов недели (08–12) — из второго круга ручных проверок 2026-10-07:

- **Wave 5 — 08, 09, 10, 11 и 12.** Блокеров нет: всё, на чём они стоят в коде (Ticket-ы 01–07),
  влито. Общих файлов нет. 08 — запись рамки Epic-а в историю ⌘Z: source рамок, `Canvas.tsx`,
  `history.ts`. 09 — `canvas.css` и `NodeResizeClamp.tsx`, без `Canvas.tsx`. 10 — только токены
  `tokens.css`, без правил в `canvas.css` и `epic-frame.css`. 11 — только `elk/layout.ts`, без
  `sources/epics.ts` и `epic-layout.ts`. 12 — подписи Session-ов, превью Subagent-ов и
  `dock-icon.ts`. 08 и 11 оба про рамку Epic-а, но 08 меняет запись её смещения и `collapsed`, а
  11 — раскладку внутри рамки. Если исполнителю понадобится файл другого Ticket-а этой Wave, Ticket
  об этом говорит, и Wave вычисляется заново.

Списки сверены скриптом, который читает «Где в коде» так же, как `src/main/workflow/reader.ts`, и
ищет пересечения правилом `filesOverlap` (`src/shared/workflow/waves.ts:145`): внутри каждой Wave
плана общих файлов нет, каждый блокер — в Wave раньше.
