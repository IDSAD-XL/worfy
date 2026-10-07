# worfy-harness: Harness как часть worfy

Status: по решениям владельца 2026-10-07 (сводка решений Q1–Q35 подтверждена владельцем целиком)
Source: [roadmap.md](../../docs/roadmap.md), раздел E3; [CONTEXT.md](../../CONTEXT.md); ADR
[0018](../../docs/adr/0018-project-is-a-workflow-folder.md),
[0019](../../docs/adr/0019-harness-claude-code-plugin.md),
[0021](../../docs/adr/0021-mcp-servers-allowlist-in-profile.md) (в силе),
[0020](../../docs/adr/0020-profile-shared-and-personal-parts.md) (заменён ADR-0042), ADR 0040–0047 этого
Epic-а; HANDOFF 2026-10-07; Epic [worfy-week](../worfy-week/spec.md) — формат и соглашения.
Ticket-ы: Epic `worfy-harness`, 26 Ticket-ов, нумерация с `01`. Шапка — тот же диалект, что у
worfy-week (`Type:` / `Status:` / `Blocked by:` / `Source:`), чтобы её читали `epic-status`, `ticket`
и вычисление Wave в worfy (`src/shared/workflow/waves.ts`).

## Цель

worfy версии X ставит и обновляет Harness версии X. Project подключается к worfy без ручной правки
`~/.claude`: в Full mode, как worfy и Auction, или в Silent mode, когда в репозитории не должно
остаться следов workflow.

Epic готов, когда (Q35; песочница — отдельные `HOME` и `CLAUDE_CONFIG_DIR` во временной папке):

1. В песочнице без файлов в `~/.claude` worfy ставит Harness своей версии. Первый запуск показывает
   проверки. qmd ставится с согласия пользователя.
2. Silent Project (тестовый репозиторий) подключается, и Wave на нём проходит. После неё в
   репозитории нет файлов workflow, а в ветках, коммитах и PR нет номеров Ticket-ов.
3. На машине владельца в `~/.claude` осталось только личное. Одна Wave в Autopilot прошла на plugin
   без человека.
4. Auction остаётся в Full mode: его Profile перенесён, worfy показывает его Epic-и. Проверка только
   на чтение: писать в `/Users/alexey/Work/*` нельзя.
5. Ручной прогон под вторым пользователем macOS — шаг владельца.

Проверку всех пяти пунктов делает Ticket 26.

## Как устроено

- **Harness — plugin Claude Code с именем `worfy`** (ADR-0019,
  [ADR-0040](../../docs/adr/0040-harness-delivery-local-marketplace.md)). Исходник — папка `harness/`
  в репозитории worfy. Её заводит Ticket 02: импорт Harness-файлов из `~/.claude` с историей git.
  Общие правила `~/.claude/CLAUDE.md` Ticket 02 кладёт под другим именем (`harness/rules/global.md`):
  Claude Code подмешивает `CLAUDE.md` из подпапки репозитория Session-ам, которые читают её файлы.
- **Версия.** Ticket 04 ставит в `package.json` 0.2.0 (сейчас там 0.0.0). Сборка пишет
  `<semver>+<короткий SHA>` в `plugin.json` (манифест plugin-а) копии Harness внутри `.app`, и
  worfy показывает эту строку в UI. Semver поднимается в конце каждого Epic-а: после E3 — 0.3.0
  (Ticket 26).
- **Доставка** (Ticket 13). worfy копирует Harness своей версии из `.app` в
  `~/.claude/worfy-harness/plugin/`, регистрирует эту папку как локальный marketplace (каталог
  plugin-ов) и ставит plugin в область пользователя (`--scope user`) встроенным бинарём Claude Code
  из SDK. Plugin из локального marketplace грузится на месте. Строка версии изменилась — worfy
  ставит plugin заново. Session-ы самого worfy ещё и передают свой Harness в SDK напрямую
  (`plugins: [{type: 'local', path}]`, Ticket 12): так worfy всегда идёт на Harness своей версии,
  даже если у пользователя установлен другой.
- **Имена.** Skills и agents живут в namespace plugin-а: `/worfy:epic-wave`, `/worfy:ship-ticket`,
  Subagent `worfy:implementer`. worfy понимает и старые имена без префикса — они есть в старых
  транскриптах (Ticket 10).
- **Состояние машины** — папка `~/.claude/worfy-harness/`, одна на машину: реестр Gate, маркеры
  Gate, Profile-ы, замки worktree, резервные копии. Это локальный git-репозиторий. Он переживает
  переустановку plugin-а и worfy.
- **Правила Harness доходят через hooks plugin-а**
  ([ADR-0041](../../docs/adr/0041-harness-rules-via-session-hooks.md), Ticket 05). Hook
  `SessionStart` отдаёт главной Session правила Orchestrator-а и общие правила, hook `SubagentStart`
  отдаёт Subagent-у только общую часть. Текст идёт в `additionalContext` — поле ответа hook-а,
  которое Claude Code добавляет в контекст. В `~/.claude/CLAUDE.md` пользователя остаётся только
  личное.
- **Profile целиком на машине**
  ([ADR-0042](../../docs/adr/0042-profile-on-machine-full-and-silent-modes.md), Ticket 11):
  `~/.claude/worfy-harness/projects/<project>/`, формат schema 2. Новые поля — `mode`,
  `language.docs`, `attribution`; поле `mcp.allowed` входит в контракт. Поля с путями к скриптам
  Harness уходят: это константы Harness. Schema 1 читается на время перехода.
