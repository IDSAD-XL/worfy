# 40 — Flight Recorder по Run-ам Codex

Type: task
Status: open
Blocked by: 34, 37
Source: [spec.md](../spec.md), «Цель и что видит пользователь» (второй выпуск); решение 07 ([07-что-получает-codex.md](07-что-получает-codex.md)); spec Epic-а `worfy-flight-recorder` ([spec.md](../../worfy-flight-recorder/spec.md), «Источники»)

## Что происходит

- Flight Recorder берёт ходы Orchestrator-а и spans агентов из транскриптов Claude
  (`src/main/flight-recorder/transcripts.ts:1-10`, факты — `src/shared/flight-recorder/from-transcript.ts`):
  вызовы `Agent` с именем `impl-NN`, `SendMessage`, `task-notification`.
- У Codex агенты — thread-ы sub-агентов (Ticket 34), вызовы — `spawn_agent` / `send_message` / `followup_task`.

## Что делаем

1. Для Run с `vendor: codex` (Ticket 37) транскрипт Orchestrator-а и sub-агентов читается через `history.read`
   driver-а Codex, а не из `~/.claude/projects`.
2. Факты из событий: начало и конец span агента по `spawn_agent` и концу thread-а sub-агента; доработка
   `send_message` / `followup_task` — второй span.
3. Run на Claude — как сейчас.

## Готово, когда

- [ ] Contract test (фейк, Run на Codex с двумя sub-агентами): шкала Run с двумя spans агентов и ходами
      Orchestrator-а.
- [ ] Test-ы Flight Recorder на Claude проходят без правок ожиданий.
- [ ] `pnpm typecheck`, `pnpm lint`, test-ы Flight Recorder — exit 0.

## Где в коде

- `src/main/flight-recorder/transcripts.ts`
- `src/shared/flight-recorder/from-transcript.ts`
- `test/contract/flight-recorder-transcripts.test.ts`

## Итог

- Выбор читателя (`src/main/flight-recorder/transcripts.ts`): `TranscriptRun.vendor` берётся из `run-started.vendor`
  (`src/shared/flight-recorder/from-journal.ts`, поле `vendor` у `JournalFacts`; Vendor, которого сборка не знает, читается
  как его отсутствие). Run без `vendor` или с `UNNAMED_VENDOR` читается как раньше — файлы Claude home. Run другого Vendor-а —
  через `vendorDriver(vendor).history` (`src/main/vendors/registry.ts`): `history.read(wave-started.session, root)` — thread
  Orchestrator-а, затем `history.read(<id Subagent-а>, root)` — thread каждого Subagent-а, чей span начался в Wave-ах Run-а,
  по одному (каждое чтение может запустить процесс Codex). Сравнения с именем Vendor-а вне `src/main/vendors/<id>/` нет.
  Service (`src/main/flight-recorder/service.ts`) передаёт `vendor` журнала.
- Факты (`src/shared/flight-recorder/from-transcript.ts`): `TranscriptParse.appendEntries` и `SubagentParse.appendEntries`
  читают записи `TranscriptEntry`. Ход — от сообщения пользователя до самого позднего ответа, tool call или thinking. Span
  агента — от события `subagent` `started` до `finished`; `started` агенту, который уже закончил, — следующий span (`#2`),
  агенту, который ещё работает, — ничего. Prompt агента — первое сообщение его thread-а (Ticket по ветке или пути), отчёт —
  `result` у `finished`, иначе последний ответ его thread-а. Дальше — те же `facts()`, что у Claude.
- Codex history (`src/main/vendors/codex/history.ts`, `codexTranscript`): item-ы про Subagent-ов дают события `subagent`
  вместо `unknown`: `subAgentActivity` started/interacted → `started` (имя — последняя часть `agentPath`), completed →
  `finished completed`, interrupted → `finished stopped`; `collabAgentToolCall` `spawnAgent`, `sendMessage`, `followupTask`,
  `sendInput`, `resumeAgent` → `started`; `wait` и `closeAgent` → `finished` с состоянием и ответом из `agentsStates`;
  `interruptAgent` → `finished stopped`; неудачный `spawnAgent` → `finished failed`. Каждая запись — со временем своего
  item-а (`startedAtMs` у сообщения пользователя и tool call, `completedAtMs` у остального), без него — со временем начала
  turn-а, как раньше.
- Сценарий фейка `test/fixtures/codex-scripts/flight-recorder-run.jsonl`: thread Orchestrator-а (два хода, два Subagent-а,
  `interacted` второму после его конца) и thread-ы обоих Subagent-ов. Форма thread-ов Subagent-ов — как у thread-а Session
  (`source` строкой, без `parentThreadId` и `agentNickname`): для `thread/read` у живой записи нет формы Subagent-а, а
  `codexTranscript` эти поля не читает; новых исключений в `test/contract/codex-compat.test.ts` нет.
- Test-ы: `test/contract/flight-recorder-transcripts.test.ts` (Run на Codex через `codexHistoryPart` на фейке: два Subagent-а
  — три span-а агентов с `#2`, два хода Orchestrator-а, Claude home не читается; Wave без thread-а — `transcript deleted`;
  Run без `vendor` и с `claude` — прежнее чтение файлов), новые случаи в `test/unit/flight-recorder-transcript.test.ts`,
  `test/unit/codex-history.test.ts`, `test/unit/flight-recorder-journal.test.ts`. Test-ы Run-ов Claude — без правок ожиданий.
- Решено без владельца, подтвердить:
  - имя агента `impl_NN`, `verify_NN` (с подчёркиванием, как его может назвать путь агента Codex) даёт Ticket и подвид так
    же, как `impl-NN` (`AGENT_NAME_TICKET`, `agentSubkind` в `src/shared/flight-recorder/spans.ts`); для Claude это меняет
    только агентов с таким именем;
  - Run на Codex читается целиком при каждом пересчёте (без tail и без сохранённого разбора), а живой Run пересчитывается,
    когда растёт Journal, а не thread Codex: у history Codex нет чтения «с места остановки»;
  - Wave, thread которой Codex не прочитал (нет thread-а или Codex не ответил), — `transcript deleted`, как удалённый
    транскрипт Claude: отдельной метки для «Codex не ответил» нет;
  - в истории Session Codex (Resume) item-ы про Subagent-ов теперь видны строками Subagent-ов, как у Claude, а не
    скрыты как `unknown`.
