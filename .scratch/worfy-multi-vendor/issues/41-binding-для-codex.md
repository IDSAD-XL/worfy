# 41 — Binding для Session-ов Codex

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), «Цель и что видит пользователь» (второй выпуск); решение 07 ([07-что-получает-codex.md](07-что-получает-codex.md)); [CONTEXT.md](../../../CONTEXT.md), термин Binding

## Что происходит

- Сигналы Binding (Session → Ticket или Epic) читаются из транскриптов Claude и его Subagent-ов
  (`src/main/claude-home/binding-signals.ts:1-15`), разбор — `src/shared/binding/signals.ts`.

## Что делаем

1. `src/main/vendors/codex/binding.ts`: сигналы Binding Session Codex — из событий `history.read` (команды, правки
   файлов, ветка) тем же чистым разбором `src/shared/binding/signals.ts`; дочитывание — только новых ходов.
2. `binding-signals.ts` выбирает источник по Vendor-у Session.

## Готово, когда

- [ ] Contract test (фейк): Session Codex, которая правит файл Ticket-а и работает в его ветке, получает Binding.
- [ ] Test-ы Binding на Claude проходят без правок ожиданий.
- [ ] `pnpm typecheck`, `pnpm lint`, test-ы Binding — exit 0.

## Где в коде

- `src/main/vendors/codex/binding.ts` (новый)
- `src/main/claude-home/binding-signals.ts`
- `test/contract/codex-binding.test.ts` (новый)

Только читать: `src/shared/binding/signals.ts`, `src/shared/binding/resolve.ts`.