- **Full mode и Silent mode** (ADR-0042, Ticket-ы 22 и 23). В Full mode файлы workflow лежат в
  репозитории, Workflow folder — его корень. В Silent mode Workflow folder — папка вне репозитория,
  а ветки, коммиты и PR выглядят как обычная работа. Новый Project по умолчанию — Silent mode.
  worfy и Auction — Full mode, Atakama — Silent mode.
- **Один Ticket — один репозиторий**
  ([ADR-0045](../../docs/adr/0045-one-ticket-one-repository.md), Ticket 23). Project над
  несколькими репозиториями — всегда Silent mode. Gate, PR и CI идут по репозиторию Ticket-а.
- **qmd — часть Harness** ([ADR-0043](../../docs/adr/0043-qmd-is-part-of-harness.md), Ticket 17).
  worfy ставит qmd через npm, модели скачиваются с согласия. MCP-сервер qmd регистрирует сам plugin
  (`.mcp.json`), коллекции заводятся по Profile.
- **Язык** ([ADR-0044](../../docs/adr/0044-harness-in-english-language-from-profile.md)). Текст
  Harness — английский; переводят его Ticket-ы 05–08, каждый в своей группе файлов. Отчёты — на
  языке `language.reports`, документы Project — на языке `language.docs`. Машинные строки — вердикт
  Gate, строка `Status:`, формат команды Autopilot — английские константы или JSON. Вердикт Gate
  worfy читает из JSON-файла (Ticket 09); старые русские строки остаются запасным путём.
- **Переход машины владельца**
  ([ADR-0047](../../docs/adr/0047-harness-lessons-by-pr-early-owner-switch.md)). После мержа
  Ticket-а 02 Harness в `~/.claude` заморожен. Wave-ы до установщика и переноса проходит Autopilot
  на замороженном `~/.claude`. Ticket 16 — шаг владельца: перед ним Autopilot останавливается,
  переход делает владелец кнопкой в worfy с подтверждением списка «уберу / оставлю». Дальше все
  Wave-ы E3 идут на plugin. Откат — восстановление из резервной копии одной командой.
- **worfy и чужие файлы.** worfy не владеет состоянием workflow
  ([ADR-0002](../../docs/adr/0002-worfy-is-a-view-over-the-workflow.md)) и не пишет в репозитории
  Project-ов ([ADR-0005](../../docs/adr/0005-worfy-own-state-inventory.md)). Новое исключение —
  установщик и перенос пишут в `~/.claude` (ADR-0040, ADR-0047). Их test-ы идут в песочнице, а не на
  настоящем `~/.claude`.

## Этапы

1. **Без блокеров** — 01, 02, 03, 10.
   - 01: spike (короткий опыт ради ответа, не код продакшена) → ADR-0048. Доходят ли hooks до
     Subagent-ов workflow-скриптов, выдаётся ли `GH_TOKEN` через `CLAUDE_ENV_FILE`, как ставится
     plugin из локального marketplace, каким именем MCP-сервер plugin-а проходит список
     MCP-серверов Project-а.
   - 02: импорт Harness из `~/.claude` в `harness/` с историей git; манифест plugin-а `worfy` с
     зависимостью `mattpocock-skills`; test-ы скриптов Harness — в `pnpm test` и в CI.
   - 03: раздел Autopilot в `docs/design/F-SPEC.md` — кнопка и строка состояния прогона.
   - 10: worfy понимает префикс `worfy:` и новый формат команды Autopilot; старые имена тоже.
2. **Harness по группам файлов** — 04–09. Каждый Ticket делает в своей группе все правки: перевод,
   пути через `${CLAUDE_PLUGIN_ROOT}` (папка plugin-а, её подставляет Claude Code), префикс
   `worfy:`, машинные строки (Q32).
   - 04: версия `0.2.0+<SHA>` в сборке, копия Harness в `.app`, версия в UI.
   - 05: правила из `CLAUDE.md` — английские части для hooks `SessionStart` и `SubagentStart`;
     `harness/hooks/hooks.json`.
   - 06: skills `epic-wave` и `ship-ticket`.
   - 07: agents implementer, reviewer, scout.
   - 08: остальные пять skills, скрипты `bin/` и `hooks/`; состояние Harness — в
     `~/.claude/worfy-harness/`.
   - 09: Gate пишет вердикт JSON-файлом, worfy читает его.
3. **Plugin в worfy** — 11–15.
   - 11: Profile schema 2 целиком на машине.
   - 12: worfy находит Harness в папке plugin-а, передаёт свой Harness Session-ам, шлёт команды по
     установленному Harness.
   - 13: установщик — копия из `.app`, локальный marketplace, установка, обновление при смене версии.
   - 14: перенос — форма «уберу / оставлю», резервная копия, коммит в git `~/.claude`, откат одной
     командой; Profile-ы — в schema 2.
   - 15: мост Limits (скрипт `statusLine`, который передаёт Limits из терминала в worfy) лежит в
     `.app`, а не в dev-checkout.
4. **Шаг владельца** — 16: переход машины владельца на plugin. Orchestrator проверяет: в
   `~/.claude` только личное, Session видит plugin `worfy`, `epic-status` и Gate работают.
5. **На plugin** — 17–25.
   - 17: qmd ставится вместе с Harness, коллекции по Profile.
   - 18: `GH_TOKEN` аккаунта Project-а выдаёт hook `SessionStart`; skills без ручного `export`.
   - 19: экран первого запуска — проверки машины и действия с подтверждением.
   - 20: Autopilot делает один узкий круг ревью без владельца, если находки только med и low.
   - 21: пометка «Harness в main новее, чем в Stable copy» в worfy и в журнале прогона.
   - 22: Silent mode в Harness.
   - 23: worfy читает Workflow folder Silent Project-а; Project над несколькими репозиториями.
   - 24: подключение Project-а — папка, режим, черновик Profile, форма, запись на машину, Gate.
   - 25: аккаунт GitHub Project-а при подключении.
