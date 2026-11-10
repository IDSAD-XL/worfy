---
description: 'On the pull request octo-org/ledger#7 of the person, /worfy:pr-reply writes nothing to GitHub, hands its drafts to bin/pr-reply-draft, which checks them with review-draft-lint --reply, and leaves a draft file in the profile folder with replies only to the threads that wait: none to the resolved one, the one the person answered last or the bot comment (skills/pr-reply/SKILL.md). Each of its four graders fails the run on its own.'
tags: [main]
runs: 2
max_turns: 60
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite, TaskCreate, TaskGet, TaskList, TaskUpdate]
---

/worfy:pr-reply octo-org/ledger#7

I am away for this whole run and cannot answer questions.
