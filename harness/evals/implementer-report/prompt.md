---
description: 'The implementer agent returns a JSON report whose commands carry exit codes (agents/implementer.md, "Report").'
tags: [main]
runs: 3
max_turns: 60
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite, TaskCreate, TaskGet, TaskList, TaskUpdate]
---

Отдай Ticket 01 эпика demo агенту `worfy:implementer`: репозиторий — текущая папка. Когда он закончит, сохрани его отчёт как есть, без правок, в файл `implementer-report.json` в текущей папке.
