# 35 — Окно «Link a machine» зависает, если в конце паузы main отвечает той же паузой

Type: task
Status: claimed 2026-10-21T23:34Z
Branch: worfy-link/35
Blocked by: —
Source: ревью PR [#718](https://github.com/IDSAD-XL/worfy/pull/718) (Ticket 34), круг 1, 2026-10-22, находка вне
диффа, low. Так было и до PR #718. Строки — по main `22f03a99`.

## Что происходит

`src/renderer/machines/LinkMachineDialog.tsx:163`: в конце паузы pairing (предел неудачных pairing за час,
Ticket 28) таймер окна вызывает `link.open`. Если main отвечает той же паузой — то же `pausedUntil`, новая
ревизия состояния, — зависимости effect-а `[pausedUntil, shownCode]` не меняются, таймер заново не ставится, и
окно навсегда показывает сообщение о паузе. Выйти можно только закрыв окно.

## Готово, когда

- [ ] Ответ `link.open` с тем же `pausedUntil` снова ставит таймер (или окно опрашивает main, пока пауза
      не кончится), и окно показывает код, когда пауза снята.
- [ ] Unit test в `test/unit/link-machine-dialog-pause.test.tsx`: таймер срабатывает, main отвечает тем же
      `pausedUntil`, затем снимает паузу — на экране код. Красный на коде main `22f03a99`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.
