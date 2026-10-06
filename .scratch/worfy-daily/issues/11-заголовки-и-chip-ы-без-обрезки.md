# 11 — Заголовки и chip-ы без обрезки

Type: task
Status: open
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
- [ ] Снимки в светлой и тёмной теме сверены с F-SPEC. Не проверено: снимки сняты (Playwright, обе
  темы, ссылки в «Итог»), но сверку глазами с F-SPEC и макетами делает владелец — GUI-проверки в
  этой волне не у исполнителя.

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
- Расширение следа (разрешил оркестратор): `test/unit/epic-canvas.test.tsx` — число фикстуры
  после новой высоты Ticket-а и test на ширину рамки Epic без Tickets;
  `src/renderer/canvas/sources/epics.ts` — имя Epic передаётся в `layoutEpic`.

## Итог

PR #64, ветка `worfy-daily/11`.

**Обрезания до правки** (built app, Project-ы Auction и worfy, временный `WORFY_DATA_DIR`, обе
темы; снимки [до, Auction, светлая](../evidence/11-before-auction-light.png),
[до, Auction, тёмная](../evidence/11-before-auction-dark.png),
[до, worfy, светлая](../evidence/11-before-worfy-light.png),
[до, worfy, тёмная](../evidence/11-before-worfy-dark.png)):

- заголовок Ticket-а сжат до 21 px — одна строка без многоточия и без tooltip: 27 Ticket-ов на
  Auction, 13 на worfy. Причина: у Ticket-а 104 px, а строки top, title, blockers и badges с actions
  вместе выше; grid из `actions.css` ужимает title (у блока с `overflow: hidden` минимум 0);
- заголовок рамки — одна строка с многоточием, без tooltip: 38 рамок на Auction, 1 на worfy. У рамки
  520 px с «Run wave» и «Autopilot» на заголовок оставалось 67–85 px («audit-20…»);
- имя Epic в sidebar обрезано многоточием: 22 из 42 на Auction;
- список стопки done обрезан посреди строки, без tooltip (стопка «90 done» на Auction); сама подпись
  «N done» не резалась;
- строка blockers («blocked by 06, 07, 08, 09, 10, 30 · done») и причина blocked — многоточие;
  полного текста blockers не было нигде;
- chip-ы checks: при gate, PR и CI в одной строке с «Ship ticket» / «Open PR» CI уходил за край
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
- Chip CI не сжимается (`flex: none`); остальные элементы строки checks сжимаются и режутся по своему
  краю, полный список — в tooltip строки, как раньше.
- Строка blockers, причина blocked и «Needs attention» — полный текст в tooltip.
- Заголовок рамки — до двух строк в 56 px заголовка, полный текст в tooltip. Рамка не уже, чем нужно
  для имени Epic целиком: `headerWidth` = 470 px на остальные части заголовка + 11 px на символ имени
  (моноширинный 18 px). Имя Epic `layoutEpic` получает из `sources/epics.ts` и для Epic без Tickets.
  По ADR-0032 ширина рамки входит в поиск колонки: широкая рамка может сдвинуть колонку правее.
- Стопка done: подпись «N done» не сжимается, список — до 4 строк с многоточием, полный — в tooltip.
- Sidebar: строка Epic в две строки, как в макетах F (`F-canvas-*.dc.html`): имя целиком (перенос
  в любом месте), под ним progress, счёт и «N in work».

**Решено без владельца, подтвердить:** предел заголовка Ticket-а — 3 строки, Ticket 160 px. F-SPEC
предела не задаёт, в макетах Ticket-ы 92–148 px. Альтернатива — 4 строки и 176 px: на Auction из 27
длинных заголовков целиком читались бы 14 вместо 6, но рамки стали бы ещё выше. Цена выбранного:
рамки и готовая Wave выше в 1,5 раза, у Ticket-а с коротким заголовком внизу пустое место.

**После правки** ([после, Auction, светлая](../evidence/11-after-auction-light.png),
[после, Auction, тёмная](../evidence/11-after-auction-dark.png),
[после, worfy, светлая](../evidence/11-after-worfy-light.png),
[после, worfy, тёмная](../evidence/11-after-worfy-dark.png); фикстура с длинными названиями:
[светлая](../evidence/11-long-names-light.png), [тёмная](../evidence/11-long-names-dark.png)):
ни один заголовок Ticket-а не сжат; всё, что обрезано (заголовки длиннее 3 строк, длинные заголовки
рамок, длинные строки blockers), имеет полный текст в tooltip; имена Epic в sidebar — целиком.

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

- Что было. Скрипт съёмки исполнителя (`/tmp/worfy-wave7/impl-11/snap/real.spec.ts`, вне
  репозитория) запускал собранный worfy через `_electron.launch` напрямую, а не через `launchApp`.
  Не было ни `WORFY_AGENT=fake`, ни временного `WORFY_CLAUDE_HOME`. Project-ы — настоящие Auction
  и worfy. worfy поднял Orchestrator на настоящем Claude Code с настоящим `~/.claude`.
- Когда. Три запуска: 19:46–19:48, 20:20–20:21, 20:27–20:28.
- Что появилось в `~/.claude` в эти окна: `session-env/` — каталоги c0422bc3…, 328599b9…,
  dff51fcf…, 540246c9…, 99715ca2…, caf63d82…; `backups/.claude.json.backup.1791305249216`,
  `…1791307233878`, `…1791307624425`; `worktree-sessions/Users-alexey-Work-Auction-7de8b409.json`.
  В эти же минуты в `~/.claude` писали и другие сессии, поэтому авторство каждого файла не
  доказано. Транскриптов Auction в `~/.claude/projects` за эти окна нет.
- Почему. Исполнитель проверил, что worfy по ADR-0005 сам не пишет в `~/.claude`. Но он не учёл,
  что Orchestrator запускает настоящий Claude Code, а тот пишет. Брифом это было запрещено.
- Что сделано. В `~/.claude` ничего не убиралось — что убрать, решает владелец. Снимки пересняты
  через `launchApp` (fake-агент, временные `WORFY_DATA_DIR` и `WORFY_CLAUDE_HOME`) на фикстурах,
  повторяющих форму Auction и worfy. Скрипт проверяет, что временный home после запуска не
  изменился.

**Не проверено:** сверка снимков с F-SPEC глазами (пункт выше).

