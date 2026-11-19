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
   запуска процесса: `merge-base`, `diff` (и `diff --no-index` для новых файлов), `log`, `show`, `ls-files`,
   `for-each-ref`, `cat-file`, `hash-object`; и ещё три, которые только читают: `check-attr` (атрибут
   `linguist-generated`), `rev-parse` и `worktree` (где worktree Ticket-а и куда указывает HEAD — так же спрашивает
   reader workflow). Команды, у которых есть пишущие формы, проходят только в одной форме, которую запускает экран:
   `ls-files --others --exclude-standard -z`, `hash-object --no-filters --stdin-paths` (никогда `-w`),
   `worktree list --porcelain` (не `add`, `remove`, `prune`), `cat-file -e <object>` и `cat-file -s <object>`. Отказ
   получает и форма команды, которая пишет файл: `--output` и `-o` у любой команды. Никогда — `fetch`, `add`, `stash`,
   `update-index`, `commit`, `checkout`, `reset`, `gc`, `maintenance`.
2. **Каждый запуск без записи.** Окружение: `GIT_OPTIONAL_LOCKS=0` (без необязательных lock-ов), `GIT_TERMINAL_PROMPT=0`
   и `GIT_LITERAL_PATHSPECS=1` (путь после `--` — путь, а не шаблон или `:(magic)`); переменные, которые уводят git в
   другой репозиторий или index (`GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`…), убираются при любом регистре имени
   (Windows его не различает). Настройки: `-c diff.autoRefreshIndex=false`, `-c core.fsmonitor=false`,
   `-c core.quotePath=false`. У `diff`, `log` и `show` — `--no-ext-diff`, `--no-textconv`, `--no-color`: ни внешний diff,
   ни textconv не запускаются.
   - Одна программа конфигурации всё же может запуститься: `git diff` против рабочего дерева пропускает файл, у
     которого сменился stat, через clean filter, который назначает ему `.gitattributes` (`filter.<имя>.clean`, например
     git-lfs). Сам filter определяется в конфигурации git пользователя, а не в репозитории, и ничего не пишет в `.git`
     сам по себе; флага, который выключает его у `git diff`, нет. `hash-object` новых файлов идёт с `--no-filters`: id
     нового файла — id его байтов как есть; у файла с filter-ом или преобразованием концов строк он отличается от id,
     который дал бы `git add`.
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
4. **Только пути репозитория.** `changes.file` принимает путь от верхней папки репозитория: абсолютный путь и путь с частью `..`
   отвергают и схема канала (в main Machine-а, чей это репозиторий), и сам reader. Абсолютен `/x` везде; `\x` и `C:x`
   абсолютны только на Windows, и только там `\` делит путь на части: на macOS и Linux `c:notes.md` и
   `back\..\slash.txt` — обычные имена файлов, и экран их открывает. Новый файл читается через
   `diff --no-index` — а он прочёл бы любой файл Machine, — только если `ls-files --others --exclude-standard` этого
   репозитория его называет: игнорируемый файл и файл вне репозитория так не читаются (канал — `'read'`, его зовёт и
   Linked machine с доступом Read only).
5. **Предел размера.** Список файлов (`--raw --numstat`) читается всегда целиком, до 256 MB вывода. Patch файла — только
   по запросу (`changes.file`); больше 2 000 строк или 1 MB, lock-файл менеджера пакетов и файл с `linguist-generated`
   приходят свёрнутыми, без запуска `git diff` для строк; развернуть можно до 64 MB, дальше — ошибка, а не память main.
6. **База — из фактов Profile-а, которые main уже держит** (`worktree.base`, `workflow.finish` в `ProjectLayout`), в
   порядке preflight Harness: `worktree.base`, `origin/<default_branch>`, `origin/HEAD`, `origin/main`; без `origin` и с
   `local-green` — локальная ветка. Отсчёт — от `git merge-base <база> HEAD`. `origin` не обновляется: Changes видит то,
   что оставил последний fetch (свой fetch main — ADR-0107, он не часть этого экрана).
7. **Каналы** `changes.scopes`, `changes.list`, `changes.file`, `changes.commits` — `'project', 'read'`: каналов записи у
   экрана в части 1 нет, Linked machine с доступом Read only читает diff (ADR-0066).
8. **Проверка.** Contract test читает все scope-ы над временным репозиторием с worktree, в котором у одного файла
   сменился stat при том же тексте, и сравнивает все файлы `.git` (размер и mtime, байты обоих index) до и после;
   затем показывает, что простой `git diff` в том же worktree index переписывает, — значит, проверка такую запись видит.
   Unit test runner-а (`test/unit/changes-git.test.ts`) подменяет запуск процесса и проверяет, что отвергнутая
   команда процесса не запускает, а у каждого запуска — эти настройки и это окружение.

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
