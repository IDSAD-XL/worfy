# 01 — Рестарт Session не повторяет внешних действий и не снимает отказ в разрешении; правило обновления SDK

Type: task
Status: done — 2026-10-15, [PR #342](https://github.com/IDSAD-XL/worfy/pull/342)
Blocked by: —
Source: [spec.md](../spec.md), решение владельца 2026-10-15, пункт 1 (идея A); исследование
[PR #325](https://github.com/IDSAD-XL/worfy/pull/325), раздел «A. P0 candidate: Claude runtime
compatibility and fail-closed regression tests»; [ADR-0029](../../../docs/adr/0029-autopilot-waits-for-background-tasks.md);
[Claude Code CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md), версии 2.1.296–2.1.299.
Код перечитан по main `fa29974`.

## Что происходит

- **Версии.** SDK закреплён: `"@anthropic-ai/claude-agent-sdk": "0.3.289"` (`package.json:28`).
  Fixtures потока SDK сняты с Claude Code 2.1.289 (`test/fixtures/sdk-messages/README.md:6`).
- **Уже покрыто contract test-ами на fake SDK** (`src/main/agent/fake-query.ts`, строка сценария
  `crash` — `:106`, `:511`):
  - background task-и после `result` и Stop — `test/contract/autopilot-background.test.ts`
    (ADR-0029); `STOP_TEXT` уходит один раз — test на `:383`;
  - Session после падения продолжает SDK session — `test/contract/agent-session.test.ts:153`. Test
    проверяет `resume` и `sessionId` двух запросов, но не то, какие сообщения получил второй процесс;
  - resume после Limits: расчёт времени — `test/unit/autopilot-resume-at.test.ts` (только `resumeAt`
    и разбор сообщения, без отправки); отправка ровно один раз в момент сброса —
    `test/contract/autopilot-limits.test.ts:277`;
  - после Stop Wave не уходит снова — `test/contract/autopilot.test.ts:532`;
  - «Always allow» не переживает Resume — `test/contract/permissions.test.ts:146`.
- **Где worfy сам отправляет ход после рестарта** (по чтению кода):
  1. Падение процесса — `Session.fail` (`src/main/agent/session.ts:702-715`): очередь ставится на
     паузу (`:711`), открытые запросы разрешения отклоняются (`:714`). Ход, который уже ушёл в процесс,
     в очередь не возвращается.
  2. Следующий `send` после падения запускает процесс заново с `resume` (`Session.begin`, `:562`,
     `:570`) и отправляет только новое сообщение.
  3. Relaunch Orchestrator-а (`src/main/agent/orchestrator.ts:456-476`) переносит очередь старой
     Session в новую (`handOverQueue`, `session.ts:402`; `adoptQueue`, `:411-415`). Очередь, которая
     не стояла на паузе, уходит сразу (`:414`).
  4. Autopilot Orchestrator после падения не перезапускает: `state: error` → `session-error`
     (`src/main/autopilot/run.ts:742`) → прогон останавливается (`src/shared/autopilot/cycle.ts:235`).
  5. Resume после Limits — `Autopilot.resume` (`run.ts:906-922`): проверка `isCurrent`
     (`src/main/autopilot/limits-wait.ts:148`), затем одно сообщение-продолжение, не команда Wave.
  6. Команда Wave — `sendWave` (`run.ts:844`). Ticket-ы, прерванные прошлым прогоном, идут только с
     первой Wave нового прогона (`:855-856`).

  Пути, где worfy сам отправил бы ход дважды, по чтению кода нет. Но test-а, который это закрепляет
  для рестарта и relaunch, тоже нет.
- **Разрешения.** `PermissionGate` (`src/main/agent/permissions.ts`): «Always allow» — множество в
  памяти (`:88`, `:155`); «Deny» не хранится, он отвечает на один вызов (`:152`). По комментарию
  (`:8-10`) новая Session и Resume начинают с пустого списка. Unattended Session отклоняет каждый
  вызов (`:56-63`). Не проверено: при рестарте той же Session после падения (`begin()`) объект gate
  тот же, и «Always allow» по коду переживает рестарт — это расходится с комментарием `:8-10`.
  Режим разрешений Node хранится в папке данных worfy (`orchestrator.ts:7-9`, `session-settings.ts`).
- **Повтор внутри Claude Code.** CHANGELOG Claude Code: в 2.1.296 регрессия «headless sessions could
  run an approved tool call twice», исправлена в 2.1.299; вызовы MCP в headless и SDK Session-ах
  после переподключения шли дважды, исправлено в 2.1.299. Fake SDK такое не ловит. Правила, на какой
  версии можно обновлять SDK, в репозитории нет.

## Что делаем

1. **Contract test-ы «не отправлено дважды»** на fake SDK, по одному на путь 1–3 и 5 выше. Каждый
   записывает сообщения, которые получил каждый процесс fake SDK, и проверяет число и текст:
   - падение посреди хода, затем `send` — второй процесс получает только новое сообщение;
   - relaunch Orchestrator-а с очередью на паузе и без паузы — каждое сообщение очереди уходит ровно
     один раз за обе Session;
   - resume после Limits, когда до сброса Session упала, — продолжение не уходит в мёртвую Session и
     не уходит дважды;
   - прерванные Ticket-ы прошлого прогона идут только с первой Wave.
2. **Contract test-ы на разрешения после рестарта:** отклонённый вызов после падения и `send` не
   выполняется сам; режим разрешений Node после relaunch тот же; unattended Session после relaunch
   по-прежнему отклоняет. Для «Always allow» после рестарта той же Session test закрепляет одно
   поведение. Если код расходится с комментарием `permissions.ts:8-10`, исполнитель выбирает, что
   чинить (код или комментарий), и пишет выбор в «Итог»; правка кода — сначала красный test.
3. **Правило обновления SDK** — раздел в `docs/lessons/agents.md` в формате `docs/lessons/README.md`:
   поднимать `@anthropic-ai/claude-agent-sdk` только до сборки, в которой Claude Code ≥ 2.1.299, и в
   том же PR заново снимать `test/fixtures/sdk-messages/` (`scripts/spikes/sdk-probe.ts`). Источник —
   строки CHANGELOG выше. Если тема не подходит к `agents.md`, исполнитель выбирает другой файл и
   правит список тем README.
4. Если test пункта 1 или 2 краснеет — это дефект worfy: чинить в этом Ticket-е, файлы `src/` —
   дописать в «Где в коде».

## Готово, когда

- [x] Test-ы пункта 1 есть и зелёные; на мутанте «очередь после падения не встаёт на паузу»
      (`session.ts:711`) test падения краснеет.
- [x] Test-ы пункта 2 есть и зелёные; поведение «Always allow» после рестарта и выбор — в «Итог».
- [x] Раздел о правиле обновления SDK есть в `docs/lessons/`.
- [x] Ни один test не запускает настоящий Claude Code (только `fake-query.ts`).
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
      `[gate] зелено (full)`; Linux CI зелёный.

## Тесты

- `test/contract/agent-session.test.ts` — падение и `send` (рядом с test-ом `:153`).
- `test/contract/orchestrator.test.ts` — relaunch с очередью.
- `test/contract/autopilot-limits.test.ts` — resume после Limits и упавшая Session; прерванные Ticket-ы.
- `test/contract/permissions.test.ts` — разрешения после рестарта.
- Мутанты: снять паузу очереди в `fail()`; отправить очередь в `adoptQueue` дважды; убрать
  `isCurrent` в `resume`. Каждый краснит свой test; итог — в «Итог».

## Где в коде

- `test/contract/agent-session.test.ts`
- `test/contract/orchestrator.test.ts`
- `test/contract/autopilot-limits.test.ts`
- `test/contract/permissions.test.ts`
- `docs/lessons/agents.md`
- `src/main/agent/permissions.ts` — только комментарий о «Always allow» после падения Claude Code (выбор в «Итог»)

Только читать (не в списке, чтобы не давать ложных пересечений Wave): `src/main/agent/session.ts`,
`src/main/agent/orchestrator.ts`, `src/main/agent/permissions.ts`, `src/main/autopilot/run.ts`,
`src/main/agent/fake-query.ts`.

## Вне скоупа

- Настройки compaction — в `src/` их нет.
- Повтор хода внутри самого Claude Code — его закрывает правило пункта 3, а не test.
- Обновление SDK — отдельным PR по правилу пункта 3.
- Рестарт процесса main worfy целиком: fake SDK умеет только падение Session.

## Итог

Ветка `worfy-reliability/01`. Дефектов worfy test-ы не нашли: ни один новый test не был красным на
main, правок кода нет; в `src/` — только комментарий `permissions.ts`.

**Test-ы пункта 1 (не отправлено дважды).** Каждый записывает сообщения каждого процесса fake SDK
(`messagesPerProcess` / `processes()` по записям `start` и `message`):

- `test/contract/agent-session.test.ts` — падение посреди хода с сообщением в очереди: второй
  процесс получает только новое сообщение; ушедший ход и очередь не повторяются; очередь ждёт
  «Send queued» и уходит один раз.
- `test/contract/orchestrator.test.ts`, блок «Orchestrator relaunch and the messages it carries
  over» — relaunch с очередью на паузе (halt и `giveBackNow`), без паузы (`giveBackNow` без halt) и
  после падения unattended Session (`setUnattended(false)` ждёт конца хода, ход кончается падением):
  команда Wave не уходит снова, каждое сообщение очереди — ровно один раз за обе Session.
- `test/contract/autopilot-limits.test.ts` — Session упала во время ожидания Limits: прогон
  встаёт с `session-error`, таймер отменён, поздний (двойной) таймер ничего не шлёт ни в мёртвую
  Session, ни в Session, отданную человеку; прерванные Force stop-ом Ticket-ы идут только с первой
  Wave следующего прогона (`autopilotWave` получил `resume` `[]`, `[1, 2]`, `[]`), продолжение после
  Limits и Wave 2 их не берут.

**Test-ы пункта 2 (разрешения после рестарта)** — `test/contract/permissions.test.ts`, блок «after
Claude Code died…»: вызов, отклонённый из-за падения, в новом процессе не выполняется, следующий
вызов спрашивает, режим `default` у нового процесса тот же; «Deny» не запоминается ни как отказ,
ни как разрешение — после падения между ходами тот же tool спрашивает снова; unattended Session
после падения и `send` по-прежнему отклоняет сразу. Режим Node после relaunch — в
`orchestrator.test.ts` («keeps the permission mode the user picked…»): unattended Session между
ними отклоняет вызов, её bypassPermissions не сохранён поверх выбора человека.

**«Always allow» после рестарта той же Session — решено без владельца, подтвердить.** По коду
список переживает падение Claude Code: `begin()` берёт тот же `PermissionGate`. Выбор — закрепить
это поведение и уточнить комментарий `permissions.ts`, код не менять. Довод: карточка обещает
«Allow … until this Session ends» (`src/renderer/session/PermissionCard.tsx:94`), а падение Session
не закрывает — Node та же, следующий `send` продолжает её. Цена: после падения tool из списка идёт
без вопроса в новом процессе. Другой путь — очищать список в `fail()` (fail-closed): человек
отвечает заново после каждого падения, а подпись карточки надо менять. Закрыто test-ом «"Always
allow" given before the crash…»; закрыть и открыть заново (Resume) — по-прежнему пустой список.

**Мутанты** (в своём worktree, откат копией):

| Мутант | Красные test-ы |
| --- | --- |
| нет `this.queue.pause()` в `fail()` (`session.ts:711`) | падение посреди хода (`agent-session`); relaunch после падения (`orchestrator`) |
| `this.queue.adopt(taken)` дважды в `adoptQueue` | все три relaunch с очередью (`orchestrator`) |
| нет `!wait.isCurrent(id)` в `resume` (`run.ts:908`) | 3 старых test-а Limits; test «Session упала во время ожидания» зелёный — его держит вторая проверка `phase === 'stopped'` |
| нет `isCurrent` и `phase === 'stopped'` вместе | ещё и «Session упала во время ожидания» (5 красных) |
| нет `run.resume = []` в `sendWave` | «прерванные Ticket-ы только с первой Wave» |
| `cancelAll()` очищает «Always allow» | «Always allow» после падения и старый test о Resume |
| процесс после первого получает canUseTool gate-а, а не отказ unattended | unattended после падения и старый test unattended (по таймауту) |

**Правило обновления SDK** — урок в конце `docs/lessons/agents.md`: поднимать
`@anthropic-ai/claude-agent-sdk` только до сборки с Claude Code ≥ 2.1.299 и в том же PR снимать
`test/fixtures/sdk-messages/` заново. Список тем `docs/lessons/README.md` не правился (не в следе):
описание `agents.md` в нём об SDK не говорит.

### Gate оркестратора (2026-10-15)

- Wave Epic-а под Autopilot: Ticket-ы 01 и 04 параллельно, общих файлов нет; 02 и 03 — исследования, `blocked` для Autopilot (PR #331). Worktree — `.claude/worktrees/rel-01`: номера Ticket-ов разных Epic-ов в шаблоне пути совпадают.
- Гейт — один круг: `VERIFIED` на `2bea632` ([комментарий в PR #342](https://github.com/IDSAD-XL/worfy/pull/342#issuecomment-6186275537)). Verifier сам: `pnpm lint`, `pnpm typecheck`, `pnpm test` — код 0, 5208 passed (gate fast ответил из кэша); четыре test-файла — 122 passed; мутанты Ticket-а и три своих (`takeAll` теряет паузу очереди, ушедший ход повторяется после падения, без копии `autopilot-waves.jsonl`) — все красные. Выбор по «Always allow» отказ не ослабляет: код не менялся, Deny не запоминается, unattended Session после падения отклоняет каждый вызов.
- Мерж: база main `e27868f`, head `282fbac`; `GATE_SCOPE=all gate full` — код 0, не из кэша, `[gate] зелено (full)` с `test:e2e` и `test:package`; CI зелёный, CLEAN; влит `75316ed`.
- Act on, Consider, Dismissed — нет.
- Noted ([low]): `test/contract/permissions.test.ts:379`, `:400-401` — название test-а обещает, что «Always allow» в новом процессе той же Session не покрывает другой tool, а проверяется только внутренний список (`as unknown as { permissions: PermissionGate }`), вызова другого tool после падения нет; почти закрывает старый test `:241`. Урок занимает `docs/lessons/agents.md:117-125`.
- **Решено без владельца, подтвердить:** «Always allow» переживает падение Claude Code внутри той же Session (выбор implementer-а выше).
