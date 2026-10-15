# worfy-polish: мелкие исправления, стабильность test-ов и несколько фич по итогу ресерча

Status: черновик Orchestrator-а 2026-10-15 по слову владельца (ниже, «Source»); владелец спит и сказал
не ждать его. Список кандидатов, вердикты, разбиение на Ticket-ы и «Готово, когда» — предложение этого
docs-PR
Source: слово владельца 2026-10-15 ~06:50: «если закончатся задачи, запусти ресерч что можно добавить
или исправить в приложении по итогу придумав 10-20 идей разного размера, от мелких фиксов до больших
фич, хорошие идеи сразу планируй и запускай в имплементацию». Кандидатов собрали два read-only scout-а
(UX и надёжность) по main `fff11ba`; каждый `file:line` перепроверен по коду и Status-ам Ticket-ов
2026-10-15. [CONTEXT.md](../../CONTEXT.md) — термины; ADR
[0002](../../docs/adr/0002-worfy-is-a-view-over-the-workflow.md),
[0005](../../docs/adr/0005-worfy-own-state-inventory.md),
[0033](../../docs/adr/0033-autopilot-names-wave-tickets.md); Epic
[worfy-reliability](../worfy-reliability/spec.md) — формат и соглашения.
Ticket-ы: Epic `worfy-polish`, 12 Ticket-ов, нумерация с `01`. Шапка — тот же диалект, что у
worfy-reliability (`Type:` / `Status:` / `Blocked by:` / `Source:`), чтобы её читали `epic-status`,
`ticket` и вычисление Wave в worfy (`src/shared/workflow/waves.ts`).

## Откуда идеи

Источники кандидатов — разделы «Итог», «Не сделано» и «Долг» влитых Ticket-ов, `HANDOFF.md`
(«Риски и долги», «Дальше» — «Кандидаты»), журналы Autopilot на Mac владельца
(`~/Library/Application Support/worfy/autopilot/*.jsonl`, только чтение) и код main. Уже
запланированное не повторяется: `worfy-week` 14, 19, 20, `worfy-link` 18, 19, `worfy-reliability`
01–04, `worfy-harness` 28–46, абсолютный путь к `gh` в hook-ах (это Harness).

Вердикты: **ticket** — Autopilot делает сам, без владельца; **research** — Ticket-исследование, его
ведёт Session Orchestrator-а; **ждёт владельца**; **потом** — хорошая идея, но не сейчас;
**отброшено** — доказательство не подтвердилось или уже сделано.

