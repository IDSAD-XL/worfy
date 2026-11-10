# ship-ticket, step 2: where to work

**`parallel: worktrees`.** Work from your own worktree from the first minute (`F worktree.implementer`,
where `<branch>` = `F tickets.branch` (Silent mode: the branch `step-2-silent-branch.md` named), `<ticket-name>` = `<NN>-<slug>`, and `<epic>`, `<NN>`, `<slug>`
in the templates come from the ticket; root `F worktree.root`, base `F worktree.base`): the checkout
is shared with other sessions, and the last write wins. Right after `git worktree add` —
`EnterWorktree` with the `path` of that worktree: the PreToolUse check on Edit and Write lets edits
only into the session's worktree, and the agent was started from the orchestrator's worktree. For
an agent, `EnterWorktree` accepts only worktrees under `.claude/worktrees/` of the same repository
— `F worktree.root` must lie there. A root outside the repository (`<HARNESS_HOME>/worktrees/<project>/`)
is not supported yet: the plugin registers no `WorktreeCreate` hook, and
`hooks/worktree-create.sh` is an unprobed draft. Edits that go around it through python or sed in Bash are not a way out.
**`parallel: single`.** No worktree: work in the main checkout, one ticket at a time, on the branch
`F tickets.branch` created from `F worktree.base` (with `local-green` — from the main branch after the
previous ticket's local merge, step 11; see `/worfy:epic-wave`).
