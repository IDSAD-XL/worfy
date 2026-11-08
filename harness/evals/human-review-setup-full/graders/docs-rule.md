---
type: regex
target: { source: file, path: built/SKILL.md }
pattern: '^- (?=(?:(?!\r?\n- |\r?\n\r?\n)[\s\S])*?(?:\bdocs?\b|documentation|typo|dependenc|\bbumps?\b))(?=(?:(?!\r?\n- |\r?\n\r?\n)[\s\S])*?(?:\bapprove\b|\bthrough\b|no comments?\b|without (?:a )?(?:comment|word)|do(?: not|n.t) raise|silently))(?:(?!\r?\n- |\r?\n\r?\n)[\s\S])*?\[R\d+\]'
flags: mi
match: contains
---

The skill keeps the team's other habit: a rule — one list item, which may wrap — that lets documentation,
text or dependency changes through without comments and ends with its `[R<n>]` reference. The docs and bump
pull requests of the history (26, 29) were approved without a single comment. No login of the history in
the skill is the grader skill-no-login.
