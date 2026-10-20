# 12 — Полоса «Open»: домен адреса виден целиком; test сверки запроса со своим Browser-ом

Type: task
Status: claimed 2026-10-20T18:55Z
Blocked by: 11
Source: review PR #614 (Ticket 11), две находки low, 2026-10-20. Код перечитан по ветке
`worfy-browser/11` (`5e08df41`).

## Что происходит

- Полоса «The page wants to open `<url>`» (Ticket 11) режет длинный адрес посередине
  (`src/renderer/canvas/nodes/BrowserNode.tsx:159`, `BrowserNode.css:140`). При такой обрезке может
  пропасть именно домен. Пример: iframe чужого origin вызывает `window.open` на
  `https://bank.example.com.aaaa…aaaa.evil.net/…/bank.example.com/login`. В полосе видно
  `https://bank.example.com.a…` и конец пути, а настоящий домен `evil.net` есть только в tooltip.
  Пользователь нажимает «Open», думая, что это банк.
- Слой Browser-ов сверяет событие из main со своим `<webview>`: `webContentsId === own`
  (`src/renderer/canvas/overlays/BrowserLayer.tsx:134`). Эту сверку не проверяет ни один test: все
  e2e работают с одним Browser-ом. Если заменить условие на `true`, test-ы останутся зелёными. Тогда
  при двух Browser-ах полоса встанет на обоих, и «Open» уведёт чужую страницу.

## Что делаем

1. Полоса показывает host адреса (`new URL(url).host`) целиком всегда. Обрезается только остальное:
   путь, query, fragment — посередине, как сейчас. Схему можно не показывать, если её нет в
   соседних надписях шапки. Полный адрес — по-прежнему в tooltip.
2. Unit-test на сверку: два Browser-а с разными web contents id. Событие для одного ставит полосу
   только ему. Если удобнее вынести сверку в чистую функцию рядом с `browser-frame.ts`, вынести.

## Готово, когда

- [x] Длинный адрес с длинным host-ом: host виден целиком, обрезан путь (unit-test на функцию
      форматирования адреса или e2e на текст полосы).
- [x] Unit-test: событие с id второго Browser-а не ставит полосу первому; мутант «условие всегда
      true» даёт exit 1.
- [x] Снимок полосы с длинным адресом в обеих темах (`snapshotThemes`).

## Где в коде

- `src/renderer/canvas/nodes/BrowserNode.tsx`
- `src/renderer/canvas/nodes/BrowserNode.css`
- `src/renderer/canvas/overlays/BrowserLayer.tsx`
- `src/renderer/canvas/nodes/browser-frame.ts`
- `test/unit/` — новый test на форматирование адреса и сверку
- `test/e2e/browser.spec.ts` — если проверка текста полосы идёт через e2e

## Вне скоупа

- Поведение main (`browserWindowOpenHandler`) не меняется.

## Итог

