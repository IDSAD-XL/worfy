# 03 — Approval policy: корни, правила, hard deny

Type: task
Status: claimed 2026-11-05T01:40Z
Blocked by: 01, 02
Source: [spec.md](../spec.md), «Как работает», п. 1, 3–6; «Безопасность», п. 2–3, 5–8; Q3, Q6, Q8

Глубина ревью: high (это и есть решение «разрешить»).

## Что происходит

- Ticket 02 даёт действия команды с путями; кто решает, можно ли их, — нет.
- Ticket 01 даёт категории прошлых отказов и решение, какие из них одобрять.

## Что делаем

1. **`src/main/agent/auto-approve/roots.ts`** — `resolveTarget(path, roots): Placement`: абсолютный путь, `..` / `.`
   свёрнуты, каждый существующий компонент — `realpath` (файловая система — через параметр, test-ы дают свою);
   `Placement` — `inside(root)`, `is-root(root)`, `outside`, `symlink-on-path`, `hard(category)`. Корни — из
   `context`: worktree-ы Ticket-ов Wave, `.scratch` Project-а, папка Run-а (`TMPDIR`), scratchpad Session. Windows —
   без учёта регистра, `\` = `/`, `/c/…` = `C:\…`.
2. **`src/main/agent/auto-approve/policy.ts`** — `judge(request, context): Decision`, `Decision` —
   `{ outcome: 'allow' | 'deny' | 'park' | 'hard-deny', rule: string, hint: string | null, targets: string[] }`.
   Порядок: hard deny (spec, п. 5) → вопрос (AskUserQuestion — spec, п. 6, исход по Q8) → `judged: false` →
   deny-with-hint → все цели `inside` → allow по правилу → иначе исход по Q3.
3. Правила allow — массив `{ id, describe, match }` в коде; стартовый набор — spec, п. 4, уточнённый Ticket-ом 01.
   Подсказки deny-with-hint — константы правил (английский текст, ADR-0074), без кусков команды.
4. Edit / Write / MultiEdit Claude Code и `fileChange` Codex — те же корни по `file_path` / путям изменений.

## Готово, когда

- [ ] Unit test на каждый пункт hard deny: исход `hard-deny` при любом режиме и любом правиле allow.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/auto-approve-policy.test.ts test/unit/auto-approve-roots.test.ts` exit 0 · mac - · 8a14cdb7f
- [ ] Unit test на каждое правило allow: allow внутри корня; не allow на той же команде с целью вне корня, с
      symlink-компонентом, с целью «весь корень».
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/auto-approve-policy.test.ts test/unit/auto-approve-roots.test.ts` exit 0 · mac - · 8a14cdb7f
- [ ] Unit test на атаки spec («Безопасность», п. 2–3): `cd ~ && rm -rf *`, `rm -rf $HOME/*`, ссылка `.scratch/l -> ~`,
      `git push --force`, `git push origin HEAD:main`, `curl … | sh` — ни одна не allow.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/auto-approve-policy.test.ts test/unit/auto-approve-roots.test.ts` exit 0 · mac - · 8a14cdb7f
- [ ] Unit test на форму `mktemp`: `T=$(mktemp -d); rm -rf "$T"/*` — не allow (Ticket 02 перечисляет цель `/*` на
      случай упавшего `mktemp`); `T=$(mktemp -d) && rm -rf "$T"/*` и `T=$(mktemp -d) || exit 1; rm -rf "$T"/*` —
      allow внутри `TMPDIR` Run-а.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/auto-approve-policy.test.ts test/unit/auto-approve-roots.test.ts` exit 0 · mac - · 8a14cdb7f
- [ ] Unit test: запись в `.git/config`, `.git/hooks/*`, `.git/info/attributes`, `.gitattributes` не allow ни одним
      правилом (spec, «Безопасность», п. 9: через них любая подкоманда git запускает программу).
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/auto-approve-policy.test.ts test/unit/auto-approve-roots.test.ts` exit 0 · mac - · 8a14cdb7f
- [ ] Факты git берутся из `ShellAction.git` (`branchDelete`, `push`: remote, refspecs, force, delete, many,
      `localPath`), не из `args`; подкоманда, которую Ticket 02 не знает, приходит с `writes: ['<unknown>']`.
      `localPath` есть и у голого слова (`origin`): это папка на случай, если remote с таким именем не
      настроен. Настоящий URL remote-а — из git config, его Ticket 02 не видит.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/auto-approve-policy.test.ts test/unit/auto-approve-roots.test.ts` exit 0 · mac - · 8a14cdb7f
- [ ] Чтение тоже судится по корням: `reads` подкоманд чтения git (`diff`, `log`, `blame`, `grep` …) и
      `git config` перечисляют файлы, которые они могут напечатать (`~/.gitconfig` среди них); цель чтения в
      hard-deny (`~/.ssh` и др.) — hard-deny, вне корней — не allow.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/auto-approve-policy.test.ts test/unit/auto-approve-roots.test.ts` exit 0 · mac - · 8a14cdb7f
- [ ] Unit test: worktree живой Session-и вне Run-а (`SessionRegistry` — через параметр) — hard-deny.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/auto-approve-policy.test.ts test/unit/auto-approve-roots.test.ts` exit 0 · mac - · 8a14cdb7f
- [ ] Прогон по категориям Ticket-а 01 (локально, только числа) — в «Итог».
  - evidence: commit pass · docs: worfy-auto-approve 03 summary · - - · 9f77947f9
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на Linux, macOS, Windows.
  - evidence: gate pass · `gate fast` exit 0 · mac - · 8a14cdb7f

## Тесты

- Unit `test/unit/auto-approve-policy.test.ts`, `test/unit/auto-approve-roots.test.ts` (новые). Пути — выдуманные.
- Сначала падающий: `judge` в заготовке отвечает allow на всё — test hard deny краснеет на каждом пункте.

## Где в коде

- `src/main/agent/auto-approve/policy.ts` (новый)
- `src/main/agent/auto-approve/roots.ts` (новый)
- `test/unit/auto-approve-policy.test.ts` (новый)
- `test/unit/auto-approve-roots.test.ts` (новый)

Только читать: `src/main/agent/auto-approve/shell.ts` (Ticket 02), `src/shared/autopilot/journal.ts` (`journalReason` — образец нормализации домашней папки).

## Итог

Прогон по категориям Ticket-а 01 с настоящей политикой (Mac, transcript-ы `~/.claude/projects`, только числа; корни
приближены, как у черновика 01: все worktree-ы репозитория `cwd`, его `.scratch`, системный `TMPDIR`, scratchpad
Claude Code): 10 отказов — allow 0, deny 10, park 0, hard-deny 0. Причины deny: `not-judged` 6 (`rm-after-cd-glob` 2,
`rm-var-target` 2, `bash-other` 1, `multiline-c-script` 1), `question` 4. Черновик 01 давал deny 9 и park 1: тот park
настоящий разбор Ticket-а 02 читает как «не могу судить». Вывод 01 не меняется: одобрение — для простых команд,
пользу на этих данных дают подсказки и правила агента (Ticket 09).

Решено без владельца:

1. **`..` — от настоящего пути, не по тексту.** Ticket говорит «свернуть `..`, потом `realpath`». Свёртка по тексту
   превращает `<корень>/ln/../x` в `<корень>/x` и теряет ссылку `ln`, а система откроет `x` рядом с целью ссылки.
   Поэтому `resolveTarget` идёт по компонентам: `..` поднимается от уже найденного настоящего пути. По тексту
   свёрнутый путь тоже судится — для hard deny и для списка `targets`. Так и для Bash, и для файловых инструментов
   (Edit, Write, MultiEdit, NotebookEdit, Codex `fileChange`): им передаётся сырой путь (раунд 2 review). `..` после
   отсутствующей папки — `not-judged`: система дальше не идёт, куда ведёт `..`, не сказать.
2. **Symlink.** Ссылка-компонент на пути — не allow, куда бы ни вела; исключение — ссылки на настроенном пути самого
   корня (macOS `/tmp`, `/var`). Цель hard deny находится и через ссылку: судятся обе формы пути.
3. **Glob** (только последний компонент, как пишет Ticket 02) судится по каждой записи папки, которую шаблон может
   совпасть при любых опциях shell-а: dot-файлы и любой регистр тоже. Ссылка среди них — `symlink-on-path`. Папка,
   которую нельзя прочитать или в которой больше 10 000 записей, — `outside`; исключение — новая папка
   `X=$(mktemp -d)`: её ещё нет, она пустая. Glob прямо в корне — сам корень (`rm -rf <worktree>/*`).
4. **Самая длинная область выигрывает**: папка Run-а внутри папки данных worfy — корень; при равной длине hard
   сильнее. На macOS hard-области сравниваются без учёта регистра, корни — с учётом (путь, отличный от корня
   регистром, может быть другой папкой). Удаление папки, в которой лежит hard-область, — hard
   (`rm -rf ~`); удаление папки, в которой лежит корень, — «весь корень».
5. **Hard-области сверх списка spec:** `~/.git-credentials`, `~/.config/git` и `$XDG_CONFIG_HOME/git`, `~/.inputrc`,
   все rc-файлы bash и zsh; программы `su`, `doas`; программа вне таблицы Ticket-а 02 (`env`, `nohup`, `xargs`), у
   которой среди слов есть программа из этого списка. Читать в папке другой Session-и, другого worktree и Harness
   home можно (не hard, а `outside`); читать секреты — hard.
6. **Чужие worktree-ы** — из `checkouts` (`git worktree list`) без worktree-ов Wave и без папки Session-и самого Run-а:
   main checkout Orchestrator-а — `outside` (park), не hard.
7. **git.** Push никогда не allow: URL remote-а — в git config, его здесь не видно. Hard: force (`-f`, `--force`,
   `--force-with-lease`, `+`), `--delete` и пустой источник, `--all` / `--mirror` / `--tags` (Ticket 02 их не различает),
   назначение `main` или default branch, назначение-glob, ветка другого worktree, push текущей ветки, имя которой
   неизвестно. Удаление ветки: default branch или ветка другого worktree — hard, прочее — park. Правило
   `git-in-wave-worktree` требует, чтобы верх репозитория был worktree-ом Wave (не вложенный репозиторий в корне) и
   чтобы на пути к папке git не было ссылки; `fetch` и `pull` разрешены только от имени remote-а (URL, `host:path`,
   путь — park). С раунда 5 review git одобряется только в формах allow-list-а (пункт 19); `git clean` в него не
   входит.
8. **Чтение.** Цели чтения судятся по корням; команда без записи и удаления (кроме git) — deny-with-hint `read-only`:
   решение Ticket-а 01 для `bash-other`, проверку Claude Code не повторить.
9. **git config, hooks, attributes, submodules:** любая цель записи или удаления с компонентом `.git`,
   `.gitattributes` или `.gitmodules` (в написанном виде и в настоящем, по диску), и источники `cp`, — deny-with-hint
   `git-files`. Копия или перенос папки (`cp`, `mv`) просматривается целиком: такой файл внутри — `git-files`; папка,
   которую нельзя прочитать, или больше 10 000 записей — `copy-unclear`. Ссылки внутри не раскрываются для `mv`,
   `cp -R`, `cp -P` и `cp -a`: они копируют ссылку как ссылку. `cp -L`, `--dereference` и `cp -r` на macOS (там это
   `-RL`) копируют то, куда ссылка ведёт: ссылка внутри такой копии — `copy-unclear`. Проверяется любая
   копия папки, не только в репозиторий. `rsync`, `ditto`, `robocopy`, `Copy-Item` — вне таблицы Ticket-а 02, их
   allow не бывает. Не закрыто: подкоманды git, которые достают `.gitattributes` из коммита (`checkout`, `merge`); без
   записи в `.git/config` такой файл программу не запускает.
10. **Команда, которую Ticket 02 не разобрал, до hard deny не доходит:** её действий не видно, исход — deny-with-hint
    `not-judged`. Текстового поиска опасных слов нет (ложные срабатывания на `echo sudo`).
11. **Без HOME** (и `USERPROFILE` на Windows) политика не одобряет ничего: deny `no-home`. Hard deny, которому HOME
    не нужен (git, программы настроек ОС, запуск скачанного, папка данных worfy, Harness home), идёт раньше и
    остаётся hard-deny.
12. **Q3 (в):** цель вне корней, программа вне таблицы, сеть (кроме git fetch / pull), push — park. Rule id исходов:
    `files-inside-roots`, `shell-script-inside-roots`, `git-in-wave-worktree`, `edit-inside-roots` (allow, через `+`);
    `question`, `not-judged`, `symlink-on-path`, `git-files`, `copy-unclear`, `whole-root`, `read-only`, `no-home`
    (deny);
    `outside-roots`, `unknown-tool` (park); `hard:<пункт>`.
13. **Mutation testing** (свой скрипт в отдельном worktree, оба unit test-файла с `--bail 1`; операторы сравнения и
    логики, `true` / `false`, `some` / `every`, исходы и use, снятый `!`, снятые guard clause-ы и `continue`, каждый
    элемент списков программ и hard-областей по одному): 557 mutant-ов в `policy.ts` и `roots.ts`. Первый прогон
    (569 mutant-ов) оставил 141; по ним добавлены test-ы и убраны три мёртвые ветки (проверка `.git` по настоящему
    пути — её раньше закрывает запрет ссылки; повтор `is-root` для glob в корне; лишняя проверка сети в `curl | sh`).
    Итог: убито 516, выжил 41. Все 41 эквивалентны: строки типов (`Outcome`, `Placement`, `TargetUse`), текст
    подсказки, `?? null` против `?? undefined`, `use` цели `<repository>`, которую разбор никогда не удаляет, ветки,
    до которых согласованная файловая система не доходит (компонент после отсутствующего, ENOENT при
    `throwIfNoEntry: false`), равная длина областей и равная тяжесть исходов.
14. **Hard-область, которой ещё нет на диске** (нет `~/.npmrc`), получает настоящий путь от ближайшей существующей
    папки над ней. Раньше её настоящий путь был `null`, и при home за ссылкой (macOS `/var` во временной папке test-а)
    такие области терялись: CI на Linux назвал удаление home через ссылку `claude-home`, macOS — `ssh`. Test-ы:
    `a hard area that does not exist yet stays hard when the home is behind a link` и удаление home через ссылку.
15. **Написание пути системой.** Пройденный путь цели в конце приводится к написанию системы (`realpath` ближайшей
    существующей папки): Windows CI пишет временную папку коротким именем (`RUNNER~1`), а настоящий путь
    hard-области приходит от системы длинными именами, и цель под home за ссылкой промахивалась мимо области.
    Test: `a target in the other spelling reaches a hard area that does not exist yet` (сделанная файловая система).
16. **Раунд 2 review (PR #1410), решено без владельца:**
    - **Корень, подменённый ссылкой.** Контекст получает `recordedRoots` — настоящие пути корней, записанные при
      старте Run-а (`recordRoots`, заполняет Ticket 04). Внутри корня — только по записанному настоящему пути. Корень,
      чей настоящий путь сейчас другой, — не корень: цель под ним — deny `symlink-on-path`, hard-область через него —
      hard. Корень без записи — не корень. Файловая система, которая не разрешает даже `/`, сдвиг не видит; обход
      пути тогда тоже ничего не находит.
    - **Ветка другого worktree и default branch.** Hard: `checkout` / `switch` с `--ignore-other-worktrees` (любым
      однозначным префиксом); `worktree add -f`; checkout, switch, `worktree add` (и ветка по имени папки), `branch`
      (в том числе `-f`), `fetch` / `pull` в `src:dst` и `rebase <upstream> <branch>` на default branch, `main` или
      ветку, выписанную в другом worktree. `-`, `@{-N}` и glob — как default branch. commit, merge, rebase,
      cherry-pick, revert, reset, am, pull, `stash pop` / `apply` — hard, если текущая ветка (читается из `HEAD` git
      папки worktree-а) — default branch или ветка другого worktree, и если `HEAD` не прочитать. Detached `HEAD` —
      не ветка. Новая ветка от `main` (`checkout -b x main`) — разрешена. Слова команды для этого читаются из `args`
      (Ticket 02 только читается в этом Ticket-е), консервативно.
    - **Пути Windows.** Путь файлового инструмента без диска (`\Users\x`, `/x`) — на диске `cwd`; `/c/x` для них —
      `C:\c\x`, как его откроет Node, а не `C:\x` Git Bash. `\\?\C:\x` — `C:\x`; любой другой `\\` путь — `not-judged`.
      Компонент, который Windows переписывает (точка или пробел в конце, `:` — поток, краткое имя `~1`), —
      `not-judged`, если на диске его нельзя разрешить в длинное имя; разрешённое длинное имя судится (`GIT~1` → `.git`
      → `git-files`).
    - **Путь файлового инструмента не абсолютный как дан** (`~`, пробелы по краям, относительный) — `not-judged`.
      Codex `fileChange` с относительным путём тоже: раньше он приклеивался к `cwd`.
    - **Glob** стоит одного `lstat` на запись (и `realpath` на ссылку), папка обходится один раз.
    - **Подсказки hard-deny** — своя у каждого правила (`HARD_HINTS`); совет про `mktemp` — только у hard-областей
      домашней папки.
    - **Ещё программы настроек:** `schtasks` (кроме `/query`), `networksetup` (кроме `-list…`, `-get…`, `-print…`,
      `-help`, `-version`), и они же за `env` / `nohup`.
    - Поле `mode` из контекста убрано: исход от режима не зависит.
    - **Mutation testing после раунда 2** (тот же скрипт; теперь он снимает и последний элемент списка): 831 mutant в
      `policy.ts` и `roots.ts`. Первый прогон оставил 82; по настоящим из них добавлены test-ы. Итог: убито 785,
      выжило 46, все эквивалентны: строки типов, текст подсказки, `?? null` против `?? undefined`, `use` цели
      `<repository>`, `>=` против `>` при равной длине или тяжести, ветки, до которых согласованная файловая система
      не доходит (`continue` после отсутствующего компонента и после разрешённого длинного имени — конечный `realpath`
      даёт то же), guard-ы, которые повторяет следующая строка (`walked.error` в `copiedTree`, пустой `HEAD`).
      Поправка раунда 3: два выживших из этого списка не эквивалентны — `--` в `worktree add` (без него
      `git worktree add -- <папка>` судился бы по `--` как по папке) и `'write'` в проверке `chmod` (с `'read'`
      `chmod` в папке живой Session внутри корня переставал быть `chmod-outside`). На оба теперь есть test-ы.
17. **Раунд 3 review (PR #1410), решено без владельца:**
    - **Ветки без учёта регистра на macOS и Windows.** Loose refs там — файлы на файловой системе без учёта регистра:
      `git checkout MAIN` и потом commit двигали `main`. На darwin и win32 имя ветки сравнивается без регистра везде:
      default branch и `main`, ветки других worktree-ов, `HEAD`, назначение refspec-а в fetch, pull и push, имя ветки
      по папке в `worktree add`. На Linux регистр различается.
    - **`HEAD`-ссылка.** `HEAD`, который сам ссылка, читается через неё как SHA и выглядел бы detached; теперь такая
      ветка — неизвестная, commit — hard.
    - **`--` у git.** `checkout <tree> -- <пути>` восстанавливает файлы и `--detach` не переключает ветку: такие
      checkout и switch судятся только по создаваемым веткам (`-b`, `-c`). git 2.50 убирает `--` у `switch`,
      `branch`, `rebase`, `fetch`, `pull` и `worktree add`: `git switch -- x` переключает на x, `git branch -f -- x
      HEAD` двигает x (проверено на диске), поэтому их операнды после `--` судятся как ветки. Пути после `--` — только
      у `checkout`.
    - **Копия, которая раскрывает ссылки** (`cp -L`, `--dereference`, `cp -r` на macOS) со ссылкой внутри —
      `copy-unclear`; учитываются только опции до `--`, поздний `-P` не смотрится (раскрытие предполагается).
    - **Mutation testing после раунда 3** (скрипт теперь запускает каждый прогон в своей группе процессов и убивает
      группу целиком; выборка — изменённые строки и строки, которые review назвал): 310 mutant-ов, убито 301,
      выжило 9, все эквивалентны: пустой `HEAD` (следующая строка даёт то же), refspec `:x` в push (его раньше ловит
      `push.delete`), `marker` цели `<repository>` и `unknown`, guard-ы `placeGlob` и `copiedTree`, до которых цель с
      абсолютным путём не доходит (нет родительской папки, `rawPath` null) или которые повторяет следующая строка
      (hard-папка, `walked.error`).
18. **Раунд 4 review (PR #1410), решено без владельца:**
    - **Назначение fetch и pull — только `refs/remotes/`.** git раскрывает назначение refspec-а `x`, `heads/x` и
      `refs/heads/x` в ветку x, а на macOS и Windows ещё и `refs/HEADS/x` в любом регистре: `e/03:refs/HEADS/main`
      двигал `main`. Вместо того чтобы перечислять написания, класс закрыт целиком: refspec с назначением (и значение
      `--refmap`, которое так же отображает названные ref-ы — проверено на git 2.50) разрешён, только если назначение
      начинается с `refs/remotes/`. Регистр здесь не различается на всех системах: на Linux `refs/REMOTES/x` — тоже не
      ветка. Любое другое назначение (`x`, `heads/…`, `refs/tags/…`, `refs/…`, `HEAD`, glob) — не allow. Назначение,
      которое раскрывается в default branch, `main` или ветку другого worktree-а, остаётся hard; остальное — park.
      Строка без назначения (`src`, `src:`) ничего не пишет и разрешена.
    - **Назначение push** `heads/x` и `refs/heads/x` (на macOS и Windows в любом регистре) судится как ветка x:
      `git push origin HEAD:heads/main` двигал `main` на remote-е (проверено на диске). push и раньше не был allow;
      теперь такой push — hard, а не park.
    - **`HEAD`** называет ветку, только если он `ref: refs/heads/…` (на macOS и Windows в любом регистре). Другой
      `ref:` — неизвестная ветка, commit — hard. `HEAD`, который папка или который нельзя прочитать, — тоже.
    - **`git checkout <ветка> --`** без слов после `--` переключает ветку и судится как переключение; пути после
      `--` — только когда за ним есть хотя бы одно слово.
    - **Mutation testing после раунда 4** на изменённых строках и строках, которые назвал review: 194 mutant-а,
      убито 191, выжило 3, все эквивалентны: пустой `HEAD` (следующая строка даёт то же), refspec `:x` в push (его
      раньше ловит `push.delete`) и `dashes >= 0` против `> 0` (с `--` первым словом у checkout нет операндов до
      него). Из выживших у review mutant «mv тоже раскрывает ссылки» эквивалентен: у `mv` в таблице парсера нет ни
      `-L`, ни `-r`; test `mv` со ссылкой внутри (allow) всё равно добавлен.
19. **Раунд 5 review (PR #1410): git — только allow-list точных форм.** Решение review, без владельца, строже
    прежнего и совпадает с «безопасно по умолчанию» spec-а. Пять раундов подряд находили новое написание в грамматике
    опций git, которое двигало защищённую ветку на настоящем git: `--refm=` (однозначный префикс `--refmap`) и `-u`
    (`--update-head-ok`), `switch --force-create=trunk`, `rebase --update-refs`, `--detach --no-detach`,
    `branch -u … main` (upstream в общем config, следующий `pull` владельца двигал `main`), `stash clear` / `pop` на
    общем для всех worktree-ов `refs/stash`. Список запрещённого не сходится, поэтому git одобряется, только если
    команда — одна из форм ниже, каждая опция написана полностью из списка этой формы (без сокращений, без
    неизвестных опций, без `--x=v`; кластер перечисленных коротких, `-am`, допустим), плюс прежние условия правила
    `git-in-wave-worktree`. Чтение (парсер не даёт записи и удаления: status, diff, log, show, `branch -a`,
    `config --local --get`…) одобряется как раньше. Формы:
    - `add` (`-A`, `--all`, `-u`, `--update`, `--`), `rm` (`-r`, `--cached`, `-q`, `--quiet`, `--`), `mv` (`--`),
      `restore` (`--staged`, `--worktree`, `-W`, `--`; без `--source` / `-s`; `-S` парсер не пропускает);
    - `commit` с `-m` / `--message`, `-a` / `--all`, `--amend`, `--no-edit`, `--allow-empty`, без путей (`-F` парсер
      Ticket-а 02 не пропускает);
    - `fetch [<remote>] [<ветка>…]` с `--prune`, `--tags`, `--no-tags`, `--quiet`, без `:` в операндах;
    - `pull [--rebase|--ff-only|--no-rebase] [<remote> [<ветка>]]`, без `:`;
    - `switch -c <новая> [<начало>]`, `checkout -b <новая> [<начало>]`; `switch <своя>`, `checkout <своя>` (ветка
      этого worktree-а по `checkouts`); `checkout [<rev>] -- <пути>` хотя бы с одним путём;
    - `rebase <upstream>` (одним операндом, с `--autostash`), `rebase --abort`, `rebase --skip`;
    - `merge [--ff-only|--no-ff|--no-edit] <rev>`, `merge --abort`; `cherry-pick` и `revert` `<rev>…` или `--abort`;
      `reset [--soft|--mixed|--hard] [<rev>]` (без путей);
    - `stash list` и `stash show` — и только они. `refs/stash` общий для всех worktree-ов: `pop`, `apply`, `drop`,
      `clear` забирают записи владельца, а `stash` / `stash push` сдвигают их, и следующий `stash pop` владельца
      достаёт работу агента. Решение координатора после раунда 5: агент откладывает работу WIP-commit-ом;
    - `branch <новая>` (одним операндом, без опций).
    Всё прочее в git (`tag`, `branch -u/-m/-c/-f/-d`, `worktree add`, `clean`, `update-ref`, `notes`, `gc`, push,
    config…) — не allow. `--continue` в формы не входит: парсер Ticket-а 02 не пропускает его (он делает commit).
    - **`rebaseUpdateRefs`** — новое поле контекста: `rebase.updateRefs`, прочитанный один раз при старте Run-а
      (заполняет Ticket 04). `rebase` и `pull` (его делает rebase-ом `pull.rebase`) одобряются только при `false`;
      `true` и `null` (не прочитан) — park.
    - **Hard остаётся, как был**, и дополнен (решение моё): префикс опции, которая берёт значение, в форме `--x=v`
      (`--refm=`, `--force-c=`, `--orph=`) читается как сама опция; `switch --create` / `--force-create` — как
      `-c` / `-C`; `--detach`, взятый назад `--no-d…`, — переключение; `branch -u <upstream> <ветка>` судит ветку;
      тег с именем защищённой ветки или ветки другого worktree-а — hard (при разрешении имени git берёт тег раньше
      ветки). Префикс с отдельным значением (`--force-c trunk`) и `rebase --update-refs` hard не дают — их держит
      allow-list (park): у `--force` и `--force-create` общий префикс, и такое чтение съело бы следующую опцию.
    - **Mutation testing после раунда 5** на allow-list-е и изменённых строках hard: скрипт теперь снимает и каждый
      элемент списков опций форм. Первый прогон: 269 mutant-ов, выжил 41 — по каждому настоящему добавлен test
      (каждая опция списка в разрешённой форме, `-am` без значения, `-ma`, `merge --abort --no-ff`, `checkout
      <своя> --`, своя ветка при detached и без записи в `checkouts`, регистр своей ветки по платформе,
      `checkout --force -B main`, имя тега после `--`, `--message`, `--cleanup`), мёртвый код убран. Второй
      прогон: 261 mutant, убито 259, выжило 2, оба эквивалентны: `dashes >= 0` против `> 0` (с `--` первым словом
      у checkout нет операндов до него) и `return false` в `default`, вместо которого функция возвращает
      `undefined` — то же «нет».
20. **Раунд 6 review (PR #1410): какой репозиторий открывает git, пути и имена веток внутри форм.** Allow-list
    точных форм выдержал атаки; обходы шли мимо него. Решения review (входы и свидетельства на настоящем git 2.50 — у
    reviewer-а), детали — мои:
    - **Подложенная git-папка (high).** Write `src/evil/HEAD` + `commondir` и `mkdir src/evil/objects src/evil/refs`,
      затем `git -C src/evil reset --soft HEAD~1` двигал `main`; вариант с `config` (`diff.external`,
      `core.sshCommand`) запускал программу. Теперь перед любым git (и чтением тоже) папки от папки команды (после
      `-C`, после `cd`) до верха worktree-а, верх не включая, не должны содержать `.git`, `HEAD`, `commondir`, `gitdir`
      или `objects` вместе с `refs` (`gitDirectoryBelow` в `roots.ts`); верх — один из `checkouts`, а его `.git` —
      папка или файл `gitdir: <checkout>/.git/worktrees/<имя>` (относительный путь git 2.48 тоже). Иначе
      `not-judged` с подсказкой `gitTop`: запускать git с верха worktree-а. Без репозитория вообще проверка молчит —
      остальные правила дают park, как раньше. Изменение прежнего поведения: git во вложенном репозитории внутри
      корня (submodule, `vendor/.git`, клон в `.scratch`) теперь deny с подсказкой, а не park; worktree, которого нет
      в `checkouts`, — тоже deny.
    - Запись, которая создаёт файл с именем `HEAD`, `commondir` или `gitdir` (в любом регистре, где угодно в корнях),
      и cp / mv такого файла — `git-files`. `mkdir objects refs` остаётся allow: без `HEAD` это не репозиторий, а git
      под такой папкой ловит проверка выше. Вторая защита — в Ticket 04: `safe.bareRepository=explicit` в окружении
      git-а Run-а.
    - **Пути форм git (medium).** Пути `add`, `rm`, `mv`, `restore` и `checkout [<rev>] -- <пути>` (от папки команды)
      проходят те же проверки, что запись файла: внутри корней, без ссылки на пути, не `.git*`, не `HEAD`, не папка
      hooks. У `mv` источники проверяются как перенос папки (`copiedTree`: папка с `.gitattributes` внутри — тоже
      `git-files`). Pathspec magic (`:/`, `:(top)`, `:!x`) и glob, который git раскрывает сам (`*`, `?`, `[`), — не
      allow. Решение моё: `checkout <rev> -- <пути>` берёт только существующие файлы — папка или новое имя могут
      принести `.gitattributes` из ревизии; `checkout -- <пути>` (из index-а) — как раньше.
    - **Имя новой ветки (medium).** `git branch origin/main` подменял remote-tracking ref, и `merge --ff-only
      origin/main` владельца двигал `main`. Новое имя (`switch -c`, `checkout -b`, `branch <новая>`) не allow, если
      совпадает с remote-ом или начинается с `<remote>/`, начинается с `refs/`, `heads/`, `tags/`, `remotes/`,
      равно `HEAD` или `@`, начинается с `-` (решение моё: `switch -c -f`). Без регистра на macOS и Windows. Новое
      поле контекста **`remotes`** (Ticket 04); `null` — новые ветки не allow.
    - **`core.hooksPath` (medium).** С hooks в отслеживаемой папке (husky, `.githooks`) правка `.githooks/pre-commit`
      была allow, и следующий `git commit` её запускал. Новое поле контекста **`hooksPath`** (Ticket 04): значение как
      git его печатает; относительное читается от верха каждого worktree-а и checkout-а, `~/` — от `HOME`. Запись и
      удаление в этой папке (и в ней самой) — `git-files`. Фраза spec-а «агент не может сначала поставить hook»
      теперь называет это условие.
    - Решение координатора о stash (`stash list` / `stash show` и только они) — в пункте 19, в том же push-е.
    - **Не покрыто:** содержимое, которое приносят в worktree разрешённые merge, cherry-pick, `reset --hard <rev>`
      (их `.gitattributes` и hooks из истории — это история репозитория владельца); `add -A` / `commit -a` кладут в
      index уже лежащие файлы без проверки путей; remote в `fetch` / `pull` по-прежнему судится по форме имени, не по
      списку `remotes`; `fetch --prune --tags` удаляет локальные теги, которых нет на remote-е (у reviewer-а в
      свидетельствах, в решения раунда не вошло).
    - **Mutation testing после раунда 6**: на изменённых строках `policy.ts` и `roots.ts`
      (вместе со строкой stash): 310 mutant-ов, убито 293, выжило 17. По каждому настоящему добавлен test: `.git` —
      ссылка на файл с верным `gitdir`; подложенная папка в `.scratch`, чей верх — основной checkout (судит папка
      git-а, а не верх); git вне корней остаётся park; hooks-папка выше worktree-а не мешает commit-у (сам репозиторий
      — не записанный файл); пути `add` / `rm` / `restore` в `~/.claude` — hard; `git mv src/a.ts .` — allow (последнее
      слово — куда, а не переносимая папка); прямые test-ы `gitDirectoryBelow` (относительный путь, ошибка по пути,
      верх не выше папки, обычный путь). Повторный прогон выживших: 13 убито, 4 эквивалентны — снятое `'write'` у
      `add`, `rm`, `restore` (без него `use` — `undefined`, а для путей этих форм код сравнивает `use` только с `'read'` и
      `'delete'` — сравнения с `'write'` стоят у file tool-ов и у переноса cp / mv, — так что это та же запись; typecheck такое не пропустит) и `.some` → `.every` по двум формам пути при проверке hooks
      (папки hooks взяты в обеих формах, записанной и настоящей, и обе формы пути лежат под ними вместе).
21. **Раунд 7 review (PR #1410): установленные git hooks.** Входы раунда 6 закрыты; `fetch --prune --tags` на
    настоящем git локальные теги не удаляет, allow верен (проверка reviewer-а).
    - **Установленные hooks (high).** husky 9 ставит `core.hooksPath=.husky/_`, его `_/pre-commit` запускает
      `.husky/pre-commit`; Write `.husky/pre-commit` и `git commit -m x` были allow, и настоящий git запустил файл
      агента. Класс шире husky: любой hook, который зовёт файлы проекта (lint-staged, скрипты `package.json`).
      Охрана папок hooks его не закрывает. Решение review: новое поле контекста **`hooksActive`** (Ticket 04): `true`,
      когда задан `core.hooksPath` или в `hooks/` общей git-папки есть файл без `.sample`; `null` — не прочитано.
      Пока оно не `false`, git-форма allow-list-а, которая может запустить client hook, получает park с правилом
      `git-hooks` и подсказкой `HINTS.gitHooks`; подсказка — только когда hooks единственная причина (с push рядом
      — обычный park).
    - **Какие формы (решение моё, строже списка review).** Review оставлял `reset --hard`, `mv`, `rm`, `add`. Но
      `post-index-change` запускается при каждой записи index-а (add, rm, mv, restore, reset, checkout, а также
      status, diff и describe, которые обновляют index, когда могут), `reference-transaction` — при каждом изменении
      ref-а (commit, fetch, pull, branch, reset, merge, rebase), `post-checkout` — у checkout, switch и restore,
      hooks commit-а — у commit, merge, cherry-pick, revert, rebase. Поэтому park получает весь git allow-list-а,
      кроме чтений, которые не пишут ни index, ни ref: `log`, `show`, `rev-parse`, `ls-files`, `ls-tree`, `cat-file`,
      `merge-base`, `blame`, `shortlog`, `rev-list`, `name-rev`, `for-each-ref`, `show-ref`, `grep`, `check-ignore`,
      `branch` без операнда (список), `stash list`, `stash show`. У самого worfy hooks нет, так что commit-ы Wave в
      нём остаются allow.
    - **Замена родительской папки папки hooks (medium).** С `hooksPath=tools/hooks` команды `mv tools tools-old`
      и `mv src/fk tools` ставили другую папку hooks. Теперь папки между папкой hooks и ближайшим верхом
      (worktree или checkout) охраняются сами по себе: запись, перенос (источник и место) и удаление такой папки —
      `git-files`; файлы внутри неё, кроме самой папки hooks, — как раньше. Для абсолютного `hooksPath` вне всех
      верхов — только сама папка и то, что в ней.
    - **`*_HEAD` (low).** Новая ветка с именем на `_HEAD` (ORIG_HEAD, FETCH_HEAD, MERGE_HEAD, CHERRY_PICK_HEAD…) —
      не allow; без регистра на macOS и Windows.
    - **Ticket 04 (low).** Для `safe.bareRepository=explicit` назван только `GIT_CONFIG_PARAMETERS`: `GIT_CONFIG_COUNT`
      стоит в `GIT_ENV` разбора команды, и при нём любой git не судится. Spec («Безопасность», п. 9) называет
      установленные hooks и `hooksActive`.
    - **Mutation testing после раунда 7** на изменённых строках `policy.ts`: 71 mutant, убито 58, выжило 13. Test-ы
      добавлены на каждое чтение списка без hooks и на park без подсказки, когда рядом push. Повторный прогон: 11
      убито, 2 эквивалентны — `.some` → `.every` по двум формам пути при проверке hooks (как в пункте 20) и
      `gitHooks: true` у file tool-а (правило `edit-inside-roots` разрешает каждый file tool внутри корней раньше, чем
      дойдёт до park с подсказкой).
22. **Раунд 8 review (PR #1410): программы, названные в git config.** High нет; входы раунда 7 закрыты.
    - **Программы config-а (medium).** `core.fsmonitor`, `textconv`, filters `clean` / `smudge` / `process`
      запускаются и на «чистых» чтениях: `git show`, `log -p`, `blame`, `grep`, `ls-files`, `check-ignore`,
      `cat-file --filters`. Пример review на настоящем git: `nbstripout --install` ставит `filter.nbstripout.clean` и
      `diff.ipynb.textconv` = `"python3" -m nbstripout`; агент кладёт `nbstripout.py` в верх worktree-а (обычная запись
      файла), и `git show` запускает его. Решение review: поле `hooksActive` не переименовывается, а получает более
      широкий смысл — «hooks или программы config-а». Ticket 04 ставит `true` и при ключах `core.fsmonitor` (не
      `true`/`false`), `filter.*.clean|smudge|process`, `diff.*.textconv|command`, `merge.*.driver`; от себя я
      добавил `diff.external`, `gpg.program` и `gpg.*.program`.
    - **Что остаётся allow при `hooksActive` не `false`.** `rev-parse`, `merge-base`, `for-each-ref`, `show-ref`,
      `name-rev`, `branch` (список), `ls-tree`, `stash list`, `cat-file` только с `-p`, `-t`, `-s`, `-e`, а также
      `log` и `rev-list` только с перечисленными опциями (`--oneline`, `--graph`, `--decorate`, `--all`, `-n`,
      `--max-count`, `--author`, `--since`, `--grep`, `--format=`, `--pretty=`, `--date=` и т. п.; полный список —
      `REVISION_FLAGS` / `REVISION_NEXT` / `REVISION_JOINED` в `policy.ts`). Для `log` ещё допускаются пути после
      `--`. Решения мои, строже списка review: опции `log` и `rev-list` заданы allow-list-ом, а не списком
      запрещённых. Ни одно слово команды не может содержать `%G` и `signature`: формат `%G?`,
      `--show-signature`, `%(signature)` запускают `gpg.program`. Каждая оставленная форма проверена на настоящем
      git 2.50: в репозитории были настроены hooks, `core.fsmonitor`, `textconv`, `clean` / `smudge`,
      `diff.external`, `gpg.program`, `gc.auto` с 600 loose object-ами и подписанный HEAD, и ни одна программа не
      запустилась (скрипт и вывод — в scratchpad исполнителя, `impl-aa03/r8git/`). `show`, `blame`, `grep`,
      `ls-files`, `check-ignore`, `shortlog`, `stash show` и `describe` из allow ушли.
    - **`log.showSignature`.** При `log.showSignature=true` в config-е владельца простой `git log` на подписанном
      commit-е запустил `gpg.program` (проверено). Это закрывает Ticket 04: драйвер добавляет
      `'log.showSignature'='false'` в `GIT_CONFIG_PARAMETERS` рядом с `safe.bareRepository`; с этой переменной тот же
      `git log` ничего не запустил.
    - **`hooksPath !== null` (low).** Заданный `core.hooksPath` считается hooks, даже если `hooksActive` — `false`.
    - **Pseudo-ref (low).** Новая ветка не может называться как pseudo-ref: имя только из заглавных букв, `-` и `_`, в
      котором есть `_` (`AUTO_MERGE`, `MERGE_AUTOSTASH`, `BISECT_EXPECTED_REV`, `NOTES_MERGE_REF`, `_`), а также
      любое имя на `_HEAD`. На macOS и Windows регистр не учитывается. `FOO` и `release-1_2` остаются allow.
    - Spec («Безопасность», п. 9) и Ticket 04 (`hooksActive`, `GIT_CONFIG_PARAMETERS`) поправлены, только текст.
    - **Mutation testing после раунда 8.** Первый прогон по изменённым строкам `policy.ts`: 67 mutant-ов, убит 65,
      выжили 2. Оба эквивалентны: `i < words.length` → `<=` (лишний проход по пустому слову делает `continue`) и
      `eq < 0` → `<= 0` (у слова с `-` в начале `=` не стоит на месте 0). Скрипт теперь снимает и элементы списков
      `const X = [...]`. Второй прогон, по спискам опций с test-ом на каждую опцию: 34 mutant-а, убиты все.
23. **Раунд 9 review (PR #1410): index в словах ревизии, флаги подписи, именованные форматы.** High нет.
    - **Слова, которые читают index (medium).** `:<path>`, `:<n>:<path>` и `:/<text>` читают index, и git при этом
      запускает `core.fsmonitor`: `cat-file -p :a.txt`, `rev-parse :a.txt`, `log -1 :a.txt`, `rev-list`, `ls-tree :`.
      Теперь, пока hooks или программы config-а активны, слово до `--`, которое начинается с `:`, даёт park
      `git-hooks`. Оставлены `HEAD:path`, `<rev>:path`, `HEAD@{1}`, `@{1}` и пути после `--` (`log -- :a.txt`).
      `rev-parse :/<text>` на настоящем git fsmonitor не запустил, но отказ по нему остаётся: строже.
    - **Подпись мимо проверки `%G` (medium).** `%-GG`, `% GK`, `%+GS`, `%<(10)%GG` и именованный формат из
      `pretty.<name>` (`--format=sig`, `--pretty=sig`, `rev-list --pretty=sig`) запускали `gpg.program`. Теперь
      отказ по `/%[-+ ]?G/` (отступ `%<(…)` перед ним этим тоже покрыт). Значение `--format` и `--pretty` без `%` и
      без `format:` или `tformat:` допускается только как встроенное имя: `oneline`, `short`, `medium`, `full`,
      `fuller`, `reference`, `raw`. Сравнение точное, `Medium` — отказ. Комментарий в `policy.ts` говорит только то,
      что доказывает `kept.sh`.
    - **`format.pretty` (low).** Ticket 04 добавляет `'format.pretty'='medium'` в `GIT_CONFIG_PARAMETERS`. Иначе
      `format.pretty` владельца с подписью делает простой `git log -1` вызовом `gpg.program`. Проверено: без переменной
      gpg запустился, с переменной — нет.
    - **Pseudo-ref (low).** Отказ теперь только по известному списку (`HEAD`, `AUTO_MERGE`, `MERGE_AUTOSTASH`,
      `BISECT_EXPECTED_REV`, `NOTES_MERGE_REF`, `NOTES_MERGE_PARTIAL`) и по окончанию `_HEAD`. Окончание покрывает
      ORIG_HEAD, FETCH_HEAD, MERGE_HEAD, CHERRY_PICK_HEAD, REVERT_HEAD, REBASE_HEAD, BISECT_HEAD, поэтому в списке их
      нет. Правило раунда 8 «заглавные с `_`» убрано: `fix_tests` и `my_feature` на macOS снова allow. Отказ по
      имени новой ветки (любой из прежних: remote, `refs/…`, pseudo-ref, `@`, опция, `remotes` не прочитаны) теперь
      park со своим правилом `branch-name` и подсказкой `HINTS.branchName`. Если рядом есть другая причина, это
      обычный park.
    - **Ключи config-а одним правилом (low, решение review).** `hooksActive` равен `true`, когда в config-е есть
      `core.fsmonitor` (не `true`/`false`), `diff.external` или ключ на `.program`, `.command`, `.cmd`, `.driver`,
      `.textconv`, `.clean`, `.smudge`, `.process`, `.defaultKeyCommand`. Это записано в Ticket 04 и в комментарии
      поля. Цена записана в spec, «Решено без владельца», п. 7: `core.sshCommand` владельца тоже включает поле, и
      `fetch` уходит в park.
    - **Проверка на настоящем git 2.50.** Оставленные формы раунда 9 ничего не запустили; отказанные запустили
      fsmonitor или gpg. Скрипт и вывод — в scratchpad исполнителя, `impl-aa03/r8git/kept9.sh` и `kept9.out`.
    - **Mutation testing после раунда 9.** Изменённые строки `policy.ts`: 75 mutant-ов, убито 65, выжило 10. Семь
      выживших — элементы `*_HEAD` в `PSEUDO_REFS`. Их покрывает окончание `_HEAD`, поэтому они были мёртвыми и
      убраны из списка. Ещё два убиты новыми test-ами: `git log -- :path` с `--` первым словом, значение
      `format:`/`tformat:` без `%`. Один эквивалентен: `eq < 0` → `<= 0`, у слова с `-` в начале `=` не на месте 0.
      Повторный прогон исправленных строк: 12 mutant-ов, убиты все.
24. **Раунд 10 review (PR #1410): путь из index в середине слова, опции rev-parse, регистр ключей config-а.** High нет.
    - **Путь из index в середине слова ревизии (medium).** `^:a.txt`, `HEAD..:a.txt`, `HEAD...:a.txt`,
      `rev-list -1 HEAD ^:a.txt`, `log -1 HEAD..:a.txt` и `rev-parse --shared-index-path` получали allow, а git
      запускал `core.fsmonitor`. Решение review — написания больше не перебирать: пока hooks или программы config-а
      активны, каждое слово до `--`, которое не опция и содержит `:`, даёт park `git-hooks`. Цена записана в spec,
      «Решено без владельца», п. 8: `rev-parse HEAD:path`, `cat-file -p <rev>:path`, `ls-tree HEAD:dir` и значение
      опции отдельным словом с `:` (`log --grep 'fix: a'`) в таком проекте тоже уходят в park. Опция с `=`
      (`--grep=fix: a`, `--format=%(refname:short)`) и слова после `--` остаются как были.
    - **Опции `rev-parse` — точный allow-list.** Оставлены `--verify`, `--quiet`, `-q`, `--short`, `--short=<n>`,
      `--abbrev-ref`, `--symbolic`, `--symbolic-full-name`, `--show-toplevel`, `--show-prefix`, `--show-cdup`,
      `--git-dir`, `--git-common-dir`, `--absolute-git-dir`, `--is-inside-work-tree`, `--is-inside-git-dir`,
      `--is-bare-repository`, `--is-shallow-repository`, `--all`, `--branches`, `--tags`, `--remotes`. Каждая
      проверена на настоящем git 2.50 с hooks, fsmonitor, textconv, clean/smudge, diff.external и gpg.program: ни
      одна ничего не запустила. `--shared-index-path` запустил fsmonitor и даёт park; любая другая опция тоже.
      Скрипт и вывод — в scratchpad исполнителя, `impl-aa03/r8git/kept10.sh` и `kept10.out`.
    - **Регистр ключей config-а (low).** `git config --list` печатает секцию и последнюю часть ключа строчными
      (`core.sshcommand`, `gpg.ssh.defaultkeycommand`), поэтому правило по окончанию в Ticket 04 и в spec теперь без
      учёта регистра. `core.sshCommand` на `.command` не кончается, поэтому он назван в правиле отдельно (он
      запускает программу на `fetch` и `pull`). Записанная цена — `fetch` уходит в park в проекте с
      `core.sshCommand` — теперь верна. Комментарий поля `hooksActive` в `policy.ts` говорит то же.
    - **Mutation testing после раунда 10.** Изменённые строки `policy.ts` (список опций `rev-parse`, проверка `:`,
      allow-list `rev-parse`): 34 mutant-а, убиты все.
