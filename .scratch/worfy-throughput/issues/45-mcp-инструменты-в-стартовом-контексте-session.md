# 45 — MCP-инструменты и инструкции connector-ов claude.ai в стартовом контексте Session: сначала замер

Type: task
Status: done 2026-10-28T22:07Z
PR: #931
Branch: worfy-throughput/45
Blocked by: 38
Source: находка Ticket-а 38 вне его скоупа (PR #920, отчёт implementer-а 2026-10-28); договорённость моста и Orchestrator-а
2026-10-28: Ticket в `worfy-throughput` после Wave 1, первым шагом — замер; [ADR-0021](../../../docs/adr/0021-mcp-servers-allowlist-in-profile.md);
[ADR-0084](../../../docs/adr/0084-session-skills-and-plugins-by-profile-list.md).

## Что происходит

При замере Ticket-а 38 в транскрипте Session Orchestrator-а `f6ab7045` первый запрос нёс 664 deferred tool-а и
инструкции MCP-серверов connector-ов claude.ai — около 10k token-ов на каждый старт. ADR-0021 обещает, что агенты
Project-а получают только MCP-серверы из списка Profile. Значит, на каком-то пути запуска этот список не действует.

Это не разовая находка уровня low: цена повторяется на каждом старте Session и Subagent-а, и именно она съедает Limits
подписки, ради которых идёт эта часть Epic-а. После сжатия контекста та же Session видит около 40 deferred tool-ов, так
что число зависит от того, как и когда Session запущена.

## Что делаем

1. **Замер по видам Session.** По транскриптам (только чтение) для первого запроса каждого вида:
   - Session Orchestrator-а, запущенная владельцем (Claude Desktop / Claude Code);
   - Session, которую запускает worfy (путь `src/main/agent/options.ts`);
   - Subagent каждой роли (scout, implementer, reviewer).
   Для каждого — число deferred tool-ов, число MCP-серверов, token-ы инструкций MCP и connector-ов claude.ai, и откуда
   они пришли (settings, plugin, connector аккаунта). Итог — таблица в «Итог».
2. **Какой путь обходит список ADR-0021.** Найти, где список MCP-серверов Profile применяется и какой вид Session из
   замера идёт мимо. Если путь — код worfy: fix с test-ом, который падает на базовом коде.
3. **Если причина — connector-ы на уровне аккаунта claude.ai** (их нельзя выключить кодом worfy, не трогая настройки
   владельца), — вопрос владельцу с ценой в token-ах на старт и вариантами; кода нет.

Нужен ПК: нет. Трогает Harness: нет на шаге 1; на шаге 2 — только если путь идёт через `harness/`, тогда слово владельца
дано (Q-L0 spec-а: «да» 2026-10-28) и это платформенный PR (ADR-0056, пункт 2). Вердикт Windows: runner `full`.

## Готово, когда

- [x] В «Итог» — таблица замера по видам Session с источником каждой части.
- [x] Назван путь запуска, где список ADR-0021 не действует, или сказано, что его нет.
- [x] Путь в коде worfy исправлен, test красный на базовом коде; или вопрос владельцу записан в spec «Вопросы» с ценой.
- [x] Повторный замер после fix-а: сколько token-ов на старт ушло.

## Где в коде

- `src/main/agent/options.ts`, `src/main/agent/app-registry.ts`, `src/main/workflow/profile.ts` — где Session worfy
  получает MCP-серверы по Profile (ADR-0021) и skills по списку (ADR-0084).
- `scripts/agent-cost.mjs` — разбор транскриптов; при необходимости флаг для счёта tool-ов первого запроса.
- Транскрипты Claude Code — только чтение.

## Вне скоупа

- Настройки connector-ов claude.ai владельца: их меняет только владелец, по ответу на вопрос шага 3.
- Skills и plugin-ы пользователя — это Ticket 38 (ADR-0084).

## Итог

Замер 2026-10-28, только чтение транскриптов `~/.claude/projects/**`: 981 транскрипт папок CanvasForAI с 2026-10-21
и транскрипт `f6ab7045`, плюс 144 транскрипта других Project-ов с 2026-10-14. Для каждого — первый запрос модели:
attachment-ы `deferred_tools_delta` (список deferred tool-ов, как он уходит в запрос), `mcp_instructions_delta`
(инструкции MCP-серверов), `usage` первого ответа. Вид Session — по полю `entrypoint` (`claude-desktop` — Session
владельца в Claude Desktop, `sdk-ts` — Session, которую запустил worfy) и по `agentType` в `*.meta.json` Subagent-а.
Скрипт замера — в scratchpad implementer-а, в репозиторий не вошёл.

Token-ы. Токенизатора офлайн нет. Длина списка в token-ах оценена по разнице `usage` первого запроса между группами
implementer-ов с разным числом tool-ов: 0,55–0,70 token-а на символ списка (имена connector-ов начинаются с UUID и
режутся на token-ы мелко). Инструкции MCP — английский текст, около 4 символов на token.

### Таблица замера: первый запрос

| Вид Session | Сколько первых запросов | Deferred tool-ов | MCP-серверов | Список tool-ов, символы → token-ы | Инструкции MCP, символы → token-ы | Откуда |
| --- | --- | --- | --- | --- | --- | --- |
| Orchestrator в Claude Desktop (владелец), `abe166a4`, 2026-10-28 | 16 с deferred-списком, медиана 739, max 994 | 927 | 23 | 58 034 → 32–41k | 16 585 → ~4k | connector-ы claude.ai: 780 tool-ов, 53 330 символов (Datadog 483, LaunchDarkly 174, Notion 67, Figma 33, connector заметок встреч 17, Claude Docs 5, ещё 1); серверы самого Claude Desktop (`ccd_*`, `computer-use`, `claude-in-chrome`, `scheduled-tasks`, `terminal`, `mcp-registry`, iOS Simulator): 126 tool-ов, 4 451 символ; built-in: 21 |
| Тот же вид, 2026-10-21…10-22 (`86b8ce44` и др.) | 4 | 154 | 18 | 5 057 → 3–3,5k | 8 040 → ~2k | без connector-ов с большими наборами: только Claude Docs и серверы Claude Desktop |
| implementer в Claude Desktop, 2026-10-28 | 182, медиана 798, max 1 114 | 1 114 | 27 | 63 903 → 35–45k | в транскрипте Subagent-а не записаны | те же 780 connector-ов и 126 Claude Desktop, плюс серверы из `~/.claude.json` пользователя: `telegram` 128, `github` 46, `freecad` 17 (191 tool, 5 850 символов), `plugin_worfy_qmd` 4, built-in 13 |
| general-purpose, Explore, claude в Claude Desktop | 47 | медиана 340, max 986 | — | — | — | те же источники, сколько их успело подключиться к старту |
| scout и reviewer в Claude Desktop | 566 | 0 | — | 0 | — | в их `tools:` нет deferred tool-ов: MCP-серверы им не приходят |
| Orchestrator, запущенный worfy (`f6ab7045`), 2026-10-28 после сжатия контекста | — | 40 | 3 | 925 → ~0,6k | 1 430 → ~0,4k | built-in 19, `plugin_worfy_qmd` 4, `worfy-canvas` 8, `worfy-browser` 9: ровно список Profile (ADR-0021) |
| implementer, запущенный worfy (Subagent `f6ab7045`) | 50 | 29 | 3 | 761 → ~0,5k | в транскрипте Subagent-а не записаны | built-in 8, `plugin_worfy_qmd` 4, `worfy-canvas` 8, `worfy-browser` 9 |
| general-purpose и Explore, запущенные worfy | 14 | 28–29 | 3 | ~0,5k | — | то же |
| scout и reviewer, запущенные worfy | 98 | 0 | — | 0 | — | как в Claude Desktop |
| Orchestrator `f6ab7045`, первый запрос 2026-10-06 01:24 UTC | 1 | 664 | 11 | 30 490 | 11 147 → ~3k | connector-ы claude.ai (Datadog 280, LaunchDarkly 141, Notion 45, Atlassian 41, Figma 41, Wispr Flow 14, Claude Docs 8), `github` 46, `freecad` 17, `qmd` 4, `worfy-canvas` 8 |

### Какой путь обходит список ADR-0021

- **Число 664 из Ticket-а 38 — история, а не нынешний путь.** `f6ab7045` — Session Orchestrator-а, которую запустил
  worfy (`entrypoint: sdk-ts`), а не владелец. Её первый запрос — 2026-10-06 01:24 UTC, а список MCP-серверов Profile
  пришёл в worfy через 11 часов: PR #43 (`a67833fd`, 2026-10-06 12:46 UTC). На первом перезапуске после него
  (16:43 UTC) транскрипт снимает 633 tool-а; с 2026-10-07 после каждого сжатия контекста та же Session видит 31–40
  tool-ов и только qmd. Отсюда «около 40 после сжатия» в «Что происходит».
- **Session-ы и Subagent-ы, которые запускает worfy, список соблюдают:** 29–40 deferred tool-ов, только серверы
  Profile, ни одного connector-а claude.ai (таблица).
- **Сотни tool-ов приходят в Session-ы, которые владелец запускает сам в Claude Desktop, и в их Subagent-ы.** ADR-0021
  их не покрывает намеренно: «Session, запущенная в терминале, получает серверы так, как настроил пользователь».
  Источник — connector-ы аккаунта claude.ai (780 tool-ов), серверы самого Claude Desktop (126) и серверы из
  `~/.claude.json` (191, только у Subagent-ов с полным набором tool-ов). Кодом worfy это не выключить, не трогая
  настройки владельца: вопрос владельцу — Q-L7 в spec, раздел «Вопросы владельцу».
- **Один путь worfy действительно шёл мимо списка — draft Session «Add project»** (`draftSessionOptions`,
  `src/main/agent/options.ts:383`, вызов из `src/main/ipc/projects.ts:91`). Она запускалась без списка, то есть со всеми серверами пользователя и connector-ами
  claude.ai, хотя canUseTool даёт ей только Read, Glob и Grep и отказывает каждому MCP tool-у. Fix: пустой список
  (`mcpAllowlist: []`) в `src/main/agent/options.ts`; test-ы `test/unit/agent-options.test.ts` («MCP servers of the
  draft Session of a Project connection») красные на базовом коде. Цена до fix-а — тот же набор, что у implementer-а
  в Claude Desktop: около 1 100 tool-ов, 35–45k token-ов на каждое подключение Project-а.
- Session worfy вне Project-а (без Profile) получает серверы пользователя как есть — так решил ADR-0021; в замере
  таких Session нет.

### Повторный замер после fix-а

Draft Session после 2026-10-14 не запускалась ни разу (в транскриптах нет ни одной Session `sdk-ts`, кроме
`f6ab7045`), а живой запуск в этом Ticket-е запрещён. После fix-а её options несут `allowedMcpServers: []` и
`allowManagedMcpServersOnly: true` — тот же механизм, что дал 29–40 tool-ов Session-ам worfy в таблице; ожидаемо —
только built-in tool-ы. Живым запуском не проверено.

Для Session-ов Claude Desktop повторного замера нет: их набор меняет только ответ владельца на Q-L7.

Ответ владельца 2026-10-29 (через Orchestrator): владелец отключил ненужные connector-ы 2026-10-29; кода не нужно.
