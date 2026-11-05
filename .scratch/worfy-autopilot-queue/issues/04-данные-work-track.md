# 04 — Данные для Work track за 1 д … 1 мес

Type: research
Status: open
Blocked by: 01
Source: [map.md](../map.md); Ticket 01, Q4–Q5

## Question

Что из источников Flight Recorder (`src/main/flight-recorder/service.ts:1-38`) доступно для ленты всей работы Project-а на этой Machine за 1, 7, 14 и 30 дней — без нового хранилища (ADR-0092)?

Для каждого источника — что даёт (какие Span-ы: Run, Wave, Ticket, Session-ход, Subagent, PR, CI, gate), сколько хранится, сколько стоит прочитать 30 дней (объём файлов, время чтения на этом Mac, число запросов GitHub API и их лимит), что теряется:

- журналы Run-ов (`<data dir>/autopilot/*.jsonl`, `src/main/autopilot/journal.ts:173-197`);
- транскрипты всех Session Project-а и их Subagent-ов (`~/.claude/projects`, `cleanupPeriodDays` 30, `src/main/flight-recorder/transcripts.ts`), транскрипты Session на Codex (`thread/list`, worfy-multi-vendor 05);
- GitHub: PR, merge, CI-run-ы за период (`src/main/flight-recorder/github.ts`);
- run-ы gate: логи (10 на worktree, 8 дней после удаления), записи о падениях `gate-failures` (срок хранения?), состояние gate;
- смена статуса Ticket-а: можно ли восстановить из `git log` файлов Ticket-ов (`Status:` в каждом коммите main и веток), с какой точностью по времени;
- ручная «Run wave» без Run-а и Wave-ы из терминала вне worfy (ADR-0092, spec Flight Recorder `:163`).

Итог: таблица «источник × период × полнота × цена», пробелы, и ответ — хватает ли этого без журнала работы, или какой минимальный журнал закрыл бы пробелы.
