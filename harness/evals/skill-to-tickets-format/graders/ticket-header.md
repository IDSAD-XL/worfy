---
type: tool_used
tool: Write
input_match: '^(?=[\s\S]*"file_path"\s*:\s*"[^"]*\.scratch/greet/issues/\d{2}-[^"/]+\.md")(?=[\s\S]*(?:"|\\n)Type: task\\n)(?=[\s\S]*(?:"|\\n)Status: open(?:\\n| ))(?=[\s\S]*(?:"|\\n)Blocked by: )'
min: 1
---

At least one ticket file is written with the header epic-status reads: the lines `Type: task`,
`Status: open` and `Blocked by:`, each at the start of a line, with no bold around the field name.
