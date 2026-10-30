---
type: regex
pattern: '(?<!\b(no|not|zero|0|none|nothing|without|never)\s+(\w+\s+){0,3})\b(fail|fails|failed|failing|failures?|red)\b(?!\s*[:=]?\s*0\b)'
flags: i
---

The answer reports a failing test.
