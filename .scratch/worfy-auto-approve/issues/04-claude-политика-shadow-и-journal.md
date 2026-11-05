# 04 — Claude: политика в unattended canUseTool, Shadow, строка Journal

Type: task
Status: claimed 2026-11-05T20:00Z
Blocked by: 03, 06, 12
Source: [spec.md](../spec.md), «Как работает», п. 1, 3, 7; «Решено без владельца», п. 4–6; «Безопасность», п. 5, 7

Глубина ревью: high (подключение решения к живому driver-у).

## Что происходит

- `unattendedCanUseTool` (`src/main/vendors/claude/session.ts:133-140`) отказывает на всё; выбор — `:391`.
- `SessionStart` (`src/main/vendors/session.ts:68-90`) не несёт ни режима, ни политики.
- `refused` → `Session.refuseDialog` (`src/main/agent/session.ts:199-202`, `:529`) → событие `refused_dialog` →
  строка `refused-dialog` (`src/main/autopilot/run.ts:1152-1154`).
- `TMPDIR` Session-у worfy не задаёт: `mktemp -d` уходит в общий системный temp.

## Что делаем

1. `SessionStart` получает `approval: { mode(): 'off' | 'shadow' | 'on'; judge(request): Decision }` (режим читается
   при каждом запросе, из настройки Ticket-а 06). `agent/session.ts` собирает `context` (корни Wave, папка Run-а,
   живые Session-ы из `SessionRegistry`) и передаёт его.
2. `unattendedCanUseTool` при `off` — как сегодня, ровно. При `shadow` — `judge`, событие решения с `would-*`, агенту
   прежний отказ. При `on`: allow → `{ behavior: 'allow', updatedInput: input }`; deny / hard-deny → `deny` с
   подсказкой правила (после `decisionReason`, как `unattendedDeniedMessage`); park → передаёт запрос Ticket-у 07
   (здесь — заготовка: park ведёт себя как deny, пока 07 не влит).
3. Новое событие `auto_approval` (`src/shared/agent/events.ts`) и строка Journal `auto-approval`
   (`src/shared/autopilot/journal.ts`, поля — spec, п. 7; очистка команды: `~` вместо домашней папки, `NAME=***` для
   секретных имён, не длиннее 200). `run.ts` пишет её на каждое событие; `run-started` получает поле `autoApproval`.
   Исходы `park-answered`, `park-expired` в схеме есть сразу (их пишет 07).
4. Папка Run-а `<WORFY_DATA_DIR>/autopilot-tmp/<run>/` создаётся при старте Run-а, уходит в `TMPDIR` окружения
   Claude Code (`options.ts`), удаляется при `run-stopped` (по буквальному пути). Проверить, меняет ли `TMPDIR` папку
   scratchpad Claude Code; результат — в «Итог».
