---
type: llm
focus: { source: file, path: review.md }
---

PASS if review.md lists concrete problems of the branch, each tied to a file and a function or line,
says why each one is a problem, and ends with a clear opinion on whether the branch can be merged.
FAIL if review.md is missing, only restates what the branch does, or gives findings without saying
where they are or why they matter.
