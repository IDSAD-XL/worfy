# Skills, agents and hooks

> Перевод [английской версии](../skills-agents-and-hooks.md), commit `3f662f1c`.

Три Feature plugin-а [Harness](harness.md). **Skills** это процедуры, которым следуют агенты, **Agents** это три роли, которые они
запускают, а **Hooks** это то, что само работает вокруг Session. Термины объяснены в [Concepts](concepts.md).

## Skills

### Behaviour

Skill это процедура в Markdown, которой следует агент. Действия worfy, Autopilot и пользователь запускают их как `/worfy:<name>`, а
модель может выбрать по описанию любой, кроме `overnight-fix-loop`.

| Skill | Когда | Что делает |
|---|---|---|
| `epic-wave` | `/worfy:epic-wave tickets 05, 06 of epic X`, команда Autopilot, или просьба запустить или продолжить Wave | Запуск, проверка и merge Ticket-ов Wave |
| `ship-ticket` | Один Ticket, или review PR, который написала другая Session | Один Ticket от claim до финиша по его Profile |
| `connect-project` | `/worfy:connect-project <folder> <full\|silent>`, или черновик в "Add project" | Читает код, составляет черновик Profile, его правил и записей registry и пишет их после подтверждения |
| `gate-queue` | `/worfy:gate-queue`, на Machine, чей Profile обслуживает очередь | См. [cross-machine gate queue](gate-and-github.md) |
| `max-review` | По просьбе, или для Ticket-а с отметкой о риске | Две линзы по всей ветке, по желанию на двух моделях, синтез и агенты-скептики. Ничего не правит и не вливает |
| `retro` | Конец Ticket-а, Epic-а или сессии отладки | Записывает то, что обобщается, туда, где Profile держит уроки |
| `qmd` | Перед планированием, или для вопроса «почему так решили» | Правила поиска решений и уроков |
| `continuous-audit` | "audit", или запуск по расписанию | Epic аудита из находок. Находка остаётся утверждением, пока её не воспроизведёт второй агент |
| `overnight-fix-loop` | `/worfy:overnight-fix-loop <modules>`, вручную | По worktree и implementer-у на модуль, с merge в ночную ветку. Ночью в главную ветку ничего не идёт |
| `tickets-to-tasks` | После записи Ticket-ов, или когда список задач пуст | Импортирует Ticket-ы в Tasks Claude Code и сохраняет их блокировки |

**`ship-ticket`.** Финиш берётся из `workflow.finish`. Шаги 7 и 8 идут в порядке Pipeline: с `agent-review` после `ci`, это значение по
умолчанию, сначала идёт шаг 8, а шаг 7 идёт на head-е PR. Остальные шаги идут по номерам:

| Шаг | Что происходит |
|---|---|
| 0 Profile | Читает факты и Pipeline Project-а |
| 1 Claim | `ticket claim`, Ticket и его spec, и один вызов `qmd` до плана |
| 2 Fresh base | Свежая база и свой worktree Ticket-а, или main checkout, когда Profile говорит `single` |
| 3 Numbers | Номера ADR и миграций берутся до содержимого |
| 4 Failing test | Test виден красным до исправления |
| 5 Implementation | Само изменение |
| 6 Checks | `commands.verify` и Gate, с видимым exit code |
| 7 Review | Агенты review по diff, когда в Pipeline есть `agent-review` |
| 8 PR and CI | PR и зелёный CI |
| 9 Merge | Отдельный шаг, на зелёном |
| 10 Production | С `pr-green-ci` и `deploy` в Profile: проверка того, что задеплоено. Иначе пропускается |
| 11 Close | Конец Ticket-а |

С `local-green` зелёный шаг 6 это финиш кода: дальше идут шаги 7 и 11, с локальным merge, а шаги 8–10 пропускаются. Спорное решение в
spec, конфликт, который не решается механически, или красная проверка, не исправленная за две попытки, останавливают skill с вопросом.

**`epic-wave`.** Его ведёт Orchestrator, раздел за разделом:

1. **Preflight**: `preflight` и состояние перед Wave.
2. **Dispatch**: implementer с именем `impl-<NN>` на Ticket, в фоне. Merge остаётся за Orchestrator-ом. Вопрос к владельцу не
   останавливает Wave: берётся рекомендованный вариант и записывается как решённый без владельца. В Session без человека вопрос к
   пользователю автоматически отклоняется.