5. **Поля `PolicyContext`** (Ticket 03, `src/main/agent/auto-approve/policy.ts`) и откуда каждое берётся:
   - `platform` — `process.platform`;
   - `cwd` — текущая папка shell-а Session-и на момент запроса, не стартовая: Claude Code сохраняет `cd` между
     вызовами Bash (для Codex `commandExecution` берёт свой `cwd` из запроса);
   - `env` — окружение shell-а Session-и: `HOME` (`USERPROFILE` на Windows), `TMPDIR`, `APPDATA`, `XDG_CONFIG_HOME`;
   - `worktrees` — worktree-ы Ticket-ов текущей Wave; `scratch` — `.scratch` Project-а; `runTemp` — папка Run-а из п. 4;
   - `scratchpad` — путь scratchpad-а Claude Code этой Session-и;
   - `dataDir` — `WORFY_DATA_DIR`; `harnessHome` — домашняя папка Harness;
   - `sessionId` и `sessions` — Session Run-а и `SessionRegistry`;
   - `checkouts` — `git worktree list` Project-а (путь и ветка), закешированный и обновляемый при смене Wave;
     **пустой `checkouts` молча выключает hard-deny `other-worktree` и `git-other-branch`**: если список прочитать
     не удалось, пустой не передавать, а ничего не одобрять;
   - `defaultBranch` — ветка по умолчанию Project-а (`main` защищён и так);
   - `rebaseUpdateRefs` — значение `git config --bool rebase.updateRefs` в worktree-е Run-а, прочитанное один раз
     при старте Run-а: `true` двигает при rebase каждую ветку, через которую он проходит. `rebase` и `pull` (его
     может сделать rebase-ом `pull.rebase`) одобряются только при `false`; если прочитать не удалось — `null`, и
     они не одобряются (Ticket 03, «Итог», пункт 19);
   - `remotes` — имена remote-ов репозитория (`git remote`), прочитанные при старте Run-а и закешированные, как
     `checkouts`. Новая ветка не может называться как remote или как ref под ним (`origin/main`): такая ветка
     подменяет remote-tracking ref, и `git merge --ff-only origin/main` владельца берёт ветку агента. Если прочитать
     не удалось — `null`, и новые ветки не одобряются (Ticket 03, «Итог», пункт 20);
   - `hooksPath` — значение `git config --get core.hooksPath` в worktree-е Run-а, прочитанное при старте Run-а, как
     git его печатает; `null` — когда ключ не задан (exit code 1). Относительный путь политика читает от верха каждого
     worktree-а, `~/` — от `HOME`. Запись в эту папку, а также запись, перенос и удаление папок между ней и верхом
     worktree-а не одобряются. Это не закрывает hooks, которые вызывают файлы проекта: husky 9 ставит
     `core.hooksPath=.husky/_`, а его `_/pre-commit` запускает `.husky/pre-commit`, который агент править может. Их
     закрывает `hooksActive`. Если чтение упало с другим exit code-ом, драйвер не включает политику для Run-а —
     передать `null` вместо неизвестного значения нельзя (Ticket 03, «Итог», пункты 20 и 21);
   - `hooksActive` — есть ли в репозитории hooks или программы, названные в git config; читается при старте Run-а.
     `true`, когда задан `core.hooksPath`, когда в `hooks/` общей git-папки (`git rev-parse --git-common-dir`) лежит
     файл без окончания `.sample` или когда в `git config --list` есть ключ по одному правилу: `core.fsmonitor` со
     значением не `true` и не `false`, `diff.external`, `core.sshCommand`, `remote.*.uploadpack`,
     `remote.*.receivepack`, или ключ, который кончается на
     `.program`, `.command`, `.cmd`, `.driver`, `.textconv`, `.clean`, `.smudge`, `.process` или
     `.defaultKeyCommand` (сюда входят `gpg.program`, `gpg.*.program`, `gpg.ssh.defaultKeyCommand`,
     `diff.*.command`, `merge.*.driver`, `trailer.*.cmd`, filters). Имена и окончания сравниваются без учёта
     регистра: `git config --list` печатает имя секции и последнюю часть ключа строчными (`core.sshcommand`,
     `gpg.ssh.defaultkeycommand`), а средняя часть (`trailer.Sign.cmd`) сохраняет регистр. Правило по окончанию
     ключа, а не список: новые ключи git с программой обычно так и названы. `core.sshCommand`,
     `remote.*.uploadpack` и `remote.*.receivepack` названы отдельно: они запускают программу на `fetch`, `pull` и
     `push`, а под окончания не подходят. `credential.helper`, `core.askPass` и `core.gitProxy` в правило не входят
     (spec, «Решено без владельца», п. 9). Цена — в spec, «Решено без владельца»,
     п. 7: `core.sshCommand` владельца включает поле, и `fetch` уходит в park. `core.pager` и `pager.*` не нужны: у Session-и нет tty, и git pager не запускает. `false` — когда нет ничего из этого; `null` — когда
     прочитать не удалось. Пока поле не `false` (или задан `hooksPath`), git одобряется только на чтение ref-ов и
     object-ов: без diff-а, без filter-ов и без обращения к рабочему дереву (Ticket 03, «Итог», пункты 21 и 22).
     Пример: `nbstripout --install` ставит `filter.nbstripout.clean` и `diff.ipynb.textconv` = `"python3" -m
     nbstripout`, и `git show` запускал файл `nbstripout.py`, который агент положил в верх worktree-а. У самого worfy
     нет ни hooks, ни таких ключей, так что commit-ы Wave в нём остаются allow;
   - `recordedRoots` — настоящие пути корней, записанные при старте Run-а: `recordRoots([...worktrees, scratch,
     runTemp, scratchpad], platform)` из `roots.ts`. Корень без записи — не корень; корень, чей настоящий путь с тех
     пор другой (подменён ссылкой), — тоже. Worktree, созданный позже старта Run-а, записывается при создании.
   - `fs` не передаётся: политика читает диск сама (`nodeFileSystem`).
   Окружение git-а Session-и Run-а: драйвер задаёт `GIT_CONFIG_PARAMETERS="'safe.bareRepository'='explicit'
   'log.showSignature'='false' 'format.pretty'='medium'"`, и только через эту переменную. С первым ключом git не открывает голый репозиторий,
   найденный поиском вверх от папки команды, — вторая защита к проверке политики, что папки по пути к верху
   worktree-а не похожи на git-папку (Ticket 03, «Итог», пункт 20). Второй ключ нужен для оставленного `git log`: при
   `log.showSignature=true` в config-е владельца простой `git log` на подписанном commit-е запускает `gpg.program`
   (проверено на git 2.50; переменная это отключает, Ticket 03, «Итог», пункт 22). Третий — тоже для `git log`:
   `format.pretty` владельца с подписью (`%G?` или именованный формат с ней) делает простой `git log -1` вызовом
   `gpg.program` (проверено; Ticket 03, «Итог», пункт 23). Когда Run стартует с `hooksActive`, которое не `false`, драйвер задаёт
   ещё `GIT_NO_LAZY_FETCH=1`. В partial clone (`--filter=blob:none`, `tree:0`) чтение недостающего object-а
   (`cat-file`, `ls-tree -l`, `log -- <path>`, `rev-parse HEAD^{tree}`) иначе догружает его с remote и запускает
   `core.sshCommand`; с переменной такое чтение падает, и программа не запускается (проверено review на git 2.50;
   Ticket 03, «Итог», пункт 25). `GIT_CONFIG_COUNT` не подходит: он в списке `GIT_ENV` разбора
   команды (Ticket 02), и при нём любой git не судится. `GIT_CONFIG_PARAMETERS` в `env` контекста передавать можно.
   Драйвер передаёт вход инструмента как получен (`file_path` без обрезки пробелов и раскрытия `~`): путь, не
   абсолютный как дан, политика не одобряет.