Сделано (ветка `worfy-browser/12`, PR #630, база `origin/main` `b691fdc8` после rebase):

- `openBarAddress(url)` в `src/renderer/canvas/nodes/browser-frame.ts` делит адрес на три части.
  `site` — схема и host с портом, показывается целиком всегда. `head` и `tail` — путь, query и
  fragment: голова режется с многоточием, последние 24 символа (`OPEN_BAR_ADDRESS_TAIL`) видны
  всегда. User info (`https://bank.example.com@evil.net/`) в видимый текст не попадает: его можно
  принять за host. Полный адрес — по-прежнему в `title`. Схему оставили: без неё e2e Ticket-а 11
  (текст полосы равен адресу) пришлось бы менять, а http и https полезно различать.
- `OpenBar` (`BrowserNode.tsx`) рисует три `span`: `browser-open-site`, `browser-open-path-head`,
  `browser-open-path-tail`.
- CSS (`BrowserNode.css`). Голова пути сжимается первой (`flex-shrink: 1000`), до 2 символов: так
  остаётся место под «…». Потом сужается host, но не уже 12 символов, и переносится на следующие
  строки, а не режется. Высота полосы — `min-height: 28px`, она растёт. Адрес не уже
  `min(100%, 12ch + 24ch)`. Если Browser уже 540px (container query по телу рамки), подпись
  «The page wants to open» встаёт на свою строку, адрес и кнопки — под ней. Хвост пути не сжимается.
  Только в рамке уже ~260px обрезается конец хвоста.
- Сверка `webContentsId === own` вынесена в `offerOwnBrowserOpenRequest(id, ownWebContentsId, request)`
  рядом с хранилищем запросов (`browser-frame.ts`). `BrowserLayer.tsx` вызывает её. Поведение то же:
  страница без web contents (guest не присоединён) запрос не берёт.
- Review PR #630 (находка low): у host-а были `min-width: 0` и `flex-shrink: 1`. В Browser-е шириной
  ~440px host сужался до столбца по одному символу, полоса вырастала примерно до 1300px. Исправлено
  минимумами и переносом на вторую строку (см. выше).

Проверки (по одному файлу, под `nice -n 10`):

- `node scripts/vitest-electron.mjs test/unit/browser-open-bar.test.tsx` — до реализации exit 1
  (8 failed), после — exit 0 (8 passed). Test-ы: длинный host целиком и обрезан только путь, порт с
  host-ом, короткий путь без обрезки, user info не показывается, не-URL; два Browser-а (id 11 и 22):
  событие второго ставит полосу только ему, событие чужой страницы — никому, страница без web
  contents — не берёт.
- `test/unit/canvas-menu.test.tsx` — exit 0 (10 passed).
- `pnpm lint` — exit 0; `pnpm typecheck` — exit 0 (последний раз на `18942863`).
- `pnpm test:e2e test/e2e/browser.spec.ts -g "the Open bar shows a long host whole"` под замком
  `/tmp/worfy-e2e.lock`, на `18942863` — exit 0 (2 passed: рамка 640 и 400). Проверяется: текст и
  tooltip полосы — весь адрес; host виден целиком, не уже 12 символов, внутри полосы и не наезжает
  на хвост; голова пути обрезана; «Open» и закрыть внутри полосы; полоса ниже 240px; при 400 адрес
  под подписью, при 640 — на одной строке с ней.
- Без e2e, до слота: статичная страница с `BrowserNode.css` и `tokens.css` в built-in browser,
  рамки 640/560/520/440/400/300/240. При ширине от 300 все условия выше держатся. Старый CSS на той же
  странице даёт полосу 1658px в рамках 400–440 и host уже 12 символов — находка review
  воспроизведена.

Mutant-ы `browser-frame.ts` (detached worktree в scratchpad, потом `git worktree remove`), каждый
против `test/unit/browser-open-bar.test.tsx`:

- условие сверки всегда `true` — exit 1 (2 failed);
- host не отделяется (старая обрезка всего адреса) — exit 1 (4 failed);
- страница без web contents берёт запрос — exit 1 (1 failed);
- user info показан перед host-ом — exit 1 (1 failed).

Снимки (обе темы, `snapshotThemes`):

- рамка 640: `../evidence/12-browser-open-bar-long-light.png`, `../evidence/12-browser-open-bar-long-dark.png`;
- рамка 400: `../evidence/12-browser-open-bar-long-narrow-light.png`,
  `../evidence/12-browser-open-bar-long-narrow-dark.png`.

Снимки Ticket-ов 02, 10 и 11 прогон не перезаписал (`-g` выбрал только новые test-ы).

Не проверено:

- Весь `pnpm test`, gate fast и весь `test:e2e` не запускались (правило нагрузки брифа): это gate full
  перед мержем.
- Mutant-ы CSS гонялись только на статичной странице, не в e2e.
- Порог 540px — оценка по ширине подписи, кнопок и 36 символов mono-шрифта. Под другим шрифтом
  (Windows) переход на две строки может начаться чуть раньше или позже. Host всё равно не уже 12
  символов: это держит `min-width`, а не порог.