3. **Verification gate**, когда в Pipeline есть `agent-review`: агент с именем `verify-<NN>` проверяет каждый отчёт.
4. **Merge by policy**: CI, отметки и merge-и.
5. **Report**: затем сохранённый brief, и Session останавливается.

Новая Session продолжает, сначала запустив `wave-brief`.

**Что меняет Profile.**

- `workflow.agents`: `full` или `eco`. В `eco` маленький Ticket (только документы или одно изменение в одном файле) делает сам
  Orchestrator, если только он не затрагивает скрипт или hook, не является платформенным PR и не удаляет файлы, не останавливает
  процессы и не заменяет копию. В `ship-ticket` review собственного diff Ticket-а в режиме `eco` идёт на глубине `low`. Verification
  gate в `epic-wave` сохраняет свою глубину. Переключатель Eco mode пишет это поле вместе с `agents`, моделью и effort каждой роли
  ([Sessions](sessions.md)).
- `docs.feature_pages`: папка страниц, описывающих поведение. На шаге 5 `ship-ticket` изменение, которое меняет описанное там поведение,
  правит страницу в том же PR, а список файлов Ticket-а в `epic-wave` без такой страницы неполон. Без поля шаг пропускается, и это
  говорится вслух.
- `review.lenses` и `review.depth`: линзы и то, сколько reviewer-ов в раунде на глубинах `low`, `medium`, `high` и `max`. Аргумент
  skill-а или слово владельца в сообщении важнее глубины.
- `workflow.pipeline`: Stage-ы, а значит и то, какие шаги идут ([Workflow](workflow.md)).

**В Silent mode** процедура та же, с файлами в Workflow folder, а отдельный файл skill-а говорит, чего не должны нести ветки, commit-ы и
тексты PR.

### How it works

- **Загружается только начало.** `ship-ticket` держит шаги 7–11 и части, нужные только некоторым Ticket-ам, в файлах рядом, каждый
  читается на своём шаге, так что агент, который туда не дошёл, за них не платит. Claude Code подставляет корень plugin-а только в
  `SKILL.md`, поэтому те файлы называют заполнитель, который агент читает как папку plugin-а.
- **Вопросы не останавливают запуск без присмотра**, потому что под [Autopilot](autopilot.md) Wave идёт без человека.
- **Merge принадлежит Orchestrator-у**, а implementer останавливается на своём финише.

### Implementation

- В `harness/skills/` на каждый skill папка с `SKILL.md`, например `harness/skills/epic-wave/SKILL.md`.
  `harness/skills/overnight-fix-loop/SKILL.md` задаёт `disable-model-invocation`.
- `harness/skills/ship-ticket/` держит ещё `step-*.md`, `silent-mode.md`, `review-of-another-pr.md`, `pipeline-stages.md` и файлы
  `implementer-*.md`, которые называет определение агента.
- `src/shared/projects/action-templates.ts` держит команды, которые отправляют действия worfy: `/worfy:ship-ticket`, `/worfy:epic-wave` и
  `/worfy:gate-queue`.

Главные test-ы: `harness/bin/tests/epic-wave-ship-ticket.test.sh`, `harness/bin/tests/skill-blocks.test.sh`,
`harness/bin/tests/review-depth.test.sh`, `harness/bin/tests/max-review.test.sh`, `harness/bin/tests/gate-queue.test.sh`,
`harness/bin/tests/silent-mode.test.sh`, `harness/bin/tests/skills-allowed.test.sh` и `test/contract/harness-retro-skill.test.ts`.
Eval-ы проверяют `epic-wave` и `ship-ticket` по поведению.

## Agents

### Behaviour

Три агента одинаковы для каждого Project-а. Каждый начинает с запуска `profile`, на пути, который называет его brief.

| Агент | Модель, effort | Инструменты | Что пишет | Чем заканчивает |
|---|---|---|---|---|
| `worfy:implementer` | Наследуется, high | Все | Код и test-ы одного Ticket-а, в своём worktree или main checkout | Отчёт в JSON |
| `worfy:reviewer` | Наследуется, high | Read, Grep, Glob, Bash, `qmd` | Ничего не исправляет: сообщает, а исправляет implementer | Находки, не больше 30 строк |
| `worfy:scout` | sonnet, medium | Read, Grep, Glob, Bash, `qmd` | Только карту кода, вне репозитория | Ответ: где X, как работает Y, карта файлов |

