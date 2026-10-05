# 15 — Дерево Subagent-ов у Сессии: тип, модель, статус, итог; сделанные сворачиваются

Type: task
Status: claimed — 2026-10-05
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
  MCP-инструменты холста их не видят, авто-раскладка их не учитывает.
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
  markdown-разметки.
- Время живых событий (у SDK-событий его нет) — момент, когда renderer впервые увидел событие.
- Связь вложенного в живой Сессии — `parentToolUseId` вызова Agent; в файлах — `meta.parentAgentId`,
  иначе транскрипт родителя, где лежит вызов.
- Правая панель показывается и у Сессии, начатой вне worfy (`ExternalSessionPanel.tsx`); для этого
  `SessionRail` вынесен в `src/renderer/session/SessionRail.tsx`, а `RailBlockProps` получил
  `claudeSessionId` (id файлов Сессии под `~/.claude`). `sessionId` у внешней Сессии остаётся null —
  он для каналов `agent.*`.
- Fixture «три Subagent-а» — новая синтетическая Сессия 7777 в отдельной папке
  `projects/-Users-test-projects-agents/` (не в папке demo: test-ы 13 и 14 считают её Сессии).
  fake-сценарий — `test/fixtures/agent-scripts/subagents.jsonl`.
- Правки вне следа, без которых не обойтись: `src/shared/ipc/claude-home.ts`,
  `src/main/ipc/claude-home.ts`, `src/main/claude-home/subagents.ts` (новый),
  `src/renderer/claude-home/subagents.ts` (новый), `src/renderer/claude-home/useClaudeHome.ts`
  (транскрипт Subagent-а, опрос раз в 2 с), `src/renderer/canvas/sources/subagents.ts` (новый),
  `src/shared/layout/derived.ts`, `src/renderer/session/{navigation.ts,ExternalSessionPanel.tsx,
  SessionView.tsx,SessionRail.tsx,rail/index.ts}`, список каналов в
  `test/contract/claude-home-registry.test.ts`.

**Не сделано и почему.**

- Subagent-ы workflow-скриптов (`subagents/workflows/wf_*/`) в дерево не входят: тикет называет только
  `subagents/agent-<id>.*`.
- Файлы Subagent-ов продолженной Сессии, оставшиеся у исходного `sessionId` (вывод 09, 467 случаев),
  не ищутся: такой Subagent виден по вызову Agent из транскрипта, без модели и транскрипта.
- Фоновый Subagent, для которого task-notification так и не пришла (Сессия закрыта, Subagent прерван
  без `stoppedByUser`), остаётся `running`: на данных Auction это 13 из 109 и 11 из 102. Нужен признак
  живости Сессии — отдельный тикет.

не проверено: вид на настоящей Сессии Claude Code с Subagent-ами в живом приложении — агент работает без
входа в Claude Code; то же поведение проверено e2e на fake-агенте и на записях формата 2.1.286, снимки
сделаны Playwright (`subagent-tree-running.png`, `subagent-tree-files.png`, `subagent-transcript.png`
в `test-results/` прогона e2e).
