# Harness

> Перевод [английской версии](../harness.md), commit `same-pr`.

Два Feature. **Installing from the app** ставит Harness на Machine. **Plugin** это то, что ставится: скрипты, Profile для
каждого Project-а и поиск по документам. Части plugin-а, которые действуют, описаны на отдельной странице,
[Skills, agents and hooks](skills-agents-and-hooks.md). Термины объяснены в [Concepts](concepts.md). У Gate есть
[своя страница](gate-and-github.md).

## Installing from the app

### Behaviour

Каждая сборка worfy несёт копию Harness и ставит её как plugin Claude Code `worfy`, в user scope, а также в Codex, когда
Codex есть на Machine (см. [In Codex](#in-codex)).
Harness home это папка Harness на Machine, по умолчанию `worfy-harness` внутри Claude home, а копия ложится в её папку
`plugin`. Установку предлагают три места: строка Harness в version popover-е footer-а, проверки [First run](onboarding.md) и Settings →
Pipeline, когда у Harness нет скрипта для редактора Pipeline. Все три используют один installer. Второй запрос во время
установки получает тот же запуск, а установка, которая могла что-то изменить, доходит до каждого окна.

**Version chip.** Состояние Harness — в version chip-е на правом конце footer-а ([App shell](app-shell.md#footer)):
версия приложения `v<major>.<minor>.<N>` с номером сборки ([Settings → General → Version](app-shell.md#settings)) или
`v<semver>+<short SHA>` для сборки без номера, и одна точка. Точка красная, пока Harness нужен пользователь: "Harness
unavailable", Harness не установлен или сломан и этот запуск может его установить (Install, Retry), или старый Harness
нужно перенести. Точка янтарная, пока ждёт обновление: [Update](updates.md) worfy, "Update Harness", plugin, выключенный
в Claude Code (Enable), или строка Codex с кнопкой или `Codex: approve hooks`. Красная идёт раньше янтарной; когда делать
нечего, точки нет. Accessible name chip-а и первая строка его tooltip-а говорят, о чём точка, например
`worfy v<version> — Harness needs Install`.
Нажатие на chip открывает над ним popover; Esc или нажатие снаружи его закрывает. Строки popover-а: версия приложения с
действиями Update, строка Harness с кнопками-иконками, строка Codex с её кнопкой, когда ей есть что сказать (см. [In
Codex](#in-codex) ниже), и собственная память worfy, пока Settings → General её показывает ([Storage and
diagnostics](storage-and-diagnostics.md)). Строка, слишком длинная для popover-а, кончается многоточием, а строка Harness
хранит весь свой текст в tooltip-е. Диалог согласия, форма переноса и шаг "Approve the Harness hooks in Codex"
открываются из popover-а, а шаг по-прежнему открывается сам, пока popover закрыт.

| Состояние | Текст | Кнопка-иконка | Когда |
|---|---|---|---|
| Не установлен | `Harness not installed` | Install | Папки plugin нет, или Claude Code не показывает plugin в списке |
| Установлен | `Harness <version>` | Нет | Копия и plugin в списке Claude Code имеют версию этой сборки |
| Выключен | `Harness <version> · disabled` | Enable, с акцентом и точкой | То же, и plugin выключен в Claude Code. См. ниже |
| Другая версия | `Harness <from>` | Update Harness, с акцентом и точкой | Установлена другая версия. Tooltip говорит `<from> → <to>` |
| Та же версия | `Harness <from>` | Replace Harness | Тот же semver из другого commit-а, см. ниже. Когда GitHub говорит, что он отстаёт, строка — «Другая версия» |
| Ошибка | `Harness error: <step>` | Retry | Шаг упал, Claude Code сообщает, что plugin сломан, или нет зависимости. Причина в tooltip |
| Идёт установка | `Installing Harness…` | Нет | Во время установки, начатой из этого пункта |
| Идёт включение | `Enabling Harness…` | Нет | Во время Enable, начатого из этого пункта |
| Нет ответа | `Harness unavailable` | Нет | Вызов main process упал. Причина в tooltip |

**Enable.** Plugin, который Claude Code показывает установленным, но выключенным (например, выключенный в `/plugin`),
получает кнопку Enable. Нажатие запускает `claude plugin enable worfy@worfy-harness --scope user` с binary Claude Code
этой сборки — ту же команду, за которой стоит `/plugin`. Так Claude Code пишет свои настройки сам, а worfy не пишет ни
одного файла. Диалога нет: команда ничего не устанавливает. Пока она идёт, строка говорит `Enabling Harness…`. Потом
состояние читается заново. Удачный Enable доходит до каждого окна. Упавшая команда оставляет строку на `· disabled`, а
tooltip-ы строки и Enable кончаются на `Enable failed:` и вывод команды. Enable виден только там, где был бы Install, в
запуске, которому можно устанавливать.

Запуск, которому нельзя устанавливать, показывает состояние без кнопки, и две строки о другой версии тогда называют обе
версии: `Harness <from> → <to>` и `Harness <from>, this build <to>`. Устанавливать может только упакованное приложение или
запуск с `WORFY_CLAUDE_HOME`, потому что development-сборка на настоящем Claude home заменила бы Harness, на котором
работают терминал и Stable copy.

**Что делает установка.** Сначала читает, потом спрашивает, потом пишет. Когда делать нечего, диалога нет. Иначе
нативный диалог называет каждую команду до запуска, в порядке запуска:

1. Для каждой отсутствующей зависимости plugin-а: `claude plugin marketplace add anthropics/claude-plugins-official`,
   когда Claude Code не знает этот marketplace, затем `claude plugin install <name>@claude-plugins-official --scope user`,
   и Claude Code скачивает её с GitHub. Сейчас plugin не объявляет ни одной зависимости: skills, которые он взял из
   `mattpocock-skills`, лежат внутри него, так что этот шаг выполняется только для копии Harness, которая зависимость
   объявляет. worfy ставит зависимости только из этого marketplace: отсутствующая зависимость из другого даёт ошибку,
   которая просит пользователя поставить её самому. Каждую поставленную зависимость worfy записывает в свою папку данных
   (`harness-dependencies.json`).
2. Копия этой сборки ложится в папку plugin и заменяет то, что там есть. Шаг пропускается, когда в папке уже версия этой
   сборки.
3. При первой установке: `claude plugin marketplace add <plugin folder>`, затем `claude plugin install worfy@worfy-harness
   --scope user`. При другой версии: `claude plugin update worfy@worfy-harness --scope user`.

Кнопка называется Install, Update или Replace, а Cancel ничего не пишет. Диалог, который копирует, ещё предупреждает: у
сессий Claude Code, уже запущенных в терминале, файлы меняются на ходу, и их нужно перезапустить. Пока старый Harness
лежит в `~/.claude`, диалог предупреждает, что сессии в терминале запускают и его hooks, и hooks plugin-а. Команде
даётся 120 с, а команде, которая ставит зависимость, 600 с.

**Plugin, который worfy поставил для старого Harness.** Старые версии Harness объявляли
`mattpocock-skills@claude-plugins-official`, и worfy его ставил. После того как прошло обновление установленного `worfy`
(Update Harness в version popover-е или установка после Update приложения), worfy удаляет этот plugin командой
`claude plugin uninstall mattpocock-skills@claude-plugins-official --scope user`, но только если его поставил worfy: так
говорит собственная запись worfy, или Claude Code показывает plugin установленным не больше чем за 10 минут до
`worfy@worfy-harness` и раньше него. Запись о plugin-е, которого уже нет или который Claude Code показывает установленным
позже записи, отбрасывается. Plugin, который пользователь поставил в другое время, plugin без читаемого времени установки
и plugin при первой установке остаются. Codex следует тому же правилу с `codex plugin remove <id>`; Codex не показывает
время установки такого plugin-а, поэтому там его удаляет только запись worfy. Marketplace остаётся. Строка Harness
затем показывает `· removed mattpocock-skills`, а её tooltip называет команду, которая возвращает plugin. Неудачное
удаление показывает `· could not remove …` с выводом команды; Harness остаётся установленным, а следующий Update
пробует снова.

**Чем кончается неудачная установка.** В списке Claude Code plugin остаётся установленным или не установленным, но не
на полпути:

| Что упало | Что остаётся | Шаг ошибки |
|---|---|---|
| Команда для зависимости | Копия Harness не тронута, ни одна команда для `worfy` не запускалась | `dependency marketplace add`, `dependency install` |
| Копирование | Прежняя папка plugin как была | `copy` |
| `marketplace add` для копии | Claude Code не показывает `worfy` в списке | `marketplace add` |
| Первый `plugin install` | worfy читает список заново и удаляет запись, которую оставила команда | `install` |
| Удаление этой записи | Причина называет оба сбоя | `uninstall` |
| `plugin update` | Ничего не удаляется, а в папке уже новая копия | `update` |
| Чтение списка, или нет бинарника Claude Code | Ничего не записано | `plugin list` |

Ответ, что официальный marketplace уже добавлен, не считается сбоем при любом exit code. Retry заново читает состояние и
запускает то, что осталось, включая отсутствующую зависимость. Plugin, установленный без зависимости, тоже считается
ошибкой, потому что Claude Code тогда не загружает из него ничего.

**Старая сборка не заменяет более новый Harness.** Версия выглядит как `<semver>+<short SHA>`, с `.dirty` на конце у
сборки с незакоммиченными изменениями. Порядок есть только у части semver. Сравниваются и копия в папке, и версия из
списка Claude Code, потому что они расходятся после неудачного `plugin update`.

| Установленная версия относительно этой сборки | Результат |
|---|---|
| Та же строка | Для plugin-а делать нечего |
| Меньший semver | Update, через диалог |
| Тот же semver из другого commit-а, или одна из двух `.dirty` | Replace, через диалог, который говорит, что worfy не может определить, какая новее |
| Больший semver, или не версия сборки | Отказ: ошибка шага `copy`, без диалога, копирования и команд. Причина называет выход: открыть сборку, которая это установила, или удалить папку вручную и нажать Install |

Когда папка удалена вручную, диалог говорит, что ставит более старый Harness. Копия, которую отложила прерванная
установка, для этого сравнения считается установленной.

**После Update или отката Stable copy второго диалога нет.** Нажатие «Restart now» или «Roll back» и было согласием на
Harness этой копии. При первом старте новой копии worfy ставит её Harness, если установленный устарел или его нет, тем
же installer-ом и теми же командами, что выше. Делает это один раз: запись о перезапуске сначала помечается как
использованная, так что упавшая установка не повторяется, пока пользователь не нажмёт кнопку. Сбой — обычное состояние
ошибки с Retry, и состояние Update отмечает его для уведомления. Установка, начатая в этот момент из version popover-а, общая, и
Cancel в её диалоге оставляет Harness как был. Если стартовала не та копия, которую назвал перезапуск, потому что замена
не случилась, ничего не ставится. Claude Code берёт новый Harness со следующей Session. Сам Update описан в
[Updates](updates.md).

**Harness out of date.** Пока Update включён, worfy ещё проверяет, не отстаёт ли установленный Harness от Harness этой
копии. Меньший semver отстаёт сразу. Для того же semver из другого commit-а worfy без входа спрашивает GitHub, идёт ли
commit этой копии после commit-а установленного. Нет ответа от GitHub — нет и сигнала. Проверка идёт после установки при
старте, потом раз в час и снова после каждой установки Harness. Сигналы отстающего Harness — акцент и точка на «Update
Harness», toast «Harness out of date: <from> → <to>» и красная строка Health, см. [Updates](updates.md).

**Перенос старого Harness.** До plugin-а Harness лежал прямо в `~/.claude`. Пока от него там что-то осталось, строка
First run предлагает "Move…", а в запуске, которому можно устанавливать, строка Harness в version popover-е ещё
показывает иконку "Move old Harness…", а у version chip-а красная точка. В форме "Move the old Harness out of ~/.claude" по строке на каждую вещь:

| Группа | Выбор |
|---|---|
| Harness files | Remove, Keep |
| Разделы CLAUDE.md, показаны как diff | Remove, Keep |
| Hooks in settings.json | Remove, Keep |
| Status line | Replace, Keep |
| qmd: скрипты, hook и запись MCP вместе | Remove, Keep |
| Machine state | Move, Keep |
| Profile-ы, каждый со своими полями и diff-ом | Move, Keep |

Строка, которую нельзя убрать, предлагает только Keep и говорит почему. Старый hook `hooks/session-end.sh`, который вёл
log напоминания о ретроспективе, которого в plugin-е больше нет, считается файлом Harness: его строка и строка его
записи в `settings.json` предлагают Remove. То, чего нет в форме, остаётся в `~/.claude`. Move неактивна, и форма
говорит почему, пока plugin не установлен, не включён и не той же версии, что сборка.

После диалога согласия всё, что перенос забирает или меняет, копируется в папку `backup-<date>` в Harness home, и только
потом идут шаги. Упавший шаг отменяет перенос и называется в форме. После переноса форма показывает backup и одну
команду отмены, `node <backup>/restore.mjs`. Этой команде не нужны ни worfy, ни plugin, и она первым делом выключает
plugin. То, что изменилось после переноса, она сохраняет в папке `after` внутри backup, а второй запуск ничего не
меняет. Уже запущенные Session-ы держат старые hooks до перезапуска.

#### In Codex

Та же установка кладёт ту же папку plugin в Codex, после части Claude Code, когда эта сборка несёт Codex и домашняя папка
Codex существует (`CODEX_HOME`, иначе `.codex` в домашней папке). Без этой папки worfy ничего в Codex не трогает.
Команды запускают бинарник Codex этой сборки, никогда не `codex` пользователя, в таком порядке:

1. Каждая отсутствующая зависимость, отдельным plugin-ом, потому что у Codex нет зависимостей между plugin-ами:
   `codex plugin marketplace add anthropics/claude-plugins-official`, когда Codex его не знает, затем `codex plugin add
   <name>@claude-plugins-official`. Как и в Claude Code, этот шаг выполняется только для копии Harness, которая
   объявляет зависимость, а сейчас plugin не объявляет ни одной. Каждую добавленную зависимость worfy записывает в
   `harness-dependencies.json`.
2. При первой установке `codex plugin marketplace add <plugin folder>`, когда Codex его не знает, затем `codex plugin add
   worfy@worfy-harness`; при другой версии только последняя команда. Прямо перед `codex plugin add` worfy пишет
   `.codex-plugin/plugin.json` в папку plugin: Codex читает его раньше `.claude-plugin/plugin.json`. Это manifest Claude
   Code плюс MCP server-ы из `.mcp.json` с папкой plugin на месте `${CLAUDE_PLUGIN_ROOT}`, потому что Codex 0.166.0 не
   подставляет эту переменную для MCP server-ов. Поэтому server `qmd` запускается как `node <plugin folder>/bin/qmd-mcp`
   в папке Session. Claude Code не читает `.codex-plugin/` и по-прежнему использует `.mcp.json`. Когда записать файл не
   удаётся, падает шаг `plugin add`, и `codex plugin add` не запускается.
3. Агенты `worfy-implementer.toml`, `worfy-reviewer.toml` и `worfy-scout.toml` в `<CODEX_HOME>/agents`.

Диалог согласия называет команды и файлы агентов Codex после части Claude Code, или одни их, когда у Claude Code уже
Harness этой сборки, и говорит, что Codex держит hooks нового или обновлённого plugin-а выключенными, пока их не одобрят
в `/hooks`. Сбой в части Claude Code оставляет Codex нетронутым. Сбой в Codex оставляет Claude Code установленным, а
строка Codex в version popover-е показывает упавший шаг. Команде Codex даётся 120 с, а команде, которая добавляет marketplace
или зависимость, 600 с.

**Агенты.** Каждый сделан из агента с тем же именем в plugin-е: его `description`, его текст как developer instructions
с папкой plugin на месте `${CLAUDE_PLUGIN_ROOT}` и его `effort` как reasoning effort. Имя модели Claude, такое как
`inherit` или `sonnet`, не пишется, так что агент берёт модель Session, которая его запускает. Каждый файл, который
пишет worfy, начинается строкой комментария, которая начинается с `# Written by worfy's Harness installer` и называет
версию Harness. Файл `worfy-*.toml` без неё принадлежит пользователю: worfy его не переписывает и не удаляет. Когда у
такого файла имя агента этой сборки, этот агент не пишется, и строка Codex об этом говорит. Помеченный файл агента, которого
в этой сборке нет, удаляется.

**В version popover-е.** Часть Codex — отдельная строка version popover-а, под строкой Harness, с кнопкой в её конце, и
только пока часть Claude Code установлена. Текст — 11 px.
Состояние ждёт `codex plugin list --json` не больше 10 с, и тогда одна часть Codex показывает `Codex error: plugin list`.

| Часть Codex | Кнопка | Когда |
|---|---|---|
| Ничего | Нет | Codex показывает версию этой сборки, и каждый файл агента на месте |
| `Codex: not installed` | Install in Codex | Codex не показывает `worfy@worfy-harness` в списке |
| `Codex <from>` | Update Harness in Codex | Другая версия, или файл агента, который нужно записать или удалить |
| `Codex error: <step>` | Retry | Шаг упал, или Codex показывает plugin без его зависимости. Причина в tooltip |
| `Codex: approve hooks` | Сам текст открывает шаг ниже | Установка или обновление в Codex этим запуском worfy, и ни одна проверка с тех пор не нашла hooks одобренными |
| `Codex: 1 agent not written`, `Codex: 2 agents not written` | Нет | У собственных файлов пользователя имена агентов. Tooltip называет их и говорит переименовать или удалить их, затем установить снова |

**Одобрение hooks.** Codex доверяет hooks plugin-а по hash-у папки plugin, поэтому после каждой установки или
обновления Harness его hooks в Codex выключены, пока пользователь их не одобрит. Без них gate и guard-ы workflow в Codex
не работают, и [Autopilot](autopilot.md#во-время-run-а) отказывает в run-е на Codex. Диалог "Approve the Harness hooks
in Codex" говорит, что делать: запустить Codex этой сборки в терминале, набрать `/hooks`, одобрить hooks plugin-а
`worfy`, вернуться и нажать "Check again". worfy запускает только свой бинарник Codex, которого нет в PATH пользователя,
поэтому шаг 1 показывает команду с полным путём этого бинарника и кнопкой "Copy": `cd ~ && '<path>'` на macOS и Linux,
`cd ~; & "<path>"` в PowerShell на Windows. Путь тот же, что использовала установка в Codex, так что `/hooks` одобряет
тот же `CODEX_HOME`. Команда запускает Codex из домашней папки, потому что Codex, запущенный из папки, которой больше
нет, например удалённого worktree, сразу останавливается с "No such file or directory (os error 2)". Когда worfy не
находит своего бинарника Codex, шаг 1 говорит об этом. Проверка спрашивает Codex и отвечает одной из трёх строк:

- "Approved: Codex runs the Harness hooks, and a Codex Autopilot Run can start." Кнопка становится "Done", а
  "Codex: approve hooks" пропадает во всех окнах.
- "The Harness hooks are still off in Codex. Approve them in /hooks, then check again."
- "worfy could not read the hooks from Codex. Check that the Harness is installed in Codex, then check again."

Диалог открывается сам в окнах, открытых в момент, когда установка или обновление в Codex оставили hooks для одобрения.
После "Close" его открывает снова только "Codex: approve hooks". Этот флаг хранится только пока worfy работает: после
перезапуска строка Codex его не показывает, но Autopilot всё равно спрашивает Codex перед каждым run-ом.

#### On Windows

Переименование или удаление папок plugin, которое отклоняет открытый кем-то файл, повторяется до 60 с: при `EPERM`,
`EBUSY` или `EACCES`, а при удалении ещё и при `ENOTEMPTY`, с паузами от 0 до 100 мс. Возврату прежней копии и удалению
промежуточной папки после сбоя даётся по 10 с, так что худший сбой занимает около 80 с. Если новая копия на месте, а
прежнюю удалить нельзя, установка идёт дальше, и эту папку удаляет следующая установка. Вне Windows те же ошибки не
повторяются.

#### On a Linked machine

Linked machine не может отсюда начать установку или перенос: каналы обоих локальные. Пункт и форма описывают Machine,
окно которой их показывает. "Add project" для папки на Linked machine говорит, что Harness настраивается на самой этой
Machine.

### How it works

- **Копия это сразу marketplace и plugin.** Её marketplace называет plugin по пути `./`
  ([ADR-0040](../../adr/0040-harness-delivery-local-marketplace.md),
  [ADR-0048](../../adr/0048-harness-plugin-spike-results.md)).
- **Два автора записи.** Сам worfy при установке пишет только папку plugin, через промежуточную папку рядом, которая
  переименовывается на место. Собственные команды Claude Code пишут `settings.json` и его папку plugin-ов. Они
  запускаются бинарником Claude Code из SDK, а не `claude` пользователя
  ([ADR-0008](../../adr/0008-claude-code-native-binary-path.md)).
- **Второй `install` не меняет версию**, поэтому другая версия идёт через `update`.
- **Зависимость идёт первой**, потому что `plugin install` без неё проходит успешно, а plugin потом не загружается
  ([ADR-0059](../../adr/0059-installer-installs-plugin-dependencies.md)). Plugin не объявляет ни одной зависимости с тех
  пор, как сам несёт skills, взятые из `mattpocock-skills`; механизм остаётся для будущей зависимости.
- **Удаляется только plugin, который поставил worfy.** Зависимость, которую поставил пользователь, принадлежит
  пользователю, поэтому правило сначала спрашивает собственную запись worfy, потом время установки, и при любом сомнении
  plugin остаётся (amendment к [ADR-0059](../../adr/0059-installer-installs-plugin-dependencies.md#amendments)).
- **Какой Harness на Machine, проверяется при каждом вызове**, поэтому для переключения не нужен перезапуск. Старый
  Harness выигрывает, пока его `bin/epic-status` лежит в Claude home, потому что его hooks всё ещё записаны в
  `settings.json` ([ADR-0049](../../adr/0049-worfy-sessions-without-inline-plugin-on-legacy-harness.md)). Поэтому перенос
  удаляет этот файл последним.
- **Чтение ничего не пишет.** Без папки plugin часть состояния Claude Code не запускает команд, а зависимость показана
  как непроверенная. Часть Codex запускает `codex plugin list --json` всегда, когда Codex есть на Machine.
- **Codex ставит из той же папки.** Копия, которую часть Claude Code держит в папке plugin, это и локальный marketplace
  Codex, поэтому обновление в Codex это снова `plugin add`: сама папка уже новая копия. Plugin локального marketplace
  может показываться в списке с версией `local`; тогда версия, которую поставил worfy, читается из его собственной
  записи, `harness-codex.json` в его папке данных ([ADR-0005](../../adr/0005-worfy-own-state-inventory.md)). Агента Codex
  нельзя поставить в plugin-е, поэтому worfy сам пишет файлы агентов, только в `<CODEX_HOME>/agents` и никогда в
  Project.

### Implementation

| Модуль | Роль |
|---|---|
| `electron.vite.config.ts` | Копирует `harness/` в `out/harness` при каждой сборке main, без `bin/tests`, `hooks/tests`, `evals` и `evals-outcome`, и пишет версию из `scripts/build-version.ts` в manifest копии |
| `electron-builder.yml` | Кладёт копию в resources приложения, вне `app.asar`, потому что скрипт внутри него запустить нельзя |
| `src/main/harness/bundled.ts` | Находит копию и её версию |
| `src/main/harness/install.ts` | Installer: состояние, план, порядок версий, текст диалога, замена папки |
| `src/main/harness/codex-install.ts` | Часть installer-а для Codex: её состояние, команды и запись |
| `src/main/harness/dependency-cleanup.ts` | Запись worfy о зависимостях, которые он поставил, и правило, которое удаляет зависимость, поставленную для старого Harness |
| `src/main/harness/codex-agents.ts` | Агенты Codex: TOML каждого агента, какие файлы принадлежат worfy, запись |
| `src/main/vendors/codex/harness-hooks.ts` | Одобрены ли hooks Harness в Codex (`hooks/list`) |
| `src/renderer/harness/CodexHooksStep.tsx` | Шаг "Approve the Harness hooks in Codex", чей "Check again" это канал `harness.codexHooks` |
| `src/main/harness/locate.ts` | Какой Harness на Machine (`plugin`, `legacy`, `none`), папки его скриптов и состояния Gate |
| `src/main/ipc/harness.ts` | Единственный installer приложения и диалог согласия. Объявляет `harness.changed` |
| `src/shared/ipc/harness.ts` | Каналы и состояния |
| `src/renderer/harness/HarnessStatus.tsx`, `src/renderer/harness/useHarnessStatus.tsx`, `src/renderer/harness/harness-lines.ts` | Строки Harness и Codex в version popover-е, которые показывает и `src/renderer/settings/PipelineSection.tsx` |
| `src/renderer/shell/footer/VersionChip.tsx`, `src/renderer/shell/footer/version-dot.ts` | Version chip, его точка и его popover |
| `src/main/first-run/actions.ts` | Запускает тот же installer из First run |
| `src/main/harness/migrate/plan.ts` | Строки формы переноса, прочитанные с диска. Ничего не пишет |
| `src/main/harness/migrate/apply.ts` | Перенос по шагам: backup, settings, `.claude.json`, CLAUDE.md, state, files, `bin/epic-status`, commit |
| `src/main/harness/migrate/restore.ts` | Manifest и `restore.mjs` |
| `src/main/harness/migrate/profiles.ts` | Profile-ы схемы 1 становятся схемой 2 |
| `src/main/ipc/harness-migration.ts`, `src/shared/ipc/harness-migration.ts`, `src/renderer/harness/MigrationForm.tsx` | Предложение и диалог переноса, его каналы и форма |

Каждый путь, который перенос пишет или удаляет, проверяется: он должен быть внутри Claude home или Harness home, а
`.claude.json` единственный файл вне их.

Главные test-ы: `test/contract/harness-install.test.ts`, с подставным Claude Code и сбоями, внесёнными в копирование и
переименования. `test/e2e/harness-install.spec.ts` и `test/e2e/harness-migrate.spec.ts` идут через version popover, а
`test/e2e/footer.spec.ts` проверяет точку chip-а и popover. Также
`test/contract/harness-changed.test.ts`, `test/contract/harness-migrate.test.ts`, `test/unit/harness-locate.test.ts`,
`test/unit/harness-status.test.tsx`, `test/unit/harness-migration-form.test.tsx` и, для удаления зависимости, которая
больше не нужна, `test/contract/harness-dependency-cleanup.test.ts`. В Codex:
`test/contract/harness-codex-install.test.ts`, с подставным `codex` и временным `CODEX_HOME`, файлы агентов в котором
должны совпадать с `test/fixtures/codex-agents/expected/`; `test/contract/codex-harness-hooks.test.ts`,
`test/unit/codex-hooks-step.test.tsx` и `test/e2e/codex-hooks-step.spec.ts` для одобрения.

## Plugin

### Behaviour

Plugin `worfy` приходит из marketplace `worfy-harness`, а его skills и агенты несут префикс `worfy:`, как в
`/worfy:epic-wave` и `worfy:implementer`.

| Часть | Что в ней |
|---|---|
| Агенты | Четыре роли, см. [Agents](skills-agents-and-hooks.md#agents) |
| Skills | Тринадцать процедур worfy и двадцать skills, скопированных у Matt Pocock, см. [Skills](skills-agents-and-hooks.md#skills) |
| Hooks | Команды, которые Claude Code запускает на свои события, и тексты правил, см. [Hooks](skills-agents-and-hooks.md#hooks) |
| Скрипты | 28 программ ниже |
| Контракт Profile | Описание Profile и схема его черновика |
| MCP server | `qmd`, поиск по документам |

**Какую копию запускает Session.**

| Session | Старый Harness в `~/.claude` | Что запускает |
|---|---|---|
| Запущена worfy | Нет | Копию этой сборки, переданную inline. Она заменяет установленный plugin с тем же именем и не нуждается в нём |
| Запущена worfy | Да | Без plugin-а, чтобы старые hooks не сработали дважды |
| Запущена в терминале | Нет | Установленный plugin |
| Запущена в терминале | Да | Старые hooks, и hooks plugin-а тоже, когда он установлен |

Так что без старого Harness Session в worfy соответствует своей сборке, а сессия в терминале меняется только с
установкой. Session в Project-е, у которого в Profile есть `skills.allowed`, теряет остальные plugin-ы и skills
пользователя и сохраняет `worfy` ([Sessions](sessions.md)).

**Profile.** Первое действие агента это запуск `profile`, и дальше агент следует тому, что тот напечатал: команды, пути
Ticket-ов, режим параллельной работы, финиш, нумерация, документы и свободный текст правил Project-а. Profile никогда не
лежит в репозитории. Скрипт находит Project по папке, в том числе по worktree в любом месте диска. Его exit code решает,
что делает агент:

| Код | Значение | Агент |
|---|---|---|
| 0 | Profile найден | Работает по нему |
| 1 | Сломан registry, resolver или файл Profile | Не угадывает команды. Implementer останавливается и сообщает об этом. Scout и reviewer первой строкой ответа пишут exit code и сообщение из stderr и работают дальше без Profile |
| 2 | Ошибка вызова, например несуществующий путь | То же |
| 3 | Project не зарегистрирован или без Profile | То же |
| 4 | С `--field`: поля нет | Пропускает шаг, который от него зависит |

**User personalization.** Два необязательных файла в Harness home, написанные вручную, которые Harness только читает:
один задаёт язык отчётов, и он важнее значения в Profile, другой держит собственные правила пользователя для каждой
Session и каждого Subagent-а (см. [Hooks](skills-agents-and-hooks.md#hooks)).

**Скрипты.**

| Скрипт | Что делает |
|---|---|
| `profile` | Печатает Profile папки, целиком или одно поле |
| `profile-set` | Пишет Pipeline или с `--field` другие поля Profile-а, проверенные схемой черновика и правилами, по которым Profile читает `bin/profile` (кроме `name`, `mode`, `schema`, `workflow.folder`). `--check` только проверяет |
| `project-connect` | Пишет или удаляет Profile и записи registry для Project-а |
| `ticket` | Единственный автор строк статуса Ticket-а. Также пишет отметки |
| `epic-status` | Строка Stage для Epic-а, или все Ticket-ы как JSON |
| `epic-board` | Снимок всех Epic-ов и Ticket-ов на одной странице |
| `preflight` | Проверка перед Ticket-ом или Wave. Последняя строка это `GO` или `BLOCKED: <reasons>`, и он печатает следующие свободные номера ADR и миграций |
| `wave-gate` | Один Gate full на набор готовых PR одной Wave, затем их merge |
| `land` | Вливает готовые PR по одному и закрывает их Ticket-ы в одном PR с документами |
| `wave-brief` | Короткая сводка по Wave-ам Epic-а, которую новый Orchestrator читает первой. Только чтение |
| `decision-log` | Добавляет одну строку в log Wave: её метки начала и конца и каждое решение, принятое без человека |
| `silent-check` | Ищет следы workflow в тексте или diff, см. [Full mode and Silent mode](projects.md) |
| `review-draft-lint` | Проверяет черновик review до того, как его увидит человек: длину каждого комментария по его уровню, следы workflow в любом режиме, строки об авторстве AI, личные данные и запрещённые слова проекта. С `--skill` проверяет, что каждое правило сгенерированного skill-а review указывает на раздел его `research.md`. С `--reply` проверяет черновик ответов skill-а `pr-reply`: те же правила для каждого ответа, который ещё в черновике, с именем `items[<i>]`, пустой ответ, один предел длины для всех ответов (наибольший уровень из `--rules`, иначе из `lint.json` шаблона), и exit 2 для файла неправильной формы; `--reply -` читает черновик из stdin |
| `pr-reply-draft` | Единственный автор черновика ответов skill-а `pr-reply`. Берёт ответы одного запуска из stdin, проверяет их через `review-draft-lint --reply` (с пределами team reviewer-а, когда он собран) и при находке ничего не пишет. Иначе сливает их в `<Profile folder>/state/pr-inbox/drafts/<owner>-<name>-<N>.json`: отправленные и отброшенные ответы остаются, ответ, который человек правил (`edited: true`), остаётся, пока его thread ждёт, черновики thread-ов, которые больше не ждут, становятся отброшенными, остальные заменяются. Session не может писать в папку Profile без запроса разрешения; скрипт может |
| `pr-review-draft` | Единственный автор, который есть у Agent review для черновика review чужого pull request-а, `<Profile folder>/state/pr-review/<owner>-<name>-<N>.json`; этот файл worfy создаёт, когда запускает review. Команды: `comment <path> <line>` (с `--start-line` и `--side`), `summary`, `verdict` (вердикт, который предлагает агент; настоящий выбирает человек) и `done`. Меняет только то, что написал агент: комментарии человека никогда, summary только пока она пустая или написана агентом. Отказывает с exit 1, когда черновика нет, когда черновик отправляется или отправлен, и после Stop. Main process worfy пишет тот же файл: каждый автор держит lock `<file>.lock` на время чтения и записи, потом переименовывает временный файл на место |
| `review-history` | Читает историю review pull request-ов Project-а на GitHub через `gh api graphql`, сохраняет слова reviewer-ов команды в `<Profile folder>/state/human-review/` и говорит, сколько их, с оценкой в токенах: это вход skill-а team reviewer. Модель в нём не запускается |
| `shortcut-ledger` | Перечисляет комментарии `shortcut:` рабочего дерева, по строке на каждый |
| `verdict` | Печатает ответ reviewer-а начиная с его строки вердикта: первой строки, которая начинается с `VERIFIED` или `REJECTED` (в том числе после `NARROW:`, жирного шрифта, знака заголовка или обратной кавычки; никогда внутри fenced-блока кода), без предложения над ней и без разметки. Exit 1, когда ни одна строка не несёт вердикта; ничего не угадывается. Skill `epic-wave` записывает через него вердикт verifier-а, и приложение читает вердикты по тому же правилу |
| `story-check` | Проверяет Code story по коду head PR-а, никогда не по главной ветке: заголовок, строку header, шаги и их поля, каждый процитированный фрагмент строка в строку и личные данные |
| `evidence-check` | Проверка приватности того, что ветка добавляет в корень Ticket-ов, до того как это попадёт в репозиторий: текст построчно и метаданные картинок и клипов (не их пиксели и кадры) |
| `code-map` | Карта кода репозитория, рядом с Profile, с commit-ом на каждую папку |
| `worktree-lock` | Рекомендательная блокировка рабочего дерева, см. [Hooks](skills-agents-and-hooks.md#hooks) |
| `start-context` | Оценивает начальный контекст каждого агента в токенах, см. [Agents](skills-agents-and-hooks.md#agents) |
| `gate-failures` | Записи о падениях Gate: какие test-ы упали в каких run-ах и на каком компьютере. Каждая подкоманда — отдельный модуль |
| `loop-log` | Циклы, которые увидел log вызовов: каждый случай, когда агент повторил вызов в четвёртый раз, и число случаев |
| `qmd-mcp` | Запускает MCP server |
| `qmd-refresh` | Обновляет индекс, когда главная ветка сдвинулась или файл memory либо lessons новее последнего обновления |
| `qmd-sync-main` | Подтягивает копию главной ветки Project-а, которую читает индекс |
| `qmd-collections` | Добавляет три коллекции Project-а в индекс и называет их в его Profile |

**qmd.** MCP server запускается только после того, как пользователь согласился на модели, с установленным qmd и node
22.14 или новее (на линии 23 — 23.6 или новее). Иначе он останавливается с одной строкой, которая говорит почему, и
агенты ищут через grep по `qmd.fallback_grep` из Profile. Один индекс обслуживает все Project-ы и может отставать:
агенты сверяют найденное с рабочим деревом. Установка qmd и его моделей это действие [First run](onboarding.md). Для
своих Session-ов worfy регистрирует server сам, под именем, которое инструменты носят в сессии в терминале
(`mcp__plugin_worfy_qmd__…`), а `mcp.allowed` из Profile фильтрует его как любой другой server.

**Текст.** Plugin написан по-английски, кроме слов других языков, которые он должен читать в Ticket-ах людей, старых
Profile-ах и строках вердикта старого Gate, и кроме старых русских форм команды Wave. Test следит, чтобы в его файлах не
было имён, аккаунтов и домашних путей одного человека, рабочих проектов и номеров решений, Ticket-ов и Wave самого worfy.

#### On Codex

Codex запускает тот же plugin с тем же `hooks/hooks.json`; второго набора hooks нет. Hook отличает Codex от Claude Code
по своему входу: Codex добавляет `turn_id` к событиям turn-а, а его transcript это файл `rollout-*.jsonl`. Workflow
сохраняет те гарантии, что есть у него на Claude Code, не строже, каждую — механизмом, который есть у Codex:

| Гарантия | На Codex |
|---|---|
| Gate до конца работы | У Codex нет `TaskCompleted` и `TeammateIdle`. На `Stop` и `SubagentStop` в зарегистрированном Project-е `stop.mjs` сам запускает `gate.mjs fast` и держит turn, пока тот красный; Codex продолжает с причиной. `Stop` в main checkout, а не в linked worktree, gate не запускает и держится только красной отметкой, которую оставил прошлый запуск |
| Reviewer и scout только читают | Bash guard отказывает `worfy-reviewer` и `worfy-scout` в `apply_patch`, правке файла в Codex; их shell-команды проходят через правила Bash |
| Bash guard | Тот же `guard.mjs` на `Bash\|apply_patch`. Ввод в открытый shell не запускает hook, поэтому агенту `worfy-*` нельзя запускать интерактивный shell, интерпретатор или терминальный мультиплексор |
| Правила на старте | `SessionStart` и `SubagentStart`, те же события |
| Учёт Session-ов | `SessionEnd`, которому Codex даёт не больше 3 с |
| Вердикты review | Те же скрипты и `gh`. Hook Codex не может задать окружение Session, поэтому worfy кладёт `GH_TOKEN` аккаунта `github.account` из Profile в окружение процесса Codex этой Session |
| Hooks включены | Только после того, как пользователь одобрил их в `/hooks`; до тех пор Autopilot отказывает в run-е на Codex |

`harness/README.md`, раздел "On Codex", держит полную таблицу с известными пробелами, такими как инструменты `mcp__*`
агентов, которые только читают: matcher guard-а их не видит. То, что Codex называет пользовательского агента
`worfy-reviewer` во входе hook-а, на живом Codex ещё не проверено.

**Набор test-ов на равенство гарантий.** `test/contract/codex-parity.test.ts` доказывает таблицу на поддельном
app-server, который запускает hooks и держит sandbox так же, как закреплённая версия Codex
([Vendors, поддельный Codex](vendors.md#implementation)). Installer ставит Harness во временный `CODEX_HOME`, и на нём идут девять сценариев. Каждая строка называет test Claude
Code, который доказывает ту же гарантию там, по файлу и по тексту проверки: переименованный файл или удалённая проверка
роняют набор, и так же его роняет гарантия в `harness/README.md` без строки.

#### On Windows

worfy запускает Node-скрипт Harness как `node <script>`. На Windows скрипт старого Harness, который не является
Node-скриптом, отклоняется с просьбой обновить Harness. Большинство команд hooks тоже называют `node`, а текст правил
показывает корень plugin-а как `C:/…`. Запуск Gate на Windows описан на [странице Gate](gate-and-github.md).

#### On a Linked machine

На Machine один Harness, и его Profile-ы остаются на ней. Project на Linked machine использует Harness этой Machine.

### How it works

- **Один Harness, много Project-ов.** Harness это plugin Claude Code
  ([ADR-0019](../../adr/0019-harness-claude-code-plugin.md)). Skill, hook или агент, которому нужен факт о проекте, читает
  его из Profile и не хранит у себя. worfy меняет состояние workflow только через эти же скрипты
  ([ADR-0002](../../adr/0002-worfy-is-a-view-over-the-workflow.md)).
- **Plugin нейтрален.** Язык и другие выборы одного человека относятся к User personalization или Profile, а не к
  plugin-у ([ADR-0074](../../adr/0074-harness-neutral-by-language-and-project.md)).
- **qmd часть Harness**, а его версия закреплена, потому что скрипты на неё рассчитывают
  ([ADR-0043](../../adr/0043-qmd-is-part-of-harness.md)).
- **Скрипт получает окружение login shell**, а не окружение самого worfy, потому что у приложения, запущенного из
  Finder, нет node в PATH ([ADR-0007](../../adr/0007-claude-code-launch-environment.md)). Для plugin-а worfy добавляет
  `HARNESS_HOME`.

### Implementation

- `harness/.claude-plugin/plugin.json` и `harness/.claude-plugin/marketplace.json` это manifest-ы. В исходнике нет
  `version`: её пишет сборка. `harness/.mcp.json` называет server.
- `harness/bin/` держит скрипты, с глоссарием Ticket-ов в `harness/bin/TICKETS.md`. `harness/lib/` держит то, что у них
  общее: правила Pipeline в `harness/lib/pipeline.cjs` и слова других языков в `harness/lib/input-words.json`.
- `harness/profiles/README.md` это контракт Profile, а `harness/profiles/draft.schema.json` схема черновика.
- В Harness home: `projects/<name>/` держит Profile (`profile.json`, `rules.md`), `gate/config.json` registry,
  `user.json` язык и `user/rules.md` правила пользователя.
- `harness/README.md` описывает папку, её test-ы и eval-ы.
- В приложении: `src/main/vendors/claude/options.ts` передаёт копию inline и регистрирует её server-ы, с папкой из
  `src/main/vendors/claude/query.ts`. `src/main/workflow/profile.ts` запускает скрипты с окружением из
  `src/main/harness/script-env.ts`. `src/main/harness/attribution.ts` держит копию worfy значения `attribution` по
  умолчанию, для значения, названного раньше любого Profile, а `src/main/harness/qmd.ts` ставит qmd и его модели.

Главные test-ы: `harness/bin/tests/` и `harness/hooks/tests/` это shell-test-ы, которые `pnpm test` запускает через
`test/contract/harness-scripts-1.test.ts` … `test/contract/harness-scripts-4.test.ts`.
`harness/bin/tests/plugin-neutral.test.sh` это test текста, о котором сказано выше. `test/contract/harness-plugin.test.ts`
закрепляет manifest и не пускает в `harness/` то, что не относится к Harness. Также `test/contract/harness-qmd.test.ts`,
`test/contract/harness-script-env.test.ts`, `test/contract/harness-script-command.test.ts` и
`test/unit/agent-options.test.ts`.

Eval-ы делают платные вызовы модели, и CI с Gate их не запускают. `harness/evals/` держит двадцать семь случаев
`claude plugin eval`, которые по поведению проверяют, что Claude следует правилам (`pnpm eval:harness`), а
`harness/evals-outcome/` держит задачи для `pnpm eval:outcome`. `test/contract/harness-evals.test.ts` бесплатно
проверяет, что каждый случай полон.
Случай `compaction-state` несёт тег `alone` и запускается только командой `pnpm eval:harness -- --case compaction-state`:
только его вызов получает `CLAUDE_CODE_AUTO_COMPACT_WINDOW=100000` и `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=50` — переменные,
с которыми Claude Code сжимает историю (compaction) один раз, до первого ответа, а каждый другой вызов идёт без них, даже когда их
задаёт shell. Общий запуск и `--changed` пропускают этот случай и печатают, как его запустить. Его запуск без hook-а
compaction и без инструкций —
`HARNESS_DIR="$(node harness/evals/compaction-state/baseline.mjs)" pnpm eval:harness -- --case compaction-state`
([Skills, agents and hooks](skills-agents-and-hooks.md)).
