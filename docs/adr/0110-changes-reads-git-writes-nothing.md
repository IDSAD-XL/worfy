# 0110 — Экран Changes читает git, ничего не пишет в репозиторий
Дата: 2026-11-19. Статус: принят.

**Контекст.** Epic `worfy-changes-view` (`.scratch/worfy-changes-view/spec.md`) добавляет экран Changes: diff Ticket-а
против merge-base, Uncommitted, Commit, Compare against. Читает его main process, и читает рядом с агентом, который в
ту же секунду делает `git commit` в том же worktree. Любая запись чтения в `.git` — `index.lock`, переписанный
`.git/index`, новый ref или object — может уронить commit агента («Unable to create '.git/index.lock': File exists») или
поменять его состояние без его ведома; ADR-0005 и так запрещает worfy писать в репозиторий Project-а. До Epic-а в main
не было ни одного вызова `git diff`; `gitRunner` стадий (`src/main/workflow/stages.ts`) держит timeout 10 s и буфер 8 MB,
для целого patch-а этого мало. Решено без владельца 2026-11-19, подтвердить (Ticket 02 Epic-а, раздел spec-а «Решения по
реализации — часть 1»).

**Решение.**

1. **Один runner git на весь экран** — `src/main/changes/git.ts`. Он знает список команд и отказывает любой другой до
   запуска git: `merge-base`, `diff` (и `diff --no-index` для новых файлов), `log`, `show`,
   `ls-files --others --exclude-standard`, `for-each-ref`, `cat-file` только с `-e` или `-s`, `hash-object` без `-w`;
   и ещё три, которые только читают: `check-attr` (атрибут `linguist-generated`), `rev-parse` и `worktree list` (где
   worktree Ticket-а и куда указывает HEAD — так же спрашивает reader workflow). Отказ получает и форма команды, которая
   пишет файл: `--output` у любой команды. Никогда — `fetch`, `add`, `stash`, `update-index`, `commit`, `checkout`,
   `reset`, `gc`, `maintenance`.
2. **Каждый запуск без записи.** Окружение: `GIT_OPTIONAL_LOCKS=0` (без необязательных lock-ов) и `GIT_TERMINAL_PROMPT=0`;
   переменные, которые уводят git в другой репозиторий или index (`GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`…),
   убираются. Настройки: `-c diff.autoRefreshIndex=false`, `-c core.fsmonitor=false`, `-c core.quotePath=false`. У
   `diff`, `log` и `show` — `--no-ext-diff`, `--no-textconv`, `--no-color`: никакая программа из конфигурации
   репозитория не запускается.
   - `diff.autoRefreshIndex=false` обязателен. `git diff` против рабочего дерева, увидев файл, у которого сменился stat,
     а текст тот же, обновляет stat в index и переписывает `.git/index`; `GIT_OPTIONAL_LOCKS=0` этой записи не
     останавливает (проверено на git 2.50: после `GIT_OPTIONAL_LOCKS=0 git diff HEAD` mtime и байты index другие). Spec
     считал, что хватит `GIT_OPTIONAL_LOCKS=0`; contract test показывает обратное. Цена: в `--raw` такой файл остаётся
     со stat-изменением, поэтому список файлов строится по `--numstat`, где его нет.
3. **Имена и Windows.** Имена — через `-z` там, где git их печатает, и `core.quotePath=false`: путь с пробелами и не-ASCII
   приходит как есть. Заголовок patch-а git всё равно берёт в кавычки, если в имени управляющий символ, `"` или `\`, и
   ставит TAB после имени с пробелом в `---`/`+++` — разбор (`src/shared/changes/parse.ts`) читает оба случая. Строки
   CRLF приходят без `\r` и с пометкой; Hide whitespace — `-w --ignore-cr-at-eol`. Contract test-ы чтения
   (`test/contract/changes-read.test.ts`) идут и на Windows runner-е CI.
4. **Предел размера.** Список файлов (`--raw --numstat`) читается всегда целиком, до 256 MB вывода. Patch файла — только
   по запросу (`changes.file`); больше 2 000 строк или 1 MB, lock-файл менеджера пакетов и файл с `linguist-generated`
   приходят свёрнутыми, без запуска `git diff` для строк; развернуть можно до 64 MB, дальше — ошибка, а не память main.
5. **База — из фактов Profile-а, которые main уже держит** (`worktree.base`, `workflow.finish` в `ProjectLayout`), в
   порядке preflight Harness: `worktree.base`, `origin/<default_branch>`, `origin/HEAD`, `origin/main`; без `origin` и с
   `local-green` — локальная ветка. Отсчёт — от `git merge-base <база> HEAD`. `origin` не обновляется: Changes видит то,
   что оставил последний fetch (свой fetch main — ADR-0107, он не часть этого экрана).
6. **Каналы** `changes.scopes`, `changes.list`, `changes.file`, `changes.commits` — `'project', 'read'`: каналов записи у
   экрана в части 1 нет, Linked machine с доступом Read only читает diff (ADR-0066).
7. **Проверка.** Contract test читает все scope-ы над временным репозиторием с worktree, в котором у одного файла
   сменился stat при том же тексте, и сравнивает все файлы `.git` (размер и mtime, байты обоих index) до и после;
   затем показывает, что простой `git diff` в том же worktree index переписывает, — значит, проверка такую запись видит.

**Последствия.**

- Новый вызов git в Changes идёт только через этот runner; команда вне списка требует поправки к этому ADR.
- Stat-изменения без изменения текста экран не показывает, но и не чинит: index обновит следующий `git status` агента
  или пользователя.
- Чтение GitHub (PR как предмет, часть 2 Epic-а) допишет сюда Amendment.

## Considered Options

- **`gitRunner` стадий** (`src/main/workflow/stages.ts`). Отброшен: timeout 10 s и буфер 8 MB, нет `GIT_OPTIONAL_LOCKS=0`
  и нет списка команд.
- **Только `GIT_OPTIONAL_LOCKS=0`**, как у `src/main/work-track/ticket-status.ts`. Отброшен: `git diff` против рабочего
  дерева всё равно переписывает index (пункт 2).
- **Копия index во временной папке (`GIT_INDEX_FILE`).** Работает и не даёт stat-шума, но копирует index на каждый запрос
  и уводит git от index, который видит агент; `diff.autoRefreshIndex=false` даёт то же без копии.
- **Plumbing (`diff-index`, `diff-files`) вместо `git diff`.** Они не пишут index, но не умеют `--no-index` и сами не
  отсеивают stat-изменения; `git diff` с выключенным refresh проще и печатает тот же формат.
