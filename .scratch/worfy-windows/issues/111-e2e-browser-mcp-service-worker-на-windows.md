# 111 — e2e `browser-mcp`: test про service worker другого сайта красный на Windows

Type: task
Status: done 2026-10-23T21:53Z
PR: #812
Branch: worfy-windows/111
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

- [x] Причина подтверждена замером; запись в «Итог».
- [x] На ПК `pnpm build && pnpm exec playwright test test/e2e/browser-mcp.spec.ts --grep-invert @packaged
      --repeat-each 3` — код 0.
- [ ] На Mac `test/e2e/browser-mcp.spec.ts:389` (было `:382`) с `--repeat-each 5` — код 0.

## Где в коде

- `test/e2e/browser-mcp.spec.ts:389-410` — test (до правки `:382`), `:395` — `pagePainted()`, `:396` — клик, `:397` —
  проверка `browser-taken-over`.
- `test/e2e/browser-mcp.spec.ts:413` — соседний test с тем же кликом (до правки `:405`), `:425` — `pagePainted()`.
- `test/e2e/browser-mcp.spec.ts:195` — `pagePainted()`.
- `test/e2e/browser-mcp.spec.ts:125` — `start()`.
- `src/renderer/canvas/nodes/BrowserNode.tsx` — `browser-taken-over`.

## Итог

**Причина — время, а не точка клика.** Test кликал по странице сразу после `browser_open`. В этот момент окно worfy
ещё не передаёт клик в страницу Browser Node. Замер на ПК (Windows 11, масштаб 150 %; временный код в spec, в коммит не
вошёл):

- Рамка `browser-frame-body` не двигается (та же позиция до клика и через 1 с). Под точкой клика `elementFromPoint`
  даёт `webview`, баннер «Claude is driving» уже виден, страница загружена.
- Первый клик: `browser-taken-over` не появился (2 запуска из 2). Счётчик `mousedown` в самой странице, замеренный во
  втором из них, остался 0. Значит, клик не дошёл до страницы, и `input-event` в main
  (`src/main/browser/cdp.ts:316`) его не видел.
- Второй клик через 1 с: страница получила `mousedown`, управление перешло к пользователю.
- Пауза 2 с перед первым кликом: test зелёный.
- Соседний test (теперь `:413`) зелёный. Вероятная причина, отдельно не замеренная: до клика он снимает скриншоты в двух
  темах, и за это время страница успевает.

Код продукта не меняли. Предположение, не замеренное: клик человека в первые доли секунды после открытия Browser тоже
может потеряться, и это поведение Electron/Chromium при только что созданной странице, а не кода worfy.

Ожидание двух кадров — косвенный признак: оно показывает, что страница рисует, а не что окно уже передаёт ей клик. На
более медленной машине test может снова стать нестабильным, поэтому пункт про прогон на Mac остаётся открытым.

**Правка (только test).** Помощник `pagePainted()` в `test/e2e/browser-mcp.spec.ts` ждёт, пока страница отрисует два
кадра (`requestAnimationFrame` дважды, внутри страницы). Его вызывают перед кликом пользователя в обоих test-ах с кликом
(`:389` и `:413`). Без этого ожидания первый клик терялся (2 из 2), с ним — доходил (3 из 3, затем весь файл).

**Проверки на ПК**, ветка `worfy-windows/111` поверх main `a6d54252`:

- `pnpm exec playwright test test/e2e/browser-mcp.spec.ts --grep-invert @packaged --repeat-each 3`: 18 passed, код 0.
- `pnpm lint` код 0, `pnpm typecheck` код 0, `test/unit/no-rmsync.test.ts` + `test/unit/e2e-no-spawn-on-load.test.ts`
  код 0.
