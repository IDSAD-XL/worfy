# 14 — Перенос: старые файлы Harness уходят из `~/.claude` по форме «уберу / оставлю», с резервной копией и откатом

Type: task
Status: done — 2026-10-08, [PR #136](https://github.com/IDSAD-XL/worfy/pull/136)
Blocked by: 11, 13
Source: решения владельца 2026-10-07, Q19, Q13, Q33, Q4, Q9, Q11, Q11', Q15, Q17, Q24, Q25, Q28, Q8; [ADR-0040](../../../docs/adr/0040-harness-delivery-local-marketplace.md) (состояние машины в `~/.claude/worfy-harness/`, worfy пишет в `~/.claude` только установщиком и переносом); [ADR-0042](../../../docs/adr/0042-profile-on-machine-full-and-silent-modes.md) (Profile целиком на машине, Full mode и Silent mode, `attribution`); [ADR-0043](../../../docs/adr/0043-qmd-is-part-of-harness.md) (qmd — часть Harness, запись qmd в `~/.claude.json` убирается при переносе); [ADR-0047](../../../docs/adr/0047-harness-lessons-by-pr-early-owner-switch.md) (ранний переход машины владельца, откат одной командой); [spec.md](../spec.md)

## Что происходит

- Harness владельца — файлы в `~/.claude`. Это локальный git-репозиторий без remote; `.gitignore`
  версионирует `CLAUDE.md`, `settings.json`, `agents/`, `skills/`, `bin/`, `hooks/`, `profiles/`,
  `gate/config.json`. Что там Harness (Q19):
  - `agents/implementer.md`, `reviewer.md`, `scout.md`; 7 skills — `epic-wave`, `ship-ticket`,
    `retro`, `qmd`, `overnight-fix-loop`, `continuous-audit`, `tickets-to-tasks`; `bin/` кроме личных
    `telegram-mcp`, `auction-staging-db-mcp`, `agent-time-split`; `hooks/`; общие правила в `CLAUDE.md`;
  - в `settings.json` → `hooks` 10 записей, которые ведут в эти файлы: SessionStart
    (`$HOME/.claude/hooks/session-start.sh`, `$HOME/.claude/bin/worktree-lock claim`), TaskCompleted и
    TeammateIdle (`$HOME/.claude/hooks/gate.sh fast`), Stop (`$HOME/.claude/hooks/stop.sh`,
    `$HOME/.claude/bin/worktree-lock beat`, `$HOME/.claude/bin/qmd-refresh --quiet`), SessionEnd
    (`$HOME/.claude/hooks/session-end.sh`, `$HOME/.claude/bin/worktree-lock release`), PreToolUse Bash
    (`$HOME/.claude/hooks/guard.mjs`);
  - `statusLine.command` — `/Users/alexey/Stuff/CanvasForAI/scripts/statusline-bridge.sh` (мост
    Limits в dev-checkout);
  - `~/.claude.json` → `mcpServers.qmd` запускает `/Users/alexey/.claude/bin/qmd-mcp`: убрать
    `bin/qmd-*` и оставить эту запись — сломать qmd;
  - состояние машины: реестр Gate `gate/config.json`, маркеры `gate/state/`, Profile-ы
    `profiles/{worfy,auction,atakama}/` (schema 1; у atakama ещё `bin/`, `lessons/`, `state/`), замки
    worktree `worktree-sessions/` (`~/.claude/bin/worktree-lock:74`).
- Пути в Profile-ах ведут в старые места: `rules.md` и `profile.json` трёх Profile-ов ссылаются на
  `~/.claude/bin/ticket`, `~/.claude/bin/preflight`, `~/.claude/bin/epic-status`,
  `~/.claude/hooks/gate.sh`, `~/.claude/gate/config.json`, `~/.claude/profiles/atakama/…` — в сумме 26
  строк на 2026-10-07 (`grep -c '~/.claude/' ~/.claude/profiles/*/rules.md ~/.claude/profiles/*/profile.json`).
- Личное, которое остаётся (Q19): остальные skills (cloudflare*, sandbox*, wrangler, sentry-cli,
  web-perf, turnstile-spin, agents-sdk, durable-objects и другие), `skills/synced/`, личные
  MCP-серверы в `~/.claude.json`, настройки `model`, `env`, `effortLevel`, `enabledPlugins`, память,
  транскрипты.
- Claude Code запускает hooks plugin и hooks из `settings.json` оба, параллельно. Пока старые записи
  на месте, после установки plugin (Ticket 13) каждый hook идёт дважды.
- Папку `~/.claude/backups/` занимает сам Claude Code (Q19) — резервной копии там не место.
- После Ticket-а 13 plugin `worfy` стоит в `~/.claude/worfy-harness/plugin/`. После Ticket-а 11 есть
  контракт Profile schema 2 (`harness/profiles/README.md`, исходный путь
  `~/.claude/profiles/README.md`), и `bin/profile` читает Profile-ы из
  `~/.claude/worfy-harness/projects/<project>/`, schema 1 — на время перехода. Переносить старое туда
  пока некому.

## Что делаем

1. **Когда доступно.** Перенос предлагается, когда plugin `worfy` установлен и включён (состояние
   Ticket-а 13) и в `~/.claude` есть хоть одна строка из п. 2. Иначе форма называет, чего не
   хватает, и ничего не пишет. Кнопка — в элементе Harness в toolbar (файл Ticket-а 13).
2. **Строки формы (Q19).** Строятся из того, что лежит на диске:
   - файлы и папки `~/.claude/{agents,skills,bin,hooks}/` и `~/.claude/profiles/README.md`, у которых
     есть одноимённые в установленном plugin (туда Ticket 02 импортировал только Harness-файлы Q19).
     Сверка со списком Q19 (3 agents, 7 skills, `bin/` без трёх личных, `hooks/`) — в test-е; имя из
     Q19, которого нет в plugin, — строка «оставлю» с пометкой «нет в plugin»;
   - `CLAUDE.md` — по разделам (заголовки `##` и `###`). У разделов из общих правил Harness
     (заголовки исходного `CLAUDE.md` из импорта Ticket-а 02, история `harness/`) по умолчанию
     «уберу»: их правила теперь приходят hooks plugin (Ticket 05, Q9). У прочих — «оставлю»: в
     `CLAUDE.md` остаётся только личное (Q9);
   - записи `hooks` в `settings.json`, чей `command` ведёт в файл первой группы (`$HOME`, `~` и
     абсолютный путь раскрываются);
   - `statusLine`, если его `command` ведёт в `statusline-bridge.sh` не этой сборки (dev-checkout,
     другой `.app`). Предложение — тот же вызов с мостом этой сборки:
     `<process.resourcesPath>/statusline-bridge.sh` и прежний аргумент (команда пользователя, если
     была). Скрипт по этому пути кладёт в `.app` Ticket 15; это контракт по имени файла, без импорта
     кода. Пока файла там нет или запущена dev-сборка — строка только «оставлю» с причиной. Других
     `statusLine` форма не трогает;
   - группа qmd (Q15, Q19): `bin/qmd-mcp`, `bin/qmd-refresh`, `bin/qmd-sync-main`, запись hook
     `qmd-refresh --quiet`, запись `mcpServers.qmd` в `~/.claude.json`. Группа уходит или остаётся
     целиком: запись без `bin/qmd-mcp` не запустится. По умолчанию «уберу» — иначе после Ticket-а 17
     (сервер qmd в `.mcp.json` plugin) было бы два qmd. Если установленный plugin qmd ещё не
     регистрирует, строка предупреждает: «до Ticket-а 17 qmd в Session-ах нет, агенты ищут grep-ом по
     `qmd.fallback_grep` Profile-а»;
   - состояние машины (Q4, Q11'): реестр Gate, `gate/state/`, Profile-ы, замки worktree — «перенести в
     `~/.claude/worfy-harness/`».
   У каждой строки — «уберу» или «оставлю». Файл показан путём, запись JSON — текстом записи,
   `CLAUDE.md` и `rules.md` — diff-ом.
3. **Profile-ы в schema 2 (Q11, Q11', Q17, Q24, Q25, Q28).** `~/.claude/profiles/<p>/` →
   `~/.claude/worfy-harness/projects/<p>/` по контракту Ticket-а 11. Поля с путями Harness
   (`tickets.status_tool`, `tickets.epic_status`, `workflow.preflight`, `numbering.reserve_with`)
   уходят. `mcp.allowed` — по умолчанию из контракта. Новые поля форма предлагает, владелец
   подтверждает:
   - `mode`: `full`, если каталог Ticket-ов (`tickets.root` или `.scratch` по умолчанию) лежит в
     git-репозитории Project-а, иначе `silent`. У Atakama `.scratch/` и `HANDOFF.md` — в папке над
     тремя репозиториями, вне git (Q24). Q28: worfy и Auction — Full, Atakama — Silent;
   - `language.docs`: значение `language.reports` того же Profile-а;
   - `attribution`: по умолчанию `on`; значение ставит владелец (Q25).
   Остальные поля, `rules.md`, папки `bin/`, `lessons/`, `state/` (atakama) переносятся как есть.
   worktree worfy и Auction остаются где были (Q17). Пути в `rules.md` и `profile.json`, которые ведут
   в перенесённые места, переписываются: `~/.claude/bin/…` → `~/.claude/worfy-harness/plugin/bin/…`,
   `~/.claude/hooks/…` → `~/.claude/worfy-harness/plugin/hooks/…`, `~/.claude/gate/config.json` →
   `~/.claude/worfy-harness/gate/config.json`, `~/.claude/profiles/<p>/…` →
   `~/.claude/worfy-harness/projects/<p>/…`. Форма показывает diff каждого файла.
   Реестр Gate и `gate/state/` — в `~/.claude/worfy-harness/gate/`; формат реестра прежний, если
   контракт Ticket-а 11 не требует иного. Замки `worktree-sessions/` — туда, где их ищет
   `bin/worktree-lock` после Ticket-а 08. В репозиториях Project-ов перенос ничего не пишет
   (ADR-0005); `mode` он определяет только чтением (`git rev-parse`).
   `~/.claude/worfy-harness/` — локальный git-репозиторий (Q4, ADR-0040, п. 5). Если git там ещё не
   заведён, перенос делает `git init` и коммитит перенесённые Profile-ы и реестр Gate. Копия plugin,
   `gate/state/`, замки и резервные копии — состояние, а не история: что из них идёт в `.gitignore`,
   решает исполнитель и пишет в «Итог».
4. **Резервная копия (Q19).** До первой записи — `~/.claude/worfy-harness/backup-<дата>/`: всё, что
   перенос уберёт или поменяет, в прежнем виде — файлы и папки, `CLAUDE.md`, `settings.json`,
   Profile-ы, реестр и состояние Gate, замки. Из `~/.claude.json` — только убранная запись: файл
   большой, его пишет Claude Code, и целиком его не восстанавливают. Рядом — манифест: что откуда
   взято и SHA коммита из п. 5.
5. **Один коммит (Q19).** Если `~/.claude` — git-репозиторий, удаления и правки идут одним коммитом.
   В него входят только пути, тронутые переносом; чужие незакоммиченные правки в него не попадают.
   Сообщение — по-английски. Нет git — шаг пропускается, копия всё равно есть.
6. **Откат одной командой (Q13, Q19).** В копии лежит `restore.mjs`;
   `node ~/.claude/worfy-harness/backup-<дата>/restore.mjs` возвращает всё: revert коммита (без git —
   файлы из копии), запись qmd в `~/.claude.json`, прежний `statusLine`, Profile-ы и Gate на старые
   места. И выключает plugin `worfy` (`claude plugin disable … --scope user`; нет `claude` в PATH —
   печатает эту команду), иначе hooks пойдут дважды. Команда работает без worfy и без plugin. После
   переноса форма показывает путь копии и эту команду.
7. **Сбой посреди переноса.** Перенос сам откатывается тем же путём, что `restore.mjs`, и форма
   называет шаг, на котором упало.
8. **Где пишет.** Только в `~/.claude` (по форме), в `~/.claude.json` (одна запись) и в
   `~/.claude/worfy-harness/`. Это исключение из ADR-0005 (ADR-0040, ADR-0047), и проверяется оно
   только в песочнице (Q8). Настоящий `~/.claude` переносит владелец в Ticket-е 16.
9. **Session-ы, которые уже идут,** стартовали со старыми hooks. Предупреждать ли о них в форме —
   решает исполнитель; решение — в «Итог».

Где Claude Code держит `.claude.json` при заданном `CLAUDE_CONFIG_DIR` — проверить по docs Claude
Code и записать в «Итог»; fixture песочницы кладёт его туда же.

**Не входит:** установка plugin (Ticket 13); скрипт моста в `.app` (Ticket 15); qmd в plugin и его
коллекции (Ticket 17); Silent mode в Harness (Ticket 22); переход машины владельца (Ticket 16);
экран первого запуска (Ticket 19).

## Готово, когда

Песочница во всех пунктах: временные `HOME`, `CLAUDE_CONFIG_DIR` и `WORFY_CLAUDE_HOME`, fixture старого
`~/.claude` (git-репозиторий; Harness-файлы, личные skills и `bin/`, `settings.json` с 10 записями
hooks, `statusLine` и личными ключами, `.claude.json` с `qmd` и личным MCP, реестр и состояние Gate,
три Profile-а schema 1 с путями Harness), установленный plugin (дерево `harness/`), подменённый
`claude`. На настоящем `~/.claude` перенос в этом Ticket-е не запускается.

- [x] Contract test: план на fixture — ровно строки из «Что делаем», п. 2; ни одной личной (личные skills, `skills/synced/`, `telegram-mcp`, `auction-staging-db-mcp`, `agent-time-split`, личный MCP, `model`, `env`, `effortLevel`).
- [x] Перенос «всё уберу»: Harness-файлы исчезли из `~/.claude` и побайтно лежат в `backup-<дата>/`; личные файлы побайтно прежние; в `settings.json` убраны только записи hooks из плана, остальные ключи равны прежним (deep equal).
- [x] `statusLine`: скрипт есть в подменённом `resourcesPath` — команда указывает на него и сохраняет аргумент; скрипта нет или dev-сборка — у строки только «оставлю», `statusLine` прежний.
- [x] Группа qmd: «уберу» — `bin/qmd-*`, запись hook и запись `qmd` в `.claude.json` убраны вместе, личный MCP на месте; «оставлю» — все пять на месте, `.claude.json` побайтно прежний. Plugin без сервера qmd в `.mcp.json` — у строки предупреждение про `qmd.fallback_grep`, plugin с ним — без предупреждения.
- [x] `worfy-harness/` песочницы — git-репозиторий; Profile-ы и реестр Gate в его последнем коммите.
- [x] `CLAUDE.md`: разделы с «уберу» исчезли, с «оставлю» — побайтно на месте.
- [x] Profile-ы: в `worfy-harness/projects/<p>/` у трёх Project-ов `profile.json` schema 2 без полей с путями Harness и с `mode`, `language.docs`, `attribution` из формы; в `rules.md` и `profile.json` нет `~/.claude/bin/`, `~/.claude/hooks/`, `~/.claude/gate/`, `~/.claude/profiles/`; у atakama на месте `bin/`, `lessons/`, `state/`. `bin/profile` из `harness/` (Ticket 11) по fixture-репозиторию Project-а с `--field mode` — код 0 и значение формы.
- [x] Gate: реестр и маркеры — в `worfy-harness/gate/`; `hooks/gate.sh` из `harness/` с `HARNESS_HOME` песочницы на fixture-репозитории не отвечает «проект не зарегистрирован».
- [x] git песочницы: ровно один новый коммит, его файлы — пути переноса; незакоммиченная правка в другом файле осталась незакоммиченной.
- [x] «оставлю» у строки каждого вида (файл, раздел `CLAUDE.md`, запись hook, `statusLine`, Profile) — этот файл или запись не тронуты.
- [x] Откат: `node <копия>/restore.mjs` отдельным процессом — код 0; дерево `~/.claude` песочницы и `.claude.json` равны снимку до переноса (в истории git — revert); подменённый `claude` получил `plugin disable worfy…`.
- [x] Сбой на каждом шаге (подменяется в test-е) — перенос откатился сам, дерево равно снимку до, ответ называет шаг.
- [x] plugin не установлен или выключен — перенос отказывает с причиной и ничего не пишет.
- [x] Снимок песочницы: вне `~/.claude`, `.claude.json` и `worfy-harness/` ничего не появилось; в fixture-репозиториях Project-ов — ничего (ADR-0005).
- [x] e2e (локально в `gate full`): форма открывается из элемента Harness в toolbar, показывает строки по группам и diff `CLAUDE.md`, переключатели «уберу / оставлю» работают; после Move видны путь копии и команда отката. Временный `WORFY_CLAUDE_HOME` с fixture, подменённый `claude`, ответ диалога подменён в main, как в `test/e2e/card-api.spec.ts:135-143`.

## Тесты

Сначала падающий test — `test/contract/harness-migrate.test.ts`: план переноса на fixture называет
10 записей hooks `settings.json` и не называет `telegram-mcp`. Модуля переноса на main нет — test
красный. В «Итог» — как он падал.

- `test/contract/harness-migrate.test.ts` — новый: план, перенос, «оставлю», qmd, `statusLine`,
  Profile-ы, Gate, git, откат, сбой по шагам.
- `test/fixtures/claude-home-legacy/` — новый: fixture старого `~/.claude` без настоящих токенов и
  личных данных владельца; имена — по списку Q19.
- `test/unit/harness-migration-form.test.tsx` — новый: группы строк, переключатели, diff.
- `test/e2e/harness-migrate.spec.ts` — новый.

`restore.mjs` test-ы запускают отдельным процессом `node`, как его запустит человек.

## Где в коде

- `src/main/harness/migrate/plan.ts` — новый: строки формы
- `src/main/harness/migrate/apply.ts` — новый: копия, записи, коммит, автооткат
- `src/main/harness/migrate/profiles.ts` — новый: schema 1 в schema 2, переписывание путей
- `src/main/harness/migrate/restore.ts` — новый: пишет restore.mjs в копию
- `src/main/ipc/harness-migration.ts` — новый
- `src/shared/ipc/harness-migration.ts` — новый
- `src/renderer/harness/MigrationForm.tsx` — новый
- `src/renderer/shell/toolbar/HarnessStatus.tsx` — кнопка формы (файл Ticket-а 13)
- `test/contract/harness-migrate.test.ts` — новый
- `test/fixtures/claude-home-legacy/` — новый
- `test/unit/harness-migration-form.test.tsx` — новый
- `test/e2e/harness-migrate.spec.ts` — новый

Не меняются, только читаются: `harness/bin/profile` (исходный путь `~/.claude/bin/profile`),
`harness/bin/worktree-lock` (`~/.claude/bin/worktree-lock`), `harness/hooks/gate.sh`
(`~/.claude/hooks/gate.sh`), контракт `harness/profiles/README.md` (`~/.claude/profiles/README.md`),
модуль установщика Ticket-а 13 (`src/main/harness/install.ts`). Общих файлов с Ticket-ом 15 нет:
`electron-builder.yml` и `scripts/statusline-bridge.sh` — его файлы, путь моста в `.app` —
контракт по имени (`<Resources>/statusline-bridge.sh`).

## Итог

- **Модули.** `src/main/harness/migrate/plan.ts` — строки формы с диска; `apply.ts` — перенос по шагам;
  `profiles.ts` — schema 1 → schema 2 и переписывание путей; `restore.ts` — текст `restore.mjs` и манифест.
  IPC: `harnessMigration.offer` (показывать ли кнопку; `claude` не вызывает), `harnessMigration.plan` (строки,
  ничего не пишет), `harnessMigration.apply` (перенос после нативного диалога «Move / Cancel»). Форма —
  `src/renderer/harness/MigrationForm.tsx`; кнопка «Move old Harness…» — в элементе Harness toolbar
  (`HarnessStatus.tsx`), пока в `~/.claude` есть что переносить. Перенос предлагается там же, где установка
  Ticket-а 13: в `.app` или с `WORFY_CLAUDE_HOME` (песочница). dev-сборка на настоящем `~/.claude` ничего не
  переносит: форма называет причину, `apply` отказывает до чтения plugin-а.
- **Строки.** Файлы `agents/`, `skills/`, `bin/`, `hooks/` и `profiles/README.md`, у которых есть одноимённые в
  `<harnessHome>/plugin/`. Имя Q19 без пары в plugin — строка только «Keep» с пометкой «not in the plugin»: в
  копии сборки нет `bin/tests` и `hooks/tests` (сборка их вырезает), а `bin/ТИКЕТЫ.md` в `harness/` назван
  `TICKETS.md`. Записи hooks — те, чей `command` ведёт в файл первой группы (`$HOME`, `${HOME}`, `~` и
  абсолютный путь раскрываются через HOME, с которым работает Claude Code). Запись к файлу без пары в plugin —
  только «Keep». Перенос отказывает, если оставить запись hook, а её файл убрать.
- **CLAUDE.md.** Разделы `##` и `###`, блоки кода пропускаются. Раздел кончается на следующем заголовке
  любого уровня: текст под `#` или `####` после раздела Harness к нему не относится и всегда остаётся.
  Diff в форме показывает файл целиком. Заголовки исходного `CLAUDE.md` взяты из импорта Ticket-а 02
  (`git show 728ee71^:harness/rules/global.md`, 16 заголовков) и лежат константой в `plan.ts`. По умолчанию
  «уберу» — раздел из этого списка, который несёт plugin: заголовок есть в `hooks/rules/*.md`, а у
  «Workflow: orchestrator + subagents» вступление открывает `hooks/rules/orchestrator.md` (Ticket 05).
  «Standing authorization» по умолчанию остаётся с пометкой: это личное согласие пользователя, plugin не
  даёт его за пользователя (долг Ticket-а 05). **Решено без владельца, подтвердить.**
- **statusLine.** Строка есть, если команда ведёт в `statusline-bridge.sh` не этой сборки. Предложение —
  `<process.resourcesPath>/statusline-bridge.sh` и прежний аргумент как есть. В dev-сборке или без файла
  моста строка только «Keep» с причиной.
- **qmd.** Три скрипта, запись hook `qmd-refresh --quiet` и `mcpServers.qmd` из `.claude.json` — одна строка.
  Запись `.claude.json` входит в группу, только если её `command` ведёт в `bin/qmd-*` старого Harness. Без
  сервера `qmd` в `<plugin>/.mcp.json` у строки предупреждение про `qmd.fallback_grep`.
- **Где `.claude.json`.** При `CLAUDE_CONFIG_DIR` — `$CLAUDE_CONFIG_DIR/.claude.json`, иначе `~/.claude.json`.
  Проверено по бинарю Claude Code из SDK 0.3.289: `configPath: join(process.env.CLAUDE_CONFIG_DIR || homedir(),
  ".claude.json")`. В песочнице `WORFY_CLAUDE_HOME` worfy передаёт `claude` этот каталог как
  `CLAUDE_CONFIG_DIR`, поэтому `.claude.json` лежит в нём; fixture кладёт его туда же. Запись — через
  временный файл рядом и `rename`, права файла сохраняются; формат (отступ, перевод строки в конце) — прежний.
- **Profile-ы.** `~/.claude/profiles/<p>/` → `<harnessHome>/projects/<p>/`: `schema: 2`; четыре поля с путями
  Harness убраны; `mode` и `attribution` встают после `title`; `language.docs` добавлен в `language`
  (строка `"language": "en"` разворачивается в `{reports, team, docs}`). `mode` — `full`, если папка
  Ticket-ов (`tickets.root`, по умолчанию `.scratch`; относительный путь — от первого репозитория Profile-а
  в реестре Gate) лежит в git; иначе `silent`. Проверка — только `git rev-parse` с `GIT_OPTIONAL_LOCKS=0`.
  `mcp.allowed` не пишется: отсутствие поля и есть умолчание контракта. Пути переписываются в
  `profile.json` (во всех строках) и в `rules.md`: `bin/` и `hooks/` → `worfy-harness/plugin/…`, `gate/` →
  `worfy-harness/gate/`, `profiles/README.md` → `worfy-harness/plugin/profiles/README.md`, `profiles/` →
  `worfy-harness/projects/`; `agents/` трёх агентов Harness (и список в фигурных скобках) и `skills/` семи
  skills Harness → `worfy-harness/plugin/agents/` и `…/plugin/skills/`; личные skills не трогаются.
  Папки `bin/`, `lessons/`, `state/` переносятся как есть. Если `projects/<p>` уже есть — строка только «Keep».
- **Состояние.** Реестр → `<harnessHome>/gate/config.json` (если там уже есть реестр — только «Keep»). Маркеры
  `gate/state/` и замки `worktree-sessions/` сливаются в `<harnessHome>/gate/state/` и
  `<harnessHome>/worktree-sessions/` (там их ищет `bin/worktree-lock` после Ticket-а 08). Файл, который в цели
  уже есть, не перезаписывается; его прежняя версия остаётся только в копии. Из старых папок перенос
  удаляет только файлы, которые нашёл и скопировал шаг `backup`, затем пустые папки. Файл, который живая
  Session написала во время переноса, остаётся на месте.
- **git `worfy-harness/`.** Если репозитория нет, перенос делает `git init` и коммитит `.gitignore`,
  `projects/` и `gate/config.json`. В `.gitignore` — список разрешённого: копия plugin-а, `gate/state/`, замки,
  `backup-*/` и `projects/*/state/` — состояние, а не история (**решено исполнителем**).
- **Копия и откат.** Копия — `<harnessHome>/backup-<ГГГГ-ММ-ДД-ЧЧ-ММ-СС>/`: `claude/<путь>` — всё, что перенос
  убирает или меняет в `~/.claude`; `manifest.json` — что откуда, что создано в `worfy-harness`, убранная
  запись `.claude.json` с её местом среди серверов, SHA обоих коммитов. Там же `restore.mjs`. Он выключает
  plugin (`claude plugin disable worfy@worfy-harness --scope user`; без `claude` в PATH печатает команду),
  делает `git revert` коммита переноса и возвращает файлы из копии побайтно. Созданное в `worfy-harness`
  он убирает, а запись `qmd` ставит на прежнее место. **Изменённое после переноса он не стирает, а
  откладывает в копию.** Перенос пишет в манифест отпечаток (хеш содержимого и прав) каждого пути, который
  оставил. Путь, который с тех пор изменился, `restore.mjs` сначала копирует в `<копия>/after/`, до `git
  revert` и до возврата файлов: урок `/retro`, правку `rules.md`, правку `settings.json` от Claude Code,
  новый маркер. `.git`, заведённый переносом, уезжает в `after/harness-git/`. Путь, которого перенос не
  коснулся (он упал раньше), остаётся как есть. Каждый запуск откладывает в свою папку (`after/`, затем
  `after-2/`, …), поэтому следующий запуск не перезаписывает отложенное прежним. Законченный откат
  помечает манифест (`restoredAt`). Второй запуск `restore.mjs` — и после ручного отката, и после
  автоотката упавшего переноса — пишет «Already restored at …», ничего не трогает и выходит с кодом 0.
  Не откладывается только запись Claude Code в `settings.json` или `.claude.json`, сделанная в миллисекунды
  между чтением и записью этого файла самим переносом (абзац «Гонки с живой Session»). Все пути манифеста проверяются до первого действия: путь вне Claude
  home или Harness home останавливает откат, и ничего не меняется. Сбой шага: перенос импортирует тот же
  `restore.mjs` и вызывает `restore` без выключения plugin-а (до переноса plugin был включён). Ответ
  называет шаг. Копия удаляется, если в её `after/` нет ничего, кроме `harness-git`; иначе форма называет
  путь копии.
- **Порядок шагов:** `backup` → `settings` → `claude-json` → `claude-md` → `state` → `files` →
  `epic-status` → `commit`. `bin/epic-status` удаляется последним, после записей hooks в `settings.json`
  (долг Ticket-а 12 к `ADR-0049:44`): пока он есть, worfy видит `legacy` и не даёт Session-ам plugin inline.
  Test порядка краснеет на мутанте, который удаляет `epic-status` в шаге `files`.
- **Гонки с живой Session.** `CLAUDE.md` и записи hooks `settings.json` перед записью сверяются с тем, что
  прочитал план: файл изменился — шаг падает, перенос откатывается, правка остаётся на месте. Файлы,
  которые перенос переписывает на месте (`settings.json`, `CLAUDE.md`, `.claude.json`), — если это
  symlink, перенос отказывает с причиной: замена через `rename` превратила бы ссылку в файл. Остаётся
  окно в миллисекунды между чтением и записью `settings.json` и `.claude.json`. Запись Claude Code в это
  окно пропадёт из файла, но её копия не сохранится.
- **Границы записи.** Без `offered`, без включённого plugin-а нужной версии (`installed` и `enabled`; при
  `outdated` — отказ «update it first») и без «Move» в диалоге ничего не пишется. Claude home и Harness home не
  могут быть корнем диска или домашней папкой. Устаревший выбор (строки формы не совпадают со свежим планом)
  — отказ «open it again». Коммит в `~/.claude` берёт только тронутые пути, которые git знает (`git commit
  -- <пути>`), без hooks git и без подписи; если у машины нет `user.email`, ставится `worfy <worfy@localhost>`.
- **Session-ы, которые уже идут** (п. 9): форма и диалог предупреждают, что их нужно перезапустить; найти их
  форма не пытается (**решено исполнителем**).
- **Расхождение с ADR-0049:44.** Там сказано «`bin/epic-status` в первую очередь». Перенос удаляет его
  последним, как требует долг в HANDOFF: иначе Session, запущенная в промежутке, получит plugin inline при
  живых старых hooks.
- **Красный test первым.** На main модуля `src/main/harness/migrate/` нет: с убранным каталогом
  `test/contract/harness-migrate.test.ts` падает на импорте `…/migrate/apply` («Test Files 1 failed, Tests no
  tests»).
- **Test-ы.** `test/contract/harness-migrate.test.ts` — 54 случая: план, перенос «всё уберу», Profile-ы
  через `harness/bin/profile` и `gate.sh` с `HARNESS_HOME` песочницы, git, «Keep» у строки каждого вида,
  statusLine, qmd, порядок `epic-status`, предложение в toolbar, `node restore.mjs` отдельным процессом (с
  подменённым `claude` и без `claude` в PATH), сбой до и после каждого из 8 шагов, отказы; круг доработки
  добавил папку-symlink наружу, `../` в манифесте `restore.mjs`, `after/` после правок, одинаковые отпечатки
  в `apply.ts` и `restore.mjs`, файл живой Session во время переноса, гонки `CLAUDE.md` и `settings.json`,
  symlink-и трёх файлов и IPC dev-сборки (offer ничего не читает, apply отказывает до plugin-а и диалога).
  Каждый из 15 мутантов этих правок краснеет. Узкий круг добавил двойной `restore.mjs`, ручной
  `restore.mjs` после автоотката и запуск после оборванного отката (`after-2/`); мутанты маркера
  `restoredAt` и отдельной папки на запуск краснеют. Fixture —
  `test/fixtures/claude-home-legacy/` (`home/.claude` и `repos/`, `__SANDBOX__` подставляется при копировании,
  `.gitignore` лежит как `gitignore`, чтобы не скрыть fixture от git репозитория).
  `test/unit/harness-migration-form.test.tsx` — группы, переключатели, diff `CLAUDE.md` и Profile-а, поля
  Profile-а, отказ без plugin-а, итог переноса. `test/e2e/harness-migrate.spec.ts` — форма из toolbar, Move,
  копия и команда отката.
- Снимки (обе темы): toolbar — [светлая](../evidence/14-toolbar-light.png), [тёмная](../evidence/14-toolbar-dark.png);
  форма — [светлая](../evidence/14-form-light.png), [тёмная](../evidence/14-form-dark.png); diff `CLAUDE.md` —
  [светлая](../evidence/14-form-claude-md-light.png), [тёмная](../evidence/14-form-claude-md-dark.png); diff
  Profile-а — [светлая](../evidence/14-form-profiles-light.png), [тёмная](../evidence/14-form-profiles-dark.png);
  после Move — [светлая](../evidence/14-done-light.png), [тёмная](../evidence/14-done-dark.png).

**Влито.** [PR #136](https://github.com/IDSAD-XL/worfy/pull/136) → squash-коммит `95dbc82` в `main`. Ревью —
три круга:
- REJECTED, первый круг, два ревьюера: 4 [med] — непокрытые test-ами проверки границ путей (`under()`,
  `within()`), `restore.mjs` удалял созданное переносом без копии, раздел `CLAUDE.md` захватывал текст под
  `#` и `####`, `mode` из формы не проверялся; и [low] — пометки «Workflow» и «Standing authorization»,
  пути `~/.claude/agents/…` в `rules.md`, удаление `gate/state` целиком, symlink-и трёх файлов, IPC dev-сборки
  без test-а.
- REJECTED, второй круг: все семь пунктов исправлены, но доработка внесла дефект — повторный запуск
  `restore.mjs` затирал отложенное в `<копия>/after/` (первый запуск сохранил правку, второй заменил её
  копией). Скептик подтвердил: маркера законченного отката не было.
- Узкий круг только по этому дефекту: маркер `restoredAt` в манифесте, отдельная папка на каждый
  незаконченный запуск (`after/`, `after-2/`, …). NARROW: VERIFIED на `2f3ffdc`.

Перед мержем: rebase на `2da3968`, `GATE_SCOPE=all gate.sh full` — код 0, CI зелёный. Первый `gate full`
мержа упал на нестабильном `test/e2e/epic-frame.spec.ts:721`.

**Долг.** Из комментариев REJECTED второго круга и NARROW: VERIFIED в PR #136:
- [low] Нет test-а, где `restore.mjs` по-настоящему падает посередине и маркер `restoredAt` не записан:
  test убирает маркер руками, поэтому перенос записи маркера в начало отката test не поймает.
- [low] `src/main/harness/migrate/profiles.ts:50` — `\b` у `agents/`: путь к личному агенту
  `scout-extra.md` переписался бы на агента plugin-а.
- [low] Окно в миллисекунды между чтением и записью `settings.json` и `.claude.json`: правка Claude Code в
  это окно теряется, копии нет (абзац «Гонки с живой Session»).
- [low] `ADR-0049:44` говорит «`bin/epic-status` в первую очередь», перенос удаляет его последним. Нужен
  новый ADR-уточнение (ADR неизменяем).
