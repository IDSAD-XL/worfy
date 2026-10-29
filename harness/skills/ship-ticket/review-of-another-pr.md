# ship-ticket: Review of a PR another session wrote

A PR that another session (for example, one on another machine) or another person wrote, which
this session reviews and its orchestrator merges. Its author has carried steps 1–6; this session
does step 7 on the PR and, when the review lets it, steps 8–11. The review edits nothing on the
author's branch: rework goes back to the author as the PR comment with the verdict.

The request: `/worfy:ship-ticket review #<N> depth <low|medium|high|max>`, the depth optional; the
owner's word `review #237 — low` in a message is the same request.

The depth of every round is chosen as in step 7 (argument, then the profile), but without the
field the review of such a PR always has a depth, by what the PR changes
(`gh pr view <N> --json files --jq '.files[].path'`):
- A PR that changes only documents gets no review agents: its check is the local gate and the CI
  rules of `rules.md`.
- A PR that changes only tests and comments gets `medium` depth in its first round (the depth of
  `F review.depth.first_round`, if that is lower).
- A PR that touches any line of code or of a script outside the tests is a PR with code: its first
  round has the depth of `F review.depth.first_round`, `high` depth without the field.
- Every later round has the depth of `F review.depth.later_rounds`, `medium` depth without the field.
- `max` depth only when the owner asks for it.

The reviewers work in their own worktrees on the PR's head (`git -C <repo> fetch origin
<headRefName>`, then `F worktree.reviewer` with `<branch>` = `origin/<headRefName>`), with the
briefs, the four groups of findings and the exchange with the reviewers of step 7. A repeat round
checks the author's rework the way step 7 says for a repeat review.

What blocks a merge, at every depth: a `high` or `med` finding in the code, or a gap in the tests
that guard a destructive action (a delete, stopping a process, replacing a copy). The other gaps go
as a list into a follow-up ticket.

At most three review rounds per PR, unless a `high` finding remains. After the third round the
`med` findings and the test gaps that are left go as a list into a follow-up ticket instead of a
fourth round, and the PR goes on to its merge; a `high` finding that is left keeps the PR open, and
the next round checks only that finding. The rounds are the verdict comments of the PR:

```bash
gh pr view <N> --json comments --jq '[.comments[].body | select(test("^(VERIFIED|REJECTED)"))] | length'
```

A wave keeps its own count of rounds (`/worfy:epic-wave`, section 3): one rework round and the
narrow round, without this limit.

Each round marks the PR's head (`gh pr view <N> --json headRefOid`) `review pending` before it
starts and `review success` or `review failure` with its verdict, as step 7 says ("The review mark").
The verdict is a PR comment, written as in `/worfy:epic-wave`, section 3: the first line
`VERIFIED` or `REJECTED: <Act on>`, then the lines of the other groups, then the two report lines
of step 7:

```
REJECTED: <Act on: the rework list>
Consider: <findings>
Review depth: <depth> — <where it came from>
Review tokens: <subagent tokens of the round> | not measured
```

The project's full local check before merging code (`rules.md`) is outside the depth scale: it
runs before the merge at every depth. The owner's manual acceptance items do not hold the merge:
the PR merges when the review lets it and the full local check is green, and the items go to the
list of what waits for the owner in the state file (`F docs.handoff`). The report to the user is the
verdict, the four groups and the same two report lines.
