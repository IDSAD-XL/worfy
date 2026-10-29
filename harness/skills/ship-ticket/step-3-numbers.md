# ship-ticket, step 3: Take numbers before the content

Plugin root: `CLAUDE_PLUGIN_ROOT` in this file is the plugin folder, the one that holds `bin/` and `skills/`: the path you read this file from, without `/skills/ship-ticket/<this file>`. Claude Code spells it out only in SKILL.md and the agent definitions, and Bash may have it empty: in every command below put that folder in its place, or start the command with `export CLAUDE_PLUGIN_ROOT=<that folder>;`.

Take the next free number from the output of step 2; do not run it a second time (the preflight's
`ADR:` and `migrations:` lines; details — `rules.md`). If the preflight could not run, the number
is printed by `"${CLAUDE_PLUGIN_ROOT}/bin/preflight"` from a repository checkout. Count across all `origin/*` and local branches, not
within one directory. A number is taken with a placeholder at once and the content is written
later: that is how 0039 turned into 0059, when two sessions took the same number. In Silent mode the
ADRs are files of the Workflow folder, in no branch: the preflight counts them there, and the
placeholder is a file in the Workflow folder's ADR directory, not a commit in the repository.

Migrations — only with `F numbering.migrations.generate`. Order is kept by the field
`F numbering.migrations.order_key` in `F numbering.migrations.journal`, not by the file name; what
happens when two green branches merge and how to fix it — `rules.md`. For reference: a duplicate
ADR number and a broken migration order are caught later by `F numbering.adr.check` and
`F numbering.migrations.check`; do not run them as a separate step here.
