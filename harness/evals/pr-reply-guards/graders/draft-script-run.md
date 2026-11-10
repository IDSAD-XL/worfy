---
type: tool_used
tool: Bash
input_match: '[\\/]bin[\\/]+pr-reply-draft\b'
min: 1
---

The skill hands its drafts to `bin/pr-reply-draft` (step 6), which checks them with `review-draft-lint --reply` and
writes the draft file only when the check is clean.
