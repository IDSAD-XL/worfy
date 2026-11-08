---
description: 'worfy:critic finds the planted error of a plan — a ticket that waits for a ticket not done yet without saying so in Blocked by — and names it with a fact; names an existing feature a plan duplicates, an existing check that is a cheaper alternative, and an earlier deferral whose condition now holds; keeps each fact apart from its judgement; and answers Keep on a plan without an error, with no invented objection (agents/critic.md).'
tags: [main]
runs: 3
max_turns: 60
timeout_seconds: 1500
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite, TaskCreate, TaskGet, TaskList, TaskUpdate]
---

Five plans wait for acceptance, each the spec of an epic with its tickets in `.scratch/<epic>/issues/`: `export` (`.scratch/export/spec.md`), `greet` (`.scratch/greet/spec.md`), `limit` (`.scratch/limit/spec.md`), `sum-guard` (`.scratch/sum-guard/spec.md`) and `sum-output` (`.scratch/sum-output/spec.md`). The repository is the current folder, branch main. Start one `worfy:critic` agent per plan, named `critic-<epic>`; the brief of each holds only the path of its spec. When all five have answered, save each answer as it is in `answer-<epic>.txt` in the current folder, and copy the review file each answer names, with `cp`, to `review-<epic>.md`. Do not edit any review. I cannot answer questions in this session.
