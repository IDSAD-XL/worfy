---
type: regex
target: { source: file, path: .git/worfy-harness/projects/demo/state/pr-inbox/drafts/octo-org-ledger-7.json }
pattern: '^(?![\s\S]*(?:PRRT_evalA4|PRRT_evalA5|"kind"\s*:\s*"conversation"))[\s\S]*"threadId"\s*:\s*"PRRT_evalA'
match: contains
---

The draft file is in the profile folder of the project (the Harness home of an eval run is .git/worfy-harness), where
only `bin/pr-reply-draft` writes it after a clean `review-draft-lint --reply`, and it holds replies only to the threads
that wait: none to the resolved thread PRRT_evalA4, none to PRRT_evalA5, which the person answered last, and none to
the bot's comment in the conversation.
