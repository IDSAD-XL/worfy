---
type: tool_used
tool: Write
input_match: '^(?=[\s\S]*"file_path"\s*:\s*"[^"]*\.scratch/cli/issues/\d{2}-[^"/]+\.md")(?=[\s\S]*(?:"|\\n)Type: (?:research|prototype|grilling|task)\\n)(?=[\s\S]*(?:"|\\n)Status: open(?:\\n| ))'
min: 1
---

At least one ticket of the map is a file `.scratch/cli/issues/NN-slug.md` whose header has a Type
line with one of the four ticket types and the line `Status: open` at the start of a line — the
header bin/TICKETS.md describes, which `epic-status` reads.
