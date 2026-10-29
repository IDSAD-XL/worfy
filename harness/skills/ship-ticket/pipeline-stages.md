# ship-ticket: what the Stages of the Pipeline mean for steps 7–11

What each Stage means is in skill `/worfy:epic-wave`, section 0; for this loop:
- Steps 7 and 8 go in the order of the Pipeline. `agent-review` before `ci` — step 7, then step 8,
  as numbered: the PR is opened only after `review success` on the branch's head, from that head.
  `agent-review` after `ci` (the default) — step 8 first (the PR and its CI), then step 7 on the PR's
  head. With no `agent-review` in the Pipeline — step 7 is skipped, and that is said.
- `check` — step 9 merges only while the PR's head carries `check/<name>` `success` or `skipped`.
  With no `check` Stage a platform PR still waits for the other platform's verdict (step 9).
- `human-review` — step 9 waits for the review decision `APPROVED`; `awaiting-merge` — no step 9:
  people merge, and the ticket stays `claimed` with its PR open until they do.
- `deploy` — step 11 closes the ticket only after its merge commit is deployed.
