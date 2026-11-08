# 72 — `worktree-lock` убирает записи worktree, которых больше нет

Type: task
Status: open
Blocked by: —
Source: решение владельца 2026-11-06, Q5 (бриф Orchestrator-а, «со всем согласен»): папка
`~/.claude/worfy-harness/worktree-sessions/` растёт без предела; замер Orchestrator-а 2026-11-05 — 101 из 193 файлов
относятся к удалённым worktree, 772K.

## Что происходит

- `bin/worktree-lock` (Harness) — advisory lock на рабочее дерево: hook-и SessionStart (`claim`), Stop (`beat`) и
  SessionEnd (`release`) пишут, какие Session сейчас в дереве (`harness/hooks/hooks.json:45`, `:98`, `:138`).
- Реестр — по файлу на дерево: `$HARNESS_HOME/worktree-sessions/<slug>.json`, `slug` — путь корня дерева с заменой
  не-букв на `-` и 8 знаков sha1 пути (`harness/bin/worktree-lock:77-81`; `HARNESS_HOME` по умолчанию
  `~/.claude/worfy-harness`, в eval run-е — `EVAL_HARNESS_HOME`). Запись Session — `{ started, seen, cwd, branch,
  told }` (`:248`, `:258-264`).
- Файл никто не удаляет. `release` убирает только запись своей Session (`:275-279`) и оставляет `{}`; мёртвые записи
  (старше `WORKTREE_LOCK_TTL_MIN`, 60 минут) выпадают при чтении (`sane`, `:95-102`, `:166`), но файл остаётся.
  Файлы `.tmp` старше 15 с подметаются (`:155-162`), `.json` — нет.
- Каждый worktree тикета (`.claude/worktrees/<NN>`) и каждый isolated worktree агента оставляют свой файл навсегда:
  дерево удалено после merge, файл реестра — нет.
- Замер 2026-11-05 (Orchestrator): 193 файла, 101 — деревья, которых нет, 772K. Замер 2026-11-06 (только чтение):
  197 файлов, 788K; у 104 файлов `cwd` всех записей не существует; 72 файла — пустой `{}` после `release`; битых JSON
  нет.
- Путь корня в файле не хранится: имя файла — необратимый `slug`, а в записи есть только `cwd` Session (корень или
  папка внутри него).

## Что делаем

1. **Корень дерева в записи.** `claim` и `beat` пишут в запись поле `root` (корень дерева, `rev-parse --show-toplevel`,
   уже посчитан в `:68`). Старые записи без `root` читаются как раньше.
2. **Уборка реестра — функция `prune`** в `worktree-lock`: проходит `*.json` папки `worktree-sessions` и удаляет файл,
   если
   - (а) у всех записей папка дерева не существует: `root` записи, для старой записи без `root` — её `cwd`;
   - (б) в файле нет записей (`{}` после `release`).
   Файл с хотя бы одной записью, чья папка есть, остаётся целиком — даже если все записи старше TTL. Файл, который не
   читается или не JSON, не трогается (`status` уже говорит человеку его удалить).
3. **Под mutex-ом файла.** Удаление — только когда взят mutex `<file>.lock` (тот же `mkdir`, что у `withRegistry`), с
   повторным чтением и повторной проверкой папок под ним: Session, которая в этот момент делает `claim` в заново
   созданном дереве с тем же путём, не теряет запись. Mutex занят — файл пропускается без ожидания.
4. **Когда.** `claim` (SessionStart) запускает `prune` не чаще раза в сутки: метка `worktree-sessions/.pruned`, её mtime —
   время последней уборки. Уборка не задерживает старт Session: ошибки молчат (exit 0, пустой stdout, как у всего
   hook-режима), предел — 200 мс на проход, остаток — в следующий раз.
5. **Руками.** Подкоманда `worktree-lock prune` — уборка сейчас, без метки суток; печатает «removed N of M registry
   files». `usage` и шапка файла называют её.
