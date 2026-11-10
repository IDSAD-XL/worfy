---
type: regex
target: { source: file, path: built/status.txt }
pattern: '^END\r?\n?$'
match: contains
---

`git status --porcelain` of the project is empty after the skill: no draft, quote or temporary file was left in the
repository (the draft lives in the profile folder, outside it).
