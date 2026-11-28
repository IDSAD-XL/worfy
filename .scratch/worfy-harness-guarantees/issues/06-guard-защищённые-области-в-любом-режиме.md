# 06: guard: защищённые области в любом режиме

Type: task
Status: claimed 2026-11-28T17:38Z
Branch: worfy-harness-guarantees/06
Blocked by: 01, 03, 08
Source: [spec.md](../spec.md), «Ticket-ы», 06; «Решение», 3; «Решения по реализации» («guard: защищённые области»,
«Один список в двух языках»); «Решения по test-ам», Seams (contract test равенства), «Сначала падающий test», 06,
«Mutation testing» и «Windows»; «Риски» («Лексический guard обходится», «Память Claude Code открыта»); «Вопросы
владельцу», Q2 (в); «Волны», Wave 4

Кто: агент. Глубина ревью — `high`; reviewer делает mutation testing: убирает каждое правило deny в отдельной копии
репозитория, хотя бы один test краснеет.

Платформенный PR (ADR-0056, пункт 2): hook Harness, `%APPDATA%`, Git Bash и регистр путей на Windows; до merge нужен
Windows verdict.

## Что происходит

- Hard deny Approval policy (ADR-0098; области — `HOME_AREAS`, `src/main/agent/auto-approve/roots.ts:185-198`, `:236-238`;
  правила — `src/main/agent/auto-approve/policy.ts:231-236`) судит только запросы разрешения, которые агент задаёт.
  В `bypassPermissions` и в Codex Full access запросов нет.
- Unattended Orchestrator идёт в `bypassPermissions` (`src/main/vendors/claude/options.ts:795`); ручные Session-ы —
  тоже, если пользователь не выбрал другой режим (`options.ts:5`).
- В `bypassPermissions` из guard.mjs остаются три раздела: уничтоженная работа, pipe, который прячет exit code, следы
  Silent mode (`harness/hooks/guard.mjs:161`, `:212`, `:235`). Запись в `~/.claude`, `~/.codex`, данные worfy, настройки
  ОС ничем не закрыта.
- Сегодня `echo x > ~/.claude/settings.json` в `bypassPermissions` проходит.

## Что строить

- Новый раздел guard-а (после раздела Ticket-а 03 в том же файле): отказ записи и удаления в областях hard deny
  Approval policy, в любом permission mode.
  - Области — те же, что `HOME_AREAS` (`roots.ts:185-198`: `.claude`, `.codex`, `.ssh`, `.gnupg`, `.config/gh`,
    `.gitconfig`, `.git-credentials`, `.config/git`, `.npmrc`, rc-файлы shell, `Library`), `%APPDATA%` на Windows,
    данные worfy и Harness home (`roots.ts:236-238`).
  - Путь данных worfy guard берёт из окружения, которое worfy задаёт Session-у (переменная — имя предложение,
    `sessionEnv` `options.ts:780` и окружение Run-а Codex `src/main/vendors/codex/session.ts:962`); без неё — платформенный
    default.
  - Плюс `.git/hooks/` и `.git/config` любого репозитория как прямой путь записи; команды git идут как прежде.
  - Чтение не отказывается: агенты читают `~/.claude/worfy-harness/projects/*/rules*.md`.
  - Исключения: память Claude Code (`~/.claude/projects/*/memory/`), файлы, которые Claude Code ведёт инструментами
    Session (список — из «Итог» spike-а 01), папка Card-ов Project-а (`cardsDir`, `options.ts:232-233`).
- Команды из правил hard deny: `os-settings` и `run-download` (`policy.ts:233`, `:235`). Категории, которые зависят от
  корней Run-а (`chmod-outside`, `send-outside`, `other-session`, `other-worktree`), остаются у политики: корней Run-а
  guard не знает.
- Команда, которую guard не прочёл, проходит (`guard.mjs:20-26`): обход скриптом описан в «Рисках» spec-а.
- Ручные Session-ы — решение владельца 2026-11-28, Q2 (в):
  - Session без человека (Autopilot; признак — окружение, которое worfy задаёт Session-у) — отказ;
  - ручная Session — `permissionDecision: "ask"`, если spike 01 подтвердил, что `ask` в `bypassPermissions` спрашивает
    человека; иначе — отказ везде, как Q2 (а), и в терминале тоже;
  - выбранная ветка и ответ spike-а записываются в «Итог».
