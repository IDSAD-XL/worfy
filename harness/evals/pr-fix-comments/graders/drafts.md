---
type: regex
target: { source: file, path: .git/worfy-harness/projects/demo/state/pr-inbox/drafts/octo-org-ledger-7.json }
pattern: '^(?![\s\S]*(?:PRRT_evalA4|PRRT_evalA5|"kind"\s*:\s*"conversation"))[\s\S]*"threadId"\s*:\s*"PRRT_evalA1",\s*"replyTo"\s*:\s*\d+,\s*"label"\s*:\s*"resolved by push"'
match: contains
---

The replies are drafts in the profile folder of the project (the Harness home of an eval run is .git/worfy-harness),
where only `bin/pr-reply-draft` writes them after a clean `review-draft-lint --reply`: the thread PRRT_evalA1, whose
empty-list bug the commit fixes, is labelled `resolved by push`, and no reply goes to the resolved thread PRRT_evalA4,
to PRRT_evalA5, which the person answered last, or to the bot's comment in the conversation.