## Готово, когда

- [ ] Contract test на fake agent: при `off` поток событий и Journal байт в байт как сегодня (сравнение с записью до
      правки).
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/auto-approve-claude.test.ts` exit 0 · mac - · b2b67e8290e738ff006af71bf49e722579c00622
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/auto-approve-claude.test.ts` exit 0 · mac - · 2d648f4e86a24412d120c7426ec3a0a0ba6824a2
  - evidence: test-run pass · node scripts/vitest-electron.mjs test/contract/auto-approve-claude.test.ts exit 0 · mac - · 5ab8f1c294f2c8aa912cb892503b283617a59da9
  - evidence: test-run pass · node scripts/vitest-electron.mjs test/contract/auto-approve-claude.test.ts exit 0 · mac - · 9bf3f6c8d6ab1b67a66e099e8757d82ccb176fa1
- [ ] Contract test: `shadow` — агент получает прежний текст отказа, в Journal `would-allow` с правилом.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/auto-approve-claude.test.ts` exit 0 · mac - · b2b67e8290e738ff006af71bf49e722579c00622
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/auto-approve-claude.test.ts` exit 0 · mac - · 2d648f4e86a24412d120c7426ec3a0a0ba6824a2
  - evidence: test-run pass · node scripts/vitest-electron.mjs test/contract/auto-approve-claude.test.ts exit 0 · mac - · 5ab8f1c294f2c8aa912cb892503b283617a59da9
  - evidence: test-run pass · node scripts/vitest-electron.mjs test/contract/auto-approve-claude.test.ts exit 0 · mac - · 9bf3f6c8d6ab1b67a66e099e8757d82ccb176fa1
- [ ] Contract test: `on` — запрос внутри worktree Wave проходит; вне корня — deny с подсказкой; hard deny — отказ.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/auto-approve-claude.test.ts` exit 0 · mac - · b2b67e8290e738ff006af71bf49e722579c00622
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/auto-approve-claude.test.ts` exit 0 · mac - · 2d648f4e86a24412d120c7426ec3a0a0ba6824a2
  - evidence: test-run pass · node scripts/vitest-electron.mjs test/contract/auto-approve-claude.test.ts exit 0 · mac - · 5ab8f1c294f2c8aa912cb892503b283617a59da9
  - evidence: test-run pass · node scripts/vitest-electron.mjs test/contract/auto-approve-claude.test.ts exit 0 · mac - · 9bf3f6c8d6ab1b67a66e099e8757d82ccb176fa1
