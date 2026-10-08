# 22 — Silent mode в Harness: файлы workflow в Workflow folder, без следов в ветках, коммитах и PR

Type: task
Status: claimed — 2026-10-08
Branch: worfy-harness/22
Blocked by: 16
Source: решения владельца 2026-10-07, Q11' (б), Q17, Q23–Q30; [ADR-0042](../../../docs/adr/0042-profile-on-machine-full-and-silent-modes.md) (Profile на машине, Full mode и Silent mode, Workflow folder, worktree вне репозитория, `attribution`; заменяет ADR-0020); [ADR-0045](../../../docs/adr/0045-one-ticket-one-repository.md) (один Ticket — один репозиторий, Project над несколькими репозиториями — всегда Silent mode, финиш без прав — локальный); [ADR-0040](../../../docs/adr/0040-harness-delivery-local-marketplace.md) (состояние Harness на машине — `~/.claude/worfy-harness/`); [spec.md](../spec.md)

## Что происходит

Пути Harness ниже — нынешние, в `~/.claude`. После Ticket-а 02 (импорт Harness в `harness/`) те же
файлы лежат в `harness/` по тем же относительным путям; после Ticket-а 16 (шаг владельца: переход
машины на plugin) работают именно они. Ticket-ы 05–08 (перевод Harness на английский, пути через
`${CLAUDE_PLUGIN_ROOT}`) и 11 (Profile schema 2) сдвинут строки — искать по смыслу.

- Harness знает один режим — нынешний Full mode: Ticket-ы, spec Epic-а, HANDOFF, ADR и уроки лежат
  в репозитории Project-а и едут в ветках.
  - Ветка Ticket-а — шаблон `tickets.branch` с номером (`<эпик>/<NN>`): бриф implementer-у
    (`~/.claude/skills/epic-wave/SKILL.md:141-145`), `ship-ticket` (`~/.claude/skills/ship-ticket/SKILL.md:93-104`).
  - `ticket claim` выполняется в дереве исполнителя, статус живёт в его ветке; Wave возобновляется
    по веткам `<эпик>/*` и по пустым коммитам `gate: VERIFIED` / `gate: REJECTED`
    (`~/.claude/skills/epic-wave/SKILL.md:222-226`, `:366-392`).
  - Конец Wave — документный PR или коммит со статусами и HANDOFF в основную ветку
    (`~/.claude/skills/epic-wave/SKILL.md:324-336`); рассказ о сделанном — в описании PR
    (`~/.claude/skills/ship-ticket/SKILL.md:286-292`).
  - Номера ADR `preflight` считает по `git ls-tree` основной ветки и веток `origin/*`
    (`~/.claude/bin/preflight:315-332`).
- Файлы workflow вне репозитория уже умеет часть скриптов — так устроен Profile Atakama
  (`~/.claude/profiles/atakama/profile.json`): абсолютные `tickets.root`, `tickets.path`,
  `tickets.spec`, `docs.handoff.path`. `bin/ticket` пишет статус прямо в абсолютный корень
  (`~/.claude/bin/ticket:94-118`); `epic-status --json --ref` при корне вне git отвечает кодом 3
  (`~/.claude/profiles/README.md`, правила поля `tickets.root`). Skills об этом не знают и всё
  равно предписывают ветки `<эпик>/<NN>`, коммиты `gate:` и документный PR.
- Поля `mode` и `attribution` заводит Ticket 11 (Profile schema 2 целиком на машине); Harness по
  ним ещё ничего не делает. Поля для пути Workflow folder в Profile нет. `_resolved` у `bin/profile`
  отдаёт `repo_root`, `checkout`, `workspace` (`~/.claude/bin/profile:212-220`), но не Workflow
  folder и не список репозиториев Project-а.
- Строки атрибуции Claude (`Co-Authored-By: Claude …`, `Generated with [Claude Code]`) добавляет
  сам Claude Code. В Harness о них нет ни слова: поиск `Co-Authored` по `CLAUDE.md`, `agents/`,
  7 skills Harness, `bin/` и `hooks/` пуст.
