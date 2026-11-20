# 06 — Документы: перевод страниц Feature, термин Changes в CONTEXT.md

Type: task
Status: claimed 2026-11-20T03:43Z
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
  - evidence: commit pass · worfy-changes-view/06: Russian Feature pages of Changes, the Changes term in CONTEXT.md · - - · 02ad3f292
- [ ] `CONTEXT.md` называет Changes, с _Avoid_.
  - evidence: commit pass · worfy-changes-view/06: Russian Feature pages of Changes, the Changes term in CONTEXT.md · - - · 02ad3f292
- [ ] В «Итог» — список решений без владельца части 1.
  - evidence: commit pass · worfy-changes-view/06: Russian Feature pages of Changes, the Changes term in CONTEXT.md · - - · 02ad3f292
- [ ] `node scripts/check-personal.mjs` и `node scripts/check-feature-docs.mjs` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: test-run pass · `node scripts/check-personal.mjs && node scripts/check-feature-docs.mjs` exit 0 · mac - · 02ad3f292

## Где в коде

- `docs/features/ru/changes.md` (новый), `docs/features/ru/sessions.md`, `docs/features/ru/workflow.md`,
  `docs/features/ru/app-shell.md`, `docs/features/ru/README.md`
- `CONTEXT.md:17-61` (рядом со статьями Node и Family)

## Вне скоупа

- Английские страницы — в Ticket-ах поведения. Поправка к ADR-0005, страницы о Last turn, Viewed и PR — часть 2.

## Итог

Сделано implementer-ом 2026-11-20, ветка `worfy-changes-view/06`, от `origin/main` `0371a73df`.

