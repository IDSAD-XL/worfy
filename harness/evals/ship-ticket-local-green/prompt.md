---
description: 'With workflow.finish local-green, ship-ticket finishes on a green gate fast and closes the ticket with bin/ticket done without --pr; no PR, no push (skills/ship-ticket/SKILL.md, sections 0, 6, 8 and 11).'
tags: [main]
runs: 2
max_turns: 80
timeout_seconds: 1800
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite, TaskCreate, TaskGet, TaskList, TaskUpdate]
---

Ship ticket 01 of epic demo
