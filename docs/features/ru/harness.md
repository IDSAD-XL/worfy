# Harness

> Перевод [английской версии](../harness.md), commit `same-pr`.

Два Feature. **Installing from the app** ставит Harness на Machine. **Plugin** это то, что ставится: скрипты, Profile для
каждого Project-а и поиск по документам. Части plugin-а, которые действуют, описаны на отдельной странице,
[Skills, agents and hooks](skills-agents-and-hooks.md). Термины объяснены в [Concepts](concepts.md). У Gate есть
[своя страница](gate-and-github.md).

## Installing from the app

### Behaviour

Каждая сборка worfy несёт копию Harness и ставит её как plugin Claude Code `worfy`, в user scope. Harness home это папка
Harness на Machine, по умолчанию `worfy-harness` внутри Claude home, а копия ложится в её папку `plugin`. Установку
предлагают три места: пункт Harness в toolbar, проверки [First run](onboarding.md) и Settings → Pipeline, когда у Harness нет
скрипта для редактора Pipeline. Все три используют один installer. Второй запрос во время установки получает тот же запуск, а
установка, которая могла что-то изменить, доходит до каждого окна.

**Пункт в toolbar.** Это последний пункт toolbar. Во второй его строке версия приложения и собственная память worfy
([Storage and diagnostics](storage-and-diagnostics.md)).

| Состояние | Текст | Кнопка-иконка | Когда |
|---|---|---|---|
| Не установлен | `Harness not installed` | Install | Папки plugin нет, или Claude Code не показывает plugin в списке |
| Установлен | `Harness <version>` | Нет | Копия и plugin в списке Claude Code имеют версию этой сборки |
| Выключен | `Harness <version> · disabled` | Нет | То же, и plugin выключен в Claude Code |
| Другая версия | `Harness <from>` | Update Harness | Установлена другая версия. Tooltip говорит `<from> → <to>` |
| Та же версия | `Harness <from>` | Replace Harness | Тот же semver из другого commit-а, см. ниже |
| Ошибка | `Harness error: <step>` | Retry | Шаг упал, Claude Code сообщает, что plugin сломан, или нет зависимости. Причина в tooltip |
| Идёт установка | `Installing Harness…` | Нет | Во время установки, начатой из этого пункта |
| Нет ответа | `Harness unavailable` | Нет | Вызов main process упал. Причина в tooltip |

Запуск, которому нельзя устанавливать, показывает состояние без кнопки, и две строки о другой версии тогда называют обе версии:
`Harness <from> → <to>` и `Harness <from>, this build <to>`. Устанавливать может только упакованное приложение или запуск с
`WORFY_CLAUDE_HOME`, потому что development-сборка на настоящем Claude home заменила бы Harness, на котором работают терминал и
Stable copy.

**Что делает установка.** Сначала читает, потом спрашивает, потом пишет. Когда делать нечего, диалога нет. Иначе нативный диалог
называет каждую команду до запуска, в порядке запуска:

1. Для каждой отсутствующей зависимости plugin-а: `claude plugin marketplace add anthropics/claude-plugins-official`, когда
   Claude Code не знает этот marketplace, затем `claude plugin install <name>@claude-plugins-official --scope user`. Plugin-у
   нужен `mattpocock-skills@claude-plugins-official`, и Claude Code скачивает его с GitHub. worfy ставит зависимости только из
   этого marketplace: отсутствующая зависимость из другого даёт ошибку, которая просит пользователя поставить её самому.
2. Копия этой сборки ложится в папку plugin и заменяет то, что там есть. Шаг пропускается, когда в папке уже версия этой сборки.
3. При первой установке: `claude plugin marketplace add <plugin folder>`, затем `claude plugin install worfy@worfy-harness
   --scope user`. При другой версии: `claude plugin update worfy@worfy-harness --scope user`.

Кнопка называется Install, Update или Replace, а Cancel ничего не пишет. Диалог, который копирует, ещё предупреждает: у сессий
Claude Code, уже запущенных в терминале, файлы меняются на ходу, и их нужно перезапустить. Пока старый Harness лежит в
`~/.claude`, диалог предупреждает, что сессии в терминале запускают и его hooks, и hooks plugin-а. Команде даётся 120 с, а
команде, которая ставит зависимость, 600 с.

**Чем кончается неудачная установка.** Установка кончается состоянием «установлен» или «не установлен», но не на полпути:

