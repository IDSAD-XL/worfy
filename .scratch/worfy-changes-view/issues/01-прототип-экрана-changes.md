# 01 — Прототип экрана Changes: Card с HTML на выдуманных данных

Type: prototype
Status: open
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
- [ ] Данные выдуманы: в Card-е нет путей, имён и кода настоящих репозиториев, кроме worfy.
- [ ] В «Итог» — id Card-а; Ticket 03 ссылается на него в брифе.

## Где в коде

Кода нет: Card лежит в папке данных Project-а (`docs/features/cards.md`), файлов репозитория Ticket не меняет.

## Вне скоупа

- Mark seen, Viewed, Last turn, PR и chip со счётчиком — часть 2. Взгляд владельца Ticket 03 не ждёт (spec, «Решено без
  владельца», 4).
