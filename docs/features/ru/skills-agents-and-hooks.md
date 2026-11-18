# Skills, agents and hooks

> Перевод [английской версии](../skills-agents-and-hooks.md), commit `b82c4d25`.
>
> Последний абзац раздела Implementation уже переводит текст PR #1996 (Ticket 13 Epic-а `worfy-continuity`), которого ещё нет в `main`.

Три Feature plugin-а [Harness](harness.md). **Skills** это процедуры, которым следуют агенты, **Agents** это четыре роли, которые они
запускают, а **Hooks** это то, что само работает вокруг Session. Термины объяснены в [Concepts](concepts.md).

## Skills

### Behaviour

Skill это процедура в Markdown, которой следует агент. Действия worfy, Autopilot и пользователь запускают их как `/worfy:<name>`, а
модель может выбрать по описанию любой skill, кроме отмеченных ниже как «только вручную». Plugin несёт одиннадцать собственных skill-ов
worfy и двадцать, скопированных из skill-ов Matt Pocock.

| Skill | Когда | Что делает |
|---|---|---|
| `epic-wave` | `/worfy:epic-wave tickets 05, 06 of epic X`, команда Autopilot, или просьба запустить или продолжить Wave | Запуск, проверка и merge Ticket-ов Wave |
| `ship-ticket` | Один Ticket, или review PR, который написала другая Session | Один Ticket от claim до финиша по его Profile |
| `connect-project` | `/worfy:connect-project <folder> <full\|silent>`, или черновик в "Add project" | Читает код, составляет черновик Profile, его правил и записей registry и пишет их после подтверждения |
| `gate-queue` | `/worfy:gate-queue`, на Machine, чей Profile обслуживает очередь | См. [cross-machine gate queue](gate-and-github.md) |
| `max-review` | По просьбе, или для Ticket-а с отметкой о риске | Две линзы по всей ветке, по желанию на двух моделях, синтез и агенты-скептики. Ничего не правит и не вливает |
| `qmd` | Перед планированием, или для вопроса «почему так решили» | Правила поиска решений и уроков |
| `continuous-audit` | "audit", или запуск по расписанию | Epic аудита из находок. Находка остаётся утверждением, пока её не воспроизведёт второй агент |
| `overnight-fix-loop` | `/worfy:overnight-fix-loop <modules>`, только вручную | По worktree и implementer-у на модуль, с merge в ночную ветку. Ночью в главную ветку ничего не идёт |
| `tickets-to-tasks` | После того как `/worfy:to-tickets` или `/worfy:wayfinder` записали Ticket-ы, или когда список задач пуст | Импортирует Ticket-ы в Tasks Claude Code и сохраняет их блокировки |
| `human-review-setup` | `/worfy:human-review-setup`, или "Build" в предложении reviewer-а команды ([Projects](projects.md)), только вручную | Читает историю review команды на GitHub, показывает, сколько прочтёт модель, и её оценку в токенах, а после согласия человека пишет приватный skill review голосом команды |
| `pr-reply` | `/worfy:pr-reply <owner>/<repo>#<N>`, или действие `actions.prReply` ("Draft replies"), которое запускает Session на Claude Code по шаблону из Project settings | Читает pull request, его diff и его review threads, сверяет каждый комментарий с кодом на head commit-е, не переключая ветку, и передаёт черновик ответа на каждый review thread, который ждёт ответа, в `pr-reply-draft`; тот проверяет их через `review-draft-lint --reply` и хранит в `<Profile folder>/state/pr-inbox/drafts/`. Ничего не публикует |
| `product-ideas` | Модель, когда Product owner просит идей или спрашивает «что дальше» | Читает roadmap, spec-и, открытые Ticket-ы и тему и отвечает тремя–пятью идеями: для кого, почему сейчас, цена в Ticket-ах и как понять, что сработало; хотя бы одна из них против названного пункта roadmap. Каждая идея становится узлом Mind map с `advice: true`; без tool-ов Mind map идеи остаются в ответе. Черновик Epic-а он не пишет, пока владелец не скажет «да» какой-то идее |

