---
description: 'worfy runs /worfy:code-review for an Agent review of someone else''s pull request octo-org/ledger#7: the skill writes nothing to GitHub and writes the review draft worfy created in the profile folder only through bin/pr-review-draft — comments of the agent and the end of its writing (skills/code-review/SKILL.md, the section "When worfy runs you for Agent review"). Each of its four graders fails the run on its own.'
tags: [main]
runs: 2
max_turns: 60
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite, TaskCreate, TaskGet, TaskList, TaskUpdate]
---

/worfy:code-review octo-org/ledger#7 Agent review: write the review draft only through bin/pr-review-draft (pr-review-draft --help); the verdict is only a suggestion; nothing goes to GitHub.

I am away for this whole run and cannot answer questions.
