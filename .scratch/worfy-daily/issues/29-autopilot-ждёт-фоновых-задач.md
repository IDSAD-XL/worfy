# 29 — Autopilot ждёт background task-и Orchestrator-а, Stop их не убивает

Type: task
Status: claimed — 2026-10-06
Blocked by: —
Source: первый настоящий прогон Autopilot 2026-10-06 13:17 (стабильная копия `~/Applications/worfy-stable.app`, собрана из main 01a10ea): журнал прогона `~/Library/Application Support/worfy/autopilot/2026-10-06T10-17-22-244Z-2e53b6.jsonl`, транскрипт Orchestrator-а `~/.claude/projects/-Users-alexey-Stuff-CanvasForAI/f6ab7045-416c-471a-a78d-433567aefa5a.jsonl`; [spec.md](../spec.md), тема A, риск 1; [ADR-0024](../../../docs/adr/0024-autopilot-wave-end-and-keep-awake.md)

## Что произошло

Background task — работа, которую Session Claude Code запустила и не ждёт в своём ходе: Subagent
через tool Agent с `run_in_background`, workflow-скрипт, Bash с `run_in_background`. Когда она
кончается, Claude Code присылает task-notification, и она начинает новый ход Session.

Прогон по журналу (время UTC):

1. 10:17:22.244 — `run-started`. 10:17:22.382 — `wave-started`: Wave 1 прогона, это Wave 4 плана,
   Ticket-ы 06, 07, 08, 09.
2. Orchestrator получил `/epic-wave волна 4 эпика worfy-daily` и прошёл preflight. С 10:18:20 по
   10:18:40 он запустил четыре implementer-а tool-ом Agent в фоне (impl-06…impl-09). Ответ tool-а
   на каждый: «Async agent launched successfully».
3. 10:18:47 — Orchestrator закончил ход текстом о запущенных исполнителях: `result` без ошибки.
4. 10:18:47.545 — `wave-finished`, 10:18:47.546 — `run-stopped` с причиной `no-progress`. Это
   через 85 секунд после старта.
5. 10:18:48 — в транскрипт пришёл `<task-notification>` со статусом `stopped`: «4 background agents
   didn't finish before the previous session ended». Implementer-ы оставили пустые worktree и
   ветки, их потом убрал Orchestrator.

**Почему Wave «закончилась».** Ни один implementer ещё не успел взять Ticket (`ticket claim`).
Свежее чтение модели workflow не нашло Ticket-ов Wave в работе (`src/shared/autopilot/cycle.ts:114-115`),
и цикл счёл Wave законченной (`:116`). Готовая Wave — снова 06–09, отсюда `no-progress` (`:119`).
Конец хода превращается в событие `turn-ended` в `src/main/autopilot/run.ts:309-326`.

**Почему умерли агенты.** После остановки прогон возвращает Orchestrator обычной Session:
`end` → `release` (`run.ts:498`) → `setUnattended(projectId, false)` (`run.ts:525`). Ход уже
закончился, поэтому перезапуск идёт сразу (`src/main/agent/orchestrator.ts:220-221`). `relaunch`
(`orchestrator.ts:414-433`) зовёт `old.session?.close()` (`:421`). `Session.close`
(`src/main/agent/session.ts:407-420`) закрывает query, процесс Claude Code завершается, а с ним все
четыре background task-а.

**Корень.** Skill `epic-wave` (так Harness ведёт Wave) запускает агентов в фоне и заканчивает ход,
пока они работают. Их task-notification приходят позже и начинают новые ходы. ADR-0024 считает,
что один ход — одна Wave. Он сам отверг вариант «только конец хода» именно из-за фоновых
исполнителей, но защитой выбрал Ticket-ы «в работе». Эта защита проигрывает гонку с `ticket claim`:
implementer берёт Ticket через минуты после запуска, а ход Orchestrator-а кончается сразу.

## Что даёт SDK

`@anthropic-ai/claude-agent-sdk` 0.3.289, Claude Code 2.1.289. Файл —
`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`.

- **`system/background_tasks_changed`** (`sdk.d.ts:3704-3724`) — полный список живых background
  task-ов Session после каждого изменения: старт, конец, kill, перевод foreground-задачи в фон.
  - Это уровень, а не фронт: свой набор заменяют каждым payload-ом целиком. Пропущенное событие
    конца поэтому не оставляет вечный `running`.
  - Задачи с `ambient: true` (`:3720`) — служебные, не работа. Их не считать.
  - Набор живёт в процессе. На старте процесса событие не приходит: при каждом (пере)запуске
    процесса Claude Code набор сбрасывается в пустой.
  - В бинарнике Claude Code событие шлётся без env-флага.