6. Строка в `harness/README.md` (раздел про `worktree-lock`): реестр сам убирает файлы удалённых деревьев.

## Готово, когда

- [ ] Shell test `harness/bin/tests/worktree-lock-prune.test.sh` (новый; `HOME` и `HARNESS_HOME` — во временном
      каталоге, настоящий `~/.claude` не трогается) зелёный, случаи:
  - evidence: test-run pass · `bash harness/bin/tests/worktree-lock-prune.test.sh` exit 0 (passed 29, failed 0) · mac - · c5dd1e7ed
      - дерево удалено (`rm -rf` папки после `claim`) → `worktree-lock prune` удаляет его файл, печатает «removed 1 of …»;
      - дерево есть, записи старше TTL → файл остаётся;
      - запись без `root` (старый формат), `cwd` не существует → файл удалён; `cwd` есть → остаётся;
      - две записи: одна с удалённой папкой, другая с живой → файл остаётся целиком;
      - `{}` → удалён;
      - файл не JSON → не тронут;
      - mutex файла занят (свежая папка `<file>.lock`) → файл не тронут, `prune` не ждёт;
      - `claim` в другом дереве убирает файл удалённого дерева; второй `claim` в те же сутки уборку не запускает
        (метка `.pruned` свежая — файл удалённого дерева, созданный после первой уборки, остаётся);
      - папка `worktree-sessions` недоступна для чтения → `claim` даёт exit 0 и пустой stdout;
      - запись нового формата несёт `root`.
- [ ] Mutant-ы красные: без проверки (а) (удалять всё), без пункта «хотя бы одна живая папка» (удалять при первой
      мёртвой), без повторной проверки под mutex-ом, без метки суток.
  - evidence: test-run pass · `bash mutants.sh` (four mutants of worktree-lock run against worktree-lock-prune.test.sh in copies of harness/) each exit 1 · mac - · c5dd1e7ed
- [ ] `harness/bin/tests/harness-home.test.sh` и остальные test-ы Harness — exit 0 (`claim` по-прежнему оставляет один
      файл в живом дереве).
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 (684 files passed, all Harness shell tests included) · mac - · c5dd1e7ed
  - evidence: gate pass · `gate fast` exit 0 · mac - · c5dd1e7ed
- [ ] На копии настоящего реестра (вручную): `cp -R ~/.claude/worfy-harness/worktree-sessions` во временный
      `HARNESS_HOME`, `worktree-lock prune` — число удалённых совпадает с замером «папки нет» плюс `{}`; файлы
      открытых сейчас worktree остались. Цифры — в «Итог».
- [ ] Платформенный PR (ADR-0056, пункт 2 — PR со скриптом Harness ждёт вердикта Windows): `ci-ok` зелёный, включая
      Windows job; на Windows путь `root` с `\` и буквой диска проверяется тем же test-ом.

## Где в коде

- `harness/bin/worktree-lock` — `:68` корень, `:77-81` `slug` и папка реестра, `:108-188` `withRegistry` и mutex,
  `:155-162` уборка `.tmp`, `:245-279` `claim`, `beat`, `release`, `:282` `usage`.
- `harness/bin/tests/worktree-lock-prune.test.sh` (новый).
- `harness/bin/tests/harness-home.test.sh:133-134`, `:149`, `:182` — `claim` в чистом `HARNESS_HOME`.
- `harness/README.md` — раздел `worktree-lock`.

Только читать: `harness/hooks/hooks.json:45`, `:98`, `:138`; `harness/hooks/eval-env.cjs` (`harnessHome`).

## Риски

- Удалить файл живого дерева — потерять предупреждение «в этом дереве уже работает Session». Поэтому удаляется только
  файл, у которого нет ни одной существующей папки, и проверка повторяется под mutex-ом.
- Сетевой или отключённый диск: папка дерева «не существует», пока диск не подключён, — файл удалится, и следующий
  `claim` заведёт его заново. Потеря — только запись `told` (о ком уже предупредили), принято.
