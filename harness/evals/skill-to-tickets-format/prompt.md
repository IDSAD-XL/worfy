---
description: 'worfy:to-tickets publishes the tickets into the ticket folder of the profile, one file per ticket, with the header of bin/TICKETS.md that epic-status reads — Type, Status open, Blocked by — and no old header (skills/to-tickets/SKILL.md, bin/TICKETS.md "Wayfinding operations").'
tags: [main]
runs: 3
max_turns: 40
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite, TaskCreate, TaskGet, TaskList, TaskUpdate]
---

/worfy:to-tickets .scratch/greet/spec.md — the epic is `greet`. I cannot answer questions in this session: I approve the breakdown you propose as it is, so publish the tickets without waiting for me.