- **Фронты.** `system/task_started` (`:6048-6082`): `is_backgrounded` (`:6061`), `task_type`
  (`:6066`), `ambient` (`:6079`). `system/task_notification` (`:5993-6021`): `status` — `completed`,
  `failed` или `stopped` (`:5998`). `reason: 'worker_restart'` (`:6002`) — процесс перезапустился, и
  задача осиротела. Ещё есть `task_updated` (`:6084`) и `task_progress` (`:6023`).
- **`system/session_state_changed`** (`:5858-5867`). По комментарию SDK, `idle` приходит, когда
  кончился цикл ожидания фоновых агентов: «authoritative turn-over signal». Но Claude Code шлёт его
  только с env `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS` или `CLAUDE_CODE_SDK_READS_SESSION_STATE`
  (строки бинарника). Без них событие в Ticket-е 06 worfy-mvp не пришло ни разу.
- **Управление.** `Query.stopTask(taskId)` (`:3215-3219`) — после него придёт task_notification
  `stopped`. `Query.backgroundTasks(toolUseId?)` (`:3220-3234`) — перевод foreground-задач в фон.
  Запроса «дай список живых задач» нет: только `background_tasks_changed`.

**Что уже есть в worfy.**

- `sdkMessageToEvents` делает из `task_started` и `task_notification` событие `subagent`
  (`src/shared/agent/events.ts:339-368`). `task_progress` и `task_updated` молчат (`:297`).
  `background_tasks_changed` уходит в `unknown` (`:369-370`).
- `onEvent` прогона событие `subagent` пропускает (`src/main/autopilot/run.ts:301-339`, `default`).
- Ход от task-notification Session уже понимает: `system/init` при `idle` делает её `busy`
  (`src/main/agent/session.ts:556-557`), `result` — снова `idle` (`:560-567`). Такой ход идёт без
  события `prompt`, поэтому `run.turns` не растёт, и `endsWave` (`run.ts:169-171`) принимает его
  `result` как ход Wave.
- Дерево Subagent-ов из транскриптов (`src/shared/transcript/subagents.ts`, `statusOf` `:371-378`;
  `src/main/claude-home/subagents.ts`) — для показа на Canvas. Для Autopilot оно не годится: файл
  догоняет события с задержкой, а зависшие там `running` чинит Ticket 08.

**Источник для Autopilot** — события живой Session прогона:

1. Основной — `background_tasks_changed`.
2. Запасной, если первый шаг покажет, что это событие не приходит: пары `task_started` /
   `task_notification` по `task_id` с момента отправки Wave, без `ambient`, со сбросом на новом
   процессе.
3. Транскрипт (`<task-notification>` разбирает `src/shared/transcript/parse.ts:75`) — только если
   не годятся оба.

## Что делаем

**Первый шаг — проверка на настоящем Claude Code, итог в «Итог» до кода.** Скрипт на SDK во
временной папке, модель sonnet. Снятые сообщения — фикстура
`test/fixtures/sdk-messages/background-tasks.jsonl`, версия Claude Code — в её README. Ответить:

1. Приходит ли `background_tasks_changed` в поток SDK, когда Session запускает Agent с
   `run_in_background`. В каком порядке оно идёт относительно `task_started` и `result`.
2. Начинает ли Claude Code в режиме SDK (streaming input) сам новый ход, когда после `result`
   приходит task-notification: `system/init` → … → `result`. Что приходит при двух задачах.
3. Когда приходит `session_state_changed: idle` с `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1`: после
   первого `result` или только после последнего хода от task-notification. Если после последнего,
   ADR может взять его как признак конца хода.
4. Дают ли `background_tasks_changed` workflow-скрипт и Bash с `run_in_background`.

**[ADR-0029](../../../docs/adr/0029-autopilot-waits-for-background-tasks.md)** — номер выдал
Orchestrator. Он дополняет ADR-0024 в вопросе «когда Wave закончена» (пункты 1–3) и в возврате
Orchestrator-а после остановки (пункт 6). ADR-0024 не правится (ADR-0017): ADR-0029 называет, какие
его пункты заменяет. ADR принимается до кода и решает:

