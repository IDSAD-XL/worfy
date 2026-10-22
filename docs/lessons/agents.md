# Агенты: изоляция, worktree, ручные проверки

## У каждого параллельного агента свой подкаталог scratchpad

Агентам одной Session scratchpad общий. Каждому — свой подкаталог (`<scratchpad>/<имя-агента>/`),
и чужие скрипты оттуда не запускать: ревьюер запустил чужой `mut.sh` и висел три часа. Никаких
watch-режимов: vitest — только `vitest run` (`pnpm test` уже так), иначе процесс не завершится и
агент встанет.
Проверка: harness/bin/tests/epic-wave-ship-ticket.test.sh:189 — текст правила о чужих скриптах в skill-е
ship-ticket; запрет watch-режима vitest ничем не проверяется.
Источник: ночной прогон worfy-mvp 2026-10-05/06.

## Исполнитель первым делом входит в свой worktree

Hook инструментов Edit и Write пускает только в дерево Session. Агент, запущенный из worktree
Orchestrator-а, не может править файлы в `.claude/worktrees/<NN>`, пока не сделает `EnterWorktree`
с `path` своего worktree. Без этого агенты обходили hook правками через python и sed в Bash.
Проверка: проверки нет: hook на Edit и Write стоит в Claude Code, а не в репозитории, и текст правила
о входе в worktree ни один test не сверяет.
Источник: worfy-mvp/02, worfy-mvp/10.

## Ручные проверки GUI агент может делать сам — по одному и только в окне приложения

Когда выданы права Screen Recording и Accessibility, агент проверяет GUI сам. Правила: строго
один такой агент за раз; клавиши — только во фронтальный процесс приложения и только после
проверки, что он фронтальный; снимки — только окна приложения, не всего экрана; системные
настройки не трогать. Без этих прав пункт остаётся `[ ]` со строкой «не проверено: …».
Проверка: проверки нет: правила ручной проверки GUI ни один test не сверяет; eval `no-os-screen-capture`
проверяет обратное — что агент вообще не снимает экран средствами ОС.
Источник: ночной прогон worfy-mvp 2026-10-05/06.

## Настоящий Claude Code в test-е пишет в `~/.claude`

Запуск настоящего Claude Code или Agent SDK пишет транскрипты в `~/.claude/projects`. Это запись
в `~/.claude`, даже если код Ticket-а сам туда не пишет. Бриф исполнителя явно говорит, разрешена ли
такая запись; без этого агент либо нарушает запрет, либо молча пропускает проверку.

