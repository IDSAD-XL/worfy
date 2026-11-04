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
      разобран с верными путями.
- [ ] Differential test: для набора команд без побочных эффектов (`printf '%s\0'` вместо программы) слова, которые
      даёт `analyze`, совпадают со словами настоящего `sh` (и `bash` на Windows через Git Bash); расхождение — test
      красный.
- [ ] Windows: `\` в путях, форма `/c/Users/…`, регистр — тот же результат, что на macOS и Linux.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на Linux, macOS, Windows.

## Тесты

- Unit `test/unit/auto-approve-shell.test.ts` (новый); contract `test/contract/auto-approve-shell-sh.test.ts`
  (новый, differential, запускает `sh` во временной папке).
- Сначала падающий: `analyze` на `rm -rf $(echo x)` возвращает `judged: true` в заготовке — test краснеет.

## Где в коде

- `src/main/agent/auto-approve/shell.ts` (новый)
- `test/unit/auto-approve-shell.test.ts` (новый)
- `test/contract/auto-approve-shell-sh.test.ts` (новый)
