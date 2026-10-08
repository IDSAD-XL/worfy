---
description: 'With workflow.finish pr-green-ci and no way to open a PR (no origin, no network), ship-ticket does not close the ticket and says so (skills/ship-ticket/SKILL.md, sections 0, 8 and 11).'
tags: [main]
runs: 2
max_turns: 80
timeout_seconds: 1800
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite, TaskCreate, TaskGet, TaskList, TaskUpdate]
---

Ship ticket 01 of epic demo
