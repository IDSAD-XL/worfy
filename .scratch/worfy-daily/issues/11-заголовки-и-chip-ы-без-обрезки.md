# 11 — Заголовки и chip-ы без обрезки

Type: task
Status: done — 2026-10-06, [PR #64](https://github.com/IDSAD-XL/worfy/pull/64)
Blocked by: 10, 30
Source: [spec.md](../spec.md), тема C; [F-SPEC.md](../../../docs/design/F-SPEC.md), макеты `docs/design/F-canvas-*.dc.html`; Ticket-ы 11 и 17 worfy-mvp

## Что делаем

**Что обрезается сейчас:**

- **Заголовок Ticket-а** — `-webkit-line-clamp: 2` в `src/renderer/canvas/epic-frame.css:250-258`.
  Строка meta — `nowrap` и ellipsis (`:259-266`).
- **Заголовок рамки** — `.w-epic__title`, `nowrap` и ellipsis (`:55-64`).
- **Стопка «33 done»** — `src/renderer/canvas/nodes/EpicFrameNode.tsx:97-107`. Её размер
  `TICKET_WIDTH × DONE_STACK_HEIGHT` задан в `layoutEpic` (`epic-layout.ts:190`).
- **Имя Epic в sidebar** («audi…») — `src/renderer/shell/sidebar/EpicsSection.tsx:33` и `:64-66`.
  Там показано только `epic.epic` с ellipsis, полное имя — лишь в атрибуте `title`.
- **Chip CI** — `src/renderer/canvas/badges/ChecksBadges.tsx:57`. В `checks-badges.css:4-26`
  обрезка заложена намеренно, а полный список — в tooltip.

Размеры: `TICKET_HEIGHT = 104`, `TICKET_WIDTH = 204`, `DONE_STACK_HEIGHT = 120`
(`src/renderer/canvas/epic-layout.ts:12-21`).

**Первый шаг — воспроизвести.** Снять снимки на Auction и на worfy, в светлой и тёмной теме.
Записать, какие заголовки и chip-ы обрезаны и где. Сверить с F-SPEC и макетами. Список и снимки
идут в «Итог».

**Правки:**

- **Заголовок Ticket-а** читается целиком или до предела из F-SPEC, а полный текст есть в tooltip.
  Если меняются `TICKET_HEIGHT` или `TICKET_WIDTH`, сдвигается геометрия рамок и готовой Wave.
  Offset-ы относительно авто-места сохраняются, но вид меняется. Числа в `epic-layout.test.ts`
  нужно обновить.
- **Стопка done** — число и подпись не обрезаны.
- **Sidebar** — имя Epic читается целиком: перенос строки или ширина — по F-SPEC.
- **Chip CI** виден на Ticket-е шириной 204 px, даже если рядом PR и Gate. Остальные chip-ы можно
  обрезать, как задумано, а CI — нельзя.

**Что известно из ручных проверок 2026-10-06, ночь** (номера Ticket-ов — `worfy-mvp`):

- на Auction заголовок Ticket-а виден одной строкой без многоточия: высота `.w-ticket__title` 21 px
  при `scrollHeight` 34 (Ticket 10);
- подпись «as of» полос Limits в toolbar налезает на соседнюю и уходит под «v0.0.0» и поле поиска:
  ширина 104 px и `nowrap` (`src/renderer/limits/LimitBar.tsx:58` и `:67`, Ticket 22);
- длинное имя Project-а в toolbar не обрезается и выталкивает за край окна переключатель
  Canvas/Session, Limits и поиск (`src/renderer/shell/Toolbar.tsx:68`, `src/renderer/shell/shell.css:86-91`,
  Ticket 09).

Подпись «as of» и имя Project-а в toolbar правит Ticket 26, не этот.

## Готово, когда

- [x] В «Итог» — список обрезаний до правки, со снимками.
- [x] На фикстуре с длинными названиями (заголовок Ticket-а — 120 символов) у заголовка Ticket-а, заголовка рамки, стопки done и имени Epic в sidebar нет скрытого переполнения, или полный текст есть в `title`. e2e проверяет `scrollWidth ≤ clientWidth` и `scrollHeight ≤ clientHeight`.
- [x] Chip CI виден на Ticket-е при PR, Gate и CI сразу: e2e проверяет, что boundingBox chip-а CI внутри boundingBox Ticket-а.
- [ ] Снимки в светлой и тёмной теме сверены с F-SPEC.
  не прошло 2026-10-07: в тёмной теме стопка done плоская, а у выделенного Node-а и Ticket-а нет
  кольца акцента — подраздел [«Ручная проверка 2026-10-07»](#ручная-проверка-2026-10-07).

## Тесты

- `test/e2e/epic-frame.spec.ts` — переполнение заголовков на фикстуре с длинными названиями.
- `test/e2e/checks-badges.spec.ts` — chip CI внутри Ticket-а.
- `test/unit/epic-layout.test.ts` — числа геометрии, если меняются размеры.
- Сначала падающий test: e2e на заголовок Ticket-а длиной 120 символов находит скрытое переполнение.

## Где в коде

- `src/renderer/canvas/epic-layout.ts`
- `src/renderer/canvas/epic-frame.css`
- `src/renderer/canvas/nodes/EpicFrameNode.tsx`
- `src/renderer/canvas/nodes/TicketNode.tsx`
- `src/renderer/canvas/badges/ChecksBadges.tsx`
- `src/renderer/canvas/badges/checks-badges.css`
- `src/renderer/shell/sidebar/EpicsSection.tsx`
- `test/unit/epic-layout.test.ts`
- `test/e2e/epic-frame.spec.ts`
- `test/e2e/checks-badges.spec.ts`
- Расширение следа (разрешил Orchestrator): `test/unit/epic-canvas.test.tsx` — число фикстуры
  после новой высоты Ticket-а и test на ширину рамки Epic без Tickets;
  `src/renderer/canvas/sources/epics.ts` — имя Epic передаётся в `layoutEpic`.

## Итог

PR #64, ветка `worfy-daily/11`.

**Обрезания до правки.** Снимки сняты через `launchApp` из `test/e2e/helpers.ts`: fake-агент,
временные `WORFY_DATA_DIR` и `WORFY_CLAUDE_HOME`. Project-ы — две фикстуры той же формы, что
Auction и worfy: длинные имена Epic, Epic без Tickets, заголовок Ticket-а в 120 символов, стопка
из 90 done, длинные причины blocked и строки blockers. Сборка «до» — origin/main 0fbcde6. Скрипт
проверяет, что временный home после запуска не изменился, а в Project-е нет изменений. Снимки:
[до, Auction-фикстура, светлая](../evidence/11-before-auction-light.png),
[до, Auction-фикстура, тёмная](../evidence/11-before-auction-dark.png),
[до, worfy-фикстура, светлая](../evidence/11-before-worfy-light.png),
[до, worfy-фикстура, тёмная](../evidence/11-before-worfy-dark.png).

- Заголовок Ticket-а сжат до 21 px: одна строка без многоточия и без tooltip (11 Ticket-ов в
  каждой фикстуре). Причина: у Ticket-а 104 px, а строки top, title, blockers и badges с actions
  вместе выше. Grid из `actions.css` ужимает title, потому что у блока с `overflow: hidden` минимум 0.
- Заголовок рамки — одна строка с многоточием, без tooltip (3 рамки в Auction-фикстуре, 1 в
  worfy). У рамки 520 px с «Run wave» и «Autopilot» на заголовок оставалось 67–85 px («audit-20…»).
- Имя Epic в sidebar обрезано многоточием (4 из 4 в Auction-фикстуре).
- Список стопки done обрезан посреди строки, без tooltip (стопка «90 done»). Подпись «N done» не
  резалась.
- Строка blockers («blocked by 01, 02, 03, 05, …») и причина blocked обрезаны многоточием. Полного
  текста blockers не было нигде.
- Chip-ы checks: при gate, PR и CI в одной строке с «Ship ticket» / «Open PR» CI уходил за край
  (`checks-badges.spec.ts`: CI заканчивался на 4 px правее Ticket-а).

**Что сделано:**

- Ticket — 160 px вместо 104 (`TICKET_HEIGHT`, `src/renderer/canvas/epic-layout.ts`). Из чего число:
  рамка 2 + отступы 16 + номер и state 18 + заголовок 3 × 17 + строка blockers или причина 19 +
  badges 16 и actions 20 на двух строках (между ними 4) + 3 зазора по 4 = 158, округлено до 160.
  Заголовок — до 3 строк (`TICKET_TITLE_LINES`), дальше многоточие, полный текст — в tooltip
  заголовка. Ни одна строка Ticket-а не сжимается (`flex: none`).
- Badges и actions — в одной обёртке `.w-ticket__slots` с переносом: в одну строку, когда помещаются,
  иначе actions уходят на вторую. Правило «badges и actions в одной строке» из
  `src/renderer/canvas/actions/actions.css` больше не срабатывает (оно ждёт их прямыми детьми Ticket-а).
- В строке checks ссылка PR и chip CI всегда целиком (`flex: none`). Gate и вердикт сжимаются: у
  chip-а многоточие (`text-overflow: ellipsis`), полный текст — в его `title` (подробнее — ниже).
- Строка blockers, причина blocked и «Needs attention» — полный текст в tooltip.
- Заголовок рамки — до двух строк в 56 px заголовка, полный текст в tooltip. Рамка не уже, чем нужно
  для имени Epic целиком: `headerWidth` = 470 px на остальные части заголовка + 11 px на символ имени
  (моноширинный 18 px). Имя Epic `layoutEpic` получает из `sources/epics.ts` и для Epic без Tickets.
  По ADR-0032 ширина рамки входит в поиск колонки: широкая рамка может сдвинуть колонку правее.
- Стопка done: подпись «N done» не сжимается, список — до 4 строк с многоточием, полный — в tooltip.
- Sidebar: строка Epic в две строки, как в макетах F (`F-canvas-*.dc.html`): имя целиком (перенос
  в любом месте), под ним progress, счёт и «N in work».

**Решено без владельца, подтвердить:** предел заголовка Ticket-а — 3 строки, Ticket 160 px. F-SPEC
предела не задаёт, в макетах Ticket-ы 92–148 px. Альтернатива — 4 строки и 176 px: целиком читалось бы
больше длинных заголовков, но рамки стали бы ещё выше. Цена выбранного:
рамки и готовая Wave выше в 1,5 раза, у Ticket-а с коротким заголовком внизу пустое место.

**После правки** ([после, Auction-фикстура, светлая](../evidence/11-after-auction-light.png),
[после, Auction-фикстура, тёмная](../evidence/11-after-auction-dark.png),
[после, worfy-фикстура, светлая](../evidence/11-after-worfy-light.png),
[после, worfy-фикстура, тёмная](../evidence/11-after-worfy-dark.png); фикстура e2e с длинными
названиями: [светлая](../evidence/11-long-names-light.png), [тёмная](../evidence/11-long-names-dark.png)).
Ни один заголовок Ticket-а не сжат. У всего, что обрезано, полный текст в tooltip: заголовки длиннее
3 строк, длинные заголовки рамок, длинные строки blockers и причины. Имена Epic в sidebar целиком.

**Тесты:**

- `test/e2e/epic-frame.spec.ts`, «long names…» — заголовок Ticket-а в 120 символов, заголовок
  рамки, стопка из 33 done, имя Epic в sidebar, строка blockers и причина blocked, в обеих темах:
  `scrollWidth ≤ clientWidth` и `scrollHeight ≤ clientHeight` или полный текст в `title`; строки
  Ticket-а внутри его box. Красный до правки, красный на мутанте `TICKET_HEIGHT = 104`.
- `test/e2e/checks-badges.spec.ts` — у Ticket-ов 08 (claimed) и 10 (blocked, «Ship ticket» и
  «Open PR») gate, PR и CI сразу; box chip-а CI внутри Ticket-а и каждого обрезающего его блока, и
  сам chip не сужен. Красный до правки и на мутанте без `flex: none` у CI.
- `test/unit/epic-layout.test.ts` — ширина рамки под имя Epic (красный на мутанте без `headerWidth`);
  `test/unit/epic-canvas.test.tsx` — то же для Epic без Tickets (красный без передачи имени),
  число фикстуры запаса под открытую стопку done обновлено (красный на мутанте без `reserve`).

**Круг доработки (вердикт REJECTED в PR #64):**

- Ссылка PR в строке checks всегда целиком (`flex: none`), и CI тоже. Сжимаются gate, вердикт и
  «gh unavailable»: chip — блок с `text-overflow: ellipsis`, в его tooltip — подпись (у gate ещё
  путь worktree). Test: `checks-badges.spec.ts`, Ticket 10 с gate, PR #1234, CI и REJECTED;
  `scrollWidth ≤ clientWidth` у PR, у сжатого chip-а — многоточие и title.
- Мёртвое grid-правило «badges и actions в одной строке» и комментарий «104px» убраны из
  `src/renderer/canvas/actions/actions.css`.

**Нарушение запрета писать в `~/.claude`** (2026-10-06, при съёмке снимков «до» и «после»):

- Что было. Скрипт съёмки исполнителя (временный Playwright-файл вне
  репозитория) запускал собранный worfy через `_electron.launch` напрямую, а не через `launchApp`.
  Не было ни `WORFY_AGENT=fake`, ни временного `WORFY_CLAUDE_HOME`. Project-ы — настоящие Auction
  и worfy. worfy поднял Orchestrator на настоящем Claude Code с настоящим `~/.claude`.
- Когда. Три запуска: 19:46–19:48, 20:20–20:21, 20:27–20:28.
- Что появилось в `~/.claude` в эти окна: `session-env/` — каталоги c0422bc3…, 328599b9…,
  dff51fcf…, 540246c9…, 99715ca2…, caf63d82…; `backups/.claude.json.backup.1791305249216`,
  `…1791307233878`, `…1791307624425`; `worktree-sessions/Users-alexey-Work-Auction-7de8b409.json`.
  В эти же минуты в `~/.claude` писали и другие Session-ы Claude Code, поэтому авторство каждого файла не
  доказано. Транскриптов Auction в `~/.claude/projects` за эти окна нет.
- Почему. Исполнитель проверил, что worfy по ADR-0005 сам не пишет в `~/.claude`. Но он не учёл,
  что Orchestrator запускает настоящий Claude Code, а тот пишет. Брифом это было запрещено.
- Что сделано. В `~/.claude` ничего не убиралось — что убрать, решает владелец. Снимки пересняты
  через `launchApp` (fake-агент, временные `WORFY_DATA_DIR` и `WORFY_CLAUDE_HOME`) на фикстурах,
  повторяющих форму Auction и worfy. Скрипт проверяет, что временный home после запуска не
  изменился. Числа «до» в первой редакции итога были сняты на настоящих Project-ах с этим
  нарушением. Теперь они заменены числами с фикстур.

**Не прошло 2026-10-07:** сверка снимков с F-SPEC — подраздел [«Ручная проверка 2026-10-07»](#ручная-проверка-2026-10-07).


### Ручная проверка 2026-10-07

Проверял агент, ночь 2026-10-07 (проверка M7 второго круга ручных проверок). С F-SPEC и макетами
`docs/design/F-*.dc.html` сверены 10 снимков `../evidence/11-*.png` из main @ 6df9791 (все сняты на
1153f1d, PR #64). Цвета — по пикселям (PIL); как ведёт себя Chromium — через CDP Stable copy, только
чтение.

- Токены совпадают ±1 в обеих темах: sidebar, toolbar, canvas, surface, selected, primary, ready,
  working, blocked, done, progress, вторичный текст. 6 PNG сохранены в Display P3, их сверял после
  перевода ICC→sRGB. Sidebar в PNG полупрозрачный (alpha 0.80 и 0.82), поэтому в просмотрщике
  тёмный sidebar кажется серым. Это артефакт снимка: RGB равен токену.
- Заголовок Ticket-а — не больше 3 строк, дальше «…» (Ticket 40 из 120 символов, Ticket-ы 91,
  05–07, 17, 23). Скрытого переполнения нет. Обрезания на снимках «до» совпадают с «Итог».
- Chip-а CI нет ни на одном из 10 снимков: правило «chip CI внутри Ticket-а» здесь подтверждает только
  e2e `test/e2e/checks-badges.spec.ts`. На Stable copy chip CI виден целиком (проверка M19 той же
  ночи, «Итог» Ticket-а 01 `worfy-week`).
- **Не прошло.** Расхождение с Light/dark pairing rule и макетом
  `docs/design/F-canvas-dark.dc.html:205-207`: в тёмной теме стопка done плоская, в светлой — со
  второй карточкой. Причина — `src/renderer/canvas/epic-frame.css:170-173`: `box-shadow` — список
  `4px 4px 0 -1px var(--done-bg), 4px 4px 0 0 var(--border), var(--shadow-node)`, а в тёмной теме
  `--shadow-node: none` (`src/renderer/theme/tokens.css:117`). `none` внутри списка через запятую
  недопустим, и браузер отбрасывает весь `box-shadow`. В Chromium 152 `CSS.supports` даёт false, у
  живой стопки на Stable copy computed `box-shadow` — `none`. Причина появилась в a634fa2
  (2026-10-05), не в PR #64. Где видно: `11-long-names-dark.png` (297–504, 185–307),
  `11-after-auction-dark.png` (684–830, 312–397).
- **Та же причина у выделения.** `var(--shadow-node), 0 0 0 1px var(--accent)` —
  `src/renderer/canvas/canvas.css:22`, `src/renderer/canvas/node-chrome.css:37`,
  `src/renderer/canvas/epic-frame.css:243`. В тёмной теме у выделенного Node-а и Ticket-а пропадает
  кольцо акцента 1 px, остаётся только цвет рамки. Вывод по `CSS.supports`: на снимках Ticket-а 11
  выделения нет.
- Остальная разметка пар light/dark совпадает (сверено наложением краёв).
- Замечание: кнопка Trash (`src/renderer/canvas/overlays/TrashPopover.tsx`) висит поверх холста внизу
  по центру и на `11-after-auction-*.png` закрывает часть Ticket-а 05. Правила в F-SPEC об этом нет.
- Решение владельца, не проверка: предел заголовка 3 строки при Ticket-е 160 px (выше, «Решено без
  владельца, подтвердить»).
- Вердикт: не прошло. Пункт «Снимки … сверены с F-SPEC» остаётся `[ ]`, пока `box-shadow` в тёмной
  теме не исправлен.
- Улики (в scratchpad Session Orchestrator-а, в репозиторий не положены): `M7-stack-light-dark.png`,
  `M7-ticket40-light-dark.png`, `M7-trash-overlay.png`, `M7-pair-after-worfy.png`, таблица
  `M7-fspec-table.md`.

### Долги из HANDOFF (2026-10-08)

- [low] `test/e2e/checks-badges.spec.ts:264` — порог 12 px пропускает вердикт, сжатый до «значок + …».
- [low] `src/renderer/canvas/nodes/TicketNode.tsx:18-20` — литералы 204 и 160 дублируют `TICKET_WIDTH` и
  `TICKET_HEIGHT` (`src/renderer/canvas/epic-layout.ts:17`, `:29`).
