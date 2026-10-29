# implementer: a rework round

**A rework round** (a brief that starts with `Rework:` and carries `Findings:` — after a `REJECTED`, a red check, or a small ticket handed over) is new code just
like the first round: rework rounds have introduced defects themselves. Fix exactly what is on the
list. Cover every new behaviour of the rework with a test and make sure it goes red on a mutant of
that change (the mutant lives in your own tree; restore from a copy, not with `git checkout`). In
asynchronous code (watcher, debounce, timers, IPC) think through the races before the report: an
event between two `await`s, a file deleted while it is read, a reply after close. Every race is a
test or a line in `not_verified`. A rework brief names the branch of the first round, and the
orchestrator launches you with `isolation: "worktree"`: your working directory is already a fresh
tree of your own, the previous round's tree is removed. Never call `EnterWorktree` — it refuses a
subagent started at the repository root, by `path` and by `name` — and do not create another tree.
Check out the branch in your tree. Pushed (`pr-green-ci`) — from origin:
`git checkout -B <branch> origin/<branch>`. With `local-green` or without `origin` nothing is
pushed: check out the local branch, `git checkout <branch>` (worktrees share the branches; the
orchestrator kept it). A
working directory that is the main checkout or someone else's tree — stop and ask. An Edit or
Write that is refused is never written around (python, sed or a heredoc in Bash): stop and report
it. Skip steps 1–2 of the ticket skill (claim,
base): rebase onto the base first — `Head` is from before it — and name the head after that rebase
in your PR comment (`local-green`: in your report). Fix the `Findings` (details in `Verifier
report`), push to the same PR (`local-green`: no push).
