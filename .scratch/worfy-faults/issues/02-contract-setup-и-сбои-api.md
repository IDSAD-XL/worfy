# 02 — Contract setup и сбои API: 500, 529, обрыв связи, Limits в Wave 2

Type: task
Status: claimed 2026-11-05T09:24Z
Blocked by: 01
Source: [spec.md](../spec.md), «Сценарии» (строки API 500, API 529, обрыв связи, Limits), «Что уже есть», «Решено без владельца», п. 1, 2, 5, «Где идёт набор»; [worfy-polish 50](../../worfy-polish/issues/50-autopilot-не-стартует-после-остановки-run-а.md), «Что происходит»

## Что происходит

- `harness()` в `test/contract/autopilot-limits.test.ts:210` собирает настоящие `SessionRegistry`, `Orchestrators`,
  `ActionLauncher`, Journal и `Autopilot` над fake agent с фиксированными часами; таймер ожидания Limits — в руках
  test-а. Этот файл не правим: новый setup повторяет сборку, перенос старых test-ов — не в этом Epic-е.
- Поля `AutopilotDeps` (`src/main/autopilot/run.ts`) для test-ов: `settleMs`, `limits`, `backgroundStallMs`,
  `tasksClock`, `prs` / `prsEveryMs` / `prsClock`, `endReadMs`.
- Ход с ошибкой → `turn-error` с событием `session-error` (`src/shared/autopilot/cycle.ts:288`); его текст — в
  Journal (`Autopilot.feed`, `run.ts`). Остановку после API 500 при живых задачах и новый старт проверяет e2e polish 50
  (`test/e2e/autopilot.spec.ts:1054`) — без общих правил.
- Ответ 529 (`overloaded_error`) и обрыв связи посреди потока ответа test-ами Autopilot не проверены; что 529 не
  принимается за Limits — тоже.

## Что делаем

1. **`test/contract/autopilot-faults-setup.ts`** — `faultRun(options)`: временный git-Project с Epic `demo` (Ticket-ы
   01, 02 готовы, 03 после них), fake agent со скриптом сценария, часы и таймеры test-а. Сразу —
   все поля, нужные Ticket-ам 03, 04, 06, чтобы в Wave 3 setup никто не правил:
   - `processes` — Claude process stub (`test/contract/claude-process-stub.ts`) для проверки «живых процессов не
     осталось» (смерть Claude Code сценарий играет директивой `crash`, не SIGKILL);
   - `prs` — свой `PrTracker` с `ghRunner` (`command: STUB_COMMAND`, `timeoutMs`), `now`, `baseIntervalMs`,
     `maxIntervalMs` и `GH_STUB_DIR` сценария; по умолчанию — gh через `test/contract/gh-world.ts`;
   - `vendor` — `claude` или `codex` (fake Codex, временный `CODEX_HOME`), Vendor Orchestrator-а Project-а.

   Возвращает Autopilot, функции, которые двигают часы и запускают таймеры, чтение Journal, сообщения
   Orchestrator-у, лог gh, снимок Project-а — всё, что ждёт `checkRecovery` (Ticket 01). `afterEach` — `stopAll()` stub-а и удаление папок.
   Сборка — по образцу `harness()`, без импорта из test-файла.
2. **Скрипты** (копии `autopilot-background.jsonl` / `orchestrator.jsonl` с заменой одного `result`):
   - `autopilot-fault-api-500.jsonl` — `result` `is_error`, `API Error: 500 {…"api_error"…}`;
   - `autopilot-fault-overloaded.jsonl` — несколько `stream_event`, затем `result` `is_error`
     `API Error: 529 {…"overloaded_error"…}`;
   - `autopilot-fault-connection.jsonl` — `result` `is_error` «API Error: Connection error.».
3. **`test/contract/autopilot-faults-api.test.ts`** — по test-у на сценарий: Run стартует, сбой, проверка
   `checkRecovery` с ожиданием `turn-error` и текстом ошибки; затем новый старт той же Session проходит (И6), и в
   новом Run команда Wave уходит один раз.
4. **Limits в Wave 2:** Wave 1 проходит, ход Wave 2 отказан Limits (`autopilot-limits.jsonl`, как в
   `autopilot-limits.test.ts:364`), таймер test-а «наступает сброс» → `resumed`; `checkRecovery` — Wave 1 не ушла
   снова, Wave 2 — один раз и одно продолжение.

## Готово, когда

