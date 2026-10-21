# 34 — Долг после review PR #695: окно «Link a machine» после паузы pairing

Type: task
Status: claimed 2026-10-21T22:43Z
Branch: worfy-link/34
Blocked by: —
Source: ревью PR [#695](https://github.com/IDSAD-XL/worfy/pull/695) (Ticket 28, предел неудачных pairing за час), круг 2,
2026-10-21. Обе находки — low. Можно сделать вместе с Ticket-ом 27. Строки — по main `81ea31cd`.

## Готово, когда

- [x] `src/renderer/machines/LinkMachineDialog.tsx:155-158`: после сна Mac таймер отстаёт; новое состояние без
      `pausedUntil` отменяет его, и окно навсегда пишет «Opening…». Открывать linking заново и тогда, когда
      `pausedUntil` пропал, а кода нет.
- [x] Нет test-а на закрытие окна во время паузы (мутант «убран `clearTimeout`», `:158`, выживает).
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Итог

- Окно помнит, что видело паузу (`wasPaused`). Если следующее состояние main пришло без `pausedUntil` и без
  кода — например, после сна Mac main уже снял паузу, а таймер окна ещё не сработал, — окно само вызывает
  `link.open` один раз. Если код уже есть, повторного открытия нет; после этого память о паузе сброшена, и
  закрытие linking позже (неудачи подряд) не открывает его снова.
- Test-ы — `test/unit/link-machine-dialog-pause.test.tsx`: сон Mac (красный на коде main), закрытие окна во время
  паузы (красный на мутанте без `clearTimeout`), состояние без кода без паузы не открывает linking.
  Мутанты «нет проверки `wasPaused`», «нет проверки кода», «нет установки» и «нет сброса `wasPaused`» — красные.
- Два `link.open` подряд (таймер и новое состояние почти одновременно) безвредны: main добавляет окно в
  openers один раз (`src/main/ipc/link.ts`, `openers.add`).
