# 11 — Полоса «The page wants to open … — Open» для ссылки, которую Browser не открыл сам

Type: task
Status: done 2026-10-20T18:55Z
PR: #614
Blocked by: 10
Source: решение владельца 2026-10-20 («10 окей» на вариант (b) в чате Session «Worfy продолжение»);
review PR #609 (Ticket 10) — цена проверки origin у `window.open`. Код перечитан по ветке
`worfy-browser/10` (`ab2469ee`).

## Что происходит

- После Ticket-а 10 обработчик `window.open` guest-страницы (`browserWindowOpenHandler`,
  `src/main/window.ts`) уводит страницу на адрес, только когда origin referrer-а совпадает с origin
  страницы. Иначе — `deny` и ничего.
- Поэтому ничего не открывают: ссылка `rel="noreferrer"` на самой странице, сайты с
  `Referrer-Policy: no-referrer`, `window.open` из iframe чужого origin. Пользователь не видит, что
  страница что-то просила.
- Сюда же, вероятно, ссылка с https-страницы на `http://…`: по политике по умолчанию
  `strict-origin-when-cross-origin` такой переход идёт без referrer (debt [low] второго круга review
  PR #609; запуском не проверено, что Electron 44 отдаёт обработчику урезанный referrer). Тест
  ticket-а проверяет и этот случай.
- Electron 44 не блокирует popup без клика из `<webview allowpopups>` и не говорит обработчику, был ли
  клик и какой frame просит (e2e Ticket-а 10, `test/e2e/browser.spec.ts`).

## Что делаем

1. Когда обработчик отказал адресу http(s) по origin или пустому referrer, main сообщает renderer-у:
   Browser `id`, адрес.
2. В рамке этого Browser-а, под адресной строкой, — полоса: «The page wants to open `<url>`» и кнопки
   «Open» и закрыть. Текст — по-английски, как остальные надписи шапки Browser-а
   (`docs/design/BRIEF.md`). Адрес показывается целиком, длинный — с обрезкой посередине.
3. «Open» — страница уходит на адрес (тот же путь, что адресная строка). Клик — это и есть жест
   пользователя: без него ничего не открывается.
4. Новая просьба заменяет старую полосу; переход страницы или закрытие убирают полосу. Адреса не
   http(s) полосу не показывают — их по-прежнему не открывает ничто.

## Готово, когда

- [x] Unit: обработчик при отказе по origin или пустому referrer сообщает адрес; при своём origin —
      не сообщает и уводит страницу, как в Ticket-е 10; адрес не http(s) — не сообщает.
- [x] e2e `test/e2e/browser.spec.ts`: iframe чужого origin вызывает `window.open` без клика —
      страница на месте, видна полоса с адресом; «Open» — страница на адресе, полоса ушла; закрыть —
      страница на месте, полоса ушла. Ссылка `rel="noreferrer"` — то же.
- [x] Снимок полосы в обеих темах.
- [x] Мутанты красные: полоса не показывается; «Open» не уводит страницу; адрес не http(s)
      показывает полосу.
- [x] `pnpm lint`, `pnpm typecheck` — exit 0 (полный `pnpm test` — gate full очереди).

## Где в коде

- `src/main/window.ts` (`browserWindowOpenHandler`)
- `src/renderer/canvas/nodes/BrowserNode.tsx`
- `src/renderer/canvas/nodes/BrowserNode.css`
- `src/renderer/canvas/overlays/BrowserLayer.tsx`
- `src/renderer/canvas/nodes/browser-frame.ts` (запрос на открытие по id Browser-а, рядом с историей страниц)
- `src/shared/ipc/browser.ts` (новый канал `browser.openRequest`, main → окно)
- `test/unit/window-options.test.ts`
- `test/e2e/browser.spec.ts`
- `test/fixtures/browser/`

Как main передаёт адрес renderer-у (событие guest-а, IPC окна) — выбор исполнителя; новый канал IPC —
в `src/shared/ipc/` по образцу соседних.

## Вне скоупа

- Browser profile — Ticket 03 (он трогает те же `BrowserNode.tsx` и `BrowserLayer.tsx` и идёт после
  этого Ticket-а).

## Итог

Сделано (ветка `worfy-browser/11`, база `origin/main` `1d94dad6`):

- `browserWindowOpenHandler` (`src/main/window.ts`) получил второй аргумент `refused(url)`. Адрес не
  http(s) — по-прежнему `deny` и ничего больше. Свой origin в referrer — страница уходит на адрес,
  как в Ticket-е 10. Иначе (referrer другого origin или пустой) — `deny` и `refused(url)`.
  `installWebPolicy` передаёт в `refused` отправку события `browser.openRequest` в
  `hostWebContents` guest-а (окно, которое рисует `<webview>`), с `webContentsId` guest-а и адресом.
  Окна уже нет — ничего не шлётся.
- Новый канал `browser.openRequest` (main → окно, `local`) — `src/shared/ipc/browser.ts`.
- main не знает id Browser-а: его знает только renderer. Поэтому main шлёт id web contents
  страницы, а `BrowserLayer.tsx` сверяет его с `getWebContentsId()` своего `<webview>` и кладёт
  адрес в хранилище запросов по id Browser-а (`browser-frame.ts`: `offerBrowserOpenRequest`,
  `dismissBrowserOpenRequest`, `useBrowserOpenRequest`; renderer ещё раз пропускает только http(s)).
  Переход страницы в main frame (`did-navigate`, `did-navigate-in-page`) и удаление страницы убирают
  запрос; новый запрос заменяет старый.
- Полоса — `OpenBar` в `BrowserNode.tsx`, вверху тела рамки, сразу под шапкой, поверх страницы
  (страница не сдвигается). Текст «The page wants to open», адрес целиком (длинный режется посередине:
  голова с многоточием, последние 24 символа всегда видны; полный адрес — в `title`), кнопки «Open» и
  закрыть. «Open» — тот же путь, что адресная строка: `navigateBrowserPage` и `patchData` адреса в Node
  (на read-only экране — только переход, Node не меняется).

Что реально приходит в обработчик (e2e, Electron 44): ссылка `target="_blank"` с https-страницы на
http-адрес приходит **без referrer** и для сайта в сети (`http://worfy-e2e.invalid/…`), и для
`http://127.0.0.1:…`, хотя 127.0.0.1 — potentially trustworthy. Первый прогон e2e ждал для 127.0.0.1
origin страницы и упал на этом; тест исправлен и проверяет полосу в обоих случаях. Значит, debt второго
круга review PR #609 подтверждён: без полосы такие ссылки не открывались бы ничем.

Проверки (по одному файлу, под `nice -n 10`):

- `pnpm lint` — exit 0; `pnpm typecheck` — exit 0.
- `node scripts/vitest-electron.mjs test/unit/window-options.test.ts` — exit 0 (23 passed); до
  реализации — exit 1 (новый test «tells the window … refused by origin or without a referrer» красный).
- `test/unit/canvas-menu.test.tsx` — exit 0 (10), `test/unit/link-access.test.ts` — exit 0 (18),
  `test/contract/ipc.test.ts` — exit 0 (20), `test/contract/ipc-renderer.test.tsx` — exit 0 (17).
- `pnpm test:e2e test/e2e/browser.spec.ts` под замком `/tmp/worfy-e2e.lock`: первый прогон — exit 1
  (тест https → http на 127.0.0.1, см. выше), второй, на `db223bef`, — exit 0 (8 passed). Новые и
  изменённые test-ы: iframe чужого origin (полоса; «Open» — страница на адресе, полоса ушла; закрыть —
  страница на месте, полоса ушла; свой `window.open` без клика — переход без полосы),
  `rel="noreferrer"` (то же), https → http (полоса для обоих адресов, «Open» — переход).

Мутанты (detached worktree в scratchpad, потом `git worktree remove`):

- полоса не показывается (`OpenBar` всегда `null`) — e2e `rel="noreferrer"` exit 1 (полосы нет);
- «Open» не уводит страницу (без `navigateBrowserPage`) — e2e `rel="noreferrer"` exit 1 (страница
  осталась на `blank.html`);
- адрес не http(s) показывает полосу (main зовёт `refused` и для него) — unit exit 1 («… does not offer
  it either»);
- main не сообщает адрес вовсе — unit exit 1.

Снимки полосы (`snapshotThemes`, iframe чужого origin): [светлая](../evidence/11-browser-open-bar-light.png),
[тёмная](../evidence/11-browser-open-bar-dark.png).

Не проверено:

- обрезка длинного адреса посередине — только кодом и CSS, снимка с длинным адресом нет;
- второе окно Project-а: запрос уходит только в окно своего `<webview>` (по `hostWebContents`), test-а
  на это нет;
- read-only экран (Linked machine): «Open» уводит страницу без `patchData` — не запускалось;
- порядок событий: запрос старой страницы, пришедший после `did-navigate` новой, покажет полосу на
  новой странице — по чтению кода маловероятно (оба события идут из main в одно окно по порядку), test-а
  нет;
- полный `pnpm test` и gate fast не запускались (по брифу — gate full очереди).

**Ревью и merge.** Ревью — VERIFIED, находок high и med нет. Две находки low переходят в Ticket 12:
домен адреса может спрятаться при обрезке посередине; сверку запроса со своим `<webview>` не
проверяет ни один test. Gate full зелёный на слиянии main `f6d9d7da` с `5e08df41`. Merge —
`a5a047a0` (gate queue Session «Worfy продолжение»).
