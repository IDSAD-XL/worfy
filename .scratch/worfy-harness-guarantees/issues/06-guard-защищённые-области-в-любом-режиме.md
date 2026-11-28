# 06: guard: защищённые области в любом режиме

Type: task
Status: open
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
- [ ] Чтение правил Harness, память Claude Code, файлы Session по spike-у 01 и папка Card-ов открыты.
- [ ] Ручные Session-ы — по Q2 (в): unattended — отказ; ручная — `ask` или отказ по ответу spike-а 01, ветка названа в
      «Итог».
- [ ] Contract test: области и id правил guard-а равны `roots.ts` и `policy.ts`; таблица команд даёт одно hard-решение
      в `shell.ts` и guard-е, расхождение с lease записано.
- [ ] Contract set Ticket-а 08 получил case-ы области `~/.claude` и правила Ticket-а 03.
- [ ] Mutation testing reviewer-а: снятие каждого нового правила deny краснит хотя бы один test.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR, включая Windows verdict.
