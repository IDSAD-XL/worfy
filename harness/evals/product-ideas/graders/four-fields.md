---
type: regex
pattern: '(?:^[-*] (?:\*\*)?For whom:[\s\S]*?^[-*] (?:\*\*)?Why now:[\s\S]*?^[-*] (?:\*\*)?Cost:[\s\S]*?^[-*] (?:\*\*)?How we will know it worked:[\s\S]*?){3}'
flags: m
match: contains
---

At least three ideas carry the four fields in order: For whom, Why now, Cost, How we will know it
worked. Known limit: with four or five ideas, one idea without a field still passes here; the llm
grader reads every idea.
