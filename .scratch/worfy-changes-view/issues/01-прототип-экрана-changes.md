# 01 — Прототип экрана Changes: Card с HTML на выдуманных данных

Type: prototype
Status: done 2026-11-19T13:18Z
PR: #2036
Blocked by: —
Source: [spec.md](../spec.md), «Ticket-ы», 1; «Решение» → «Экран»; «Решено без владельца», 4

Кто: агент.

Не платформенный Ticket (Card, кода нет). Глубина ревью — `low`.

## Что происходит

- Экрана diff в worfy нет; набросок экрана — ASCII в spec-е («Решение» → «Экран»). Ticket 03 строит Node Changes, и ему
  нужен образец вида, а не только схема.
- Экран Product Session строили по прототипу-Card-у, и владелец сравнивал готовый экран с ним
  (`.scratch/worfy-product-session/spec.md:89-93`). Card — HTML-файл в папке данных Project-а, его показывает Node
  Card (`docs/features/cards.md`).
- Тексты UI английские: «UI copy is ENGLISH» (`docs/design/BRIEF.md:4`; ADR-0017 — английские канонические термины).

## Что делаем

1. Card «Prototype: Changes» на Canvas Project-а worfy через Card API или tool `create_card` сервера worfy-canvas.
   Данные выдуманы: Ticket `demo-epic/03`, 6 файлов, один большой свёрнутый файл, один binary, группа Workflow files.
2. На Card-е: шапка (scope All changes ▾, база ← head, число файлов, `+/−`, Refresh); дерево с фильтром и статусами
   A, M, D, R; переключатель Inline | Side by side, Wrap, Hide whitespace, Compare against; diff с gutter-ом «+» на
   наведении; popover комментария (текст, «Add image», ⌘↵); неотправленный комментарий под строкой; лоток внизу
   («3 comments on 2 files», chip-ы, Clear, «To [Orchestrator ▾]», поле общего текста, Send ⌘↵); вид Read only без «+» и
   лотка.
3. Кнопки на Card-е переключают состояния (Inline и Side by side, popover открыт, Read only); логики git нет.
4. Цвета — tokens темы worfy (`--ready-*`, `--blocked-*` для строк, как `src/renderer/harness/MigrationForm.tsx:91-92`),
   без подсветки синтаксиса (Q5).
5. В «Итог»: id Card-а и снимок экрана для брифа Ticket-а 03 (снимок — в scratchpad, в репозиторий не кладётся).

## Готово, когда

- [ ] Card «Prototype: Changes» открывается на Canvas Project-а и показывает все состояния из «Что делаем», 2.
  - evidence: test-run pass · `node shoot.cjs <card>/index.html <shots>` exit 0, 8 states in light and dark, no console errors · mac - · bd27572f461ed92c55955c882bbaddea6ca9a186
  - evidence: review pass · PR #2036 · - - · 0cd514340278681a52b69bc7051339791a04872b
- [ ] Данные выдуманы: в Card-е нет путей, имён и кода настоящих репозиториев, кроме worfy.
  - evidence: test-run pass · `grep -inE "canvasforai|idsad|src/main|src/renderer|https?://" <card>/index.html` exit 0, one match: the comment naming the worfy tokens.css · mac - · bd27572f461ed92c55955c882bbaddea6ca9a186
  - evidence: review pass · PR #2036 · - - · 0cd514340278681a52b69bc7051339791a04872b
- [ ] В «Итог» — id Card-а; Ticket 03 ссылается на него в брифе.
  - evidence: commit pass · worfy-changes-view/01: result of the Changes screen prototype Card · - - · bd27572f461ed92c55955c882bbaddea6ca9a186

## Где в коде

Кода нет: Card лежит в папке данных Project-а (`docs/features/cards.md`), файлов репозитория Ticket не меняет.

## Вне скоупа

- Mark seen, Viewed, Last turn, PR и chip со счётчиком — часть 2. Взгляд владельца Ticket 03 не ждёт (spec, «Решено без
  владельца», 4).

## Итог

- Card — `card-d72db918`, title «Prototype: Changes», Node на Canvas Project-а worfy (x 1088, y 8692, 1280 × 860).
  Файл — `~/Library/Application Support/worfy/CanvasForAI-a2cd477b/cards/card-d72db918/index.html`: один HTML со
  встроенными CSS и JS, без сети и сборки.
- Данные выдуманы: Ticket `demo-epic/03` выдуманного магазина; 6 файлов — `src/orders/cart.ts` (M),
  `src/orders/discount.ts` (A), `src/orders/legacy-tax.ts` (D), `src/ui/CartSummary.tsx → src/ui/OrderSummary.tsx` (R),
  `assets/logo.png` (binary, 12.4 KB → 14.1 KB), `data/fixtures/catalog.json` (большой, свёрнут, `+1 204`); группа
  Workflow files (2) под `.scratch/**` свёрнута в конце.
- На Card-е — все состояния из «Что делаем», 2: шапка (scope All changes ▾ с Uncommitted и Commit, `origin/main ←
  demo-epic/03`, base, число файлов, `+/−`, Refresh); дерево с фильтром и статусами A, M, D, R; Inline | Side by side,
  Wrap, Hide whitespace (пара строк, где изменился только отступ, становится одной), Compare [main ▾]; «+» в gutter-е на
  наведении и клавиша `c`; popover (текст, Add image до 3, Cancel, Comment ⌘↵); неотправленные комментарии под строкой
  (Edit · Delete), комментарий к диапазону 14–18 с подсветкой строк; лоток «3 comments on 2 files», chip-ы, Clear,
  To [Orchestrator ▾], поле общего текста, Send ⌘↵; после Send комментарии остаются тусклыми («sent to …»); Read only —
  без «+», без комментариев и без лотка, chip Read only в шапке.
- Полоса «Prototype · fictional data» над Node-ом — не часть экрана: кнопки Inline, Side by side, Popover open, Read
  only, Reset. Клавиши `j` / `k` ходят по файлам.
- Цвета — tokens темы worfy из `src/renderer/theme/tokens.css` (светлая — палитра E, тёмная — Graphite, по
  `prefers-color-scheme`); строки diff — `--ready-*` и `--blocked-*`, как `src/renderer/harness/MigrationForm.tsx:91-92`;
  подсветки синтаксиса нет (Q5).
- Снимки для брифа Ticket-а 03 — в scratchpad, не в репозитории: `/tmp/worfy-changes-view-w1/impl-01/shots/`
  (`01-inline-*`, `02-side-by-side-*`, `03-popover-*`, `04-read-only-*`, `05-binary-large-*`, `06-workflow-*`,
  `07-gutter-plus-*`, `08-sent-*` — каждый в `light` и `dark`; `09-range-light.png`). Сняты Playwright-ом по `file://`,
  1280 × 860, ошибок в console нет.
- Владелец одобрил прототип (Card `card-d72db918`) 2026-11-20: «Прототип Changes глянул, апруваю».
