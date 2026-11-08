---
description: 'worfy:code-review reviews the change since a fixed point on its two axes, Standards and Spec, each in its own sub-agent, and reports them under two headings without merging them (skills/code-review/SKILL.md).'
tags: [main]
runs: 3
max_turns: 40
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite, TaskCreate, TaskGet, TaskList, TaskUpdate]
---

/worfy:code-review origin/main — the spec is ticket 01 of epic demo, `.scratch/demo/issues/01-alpha.md`. Review only; change no file.
