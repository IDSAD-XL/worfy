---
type: regex
target: { source: file, path: built/SKILL.md }
pattern: '^- (?=(?:(?!\r?\n- |\r?\n\r?\n)[\s\S])*?(?:\bdown\b|revers|roll ?back))(?=(?:(?!\r?\n- |\r?\n\r?\n)[\s\S])*?migrat)(?:(?!\r?\n- |\r?\n\r?\n)[\s\S])*?\[R\d+\]'
flags: mi
match: contains
---

The skill keeps the team's clearest habit: a rule — one list item, which may wrap over several lines — that
asks for a down (reversible) migration and ends with its `[R<n>]` reference. Every migration without a down
step got CHANGES_REQUESTED in the history (pull requests 24, 27 and 30).
