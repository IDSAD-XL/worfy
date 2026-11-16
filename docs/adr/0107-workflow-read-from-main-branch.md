# 0107 — worfy читает workflow из main-ветки, а не из рабочего дерева
Дата: 2026-11-16. Статус: принят.

**Контекст.** До этого решения worfy читал список Epic-ов и Ticket-ов из рабочего дерева основной папки Project-а:
`epic-status --json` без `--ref`, а spec-и, текст Ticket-ов, раздел `## Где в коде`, `HANDOFF.md` и `docs/adr` — с диска.
Папка показывала то, что в ней лежит: её HEAD, её ветку, её отставание и её неотслеживаемые файлы. 2026-11-16 Epic
`worfy-code-stories`, влитый в main (#1888), не появился в worfy: папка отстала от `origin/main` на 4 commit-а (detached
HEAD, неотслеживаемые файлы на пути нового Epic-а мешали fast-forward). Никто в `src/` не делал `git fetch`. Владелец:
«ветка, которую читает worfy, всегда, безусловно, без каких-либо условий отражала правильное состояние»
(`.scratch/worfy-polish/issues/118-список-epic-ов-из-main-а-не-из-папки-project-а.md`).

**Решение.**

1. **Источник правды — main-ветка Project-а.** В режиме Full, когда корень Ticket-ов лежит в git, worfy читает
   commit main-ветки, а не рабочее дерево:
   - `workflow.finish` = `pr-green-ci` (и когда Profile его не называет): `refs/remotes/origin/HEAD`, иначе
     `refs/remotes/origin/<main>` — так же базу выбирает `harness/bin/preflight`;
   - `workflow.finish` = `local-green` (Ticket-ы вливаются локально, без PR): локальная `refs/heads/<main>`, а не
     HEAD папки, — когда папка в detached HEAD или на посторонней ветке. Папка на `<main>` или на ветке Ticket-а
     читается как есть: в `local-green` именно там Harness пишет статус (`ticket claim`), и эта правка ещё не
     закоммичена; чтение одного commit-а прятало бы claim (так ломался demo Getting started);
   - `<main>` — ветка из `worktree.base` Profile-а без `origin/`, иначе `main`.
   Выбор делает `src/main/workflow/main-ref.ts` (`resolveSource`).
2. **Всё видимое — из одного commit-а.** Список — `epic-status --json --ref <sha>`; spec-и, текст Ticket-ов и раздел
   `## Где в коде` (`enrichSnapshot`), текст Ticket-а в его карточке (`tickets.read`), `HANDOFF.md` и ADR (`docs`) —
   из git objects того же commit-а: один `git ls-tree -r -z` нужных папок и один `git cat-file --batch` на чтение, не
   `git show` на файл. Смеси «список из ref, текст с диска» нет. Sha commit-а — ключ кэша чтения: событие рабочего
   дерева без движения ref-а не перечитывает список; ref сдвинулся — перечитывается, и документы тоже.
3. **Fetch.** Main process делает `git fetch --prune origin <main>` при старте watch-а Project-а, раз в 2 минуты, пока
   он открыт, и при фокусе окна, не чаще раза в 30 с (`src/main/workflow/fetch.ts`). Окружение — login shell, то же,
   что у `epic-status`; `GIT_TERMINAL_PROMPT=0`, timeout 60 с, без `gc`/`maintenance`, без записи `FETCH_HEAD`. Ошибка
   fetch никогда не ломает чтение: список остаётся на последнем commit-е. Watch ref-ов следит за `refs/remotes/**` и
   `packed-refs`, так что fetch из терминала тоже вызывает перечитывание. В режиме `local-green` fetch не нужен и не
   идёт.
4. **Видно, откуда данные.** Модель несёт `source` (ref, sha, время последнего удачного fetch, причина). Когда main-ветка
   не разрешается (нет `origin`, пустой repository) — читается рабочее дерево, как раньше, и у списка Epic-ов строка
   «As of <short sha>» с причиной. Когда fetch не удаётся дольше 10 минут — та же строка с временем последнего
   обновления и ошибкой fetch. Пока всё свежо, строки нет.
5. **Ветки Ticket-ов.** Наложение статусов из локальных worktree `<epic>/<NN>` (`applyBranches`, ADR-0033) остаётся.
   Основная папка, когда она сама стоит на ветке Ticket-а (`parallel: single`), теперь тоже такой worktree: её claim
   накладывается на main, а не пропадает. Ticket-ы, взятые только на удалённой ветке или в PR без локального worktree,
   — вне этого решения.
6. **Поправка к ADR-0005** («worfy ничего не пишет в репозитории проектов»): `git fetch` пишет в `.git` Project-а
   objects и `refs/remotes/origin/<main>` — ровно то, что пишет любой fetch. Рабочее дерево, index, HEAD и локальные
   ветки он не трогает; contract test `test/contract/workflow-read-from-main.test.ts` это проверяет.

**Последствия.**

- **Silent mode** не меняется: Workflow folder не лежит ни в одной ветке (ADR-0042), рабочее дерево и есть правда.
  Корень Ticket-ов вне git — тоже рабочее дерево, без строки «As of».
- **Несколько repository** (ADR-0104): Project, чей корень — папка над repository и сам не repository, читается из
  рабочего дерева, как раньше. Ветки Ticket-ов в repository, которые называют его `Repo:` строки, читаются как прежде.
- Правка Ticket-а в рабочем дереве папки, не закоммиченная и не влитая в main, больше не видна в списке, пока не
  попадёт в main (или в ветку Ticket-а с worktree). Так и задумано: список показывает main.
- Fetch одновременно с `git fetch` пользователя может получить «cannot lock ref»; это ошибка одного fetch, следующий
  через 2 минуты.
- Specs без статуса Ticket-ов сортируются по mtime файла на диске, а если его в папке ещё нет — по времени commit-а.

## Considered Options

- **Рабочее дерево + автоматический fast-forward папки.** Отброшен: папку держат чужие Session-ы (основной checkout
  занят Orchestrator-ом), неотслеживаемые файлы и detached HEAD мешают fast-forward, а запись в рабочее дерево нарушает
  ADR-0005 сильнее, чем fetch.
- **Скрытый собственный worktree на main.** Отброшен: второй checkout на Project — место на диске, `git worktree list`
  с лишней записью, его тоже нужно обновлять, а git objects дают то же без checkout-а.
- **`git show <ref>:<path>` на каждый файл.** Отброшен: сотни процессов на одно чтение Project-а с сотнями Ticket-ов;
  `git cat-file --batch` читает всё одним процессом.
- **Только `epic-status --ref`, остальное с диска.** Отброшен: spec Epic-а, которого ещё нет в папке, и текст Ticket-а
  расходились бы со списком — та смесь, которую запретил владелец.
