# 35 — Окно «Link a machine» зависает, если в конце паузы main отвечает той же паузой

Type: task
Status: done 2026-10-22T00:31Z
PR: #722
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

- [x] Ответ `link.open` с тем же `pausedUntil` снова ставит таймер (или окно опрашивает main, пока пауза
      не кончится), и окно показывает код, когда пауза снята.
- [x] Unit test в `test/unit/link-machine-dialog-pause.test.tsx`: таймер срабатывает, main отвечает тем же
      `pausedUntil`, затем снимает паузу — на экране код. Красный на коде main `22f03a99`.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Итог

PR #722, merge `371aa21d`. Строки — по main `b1e7ce39`.

- Ответ `link.open` в конце паузы, если это не ошибка, увеличивает счётчик `asks`
  (`src/renderer/machines/LinkMachineDialog.tsx:163`). Счётчик — зависимость effect-а таймера (`:180`), поэтому
  таймер ставится снова и тогда, когда main отвечает тем же `pausedUntil`.
- Неудачный вызов `link.open` не повторяется: счётчик не растёт, окно не опрашивает main в цикле.
- Таймер никогда не ждёт меньше 1 s (`PAUSE_RECHECK_MS`, `:86`).
- Test-ы — `test/unit/link-machine-dialog-pause.test.tsx`; 5 мутантов убиты. gate full — зелёный.
