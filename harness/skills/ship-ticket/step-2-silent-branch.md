# ship-ticket, step 2: the branch in Silent mode

Plugin root: `CLAUDE_PLUGIN_ROOT` in this file is the plugin folder, the one that holds `bin/` and `skills/`: the path you read this file from, without `/skills/ship-ticket/<this file>`. Claude Code spells it out only in SKILL.md and the agent definitions, and Bash may have it empty: in every command below put that folder in its place, or start the command with `export CLAUDE_PLUGIN_ROOT=<that folder>;`.

**Silent mode branch.** There is no `F tickets.branch` template: the branch is named by what the
change does, checked and recorded in the ticket before the worktree is created:

```bash
b=<kind>/<what-the-change-does>        # fix/lot-withdraw-button — no epic name, ticket or ADR number
if "${CLAUDE_PLUGIN_ROOT}/bin/silent-check" -C <repo> "$b"; then          # prints the traces it finds
  (cd <repo> && "${CLAUDE_PLUGIN_ROOT}/bin/ticket" claim <epic> <NN> --branch "$b"); echo "EXIT=$?"   # Status and Branch: in the Workflow folder
else echo "RENAME: the branch name carries a trace of the workflow"; fi
```

`<branch>` in the templates below is then `$b`.

**A ticket of several repositories** — more than one `Repo:` line in its header. Such a project runs
`parallel: single`, and there is no `parallel: worktrees` across several repositories: no worktree,
the ticket holds the main checkout of every repository of those lines (paths — `F _resolved.repos`)
until it is closed, and the preflight (the minimal one, per checkout), the checks and the gate run in
each of them. The branch is one name, `$b`, in all of them: one `Branch:` line, and the key of a
branch is the pair (repository, branch). `silent-check` checks the name in each checkout, the claim
keeps the `Repo:` lines as they stand, and the branch is created in each checkout from that
repository's base (its line of the preflight). The rest — the review, the PRs, the release — is in
`${CLAUDE_PLUGIN_ROOT}/skills/ship-ticket/implementer-silent-mode.md`, "A ticket of several
repositories":

```bash
F() { "${CLAUDE_PLUGIN_ROOT}/bin/profile" -C <repo> --field "$@"; }
b=<kind>/<what-the-change-does>; clean=yes
for r in <the names of the Repo: lines, in their order>; do
  d=$(F _resolved.repos | jq -r --arg r "$r" '.[] | select(.name==$r) | .path' | tr -d '\r')
  "${CLAUDE_PLUGIN_ROOT}/bin/silent-check" -C "$d" "$b" || clean=no
done
if [ "$clean" = yes ]; then (cd <repo> && "${CLAUDE_PLUGIN_ROOT}/bin/ticket" claim <epic> <NN> --branch "$b"); echo "EXIT=$?"
else echo "RENAME: the branch name carries a trace of the workflow"; fi
# then in each of those checkouts: git -C <checkout> switch -c "$b" <its base>; echo "EXIT=$?"
```
