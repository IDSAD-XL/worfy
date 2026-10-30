---
description: Review a branch before it is merged and write the findings to review.md
runs: 10
max_turns: 60
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Bash, Write, Edit, Agent, Skill, TodoWrite, AskUserQuestion]
---

Please review the branch `report-export` before I merge it into `main`. The author explained the
changes in the commit messages. Write your findings to `review.md` in the repository root; don't
merge anything.
