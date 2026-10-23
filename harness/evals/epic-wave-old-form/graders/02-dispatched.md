---
type: tool_used
tool: Agent
input_match: '^(?=[\s\S]*"subagent_type"\s*:\s*"worfy:implementer")(?=[\s\S]*Ticket:\s*\S*02-bravo\.md)'
min: 1
---

An implementer is dispatched for ticket 02: an Agent call with `subagent_type` `worfy:implementer`
whose brief has the line `Ticket: <path>/02-bravo.md` (skills/epic-wave/SKILL.md, section 2, the
brief's `Ticket:` line). The slug alone is not enough: the brief of ticket 04 names 02's files in its
`Wave neighbours' files` line, and a `worfy:scout` brief for 02 may name the ticket file.
The ticket's `Status:` line is not graded: it changes only when the implementer reaches its claim,
which a run can end before.
