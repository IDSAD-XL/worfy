---
type: regex
target: { source: file, path: implementer-report.json }
pattern: '"exit_code"\s*:\s*-?\d+'
---

A command in the report carries a numeric "exit_code".
