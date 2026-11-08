---
description: 'A whole build of /worfy:human-review-setup on an invented history of 12 pull requests: after the person''s yes it holds pull requests out, analyses the rest with Subagents into research.md, writes the review skill so that review-draft-lint --skill passes, keeps no login in the skill, its voice examples or research.md, finds the team''s habits (a down migration on every migration, silent approvals of docs and bumps), and writes nothing to GitHub (skills/human-review-setup/SKILL.md, analyse.md, write.md, check.md, template/).'
tags: [main]
runs: 2
max_turns: 150
timeout_seconds: 3000
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite, TaskCreate, TaskGet, TaskList, TaskUpdate]
---

/worfy:human-review-setup

I am away for this whole run, so here are my answers in advance, and this message is my explicit "yes". To the question after the estimate: yes, read and analyse them. To the question of step 7: keep. Nothing else needs me.

When the skill has finished, copy the `SKILL.md` and `voice-examples.md` it installed and the `research.md` of its private folder into a new folder `built/` in the current folder. Then run the same `review-draft-lint --skill` the skill ran, on `built/`, and write its output and then the line `EXIT=<its exit code>` into `built/lint.txt`.
