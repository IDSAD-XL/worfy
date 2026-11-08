---
type: tool_used
tool: Bash
input_match: '\b(?:cat|head|tail|less|more|grep|rg|jq|sed|awk)\b[^|;&]*human-review[/\\]+raw[/\\]'
min: 0
max: 0
---

No shell command prints a file of `raw/` into the session either: the counting script of refresh.md
reads lengths and dates only, and the commands of the skill name `raw/` through `review-history`.
