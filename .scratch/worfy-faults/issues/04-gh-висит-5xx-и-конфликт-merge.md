# 04 — gh висит, отвечает 5xx; конфликт merge

Type: task
Status: open
Blocked by: 02
Source: [spec.md](../spec.md), «Сценарии» (строки «gh висит», «gh отвечает 5xx», «Конфликт merge»), «Решено без владельца», п. 3 и 5, «Правила восстановления» (И2)

## Что происходит

- Run читает PR Ticket-ов своих Wave через `AutopilotDeps.prs` (`src/main/autopilot/run.ts`) в фоне; неудачное
  чтение ничего не пишет, Run идёт дальше; последнее чтение перед `run-stopped` ждёт не дольше `END_READ_MS` (шапка
  `run.ts`, абзац «The narrow fix round»).
- `PrTracker` (`src/main/github/prs.ts:395`): часы `now`, по умолчанию `Date.now` (`prs.ts:403`); после неудачного
  чтения интервал удваивается до `maxIntervalMs` (`fail`, `prs.ts:433-435`).
- gh запускается с timeout 30 с по умолчанию (`prs.ts:110`), `ghRunner` принимает свой (`prs.ts:95`); runner
  `gh-world.ts` — с timeout 15 с (`test/contract/gh-world.ts:64`), для «gh висит» не годится.
- gh stub: файл `fail` в `GH_STUB_DIR` — exit 1 с его текстом (`test/fixtures/gh/gh-stub.mjs:45-47`); режима «висит»
  нет.
- worfy не делает merge (ADR-0002): конфликт видит Orchestrator, а worfy — только Ticket в `blocked`.
  Стоп `blocked-tickets` — `nothingReady` в `src/shared/autopilot/cycle.ts`.

## Что делаем

1. **Режим `hang` в gh stub:** файл `hang` в `GH_STUB_DIR` — вызов ждёт столько миллисекунд, сколько в файле
   (по умолчанию 60 000), потом exit 1. Шапка `gh-stub.mjs` описывает режим. На Windows — тот же `.mjs`.
2. **Своё чтение PR в Run:** поле `faultRun` из Ticket-а 02 — `prs` на
   `new PrTracker({ run: ghRunner({ command: STUB_COMMAND, timeoutMs: ms(500) }), now: <часы test-а>, baseIntervalMs, maxIntervalMs })`
   с `GH_STUB_DIR` сценария; `prsClock` и `prsEveryMs` — те же часы test-а.
3. **gh висит:** `hang` на весь Run. Ожидание: Wave идёт, строк `narrow-round` нет, Stop кончается не позже
   `endReadMs` после последнего хода; `checkRecovery` пустой (И2 — в логе только `pr list`).
4. **gh отвечает 5xx:** `fail` с «HTTP 502: Bad Gateway (https://api.github.com/graphql)» до старта, удалён посреди
   Run. После неудачи `PrTracker` удвоил интервал: test двигает часы на удвоенный интервал и ждёт следующего опроса
   (вызов в логе gh stub), не отсчёт по часам. Ожидание: `narrow-round` из `prs.json` один раз после восстановления.
5. **Конфликт merge:** скрипт `autopilot-fault-conflict.jsonl` — Orchestrator пишет «merge conflict in src/f2.ts»;
   test ставит 02 в `blocked` с причиной, как сделал бы `ticket`. Ожидание: `blocked-tickets`, `ticket-status` 02
   `blocked` один раз; следующий Run не берёт 02 в первую Wave; И2 — gh только читал.

## Готово, когда

- [ ] Test самого gh stub: `hang` ждёт и выходит с exit 1; без файла — прежнее поведение.
- [ ] Contract test: gh висит — Run не стоит на gh, Stop кончается не позже `endReadMs`; `checkRecovery` пустой.
- [ ] Contract test: 5xx, затем восстановление — опрос после удвоенного интервала, `narrow-round` один раз;
      `checkRecovery` пустой.
- [ ] Contract test: конфликт — `blocked-tickets`, 02 `blocked` один раз, новый Run без 02; `checkRecovery` пустой.
- [ ] Каждый test краснеет на испорченном ожидании — в «Итог».
- [ ] `src/` не изменён. `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный (правка fixture-а
      gh запускает все e2e spec-файлы — это ожидаемо).

## Тесты

- Contract `test/contract/autopilot-faults-github.test.ts` (новый); проверка режима `hang` — там же.
- Сначала падающий: «gh висит» до режима `hang` — stub отвечает сразу, ожидание timeout-а красное.
- Прогнать `test/contract/autopilot*.test.ts`, `test/contract/gh-*.test.ts`, `test/contract/*prs*.test.ts`.

## Где в коде

- `test/contract/autopilot-faults-github.test.ts` (новый)
- `test/fixtures/gh/gh-stub.mjs`
- `test/fixtures/agent-scripts/autopilot-fault-conflict.jsonl` (новый)

Только читать: `test/contract/autopilot-faults-setup.ts`, `test/contract/gh-world.ts`, `src/main/github/prs.ts`,
`src/main/autopilot/run.ts`.
