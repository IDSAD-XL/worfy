# 01 — Прототип слоя Live Browser-ов: `<webview>` в системе координат Canvas, Node — рамка

Type: task
Status: claimed 2026-10-19T21:36Z
Branch: worfy-browser/01
Blocked by: —
Source: [spec.md](../spec.md); [ADR-0078](../../../docs/adr/0078-browser-node.md) (Browser Node), пункт 12
(слой вне списка Node-ов, первый Ticket — прототип, запасной вариант), пункт 3 (хост — `<webview>`),
«Последствия» (слой — главный риск по отображению). Код перечитан по main `dd6b0afb`.

## Что происходит

- Canvas монтирует только видимые Node-ы: `onlyRenderVisibleElements` у `<ReactFlow>`
  (`src/renderer/canvas/Canvas.tsx:543`) действует на весь Canvas сразу. `<webview>` внутри Node-а
  размонтировался бы при уходе с экрана и терял страницу.
- Overlay-и Canvas рисуются детьми `<ReactFlow>` (`Canvas.tsx:548`), список собирается сам из
  `src/renderer/canvas/overlays/*.tsx` (`src/renderer/canvas/extensions.ts:84`). Рисовать внутри
  transform viewport-а умеет `ViewportPortal` React Flow — сейчас его использует один
  `src/renderer/canvas/overlays/FocusEntry.tsx:116`.
- `webviewTag` в окне выключен: блок `webPreferences` (`src/main/window.ts:84`) его не ставит;
  `will-attach-webview` в `src/main` нет.

## Что делаем

Прототип отвечает на один вопрос: держит ли отдельный слой `<webview>` отображение на Canvas. Итог —
«go» или запасной вариант ADR-0078, п. 12.

1. **Рамка.** `src/renderer/canvas/nodes/BrowserNode.tsx` (новый), `kind = 'browser'`, без
   `createLabel` — в меню Canvas его ещё нет; Node создаёт только test. Рамка пустая, у неё есть
   id и размер.
2. **Слой.** `src/renderer/canvas/overlays/BrowserLayer.tsx` (новый) рисует `<webview>` каждого
   Browser Node-а Layout-а внутри transform viewport-а (`ViewportPortal`), по координатам и размеру
   его рамки. Слой не зависит от `onlyRenderVisibleElements`: рамка вне экрана не размонтирует
   страницу.
3. **Обрезка.** `<webview>` обрезан по краю своей рамки на любом zoom; часть рамки за краем окна не
   рисуется поверх интерфейса.
4. **`webviewTag`** включается только под флагом прототипа (env-переменная e2e); без флага окно
   такое же, как сейчас. Даже под флагом `will-attach-webview` снимает preload и ставит
   `nodeIntegration: false` (полная проверка partition-ов — Ticket 02).
5. **Замеры** — e2e на локальной fixture-странице (счётчик кадров и текст). Итог с числами и
   снимками — в «Итог»: «go» или запасной вариант.

## Готово, когда

- [x] e2e `test/e2e/browser-layer.spec.ts`, pan: рамка и страница расходятся не больше чем на 1 кадр
      и не больше чем на 1 px. Как меряем: во время pan мышью test в каждом `requestAnimationFrame`
      окна пишет timestamp кадра и `getBoundingClientRect()` рамки и `<webview>`; страница рамки
      не должна отставать больше чем на 1 кадр, а в одном кадре края расходятся на ≤1 px. Плюс
      screenshot окна в 5 точках pan без ожидания: край fixture-страницы (контрастная рамка 1 px)
      от края Node-а — ≤1 px. Числа замеров — в «Итог».
- [x] Zoom 0.25 → 2: страница масштабируется вместе с рамкой. На zoom 1.0 текст fixture-страницы
      читается: screenshot страницы в Browser сравнивается со screenshot той же fixture-страницы в
      обычном окне Electron того же размера (`toMatchSnapshot`, расхождение ≤1 % пикселей).
- [x] Перекрытие: другой Node, перетащенный на Browser, и контекстное меню Canvas рисуются поверх
      страницы; снимок `browser-layer-overlap` в обеих темах.
- [x] Drag рамки Browser: страница идёт за рамкой с расхождением не больше 1 кадра и 1 px, тем же
      замером, что и pan (`requestAnimationFrame` с timestamp-ами и прямоугольниками, screenshot-ы в
      5 точках drag). Числа — в «Итог».
- [x] Обрезка по краю рамки на zoom 0.5, 1 и 2: снимок `browser-layer-clip`.
- [x] Рамка ушла с экрана и вернулась: счётчик на странице не сбросился — страница не
      перезагружалась.
- [x] Unit `test/unit/window-options.test.ts`: без флага `webviewTag` выключен; под флагом —
      включён, а `will-attach-webview` снимает preload.
