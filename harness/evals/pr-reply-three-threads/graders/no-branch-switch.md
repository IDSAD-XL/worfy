---
type: tool_used
tool: Bash
input_match: '\bgit\b[^|;&]*\s(?:checkout|switch|push|commit|stash)\b'
min: 0
max: 0
---

The skill reads the head commit with `git show` and never checks out, switches, commits, stashes or pushes in the
person's checkout.
