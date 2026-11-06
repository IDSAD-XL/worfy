# 08 — Сервис Work track и канал `work-track.read`

Type: task
Status: done 2026-11-06T20:14Z
PR: #1521
Blocked by: 01, 02, 05, 06, 07
Source: [spec.md](../spec.md), «Как работает» → «Источники», «Чтение»; «Решения владельца», 2, 3, 6; «ADR»; [04](../../worfy-autopilot-queue/issues/04-данные-work-track.md), «Итог»

## Что происходит

- Сервис Flight Recorder (`src/main/flight-recorder/service.ts:1-38`) собирает факты одного Run-а и ничего не пишет;
  домен IPC `runs` (`src/shared/ipc/runs.ts`).
- Зеркало сроков gate в worfy — `LOG_RUNS_KEPT`, `STALE_MS` (`src/main/flight-recorder/gate-logs.ts:27-30`); после
  Ticket-а 01 `timings.json` живёт 31 день.
- Маркер Wave (Ticket 02) — строки `wave-started`/`wave-finished` в `~/.claude/worfy-harness/runs/<project>/<epic>-wave-<UTC>/decisions.tsv`.

## Что делаем

1. `src/main/work-track/harness-state.ts` — run-ы gate Project-а за период (`timings.json` всех worktree Project-а, по
   `canonicalWorktree`) → факты `gate`; маркеры Wave-ов → факты `wave` вне Run-а (Wave Run-а — из журнала, дубль по
   времени и Ticket-ам — одна); пробел gate — начало периода раньше 31 дня или самого старого `timings.json`.
2. `src/main/work-track/service.ts` — `read(projectId, period)`: журналы Run-ов (`listRuns` и разбор журнала), reader-ы
   05–07, harness-state; модель 04; ответ — дорожки, Span-ы, сводка, пробелы, Session-ы. Ничего не пишет.
3. Канал `work-track.read` (`src/shared/ipc/work-track.ts`, `src/main/ipc/work-track.ts`, `project`, `read`), с
   признаком загрузки по источникам (`loading: ['transcripts']`), чтобы вид показывал ход.
4. `gate-logs.ts` — константы под новый срок Harness-а и комментарий.

## Готово, когда

- [ ] Contract test на fixture-ах: Run, ручная Wave по маркеру, ходы трёх Session, PR, CI, gate, смены статуса — все
      факты в ответе; Wave Run-а и её маркер — один Span.
  - evidence: test-run pass · `pnpm test test/contract/work-track-service.test.ts` exit 0 · mac - · 63e961516e8fa12a512bf43b96eea7e10114f9f2
  - evidence: review pass · PR #1521 · - - · e1622b5e664b9a499413ce66c9077523d5d35ff5
- [ ] Contract test: ни один файл в fixture Claude home, папке Harness-а и репозитории не изменён (ADR-0005).
  - evidence: test-run pass · `pnpm test test/contract/work-track-service.test.ts` exit 0 · mac - · 63e961516e8fa12a512bf43b96eea7e10114f9f2
  - evidence: review pass · PR #1521 · - - · e1622b5e664b9a499413ce66c9077523d5d35ff5
- [ ] Contract test: gate старше срока — пробел; GitHub недоступен — пробел и остальное.
  - evidence: test-run pass · `pnpm test test/contract/work-track-service.test.ts` exit 0 · mac - · 63e961516e8fa12a512bf43b96eea7e10114f9f2
  - evidence: review pass · PR #1521 · - - · e1622b5e664b9a499413ce66c9077523d5d35ff5
- [ ] `test/contract/flight-recorder-gate-logs.test.ts` зелёный с новыми константами.
  - evidence: test-run pass · `pnpm test test/contract/flight-recorder-gate-logs.test.ts` exit 0 · mac - · 63e961516e8fa12a512bf43b96eea7e10114f9f2
  - evidence: review pass · PR #1521 · - - · e1622b5e664b9a499413ce66c9077523d5d35ff5
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.
  - evidence: gate pass · `gate fast` exit 0 · mac - · 63e961516e8fa12a512bf43b96eea7e10114f9f2
  - evidence: gate pass · `gate fast` exit 0 · mac - · c23447116a1396ca61d3b70056991327c856831f
  - evidence: review pass · PR #1521 · - - · e1622b5e664b9a499413ce66c9077523d5d35ff5
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/42282442156 · ci - · e1622b5e664b9a499413ce66c9077523d5d35ff5