- [x] В «Итог» записано решение: «go» или запасной вариант («засыпать сразу при уходе с экрана и
      вести только видимый Browser»), с числами замеров и снимками.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Тесты

- Сначала падающий: e2e «рамка ушла с экрана и вернулась — счётчик не сбросился».
- e2e `test/e2e/browser-layer.spec.ts` (новый); unit `test/unit/window-options.test.ts`.
- Fixture-страницы — `test/fixtures/browser/` (новые), локальный test server; внешних сайтов нет.

## Где в коде

- `src/renderer/canvas/nodes/BrowserNode.tsx` (новый)
- `src/renderer/canvas/overlays/BrowserLayer.tsx` (новый)
- `src/main/window.ts` (`webPreferences` `:84`, `installWebPolicy` `:214`)
- `test/fixtures/browser/` (новый)
- `test/e2e/browser-layer.spec.ts` (новый)
- `test/unit/window-options.test.ts`

Только чтение: `src/renderer/canvas/Canvas.tsx` (`onlyRenderVisibleElements` `:543`, transform
`:359-360`), `src/renderer/canvas/overlays/FocusEntry.tsx` (`ViewportPortal` `:116`),
`src/renderer/canvas/extensions.ts` (`:84`).

## Вне скоупа

- Адресная строка, пункт меню Canvas, полная проверка `will-attach-webview` — Ticket 02.
- Browser profile и partition-ы — Ticket 03.
- Сон и предел Live — Ticket 05.

## Открытые вопросы

1. **Порог «без видимого отставания».** ADR числа не даёт. Предложение: расхождение рамки и страницы
   не больше одного кадра анимации и 1 px. Исполнитель записывает замер в «Итог»; спорный результат
   решает владелец по снимку или записи экрана.
2. **Порядок перекрытия.** Слой один на все Browser-ы. ADR-0078, п. 3 требует, чтобы Node-ы и меню
   перекрывали страницу; как слой встаёт между Node-ами (поверх всех рамок или ниже Node-ов с
   «окном» в рамке), ADR не говорит. Прототип пробует и записывает выбор в «Итог».
3. **Колесо мыши над страницей** — прокрутка страницы или pan Canvas. ADR не решает. Прототип
   записывает, что делает `<webview>` по умолчанию; решение — в Ticket 02 (владелец).
4. **Код прототипа после «go»** — остаётся основой Ticket-а 02 или переписывается. Предложение:
   остаётся, флаг снимает Ticket 02.

## Итог

**Решение: «go».** Отдельный слой `<webview>` держит отображение на Canvas по всем пунктам «Готово,
когда»; запасной вариант ADR-0078, п. 12 («засыпать сразу при уходе с экрана») не нужен.

Замеры — e2e `test/e2e/browser-layer.spec.ts`, Mac владельца (Retina, 2 device px на CSS px,
120 Hz: средний кадр 8,33 ms), окно 1400×900, рамка 640×440, страница — `test/fixtures/browser/page.html`
с локального test server на 127.0.0.1. Каждое число тест печатает строкой `[browser-layer] …`.

| Что | Замер | Порог |
| --- | --- | --- |
| Pan (средняя кнопка, 30 шагов) | 60 кадров `requestAnimationFrame`, в 29 рамка двигалась; отставание страницы **0 кадров**, расхождение краёв **0 px**; capture окна в 5 точках без ожидания — край страницы от края рамки **0 px** по всем четырём сторонам | ≤1 кадр, ≤1 px |
| Drag рамки за header (30 шагов) | 63 кадра, в 29 рамка двигалась; отставание **0 кадров**, **0 px**; 5 capture — **0 px** | ≤1 кадр, ≤1 px |
| Zoom 0.25 / 0.5 / 1 / 2 | ширина страницы 159,5 / 319 / 638 / 1276 px = 638 × zoom; край страницы от края рамки 0,13 / 0 / 0 / 0 px | ≤1 px |
| Zoom 1 против обычного окна Electron того же размера | расходится **0,01 %** пикселей (638×410), `toMatchSnapshot` с `maxDiffPixelRatio: 0.01` зелёный | ≤1 % |
| Обрезка (zoom 0.25, 0.5, 1, 2; на 2 рамка уходит под sidebar и за низ окна) | пикселей страницы вне видимой части рамки — **0**, левее Canvas (над sidebar) — **0** | 0 |
| Перекрытие | под Note, которую держат над страницей, пикселей страницы **0**; под меню Canvas — **0** | 0 |
| Рамка ушла с экрана и вернулась | `<webview>` остался в DOM, счётчик страницы рос и вне экрана, токен загрузки тот же — **перезагрузки нет** | без перезагрузки |

0,13 px на zoom 0.25 — шаг самого замера: линия края в 1 CSS px там занимает полпикселя устройства
и смешивается с соседним. На zoom 2 Chromium перерисовывает страницу в новом масштабе, текст
резкий (снимок zoom 2).

