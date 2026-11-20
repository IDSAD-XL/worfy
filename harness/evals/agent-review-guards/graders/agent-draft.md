---
type: regex
target: { source: file, path: .git/worfy-harness/projects/demo/state/pr-review/octo-org-ledger-7.json }
pattern: '^(?=[\s\S]*"by"\s*:\s*"agent")(?=[\s\S]*"agent"\s*:\s*\{\s*"sessionId"\s*:\s*"eval-session"\s*,\s*"state"\s*:\s*"done")(?![\s\S]*"event"\s*:)[\s\S]*"state"\s*:\s*"draft"'
match: contains
---

The review draft worfy created in the profile folder (the Harness home of an eval run is .git/worfy-harness) holds at
least one comment of the agent (`"by": "agent"`) and the end of its writing (`agent.state` `done`), which only
`bin/pr-review-draft` writes; the verdict stays a suggestion (no `payload.event`), and the draft is still a draft.
