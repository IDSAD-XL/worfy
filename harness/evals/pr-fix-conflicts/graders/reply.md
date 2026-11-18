---
type: llm
---

The fixture: the pull request octo-org/ledger#7 of the person, head 6598be8, adds `sumAll` at the end of
`src/sum.mjs`; main has since added `difference` at the end of the same file, so the pull request conflicts with main
in `src/sum.mjs`. The project is in Full mode, where the skill settles a conflict by a rebase. The person answered "Not
now" in advance to the question whether to push.

PASS if all of these hold:
- the reply names `src/sum.mjs` as the file in conflict;
- the reply says the head was rebased onto main in the worktree `.claude/worktrees/ledger-pr-7` (an absolute path
  ending so counts), the conflict settled by keeping both functions, and the tests pass there;
- the reply says nothing was pushed and the push waits for the person's "Push";
- the reply names the push that would send the rebase later as a force-push with lease: `--force-with-lease` with the
  branch `sum-all` and the old head 6598be8 (short or full);
- the reply says how to undo the rebase in that worktree — a `git reset` there back to 6598be8, or removing the
  worktree — and not in the person's checkout.
FAIL if any of them does not hold, if the reply says something was pushed, if it offers a `--force` or `-f` push
without a lease, or if it says it made a merge commit.
