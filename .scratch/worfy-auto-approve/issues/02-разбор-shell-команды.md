# 02 — Разбор shell-команды

Type: task
Status: claimed 2026-11-04T13:27Z
Blocked by: —
Source: [spec.md](../spec.md), «Как работает», п. 2; «Безопасность», п. 4; «Решено без владельца», п. 2

Глубина ревью: high (ошибка разбора — одобренная опасная команда).

## Что происходит

- Решать, куда пишет команда, сегодня нечем: guard Harness-а режет её простым `split` по `;`, `&&`, `|`
  (`harness/hooks/guard.mjs:106`) — годится только чтобы запретить.
- Claude Code сам не одобряет `rm` с целью-переменной и многострочный `-c`-скрипт с `rm`: именно эти запросы
  приходят в unattended Session (spec, «Данные»).

## Что делаем

1. **`src/main/agent/auto-approve/shell.ts`** — чистые функции без файловой системы:
   `analyze(command, { cwd, env, platform }): Analysis`, где `Analysis` — либо `{ judged: true, actions }`, либо
   `{ judged: false, why }`. `actions` — по порядку: `{ program, args, cwd, writes: string[], deletes: string[],
   reads: string[], network: boolean }`; пути — после подстановки известных переменных, ещё не `realpath`
   (это Ticket 03).
