# 110 — e2e `linked-notify` на Windows снова красный: после сворачивания окно worfy остаётся в фокусе

Type: task
Status: open
Blocked by: —
Source: пересчёт e2e на ПК владельца 2026-10-23 (main `f8ada2a3`, масштаб 150 %;
`C:/Users/Alexey/worfy-wt/recount/e2e.json` на ПК), решение владельца 2026-10-23 по отсечке Epic-а.
Регрессия [Ticket-а 100](100-linked-notify-blur-на-windows-не-снимает-фокус.md) (PR #760). Строки — по main
`cf5adbf2`.

## Что происходит

`test/e2e/linked-notify.spec.ts:103` («a turn of a Session of A ends with no window focused: A and B record the
notification; a click on B opens the Session in B on A's Project») красный в каждом прогоне на ПК. Падает
helper `unfocusAll` (`:88-100`), ещё до самого test-а:

```
expect(received).toBe(expected)
Expected: false   Received: true
Timeout 5000ms exceeded while waiting on the predicate
```

`unfocusAll` на Windows сворачивает (`minimize()`) все окна обоих worfy и ждёт, пока
`BrowserWindow.getFocusedWindow()` не станет `null` у обоих. По замеру Ticket-а 100 (2026-10-22, main
`b6f597ad`) после `minimize()` обоих передний план уходил другому приложению, и у обоих `getFocusedWindow()`
был `null` и 4 s спустя. Сейчас хотя бы у одного worfy окно в фокусе все 5 s.

Что изменилось с 2026-10-22, не установлено: код worfy (фокус при сворачивании, `src/main/notify.ts`,
восстановление окна), код test-а или окружение ПК (какое приложение получает передний план).

## Что делаем

1. Замер на ПК, как в Ticket-е 100: временный spec-зонд (не в коммите), после `minimize()` для каждого окна —
   `isMinimized()`, `isFocused()`, `getFocusedWindow()` и окно переднего плана Windows (`GetForegroundWindow`
   через PowerShell). Тот же замер на main `b6f597ad` (зелёный в Ticket-е 100) и на свежем main, чтобы
   отделить код от окружения.
2. Если причина в коде worfy — найти коммит (bisect между `b6f597ad` и main) и править продукт. Если в
   окружении — сделать helper независимым от него, не ослабляя проверку «ни одно окно не в фокусе».

## Готово, когда

- [ ] Причина подтверждена замером; в «Итог» — замер и, если это код, коммит, который её внёс.
- [ ] На ПК `pnpm build && pnpm exec playwright test test/e2e/linked-notify.spec.ts --grep-invert @packaged
      --repeat-each 3` — код 0.
- [ ] Мутант (старый код правки) — красный.
- [ ] На Mac тот же spec — код 0.

## Где в коде

- `test/e2e/linked-notify.spec.ts:88-100` — `unfocusAll`, `:103` — test.
- `src/main/notify.ts` — `focused: () => BrowserWindow.getFocusedWindow() !== null` и `window.restore()` по
  клику на уведомление.
