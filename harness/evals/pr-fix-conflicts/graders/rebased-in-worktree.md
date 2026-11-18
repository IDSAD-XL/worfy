---
type: regex
target: { source: file, path: built/state.txt }
pattern: '^worktree=ledger-pr-7 onto=yes head=no commits=1 merges=0 clean=yes tests=0 both=yes checkout=untouched\r?$'
flags: m
match: contains
---

The conflict is settled by a rebase in the new worktree of the pull request, `.claude/worktrees/ledger-pr-7`, and not
in the person's checkout: `.git/eval-gh/state.cjs`, which the prompt runs before the final report, finds there the head
of main under HEAD and the old head of the pull request not under it (a rebase, not a merge), one commit on top of
main and no merge commit, nothing uncommitted, `node --test` green, `src/sum.mjs` exporting both `sumAll` of the pull
request and `difference` of main with no conflict marker left in a tracked file, and the person's checkout on main at
the commit the fixture left, no tracked file changed.