- Переводы `docs/features/ru/` — по английским страницам на `main`, с новой отметкой commit-а в первой строке:
  `changes.md` (новая, `same-pr`: английская страница правится в этом же PR, см. ниже), `sessions.md` (`4879eec7`,
  комментарий к строкам diff-а — Ticket 04), `workflow.md` (`ea853f5d`, строка Changes таблицы действий — Ticket 03;
  `same-pr` заменён SHA, как велит раздел «Translation» `docs/features/README.md`), `app-shell.md` (`1147879d`, строка
  Open changes в Command palette), `README.md` (`4462608d`, строка Changes). `node scripts/feature-docs-lag.mjs`
  больше не называет ни одну из пяти. Лаг `ru/workflow.md` отчёт не видел: Ticket polish 132 (#2050) правил
  `ru/workflow.md` после Ticket-а 03, и отчёт считал от него.
- `CONTEXT.md`: статья **Changes** после Family, с _Avoid_: diff view, Review pane, Files changed.
- Сверка страниц с кодом Ticket-ов 02–05 (`src/main/changes/`, `src/renderer/changes/`, `ChangesNode.tsx`). Две фразы
  английской `docs/features/changes.md` код не подтверждал — исправлены в этом PR вместе с переводом (вне «Где в коде»:
  иначе перевод либо повторил бы ошибку, либо разошёлся бы с английской страницей):
  - «Show whole file» как надпись: кнопки нет, есть только параметр `whole` канала `changes.file`
    (`src/shared/ipc/changes.ts:145`, `src/main/changes/scopes.ts:82`); renderer его не передаёт.
  - Заголовок раздела Send называет не только ветку, но и worktree, и разделов столько, сколько пар worktree и ветки
    (`src/renderer/session/quote-comments.ts:339`, `:353`); `sessions.md` это уже говорил верно.
- ADR Ticket-а 02 влит: `docs/adr/0110-changes-reads-git-writes-nothing.md`, статус «принят», в контексте — «Решено без
  владельца 2026-11-19, подтвердить».

### Решено без владельца, часть 1 — для приёмки (Ticket 07)

Из spec-а, «Вопросы владельцу» (все 2026-11-19, рекомендованный вариант):

1. Q1 — экран Changes — Node на Canvas рядом с карточкой Ticket-а, в focus mode — плитка рядом с Session (Ticket-ы 03, 05).
2. Q2 — комментарии по умолчанию уходят Session с Binding-ом к Ticket-у, без неё — Orchestrator-у (Ticket 05).
3. Q5 — без подсветки синтаксиса (Ticket 03).

Из spec-а, «Решено без владельца (подтвердить)»:

4. Epic разрезан на часть 1 (7 Ticket-ов) и часть 2 (Last turn, живое обновление, Viewed, PR, Stage Human review).
5. Q1, Q2, Q5 — рекомендованные варианты (пункты 1–3 выше).
6. Возражение 3 critic-а снято выбором владельца (этот Epic — следующий после worfy-auth-check).
7. Прототип не держит Ticket 03; правки владельца после приёмки — Ticket-ом polish.
8. Предмет части 1 — только Ticket; Session и PR как предмет — часть 2.
9. Scope-ы части 1: All changes, Uncommitted, Commit, Compare against.
10. Комментарии — два Ticket-а: модель (04) в Wave 1, экран (05) после Node-а.
11. ContextMenu на строке (Comment, Copy line) — в части 1.
12. Без поправки к ADR-0005 в части 1: неотправленные комментарии — в localStorage окна, в папке данных worfy.
13. Страницы Feature: английскую правят Ticket-ы поведения, переводы и CONTEXT.md — Ticket 06.
14. Строка Status spec-а — в единой форме «принят владельцем YYYY-MM-DD …».

Из Ticket-а 02 (ADR-0110, «Решено без владельца 2026-11-19, подтвердить»):

15. Changes читает git одним runner-ом с фиксированным списком читающих команд и ничего не пишет в репозиторий; сверх
    spec-а — `-c diff.autoRefreshIndex=false`: одних `GIT_OPTIONAL_LOCKS=0` мало, `git diff` всё равно переписывал
    `.git/index`, если у файла сменилось время изменения, а текст нет (PR #2038).

Из «Итог» Ticket-а 03:

16. Кнопка Changes видна у Ticket-а с веткой worktree-а, строкой `Branch:` или в работе — как строка palette; один
    worktree без этих признаков кнопки не даёт.
17. Palette без Node-а центрирует карточку и оставляет запрос её кнопке; через 2 s без ответа ставит Node справа от всего
    Canvas.
18. Цвет вида в minimap нейтральный (`var(--border-strong)`): новый цвет — только через новый ADR (ADR-0077).
19. На экране только для чтения кнопка и строка palette неактивны, пока Node-а нет; scope там хранится локально.
20. Новый Node встаёт через `freePlace` от `sessionSpot` (справа от полосы рамок на высоте Ticket-а), а не через
    `placeNear` от карточки, как писал Ticket.
21. Вторая строка действий на карточке с кнопкой Changes (+24 px) — уже подтверждено владельцем 2026-11-20.

Из «Итог» Ticket-а 05 (его пункты 1–12):

22. В «To» — Session-ы любого Vendor-а, не только Claude Code.
23. Без предела в 24 часа на Session-ы в «To».
24. По умолчанию в «To» — привязанная Session с самой свежей записью, иначе Orchestrator (по Q2).
25. Session или Orchestrator без session id держат комментарии под ключом `not-started`, потом они переезжают на id.
26. Отправленные комментарии тусклые через отдельный store `sent-lines.ts` (200 последних на Ticket).
27. Send запускает Session, если она не идёт.
28. Send шлёт все черновики этой Session, включая комментарии к её сообщениям.
29. «Line changed» — отметка только в памяти; повторная привязка после Refresh — по тексту hunk-ов, не всего файла.
30. `commit` комментария — по scope-у: all и compare — новая сторона worktree (или head), старая — merge-base;
    uncommitted — новая worktree, старая head; commit — этот sha с обеих сторон.
31. «To» закрепляется за показанной Session, когда у неё появились черновики или она приняла Send.
32. Повторная привязка — только в виде (scope и Hide whitespace), где нажат Refresh, и только на commit-е этого чтения.
33. Во время Send правка и удаление комментариев заблокированы целиком.

У Ticket-ов 01 и 04 решений без владельца нет: 01 — прототип, который владелец одобрил 2026-11-20; 04 записал только
модель (PR #2039), без отступлений от spec-а. Раздела «Итог» у Ticket-ов 02 и 04 на `main` нет — их решения взяты из
ADR-0110 и описаний PR #2038 и #2039.
