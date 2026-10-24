# 71 — epic-status теряет заголовок Ticket-а, если шапка стоит перед `# заголовком`

Type: bug
Status: claimed 2026-10-24T21:56Z
Branch: worfy-harness/71
Blocked by: —
Source: владелец, 2026-10-25 (чат Mac-оркестратора); замер файлов — Session на Windows-ПК, 2026-10-25

## Что происходит

- Владелец, Windows-ПК, Stable worfy. Его Project `stolyar` (`F:\SWE\basiz-stolyar\stolyar`), рамка Epic-а
  `edge-bands — Эпик «Кромки»`. Карточки Ticket-ов на Canvas показывают номер, статус «Queued»,
  «1/7 · agent», блокеры — но не заголовок. Тот же Ticket в focus mode (Ticket во весь экран) заголовок
  показывает.
- Замер на ПК: в Epic-ах `edge-bands` (21 Ticket), `foundation` (14) и `grooves` (15) каждый файл начинается
  с шапки (`Type`, `Status`, `Branch`, `Blocked by`, `Source`), потом пустая строка, и `# заголовок` — на
  строке 7. BOM (byte order mark, три байта `EF BB BF` в начале файла) — ни в одном из 21 файла
  `edge-bands`. Концы строк CRLF.
- `~/.claude/worfy-harness/plugin/bin/epic-status --json edge-bands` (копия plugin-а от 23 октября) даёт
  `"title":""` для 21 из 21, 14 из 14 и 15 из 15 Ticket-ов.
- Причина: `epic-status` (скрипт Harness, единственный reader файлов Ticket-ов — из него берут данные карточки
  Canvas и `epic-board`) берёт заголовок только из строки 0: `if (n === 0 && l.startsWith("#"))`
  (`harness/bin/epic-status:243`). Заголовок на строке 7 он не видит.
- Ticket-ы самой worfy пишут `# заголовок` на строке 0 — поэтому на Mac всё выглядело нормально. Баг не про
  Windows: любой Project с шапкой над заголовком теряет заголовки на всех машинах.
- Почему focus mode показывает заголовок: он рисует весь файл Ticket-а как markdown (`readFile` в
  `src/main/ipc/tickets.ts:52` → `<Markdown>` в `src/renderer/canvas/nodes/TicketBody.tsx:16`), и H1 на любой
  строке становится заголовком. Тем же правилом — H1 на любой строке — worfy читает заголовок Epic-а из
  `spec.md`: `firstHeading` (`src/main/workflow/reader.ts:218-219`, regex `/^#[ \t]+(.+?)\s*$/mu`).
- Карточка: `ticketTitle` (`src/renderer/canvas/epic-layout.ts:681`) убирает номер в начале заголовка и
  возвращает `stripped || ticket.title`. Запасного варианта для пустого заголовка нет — карточка без текста
  (`src/renderer/canvas/nodes/TicketNode.tsx:110`, `:171`).
- Другие места Harness, которые читают строку 0, проверены. `harness/bin/ticket:472` смотрит на `lines[0]`,
  только чтобы вставить строку Status после заголовка в файле без полей шапки; заголовок он не читает, а у
  файла с шапкой туда не доходит. `epic-board` и skill `epic-wave` берут заголовок из `epic-status`.

## Что сделать

