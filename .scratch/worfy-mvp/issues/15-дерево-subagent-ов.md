# 15 — Дерево Subagent-ов у Сессии: тип, модель, статус, итог; сделанные сворачиваются

Type: task
Status: done 2026-10-05
PR: #26
Blocked by: 14
Source: [CONTEXT.md](../../../CONTEXT.md), термин «Subagent»; [BRIEF.md](../../../docs/design/BRIEF.md), Screen 1 пункт 2 и Screen 2 «Subagent tree»; «Итог» тикета 09

## Что делаем

- `src/shared/transcript/subagents.ts` — чистая функция: по событиям Сессии и файлам
  `subagents/agent-<id>.meta.json` строит дерево Subagent-ов. Узел дерева: `agentId`, имя,
  `subagent_type`, модель, описание, статус (`running`, `done`, `error`), время старта и
  длительность, первая строка итога (у reviewer-а это `VERIFIED` или `REJECTED`). Вложенные
  Subagent-ы — дети своего родителя (`spawnDepth`). Связь запуска с файлом — через `tool_use` id и
  `toolUseResult.agentId`, завершение фонового — через task-notification.
- Работает для обоих источников: живой Сессии worfy (события `subagent` из 07 плюс те же файлы) и
  внешней Сессии.
- На Холсте Узлы Subagent-ов стоят справа от своей Сессии, рёбра дерева
  (`edges/subagents.ts`). Сделанные сворачиваются в строку «N done» под родителем; раскрываются
  щелчком. Щелчок по Subagent-у открывает его транскрипт в Session view, только для чтения.
- Правая панель Session view: `rail/SubagentsRail.tsx` — то же дерево списком со статусами.
- Положение Узлов Subagent-ов автоматическое; ручной сдвиг сохраняется, как у Тикетов.

## Готово, когда

- [x] Fixture с тремя Subagent-ами, один вложенный, один фоновый: дерево совпадает с ожиданием (тип, модель, статус, итог).
- [x] Subagent, ещё работающий, показан `running` с идущим временем; после task-notification — `done` и сворачивается.
- [x] Reviewer с итогом `REJECTED` показан с этим словом на Узле.
- [x] Щелчок открывает транскрипт Subagent-а только для чтения.
- [x] Узел Subagent-а появляется на Холсте ≤ 500 мс после события `subagent` (fake-агент; e2e мерит от записи события до появления Узла).
- [x] Сессия Auction с 20+ Subagent-ами: дерево построено и показано ≤ 1 с после открытия Сессии (число в «Итог»).

## Тесты

- `test/unit/subagents.test.ts` — построение дерева по fixtures 09 и по событиям fake-агента (новый).
- `test/e2e/subagent-tree.spec.ts` — Узлы, сворачивание, переход в транскрипт (новый).
- Сначала падающий test: `subagents.test.ts` на вложенного Subagent-а.

## Где в коде

- `src/shared/transcript/subagents.ts`
- `src/renderer/canvas/nodes/SubagentNode.tsx`
- `src/renderer/canvas/edges/subagents.ts`
- `src/renderer/session/rail/SubagentsRail.tsx`

## Итог

**Сделано.**

- `src/shared/transcript/subagents.ts` — чистое построение дерева. Вход — «сигналы» (вызов Agent,
  его результат, `subagent started`, task-notification) из событий Сессии и сводка файлов каждого
  Subagent-а (`meta.json` и его транскрипт: модель, время первой и последней записи, последний ответ,
  закончен ли ход, свои вызовы Agent). Узел дерева: `agentId`, имя, тип, модель, описание, статус
  (`running`, `done`, `error`), фоновый ли, время старта и длительность, первая строка итога и вердикт
  `VERIFIED`/`REJECTED`, глубина, дети. Один и тот же Subagent, названный разными источниками
  (`toolUseId` вызова, `agentId` результата, `meta.toolUseId`, task-notification), сливается в один узел.
  Узел помнит все id, по которым его нашли; если id живого `task_started` и id файлов разные, узел
  называется id файлов: по нему открывается транскрипт и ищется родитель по `meta.parentAgentId`.
- main: `src/main/claude-home/subagents.ts` читает транскрипт Сессии и папку `subagents/` с курсором
  по каждому файлу (повторный запрос дочитывает только новое); каналы `claudeHome.subagents` и
  `claudeHome.subagentTranscript` (`src/shared/ipc/claude-home.ts`, `src/main/ipc/claude-home.ts`).
- renderer: `src/renderer/claude-home/subagents.ts` — общее хранилище деревьев по Сессиям: файлы из main
  плюс живые события Сессии worfy (`session/store.ts`). Перечитывает по `claudeHome.changed` транскрипта
  Сессии и раз в 2 с, пока кто-то `running`.
