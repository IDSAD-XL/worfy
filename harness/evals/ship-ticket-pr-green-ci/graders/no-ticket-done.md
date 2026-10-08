---
type: tool_used
tool: Bash
input_match: 'bin/ticket\S{0,2}\s+done'
min: 0
max: 0
---

bin/ticket done is never called: without a PR and green CI the ticket is not finished.
