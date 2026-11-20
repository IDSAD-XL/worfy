# 01 — Прототип: поиск, Start review с выбором Review myself или Agent review, Review mode, диалог Submit и chip одобрений

Type: prototype
Status: open
Blocked by: —
Source: [spec.md](../spec.md), «Ticket-ы», 1; «Решение» (пункты 1–6, «Как пользователь идёт по экрану», «Экран»);
«Вопросы владельцу», Q5, Q6 и требование владельца 2026-11-20

Кто: агент.

Не платформенный Ticket (Card, кода нет). Глубина ревью — `low`.

## Что происходит

- Поиска и ревью чужого PR в worfy нет; набросок экрана — ASCII в spec-е («Решение» → «Экран»). Ticket-ы 03, 05, 09, 10
  и 11 строят экран, и им нужен образец вида, а не только схема.
- Экран Changes строили по прототипу-Card-у (`.scratch/worfy-changes-view/issues/01-прототип-экрана-changes.md`). Card —
  HTML-файл в папке данных Project-а, его показывает Node Card (`docs/features/cards.md`).
- Требование владельца 2026-11-20: выбор, кто пишет ревью — Review myself или Agent review. Прототип показывает оба
  пути.
- Тексты UI английские: «UI copy is ENGLISH» (`docs/design/BRIEF.md:4`; ADR-0017).

## Что делаем

1. Card «Prototype: PR search and review» на Canvas Project-а worfy через Card API или tool `create_card` сервера
   worfy-canvas. Данные выдуманы: владелец `acme`, репозитории `web` и `api`, login-ы `alice`, `bob`, `carol`.
2. Вкладка Pull requests с полем поиска: меню области (This Project, организации Project-а, All of GitHub), chip-ы
   фильтров, «☆ Save», список «Search · 7 results» со chip-ом одобрений и chip-ом `Review draft` в строках.
3. Панель PR: полоса «Review this pull request», кнопка Start review ▾ с меню Review myself и Agent review, ячейка
   Approvals со списком reviewer-ов (approved, changes requested, requested, stale, «does not count»).
4. Review mode: свёрнутый список, шапка, дерево с Viewed, diff, Pending-комментарий человека, комментарий агента с
   пометкой «Written by the agent», нить GitHub, список «Not on a changed line»; полоса «Agent is writing the review… ·
   Stop», полоса «Your review» с Ask the agent to add comments или Take over, Discard, Finish review.
5. Диалог Finish review: Summary, Comment / Approve / Request changes (начинается с Comment), строка «The agent suggests:
   Request changes», список комментариев с пометкой «by the agent» и Remove, строка lint-а, полоса «Your comments are on
   3f2a9c1; the head is 7d0e4b2».
6. Все состояния chip-а: `0/2`, `1/2`, `✓ 2/2`, `1/?`, changes requested, waiting for code owners — и он же на карточке
   доски Pipeline (`Waits: team · 1/2 approvals`) и на карточке Ticket-а на Canvas (Q5 (а)).
7. Кнопки на Card-е переключают состояния; логики GitHub нет. Цвета — tokens темы worfy (`--ready-*`, `--blocked-*`),
   обе темы.
8. В «Итог»: id Card-а и снимки экрана для брифов Ticket-ов 03, 05, 09, 10, 11 (снимки — в scratchpad, в репозиторий не
   кладутся).

## Готово, когда

- [ ] Card «Prototype: PR search and review» открывается на Canvas Project-а и показывает все состояния из «Что
      делаем», 2–6, в светлой и тёмной теме; в консоли Card-а нет ошибок.
- [ ] Данные выдуманы: `grep -inE "canvasforai|idsad|src/main|src/renderer|https?://" <card>/index.html` не
      находит настоящих путей, имён и адресов.
- [ ] В «Итог» — id Card-а; брифы Ticket-ов 03, 05, 09, 10 и 11 ссылаются на него.

## Где в коде

Кода нет: Card лежит в папке данных Project-а (`docs/features/cards.md`), файлов репозитория Ticket не меняет.

Только читать: `docs/design/BRIEF.md`, `src/renderer/theme/tokens.css`, `src/renderer/pr-inbox/PrInboxView.tsx` (как
выглядит вид сейчас).

## Вне скоупа

- Код вида и main — Ticket-ы 02–11. Логика Agent review — Ticket 08.
