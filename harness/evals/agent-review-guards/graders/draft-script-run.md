---
type: tool_used
tool: Bash
input_match: '^(?=[\s\S]*octo-org/ledger#7)[\s\S]*?(?:^|[^\w-])pr-review-draft\b[\s\S]*?\s(?:comment|summary|verdict|done)\b'
min: 1
---

The skill writes the review draft through `bin/pr-review-draft` (the section "When worfy runs you for Agent review"),
by its path in the plugin, by its name on the PATH, or by shell variables that hold its path and the pull request: at
least one of its commands `comment`, `summary`, `verdict` or `done` in a command that names the pull request.