- [ ] Unit test очистки: домашняя папка, `GH_TOKEN=…`, длинная команда — в строке Journal нет ни секрета, ни пути дома.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/auto-approve-run.test.ts` exit 0 · mac - · b2b67e8290e738ff006af71bf49e722579c00622
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/auto-approve-run.test.ts` exit 0 · mac - · 2d648f4e86a24412d120c7426ec3a0a0ba6824a2
  - evidence: test-run pass · node scripts/vitest-electron.mjs test/unit/auto-approve-run.test.ts exit 0 · mac - · 5ab8f1c294f2c8aa912cb892503b283617a59da9
  - evidence: test-run pass · node scripts/vitest-electron.mjs test/unit/auto-approve-run.test.ts exit 0 · mac - · 9bf3f6c8d6ab1b67a66e099e8757d82ccb176fa1
- [ ] Переключение режима во время Run-а действует со следующего запроса; строка Journal называет режим.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/auto-approve-claude.test.ts` exit 0 · mac - · b2b67e8290e738ff006af71bf49e722579c00622
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/auto-approve-claude.test.ts` exit 0 · mac - · 2d648f4e86a24412d120c7426ec3a0a0ba6824a2
  - evidence: test-run pass · node scripts/vitest-electron.mjs test/contract/auto-approve-claude.test.ts exit 0 · mac - · 5ab8f1c294f2c8aa912cb892503b283617a59da9
  - evidence: test-run pass · node scripts/vitest-electron.mjs test/contract/auto-approve-claude.test.ts exit 0 · mac - · 9bf3f6c8d6ab1b67a66e099e8757d82ccb176fa1
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.

## Тесты

- Contract `test/contract/auto-approve-claude.test.ts` (новый); fake agent `WORFY_AGENT=fake` со скриптом, который
  зовёт `canUseTool` с `decisionReason`.
- Прогнать все test-ы модуля: `test/unit/autopilot-*.test.ts`, `test/contract/autopilot-*.test.ts`,
  `test/unit/permissions*.test.ts`, `test/unit/journal*.test.ts`.

## Где в коде

- `src/main/vendors/session.ts`, `src/main/vendors/claude/session.ts`, `src/main/vendors/claude/options.ts`
- `src/main/agent/session.ts`, `src/shared/agent/events.ts`
- `src/shared/autopilot/journal.ts`, `src/main/autopilot/run.ts` (общие с worfy-retry 04 / 05 — не параллельно)
- `test/contract/auto-approve-claude.test.ts` (новый)

## Итог

Unattended Session Run-а на Claude Code спрашивает политику Ticket-а 03 вместо отказа на всё. Режим читается при
каждом запросе. Off — прежний отказ байт в байт: поток событий и Journal Run-а совпадают с записью, сделанной до
правки (`test/fixtures/auto-approve/off-baseline.json`). Shadow — строка `auto-approval` с `would-*` и правилом,
агенту прежний отказ. On — allow пропускает вызов, deny и hard deny отказывают с подсказкой правила, park отказывает
с подсказкой «ждёт очереди» до Ticket-а 07.

**`TMPDIR` и scratchpad Claude Code.** `TMPDIR` папку scratchpad не меняет. Claude Code берёт свою временную папку из
`CLAUDE_CODE_TMPDIR`, иначе из `XDG_RUNTIME_DIR`, иначе `/tmp/claude-<uid>` (строки бинарника Claude Code); в Session,
где это проверено, `TMPDIR` — папка `/var/folders/…`, а scratchpad — `/private/tmp/claude-<uid>/…`. Поэтому scratchpad
— отдельный корень: путь берётся из `scratchpad_dir` входа PreToolUse hook-а и записывается при первом появлении. На
живой Session с `TMPDIR` папки Run-а это не проверено: настоящий Claude Code в test-ах не запускается.

**Откуда папка и scratchpad запроса.** В `canUseTool` у SDK нет `cwd`. Его даёт PreToolUse hook (SDK callback): он
идёт раньше `canUseTool` и несёт `cwd` shell-а (после `cd` прошлых вызовов), `tool_use_id` и `scratchpad_dir`. Hook
отвечает `{}` — Claude Code идёт дальше, как без него, и события `hook` не появляется. Драйвер держит последние 256
вызовов по `tool_use_id`; вызов, о котором hook не сказал, судится без папки — для Bash это deny `no-cwd`.

Решено без владельца:

1. **`run-started.autoApproval` при Off не пишется**, иначе Off не был бы байт в байт. При Shadow и On — режим на
   старте; `off`, когда режим Shadow или On, а политика не открылась (чтение `core.hooksPath` упало с exit code не 0
   и не 1, по пункту 5 Ticket-а), или Orchestrator на Vendor-е без политики (Codex, до Ticket-а 05) — Run идёт как
   при Off, без папки Run-а и без окружения git-а.