- Холст: источник Узлов `src/renderer/canvas/sources/subagents.ts`, Узел `nodes/SubagentNode.tsx`
  (`kind = 'subagent'`), линии `edges/subagents.ts`. Правая панель: `session/rail/SubagentsRail.tsx`.
  Транскрипт Subagent-а — `ExternalSessionPanel.tsx` с `agentId` (навигация `external.agentId`).

**Сначала падающий test.** `test/unit/subagents.test.ts` на вложенного Subagent-а Сессии 5555 упал при
загрузке: модуля `src/shared/transcript/subagents` ещё не было (`Test Files 1 failed`, `no tests`).

**Числа.**

- Узел Subagent-а на fake-агенте появился через 38 мс после сообщения, которое его запускает
  (`test/e2e/subagent-tree.spec.ts`, порог 500 мс; событие `task_started` идёт сразу за сообщением).
- Синтетическая Сессия с 24 Subagent-ами (24 файла по 422 KB): дерево на Холсте через 5 мс после
  Узла Сессии, в правой панели — через 37 мс после двойного щелчка (e2e, порог 1 с). Contract test:
  24 × 400 KB прочитаны и дерево построено за 12 мс (порог 1 с).
- Настоящий `~/.claude`, только чтение, пять Сессий Auction с наибольшим числом Subagent-ов (скрипт в
  scratchpad, `SubagentReader` + `buildSubagentTree`): 151 Subagent (83 MB) — 281–312 мс первое чтение,
  14–20 мс повторное; 109 (88 MB) — 186–297 мс; 104 (113 MB) — 243–295 мс; 102 (39 MB) — 92–107 мс.
  Повторное чтение 5–20 мс. Вердиктов найдено 40 из 109 и 49 из 104.

**Неочевидные решения.**

- Узлы Subagent-ов — не Узлы Раскладки, а источник Узлов, как Тикеты (`sources/epics.ts`): дерево
  вычисляется из транскрипта, а ручной сдвиг хранится в одном Узле Раскладки вида `subagent-tree` на
  Сессию (`subagents:<sessionId>`, `data["offset:<ключ>"] = {dx, dy}`). Виды `subagent` и
  `subagent-tree` добавлены в `SOURCE_NODE_KINDS` и `isSourceNodeId` (`src/shared/layout/derived.ts`):
  MCP-инструменты холста их не видят, авто-раскладка их не учитывает. Отказ MCP-сервера холста на id
  Subagent-а говорит, что это Subagent Сессии (а не Epic frame или Тикет), и `agent-instructions.md`
  называет Узлы Subagent-ов.
- Узлы Subagent-ов — дети Узла Сессии в React Flow (`parentId`): двигаются вместе с ним. У Узла
  Сессии и Оркестратора нет handle, поэтому линии дерева начинаются у невидимого «якоря» на правом
  краю Узла Сессии (Узел того же вида с `variant: 'anchor'`); `SessionNode.tsx` и
  `OrchestratorNode.tsx` не правились (первый правит тикет 18 в этой же волне).
- Узлы Subagent-ов не выделяются (`selectable: false`): панель выделения (Pin, теги) работает с Узлами
  Раскладки, а эти ими не являются. Сдвиг мышью работает.
- Сворачивание «N done» — у каждого родителя (Сессии и Subagent-а) своя строка; раскрытие не
  сохраняется (как стопка done у Эпика). `error` не сворачивается.
- Статус: task-notification решает (`completed` — done, иначе error); результат синхронного вызова —
  done (ошибка вызова — error); фоновый ждёт task-notification; без них — done, если файл Subagent-а
  кончается ответом с `end_turn`; `meta.stoppedByUser` — error; иначе running. Итог — `<result>`
  notification, текст результата синхронного вызова, последний ответ из файла; первая строка без
  markdown-разметки (`#`, `>` в начале; `**x**`, `__x__`, `*x*` в любом месте строки).
- Когда меняется набор Сессий на Холсте, `useSubagentTrees` отпускает Сессии старого списка
  микрозадачей после того, как effect взял новый список: Сессия, оставшаяся в списке, сохраняет
  дерево и курсор чтения и не перечитывается.
- Время живых событий (у SDK-событий его нет) — момент, когда renderer впервые увидел событие.
- Связь вложенного в живой Сессии — `parentToolUseId` вызова Agent; в файлах — `meta.parentAgentId`,
  иначе транскрипт родителя, где лежит вызов.
- Правая панель показывается и у Сессии, начатой вне worfy (`ExternalSessionPanel.tsx`): она рисует
  её через `src/renderer/session/SessionRail.tsx`, а `RailBlockProps` получил `claudeSessionId` (id
  файлов Сессии под `~/.claude`; без него берётся `sessionId`). `sessionId` у внешней Сессии
  остаётся null — он для каналов `agent.*`. `SessionView.tsx` правится одной строкой (передать
  `agentId` и блоки панели в `ExternalSessionPanel`) и пока держит свою копию `SessionRail`: тикеты
  18 и 19 той же волны правят импорты и соседние строки этого файла, и перенос давал конфликт
  слияния. Копию заменить импортом из `SessionRail.tsx` после их мержа.
