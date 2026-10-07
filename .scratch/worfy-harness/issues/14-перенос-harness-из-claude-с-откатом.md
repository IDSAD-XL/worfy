# 14 — Перенос: старые файлы Harness уходят из `~/.claude` по форме «уберу / оставлю», с резервной копией и откатом

Type: task
Status: open
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

- [ ] Contract test: план на fixture — ровно строки из «Что делаем», п. 2; ни одной личной (личные skills, `skills/synced/`, `telegram-mcp`, `auction-staging-db-mcp`, `agent-time-split`, личный MCP, `model`, `env`, `effortLevel`).
- [ ] Перенос «всё уберу»: Harness-файлы исчезли из `~/.claude` и побайтно лежат в `backup-<дата>/`; личные файлы побайтно прежние; в `settings.json` убраны только записи hooks из плана, остальные ключи равны прежним (deep equal).
- [ ] `statusLine`: скрипт есть в подменённом `resourcesPath` — команда указывает на него и сохраняет аргумент; скрипта нет или dev-сборка — у строки только «оставлю», `statusLine` прежний.
- [ ] Группа qmd: «уберу» — `bin/qmd-*`, запись hook и запись `qmd` в `.claude.json` убраны вместе, личный MCP на месте; «оставлю» — все пять на месте, `.claude.json` побайтно прежний. Plugin без сервера qmd в `.mcp.json` — у строки предупреждение про `qmd.fallback_grep`, plugin с ним — без предупреждения.
- [ ] `worfy-harness/` песочницы — git-репозиторий; Profile-ы и реестр Gate в его последнем коммите.
- [ ] `CLAUDE.md`: разделы с «уберу» исчезли, с «оставлю» — побайтно на месте.
- [ ] Profile-ы: в `worfy-harness/projects/<p>/` у трёх Project-ов `profile.json` schema 2 без полей с путями Harness и с `mode`, `language.docs`, `attribution` из формы; в `rules.md` и `profile.json` нет `~/.claude/bin/`, `~/.claude/hooks/`, `~/.claude/gate/`, `~/.claude/profiles/`; у atakama на месте `bin/`, `lessons/`, `state/`. `bin/profile` из `harness/` (Ticket 11) по fixture-репозиторию Project-а с `--field mode` — код 0 и значение формы.
- [ ] Gate: реестр и маркеры — в `worfy-harness/gate/`; `hooks/gate.sh` из `harness/` с `HARNESS_HOME` песочницы на fixture-репозитории не отвечает «проект не зарегистрирован».
- [ ] git песочницы: ровно один новый коммит, его файлы — пути переноса; незакоммиченная правка в другом файле осталась незакоммиченной.
- [ ] «оставлю» у строки каждого вида (файл, раздел `CLAUDE.md`, запись hook, `statusLine`, Profile) — этот файл или запись не тронуты.
- [ ] Откат: `node <копия>/restore.mjs` отдельным процессом — код 0; дерево `~/.claude` песочницы и `.claude.json` равны снимку до переноса (в истории git — revert); подменённый `claude` получил `plugin disable worfy…`.
- [ ] Сбой на каждом шаге (подменяется в test-е) — перенос откатился сам, дерево равно снимку до, ответ называет шаг.
- [ ] plugin не установлен или выключен — перенос отказывает с причиной и ничего не пишет.
- [ ] Снимок песочницы: вне `~/.claude`, `.claude.json` и `worfy-harness/` ничего не появилось; в fixture-репозиториях Project-ов — ничего (ADR-0005).
- [ ] e2e (локально в `gate full`): форма открывается из элемента Harness в toolbar, показывает строки по группам и diff `CLAUDE.md`, переключатели «уберу / оставлю» работают; после Move видны путь копии и команда отката. Временный `WORFY_CLAUDE_HOME` с fixture, подменённый `claude`, ответ диалога подменён в main, как в `test/e2e/card-api.spec.ts:135-143`.

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

Заполняется при закрытии.
