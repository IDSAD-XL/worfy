# 06 — Документы: переводы страниц Feature, Amendment к ADR-0105, имена действий в CONTEXT.md

Type: task
Status: done 2026-11-18T19:52Z
PR: #2015
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
  - evidence: review pass · PR #2015 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] Amendment к ADR-0105 влит, текст ADR выше него не изменён.
  - evidence: commit pass · worfy-pr-follow/06: Russian Feature pages, ADR-0105 amendment, PR fix actions in CONTEXT · - - · 2f293e4e779db865318128bb6eaefa7179f29fdd
  - evidence: review pass · PR #2015 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] CONTEXT.md называет три действия в статье PR inbox.
  - evidence: commit pass · worfy-pr-follow/06: Russian Feature pages, ADR-0105 amendment, PR fix actions in CONTEXT · - - · 2f293e4e779db865318128bb6eaefa7179f29fdd
  - evidence: review pass · PR #2015 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] `node scripts/check-personal.mjs` и `node scripts/check-feature-docs.mjs` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: test-run pass · `node scripts/check-personal.mjs` exit 0, `node scripts/check-feature-docs.mjs` exit 0 · mac - · 2f293e4e779db865318128bb6eaefa7179f29fdd
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/44384091333/job/135086091023 · ci - · 86f7a49ded7707bef39f9961ae02ff798b390c3d

## Где в коде

- `docs/features/ru/projects.md`, `docs/features/ru/pr-inbox.md`, `docs/features/ru/workflow.md`,
  `docs/features/ru/app-shell.md`, `docs/features/ru/skills-agents-and-hooks.md`, `docs/features/ru/harness.md`
- `docs/adr/0105-pr-reply-only-on-the-users-click.md`
- `CONTEXT.md`

## Вне скоупа

- Английские страницы — в Ticket-ах поведения. Термин PR watch, страница `pr-watch.md` и Amendment к ADR-0108 — часть 2.

## Итог

- Переводы шести страниц `docs/features/ru/` сверены с английскими на `main` (7aadf9f75) целиком, не только по diff-у
  Epic-а: `ru/pr-inbox.md` и `ru/harness.md` отставали и до Epic-а. Метки перевода — последний commit английского файла.
  У `ru/skills-agents-and-hooks.md` снята пометка о PR #1996: он в `main`.
- Amendment к ADR-0105 от 2026-11-18: действия правки, push только по «Push» (Q3), конфликт по режиму Profile-а (Q4).
- CONTEXT.md: три действия правки в статье PR inbox, `_Avoid_` — голое Fix (действие Terminal AI и кнопка Health check), autofix.
- Вне списка файлов, по указанию Orchestrator-а: `harness.md` — 28 скриптов и пять недостающих строк; пропуски
  `app-shell.md`, `workflow.md` и `projects.md` о действиях правки; в `ru/notifications.md` — раздел «Утренний
  дайджест» (метка `41f4e01b`, остальная страница отстаёт по-прежнему).

Решено без владельца в Epic-е части 1 — подтвердить на приёмке (Ticket 07). В «Итог» Ticket-ов 01, 02, 04 и 05 таких
пунктов нет; список собран из spec-а («Вопросы владельцу», «Решено без владельца») и «Итог» Ticket-а 03:

1. Q3 — push только после ответа «Push» в карточке вопроса, и в Full mode тоже (spec; Ticket-ы 02, 03; Amendment к
   ADR-0105).
2. Q4 — конфликт по режиму Profile-а: Full mode — rebase и `--force-with-lease`, Silent mode — merge commit (spec;
   Ticket 03; Amendment к ADR-0105).
3. Q7 — Session Ticket-а продолжается, если последняя запись её транскрипта моложе 24 часов, иначе новая Session
   (spec; Ticket 01; `src/main/actions/launch.ts:164`).
4. Split Epic-а на часть 1 и часть 2 (spec, пункт 1).
5. Без своего ADR о сообщении main в Session: путь записан в ADR-0108, пункт 5; решения о push и конфликте — Amendment
   к ADR-0105 (spec, пункт 3).
6. Возражение 2 critic-а (id review и `authorAssociation` в snapshot PR inbox) — в часть 2 (spec, пункт 4).
7. Ticket Node берёт причины кнопок из PR inbox, а не из Pipeline; Project с `"prInbox": false` кнопок не получает
   (spec, пункт 5).
8. Skill — два Ticket-а, режим `conflicts` отдельно (spec, пункт 6).
9. Ветку «Push» ни один eval не достаёт: «без ответа ничего не уходит» проверяет eval, push с lease и отказ lease —
   contract test (`test/contract/harness-evals.test.ts`) (Ticket 03).
10. Страницы Feature: английскую страницу правит Ticket своего поведения (ADR-0088), а Ticket 06 держит переводы в
    `docs/features/ru/`, Amendment к ADR-0105 и CONTEXT.md (spec, пункт 7).
11. Строка Status spec-а записана в единой форме «принят владельцем YYYY-MM-DD …», хотя указание звучит «принят по
    указанию владельца» (spec, пункт 8).
