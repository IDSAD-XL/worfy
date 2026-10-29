# ship-ticket, step 11: Close

Plugin root: `CLAUDE_PLUGIN_ROOT` in this file is the plugin folder, the one that holds `bin/` and `skills/`: the path you read this file from, without `/skills/ship-ticket/<this file>`. Claude Code spells it out only in SKILL.md and the agent definitions, and Bash may have it empty: in every command below put that folder in its place, or start the command with `export CLAUDE_PLUGIN_ROOT=<that folder>;`.

**Local finish** — only with `local-green` (contract: `profiles/README.md`, "Local finish"). The
ticket closes when its branch is merged locally into the main branch of its repository and the local
`gate full` is green on exactly what is merged. The main branch is `F worktree.base` without
`origin/`; without it — `default_branch` of this repository in `F layout.repos`, then the branch
`origin/HEAD` points to, then a local `main` or `master`. Never the branch the main checkout stands
on: with `single` that is the ticket branch itself. The steps go in this order, and each has one
doer:

1. **On top of the main branch — the implementer.** If the branch is not on top of the main branch
   (`git merge-base --is-ancestor <main branch> <ticket branch>` — exit 1), the orchestrator sends
   the ticket back through `SendMessage`; the implementer rebases it in its own worktree (with
   `single` — the main checkout), resolves conflicts there (a migration is regenerated with
   `F numbering.migrations.generate`, not merged by hand), runs its checks again and reports — as
   with a `DIRTY` PR.
2. **The gate — the orchestrator.** `node "${CLAUDE_PLUGIN_ROOT}/hooks/gate.mjs" full </dev/null; echo
   "EXIT=$?"` in the ticket's worktree — `EXIT=0` and the line `[gate] green (…)`: this code is
   exactly what the main branch gets. A red gate stops here: no documents, no merge.
3. **The documents and the merge — whoever `F workflow.merge` names (the orchestrator), in one go
   under the lock** of `/worfy:epic-wave`, section 4, one merge at a time. Full mode: first, under the
   lock, `git -C <repo> merge-base --is-ancestor <main branch> <ticket branch>`, where `<main branch>` is
   found in the order given above — the same order as the lines `M=` of the block below — exit 1 sends the
   branch back to the implementer (step 1) before any document is written. Exit 0 — right before the
   block, in the ticket's worktree, `ticket done` (without `--pr`), the ticket's result section, and —
   when this is the wave's last merged ticket — the state file and `ticket block` of the tickets removed
   from the wave; these edits stay uncommitted. The block commits them on the ticket branch only after
   the branch has passed the on-top check, and fast-forwards the main branch right after, so a ticket
   branch that never reached the main branch does not carry `done`. It commits only this epic's
   folder of the tickets root and the state file (`git commit -- <those paths>`): other changes of the
   tree and anything already staged stay out. In Silent mode the block finds nothing to commit (the
   documents are in the Workflow folder), and `ticket done` follows `MERGED=0`. `<repo>` is the
   repository's main checkout, `<ticket worktree>` the ticket's tree (with `single` — `<repo>` itself):

```bash
F() { "${CLAUDE_PLUGIN_ROOT}/bin/profile" -C <repo> --field "$@" 2>/dev/null; }
B=<ticket branch>; T=<ticket worktree>; E=<epic>; DOCS_FAILED=
# the documents: this epic's folder and the state file — nothing else of the tree
DOCS=(); r=$(F tickets.root); h=$(F docs.handoff.path)
[ -n "$r" ] && [ "$r" != null ] && [ -e "$T/${r%/}/$E" ] && DOCS+=("${r%/}/$E")
[ -n "$h" ] && [ "$h" != null ] && [ -e "$T/$h" ] && DOCS+=("$h")
M=$(F worktree.base); [ "$M" = null ] && M=
[ -n "$M" ] || M=$(F layout.repos | jq -r --arg r "$(basename "$(cd <repo> && pwd -P)")" '.[$r].default_branch // empty' 2>/dev/null | tr -d '\r')
[ -n "$M" ] || M=$(git -C <repo> symbolic-ref -q --short refs/remotes/origin/HEAD)
[ -n "$M" ] || for c in main master; do git -C <repo> rev-parse -q --verify "refs/heads/$c" >/dev/null && { M=$c; break; }; done
M=${M#origin/}
W=$(git -C <repo> worktree list --porcelain | awk -v b="branch refs/heads/$M" 'BEGIN { while ((getline l) > 0) { if (l ~ /^worktree /) w = substr(l, 10); if (l == b) print w } }')
if [ -z "$M" ]; then echo "NO MAIN BRANCH: set worktree.base in the profile"
elif [ "$M" = "$B" ]; then echo "SAME BRANCH: $B is the main branch itself, nothing to merge"
elif ! git -C <repo> merge-base --is-ancestor "$M" "$B"; then echo "NOT ON TOP: back to the implementer — rebase $B onto $M"
  # the prepared documents go back to the branch's state: the rebase needs a clean tree, and no commit carries done
  [ "${#DOCS[@]}" -gt 0 ] && git -C "$T" restore -q --source=HEAD --staged --worktree -- "${DOCS[@]}" \
    && echo "DOCS ROLLED BACK in $T: prepare them again after the rebase"
else
  # the documents: only now, on a branch that is on top — then the fast-forward at once
  if [ "${#DOCS[@]}" -gt 0 ] && [ -n "$(git -C "$T" status --porcelain -- "${DOCS[@]}")" ]; then
    git -C "$T" add -A -- "${DOCS[@]}" && git -C "$T" commit -q -m "<documents commit message>" -- "${DOCS[@]}" \
      || { DOCS_FAILED=1; echo "DOCS COMMIT FAILED in $T: $M not moved — fix the cause (hook, signing, user.email), run the block again"; }
  fi
  if [ -n "${DOCS_FAILED:-}" ]; then :
  elif [ -n "$W" ]; then git -C "$W" merge --ff-only --quiet "$B"; else git -C <repo> branch -f "$M" "$B"; fi
fi
[ -z "${DOCS_FAILED:-}" ] && [ -n "$M" ] && [ "$M" != "$B" ] && git -C <repo> merge-base --is-ancestor "$B" "$M"; echo "MERGED=$?"     # 0 — the branch is in the main branch
echo "MAIN=$M"
```