- Один список в двух языках:
  - contract test `test/contract/guard-policy-parity.test.ts` (имя — предложение) сверяет области и id правил guard-а с
    `roots.ts` и `policy.ts`;
  - одна таблица команд проходит через `src/main/agent/auto-approve/shell.ts` и через guard и даёт одно hard-решение;
  - одно расхождение записано в таблице: политика считает `--force-with-lease` force push-ем (`shell.ts:105`, `:901`), а
    guard пропускает lease в ветку PR (Ticket 05).
- Case-ы contract set-а (Ticket 08, `src/main/harness/contract/`): отказ записи в `~/.claude` в `bypassPermissions` и
  правило Ticket-а 03 (Edit implementer-а в путь проверки вне trail-а).

## Где в коде

- `harness/hooks/guard.mjs` — новый раздел областей, `expandPath` `:849-861` (win32 `:858-859`)
- `harness/hooks/tests/guard-areas.test.sh` (новый, имя — предложение)
- `test/contract/guard-policy-parity.test.ts` (новый, имя — предложение)
- `src/main/vendors/claude/options.ts` — `sessionEnv` `:780` (путь данных worfy и признак Session без человека)
- `src/main/vendors/codex/session.ts` — окружение Run-а `:962`
- `src/main/harness/contract/` (Ticket 08) — два новых case-а
- Только читать: `src/main/agent/auto-approve/roots.ts` (`:185-198`, `:236-238`), `src/main/agent/auto-approve/policy.ts`
  (`:231-236`), `src/main/agent/auto-approve/shell.ts` (`:105`, `:901`)

## Test-ы

- Shell test-ы на JSON PreToolUse: запись и удаление в каждой области (Bash, Edit, Write, `apply_patch`) — deny; чтение —
  allow; память Claude Code, файлы Session по spike-у и папка Card-ов — allow; `.git/hooks/x` и `.git/config` — deny,
  `git config user.name` — как прежде; `os-settings` и `run-download` — deny.
- Ручная и unattended Session по Q2 (в): unattended — deny; ручная — `ask` или deny, по ответу spike-а 01.
- Contract test равенства с `roots.ts` и `policy.ts`; таблица команд через `shell.ts` и guard.
- Сначала падающий test: `echo x > ~/.claude/settings.json` в `bypassPermissions` сегодня проходит; test ждёт deny.
- Windows: `%APPDATA%`, Git Bash, регистр — тот же shell test на ПК в CI.
- Без моделей и без сети.

## Готово, когда

- [ ] Запись и удаление в защищённых областях отказаны в `bypassPermissions` и в Codex Full access; `.git/hooks/` и
      `.git/config` — тоже (shell test-ы, красный на старом коде).
  - evidence: test-run pass · `bash harness/hooks/tests/guard-areas.test.sh` exit 0 (172 passed; exit 1 with 126 failed on the old guard) · mac - · c31b217f294883afcb0b7fced0560822969b113f
- [ ] Чтение правил Harness, память Claude Code, файлы Session по spike-у 01 и папка Card-ов открыты.
  - evidence: test-run pass · `bash harness/hooks/tests/guard-areas.test.sh` exit 0 (open places and reads) · mac - · c31b217f294883afcb0b7fced0560822969b113f
- [ ] Ручные Session-ы — по Q2 (в): unattended — отказ; ручная — `ask` или отказ по ответу spike-а 01, ветка названа в
      «Итог».
  - evidence: test-run pass · `bash harness/hooks/tests/guard-areas.test.sh` exit 0 (Q2 branch (в): unattended deny, manual ask, Codex deny) · mac - · c31b217f294883afcb0b7fced0560822969b113f
