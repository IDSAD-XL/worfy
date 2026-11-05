# 04 — Claude: политика в unattended canUseTool, Shadow, строка Journal

Type: task
Status: open
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
     значением не `true` и не `false`, `diff.external`, `core.sshCommand`, или ключ, который кончается на
     `.program`, `.command`, `.cmd`, `.driver`, `.textconv`, `.clean`, `.smudge`, `.process` или
     `.defaultKeyCommand` (сюда входят `gpg.program`, `gpg.*.program`, `gpg.ssh.defaultKeyCommand`,
     `diff.*.command`, `merge.*.driver`, `trailer.*.cmd`, filters). Имена и окончания сравниваются без учёта
     регистра: `git config --list` печатает имя секции и последнюю часть ключа строчными (`core.sshcommand`,
     `gpg.ssh.defaultkeycommand`), а средняя часть (`trailer.Sign.cmd`) сохраняет регистр. Правило по окончанию
     ключа, а не список: новые ключи git с программой обычно так и названы. `core.sshCommand` назван отдельно: он
     запускает программу на `fetch` и `pull`, а на `.command` не кончается. Цена — в spec, «Решено без владельца»,
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
   `gpg.program` (проверено; Ticket 03, «Итог», пункт 23). `GIT_CONFIG_COUNT` не подходит: он в списке `GIT_ENV` разбора
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
