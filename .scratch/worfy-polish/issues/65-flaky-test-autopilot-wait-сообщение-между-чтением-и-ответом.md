# 65 — Flaky test autopilot-wait: сообщение между чтением и ответом

Type: bug
Status: claimed
Blocked by: —
Source: CI PR #1592 linux-tests (2/4) и main run 42266856501 (FLAKY).

## Что происходит

- `test/contract/autopilot-wait.test.ts:497` «a message that lands between the start's read of the Orchestrator and its
  answer» падает на Linux CI (PR #1592, run 42409651387, job linux-tests (2/4), обе попытки): `h.requests.at(-1)` —
  `unattended: false`, а test ждёт `true` и TMPDIR run-а. На Mac проходит.
- На main (run 42266856501, commit `44108b8f2`) в том же файле упал test «after the last task the run waits the grace
  time…» (`expected [ false, true, false ] to deeply equal [ false, true ]`, обе попытки), а «a message that lands…» и
  «a run that waited starts its Session…» помечены FLAKY — прошли только на retry.
- Общий признак: после unattended-запроса Session появляется ещё один, attended.

## Что делаем

1. Найти root cause: race на стороне test-а или ошибка порядка в продукте. Записать в «Итог» с file:line.
2. Сделать исход детерминированным: ждать настоящего условия или события, без sleep, без подстройки timeout-ов, без
   retry. Если race в продукте — чинить продукт, test остаётся строгим.
3. Доказать: файл с `--sequence.shuffle`, повторно и под нагрузкой (несколько копий параллельно); до правки —
   воспроизвести падение (задержка в подозрительном месте).

## Готово, когда

- [ ] Root cause назван в «Итог» с file:line; падение воспроизведено до правки.
- [ ] Test-ы файла не зависят от того, как быстро run доходит до своего конца после Wave 1.
- [ ] Если найден race в продукте — он исправлен, есть test, красный до правки.
- [ ] `test/contract/autopilot-wait.test.ts` с `--sequence.shuffle --retry=0`: 30+ запусков под нагрузкой, все exit 0.
- [ ] Все unit и contract test-ы `src/main/autopilot/`, `src/main/agent/orchestrator.ts`, `src/main/ipc/autopilot.ts`,
      `pnpm lint`, `pnpm typecheck`, gate fast — exit 0.
- [ ] ci-ok зелёный на head PR.

## Где в коде

- `test/contract/autopilot-wait.test.ts` — `waveOne`, `holdWaveTurn`, harness, test-ы, которые читают `h.requests`.
- `test/contract/autopilot-faults-api.test.ts` — ожидание паузы после последней задачи.
- `src/main/autopilot/run.ts` — `recheck` (ожидание свободного Orchestrator-а), интерфейс `orchestrators`.
- `src/main/agent/orchestrator.ts` — `apply` (события Session), `busy`.
- `src/main/ipc/autopilot.ts` — зависимости Autopilot в приложении.
- `docs/features/autopilot.md` — когда run считает Orchestrator свободным.

## Итог

Причин две, и обе давали лишний или пропущенный шаг в одном и том же месте — после последней задачи и после Wave 1.

**1. Race на стороне test-а (то, что падало на CI).** Скрипт `autopilot-waves.jsonl` отвечает на Wave сразу. Run
перечитывает Tickets, видит те же и останавливается с `no-progress` (`src/shared/autopilot/cycle.ts:274`). Остановка
отдаёт Orchestrator человеку: `release` → `setUnattended(…, false)` (`src/main/autopilot/run.ts:3168` на main `f0fa80fa6`) →
`relaunch(entry, ATTENDED)` (`src/main/agent/orchestrator.ts:355`), и это новый запрос с `unattended: false`. Это
поведение продукта по спецификации (worfy-autopilot-queue 08). А пять test-ов читали `h.requests` после `waveOne`,
опрашивая каждые 10 ms. На медленном Linux CI run успевал дойти до `run-stopped no-progress` раньше, чем test читал
запросы. Воспроизведено задержкой 300 ms в конце `waveOne`: 5 test-ов красные, ровно с текстами CI
(`[false, true, false]` и `unattended: false`); журнал тогда — `…wave-started, wave-finished, run-stopped no-progress`.
Правка: эти пять test-ов держат ход Wave (`holdWaveTurn`, скрипт `autopilot-waves-held`), пока test не закончит
проверки. Run остаётся в Wave 1, проверки строгие (`[false, true]`, `at(-1)` — unattended с TMPDIR run-а). С той же
задержкой в 300 ms после правки — 14 из 14 зелёные.

**2. Race в продукте (нашёлся под нагрузкой, когда первая причина была уже закрыта).** Run, который ждёт
Orchestrator, перечитывает его в `recheck` по событиям Session, но позже, через свою очередь, и читает только текущее
состояние. Если последняя задача кончилась, а ход её task-notification начался и закончился до этого чтения, run
видел «задач нет, хода нет» и включал паузу `TASKS_GRACE_MS` (2 минуты) в ожидании хода, который уже прошёл
(`src/main/autopilot/run.ts:1302-1314` на main `f0fa80fa6`). В приложении это лишние 2 минуты до Wave. В test-е на ручных часах —
зависание: `waits until the queue is empty…` падал по `timed out waiting for Wave 1` (4 раза из 30 при шести копиях
параллельно, 1 раз из 18 на исходном файле). Воспроизведено задержкой 30 ms в начале `recheck`: test красный каждый раз.
Правка: Orchestrators по событиям в их порядке помнит, был ли ход в текущей Session после того, как задач стало ноль
(`turnSinceTasks`, `src/main/agent/orchestrator.ts:198`, `:775`, `:796`), и отдаёт это через `turnSinceLastTask`
(`:474`). `recheck` не включает паузу, если такой ход уже был (`src/main/autopilot/run.ts:1313`). Это то же решение,
которое run принимал, когда читал вовремя (ход виден → `orchestrator-busy`, конец хода → `orchestrator-free` без паузы).
ADR-0099, п. 3 требует паузу только пока ход task-notification ещё не начался. Новый test «a run that reads the
Orchestrator only after the last task's task-notification turn has ended…» задерживает события для run-а
(`holdRunEvents`/`deliverRunEvents` в harness) и до правки красный (`expected [ 120000 ] to not include 120000`).
`autopilot-faults-api.test.ts` ждал эту паузу и двигал часы. Это и был поздний `recheck`: test теперь ждёт Wave нового
run-а без часов. Feature page `docs/features/autopilot.md` говорит новое правило.

Доказательство: `test/contract/autopilot-wait.test.ts --retry=0 --sequence.shuffle` — 30 запусков тремя копиями
параллельно, 30 запусков шестью копиями, 32 запуска восемью копиями: 92 из 92 exit 0. Все 54 файла unit и contract
test-ов затронутых модулей — exit 0.