**Какая модель и effort.** Побеждает первое с допустимым значением: слово владельца в сообщении, аргумент skill-а, `agents.<role>` из
Profile, собственное определение агента. Роли: `implementer`, `reviewer` (reviewer-ы и скептики), `scout` и `verifier`. Модель это
`sonnet` или `opus`, effort это `low`, `medium` или `high`. Другое значение, включая `haiku`, не передаётся. Отчёт skill-а называет модель
и effort каждого агента и откуда они взялись.

**Implementer.** Правит файлы из раздела следа Ticket-а и те, что назвал brief, а остальное сообщает как вне scope. Посылку brief-а,
которой противоречит код, он не выполняет молча: достигает результата другим путём и говорит об этом первым. Запускает проверку и Gate с
exit code, открывает PR, когда финиш его требует, и не ждёт CI. Не делает merge, не запускает агентов review и не трогает ADR и файл
состояния. Его отчёт содержит:

- `ticket`, `branch`, `pr`, `worktree`, `files_changed`
- `commands`, каждую с exit code
- `claims`, каждое с доказательством, которое проверяет другой агент
- `removed`, что изменение убрало из существующего поведения
- `not_verified`, `out_of_scope` и `sign_in_needed`

**Reviewer.** Получает diff и одну линзу и пытается опровергнуть «всё в порядке». Находка говорит о строке diff, невыполненном пункте
Ticket-а или доказательстве, которое не держится, и у каждой есть серьёзность, сценарий и исправление. Дефект рядом с изменением идёт на
строку "outside the diff", а дефект вне линзы на строку "outside the lens". Удаление, которое Ticket, spec или brief называют намеренным,
не считается находкой, если только последствия не кажутся недооценёнными или изменение не выглядит вредным. Сначала он спрашивает `qmd`,
не решён ли уже вопрос. У трёх линз есть записанные правила:

- **Implementer's report**: первые символы ответа это `VERIFIED` или `REJECTED: <the unconfirmed claims>`.
- **Simplification**: что можно удалить, использовать повторно или упростить. Предложение, на которое нечем указать, не сообщается.
- **documentation**: меняет ли diff поведение, которое описывает страница из `docs.feature_pages`, не правя эту страницу. Фраза, которую
  изменение делает ложной, это `med`. Рефакторинг, поведение, которого нет ни на одной странице, и фраза, неверная ещё до diff, находками
  не считаются.

Остальные линзы, из `review.lenses`, читаются по именам. Для Ticket-а с UI нужны снимки в обеих темах.

**Scout.** На вопрос о коде он сначала читает карту кода. Отвечает, где X или как работает Y, или строит список файлов для Ticket-а. Не
правит файлы репозитория и не запускает stack.