Снимки:
- перекрытие: [светлая](../evidence/01-browser-layer-overlap-light.png), [тёмная](../evidence/01-browser-layer-overlap-dark.png) тема; меню над страницей — [светлая](../evidence/01-browser-layer-overlap-menu-light.png), [тёмная](../evidence/01-browser-layer-overlap-menu-dark.png);
- обрезка: [zoom 0.5](../evidence/01-browser-layer-clip-zoom-0.5.png), [zoom 1](../evidence/01-browser-layer-clip-zoom-1.png), [zoom 2](../evidence/01-browser-layer-clip-zoom-2.png);
- zoom 1: [страница в слое](../evidence/01-browser-layer-zoom-1-in-layer.png) и [та же страница в обычном окне](../evidence/01-browser-layer-zoom-1-plain-window.png);
- середина pan и drag: [pan](../evidence/01-browser-layer-pan-point-3.png), [drag](../evidence/01-browser-layer-drag-point-3.png).

Зелёная линия вокруг тела рамки на снимках — outline, который ставит сам test, чтобы мерить край
рамки на пикселях; в приложении её нет.

**Чем мерили и одна ловушка.** Пиксели берутся из `webContents.capturePage()` окна, а не из
`page.screenshot()` Playwright: screenshot через CDP (`Page.captureScreenshot`) теряет последний
CSS px страницы `<webview>` справа и снизу, хотя окно его показывает (сверено попиксельно: guest
capture 1276×820, capture окна — линия на месте, screenshot — нет). Снимки перекрытия сделаны
helper-ом `snapshotThemes` (тот же screenshot), на них справа и снизу у страницы нет розовой линии —
это артефакт снимка, не слоя.

**Открытые вопросы.**
2. *Порядок перекрытия.* Выбран вариант «слой ниже всех Node-ов, тело рамки — окно»: слой лежит
   внутри viewport React Flow с `z-index: -1`, под Node-ами и Edge-ами, над плоскостью; рамка
   Browser прозрачна, и мышь через её тело проходит к `<webview>` (у обёртки Node-а
   `pointer-events: none`, мышь берёт только header). Так любой Node, меню, toolbar выделения и
   кнопка Focus рисуются поверх страницы без отдельной логики. Цена (видна на снимке одного из
   прогонов при подготовке test-а, в evidence его нет): пока Browser тащат над другим Node-ом, рамка (поднятая как выбранная) рисуется
   поверх того Node-а, а страница — под ним; в покое Node-ы не пересекаются (ADR-0038), так что это
   только во время drag. Два Browser-а, наложенные друг на друга, перекрываются страницами по id, а
   не по выбору; Browser внутри полупрозрачного Epic frame виден сквозь него — оба случая не
   мерились, это задача Ticket-а 02.
3. *Колесо над страницей.* По умолчанию его берёт страница: wheel из CDP (как и настоящий, он
   маршрутизируется в frame под указателем) прокрутил страницу на 400 px, Canvas не сдвинулся. Это
   противоположно правилу Card (wheel-router: до клика колесо двигает Canvas). Решение — Ticket 02,
   владелец. Настоящий trackpad руками не проверялся; `webContents.sendInputEvent` на окне для
   этого не годится — он отдаёт событие странице самого окна, и Canvas сдвигается.
4. *Код прототипа.* Предложение — оставить основой Ticket-а 02, а флаг `WORFY_BROWSER_PROTOTYPE`
   снять там же. Ticket 02 добавляет: полную проверку `will-attach-webview` (адрес, partition),
   решение по колесу, «страница не берёт мышь, пока зажата кнопка» для жеста, начатого вне рамки
   (как `data-pointer-pressed` у Card; сейчас мышь снимается только на drag Node-а, pan и resize),
   permission handler для partition-ов Browser profile (сейчас guest живёт в `defaultSession`, где
   permission handler уже отказывает всем, кроме renderer-а worfy).

**Что сделано.** `src/renderer/canvas/nodes/BrowserNode.tsx` — рамка (`kind = 'browser'`, без
`createLabel`), `nodes/browser-frame.ts` — геометрия тела рамки и адрес из `data.url` (только
http/https), `nodes/BrowserNode.css` — стили рамки и слоя, `overlays/BrowserLayer.tsx` — слой
через `ViewportPortal`, читает все Browser Node-ы из `nodeLookup` React Flow, а не из видимых, и
держит `<webview>` в постоянном порядке по id (перестановка `<webview>` в DOM перезагружает
страницу). `src/main/window.ts`: `webviewTag` только при `WORFY_BROWSER_PROTOTYPE=1`, и тогда
`will-attach-webview` снимает preload, ставит `nodeIntegration: false`,
`nodeIntegrationInSubFrames: false`, `contextIsolation: true`, `sandbox: true`; без флага окно
прежнее (`test/unit/window-options.test.ts`).