- worktree у worfy и Auction лежат в `.claude/worktrees/` внутри репозитория, и skills требуют
  этого прямо: «Агенту `EnterWorktree` принимает только деревья под `.claude/worktrees/` того же
  репозитория» (`~/.claude/skills/ship-ticket/SKILL.md:97-100`; то же —
  `~/.claude/agents/implementer.md:30-36`). Описание инструмента `EnterWorktree` в Claude Code
  говорит то же: агент с закреплённым при запуске cwd входит только в дерево под
  `.claude/worktrees/` своего репозитория. Решение Q17 кладёт worktree новых Project-ов вне
  репозитория — `~/.claude/worfy-harness/worktrees/<project>/`. Сможет ли implementer-Subagent
  править файлы в таком дереве — не проверено; spike Ticket-а 01 этого не проверяет.
- Проверки «нет следов workflow в ветке, коммите, PR» нет. `hooks/guard.mjs` (PreToolUse Bash)
  запрещает только разрушительные git-команды и трубы, теряющие код выхода
  (`~/.claude/hooks/guard.mjs:72-140`).

## Что делаем

Режим — поле `mode` Profile (Ticket 11). `full` — всё как сейчас: этот Ticket не меняет поведения
Full mode, кроме пунктов 6 и 9 — они действуют в любом режиме. `silent` — пункты ниже. Project над несколькими репозиториями — всегда
Silent mode (Q29).

1. **Workflow folder в Profile (Q23, Q24).**
   - Поле `workflow.folder` — абсолютный путь Workflow folder в Silent mode; в Full mode — `null`,
     Workflow folder — корень репозитория. Если Ticket 11 уже завёл поле для этого пути под другим
     именем — взять его и сказать в «Итог». Значение пишет подключение Project-а (Ticket 24). По
     умолчанию — `<HARNESS_HOME>/projects/<project>/workflow/` (`HARNESS_HOME` — Ticket 08, по
     умолчанию `~/.claude/worfy-harness/`); у Project-а над несколькими репозиториями — папка над
     ними, как у Atakama.
   - Структура папок Workflow folder — та же, что у Full mode в репозитории: `.scratch/<эпик>/…`,
     `HANDOFF.md`, `docs/adr/`, `docs/lessons/`, `CONTEXT.md`. Её же читает worfy (Ticket 23).
   - `bin/profile` отдаёт в `_resolved`: `mode`; `workflow_folder` — абсолютный путь в обоих
     режимах; `repos` — репозитории Project-а `[{name, path, gate_key}]` по записям реестра Gate с
     этим Profile (тот же реестр, по которому `bin/profile` уже вычисляет `workspace`).
   - В Silent mode относительные пути полей файлов workflow (`tickets.root`, `tickets.path`,
     `tickets.spec`, `docs.handoff.path`, `docs.adr_dir`, `docs.context.path`,
     `lessons: "repo:<путь>"`) считаются от Workflow folder, а не от корня рабочего дерева.
     `bin/ticket`, `bin/epic-status` и `bin/epic-board` берут корень Ticket-ов по этому правилу. В
     Full mode правило прежнее.
   - Контракт — `profiles/README.md`: поле, `_resolved`, правило путей, структура папок Workflow folder.
2. **Статус сразу в Workflow folder (Q27).**
   - В Silent mode `ticket claim|block|done` из любого дерева пишет в файл Ticket-а в Workflow
     folder. Статус один, в ветках его нет.
   - `epic-status --json --ref` в Silent mode — код 3 с причиной «in Silent mode the status does
     not live in branches», как сейчас для корня вне git.
   - Новые строки шапки Ticket-а. `Branch: <ветка>` — пишет `ticket claim <эпик> <NN> --branch <ветка>`.
     `Repo: <имя>` — репозиторий Ticket-а у Project-а над несколькими репозиториями (Q29: один
     Ticket — один репозиторий); имя — из `_resolved.repos`.
   - `epic-status --json` отдаёт у Ticket-а поля `branch` и `repo` (`null`, если строки нет). Это
     контракт с worfy: Ticket 23 их читает. Нынешний worfy лишние поля отбрасывает (схема
     `src/shared/workflow/types.ts:31-35`, «Unknown keys are dropped»).