- [ ] Contract test: области и id правил guard-а равны `roots.ts` и `policy.ts`; таблица команд даёт одно hard-решение
      в `shell.ts` и guard-е, расхождение с lease записано.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs run test/contract/guard-policy-parity.test.ts` exit 0 · mac - · c31b217f294883afcb0b7fced0560822969b113f
- [ ] Contract set Ticket-а 08 получил case-ы области `~/.claude` и правила Ticket-а 03.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs run test/contract/harness-guarantees.test.ts` exit 0 · mac - · c31b217f294883afcb0b7fced0560822969b113f
- [ ] Mutation testing reviewer-а: снятие каждого нового правила deny краснит хотя бы один test.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR, включая Windows verdict.

## Итог

- Сначала падающий test: `harness/hooks/tests/guard-areas.test.sh` на старом guard-е — 126 из 170 case-ов красные,
  первый — «`echo x > ~/.claude/settings.json` in bypassPermissions, no person at the Session -> deny»: guard пропускал
  запись (`allow`). После правки — 172 из 172 зелёные.
- Ветка Q2 — (в). Spike 01, пункт 4: `permissionDecision: "ask"` в `bypassPermissions` спрашивает человека (SDK зовёт
  `canUseTool`), а в `claude -p` без permission prompt tool `ask` сам становится отказом. Поэтому:
  - Session без человека — отказ. Признак — `WORFY_UNATTENDED=1`: worfy задаёт его unattended Session-у Claude
    (`sessionEnv`, `src/main/vendors/claude/options.ts`) и Codex (окружение app-server-а, `src/main/vendors/codex/session.ts`)
    через `guardVariables` (`src/main/vendors/session.ts`);
  - ручная Session Claude Code (и терминал) — `ask`; `ask` не пишет строку в `WORFY_GUARD_LOG`: это не отказ;
  - Codex — отказ всегда, и в ручной Session: парсер ответа PreToolUse Codex 0.166 не принимает `ask` («invalid
    pre-tool-use JSON output», hook считается упавшим, и вызов проходит; `test/fixtures/codex-app-server/hook-runner.mjs`
    по `output_parser.rs`). На Codex действует Q2 (а).
  - `ask` ждёт разделы 1–3: их отказ сильнее (test «a commit with workflow traces and a protected write»).
- Области — `harness/lib/protected-areas.cjs` (новый модуль, вне trail-а: contract test должен прочесть список guard-а,
  а `guard.mjs` — скрипт, который читает stdin, его нельзя импортировать): `HOME_AREAS` в порядке и с id `roots.ts`,
  `XDG_CONFIG_HOME/{gh,git}`, `%APPDATA%` на Windows, данные worfy, Harness home (`harnessHome` из `eval-env.cjs`).
  Дома — `HOME` (форма Git Bash `/c/…` читается как `C:/…`) и домашняя папка системы. Регистр не важен на Windows и macOS.
  Путь сравнивается как назван и через ссылки ближайшей существующей папки; удаление папки над областью (`rm -rf ~`)
  — тоже отказ.
- Данные worfy: `WORFY_GUARD_DATA_DIR` (имя — предложение тикета) worfy задаёт, только когда `WORFY_DATA_DIR` увёл папку
  с default-а (`dataRoot()`); без неё guard знает оба default-а платформы — `worfy` и `worfy-dev`.
- Открыто: память Claude Code `<home>/.claude/projects/*/memory/` и планы `<home>/.claude/plans/` (spike 01, пункт 7: их
  модель пишет Write/Edit; `tasks/` matcher не видит вовсе), папки Card-ов `<данные worfy>/*/cards/` любого Project-а, и
  `TMPDIR` Session-а, если он лежит внутри области: unattended Session получает `<данные worfy>/autopilot-tmp/<run>`
  (`runTempsDir`), без исключения guard отказал бы каждому временному файлу Autopilot-а. Чтение не отказывается.
- `.git/hooks/` (и ниже) и `.git/config` любого репозитория — прямой путь записи, id `git-files`, как у политики; папка
  над ними (`rm -rf .git`, временный репозиторий test-а) не отказывается. `git config …` идёт как прежде.
