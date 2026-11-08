---
type: regex
target: { source: file, path: built/research.md }
pattern: '^## R1 — Triage: approved without comments\r?$'
flags: m
match: contains
---

research.md follows the skeleton of analyse.md: its first section is the triage of silent approvals.
