# 100 — e2e `linked-notify`: на Windows `BrowserWindow.blur()` не снимает фокус с окна

Type: task
Status: done 2026-10-22T14:54Z
PR: #760
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

Причина в test-е, не в продукте. Замер на ПК 2026-10-22 (main `b6f597ad`, временный spec-зонд, не в коммите;
окно переднего плана — `GetForegroundWindow` через PowerShell):

- Одно окно worfy: `blur()` снимает фокус, передний план уходит другому приложению (Telegram),
  `getFocusedWindow()` — `null`.
- Два worfy (как в spec-е): после `blur()` у B передний план переходит к окну A — следующему видимому окну
  в z-order; у A `getFocusedWindow()` снова не `null`, и это настоящее окно переднего плана Windows.
  `blur()` поочерёдно передаёт фокус между двумя окнами, «ни одно не в фокусе» не наступает.
- `minimize()` обоих: передний план уходит другому приложению, у обоих `getFocusedWindow()` — `null` и
  4 s спустя.

Продукт (`src/main/notify.ts`, `focused: () => BrowserWindow.getFocusedWindow() !== null`) решает верно: окно A
действительно в фокусе. На этом main spec падал уже не в helper-е `blur`, а на `:124` (A ничего не
записал: `Received array: []`), 3 из 3.

Исправление: helper `unfocusAll([a, b])` в `test/e2e/linked-notify.spec.ts` — на Windows `minimize()`, на
macOS прежний `blur()`; ждёт, пока ни у одного из двух worfy нет окна в фокусе (раньше проверял каждый worfy
отдельно и не видел, что фокус вернулся к первому). Клик по уведомлению разворачивает окно B
(`window.restore()` в `src/main/notify.ts`). После: spec 3 из 3 код 0; мутант (`blur()` и на Windows) —
красный в `unfocusAll` (`Expected: false, Received: true`).
