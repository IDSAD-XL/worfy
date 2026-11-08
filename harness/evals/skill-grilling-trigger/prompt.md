---
description: 'A plain "grill me on this plan" calls the copied skill worfy:grilling, never a skill of another plugin, and the reply is a numbered round of questions with recommended answers (skills/grilling/SKILL.md).'
tags: [main]
runs: 3
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite, TaskCreate, TaskGet, TaskList, TaskUpdate]
---

Grill me on this plan before I start: I want to replace the four small functions of `src/` with one module, `src/math.mjs`, that exports all of them, delete the old files, and keep the tests passing. Do not change any file yet.
