---
type: tool_used
tool: Edit
input_match: '"new_string"\s*:\s*"(?:(?:[^"\\]|\\.)*?\\n)?Status: (?!(?:open|claimed|blocked|done)\b)'
min: 0
max: 0
---

No Edit writes a Status line with a word other than open, claimed, blocked or done (`new_string`
only; what the Edit replaces does not count): no `resolved`, no `closed`, no triage label.
