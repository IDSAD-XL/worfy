---
description: 'An update of a reviewer built before (/worfy:human-review-setup --refresh) that the person declines after the estimate: the skill reads only the pull requests since the fetched_at of meta.json with review-history fetch --since, shows the estimate, and on "no" deletes raw/ with review-history clean; no Subagent, nothing read in raw/ by the session, the installed skill, research.md and lint.json stay, nothing is written to GitHub (skills/human-review-setup/SKILL.md step 1, refresh.md sections 1–2).'
tags: [main]
runs: 3
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite, TaskCreate, TaskGet, TaskList, TaskUpdate]
---

/worfy:human-review-setup --refresh

My answer to the question after the estimate is no: do not read or analyse the comments. I cannot answer anything else in this session. When the skill has stopped, save the listing of its private folder — `ls -A` of the folder `<_resolved.dir>/state/human-review` the skill works in — into `private-folder.txt` in the current folder, one name per line.