3. **Документы Harness — только в Workflow folder (Q26).**
   - В Silent mode skills `epic-wave`, `ship-ticket`, `retro`, `continuous-audit` и agent
     `implementer` пишут Ticket-ы, spec, HANDOFF, ADR, глоссарий, уроки и снимки-доказательства
     только в Workflow folder.
   - Документы в репозитории — только чтение. Исключение — Ticket, чья прямая цель — документ для
     команды (например, README функции); так и сказано в его «Что делаем».
   - Номера ADR в Silent mode `bin/preflight` считает по файлам каталога ADR в Workflow folder, а не
     по `git ls-tree` веток.
4. **Ветки, коммиты, PR — как обычная работа (Q25).** В Silent mode:
   - ветка — по смыслу изменения (`fix/lot-withdraw-button`), без номера Ticket-а, имени Epic-а,
     номера ADR; её имя идёт в `ticket claim --branch`;
   - сообщения коммитов, заголовок и описание PR, комментарии в PR и в коде описывают само
     изменение: без номеров Ticket-ов и ADR, имён Epic-ов, путей Workflow folder;
   - нет документного PR и документного коммита в репозиторий: статусы и HANDOFF уже в Workflow
     folder. Если Workflow folder — git-репозиторий (так по умолчанию, Q24), то, что в Full mode шло
     документным коммитом, — локальный коммит в Workflow folder, без push;
   - вердикт ревью при `workflow.finish: local-green` — не пустой коммит `gate: …` в ветке, а запись
     в «Итог» Ticket-а в Workflow folder;
   - Wave возобновляется по строкам `Branch:` Ticket-ов, а не по шаблону `<эпик>/*`;
   - финиш — как велит `workflow.finish` (Q30: PR в `origin` или локальный финиш, пункт 9).
5. **Проверка следов — новый `bin/silent-check`.**
   - Вход — текст (сообщение коммита, имя ветки, заголовок и описание PR, комментарий) или
     `--diff <ref>` (добавленные строки диффа).
   - Ищет: имена Epic-ов Project-а (каталоги корня Ticket-ов), `<эпик>/<NN>`, `ADR-<4 цифры>`,
     `Ticket <число>` и `Ticket-<число>`, путь Workflow folder, `.scratch/`, `HANDOFF`.
   - Нашёл — код 1 и найденные места; чисто — код 0; Project не Silent — код 0 без проверки.
   - `hooks/guard.mjs` в Silent Project-е зовёт его и отказывает (`permissionDecision: deny`) с
     найденным на: `git commit` (текст `-m`, файл `-F`, добавленные строки индекса);
     `git checkout -b`, `git switch -c`, `git branch <имя>`, `git worktree add -b` (имя ветки);
     `gh pr create|edit|comment|review` (`--title`, `--body`, `--body-file`). В Full mode guard
     ведёт себя как сейчас.
6. **`attribution` (Q25), в любом режиме.** `off` — в коммитах и PR Project-а нет строк атрибуции
   Claude (`Co-Authored-By: Claude`, `Generated with [Claude Code]`). Правило подмешивается в
   контекст Session-ов Project-а тем же hook-ом, что подмешивает правила Project-а
   (`hooks/session-start.sh`); guard отказывает командам из пункта 5 с такими строками. `on` (по
   умолчанию) — как сейчас.
7. **worktree вне репозитория у новых Project-ов (Q17).**
   - `worktree.root` по умолчанию для новых Project-ов — `<HARNESS_HOME>/worktrees/<project>/`,
     дерево Ticket-а — `<worktree.root><NN>`. Записывает значение подключение Project-а (Ticket 24);
     этот Ticket описывает его в контракте. worfy и Auction остаются на `.claude/worktrees/`.
   - Сначала — проверка в живой Session (временный репозиторий; `claude -p`): может ли
     implementer-Subagent править файлы в дереве вне репозитория. Варианты: (а) `EnterWorktree` с
     `path` такого дерева; (б) Subagent, которого Orchestrator запускает с cwd этого дерева;
     (в) hook `WorktreeCreate` plugin-а `worfy`. Что пробовали и что ответил Claude Code — в «Итог».
   - Сработал хоть один вариант — skills и implementer описывают его вместо «только
     `.claude/worktrees/`» для Project-ов с `worktree.root` вне репозитория.
   - Не сработал ни один — этот пункт не делается: `ticket block` с причиной «Q17: Subagent cannot
     edit a worktree outside the repository» и вопрос владельцу в HANDOFF, раздел «Ждёт
     владельца». Остальные пункты закрываются без него, Ticket — в `blocked` до ответа.
   - `bin/profile`, `hooks/gate.sh` и `bin/worktree-lock` находят репозиторий по
     `git rev-parse --git-common-dir` и должны узнавать дерево вне репозитория; test это подтверждает.
