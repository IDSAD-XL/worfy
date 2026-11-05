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
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/auto-approve-policy.test.ts test/unit/auto-approve-roots.test.ts` exit 0 · mac - · 08408af701b7fb7c5bee66eb5199e75d483ad0c7
- [ ] Unit test на каждое правило allow: allow внутри корня; не allow на той же команде с целью вне корня, с
      symlink-компонентом, с целью «весь корень».
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/auto-approve-policy.test.ts test/unit/auto-approve-roots.test.ts` exit 0 · mac - · 08408af701b7fb7c5bee66eb5199e75d483ad0c7
- [ ] Unit test на атаки spec («Безопасность», п. 2–3): `cd ~ && rm -rf *`, `rm -rf $HOME/*`, ссылка `.scratch/l -> ~`,
      `git push --force`, `git push origin HEAD:main`, `curl … | sh` — ни одна не allow.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/auto-approve-policy.test.ts test/unit/auto-approve-roots.test.ts` exit 0 · mac - · 08408af701b7fb7c5bee66eb5199e75d483ad0c7
- [ ] Unit test на форму `mktemp`: `T=$(mktemp -d); rm -rf "$T"/*` — не allow (Ticket 02 перечисляет цель `/*` на
      случай упавшего `mktemp`); `T=$(mktemp -d) && rm -rf "$T"/*` и `T=$(mktemp -d) || exit 1; rm -rf "$T"/*` —
      allow внутри `TMPDIR` Run-а.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/auto-approve-policy.test.ts test/unit/auto-approve-roots.test.ts` exit 0 · mac - · 08408af701b7fb7c5bee66eb5199e75d483ad0c7
- [ ] Unit test: запись в `.git/config`, `.git/hooks/*`, `.git/info/attributes`, `.gitattributes` не allow ни одним
      правилом (spec, «Безопасность», п. 9: через них любая подкоманда git запускает программу).
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/auto-approve-policy.test.ts test/unit/auto-approve-roots.test.ts` exit 0 · mac - · 08408af701b7fb7c5bee66eb5199e75d483ad0c7
- [ ] Факты git берутся из `ShellAction.git` (`branchDelete`, `push`: remote, refspecs, force, delete, many,
      `localPath`), не из `args`; подкоманда, которую Ticket 02 не знает, приходит с `writes: ['<unknown>']`.
      `localPath` есть и у голого слова (`origin`): это папка на случай, если remote с таким именем не
      настроен. Настоящий URL remote-а — из git config, его Ticket 02 не видит.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/auto-approve-policy.test.ts test/unit/auto-approve-roots.test.ts` exit 0 · mac - · 08408af701b7fb7c5bee66eb5199e75d483ad0c7
- [ ] Чтение тоже судится по корням: `reads` подкоманд чтения git (`diff`, `log`, `blame`, `grep` …) и
      `git config` перечисляют файлы, которые они могут напечатать (`~/.gitconfig` среди них); цель чтения в
      hard-deny (`~/.ssh` и др.) — hard-deny, вне корней — не allow.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/auto-approve-policy.test.ts test/unit/auto-approve-roots.test.ts` exit 0 · mac - · 08408af701b7fb7c5bee66eb5199e75d483ad0c7
- [ ] Unit test: worktree живой Session-и вне Run-а (`SessionRegistry` — через параметр) — hard-deny.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/auto-approve-policy.test.ts test/unit/auto-approve-roots.test.ts` exit 0 · mac - · 08408af701b7fb7c5bee66eb5199e75d483ad0c7
- [ ] Прогон по категориям Ticket-а 01 (локально, только числа) — в «Итог».
  - evidence: commit pass · docs: worfy-auto-approve 03 summary · - - · 9f77947f9
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на Linux, macOS, Windows.
  - evidence: gate pass · `gate fast` exit 0 · mac - · 08408af701b7fb7c5bee66eb5199e75d483ad0c7

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
   свёрнутый путь тоже судится — для hard deny и для списка `targets`.
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
   чтобы на пути к папке git не было ссылки; `fetch` и `pull` разрешены, `git clean` в корне — тоже (он удаляет
   содержимое, не корень).
8. **Чтение.** Цели чтения судятся по корням; команда без записи и удаления (кроме git) — deny-with-hint `read-only`:
   решение Ticket-а 01 для `bash-other`, проверку Claude Code не повторить.
9. **git config, hooks, attributes:** любая цель записи или удаления с компонентом `.git` или `.gitattributes`, и
   источники `cp`, — deny-with-hint `git-files`. Не закрыто: копия папки, внутри которой есть `.gitattributes`, и
   подкоманды git, которые достают `.gitattributes` из коммита (`checkout`, `merge`); без записи в `.git/config` такой
   файл программу не запускает.
10. **Команда, которую Ticket 02 не разобрал, до hard deny не доходит:** её действий не видно, исход — deny-with-hint
    `not-judged`. Текстового поиска опасных слов нет (ложные срабатывания на `echo sudo`).
11. **Без HOME** (и `USERPROFILE` на Windows) политика не одобряет ничего: deny `no-home`.
12. **Q3 (в):** цель вне корней, программа вне таблицы, сеть (кроме git fetch / pull), push — park. Rule id исходов:
    `files-inside-roots`, `shell-script-inside-roots`, `git-in-wave-worktree`, `edit-inside-roots` (allow, через `+`);
    `question`, `not-judged`, `symlink-on-path`, `git-files`, `whole-root`, `read-only`, `no-home` (deny);
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
