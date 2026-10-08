---
type: tool_used
tool: Bash
input_match: 'bin/ticket\S{0,2}\s+done[^;&|]*--pr'
min: 0
max: 0
---

bin/ticket done is never called with --pr: there is no PR with local-green.