1. **`epic-status`: заголовок — первый H1 (`# ` в начале строки) на любой строке**, вне блоков кода (```` ``` ````
   и `~~~`, их `parse()` уже отслеживает). Правило то же, что у `firstHeading` в `reader.ts`: один
   контракт, записанный в `harness/bin/TICKETS.md` («Header» — шапка может стоять до или после H1).
2. **Общий test case**, чтобы два reader-а не разошлись: один и тот же текст Ticket-а (шапка, пустая строка,
   `# заголовок`, CRLF) проверяется и в `harness/bin/tests/epic-status.test.sh`, и unit test-ом
   `firstHeading`. Например, файл в `test/fixtures/`, который читают оба test-а.
3. **Fixture в `epic-status.test.sh`**: `07-header-first.md` — шапка (`Type`, `Status`, `Branch`,
   `Blocked by`, `Source`), пустая строка, `# 07 — Header first`, концы строк CRLF. Обновить ожидаемый JSON
   `want=` (`:151`) и список заголовков (`:172`). Fixture `03-crlf.md` (`:64`, заголовок на строке 0)
   остаётся.
4. **Запасной заголовок на карточке.** `ticketTitle` при пустом заголовке возвращает slug файла (часть имени
   после номера, `07-rate-limit-bids.md` → `rate-limit-bids`). Unit test.
5. **BOM — по желанию, как дешёвая защита, не как исправление.** Если BOM в начале файла (при чтении latin1 —
   символы `\xEF\xBB\xBF`, `harness/bin/epic-status:36`, `:138`), убрать его до разбора. У владельца BOM нет.
6. **Low, наблюдение.** `epic-status` принимает `--json` только до имени Epic-а: `epic-status --json edge-bands`
   даёт JSON, `epic-status edge-bands --json` — текстовую строку. Так задумано (комментарий
   `harness/bin/epic-status:421`, «as before»), но путает. Исправить, только если это мелочь (принять `--json`
   и после имени); иначе оставить запись в «Итог».

## Готово, когда

- [ ] `epic-status --json` даёт заголовок для Ticket-а с шапкой над `# заголовком` — test с fixture-ом
      `07-header-first.md` зелёный; mutant (вернуть `n === 0`) — красный.
- [ ] Общий test case зелёный и для `epic-status`, и для `firstHeading`; mutant в любом из двух reader-ов
      красный.
- [ ] Карточка Ticket-а с пустым заголовком показывает slug — unit test зелёный, mutant красный.
- [ ] Правило про место H1 записано в `harness/bin/TICKETS.md`.
- [ ] Платформенный PR (ADR-0056, пункт 2 — PR со скриптом Harness ждёт вердикта Windows): Mac gate зелёный и
      вердикт Windows на ПК.
- [ ] После выпуска plugin-а — у владельца на ПК карточки `edge-bands`, `foundation`, `grooves` с заголовками.

## Где в коде

- `harness/bin/epic-status:240-243` — `parse()`, заголовок из строки 0; `:36`, `:138` — чтение latin1;
  `:404-428` — разбор аргументов.
- `harness/bin/tests/epic-status.test.sh:64` — fixture CRLF; `:151` — `want=`; `:172` — список заголовков.
- `src/main/workflow/reader.ts:218-219` — `firstHeading`.
- `src/renderer/canvas/epic-layout.ts:681` — `ticketTitle`; `src/renderer/canvas/nodes/TicketNode.tsx:110`, `:171`.
- `src/main/ipc/tickets.ts:52`, `src/renderer/canvas/nodes/TicketBody.tsx:16` — файл Ticket-а в focus mode.
- `harness/bin/TICKETS.md` — «Header».

## Итог

Ветка `worfy-harness/71`, PR — в отчёте implementer-а (номер допишет Orchestrator при `ticket done`).

- **`epic-status`** (`harness/bin/epic-status`, `parse()`): заголовок — первый H1 на любой строке вне
  блоков ```` ``` ```` и `~~~`: `#`, пробел или tab, текст; хвостовые пробелы и tab-ы отрезаются. Регулярка
  `/^#[ \t]+([^ \t].*?)[ \t]*$/`, без `\s`: в строке latin1 `\s` ловит байт `0xA0`, которым кончается
  UTF-8 буква «Р» (`D0 A0`), и оставил бы полбуквы — на это есть случай `10-cyrillic.md`. BOM в начале файла
  отбрасывается до разбора (пункт 5, дешёвая защита).
- **`firstHeading`** (`src/main/workflow/reader.ts`) переписан на то же правило: построчно, `\r?\n`, блоки кода
  пропускаются, BOM отбрасывается, `[ \t]` вместо `\s`. Раньше он брал `# ` и внутри блока кода.
- **Общий test case**: `harness/bin/tests/fixtures/ticket-title/07-header-first.md` (шапка `Type`, `Status`,
  `Branch`, `Blocked by`, `Source`, пустая строка, `# 07 — Header first`) и `08-fence-first.md` (`# ` внутри
  ```` ``` ```` и `~~~`, строка `#not-a-heading`, второй H1 ниже первого). Файлы лежат в LF (`harness/**` в
  `.gitattributes` — `eol=lf`); `epic-status.test.sh` пишет их в fixture с CRLF через `awk`,
  `test/unit/first-heading.test.ts` проверяет и LF, и CRLF и сверяет список файлов папки со своим списком — новый
  случай не останется непрочитанным одним из reader-ов.
- **`epic-status.test.sh`**: в Epic `last` добавлены 07, 08 (из общей папки, CRLF), `09-bom.md`, `10-cyrillic.md`;
  `want=` пересобран, и проверено скриптом, что он отличается от прежнего только четырьмя новыми Ticket-ами.
  Списки `statusRaw`, `state`, `title` и строка «Этап» `last 0/10` обновлены. 47 проверок, exit 0 с пустым HOME.
- **Карточка**: `ticketTitle` (`src/renderer/canvas/epic-layout.ts`) при пустом заголовке (или из одних пробелов)
  отдаёт slug. `LayoutTicket` теперь несёт `slug`: высота карточки (`cardHeights`) считается от того же текста,
  что карточка рисует. Unit test — `test/unit/epic-layout.test.ts`.
- **Правило** записано в `harness/bin/TICKETS.md`, «Header»: шапка до или после H1, что считается H1, BOM, slug
  на карточке, общий fixture.
- **Mutation testing** (копии `harness/` во временных папках; TS-файлы — копия и восстановление из копии):
  7 mutant-ов `epic-status` (правило строки 0 `n === 0`, без BOM, последний H1, `#word`, `\s` вместо `[ \t]`, без
  обрезки хвоста, H1 внутри блока кода) — все красные; 7 mutant-ов `firstHeading` и 2 `ticketTitle` — все красные.
- **На настоящих данных**: `epic-status --json` из `origin/main` и новой версии по `.scratch` worfy — 493 Ticket-а,
  0 различий; `firstHeading` старый и новый по 17 `spec.md` — 0 различий.
- **Пункт 6 (`--json` после имени Epic-а) не сделан**: `epic-status.test.sh` прямо проверяет, что
  `epic-status fin --json` печатает строку «Этап» (case «--json after the epic name prints the line»), это
  записанный контракт характеризующего test-а. Менять его — отдельное решение, не мелочь.
- **Открыто**: вердикт Windows на ПК (PR платформенный — скрипт Harness, ADR-0056 пункт 2); проверка у владельца
  после выпуска plugin-а — карточки `edge-bands`, `foundation`, `grooves` с заголовками.
