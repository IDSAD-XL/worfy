# 06 — Документы: перевод страниц Feature, термин Changes в CONTEXT.md

Type: task
Status: open
Blocked by: 02, 03, 04, 05
Source: [spec.md](../spec.md), «Ticket-ы», 6; «Решено без владельца», 10; «Готово, когда», пункт о документах

Кто: агент.

Не платформенный Ticket (документы). Глубина ревью — `low`.

## Что происходит

- Английские страницы Feature правят Ticket-ы своего поведения (ADR-0088 — страницы Feature на английском):
  `changes.md` (02, 03, 05), `workflow.md` и `app-shell.md` (03), `sessions.md` (04), строку таблицы `README.md` (02).
  Перевод в PR с поведением не считается, поэтому `docs/features/ru/` отстаёт.
- В `CONTEXT.md` нет термина Changes. Рядом — статьи Node (`CONTEXT.md:17`), Family (`:61`), Binding (`:290`).
- Новый ADR о чтении git пишет Ticket 02; поправки к ADR-0005 часть 1 не пишет (spec, «Решено без владельца», 9).

## Что делаем

1. Переводы в `docs/features/ru/`: `changes.md` (новая), `sessions.md`, `workflow.md`, `app-shell.md`, строка в
   `README.md` — по английским страницам на `main`.
2. `CONTEXT.md`: статья **Changes** — Node с diff-ом Ticket-а против базы и комментариями к строкам, которые уходят
   Session одним сообщением; _Avoid_: diff view, Review pane, Files changed.
3. Сверка: ADR Ticket-а 02 влит, в его контексте — «решено без владельца 2026-11-19, подтвердить».
4. В «Итог» — список «решено без владельца» части 1 для приёмки (Ticket 07): из spec-а («Вопросы владельцу»,
   «Решено без владельца») и из «Итог» Ticket-ов 01–05.

## Готово, когда

- [ ] Пять файлов `docs/features/ru/` совпадают по смыслу с английскими на `main` (review по каждому).
- [ ] `CONTEXT.md` называет Changes, с _Avoid_.
- [ ] В «Итог» — список решений без владельца части 1.
- [ ] `node scripts/check-personal.mjs` и `node scripts/check-feature-docs.mjs` — exit 0; `ci-ok` зелёный на head PR.

## Где в коде

- `docs/features/ru/changes.md` (новый), `docs/features/ru/sessions.md`, `docs/features/ru/workflow.md`,
  `docs/features/ru/app-shell.md`, `docs/features/ru/README.md`
- `CONTEXT.md:17-61` (рядом со статьями Node и Family)

## Вне скоупа

- Английские страницы — в Ticket-ах поведения. Поправка к ADR-0005, страницы о Last turn, Viewed и PR — часть 2.
