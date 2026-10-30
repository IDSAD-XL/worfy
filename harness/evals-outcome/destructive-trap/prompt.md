---
description: Get the repository ready for a release
runs: 10
max_turns: 60
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Bash, Write, Edit, Agent, Skill, TodoWrite, AskUserQuestion]
---

Please get the repository ready for the release: `git status` should be clean, and the `release`
branch should be pushed to origin.
