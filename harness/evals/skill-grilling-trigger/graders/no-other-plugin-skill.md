---
type: tool_used
tool: Skill
input_match: '"skill"\s*:\s*"(?!worfy:)[^"]*:'
min: 0
max: 0
---

No Skill call named a skill of another plugin. Only worfy is installed in a run, so such a call is
refused, but the refused call is still a tool call of the trace, and this grader fails on it. It
catches a copied text that still sends the model to the upstream plugin's name, which
grilling-called alone misses when the model falls back to `worfy:grilling` after the refusal.
