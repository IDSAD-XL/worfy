# 64 — Linked machine: закрытие Project-а в одном окне снимает watcher Claude home у всех её окон

Type: bug
Status: open
Blocked by: —
Source: ревью корректности Ticket-а 57 (ПК владельца, 2026-10-18): находка вне diff-а 57, дефект был и
до него. Не проверено.

Приоритет — low.

## Что происходит (гипотеза)

- Все окна одной Linked machine ходят через один `project` client соединения (`LinkPeer`,
  `src/main/link/ipc-adapter.ts:137`).
- Watcher Claude home ключуется по client-у (`src/main/ipc/claude-home.ts`, снятие — около `:108-111`).
- Окно A и окно B на одной Linked machine открыли Project; A закрывает его — watcher снимается для
  общего client-а, и окно B перестаёт получать `claudeHome.changed`.

## Что делаем

1. test: два окна одной Linked machine (один `LinkPeer`), оба открыли Project, одно закрыло —
   второе всё ещё получает `claudeHome.changed`. Красный — гипотеза верна.
2. Считать подписки окон внутри соединения (счётчик или id окна в запросе), снимать watcher, когда
   закрыло последнее. Проверить, нет ли того же у других подписок через `project` client
   (`workflow`, `pipeline`).

## Критерии готовности

- [ ] test красный до правки и зелёный после.
