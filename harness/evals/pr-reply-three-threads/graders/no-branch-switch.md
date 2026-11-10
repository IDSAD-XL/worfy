---
type: tool_used
tool: Bash
input_match: '\bgit(?:\s+-C\s+(?:\\?"[^"\\]*\\?"|\S+)|\s+-c\s+\S+)*\s+(?:checkout|switch|push|commit|stash|reset)\b'
min: 0
max: 0
---

The skill reads the head commit with `git show` and never checks out, switches, commits, stashes, resets or pushes
in the person's checkout. Only the git subcommand counts: `<sha>^{commit}` in a revision, or the word in a
description, is no switch.