2. **Папка Run-а создаётся во всех режимах, но агент получает её и окружение git-а только при Shadow и On**
   (раунд 2 review): при Off процесс стартует как сегодня («Готово, когда» spec-а: «Off ведёт себя ровно как
   сегодня»). Папка при Off нужна на случай переключения на On посреди Run-а.
3. **Shadow не пишет `refused-dialog`**: отказ при Shadow — решение политики, его строка — `auto-approval` с `would-*`.
   При Off `refused-dialog` как прежде.
4. **park при On** пишется в Journal как `park`, агенту — deny с `HINTS.parkPending` (заготовка до Ticket-а 07).
5. **`checkouts` и факты git-а читаются при каждом запросе**, а не кешируются до смены Wave, как пишет пункт 5:
   implementer создаёт свой worktree после старта Wave, а агент в `bypassPermissions` может без вопроса поставить
   hook или программу в git config. Список, который не прочитался, — deny `no-checkouts`, пустым не передаётся;
   факты, которые не прочитались, — deny `no-git-facts`.
6. **Worktree Wave записывается в корни при первом запросе, который его видит**, а не «при создании»: worfy не видит
   момента создания. Worktree находится по ветке `<epic>/<NN>` (комментарий `shortcut:` в `run-approval.ts`: шаблон
   ветки Profile-а не читается).
7. **`rebaseUpdateRefs`, `hooksPath`, `hooksActive`, `remotes` читаются в корне Project-а**, не «в worktree-е Run-а»:
   на старте Run-а worktree-ов Wave ещё нет, а config у worktree-ов общий (кроме `extensions.worktreeConfig`).
   Читаются в окружении login shell-а агента (с `GIT_CONFIG_PARAMETERS` Run-а), не в окружении Electron-а: так
   `GIT_CONFIG_GLOBAL` или `XDG_CONFIG_HOME` из shell-а владельца видны.
8. **Ветка по умолчанию**: `refs/remotes/origin/HEAD`, иначе текущая ветка корня, иначе `main`.
9. **Run id приходит в Journal из политики** (`RunStart.run`): папка Run-а создаётся до `setUnattended`, а файл Journal
   — после, и имя у них одно. Чужой id (`../x`) `openRun` отказывает; существующий файл не переоткрывается.
10. **Takeover**: Session, которую новый Run принял на ходу, продолжает с прежним `TMPDIR` и судится в окружении,
    с которым стартовал её процесс; папка старого Run-а при takeover не удаляется. Её, как и папки после crash-а
    или quit-а, удаляет уборка при создании Autopilot-а в следующий запуск worfy (только папки Run-ов, начатых
    раньше этого момента). Удаление — асинхронное (`removeTreeAsync`: тот же осмотр на смонтированный том, затем `rm`
    из `node:fs/promises`; на Windows — прежний синхронный обход, он нужен для junction-ов).
11. **Строка `auto-approval`**: `targets` тоже с `~` и не длиннее 200. Скрывается значение переменной, в имени
    которой (части через `_`, без учёта регистра) есть `token`, `secret`, `passw`, `apikey`, часть на `key` или часть
    `pat`, `pass`, `pw`, `pwd`, `auth`, `credential(s)`, `cookie`; значение опции с таким словом (`--token x`,
    `--password=x`); `Authorization: …` и `Bearer …`; пароль в URL; `curl -u user:pass`; `mysql -p…`; токены с
    известным началом (`ghp_`, `github_pat_`, `sk-`, `xox?-`, `AKIA`). Лишнее скрытие (`--auth-mode x`) безопаснее
    утечки.
12. **Ошибка политики** (исключение в `judge`) — deny `policy-failed` без подсказки: агенту прежний текст отказа.
    Режим, который не читается, — Off.

Расхождений текста Ticket-а с кодом политики Ticket-а 03 не найдено: правило `hooksActive` и окружение git-а сделаны
по тексту и покрыты unit test-ами (`test/unit/auto-approve-run.test.ts`).

**Mutation testing** (свой скрипт, отдельный worktree, test-файлы модуля): 25 mutant-ов на изменённых строках
(`run-approval.ts`, драйвер Claude, `options.ts`, `query.ts`, Journal, `run.ts`, fake agent). Первый прогон: 21 убит,
4 выжили — `cwd` запроса, проверка run id в `openRun`, передача hook-а в `query.ts`, `cwd` fake agent-а. На первые три
добавлены test-ы, повторный прогон их убил. Выжил один — запасной `cwd` fake agent-а (`line.cwd ?? request.cwd`),
это код test-ов: сценарий всегда задаёт `cwd`, а его смена переписала бы запись Off.

