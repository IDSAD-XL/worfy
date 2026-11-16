# ship-ticket: the Code story of the PR

Plugin root: `CLAUDE_PLUGIN_ROOT` in this file is the plugin folder, the one that holds `bin/` and `skills/`: the path you read this file from, without `/skills/ship-ticket/<this file>`. Claude Code spells it out only in SKILL.md and the agent definitions, and Bash may have it empty: in every command below put that folder in its place, or start the command with `export CLAUDE_PLUGIN_ROOT=<that folder>;`.

A Code story is a short step-by-step account of the change for the person responsible for the code: the key
fragments of the diff, what each does, why it is there, what breaks without it, the requirement it answers and
what the tests leave out. Whoever opens the ticket's PR writes it, as the last step before `gh pr create`, after
the Evidence lines and their commit.

**When.** Only when `"${CLAUDE_PLUGIN_ROOT}/bin/profile" -C <repo> --field code_stories.pr` prints `on` (the
default when the profile does not set it). `off` — say "Code story skipped: code_stories.pr is off". With
`workflow.finish: "local-green"` there is no PR and no story. With `on`, `land` does not merge a ticket's PR
without its story or with a red `story-check`: the story is part of the PR, not an extra.

**Where.** `<tickets root>/<epic>/stories/<NN>-<slug>.md`, where `<tickets root>` is what
`"${CLAUDE_PLUGIN_ROOT}/bin/ticket" root` prints and `<NN>-<slug>` is the name of the ticket file. In Silent mode
that root is in the Workflow folder: the story lies there, and the branch gets nothing — as with Evidence lines.

**Format** — `${CLAUDE_PLUGIN_ROOT}/bin/TICKETS.md`, section **Code story**; a sample is
`${CLAUDE_PLUGIN_ROOT}/bin/tests/fixtures/code-story/pr-en.md`. The title is `# Code story — <epic> <NN>: <ticket
title>`, the header `Kind: pr · Epic: <epic> · Ticket: <NN> · PR: - · Language: <code>`: the PR has no number
yet, and a reader takes it from the ticket's `PR:` line. `<code>` is `language.reports` of the profile; with
`ru` the labels are the Russian ones of the table in `${CLAUDE_PLUGIN_ROOT}/bin/tests/fixtures/code-story/README.md`.

**What it says — decisions and the evidence for them.**
- Order of explanation, not of files. The first step is `What was wrong`, with a `Requirement` link to the
  section of the ticket it answers. Then the code steps, each leading the reader towards how it is checked, not
  retelling the code. Then, when there is something to say, `What was deliberately not changed` and `How it was
  checked` (the commands with their exit codes). Never `What review found and what remains`: the documents PR
  appends it after the merge.
- A code step has one fragment — the line `` Code: `<path>:<from>-<to>` · key lines: <n> `` and the lines
  `<from>` to `<to>` of that file copied exactly — and every field: `What it does`, `Why here`, `Without it`,
  `Requirement` (a link to a section of the ticket or the spec, relative to the story file), `Risks and test gaps`.
- A field whose reason nobody wrote down says `not recorded`. Never fill it with a guess.
- `Why here` holds only what the ticket, the spec, an ADR or the diff records. When the ticket lists the file in
  its section of files (`tickets.trail_section`), say so: the place is named in the ticket; the reason for the
  rule is `not recorded` unless the ticket, the spec, an ADR or the diff records it. Never guess who calls the
  code, what else uses it, or a motive.
  Bad: `Why here: the only place the invoice formats dates; the rest of the code calls formatDate`.
  Good: `Why here: the ticket names src/date.mjs among its files; why the format is ISO is not recorded`.
- Size: one to three code steps for a small PR, up to ten for a large one.
- The words are in the language of `language.reports`; code, names and terms stay as the code spells them.
- No host name, user name in a path, email or token: `story-check` looks for them.

**Check it, then commit it.**
- Full mode: in your worktree, `"${CLAUDE_PLUGIN_ROOT}/bin/story-check" <story>; echo "EXIT=$?"`. A story not
  committed yet is read against the working tree. `EXIT=2` lists `<story>:<step>: <what is wrong>`: fix the story
  (a fragment copied wrong, a field missing) and run it again. `EXIT=1` — it could not check, the reason on
  stderr (the main branch, a quoted file not committed). Green — commit the story on your branch, in the same PR,
  and run the same command once more: now it reads `HEAD`, the head the PR will have.
- Silent mode: the anchor is `HEAD` of your branch, so commit the code first and write the story after. Run
  `"${CLAUDE_PLUGIN_ROOT}/bin/story-check" --repo <your worktree> <story>; echo "EXIT=$?"`: it reads `HEAD`, and it
  refuses (exit 1) a quoted file with changes that are not committed.
- A fix after review goes into the same branch: update the story together with the code and run `story-check`
  again on the new head before you push.

**After the PR** — the link to the story goes into the PR description as its own section: the block of
`/worfy:ship-ticket`, step 8 (`step-8-pr-and-ci.md`). In the report, a claim with `item` `null`, the text
`Code story: <story path>` and the evidence `story-check <story> exit 0`.