8. **Язык.** Тексты skills и agents уже английские (Ticket-ы 06–08, Q6); новые строки — тоже.
   Машинные строки (`Branch:`, `Repo:`, причины кодов) — английские константы.
9. **Локальный финиш вливает ветку (Q30, ADR-0045, пункт 4) — в любом режиме.**
   - При `workflow.finish: local-green` Ticket закрывается, когда локальный `gate full` зелёный и
     ветка Ticket-а влита локально в основную ветку его репозитория. Сегодня `local-green` ветку не
     вливает (контракт: «ship-ticket и epic-wave не открывают PR и не мержат»); вливание — новое.
   - Меняются описание `local-green` в контракте Profile (`profiles/README.md`) и шаги финиша в
     skills `ship-ticket` и `epic-wave`. `ticket done` — без `--pr`, как сейчас.
   - Как вливать и что делать при конфликте, исполнитель пишет в контракт и в «Итог».

ADR не нужен: решения приняты в ADR-0042 и ADR-0045. Если пункт 7 упрётся в Claude Code — новый ADR
не заводить, решает владелец.

**Не входит:** чтение Silent Project-а и Project-а над несколькими репозиториями в worfy (Ticket 23);
форма подключения, выбор Workflow folder и запись Profile на машину (Ticket 24); коллекции qmd по
Workflow folder (Ticket 17); `GH_TOKEN` аккаунта Project-а (Ticket 18); смена режима на ходу (Q28: в
E3 её нет).

## Готово, когда