ADR-0005 (worfy не пишет в репозиторий Project-а): unit test сравнивает все файлы репозитория и worktree-а, `.git`
тоже, до и после открытия политики, двух запросов и закрытия.

### Раунд 2 (review high PR #1460)

1. **Политика судит в том окружении, в котором стартовал процесс агента**: всё окружение login shell-а и
   переменные Run-а поверх (`ApprovalAt.started`). Раньше политика видела 6 переменных, и проверки `CDPATH`,
   `BASH_ENV`, `IFS`, `GIT_DIR` разбора команды молчали: при `CDPATH=~` `cd projects && rm -rf *` проходил как allow.
   Unit test на каждую из четырёх переменных.
2. **Чтения git-а Run-а идут в окружении shell-а**, не Electron-а (`GIT_CONFIG_GLOBAL` shell-а с `core.sshCommand`
   теперь даёт `hooksActive: true`).
3. **Takeover**: старая Session судится с `TMPDIR` и окружением своего процесса, не нового Run-а; папка старого
   Run-а остаётся (contract test в `autopilot-background.test.ts`).
4. **Факты git-а перечитываются на каждый запрос** (как `checkouts`). Процессу, который стартовал без окружения
   git-а Run-а (при Off) или без `GIT_NO_LAZY_FETCH` при `hooksActive`, которое теперь не `false`, git не
   одобряется: allow с правилом `git-in-wave-worktree` (и в составном правиле) становится park
   `git-without-run-environment`. Spec, «Безопасность», п. 9 дополнен.
5. **Маскировка Journal** расширена (пункт 11 выше), unit test на каждую форму.
6. **macOS `mktemp -d` не смотрит на `TMPDIR`** (проверено здесь: `TMPDIR=<папка> mktemp -d -u` печатает путь под
   `/var/folders`): на darwin папка `X=$(mktemp -d)` — вне корней (`MACOS_TEMP` в `shell.ts`), запись в неё — park.
   Подсказки hard deny домашней папки по-прежнему советуют `mktemp -d`; на macOS такая команда уйдёт в park.
7. **Off — как сегодня**: без `TMPDIR` и без окружения git-а; переключение Off → On посреди Run-а судит процесс
   по пункту 4.
8. **Уборка папок**: асинхронное удаление и уборка при создании Autopilot-а (пункт 10 выше).
9. **Документы**: `docs/features/autopilot.md`, `docs/features/flight-recorder.md` (у `auto-approval` нет метки `i`).
10. Слова решения (`AUTO_APPROVAL_OUTCOMES`, `AUTO_APPROVAL_LINE_MODES`) — в `src/shared/agent/auto-approval.ts`;
    подсказка park — `HINTS.parkPending` политики; `ApprovalWhere` описан без Claude. Run на Codex пишет
    `autoApproval: off`.

**Mutation testing раунда 2**: 29 mutant-ов на изменённых строках, 27 убиты сразу, 2 выжили. Суффикс в имени
опции маскировки убит новым случаем (`--secret-key`, `--token-file`). Выжил один — deny `no-git-facts`: факты git-а
не читаются, когда `git config --get core.hooksPath` падает с кодом не 0 и не 1, а при такой поломке config-а
раньше падает и `git worktree list` (deny `no-checkouts`). Ветка — защита на случай, который test не воспроизводит.

### Раунд 3 (review PR #1460: 2 medium, 5 low)

1. **git читается в том checkout-е, где идёт команда.** На каждый запрос факты git-а читаются в корне Project-а, в
   каждом worktree Wave и в каждой папке, где идёт git-команда запроса (после её `cd` и `-C`), командой
   `git -C <папка>`; каждая папка — один раз за запрос. Config одного worktree (`git config --worktree`,
   `includeIf "gitdir:…"`) теперь виден: `git status` в таком worktree больше не allow, запись в папку его
   `core.hooksPath` — deny `git-files`. Папка, где git не прочитался (её ещё нет), считается «hooks не исключены».
   Test-ы на настоящем git-е: `--worktree` config, `includeIf "gitdir:**/worktrees/wt"`, `git -C`.
