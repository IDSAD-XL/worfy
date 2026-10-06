# 0035 — Subagent-ы workflow-скриптов висят в дереве под вызовом Workflow
Дата: 2026-10-07. Статус: принят.

**Контекст.** Wave в Autopilot идёт через workflow-скрипт (инструмент `Workflow` Claude Code), и
его агенты в дерево Subagent-ов не попадали: `SubagentReader` читал только
`<sessionId>/subagents/agent-*`, а агенты workflow-скрипта лежат глубже. Разбор настоящих файлов
(Ticket 17 worfy-daily, «Итог»; `~/.claude/projects` на 2026-10-07, 104 каталога `wf_*`) показал:

- Агенты одного запуска (run) лежат в `<sessionId>/subagents/workflows/<runId>/`: `agent-<id>.jsonl`,
  `agent-<id>.meta.json` и `journal.jsonl`. Глубже каталогов нет.
- `meta.json` такого агента — `{"agentType":"workflow-subagent","spawnDepth":1}`; в новых версиях
  ещё `description` (метка вида `impl:03`), `workflowPhase`, `requestShape`. `agentType` бывает и
  обычным (`Explore`). **`toolUseId` и `parentAgentId` нет ни у одного** — вывод Ticket-а 09
  worfy-mvp подтвердился.
- `journal.jsonl` — записи `started` (`agentId`, `key`; в новых версиях `label` и `phase`),
  `result` (`agentId`, `result` — текст или объект), `failed` (`agentId`) и `launched` без агента.
- Связь с Session — вызов `Workflow` в её транскрипте. Его `tool_result` — текст «Workflow launched
  in background. Task ID: … Summary: … Transcript dir: …/subagents/workflows/<runId> … Run ID:
  <runId>»; `toolUseResult` повторяет `runId`, `taskId`, `workflowName`. Конец запуска —
  task-notification с `tool-use-id` этого вызова (как у фонового Subagent-а, ADR-0030).
- Повторный вызов с `resumeFromRunId` пишет в тот же `<runId>`: у одного запуска бывает несколько
  вызовов.
- Последняя запись агента workflow-скрипта — обычно ответ на `StructuredOutput`, а не
  `stop_reason: end_turn`: по транскрипту агента его конец не виден.

**Решение.**

1. **Запуск workflow-скрипта — одна запись дерева, агенты — её дети.** Запись типа `workflow`
   (`subagentType: 'workflow'`), имя — `meta.name` встроенного скрипта или имя файла скрипта без
   `-<runId>.js`, иначе `runId`; описание — строка `Summary:` результата вызова. У записи нет
   `agentId` и транскрипта. Агенты запуска — дети этой записи на глубине 2; обычные Subagent-ы
   Session остаются как были.
2. **Связь — по `runId`.** Результат вызова `Workflow` называет `Run ID:` (или каталог в
   `Transcript dir:`), имя каталога агента — тот же `runId`. Из нескольких вызовов одного `runId`
   (возобновление) запуск представляет последний, прежние не показываются. Каталог без известного
   вызова (транскрипт Session обрезан, вызов из другого места) — всё равно одна запись
   `workflow:<runId>`, чтобы агенты держались вместе; она `running`, пока бежит хоть один агент,
   `error`, если агента оборвали, иначе `done`.
3. **Статус агента — по журналу запуска.** `result` — `done`, `failed` — `error`. Без записи агент
   `running`, пока бежит и запуск, и Session; кончился запуск (task-notification или ошибка вызова)
   или закрылась Session — `error`, как у оборванного Subagent-а (ADR-0031). Имя агента — `label`
   журнала, если в `meta.json` нет `name`; итог — текст `result` журнала (или его `summary`).
4. **Чтение — фиксированной глубины и инкрементально.** Читается ровно
   `subagents/workflows/wf_*/` (не больше 200 запусков на Session), ничего глубже и ничего с другим
   именем. Транскрипты агентов и `journal.jsonl` дочитываются с курсора (`tail.ts`): повторный
   запрос стоит дописанных байт (`SubagentReader.bytesRead`, contract test). Транскрипт агента
   открывается тем же `claudeHome.subagentTranscript`: `subagentTranscriptPath` ищет его и в
   каталогах запусков.

Рисование не меняется: запись `workflow` — такой же Node Subagent-а (`SubagentNode`), колонка
рамок Epic-ов обходит его, как любое дерево (ADR-0032).

**Последствия.** Wave Autopilot-а видна на Canvas: запуск и его агенты, с готовыми, свёрнутыми в
«N done». Первый показ дерева самой большой Session Auction с workflow-скриптами (30 записей запусков,
672 файла, 628 MB вместе с обычными Subagent-ами) — около 1 с, повторный — 27 мс и 702 байта.
`~/.claude/projects/*/<sessionId>/workflows/wf_*.json` (итог запуска с метками всех агентов) не
читается: его mtime на файлах Auction совпадает с концом запуска, и он несёт текст скрипта.

## Considered Options

- **Агенты под вызовом `Workflow` одной записью запуска** — выбрано: видно, какой запуск их
  породил, у запуска свой статус, а деревья Session из нескольких Wave не сливаются в один список.
- **Плоская группа агентов в корне дерева.** Проще, но у самой большой Session Auction 633
  агента workflow-скриптов в 29 каталогах запусков: без группировки это неразличимый список, и не видно,
  какой запуск ещё идёт.
- **Отдельный тип Node для запуска.** Даёт свой вид, но требует правки Canvas, раскладки и рамок
  (ADR-0032) ради того, что уже умеет `SubagentNode`; отложено, пока не нужно своё поведение.
- **Статус агента по его транскрипту (`end_turn`).** Не работает: агенты workflow-скрипта кончают
  вызовом `StructuredOutput`, а не `end_turn`, и висели бы `running` до закрытия Session.
- **Читать `<sessionId>/workflows/wf_*.json`.** В нём метки агентов и для старых журналов, но, судя по mtime, он
  появляется только в конце запуска, весит до 870 KB из-за текста скрипта и логов и лежит вне `subagents/`.