1. **Когда Wave закончена.** Должно выполняться всё сразу:
   - последний ход Orchestrator-а закончился `result` без ошибки и без прерывания;
   - у Session прогона нет живых background task-ов, не считая `ambient`;
   - Session `idle`, её очередь пуста;
   - ни один Ticket Wave не в работе — правило ADR-0024 остаётся.

   worfy держит Session живой и ждёт ходов, которые начнут task-notification. Ход от
   task-notification — тоже ход Wave, и Wave кончает его `result`.
2. **Ожидание.** Пока задачи живы, прогон стоит в новой фазе цикла. Строка состояния:
   «Wave 1 · 4 background tasks». Таймер `SETTLE_MS` (10 минут, `cycle.ts:35`) в этой фазе не идёт:
   implementer работает дольше. Ожидание без предела запрещено: зависший Subagent (Ticket 08)
   держал бы прогон вечно. Предел выбирает ADR. Предложение: если N минут нет ни одного события
   задач (`task_progress`, `task_updated`, `task_notification`, `background_tasks_changed`), прогон
   останавливается с новой причиной, например `background-stalled`, и пишет в журнал список задач.
3. **Измеримое правило для `no-progress`.** `wave-finished`, `no-progress` и `no-ready-wave`
   возможны только в состоянии «живых задач 0 и Session `idle`». Проверка — журнал прогона: между
   первым непустым набором задач и `result` хода, после которого набор пуст, нет ни `wave-finished`,
   ни `run-stopped`.
4. **Stop не убивает задачи молча** — при любой причине, включая `user-stop` и `no-progress`. ADR
   выбирает один из двух путей и объясняет выбор:
   - **(а) Отложенный перезапуск.** Прогон останавливается сразу: `run-stopped`, новые Wave-ы не
     уходят. Orchestrator возвращается обычной Session, только когда ход кончился и живых задач 0.
     Это расширение нынешнего ожидания конца хода: `entry.wanted = ATTENDED` (`orchestrator.ts:218-219`)
     и `relaunchLater` на `idle` (`:369`, `:440-447`). Пока ждём, Session остаётся без человека, и
     ходы от task-notification идут в ней. Новый старт Autopilot отклоняется, как сейчас при идущем
     ходе (`orchestrator.ts:228`).
   - **(б) Остановка без перезапуска.** Orchestrator остаётся Session без человека, пока человек сам
     не перезапустит её или не закроет приложение.

   Рекомендация — (а). Работа не теряется, и Session возвращается человеку сама, как сейчас после
   идущего хода. При (б) Session человека неопределённо долго живёт в `bypassPermissions`.

   ADR также решает:
   - держится ли keep-awake до перезапуска. Рекомендация: да, иначе Mac уснёт посреди работы агентов;
   - есть ли явное «остановить и убить задачи» (`stopTask` каждой задачи) и как оно пишется в журнал;
   - что пишется в журнал: какие задачи были живы на остановке и когда Orchestrator вернулся обычной
     Session.

   `app-quit` закрывает процесс и задачи неизбежно. Молча это не происходит: журнал перечисляет
   живые задачи.

**Код, по решению ADR:**

- `src/shared/agent/events.ts`. `background_tasks_changed` становится новым событием со списком
  задач (`taskId`, `taskType`, `description`, `ambient`). Событие `subagent` получает
  `isBackgrounded`, `taskType`, `ambient` и `reason`.
- `src/shared/agent/background-tasks.ts` (новый) — чистая свёртка событий Session в набор живых
  задач. Замена набора по списку, пары started/finished как запасной путь, сброс на новом процессе.
- `src/main/agent/session.ts` — Session знает, когда стартует новый процесс Claude Code. Она
  сбрасывает набор и отдаёт его наружу: прогону и Orchestrator-у.
- `src/shared/autopilot/cycle.ts` — фаза ожидания задач, правило конца Wave из пункта 1, новая
  причина остановки.
- `src/main/autopilot/run.ts` — кормит цикл событиями задач, ведёт таймер предела, Stop по ADR.
- `src/main/agent/orchestrator.ts` — перезапуск ждёт и конца хода, и пустого набора задач.
  `setUnattended(true)` при живых задачах отклоняется.
