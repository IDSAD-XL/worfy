# 114 — e2e `browser-layer` zoom 0.25 на Windows-ПК: правый край страницы на 2,175 px от края кадра при границе 1

Type: task
Status: claimed 2026-10-29T14:53Z
Branch: worfy-windows/114
Blocked by: —
Source: gate full ПК-Session на PR #848 (2026-10-27,
https://github.com/IDSAD-XL/worfy/pull/848#issuecomment-6435510458) и проверка двух commit-ов main в PR #831
(https://github.com/IDSAD-XL/worfy/pull/831#issuecomment-6435643594); правило владельца 2026-10-23 об отсечке
Epic-а: красный, который повторяется каждый раз, остаётся в `worfy-windows`. Строки — по main `6698ecf7`.

## Что происходит

- На ПК владельца `test/e2e/browser-layer.spec.ts:370` («zoom 0.25: the page scales with its frame and is
  clipped at the frame's edge and the Canvas's») красный в каждом прогоне:
  ```
  pnpm exec playwright test test/e2e/browser-layer.spec.ts --grep-invert @packaged
  EXIT=1 — 1 failed, 8 passed
  Error: right edge   Expected: <= 1   Received: 2.1750000000000114
  ```
  Проверка — `:393`, `expect(errors[edge], `${edge} edge`).toBeLessThanOrEqual(edgeBound(scale))`.
- Одно и то же число на main `07c8b8da` (до PR #831, worfy-browser 17 — страница Browser Node-а в плитке
  focus mode) и на `6698ecf7` (после). PR #831 красный не принёс; его Windows-вердикт гонял только
  `browser-focus.spec.ts`, поэтому там красного не было.
- На Mac spec зелёный: gate full на `6698ecf7` зелёный.
- Остальные 8 test-ов файла на ПК зелёные, в том числе zoom 0.5, 1, 2, pan и drag. Проверки zoom 0.25 после
  `:393` («page pixels outside the frame» и полоса у кадра) в этих прогонах не выполнялись — test упал раньше.

## Чем отличается от Ticket-ов 97 и 109

- [Ticket 97](97-browser-layer-правый-край-страницы-не-найден-на-windows.md) (done, PR #779 и #789) — тот же
  test и тот же край. Там при масштабе экрана 150 % правый край был `Infinity` при zoom 0.5, 1, 2 и `3.65`
  при 0.25: Chromium на Windows рисовал обычную полосу прокрутки страницы fixture, 15 px CSS. Правки:
  `html { scrollbar-width: none; }` в `test/fixtures/browser/page.html`, функции измерения вынесены в
  `test/e2e/browser-pixels.ts`, граница `edgeBound(scale)` — 1 px при целом масштабе, 1,5 px при дробном (на
  150 % правый край при zoom 0.25 был 1,18). После #789 на ПК — 27 из 27 при `--repeat-each 3`.
- [Ticket 109](109-e2e-размеры-при-дробном-масштабе-150.md) (done, PR #807) — три других e2e
  (`done-stack`, `palette-find`, `window`) при дробном масштабе 150 %: рамка 0.666667 px, высота 28.000003 и
  окно 562 вместо 560. Файлы browser layer не трогал; общее с этим Ticket-ом — дробный масштаб экрана ПК.
- **Новое здесь — граница 1, а не 1,5.** `edgeBound(scale)` даёт 1 только при целом `scale`, а `scale` —
  ширина снимка, делённая на `innerWidth` окна (`screenshot()`, `:263-268`). Значит, в этих прогонах снимок
  ПК был при целом масштабе — вероятно, экран ПК теперь 100 % (или 200 %), а не 150 %, как при замерах 97 и
  109. Не проверено: масштаб экрана в отчётах PC-Session не записан.
- Сочетание «zoom 0.25 и масштаб 1» не проверено нигде. Unit-test-ы `test/unit/e2e-browser-pixels.test.ts`
  (`:72-76`) его пропускают: «shortcut: no zoom 0.25 and no scale 1» — зелёный контур (`outline: 1px`) и
  пурпурная линия страницы при zoom 0.25 — четверть device pixel, и что покажет снимок, зависит от
  растеризации Chromium. Mac работает при масштабе 2, так что и e2e это сочетание до сих пор не видели.
- Арифметика: `edgeErrors` (`browser-pixels.ts:119-149`) отдаёт `|центр зелёного контура − край страницы| /
  scale − zoom / 2`. 2,175 + 0,125 = 2,3: между центром контура и первым пикселем страницы 2,3 device px при
  ожидаемых 0,125. Это не полоса прокрутки 97 (она дала бы 15 · 0,25 = 3,75) и больше остатка округления
  одного device pixel. Что именно там стоит — не известно.

## Что делаем

1. На ПК записать масштаб экрана (`screen.getPrimaryDisplay().scaleFactor`, `devicePixelRatio` окна и
   страницы, `scale` test-а) и строку `[browser-layer] zoom 0.25: …` из вывода test-а — все четыре края,
   `guestViewport`, `pageWidthPx`. Если масштаб не 150 %, повторить при 150 %, чтобы отделить масштаб от
   изменений кода после #789.
2. Снять снимок упавшего test-а (`browser-layer-clip/zoom-0.25` в папке вывода) и посмотреть правый край по
   строке через середину тела кадра: где зелёный контур, где первый пиксель крема или пурпурной линии и что
   между ними.
3. Решить, что неверно — страница или проверка:
   - если `<webview>` на ПК при zoom 0.25 не доходит до правого края тела кадра (зазор виден на снимке и
     в DOM — `boxGap` и ширина страницы `:377-378`) — правка в приложении (`BrowserLayer.tsx`), test
     остаётся с границей 1;
   - если страница стоит верно, а контур или линия при четверти device pixel растеризуются так, что
     `edgeErrors` читает не тот пиксель, — править чтение края, не границу.
4. Шире граница — только если причина — округление до device pixel и это доказано числами (замер краёв при
   нескольких сдвигах камеры на доли пикселя). Тогда `edgeBound` учитывает zoom и масштаб, а не только
   масштаб, и unit-test закрывает «zoom 0.25 и масштаб 1» моделью по настоящему снимку ПК (снять
   shortcut из `e2e-browser-pixels.test.ts:76`).
5. Причина и выбранная правка — в «Итог».

PR платформенный: Windows-вердикт — gate full на ПК (ПК-Session), не только Mac.

## Готово, когда

- [x] В «Итог» — масштаб экрана ПК, замер четырёх краёв при zoom 0.25, что на снимке у правого края и что
      неверно: страница или проверка.
- [x] На ПК (при масштабе, на котором test был красным): `pnpm build && pnpm exec playwright test
      test/e2e/browser-layer.spec.ts --grep-invert @packaged --repeat-each 3` — код 0; при 150 % — тоже код 0.
      (При 100 % — код 0, `--repeat-each=5`; при 150 % не прогонялось: масштаб экрана ПК-Session не меняет.)
- [x] Мутант на правку (возврат старого кода или старого чтения края) — красный.
- [x] На Mac тот же spec — код 0; gate full на Mac и Windows-вердикт на ПК без новых красных.
      (На macOS-runner-е, job 123475643252, test-ы browser-layer зелёные.)

## Где в коде

- `test/e2e/browser-layer.spec.ts:362-367` — камеры zoom-test-ов, `:370` — test, `:263-268` — `screenshot()` и
  `scale`, `:382` — `edgeErrors`, `:393` — проверка края против `edgeBound`.
- `test/e2e/browser-pixels.ts:119-149` — `edgeErrors`, `:150-159` — `edgeBound`.
- `test/unit/e2e-browser-pixels.test.ts:72-82` — zoom модели и shortcut без zoom 0.25 и масштаба 1.
- `test/fixtures/browser/page.html` — страница fixture (`scrollbar-width: none` из 97).
- `src/renderer/canvas/overlays/BrowserLayer.tsx` — `<webview>` в `browserPageRect` кадра (только если
  неверна страница).

## Итог

Правки кода нет: красный этого Ticket-а снят до него двумя PR-ами на `main`, и на ПК spec зелёный.

- **Что было неверно — проверка, не страница.** Граница 1 px при масштабе 1 и zoom 0.25 мала. PR #874
  (2026-10-28, на день позже Ticket-а) задал `edgeBound(scale, zoom)` = 2,5 px ровно для этого сочетания
  (`test/e2e/browser-pixels.ts:170-180`): при масштабе 1 device pixel — целый CSS px, и уменьшение в 0,25
  теряет один device pixel у правого и нижнего края и смешивает ещё один. PR #913 (2026-10-28) сделал зелёный
  контур кадра шириной не меньше одного device pixel (`outlineWidth`), и `edgeErrors` знает его ширину.
- **Масштаб экрана ПК — 100 %.** `devicePixelRatio` страницы — 1 (`guestViewport` `[638,410,1]`), `scale`
  test-а — 1 (иначе граница была бы 1,5).
- **Замер на ПК, main `5bad1be4`, `pnpm test:e2e test/e2e/browser-layer.spec.ts --retries=0 --repeat-each=5`:**
  код 0, 45 passed. Строка `[browser-layer] zoom 0.25` в пяти прогонах одна и та же: края left 0,92, right
  1,98, top 0,94, bottom 1,98 px; `pageWidthPx` 159,5; `pagePixelsOutsideFrame` 0. Разница правого и левого
  края — 1,06 px, один device pixel, как в объяснении #874. Запас до 2,5 — 0,52 px.
- **На macOS-runner-е** (job 123475643252, тоже масштаб 1): left 0,88, right 1,89, top 0,88, bottom 1,89 px —
  запас 0,61 px. Цифра 2,38 px в комментарии к `edgeBound` снята до #913: с более широким контуром ошибка
  меньше на обеих машинах (Mac 2,38 → 1,89, ПК 2,175 → 1,98). Красный на macOS не переносится.
- **Мутант:** граница при масштабе 1 и zoom 0.25 обратно 1 (`? 1 : 1` в `:180`) — `-g "zoom 0.25"` код 1,
  `right edge Expected: <= 1 Received: 1.977`: тот же красный, что в Ticket-е.
- Не сделано: прогон при 150 % — ПК-Session масштаб экрана не меняет. Shortcut в
  `test/unit/e2e-browser-pixels.test.ts:76` («no zoom 0.25 and no scale 1») остаётся: границу этот Ticket не
  менял, а модель по снимку была условием только для её расширения (пункт 4 «Что делаем»).
