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
- [ ] Contract test: `shadow` — агент получает прежний текст отказа, в Journal `would-allow` с правилом.
- [ ] Contract test: `on` — запрос внутри worktree Wave проходит; вне корня — deny с подсказкой; hard deny — отказ.
- [ ] Unit test очистки: домашняя папка, `GH_TOKEN=…`, длинная команда — в строке Journal нет ни секрета, ни пути дома.
- [ ] Переключение режима во время Run-а действует со следующего запроса; строка Journal называет режим.
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
   и не 1, по пункту 5 Ticket-а) — Run идёт как при Off, без папки Run-а и без окружения git-а.
2. **Папка Run-а и окружение git-а — во всех режимах**, Off тоже: пункт 4 Ticket-а не ставит их в зависимость от
   режима. Поток событий и Journal при Off от этого не меняются (contract test Off).
3. **Shadow не пишет `refused-dialog`**: отказ при Shadow — решение политики, его строка — `auto-approval` с `would-*`.
   При Off `refused-dialog` как прежде.
4. **park при On** пишется в Journal как `park`, агенту — deny с `PARK_PENDING_HINT` (заготовка до Ticket-а 07).
5. **`checkouts` читаются при каждом запросе**, а не кешируются до смены Wave, как пишет пункт 5: implementer
   создаёт свой worktree после старта Wave, и кеш его бы не видел. Список, который не прочитался, — deny
   `no-checkouts`, пустым не передаётся.
6. **Worktree Wave записывается в корни при первом запросе, который его видит**, а не «при создании»: worfy не видит
   момента создания. Worktree находится по ветке `<epic>/<NN>` (комментарий `shortcut:` в `run-approval.ts`: шаблон
   ветки Profile-а не читается).
7. **`rebaseUpdateRefs`, `hooksPath`, `hooksActive`, `remotes` читаются в корне Project-а**, не «в worktree-е Run-а»:
   на старте Run-а worktree-ов Wave ещё нет, а config у worktree-ов общий (кроме `extensions.worktreeConfig`).
8. **Ветка по умолчанию**: `refs/remotes/origin/HEAD`, иначе текущая ветка корня, иначе `main`.
9. **Run id приходит в Journal из политики** (`RunStart.run`): папка Run-а создаётся до `setUnattended`, а файл Journal
   — после, и имя у них одно. Чужой id (`../x`) `openRun` отказывает; существующий файл не переоткрывается.
10. **Takeover**: Session, которую новый Run принял на ходу, продолжает с прежним `TMPDIR`, поэтому папка старого Run-а
    при takeover не удаляется. Цена — она остаётся в `autopilot-tmp` до ручной уборки.
11. **Строка `auto-approval`**: `targets` тоже с `~` и не длиннее 200; секрет — имя, в котором есть `TOKEN`, `KEY`,
    `SECRET` или `PASSWORD` (без учёта регистра), значение в кавычках или до пробела.
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
