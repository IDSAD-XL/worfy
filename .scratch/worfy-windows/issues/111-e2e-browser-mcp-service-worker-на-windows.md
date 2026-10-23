# 111 — e2e `browser-mcp`: test про service worker другого сайта красный на Windows

Type: task
Status: open
Blocked by: —
Source: пересчёт e2e на ПК владельца 2026-10-23 (main `f8ada2a3`, масштаб 150 %;
`C:/Users/Alexey/worfy-wt/recount/e2e.json` на ПК), решение владельца 2026-10-23 по отсечке Epic-а. На Mac
тот же test, по словам Session на Mac, иногда красный. Строки — по main `cf5adbf2`.

## Что происходит

`test/e2e/browser-mcp.spec.ts:382` («a service worker of another site does not let the Session's navigation past
the origins») на ПК красный в каждом прогоне 2026-10-23: два gate full, сравнения с main и пересчёт.

```
expect(locator).toBeVisible() failed
Locator: locator('[data-testid="browser-frame"][data-node-id="browser-…"]').getByTestId('browser-taken-over')
Expected: visible   Timeout: 5000ms
```

Падает первый шаг, до service worker-а: клик пользователя по странице (`window.mouse.click` в середину
`browser-frame-body` на 60 px ниже верха, `:388`) не переводит Browser Node в «пользователь взял управление»
(`browser-taken-over`, `:389`). Соседний test `:405` (««Claude is driving» goes at a click of the user on the
page…») делает тот же клик (`:417`) и на ПК зелёный. Чем отличается их начало, не разобрано.

## Что делаем

1. Найти, чем начало test-а `:382` отличается от `:405` до клика: загружена ли страница, где окно, что под
   точкой клика (снимок при падении, `elementFromPoint` в странице и в окне). Если клик уходит не в страницу —
   ждать того же, чего ждёт `:405`.
2. Если причина в продукте (клик по странице иногда не снимает управление с Claude) — править продукт.
3. Прогнать test и на Mac: если он и там иногда красный, правка должна закрыть обе системы.

## Готово, когда

- [ ] Причина подтверждена замером; запись в «Итог».
- [ ] На ПК `pnpm build && pnpm exec playwright test test/e2e/browser-mcp.spec.ts --grep-invert @packaged
      --repeat-each 3` — код 0.
- [ ] На Mac `test/e2e/browser-mcp.spec.ts:382` с `--repeat-each 5` — код 0.

## Где в коде

- `test/e2e/browser-mcp.spec.ts:382-392` — test, `:388` — клик, `:389` — проверка `browser-taken-over`.
- `test/e2e/browser-mcp.spec.ts:405-419` — соседний зелёный test с тем же кликом.
- `test/e2e/browser-mcp.spec.ts:125` — `start()`.
- `src/renderer/canvas/nodes/BrowserNode.tsx` — `browser-taken-over`.
