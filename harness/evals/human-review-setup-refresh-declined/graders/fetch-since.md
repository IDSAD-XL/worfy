---
type: tool_used
tool: Bash
input_match: 'review-history[\\"]*\s+(?:-C\s+\S+\s+)?fetch\s+(?:\S+\s+)*?--since[\s=]+[\\"'']*\d{4}-\d{2}-\d{2}'
min: 1
---

The update reads only the pull requests since a date, with `review-history fetch --since <date>`
(refresh.md, section 2).
