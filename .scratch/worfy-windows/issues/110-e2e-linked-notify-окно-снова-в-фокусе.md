# 110 — e2e `linked-notify` на Windows снова красный: после сворачивания окно worfy остаётся в фокусе

Type: task
Status: done 2026-10-23T21:53Z
PR: #809
Branch: worfy-windows/110
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

## Итог

Причина — окружение ПК, не код worfy. Код окон с `b6f597ad` не менялся: в `src/main/window.ts`, `src/main/index.ts`,
`src/main/notify.ts`, `src/main/quiet-windows.ts` и версии Electron между `b6f597ad` и main `c6a103f8` правок нет;
коммиты из следа (684d1c75 `parkPointer`, 368f195e `processesWith`, 52af1879 общие helper-ы) окна не трогают.
Bisect не понадобился: тот же замер на `b6f597ad` даёт ту же картину.

Замер на ПК 2026-10-23 (временный spec-зонд, не в коммите: два worfy без quiet windows, `canvasReady`, затем
`minimize()` всех окон A, потом B; для каждого окна `isMinimized()`, `isFocused()`, `getFocusedWindow()` и окно
переднего плана Windows — `GetForegroundWindow` через PowerShell, с pid и процессом):

- Spec один, на main `c6a103f8`: зелёный 1 из 1 и 3 из 3. Зонд один: перед сворачиванием B — настоящее окно
  переднего плана и в фокусе; после `minimize()` обоих передний план уходит другому приложению, у обоих
  `getFocusedWindow()` — `null` и 4 s спустя. Это картина Ticket-а 100.
- Spec после `linked-machines.spec.ts:756` (так он идёт в полном прогоне, где красный в каждом прогоне дня):
  красный в `unfocusAll`, `Received: true`. Зонд после `:756`, main: ещё до сворачивания передний план — у
  другого приложения (окно worfy владельца), а у A и у B `isFocused()` — `true`; после `minimize()`
  `isMinimized()` — `true`, `isFocused()` — `true`, `getFocusedWindow()` не `null` все 4 s, передний план не
  меняется.
- Зонд после `linked-machines.spec.ts:735` (тот же test в старой нумерации) на `b6f597ad` в отдельном
  worktree: то же самое — до сворачивания передний план у другого приложения (OpenCode), A и B «в фокусе»,
  после `minimize()` «в фокусе» все 4 s.
- В обоих деревьях: `blur()` этого не снимает; `focus()` при чужом переднем плане снова делает оба окна «в
  фокусе», не выводя их вперёд, и `minimize()` после этого фокус не снимает; `hide()` снимает (у обоих
  `getFocusedWindow()` — `null`).

Что это значит. На Windows фокус окна у Electron — активное окно своего потока, а не системный передний план.
Окно, которое Windows не пустила вперёд при запуске (блокировка переднего плана: другое приложение недавно
получало ввод или стоит впереди), всё равно считается активным в своём потоке, и `minimize()` его не
деактивирует. Пустит ли Windows новые окна вперёд, зависит от того, что на экране и что делает человек за
ПК, — 2026-10-22 пускала, в прогонах 2026-10-23 после `:756` — нет. Какое именно правило блокировки сработало,
не установлено.

Исправление: helper `unfocusAll` в `test/e2e/linked-notify.spec.ts` на Windows прячет окна (`hide()`) вместо
`minimize()`; на macOS по-прежнему `blur()`. Проверка не ослаблена: helper так же ждёт, пока ни у одного из двух
worfy `getFocusedWindow()` не `null`. Клик по уведомлению показывает окно B снова (`openNote` в
`src/main/notify.ts`: `show()` и `focus()`).

После: `pnpm build && pnpm exec playwright test test/e2e/linked-notify.spec.ts --grep-invert @packaged
--repeat-each 3` — 3 из 3, код 0; spec после `linked-machines.spec.ts:756` — зелёный 2 из 2. Мутант (старый
`minimize()`) после `:756` — красный в `unfocusAll` (`Received: true`). Сам `:756` красный по Ticket-у 106 (в
одном из прогонов зелёный), на исход `linked-notify` это не влияет.

Замечание о продукте, не исправлено: `focused: () => BrowserWindow.getFocusedWindow() !== null` в
`src/main/notify.ts` на Windows так же считает «в фокусе» окно, которое ни разу не было впереди, и такое окно
держит уведомления, хотя человек работает в другом приложении. В обычной работе окно worfy выходит вперёд при
запуске, поэтому случай редкий.
