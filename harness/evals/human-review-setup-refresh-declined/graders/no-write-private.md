---
type: tool_used
tool: Write
input_match: 'state[/\\]+human-review[/\\]+(?!raw[/\\])'
min: 0
max: 0
---

Nothing of the private folder outside `raw/` is written by the session: the installed skill,
`research.md` and `lint.json` stay as they were. `raw/` is the run's own and `clean` deletes it.
