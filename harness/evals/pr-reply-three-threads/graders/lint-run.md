---
type: tool_used
tool: Bash
input_match: 'review-draft-lint[\\"]*\s+--reply\s+[^|;&]*pr-inbox[\\/]+drafts[\\/]'
min: 1
---

The skill checks the draft file in the profile folder with `review-draft-lint --reply` (step 6); the run of the
prompt on the copy in `built/` does not count.
