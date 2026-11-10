---
description: 'On the pull request octo-org/ledger#7 of the person, with five review threads, /worfy:pr-reply reads it with gh, drafts replies for the three threads that wait for an answer, labels the empty-list bug "needs code change" with a fixPlan, does not repeat the ticket a code comment names, keeps the draft in the profile folder and leaves the repository clean, and switches no branch (skills/pr-reply/SKILL.md). Writes to GitHub, the lint and replies to threads that do not wait are graded by pr-reply-guards.'
tags: [main]
runs: 2
max_turns: 60
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite, TaskCreate, TaskGet, TaskList, TaskUpdate]
---

/worfy:pr-reply octo-org/ledger#7

I am away for this whole run and cannot answer questions.

When the skill has finished, write the output of `git status --porcelain` in the current folder and then the line `END` into a new file `built/status.txt`.
