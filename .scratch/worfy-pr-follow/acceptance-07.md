# Приёмка части 1 Epic-а worfy-pr-follow (Ticket 07): доказательства

Проверено 2026-11-18 на `main` b23c76d38, только чтение. Источники: `.scratch/worfy-pr-follow/spec.md` («Готово,
когда», «Вопросы владельцу», «Решено без владельца»), «Итог» Ticket-ов 01–06, `gh pr view`, verdict-ы в
`~/Stuff/worfy-orch/verdict/`, eval log-и в этой папке.

## CI и verdict по PR

`ci-ok` взят двумя путями: на head PR-а (`gh pr view <N> --json statusCheckRollup`) и на merge commit в `main`
(`gh api …/commits/<sha>/check-runs`). Последний verdict — тот, чей файл `.posted.<sha>` равен head PR-а.

| Ticket | PR | head PR | ci-ok на head | merge commit в main | ci-ok на main | последний verdict |
|---|---|---|---|---|---|---|
| 01 действия в main | #2005 | cfb385368 | SUCCESS | a8f1faef5 | success | 2005-r3 VERIFIED |
| 02 skill `checks`/`comments` | #2004 | 3fafff581 | SUCCESS | b9a9cbc7b | success | 2004-r3 VERIFIED |
| 03 skill `conflicts` | #2011 | 61b4b2e9b | SUCCESS | 4227ebcb5 | success | 2011-r2 VERIFIED |
| 04 кнопки в Pull requests | #2010 | db344cac2 | SUCCESS | c079a41e3 | success | 2010-r3 VERIFIED |
| 05 Ticket Node и Command palette | #2009 | 21caee9f3 | SUCCESS | 0819cc9bf | success | 2009-r3 VERIFIED |
| 06 документы | #2015 | 86f7a49de | SUCCESS | dad9d11ba | success | 2015-r2 VERIFIED |

У #2009 и #2010 e2e job-ы на head зелёные: macos-e2e 1/2 и 2/2, windows-e2e 1/4 … 4/4 — все SUCCESS.

## Пункт → доказательство

Пунктов «Готово, когда» части 1 без (вручную) — 7. С доказательством — 7, без доказательства — 0. У пункта 4 есть
оговорка о head eval-а, у пункта 7 — оговорка о `ru/notifications.md`.

