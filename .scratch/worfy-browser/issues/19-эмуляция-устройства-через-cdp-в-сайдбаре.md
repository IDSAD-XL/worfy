# 19 — Эмуляция устройства через CDP: `devicePixelRatio`, touch и user agent как настройка сайдбара Browser поверх viewport-а

Type: feature
Status: blocked 2026-10-29T19:55Z
Blocked reason: owner 2026-10-29: add, don't work on now
Waits: owner
Blocked by: 18
Source: решение владельца 2026-10-29, раунд 3, Q2 (приёмка Ticket-а 18): Ticket-ы эмуляции устройства «можно
добавить, но сейчас над ними точно не работаем»; [ADR-0087](../../../docs/adr/0087-browser-page-viewport.md),
пункт 5 и «Considered Options».

## Что происходит

- Ticket 18 (#1008) дал viewport страницы Browser отдельно от размера карточки. Способ — CSS (ADR-0087):
  `<webview>` размера viewport-а, вписанный в тело карточки через `transform: scale(…)`. Viewport хранится в
  `data.viewport` Node-а.
- CSS меняет только ширину и высоту окна страницы. Устройство не эмулируется (ADR-0087, пункт 5):
  - `devicePixelRatio` страницы — как у окна worfy (2 на Retina);
  - `matchMedia('(pointer: coarse)')` — `false`, touch-событий нет;
  - `<meta name="viewport">` не читается, мобильного layout-а нет;
  - user agent — настольный.
- Поэтому сайт, который выбирает мобильную вёрстку по user agent, touch или `devicePixelRatio`, в узком
  viewport-е показывает настольную вёрстку узкой ширины. Сайдбар так и пишет: «Only the width and height of the
  page change: no device is emulated.» (`src/renderer/canvas/nodes/BrowserSidebar.tsx:90`).
- В `src/` нет ни `Emulation.*` CDP (протокол отладки Chromium), ни `enableDeviceEmulation` Electron.

## Что делаем

1. **Настройка сайдбара «Emulate device».** Включается поверх заданного viewport-а; без viewport-а недоступна.
   Значения — `deviceScaleFactor`, `mobile`, touch, user agent; несколько готовых устройств и свой набор. Хранится
   в `data` Node-а Browser рядом с `viewport`, меняется операцией Layout `patchData`, как viewport.
2. **Эмуляция в main через CDP** на debugger-е страницы (`src/main/browser/cdp.ts`):
   - `Emulation.setDeviceMetricsOverride` — `deviceScaleFactor` и `mobile: true` (страница читает
     `<meta name="viewport">`); ширина и высота — те же, что `data.viewport`, чтобы CSS-размер `<webview>` и
     размер страницы совпадали;
   - `Emulation.setTouchEmulationEnabled` — touch и `pointer: coarse`;
   - `Emulation.setUserAgentOverride` — мобильный user agent.
3. **Повтор эмуляции.** Main держит состояние эмуляции на каждый Live Browser и повторяет его на каждой новой
   странице: пробуждение Asleep Browser, переезд в другое окно, падение guest-а, новый attach debugger-а.
4. **Сброс при detach debugger-а.** Эмуляция CDP живёт, пока подключён debugger main-а. DevTools отключает его
   (`src/main/browser/screencast.ts` уже обрабатывает такой detach), и эмуляция молча сбрасывается. Выбрать
   поведение и записать его в «Итог»: повторить эмуляцию после нового attach или показать в сайдбаре, что
   эмуляция снята.
5. **ADR**, если решение меняет устройство Browser: ADR-0087 оставил CDP-эмуляцию отдельной настройкой поверх
   CSS-viewport-а со своим состоянием в main.

## Компромиссы (из ADR-0087)

- **Состояние в main.** CSS-viewport живёт только в renderer; эмуляция требует состояния в main на каждую
  страницу и повтора на каждой новой странице Browser.
- **Сброс при detach debugger-а.** Открытие DevTools снимает эмуляцию без сигнала странице; нужна явная
  обработка (пункт 4 «Что делаем»).
- **Ещё одно правило координат.** С `setDeviceMetricsOverride` размер, который видит страница, и размер
  `<webview>` могут разойтись; тогда что видно в карточке, решает Chromium (обрезка или свой масштаб). Кадры для
  других окон и Linked machine (screencast) и пересчёт ввода (`framePoint`, `src/renderer/browser/frames.ts`)
  должны остаться верными.
- **`enableDeviceEmulation` Electron** — та же эмуляция без CDP и без сброса при detach, но меньше контроля
  (нет `scale`, поведение с `<webview>` не документировано). Сравнить с CDP в начале работы.
- **Инструменты агента.** `browser_screenshot` снимает страницу с её `devicePixelRatio`: с эмуляцией размер
  снимка в пикселях меняется. Описать в «Итог», что видит Session.

## Готово, когда

- [ ] Выбор CDP или `enableDeviceEmulation` и поведение при detach debugger-а записаны в «Итог» или ADR.
- [ ] С эмуляцией страница-fixture видит заданные `devicePixelRatio`, `matchMedia('(pointer: coarse)')` — `true`,
      мобильный user agent и ширину из `<meta name="viewport">` — e2e.
- [ ] Эмуляция переживает перезапуск worfy, пробуждение Asleep Browser и переезд в другое окно — e2e или
      contract test.
- [ ] Поведение после detach debugger-а (DevTools) — test.
- [ ] Кадры для других окон и Linked machine и клики с них попадают в верные точки страницы с эмуляцией — test.
- [ ] Без эмуляции всё как после Ticket-а 18: проверки пикселей Browser на Canvas и в focus mode зелёные.
- [ ] Mutant-ы: без повтора эмуляции на новой странице test красный; без пересчёта координат test ввода красный.
- [ ] gate full на Mac зелёный.

## Тесты

- e2e — `test/e2e/browser-layer.spec.ts` или новый spec рядом; страница-fixture `test/fixtures/browser/`
  печатает `devicePixelRatio`, `pointer`, user agent и `window.innerWidth`.
- unit или contract — состояние эмуляции в main и её повтор на новой странице.

## Где в коде

- `src/renderer/canvas/nodes/BrowserSidebar.tsx` — сайдбар и текст «no device is emulated» (`:90`).
- `src/renderer/canvas/nodes/browser-viewport.ts` — `viewportFit`, границы viewport-а.
- `src/main/browser/cdp.ts` — attach debugger-а и `sendCommand`.
- `src/main/browser/screencast.ts` — обработка detach debugger-а.
- `src/main/browser/live.ts`, `src/main/browser/sleep.ts` — жизнь Live Browser и пробуждение.
- `src/renderer/browser/frames.ts` — `framePoint`, пересчёт ввода с других экранов.

## Вне скоупа

- Смена viewport-а агентом: в инструментах Browser такого параметра нет (ADR-0087, пункт 6).
- Готовые размеры viewport-а и CSS-способ — Ticket 18.

## Итог