Собранный worfy, запущенный напрямую (`_electron.launch` или `open`), тоже пишет в `~/.claude`: он
поднимает Orchestrator на настоящем Claude Code. Снимки и любые прогоны приложения в Ticket-е —
только через `launchApp` (`test/e2e/helpers.ts:111`): fake-агент, временные `WORFY_DATA_DIR` и
`WORFY_CLAUDE_HOME`, фикстуры вместо настоящих Project-ов (worfy-daily/11, PR #64).
Проверка: harness/bin/tests/agents-text.test.sh:100 — общее правило агентов «запись в `~/.claude` только
с разрешения брифа»; изоляцию `launchApp` test не сторожит.
Источник: ночной прогон worfy-mvp 2026-10-05/06.

## Таймаут `firstWindow` при параллельных e2e — это нагрузка, а не красный test

Когда несколько агентов одновременно гоняют Playwright с Electron, Electron не доходит до
`app ready` за 30 с — даже пустое приложение стартует 25+ с. Ошибка выглядит как красный test
(`firstWindow` timeout), хотя код ни при чём. Такой таймаут сначала повторить в одиночку, потом
чинить. Копия `Electron.app` в `/tmp` ради изоляции тоже замедляет первый запуск — не делать её.
Правило и путь общего замка для e2e и `gate full` — `rules.md` Profile-а worfy.
Проверка: harness/bin/tests/wave-gate-lock.test.sh:22 — gate full `wave-gate` ждёт чужой живой замок e2e;
e2e агента без замка не ловит никто.
Источник: worfy-daily Wave 6.

## Заблокированный экран macOS — одна из причин таймаута первого окна в e2e

Пока экран Mac заблокирован, Electron не показывает окно, и `launchApp` падает с «the window was not
shown within 30 s» (`test/e2e/helpers.ts:167`) — даже на чистом main. Ошибка выглядит как красный
test, хотя код ни при чём. Вторая известная причина того же таймаута — параллельные e2e (урок
выше). Перед e2e и `gate full` проверить `ioreg -n Root -d1 | grep -o '"IOConsoleLocked" = [A-Za-z]*'`:
при `Yes` прогон не запускать, а уже упавший — не считать красным и повторить после разблокировки.
Проверка: harness/bin/tests/wave-gate-screen.test.sh:21 — при `IOConsoleLocked = Yes` `wave-gate check` не
запускает gate и пишет одну строку «screen locked»; ручной прогон e2e эту проверку не делает.
Источник: worfy-daily/11, PR #64 (при доработке экран был заблокирован, `launch.spec.ts` падал на main).

## Окно macOS «восстановить окна?» — третья причина таймаута первого окна, сразу во всех e2e

2026-10-09 с 06:20 все e2e на всех ветках падали в `firstWindow`, хотя в 05:33 на main было зелено:
экран не заблокирован, нагрузка обычная. Даже приложение Electron из трёх строк не доходило до
`ready`. `sample <pid>` его главного потока показал `NSPersistentUIRestorer
promptToIgnorePersistentStateWithCrashHistory` и под ним `NSAlert runModal`: macOS спрашивала, не
восстановить ли окна, и ждала ответа. Это состояние она ведёт по bundle id, а он у всех dev- и
test-запусков один — `com.github.Electron`; test-ы убивают приложение нарочно, и оно копится.
Каждый запуск приложения в test-е передаёт `NO_WINDOW_RESTORE` (`-ApplePersistenceIgnoreState YES`,
`test/e2e/helpers.ts`), новый способ запуска — тоже. Если `firstWindow` падает у всех test-ов сразу,
сначала запустить пустое приложение Electron и снять `sample` главного потока.
Проверка: проверки нет: что `launchApp` передаёт `NO_WINDOW_RESTORE`, test не проверяет; без флага
краснеют только живые e2e, и то когда macOS накопит состояние.
Источник: PR #179.

## Test-ы наблюдателя файлов красные и на чистом main — сначала проверить `fseventsd` в `top`

Признак: test-ы наблюдателя файлов (`test/contract/docs.test.ts`, `test/contract/claude-home-registry.test.ts`)
краснеют и на чистом main, а служба macOS `fseventsd` в `top` держит около 100 % CPU и гигабайты памяти
(2026-10-12/13: 102–116 % CPU, 4,2 ГБ, уведомление об изменении файла опаздывало до 2,5 s). Test не
чинить и не повторять до зелёного. Лечит владелец: `sudo killall fseventsd`, агент `sudo` не запускает.
Потом повторить тот же commit: класс «временный сбой машины» ставит только зелёный повтор
(`docs/lessons/README.md`, «Классы сбоев»). Вероятная причина роста — папки, которые test-ы оставляют
во временном каталоге (на Mac было 57 487 `worfy-*`); связь не доказана.
Проверка: test/unit/no-rmsync.test.ts:152 — test-ы не удаляют свои папки через rmSync с recursive, который падал и оставлял их во временном каталоге; утечку папок по другой причине он не ловит
Источник: worfy-windows/26, worfy-reliability/03.

## Ночной прогон Autopilot: Mac не заблокирован, крышка открыта

Погасший экран macOS блокирует, Electron перестаёт показывать окно, и `gate full` ждёт человека
(прогон 3 Autopilot 2026-10-06 держал только `prevent-app-suspension`; e2e идут только локально —
урок о CI в `ci-merge.md`). Прогон держит `prevent-display-sleep` (ADR-0034), но только пока идёт сам.
Проверку набора и мержи вне прогона держат `wave-gate check` и `wave-gate merge`
(`caffeinate -d -w <свой pid>`); между ними экран может погаснуть, и `check` перед gate full ждёт
разблокировки строкой `screen locked: gate full waits`. Ручную блокировку и закрытую крышку не обходит никто: на ночь Mac разблокирован, крышка открыта (README, «Stable copy»).
Код: `src/main/autopilot/power.ts`, `harness/bin/wave-gate`.
Проверка: harness/bin/tests/wave-gate-screen.test.sh:111 — `wave-gate check` держит `caffeinate -d -w <свой pid>`;
`merge` — тот же блок test-а, `prevent-display-sleep` прогона — `test/unit/autopilot-power.test.ts`.
Источник: worfy-daily/32, PR #70; ночь 2026-10-16 — мержи вне прогона стояли с 04:39 до 10:09 (worfy-throughput/02).

## Конец хода Orchestrator-а — не конец Wave: Subagent-ы Wave живут как background task-и

Skill `/epic-wave` запускает implementer-ов Subagent-ами с `run_in_background` и кончает ход, а Wave
идёт дальше. Первый прогон Autopilot (2026-10-06, 10:17Z) счёл конец хода концом Wave: через 85 с —
`no-progress`, Session Orchestrator-а закрылась, и с процессом Claude Code погибли четыре Subagent-а.
Кто смотрит на Session извне, судит о конце её работы по живым background task-ам (событие SDK
`system/background_tasks_changed`), а не по `result` хода или `idle`. Правило — ADR-0029.
Код: `src/shared/agent/background-tasks.ts`, `src/main/autopilot/run.ts`.
Проверка: test/contract/autopilot-background.test.ts:334 — Wave не кончается, пока живы background task-и.
Источник: worfy-daily/29, PR #41.

## В Session без человека любой диалог — отказ: удалять только буквальный путь, владельца не спрашивать

На `rm -rf` с маской или переменной в пути Claude Code спрашивает подтверждение даже в
`bypassPermissions`; в Autopilot worfy отклоняет запрос сам (`refused-dialog` в журнале), и шаг
агента ломается. Так было в прогоне 2 (Wave 6 плана: `rm -rf *`, затем `AskUserQuestion`) и в
прогоне 3 (Wave 8: `rm -rf $R/$d`); в прогоне 4 — ни разу. Правила: только буквальный путь, чистый
каталог — новый `mktemp -d` (`~/.claude/agents/implementer.md`, `~/.claude/agents/reviewer.md`);
развилку владельца решать рекомендованным вариантом (`~/.claude/skills/epic-wave/SKILL.md`, «2. Раздача»).
Источник: прогоны Autopilot 2 и 3, 2026-10-06; коммиты `~/.claude` 8d2fbea, f0132fb.

Правило нарушается регулярно, и не только в Autopilot. Wave-ы 2 и 3 `worfy-harness` нарушили его
четыре раза. В Wave 2 два ревьюера и Subagent исполнителя выполняли `rm -rf` с переменной в пути
(свои каталоги в `/tmp`). В Wave 3 исполнитель Ticket-а 11 удалил файл по пути с переменной и правил
файлы Python-скриптами вместо инструмента Edit.
Источник: `worfy-harness` Wave-ы 2 и 3 (PR #108–#112, #114, #115); `git show 84684b5:HANDOFF.md`.

Без Autopilot отказа нет, и хуже: карточка разрешения в worfy ждёт человека. 2026-10-08 круг
`worfy-harness` 22 стоял 50 минут на `rm -rf "$M/$name"` исполнителя, пока карточку не отклонили; после
отказа он сам перешёл на `mktemp -d`. Кто следит за Session, следит и за карточками разрешения.
Проверка: проверки нет: текст правила агентов о `rm -rf` и `mktemp -d` test не сверяет, а отказа hook-а
на маску или переменную в пути в репозитории нет — его даёт открытый `worfy-harness` 48.
Источник: PR #150.

## Worktree и ветку влитого Ticket-а удалять сразу после мержа

После Wave 6 плана деревья влитых Ticket-ов остались, и Epic показывал «3 in work». worfy накладывает
Status ветки живого worktree на checkout, пока в checkout-е не `done` и не `blocked` (ADR-0033), так
что старая ветка в живом дереве — ложный сигнал «в работе». Правило: влит PR Ticket-а или документный
PR Wave — сразу `git worktree remove` и `git branch -D` (`~/.claude/skills/epic-wave/SKILL.md`,
«4. Мерж по политике», «Уборка после мержа»).
Код: `applyBranches` в `src/main/workflow/reader.ts`.
Проверка: проверки нет: уборку после мержа делает по тексту skill `epic-wave`, test-а на неё нет;
`test/contract/workflow-reader.test.ts` сторожит только то, что оставшаяся ветка не перекрывает `done`.
Источник: worfy-daily Wave 6; коммит `~/.claude` ec8412c.

## Agent SDK поднимать только до сборки с Claude Code 2.1.299 или новее и в том же PR заново снимать fixtures

В Claude Code 2.1.296 headless Session могла дважды выполнить одобренный вызов tool, а вызовы MCP
после переподключения шли дважды; исправлено в 2.1.299 (CHANGELOG Claude Code). Fake SDK такой
повтор не ловит: contract test-ы доказывают лишь, что сам worfy после рестарта не шлёт ход второй раз.
Поэтому `@anthropic-ai/claude-agent-sdk` (`package.json`) поднимать только до сборки с Claude Code
≥ 2.1.299 и в том же PR снимать `test/fixtures/sdk-messages/` заново (`scripts/spikes/sdk-probe.ts`;
проверка — `claude_code_version` в их `system/init`). Spike зовёт настоящую модель и пишет в `~/.claude`.
Код: `src/main/agent/fake-query.ts`.
Проверка: test/contract/sdk-compat.test.ts:60 — SDK в `package.json` поднят без нового манифеста fixtures — test красный
Источник: worfy-reliability/01; PR #325, идея A.

## Бриф, который велит запускать `gate.mjs`, задаёт временные `HOME` и `HARNESS_HOME`

2026-10-18 reviewer PR #510 (раздел Mac checks) запустил `gate.mjs --help` с настоящим `HOME`, пока
Orchestrator гонял свой gate full. Gate принял `--help` за имя профиля проверки (`process.argv[2]`) и записал
`~/.claude/worfy-harness/gate/state/verdict-89dd595a.json` — ключ worktree reviewer-а, outcome `none`; файл потом
удалён. Вердикт Orchestrator-а не пострадал, но агент менял состояние Harness владельца. Что делать: бриф,
где агент запускает gate (или его справку), задаёт `HOME` и `HARNESS_HOME` во временной папке; как сделать это
без кода 3 — `worfy-harness` 47. Справки у `gate.mjs` нет: любой первый аргумент — профиль (находка low).
Код: `harness/hooks/gate.mjs:123`.
Проверка: проверки нет: правило брифа; hook-а, который не пускает gate с настоящим `HOME` из Subagent-а, нет.
Источник: ревью PR #510 (`worfy-windows` 48), 2026-10-18.

## Перед отправкой head — оба guard-test-а: `no-rmsync` и `e2e-no-spawn-on-load`

2026-10-20 gate full Mac дважды покраснел только на `test/unit/no-rmsync.test.ts` (PR #591, PR #592): test
удалял свою папку через `rmSync(…, { recursive: true })`, а не через `removeTestTree` из `test/remove.ts`.
Остальные 7000+ test-ов, lint и e2e были зелёными; каждый такой красный — лишний полный gate в общей очереди.
Оба guard-а читают исходники всех test-ов и идут за секунды. Что делать: бриф implementer-а и круга правок
велит перед push-ем, который меняет `test/`, запустить по файлу `test/unit/no-rmsync.test.ts` и
`test/unit/e2e-no-spawn-on-load.test.ts` и приложить exit code; ревьюер линзы тестов запускает их сам.
Проверка: проверки нет: правило брифа; сами guard-ы ловят нарушение только в gate или при запуске по файлу.
Источник: gate full PR #591 и PR #592 (`worfy-harness` 41, 36), 2026-10-20.