| # | Пункт spec-а | PR | Test-ы на `main` (file:line, название) | Eval / прочее |
|---|---|---|---|---|
| 1 | Pull requests: у своего PR в Needs a fix — кнопка по первой причине, остальные рядом, Open checks — ссылка; в Needs my answer — Address comments рядом с Draft replies | #2010 (причины — #2005) | `test/unit/pr-inbox-view.test.tsx:629` «nextStep of a PR to fix names what is wrong; its first reason is the main button, the others beside it, and Open checks stays a link»; `:656` «nextStep of my PR that waits for an answer puts Address comments beside Draft replies; a colleague's PR gets none»; `:1213` «a PR in conflict and red: Resolve conflicts is the main button, Fix checks beside it, Open checks a link…»; `:1248` «my PR in Needs my answer: Address comments right beside Draft replies»; e2e `test/e2e/pr-inbox.spec.ts:767` «Fix checks in the strip of a red PR: a new Session Node gets /worfy:pr-fix checks with the head of the stub; Open checks stays a link»; порядок причин — `test/unit/pr-follow.test.ts:31` «takes DIRTY first, then failing CI, then the comments» | — |
| 2 | Ticket Node с PR, которому нужна правка, — та же кнопка с меню; Command palette — те же действия с теми же причинами отказа | #2009 | `test/unit/canvas-actions.test.tsx:1321` «a PR in conflict with red CI: Resolve conflicts on the button, Fix checks in «▾»; each click asks main for its action»; `:1347` «a Project with the PR inbox off ("prInbox": false) has no button…»; `test/unit/palette-commands.test.tsx:1017` «the rows say what the Ticket's button and its «▾» say: the same text when active, the same reason when not»; `:976` «a row per action the Ticket's PR has a reason for, in the button's order…»; e2e `test/e2e/pr-follow-ticket.spec.ts:91` «Resolve conflicts on a Ticket with no bound Session: the button for the first reason, Fix checks in «▾», and a click starts a new Session by the Ticket…» | — |
| 3 | Щелчок продолжает Session с Binding-ом на Ticket (порог 24 часа), иначе новая; пустой шаблон — кнопка неактивна, tooltip говорит, где задать | #2005; UI — #2010, #2009 | `test/contract/actions.test.ts:622` describe «the Session Node bound to the PR's Ticket, its transcript younger than 24 hours» с `:623` «takes the text at once (`sent`)…»; `:671` it.each «when %s» (строки `:664` «older than 24 hours», `:665` «exactly 24 hours old» → новая Session Node); `test/unit/render-template.test.ts:130` «refuses an empty template with the hint where to set it»; `test/unit/pr-follow-state.test.tsx:88` «is inactive with the hint where to set an empty template»; `test/unit/pr-inbox-view.test.tsx:1263` «an empty template: the button is inactive, and its tooltip says where to set it; a click sends nothing»; `test/unit/canvas-actions.test.tsx:1362` «inactive with the reason of usePrFollowState: someone else's PR, an empty template» | порог — `src/main/actions/launch.ts:164` `FOLLOW_SESSION_MS = 24 * 60 * 60_000` |
| 4 | Skill `/worfy:pr-fix`: worktree ветки PR, checkout человека не трогает, push только после «Push», в PR ничего не пишет; конфликт по режиму Profile-а; evals зелёные | #2004, #2011 | `test/contract/harness-evals.test.ts:2556` «SKILL.md pushes only on the answer "Push", writes nothing else to GitHub, takes only a worktree on the branch of the pull request…»; `:2079` «a run as the skill says, with git hooks off as in an eval: the fix committed in a new worktree passes fixed-in-worktree…»; `:2344` «the command grader catches a push whatever options stand before it… and every write to GitHub wherever gh stands…»; `:2193` «conflicts in Full mode, a run as SKILL.md says…: … the lease push of step 8 is refused…»; `:2240` «conflicts in Silent mode, a run as SKILL.md says…: the merge commit passes merged-in-worktree only…»; `:2516` «each case at its own runs and the threshold…: … a prompt has no "Push" answer» (тесты `:2079`, `:2193`, `:2240` пропускаются на win32) | Платные evals, 2 run-а на кейс, потолок 3 USD на вызов. **На 6f0f63a98 (#2011, `eval-2011.log`)**: `pr-fix-checks` 1.00 (0.80 USD), `pr-fix-comments` 1.00 (1.20), `pr-fix-conflicts` 0.96 (0.75), `pr-fix-conflicts-silent` 1.00 (0.83); casesPassed 1 из 1 и exit 0 у всех четырёх; всего 3.58 USD. **На dbd7199ae (#2004, `eval-2004.log`)**: `pr-fix-checks` 0.93 (0.75), `pr-fix-comments` 1.00 (1.20), exit 0. Grader `fixed-in-worktree` / `merged-in-worktree` сопоставил строку `checkout=untouched` в каждом run-е. **Оговорка 1.** Ветку «Push» ни один eval не достаёт: в eval-е нет человека для ответа. Это покрывают contract test-ы `:2193` и `:2556` (решение 9 ниже). **Оговорка 2.** Eval шёл на 6f0f63a98, а влит head 61b4b2e9b. Раунд 2 review поменял `harness/skills/pr-fix/SKILL.md` (+5/−2): добавил `--cleanup=strip` к merge commit и подсказку человеку про `reset --hard`. Eval после этого не повторяли; `--cleanup=strip` проверяет contract test `:2240` (verdict 2011-r2). У #2004 head после eval-а (3fafff581) меняет только документ Ticket-а |
| 5 | Действия отказывают, пока идёт Autopilot, для PR из fork и при `busy` Orchestrator-е Epic-а Ticket-а | #2005; показ отказа — #2010, #2009 | `test/contract/actions.test.ts:785` describe «refused with the reason, nothing sent and no Session created», it.each `:794` «%s» со строками `:787` «while Autopilot runs in the Project», `:788` «while the Orchestrator bound to the Epic of the PR's Ticket is busy», `:789` «for a PR from a fork»; `:802` «but not while the busy Orchestrator is bound to another Epic, or the Orchestrator is idle»; `test/contract/pr-inbox.test.ts:439` describe «a PR from a fork (worfy-pr-follow ticket 01)»; `test/unit/pr-follow.test.ts:64` «refuses a PR that is not the user's, from a fork, or closed, with the reason»; `test/unit/pr-inbox-view.test.tsx:1277` «a refusal of the verdict of ticket 01 is the tooltip too: a PR from a fork», `:1326` «main's refusal is an error toast with its reason» | — |
| 6 | Linked machine с доступом read-only видит причины, кнопки у неё неактивны | #2005; UI — #2010, #2009 | `test/contract/actions.test.ts:835` «with read-only access is refused before the launcher runs» (и `:843` «with full access runs it…»); `test/unit/link-access.test.ts:171` «project: the work with Projects…» — `actions.prFollow` в списке канала `project` (`:310`); `test/unit/pr-follow-state.test.tsx:94` «is inactive on a read-only screen, with its reason first», `:100` «says read-only before it waits for the Project settings…»; `test/unit/pr-inbox-view.test.tsx:1347` «Fix checks and the other actions on a PR are inactive, with the hint, and a click sends nothing (worfy-pr-follow ticket 04)»; palette — проверка в `test/unit/palette-commands.test.tsx:991` внутри теста `:976` | Ticket Node берёт неактивность из того же `usePrFollowState` (`canvas-actions.test.tsx:1362`), отдельного test-а на read-only Ticket Node нет |
| 7 | Страницы Feature en и ru описывают сделанное; Amendment к ADR-0105 и имена действий в CONTEXT.md влиты | #2015 (английские страницы — #2004, #2005, #2009, #2010, #2011) | Test-а на смысл текста нет. В CI идёт `scripts/check-feature-docs.mjs` (часть `pnpm lint`, `package.json:17`) | `docs/adr/0105-pr-reply-only-on-the-users-click.md:76` «## Amendments», `:78` запись «2026-11-18 — действия правки PR и skill `pr-fix`…»; `CONTEXT.md:152` — три действия в статье PR inbox, `:153` `_Avoid_`: голое Fix, autofix; `docs/features/pr-inbox.md:85` и `docs/features/ru/pr-inbox.md:83` — кнопки; `pr-fix` в `docs/features/skills-agents-and-hooks.md:28` и `ru/…:29`. `node scripts/feature-docs-lag.mjs` на `main` — EXIT=0, отстают 13 из 36 переводов; шесть страниц Epic-а (`pr-inbox`, `harness`, `app-shell`, `workflow`, `projects`, `skills-agents-and-hooks`) в этом списке не стоят. **Оговорка:** `ru/notifications.md` отстаёт на 4 commit-а после 41f4e01b; Ticket 06 добавил туда только раздел «Утренний дайджест», и к действиям правки эта страница не относится |

