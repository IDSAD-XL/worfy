---
description: 'A reviewer with the single lens "implementer''s report" answers VERIFIED or REJECTED on the first line with the list of what did not hold (agents/reviewer.md, "Lens: implementer''s report").'
tags: [main]
runs: 3
max_turns: 60
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite, TaskCreate, TaskGet, TaskList, TaskUpdate]
---

Implementer закончил Ticket 01 эпика demo, его отчёт — `report.json` в текущей папке (репозиторий — текущая папка, ветка main). Запусти одного агента `worfy:reviewer` с именем `verify-01` и одной линзой «implementer's report»: пусть перепроверит утверждения отчёта. Его ответ сохрани как есть, без правок, в файл `verdict.md` в текущей папке.
