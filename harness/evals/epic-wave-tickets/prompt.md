---
description: 'epic-wave takes exactly the tickets the Autopilot command names and does not start a named ticket whose blocker is not done (skills/epic-wave/SKILL.md, "What goes into the wave").'
tags: [main]
runs: 2
max_turns: 80
timeout_seconds: 1800
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite, TaskCreate, TaskGet, TaskList, TaskUpdate]
---

/worfy:epic-wave tickets 02, 03 of epic demo
