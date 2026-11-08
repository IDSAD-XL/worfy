---
type: regex
pattern: '^[-*] (?:\*\*)?Against the roadmap:'
flags: m
match: contains
---

At least one idea has the list item `Against the roadmap:` at the start of a line, as the skill's
format writes it; the words inside a sentence do not count.
