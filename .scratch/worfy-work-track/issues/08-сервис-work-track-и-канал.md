# 08 — Сервис Work track и канал `work-track.read`

Type: task
Status: open
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
- [ ] Contract test: ни один файл в fixture Claude home, папке Harness-а и репозитории не изменён (ADR-0005).
- [ ] Contract test: gate старше срока — пробел; GitHub недоступен — пробел и остальное.
- [ ] `test/contract/flight-recorder-gate-logs.test.ts` зелёный с новыми константами.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.

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
