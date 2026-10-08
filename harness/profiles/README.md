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
session only by the Harness (`hooks/session-start.sh`, from the folder `_resolved.dir`), never
through the repository's `.claude/rules/`.

Not `~/.claude/projects/` — that is where Claude Code keeps transcripts.

During the transition (schema 1, see below) a profile may still lie in the old place,
`~/.claude/profiles/<name>/`, with the same layout.

## How the profile is found

There is one registry — the gate's `$HARNESS_HOME/gate/config.json` (during the transition, while it
does not exist, the old `~/.claude/gate/config.json`). A project's entry has the field
`"profile": "<name>"`. There is no second registry of paths.

`${CLAUDE_PLUGIN_ROOT}/bin/profile` does the same as `hooks/gate.sh`:
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
   exit 3: the gate, preflight and the session hooks treat it as unregistered). `hooks/gate.sh`
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
otherwise `null`; with it `gate_key` and `repo_root` are `null`).

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
| `language.reports` | `"ru"` \| `"en"` | language of agent reports and messages to the user | all agents, skills |
| `language.team` | `"ru"` \| `"en"` | language of everything the team sees: code comments, commit messages, PR titles and descriptions, review comments and verdicts in PRs. While the profile has no `language.docs`, documents (tickets, `spec.md`, ADRs, the state file) are written in the language their neighbours are already written in; a new set without neighbours — `language.reports`; exceptions — in `rules.md`. The old form is the string `"language": "ru"`: `bin/profile` reads it as `{reports: "ru", team: "ru"}`, so `--field language.team` works on it too | implementer, reviewer, ship-ticket, epic-wave, overnight-fix-loop, continuous-audit |
| `language.docs` | `"ru"` \| `"en"` | language of the project's documents: tickets, the epic spec, ADRs, the state file, lessons. Absent — exit 4, and the reader keeps the rule of `language.team` (the language of the neighbouring documents) | implementer, reviewer, ship-ticket, epic-wave, retro |
| `attribution` | `"on"` \| `"off"` | whether commits and PRs carry the Claude attribution lines. Absent — `--field attribution` prints `on` | agents and skills that commit or open PRs |
| `layout.summary` | string | the code layout in one phrase (packages, repositories) | scout |
| `layout.packages` | strings | package or repository directories | scout, audit |
| `layout.repos` | `{"<repository>": {kind, default_branch, what}}` \| null | a project of several repositories: `kind` — `single` (one package) or `workspaces`; the main branch; what is in it | scout, implementer |
| `layout.read_only` | `[{path, what}]` \| absent | directories next to the project that are only read: run no commands in them, edit nothing | scout, implementer, orchestrator |
| `stack` | strings | the stack — facts, not wishes | all agents |
| `commands.install` | string | installing dependencies in a fresh tree | implementer, reviewer |
| `commands.lint` / `typecheck` / `test` / `build` | string | how the project runs them from the root | all |
| `commands.test_one` | string | a targeted run of one test, with the placeholder `<файл>` (file) | implementer, reviewer |
| `commands.contract` / `e2e` | string \| null | suites not included in `test` | implementer, reviewer |
| `commands.verify` | string | the full local check in one line; agents append `; echo "EXIT=$?"` | implementer, reviewer |
| `commands.prepare_tree` | string | what to do in a freshly created worktree before running checks | orchestrator, reviewer |
| `commands.requires` | strings | what must be up (Docker, a database, the stack) | implementer, reviewer |
| `commands.package` | `{typecheck, test, test_one, names}` \| null | commands of one package of a monorepo: templates with the placeholders `<пакет>` (package name) and `<файл>` (path from the package root, `test_one` only); `names` — package directory → name for `<пакет>` (`{"apps/api": "@auction/api"}`). No field — the root's commands | overnight-fix-loop |
| `modules` | `{deep, flat, skip, heavy}` \| null | what counts as a module: by default a directory right under `<пакет>/src`; `deep` — roots where a module is one level deeper; `flat` — packages that are one module as a whole; `skip` — directory names that form no modules; `heavy` — `{"<пакет>": N}`, no more than N modules of the package at once (the tests bring up their own database or stack) | overnight-fix-loop |
| `tests.new_file` | `{"<пакет>": template}` \| null | where a module's new test file goes; placeholders `<имя>` (module name) and `<каталог модуля>` (module directory) | overnight-fix-loop |
| `tests.globs` | strings \| null | test file name masks (`*.spec.ts`), for `grep --include` | overnight-fix-loop |
| `parallel` | `"worktrees"` \| `"single"` | `worktrees` — several implementers, each in its own worktree; `single` — one implementer, work in the main checkout, no worktree | all agents, epic-wave |
| `worktree.root` | path \| null | where working trees are created | implementer, reviewer, orchestrator |
| `worktree.base` | string \| null | what to branch from (`origin/main`, `origin/master`). `null` — the Harness preflight takes `origin/<layout.repos.<repo>.default_branch>`, then the branch `origin/HEAD` points to, then `origin/main` | implementer, preflight |
| `worktree.implementer` / `reviewer` | string | a ready `git worktree add` command with placeholders: `<ветка>` (branch, = `tickets.branch`), `<имя-тикета>` (ticket name, = `<NN>-<slug>`), `<эпик>` (epic), `<NN>`, `<slug>`, `<что-ревьюишь>` (what is reviewed). worfy names the tree by number only — `…/worktrees/<NN>` | implementer, reviewer, ship-ticket, epic-wave |
| `tickets.root` | path \| null | root of the epics directory (`.scratch/`), with a trailing slash; the audit epic is created there. `bin/ticket`, `bin/epic-status` and `bin/epic-board` take the root from here too (path rules — below the table) | continuous-audit, ticket, epic-status, epic-board |
| `tickets.path` | path template | where a ticket lies | implementer, epic-wave |
| `tickets.trail_section` | string | the ticket section listing the files that may be edited | implementer |
| `tickets.spec` | path template \| null | the epic spec, read together with the ticket | ship-ticket, epic-wave |
| `tickets.branch` | template \| null | the ticket's branch name: `<эпик>/<NN>-<slug>` (auction) or `<эпик>/<NN>` (worfy — number only); epic-wave finds the wave's branches by it when resuming (everything after `<эпик>/` → `*`) | ship-ticket, epic-wave |
| `workflow.ticket_skill` | string \| null | the skill a ticket goes by | implementer |
| `workflow.implementer_steps` | string | which steps of the skill the implementer does | implementer |
| `workflow.finish` | `"pr-green-ci"` \| `"local-green"` | how far the implementer takes the work: a PR with green CI or locally green checks. With `local-green` ship-ticket and epic-wave open no PR and do not merge | implementer, ship-ticket, epic-wave |
| `workflow.merge` | `"orchestrator"` | who merges | implementer, epic-wave |
| `numbering.adr` | `{dir, check}` \| null | the ADR directory and the check that numbers are unique | orchestrator, reviewer, ship-ticket, epic-wave |
| `numbering.migrations` | `{generate, journal, order_key, check}` \| null | how migrations are created and what sets their order | implementer, reviewer, ship-ticket, epic-wave |
| `deploy` | object \| null | `how` — how it deploys; `ci_run_check` — the command that checks the CI run by commit (`$sha` — the merge commit's SHA); `production_check` + `production_expect` — a request to the live address and the expected answer (requirements for the command — below the table); `smoke`, `auth` — explanations; `env` — names of environment variables without which the production checks cannot run (names, not values). `null` — the project does not deploy | orchestrator, ship-ticket, epic-wave |
| `github.account` | string \| null | the `gh` account that opens PRs and runs git commands against origin: if the active `gh` account is another one, every such command starts with `export GH_TOKEN=$(gh auth token -u <account>);` — the global account is not switched; absent — `gh auth status` is only printed | overnight-fix-loop, ship-ticket, epic-wave |
| `serial_merge.paths` | strings | PRs that touch these paths are merged one at a time | epic-wave |
| `serial_merge.rule` | string | when the next one may be merged | epic-wave |
| `docs.context` | `{path, vocabulary_section, decided_in}` \| null | the project's glossary | all agents |
| `docs.handoff` | `{path, kind, check}` \| null | the project's state file and the check of its form | orchestrator, ship-ticket, epic-wave; implementer does not edit it |
| `docs.adr_dir` | path \| null | the ADR directory; implementer does not edit it | implementer, reviewer |
| `lessons` | `"repo:<path>"` \| `"profile"` | where lessons are written: into the repository or into the profile's `lessons/` | retro, ship-ticket, epic-wave, hooks/session-start.sh |
| `session.inject_rules` | bool | `true` — `hooks/session-start.sh` mixes into every session of the project `rules.md` (without the sources section), the lessons index with `lessons: "profile"` and the map of the active epic (`state/active-epic` → `epics/<epic>/map.md`); the text of each section is at most 20000 bytes (`CLAUDE_SESSION_SECTION_CAP`), a longer one is cut with the line "… truncated, full text: <path>". No field or `false` — the session starts empty | hooks/session-start.sh |
| `session.rules_heading` | string | the heading under which `rules.md` is mixed in | hooks/session-start.sh |
| `session.retro_reminder_after` | number \| absent | present — `hooks/session-end.sh` writes every session into `state/pending-retro.log`, and session-start reminds about `/retro` when there are at least this many lines | hooks/session-start.sh, session-end.sh, retro |
| `tasks.tool` | path | what scans tickets and keeps the ticket → task link (`scan`, `link`, `map`) | tickets-to-tasks |
| `tasks.list_id` | template | the epic's `CLAUDE_CODE_TASK_LIST_ID`, `<slug>` — the epic name | tickets-to-tasks |
| `tasks.scan_root` | path | where to look for `.scratch/<epic>/issues/` without an explicit directory | tickets-to-tasks (through `tasks.tool`) |
| `mcp.allowed` | strings \| absent | names of the MCP servers allowed to the agents of the project in the sessions worfy starts (orchestrator, new sessions, Autopilot; their subagents inherit the set). Absent — exit 4, and worfy takes `plugin_worfy_qmd` and `worfy-canvas`, the servers the workflow needs. `plugin_worfy_qmd` is the qmd server of the Harness plugin, which worfy registers under that name (ADR-0048); `qmd` means the user's own server from `~/.claude.json` | worfy |
| `qmd.collections` | strings | `qmd` collections where an answer about the project is expected. A hint, not a filter: agents search the whole index and do not pass this list into the `collections` parameter. Filled by the Harness, not by hand: `bin/qmd-collections <name>` adds `<name>-docs`, `<name>-tickets` and `<name>-memory` to the qmd index and writes their names here; a profile that already names collections present in the index (Auction) keeps them, and only their `update:` is pointed at the plugin's `qmd-sync-main` | all agents; written by qmd-collections |
| `qmd.covers` | string | what lies in them; written by `bin/qmd-collections` together with `qmd.collections` | all agents |
| `qmd.mirror.path` | path \| absent | the git copy of the main branch that the qmd collections of a Full mode project are read from; absent — `~/.cache/qmd/<name>-<branch>`. `~/` is expanded | qmd-sync-main, qmd-collections, qmd-refresh |
| `qmd.mirror.branch` | string \| absent | the branch of that copy; absent — `worktree.base` without `origin/`, and without it `main` | qmd-sync-main, qmd-collections, qmd-refresh |
| `qmd.fallback_grep` | strings | where to search with `grep` if `qmd` is silent | scout |
| `review.lenses` | strings | the project's review lenses; the orchestrator gives each reviewer one | orchestrator |
| `review.ticket_lenses` | strings | two or three of `review.lenses` that ship-ticket runs on every ticket by default | ship-ticket |
| `dev_stack` | `{check, web_port}` \| null | how to make sure the local stack is up | continuous-audit `--live` |
| `audit_lenses` | `[{id, title, where[], finding}]` | continuous-audit lenses: where to look and what counts as a finding | continuous-audit |

Secrets are not written into the profile: no environment variable values, no passwords, no
addresses of private databases. The profile names the variable (`$API_URL`), not its value.

Placeholders inside values (`<эпик>`, `<NN>`, `<пакет>` and the rest above) are part of the
contract: they are substituted as written, not translated.

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
- a broken registry or profile (exit 1) — refusal with exit 1, not a quiet fallback: the status
  would go into the wrong file;
- the `--root <directory>` flag of `ticket` and `epic-status` overrides all of this; `ticket root`
  prints the resulting root.

`epic-status --json --ref <branch>` reads the root from the git of the repository where it lies. A
root outside git (Atakama) — exit 3 and the reason in stderr, not an empty answer. Tests:
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

- `ticket` — moves a ticket's status (`claim`, `block`, `done`);
- `epic-status` — the epic summary: `epic-status <epic>` — one line, `--json [--ref <branch>]` — all
  epics as JSON; `--ref` with the tickets root outside git — exit 3 with the reason;
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

## Schema 1 (transition)

Profiles of schema 1 are read until they are moved to schema 2 and into `$HARNESS_HOME`. How
`bin/profile` reads them:

- **Place.** `~/.claude/profiles/<name>/` is looked at only when `$HARNESS_HOME/projects/<name>/`
  has no `profile.json` (step 3 of the lookup).
- **`mode`.** Schema 1 has no such field; `--field mode` prints `full`: before modes the whole
  Harness worked as Full mode. A schema 1 profile with no `schema` field is read the same way.
- **`attribution`** — absent prints `on`, as in schema 2; **`language.docs`** — absent, exit 4.
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
clear what to check. It is not an instruction to the agent; `hooks/session-start.sh` leaves it out.

## New project

The profile is written on the machine, in `$HARNESS_HOME/projects/<name>/`, not into the project's
repository.

1. An entry in `$HARNESS_HOME/gate/config.json` (`key`, `match`, `pm`, gate scripts) and the field
   `"profile": "<name>"`.
2. `$HARNESS_HOME/projects/<name>/profile.json` with `"schema": 2` and `mode` by the table above;
   fields the project does not have — `null`.
3. `$HARNESS_HOME/projects/<name>/rules.md` with a `## Sources` section.
4. Check: `${CLAUDE_PLUGIN_ROOT}/bin/profile -C <project root>` prints the profile, exit code 0.
