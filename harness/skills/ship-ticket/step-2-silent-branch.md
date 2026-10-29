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