2. **Flaky contract test «a run given no policy» исправлен.** Причина нашёл reviewer: store-ы harness-а читали
   общую переменную `scratch` в момент записи, а Codex test не ждал остановки своего Run-а — его `layout.json`
   попадал в папку следующего test-а. Harness держит свою папку (`own`, `ownRepo`), Codex test ждёт конца Run-а.
   10 прогонов файла подряд — зелёные (до коммита и после него).
3. **Подсказка hard deny домашней папки на macOS** называет `mkdir -p "$TMPDIR/<name>"` вместо `mktemp -d`
   (`hardHint`); на Linux и Windows — как было. Test: названная форма получает allow.
4. **Маскировка Journal**: ключи JSON с секретным именем (и в экранированных кавычках), `password X` из `.netrc`,
   заголовки с секретным именем в кавычках (`X-Api-Key:`, `Cookie:`), `curl -ubob:pass` и `curl -u "bob:a b"`,
   `-p` у `docker login` / `podman login` / `sshpass`, `--key`. Unit test на каждую форму.
5. **`removeTreeAsync` обходит дерево через `fs/promises`**: event loop свободен, отказ при смонтированном томе и при
   части, которую не видно, — как был.
6. **Политика судит во всём окружении процесса.** Фабрика query говорит Session-у окружение, с которым стартует
   Claude Code (`QueryRequest.processEnv`), driver передаёт его в каждый запрос (`ApprovalWhere.env`), политика
   судит в нём. Без него — окружение shell-а Run-а и переменные процесса поверх, как в раунде 2.
7. **`ZDOTDIR` для `zsh -c`, `ENV` (и `BASH_ENV`) для `sh -c`** — not-judged, как `BASH_ENV` для `bash -c`.

**Mutation testing раунда 3**: 35 mutant-ов на изменённых строках (policy, run-approval, shell, journal, remove,
query, driver Claude), 32 убиты сразу, 3 выжили и убиты новыми случаями: чтение git-а в подпапке worktree
(`cd src && git status`), решение самой политики для процесса с `GIT_NO_LAZY_FETCH` (park `git-hooks` вместо park
окружения Run-а) и папка, где git не прочитался. Выживших нет.

### Раунд 4 (review PR #1460: 1 medium, 2 low; CI Windows)

1. **Файлы config-а, которые подключает git, защищены как `.git/config`.** Факты читаются через
   `git config --list -z --show-origin`. Каждый файл-origin записи и каждая цель `include.path` /
   `includeIf.*.path` (`~/` от HOME, относительный путь — от папки файла, который его называет; и файл, которого
   ещё нет: git его пропускает, а запись добавила бы config) — защищённая область, как папка hooks. Запись в неё
   (Write, Edit, перенаправление shell-а, `cp`, `rm`) — deny `git-files`. Test-ы на настоящем git-е:
   `include.path` абсолютный и относительный, `includeIf.gitdir`, существующий файл, `config.worktree`; одна команда
   «запись + git» и отдельные запросы.
2. **Два вызова git-а на checkout.** `git config --list -z --show-origin` и `git rev-parse --git-dir
   --git-common-dir`; папка hooks, HEAD, origin/HEAD и старые папки `remotes/` и `branches/` читаются как файлы.
   Запрос, который не пишет и не вызывает git, фактов git-а не читает. Worktree-ы Wave и checkout git-команды
   читаются, только когда у checkout-а может быть свой config (`extensions.worktreeConfig`, любой `includeIf`);
   иначе их факты — факты корня. Git вне всех checkout-ов не читается: там git не одобряется.
   Вызовов git-а на запрос (3 worktree-а в Wave, измерено счётчиком перед настоящим git-ом в PATH):

   | Запрос | До | После |
   |---|---|---|
   | чтение без git-а (`cat`) | 29 | 1 |
   | запись (`rm -rf build/x`, Write) | 29 | 3 |
   | `git status` в worktree | 29 | 3 |
   | `cd build && git status && git log` | 36 | 3 |
   | запись при config-е worktree-а | 29 | 9 |
   | `git status` дважды в одном worktree при config-е worktree-а | — | 5 |

3. **Маскировка Journal сужена по контексту.** Заголовки — только после `-H` / `--header` у curl, wget и HTTPie;
   `-u user:pass` — только у curl и wget; `--key` — только как `--private-key`, `--access-key` и подобные;
   `password X` — только в строке `.netrc` (`machine … password …`, `default … password …`). Формы раундов 2 и 3
   скрыты, как были. Unit test на каждую ложную маскировку: `sort --key`, сообщения commit-а «auth: …»,
   «keyboard: …», «session: …», `grep password`, `docker run -u`, `rg "apiKey: string"`, `grep -H`.