## Решения без владельца

Источники совпадают. Все 8 пунктов spec-а «Решено без владельца» и Q3, Q4, Q7 из «Вопросы владельцу» есть в списке
«Итог» Ticket-а 06. Ticket 03 добавил одно решение (пункт 9). В «Итог» Ticket-ов 01, 02, 04, 05 и в описаниях PR
других решений нет.

1. Q3 — push только после ответа «Push» в карточке вопроса, в Full mode тоже. Где: spec «Вопросы владельцу», Q3; Ticket-ы 02, 03; Amendment к ADR-0105 (`docs/adr/0105-…md:78`).
2. Q4 — конфликт по режиму Profile-а: Full mode — rebase и `--force-with-lease`, Silent mode — merge commit. Где: spec, Q4; Ticket 03; Amendment к ADR-0105.
3. Q7 — Session Ticket-а продолжается, если последняя запись транскрипта моложе 24 часов, иначе новая. Где: spec, Q7; Ticket 01; `src/main/actions/launch.ts:164`.
4. Split Epic-а: часть 1 (действия и skill, 7 Ticket-ов) и часть 2 (PR watch, без Ticket-ов, после приёмки). Где: spec «Решено без владельца», 1.
5. Своего ADR о сообщении main в Session нет: путь как у продолжения после перезапуска (ADR-0108, пункт 5); push и конфликт — Amendment к ADR-0105. Где: spec «Решено без владельца», 3.
6. Возражение 2 critic-а (id review и `authorAssociation` в snapshot PR inbox) перенесено в часть 2. Где: spec «Решено без владельца», 4.
7. Ticket Node берёт причины кнопок из PR inbox, а не из Pipeline; Project с `"prInbox": false` кнопок не получает. Где: spec «Решено без владельца», 5; Ticket 05; test `canvas-actions.test.tsx:1347`.
8. Skill разбит на два Ticket-а: режим `conflicts` с force-push — отдельный Ticket 03 со своим eval-ом и review. Где: spec «Решено без владельца», 6.
9. Ветку «Push» ни один eval не достаёт. Что без «Push» ничего не уходит, проверяет eval (`no-publish-command`, `nothing-published`); push с lease и отказ lease — contract test `test/contract/harness-evals.test.ts:2193`. Где: «Итог» Ticket-а 03.
10. Английскую страницу Feature правит Ticket своего поведения (ADR-0088); Ticket 06 держит переводы `docs/features/ru/`, Amendment к ADR-0105 и CONTEXT.md. Где: spec «Решено без владельца», 7.
11. Строка Status spec-а записана в форме «принят владельцем 2026-11-18 по указанию «сразу бери следующий», часть 1», хотя указание звучит «принят по указанию владельца». Где: spec «Решено без владельца», 8; `spec.md:3`.

