---
type: tool_used
tool: Write
input_match: '^(?=[\s\S]*"file_path"\s*:\s*"[^"]*\.scratch/greet/issues/)(?=[\s\S]*(?:\*\*Status|(?:"|\\n)Status: (?!(?:open|claimed|blocked|done)\b)|(?:"|\\n)Status: open ?[^\\\d "]))'
min: 0
max: 0
---

No ticket file is written with an old header — `**Status:**`, a word other than open, claimed,
blocked or done, or a tail after the word such as `Status: open — new` — which epic-status reports as
"old header".
