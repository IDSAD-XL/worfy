# Fixtures: домашний каталог Claude Code

Синтетический `~/.claude` для contract test-ов разбора реестра Сессий и транскриптов (тикет 13).
Записи написаны вручную, тексты и пути выдуманы; форма записей (поля, их вложенность, значения
перечислений) повторяет реальные транскрипты версий, указанных ниже, — сверено командой
`node scripts/spikes/claude-home-survey.ts --skeleton <файл>` (тикет 09, «Итог»). Все пути — под
`/Users/test/`.

Fixtures только читаются. Test, которому нужно что-то дописать (хвост транскрипта, новая запись
реестра), копирует каталог во временный.

## Состав

| Файл | Версия | Что покрывает |
|------|--------|---------------|
| `sessions/41004.json` | 2.1.284 | живая Сессия из терминала (`entrypoint: cli`), `status: busy`, cwd — worktree, `nameSource: derived` |
| `sessions/41005.json` | 2.1.286 | живая Сессия из Claude desktop, `status: idle`, `hostSessionId`, `bridgeSessionId`, `nameSource: user` |
| `projects/-Users-test-projects-demo/1111…1111.jsonl` | 2.1.222 | старая версия: `task_reminder`, `stop_hook_summary` без `durationMs`, `ai-title` и `custom-title`, `queue-operation`, `mode` |
| `projects/-Users-test-projects-demo/2222…2222.jsonl` | 2.1.247 | slash-команда (`<command-name>`), синхронный вызов Agent (`toolUseResult.status: completed`), `hook_success` со `stdout` |
| `projects/-Users-test-projects-demo/2222…2222/subagents/agent-a0000000000000247.jsonl` | 2.1.247 | Subagent без `meta.json`: связь только через `toolUseResult.agentId` |
| `projects/-Users-test-My-Projects-demo-app/3333…3333.jsonl` | 2.1.270 | cwd с пробелом и точкой; `cd` посреди Сессии меняет `cwd` записей, папка остаётся по cwd запуска; `turn_duration`, `file-history-snapshot` |
| `projects/-Users-test-projects-demo--claude-worktrees-07/4444…4444.jsonl` | 2.1.284 | Сессия в worktree: Skill `ship-ticket`, `invoked_skills`, `ticket claim` и вывод `gate.sh` в Bash `tool_result`, Stop hook, `agent-name`, `pr-link` |
| `projects/-Users-test-projects-demo/5555…5555.jsonl` | 2.1.286 | `/epic-wave`, фоновый Agent (`async_launched`), task-notification о завершении, `bridge-session` |
| `projects/-Users-test-projects-demo/5555…5555/subagents/agent-a1000000000000286.*` | 2.1.286 | Subagent глубины 1 (`requestShape: background`); сам вызывает Agent и `ticket claim` |
| `projects/-Users-test-projects-demo/5555…5555/subagents/agent-a2000000000000286.*` | 2.1.286 | вложенный Subagent: `parentAgentId`, `spawnDepth: 2`, `toolUseId` = id вызова в транскрипте родителя |
| `projects/-Users-test-projects-agents/7777…7777.jsonl` | 2.1.286 | тикет 15: три Subagent-а — фоновый implementer `impl-08` (`run_in_background`, `async_launched`, task-notification с `<result>`), синхронный reviewer `verify-07` с итогом `**REJECTED**`, `name` и `model` во входе вызова Agent |
| `projects/-Users-test-projects-agents/7777…7777/subagents/agent-a3…286.*` | 2.1.286 | фоновый implementer глубины 1; сам вызывает Agent (scout) синхронно, итог — последняя assistant-запись с `end_turn` |
| `projects/-Users-test-projects-agents/7777…7777/subagents/agent-a4…286.*` | 2.1.286 | вложенный scout: `parentAgentId`, `spawnDepth: 2`, вызов и результат — в транскрипте родителя (без `toolUseResult`) |
| `projects/-Users-test-projects-agents/7777…7777/subagents/agent-a5…286.*` | 2.1.286 | reviewer глубины 1, `requestShape: foreground` |
| `projects/-Users-test-------/6666…6666.jsonl` | 2.1.286 | cwd `/Users/test/проект`: каждая кириллическая буква даёт `-` |

Сессии 1111, 2222, 3333, 6666 и 7777 завершены: записи в `sessions/` у них нет. Процессов 41004 и 41005
на машине нет, поэтому живость в test-ах подменяется, а не проверяется `kill(pid, 0)`.

Agent SDK (`listSessions`, `getSessionMessages`, `listSubagents`, `getSubagentMessages` с
`CLAUDE_CONFIG_DIR=<этот каталог>`) разбирает все шесть Сессий и оба Subagent-а Сессии 5555.