## Тесты

- Contract `test/contract/work-track-service.test.ts` (новый), `test/contract/flight-recorder-gate-logs.test.ts`.
- Сначала падающий: канала нет.

## Где в коде

- `src/main/work-track/service.ts`, `src/main/work-track/harness-state.ts` (новые)
- `src/shared/ipc/work-track.ts`, `src/main/ipc/work-track.ts` (новые)
- `src/main/flight-recorder/gate-logs.ts`
- `test/contract/work-track-service.test.ts` (новый), `test/contract/flight-recorder-gate-logs.test.ts`

Только читать: `src/main/flight-recorder/service.ts`, `src/main/autopilot/journal.ts`, `src/shared/flight-recorder/from-journal.ts`,
`src/main/flight-recorder/worktree-path.ts`.

## Итог

- Сервис — `src/main/work-track/service.ts`, `WorkTrackService.read(projectId, period, { wait })`: журналы Run-ов
  (`listRuns` и `journalFacts`) → факты `run` и `wave`; маркеры Wave и run-ы gate — `src/main/work-track/harness-state.ts`;
  reader-ы 05–07 без копий разбора. Ответ — вход модели 04 (`period`, `now`, факты, Session-ы, пробелы), сводка
  `summarize` и `loading`. Ничего не пишет.
- Канал — `workTrack.read` (`project`, `read`; `src/shared/ipc/work-track.ts`, `src/main/ipc/work-track.ts`). Медленные
  источники (транскрипты, GitHub) читаются в фоне: ответ без `wait` — то, что дали остальные, и `loading: ['transcripts', …]`;
  ответ с `wait` — когда пришли все.
- `gate-logs.ts`: `TIMINGS_KEPT_MS` (31 день, зеркало `gate-log.mjs`, test сверяет) вместо `LOG_RUNS_KEPT` и `STALE_MS`;
  правило «папка полна десяти run-ов — запись потеряна» снято: gate хранит `timings.json` старших run-ов 31 день.
- Сначала падающий test: `test/contract/work-track-service.test.ts` без новых модулей красный (vitest: «Cannot find module
  '../../src/main/work-track/harness-state'»); после реализации 6 test-ов зелёные, в часовых поясах UTC,
  Pacific/Kiritimati (+14) и Pacific/Pago_Pago (−11) тоже.

Решено без владельца:

1. **Имя канала `workTrack.read`**, а не `work-track.read`: домены каналов всех остальных — camelCase (`autoApproval`,
   `gateQueue`, `terminalAi`).
2. **Дорожек в ответе нет.** Они зависят от развёрнутых Session (▸) — это состояние экрана; экран считает их сам чистым
   `lanesBySession`/`lanesByEpic` над ответом. Ответ не раздувается втрое на месяце.
3. **Пробел gate** — от начала периода до более позднего из «сейчас − 31 день» и самого старого `timings.json` Project-а
   (до Ticket-а 01 gate хранил 8 дней — то, что он удалил, не вернуть). Подсказка — «Gate logs are kept 31 days…».
4. **Wave Run-а и её маркер — одна Wave**, когда совпадают Epic, время пересекается и есть общий Ticket; остаётся Wave
   журнала (с её Run-ом). Маркер без `wave-finished` идёт, пока ему меньше суток, иначе кончается на последней строке
   (`stopped`).
5. **Ход или Subagent Session-а, которой журнал отдал Wave**, начатый внутри этой Wave и без своего Epic-а, получает
   Wave родителем — и её Epic (эвристика «по маркеру Wave» spec-а).
6. **Смены статуса — только из git** (07): строки `ticket-status` журнала дали бы дубль той же смены.
7. **Night-view Flight Recorder**: `now` test-а `flight-recorder-night-view` сдвинут на 2026-11-20 — за 31 день от Run-а,
   чтобы экранные test-ы по-прежнему рисовали пометку «gate logs deleted»; в файле вида изменилось только `now`.
8. **e2e `flight-recorder.spec.ts` больше не проверяет пометку «gate logs deleted» ночного Run-а.** Приложение считает её
   по своим часам: при сроке 31 день пометка появляется только с 2026-11-18, до того её нет — проверка зависела бы от даты
   (на этом PR job `windows-e2e (2/4)` упал именно на ней). Пометку и штриховку рисует unit test
   `flight-recorder-view.test.tsx` по `night-run-view.json`, посчитанному после этой даты.
