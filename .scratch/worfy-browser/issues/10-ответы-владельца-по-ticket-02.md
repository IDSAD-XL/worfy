# 10 — Ответы владельца по Ticket-у 02: partition `persist:`, кнопки назад/вперёд/обновить, `target=_blank` в том же Browser

Type: task
Status: claimed 2026-10-20T12:48Z
Branch: worfy-browser/10
Blocked by: 02
Source: Ticket 02, «Открытые вопросы» 1, 2, 5 и «Итог» (PR #576 держится вариантов, которые ничего не
решают за владельца); план Wave 2 от 2026-10-20 — ответы «решено без владельца, подтвердить».
Код перечитан по main `ae547cc2`.

## Что происходит

- Partition один, временный, в памяти: `BROWSER_PARTITION = 'worfy-browser'` без `persist:`
  (`src/shared/browser/partition.ts:11`, список `BROWSER_PARTITIONS` `:14`). После перезапуска
  сохраняется только адрес, cookies и вход — нет.
- Кнопок назад, вперёд, обновить в шапке рамки нет (`src/renderer/canvas/nodes/BrowserNode.tsx`).
- Новые окна guest-страницы запрещены: `setWindowOpenHandler` — deny (`src/main/window.ts:252`), ссылка
  `target=_blank` ничего не открывает.

## Что делаем

Владелец подтвердил ответы 2026-10-20 (см. «Итог»):

1. Вопрос 1 — `persist:` partition «по умолчанию», один на Project; Ticket 03 превращает его в первый
   Browser profile.
2. Вопрос 2 — три кнопки слева от адресной строки: `goBack`, `goForward`, `reload` у `<webview>`;
   назад и вперёд неактивны, когда идти некуда.
3. Вопрос 5 — `target=_blank` и `window.open` guest-страницы открываются в том же Browser
   (`loadURL` вместо нового окна).

## Готово, когда

- [ ] Владелец подтвердил ответы 1, 2, 5 (или дал свои) — запись в «Итог».
- [ ] e2e `test/e2e/browser.spec.ts`: после перезапуска worfy cookie fixture-страницы на месте
      (вопрос 1); назад, вперёд, обновить работают и неактивны по краям истории (вопрос 2); ссылка
      `target=_blank` открывается в том же Browser, нового окна нет (вопрос 5).
- [ ] Unit `test/unit/window-options.test.ts`: у guest-страницы `setWindowOpenHandler` — deny и переход
      в той же странице.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Где в коде

- `src/shared/browser/partition.ts`
- `src/renderer/canvas/nodes/BrowserNode.tsx`
- `src/renderer/canvas/nodes/BrowserNode.css`
- `src/renderer/canvas/overlays/BrowserLayer.tsx`
- `src/main/window.ts` (`setWindowOpenHandler` guest-а `:252`)
- `test/e2e/browser.spec.ts`
- `test/unit/window-options.test.ts`

## Вне скоупа

- Browser profile — Ticket 03.

## Итог

**Ответы владельца — 2026-10-20**, в чате Session «Worfy продолжение»: «Согласен со всем», то есть
предложение из «Что делаем» принято как есть:

1. `persist:` partition, один на Project; Ticket 03 делает его первым Browser profile.
2. Кнопки назад, вперёд, обновить слева от адресной строки; неактивны, когда идти некуда.
3. `target=_blank` и `window.open` guest-страницы открываются в том же Browser, нового окна нет.

Остальное заполняется при закрытии.