4. **CI Windows, `windows (2/3) / full-suite`**: contract test ждал путь в `targets` со `/`, а на Windows путь идёт с
   `\`. Test сравнивает путь с одним разделителем; продукт пути не сравнивает со `/` как строки. Ожидания путей
   config-файлов в unit test-ах сравниваются так же (на Windows и без учёта регистра).
5. **CI Windows, `windows-e2e (2/4)`, `test/e2e/interface-scale.spec.ts:379`** — PR не трогает ни этот spec, ни
   код масштаба (`git diff --stat origin/main...HEAD`): падение не из этого PR.

**Mutation testing раунда 4**: 34 mutant-а на изменённых строках. 19 убиты сразу, 15 выжили. Все 15 убиты новыми
test-ами: чтение `--bool`, `hooksPath` без значения, remotes с точкой в имени и из старых папок, цели include от
HOME, HEAD `.invalid`, счёт вызовов git-а (повторное чтение, корень, worktree-ы для git-а), config-файлы корня без
своего config-а у checkout-а, `grep -H`, `docker run -u "…"`. Выживших нет. Git вне всех checkout-ов теперь не
читается: строка, на которой выжил mutant, упрощена.

### Раунд 5 (review PR #1460: 2 high, регрессии раунда 4)

1. **Worktree с чужим общим git-каталогом.** Раньше worktree Wave без своего config-а получал факты корня, даже
   когда его `commondir` называл другой общий git-каталог (с `core.fsmonitor` или hook-ами там): `git status`,
   `git add`, `git commit` получали allow. Теперь на каждый запрос с git-ом run читает файлами (без вызова git-а)
   `.git`-файл worktree-а и `commondir` его git-папки. Если `commondir` не ведёт в общий git-каталог корня
   (`git rev-parse --git-common-dir`) или файл не читается, фактов у worktree-а нет: git там получает park
   `git-hooks`, как в раунде 3. Чтение refs и объектов (`git log`) — как в раунде 3: allow только процессу с
   `GIT_NO_LAZY_FETCH`. Цель `.git`-файла вне `<checkout>/.git/worktrees/` policy уже отклоняет сама
   (`ownRepository`, deny `not-judged`); отдельной проверки в run-approval нет. Test-ы на настоящем git-е: P1
   (`core.fsmonitor`) и P2 (`pre-commit`) из probe review-а, `.git`-файл с чужой целью, без строки `gitdir`, с
   относительным `gitdir`, `commondir` в несуществующую папку и без `commondir`. Число вызовов git-а не изменилось.
2. **Маскировка Journal — снова как на 7af4d4a2b (раунд 3).** `journal.ts` возвращён к 7af4d4a2b целиком; сужение
   раунда 4 (заголовки только у curl/wget/HTTPie, `-u` только у curl/wget, `--key` только как `--private-key` и т.п.,
   `password` только в строке `.netrc`) убрано вместе с его test-ом. Table test: каждый вход test-ов раундов 2 и 3
   и другие формы review-а (`gh api -H`, `git -c http.extraHeader`, curlie, wget2, `aria2c --header=`, HTTPie/xh,
   `.netrc` в несколько строк, `echo password … | sudo -S`, `-u user:pass` у lftp/rsync/mongo, голый `--key`) дают
   вывод 7af4d4a2b. Ложные срабатывания раунда 4 (`sort --key`, `git commit -m "auth: …"`, `grep password`,
   `docker run -u 1000:1000`, `rg "apiKey: string"`, `grep -H "token: …"`) снова маскируются; они уходят в
   follow-up ticket (решение координатора).

**Mutation testing раунда 5**: 17 mutant-ов на изменённых строках, потом 6 на строках после правки. Первая
серия: 11 убиты, 6 выжили. Строка с пустым `commondir` упрощена (пустой путь ведёт в саму git-папку и так не
совпадает); проверка цели `.git`-файла убрана как повтор `ownRepository`; для `commondir` в несуществующую папку
добавлен test. Эквивалентны три: `.git` без строки `gitdir` (policy отклоняет такой worktree раньше фактов),
`commonDir` null (без репозитория в корне `git worktree list` не даёт checkout-ов, и git вне checkout-ов не
читается), строка корня (git в своём checkout-е Project-а policy не одобряет: `outside-roots`). Вторая серия:
2 убиты, mutant `resolve(path, named)` убит test-ом с относительным `gitdir`; два выживших эквивалентны по
построению (`real` null недостижим, замена null на `''` даёт тот же false).
