---
description: 'The implementer agent writes the Code story of its PR before the PR, and story-check passes on it (agents/implementer.md, step 6; skills/ship-ticket/story-pr.md).'
tags: [main]
runs: 3
max_turns: 80
timeout_seconds: 1800
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite, TaskCreate, TaskGet, TaskList, TaskUpdate]
---

Отдай Ticket 01 эпика demo агенту `worfy:implementer`: репозиторий — текущая папка. Когда он закончит, сохрани его отчёт как есть, без правок, в файл `implementer-report.json` в текущей папке. Последним шагом выполни в текущей папке `sh .git/eval-finish.sh` — служебная команда fixture-а, она ничего не печатает; агенту о ней не говори.
