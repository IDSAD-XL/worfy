# 02 — Прототип-Card UI Assistant-а в стиле worfy

Type: prototype
Status: done 2026-11-25T20:05Z
Blocked by: —
Source: [spec.md](../spec.md), «Ticket-ы», строка 02; «Решения владельца», 17 и 18; «Решения по реализации» → «UI»;
«Волны», Wave 1

Кто: агент, затем владелец.

## Что строить

Card с HTML на выдуманных данных — образец экрана Assistant-а для Ticket-а 14, как у Ticket-ов 01 Epic-ов
worfy-pr-review и worfy-changes-view. Владелец смотрит Card и принимает; только потом идут Ticket-ы UI.

На Card-е:

- раздел Assistant-а в rail рядом с Canvas (вариант A прототипа темы);
- что показывает раздел: список «что ждёт»; предложения с Dismiss, Snooze, Open и Prepare; like и dislike; журнал;
  сводку; разговор; знакомство; раздел Settings; карточки «было → станет» с Apply; строку расхода;
- свои уведомления Assistant-а: карточка-реплика у значка Assistant-а в rail, у левого края окна; значок и свой цвет
  Assistant-а, like и dislike, кнопки Open, Prepare, Snooze; на экране одна карточка за раз, остальное — число на значке
  Assistant-а.

## Где в коде

Кода в репозитории нет: Card лежит в папке данных Project-а (`docs/features/cards.md`), создаётся tool-ом
`create_card` сервера worfy-canvas (`src/main/mcp/canvas-server.ts`).

- Tokens темы worfy — `src/renderer/theme/tokens.css`.
- Прототип темы, который надо превзойти, — `docs/product/proactive-runtime/prototype-агент-worfy.html` (вариант A).
- Тексты UI — `docs/design/BRIEF.md` (UI copy is English), ADR-0017.

## Решения

- Размещение — вариант A: раздел в rail рядом с Canvas (решение 17; spec, «UI»).
- Уведомления Assistant-а отличаются от обычных уведомлений worfy и стоят в другом месте. Обычные — toast у правого края
  окна, до трёх сразу (решение 17; spec, «UI»).
- Дизайн — в стиле worfy, красивее и интереснее прототипа темы; tokens темы worfy, обе темы, выдуманные данные
  (решение 18; spec, «UI»).
- Тексты UI — на английском (spec, «UI»).

## Test-ы

Кода нет. Card проверяется снимками обеих тем и взглядом владельца.

## Готово, когда

- [x] Card открывается на Canvas Project-а worfy и показывает: раздел Assistant-а в rail рядом с Canvas; список «что
      ждёт»; предложения с Dismiss, Snooze, Open и Prepare; like и dislike; журнал; сводку; разговор; знакомство; раздел
      Settings; карточку «было → станет» с Apply; строку расхода.
  - evidence: review pass · 2026-11-25: Orchestrator read Card card-2f66a896 (app.js): rail section, waits list, Dismiss/Snooze/Open/Prepare, like/dislike, Journal, Summary, chat, intro, Settings, before/after card with Apply, usage line; owner looked and accepted · - - · 91dfbf2f2e29fab987e7e9330bce6b84f4f0d29a
- [x] Card показывает карточку-уведомление Assistant-а у его значка в rail (левый край окна) со значком и цветом
      Assistant-а, like и dislike, Open, Prepare, Snooze; одна карточка за раз, остальное — число на значке.
  - evidence: review pass · 2026-11-25: notification card at the rail icon with like/dislike, Open, Prepare, Snooze, one at a time with a count (dark-notify.png, light-notify.png); owner looked and accepted · - - · 91dfbf2f2e29fab987e7e9330bce6b84f4f0d29a
- [x] Цвета — tokens темы worfy; Card снят в светлой и тёмной теме.
  - evidence: screenshot pass · 2026-11-25: 13 views shot in light and dark theme (26 PNG: waits, notify, prepare, snooze, ratings, journal, summary, chat, intro, settings, change, usage, duties); colours copied from src/renderer/theme/tokens.css (58 CSS variables) · mac stable · 91dfbf2f2e29fab987e7e9330bce6b84f4f0d29a
- [x] Данные выдуманы: в Card-е нет имён рабочих Project-ов, людей и адресов.
  - evidence: review pass · 2026-11-25: Card data invented: no working Project, person or address names (Orchestrator read app.js) · - - · 91dfbf2f2e29fab987e7e9330bce6b84f4f0d29a
- [x] Тексты UI на Card-е — английские.
  - evidence: review pass · 2026-11-25: UI texts English: 0 Cyrillic characters in app.js and index.html · - - · 91dfbf2f2e29fab987e7e9330bce6b84f4f0d29a
- [x] В «Итог» — id Card-а; Ticket 14 ссылается на него.
  - evidence: review pass · 2026-11-25: Card id card-2f66a896 in the result section; ticket 14 points to it (its lines 11-12 and 40) · - - · 91dfbf2f2e29fab987e7e9330bce6b84f4f0d29a
- [x] (вручную) Владелец посмотрел Card и принял его (или назвал доработки).
  - needs: mac
  - evidence: owner-check pass · 2026-11-25: огонь, всё верно, принимаем · mac stable · 91dfbf2f2e29fab987e7e9330bce6b84f4f0d29a

## Итог

- Card: `card-2f66a896` на Canvas Project-а worfy («Assistant — прототип UI», 1280×820): `index.html`, `app.js`,
  `style.css` в папке Card-ов Project-а. Ticket 14 строит UI по нему.
- 2026-11-25 владелец посмотрел Card: «огонь, всё верно, принимаем». Доработок нет.