- `src/shared/autopilot/journal.ts` — новые события журнала.
- `src/shared/ipc/autopilot.ts`, `src/renderer/canvas/actions/AutopilotAction.tsx` — строка
  состояния.
- `src/main/agent/fake-query.ts` — новая директива: сценарий стоит, пока test его не отпустит
  (например `{"fake":"wait_release","name":"tasks"}`). Fake-агент записывает `close()`, вызванный
  при живых задачах.

## Готово, когда

- [x] В «Итог» — ответы первого шага с версией Claude Code. Снятая фикстура лежит в `test/fixtures/sdk-messages/`.
- [x] ADR-0029 принят до кода. Он дополняет ADR-0024 в вопросе «когда Wave закончена» и выбирает (а) или (б) для Stop с объяснением.
- [x] Fake-сценарий: Orchestrator запускает две background task-и и кончает ход, пока Ticket-ы Wave ещё `open`, как в настоящем прогоне. Прогон остаётся в Wave: нет `wave-finished` и `run-stopped`, статус `running`. Wave кончается только после `result` последнего хода от task-notification, дальше — по ADR-0024.
- [x] Правило `no-progress` из пункта 3 проверено по журналу: пока набор задач не пуст или Session `busy`, нет ни `wave-finished`, ни `run-stopped`.
- [x] Задача с `ambient: true` Wave не держит. Без `background_tasks_changed`, только на парах `task_started` / `task_notification`, Wave держится так же.
- [x] Stop при живых задачах (`user-stop`, и остановка по причине цикла) не вызывает `close()` fake-агента, пока набор не пуст. Дальше — по выбору ADR. Новый старт Autopilot в это время отклоняется.
- [x] Предел ожидания задач на фиксированных часах останавливает прогон с причиной из ADR, со списком задач в журнале.
- [x] `app-quit` при живых задачах пишет их в журнал.
- [x] Снимки строки состояния ожидания задач в двух темах сверены с F-SPEC.
- [ ] (вручную) Повторный прогон Autopilot со стабильной копии на настоящей Wave — Ticket-ы 06–09 после влития этого Ticket-а и обновления копии по README. Прогон не останавливается, пока implementer-ы работают. `wave-finished` приходит после их task-notification и хода Orchestrator-а за ними. Как проверить: журнал прогона и транскрипт Orchestrator-а — в нём нет «didn't finish before the previous session ended».

Ручной пункт агент не проверяет: настоящий Autopilot требует стабильной копии и настоящего
Claude Code. Если он не сделан, в «Итог» пишется «не проверено: …» с причиной, а в HANDOFF, раздел
«Ждёт владельца», — пункт для человека. Так же сделано у Ticket-ов 03, 04 и 05.

## Тесты

- `test/fixtures/agent-scripts/autopilot-background.jsonl` (новый). Ход Wave: два `task_started`
  с `is_backgrounded: true`, `background_tasks_changed` с двумя задачами, текст, `result`. Потом
  ожидание отпускания test-ом. Потом по каждой задаче: `task_notification`, новый
  `background_tasks_changed`, ход от task-notification (`system/init`, текст, `result`).
- `test/contract/autopilot-background.test.ts` (новый) — прогон на fake-агенте во временном Project.
  Случаи — из «Готово, когда»: Wave держится и кончается; `ambient`; запасной путь на парах; Stop
  не закрывает Session при живых задачах; предел на фиксированных часах.
- `test/unit/background-tasks.test.ts` (новый) — свёртка набора задач.
- `test/unit/autopilot-cycle.test.ts` — переходы новой фазы.
- `test/contract/agent-events.test.ts` — новое событие. Снятая фикстура подхватывается сама:
  test читает всю папку `sdk-messages`.
- `test/e2e/autopilot.spec.ts` — e2e на fake-агенте: строка состояния ожидания задач, Stop при
  живых задачах, снимки в двух темах.
- Сначала падающий test — первый случай contract-test-а. На нынешнем main прогон пишет
  `wave-finished` и `run-stopped` с `no-progress` сразу после первого `result`, как в настоящем
  прогоне.

## Где в коде

