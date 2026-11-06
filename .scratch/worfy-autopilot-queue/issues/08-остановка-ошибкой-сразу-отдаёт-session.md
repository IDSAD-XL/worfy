# 08 — Run, остановленный ошибкой, сразу отдаёт Session человеку: без перезапуска, задачи живут

Type: task
Status: open
Blocked by: 07
Source: [spec.md](../spec.md), «Что видит владелец», п. 6; «Как работает» → «Остановка ошибкой отдаёт Session сразу»; «Решения владельца», 7; «Решено без владельца», 5; «Риски», 1–2; [02](02-старт-при-идущей-работе.md), Q7; случай 2026-11-03 ([worfy-polish 50](../../worfy-polish/issues/50-autopilot-не-стартует-после-остановки-run-а.md))

Начинать после merge worfy-retry 05 и 14 (общие run.ts, cycle.ts, журнал; worfy-retry 04 влит 2026-11-06, PR #1468).

## Что происходит

- `end` (`src/main/autopilot/run.ts:1945`): при любой остановке, кроме `user-force-stop` и `app-quit`, живые задачи или
  идущий ход оставляют Session unattended (`linger`, `:1975-1976`, `:2030`); `release` зовёт
  `setUnattended(false)` (`:2089`), а тот при ходе или задачах только запоминает `wanted = ATTENDED`
  (`src/main/agent/orchestrator.ts:298-312`, `:307`). Перезапуск процесса убил бы задачи (ADR-0029, п. 5).
- `Session.launch` — `readonly` (`src/main/agent/session.ts:175`); смена permission mode в живом процессе уже есть через
  seam Vendor-а `setPermissionPreset` (`src/main/vendors/session.ts:106`; Claude Code —
  `src/main/vendors/claude/session.ts:251-254`; Codex — `src/main/vendors/codex/session.ts:344`, со следующего
  `turn/start`). `launchSettings` держит unattended в `bypassPermissions` (`src/main/agent/session-settings.ts:46-49`).

## Что делаем

1. **Session: смена launch на месте.** `Session.becomeAttended(settings)` — `launch` становится attended, permission
   mode — сохранённый для Node, через `setPermissionPreset`; процесс, задачи и очередь остаются. Отказ seam-а — ошибка,
   вызывающий решает.
2. **Orchestrators.** `setUnattended(false)` при ходе или задачах вместо `wanted = ATTENDED` зовёт `becomeAttended`;
   не удалось — `wanted = ATTENDED`, как сейчас.
3. **Run.** В `end` при причинах, кроме `user-stop`, `user-force-stop`, `app-quit`, — Session отдаётся сразу:
   `orchestrator-returned` с `tasks` (живые задачи) в журнале, keep-awake держится, пока задачи живы (чтобы Mac не
   уснул посреди их работы), затем отпускается. `user-stop` — как сейчас (`linger`).
4. **Строка Canvas** остановленного Run-а: `stopped: <причина> · N background tasks still run`.
5. **`## Amendments` в ADR-0029**, п. 5: остановка, кроме `user-stop`, отдаёт Session без перезапуска; задачи живут в
   Session человека; смена не удалась — прежнее поведение.

## Готово, когда

- [ ] Contract test: `turn-error` при двух живых задачах — Session attended сразу, процесс тот же (нет нового `init`
      от перезапуска), задачи в `orchestrator-returned`, их `task_notification` начинает ход в attended Session.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs run test/contract/autopilot-background.test.ts` exit 0 · mac - · e97076d0a2ac70f80eb0433a55549b4e83ce9312
  - evidence: test-run pass · `node scripts/vitest-electron.mjs run test/contract/autopilot-background.test.ts` exit 0 · mac - · a23bec41e6fce924ee815169693c44c8ce7eae6f
- [ ] Contract test: `user-stop` при живых задачах — как сейчас (unattended до конца задач).
  - evidence: test-run pass · `node scripts/vitest-electron.mjs run test/contract/autopilot-retry.test.ts test/contract/autopilot-background.test.ts` exit 0 · mac - · e97076d0a2ac70f80eb0433a55549b4e83ce9312
  - evidence: test-run pass · `node scripts/vitest-electron.mjs run test/contract/autopilot-retry.test.ts test/contract/autopilot-background.test.ts` exit 0 · mac - · a23bec41e6fce924ee815169693c44c8ce7eae6f
- [ ] Contract test: Codex (fake Codex, временный `CODEX_HOME`) — следующий `turn/start` идёт с режимом Node.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs run test/contract/orchestrator-relaunch.test.ts` exit 0 · mac - · e97076d0a2ac70f80eb0433a55549b4e83ce9312
  - evidence: test-run pass · `node scripts/vitest-electron.mjs run test/contract/orchestrator-relaunch.test.ts` exit 0 · mac - · a23bec41e6fce924ee815169693c44c8ce7eae6f
- [ ] Contract test: seam отказал — `wanted = ATTENDED`, поведение как сейчас.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs run test/contract/orchestrator-relaunch.test.ts test/contract/autopilot-background.test.ts` exit 0 · mac - · e97076d0a2ac70f80eb0433a55549b4e83ce9312
  - evidence: test-run pass · `node scripts/vitest-electron.mjs run test/contract/orchestrator-relaunch.test.ts test/contract/autopilot-background.test.ts` exit 0 · mac - · a23bec41e6fce924ee815169693c44c8ce7eae6f
- [ ] `## Amendments` в ADR-0029.
  - evidence: commit pass · docs: ADR-0029 amendment, stop rows and ticket result for the in-place give-back (worfy-autopilot-queue 08) · - - · 1fc13a60f
  - evidence: commit pass · docs: ADR-0029 amendment, stop rows and ticket result for the in-place give-back (worfy-autopilot-queue 08) · - - · ed1c9ebb2
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный. Ревью не ниже `high`.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · e97076d0a2ac70f80eb0433a55549b4e83ce9312
  - evidence: gate pass · `gate fast` exit 0 · mac - · e97076d0a2ac70f80eb0433a55549b4e83ce9312
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · a23bec41e6fce924ee815169693c44c8ce7eae6f
  - evidence: gate pass · `gate fast` exit 0 · mac - · a23bec41e6fce924ee815169693c44c8ce7eae6f

## Тесты

- Contract `test/contract/autopilot-background.test.ts` (остановка при задачах), `test/contract/orchestrator-relaunch.test.ts`
  (смена без перезапуска); fake agent пишет `setPermissionMode` в свой лог (`src/main/agent/fake-query.ts:364-366`).
- Сначала падающий: `turn-error` при задачах — Session ожидалась attended, сейчас unattended.

## Где в коде

- `src/main/autopilot/run.ts` (`end`, `release`)
- `src/main/agent/orchestrator.ts` (`setUnattended(false)`)
- `src/main/agent/session.ts` (`launch`, `becomeAttended`), `src/main/agent/session-settings.ts`
- `test/contract/autopilot-background.test.ts`, `test/contract/orchestrator-relaunch.test.ts`
- `docs/adr/0029-autopilot-waits-for-background-tasks.md`
- Добавлены в ходе работы (с согласия Orchestrator-а): `src/main/vendors/claude/session.ts` (выбор `canUseTool` на
  каждый запрос), `src/main/vendors/session.ts` (doc `SessionStart.unattended`), `src/shared/autopilot/journal.ts`
  (`tasks` у `orchestrator-returned`), `src/shared/ipc/autopilot.ts` (строка остановленного Run-а),
  `src/main/ipc/autopilot.ts` (4-й аргумент `setUnattended`); test-ы `test/contract/autopilot-retry.test.ts`,
  `autopilot-wiring.test.ts` (раунд 2: проводка `waitForWork`),
  `autopilot-faults-api.test.ts`, `autopilot-faults-setup.ts`, `autopilot-limits-switch.test.ts`, `orchestrator.test.ts`,
  `test/unit/autopilot-journal.test.ts`, `autopilot-wait-line.test.ts`, e2e `test/e2e/autopilot.spec.ts` (test
  worfy-polish 50: после `turn-error` при задачах новый Run ждёт Orchestrator); feature pages `docs/features/autopilot.md` и
  `docs/features/ru/autopilot.md` (две строки таблиц).

Только читать: `src/main/vendors/codex/session.ts`.

## Итог

`Session.becomeAttended(settings)` (`src/main/agent/session.ts`) меняет launch на attended в живом процессе: permission
mode Node-а уходит через `setPermissionPreset`, процесс, задачи и очередь остаются; отказ seam-а — ошибка, launch не
меняется. `Orchestrators.setUnattended(false)` при ходе или задачах сначала пробует её (`attendInPlace`); не удалось —
`wanted = ATTENDED` и перезапуск, когда Session свободна, как раньше. `user-stop` передаёт `waitForWork: true` и идёт
прежним путём. В `Autopilot.end` при остановке по причине самого Run-а (не `user-stop`, `user-force-stop`, `app-quit`)
с живыми задачами или ходом — `giveBackAsItRuns`: Session отдаётся сразу, журнал `orchestrator-returned` с `tasks`,
keep-awake держится, пока задачи живы или идёт ход; строка Canvas — `stopped: <причина> · N background tasks still
run`, число убывает вживую. Claude Code: `canUseTool` выбирает обработчик на каждый запрос по живому
`opts.unattended`, поэтому после отдачи запросы разрешений идут человеку; Codex читает `unattended` при каждом
approval, следующий `turn/start` идёт с режимом Node-а (`on-request`, `workspaceWrite`). `## Amendments` в ADR-0029.

Сначала падающий: до правки `turn-error` при двух задачах оставлял Session unattended (`isUnattended` true), новый
contract test ждал attended. Mutation testing (каждая правка откатывалась, падали test-ы): нет отдачи на месте — 10;
выбор `canUseTool` один раз при старте — тест отдачи на месте и оба теста Off/On; всегда attended — оба теста Off/On;
`unattended` значением вместо getter-а — 4, включая Codex; `{...opts}` вместо `Object.assign` — 4; `user-stop` тоже
отдаёт на месте — тест `user-stop` в `autopilot-retry`; `waitForWork` не учитывается — 3; нет перезапуска после
позднего отказа — 2; keep-awake не держится — 4; `linger` не видит закрытую Session — 1; строка не обновляется — 1;
папка удаляется при отдаче — 1; строка без задач — unit и contract; `orchestrator-returned` без `tasks` — 1;
`entry.launch` не меняется — 5; launch Session не меняется — 6; app-quit не пишет `tasks-killed` — 2.

Решено без владельца:

- `canUseTool` Claude Code выбирается на каждый запрос (`src/main/vendors/claude/session.ts`), а не один раз при
  старте процесса: иначе отданная Session отвечала бы на запросы правилами Run-а. Пока Run держит Session, запросы
  идут прежнему обработчику (Off/Shadow отказывают, On судит политика Run-а).
- keep-awake держится и для идущего хода без задач, не только для задач (как пункт 5 ADR-0029).
- Папка прогона (TMPDIR процесса) после отдачи на месте остаётся и удаляется `sweepRunTemps` при следующем старте
  приложения: процесс продолжает ею пользоваться. Политика Auto-approval отпускается сразу.
- app-quit, пока отданные задачи живы, пишет в журнал `tasks-killed` с причиной `app-quit`.
- Строка «почему смена не удалась» не сделана: пункты «Готово, когда» её не требуют; отказ виден в логе (`warn`).
- Сценарий `autopilot-faults-api`: новый старт после ошибки API теперь ждёт занятый Orchestrator и паузу
  `TASKS_GRACE_MS`, а не перехватывает его.

### Раунд 2

По вердикту `REJECTED` в PR #1512:

- Отдача на месте теперь возвращает человеку и очередь, которую отложил Start now (`entry.kept`): сообщения встают в
  очередь Session первыми и удержанными, `kept` очищается (`attendInPlace`, `src/main/agent/orchestrator.ts`). Раньше
  они брались только при перезапуске attended, которого после отдачи на месте нет, и пропадали при выходе. Contract
  test: Start now с сообщением в очереди → `turn-error` при живых задачах → сообщение в очереди человека, удержано;
  следующий Run его не возвращает второй раз.
- Отказ в смене режима, когда последняя задача кончилась во время попытки: перезапуск ждёт паузу `returnGraceMs`
  (`relaunchAfterGrace`), чтобы не оборвать turn её task-notification; без задач — сразу, как раньше.
- Проводка `waitForWork` через `sharedAutopilot` проверена в `test/contract/autopilot-wiring.test.ts`.
- Отдельные test-ы: политика Run-а отпускается при отдаче (`mode()` — `off`, окружение пустое, папка остаётся); следующий
  процесс отданной Session стартует attended и как Orchestrator.
- Комментарий `becomeAttended`: при отказе на effort процесс остаётся в режиме Node-а, но unattended (`pushSettings` идёт
  model → mode → effort). Откат режима не делался.
- Страницы `docs/features/autopilot.md` и `ru/autopilot.md`: «После любой другой остановки» описывает отдачу на месте,
  прежний текст оставлен для Stop autopilot и для неудачной смены; строка `stopped: turn error · …`; строка решений
  Auto-approval и шаг 5 потока данных. ADR-0029, поправка: что переживает смену на месте, и задача, ждущая человека
  ночью.

Сначала падающие: test очереди Start now и test паузы — красные на коде раунда 1. Mutation testing (правка откатывалась,
test падал): нет `adoptQueue` — 1; `kept` не очищается — 1; `options` не передаётся в проводке — 1; `relaunchIfFree`
вместо паузы — 1; нет `closeApproval(run, false)` при отдаче — 1; launch без `orchestrator` — 1. Выжили и не покрыты:
`stopTimers` и `unobserveSession` в начале `giveBackAsItRuns` (мутанты N25, N26 ревью): без них все test-ы
`autopilot-background` зелёные, в том числе отказ, во время которого задачи кончаются; дешёвого сценария, где они
нужны, не нашлось.
