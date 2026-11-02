# 22 — History и slash-команды Codex

Type: task
Status: open
Blocked by: 20
Source: [spec.md](../spec.md), «Модель» (History, таблица частей); решение 06 ([06-граница-vendor.md](06-граница-vendor.md), части history и commands); решение 07 ([07-что-получает-codex.md](07-что-получает-codex.md)); Ticket 05 ([05-codex-транскрипты.md](05-codex-транскрипты.md)); Ticket 02 ([02-codex-управление-сессией.md](02-codex-управление-сессией.md), строка «Список slash-команд»)

## Что делаем

1. `src/main/vendors/codex/history.ts`: `list(cwd)` — `thread/list` с фильтром `cwd` и `sourceKinds`, без
   архивных; у каждой Session — id, название, время, откуда начата (`source`, `originator`: `worfy` — своя).
   `read(id)` — `thread/read {includeTurns: true}` → `TranscriptEntry` (`src/shared/transcript/parse.ts:38`) через
   перевод item-ов Ticket-а 20. Rollout-файлы worfy не читает.
2. `src/main/vendors/codex/commands.ts`: строки slash-меню — `skills/list` (обновление по `skills/changed`) и
   встроенные, у которых есть метод app-server: `/compact` — `thread/compact/start`, `/review` — `review/start`.
   Встроенные TUI без метода в список не входят.
3. Части history и commands driver-а Codex.

Глубина review — `high` (driver Codex).

## Готово, когда

- [ ] Contract test на фейке (`threads`): `list` по `cwd` Project-а находит thread-ы, начатые в worfy и в терминале,
      и отличает их; `read` даёт записи с сообщениями, мыслями, командами и их выводом.
- [ ] Contract test: slash-меню — skills сценария и `/compact`, `/review`; вызов skill уходит item-ом `skill` в
      `turn/start`.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` — exit 0.

## Где в коде

- `src/main/vendors/codex/history.ts`, `commands.ts` (новые)
- `src/main/vendors/codex/index.ts` — части history и commands
- `test/unit/codex-history.test.ts`, `test/contract/codex-history.test.ts` (новые)

Только читать: `src/shared/transcript/parse.ts:26-50`, `src/main/agent/commands.ts:1-12`,
`src/main/vendors/codex/items.ts` (Ticket 20).
