---
type: tool_used
tool: Write
input_match: '(?:"|\\n)Status: (?!(?:open|claimed|blocked|done)\b)'
min: 0
max: 0
---

No written file has a Status line with a word other than open, claimed, blocked or done: no
`resolved`, no `closed`, no triage label (bin/TICKETS.md, "Labels").
