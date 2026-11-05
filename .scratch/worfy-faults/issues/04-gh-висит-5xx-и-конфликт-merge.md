# 04 — gh висит, отвечает 5xx; конфликт merge

Type: task
Status: done 2026-11-05T18:02Z
PR: #1441
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
  - evidence: test-run pass · `pnpm test test/contract/autopilot-faults-github.test.ts` exit 0 · mac - · c48e4fcf05f18fc34060a0ebdd9113b41279848e
  - evidence: review pass · PR #1441 · - - · a7f463c7c2d32e26a746e604d664cbf0f34f9486
- [ ] Contract test: gh висит — Run не стоит на gh, Stop кончается не позже `endReadMs`; `checkRecovery` пустой.
  - evidence: test-run pass · `pnpm test test/contract/autopilot-faults-github.test.ts` exit 0 · mac - · c48e4fcf05f18fc34060a0ebdd9113b41279848e
  - evidence: review pass · PR #1441 · - - · a7f463c7c2d32e26a746e604d664cbf0f34f9486
- [ ] Contract test: 5xx, затем восстановление — опрос после удвоенного интервала, `narrow-round` один раз;
      `checkRecovery` пустой.
  - evidence: test-run pass · `pnpm test test/contract/autopilot-faults-github.test.ts` exit 0 · mac - · c48e4fcf05f18fc34060a0ebdd9113b41279848e
  - evidence: review pass · PR #1441 · - - · a7f463c7c2d32e26a746e604d664cbf0f34f9486
- [ ] Contract test: конфликт — `blocked-tickets`, 02 `blocked` один раз, новый Run без 02; `checkRecovery` пустой.
  - evidence: test-run pass · `pnpm test test/contract/autopilot-faults-github.test.ts` exit 0 · mac - · c48e4fcf05f18fc34060a0ebdd9113b41279848e
  - evidence: review pass · PR #1441 · - - · a7f463c7c2d32e26a746e604d664cbf0f34f9486
- [ ] Каждый test краснеет на испорченном ожидании — в «Итог».
  - evidence: test-run pass · `pnpm test test/contract/zz-mutant-` exit 1, 4 of 4 spoiled copies red · mac - · c48e4fcf05f18fc34060a0ebdd9113b41279848e
  - evidence: review pass · PR #1441 · - - · a7f463c7c2d32e26a746e604d664cbf0f34f9486
- [ ] `src/` не изменён. `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный (правка fixture-а
      gh запускает все e2e spec-файлы — это ожидаемо).
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · c48e4fcf05f18fc34060a0ebdd9113b41279848e
  - evidence: gate pass · `gate fast` exit 0 · mac - · c48e4fcf05f18fc34060a0ebdd9113b41279848e
  - evidence: review pass · PR #1441 · - - · a7f463c7c2d32e26a746e604d664cbf0f34f9486
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/42075746811/job/127430753029 · ci - · a7f463c7c2d32e26a746e604d664cbf0f34f9486

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

## Итог

- `test/fixtures/gh/gh-stub.mjs`: режим `hang` — файл `hang` в `GH_STUB_DIR`; вызов пишет свой pid в `hang.pids`
  рядом, ждёт столько миллисекунд, сколько в файле (60 000 без числа), и выходит с exit 1 («gh stub: hung for N ms»).
  `fail` проверяется раньше и отвечает сразу. Без файла stub ведёт себя как раньше: все test-ы, которые используют
  `gh-stub.mjs` и `gh-world.ts` (18 файлов unit и contract вместе с `test/contract/autopilot*.test.ts`), зелёные.
  `hang.pids` — добавка к тексту Ticket-а: по нему test проверяет, что зависший stub не пережил timeout `ghRunner`, а
  `afterEach` добивает SIGKILL-ом то, что ещё живо (на Mac после прогона `pgrep -f gh-stub.mjs` пуст).
- `test/contract/autopilot-faults-github.test.ts` — 5 test-ов, файл идёт 5,1–5,2 с (предел Epic-а — 20 с):
  - stub: `hang` 400 мс → exit 1 не раньше 400 мс, один pid; `fail` при `hang` отвечает сразу; без файлов — exit 0;
    `gh-world.ts` читает `prs.json` как раньше, `hang.pids` не появляется;
  - **gh висит:** `timeoutMs: ms(500)`, `baseIntervalMs` 1 с, `endReadMs` 5 с на часах test-а. Wave 1 и Wave 2
    стартуют, пока чтение Wave 1 висит; timeout убивает этот stub. Ход Wave 2 ждёт test (`wait_release`), test двигает
    часы на удвоенный интервал и отпускает ход: последнее чтение перед `run-stopped` запускает новый зависший вызов.
    Test двигает часы ровно на `endReadMs` — Run останавливается (`no-ready-wave`), а этот stub ещё жив: Stop не ждал
    gh дольше `endReadMs`. `narrow-round` нет, хотя в `prs.json` у PR 02 есть `NARROW: REJECTED`; в логе gh — только
    `pr list`; после test-а живых stub-ов нет; `checkRecovery` пуст;
  - **5xx:** файл `fail` «HTTP 502: Bad Gateway (https://api.github.com/graphql)» до старта. Первое чтение падает,
    `PrTracker` отвечает `{ available: false, intervalMs: 2000 }`. `fail` удалён, часы +1 с — опрос Run-а есть, вызова
    gh нет; ещё +1 с — второй `pr list`, `narrow-round` 02 `rejected`. Чтения Wave 2 и последнее его не повторяют:
    строка одна; `checkRecovery` пуст;
  - **конфликт merge:** `autopilot-fault-conflict.jsonl` — Orchestrator отвечает «01 merged. 02: merge conflict in
    src/f2.ts …» после `wait_release`; пока ход ждёт, test пишет 01 `done`, 02 `blocked` со строкой `Blocked reason:
    merge conflict in src/f2.ts` (как `ticket block`). Run — `blocked-tickets`, `tickets: ['02']`, `lastText` с текстом
    конфликта, `ticket-status` 02 `blocked` один раз. Новый Run — `run-started`, `run-stopped` `blocked-tickets` без
    Wave и без сообщений Orchestrator-у: 02 заблокирован, 03 ждёт его. gh только читал; `checkRecovery` пуст.
- **Расхождение с текстом Ticket-а.** «Следующий Run не берёт 02 в первую Wave»: в Epic-е fixture-а 03 ждёт 02, поэтому
  новый Run не начинает ни одной Wave — это сильнее «Wave без 02», test так и проверяет.
- **Красные прогоны.** До режима `hang` (stub из `origin/main`): красные test stub-а (exit 0 вместо 1) и «gh висит»
  (timeout ожидания зависшего вызова). Испорченные копии test-а, по одной на сценарий: без файла `hang` — «gh висит»
  красный; `intervalMs: BASE_MS` вместо удвоенного — 5xx красный; две строки `narrow-round` в ожидании — 5xx красный;
  02 `claimed` вместо `blocked` — конфликт красный. 4 из 4 красные, остальные test-ы копий зелёные.
- `src/` не изменён. `pnpm lint && pnpm typecheck && pnpm test` — exit 0 (645 файлов, 14 596 test-ов). Gate fast:
  первый прогон красный на `test/contract/harness-codex-hooks.test.ts:139` (код Harness-а, этот PR его не трогает;
  отдельно и в полном `pnpm test` зелёный), повтор — `[gate] green (fast)`.
