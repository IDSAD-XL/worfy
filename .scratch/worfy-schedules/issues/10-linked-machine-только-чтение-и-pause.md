# 10: Linked machine — Schedules только для чтения и Pause при Full access

Type: task
Status: open
Blocked by: 07
Source: [spec.md](../spec.md), «Ticket-ы», 10; «Решения по реализации» («Linked machine»); решения владельца Q4, Q17
grilling-а и Q3 spec-а; «Волны», Wave 4

Кто: агент. Глубина ревью — `medium`.

## Что происходит

- Уровни доступа Linked machine — Off, Read only, Full access (ADR-0066); канал `write` при Read only отвечает отказом в
  `LinkIpcAdapter.call` (`src/main/link/ipc-adapter.ts`).
- Q17: Linked machine видит Schedules только для чтения и ставит на паузу. Q3 spec-а: Pause — только при Full access;
  ADR-0066 не меняется.

## Что строить

- Окно Linked machine показывает вид Schedules той Machine: без New schedule, Edit, Run now, Resume, Delete и Remove
  worktree. Pause — только при Full access; при Read only кнопки нет.
- Пауза с Linked machine пишет причину «Paused from <Machine>»; Resume — только на своей Machine.
- Каналы — из Ticket-а 03 (`schedules.list`, `schedules.history` — `read`; `schedules.pause` — `write`).

## Где в коде

- `src/renderer/schedules/ScheduleCard.tsx`, `src/renderer/schedules/SchedulesView.tsx`
- `src/main/link/ipc-adapter.ts` (только чтение)
- `test/e2e/schedules-linked.spec.ts` (новый), строка в `scripts/e2e-specs.table.json`

## Test-ы

- E2E: Linked machine видит список без кнопок правки; Pause при Full access ставит паузу с причиной; при Read only кнопки
  Pause нет, а вызов канала получает отказ ADR-0066.
- Сначала падающий test.

## Готово, когда

- [ ] Linked machine видит Schedules без правки; при Full access ставит паузу, при Read only только смотрит.
- [ ] `schedules-linked.spec.ts` зелёный.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
