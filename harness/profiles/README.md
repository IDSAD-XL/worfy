# Project profiles

A profile is everything that tells one project apart from another for the shared agents and skills:
commands, paths, the parallel-work mode, deploy, review and audit lenses. The `scout`,
`implementer` and `reviewer` agents (`${CLAUDE_PLUGIN_ROOT}/agents/`) are the same for every
project; their first action is to run `${CLAUDE_PLUGIN_ROOT}/bin/profile`, and from then on they
follow what it printed.

**The orchestrator writes the repository or worktree path into every brief** for these agents. The
agent runs `profile -C <path from the brief>`, and without a path — `profile` in the directory it
was started in; that is the orchestrator's directory, and it may lie outside the project or in
another project. Without a path in the brief the agent gets someone else's profile or exit code 3.

What the agent does by exit code: `0` — works by the profile; `1`, `2`, `3` — scout and reviewer
write the code as the first line of their answer and do not guess commands or paths, implementer
stops and returns a report whose first `not_verified` line is the reason; `4` — the step that rests
on the field is skipped.

This file is the contract. A skill, hook or agent that needs a project fact reads it from the
profile by a field described here, and does not keep it itself.

## Where it lives

The profile lives on the machine, in the Harness state folder (`HARNESS_HOME`, by default
`~/.claude/worfy-harness/`):

```
$HARNESS_HOME/projects/<name>/
  profile.json   machine-readable facts (schema below)
  rules.md       prose for agents: facts that do not fit into a field
  lessons/       optional: lessons, if the project keeps them outside the repository (lessons: "profile");
                 lessons.md — the full log, lessons-index.md — one line per lesson
  bin/           optional: the project's tools named by profile fields (tasks.tool)
  epics/         optional: epic maps (<epic>/map.md — versioned; task-map.json is written by
                 tickets-to-tasks and is git-ignored)
  state/         working state of the hooks (pending-retro.log, active-epic); not versioned
```

There is no profile in the project's repository and no PR with a profile. `rules.md` is mixed into a
session only by the Harness (`hooks/session-start.mjs`, from the folder `_resolved.dir`), never
through the repository's `.claude/rules/`.

Not `~/.claude/projects/` — that is where Claude Code keeps transcripts.

During the transition (schema 1, see below) a profile may still lie in the old place,
`~/.claude/profiles/<name>/`, with the same layout.

## User personalization

Two settings belong to the person, not to a project, and hold for every project on the machine.
Both files are optional and are written by hand; the Harness only reads them.

```
$HARNESS_HOME/user.json        {"language": {"reports": "ru"}}
$HARNESS_HOME/user/rules.md    the user's own rules, in prose
```

- **`user.json`, field `language.reports`** — the language of agent reports and messages to the
  user: `"en"`, `"ru"` or another language code. `bin/profile --field language.reports` answers
  from it first, then (for one more release) from the profile's own `language.reports`, then `en`;
  the summary and `--json` show the same resolved value. Other fields of the file are ignored:
  `language.team` and `language.docs` stay in the profile. A file that is not JSON, not an object,
  or has a `language.reports` that is not a non-empty string is one line on stderr and is skipped;
  `bin/profile` still answers with exit 0.
- **`user/rules.md`** — rules the user wants in every session, for example rules for writing in
  their language. `hooks/inject-rules.mjs` appends the file to the part `common` under the heading
  `## User rules`, in `SessionStart` and in `SubagentStart`, so subagents get it too. The Harness
  neither reads its meaning nor checks it. The part and the file together stay within the hook
  limit of 10,000 characters; a longer file is cut after a whole line, and a closing line names the
  file. An empty file adds nothing; a file that cannot be read is one line on stderr, and the part
  arrives without it.

## How the profile is found

There is one registry — the gate's `$HARNESS_HOME/gate/config.json` (during the transition, while it
does not exist, the old `~/.claude/gate/config.json`). A project's entry has the field
`"profile": "<name>"`. There is no second registry of paths.

`${CLAUDE_PLUGIN_ROOT}/bin/profile` does the same as `hooks/gate.mjs`:
1. directory → `git rev-parse --git-common-dir` → the canonical root of the main repository
   (so a worktree anywhere on disk is recognised by its repository);
2. `hooks/gate-resolve.mjs --which <root>` — the longest `match` prefix in the registry; the path
   is brought to its spelling on disk (native `realpath`), so on a case-insensitive filesystem
   `/users/alexey/work/auction` is recognised as `/Users/alexey/Work/Auction`;
3. the `profile` field of the found entry → `$HARNESS_HOME/projects/<name>/profile.json`; if it is
   not there — during the transition `~/.claude/profiles/<name>/profile.json` (schema 1). If it is
   in both places, `$HARNESS_HOME` wins. `_resolved.dir` is the folder where the profile was found.
4. No `match` fits — the common directory (workspace): if the directory lies inside the common
   parent of all repositories of ONE profile (the profile has at least two entries), the profile is
   that one. So `/Users/alexey/Work/Atakama` (above the three Atakama repositories, not git itself)
   and the directories outside git next to them get the `atakama` profile. The parent is computed
   from the registry, not stored. It does not count: the disk root, `$HOME`, a directory holding a
   repository of another profile or of an entry without a profile, and any directory inside a git
   repository that is not in the registry (`/Users/alexey/Work/Atakama/flux-config-platform` —
   exit 3: the gate, preflight and the session hooks treat it as unregistered). `hooks/gate.mjs`
   does not take this step: the gate checks only registered repositories.

Several registry entries (for example, three repositories of one product) may name one profile.

```
profile                    summary: name, paths, profile.json and rules.md — this is what agents read
profile --json             profile.json + the _resolved block
profile --field a.b.c      one field; a string is printed as is, anything else as JSON
profile --rules            only rules.md
profile --dir | --name     the profile's folder or name
profile -C <directory> ... resolve as if run from <directory> (a relative one — from the current)
```

`_resolved` (computed, not stored in the file): `name`, `dir` (the folder where the profile was
found), `gate_key`, `repo_root`, `checkout` (the root of the current working tree), `in_worktree`
(true if the checkout is not the main one), `workspace` (the common directory from step 4,
otherwise `null`; with it `gate_key` and `repo_root` are `null`), `mode` (`full` or `silent`; schema 1
is `full`), `workflow_folder` (the absolute path of the Workflow folder in both modes — section
"Full mode and Silent mode"), `repos` (the project's repositories, `[{name, path, gate_key}]`: every
registry entry that names this profile; `name` is the folder name of the repository, `path` its
`match`, `gate_key` its `key`), `pipeline` (`workflow.pipeline` as written, or the default Pipeline when the
field is absent or `null` — see the field in the table below). In Silent mode the summary printed without flags has one more line,
`mode: silent   workflow folder: <path>`; the Full mode summary is unchanged.

