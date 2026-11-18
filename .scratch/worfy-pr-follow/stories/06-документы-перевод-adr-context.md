# Code story — worfy-pr-follow 06: Документы: переводы страниц Feature, Amendment к ADR-0105, имена действий в CONTEXT.md

Kind: pr · Epic: worfy-pr-follow · Ticket: 06 · PR: - · Language: ru

## 1. Что было не так

Ticket-ы 01–05 правили только английские страницы Feature (ADR-0088), и шесть страниц `docs/features/ru/` отстали;
`ru/pr-inbox.md` и `ru/harness.md` отставали и до Epic-а. ADR-0105 говорил, что main не пушит, но молчал о push
Session-ом skill-а `pr-fix` и о политике конфликта. Статья PR inbox в CONTEXT.md не называла действий правки.

- Требование: [Что происходит](../issues/06-документы-перевод-adr-context.md#что-происходит)

## 2. Amendment к ADR-0105: push только по «Push», конфликт по режиму Profile-а

Code: `docs/adr/0105-pr-reply-only-on-the-users-click.md:76-95` · key lines: 82, 86, 90, 93

```markdown
## Amendments

- **2026-11-18 — действия правки PR и skill `pr-fix`: push только по ответу «Push», конфликт — по режиму Profile-а**
  (worfy-pr-follow 06, по Ticket-ам 01–05; Q3 и Q4 spec-а `.scratch/worfy-pr-follow/spec.md` — решено без владельца
  2026-11-18, подтвердить). Действия Fix checks, Resolve conflicts и Address comments на PR пользователя (Pull
  requests, Ticket Node, Command palette) из main на GitHub не пишут: main заново читает PR и отдаёт шаблон действия
  (по умолчанию `/worfy:pr-fix <checks|conflicts|comments> {repo}#{pr} {sha}`) Session-и Project-а на Claude Code —
  Session Ticket-а этого PR, если последняя запись её транскрипта моложе 24 часов, иначе новой Session
  (`src/shared/ipc/actions.ts:107-122`, `src/shared/projects/action-templates.ts:95-97`,
  `src/main/actions/launch.ts:164`). Правку и commit делает Session со skill-ом `pr-fix` в worktree ветки PR, не в
  checkout пользователя. Push делает только Session и только после ответа «Push» в карточке вопроса — и в Silent
  mode, и в Full mode, где ship-ticket пушит сам (Q3); «Push», написанный в просьбе заранее, ответом не считается, а
  без человека ничего не уходит (`harness/skills/pr-fix/SKILL.md:14-18`, `:264-282`). Конфликт с базовой веткой — по
  режиму Profile-а (Q4): в Full mode rebase на базу в worktree и push только с
  `--force-with-lease=<ветка>:<head до rebase>`, который назван в вопросе «Force-push (with lease) …», никогда голым
  `--force`; если ветку на GitHub сдвинули, lease отказывает, и skill больше ничего не пушит. В Silent mode — merge
  commit базы, без rebase и force-push (`harness/skills/pr-fix/SKILL.md:170-186`, `:264-276`). Пункт 4 в силе: main
  делает только две записи из него, ничего больше в PR не пишет и не пушит. Ответы на нити ревью режима `comments`
  skill отдаёт черновиками в `pr-reply-draft`, публикует их, как раньше, щелчок Send (пункты 2–3). Сообщение main в
  Session записано в ADR-0108, пункт 5; своего ADR о нём нет.
```

- Что делает: записывает решения Q3 и Q4 части 1 с пометкой «решено без владельца, подтвердить»: main отдаёт действие Session-и и не пушит, push — только Session и только после ответа «Push», конфликт — rebase с lease в Full mode и merge commit в Silent mode. Каждое утверждение несёт file:line кода или SKILL.md.
- Почему здесь: Ticket называет Amendment к ADR-0105 ([Что делаем, п. 2](../issues/06-документы-перевод-adr-context.md#что-делаем)); изменение решения дописывается датированным разделом `## Amendments`, текст выше не меняется (правило ADR проекта).
- Без него: пункт 4 ADR-0105 («push main не делает») читался бы как запрет любого push, а политика конфликта жила бы только в spec-е и SKILL.md.
- Требование: [Что делаем, п. 2](../issues/06-документы-перевод-adr-context.md#что-делаем)
- Риски и пробелы test-ов: номера строк в Amendment сверены чтением; если `actions.ts` или SKILL.md сдвинутся, ссылки устареют, и ни один test этого не заметит.

## 3. Три действия правки в статье PR inbox

Code: `CONTEXT.md:151-153` · key lines: 152, 153

```markdown
**PR inbox**:
Вид «Pull requests» Project-а: открытые PR пользователя и запросы ревью у него по репозиториям Project-а, сгруппированные по тому, чей ход (Needs my review, Needs my answer, Needs a fix, Ready, Waiting on others), нити ревью и черновики ответов. Читает GitHub из main и ничего не публикует без щелчка Send ([ADR-0105](docs/adr/0105-pr-reply-only-on-the-users-click.md)). Подпись в UI — «Pull requests». Три действия правки PR пользователя — Fix checks (упавшие checks), Resolve conflicts (конфликт с базовой веткой) и Address comments (замечания ревью) — передают PR Session-и Project-а, а push в ветку PR бывает только после ответа пользователя «Push».
_Avoid_: inbox (без PR), входящие, dashboard; для действий правки — голое Fix (так зовутся действие Terminal AI и кнопка строки Health check), autofix
```

- Что делает: называет Fix checks, Resolve conflicts и Address comments одной фразой и добавляет в `_Avoid_` голое Fix и autofix.
- Почему здесь: Ticket велит так ([Что делаем, п. 3](../issues/06-документы-перевод-adr-context.md#что-делаем)); слово «Fix» уже занято действием Terminal AI (статья **Fix** в CONTEXT.md) и кнопкой строки Health check.
- Без него: «Fix» в тексте о PR путали бы с действием Terminal AI.
- Требование: [Готово, когда](../issues/06-документы-перевод-adr-context.md#готово-когда)
- Риски и пробелы test-ов: не записано.

## 4. Перевод: строка skill-а `pr-fix`

Code: `docs/features/ru/skills-agents-and-hooks.md:29-29` · key lines: 29

```markdown
| `pr-fix` | `/worfy:pr-fix <checks\|conflicts\|comments> <owner>/<repo>#<N> [<sha>]`, или действия "Fix checks", "Resolve conflicts" и "Address comments" | Берёт собственный pull request человека на его текущем head (и говорит об этом, если head ушёл от `<sha>`), делает правку в worktree Ticket-а, когда тот стоит на ветке PR и чист на head (detached tree другого агента не в счёт), иначе в новом detached worktree `<worktree.root or .claude/worktrees>/<repo>-pr-<N>`, подготовленном через `commands.prepare_tree`, гоняет `commands.verify` или gate fast с exit code и делает там commit; checkout человека не трогает. `checks` читает упавшие checks и их логи без отметок агентов и лишь называет check, который красный и на базовой ветке. `comments` берёт ждущие review threads, review с `CHANGES_REQUESTED` и вердикты `REJECTED` (и когда ни один thread не ждёт) и `fixPlan` черновиков, спрашивает перед изменением дизайна, scope или UX и передаёт ответы в `pr-reply-draft`. `conflicts` сначала называет файлы в конфликте через `git merge-tree` против head базы; без конфликта он ничего не меняет: ушедшая вперёд база — не повод для rebase. Конфликт, которому нужно решение о дизайне или scope, задаётся вопросом, а без человека ничего не меняется. Иначе политика следует режиму Profile-а: в Full mode — rebase на базу в worktree, в Silent mode — merge commit базы и никогда rebase или force-push. Push он делает только на ответ "Push" на свой вопрос "Push N commit(s) to <branch>?", или, после rebase в Full mode, "Force-push (with lease) N commit(s) to <branch>?", сказав перед этим, что после push отметки агентов остаются на старом commit-е. Rebase уходит только с `--force-with-lease=<branch>:<head before the rebase>`, никогда голым `--force`; если ветка на GitHub ушла вперёд, lease отказывает, и skill больше ничего не пушит. "Not now" или отсутствие человека оставляют commit-ы в worktree, а в режиме `conflicts` отчёт говорит, что их отменяет `git reset --hard <head>` в этом worktree. Он ничего не вливает, не публикует, не resolve-ит и не ставит label-ов. Eval-случаи `pr-fix-checks`, `pr-fix-comments`, `pr-fix-conflicts` (Full mode) и `pr-fix-conflicts-silent` проверяют, что работа попадает в worktree, что конфликт решается rebase-ом или merge commit-ом, как велит режим, и что без этого ответа ничего не пушится и не пишется в GitHub |
```

- Что делает: один пример перевода — строка `pr-fix` Ticket-ов 02 и 03; на той же странице число собственных skill-ов стало «тринадцать».
- Почему здесь: Ticket называет шесть страниц `docs/features/ru/` ([Что делаем, п. 1](../issues/06-документы-перевод-adr-context.md#что-делаем)).
- Без него: русская таблица skill-ов не знала бы о `pr-fix`.
- Требование: [Готово, когда](../issues/06-документы-перевод-adr-context.md#готово-когда)
- Риски и пробелы test-ов: `scripts/check-feature-docs.mjs` русские страницы не читает; совпадение по смыслу проверяет только review. Механически сверены числа заголовков, строк таблиц и пунктов списков en/ru и существование относительных ссылок.

## 5. Вне списка файлов: пять скриптов Harness на английской странице

Code: `docs/features/harness.md:355-364` · key lines: 358, 359, 363, 364

```markdown
| `review-history` | Reads the review history of a Project's pull requests on GitHub through `gh api graphql`, keeps the words of the team's reviewers in `<Profile folder>/state/human-review/` and says how much there is, with a token estimate: the input of the team reviewer skill. No model runs in it |
| `shortcut-ledger` | Lists the `shortcut:` comments of a work tree, one row each |
| `verdict` | Prints a reviewer's answer from its verdict line on: the first line that starts with `VERIFIED` or `REJECTED` (also after `NARROW:`, bold, a heading mark or a backtick; never inside a fenced code block), a sentence above it and the markup dropped. Exit 1 when no line carries a verdict; nothing is guessed. Skill `epic-wave` records a verifier's verdict through it, and the app reads verdicts by the same rule |
| `story-check` | Checks a Code story against the code of the PR's head, never the main branch: the title, the header line, the steps and their fields, every quoted fragment line by line, and personal data |
| `evidence-check` | The privacy check of what a branch adds to the Tickets root before it reaches the repository: text line by line, and the metadata of images and clips (not their pixels or frames) |
| `code-map` | The code map of a repository, kept next to the Profile, with a commit for each folder |
| `worktree-lock` | The advisory lock on a working tree, see [Hooks](skills-agents-and-hooks.md#hooks) |
| `start-context` | Estimates each agent's starting context in tokens, see [Agents](skills-agents-and-hooks.md#agents) |
| `gate-failures` | The failure records of the Gate: which tests failed in which runs, on which computer. Each subcommand is a module of its own |
| `loop-log` | The loops the call log saw: each case of an agent that repeated a call a fourth time, and the count of cases |
```

- Что делает: таблица скриптов называет все 28 программ `harness/bin/` (без `TICKETS.md` и `tests/`), строка частей Harness — «The 28 programs below» вместо «20»; то же — в `ru/harness.md`.
- Почему здесь: при переводе нашлось расхождение английской страницы с `harness/bin/`; Orchestrator разрешил исправить его в этом PR. Описания взяты из заголовков самих скриптов.
- Без него: страница говорила бы «20 программ» при 23 строках и 28 файлах.
- Требование: не записано
- Риски и пробелы test-ов: `check-feature-docs.mjs` проверяет, что пути существуют, но не что таблица полна.

## 6. Что сознательно не меняли

Остальные английские страницы не тронуты, кроме пропусков, которые нашли переводчики: их Orchestrator велел закрыть в
этом PR. `app-shell.md` — Notifications восьмая Feature, а не шестая; на Linked machine только для чтения неактивны и
Fix checks, Resolve conflicts, Address comments (`src/renderer/palette/commands.ts:364`). `workflow.md` — отказы при
Autopilot и при занятом Wave-ой Orchestrator-е (`src/main/actions/launch.ts:359`, `:384`), Linked machine,
`PrFollow.tsx` и `pr-follow-choices.ts` в Implementation. `projects.md` — `… queued in this Session`
(`src/main/actions/launch.ts:178`) и отказы `src/shared/actions/pr-follow.ts:41-42`. Метки этих трёх ru-страниц и
`ru/harness.md` — `same-pr`. В `ru/notifications.md` переведён только раздел «Утренний дайджест», на который ссылается
`ru/app-shell.md`; метка — `41f4e01b`, английская версия до раздела, поэтому `feature-docs-lag.mjs` по-прежнему
показывает отставание остальной страницы.

## 7. Как проверено

`node scripts/check-personal.mjs`, `node scripts/check-feature-docs.mjs`, `node scripts/check-handoff.mjs`,
`node scripts/feature-docs-lag.mjs` — exit 0, ни одна из шести страниц не в списке отстающих. `pnpm lint && pnpm
typecheck && pnpm test` — exit 0. Gate fast — exit 0, но `nothing ran`: документы не входят ни в один пакет gate.

## Проверить себя

1. Почему решения о push и конфликте — Amendment к ADR-0105, а не новый ADR?
   - Ответ: путь сообщения main в Session уже записан в ADR-0108, пункт 5; меняется только граница «main не пушит» из ADR-0105, а изменение решения дописывается Amendment-ом.
   - Строки: `docs/adr/0105-pr-reply-only-on-the-users-click.md:93-95`
2. Почему в Silent mode конфликт решается merge commit-ом, а не rebase?
   - Ответ: ветку командного репозитория мог взять коллега; rebase с force-push переписал бы его историю.
   - Строки: `harness/skills/pr-fix/SKILL.md:180-181`
