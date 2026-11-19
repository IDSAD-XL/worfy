# Code story — worfy-changes-view 01: Прототип экрана Changes: Card с HTML на выдуманных данных

Kind: pr · Epic: worfy-changes-view · Ticket: 01 · PR: - · Language: ru

## 1. Что было не так

Экрана diff в worfy нет, а у экрана Changes был только ASCII-набросок в spec-е. Ticket 03 строит Node Changes, и ему
нужен образец вида, как экрану Product Session был нужен его прототип-Card. Сам прототип — Card в папке данных
Project-а, вне репозитория; PR несёт только «Итог» Ticket-а с id Card-а и этой story.

- Требование: [Что происходит](../issues/01-прототип-экрана-changes.md#что-происходит)

## 2. Где лежит Card

Code: `.scratch/worfy-changes-view/issues/01-прототип-экрана-changes.md:55-57` · key lines: 55, 56

```markdown
- Card — `card-d72db918`, title «Prototype: Changes», Node на Canvas Project-а worfy (x 1088, y 8692, 1280 × 860).
  Файл — `~/Library/Application Support/worfy/CanvasForAI-a2cd477b/cards/card-d72db918/index.html`: один HTML со
  встроенными CSS и JS, без сети и сборки.
```

- Что делает: называет id Card-а и его файл. По id brief Ticket-а 03 находит прототип на Canvas, по пути — HTML.
- Почему здесь: Ticket велит записать id Card-а в «Итог» («Что делаем», 5; «Готово, когда», 3).
- Без него: Ticket 03 не знал бы, какой из Card-ов «Prototype: …» на Canvas — его образец.
- Требование: [Что делаем, 5](../issues/01-прототип-экрана-changes.md#что-делаем)
- Риски и пробелы test-ов: Card создан tool-ом `create_card`, и `list_nodes` показывает его Node. Открыт ли он в
  запущенном worfy, не проверено: снимки сделаны Playwright-ом по `file://`, вне приложения.

## 3. Что показывает Card

Code: `.scratch/worfy-changes-view/issues/01-прототип-экрана-changes.md:62-68` · key lines: 62, 65, 67

```markdown
- На Card-е — все состояния из «Что делаем», 2: шапка (scope All changes ▾ с Uncommitted и Commit, `origin/main ←
  demo-epic/03`, base, число файлов, `+/−`, Refresh); дерево с фильтром и статусами A, M, D, R; Inline | Side by side,
  Wrap, Hide whitespace (пара строк, где изменился только отступ, становится одной), Compare [main ▾]; «+» в gutter-е на
  наведении и клавиша `c`; popover (текст, Add image до 3, Cancel, Comment ⌘↵); неотправленные комментарии под строкой
  (Edit · Delete), комментарий к диапазону 14–18 с подсветкой строк; лоток «3 comments on 2 files», chip-ы, Clear,
  To [Orchestrator ▾], поле общего текста, Send ⌘↵; после Send комментарии остаются тусклыми («sent to …»); Read only —
  без «+», без комментариев и без лотка, chip Read only в шапке.
```

- Что делает: перечисляет состояния Card-а по списку пункта 2 «Что делаем». Ticket 03 сверяет с ним свой экран.
- Почему здесь: Ticket требует, чтобы Card показывал все состояния пункта 2, а кнопки переключали Inline, Side by
  side, popover и Read only.
- Без него: Ticket 03 получил бы картинку без списка того, что в ней должно быть.
- Требование: [Что делаем, 2–3](../issues/01-прототип-экрана-changes.md#что-делаем)
- Риски и пробелы test-ов: состояния проверены одним Playwright-скриптом в scratchpad: клики, ⌘↵, число «+» в Read
  only, console без ошибок. Это не test репозитория; повторить его можно, только пока жив scratchpad.

## 4. Цвета — tokens темы, без подсветки синтаксиса

Code: `.scratch/worfy-changes-view/issues/01-прототип-экрана-changes.md:71-73` · key lines: 72, 73

```markdown
- Цвета — tokens темы worfy из `src/renderer/theme/tokens.css` (светлая — палитра E, тёмная — Graphite, по
  `prefers-color-scheme`); строки diff — `--ready-*` и `--blocked-*`, как `src/renderer/harness/MigrationForm.tsx:91-92`;
  подсветки синтаксиса нет (Q5).
```

- Что делает: фиксирует, откуда цвета Card-а. Значения переменных скопированы в CSS Card-а: у страницы Card-а нет
  доступа к стилям окна worfy.
- Почему здесь: Ticket велит брать `--ready-*` и `--blocked-*`, как MigrationForm, и не подсвечивать синтаксис
  (spec, Q5 (а)).
- Без него: Ticket 03 мог бы взять цвета с картинки, а не из tokens, и разойтись с темой.
- Требование: [Что делаем, 4](../issues/01-прототип-экрана-changes.md#что-делаем)
- Риски и пробелы test-ов: копия tokens в Card-е не следит за `tokens.css`. Поменяется палитра — Card устареет молча.

## 5. Что сознательно не меняли

- Mark seen, Viewed, Last turn, PR и chip со счётчиком на Card-е не нарисованы: это часть 2 Epic-а («Вне скоупа»).
- Файлы репозитория, кроме Ticket-а и этой story, не менялись: «Где в коде» Ticket-а говорит, что кода нет.
- Снимки лежат в scratchpad, не в `.scratch/worfy-changes-view/evidence/`: так велит пункт 5 «Что делаем».

## 6. Как проверено

- `node shoot.cjs <card>/index.html <shots>` (Playwright, Chromium, 1280 × 860) — exit 0, 8 состояний в светлой и
  тёмной теме, ошибок в console нет.
- `grep -inE "canvasforai|idsad|src/main|src/renderer|https?://" <card>/index.html` — одно совпадение: комментарий с
  путём `tokens.css` самого worfy.
- `pnpm lint && pnpm typecheck && pnpm test` и gate fast — exit codes в отчёте implementer-а.

## Проверить себя

1. Почему цвета в Card-е заданы копией значений, а не ссылкой на tokens worfy?
   - Ответ: Card — отдельная страница в iframe со своим origin, стили окна worfy до неё не доходят. Поэтому значения
     скопированы, и копия может отстать от темы.
   - Строки: `.scratch/worfy-changes-view/issues/01-прототип-экрана-changes.md:71-73`
2. Чем вид Read only отличается от обычного, кроме chip-а в шапке?
   - Ответ: нет «+» в gutter-е, нет комментариев под строками и нет лотка: комментарий некому отправить.
   - Строки: `.scratch/worfy-changes-view/issues/01-прототип-экрана-changes.md:67-68`

## 7. Что нашёл review и что осталось

> VERIFIED
> Noted: [low] card index.html:556, :575 — "+1 243 −17" reads as "+1" and "243" (nf() at :434 uses a space as the thousands separator); [low] index.html:206-208 — the comment popover overlays line 28 and its comment instead of pushing the lines down (the real Node must push them); [low] index.html:592 — the tree filter "order" matches src/orders, so no narrowing is visible, and the filter does not touch the diff pane. All three go to the brief of ticket 03, not to rework of a throwaway prototype.
> Review depth: low — the ticket's own depth (spec)
> Review tokens: 103380
>
> Could not verify: the Card inside running worfy (Node on the Canvas) — screenshots taken outside the app via file://. pnpm test not rerun: the diff is .md only, ci-ok green on head.
