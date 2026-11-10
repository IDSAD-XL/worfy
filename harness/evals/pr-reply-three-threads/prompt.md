---
description: 'On the pull request octo-org/ledger#7 of the person, with five review threads, /worfy:pr-reply reads it with gh, drafts replies for the three threads that wait for an answer and none for the resolved one or the one the person answered last, labels the empty-list bug "needs code change" with a fixPlan, does not repeat the ticket a code comment names, checks the draft with review-draft-lint --reply until it passes, keeps it in the profile folder, switches no branch and writes nothing to GitHub (skills/pr-reply/SKILL.md).'
tags: [main]
runs: 2
max_turns: 60
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite, TaskCreate, TaskGet, TaskList, TaskUpdate]
---

/worfy:pr-reply octo-org/ledger#7

I am away for this whole run and cannot answer questions.

When the skill has finished, copy the draft file it wrote into a new folder `built/` in the current folder, as `built/draft.json`. Then run `review-draft-lint --reply built/draft.json` and write its output and then the line `EXIT=<its exit code>` into `built/lint.txt`.