2. Грамматика (spec, «Как работает», п. 2): простые команды, `&&`, `||`, `;`, `|`, перевод строки, одинарные и
   двойные кавычки, `\`-экранирование, `$VAR` / `${VAR}` из `env` и из присваиваний той же команды, `X=$(mktemp -d)`
   (значение — «новая папка внутри `TMPDIR`»), `cd`, перенаправления `>`, `>>`, `2>`, `<`, glob в последнем
   компоненте. Всё вне грамматики — `judged: false` с причиной (подстановка команды в слове-цели, `eval`, `source`,
   `.`, функции, `for` / `while` / `if` / `case`, here-doc, process substitution, built-in-ы zsh вроде `zmodload`,
   неизвестная переменная, `IFS`, расширение `~user`).
3. `sh -c`, `bash -c`, `zsh -c` с одним аргументом-скриптом — скрипт разбирается тем же `analyze` с тем же `cwd` и
   `env`; многострочный — построчно, `judged` только если разобрана каждая строка.
4. Таблица «что пишет / удаляет» для известных программ: `rm`, `rmdir`, `mv`, `cp`, `mkdir`, `touch`, `ln`, `tee`,
   `git` (`clean`, `worktree remove`, `branch -D`, `push` и его флаги), `curl` / `wget` (`network`, `-o`, `-T`,
   `--data @`). Неизвестная программа — `writes: ['<unknown>']`, политика её не одобрит.

## Готово, когда

- [ ] Unit test таблицей: каждая конструкция вне грамматики даёт `judged: false`; каждый пример из spec
      (`cd <tmp> && rm -rf *`, `rm -rf "$M/$d"`, `T=$(mktemp -d); rm -rf "$T"/*`, многострочный `zsh -c` с `rm`)
      разобран с верными путями. Форма с `;` перечисляет и цель `/*` (на случай упавшего `mktemp`), поэтому
      одобрять её нельзя; без `/*` разобраны `T=$(mktemp -d) && rm -rf "$T"/*` и `… || exit 1; rm -rf "$T"/*`
      (spec, «Проблема»; Ticket 03).
  - evidence: test-run pass · `pnpm vitest run --project node test/unit/auto-approve-shell.test.ts` exit 0 · mac - · ad5417fe2ccb75ffcfc74ce2df4f93d1892502f1
  - evidence: test-run pass · `pnpm test` exit 0 (test/unit/auto-approve-shell.test.ts, 300 tests, exact reason of every refusal) · mac - · c39ef44b32932226e5746cfa0e348fe9db3a5801
- [ ] Differential test: для набора команд без побочных эффектов (`printf '%s\0'` вместо программы) слова, которые
      даёт `analyze`, совпадают со словами настоящего `sh` (и `bash` на Windows через Git Bash); расхождение — test
      красный.
  - evidence: test-run pass · `pnpm vitest run --project contract test/contract/auto-approve-shell-sh.test.ts` exit 0 (sh, dash, bash, zsh on macOS) · mac - · ad5417fe2ccb75ffcfc74ce2df4f93d1892502f1
  - evidence: test-run pass · `pnpm test` exit 0 (test/contract/auto-approve-shell-sh.test.ts: sh, dash, bash, zsh on macOS) · mac - · c39ef44b32932226e5746cfa0e348fe9db3a5801
  - evidence: test-run pass · CI job windows (2/3) / full-suite, run 41862352623: test/contract/auto-approve-shell-sh.test.ts 21 tests on Git Bash, exit 0 · windows - · 0ef9b1bf48da28af56d0f351149bbf5b665b0304
  - evidence: test-run pass · CI job macos-tests, run 41862352623: test/contract/auto-approve-shell-sh.test.ts 87 tests (the darwin guard puts it there), exit 0 · mac - · 0ef9b1bf48da28af56d0f351149bbf5b665b0304
- [ ] Windows: `\` в путях, форма `/c/Users/…`, регистр — тот же результат, что на macOS и Linux.
  - evidence: test-run pass · `pnpm vitest run --project node test/unit/auto-approve-shell.test.ts` exit 0 (describe Windows (Git Bash), platform win32) · mac - · ad5417fe2ccb75ffcfc74ce2df4f93d1892502f1
  - evidence: test-run pass · `pnpm test` exit 0 (describe Windows (Git Bash), platform win32, rm -rf ~/x/* agrees with Linux) · mac - · c39ef44b32932226e5746cfa0e348fe9db3a5801
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на Linux, macOS, Windows.
  - evidence: gate pass · `gate fast` exit 0 · mac - · ad5417fe2ccb75ffcfc74ce2df4f93d1892502f1
  - evidence: gate pass · `gate fast` exit 0 · mac - · c39ef44b32932226e5746cfa0e348fe9db3a5801
  - evidence: gate pass · CI run 41862352623: ci-ok pass on Linux, macOS, Windows · linux - · 0ef9b1bf48da28af56d0f351149bbf5b665b0304

## Тесты

- Unit `test/unit/auto-approve-shell.test.ts` (новый); contract `test/contract/auto-approve-shell-sh.test.ts`
  (новый, differential, запускает `sh` во временной папке).
- Сначала падающий: `analyze` на `rm -rf $(echo x)` возвращает `judged: true` в заготовке — test краснеет.

## Где в коде

- `src/main/agent/auto-approve/shell.ts` (новый)
- `test/unit/auto-approve-shell.test.ts` (новый)
- `test/contract/auto-approve-shell-sh.test.ts` (новый)

## Итог

Решено без владельца (round 1 и round 2 ревью PR #1372):

1. **`stdinFrom`** — номер действия, чей вывод идёт этому на вход через `|`; так политика видит `curl … | sh`, не
   читая `args`. Во вложенном `-c`-скрипте номер считается в общем списке действий.
2. **`/dev/null` не запись.** Перенаправление в `/dev/null` в `writes` не попадает; `/dev/tcp/…` и `/dev/udp/…` —
   `judged: false` (bash открывает сеть).
3. **git:** `git config` с записью, подкоманда, которую таблица не знает, и alias — `writes: ['<unknown>']`;
   `git config --get` и `--list` — чтение. Факты для Ticket-а 03 — в `ShellAction.git`: `branchDelete` (ветки,
   force) и `push` (remote, refspecs, force, delete, many, `localPath`); push в локальный путь пишет этот путь.
   Переименование и копия ветки, commit без сообщения, `commit -c`, `tag -s` / `-u` / `-a` без `-m`,
   `pull --rebase=interactive`, `rebase --continue` — `judged: false`: они запускают editor или gpg.
4. **`set`:** без действия только `-e`, `-u`, `+e`, `+u` и `-o` / `+o` с `errexit`, `nounset`, `pipefail`.
   `set -x` и `-o xtrace` — `judged: false`: trace раскрывает `PS4`, а там может быть подстановка команды. Опции
   `sh -c` — тоже только `-e`, `-u`; любая другая форма с `c` (`bash -l -c`) — `judged: false`.
5. **Присваивания.** Присваивание перед программой — всегда `judged: false`. Отдельное присваивание — только имени,
   которому shell не даёт смысла: список имён bash, sh и zsh (`PATH`, `PS4`, `GLOBIGNORE`, `EXECIGNORE`,
   `POSIXLY_CORRECT`, zsh `path` / `cdpath` / `fpath`, `_`…) и префиксы (`BASH_`, `ZSH_`, `PS<цифра>`, `GIT_`,
   `LD_`, `DYLD_`, `LC_`…); и не переменной из окружения.
6. **Glob, который может стать опцией.** Glob до `--` у программы таблицы — `judged: false` (`git grep -e x *` при
   файле `-O…`). Исключения — `rm`, `rmdir`, `echo` (у них нет опции, которая называет путь) и операнды `printf`
   после формата; `curl`, `test` и `[` конец опций по `--` не признают.
7. **`ln` — `judged: false` целиком** (ссылка — обход корней), как и `-l`, `-s`, `--link`, `--symbolic-link` у `cp` и
   `-b` / `--backup` у `cp`, `mv`: таблица их не знает. `test -v`, `[ -v`, `-R` — `judged: false`: имя переменной
   с индексом выполняет подстановку.
8. **`exit`** с перенаправлением, с двумя операндами или с не-числом — `judged: false`: такой `exit` может не выйти,
   и shell идёт дальше. Команды после настоящего `exit` в список не попадают.
9. **Продолжение строки** (`\` + newline) — только между словами; внутри слова (`$NA\<newline>ME`) —
   `judged: false`. Числовой glob zsh (`<1-9>`, `<->`), `chdir`, ссылка на `OLDPWD` — `judged: false`.
10. **Windows:** `HOME`, `TMPDIR`, `TMP`, `TEMP` вида `C:\…` скрипт видит как `/c/…` — так их отдаёт MSYS Git Bash;
    поэтому `rm -rf ~/x/*` на Windows и на Linux даёт одно действие. Ticket платформенный: пути Windows.
11. **Маркер новой временной папки** — `<new-temp-folder-N>`; модуль экспортирует `newTempFolderName(n)` и
    `isNewTempFolder(component)`, политика узнаёт папку по ним, не по строке.
12. **macOS в CI.** Contract test требует zsh на macOS (`process.platform === 'darwin'`); этот darwin guard
    включает файл в CI job `macos-tests` (`scripts/ci-scope.mjs`, `DARWIN_GUARD`). Без него pull request запускал
    файл только на Linux и Windows.
13. **Mutation testing** (round 2, свой скрипт в отдельном worktree, unit test-файл): 613 mutant-ов — 197 из списка
    ревьюера, найденные заново по тексту, каждый `fail(…)` убран, каждое имя из списков `SPECIAL`, `BUILTINS`,
    `RESERVED` и других убрано по одному. Убит 581 (5 из них — по зависанию test-а), 17 из списка ревьюера ушли вместе с
    кодом, выжили 15. Все 15 эквивалентны: имена, которые и так ловит префикс (`HISTCHARS`, `HISTNO`, `zsh_…`),
    reserved words, которые раньше отсекает разбор слова (`!`, `{`, `}`, `[[`), и проверки, до которых не доходит
    ни один ввод (строки, которые прошлая проверка уже отклонила с тем же исходом).
