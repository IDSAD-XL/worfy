---
description: 'With too little review history — 8 substantive comments of the team, 30 needed — /worfy:human-review-setup reads it through review-history, says the voice cannot be built with the words "8 of 30", offers /worfy:code-review instead, deletes raw/ with review-history clean, starts no Subagent, reads nothing in raw/ and leaves only meta.json (and the empty ignore.json fetch creates) in the private folder; nothing is written to GitHub (skills/human-review-setup/SKILL.md, steps 1–3).'
tags: [main]
runs: 3
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite, TaskCreate, TaskGet, TaskList, TaskUpdate]
---

/worfy:human-review-setup

I cannot answer questions in this session. When the skill has stopped, save the listing of its private folder — `ls -A` of the folder `<_resolved.dir>/state/human-review` the skill works in — into `private-folder.txt` in the current folder, one name per line.
