# 07 — Что получает Session на Codex: первый выпуск, потом, никогда

Type: grilling
Status: done 2026-11-02
Blocked by: 02, 03, 04, 05
Source: [map.md](../map.md), Ticket 01

## Question

Для каждой части worfy — чат и очередь сообщений, slash-меню, пикеры Model / effort / permission, Subagent-ы на Canvas, Binding, Background task, MCP `worfy-canvas` и `worfy-browser`, Cards (`worfy.ask`), Limits, Autopilot и Wave-ы, Harness, Terminal AI, Flight Recorder, поиск, Link (вторая Machine), onboarding — что Session на Codex получает в первом выпуске, что позже и что никогда. Как интерфейс показывает то, чего Vendor не умеет: скрыть, показать недоступным с причиной или эмулировать силами worfy?

## Answer

Решено Orchestrator-ом 2026-11-02 по поручению владельца («да, можешь работать над этим эпиком полностью на автопилоте»), подтвердить при приёмке. План по Ticket-ам — [spec.md](../spec.md).

**Первый выпуск — чат:**
- создание Session с выбором Vendor-а; у Project — Vendor по умолчанию;
- чат с очередью и steer;
- interrupt и resume;
- пикеры Model и effort — из списка Vendor-а;
- permission presets словами самого Vendor-а: «Read only», «Auto», «Full access» — это approval policy плюс sandbox;
- диалог подтверждения команд и правок файлов;
- slash-меню: skills Codex и его встроенные команды;
- Node Session на Canvas с транскриптом через app-server и Session-ы, начатые в терминале (по `cwd`);
- Limits по каждому Vendor-у;
- onboarding: найти Codex и войти в него — необязательно; пользователь без Codex ошибки не видит;
- поиск по транскриптам Codex.

**Второй выпуск:**
- MCP-серверы worfy для Codex по HTTP: tool-ы Canvas, Cards `worfy.ask`, Browser;
- Node-ы Subagent-ов из thread-ов sub-агентов Codex;
- Harness на Codex (Ticket 08);
- Autopilot и Wave-ы на Orchestrator-е Codex с budget Limits (Ticket 09);
- Flight Recorder по Run-ам Codex;
- Binding.

**Позже, после этого Epic-а, отдельными решениями:** Terminal AI на Codex; смешанные Vendor-ы по ролям агентов; Link ко второй Machine с Codex.

**Никогда:** всё, что требует API-ключа.

**Как показывать то, чего Vendor не умеет.** Показывать недоступным, с tooltip причины («Codex does not support …»). Скрывать только то, что для Vendor-а не имеет смысла. worfy ничего не эмулирует своими силами.

Почему так: первый выпуск — то, что уже даёт app-server без experimental-методов (Ticket 02); всё, что стоит на Harness, MCP в процессе и Autopilot, требует решений 08 и 09 и отдельных Wave. Недоступное с причиной честнее скрытого: пользователь видит, что функция есть у другого Vendor-а, а эмуляция означала бы второй источник поведения, который worfy пришлось бы держать сам.
