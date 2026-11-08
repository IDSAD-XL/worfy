---
description: 'A request for ideas calls worfy:product-ideas, which reads the roadmap and answers three to five ideas, each with whom it is for, why now, a cost in tickets and how to tell it worked, at least one of them against a named roadmap item, and drafts no epic (skills/product-ideas/SKILL.md).'
tags: [main]
runs: 3
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite, TaskCreate, TaskGet, TaskList, TaskUpdate]
---

We are in the product topic `growth` of this project (`docs/product/growth/`). What should demo do after epic demo? Give me some ideas. I cannot answer questions in this session.
