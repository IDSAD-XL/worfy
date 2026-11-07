---
name: connect-project
description: Connect a project to the Harness — read the repository (or the folder above several repositories), propose its profile, rules.md and gate registry entries, and with the user's confirmation write them through bin/project-connect. Use on "/worfy:connect-project <folder> <full|silent>", when worfy's "Add project" dialog asks for a draft (`--draft-only`), or when the user says "connect this project", "register the project in the Harness".
---

# Connect a project

```
/worfy:connect-project <folder> <full|silent> [--draft-only]
```

`<folder>` is a git repository, or a folder that is not in git itself and holds two or more git
repositories as direct subfolders (a project over several repositories). `<full|silent>` is the
mode the user picked (contract: `${CLAUDE_PLUGIN_ROOT}/profiles/README.md`, section "Full mode and
Silent mode"). A project over several repositories is always `silent`.

The result is a **draft**: one JSON object `{ profile, rules, gate }` by the schema
`${CLAUDE_PLUGIN_ROOT}/profiles/draft.schema.json`:

- `profile` — `profile.json`, schema 2, every field of the table in `profiles/README.md`; a field
  the project does not have is `null`;
- `rules` — the text of `rules.md`: facts for agents that do not fit a field, ending with a
  `## Sources` section — file and line of every fact;
- `gate` — gate registry entries, one per repository: `key`, `match` (the absolute path of the
  repository root), `profile` (= `profile.name`), `pm`, `root: {fast, full}` (package scripts the
  gate runs at the root), `workspace` (`{}` for one package), `root_if` when only some files should
  wake the root scripts. All entries of a project over several repositories name one profile.

## You only read files

Nothing is written while the draft is made — not in the project, not in `~/.claude`, not in
`$HARNESS_HOME`. The draft is made with **Read, Glob and Grep only — never Bash**: no git command,
no install, no build, no test run; the commands go into the draft as text.

What only a command could tell — the kind of the folder, and per repository its current and default
branch, whether it has commits, its remotes and `origin` — comes as **facts**: the JSON of
`"${CLAUDE_PLUGIN_ROOT}/bin/project-connect" --facts <folder>`. worfy runs it and puts it under the
first message (`Facts of the repositories …`); take the values from there. In a terminal session
without that block, ask the user to run that one command and paste its output.

## What to read

1. **Checks and stack.** `package.json` scripts and the lock file (pnpm, npm, yarn, bun), a
   `Makefile`, `justfile`, `pyproject.toml`, `Cargo.toml`, `go.mod`; CI workflows
   (`.github/workflows/*.yml`) — they show which commands really run and in what order. Workspaces
   (`pnpm-workspace.yaml`, `workspaces` in `package.json`) decide `layout.packages` and the gate's
   `workspace` scripts.
2. **Workflow files already there.** `.scratch/` (epics, tickets, their `## …` section listing the
   files to edit — `tickets.trail_section`), `HANDOFF.md`, `docs/adr/`, `CONTEXT.md`, `CLAUDE.md`,
   `AGENTS.md`. Their language is `language.docs`. Also `docs/agents/issue-tracker.md`, if there
   is one: an earlier skills setup wrote it, and it says where that setup kept issues (local
   files, GitHub or GitLab).
3. **Branch and remote** — from the facts, not from git: `defaultBranch` gives `worktree.base`
   (`origin/<defaultBranch>` when there is an `origin`), `origin` decides `workflow.finish`.

In a project over several repositories, read each repository, and the folder above them for its
`.scratch/` and `HANDOFF.md`.

## Values you set without asking

- `schema` — `2`; `mode` — the mode from the arguments;
- `workflow.folder` — `null` in Full mode; in Silent mode `null` for the default folder
  `$HARNESS_HOME/projects/<name>/workflow/`, or the folder above the repositories of a project over
  several repositories (its `.scratch/` and `HANDOFF.md` stay where they are);
- `worktree.root` — `<repository>/.claude/worktrees/` for one repository, `null` for several, with
  `worktree.implementer` = `git worktree add -b <branch> <repository>/.claude/worktrees/<NN> <base>`;
  the placeholders stay as written (`<branch>`, `<NN>`, `<epic>`). In Silent mode `project-connect`
  puts `.claude/worktrees/` into each repository's `.git/info/exclude`, so the trees never show in
  git; `rules.md` needs no `.gitignore` advice for them;
- `language.docs` — the language of the documents already there; without documents, the language of
  the user's messages (worfy sets `language.reports` from the system language itself);
- `workflow.finish` — `pr-green-ci` when the facts name an `origin`, else `local-green`;
- `mcp.allowed` — `["plugin_worfy_qmd", "worfy-canvas"]`;
- `attribution` — `"off"` in Silent mode, `"on"` in Full mode: a Silent project's commits and PRs
  carry no Claude attribution lines unless the user asks for them;
- `github.account` — `null` (the account is chosen later);
- `tickets.branch` — `<epic>/<NN>` in Full mode, `null` in Silent mode (the branch is named by the
  change);
- `review.lenses` — two to four lenses that fit the code (correctness, module boundaries, tests,
  security for a web backend); `review.ticket_lenses` — two or three of them.

The profile name: the repository folder name in lower case (the folder above the repositories for
several), letters, digits, dots, dashes and underscores. Every `commands.*` the project lacks is
`null`, never a guess; `commands.verify` joins lint, typecheck and test with `&&`.

## Tracker and glossary of the skills

The planning skills of the plugin (`/worfy:wayfinder`, `/worfy:to-spec`, `/worfy:to-tickets`,
`/worfy:code-review`) have one tracker: the ticket folder `tickets.root` of this profile, read
through `${CLAUDE_PLUGIN_ROOT}/bin/TICKETS.md`, section "Wayfinding operations". Their glossary is
the file `docs.context` of the profile. The draft sets both, and the summary to the user names them:
"Tracker for the skills: `<tickets.root>`; glossary: `<docs.context.path>`" (`none` for a `null`
glossary).

If `docs/agents/issue-tracker.md` names GitHub or GitLab, the summary adds: "Found
`docs/agents/issue-tracker.md` with <GitHub|GitLab>: the worfy skills work only with the ticket
folder `<tickets.root>`, not with that tracker." Leave the file and the `CLAUDE.md` or `AGENTS.md`
block that points to it as they are: nothing is written into the project's repository for the
skills — no `CLAUDE.md` or `AGENTS.md` block, no `docs/agents/`.

## With `--draft-only` (worfy)

Return the draft as the structured output and stop. Do not call `project-connect`, do not ask
questions: worfy shows the draft in a form, the person edits it there, and worfy writes it. The
lines of "Tracker and glossary of the skills" go into `rules` as facts, with `docs/agents/issue-tracker.md`
in `## Sources` when the GitHub or GitLab line is there. For a
Silent draft worfy sets `attribution` to `"off"` itself before the form, whatever the draft says,
and the person changes it in the form.

## Without `--draft-only` (a terminal)

1. Show the draft: the profile fields that matter (name, mode, Workflow folder, commands, gate
   scripts, finish), the tracker and glossary lines of "Tracker and glossary of the skills",
   `rules.md`, the gate entries.
2. Check it, nothing is written:
   `"${CLAUDE_PLUGIN_ROOT}/bin/project-connect" --check <<'JSON' … JSON` — exit 1 names each
   problem with its field (`profile.name: the name is taken`); fix them with the user.
3. Ask for confirmation. Only on an explicit yes:
   `"${CLAUDE_PLUGIN_ROOT}/bin/project-connect" <<'JSON' … JSON; echo "EXIT=$?"`.
   Exit 0 prints `{ name, profileDir, gateKeys, workflowFolder, excludes, qmd }`; `qmd.status:
   "skipped"` carries the reason (no qmd, models not downloaded) — the connection still holds.
4. Verify: `"${CLAUDE_PLUGIN_ROOT}/bin/profile" -C <folder>; echo "EXIT=$?"` — exit 0, the profile
   printed.

`project-connect` writes `$HARNESS_HOME/projects/<name>/` and the gate registry, creates the default
Workflow folder with `git init`, commits once in the git of `$HARNESS_HOME` and rolls everything
back on a failure half-way. In a project's repository it writes only the `.git/info/exclude` line
of Silent mode — no working-tree file, no `.gitignore`.