Ещё одно расширение рамок, не из списка решений. Ticket 06 по указанию Orchestrator-а вышел за свой список файлов:
`harness.md` (28 скриптов, пять строк), пропуски в `app-shell.md`, `workflow.md`, `projects.md`, раздел «Утренний
дайджест» в `ru/notifications.md`. Где: «Итог» Ticket-а 06.

## Что владелец проверяет руками

Шаг 3 Ticket-а 07. До него Orchestrator обновляет Mac Stable до `main` с Ticket-ами 01–06 (с согласия владельца).
Проверка идёт в тестовом репозитории со своим PR.

- [x] Fix checks на красном CI в Pull requests → Session чинит в worktree → «Push» → CI зелёный. До «Push» в ветку ничего не ушло.
- [x] Resolve conflicts на Ticket Node при конфликте с базой → вопрос называет `--force-with-lease` (Full mode) → «Not now» ничего не пушит, «Push» пушит.
- [x] Address comments на запросе изменений → правка и черновики ответов; без Send в PR ничего не опубликовано.
- [x] После всех трёх checkout владельца не тронут: `git status` чистый, ветка та же.
- [x] Владелец принимает часть 1 и подтверждает или отменяет решения 1–11 выше.

## Ответ владельца 2026-11-19

Из карточки приёмки, 2026-11-19: «Принимаю». Проверка — на Mac Stable, в private тестовом репозитории
`IDSAD-XL/worfy-sandbox`, Project в Full mode:

- Fix checks на PR #1 (красный CI);
- Resolve conflicts на PR #2 (конфликт с базой);
- Address comments на PR #3 (комментарий второго аккаунта, группа «Needs my answer»);
- checkout владельца не тронут.

Решения без владельца 1–11 — подтверждены. Владелец заметил bug: «Open» из другого Project-а не переключает Project —
Ticket worfy-polish 127.