`MERGED=0` is the proof; anything else — the ticket is not done:
- `NOT ON TOP` — the block also rolls the prepared documents back to the branch's state
  (`DOCS ROLLED BACK`): the implementer's rebase needs a clean tree, and the branch must not get `done`.
  After the rebase and a green `gate full` the documents are prepared again.
- `DOCS COMMIT FAILED` (a commit hook, signing, no `user.email`) — the main branch is not moved and
  `MERGED=1`; the documents stay staged in the ticket's worktree. Fix the cause and run the block
  again.
- `NO MAIN BRANCH` or `SAME BRANCH` (`MERGED=1`) — a profile problem, not the ticket's: the block
  commits, merges and rolls back nothing, so the prepared documents stay uncommitted in the ticket's
  worktree. Fix the profile (`F worktree.base`) and run the block again; if the ticket will not be
  merged now, roll them back by hand with the same `git -C "$T" restore -q --source=HEAD --staged
  --worktree -- <documents>` as in `NOT ON TOP`, so no commit of the branch carries `done`.
- A break between the documents commit and the fast-forward, or a fast-forward that failed: the
  branch carries `done` but is not in the main branch. Run the block again — the documents are
  already committed, so it commits nothing a second time and only fast-forwards. A second run after
  `MERGED=0` changes nothing and prints `MERGED=0` again.

Nothing is pushed: the finish is local. With
`single` the main checkout stays on the ticket branch; the next ticket's branch is created from the
main branch. In Silent mode `ticket done` follows now; in Full mode it reached the main branch with
the fast-forward. With `pr-green-ci`:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/ticket" done <epic> <NN> --pr <N>     # with local-green — without --pr (step 3 above)
```

With `deploy` in the Pipeline (section 0) `ticket done` waits for the deploy: skill
`/worfy:epic-wave`, section 4, "Deploy before close" — who deploys, and the block that says whether
the merge commit is deployed. `DEPLOYED=none` — the ticket stays `claimed` with its PR merged, and
the report says "waits for deploy".

The state file is `F docs.handoff` (`path`, `kind`, `check`). No field — "the project has no state
file, nothing to update". If it exists, it is the only state file — a snapshot for whoever picks
the work up next, not a log: at a phase boundary it is **rewritten**, not appended to. Rewrite only
the lines of your own epic; do not add a block per ticket or per wave. Each item is either still
true (update it), or moves to its place — a lesson where `F lessons` says (`repo:<path>` — into the
repository, `profile` — into the profile's `lessons/`), the story of what was done into the PR
description (with `local-green` — into the commit message) and the ticket's result section, the
owner's answer into an ADR or the ticket — or is deleted. In Silent mode the story goes into the
ticket's result section in the Workflow folder, not into the PR description or the commit message, and
the state file, the lessons and the ADRs are files of the Workflow folder; when it is a git repository
they are committed there locally (`/worfy:epic-wave`, section 4, item 4), without push.

- Low-severity debts from review stay in the ticket's result section; the state file holds one
  line that links there.
- What waits for the owner: one line per item, with a link to its ticket. An item this PR
  finishes is deleted in this PR. An item waiting longer than two weeks becomes a ticket for the
  owner's step and leaves the state file. Keep the list to about ten items.
- A closed epic is one line among the pointers to where the rest lives.

`F docs.handoff.check` checks the form — run it before push, if the profile sets it; what exactly
it requires — `rules.md`. Do not touch ADRs: they are immutable.
