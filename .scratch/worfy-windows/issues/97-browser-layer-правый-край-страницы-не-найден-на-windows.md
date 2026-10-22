# 97 — e2e `browser-layer`: на Windows правый край страницы Browser Node-а не находится на снимке экрана

Type: task
Status: open
Blocked by: —
Source: направление Session на Mac 2026-10-22, пересчёт красных e2e [Ticket-а 14](14-gate-full-на-windows.md);
замер на ПК 2026-10-22, main `d06d2c2d`, масштаб экрана 150 %.

## Что происходит

Шесть test-ов `test/e2e/browser-layer.spec.ts` красные на Windows-ПК; ни одна группа Ticket-а 14 и ни один
Ticket их не называет:

- `:506` «pan: the page stays in its frame…» и `:519` «drag of the frame: the page follows…» — проверка снимков
  (`shotsPx`, `:516`, `:532`): `Expected: <= 1`, `Received: Infinity`;
- `:547` «zoom N: the page scales with its frame…», все четыре масштаба (0.25, 0.5, 1, 2) — проверка `right edge`
  (`:567`): при 0.5, 1 и 2 — `Infinity`, при 0.25 — `3.65`.

`Infinity` по `edgeErrors` (`:262-300`) значит: на снимке не найден зелёный контур кадра или пиксель страницы у
края. Отчёт test-а (строка `[browser-layer] zoom …` в выводе) — левый, верхний и нижний края в пределах 1 px,
правый не найден:

```
[browser-layer] zoom 1: {"guestViewport":[638,410,1],"edgeErrorsPx":{"left":0,"right":null,"top":0,"bottom":0},…}
[browser-layer] zoom 0.25: {"guestViewport":[638,410,1],"edgeErrorsPx":{"left":0.86,"right":3.65,"top":0.94,"bottom":1.69},…}
```

Вероятная причина — прочитана по отчёту, запуском не подтверждена: у правого края страницы на Windows стоит
что-то не цвета страницы — например, обычная (не наложенная) полоса прокрутки Chromium; на macOS полосы
прокрутки наложенные. `devicePixelRatio` страницы — 1 при масштабе экрана 150 %; влияет ли это, не проверено.

## Воспроизведение (ПК, 2026-10-22)

```
pnpm build && pnpm exec playwright test test/e2e/browser-layer.spec.ts --grep-invert @packaged
```

Красные 6 из 9 test-ов файла в полном прогоне `pnpm test:e2e` и те же 6 при повторе файла одного (2 из 2 —
стойко, не нестабильно). Отчёты — `%TEMP%\wt14r-full-report.json`, `%TEMP%\wt14r-rerun-browser-layer-report.json`
(на ПК, в репозиторий не входят).

## Что делаем

1. Посмотреть снимки упавших test-ов (`test-failed-*.png` в папке вывода): что стоит у правого края страницы.
2. Если это полоса прокрутки или другая разница систем — решить, где правка: страница fixture без полосы
   прокрутки, поиск края с учётом её ширины или поведение Browser Node-а в приложении. Причина — в «Итог».
3. Если это ошибка положения страницы в кадре на Windows — правка в приложении, test не ослабляется.

## Готово, когда

- [ ] На ПК `pnpm build && pnpm exec playwright test test/e2e/browser-layer.spec.ts --grep-invert @packaged` —
      код 0, три прогона подряд.
- [ ] На Mac тот же spec — код 0.

## Где в коде

- `test/e2e/browser-layer.spec.ts`

## Итог