- `docs/adr/0029-autopilot-waits-for-background-tasks.md` (новый)
- `src/shared/agent/events.ts`
- `src/shared/agent/background-tasks.ts` (новый)
- `src/main/agent/session.ts`
- `src/shared/autopilot/cycle.ts`
- `src/main/autopilot/run.ts`
- `src/main/agent/orchestrator.ts`
- `src/shared/autopilot/journal.ts`
- `src/shared/ipc/autopilot.ts`
- `src/renderer/canvas/actions/AutopilotAction.tsx`
- `src/main/agent/fake-query.ts`
- `test/fixtures/sdk-messages/`
- `test/fixtures/agent-scripts/autopilot-background.jsonl` (новый)
- `test/unit/background-tasks.test.ts` (новый)
- `test/unit/autopilot-cycle.test.ts`
- `test/contract/autopilot-background.test.ts` (новый)
- `test/contract/agent-events.test.ts`
- `test/e2e/autopilot.spec.ts`

Общие файлы с более поздними Ticket-ами. Этот Ticket идёт раньше их всех: 06–09 блокированы им,
остальные Ticket-ы — через 06–09.

- `src/main/agent/session.ts`: 29 → 07 → 23 → 24.
- `src/main/agent/fake-query.ts`: 29 → 07 → 24.
- `src/main/agent/orchestrator.ts`: 29 → 10 → 27.
- `src/shared/agent/events.ts`: 29 → 14.

## Итог

### Первый шаг: проверка на настоящем Claude Code

Снято 2026-10-06: `@anthropic-ai/claude-agent-sdk` 0.3.289, Claude Code 2.1.289 (нативный бинарник
из пакета SDK), Node 24.19.0, macOS arm64, вход по подписке, модель sonnet, streaming input,
`settingSources: []`, без MCP, `bypassPermissions`, во временной папке. Сценарий — один Bash
`sleep 5` с `run_in_background: true`, затем ожидание хода от task-notification;
`CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1`. Поток — `test/fixtures/sdk-messages/background-tasks.jsonl`.
Порядок (мс от старта):

```
2478 session_state_changed running · 2499 init · 3872 assistant (tool_use Bash)
4174 background_tasks_changed [bo1g8a214 local_bash] · 4175 task_started (is_backgrounded: true)
4178 user (tool_result) · 4953 assistant · 4969 result/success · 4971 session_state_changed idle
9196 background_tasks_changed [] · 9196 task_updated (status completed) · 9196 task_notification completed
9230 session_state_changed running · 9242 init · 10247 assistant · 10267 result/success · 10268 idle
```

1. `background_tasks_changed` приходит в поток SDK без env-флага. Он идёт **перед** `task_started`
   задачи и **перед** `task_updated` / `task_notification` её конца; `result` хода — после
   первого. Проверено на Bash (`task_type: local_bash`). Agent с `run_in_background` не снимался:
   бриф разрешил один короткий вызов с фоновым Bash. Что `local_agent` тоже входит в набор,
   говорит `sdk.d.ts:3704-3724` («a foreground agent being backgrounded»), не проверка.
2. Да: после `result` и конца задачи Claude Code сам начинает новый ход — `system/init` →
   `assistant` → `result`, без сообщения от worfy. Две задачи не снимались (тот же запрет брифа);
   по коду worfy каждая task-notification даёт свой ход или попадает в уже идущий.
3. `session_state_changed: idle` приходит сразу после **первого** `result`, пока фоновая задача
   ещё идёт (4971 мс против 9196 мс конца задачи). Признаком конца работы Session оно не годится;
   ADR-0029 его не берёт.
4. Workflow-скрипт не снимался (запрет брифа). Bash с `run_in_background` даёт
   `background_tasks_changed` — пункт 1.

### Что сделано

- ADR-0029 (`docs/adr/0029-autopilot-waits-for-background-tasks.md`) принят до кода: набор живых
  задач из `background_tasks_changed` с запасным путём на парах, фаза ожидания `tasks`, предел
  60 минут без событий задач (`background-stalled`), 2 минуты на ход от task-notification после
  конца последней задачи, Stop — вариант (а), keep-awake держится до возврата Orchestrator-а,
  явного «убить задачи» нет.
- `src/shared/agent/events.ts`: события `background_tasks_changed`, `task_activity`
  (`task_progress`, `task_updated`), `background_tasks` (счёт Session); у `subagent` — поля
  `isBackgrounded`, `taskType`, `ambient`, `reason` (необязательные: транскрипт их не даёт).
  `session_state_changed` стал тихим, как `hook_started`: без env-флага его нет, а с флагом
  его `idle` не годится.