6. **Приёмка** — 26: пять пунктов «Готово, когда» из раздела «Цель».

## Решения владельца

Session проектирования E3, 2026-10-07. Номер вопроса — как в той Session (Q1–Q35). Ticket-ы ссылаются на
эти номера и на ADR.

- **Доставка, имя, версия** — ADR-0040 (Q1, Q2, Q4, Q12, Q20). Копия `harness/` своей версии из
  `.app` в `~/.claude/worfy-harness/plugin/` как локальный marketplace, plugin `worfy` в области
  пользователя; Session-ы worfy грузят свой Harness inline. Состояние машины —
  `~/.claude/worfy-harness/`, а не `${CLAUDE_PLUGIN_DATA}` (удаляется при uninstall) и не папка
  данных worfy (своя у dev-сборки и у Stable copy). Версия — `<semver>+<SHA>`. Минимальная версия
  Claude Code — встроенная в сборку; старше `claude --version` терминала — только предупреждение.
  Отвергнуты: marketplace на GitHub, загрузка прямо из `.app`, имена `harness` и `worfy-harness`.
- **Правила** — ADR-0041 (Q9). Hooks `SessionStart` и `SubagentStart`, части до 10 000 символов.
  Отвергнуты: строка `@<путь>` в `CLAUDE.md` пользователя (правка его файла) и `settings.agent`
  (подменяет системный prompt).