| Что упало | Что остаётся | Шаг ошибки |
|---|---|---|
| Команда для зависимости | Копии Harness нет, ни одна команда для `worfy` не запускалась | `dependency marketplace add`, `dependency install` |
| Копирование | Прежняя папка plugin как была | `copy` |
| `marketplace add` для копии | Claude Code не показывает `worfy` в списке | `marketplace add` |
| Первый `plugin install` | worfy читает список заново и удаляет запись, которую оставила команда | `install` |
| Удаление этой записи | Причина называет оба сбоя | `uninstall` |
| `plugin update` | Ничего не удаляется, а в папке уже новая копия | `update` |
| Чтение списка, или нет бинарника Claude Code | Ничего не записано | `plugin list` |

Ответ, что официальный marketplace уже добавлен, не считается сбоем при любом exit code. Retry заново читает состояние и
запускает то, что осталось, включая отсутствующую зависимость. Plugin, установленный без зависимости, тоже считается ошибкой,
потому что Claude Code тогда не загружает из него ничего.

**Старая сборка не заменяет более новый Harness.** Версия выглядит как `<semver>+<short SHA>`, с `.dirty` на конце у сборки с
незакоммиченными изменениями. Порядок есть только у части semver. Сравниваются и копия в папке, и версия из списка Claude Code,
потому что они расходятся после неудачного `plugin update`.

| Установленная версия относительно этой сборки | Результат |
|---|---|
| Та же строка | Для plugin-а делать нечего |
| Меньший semver | Update, через диалог |
| Тот же semver из другого commit-а, или одна из двух `.dirty` | Replace, через диалог, который говорит, что worfy не может определить, какая новее |
| Больший semver, или не версия сборки | Отказ: ошибка шага `copy`, без диалога, копирования и команд. Причина называет выход: открыть сборку, которая это установила, или удалить папку вручную и нажать Install |

Когда папка удалена вручную, диалог говорит, что ставит более старый Harness. Копия, которую отложила прерванная установка, для
этого сравнения считается установленной.

**Перенос старого Harness.** До plugin-а Harness лежал прямо в `~/.claude`. Пока от него там что-то осталось и запуску можно
устанавливать, toolbar показывает иконку "Move old Harness…", а строка First run предлагает "Move…". В форме "Move the old
Harness out of ~/.claude" по строке на каждую вещь:

| Группа | Выбор |
|---|---|
| Файлы Harness | Remove, Keep |
| Разделы CLAUDE.md, показаны как diff | Remove, Keep |
| Hooks в settings.json | Remove, Keep |
| Status line | Replace, Keep |
| qmd: скрипты, hook и запись MCP вместе | Remove, Keep |
| Состояние Machine | Move, Keep |
| Profile-ы, каждый со своими полями и diff-ом | Move, Keep |

Строка, которую нельзя убрать, предлагает только Keep и говорит почему. То, чего нет в форме, остаётся в `~/.claude`. Move
неактивна, и форма говорит почему, пока plugin не установлен, не включён и не той же версии, что сборка.

После диалога согласия всё, что перенос забирает или меняет, копируется в папку `backup-<date>` в Harness home, и только потом
идут шаги. Упавший шаг отменяет перенос и называется в форме. После переноса форма показывает backup и одну команду отмены,
`node <backup>/restore.mjs`. Этой команде не нужны ни worfy, ни plugin, и она первым делом выключает plugin. То, что изменилось
после переноса, она сохраняет в папке `after` внутри backup, а второй запуск ничего не меняет. Уже запущенные Session-ы держат
старые hooks до перезапуска.

#### On Windows

Переименование или удаление папок plugin, которое отклоняет открытый кем-то файл, повторяется до 60 с: при `EPERM`, `EBUSY` или
`EACCES`, а при удалении ещё и при `ENOTEMPTY`, с паузами от 0 до 100 мс. Возврату прежней копии и удалению промежуточной папки
после сбоя даётся по 10 с, так что худший сбой занимает около 80 с. Если новая копия на месте, а прежнюю удалить нельзя,
установка идёт дальше, и эту папку удаляет следующая установка. Вне Windows те же ошибки не повторяются.

#### On a Linked machine

Linked machine не может отсюда начать установку или перенос: каналы обоих локальные. Пункт и форма описывают Machine, окно которой
их показывает. "Add project" для папки на Linked machine говорит, что Harness настраивается на самой этой Machine.

### How it works

- **Копия это сразу marketplace и plugin.** Её marketplace называет plugin по пути `./`
  ([ADR-0040](../../adr/0040-harness-delivery-local-marketplace.md), [ADR-0048](../../adr/0048-harness-plugin-spike-results.md)).
