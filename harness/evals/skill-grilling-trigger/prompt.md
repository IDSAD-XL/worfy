---
description: 'A plain "grill me on this plan" calls the copied skill worfy:grilling, never a skill of another plugin, and the reply is a numbered round of questions with recommended answers (skills/grilling/SKILL.md).'
tags: [main]
runs: 3
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite, TaskCreate, TaskGet, TaskList, TaskUpdate]
---

Grill me on this plan before I start: instead of one file per function, `src/sum.mjs` and the four functions the tickets of epic demo add (double, square, negate, triple) go into one module, `src/math.mjs`, with one test file, and the tickets change to match. Do not change any file yet.
