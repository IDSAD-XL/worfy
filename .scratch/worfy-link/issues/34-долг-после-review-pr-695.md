# 34 — Долг после review PR #695: окно «Link a machine» после паузы pairing

Type: task
Status: open
Blocked by: —
Source: ревью PR [#695](https://github.com/IDSAD-XL/worfy/pull/695) (Ticket 28, предел неудачных pairing за час), круг 2,
2026-10-21. Обе находки — low. Можно сделать вместе с Ticket-ом 27. Строки — по main `81ea31cd`.

## Готово, когда

- [ ] `src/renderer/machines/LinkMachineDialog.tsx:155-158`: после сна Mac таймер отстаёт; новое состояние без
      `pausedUntil` отменяет его, и окно навсегда пишет «Opening…». Открывать linking заново и тогда, когда
      `pausedUntil` пропал, а кода нет.
- [ ] Нет test-а на закрытие окна во время паузы (мутант «убран `clearTimeout`», `:158`, выживает).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Итог

Заполняется при закрытии.
