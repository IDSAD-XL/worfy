# Code story — worfy-integrations 02: Прототип экранов: раздел Integrations, Add integration, вход, строка Integration, фильтр tools, chip и Settings → Integrations

Kind: pr · Epic: worfy-integrations · Ticket: 02 · PR: - · Language: ru

## 1. Что было не так

Добавить MCP-сервер из worfy сегодня нельзя, а у экрана Integrations был только ASCII-набросок в spec-е. Ticket-ы 08 и
09 строят экран и вход, и им нужен образец вида. Сам прототип — Card в папке данных Project-а, вне репозитория; PR
несёт только «Итог» Ticket-а с id Card-а, строку Evidence и эту story.

- Требование: [Что происходит](../issues/02-прототип-экранов-integrations.md#что-происходит)

## 2. Где лежит Card

Code: `.scratch/worfy-integrations/issues/02-прототип-экранов-integrations.md:71-74` · key lines: 71, 73

```markdown
- Card — `card-e53beada`, title «Prototype: Integrations», Node на Canvas Project-а worfy (x 1088, y 10752,
  1300 × 880), связан с Epic-ом `worfy-integrations` (`link_card`). Файл —
  `~/Library/Application Support/worfy/CanvasForAI-a2cd477b/cards/card-e53beada/index.html`: один HTML со встроенными
  CSS и JS, без сети и сборки. Цвета — копия tokens темы worfy (светлая — палитра E, тёмная — Graphite), как у
```

- Что делает: называет id Card-а и его файл. По id brief Ticket-а 08 или 09 находит прототип на Canvas, по пути — HTML.
- Почему здесь: Ticket велит записать id Card-а в «Итог» («Что делаем», 9; «Готово, когда», 4).
- Без него: Ticket-ы 08 и 09 не знали бы, какой Card «Prototype: …» на Canvas — их образец.
- Требование: [Что делаем, 9](../issues/02-прототип-экранов-integrations.md#что-делаем)
- Риски и пробелы test-ов: Card создан tool-ом `create_card` и связан с Epic-ом tool-ом `link_card`; оба ответили без
  ошибки. Открыт ли он в запущенном worfy, не проверено: снимки сделаны headless Chrome по `file://`, вне приложения.

## 3. Какие состояния нужны каким Ticket-ам

Code: `.scratch/worfy-integrations/issues/02-прототип-экранов-integrations.md:100-102` · key lines: 100, 101

```markdown
- Для брифов: Ticket 08 — `list`, `details`, `menu`, `filter`, `filter-noro`, `choose`, `connector-off`, `empty`,
  `add`, `form`, `form-token`, `form-dup`, `custom-http`, `custom-stdio`, `machine`, `remove`; Ticket 09 — `signin`,
  `signin-site`, `signin-browser`, `signin-failed`, `checking`, `chip` и строка Sign-in needed в `list`.
```

- Что делает: делит 22 состояния Card-а между Ticket-ами по их заголовкам: 08 — раздел в Project settings, Add
  integration, фильтр tools и Settings → Integrations; 09 — Sign in на экране и в chip-е, Health check.
- Почему здесь: пункт 9 «Что делаем» просит снимки «для брифов Ticket-ов 08 и 09»; по какому принципу их делить, не
  записано.
- Без него: brief каждого Ticket-а пришлось бы собирать по всему списку состояний заново.
- Требование: [Что делаем, 9](../issues/02-прототип-экранов-integrations.md#что-делаем)
- Риски и пробелы test-ов: деление — моё прочтение заголовков Ticket-ов 08 и 09; Orchestrator может переставить
  состояния при составлении brief-ов.

## 4. Slack: каталог без него, строка connector-а — с ним

Code: `.scratch/worfy-integrations/issues/02-прототип-экранов-integrations.md:108-111` · key lines: 108, 110

```markdown
- Slack: в каталоге (`CATALOG`) его нет. Слово встречается один раз — строка connector-а «claude.ai Slack» в группе
  «From Claude Code»: так велят spec («Решения по реализации» → Slack: connector «виден в группе From Claude Code») и
  brief Orchestrator-а. Поэтому `grep -ic slack <card>/index.html` даёт 1, а не 0; проверка «Готово, когда», 3, по
  букве не проходит, по смыслу (каталог без Slack) проходит.
```

- Что делает: записывает расхождение между проверкой Ticket-а и spec-ом: каталог Add integration без Slack, а строка
  connector-а claude.ai Slack в группе «From Claude Code» есть.
- Почему здесь: spec («Решения по реализации», Slack) оставляет Slack за connector-ом claude.ai, который «виден в группе
  From Claude Code»; brief Orchestrator-а просит показать эту строку. Проверка Ticket-а `grep -ic slack` — 0 этого не
  учитывает.
- Без него: reviewer увидел бы `grep -ic slack` = 1 и счёл бы пункт 3 «Готово, когда» нарушенным без объяснения.
- Требование: [Готово, когда, 3](../issues/02-прототип-экранов-integrations.md#готово-когда)
- Риски и пробелы test-ов: решение «показать строку connector-а» — за brief-ом; если владелец хочет буквальный 0, строку
  надо убрать из Card-а.

## 5. Что сознательно не меняли

- Файлы репозитория, кроме Ticket-а и этой story, не менялись: «Где в коде» Ticket-а говорит, что кода нет.
- Снимки лежат в scratchpad, не в `.scratch/worfy-integrations/evidence/`: так велит пункт 9 «Что делаем».
- Пункты 1, 3 и 4 «Готово, когда» не отмечены строками Evidence: Card на Canvas внутри worfy не открывался, `grep -ic
  slack` даёт 1, brief-ы Ticket-ов 08 и 09 пишет Orchestrator.

## 6. Как проверено

- `zsh -f shoot.zsh` (headless Chrome, 1300 × 880, `file://`) — exit 0, 22 состояния в светлой и тёмной теме, 44 PNG.
- `zsh -f smoke.zsh` — скрипт в копии Card-а прошёл все состояния в обеих темах и нажал каждую кнопку с `data-act`:
  `SMOKE states=22 clicks=1372 errors=0`.
- `grep -inE "canvasforai|idsad|src/main|src/renderer" <card>/index.html` — exit 1, ничего не найдено.
- `pnpm lint && pnpm typecheck && pnpm test` и gate fast — exit codes в отчёте implementer-а.

## Проверить себя

1. Почему проверка `grep -ic slack` даёт 1, и какой пункт spec-а это оправдывает?
   - Ответ: строка connector-а «claude.ai Slack» стоит в группе «From Claude Code», потому что spec оставляет Slack за
     connector-ом claude.ai и показывает его там; в каталоге Add integration Slack нет.
   - Строки: `.scratch/worfy-integrations/issues/02-прототип-экранов-integrations.md:108-111`
2. Каким Ticket-ам нужны состояния окна входа, и почему не Ticket-у 08?
   - Ответ: Ticket-у 09 — он ставит Sign in на экран и в chip; Ticket 08 строит раздел, Add integration и фильтр.
   - Строки: `.scratch/worfy-integrations/issues/02-прототип-экранов-integrations.md:100-102`