- [ ] Contract test: API 500 — `run-stopped` `turn-error`, `session-error` с «API Error: 500»; `checkRecovery` пустой;
      новый Run стартует и шлёт команду Wave один раз.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/autopilot-faults-api.test.ts` exit 0 · mac - · d28453518a44ba9434de54a4acfb936758f7386f
- [ ] Contract test: 529 посреди потока — то же; в Journal нет `limits-hit` (не принят за Limits).
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/autopilot-faults-api.test.ts` exit 0 · mac - · d28453518a44ba9434de54a4acfb936758f7386f
- [ ] Contract test: обрыв связи — то же.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/autopilot-faults-api.test.ts` exit 0 · mac - · d28453518a44ba9434de54a4acfb936758f7386f
- [ ] Contract test: Limits в Wave 2 — `limits-hit`, `waiting-until`, `resumed`; команда Wave 1 одна, продолжение одно;
      `checkRecovery` пустой.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/autopilot-faults-api.test.ts` exit 0 · mac - · d28453518a44ba9434de54a4acfb936758f7386f
- [ ] Каждый test краснеет, если испортить ожидание (вторая отправка команды Wave в setup-е) — записано в «Итог».
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/autopilot-faults-api.test.ts` on the second-send mutant exit 1, 5 of 5 red · mac - · d28453518a44ba9434de54a4acfb936758f7386f
- [ ] Contract test: `faultRun({ vendor: 'codex' })` доходит до `wave-started` (поле для Ticket-а 06 работает).
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/autopilot-faults-api.test.ts` exit 0 · mac - · d28453518a44ba9434de54a4acfb936758f7386f
- [ ] Файл contract test-ов идёт не дольше 20 с по логу `linux-tests` (предел этого Epic-а); после него нет живых процессов stub-а.
- [ ] `src/` не изменён. `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный (Linux и Windows).
  - evidence: gate pass · `gate fast` exit 0 · mac - · d28453518a44ba9434de54a4acfb936758f7386f

## Тесты

- Contract `test/contract/autopilot-faults-api.test.ts` (новый).
- Сначала падающий: API 500 с `checkRecovery`, пока setup не отдаёт сообщения Orchestrator-у.
- Прогнать `test/contract/autopilot*.test.ts`, `test/contract/orchestrator*.test.ts`, `test/unit/autopilot-*.test.ts`.

## Где в коде

- `test/contract/autopilot-faults-setup.ts` (новый; поля `processes`, `prs`, `vendor`)
- `test/contract/autopilot-faults-api.test.ts` (новый)
- `test/fixtures/agent-scripts/autopilot-fault-api-500.jsonl` (новый)
- `test/fixtures/agent-scripts/autopilot-fault-overloaded.jsonl` (новый)
- `test/fixtures/agent-scripts/autopilot-fault-connection.jsonl` (новый)

Только читать: `test/contract/autopilot-limits.test.ts` (`harness()`), `test/contract/autopilot-background.test.ts`,
`test/contract/claude-process-stub.ts`, `test/contract/gh-world.ts`, `src/main/github/prs.ts` (`PrTracker`),
`src/main/autopilot/run.ts`,
`src/main/agent/fake-query.ts`, `test/autopilot-invariants.ts`.

## Итог

- `test/contract/autopilot-faults-setup.ts`: `faultRun(options)` (`:264`) собирает настоящие `SessionRegistry`,
  `Orchestrators`, `ActionLauncher`, `LimitsTracker`, `PrTracker`, Journal и `Autopilot` над fake agent и временным
  git-Project-ом (Epic `demo`: 01 и 02 — Wave 1, 03 после них). Поля для Wave 3:
  - `scripts` — скрипты unattended Session-ов по порядку старта, последний — для всех следующих; `attendedScript`;
    скрипт — имя fixture-а или строки test-а; `releases` — `FakeReleases` для `wait_release`;
  - `marks` — что агент пишет в `Status:` Ticket-ов Wave, когда до него доходит команда (`done`, `claimed`, `none`);
    `setStatus(num, status)` — запись test-а; каждая запись — `StatusWrite` для И3 и сигнал workflow watch;
  - `processes` — Claude process stub за каждым query (`StubKind` или функция); `stopAll()` — в `afterEach`;
  - `prs` — свой `PrTracker` (`:423`) с `ghRunner({ command: STUB_COMMAND, timeoutMs })` над `gh-world.ts`,
    `now`, `baseIntervalMs`, `maxIntervalMs` — часы test-а; `everyMs`, `endReadMs`; включён по умолчанию, `false` —
    Run не читает PR; `gh` — мир stub-а (`GH_STUB_DIR` = `gh.dir`), `pulls` — `prs.json`;
  - `vendor: 'codex'` + `codexScripts` — fake app-server под `scriptNode()`, `CODEX_HOME` — папка test-а; проверку
    одобрения hooks Harness-а setup не делает (`harnessHooks: () => undefined`): её проверяет `codex-orchestrator.test.ts`;
  - `settleMs` (реальное время), `backgroundStallMs`, `tasksGraceMs`, `haltTurnMs`.
  Часы test-а — `FaultClock` (`:137`): `now`, `advance`/`advanceTo` (стреляют таймеры, у которых пришло время;
  таймер, поставленный во время выстрела, ждёт следующего сдвига), `pending()`; это `tasksClock`, `prsClock` и
  `limits.schedule`. Чтение: `journals()`, `journal(n)`, `kinds(n)`, `messages()` (для Codex — из `turn/start` логов),
  `queries()`, `gh.calls()`, `snapshot()`; `start()`/`startAgain()` (`:523`) отдают `{ refusal }`; `recovery(expect)`
  (`:530`) собирает вход `checkRecovery`. `afterEach` (`:178`) останавливает Run-ы, закрывает Session-ы, убивает stub и
  fake-процессы, удаляет папки. `.git` в снимок Project-а не входит.
- **Расхождение с текстом Ticket-а (И6 для API-сбоев).** Сбойный ход — первый ход Wave из `autopilot-background.jsonl`
  с заменённым `result`: два implementer-а ещё живы, поэтому Orchestrator остаётся unattended (ADR-0029), а новый старт
  берёт ту же Session (worfy-polish 50). Скрипт этой Session повторяется по кругу, второй ход до сбоя не дошёл бы
  до конца без ещё одного сбоя, поэтому новый Run после отправки своей команды Wave останавливает Force stop. Агент
  Ticket-ы не отмечает (`marks: 'none'`, как e2e polish 50), и новый Run шлёт команду Wave 1 снова — это Wave нового
  Run-а, И1 её не считает повтором. Test проверяет: одна команда на каждый `wave-started`, оба Run-а — в одном процессе
  Claude Code (`queries()`), gh вызывался и только читал.
- Скрипты: `autopilot-fault-api-500.jsonl`, `autopilot-fault-overloaded.jsonl` (три `stream_event` перед `result`),
  `autopilot-fault-connection.jsonl` — копии `autopilot-background.jsonl`, в которых первый `result` заменён на
  `is_error: true`, `terminal_reason: "api_error"`; `stop_reason` — строка, как в записанных сообщениях
  (`sdk-compat.test.ts` зелёный).
- `test/contract/autopilot-faults-api.test.ts` — 5 test-ов: API 500, 529 (в Journal-ах обоих Run-ов нет
  `limits-hit`, нет `waiting-until`), обрыв связи, Limits в Wave 2 (Wave 2 идёт в новой SDK session со скриптом
  `autopilot-limits.jsonl`; `advanceTo(reset + RESUME_MARGIN_MS)` → `resumed`, одно продолжение, команды Wave — 01, 02
  и 03 по одной, `run-stopped` `no-ready-wave`), `faultRun({ vendor: 'codex' })` доходит до `wave-finished` Wave 1.
  `checkRecovery` пуст во всех четырёх сценариях сбоя.
- Мутант (вторая отправка команды Wave в setup-е: наблюдатель `prompt` шлёт ту же команду ещё раз) в отдельном
  worktree в scratchpad: 5 из 5 test-ов красные за 0,3–0,4 с, на утверждениях (команды Wave `[…3]` вместо `[…2]`,
  Limits — Run не ждал, Codex — `[…2]` вместо `[…1]`). Без явных утверждений о командах три API-test-а краснеют на
  `checkRecovery`: «I1: /epic-wave for wave 1 of run 2 sent 2 times». Worktree мутанта удалён.
- Время: файл — около 2 с локально (Mac, все 5 test-ов); процессов stub-а и fake app-server после прогона нет (`ps`).
  Предел 20 с по логу `linux-tests` локально не проверить — смотреть в CI PR.
- Прогоны: test-ы модуля (`test/contract/autopilot*.test.ts`, `test/contract/orchestrator*.test.ts`,
  `test/unit/autopilot-*.test.ts`) — 26 файлов, 789 test-ов, exit 0; `pnpm lint && pnpm typecheck && pnpm test` — exit 0;
  gate fast — green. `src/` не изменён.