- **Два автора записи.** Сам worfy при установке пишет только папку plugin, через промежуточную папку рядом, которая
  переименовывается на место. Собственные команды Claude Code пишут `settings.json` и его папку plugin-ов. Они запускаются
  бинарником Claude Code из SDK, а не `claude` пользователя ([ADR-0008](../../adr/0008-claude-code-native-binary-path.md)).
- **Второй `install` не меняет версию**, поэтому другая версия идёт через `update`.
- **Зависимость идёт первой**, потому что `plugin install` без неё проходит успешно, а plugin потом не загружается
  ([ADR-0059](../../adr/0059-installer-installs-plugin-dependencies.md)).
- **Какой Harness на Machine, проверяется при каждом вызове**, поэтому для переключения не нужен перезапуск. Старый Harness
  выигрывает, пока его `bin/epic-status` лежит в Claude home, потому что его hooks всё ещё записаны в `settings.json`
  ([ADR-0049](../../adr/0049-worfy-sessions-without-inline-plugin-on-legacy-harness.md)). Поэтому перенос удаляет этот файл последним.
- **Чтение ничего не пишет.** Без папки plugin чтение состояния не запускает команд, а зависимость показана как непроверенная.

### Implementation

| Модуль | Роль |
|---|---|
| `electron.vite.config.ts` | Копирует `harness/` в `out/harness` при каждой сборке main, без `bin/tests`, `hooks/tests`, `evals` и `evals-outcome`, и пишет версию из `scripts/build-version.ts` в manifest копии |
| `electron-builder.yml` | Кладёт копию в resources приложения, вне `app.asar`, потому что скрипт внутри него запустить нельзя |
| `src/main/harness/bundled.ts` | Находит копию и её версию |
| `src/main/harness/install.ts` | Installer: состояние, план, порядок версий, текст диалога, замена папки |
| `src/main/harness/locate.ts` | Какой Harness на Machine (`plugin`, `legacy`, `none`), папки его скриптов и состояния Gate |
| `src/main/ipc/harness.ts` | Единственный installer приложения и диалог согласия. Объявляет `harness.changed` |
| `src/shared/ipc/harness.ts` | Каналы и состояния |
| `src/renderer/shell/toolbar/HarnessStatus.tsx` | Пункт toolbar, который показывает и `src/renderer/settings/PipelineSection.tsx` |
| `src/main/first-run/actions.ts` | Запускает тот же installer из First run |
| `src/main/harness/migrate/plan.ts` | Строки формы переноса, прочитанные с диска. Ничего не пишет |
| `src/main/harness/migrate/apply.ts` | Перенос по шагам: backup, settings, `.claude.json`, CLAUDE.md, state, files, `bin/epic-status`, commit |
| `src/main/harness/migrate/restore.ts` | Manifest и `restore.mjs` |
| `src/main/harness/migrate/profiles.ts` | Profile-ы схемы 1 становятся схемой 2 |
| `src/main/ipc/harness-migration.ts`, `src/shared/ipc/harness-migration.ts`, `src/renderer/harness/MigrationForm.tsx` | Предложение и диалог переноса, его каналы и форма |

Каждый путь, который перенос пишет или удаляет, проверяется: он должен быть внутри Claude home или Harness home, а `.claude.json`
единственный файл вне их.

Главные test-ы: `test/contract/harness-install.test.ts`, с подставным Claude Code и сбоями, внесёнными в копирование и
переименования. `test/e2e/harness-install.spec.ts` и `test/e2e/harness-migrate.spec.ts` идут через toolbar. Также
`test/contract/harness-changed.test.ts`, `test/contract/harness-migrate.test.ts`, `test/unit/harness-locate.test.ts`,
`test/unit/harness-status.test.tsx` и `test/unit/harness-migration-form.test.tsx`.

## Plugin

### Behaviour

Plugin `worfy` приходит из marketplace `worfy-harness`, а его skills и агенты несут префикс `worfy:`, как в `/worfy:epic-wave` и
`worfy:implementer`.

