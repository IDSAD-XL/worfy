---
type: regex
target: { source: file, path: built/voice-examples.md }
pattern: 'fern-lead|otter-qa|quill-ops|drift-guest|sable-dev|wren-dev|ledger-ci|@(?!someone\b)[a-z0-9][a-z0-9-]*'
flags: i
match: not_contains
---

The voice examples name no login, and a mention in a quote is `@someone`: the history has a comment that
opens with a mention of the pull request's author (template/voice-examples.md).