**Начальный контекст.** Агент начинает со своего определения, общих правил из [Hooks](#hooks) и skill-а, который читает в начале.
`start-context` оценивает это из расчёта 2,7 байта на токен и выходит с кодом 1, когда части, которые пишет Harness, превышают 15 000
токенов для агента.

### How it works

- **Роли проверяют друг друга.** Утверждения implementer-а идут другому агенту, а reviewer-ов запускает Orchestrator. Implementer,
  который запустил бы reviewer-а, ждал бы вечно, потому что ответ идёт Orchestrator-у.
- **Параллельные reviewer-ы держат по одной линзе**, потому что пересечение лишает смысла параллельный запуск.
- **Карта до кода.** Scout повторно использует карту кода, а `code-map stale` перечисляет папки, файлы которых изменились после их commit-а.

### Implementation

- `harness/agents/implementer.md`, `harness/agents/reviewer.md` и `harness/agents/scout.md` это определения.
- `harness/skills/ship-ticket/implementer-report.md` и другие файлы `implementer-*.md` держат то, что нужно только некоторым Ticket-ам.
- `harness/bin/code-map` и `harness/bin/start-context` это скрипты, перечисленные на странице [Harness](harness.md).

Главные test-ы: `harness/bin/tests/agents-text.test.sh`, `harness/bin/tests/code-map.test.sh`, `harness/bin/tests/start-context.test.sh` и
eval-ы `harness/evals/implementer-report/`, `harness/evals/reviewer-verdict/`, `harness/evals/reviewer-intended-breakage/` и
`harness/evals/reviewer-simplification/`.

## Hooks

### Behaviour

Claude Code запускает эти команды на свои события. Лимит в секундах.

| Событие | Команда | Лимит | Что делает |
|---|---|---|---|
| `SessionStart` | `inject-rules.mjs orchestrator` | 10 | Правила главной Session |
| `SessionStart` | `inject-rules.mjs common` | 10 | Общие правила и правила пользователя |
| `SessionStart` | `session-start.mjs` | 15 | Контекст Project-а |
| `SessionStart` | `gh-token-env.mjs` | 10 | `GH_TOKEN` аккаунта Project-а |
| `SessionStart` | `worktree-lock claim` | 10 | Регистрируется в дереве и говорит, кто там уже есть |
| `SubagentStart` | `inject-rules.mjs common` | 10 | Общие правила и правила пользователя |
| `PreToolUse` на Bash | `guard.mjs` | 30 | Bash guard |
| `TaskCompleted`, `TeammateIdle` | `gate.sh fast` | 900 | [Gate](gate-and-github.md) |
| `Stop` | `stop.mjs` | 10 | Держит ход, пока Gate красный, см. [Gate](gate-and-github.md) |
| `Stop` | `worktree-lock beat` | 5 | Отмечает Session живой |
| `Stop` | `qmd-refresh --quiet` | 15 | Обновляет индекс в фоне, если главная ветка сдвинулась или файл memory либо lessons новее последнего обновления. Когда qmd не может работать (нет qmd, слишком старый node), завершается с exit code 0, не обновляет индекс и пишет причину в журнал не чаще раза в сутки |
| `SessionEnd` | `session-end.mjs` | 10 | Отмечает Session без ретроспективы |
| `SessionEnd` | `worktree-lock release` | 5 | Снимает регистрацию |

**Сломанный hook не ломает Session.** Сбой внутри `inject-rules.mjs`, `session-start.mjs`, `session-end.mjs`, `gh-token-env.mjs` или
`stop.mjs` это одна строка в stderr и код 0, а worktree lock падает молча. Gate даёт вердикт через exit code, а `stop.mjs` держит ход с
кодом 2. Guard выходит с кодом 0 и отказывает через свой ответ.

**Правила.** `orchestrator` доходит до главной Session, а `common` до главной Session и каждого Subagent-а. В `orchestrator` основной цикл,
делегирование и отчёт. В `common` простой язык, доказательство перед «зелёным», гигиена контекста и shell-команды, которым нужно
подтверждение человека. Claude Code обрезает такой текст до превью выше 10 000 символов, поэтому `common` с правилами пользователя держится
в этом пределе: более длинный файл правил обрезается после целой строки, а заключительная строка называет файл. Файл, который нельзя
прочитать, стоит одной строки в stderr, и часть приходит без него.

**Контекст Project-а.** Он пуст для папки вне зарегистрированного Project-а и для Project-а, который ничего не просит:

| Что добавляется | Когда |
|---|---|
| Где лежат файлы workflow и что ветки, commit-ы и PR не несут следов workflow | Silent mode |
| Что commit-ы и PR не несут строк атрибуции Claude | `attribution: off` |
| Правила Project-а без раздела источников, индекс уроков, когда уроки лежат в Profile, карта активного Epic-а | `session.inject_rules: true` |
| Напоминание о `/retro` | `session.retro_reminder_after`, когда столько Session-ов закончилось после последнего `/retro` |

Каждый раздел по умолчанию не больше 20 000 байт. Более длинный обрезается на конце строки, а последняя строка называет полный текст.

**`GH_TOKEN`.** Когда `github.account` из Profile это логин GitHub и `gh auth token -u <account>` проходит успешно, hook добавляет строку в
файл окружения Claude Code, который выполняется перед каждой командой Bash в Session и её Subagent-ах. Токен вычисляется для каждой команды
и не пишется на диск. Он важнее `GH_TOKEN`, экспортированного пользователем, а глобальный аккаунт `gh` не трогается. Если такого логина в
`gh` нет, Session получает об этом одну строку и идёт дальше.

**Worktree lock.** Он говорит, кто ещё пишет в эту папку, чего git не отслеживает. Он ничего не блокирует. Session считается живой, если
отметилась за последние 60 минут (`WORKTREE_LOCK_TTL_MIN`), а `beat` молчит, пока набор Session-ов не изменился.

**Bash guard.** Он отказывает команде и называет причину в трёх случаях:

| Отказ | Какие команды |
|---|---|
| Уничтожение незакоммиченной работы | `git checkout` или `git restore` по `.`, `./` или `*`; `git reset --hard`; `git clean` с force; `git stash pop`, `git stash drop` и `git stash` отдельно или сразу с `-u`, `-k`, `-a` или `save` |
| Pipe, который прячет exit code | Pipe после `pnpm`, `yarn` или `npm` с `lint`, `test`, `typecheck`, `check` или `build`, или после `vitest`, `eslint`, `tsc`, `jest`, `pytest` или `gh pr checks`, если `pipefail` не стоит перед pipe |
| Следы workflow | В Silent mode или с `attribution: off`: текст и staged changes команды `git commit`, имя новой ветки и текст `gh pr create`, `edit`, `comment`, `review` или `merge`, когда `silent-check` их отвергает |

Причина называет правильный путь, например временный commit или `set -o pipefail`. В первых двух случаях текст в кавычках в команде вроде
`grep` или `echo` считается данными, а тело heredoc не читается как команда. Проверка следов, которая не дала ответа, тоже отказывает: на
попытку 10 с, на команду две попытки всего, так что hook укладывается в свой лимит. Если проверка не может прочитать Profile, команда идёт
дальше.

#### On Windows

Hooks запускают `profile` как `node <script>`, а не по его первой строке. Текст правил показывает корень plugin-а как `C:/…`, а домашняя
папка, показанная как `~`, это `USERPROFILE`. Launcher Gate описан на [странице Gate](gate-and-github.md).

### How it works

- **Правила не `CLAUDE.md`.** Claude Code не загружает его из корня plugin-а, а файл в подпапке репозитория добавлялся бы к каждой Session,
  которая правит эту папку. Поэтому они приходят как `additionalContext`.
- **Текст для модели, а не управление.** Сдерживают что-либо только Gate и guard. Остальное это текст для модели.
- **Токен не попадает в вывод.** Hook проверяет только exit code `gh`, а записанная им строка вычисляет токен позже.
- **Значение атрибуции по умолчанию следует за режимом**: выключена в Silent mode и включена в Full mode, если Profile не задаёт её сам
  ([ADR-0061](../../adr/0061-attribution-default-follows-mode.md)).

### Implementation

- `harness/hooks/hooks.json` подключает каждый hook через корень plugin-а.
- `harness/hooks/inject-rules.mjs` с `harness/hooks/rules/orchestrator.md` и `harness/hooks/rules/common.md`.
- `harness/hooks/session-start.mjs` и `harness/hooks/session-end.mjs`, которые спрашивают Project у `bin/profile`. Журнал ретроспектив это
  `state/pending-retro.log` в Profile.
- `harness/hooks/gh-token-env.mjs`, `harness/hooks/guard.mjs` (с `harness/bin/silent-check`) и `harness/bin/worktree-lock`, чей registry это
  `worktree-sessions/` в Harness home.
- `harness/hooks/stop.mjs`, `harness/hooks/gate.mjs`, `harness/hooks/gate.sh` и модули рядом: см. [Gate](gate-and-github.md).
- `harness/hooks/eval-env.cjs` даёт скриптам их git и папку состояния, с переменными запуска eval.
- `harness/hooks/worktree-create.sh` это черновик, и `harness/hooks/hooks.json` его не запускает.

Главные test-ы, все shell: `harness/hooks/tests/rules-hooks.test.sh`, `harness/hooks/tests/session-hooks.test.sh`,
`harness/hooks/tests/gh-token-env.test.sh`, `harness/hooks/tests/guard-silent.test.sh` и `harness/bin/tests/harness-home.test.sh`. Eval
`harness/evals/status-block/` по поведению проверяет, что главная Session следует правилам.