- [ ] `bin/profile` на Silent Profile во временном `HARNESS_HOME`: `--field _resolved.workflow_folder` печатает Workflow folder, `--field _resolved.mode` — `silent`, `--field _resolved.repos` у Project-а над двумя репозиториями — оба; относительный `tickets.root` разрешается от Workflow folder. На Full Profile — прежние ответы. `bash harness/bin/tests/profile.test.sh` — код 0.
- [ ] `ticket claim <эпик> <NN> --branch fix/x` в worktree тестового Silent репозитория пишет `Status: claimed — …` и `Branch: fix/x` в файл Ticket-а в Workflow folder; `git status --porcelain` репозитория пуст. `epic-status --json` отдаёт `branch` и `repo`; `epic-status --json --ref <ветка>` в Silent — код 3. `bash harness/bin/tests/silent-mode.test.sh` (новый) — код 0.
- [ ] `bin/silent-check` находит каждый вид следа из пункта 5 (имя Epic-а, `<эпик>/<NN>`, `ADR-0042`, `Ticket 05`, путь Workflow folder, `.scratch/`, `HANDOFF`) — код 1; чистый текст и чистый дифф — код 0; Full Project — код 0. Тот же test.
- [ ] Дерево `<HARNESS_HOME>/worktrees/<project>/05` вне репозитория: `bin/profile -C <дерево>` — код 0 и тот же Profile; `hooks/gate.sh fast` в нём находит запись реестра; `bin/worktree-lock claim` пишет замок в `HARNESS_HOME`. Тот же test.
- [ ] `hooks/guard.mjs` в Silent Project-е отказывает `git commit -m "… Ticket 05"`, `git switch -c <эпик>/05`, `gh pr create --body "… ADR-0042"` и пропускает коммит без следов; при `attribution: off` отказывает коммиту с `Co-Authored-By: Claude`; в Full Project-е с `attribution: on` все эти команды проходят, как сейчас. `bash harness/hooks/tests/guard-silent.test.sh` (новый) — код 0.
- [ ] `hooks/session-start.sh` в Silent Project-е с `attribution: off` подмешивает строки о режиме и атрибуции; в Full Project-е вывод прежний. `bash harness/hooks/tests/session-hooks.test.sh` — код 0.
- [ ] `bin/preflight` в Silent Project-е считает номера ADR по каталогу ADR в Workflow folder: дубль номера там — `BLOCKED`, код 1. `bash harness/bin/tests/preflight.test.sh` — код 0.
- [ ] Блоки bash из skills для Silent mode (возобновление Wave по `Branch:`, ветка по смыслу, локальный коммит в Workflow folder) вырезаются из SKILL.md и проходят на заглушке Profile под bash и zsh, как в `harness/bin/tests/skill-blocks.test.sh`. Код 0.
- [ ] Все test-ы пишут только во временные папки (`HARNESS_HOME`, `HOME`, `CLAUDE_CONFIG_DIR`): настоящие `~/.claude` и `~/.claude/worfy-harness/` до и после прогона одинаковы (список файлов и mtime сверяет сам test-набор).
- [ ] Пункт 7: в «Итог» — какие варианты (а), (б), (в) проверены, команды и ответ Claude Code. Сработал вариант — skills и implementer его описывают, а `silent-mode.test.sh` проверяет шаблон `worktree.implementer` с корнем вне репозитория. Не сработал ни один — Ticket в `blocked` с причиной из пункта 7.
- [ ] Локальный финиш (пункт 9): блок bash финиша `local-green` вырезается из skill, где лежит вливание (`ship-ticket` или `epic-wave`), и прогоняется во временном репозитории, как в `skill-blocks.test.sh`; после него ветка Ticket-а влита в `main` этого репозитория (`git merge-base --is-ancestor <ветка> main` — код 0), строка `Status: done` — без `--pr`. Описание `local-green` в `profiles/README.md` говорит о локальном вливании. `bash harness/bin/tests/silent-mode.test.sh` — код 0.
- [ ] Ревьюер с линзой «смысл сохранён» (Q34) сравнивает тексты skills и agents до и после: поведение Full mode не изменилось, кроме пунктов 6 и 9. Вердикт — в «Итог».
- [ ] Test-ы Harness — код 0 той командой, которой их гоняет CI worfy (Ticket 02); `pnpm lint`, `pnpm typecheck`, `pnpm test` — код 0; локальный `gate full` под замком `/tmp/worfy-e2e.lock` (правила Profile worfy; `harness/` едет в `.app`) — код 0 и вердикт «зелено».

## Тесты

Сначала падающий test — `harness/bin/tests/silent-mode.test.sh`, случай «`ticket claim --branch`
пишет `Branch:` в Workflow folder». На нынешнем main у `ticket` нет флага `--branch` — test падает
на «неизвестный флаг». В «Итог» — как он падал.

- `harness/bin/tests/silent-mode.test.sh` — новый: Silent Project во временных `HARNESS_HOME`,
  Workflow folder и git-репозитории с локальным bare-remote; `ticket`, `epic-status`,
  `silent-check`, дерево вне репозитория, локальное вливание при `local-green`.
- `harness/bin/tests/profile.test.sh` — `_resolved.mode`, `workflow_folder`, `repos`, правило путей.
- `harness/bin/tests/tickets-root.test.sh` — корень Ticket-ов от Workflow folder.
- `harness/bin/tests/preflight.test.sh` — номера ADR в Workflow folder.
- `harness/bin/tests/skill-blocks.test.sh` — блоки Silent mode из `epic-wave` и `ship-ticket`.
- `harness/hooks/tests/guard-silent.test.sh` — новый: отказы guard в Silent mode и при
  `attribution: off`, пропуск в Full mode.
- `harness/hooks/tests/session-hooks.test.sh` — строки о режиме и атрибуции.

Приёмка целой Wave в Silent Project-е (после Wave в репозитории нет файлов workflow, в ветках,
коммитах и PR нет номеров) — Ticket 26 (приёмка E3), пункт 2.

## Где в коде

