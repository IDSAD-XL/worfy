# 01 — Прототип слоя Live Browser-ов: `<webview>` в системе координат Canvas, Node — рамка

Type: task
Status: open
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

- [ ] e2e `test/e2e/browser-layer.spec.ts`, pan: рамка и страница расходятся не больше чем на 1 кадр
      и не больше чем на 1 px. Как меряем: во время pan мышью test в каждом `requestAnimationFrame`
      окна пишет timestamp кадра и `getBoundingClientRect()` рамки и `<webview>`; страница рамки
      не должна отставать больше чем на 1 кадр, а в одном кадре края расходятся на ≤1 px. Плюс
      screenshot окна в 5 точках pan без ожидания: край fixture-страницы (контрастная рамка 1 px)
      от края Node-а — ≤1 px. Числа замеров — в «Итог».
- [ ] Zoom 0.25 → 2: страница масштабируется вместе с рамкой. На zoom 1.0 текст fixture-страницы
      читается: screenshot страницы в Browser сравнивается со screenshot той же fixture-страницы в
      обычном окне Electron того же размера (`toMatchSnapshot`, расхождение ≤1 % пикселей).
- [ ] Перекрытие: другой Node, перетащенный на Browser, и контекстное меню Canvas рисуются поверх
      страницы; снимок `browser-layer-overlap` в обеих темах.
- [ ] Drag рамки Browser: страница идёт за рамкой с расхождением не больше 1 кадра и 1 px, тем же
      замером, что и pan (`requestAnimationFrame` с timestamp-ами и прямоугольниками, screenshot-ы в
      5 точках drag). Числа — в «Итог».
- [ ] Обрезка по краю рамки на zoom 0.5, 1 и 2: снимок `browser-layer-clip`.
- [ ] Рамка ушла с экрана и вернулась: счётчик на странице не сбросился — страница не
      перезагружалась.
- [ ] Unit `test/unit/window-options.test.ts`: без флага `webviewTag` выключен; под флагом —
      включён, а `will-attach-webview` снимает preload.
- [ ] В «Итог» записано решение: «go» или запасной вариант («засыпать сразу при уходе с экрана и
      вести только видимый Browser»), с числами замеров и снимками.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

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

Заполняется при закрытии.
