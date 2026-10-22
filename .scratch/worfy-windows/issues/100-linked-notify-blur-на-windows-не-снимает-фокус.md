# 100 — e2e `linked-notify`: на Windows `BrowserWindow.blur()` не снимает фокус с окна

Type: task
Status: open
Blocked by: —
Source: направление Session на Mac 2026-10-22, пересчёт красных e2e [Ticket-а 14](14-gate-full-на-windows.md);
замер на ПК 2026-10-22, main `d06d2c2d`, масштаб экрана 150 %.

## Что происходит

`test/e2e/linked-notify.spec.ts:90` («a turn of a Session of A ends with no window focused…») красный на
Windows-ПК. Он падает в helper-е `blur` (`:79-88`), до проверки уведомлений:

```
Error: expect(received).toBe(expected) // Object.is equality
Expected: true
Received: false
Call Log:
- Timeout 5000ms exceeded while waiting on the predicate
  > 87 |     .toBe(true)
```

`blur` вызывает `window.blur()` у каждого окна и ждёт, что `BrowserWindow.getFocusedWindow()` вернёт `null`. На
Windows этого не происходит за 5 s. Test запускает окна с `WORFY_QUIET_WINDOWS=0` (обычные окна, с фокусом).
Почему фокус остаётся — не разобрано: поведение `blur()` в Electron на Windows или фокус, который окно берёт
обратно.

## Воспроизведение (ПК, 2026-10-22)

```
pnpm build && pnpm exec playwright test test/e2e/linked-notify.spec.ts --grep-invert @packaged
```

Красный в полном прогоне `pnpm test:e2e` и при повторе файла одного (2 из 2 — стойко). Test забирает фокус
окна на ПК.

## Что делаем

1. Выяснить, что делает `BrowserWindow.blur()` на Windows в Electron 44 и куда уходит фокус.
2. Найти на Windows способ получить «ни одно окно worfy не в фокусе» (например, свернуть окна или отдать фокус
   другому окну test-а) и записать его в «Итог»; проверка уведомлений остаётся та же.

## Готово, когда

- [ ] На ПК `pnpm build && pnpm exec playwright test test/e2e/linked-notify.spec.ts --grep-invert @packaged` — код 0.
- [ ] На Mac тот же spec — код 0.

## Где в коде

- `test/e2e/linked-notify.spec.ts`

## Итог