- `harness/profiles/README.md` — из ~/.claude/profiles/README.md (контракт Profile; если Ticket 11 перенёс его в другое место — править там)
- `harness/bin/profile` — из ~/.claude/bin/profile
- `harness/bin/ticket` — из ~/.claude/bin/ticket
- `harness/bin/epic-status` — из ~/.claude/bin/epic-status
- `harness/bin/epic-board` — из ~/.claude/bin/epic-board
- `harness/bin/preflight` — из ~/.claude/bin/preflight
- `harness/bin/silent-check` — новый
- `harness/hooks/guard.mjs` — из ~/.claude/hooks/guard.mjs
- `harness/hooks/session-start.sh` — из ~/.claude/hooks/session-start.sh
- `harness/skills/epic-wave/SKILL.md` — из ~/.claude/skills/epic-wave/SKILL.md
- `harness/skills/ship-ticket/SKILL.md` — из ~/.claude/skills/ship-ticket/SKILL.md
- `harness/skills/retro/SKILL.md` — из ~/.claude/skills/retro/SKILL.md
- `harness/skills/continuous-audit/SKILL.md` — из ~/.claude/skills/continuous-audit/SKILL.md
- `harness/agents/implementer.md` — из ~/.claude/agents/implementer.md
- `harness/bin/tests/silent-mode.test.sh` — новый
- `harness/bin/tests/profile.test.sh` — из ~/.claude/bin/tests/profile.test.sh
- `harness/bin/tests/tickets-root.test.sh` — из ~/.claude/bin/tests/tickets-root.test.sh
- `harness/bin/tests/preflight.test.sh` — из ~/.claude/bin/tests/preflight.test.sh
- `harness/bin/tests/skill-blocks.test.sh` — из ~/.claude/bin/tests/skill-blocks.test.sh
- `harness/hooks/tests/guard-silent.test.sh` — новый
- `harness/hooks/tests/session-hooks.test.sh` — из ~/.claude/hooks/tests/session-hooks.test.sh
- `harness/bin/tests/real-home.sh` — новый (добавлен исполнителем): общий снимок настоящих `~/.claude` и
  `~/.claude/worfy-harness` для test-ов этого следа (пункт «Все test-ы пишут только во временные папки»)
- `harness/bin/tests/harness-home.test.sh` — добавлен исполнителем: сравнивает JSON `epic-status --json`
  побайтно, а у Ticket-а появились поля `branch` и `repo`

Если hook `WorktreeCreate` (пункт 7, вариант в) понадобится, исполнитель добавляет его файл и
`harness/hooks/hooks.json` (файл Ticket-а 05) сюда. Настоящий `~/.claude` этот Ticket не меняет:
после Ticket-а 16 Harness живёт в plugin, а `~/.claude` заморожен (ADR-0047).

Общие файлы с Ticket-ами, которые тоже ждут только Ticket 16: 18 (`GH_TOKEN` через hook
`SessionStart`, skills без ручного `export`) — `epic-wave`, `ship-ticket`, `implementer.md`,
возможно `session-start.sh`; 20 (узкий круг ревью Autopilot) — `epic-wave`; 17 (qmd) —
`profiles/README.md` и `bin/tests/skill-blocks.test.sh`. В одну Wave с ними этот Ticket не
попадает: Wave не берёт Ticket-ы с общими файлами, порядок вычисляет `epic-wave`.

## Итог

Ветка `worfy-harness/22`. Сделаны пункты 1–6, 8 и 9. Пункт 7 не сделан: живую пробу нельзя провести
без записи в `~/.claude` (ниже). Статус `blocked` ставит Orchestrator в документном PR.

**Первый test.** `harness/bin/tests/silent-mode.test.sh`, случай «`ticket claim --branch` пишет
`Branch:` в Workflow folder», на базе 3625fef упал так: `ticket claim checkout-flow 05 --branch fix/x`
→ exit 1, `unknown flag: --branch` и usage.

**Что сделано.**
- Пункт 1. Поле `workflow.folder` (Ticket 11 другого поля под этот путь не завёл; `bin/qmd-collections`
  уже читал `workflow.folder`). `bin/profile` отдаёт в `_resolved`: `mode`, `workflow_folder` (в обоих
  режимах), `repos` `[{name, path, gate_key}]` по записям реестра Gate. Silent без `workflow.folder`:
  у Project-а над несколькими репозиториями — общая папка над ними, иначе
  `$HARNESS_HOME/projects/<name>/workflow`. Относительный `workflow.folder` — exit 1. В сводке без
  флагов у Silent Profile-а есть строка `mode: silent   workflow folder: …`, у Full сводка прежняя.
  Правило путей реализуют `bin/ticket` (корень Ticket-ов), `bin/epic-status`, `bin/epic-board` и
  `bin/preflight` (каталог ADR). Контракт — `harness/profiles/README.md`, разделы «Full mode and
  Silent mode» и «Local finish».
