# 30 — Список машин из Tailscale в «Link a machine»

Type: task
Status: open
Blocked by: 29
Source: решение владельца 2026-10-18, Q22, вторая часть ([ADR-0070](../../../docs/adr/0070-worfy-link-outside-the-lan-through-an-overlay-network.md), пункт 5): «позже, отдельным Ticket-ом». Код начинается после текущей очереди Epic-а `worfy-windows` (Q21)

## Что происходит

- После Ticket-а 29 машину в tailnet находят руками: имя MagicDNS или IP-адрес и порт из окна другой
  машины.
- Tailscale CLI отдаёт список машин tailnet: `tailscale status --json` (поля `Self` и `Peer`: имя
  MagicDNS, адреса Tailscale, в сети ли машина). CLI есть не у каждого: на macOS приложение Tailscale
  кладёт его не в `PATH`, на Windows — в папку установки.

## Что делаем

1. «Link a machine» при включённой настройке «Связь через Tailscale» показывает машины tailnet рядом с
   найденными через Bonjour, если Tailscale CLI найден. Порт по-прежнему вводится руками: Tailscale его
   не знает.
2. CLI не найден — список не показывается, ввод руками работает. Ошибка CLI не мешает окну.
3. Развилка — к владельцу при claim: где искать CLI на macOS и Windows и показывать ли машины не в сети.

## Готово, когда

- [ ] Unit test разбора вывода `tailscale status --json` (запись из фикстуры): имена, адреса, в сети.
- [ ] Contract test: CLI нет — окно открывается, списка нет, ошибки нет.
- [ ] Ответ владельца по пункту 3 записан в «Итог».

## Где в коде

- `src/main/link/` — новый модуль чтения списка Tailscale (имя выбирает исполнитель).
- `src/shared/ipc/link.ts`, `src/renderer/machines/LinkMachineDialog.tsx`.
