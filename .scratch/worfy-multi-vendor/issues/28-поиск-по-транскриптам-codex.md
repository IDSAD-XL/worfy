# 28 — Поиск по транскриптам Codex

Type: task
Status: open
Blocked by: 22
Source: [spec.md](../spec.md), «Цель и что видит пользователь», п. 10; решение 07 ([07-что-получает-codex.md](07-что-получает-codex.md))

## Что происходит

- Поиск — `TranscriptSearch` (`src/main/claude-home/search.ts:141`) по файлам Claude с пределами `SEARCH_LIMITS`
  (`:35`); канал `claudeHome.search` (`src/shared/ipc/claude-home.ts:220-243`).

## Что делаем

1. Поиск идёт и по Session-ам Codex Project-а: текст сообщений из `history.read` (Ticket 22), те же пределы и то же
   правило snippet-а (`snippetAround`, `:112`).
2. Результат несёт `vendor`; renderer показывает значок Vendor-а (`VendorBadge`, Ticket 24).
3. Прочитанные thread-ы кэшируются в памяти до изменения времени thread-а, чтобы повторный поиск не читал всё заново.

## Готово, когда

- [ ] Contract test (фейк, `threads`): текст из сообщения Codex находится; snippet и пределы — как у Claude.
- [ ] Test-ы поиска Claude проходят без правок ожиданий.
- [ ] `pnpm typecheck`, `pnpm lint`, test-ы поиска — exit 0.

## Где в коде

- `src/main/claude-home/search.ts` — `:35`, `:68`, `:112`, `:141`
- `src/main/ipc/claude-home.ts`
- `test/contract/claude-home-search.test.ts`
