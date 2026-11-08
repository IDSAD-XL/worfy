---
description: 'worfy:critic finds the planted error of a plan — a ticket that waits for a ticket not done yet without saying so in Blocked by — and names it with a fact, and answers Keep on a plan without an error, with no invented objection (agents/critic.md).'
tags: [main]
runs: 3
max_turns: 60
timeout_seconds: 1500
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite, TaskCreate, TaskGet, TaskList, TaskUpdate]
---

Two plans wait for acceptance: the spec of epic `export` (`.scratch/export/spec.md`) and the spec of epic `greet` (`.scratch/greet/spec.md`), each with its tickets in `.scratch/<epic>/issues/`. The repository is the current folder, branch main. Start one `worfy:critic` agent per plan, named `critic-export` and `critic-greet`; the brief of each holds only the path of its spec. When both have answered, save each answer as it is in `answer-export.txt` and `answer-greet.txt` in the current folder, and copy the review file each answer names, with `cp`, to `review-export.md` and `review-greet.md`. Do not edit either review. I cannot answer questions in this session.
