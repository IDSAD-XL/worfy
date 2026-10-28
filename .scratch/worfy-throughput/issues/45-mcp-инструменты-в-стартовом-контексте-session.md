# 45 — MCP-инструменты и инструкции connector-ов claude.ai в стартовом контексте Session: сначала замер

Type: task
Status: open
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

- [ ] В «Итог» — таблица замера по видам Session с источником каждой части.
- [ ] Назван путь запуска, где список ADR-0021 не действует, или сказано, что его нет.
- [ ] Путь в коде worfy исправлен, test красный на базовом коде; или вопрос владельцу записан в spec «Вопросы» с ценой.
- [ ] Повторный замер после fix-а: сколько token-ов на старт ушло.

## Где в коде

- `src/main/agent/options.ts`, `src/main/agent/app-registry.ts`, `src/main/workflow/profile.ts` — где Session worfy
  получает MCP-серверы по Profile (ADR-0021) и skills по списку (ADR-0084).
- `scripts/agent-cost.mjs` — разбор транскриптов; при необходимости флаг для счёта tool-ов первого запроса.
- Транскрипты Claude Code — только чтение.

## Вне скоупа

- Настройки connector-ов claude.ai владельца: их меняет только владелец, по ответу на вопрос шага 3.
- Skills и plugin-ы пользователя — это Ticket 38 (ADR-0084).

## Итог