- `src/shared/agent/background-tasks.ts` — свёртка; `Session` (`src/main/agent/session.ts`)
  сбрасывает набор на каждом новом процессе, при его смерти и при `close()`, отдаёт его
  `backgroundTasks()` и событием `background_tasks`.
- `src/shared/autopilot/cycle.ts`: фаза `tasks`, событие `tasks-timeout`, `turn-ended` несёт
  число живых задач и `idle`; причина `background-stalled`.
- `src/main/autopilot/run.ts`: число задач берётся в момент `result` (а не после чтения модели
  workflow: иначе следующая задача успевала кончиться до хода от её task-notification, и Wave
  кончалась раньше этого хода — test это ловил); `idle` — в момент решения. Таймер ожидания —
  на часах `tasksClock`, которые test подменяет. После Stop с живыми задачами прогон
  остаётся «держащим» (`anyRunning()` — да, чтобы выход из приложения дождался `stopAll()` и
  записал `tasks-killed`), пишет `background-tasks` и `orchestrator-returned`.
- `src/main/agent/orchestrator.ts`: возврат обычной Session ждёт конца хода и пустого набора;
  после опустевшего набора ждёт ход от task-notification 30 секунд (`RETURN_GRACE_MS`).
  `setUnattended(true)` отклоняется (`ORCHESTRATOR_HAS_TASKS`), пока живы задачи или ждёт возврат.
- Журнал (`src/shared/autopilot/journal.ts`): `background-tasks`, `orchestrator-returned`,
  `tasks-killed`, у `run-stopped` — необязательный `tasks`.
- Строка состояния: «Wave 1 · 2 background tasks» (`autopilotStatusLine`), поле
  `backgroundTasks` в `AutopilotState`.
- Fake-агент: директива `{"fake":"wait_release","name":…}` (`FakeReleases`, в e2e —
  `globalThis.worfyFakeRelease` в main) и запись `close` при живых задачах.

### Тесты

- `test/contract/autopilot-background.test.ts` — 10 случаев на fake-агенте по «Готово, когда».
  Первый случай сначала падал на нынешнем main (у Session не было набора задач). Мутанты
  проверены: без перехода в фазу `tasks` краснеют 12 test-ов (contract и unit), без ожидания
  задач в `setUnattended(false)` — 4 случая Stop/предела/выхода, без перезапуска предела на
  событии задачи — случай «a task event … sets the limit anew».
- `test/unit/background-tasks.test.ts`, `test/unit/autopilot-cycle.test.ts` (переходы фазы),
  `test/contract/agent-events.test.ts` (новые события, снятая фикстура, отказ на неверной форме
  и вырезание лишних ключей), `test/e2e/autopilot.spec.ts` (строка, Stop при живых задачах,
  снимки в двух темах).
- Вне следа тикета пришлось поправить test-ы, которые перечисляют поля и виды событий:
  `test/unit/autopilot-journal.test.ts`, `test/contract/autopilot-journal.test.ts` (новые виды
  журнала), `test/contract/autopilot.test.ts`, `test/contract/autopilot-limits.test.ts`
  (поле `backgroundTasks` состояния), `test/unit/autopilot-run.test.ts` (`backgroundTasks()` у
  `RunSession`). README фикстур `test/fixtures/sdk-messages/README.md` — новая строка.

### Не проверено

- не проверено: снимки строки в двух темах сняты e2e (`autopilot-background-tasks-light.png`,
  `-dark.png` в выводе Playwright) и показывают строку над «Stop autopilot», но сверить их с
  F-SPEC не с чем: в `docs/design/F-SPEC.md` нет раздела про Autopilot. Стиль — тот же, что у
  строк Ticket-ов 04 и 05.
- не проверено: ручной повторный прогон на стабильной копии — его делает оркестратор после
  влития (настоящий Autopilot на настоящем Claude Code в этом тикете запускать запрещено).
- не проверено на настоящем Claude Code: Agent с `run_in_background`, две задачи сразу,
  workflow-скрипт, и приходит ли `task_progress` у фонового Subagent-а во время долгой
  Bash-команды внутри него. Если не приходит, предел 60 минут — единственная защита от
  ложного `background-stalled` у implementer-а, который ждёт CI дольше часа одной цепочкой
  команд.
- Session, закрытая не возвратом, а удалением Project-а из списка, тоже даёт строку
  `orchestrator-returned` в журнале остановленного прогона.