**Skill-ы Matt Pocock.** Двадцать skill-ов это копия skill-ов Matt Pocock, версия 1.3.1 plugin-а `mattpocock-skills`, под лицензией MIT.
`harness/skills/THIRD_PARTY.md` называет автора, upstream commit и файл лицензии и перечисляет каждую строку, которая отличается от
1.3.1. Ссылка на другой skill называет его `worfy:<name>`. Там, где skill просил свой upstream skill настройки, он теперь читает папку
Ticket-ов Project-а (`tickets.root` из Profile) как свой tracker, с операциями из `harness/bin/TICKETS.md`, а Project без Profile
отправляет к `/worfy:connect-project`. `to-tickets` пишет заголовок Ticket-а worfy (`Type`, `Status: open`, `Blocked by`) и кладёт
критерии приёмки под заголовок done из Profile (`tickets.done_section`), куда прикрепляется Evidence; `domain-modeling` держит glossary
в файле `docs.context` из Profile, а не в `GLOSSARY.md` в корне; ни `to-tickets`, ни `to-spec` не ставят метку triage. Копия заморожена:
ничто не синхронизирует её с upstream, а новая версия приходит только отдельным PR.

| Skill | Когда | Что делает |
|---|---|---|
| `code-review` | Модель, или `/worfy:code-review` | Делает review изменений после фиксированной точки по двум осям, стандарты репозитория и spec, в двух Subagent-ах |
| `codebase-design` | Модель | Словарь глубоких модулей: interface, seam, глубина |
| `diagnosing-bugs` | Модель | Цикл диагностики трудного бага или регрессии производительности |
| `domain-modeling` | Модель | Glossary и ADR Project-а, которые ведутся во время проектирования |
| `grill-with-docs` | `/worfy:grill-with-docs`, только вручную | Допрос по плану, который по ходу записывает glossary и ADR |
| `improve-codebase-architecture` | `/worfy:improve-codebase-architecture`, только вручную | Находит модули, которые стоит углубить, показывает их в отчёте HTML, затем допрашивает по выбранному |
| `prototype` | Модель | Одноразовый прототип логики или UI для вопроса дизайна |
| `research` | Модель | Исследование по первоисточникам, записанное в файл Markdown в репозитории |
| `retro` | `/worfy:retro`, только вручную | Ретроспектива Session: предлагает изменения окружения агента и ничего не пишет |
| `tdd` | Модель | Red-green-refactor, с интеграционными test-ами |
| `to-spec` | `/worfy:to-spec`, только вручную | Пишет spec из разговора в tracker |
| `to-tickets` | `/worfy:to-tickets`, только вручную | Режет план на Ticket-ы, у каждого свой `Blocked by` |
| `wayfinder` | `/worfy:wayfinder`, только вручную | Карта Ticket-ов-решений для работы больше одной Session, решаемых по одному |
| `grill-me` | `/worfy:grill-me`, только вручную | Допрос по плану, через `grilling` |
| `grilling` | Модель | Вопросы о плане, по одному |
| `handoff` | `/worfy:handoff`, только вручную | Сжимает разговор в документ для следующего агента |
| `teach` | `/worfy:teach`, только вручную | Учит теме внутри рабочей папки |
| `to-questionnaire` | `/worfy:to-questionnaire`, только вручную | Опросник для человека, который знает ответ |
| `wait-what` | `/worfy:wait-what`, только вручную | Повторяет последнее сообщение другими словами |
| `writing-for-agents` | Модель | Как писать skill-ы, `AGENTS.md` и `CLAUDE.md` |

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
  gate в `epic-wave` сохраняет свою глубину.
  Eco mode в меню Modes Orchestrator-а пишет это поле вместе с `agents`, моделью и effort каждой роли
  ([Orchestrator modes](orchestrator-modes.md#eco-mode)).
- `docs.feature_pages`: папка страниц, описывающих поведение. На шаге 5 `ship-ticket` изменение, которое меняет описанное там поведение,
  правит страницу в том же PR, а список файлов Ticket-а в `epic-wave` без такой страницы неполон. Без поля шаг пропускается, и агент
  говорит об этом.
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
  Skill, отмеченный «только вручную», задаёт `disable-model-invocation`, как это делает `harness/skills/overnight-fix-loop/SKILL.md`.
- Двадцать скопированных папок лежат плоско рядом с собственными папками worfy, под своими upstream именами.
  `harness/skills/THIRD_PARTY.md` держит их источник, список изменённых строк и способ, которым приходит новая версия;
  `harness/skills/LICENSE.mattpocock-skills` это upstream лицензия. `test/contract/harness-third-party-skills.test.ts` фиксирует sha256
  каждого скопированного файла, неизменённого или изменённого, и то, какие из них только вручную.
- `harness/skills/ship-ticket/` держит ещё `step-*.md`, `silent-mode.md`, `review-of-another-pr.md` и `pipeline-stages.md`, и файлы
  `implementer-*.md`, которые называет определение агента.
- `src/shared/projects/action-templates.ts` держит команды, которые отправляют действия worfy: `/worfy:ship-ticket`, `/worfy:epic-wave` и
  `/worfy:gate-queue`.

Главные test-ы: `harness/bin/tests/epic-wave-ship-ticket.test.sh`, `harness/bin/tests/skill-blocks.test.sh`,
`harness/bin/tests/review-depth.test.sh`, `harness/bin/tests/max-review.test.sh`, `harness/bin/tests/gate-queue.test.sh`,
`harness/bin/tests/silent-mode.test.sh`, `harness/bin/tests/skills-allowed.test.sh` и `test/contract/harness-third-party-skills.test.ts`.
Eval-ы проверяют `epic-wave`, `ship-ticket` и `product-ideas` (`harness/evals/product-ideas/`) по поведению.

## Agents

### Behaviour

Четыре агента одинаковы для каждого Project-а. Каждый начинает с запуска `profile`, на пути, который называет его brief.

| Агент | Модель, effort | Инструменты | Что пишет | Чем заканчивает |
|---|---|---|---|---|
| `worfy:implementer` | Наследуется, high | Все | Код и test-ы одного Ticket-а, в своём worktree или main checkout | Отчёт в JSON |
| `worfy:reviewer` | Наследуется, high | Read, Grep, Glob, Bash, `qmd` | Ничего не исправляет: сообщает, а исправляет implementer | Находки, не больше 30 строк |
| `worfy:scout` | sonnet, medium | Read, Grep, Glob, Bash, `qmd` | Только карту кода, вне репозитория | Ответ: где X, как работает Y, карта файлов |
| `worfy:critic` | opus, high | Read, Grep, Glob, Bash, WebSearch, WebFetch, Write | Один файл review, `critic/<epic>-<date>.md` в папке Product Session | Путь review и его вердикт, одной строкой |

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

- **Implementer's report**: первые символы ответа это `VERIFIED` или `REJECTED: <the unconfirmed claims>`. Тот, кто читает, сохраняет
  или публикует вердикт, всё равно берёт первую строку, которая начинается с `VERIFIED` или `REJECTED`, с жирным шрифтом или знаком
  заголовка перед ней или без них, и отбрасывает фразу над ней и эту разметку (`bin/verdict`, и то же правило в приложении); у ответа без
  такой строки вердикта нет. Grader eval-а остаётся строгим: он пропускает только голую строку.
- **Simplification**: что можно удалить, использовать повторно или упростить. Предложение, на которое нечем указать, не сообщается.
- **documentation**: меняет ли diff поведение, которое описывает страница из `docs.feature_pages`, не правя эту страницу. Фраза, которую
  изменение делает ложной, это `med`. Рефакторинг, поведение, которого нет ни на одной странице, и фраза, неверная ещё до diff, находками
  не считаются.

Остальные линзы, из `review.lenses`, читаются по именам. Для Ticket-а с UI нужны снимки в обеих темах.

**Scout.** На вопрос о коде он сначала читает карту кода. Отвечает, где X или как работает Y, или строит список файлов для Ticket-а. Не
правит файлы репозитория и не запускает stack.

**Critic.** Получает путь spec-а или плана и ищет возражения, а не причины согласиться. Вердикт или самооценка автора плана, в brief-е
или в плане, для него утверждение, которое он проверяет, и никогда не факт, на который он ссылается. Он пишет
`docs/product/critic/<epic>-<YYYY-MM-DD>.md` в Full mode и `<Workflow folder>/product/critic/<epic>-<YYYY-MM-DD>.md`, вне git, в Silent
mode (режим и папки берутся из `profile`, запущенного на репозитории: в Silent mode план лежит вне него), добавляя `-2`, `-3`, а не
записывая поверх прежнего review: вердикт `Keep`, `Reorder`, `Split` или `Defer` с одной фразой почему, не больше трёх возражений, одна
альтернатива и то, чего он не может знать (продуктовой аналитики нет). У каждого возражения есть строка `Fact:`, то есть `path:line`,
Ticket, PR или URL с тем, что там сказано, отдельная строка `Judgement:` с тем, какой вывод из этого делает critic, и пустая строка
`Owner decision:`, позже `accepted — <reason>` или `rejected — <reason>` по слову владельца; возражение без факта не пишется, а здоровый
план получает `Keep` без возражений. Метки полей остаются английскими, а текст пишется на `language.team`. Он не входит в роли выше: Eco
mode и `agents.<role>` не меняют его модель, а Codex его не получает.

**Начальный контекст.** Агент начинает со своего определения, общих правил из [Hooks](#hooks) и skill-а, который читает в начале.
`start-context` оценивает это из расчёта 2,7 байта на токен и выходит с кодом 1, когда части, которые пишет Harness, превышают 15 000
токенов для агента.

### How it works

- **Роли проверяют друг друга.** Утверждения implementer-а идут другому агенту, а reviewer-ов запускает Orchestrator. Implementer,
  который запустил бы reviewer-а, ждал бы вечно, потому что ответ идёт Orchestrator-у.
- **Параллельные reviewer-ы держат по одной линзе**, потому что пересечение лишает смысла параллельный запуск.
- **Карта до кода.** Scout повторно использует карту кода, а `code-map stale` перечисляет папки, файлы которых изменились после их commit-а.

### Implementation

- `harness/agents/implementer.md`, `harness/agents/reviewer.md`, `harness/agents/scout.md` и `harness/agents/critic.md` это определения.
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
| `SessionStart` | `inject-rules.mjs orchestrator` | 10 | Правила главной Session; в Product Session ничего |
| `SessionStart` | `inject-rules.mjs common` | 10 | Общие правила и правила пользователя |
| `SessionStart` | `inject-rules.mjs product` | 10 | Правила Product Session; в любой другой Session ничего |
| `SessionStart` | `session-start.mjs` | 15 | Контекст Project-а |
| `SessionStart` на `compact` | `after-compact.mjs` | 30 | После compaction — состояние работы из файлов: `wave-brief` Epic-а в main checkout, файл Ticket-а и `git status --short` в worktree implementer-а. Ничего в начале Session, вне Project-а, который ведёт Ticket-ы, и без Ticket-а или Epic-а |
| `SessionStart` | `gh-token-env.mjs` | 10 | `GH_TOKEN` аккаунта Project-а |
| `SessionStart` | `worktree-lock claim` | 10 | Регистрируется в дереве и говорит, кто там уже есть; раз в сутки удаляет файлы registry удалённых деревьев |
| `SubagentStart` | `inject-rules.mjs common` | 10 | Общие правила и правила пользователя |
| `PreCompact` | `inject-rules.mjs compaction` | 10 | Инструкции для итога compaction, простым текстом, в главной Session и в Subagent-е; в Codex ничего |
| `UserPromptSubmit` | `stage-lines.mjs` | 10 | В Project-е, который ведёт Ticket-ы, строки `epic-status` Epic-ов в работе для строки Stage в блоке статуса: Epic текущей ветки (его строка называет ветку), затем Epic-и с занятым Ticket-ом, затем Epic-и локальных веток Ticket-ов, сначала новые, чей Ticket не done; не больше трёх строк. Если ничего из этого нет — Epic-и, которые не закрыты, причём те, чей следующий Ticket заблокирован, идут последними. Ничего в Product Session и для Subagent-а. Когда `bin/profile` или `epic-status` падает или идёт дольше 2,5 с — ничего и одна строка в stderr; медленный процесс убивается |
| `PreToolUse` на `Bash\|apply_patch` | `guard.mjs` | 30 | Bash guard. `apply_patch` это правка файла в Codex, которой у Claude Code нет: в Codex guard отказывает в ней `worfy-reviewer` и `worfy-scout` |
| `PostToolUse`, `PostToolUseFailure` | `calls.mjs` | 5 | Log вызовов, только запись: агент ничего не видит, и его вызов не задерживается. Хранит последние 20 вызовов каждого агента (tool, hash входа, исход) в `<gate state>/calls/<owner>.jsonl`, где owner — Session или Session и `agent_id` Subagent-а. Когда агент повторяет тот же упавший вызов, правит файл туда и обратно или повторяет пару вызовов, он на 3-м повторе дописывает `would-hint`, а на 4-м `would-deny` в `calls/loops.jsonl` с началом команды; ожидания CI (`gh pr checks`, `gh run watch`, `gh run view`) не считаются. `bin/loop-log [--since <YYYY-MM-DD>]` печатает случаи `would-deny` с их Vendor и `cases: N (revisit at 3)`. Log-и старше 7 дней удаляются; `loops.jsonl` хранит свои последние 2000 строк. В Codex его тоже запускает `PostToolUse` (исход shell-вызова там — его вывод, без exit code, и сбоем он не считается, поэтому повтор shell-вызова там случая не даёт; `apply_patch` несёт exit code и считается); `PostToolUseFailure` есть только у Claude Code |
| `TaskCompleted`, `TeammateIdle` | `gate.sh fast` | 900 | [Gate](gate-and-github.md) |
| `Stop` | `stop.mjs` | 900 | Держит ход, пока Gate красный, см. [Gate](gate-and-github.md). Под Claude Code проверок не запускает, и лимит только потолок; в Codex сначала запускает Gate, кроме main checkout Project-а |
| `SubagentStop` | `stop.mjs` | 900 | Под Claude Code ничего не делает. В Codex запускает Gate и так же держит ход Subagent-а, в main checkout тоже |
| `Stop` | `worktree-lock beat` | 5 | Отмечает Session живой |
| `Stop` | `qmd-refresh --quiet` | 15 | Обновляет индекс в фоне, если главная ветка сдвинулась или файл memory либо lessons новее последнего обновления. Когда qmd не может работать (нет qmd, слишком старый для него node), завершается с exit code 0, не обновляет индекс и пишет причину в log не чаще раза в сутки |
| `SessionEnd` | `worktree-lock release` | 5 | Снимает регистрацию |

**Сломанный hook не ломает Session.** Сбой внутри `inject-rules.mjs`, `session-start.mjs`, `stage-lines.mjs`, `after-compact.mjs`,
`gh-token-env.mjs` или `stop.mjs` это одна строка в stderr и код 0, а worktree lock и log вызовов `calls.mjs` падают молча. Gate даёт
вердикт через exit code, а `stop.mjs` держит ход с кодом 2. Guard выходит с кодом 0 и отказывает через свой ответ.

**Правила.** `orchestrator` доходит до главной Session, а `common` до главной Session и каждого Subagent-а. В `orchestrator` основной цикл,
делегирование и отчёт. В `common` простой язык, доказательство перед «зелёным», гигиена контекста и shell-команды, которым нужно
подтверждение человека. Claude Code обрезает такой текст до превью выше 10 000 символов, поэтому `common` с правилами пользователя держится
в этом пределе: более длинный файл правил обрезается после целой строки, а заключительная строка называет файл. Файл, который нельзя
прочитать, стоит одной строки в stderr, и часть приходит без него. `common` говорит ещё, что делать после compaction: перечитать Ticket
(Orchestrator запускает `epic-status` своего Epic-а) и `git status` перед следующим шагом.

**Compaction.** Когда Claude Code сжимает контекст (compaction), по `/compact` и при автоматической compaction, в главной Session и в
Subagent-е, часть `compaction` (`harness/hooks/rules/compaction.md`) добавляется к инструкциям модели, которая пишет итог. Она просит семь
разделов: Intent, Essential facts, Completed work, Files touched, Errors, Pending work и Next action. Она называет, что сохраняет каждая
роль. Orchestrator сохраняет Epic, номер Wave, PR в работе и решения, принятые без владельца. Implementer сохраняет свой Ticket, каждый
пункт раздела «Готово, когда» Ticket-а с его отметкой, worktree и ветку. Hook не может отличить Subagent от главной Session, поэтому один текст
держит все роли, а модель итога выбирает по разговору. Это простой текст, а не `additionalContext`, и Claude Code обрезает его после
10 000 символов. Codex этот вывод не читает.

**Состояние после compaction.** Claude Code и Codex после compaction снова запускают hook-и `SessionStart` Session, с источником
`compact`, и `after-compact.mjs` работает только тогда. Он передаёт агенту его состояние из файлов, что бы ни сохранил итог. Вход hook-а не
говорит, был ли сжат Subagent, поэтому решает папка работы:

| Где | Что приходит |
|---|---|
| Связанный worktree, чья ветка принадлежит Ticket-у (форма ветки из Profile или строка `Branch:` Ticket-а в Silent mode) | Ticket, worktree и ветка, `git status --short` worktree (не больше 50 строк), затем файл Ticket-а |
| Main checkout | `wave-brief <epic>`: его начало со строкой Stage, затем Ticket-ы в работе (`Waiting`) и открытые PR, затем остальное. Epic это `WORFY_EPIC`, когда Ticket этого Epic-а существует, иначе Epic ветки checkout-а, иначе первый из Epic-ов в работе в том порядке, в каком их ставит `stage-lines.mjs` |

Текст держится в пределах 10 000 символов, а в Codex ещё и 10 000 байт, потому что Codex переносит более длинный контекст в файл. Более
длинный текст обрезается после целой строки, а его последняя строка называет команду или файл с полным текстом. Когда `wave-brief`
падает, Orchestrator получает одну строку, которая просит его запустить `wave-brief` самому. Hook молчит в Product Session, в папке, которая
не принадлежит Project-у, ведущему Ticket-ы, в worktree без своего Ticket-а (у reviewer-а) и в main checkout без Epic-а.

**Контекст Project-а.** Он пуст для папки вне зарегистрированного Project-а и для Project-а, который ничего не просит:

| Что добавляется | Когда |
|---|---|
| Где лежат файлы workflow и что ветки, commit-ы и PR не несут следов workflow | Silent mode |
| Что commit-ы и PR не несут строк атрибуции Claude | `attribution: off` |
| Правила Project-а без раздела источников, индекс уроков, когда уроки лежат в Profile, карта активного Epic-а | `session.inject_rules: true` |

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
| Следы workflow | В Silent mode или с `attribution: off`: текст и staged changes команды `git commit`, имя новой ветки, текст `gh pr create`, `edit`, `comment`, `review` или `merge` и текст, который запись через `gh api` отправляет в PR или issue (новый PR или issue, его заголовок и описание, комментарий, ответ, review, отклонение review, merge), или мутация GraphQL, когда `silent-check` их отвергает. Файл, который отправляет такая команда `gh api` и который guard не может прочитать, тоже получает отказ: запишите файл одной командой и отправьте его следующей |

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
- `harness/hooks/inject-rules.mjs` с `harness/hooks/rules/orchestrator.md`, `harness/hooks/rules/common.md`,
  `harness/hooks/rules/product.md` и `harness/hooks/rules/compaction.md`. На `PreCompact` он печатает часть простым текстом, а когда вход
  пришёл от Codex, ничего. Product Session это та, в окружении которой есть `WORFY_SESSION_KIND=product`; worfy задаёт его, когда её
  запускает.
- `harness/hooks/session-start.mjs`, который спрашивает Project у `bin/profile`. Profile ещё может нести удалённое поле
  `session.retro_reminder_after`: оно игнорируется, а оставшийся с тех пор `state/pending-retro.log` не читается.
- `harness/hooks/stage-lines.mjs`, который спрашивает у `bin/profile`, ведёт ли Project Ticket-ы и как называются его ветки, перечисляет
  локальные ветки через git и запускает `bin/epic-status` параллельно для строк, состояний Ticket-ов и строки Epic-а текущей ветки.
- `harness/hooks/after-compact.mjs`, который спрашивает у `bin/profile`, ведёт ли Project Ticket-ы, у git — worktree и его ветку, а у
  `bin/epic-status` — Ticket-ы и Epic-и. В main checkout без `WORFY_EPIC` или ветки Ticket-а он запускает
  `harness/hooks/stage-lines.mjs` для Epic-ов в работе. Затем он запускает `bin/ticket root` или `bin/wave-brief`.
- `harness/hooks/gh-token-env.mjs`, `harness/hooks/guard.mjs` (с `harness/bin/silent-check`) и `harness/bin/worktree-lock`, чей registry это
  `worktree-sessions/` в Harness home. Файл оттуда уходит, когда в нём нет записей или когда не существует ни одной папки дерева, которые
  называют его записи; `worktree-lock prune` удаляет их сразу.
- `harness/hooks/stop.mjs`, `harness/hooks/gate.mjs`, `harness/hooks/gate.sh` и модули рядом: см. [Gate](gate-and-github.md).
- `harness/hooks/eval-env.cjs` даёт скриптам их git и папку состояния, с переменными запуска eval.
- `harness/hooks/worktree-create.sh` это черновик, и `harness/hooks/hooks.json` его не запускает.

Главные test-ы, все shell: `harness/hooks/tests/rules-hooks.test.sh`, `harness/hooks/tests/session-hooks.test.sh`,
`harness/hooks/tests/gh-token-env.test.sh`, `harness/hooks/tests/guard-silent.test.sh` и `harness/bin/tests/harness-home.test.sh`. Eval
`harness/evals/status-block/` по поведению проверяет, что главная Session следует правилам. Eval `harness/evals/compaction-state/` после
compaction задаёт implementer-у шесть вопросов — его цель, Ticket, пункты «Готово, когда», файлы, решения и следующий шаг — с `compaction.md` и
`after-compact.mjs` и, в копии Harness, которую делает `baseline.mjs`, без них. Кейс сжимает свою историю до первого ответа только с
`CLAUDE_CODE_AUTO_COMPACT_WINDOW=100000` (окно контекста в токенах, от которого считает автоматическая compaction) и
`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=5` (сжимать на 5 % от него). Кейс может задавать только переменные `EVAL_*`, поэтому
`scripts/eval-harness.mjs` задаёт эти две в вызове этого кейса и убирает их из всех остальных вызовов. Кейс несёт тег `alone`: он
запускается только через `pnpm eval:harness -- --case compaction-state`, а общий запуск или `--changed` его пропускает со строкой о том,
как его запустить. Вариант без hook-а:
`HARNESS_DIR="$(node harness/evals/compaction-state/baseline.mjs)" pnpm eval:harness -- --case compaction-state`; его результаты идут в
`evals/results/` этой копии, которую удалять вам. Без compaction grader `compacted` сам по себе проваливает кейс.
