# ship-ticket, step 2: the preflight's answer, the base and the GitHub account

The last line of the output is `GO` or `BLOCKED: <reasons>`, exit code 1 on `BLOCKED`. What exactly
the command checks and what each reason means is in `rules.md`. The reason "another live session in
the worktree" means the command was run from a shared checkout: with `worktrees`, move to your own
worktree (`step-2-worktree.md`, the `parallel: worktrees` paragraph) and repeat; with `single` it
means another session works in the checkout — stop and ask the user.
Any other reason — stop, do not work around it. Put the line `<base>: <sha> …` (the base is
`F worktree.base`; in a repository without `origin` — the branch that line names) into every agent's brief as the base — a subagent that read the local `main`
once reasoned over a stale tree.

If the preflight cannot run here (exit 2: not a git repository, for example the common directory
above a multi-repository project) — say "preflight cannot run here, running a minimal one" and run:
`git -C <repo> fetch`, `git -C <repo> status --porcelain`, how far behind `F worktree.base` the
checkout is, and with `pr-green-ci` also `gh pr list --state open`. Put the line
`git log -1 --format='%h %s' <base>` into the briefs as the base.

**GitHub account** — `F github.account`. `GH_TOKEN` of that account is set by the plugin's
`SessionStart` hook (`hooks/gh-token-env.mjs`) for every Bash command of the session and of its
agents; do not switch the global account without the owner's permission: other sessions use it.
If `gh` answers "Could not resolve to a Repository", compare `gh auth status` with
`F github.account` and say so in the report.