- **Profile и режимы** — ADR-0042, заменяет ADR-0020 (Q10, Q11, Q11', Q17, Q21, Q23–Q28). Profile
  целиком на машине, в репозитории Project-а его нет. Правила Project-а (`rules.md`) подмешивает
  только Harness. Full mode и Silent mode, Workflow folder; в Silent mode Workflow folder выбирает
  пользователь при подключении. В Silent mode ветки, коммиты, PR и комментарии в коде — без номеров
  Ticket-ов и ADR, имён Epic-ов и путей к Workflow folder; статус Ticket-а пишется сразу в Workflow
  folder; свои документы Harness пишет только туда. Поле `attribution: on | off`, по умолчанию `on`.
  Worktree новых Project-ов — `~/.claude/worfy-harness/worktrees/<project>/`; у worfy и Auction —
  прежние папки. `GH_TOKEN` аккаунта Project-а выдаёт hook `SessionStart` через `CLAUDE_ENV_FILE`;
  сам токен на диск не пишется.
- **qmd** — ADR-0043 (Q5, Q15, Q16). qmd — часть Harness: `npm install -g @tobilu/qmd`, обёртки
  `qmd-*` и `.mcp.json` в plugin-е, запись qmd в `~/.claude.json` убирается при переносе. Модели —
  на первом экране, с размером и согласием; без них поиск идёт grep-ом. Коллекции — по Profile:
  в Full mode из отдельной копии main, в Silent mode — из Workflow folder. Отвергнуты: plugin
  upstream `qmd@qmd` как зависимость, qmd внутри `.app`.
- **Язык** — ADR-0044 (Q6, Q34). Перевод Harness на английский — в E3, в тех же Ticket-ах, что
  переписывают файлы. Новое поле Profile `language.docs`. Проверка перевода — ревьюер с линзой
  «смысл сохранён» и первая Wave после перехода. Gate пишет вердикт JSON-файлом.
- **Репозитории** — ADR-0045 (Q29, Q30). Один Ticket — один репозиторий; функция через три
  репозитория — три Ticket-а со связями Blocked by. Есть права — PR в `origin`; нет прав или нет
  `origin` — локальный финиш. Отвергнуто: один Ticket — несколько PR.
- **Autopilot** — [ADR-0046](../../docs/adr/0046-autopilot-narrow-round-without-owner.md) (Q7). При
  заблокированном Ticket-е на критическом пути — один дополнительный узкий круг ревью без владельца,
  только при находках med и low и только по ним. Не помогло — блок и отчёт.
- **Развитие Harness и переход** — ADR-0047 (Q3, Q13, Q14, Q19, Q33). Урок — PR в `harness/`; после
  мержа Orchestrator запускает `pnpm install:stable`, урок действует со следующей Session. Во время
  прогона Autopilot Stable copy не пересобирается. Что переносится в plugin и что остаётся личным —
  список Q19. Резервная копия — `~/.claude/worfy-harness/backup-<дата>/`.
- **Первый запуск** (Q22, Ticket 19). Проверяет вход в Claude, `claude --version`, `git`, `gh` и
  аккаунты, node ≥22, `jq`, Harness и его версию, qmd и модели. С подтверждения ставит и обновляет
  plugin, ставит qmd, переносит файлы. node, git и gh не ставит — показывает `brew install …`;
  `gh auth login` запускает в Terminal, вход делает пользователь.
- **Приёмка** (Q8, Q35, Ticket 26). Автоматический test в песочнице; один `/login` в ней делает
  владелец. В конце Epic-а — ручной прогон под вторым пользователем macOS, которого создаёт владелец.
- **Epic** (Q31, Q32). Имя `worfy-harness`. Wave 2 режется по группам файлов: параллельные Ticket-ы
  не правят один файл.

## Не в этом Epic-е

- **eval-кейсы перевода Harness** (`claude plugin eval`) — E4 (Q6).
- **PR из форка**, когда нет прав на `origin`, — позже; в E3 без прав — локальный финиш (Q30).
- **Смена режима Project на ходу** (Full mode ↔ Silent mode) — нет в E3 (Q28).
- **Подпись Developer ID и нотаризация** — E4.
- **Личные skills, MCP-серверы и память пользователя.** Они не входят в Harness; worfy их не ставит и
  не переносит. Исключение — qmd (ADR-0043).
- **Долги из HANDOFF, раздел «Риски и долги»**, в 26 Ticket-ов не вошли.

## Риски и открытые технические вопросы

1. **Ответы spike-а** (Ticket 01, итог — ADR-0048). Четыре вопроса, на которых стоят другие
   Ticket-ы:
   - доходят ли hooks plugin-а до Subagent-ов workflow-скриптов — Autopilot ведёт Wave через
     workflow-скрипт, и правила Subagent-а придут через `SubagentStart` (Ticket-ы 05, 06);
   - работает ли `GH_TOKEN` через `CLAUDE_ENV_FILE` — файл окружения, который пишет hook
     `SessionStart`: исполняется ли он перед каждой командой Bash, видят ли токен Subagent-ы, нет ли
     токена в транскрипте (Ticket 18);
   - как ставится plugin из локального marketplace встроенным бинарём: коды выхода, повторный
     запуск, обновление при смене `version`, нужны ли сеть и вход (Ticket 13);
   - каким именем MCP-сервер plugin-а проходит `allowedMcpServers` — список MCP-серверов, который
     worfy передаёт Session-ам (Ticket-ы 11, 17).

   Ответ «нет» — ADR-0048 называет запасной путь и Ticket-ы, которые меняются. Для `GH_TOKEN`
   запасной путь уже решён (Q21): worfy кладёт `GH_TOKEN` в env своих Session-ов, в терминале
   остаётся ручной `export`. В `Blocked by` Ticket 01 стоит только у 18 и 26. Остальные получают
   ответ потому, что 01 — в Wave 1 плана; если 01 задержится, вычисленная Wave может взять их
   раньше.
2. **Предел 10 000 символов.** `additionalContext` hook-а ограничен 10 000 символами; длиннее
   Claude Code кладёт в файл и показывает превью на 2 000 символов. `~/.claude/CLAUDE.md` — 13 489
   байт. Ticket 05 делит правила на две части (Orchestrator и общая), сжимает их и проверяет test-ом
   размер в символах и то, что ни одна тема старого `CLAUDE.md` не потеряна. Не помещается — третья
   часть со своей записью `SessionStart`. Hooks одного события идут параллельно, порядок частей в
   контексте не задан, поэтому часть не ссылается на другую.
3. **Две копии Harness до Ticket-а 16.** После мержа Ticket-а 02 исходник — `harness/`, а живой
   Harness — замороженный `~/.claude`. Правки `harness/` до Ticket-а 16 на Session-ы не действуют,
   и Wave-ы E3 до него идут на старых файлах. Урок, найденный в эти Wave-ы, идёт PR-ом в `harness/`
   и проверяется только после перехода. На машине, где есть и старые файлы, и plugin, worfy
   выбирает старый Harness (Ticket 12): пока hooks старого Harness записаны в
   `~/.claude/settings.json`, plugin с теми же hooks запускал бы каждый из них второй раз. Старые
   записи убирает перенос (Ticket 14) на шаге владельца (Ticket 16).
4. **Перевод может изменить смысл правил.** Skills и agents сейчас русские (`epic-wave` — 37 КБ,
   `ship-ticket` — 26 КБ, `implementer` — 17 КБ). Проверка (Q34): ревьюер с линзой «смысл сохранён»
   сравнивает старый и новый текст каждого файла; итоговая проверка — первая Wave после перехода.
   Ошибку перевода покажет только Wave на plugin, то есть после Ticket-а 16. Машинные строки не
   переводятся, worfy читает и старые русские строки. Подписи блока статуса «— Этап: / — Сейчас: /
   — Дальше: / — Жду:» остаются как есть: их читает worfy (`src/shared/agent/status-block.ts:23`).
5. **Токен GitHub не должен утечь** (Ticket-ы 01, 18). Токен не попадает в журнал прогона,
   транскрипт и логи. Spike проверяет это на фальшивом токене; настоящий токен нигде не печатается.
6. **Запись в `~/.claude`** (Ticket-ы 13, 14, 17). Установщик, перенос и qmd проверяются в
   песочнице. Настоящий `~/.claude` меняет только шаг владельца — Ticket 16.
7. **План Wave-ов — прогноз.** Wave, которую берут в работу, вычисляется заново в момент запуска
   (CONTEXT.md, термин Wave).

## Соглашения для Ticket-ов этого Epic-а

Как в [worfy-week](../worfy-week/spec.md), раздел «Соглашения для Ticket-ов этого Epic-а»: сначала
падающий test, виды test-ов, только чтение чужих файлов, ручные пункты «(вручную)», снимки UI в двух
темах, Autopilot над worfy — только на Stable copy. Отличия:

- **Ветки** — `worfy-harness/<NN>`; worktree — `.claude/worktrees/<NN>`.
- **ADR.** Номер 0048 выдан Ticket-у 01 (итог spike-а). Следующий свободный номер — 0049. Номера
  Ticket-ам, которым нужен ADR, выдаёт Orchestrator в момент взятия, по одному решению на файл.
  Принятые ADR 0001–0047 не правятся: уточнение — новым ADR, который говорит, что он уточняет.
- **`~/.claude` заморожен после мержа Ticket-а 02.** Уроки идут только PR-ами в `harness/`, в
  `~/.claude` их не коммитят.
- **Правки `harness/` до Ticket-а 16 не действуют на живой Harness.** Wave-ы E3 до него идут на
  замороженном `~/.claude`.
- **Песочница.** Ticket-ы, которые пишут в `~/.claude` (установщик, перенос, qmd), проверяются с
  `HOME` и `CLAUDE_CONFIG_DIR` во временной папке. Вход в Claude в песочнице делает владелец.
- **Только чтение.** Писать в `/Users/alexey/Work/*` нельзя: Auction и Atakama — только чтение, без
  `git fetch`. Ticket, который читает репозиторий Project-а или `~/.claude`, проверяет test-ом, что
  не пишет туда.
- **GitHub.** Глобальный `gh` остаётся на рабочем аккаунте. Для репозитория worfy —
  `GH_TOKEN=$(gh auth token -u IDSAD-XL)` в команде; `gh auth switch` не вызывать.
- **CI** — только Linux: lint, typecheck, unit и contract test-ы. macOS-зависимые test-ы —
  `skipIf(process.platform !== 'darwin')`. e2e и `.app` проверяются локально перед мержем:
  `GATE_SCOPE=all gate.sh full` на ветке, под замком `/tmp/worfy-e2e.lock` (команда — `rules.md`
  Profile-а worfy).
- **Системные запросы macOS и вход в аккаунты** — за владельцем.

## Волны

Wave — Ticket-ы, которые можно брать параллельно: все блокеры закрыты, общих файлов в «Где в коде»
нет. Таблица — план. Wave, которую берут в работу, вычисляется заново в момент запуска (CONTEXT.md,
термин Wave). Заголовок раздела и шапка таблицы остаются русскими: это формат, который читает skill
`epic-wave`.

| Тикет | Файлы из «Где в коде» | Волна |
| --- | --- | --- |
| 01 | `scripts/spikes/harness-plugin/probe.ts`, `scripts/spikes/harness-plugin/fixture/`, `scripts/spikes/harness-plugin/marketplace/`, `docs/adr/0048-harness-plugin-spike-results.md`, `test/fixtures/sdk-messages/plugin-*.jsonl` | 1 |
| 02 | `harness/rules/global.md`, `harness/agents/implementer.md`, `harness/agents/reviewer.md`, `harness/agents/scout.md`, `harness/skills/epic-wave/SKILL.md`, `harness/skills/ship-ticket/SKILL.md`, `harness/skills/retro/SKILL.md`, `harness/skills/qmd/SKILL.md`, `harness/skills/overnight-fix-loop/SKILL.md`, `harness/skills/continuous-audit/SKILL.md`, `harness/skills/tickets-to-tasks/SKILL.md`, `harness/bin/profile`, `harness/bin/ticket`, `harness/bin/epic-status`, `harness/bin/preflight`, `harness/bin/worktree-lock`, `harness/bin/epic-board`, `harness/bin/qmd-mcp`, `harness/bin/qmd-refresh`, `harness/bin/qmd-sync-main`, `harness/bin/ТИКЕТЫ.md`, `harness/bin/tests/preflight.test.sh`, `harness/bin/tests/profile.test.sh`, `harness/bin/tests/qmd.test.sh`, `harness/bin/tests/skill-blocks.test.sh`, `harness/bin/tests/tickets-root.test.sh`, `harness/hooks/gate.sh`, `harness/hooks/gate-resolve.mjs`, `harness/hooks/guard.mjs`, `harness/hooks/session-start.sh`, `harness/hooks/session-end.sh`, `harness/hooks/stop.sh`, `harness/hooks/tests/gate-notverified.test.sh`, `harness/hooks/tests/gate-unregistered.test.sh`, `harness/hooks/tests/session-hooks.test.sh`, `harness/profiles/README.md`, `harness/.claude-plugin/plugin.json`, `harness/README.md`, `test/contract/harness-scripts.test.ts`, `test/contract/harness-plugin.test.ts`, `eslint.config.js`, `.github/workflows/ci.yml` | 1 |
| 03 | `docs/design/F-SPEC.md` | 1 |
| 04 | `package.json`, `scripts/build-version.ts`, `electron.vite.config.ts`, `electron-builder.yml`, `src/main/harness/bundled.ts`, `src/main/ipc/app.ts`, `src/shared/ipc/app.ts`, `test/unit/build-version.test.ts`, `test/contract/main-ipc-wiring.test.ts`, `test/e2e/toolbar.spec.ts`, `test/e2e/packaged.spec.ts` | 2 |
| 05 | `harness/rules/global.md`, `harness/hooks/rules/orchestrator.md`, `harness/hooks/rules/common.md`, `harness/hooks/inject-rules.sh`, `harness/hooks/hooks.json`, `harness/hooks/tests/rules-hooks.test.sh` | 2 |
| 06 | `harness/skills/epic-wave/SKILL.md`, `harness/skills/ship-ticket/SKILL.md`, `harness/bin/tests/epic-wave-ship-ticket.test.sh` | 2 |
| 07 | `harness/agents/implementer.md`, `harness/agents/reviewer.md`, `harness/agents/scout.md`, `harness/bin/tests/agents-text.test.sh` | 2 |
| 08 | `harness/skills/retro/SKILL.md`, `harness/skills/qmd/SKILL.md`, `harness/skills/overnight-fix-loop/SKILL.md`, `harness/skills/continuous-audit/SKILL.md`, `harness/skills/tickets-to-tasks/SKILL.md`, `harness/bin/profile`, `harness/bin/ticket`, `harness/bin/epic-status`, `harness/bin/preflight`, `harness/bin/worktree-lock`, `harness/bin/epic-board`, `harness/bin/qmd-mcp`, `harness/bin/qmd-refresh`, `harness/bin/qmd-sync-main`, `harness/bin/ТИКЕТЫ.md`, `harness/bin/TICKETS.md`, `harness/hooks/gate.sh`, `harness/hooks/gate-resolve.mjs`, `harness/hooks/guard.mjs`, `harness/hooks/stop.sh`, `harness/hooks/session-start.sh`, `harness/hooks/session-end.sh`, `harness/bin/tests/preflight.test.sh`, `harness/bin/tests/profile.test.sh`, `harness/bin/tests/qmd.test.sh`, `harness/bin/tests/skill-blocks.test.sh`, `harness/bin/tests/tickets-root.test.sh`, `harness/bin/tests/harness-home.test.sh`, `harness/hooks/tests/gate-notverified.test.sh`, `harness/hooks/tests/gate-unregistered.test.sh`, `harness/hooks/tests/session-hooks.test.sh` | 2 |
| 09 | `harness/hooks/gate.sh`, `harness/hooks/tests/gate-verdict.test.sh`, `src/main/gate/state.ts`, `src/shared/ipc/checks.ts`, `test/unit/gate-state.test.ts` | 3 |
| 10 | `src/shared/binding/signals.ts`, `src/shared/agent/subagent-type.ts`, `src/renderer/canvas/nodes/SubagentNode.tsx`, `src/renderer/session/rail/SubagentsRail.tsx`, `src/renderer/session/ExternalSessionPanel.tsx`, `src/renderer/session/Transcript.tsx`, `test/unit/binding.test.ts`, `test/unit/subagent-type.test.ts`, `test/unit/subagent-nodes.test.tsx`, `test/unit/subagents.test.ts`, `test/contract/github-prs.test.ts` | 1 |
| 11 | `harness/bin/profile`, `harness/bin/tests/profile.test.sh`, `harness/bin/preflight`, `harness/bin/tests/preflight.test.sh`, `harness/profiles/README.md`, `harness/skills/epic-wave/SKILL.md`, `harness/skills/ship-ticket/SKILL.md` | 3 |
| 12 | `src/main/harness/locate.ts`, `src/main/storage/paths.ts`, `src/main/workflow/reader.ts`, `src/main/workflow/profile.ts`, `src/main/gate/state.ts`, `src/main/agent/options.ts`, `src/main/agent/app-registry.ts`, `src/shared/projects/action-templates.ts`, `src/main/projects/settings.ts`, `src/shared/ipc/projects.ts`, `src/main/ipc/projects.ts`, `src/renderer/shell/ProjectSettings.tsx`, `test/unit/harness-locate.test.ts`, `test/unit/paths.test.ts`, `test/unit/gate-state.test.ts`, `test/unit/agent-options.test.ts`, `test/unit/action-templates.test.ts`, `test/contract/workflow-reader.test.ts`, `test/contract/workflow-profile.test.ts`, `test/e2e/packaged.spec.ts` | 4 |
| 13 | `src/main/harness/install.ts`, `src/main/ipc/harness.ts`, `src/shared/ipc/harness.ts`, `src/renderer/shell/toolbar/HarnessStatus.tsx`, `src/main/storage/paths.ts`, `src/main/agent/options.ts`, `electron-builder.yml`, `harness/.claude-plugin/marketplace.json`, `test/contract/harness-install.test.ts`, `test/e2e/harness-install.spec.ts`, `test/e2e/packaged.spec.ts`, `test/e2e/toolbar.spec.ts` | 5 |
| 14 | `src/main/harness/migrate/plan.ts`, `src/main/harness/migrate/apply.ts`, `src/main/harness/migrate/profiles.ts`, `src/main/harness/migrate/restore.ts`, `src/main/ipc/harness-migration.ts`, `src/shared/ipc/harness-migration.ts`, `src/renderer/harness/MigrationForm.tsx`, `src/renderer/shell/toolbar/HarnessStatus.tsx`, `test/contract/harness-migrate.test.ts`, `test/fixtures/claude-home-legacy/`, `test/unit/harness-migration-form.test.tsx`, `test/e2e/harness-migrate.spec.ts` | 6 |
| 15 | `electron-builder.yml`, `scripts/statusline-bridge.sh`, `src/main/agent/limits.ts`, `test/e2e/packaged.spec.ts`, `test/contract/statusline-bridge.test.ts` | 6 |
| 16 | `HANDOFF.md`, `~/.claude/` | 7 |
| 17 | `harness/.mcp.json`, `harness/bin/qmd-mcp`, `harness/bin/qmd-refresh`, `harness/bin/qmd-sync-main`, `harness/bin/qmd-collections`, `harness/bin/tests/qmd.test.sh`, `harness/bin/tests/qmd-collections.test.sh`, `harness/bin/tests/skill-blocks.test.sh`, `harness/hooks/hooks.json`, `harness/agents/scout.md`, `harness/agents/reviewer.md`, `harness/skills/qmd/SKILL.md`, `harness/profiles/README.md`, `src/main/harness/qmd.ts`, `src/main/workflow/profile.ts`, `test/contract/harness-qmd.test.ts`, `test/contract/workflow-profile.test.ts`, `test/unit/agent-options.test.ts` | 8 |
| 18 | `harness/hooks/gh-token-env.sh`, `harness/hooks/hooks.json`, `harness/hooks/tests/gh-token-env.test.sh`, `harness/skills/epic-wave/SKILL.md`, `harness/skills/ship-ticket/SKILL.md`, `harness/skills/overnight-fix-loop/SKILL.md`, `harness/agents/implementer.md`, `harness/agents/reviewer.md`, `harness/profiles/README.md`, `src/main/agent/app-registry.ts`, `test/unit/agent-query-factory.test.ts` | 9 |
| 19 | `docs/design/F-SPEC.md`, `src/main/first-run/checks.ts`, `src/main/first-run/actions.ts`, `src/shared/ipc/first-run.ts`, `src/main/ipc/first-run.ts`, `src/renderer/shell/FirstRun.tsx`, `src/renderer/shell/AppShell.tsx`, `src/renderer/palette/commands.ts`, `src/shared/ipc/terminal.ts`, `src/main/ipc/terminal.ts`, `src/main/terminal/pty.ts`, `test/contract/first-run-checks.test.ts`, `test/contract/terminal.test.ts`, `test/e2e/first-run.spec.ts`, `test/fixtures/first-run-tools/` | 9 |
| 20 | `harness/skills/epic-wave/SKILL.md`, `src/main/github/prs.ts`, `src/shared/ipc/checks.ts`, `src/main/ipc/checks.ts`, `src/main/ipc/autopilot.ts`, `src/shared/autopilot/journal.ts`, `src/main/autopilot/run.ts`, `test/contract/github-prs.test.ts`, `test/unit/autopilot-journal.test.ts`, `test/unit/autopilot-run.test.ts`, `test/e2e/autopilot.spec.ts`, `test/fixtures/agent-scripts/autopilot-narrow.jsonl` | 8 |
| 21 | `src/main/autopilot/harness-drift.ts`, `src/main/autopilot/run.ts`, `src/main/ipc/autopilot.ts`, `src/shared/autopilot/journal.ts`, `src/shared/ipc/autopilot.ts`, `src/renderer/canvas/actions/AutopilotAction.tsx`, `docs/design/F-SPEC.md`, `test/contract/harness-drift.test.ts`, `test/unit/autopilot-run.test.ts`, `test/unit/autopilot-journal.test.ts`, `test/unit/canvas-actions.test.tsx`, `test/e2e/packaged.spec.ts` | 10 |
| 22 | `harness/profiles/README.md`, `harness/bin/profile`, `harness/bin/ticket`, `harness/bin/epic-status`, `harness/bin/epic-board`, `harness/bin/preflight`, `harness/bin/silent-check`, `harness/hooks/guard.mjs`, `harness/hooks/session-start.sh`, `harness/skills/epic-wave/SKILL.md`, `harness/skills/ship-ticket/SKILL.md`, `harness/skills/retro/SKILL.md`, `harness/skills/continuous-audit/SKILL.md`, `harness/agents/implementer.md`, `harness/bin/tests/silent-mode.test.sh`, `harness/bin/tests/profile.test.sh`, `harness/bin/tests/tickets-root.test.sh`, `harness/bin/tests/preflight.test.sh`, `harness/bin/tests/skill-blocks.test.sh`, `harness/hooks/tests/guard-silent.test.sh`, `harness/hooks/tests/session-hooks.test.sh` | 10 |
| 23 | `src/main/workflow/profile.ts`, `src/main/workflow/folder.ts`, `src/main/workflow/reader.ts`, `src/main/workflow/watch.ts`, `src/main/docs/watch.ts`, `src/main/ipc/docs.ts`, `src/main/projects/store.ts`, `src/main/ipc/checks.ts`, `src/shared/ipc/checks.ts`, `src/shared/workflow/types.ts`, `src/shared/workflow/ticket-ref.ts`, `src/shared/binding/resolve.ts`, `src/renderer/canvas/badges/use-checks.ts`, `src/renderer/canvas/badges/ChecksBadges.tsx`, `src/renderer/canvas/actions/OpenPr.tsx`, `src/renderer/canvas/nodes/TicketNode.tsx`, `test/contract/workflow-reader.test.ts`, `test/contract/workflow-profile.test.ts`, `test/contract/docs.test.ts`, `test/contract/projects.test.ts`, `test/contract/github-prs.test.ts`, `test/unit/checks-badges.test.tsx`, `test/unit/epic-canvas.test.tsx`, `test/unit/ticket-ref.test.ts`, `test/unit/binding.test.ts`, `test/e2e/silent-project.spec.ts` | 11 |
| 24 | `src/main/projects/connect.ts`, `src/main/ipc/projects.ts`, `src/shared/ipc/projects.ts`, `src/main/agent/options.ts`, `src/renderer/projects/ConnectProject.tsx`, `src/renderer/shell/sidebar/ProjectsSection.tsx`, `src/renderer/canvas/overlays/FirstEpic.tsx`, `harness/skills/connect-project/SKILL.md`, `harness/bin/project-connect`, `harness/bin/tests/project-connect.test.sh`, `harness/profiles/draft.schema.json`, `harness/profiles/README.md`, `test/contract/projects-connect.test.ts`, `test/e2e/projects-connect.spec.ts`, `test/e2e/projects.spec.ts`, `test/unit/first-epic.test.tsx`, `test/fixtures/agent-scripts/profile-draft.jsonl` | 11 |
| 25 | `src/main/github/accounts.ts`, `src/main/projects/connect.ts`, `src/main/ipc/projects.ts`, `src/shared/ipc/projects.ts`, `src/renderer/projects/ConnectProject.tsx`, `test/fixtures/gh/gh-stub.mjs`, `test/contract/github-accounts.test.ts`, `test/contract/projects-connect.test.ts`, `test/e2e/projects-connect.spec.ts` | 12 |
| 26 | `scripts/e3-sandbox.sh`, `scripts/e3-owner-check.sh`, `test/acceptance/e3.spec.ts`, `test/acceptance/fixtures/silent-repo/`, `test/acceptance/fixtures/silent-epic/`, `playwright.acceptance.config.ts`, `package.json`, `vitest.config.ts`, `tsconfig.test.node.json` | 13 |

Правило плана. Ticket стоит в первой Wave, где закрыты все его блокеры (`Blocked by`). Если у двух
Ticket-ов одной Wave общий файл, Ticket с большим номером уходит в следующую Wave. Ticket 16 — шаг
владельца — стоит в Wave один; все Ticket-ы, которые его ждут, идут после.

- **Wave 1 — 01, 02, 03 и 10.** Блокеров нет, общих файлов нет.
- **Wave 2 — 04, 05, 06, 07 и 08.** Все ждут только 02. Группы файлов не пересекаются (Q32): 04 —
  сборка и код worfy, 05 — части правил и `hooks.json`, 06 — skills `epic-wave` и `ship-ticket`,
  07 — agents, 08 — остальные skills, `bin/` и скрипты `hooks/`.
- **Wave 3 — 09 и 11.** 09 ждёт 08, 11 — 06, 07 и 08. Общих файлов нет: 09 — `gate.sh` и чтение
  вердикта в worfy, 11 — `profile`, `preflight`, контракт Profile и строки skills с полями-путями.
- **Wave 4 — 12.** Ждёт 04 и 10, по блокерам — Wave 3; сдвинут (ниже).
- **Wave 5 — 13.** Ждёт 04 и 12.
- **Wave 6 — 14 и 15.** 14 ждёт 11 и 13, 15 — 13. Общих файлов нет: `electron-builder.yml` и
  `test/e2e/packaged.spec.ts` — только у 15, `HarnessStatus.tsx` — только у 14.
- **Wave 7 — 16, один.** Ждёт 05, 09, 14 и 15. Autopilot его не берёт: Ticket лежит в `blocked` с
  этого docs-PR, и прогон останавливается, когда других готовых Ticket-ов нет.
- **Wave 8 — 17 и 20.** Оба ждут только 16. Общих файлов нет: 17 — qmd, 20 — `epic-wave` и
  Autopilot в worfy.
- **Wave 9 — 18 и 19.** 18 ждёт 01 и 16 (по блокерам — Wave 8, сдвинут), 19 — 16 и 17. Общих файлов
  нет.
- **Wave 10 — 21 и 22.** 21 ждёт 12, 22 — 16; оба сдвинуты. Общих файлов нет: 21 — код worfy и
  `F-SPEC.md`, 22 — только `harness/`.
- **Wave 11 — 23 и 24.** 23 ждёт 22, 24 — 19 и 22. Общих файлов нет: `src/main/projects/store.ts` и
  `test/contract/projects.test.ts` — только у 23.
- **Wave 12 — 25.** Ждёт 24.
- **Wave 13 — 26.** Ждёт все остальные Ticket-ы.

Сдвиги из-за общих файлов:

- **12: Wave 3 → 4.** С 09 общие `src/main/gate/state.ts` и `test/unit/gate-state.test.ts`. Отсюда
  13 — в Wave 5, 14 и 15 — в Wave 6, 16 — в Wave 7.
- **21: Wave 5 → 10.** По блокеру (12) — Wave 5. Wave 5 → 6: с 13 общий
  `test/e2e/packaged.spec.ts`. Wave 6 → 7: с 15 тот же файл. Wave 7 занята одним Ticket-ом 16 →
  Wave 8. Wave 8 → 9: с 20 общие `src/main/autopilot/run.ts`, `src/main/ipc/autopilot.ts`,
  `src/shared/autopilot/journal.ts`, `test/unit/autopilot-run.test.ts`,
  `test/unit/autopilot-journal.test.ts`. Wave 9 → 10: с 19 общий `docs/design/F-SPEC.md`. Ticket 16
  он не ждёт. Если 14 и 15 влиты, а 16 стоит `blocked`, вычисление Wave в момент запуска возьмёт 21
  раньше шага владельца — это допустимо.
- **18: Wave 8 → 9.** С 17 общие `harness/hooks/hooks.json`, `harness/agents/reviewer.md`,
  `harness/profiles/README.md`.
- **22: Wave 8 → 10.** Wave 8 → 9: с 17 общие `harness/profiles/README.md` и
  `harness/bin/tests/skill-blocks.test.sh`, с 20 — `harness/skills/epic-wave/SKILL.md`. Wave 9 → 10:
  с 18 общие `harness/profiles/README.md`, `harness/skills/epic-wave/SKILL.md`,
  `harness/skills/ship-ticket/SKILL.md`, `harness/agents/implementer.md`. Отсюда 23 и 24 — в Wave 11,
  25 — в Wave 12, 26 — в Wave 13.

Таблица собрана скриптом. Файлы — текст в обратных кавычках пунктов списка «Где в коде», без
пояснений после « — » и без исходных путей `~/.claude/…` в скобках. Пересечения — правилом
`filesOverlap` (`src/shared/workflow/waves.ts:145`): папка с `/` на конце пересекается с каждым
файлом в ней. Внутри каждой Wave плана общих файлов нет, каждый блокер — в Wave раньше.