- Пункт 2. `ticket claim <эпик> <NN> --branch <ветка>` пишет строку `Branch:`, `--repo <имя>` — строку
  `Repo:` (имя сверяется с `_resolved.repos`). `epic-status --json` отдаёт `branch` и `repo`;
  `--ref` в Silent mode — exit 3 «in Silent mode the status does not live in branches».
  `epic-board` в Silent mode читает только Workflow folder.
- Пункт 3. `bin/preflight` в Silent mode считает номера ADR по файлам каталога ADR в Workflow folder,
  дубль — `BLOCKED`. Skills `epic-wave`, `ship-ticket`, `retro`, `continuous-audit` и agent
  `implementer` пишут документы только в Workflow folder.
- Пункт 4. Ветка по смыслу, проверка `silent-check` и `ticket claim --branch` — блок в `ship-ticket`,
  шаг 2. Нет документного PR и коммита: локальный коммит в Workflow folder без push (`epic-wave`,
  раздел 4, пункт 4). Вердикт при `local-green` в Silent mode — строка `gate: …` в конце файла
  Ticket-а. Wave возобновляется по строкам `Branch:` (`epic-wave`, «How to resume a wave»).
- Пункт 5. Новый `bin/silent-check`: текст аргументами, `--file <путь|->`, `--diff <rev>`, `--cached`,
  `--untracked`. `hooks/guard.mjs` (раздел 3) отказывает `git commit` (`-m`, `-F`, индекс, а после
  `git add` в той же команде — всё дерево и неотслеживаемые файлы), именам веток
  `checkout -b`/`switch -c`/`branch <имя>`/`worktree add -b` и текстам `gh pr
  create|edit|comment|review|merge`. Каталог команды определяется по `cd` и `git -C`.
- Пункт 6. `attribution: off` в любом режиме: строки атрибуции — след для `silent-check` и guard;
  `hooks/session-start.sh` подмешивает раздел «Workflow mode» (режим и атрибуция) независимо от
  `session.inject_rules`. Full mode с `attribution: on` — вывод прежний (test).
- Пункт 9. Локальный финиш: rebase ветки на основную ветку в её worktree → `gate full` на этой ветке →
  fast-forward основной ветки (`git merge --ff-only` в дереве, где она выписана, или `git branch -f`,
  если она нигде не выписана) → `git merge-base --is-ancestor` как доказательство; без push. Ветка не
  поверх основной — `NOT ON TOP`, не вливается. Конфликт rebase — `git rebase --abort`, исполнитель
  решает его в своём дереве, как у `DIRTY` PR. Блок — `ship-ticket`, шаг 11; `epic-wave`, раздел 4,
  «Local merge». При `single` следующая ветка Wave — от основной ветки после вливания (раньше —
  цепочка от предыдущей ветки).

**Пункт 7 — не сделан, проба не проведена.** Обе пробы — 2026-10-08, cwd в scratchpad.
1. `CLAUDE_CONFIG_DIR=/tmp/worfy-harness-w10/impl-22/probe/cfg claude -p "Reply with the single word
   PONG." --model haiku --max-budget-usd 0.2 --no-session-persistence` → exit 1, «Not logged in · Please
   run /login». Вход идёт через keychain и с временной папкой конфигурации не работает; `--bare`
   требует `ANTHROPIC_API_KEY`, его нет. В `~/.claude` ничего не появилось.
2. `claude -p "Reply with the single word PONG." --model haiku --max-budget-usd 0.2
   --no-session-persistence --setting-sources project` (настоящий конфиг, cwd
   `/tmp/worfy-harness-w10/impl-22/probe/t0`) → exit 0, ответ `PONG`. Список `ls ~/.claude/projects`
   изменился: появилась папка `~/.claude/projects/-private-tmp-worfy-harness-w10-impl-22-probe-t0/` с
   пустой подпапкой `memory/`; ещё Claude Code записал свой
   `~/.claude/backups/.claude.json.backup.1791436482932`. По правилу брифа пробы остановлены, ничего
   не удалено (папку Orchestrator вынес в HANDOFF «Мусор на машине»).

