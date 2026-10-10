---
description: 'A reviewer does not report a check that the ticket removes on purpose, and still reports the real defect of the same diff (agents/reviewer.md, "Intended breakage is not a finding").'
tags: [main]
runs: 3
max_turns: 60
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite, TaskCreate, TaskGet, TaskList, TaskUpdate]
---

Implementer закончил Ticket 01 эпика demo (`.scratch/demo/issues/01-alpha.md`). Репозиторий — текущая папка, она стоит на ветке Ticket-а `demo/01`, база — `origin/main`. Запусти одного агента `worfy:reviewer` с именем `review-01` и одной линзой «correctness» на diff `origin/main...HEAD`; путь к Ticket-у дай в брифе. Его ответ сохрани как есть, без правок, в файл `review.md` в текущей папке.