Exit codes: `0` found; `2` usage error; `3` the directory is outside the registered projects, the
entry has no `profile` field, or the profile file exists in neither place (a one-line message in
stderr); `4` no such field (`--field`); `1` broken registry, resolver or `profile.json` (including
an unsupported `schema` and a schema 2 profile without a valid `mode`).

`profile` only reads: it writes nothing, neither into `HARNESS_HOME` nor into `~/.claude`.

Variables for tests: `HARNESS_HOME`, `CLAUDE_GATE_CONFIG`, `CLAUDE_GATE_RESOLVE`,
`CLAUDE_PROFILES_DIR` (a folder of profiles that replaces both places of step 3).
Tests: `bash bin/tests/profile.test.sh` from the plugin root (in the worfy repository —
`harness/bin/tests/profile.test.sh`).

## profile.json

A field the project does not have is `null` or absent; the agent then skips the step rather than
guessing. Skills (`ship-ticket`, `epic-wave`) read a field through `--field`: exit 4 or a printed
`null` — the step is skipped, and the skill says so in words, not silently. Commands are written
the way the project really runs them.

| Field | Type | What it means | Who reads |
|---|---|---|---|
| `schema` | number | format version, currently `2`; `1` is read during the transition (section "Schema 1"); any other value — exit 1 | all |
| `name` | string | profile name = folder name | all |
| `title` | string | the project's human name | reports |
| `mode` | `"full"` \| `"silent"` | where the workflow files (tickets, the epic spec, the state file, ADRs, lessons) live: `full` — in the repository (Full mode); `silent` — outside git, in the project's Workflow folder (Silent mode). Required in schema 2: absent or another value — exit 1 with the reason in stderr, because a guessed mode would quietly put the workflow files in the wrong place | all skills and agents that write workflow files |
| `language.reports` | `"ru"` \| `"en"` | language of agent reports and messages to the user. It belongs to the user, not to the project: `bin/profile` answers it from the user's `$HARNESS_HOME/user.json` (section "User personalization"), then, for one more release, from this field of the profile, then `en`. A new profile leaves it out | all agents, skills |
| `language.team` | `"ru"` \| `"en"` | language of everything the team sees: code comments, commit messages, PR titles and descriptions, review comments and verdicts in PRs. Absent — `bin/profile` prints `en`. The old form is the string `"language": "ru"`: `bin/profile` reads it as `{reports: "ru", team: "ru", docs: "ru"}`, so `--field language.team` works on it too | implementer, reviewer, ship-ticket, epic-wave, overnight-fix-loop, continuous-audit |
| `language.docs` | `"ru"` \| `"en"` | language of the project's documents: tickets, the epic spec, ADRs, the state file, lessons. Absent — `bin/profile` prints `en` | implementer, reviewer, ship-ticket, epic-wave, retro |
| `attribution` | `"on"` \| `"off"` | whether commits and PRs carry the Claude attribution lines. Absent or `null` — the default follows `mode`: `--field attribution` prints `off` in Silent mode and `on` in Full mode (worfy ADR-0061). `"on"` or `"off"` written here wins in both modes; any other value — exit 1 with the reason in stderr, as with `mode` | agents and skills that commit or open PRs |
| `layout.summary` | string | the code layout in one phrase (packages, repositories) | scout |
| `layout.packages` | strings | package or repository directories | scout, audit |
| `layout.repos` | `{"<repository>": {kind, default_branch, what}}` \| null | a project of several repositories: `kind` — `single` (one package) or `workspaces`; the main branch; what is in it | scout, implementer |
| `layout.read_only` | `[{path, what}]` \| absent | directories next to the project that are only read: run no commands in them, edit nothing | scout, implementer, orchestrator |
| `stack` | strings | the stack — facts, not wishes | all agents |
| `commands.install` | string | installing dependencies in a fresh tree | implementer, reviewer |
| `commands.lint` / `typecheck` / `test` / `build` | string | how the project runs them from the root | all |
| `commands.test_one` | string | a targeted run of one test, with the placeholder `<файл>` (file) | implementer, reviewer |
| `commands.contract` / `e2e` | string \| null | suites not included in `test` | implementer, reviewer |
| `commands.verify` | string | the full local check in one line; agents append `; echo "EXIT=$?"`. A line that runs the gate names `node <plugin>/hooks/gate.mjs` or `bash <plugin>/hooks/gate.sh`, the spelling of profiles moved from the old Harness. Both work; where node is not on PATH, `gate.sh` answers "could not verify: node not found" with code 3 and replaces the verdict file, while `node …/gate.mjs` fails with 127 before the gate starts | implementer, reviewer |
| `commands.prepare_tree` | string | what to do in a freshly created worktree before running checks | orchestrator, reviewer |
| `commands.requires` | strings | what must be up (Docker, a database, the stack) | implementer, reviewer |
| `commands.package` | `{typecheck, test, test_one, names}` \| null | commands of one package of a monorepo: templates with the placeholders `<пакет>` (package name) and `<файл>` (path from the package root, `test_one` only); `names` — package directory → name for `<пакет>` (`{"apps/api": "@auction/api"}`). No field — the root's commands | overnight-fix-loop |
| `modules` | `{deep, flat, skip, heavy}` \| null | what counts as a module: by default a directory right under `<пакет>/src`; `deep` — roots where a module is one level deeper; `flat` — packages that are one module as a whole; `skip` — directory names that form no modules; `heavy` — `{"<пакет>": N}`, no more than N modules of the package at once (the tests bring up their own database or stack) | overnight-fix-loop |
| `tests.new_file` | `{"<пакет>": template}` \| null | where a module's new test file goes; placeholders `<имя>` (module name) and `<каталог модуля>` (module directory) | overnight-fix-loop |
| `tests.globs` | strings \| null | test file name masks (`*.spec.ts`), for `grep --include` | overnight-fix-loop |
| `workflow.folder` | absolute path \| null | the Workflow folder of a Silent mode project (section "Full mode and Silent mode"); `~/` is expanded, a relative path is a broken profile (exit 1). `null` or absent — the folder above the repositories for a project of several repositories, otherwise `$HARNESS_HOME/projects/<name>/workflow/`. Full mode ignores it: the Workflow folder is the root of the working tree. Written when the project is connected | profile (`_resolved.workflow_folder`), all skills and agents that write workflow files, qmd-collections |
| `parallel` | `"worktrees"` \| `"single"` | `worktrees` — several implementers, each in its own worktree; `single` — one implementer, work in the main checkout, no worktree | all agents, epic-wave |
| `worktree.root` | path \| null | where working trees are created. worfy and Auction keep `.claude/worktrees/` inside the repository. The planned default for projects connected from E3 on is `<HARNESS_HOME>/worktrees/<name>/` (outside the repository, so the project's test runner and linter never walk into it, and `.gitignore` needs no entry), with a ticket's tree at `<worktree.root><NN>`. It is **not set** — the connection does not write it — and not supported until worfy-harness ticket 24: an implementer subagent edits only in a tree under `.claude/worktrees/` of the repository (`EnterWorktree` refuses any other), so until then `worktree.root` lies there, as skill `ship-ticket` requires. Ticket 22 (item 7) found one way that ticket 24 can build on: a `WorktreeCreate` hook with `isolation: "worktree"` — live probes with a test script given through `claude -p --settings` pinned the subagent to a tree outside the repository. The plugin does not register such a hook: `hooks/worktree-create.sh` is an unregistered draft, never probed through the plugin, and it is not Claude Code's own worktree creation for a root inside the repository (no reuse of an existing tree, no cleanup, no fetch, no `.worktreeinclude`). `bin/profile`, `hooks/gate.mjs` and `bin/worktree-lock` recognise a tree outside the repository by `git rev-parse --git-common-dir` | implementer, reviewer, orchestrator |
| `worktree.base` | string \| null | what to branch from (`origin/main`, `origin/master`). `null` — the Harness preflight takes `origin/<layout.repos.<repo>.default_branch>`, then the branch `origin/HEAD` points to, then `origin/main` | implementer, preflight |
| `worktree.implementer` / `reviewer` | string | a ready `git worktree add` command with placeholders: `<ветка>` (branch, = `tickets.branch`), `<имя-тикета>` (ticket name, = `<NN>-<slug>`), `<эпик>` (epic), `<NN>`, `<slug>`, `<что-ревьюишь>` (what is reviewed). worfy names the tree by number only — `…/worktrees/<NN>` | implementer, reviewer, ship-ticket, epic-wave |
| `tickets.root` | path \| null | root of the epics directory (`.scratch/`), with a trailing slash; the audit epic is created there. `bin/ticket`, `bin/epic-status` and `bin/epic-board` take the root from here too (path rules — below the table) | continuous-audit, ticket, epic-status, epic-board |
| `tickets.path` | path template | where a ticket lies | implementer, epic-wave |
| `tickets.trail_section` | string | the ticket section listing the files that may be edited | implementer |
| `tickets.spec` | path template \| null | the epic spec, read together with the ticket | ship-ticket, epic-wave |
| `tickets.branch` | template \| null | the ticket's branch name: `<эпик>/<NN>-<slug>` (auction) or `<эпик>/<NN>` (worfy — number only); epic-wave finds the wave's branches by it when resuming (everything after `<эпик>/` → `*`). Silent mode has no template (`null`): a branch is named by what it changes and is recorded in the ticket's `Branch:` line | ship-ticket, epic-wave |
| `workflow.ticket_skill` | string \| null | the skill a ticket goes by | implementer |
| `workflow.implementer_steps` | string | which steps of the skill the implementer does | implementer |
| `workflow.finish` | `"pr-green-ci"` \| `"local-green"` | how the ticket finishes: a PR with green CI, merged by `workflow.merge`; or `local-green` — no PR: the ticket closes when the local `gate full` is green and its branch is merged locally into the main branch of its repository (section "Local finish"), and `ticket done` goes without `--pr` | implementer, ship-ticket, epic-wave |
| `workflow.merge` | `"orchestrator"` | who merges | implementer, epic-wave |
| `workflow.merge_gate` | `"each"` \| `"wave"` \| null | the gate before the merge of a PR with code (`pr-green-ci`; `local-green` has its own, section "Local finish"). Absent or `null` — the Harness requires none; `"each"` — every PR is rebased and gets its own `GATE_SCOPE=all` gate full; `"wave"` — one gate full for the set of a wave's ready PRs, `bin/wave-gate` (worfy ADR-0065); PRs the project's rules call platform PRs and PRs with the label `needs-mac-gate` stay out of the set. Any other value — exit 1 with the reason | epic-wave (section 4, "Gate before merge"), ship-ticket (step 9) |
| `workflow.ci` | `"pr"` \| `"batch"` \| null | where GitHub CI runs (`pr-green-ci`). Absent or `null` — `bin/profile` resolves it to `"pr"`: CI on every PR head is a merge condition, as before. `"batch"` (worfy ADR-0068; the owner calls it a bad practice, so it is opt-in per project) — CI is not a merge condition: a PR merges on `workflow.merge_gate` (plus the other platform's verdict for a platform PR) when `mergeable` is `MERGEABLE`, whatever its old checks say, and CI runs once on the main branch after the wave is merged — `bin/wave-gate ci`. Any other value — exit 1 with the reason; exit 4 only when the profile has no `workflow` at all, and that reads as `"pr"` | implementer, ship-ticket (steps 8–9), epic-wave (sections 3–5), overnight-fix-loop, bin/wave-gate (through its CI file) |
| `workflow.ci_batch_run` | string \| null | the command that starts the CI run on a branch, `$ref` — the branch name (worfy: `gh workflow run ci.yml --ref $ref -f job=check`). Required with `workflow.ci: "batch"` (absent or blank — exit 1); not read with `"pr"`. Another type — exit 1 | bin/wave-gate ci, epic-wave |
| `workflow.e2e_lock` | absolute path \| null | the directory every e2e run and every gate full of the project takes as a lock (`mkdir`; older than 30 min — abandoned; heartbeat `touch -c` every 5 min; released on exit and on error). `~/` is expanded; absent or `null` — no lock; a relative path or another type — exit 1 | bin/wave-gate (through the state file), epic-wave, the project's rules |
| `workflow.pipeline` | `[{kind, name?, label?, stuck_after?, environment?}]` \| null | the Pipeline: the Stages a ticket goes through, in order, from a fixed catalogue of kinds, each with its predicate in the code of worfy and the Harness (worfy ADR-0067): `queued`, `implementing`, `ci`, `agent-review`, `human-review`, `check`, `gate-merge`, `awaiting-merge`, `deploy`, `closing`, `done`. `name` — `check` only, and required there: the agent's mark `check/<name>` the Stage waits for (lower case letters, digits, dashes); `label` — the Stage's name on the board; `stuck_after` — `"<number>h"` or `"<number>m"`, how long a ticket may stay on the Stage before it counts as stuck; `environment` — `deploy` only: the GitHub Deployment environment, without it the Stage waits for the commit status `deploy`. Rules: `queued` first, `done` last, each kind once (`check` once per `name`), `gate-merge` and `awaiting-merge` not together; any other field or value — exit 1 with the reason. Absent or `null` — the default Pipeline `queued, implementing, ci, agent-review, gate-merge, closing, done`; either way `bin/profile` resolves it into `_resolved.pipeline`. The profile picks no expressions or scripts of its own: a new kind is a change of worfy and the Harness. Written by `bin/profile-set`; an editor or any caller writes the Pipeline through it. It checks the value with the same rules (`lib/pipeline.cjs`), writes only while the file still has the Pipeline the caller read (`--expect <fingerprint>` from `--read`), `--reset` removes the field, writers of one profile take turns under a lock, and the change is committed in the git repository of the Harness home | profile (`_resolved.pipeline`), worfy's board, `profile-set` |
| `numbering.adr` | `{dir, check}` \| null | the ADR directory and the check that numbers are unique | orchestrator, reviewer, ship-ticket, epic-wave |
| `numbering.migrations` | `{generate, journal, order_key, check}` \| null | how migrations are created and what sets their order | implementer, reviewer, ship-ticket, epic-wave |
| `deploy` | object \| null | `how` — how it deploys; `ci_run_check` — the command that checks the CI run by commit (`$sha` — the merge commit's SHA); `production_check` + `production_expect` — a request to the live address and the expected answer (requirements for the command — below the table); `smoke`, `auth` — explanations; `env` — names of environment variables without which the production checks cannot run (names, not values). `null` — the project does not deploy | orchestrator, ship-ticket, epic-wave |
| `github.account` | string \| null | the `gh` account that opens PRs and runs git commands against origin: the plugin's `SessionStart` hook (`hooks/gh-token-env.mjs`) appends `export GH_TOKEN="$(gh auth token -u <account> 2>/dev/null)"` to `CLAUDE_ENV_FILE`, so every Bash command of the session and its agents runs as this account; the global account is not switched; no login under it — the session gets one line of context instead; absent — `gh` runs as the active account | hooks/gh-token-env.mjs, overnight-fix-loop, ship-ticket, epic-wave |
| `cross_machine_gate.label` | string | the name of the GitHub label on the PRs of the `request` machine that touch shared code (worfy: `needs-mac-gate`). Skills take it from here and never write it in their text | epic-wave (sections 1 and 4), gate-queue, ship-ticket (steps 8 and 9) |
| `cross_machine_gate.role` | `"request"` \| `"serve"` | this machine's part, written in each machine's own profile (worfy: the Windows PC — `request`, the Mac — `serve`). `request` — puts the label on its PRs with shared code and does not merge them; at the start of each wave it runs gate full on the fresh base first. `serve` — before each wave goes through the open labelled PRs one at a time: rebase, `check`, the commands of the `checks_section` section, a report in the PR, then the merge (skill gate-queue) | epic-wave (sections 1 and 4), gate-queue, ship-ticket (steps 8 and 9) |
| `cross_machine_gate.exempt` | strings \| null | paths whose change needs no label: documents and files no other machine reads (worfy: `.scratch/`, `docs/`, `HANDOFF.md`, `CONTEXT.md`, `README.md`). `/`-separated as `gh` prints a PR's files; a path that ends with `/` is a folder, as in `filesOverlap` of worfy (`src/shared/workflow/waves.ts`); no quote or backslash. Absent or `null` — nothing is exempt, every PR gets the label. Read with `request` | ship-ticket (step 8) |
| `cross_machine_gate.check` | string \| null | the command that checks a labelled PR's branch on the `serve` machine, run in the PR's worktree under the project's e2e lock (worfy: `GATE_SCOPE=all` gate full). Required with `serve`. Read with `serve` | gate-queue |
| `cross_machine_gate.checks_section` | string | the heading of the PR description section with the commands the `serve` machine runs beyond `check`, each with its expected result, or the line `none` (worfy: `Mac checks`). `request` writes the section, `serve` runs it and starts its report in the PR with `<checks_section> report: green` or `… red`; a labelled PR without the section is red | gate-queue, epic-wave (section 1, `request`), ship-ticket (step 8) |
| `serial_merge.paths` | strings | PRs that touch these paths are merged one at a time | epic-wave |
| `serial_merge.rule` | string | when the next one may be merged | epic-wave |
| `docs.context` | `{path, vocabulary_section, decided_in}` \| null | the project's glossary | all agents |
| `docs.handoff` | `{path, kind, check}` \| null | the project's state file and the check of its form | orchestrator, ship-ticket, epic-wave; implementer does not edit it |
| `docs.adr_dir` | path \| null | the ADR directory; implementer does not edit it | implementer, reviewer |
| `lessons` | `"repo:<path>"` \| `"profile"` | where lessons are written: into the repository or into the profile's `lessons/` | retro, ship-ticket, epic-wave, hooks/session-start.mjs |
| `session.inject_rules` | bool | `true` — `hooks/session-start.mjs` mixes into every session of the project `rules.md` (without the sources section), the lessons index with `lessons: "profile"` and the map of the active epic (`state/active-epic` → `epics/<epic>/map.md`); the text of each section is at most 20000 bytes (`CLAUDE_SESSION_SECTION_CAP`), a longer one is cut with the line "… truncated, full text: <path>". No field or `false` — the session starts empty | hooks/session-start.mjs |
| `session.rules_heading` | string | the heading under which `rules.md` is mixed in | hooks/session-start.mjs |
| `session.retro_reminder_after` | number \| absent | present — `hooks/session-end.mjs` writes every session into `state/pending-retro.log`, and session-start reminds about `/retro` when there are at least this many lines | hooks/session-start.mjs, session-end.mjs, retro |
| `tasks.tool` | path | what scans tickets and keeps the ticket → task link (`scan`, `link`, `map`) | tickets-to-tasks |
| `tasks.list_id` | template | the epic's `CLAUDE_CODE_TASK_LIST_ID`, `<slug>` — the epic name | tickets-to-tasks |
| `tasks.scan_root` | path | where to look for `.scratch/<epic>/issues/` without an explicit directory | tickets-to-tasks (through `tasks.tool`) |
| `mcp.allowed` | strings \| absent | names of the MCP servers allowed to the agents of the project in the sessions worfy starts (orchestrator, new sessions, Autopilot; their subagents inherit the set). Absent — exit 4, and worfy takes `plugin_worfy_qmd` and `worfy-canvas`, the servers the workflow needs. `plugin_worfy_qmd` is the qmd server of the Harness plugin, which worfy registers under that name (ADR-0048); `qmd` means the user's own server from `~/.claude.json` | worfy |
| `qmd.collections` | strings | `qmd` collections where an answer about the project is expected. A hint, not a filter: agents search the whole index and do not pass this list into the `collections` parameter. Filled by the Harness, not by hand: `bin/qmd-collections <name>` adds `<name>-docs`, `<name>-tickets` and `<name>-memory` to the qmd index and writes their names here; a profile that already names collections present in the index (Auction) keeps them, and only their `update:` is pointed at the plugin's `qmd-sync-main` | all agents; written by qmd-collections |
| `qmd.covers` | string | what lies in them; written by `bin/qmd-collections` together with `qmd.collections` | all agents |
| `qmd.mirror.path` | path \| absent | the git copy of the main branch that the qmd collections of a Full mode project are read from; absent — `~/.cache/qmd/<name>-<branch>`. `~/` is expanded | qmd-sync-main, qmd-collections, qmd-refresh |
| `qmd.mirror.branch` | string \| absent | the branch of that copy; absent — `worktree.base` without `origin/`, and without it `main` | qmd-sync-main, qmd-collections, qmd-refresh |
| `qmd.fallback_grep` | strings | where to search with `grep` if `qmd` is silent | scout |
| `review.lenses` | strings | the project's review lenses; the orchestrator gives each reviewer one. What a lens looks for is described in `agents/reviewer.md`, section "Lens descriptions"; a lens that has no description there is read by its name. The lens `simplification` described there may be named `упрощение` in a profile | orchestrator |
| `review.ticket_lenses` | strings | two or three of `review.lenses` that ship-ticket runs on every ticket by default | ship-ticket |
| `review.depth.wave` | `"low"` \| `"medium"` \| `"high"` \| `"max"` \| null | the review depth of a wave's gate: how many agents check each ticket, which lenses, how much mutation testing, which findings get a sceptic; the scale is described in skill `ship-ticket`, step 7, and what each depth adds to the gate in skill `epic-wave`, section 3. An argument of the skill overrides it. absent or `null` — `low` depth (one verifier), and the skill says in its report that it took the default. Above `low` every ticket of the wave costs more: `high` is 5.3–6.4 million subagent tokens per ticket and round | epic-wave |
| `review.depth.first_round` | `"low"` \| `"medium"` \| `"high"` \| `"max"` \| null | the review depth of the first review round of a ticket's diff (ship-ticket, step 7) and of a PR another session or person wrote (ship-ticket, section "Review of a PR another session wrote"). An argument of the skill or the owner's word in a message overrides it. absent or `null` — the review of a ticket's own diff stays as it was, without a depth (two or three reviewers by `review.ticket_lenses`, the same cost as before), and a PR another session wrote gets `high` depth (`medium` depth for a PR of tests and comments only); the skill says in its report that it took the default. `max` depth is `high` depth and then skill `max-review` | ship-ticket |
| `review.depth.later_rounds` | `"low"` \| `"medium"` \| `"high"` \| `"max"` \| null | the review depth of every round after rework, for the same reviews as `review.depth.first_round`. absent or `null` — the repeat review of a ticket's own diff stays as it was, and a PR another session wrote gets `medium` depth; the skill says in its report that it took the default | ship-ticket |
| `dev_stack` | `{check, web_port}` \| null | how to make sure the local stack is up | continuous-audit `--live` |
| `audit_lenses` | `[{id, title, where[], finding}]` | continuous-audit lenses: where to look and what counts as a finding | continuous-audit |

Secrets are not written into the profile: no environment variable values, no passwords, no
addresses of private databases. The profile names the variable (`$API_URL`), not its value.

Placeholders inside values (`<эпик>`, `<NN>`, `<пакет>` and the rest above) are part of the
contract: they are substituted as written, not translated.

`cross_machine_gate` (worfy ADR-0069) is checked by `bin/profile` the way `mode` is. No field, or
`null` — exit 4 for `--field cross_machine_gate.<name>` (the project has one machine: the skills skip
the step and say so). Exit 1 with the reason in stderr: `role` neither `"request"` nor `"serve"`, no
`label`, no `checks_section` (absent or blank), `"serve"` without `check`, `exempt` that is not a
list of `/`-separated paths, `check` that is not a command string. A guessed role would either merge
a PR without the other machine's gate full, or leave it with nobody to merge it.

`tickets.root` — how `bin/ticket`, `bin/epic-status` and `bin/epic-board` read it:
- an absolute path (`/Users/alexey/Work/Atakama/.scratch/`) or `~/…` — taken as is. This is how a
  project of several repositories writes the root when its tickets lie in the common directory
  (workspace) outside git: from any of its repositories and from the common directory itself the
  tickets are the same;
- a relative one (`.scratch/`) — from the root of the current working tree
  (`git rev-parse --show-toplevel`): the tickets travel in the branch, each worktree has its own.
  Outside git — from `_resolved.workspace`, otherwise from the current directory;
- `null`, no field, or the directory is not registered (exit 3 from `profile`) — as before profiles:
  `<git top-level or the current directory>/.scratch`;
- **Silent mode** (`mode: "silent"`): a relative root is taken from the Workflow folder
  (`_resolved.workflow_folder`), and `null` or no field means `<Workflow folder>/.scratch`. The root is
  then the same from every worktree, from the main checkout and from the Workflow folder itself;
- a broken registry or profile (exit 1) — refusal with exit 1, not a quiet fallback: the status
  would go into the wrong file;
- the `--root <directory>` flag of `ticket` and `epic-status` overrides all of this; `ticket root`
  prints the resulting root.

`epic-status --json --ref <branch>` reads the root from the git of the repository where it lies. A
root outside git (Atakama) — exit 3 and the reason in stderr, not an empty answer. In Silent mode
`--ref` is exit 3 with "in Silent mode the status does not live in branches": the status is written
straight into the Workflow folder. Tests:
`bash bin/tests/tickets-root.test.sh` from the plugin root; variables for tests —
`CLAUDE_PROFILE_BIN` (what `ticket` reads the profile with), `CLAUDE_TICKET_BIN` (what `epic-status`
takes the root from).

`deploy.production_check` is one line that skills run as `got=$(<command>); echo "EXIT=$?"`.
Requirements: the password does not get into the process arguments (they are visible in `ps`) — the
pair goes through stdin, for example `printf 'user = "%s:%s"\n' "$USER_VAR" "$PASS_VAR" | curl -K - …`
(`printf` is a shell builtin, there is no separate process); the characters `"` and `\` in the pair
must be escaped in such a config — auction does it with
`esc() { printf '%s' "$1" | sed 's/[\\"]/\\&/g'; }` (the value goes into `sed` through stdin, not as
an argument), the check is `bin/tests/production-check.test.sh`; the exit code is not lost —
`set -o pipefail` at the start of the line, `curl -f` and `jq -e`, so a 401, an empty answer or an
unset variable give a non-zero code and read as "not verified".

## The Harness's own scripts

Four scripts are constants of the Harness, the same for every project, and not facts of a project;
they are not profile fields. They live in `${CLAUDE_PLUGIN_ROOT}/bin/`:

- `ticket` — moves a ticket's status (`claim`, `block`, `done`); `ticket claim <epic> <NN> --branch
  <branch>` also writes the header line `Branch: <branch>`, and `--repo <name>` the line `Repo: <name>`
  (a name from `_resolved.repos`, checked against it);
- `epic-status` — the epic summary: `epic-status <epic>` — one line, `--json [--ref <branch>]` — all
  epics as JSON; `--ref` with the tickets root outside git, or in Silent mode, — exit 3 with the
  reason. Every ticket in the JSON has `branch` and `repo` — the values of its `Branch:` and `Repo:`
  lines, `null` without one (worfy reads them: worfy-harness ticket 23);
- `silent-check` — looks for traces of the workflow in a text (`silent-check -C <dir> <text>`,
  `--file <path|->`) or in the added lines and file names of a diff (`--diff <rev>`, `--cached`); the
  rules are in section "Full mode and Silent mode". Exit 0 — clean or nothing to check, 1 — traces
  found (one line each: where, what kind, the match), 2 — usage or profile error;
- `preflight --epic <epic>` — the check before a ticket or a wave; it also prints the next free ADR
  and migration numbers, which are taken before the content. Contract: the last line of the output
  is `GO` or `BLOCKED: <reasons>`, exit code 1 on `BLOCKED`; the line `<base>: <sha> …` is the base
  for briefs. `preflight` takes `epic-status` next to itself, not from the profile. The base is
  `worktree.base`; when it is `null` (a project of several repositories whose main branches
  differ, like Atakama: `master` in two repositories, `main` in the third) — `origin/<default_branch>`
  of this repository from `layout.repos`, then the branch `origin/HEAD` points to, and only then
  `origin/main`. So every repository of such a project runs the Harness preflight against its own
  main branch. Exit 2 (not a git repository — for example the common directory above the
  repositories of such a project, — or a project that is not registered) — the skill runs a minimal
  preflight itself (`git fetch`, the state of the tree, open PRs).

The qmd scripts are Harness constants too (worfy ADR-0043; skill `qmd`): `qmd-mcp` starts the MCP
server of `.mcp.json` (only after the user agreed to the models: `$HARNESS_HOME/qmd-models` starts
with `downloaded`), `qmd-refresh` is the Stop hook that updates the index when a main branch moved,
`qmd-sync-main <name>` pulls the copy of `qmd.mirror`, and `qmd-collections <name>` adds a project's
collections. `qmd-collections` reads the documents from that copy in Full mode (it clones the copy
when there is none, with the token of `github.account`) and from the Workflow folder in Silent mode
(`workflow.folder`, by default `$HARNESS_HOME/projects/<name>/workflow`); it writes `index.yml` (a
dated copy of the old one next to it), the `qmd` field of `profile.json` and nothing in the project's
repository.

## Full mode and Silent mode

`mode` decides where the **workflow files** live — tickets, epic specs, the state file, ADRs, the
glossary, lessons, evidence screenshots (worfy ADR-0042). The folder they live in is the **Workflow
folder**, `_resolved.workflow_folder`:

- **Full mode** — the root of the current working tree: the files are in the repository and travel in
  the branches, as worfy and Auction have always worked. Nothing below changes Full mode except
  `attribution` and the local finish, which hold in both modes.
- **Silent mode** — a folder outside the project's repositories: `workflow.folder`; without it the
  folder above the repositories of a project of several repositories (Atakama keeps its `.scratch/` and
  `HANDOFF.md` there), otherwise `$HARNESS_HOME/projects/<name>/workflow/`, which by default is a local
  git repository for history only (no remote unless the user adds one). A project of several
  repositories is always Silent (ADR-0045).

The Workflow folder has the same layout in both modes, so one reader (worfy, ticket 23) reads both:

```
<Workflow folder>/
  .scratch/<epic>/spec.md, map.md, issues/NN-slug.md, evidence/
  HANDOFF.md        the state file (docs.handoff.path)
  docs/adr/         ADRs (docs.adr_dir, numbering.adr.dir)
  docs/lessons/     lessons with lessons: "repo:docs/lessons"
  CONTEXT.md        the glossary (docs.context.path)
```

**Paths.** In Silent mode a relative path in `tickets.root`, `tickets.path`, `tickets.spec`,
`docs.handoff.path`, `docs.adr_dir`, `numbering.adr.dir`, `docs.context.path` and `lessons:
"repo:<path>"` is taken from the Workflow folder, not from the working tree; an absolute one or `~/…`
stays as it is. `bin/profile` prints the fields as written; `bin/ticket`, `bin/epic-status`,
`bin/epic-board` and `bin/preflight` apply the rule, and skills say "relative to
`_resolved.workflow_folder`". In Full mode the rule is the old one.

**What Silent mode changes:**

- **Status.** `ticket claim|block|done` from any worktree writes into the ticket in the Workflow folder;
  there is one status and no branch carries it. `epic-status --json --ref` is exit 3; `epic-board`
  reads the folder alone, without branch marks.
- **Ticket header.** `Branch: <branch>` — written by `ticket claim … --branch <branch>`: the branch name
  says nothing about the ticket, so the ticket names its branch, and a wave resumes by these lines.
  `Repo: <name>` — the ticket's repository in a project of several repositories (one ticket — one
  repository); the name comes from `_resolved.repos`. Both are machine lines with English keys.
- **Documents.** Skills and agents write workflow files only into the Workflow folder; the documents
  in the repository are read-only. The exception is a ticket whose own goal is a document for the team
  (a README of a feature), and its "what we do" section says so.
- **ADR numbers.** `bin/preflight` counts them from the files of the ADR directory in the Workflow
  folder (a duplicate number there — `BLOCKED`), not from `git ls-tree` of branches.
- **Branches, commits, PRs.** A branch is named by what it changes (`fix/lot-withdraw-button`). Commit
  messages, PR titles, descriptions and comments, and code comments describe the change itself. There
  is no documents PR and no documents commit in the repository: what Full mode commits there is a local
  commit in the Workflow folder when it is a git repository, without push. With `local-green` a review
  verdict is a line in the ticket's result section in the Workflow folder, not an empty `gate:` commit.
- **Traces.** A trace of the workflow is: an epic name of the project (a directory of the tickets
  root), `<epic>/<NN>`, `ADR-<4 digits>`, `Ticket <number>` or `Ticket-<number>`, the Workflow folder
  path, `.scratch`, `HANDOFF`. `bin/silent-check` finds them (in the added lines of a diff a bare epic
  name is not looked for: code names its own areas, and epics are often named after them).
  `hooks/guard.mjs` (PreToolUse, Bash) runs it from the command's directory and refuses: `git commit`
  (`-m`, `-F`, the index, and the whole tree after `git add` in the same command), the branch name of
  `git checkout -b`, `git switch -c`, `git branch <name>`, `git worktree add -b`, and `gh pr
  create|edit|comment|review|merge` (`--title`, `--body`, `--body-file`, `--subject`). Commits in the
  Workflow folder itself are not checked: it is not one of the project's repositories.
- **Session context.** `hooks/session-start.mjs` tells every session of a Silent project where the
  Workflow folder is and that the repository gets no traces, whatever `session.inject_rules` says.

**`attribution: off`** (any mode): commits and PRs of the project carry no Claude attribution lines
(`Co-Authored-By: Claude …`, `Generated with [Claude Code]`). `hooks/session-start.mjs` says so in every
session of the project, and the guard refuses the commands above when their text carries such a line.
`on` — as before.

A profile that does not set `attribution` gets the default of its mode: **`off` in Silent mode, `on`
in Full mode** (worfy ADR-0061, which refines item 6 of ADR-0042). A value written in the profile
wins in both modes: `"on"` in a Silent project keeps the lines, `"off"` in a Full project drops
them. `null` reads as "not set"; a value that is neither `"on"` nor `"off"` (`""`, `"OFF"`, `0`,
`false`) is a broken profile, exit 1, as a wrong `mode` is.

`bin/profile` resolves the value: `--field attribution`, `--json` and the summary print it, and
`bin/silent-check`, the guard, `hooks/session-start.mjs` and the skills read it from there and know
no default of their own. The rule "Silent — `off`, Full — `on`" is written in four places:

- `bin/profile` — a profile without the field;
- worfy's "Add project": for a Silent project worfy sets `off` over whatever the draft says, once,
  before the form is shown; the person may change the field there, and that choice is written. A
  Full draft keeps the value the Session proposed (`src/main/projects/connect.ts`, `applyChoices`);
- worfy's move of schema 1 profiles: the value the old profile names, else the default of the
  proposed mode (`src/main/harness/migrate/profiles.ts`);
- the text of skill `connect-project`, which names the value by the mode.

The two worfy places share one function (`src/main/harness/attribution.ts`), and
`test/contract/projects-connect.test.ts` of worfy holds it to what `bin/profile --field attribution`
prints for a profile without the field, in both modes; `bin/tests/project-connect.test.sh` holds
the skill's sentence. The draft schema requires the field, so a project connected through worfy
carries the value explicitly.

## Local finish

With `workflow.finish: local-green` (a project without PR rights or without `origin`, ADR-0045) a
ticket closes when the local `gate full` is green on its branch **and** the branch is merged locally
into the main branch of its repository; `ticket done` goes without `--pr`. Before that change
`local-green` merged nothing.

How it is merged (skill `ship-ticket`, step 11; `epic-wave`, section 4). The main branch is
`worktree.base` without `origin/`; without it — `layout.repos.<repo>.default_branch`, then the branch
`origin/HEAD` points to, then a local `main` or `master`. Never the branch the main checkout stands on:
with `parallel: single` that is the ticket branch itself.

1. **The implementer** puts the ticket branch on top of the main branch: `git rebase <main>` in its own
   worktree (with `single` — the main checkout), conflicts resolved there (a migration is regenerated,
   not merged by hand), its checks run again. The orchestrator only checks `git merge-base
   --is-ancestor <main> <branch>` and sends the branch back when it is not on top.
2. **The orchestrator**: `gate full` on the ticket branch — that code is exactly what the main branch
   gets. A red gate stops the finish: no documents commit, no merge.
3. **Whoever `workflow.merge` names** (the orchestrator), in one block under the lock: Full mode — the
   ticket's documents (`ticket done`, its result section; for the wave's last merged ticket also the
   state file and `ticket block` of removed tickets), prepared uncommitted in the ticket's worktree,
   are committed on the ticket branch only after the on-top check, and the main branch is
   fast-forwarded right after: `git merge --ff-only` in the worktree where it is checked out, or
   `git branch -f <main> <branch>` when it is checked out nowhere. A wave with no `VERIFIED` ticket
   left to merge commits its documents on the main branch under the lock (in a temporary worktree of
   the main branch when it is checked out nowhere). Silent mode commits nothing in the repository:
   `ticket done` writes into the Workflow folder after the merge.
   Refused: a branch that is not on top ("NOT ON TOP"; the block also rolls the prepared documents back
   in the ticket's worktree, so the implementer's rebase there starts from a clean tree), the ticket
   branch being the main branch itself ("SAME BRANCH"), no main branch found ("NO MAIN BRANCH"). A
   documents commit that fails (a commit hook, signing) moves nothing: "DOCS COMMIT FAILED" and
   `MERGED=1`. A documents commit takes only the epic's folder of the tickets root and the state file
   (`git commit -- <paths>`), never the rest of the index. Running the block again is safe: committed
   documents are not committed twice. `git merge-base --is-ancestor <branch> <main>` — exit 0 — is the
   proof. Nothing is pushed.

Merges go one at a time, under the same lock as merges of PRs (skill `epic-wave`, section 4).

## Schema 1 (transition)

Profiles of schema 1 are read until they are moved to schema 2 and into `$HARNESS_HOME`. How
`bin/profile` reads them:

- **Place.** `~/.claude/profiles/<name>/` is looked at only when `$HARNESS_HOME/projects/<name>/`
  has no `profile.json` (step 3 of the lookup).
- **`mode`.** Schema 1 has no such field; `--field mode` prints `full`: before modes the whole
  Harness worked as Full mode. A schema 1 profile with no `schema` field is read the same way.
- **`attribution`** — absent prints `on`: schema 1 is always Full mode, whose default is `on`;
  **`language.docs`** — absent prints `en`; the string form of `language` gives all three fields its
  value.
- **The four path fields.** Schema 1 has `tickets.status_tool`, `tickets.epic_status`,
  `workflow.preflight` (with the placeholder `<эпик>`) and `numbering.reserve_with` — paths to the
  Harness, not facts of the project. A value that starts with `~/.claude/bin/` or with its
  absolute form `$HOME/.claude/bin/` (the Harness before the plugin) is replaced with the same
  script next to `bin/profile`: `~/.claude/bin/ticket` → `<bin>/ticket`,
  `~/.claude/bin/preflight --epic <эпик>` → `<bin>/preflight --epic <эпик>`. Any other value is
  left as it is, and `null` stays `null` (Atakama has `workflow.preflight: null`). Schema 2 has no
  such choice — the Harness preflight is one for all projects; skills no longer read these fields,
  so Atakama's repositories now go through the Harness preflight too (its base — section "The
  Harness's own scripts").
- **The same four fields in schema 2.** They are not in the table and not read from the file. So
  that a reader that still asks for one does not break, `--field` (and `--json`) answers with this
  Harness's own script: `tickets.status_tool` → `<bin>/ticket`, `tickets.epic_status` →
  `<bin>/epic-status`, `numbering.reserve_with` → `<bin>/preflight`, `workflow.preflight` →
  `<bin>/preflight --epic <эпик>`, where `<bin>` is the folder of `bin/profile`.
- **`language`** as a string — expanded into `{reports, team}` (the `language.team` row).

## rules.md

Prose that the agent reads whole (`profile` without flags prints it after the JSON). Facts that
cannot be expressed as a field go here: tool pitfalls ("`pnpm test -- <file>` does not filter"),
mandatory steps ("after editing `packages/shared` — a build"), the project's prohibitions. There are
no general working rules here — they are in the agents.

`rules.md` is not a reading list. The agent opens the paths in it only when the task needs them.
If a project really needs documents the implementer must read beyond `CLAUDE.md` / `AGENTS.md`, the
ticket and the brief, they are listed under a separate heading
`## Обязательное чтение исполнителя` (required reading for the implementer), and only there.

At the end — a `## Sources` section (in the existing Russian profiles `## Источники`): where the
facts come from (file and line), for whoever maintains the profile, so that on a mismatch it is
clear what to check. It is not an instruction to the agent; `hooks/session-start.mjs` leaves it out.

## New project

The profile is written on the machine, in `$HARNESS_HOME/projects/<name>/`, not into the project's
repository, and only by `${CLAUDE_PLUGIN_ROOT}/bin/project-connect` — worfy's "Add project" dialog
and a terminal session (skill `connect-project`) both call it.

1. `project-connect --facts <folder>` reads, and writes nothing, what only a command could tell: the
   kind of the folder and per repository its branches, remotes (without credentials) and `origin`.
   Skill `connect-project` gets that JSON as data — the draft is made with Read, Glob and Grep only,
   never Bash — reads the project's files and proposes a draft `{ profile, rules, gate }` by the
   schema `profiles/draft.schema.json`: `profile.json` (schema 2, `mode` by the table above, fields
   the project does not have — `null`), the text of `rules.md` with a `## Sources` section, and the
   gate registry entries (`key`, `match`, `profile`, `pm`, gate scripts), one per repository.
2. `project-connect --check < draft.json` checks it and writes nothing: the schema, the name not
   taken, no `match` or `key` already in the registry, Silent mode for several repositories, no
   Workflow folder in Full mode, a chosen Workflow folder outside the repositories. Exit 1 lists the
   problems as `{ path, kind, message }`.
3. `project-connect < draft.json` writes `profile.json` and `rules.md`, appends the entries to
   `$HARNESS_HOME/gate/config.json`, creates the default Workflow folder of a Silent project
   (`workflow.folder: null` → `$HARNESS_HOME/projects/<name>/workflow/`, `git init`, left out of the
   Harness home's history) and records the path in `workflow.folder`, and commits once in the git of
   `$HARNESS_HOME` (`git init` and the `.gitignore` of a Harness home first when it is none). A
   Silent project's repositories get `.claude/worktrees/` in their `.git/info/exclude` (the common
   git dir; once; nothing in `.gitignore` or a tracked file), where `worktree.root` puts the ticket
   trees. A failure half-way rolls back what was written; exit 1, nothing left. Only after the commit it adds
   the qmd collections when qmd and its models are there (otherwise the step is skipped with the
   reason); their `qmd` field joins the same commit. A qmd failure undoes nothing else: when
   `index.yml` was written before it (`qmd update` failed), the field stays and only that is reported.
4. Check: `${CLAUDE_PLUGIN_ROOT}/bin/profile -C <project root>` prints the profile, exit code 0.

Exit codes of `project-connect`: `0` written (or checked); `1` the draft failed a check, or the write
failed and was rolled back (with `--facts`: the folder is no repository and holds fewer than two);
`2` usage. Its output is JSON: `{ name, profileDir, gateKeys, workflowFolder, excludes, qmd }`. Tests: `bash bin/tests/project-connect.test.sh` from the plugin root.