Причина блокировки: «Q17: Subagent cannot edit a worktree outside the repository (not probed: a live
probe writes into ~/.claude)». Варианты (а) `EnterWorktree` с `path`, (б) Subagent с cwd дерева,
(в) hook `WorktreeCreate` не проверены. В skills и `implementer` о дереве вне репозитория ничего не
написано; в контракте Profile-а `<HARNESS_HOME>/worktrees/<project>/` описан только как значение по
умолчанию, с пометкой «не проверено». Без Claude Code проверено: `bin/profile -C`, `hooks/gate.sh
fast` и `bin/worktree-lock claim` узнают дерево `<HARNESS_HOME>/worktrees/<project>/05` (test в
`silent-mode.test.sh`).

**Вопрос владельцу:** разрешить ли живые пробы с `--no-session-persistence`? После каждой остаётся
пустая папка `~/.claude/projects/<cwd>/memory`, а все пробы из одного cwd дают одну папку.

**Решено без владельца, подтвердить.**
- Имя поля — `workflow.folder`; относительный путь в нём — сломанный Profile (exit 1).
- В добавленных строках диффа голое имя Epic-а следом не считается: код называет свои области, а Epic
  часто назван по области (`deals`, `frontend` у Auction). `<эпик>/<NN>` и остальные следы в диффе
  считаются. В тексте коммита, ветки и PR голое имя Epic-а — след, поэтому Epic с именем-обычным словом
  даст ложные отказы guard-а; лечится именем Epic-а, а не правилом.
- Guard проверяет и `gh pr merge` (`--subject`, `--body`): их текст попадает в историю основной ветки.
- Если сама проверка упала (Profile не читается, таймаут 8 с), guard пропускает команду: он не должен
  ломать Session из-за чужой поломки.
- Коммиты в Workflow folder guard не проверяет: это не репозиторий Project-а (`gate_key` пуст или
  Project не найден).
- `ticket claim --branch` пишет `Branch:` и в Full mode; на поведение Full mode это не влияет.
- Локальное вливание — fast-forward после rebase, не merge-коммит: `gate full` проверяет ровно то
  дерево, которым станет основная ветка.

**Test-ы** (каждый — код 0, и под пустым HOME, как в CI): `harness/bin/tests/silent-mode.test.sh` (40),
`harness/hooks/tests/guard-silent.test.sh` (32), `profile.test.sh`, `tickets-root.test.sh`,
`preflight.test.sh` (теперь с временными HOME, HARNESS_HOME, CLAUDE_CONFIG_DIR),
`skill-blocks.test.sh` (блоки Silent mode под bash и zsh), `session-hooks.test.sh`. Каждый из них в
конце сверяет настоящие `~/.claude` (части Harness) и `~/.claude/worfy-harness` со снимком до
прогона (`harness/bin/tests/real-home.sh`: список файлов, размер и mtime; в папках, куда пишут живые
Session-ы, — поиск файлов, где упомянута временная папка test-а). Заодно исправлены две живые
проверки, падавшие на настоящем HOME после переноса Profile-ов в `~/.claude/worfy-harness/projects/`
(`profile.test.sh`: auction `--dir`; `skill-blocks.test.sh`: два случая atakama).

**Проверки.** `pnpm lint && pnpm typecheck && pnpm test` — код 0 (141 файл, 2685 test-ов). `GATE_SCOPE=all
gate.sh fast` — код 0, «[gate] зелено (fast)». `gate.sh full` под замком `/tmp/worfy-e2e.lock` на
коммите 1c055c7 — код 0, «[gate] зелено (full): … test:e2e … test:package». Первый прогон full до
коммита упал на `test/e2e/packaged.spec.ts:700` (`git diff --quiet -- harness`: правки ещё не были
закоммичены) — это не дефект.

**Не сделано здесь.** Ревьюер с линзой «смысл сохранён» (Q34) — за Orchestrator-ом.