- Fixture «три Subagent-а» — новая синтетическая Сессия 7777 в отдельной папке
  `projects/-Users-test-projects-agents/` (не в папке demo: test-ы 13 и 14 считают её Сессии).
  fake-сценарий — `test/fixtures/agent-scripts/subagents.jsonl`.
- Правки вне следа, без которых не обойтись: `src/shared/ipc/claude-home.ts`,
  `src/main/ipc/claude-home.ts`, `src/main/claude-home/subagents.ts` (новый),
  `src/renderer/claude-home/subagents.ts` (новый), `src/renderer/claude-home/useClaudeHome.ts`
  (транскрипт Subagent-а, опрос раз в 2 с), `src/renderer/canvas/sources/subagents.ts` (новый),
  `src/shared/layout/derived.ts`, `src/renderer/session/{navigation.ts,ExternalSessionPanel.tsx,
  SessionView.tsx,SessionRail.tsx,rail/index.ts}`, `src/main/mcp/canvas-server.ts` и
  `src/main/mcp/agent-instructions.md` (текст отказа и инструкция про Узлы Subagent-ов), список
  каналов в `test/contract/claude-home-registry.test.ts`, test-ы Узлов Subagent-ов в
  `test/contract/canvas-tools.test.ts` и `test/unit/layout-place.test.ts`.

**Не сделано и почему.**

- Subagent-ы workflow-скриптов (`subagents/workflows/wf_*/`) в дерево не входят: тикет называет только
  `subagents/agent-<id>.*`.
- Файлы Subagent-ов продолженной Сессии, оставшиеся у исходного `sessionId` (вывод 09, 467 случаев),
  не ищутся: такой Subagent виден по вызову Agent из транскрипта, без модели и транскрипта.
- Фоновый Subagent, для которого task-notification так и не пришла (Сессия закрыта, Subagent прерван
  без `stoppedByUser`), остаётся `running`: на данных Auction это 13 из 109 и 11 из 102. Нужен признак
  живости Сессии — отдельный тикет.

Проверено 2026-10-06 ночью: вид на настоящей Session Claude Code с Subagent-ами в живом приложении —
подраздел [«Ручная проверка 2026-10-06, ночь»](#ручная-проверка-2026-10-06-ночь).

### Ручная проверка 2026-10-06, ночь

Сборка `main` @ 92c00a5, проверял агент. Режим Б: собранный `worfy.app`, запущенный через
LaunchServices с окружением launchd, настоящий Claude Code с входом владельца. Session a5e24075 на
`claude-opus-5-5[1m]`, Permissions bypass. Снимки лежат в scratchpad Session оркестратора, в репозиторий не положены.

**Дерево Subagent-ов на настоящей Session — проверено (проверка 28 гайда).**

- Промпт из гайда, сразу переход на Canvas. Через ~3 с справа от Node-а Session — два Node-а Subagent-ов
  «Explore | running 4s | Explore · claude-opus-5-5 | Transcript» с задачами про `canvas-server` и
  `notify`, от Session к ним линии.
- По окончании оба свернулись в «› 2 done»; щелчок развернул «Explore ✓ done 9s» и «Explore ✓ done 12s».
- В Session view блок «Subagents» с теми же двумя строками. Щелчок по строке и кнопка «Transcript» на
  Node-е открывают транскрипт Subagent-а только для чтения («Read-only: Subagent transcript»).
- На диске `subagents/agent-*.jsonl` и `.meta.json` для обоих. `git status --porcelain` основного
  checkout пуст до и после.
- Попутно: Node-ы Subagent-ов и «2 done» ставятся вплотную справа от Session поверх Card «Вопрос» —
  свободное место не ищется.
- Снимки: `28-03-canvas-running.png`, `28-04-canvas-2done.png`, `28-05-canvas-expanded.png`,
  `28-06-session-view-subagents.png`, `28-07-subagent-transcript-row.png`,
  `28-08-subagent-transcript-node-button.png`.

### Долги из HANDOFF (2026-10-08)

- [low] Корректность: `summaryLine` в `src/shared/transcript/subagents.ts` снимал выделение `__x__` в
  любом месте строки и портил имена вида `__init__` в итоге Subagent-а. Меняется только показанный текст;
  поиск вердикта `VERIFIED`/`REJECTED` не задет. `worfy-week` 12 сузил правило до границ слова, как в
  CommonMark (`subagents.ts:404`): `mcp__qmd__get` теперь цел, а отдельное `__init__` по-прежнему
  показывается как «init».
