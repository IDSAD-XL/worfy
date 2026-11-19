# 02 — Чтение diff-а Ticket-а в main: только чтение git, база, scope-ы, каналы `changes.*`, новый ADR

Type: task
Status: claimed 2026-11-19T12:55Z
Blocked by: —
Source: [spec.md](../spec.md), «Ticket-ы», 2; «Решения по реализации — часть 1»: «Только чтение git», «Предмет части
1», «База», «Scope-ы части 1», «Каналы», «Предел размера», «Файлы workflow», «Windows», «ADR»; «Решения по test-ам —
часть 1», seam 1 и 2

Кто: агент.

Платформенный Ticket: git на Windows (пути через `-z`, `core.quotePath=false`, CRLF) — contract test-ы идут на
Windows runner-е CI. Глубина ревью — `high`: чтение рядом с commit-ами агента в том же worktree.

## Что происходит

- В main нет ни одного вызова `git diff`. Worktree-ы Ticket-ов читает `ticketWorktrees`
  (`src/main/workflow/reader.ts:560`), ветки Ticket-ов Project-а над несколькими репозиториями — `ticketBranches`
  (`:621-629`, ADR-0104).
- `gitRunner` (`src/main/workflow/stages.ts:47-58`) — таймаут 10 s и буфер 8 MB: на целый patch не хватит.
- Чтение без блокировок уже есть: `src/main/work-track/ticket-status.ts` запускает git с `GIT_OPTIONAL_LOCKS=0` и
  `GIT_TERMINAL_PROMPT=0` (правило — `:16`, окружение — `:276-278`).
- База: main читает `worktree.base` и `workflow.finish` Profile-а — поля `mainBranch` и `finish`
  (`src/main/workflow/profile.ts:717-720`, схема `:725-729`), `mainBranchName` (`src/main/workflow/main-ref.ts:98`).
  Запасной порядок при `null` — `harness/profiles/README.md:173`.
- Корень Ticket-ов в Full mode — `.scratch/` checkout-а (`src/main/workflow/folder.ts`; `src/main/workflow/reader.ts:9-11`).
- Каналы: файл на домен, `src/main/ipc/index.ts` находит новый домен сам (`:4-6`, ADR-0006); правила доступа —
  `src/shared/ipc/channels.ts:21-52`.

## Что делаем

1. `src/main/changes/git.ts` — свой запуск git: `GIT_OPTIONAL_LOCKS=0`, `GIT_TERMINAL_PROMPT=0`,
   `-c core.quotePath=false`, `--no-ext-diff`, `--no-color`, `-z`; без лимита 8 MB на список, свой предел на patch.
   Разрешённые команды — список в коде (`merge-base`, `diff`, `log`, `show`, `ls-files --others --exclude-standard`,
   `for-each-ref`, `cat-file -e`, `hash-object` без `-w`, `diff --no-index`); другие отвергаются.
2. `src/main/changes/subjects.ts` — предмет Ticket: worktree, а без него ветка; в Project-е над несколькими
   репозиториями — по репозиторию, репозиторий — верхний уровень ответа.
3. `src/main/changes/base.ts` — база: `mainBranch` Profile-а; при `null` — `origin/<default_branch>`, `origin/HEAD`,
   `origin/main`; без `origin` и с `local-green` — локальная ветка. Merge-base — `git merge-base <база> HEAD`.
4. `src/main/changes/scopes.ts` — All changes (`git diff <merge-base>` и новые файлы через `diff --no-index`),
   Uncommitted (`git diff HEAD` и новые файлы), Commit (`git log <merge-base>..HEAD`, `git show`), Compare against
   (ветки из `for-each-ref`).
5. `src/shared/changes/parse.ts` и `src/shared/changes/types.ts` — чистый разбор: файлы, статус, `+/−`, hunk-и,
   строки с номерами двух сторон, rename, binary с размерами, смена режима, «\ No newline at end of file», CRLF.
   Предел: patch больше 2 000 строк или 1 MB, lock-файлы и `linguist-generated` — свёрнуты («Large diff · N lines»).
   Файлы под `.scratch/` в Full mode помечены группой Workflow files.
6. Каналы `src/shared/ipc/changes.ts` и `src/main/ipc/changes.ts`: `changes.scopes`, `changes.list`, `changes.file`
   (с «Show whole file»), `changes.commits` — все `'project', 'read'`.
7. Новый ADR в `docs/adr/` (номер резервирует implementer по правилу ship-ticket): «Экран Changes читает git, ничего не
   пишет в репозиторий» — список команд, `GIT_OPTIONAL_LOCKS=0`, никаких `fetch`, `add`, `stash`, `update-index`;
   статус «принят», в контексте пометка «решено без владельца 2026-11-19, подтвердить».
8. Английская страница `docs/features/changes.md` (новая, по шаблону `docs/features/README.md`): раздел о чтении —
   предмет, база, scope-ы, пределы, «worfy ничего не пишет в репозиторий»; строка страницы в таблице
   `docs/features/README.md`. Перевод — Ticket 06.

## Готово, когда

- [ ] Unit test-ы (`test/unit/changes-parse.test.ts`): rename, binary, «No newline at end of file», CRLF, пути с
      пробелами и не-ASCII, свёрнутый большой и lock-файл.
- [ ] Unit test-ы (`test/unit/changes-base.test.ts`): база по `worktree.base`, по запасному порядку, без `origin` с
      `local-green`.
- [ ] Contract test (`test/contract/changes-read.test.ts`, временный репозиторий, `NO_GIT_MAINTENANCE` —
      `test/git-env.ts:14`): worktree против merge-base с новыми файлами, Commit, Uncommitted, Compare against; Ticket
      в двух репозиториях.
- [ ] Contract test: после всех чтений байты и mtime `.git/index` прежние, новых refs и объектов нет.
- [ ] Те же contract test-ы зелёные на Windows runner-е CI.
- [ ] Новый ADR влит; в контексте — «решено без владельца 2026-11-19, подтвердить».
- [ ] Английская страница `docs/features/changes.md` описывает чтение; `node scripts/check-feature-docs.mjs` — exit 0.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

## Где в коде

- `src/main/changes/git.ts`, `src/main/changes/subjects.ts`, `src/main/changes/base.ts`, `src/main/changes/scopes.ts`
  (новые)
- `src/shared/changes/parse.ts`, `src/shared/changes/types.ts` (новые)
- `src/shared/ipc/changes.ts`, `src/main/ipc/changes.ts` (новые)
- `test/unit/changes-parse.test.ts`, `test/unit/changes-base.test.ts`, `test/contract/changes-read.test.ts` (новые)
- `docs/adr/<номер>-changes-reads-git-writes-nothing.md` (новый)
- `docs/features/changes.md` (новый), `docs/features/README.md` (строка в таблице раздела «Pages», `:15-52`)

Только читать: `src/main/workflow/reader.ts:560`, `:621-629`; `src/main/workflow/profile.ts:717-729`;
`src/main/workflow/main-ref.ts:92-98`; `src/main/work-track/ticket-status.ts:16`, `:276-278`;
`src/shared/ipc/channels.ts:21-52`; `test/git-env.ts:14`.

## Вне скоупа

- Предмет Session и PR, Last turn и заготовка `TurnChangesPart`, Viewed, `changes.markViewed` и `changes.markSeen`,
  `changes.updated` — часть 2. Канал `changes.targets` — Ticket 05. Renderer — Ticket 03.
