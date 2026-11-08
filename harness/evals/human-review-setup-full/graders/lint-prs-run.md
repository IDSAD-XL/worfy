---
type: tool_used
tool: Bash
input_match: 'review-draft-lint[\\"]*\s+--skill\s+\S+\s+--prs\b'
min: 1
---

The skill checks the links of what it wrote against the history with `review-draft-lint --skill … --prs
…/raw/prs.jsonl` (write.md, section 5), before "Keep" deletes `raw/`.
