---
type: regex
target: { source: file, path: built/SKILL.md }
pattern: '\{\{\s*(rules|examples)\s*[:}]'
match: not_contains
---

No `{{rules: …}}` or `{{examples: …}}` place of the template is left in the skill (write.md, section 5). Any
other `{{`, such as a Go composite literal in a quoted comment of the team, is text and passes.
