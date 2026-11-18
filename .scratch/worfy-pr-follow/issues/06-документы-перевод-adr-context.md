# 06 — Документы: переводы страниц Feature, Amendment к ADR-0105, имена действий в CONTEXT.md

Type: task
Status: open
Blocked by: 01, 02, 03, 04, 05
Source: [spec.md](../spec.md), «Ticket-ы», 6; «Решения по реализации», 5; «Решено без владельца», 3 и 7; «Готово,
когда», пункт о документах

Кто: агент.

Не платформенный Ticket (документы). Глубина ревью — `low`.

## Что происходит

- Английские страницы Feature правят Ticket-ы своего поведения (ADR-0088): `projects.md` (01),
  `skills-agents-and-hooks.md` и `harness.md` (02, 03), `pr-inbox.md` (04), `workflow.md` и `app-shell.md` (05). Перевод
  в PR с поведением не считается, поэтому `docs/features/ru/` отстаёт.
- ADR-0105 говорит, что main не делает push (пункт 4, `docs/adr/0105-pr-reply-only-on-the-users-click.md:31-34`), но
  не говорит о push Session-ом skill-а `pr-fix` и о политике конфликта.
- Сообщение main в Session Node уже записано в ADR-0108, пункт 5
  (`docs/adr/0108-work-continues-after-a-restart-of-worfy.md:36-39`); нового ADR о нём часть 1 не пишет (возражение 3
  critic-а).
- В CONTEXT.md статья PR inbox (`CONTEXT.md:151-153`) не называет действий правки; слово «Fix» занято шагом Terminal AI
  (`CONTEXT.md:372-374`).

## Что делаем

1. Переводы в `docs/features/ru/`: `projects.md`, `pr-inbox.md`, `workflow.md`, `app-shell.md`,
   `skills-agents-and-hooks.md`, `harness.md` — по английским страницам на `main`.
2. Датированный Amendment к ADR-0105 (`## Amendments`, по `rules-adr.md`): действия Fix checks, Resolve conflicts,
   Address comments запускают Session со skill-ом `pr-fix`; push делает Session только после ответа «Push» в карточке
   вопроса (Q3 — и в Full mode); конфликт — rebase и `--force-with-lease`, названный в вопросе, в Full mode, merge
   commit в Silent mode (Q4); main по-прежнему не пишет в PR и не пушит. Пометка «решено без владельца 2026-11-18,
   подтвердить».
3. CONTEXT.md: в статье PR inbox — три действия правки (Fix checks, Resolve conflicts, Address comments) одной фразой;
   `_Avoid_` у них — «Fix» (шаг Terminal AI), autofix.

## Готово, когда

- [ ] Шесть страниц `docs/features/ru/` совпадают по смыслу с английскими на `main` (review по каждой).
- [ ] Amendment к ADR-0105 влит, текст ADR выше него не изменён.
- [ ] CONTEXT.md называет три действия в статье PR inbox.
- [ ] `node scripts/check-personal.mjs` и `node scripts/check-feature-docs.mjs` — exit 0; `ci-ok` зелёный на head PR.

## Где в коде

- `docs/features/ru/projects.md`, `docs/features/ru/pr-inbox.md`, `docs/features/ru/workflow.md`,
  `docs/features/ru/app-shell.md`, `docs/features/ru/skills-agents-and-hooks.md`, `docs/features/ru/harness.md`
- `docs/adr/0105-pr-reply-only-on-the-users-click.md`
- `CONTEXT.md`

## Вне скоупа

- Английские страницы — в Ticket-ах поведения. Термин PR watch, страница `pr-watch.md` и Amendment к ADR-0108 — часть 2.