- Команды: `os-settings` — программы списка `policy.ts` (`sudo`, `su`, `doas`, `launchctl`, `security`, `pfctl`,
  `socketfilterfw`, `netsh`, `reg`, `crontab`; `defaults`, `schtasks`, `networksetup` — кроме чтения), и за обёртками
  (`env`, `nohup`, `xargs`, `timeout`…), и в `-c` shell-а на уровень вниз. `run-download` — загрузка `curl`/`wget`, которую
  pipe несёт в shell без `-c` или в интерпретатор без скрипта (`| sh`, `| python3`), и `sh -c "$(curl …)"`,
  `bash <(curl …)`, `eval "$(curl …)"`.
- Contract test `test/contract/guard-policy-parity.test.ts`: области и id guard-а равны `rootsOf` (`roots.ts`) на linux,
  darwin и win32; id guard-а — id `HARD_HINTS`, а каждое hard-правило политики либо у guard-а, либо в списке «оставлено
  политике» (корни Run-а и правила git push/веток — раздел merge Ticket-а 05). Таблица из 36 команд идёт через `judge`
  (парсер `shell.ts`) и через процесс guard-а. Записанные расхождения — три, не одно:
  - `--force-with-lease`: политика — `git-force-push`, guard пропускает (lease в ветку PR, Ticket 05);
  - `cat ~/.ssh/id_demo`: политика отказывает чтению секрета, guard чтение не отказывает (spec, «Решение», 3);
  - `curl … | jq`: политика считает `run-download`, потому что `jq` вне таблицы её парсера и «может исполнить»
    прочитанное; guard отказывает только shell-у и интерпретатору, которые исполняют вход: отказ на каждом вызове каждой
    Session не должен ломать обычную работу.
- Contract set Ticket-а 08 (`src/main/harness/contract/cases.ts`): case 7 `guard-claude-home` — Bash
  `echo … > ~/.claude/settings.json` в `bypassPermissions`, `WORFY_UNATTENDED=1`, ждёт отказ по `claude-home`; case 8
  `guard-verification-trail` — Subagent пишет новый `.github/workflows/new.yml`, которого trail `ep 07` на `origin/main` не
  называет, ждёт отказ правила Ticket-а 03. Оба зелёные на binary SDK со stand-in-ом (`harness-guarantees.test.ts`).
- Mutation testing сам, в копии через `HOOKS_DIR`: снятие gnupg из `HOME_AREAS`, исключения Card-ов, `.git/hooks`,
  `.git/config`, списка `os-settings`, `defaults`, `run-download`, `XDG_CONFIG_HOME`, Harness home, исключения `TMPDIR`,
  проверки по реальному пути, отказа на Codex и `ask` ручной Session — каждое краснит от 1 до 27 case-ов.
- Вне trail-а, по необходимости: `src/main/vendors/session.ts` (`guardVariables`, общий для обоих Vendor-ов),
  `harness/lib/README.md`, `harness/evals/lib/coverage.json` (новый lib назван, иначе `harness-evals-run.test.ts`
  красный), test-ы `test/unit/agent-options.test.ts` и `test/contract/codex-session.test.ts`, строка Codex в
  `docs/features/harness.md`. Три test-а сравнивали окружение Session-а целиком и получили переменные guard-а в
  ожидании: `test/unit/agent-query-factory.test.ts`, `test/contract/workflow-profile.test.ts`,
  `test/contract/orchestrator-wave-epic.test.ts` (test-ы ставят `WORFY_DATA_DIR`, поэтому `WORFY_GUARD_DATA_DIR` есть).
- Риски и пробелы: guard лексический — скрипт, который пишет файл сам (`node -e …`), и путь за переменной, которую guard
  не читает, проходят (spec, «Риски»; второй проверки для областей нет). Раскрываются `$HOME`, `$TMPDIR`, `$APPDATA`,
  `$USERPROFILE`, `$XDG_CONFIG_HOME`; синтаксис cmd `%APPDATA%` — нет. `CLAUDE_CONFIG_DIR` и `CODEX_HOME` вне дома не
  защищены (политика их тоже не знает). Tool PowerShell Claude Code на Windows matcher не видит. Память Claude Code открыта
  (spec, «Риски»). Windows-ветки shell test-а (`%APPDATA%`, путь Git Bash, обратные слэши) идут только в Git Bash на ПК;
  чтение путей win32 модулем проверено на любой системе — Windows verdict даёт CI.
