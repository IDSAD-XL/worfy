# 106 — e2e linked-machines на Windows: клик по Terminal перехватывает `react-flow__pane selection`

Type: task
Status: open
Blocked by: —
Source: прогоны на ПК 2026-10-22 (Ticket-ы 99 и 105), направление Session на Mac 2026-10-22: новый красный
в счёте e2e Windows ([Ticket 14](14-gate-full-на-windows.md)). Строки — по main `1e1027f2`.

## Что происходит

`test/e2e/linked-machines.spec.ts:757` («A opens a Project of B: its Canvas, Node moves, Session, Terminal and
Autopilot go to B; B gone — "unreachable", B back — the Canvas again») на Windows-ПК красный:

```
TimeoutError: locator.click: Timeout 30000ms exceeded.
  - <div class="react-flow__pane selection">…</div> intercepts pointer events
```

Падает клик по экрану Terminal в окне A (`termA.getByTestId('terminal-screen').click()`, `:818`): pane React Flow
стоит в режиме выделения (класс `selection`) и перехватывает каждый повтор клика. На снимке после падения узел
Terminal почти целиком за правым краем окна — Canvas сдвинулся уже во время попыток.

Замеры на ПК:
- до 14:00 test зелёный 4 раза подряд (ветка `worfy-windows/99`, прогоны после правки);
- с 14:07 красный: на ветке `worfy-windows/99` 2 из 2, на main `14f008a4` 2 из 2, на ветке
  `worfy-windows/105-helpers` (поверх main `1e1027f2`) 2 из 2;
- окно не урезано: содержимое 1400×900 (`SIZE`, `:581`) на основном дисплее, `scaleFactor` 1.5;
- настоящий курсор во время прогона стоял внутри окон теста: `screen.getCursorScreenPoint()` = (1798, 424),
  то есть (1151, 77) в окне — полоса инструментов над Canvas.

Вероятная причина, не подтверждена: перед кликом test перетаскивает Node синтетической мышью Playwright
(`drag`, `:674`; вызов на `:801`). Windows отдаёт окну под курсором и события физической мыши; вместе они
оставляют pane в режиме выделения. Это объясняет, почему test стал красным после 14:00, когда владелец вернулся
к ПК. На Mac test зелёный.

## Что делаем

1. Проверить гипотезу: прогнать test, когда физический курсор вне окон теста. Курсор двигает владелец или
   test, но не агент руками. Если красный и так — искать причину в самом test-е.
2. Если причина в курсоре — сделать test независимым от него: например, перед прогоном уводить курсор
   из окна средствами test-а (на Windows) или открывать окна теста там, где курсора нет. Решение — в «Итог».

## Готово, когда

- [ ] Причина подтверждена замером; запись в «Итог».
- [ ] На ПК `pnpm build && pnpm exec playwright test test/e2e/linked-machines.spec.ts --grep-invert @packaged` —
      код 0 в 3 прогонах подряд, в том числе когда владелец работает за ПК.
- [ ] На Mac тот же spec — код 0.

## Где в коде

- `test/e2e/linked-machines.spec.ts:757`, `:818` — test и падающий клик.
- `test/e2e/linked-machines.spec.ts:674` — `drag` синтетической мышью.
- `test/e2e/linked-machines.spec.ts:581` — размер окна.
