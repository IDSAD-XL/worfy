# 02 — Прототип-Card UI Assistant-а в стиле worfy

Type: prototype
Status: open
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

- [ ] Card открывается на Canvas Project-а worfy и показывает: раздел Assistant-а в rail рядом с Canvas; список «что
      ждёт»; предложения с Dismiss, Snooze, Open и Prepare; like и dislike; журнал; сводку; разговор; знакомство; раздел
      Settings; карточку «было → станет» с Apply; строку расхода.
- [ ] Card показывает карточку-уведомление Assistant-а у его значка в rail (левый край окна) со значком и цветом
      Assistant-а, like и dislike, Open, Prepare, Snooze; одна карточка за раз, остальное — число на значке.
- [ ] Цвета — tokens темы worfy; Card снят в светлой и тёмной теме.
- [ ] Данные выдуманы: в Card-е нет имён рабочих Project-ов, людей и адресов.
- [ ] Тексты UI на Card-е — английские.
- [ ] В «Итог» — id Card-а; Ticket 14 ссылается на него.
- [ ] (вручную) Владелец посмотрел Card и принял его (или назвал доработки).
  - needs: mac