| Часть | Что в ней |
|---|---|
| Агенты | Три роли, см. [Agents](skills-agents-and-hooks.md#agents) |
| Skills | Десять процедур, см. [Skills](skills-agents-and-hooks.md#skills) |
| Hooks | Команды, которые Claude Code запускает на свои события, и тексты правил, см. [Hooks](skills-agents-and-hooks.md#hooks) |
| Скрипты | 20 программ ниже |
| Контракт Profile | Описание Profile и схема его черновика |
| MCP server | `qmd`, поиск по документам |

**Какую копию запускает Session.**

| Session | Старый Harness в `~/.claude` | Что запускает |
|---|---|---|
| Запущена worfy | Нет | Копию этой сборки, переданную inline. Она заменяет установленный plugin с тем же именем и не нуждается в нём |
| Запущена worfy | Да | Без plugin-а, чтобы старые hooks не сработали дважды |
| Запущена в терминале | Нет | Установленный plugin |
| Запущена в терминале | Да | Старые hooks, и hooks plugin-а тоже, когда он установлен |

Так что без старого Harness Session в worfy соответствует своей сборке, а сессия в терминале меняется только с установкой. Session
в Project-е, у которого в Profile есть `skills.allowed`, теряет остальные plugin-ы и skills пользователя и сохраняет `worfy`
([Sessions](sessions.md)).

**Profile.** Первое действие агента это запуск `profile`, и дальше агент следует тому, что тот напечатал: команды, пути Ticket-ов,
режим параллельной работы, финиш, нумерация, документы и свободный текст правил Project-а. Profile никогда не лежит в репозитории.
Скрипт находит Project по папке, в том числе по worktree в любом месте диска. Его exit code решает, что делает агент:

| Код | Значение | Агент |
|---|---|---|
| 0 | Profile найден | Работает по нему |
| 1 | Сломан registry, resolver или файл Profile | Не угадывает команды. Implementer останавливается и сообщает об этом. Scout и reviewer сначала пишут код и работают без Profile |
| 2 | Ошибка вызова, например несуществующий путь | То же |
| 3 | Project не зарегистрирован или без Profile | То же |
| 4 | С `--field`: поля нет | Пропускает шаг, который от него зависит |

**User personalization.** Два необязательных файла в Harness home, написанные вручную, которые Harness только читает: один задаёт
язык отчётов, и он важнее значения в Profile, другой держит собственные правила пользователя для каждой Session и каждого Subagent-а
(см. [Hooks](skills-agents-and-hooks.md#hooks)).

**Скрипты.**

| Скрипт | Что делает |
|---|---|
| `profile` | Печатает Profile папки, целиком или одно поле |
| `profile-set` | Пишет Pipeline или `workflow.agents` и `agents`. Больше ничего |
| `project-connect` | Пишет или удаляет Profile и записи registry для Project-а |
| `ticket` | Единственный автор строк статуса Ticket-а. Также пишет отметки |
| `epic-status` | Строка Stage для Epic-а, или все Ticket-ы как JSON |
| `epic-board` | Снимок всех Epic-ов и Ticket-ов на одной странице |
| `preflight` | Проверка перед Ticket-ом или Wave. Последняя строка это `GO` или `BLOCKED: <reasons>`, и он печатает следующие свободные номера ADR и миграций |
| `wave-gate` | Один Gate full на набор готовых PR одной Wave, затем их merge |
| `land` | Вливает готовые PR по одному и закрывает их Ticket-ы в одном PR с документами |
| `wave-brief` | Короткая сводка по Wave-ам Epic-а, которую новый Orchestrator читает первой. Только чтение |
| `decision-log` | Добавляет одно решение в журнал Wave, которая идёт без человека |
| `silent-check` | Ищет следы workflow в тексте или diff, см. [Full mode and Silent mode](projects.md) |
| `shortcut-ledger` | Перечисляет комментарии `shortcut:` рабочего дерева, по строке на каждый |
| `code-map` | Карта кода репозитория, рядом с Profile, с commit-ом на каждую папку |
| `worktree-lock` | Рекомендательная блокировка рабочего дерева, см. [Hooks](skills-agents-and-hooks.md#hooks) |
| `start-context` | Оценивает начальный контекст каждого агента в токенах, см. [Agents](skills-agents-and-hooks.md#agents) |
| `qmd-mcp` | Запускает MCP server |
| `qmd-refresh` | Обновляет индекс, когда главная ветка сдвинулась |
| `qmd-sync-main` | Подтягивает копию главной ветки Project-а, которую читает индекс |
| `qmd-collections` | Добавляет три коллекции Project-а в индекс и называет их в его Profile |

**qmd.** MCP server запускается только после того, как пользователь согласился на модели. Иначе он останавливается с сообщением, и
агенты ищут через grep по `qmd.fallback_grep` из Profile. Один индекс обслуживает все Project-ы и может отставать: агенты сверяют
найденное с рабочим деревом. Установка qmd и его моделей это действие [First run](onboarding.md). Для своих Session-ов worfy
регистрирует server сам, под именем, которое инструменты носят в сессии в терминале (`mcp__plugin_worfy_qmd__…`), а `mcp.allowed` из
Profile фильтрует его как любой другой server.

**Текст.** Plugin написан по-английски, кроме слов других языков, которые его скрипты должны читать в Ticket-ах людей. Test следит,
чтобы в его файлах не было имён, аккаунтов и домашних путей одного человека, рабочих проектов и номеров решений, Ticket-ов и Wave
самого worfy.

#### On Windows

worfy запускает Node-скрипт Harness как `node <script>`. На Windows скрипт старого Harness, который не является Node-скриптом,
отклоняется с просьбой обновить Harness. Большинство команд hooks тоже называют `node`, а текст правил показывает корень plugin-а как
`C:/…`. Запуск Gate на Windows описан на [странице Gate](gate-and-github.md).

#### On a Linked machine

На Machine один Harness, и его Profile-ы остаются на ней. Project на Linked machine использует Harness этой Machine.

### How it works

- **Один Harness, много Project-ов.** Harness это plugin Claude Code ([ADR-0019](../../adr/0019-harness-claude-code-plugin.md)). Skill,
  hook или агент, которому нужен факт о проекте, читает его из Profile и не хранит у себя. worfy меняет состояние workflow только
  через эти же скрипты ([ADR-0002](../../adr/0002-worfy-is-a-view-over-the-workflow.md)).
- **Plugin нейтрален.** Язык и другие выборы одного человека относятся к User personalization или Profile, а не к plugin-у
  ([ADR-0074](../../adr/0074-harness-neutral-by-language-and-project.md)).
- **qmd часть Harness**, а его версия закреплена, потому что скрипты на неё рассчитывают
  ([ADR-0043](../../adr/0043-qmd-is-part-of-harness.md)).
- **Скрипт получает окружение login shell**, а не окружение самого worfy, потому что у приложения, запущенного из Finder, нет node в
  PATH ([ADR-0007](../../adr/0007-claude-code-launch-environment.md)). Для plugin-а worfy добавляет `HARNESS_HOME`.

### Implementation

- `harness/.claude-plugin/plugin.json` и `harness/.claude-plugin/marketplace.json` это manifest-ы. В исходнике нет `version`: её пишет
  сборка. `harness/.mcp.json` называет server.
- `harness/bin/` держит скрипты, с глоссарием Ticket-ов в `harness/bin/TICKETS.md`. `harness/lib/` держит то, что у них общее: правила
  Pipeline в `harness/lib/pipeline.cjs` и слова других языков в `harness/lib/input-words.json`.
- `harness/profiles/README.md` это контракт Profile, а `harness/profiles/draft.schema.json` схема черновика.
- В Harness home: `projects/<name>/` держит Profile (`profile.json`, `rules.md`), `gate/config.json` registry, `user.json` язык и
  `user/rules.md` правила пользователя.
- `harness/README.md` описывает папку, её test-ы и eval-ы.
- В приложении: `src/main/agent/options.ts` передаёт копию inline и регистрирует её server-ы, с папкой из
  `src/main/agent/app-registry.ts`. `src/main/workflow/profile.ts` запускает скрипты с окружением из
  `src/main/harness/script-env.ts`. `src/main/harness/attribution.ts` держит значение `attribution` по умолчанию, а
  `src/main/harness/qmd.ts` ставит qmd и его модели.

Главные test-ы: `harness/bin/tests/` и `harness/hooks/tests/` это shell-test-ы, которые `pnpm test` запускает через
`test/contract/harness-scripts-1.test.ts` … `test/contract/harness-scripts-4.test.ts`. `harness/bin/tests/plugin-neutral.test.sh` это
test текста, о котором сказано выше. `test/contract/harness-plugin.test.ts` закрепляет manifest и не пускает в `harness/` то, что не
относится к Harness. Также `test/contract/harness-qmd.test.ts`, `test/contract/harness-script-env.test.ts`,
`test/contract/harness-script-command.test.ts` и `test/unit/agent-options.test.ts`.

Eval-ы делают платные вызовы модели, и CI с Gate их не запускают. `harness/evals/` держит десять случаев `claude plugin eval`, которые по
поведению проверяют, что Claude следует правилам (`pnpm eval:harness`), а `harness/evals-outcome/` держит задачи для
`pnpm eval:outcome`. `test/contract/harness-evals.test.ts` бесплатно проверяет, что каждый случай полон.