| Id | Размер | Идея | Вердикт | Почему |
| --- | --- | --- | --- | --- |
| U1 | M | Subagent без task-notification навсегда `running` — признак живости | отброшено | Уже сделано: сигнал `session-closed` (ADR-0031), `src/shared/transcript/subagents.ts:540-552` ставит такому Subagent-у `error`, когда процесс Session-а закрыт; пока Session жив, `running` — правда |
| U2 | S–M | Файл или картинку бросить прямо на Узел Session-а | ticket 08 | Подтверждено: `SessionNode.tsx:198-207` шлёт `agent.send` только с текстом, файлы принимает лишь `MessageInput.tsx:195` |
| U3 | M | Поиск палитры и по Session-ам, запущенным вне worfy | ticket 10 | Подтверждено: поиск ⌘F (`findDocs`, `src/renderer/find/search-index.ts:340-343`) берёт транскрипты только Session-ов окна, палитра ⌘K знает Session-ы только как Узлы Canvas и только по заголовку (`palette/commands.ts:79-81`, `:292`) |
| U4 | S | Панель выделения закрывает шапку рамки Epic-а и подпись «Done N» | ticket 01 | Подтверждено: `SelectionToolbar.tsx:239-243` всегда ставит панель сверху (`'top'`, 12 px), а Ticket-ы верхнего ряда — сразу под шапкой и подписями колонок (`epic-layout.ts:34-54`, 92 px) |
| U6 | S | Контраст Suggestion Terminal AI 2,30:1 и 2,71:1 при ≥ 4,5:1 | ticket 02 | Фон Terminal-а тёмный в обеих темах (`docs/design/F-SPEC.md:38`), значит один `brightBlack` ≥ 4,5:1 подходит обеим; выбора у владельца не остаётся, цена — в Ticket-е |
| U12 | M | Список ручных проверок «(вручную)» всех Ticket-ов в окне | ticket 09 | Подтверждено: 70 неотмеченных `- [ ] (вручную)` в `.scratch/*/issues/`, из них в 34 файлах со `Status: done`; модель Ticket-а их не читает (`src/shared/workflow/types.ts`) |
| R1 | S | Orchestrator Autopilot теряет ход на запросе разрешения Bash | research 12 | Подтверждено: из 6 `refused-dialog` в журналах 4 — `permission_request Bash`; какие команды — в журнале нет, нужен разбор транскрипта; правка, скорее всего, в Harness или Profile |
| R3 | S | Шум журнала: `background-tasks` писать только при изменении | отброшено | 1555 из 1693 строк — `background-tasks`, но подряд одинаковых `tasks` в одном прогоне 0: каждая строка — настоящее изменение списка задач (`run.ts:752`, `:1122`) |
| R4 | M | Три нестабильных e2e: `edges.spec.ts:166`, `binding.spec.ts:272`, `autopilot.spec.ts:485` | ticket 04 | Подтверждено: «Итог» `worfy-week` 06 и HANDOFF «Риски»; `edges.spec.ts:196` читает толщину линии один раз через `evaluate`, без повтора |
| R5 | M | 32 `waitForTimeout` в `test/e2e` → ожидание состояния | ticket 05 | Подтверждено: 32 вызова в 18 файлах; с R4 общих файлов нет, поэтому отдельный Ticket |
| R6 | S | Contract test-ы читают настоящий `~/.claude/settings.json` | ticket 03 | Подтверждено: HANDOFF «Риски» (`model: haiku` — 10 красных); `WORFY_CLAUDE_HOME` ставят 19 из 97 файлов `test/contract`, общего setup-файла у project-а `contract` нет (`vitest.config.ts:61-67`) |
| R7 | S | Contract test-ы под нагрузкой > 15 s: sleep 1000 ms → ожидание события | отброшено | Три sleep-а намеренные: окно «ничего не пришло» (`workflow-reader.test.ts:789`), окно гонки (`:841`), повтор FSEvents до старта watch (`claude-home-registry.test.ts:750`). Таймауты — от load 6–8 машины, не от них; лечится расписанием параллельных исполнителей (Harness) |
| R8 | M | Project по первому совпадению пути вместо длинного префикса | ticket 11 | Формулировка неверна, долг верен: `targetOf` (`src/main/ipc/checks.ts:68-77`) берёт свой корень Project-а раньше репозитория Project-а над несколькими репозиториями; нужен корень спрашивающего Project-а («Итог» `worfy-harness` 23) |
| R9 | S | `done` читается с невлитой ветки Ticket-а | ticket 07 | Показ — по ADR-0033 и верен (`reader.ts:395-397`). Дефект в другом: готовая Wave считает такой блокер закрытым (`waves.ts:173`), и зависимый Ticket стартует от main без кода блокера |
| R10 | S | Select закрывается при scroll любого элемента | отброшено | Исправлено Ticket-ом `worfy-ui` 09 (PR #291): scroll закрывает список, только если прокрученный элемент содержит кнопку |
| R11 | S | Пачка долгов [low] по test-ам без Ticket-а | ticket 06 | Подтверждено три из четырёх: предел `SHOWN` палитры без test-а (`CommandPalette.tsx:25`, `:236`), `expandMachines` читает `aria-expanded` один раз (`test/e2e/helpers.ts:475`), fixture `epic-frame` с `offset:3` (`canvas-tools.test.ts:486-490`, было `:438`). Четвёртый — `blur` не закрывает список — закрыт `worfy-ui` 09 (Tab, `blur` окна, mousedown снаружи) |
| T1 | L | Terminal AI для bash, fish и PowerShell | потом | Только zsh (ADR-0058); большой порт, не сейчас |

## Цель

Видимые мелочи Canvas и Terminal-а исправлены. Test-ы не зависят от настроек машины и не краснеют от
нагрузки там, где можно ждать состояния, а не время. Wave не стартует Ticket раньше, чем код его
блокера в main. Три небольшие фичи: файл на Узел Session-а, список ручных проверок, поиск по
внешним Session-ам.

Epic готов, когда:

1. Панель выделения не закрывает шапку рамки Epic-а и подписи колонок (Ticket 01); Suggestion и цвет 8
   Terminal-а — ≥ 4,5:1 в обеих темах (Ticket 02).
2. Project `contract` проходит с `model: haiku` в `settings.json` домашней папки (Ticket 03); три
   нестабильных e2e и 32 `waitForTimeout` переведены на ожидание состояния или обоснованы комментарием
   (Ticket-ы 04, 05); долги [low] test-ов закрыты (Ticket 06).
3. Блокер с `done` только в невлитой ветке не делает Ticket готовым к Wave (Ticket 07).
4. Файл, брошенный на Узел Session-а, уходит в Session как вложение (Ticket 08); палитра показывает
   неотмеченные ручные проверки (Ticket 09) и находит текст в транскриптах внешних Session-ов
   (Ticket 10); бейджи Gate, PR, CI верны для репозитория, который ещё и отдельный Project
   (Ticket 11).
5. Есть отчёт о запросах разрешения Bash, на которых Autopilot терял ход, с предложением правки
   (Ticket 12).

## Решения владельца

Владелец спит; его слово 2026-10-15 ~06:50 (выше, «Source») разрешает планировать хорошие идеи и
сразу отдавать их в имплементацию. Решения ниже приняты без него и могут быть пересмотрены в PR:

1. **U6 — ticket, а не «ждёт владельца».** В «Итог» `worfy-terminal-ai` 03 вопрос владельцу — менять ли
   цвет 8 для всего вывода Terminal-а. Требование ≥ 4,5:1 для текста уже есть в
   `docs/design/F-SPEC.md:40`, и фон Terminal-а тёмный в обеих темах: один цвет подходит обеим, и он
   исполняет уже принятое правило. Цвет 8 других программ становится светлее — так у Terminal.app и
   iTerm2. Если владелец не согласен, Ticket 02 откатывается одним revert-ом.
2. **R1 — research.** Правка, скорее всего, в разрешениях Profile-а или Harness — это только по слову
   владельца.

## Не в этом Epic-е

- U1, R3, R7, R10 — отброшены (таблица выше, «Почему»).
- T1 — Terminal AI для других shell-ов — потом.
- Расписание gate параллельных исполнителей под нагрузкой (причина таймаутов R7) — это Harness.
- Изоляция `harness/bin/tests/preflight.test.sh` (`worfy-harness` 11) и абсолютный путь к `gh` — Harness.

## Риски

- **Цвет 8 меняется для всех программ** (Ticket 02): `ls`, `git log` и подсказки zsh, которые рисуют
  цветом 8, станут светлее. Это цель, но владелец может решить иначе (решение 1).
- **Глобальный `WORFY_CLAUDE_HOME` в test-ах** (Ticket 03) включает поведение «песочницы»: установка и
  перенос Harness разрешены в прогоне с этой переменной (`src/shared/ipc/harness.ts:51`,
  `harness-migration.ts:72`). Test-ы, которые проверяют отказ без неё, должны её снимать.
- **Чтение чужих транскриптов** (Ticket 10) — только чтение, с пределом на размер и число файлов; в
  индекс не идут файлы вне `<claudeHome>/projects/` Project-а.

## Соглашения для Ticket-ов этого Epic-а

Как в [worfy-reliability](../worfy-reliability/spec.md), раздел «Соглашения для Ticket-ов этого
Epic-а»: сначала падающий test, только чтение чужих файлов, ручные пункты «(вручную)», Autopilot над
worfy — только на Stable copy, без `gh auth switch`, мерж в main — по очереди. Отличия:

- **Кто ведёт.** Autopilot может брать 01–11 (команда `/worfy:epic-wave tickets 01, 02, 03 of epic
  worfy-polish`). 12 — research: его ведёт Session Orchestrator-а, итог — отчёт в `docs/research/`,
  который читает владелец. В команду Wave Autopilot 12 не входит.
- **Конец Ticket-а** — `pr-green-ci`: PR, зелёный CI на Linux, gate full на Mac перед мержем, мерж —
  Orchestrator.
- **Ветки** — `worfy-polish/<NN>`; worktree — `.claude/worktrees/<NN>`.
- **ADR.** Ticket-ам этого Epic-а новый ADR, скорее всего, не нужен. Ticket 07 уточняет правило
  готовой Wave рядом с ADR-0033; если Orchestrator решит, что нужен ADR, номер выдаёт он в момент взятия:
  следующий свободный. Принятые ADR не правятся.
- **Без платных прогонов.** Ни одного запуска настоящего Claude Code или Agent SDK на подписке или API
  ради test-ов: unit и contract — fake SDK (`src/main/agent/fake-query.ts`).
- **Чужие данные — только чтение.** Журналы Autopilot, транскрипты `~/.claude/projects/` и `.scratch/`
  читаются; worfy ничего не пишет в репозитории Project-ов (ADR-0002, ADR-0005).
- **Правки Harness и Profile** — только по слову владельца (Ticket 12 их только предлагает).
- **CI** — только Linux: lint, typecheck, unit и contract test-ы. e2e и `.app` — локально перед
  мержем: `GATE_SCOPE=all` gate full на ветке (команда — `rules.md` Profile-а worfy).
- **Язык.** Документы — русские, термины — латиницей, из `CONTEXT.md`; текст коммитов и код — английский.

## Порядок

Сначала мелкие видимые исправления и стабильность test-ов: 01, 02, 03, 04, 05. Затем правило Wave 07
(маленькое, но про корректность Autopilot) и долги test-ов 06. Затем фичи: 08 (S–M), 09, 10, и 11.
Зависимостей между Ticket-ами нет; 06 ждёт 04 только из-за общего файла `test/e2e/helpers.ts`.

## Волны

Wave — Ticket-ы, которые можно брать параллельно: все блокеры закрыты, общих файлов в «Где в коде»
нет. Таблица — план. Wave, которую берут в работу, вычисляется заново в момент запуска (CONTEXT.md,
термин Wave). Заголовок раздела и шапка таблицы остаются русскими: это формат, который читает skill
`epic-wave`.

| Тикет | Файлы из «Где в коде» | Волна |
| --- | --- | --- |
| 01 | `src/renderer/canvas/pinning.ts`, `src/renderer/canvas/overlays/SelectionToolbar.tsx`, `test/unit/pinning.test.tsx`, `test/e2e/selection-toolbar-frame.spec.ts` | 1 |
| 02 | `src/renderer/theme/tokens.css`, `src/renderer/canvas/nodes/TerminalNode.tsx`, `test/unit/contrast.test.ts`, `test/unit/terminal-theme.test.tsx`, `docs/design/F-SPEC.md` | 1 |
| 03 | `vitest.config.ts`, `test/setup-contract.ts`, `test/contract/claude-home-isolation.test.ts` | 1 |
| 04 | `test/e2e/edges.spec.ts`, `test/e2e/binding.spec.ts`, `test/e2e/autopilot.spec.ts`, `test/e2e/helpers.ts` | 1 |
| 05 | `test/e2e/card-runtime.spec.ts`, `test/e2e/epic-frame-undo.spec.ts`, `test/e2e/wheel-over-nodes.spec.ts`, `test/e2e/focus.spec.ts`, `test/e2e/done-stack.spec.ts`, `test/e2e/terminal-ai-fix.spec.ts`, `test/e2e/terminal-ai-suggest.spec.ts`, `test/e2e/terminal-ai-next-command.spec.ts`, `test/e2e/card-drag.spec.ts`, `test/e2e/linked-cards.spec.ts`, `test/e2e/handoff.spec.ts`, `test/e2e/terminal-ai-request.spec.ts`, `test/e2e/external-session.spec.ts`, `test/e2e/ship-ticket.spec.ts`, `test/e2e/subagent-tree.spec.ts`, `test/e2e/packaged.spec.ts`, `test/e2e/session-controls.spec.ts`, `test/e2e/epic-frame.spec.ts` | 1 |
| 06 | `test/unit/palette-groups.test.tsx`, `test/e2e/helpers.ts`, `test/contract/canvas-tools.test.ts` | 2 |
| 07 | `src/shared/workflow/waves.ts`, `test/unit/waves.test.ts` | 1 |
| 08 | `src/renderer/canvas/nodes/SessionNode.tsx`, `src/renderer/session/MessageInput.tsx`, `src/renderer/session/attach-files.ts`, `test/unit/session-node-drop.test.tsx`, `test/unit/message-input-attach.test.tsx` | 1 |
| 09 | `src/shared/workflow/manual-checks.ts`, `src/shared/workflow/types.ts`, `src/main/workflow/reader.ts`, `src/renderer/palette/commands.ts`, `test/unit/manual-checks.test.ts`, `test/unit/palette-commands.test.tsx`, `test/contract/workflow-reader.test.ts` | 1 |
| 10 | `src/main/claude-home/search.ts`, `src/main/ipc/claude-home.ts`, `src/shared/ipc/claude-home.ts`, `src/renderer/palette/CommandPalette.tsx`, `test/contract/claude-home-search.test.ts`, `test/unit/palette-transcripts.test.tsx`, `test/contract/claude-home-registry.test.ts` | 1 |
| 11 | `src/main/ipc/checks.ts`, `src/shared/ipc/checks.ts`, `src/renderer/canvas/badges/use-checks.ts`, `test/contract/github-prs.test.ts`, `test/unit/checks-badges.test.tsx` | 1 |
| 12 | `docs/research/2026-10-NN-bash-запросы-разрешения-autopilot.md` | 1 |

Правило плана. Ticket стоит в первой Wave, где закрыты все его блокеры (`Blocked by`). Если у двух
Ticket-ов одной Wave общий файл, Ticket с большим номером уходит в следующую Wave.

- **Wave 1 — 01–05 и 07–12.** Блокеров нет, общих файлов нет. Autopilot берёт из неё 01–05 и 07–11
  порциями (сначала 01–05); 12 ведёт Orchestrator.
- **Wave 2 — 06.** Общий с 04 файл `test/e2e/helpers.ts`.

Пересечения проверены правилом `filesOverlap` (`src/shared/workflow/waves.ts:145`): папка с `/` на
конце пересекается с каждым файлом в ней. Если исполнителю нужен файл вне своего списка (например,
Ticket 03 правит test-ы, которые читают `~/.claude` иначе), он дописывает его в «Где в коде» при claim.
