# Агенты: изоляция, worktree, ручные проверки

## У каждого параллельного агента свой подкаталог scratchpad

Агентам одной Session scratchpad общий. Каждому — свой подкаталог (`<scratchpad>/<имя-агента>/`),
и чужие скрипты оттуда не запускать: ревьюер запустил чужой `mut.sh` и висел три часа. Никаких
watch-режимов: vitest — только `vitest run` (`pnpm test` уже так), иначе процесс не завершится и
агент встанет.
Источник: ночной прогон worfy-mvp 2026-10-05/06.

## Исполнитель первым делом входит в свой worktree

Hook инструментов Edit и Write пускает только в дерево Session. Агент, запущенный из worktree
Orchestrator-а, не может править файлы в `.claude/worktrees/<NN>`, пока не сделает `EnterWorktree`
с `path` своего worktree. Без этого агенты обходили hook правками через python и sed в Bash.
Источник: worfy-mvp/02, worfy-mvp/10.

## Ручные проверки GUI агент может делать сам — по одному и только в окне приложения

Когда выданы права Screen Recording и Accessibility, агент проверяет GUI сам. Правила: строго
один такой агент за раз; клавиши — только во фронтальный процесс приложения и только после
проверки, что он фронтальный; снимки — только окна приложения, не всего экрана; системные
настройки не трогать. Без этих прав пункт остаётся `[ ]` со строкой «не проверено: …».
Источник: ночной прогон worfy-mvp 2026-10-05/06.

## Настоящий Claude Code в test-е пишет в `~/.claude`

Запуск настоящего Claude Code или Agent SDK пишет транскрипты в `~/.claude/projects`. Это запись
в `~/.claude`, даже если код Ticket-а сам туда не пишет. Бриф исполнителя явно говорит, разрешена ли
такая запись; без этого агент либо нарушает запрет, либо молча пропускает проверку.

Собранный worfy, запущенный напрямую (`_electron.launch` или `open`), тоже пишет в `~/.claude`: он
поднимает Orchestrator на настоящем Claude Code. Снимки и любые прогоны приложения в Ticket-е —
только через `launchApp` (`test/e2e/helpers.ts:111`): fake-агент, временные `WORFY_DATA_DIR` и
`WORFY_CLAUDE_HOME`, фикстуры вместо настоящих Project-ов (worfy-daily/11, PR #64).
Источник: ночной прогон worfy-mvp 2026-10-05/06.

## Таймаут `firstWindow` при параллельных e2e — это нагрузка, а не красный test

Когда несколько агентов одновременно гоняют Playwright с Electron, Electron не доходит до
`app ready` за 30 с — даже пустое приложение стартует 25+ с. Ошибка выглядит как красный test
(`firstWindow` timeout), хотя код ни при чём. Такой таймаут сначала повторить в одиночку, потом
чинить. Копия `Electron.app` в `/tmp` ради изоляции тоже замедляет первый запуск — не делать её.
Правило и путь общего замка для e2e и `gate full` — `rules.md` Profile-а worfy.
Источник: worfy-daily Wave 6.

## Заблокированный экран macOS — одна из причин таймаута первого окна в e2e

Пока экран Mac заблокирован, Electron не показывает окно, и `launchApp` падает с «the window was not
shown within 30 s» (`test/e2e/helpers.ts:167`) — даже на чистом main. Ошибка выглядит как красный
test, хотя код ни при чём. Вторая известная причина того же таймаута — параллельные e2e (урок
выше). Перед e2e и `gate full` проверить `ioreg -n Root -d1 | grep -o '"IOConsoleLocked" = [A-Za-z]*'`:
при `Yes` прогон не запускать, а уже упавший — не считать красным и повторить после разблокировки.
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
Источник: PR #179.

## Ночной прогон Autopilot: Mac не заблокирован, крышка открыта

Прогон 3 Autopilot вечером 2026-10-06 держал только `prevent-app-suspension`: экран гас, macOS его
блокировала, Electron переставал показывать окно, и `gate full` Ticket-ов 24 и 28 ждал, пока человек
разблокирует Mac (e2e идут только локально — урок о CI в `ci-merge.md`). Теперь прогон держит
`prevent-display-sleep` (ADR-0034), но ручную блокировку и закрытую крышку не обходит: на ночь Mac
разблокирован, крышка открыта (README, раздел «Stable copy»).
Код: `src/main/autopilot/power.ts`. Источник: worfy-daily/32, PR #70.

## Конец хода Orchestrator-а — не конец Wave: Subagent-ы Wave живут как background task-и

Skill `/epic-wave` запускает implementer-ов Subagent-ами с `run_in_background` и кончает ход, а Wave
идёт дальше. Первый прогон Autopilot (2026-10-06, 10:17Z) счёл конец хода концом Wave: через 85 с —
`no-progress`, Session Orchestrator-а закрылась, и с процессом Claude Code погибли четыре Subagent-а.
Кто смотрит на Session извне, судит о конце её работы по живым background task-ам (событие SDK
`system/background_tasks_changed`), а не по `result` хода или `idle`. Правило — ADR-0029.
Код: `src/shared/agent/background-tasks.ts`, `src/main/autopilot/run.ts`. Источник: worfy-daily/29, PR #41.

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
Источник: PR #150.

## Worktree и ветку влитого Ticket-а удалять сразу после мержа

После Wave 6 плана деревья влитых Ticket-ов остались, и Epic показывал «3 in work». worfy накладывает
Status ветки живого worktree на checkout, пока в checkout-е не `done` и не `blocked` (ADR-0033), так
что старая ветка в живом дереве — ложный сигнал «в работе». Правило: влит PR Ticket-а или документный
PR Wave — сразу `git worktree remove` и `git branch -D` (`~/.claude/skills/epic-wave/SKILL.md`,
«4. Мерж по политике», «Уборка после мержа»).
Код: `applyBranches` в `src/main/workflow/reader.ts`. Источник: worfy-daily Wave 6; коммит `~/.claude` ec8412c.
