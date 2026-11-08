---
type: regex
target: { source: file, path: built/SKILL.md }
pattern: '\{\{'
match: not_contains
---

No `{{…}}` line of the template is left in the skill (write.md, section 5).
