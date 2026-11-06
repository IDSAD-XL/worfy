# 61 — Run не считает живую долгую фоновую задачу зависшей

Type: task
Status: open
Blocked by: —
Source: приёмка [worfy-windows 16](../../worfy-windows/issues/16-приёмка-worfy-windows.md), пункт 9

## Что происходит

- На Windows-ПК владельца 2026-11-06 Run Autopilot `2026-11-06T11-47-32-575Z-bc80b1` (Epic worfy-polish, Ticket 48)
  остановился в 16:15:10Z событием `run-stopped` с причиной `background-stalled`.
- В этот момент его единственная background task (работа, которую Session запустила и не ждёт в своём ходе) — «Run
  full gate on main merge commit», gate full с `GATE_SCOPE=all`, начата около 15:14Z — была жива и шла на шаге e2e.
- Gate full на Windows идёт дольше часа: в тот день — 3725 s.
- Причина: Run считает background task зависшей, если за `BACKGROUND_STALL_MS` = 60 min от неё не пришло ни одного
  события (`src/shared/autopilot/cycle.ts:80`, [ADR-0029](../../../docs/adr/0029-autopilot-waits-for-background-tasks.md)).
  Одна долгая task, которая молча работает, событий не шлёт и выглядит так же, как зависшая.
- [worfy-autopilot-queue 08](../../worfy-autopilot-queue/issues/08-остановка-ошибкой-сразу-отдаёт-session.md)
  (PR #1512, в review) после такой остановки отдаёт Session на месте, не перезапуская её. Это смягчает последствия,
  но не убирает ложную остановку.

## Что делаем

1. Отличить живую долгую task от зависшей. Варианты для implementer-а — выбрать с доказательством в «Итог»:
   - признак жизни от самой task: растёт её output file, жив её процесс или дерево процессов;
   - или Wave запускает gate full не одной молчащей task, а так, чтобы события шли (например, по шагам).
2. Просто поднять `BACKGROUND_STALL_MS` — не решение: зависшая task тогда держит Run ещё дольше.
3. Зависшая task (нет ни событий, ни признака жизни) по-прежнему останавливает Run с `background-stalled`.
4. Если меняется правило ADR-0029 — новый ADR или правка в нём, и `docs/features/autopilot.md` с переводом.

Глубина review — `medium`. Платформенный, если признак жизни читает процессы ОС: Windows-часть — на ПК.

## Готово, когда

- [ ] Contract test: task без событий дольше `BACKGROUND_STALL_MS`, но с признаком жизни — Run ждёт и не
      останавливается. До правки — красный (`background-stalled`).
  - evidence: test-run pass · `pnpm exec vitest run test/contract/autopilot-background.test.ts -t "worfy-polish ticket 61"` exit 0; red before the fix (2 of 4 failed on origin/main run.ts) · mac - · 038f946096b6ea6f91a9c35ba88942ca0c30785d
  - evidence: test-run pass · `pnpm exec vitest run test/contract/autopilot-background.test.ts -t "worfy-polish ticket 61"` exit 0, six runs; red on origin/main run.ts (2 of 4 failed) · mac - · 59ab5f28243a1bc4fac78c35b222a949911161d7
- [ ] Contract test: task без событий и без признака жизни дольше `BACKGROUND_STALL_MS` — Run останавливается с
      `background-stalled`, как раньше.
  - evidence: test-run pass · `pnpm exec vitest run test/contract/autopilot-background.test.ts -t "worfy-polish ticket 61"` exit 0 · mac - · 038f946096b6ea6f91a9c35ba88942ca0c30785d
  - evidence: test-run pass · `pnpm exec vitest run test/contract/autopilot-background.test.ts -t "worfy-polish ticket 61"` exit 0, six runs · mac - · 59ab5f28243a1bc4fac78c35b222a949911161d7
- [ ] Все unit и contract test-ы `src/shared/autopilot/` и `src/main/autopilot/`, `pnpm typecheck`, `pnpm lint`,
      gate fast — exit 0.
  - evidence: gate pass · `gate fast` exit 0; `pnpm lint` exit 0; `pnpm typecheck` exit 0; `vitest run` of 52 autopilot unit and contract files exit 0 · mac - · 038f946096b6ea6f91a9c35ba88942ca0c30785d
  - evidence: gate pass · `gate fast` exit 0 · mac - · 59ab5f28243a1bc4fac78c35b222a949911161d7

## Где в коде

- `src/shared/autopilot/cycle.ts:80` — `BACKGROUND_STALL_MS`; причина `background-stalled` — `:62`.
- `src/main/autopilot/run.ts` — ожидание background task-ов Run-а.
- `docs/adr/0029-autopilot-waits-for-background-tasks.md`

## Итог

Ветка `worfy-polish/61`, base `origin/main` `8795a17d2`.

**Признак жизни — изменение output file задачи (п. 1), процессы ОС не читаются.** Доказательство, что его хватает:

- Bash в фоне событий не шлёт: у SDK `task_progress` идёт только у Subagent-ов и `mcp_task`
  (`SDKTaskProgressMessage` в `@anthropic-ai/claude-agent-sdk/sdk.d.ts`), а `task_started` пути к файлу не несёт.
  Путь называет tool result, который задачу запустил: «Command running in background with ID: <id>. Output is being
  written to: …/tasks/<id>.output. …» (так в транскриптах Claude Code этого Mac). Claude Code пишет туда вывод по ходу.
- gate full пишет в stdout строку `[gate] time (<profile>): <step> <s> s` в конце каждого шага
  (`harness/hooks/gate.mjs`, `say(stepLine(…))` после каждого script-а; `say` — `process.stdout.write`), а вывод
  самих script-ов копит до их конца. Wave запускает его без фильтра: `node gate.mjs full </dev/null; echo "EXIT=$?"`
  (skill `epic-wave`, `ship-ticket/step-11-close.md`), так что строки сразу попадают в output file задачи.
- Шаги gate full на ПК (простаивающем, `worfy-windows` 16): lint 47.8 s, typecheck 61.8 s, test 1553.4 s, e2e
  2009.5 s, package 201.6 s. Самый долгий — около 34 минут, меньше предела в 60 минут. В Run-е `bc80b1` gate начат
  около 15:14Z, остановка — 16:15:10Z на шаге e2e: строка о конце шага test легла в файл примерно в 15:45Z, и с
  правкой предел начался бы заново, а gate кончился в 16:17Z.

**Как устроено.** `src/main/autopilot/task-output.ts`: `taskOutputFiles` достаёт из текста tool result абсолютные пути
`…/tasks/<id>.output` (POSIX, диск Windows, UNC; путь с пробелами — от последнего «: »), `outputMarks` снимает
размер и mtime файлов живых задач (`statSync`: метка — того самого момента), `outputChanged` сравнивает метки.
`run.ts`: tool result-ы Session-а пополняют `taskOutputs` Run-а; `tasksTimer` при установке предела снимает метки
файлов живых задач, а когда предел вышел (после проверки запросов в park), снимает их ещё раз: файл изменился —
предел заново, нет — `tasks-timeout` и `background-stalled`, как раньше (п. 3). `BACKGROUND_STALL_MS` не менялся (п. 2).

**Цена и что не закрыто.** Проверка идёт раз в предел, поэтому задача, которая перестала писать, держит Run меньше
двух пределов от последней записи, а не один. Шаг gate full дольше часа без вывода по-прежнему останавливает Run.
Если Claude Code сменит текст tool result-а, путь не найдётся, и Run поведёт себя как до правки (остановится).

**Решено без владельца.** Признак — output file, а не дерево процессов: PR не платформенный, gate full на ПК не нужен.
Правка правила — раздел `## Amendments` в ADR-0029, не новый ADR (п. 4). `docs/features/autopilot.md` и перевод
`docs/features/ru/autopilot.md` — абзац об ожидании задач и строка `background-stalled` в таблице причин.

**Test-ы.** `test/contract/autopilot-background.test.ts`, describe «a live background task that sends no events is not
stalled while its output file changes (worfy-polish ticket 61)»: gate пишет строку на шаг — Run переживает предел
дважды и кончает Wave по task-notification (до правки — красный: Run стоял `background-stalled`); файл не менялся —
`background-stalled` с задачей `local_bash` в `run-stopped`; писал и перестал — остановка на первом пределе без
изменения (до правки — красный); файла нет — остановка. `test/unit/autopilot-task-output.test.ts` — разбор путей,
метки, сравнение.
