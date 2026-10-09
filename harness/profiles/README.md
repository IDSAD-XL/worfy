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
otherwise `null`; with it `gate_key` and `repo_root` are `null`), `mode` (`full` or `silent`; schema 1
is `full`), `workflow_folder` (the absolute path of the Workflow folder in both modes — section
"Full mode and Silent mode"), `repos` (the project's repositories, `[{name, path, gate_key}]`: every
registry entry that names this profile; `name` is the folder name of the repository, `path` its
`match`, `gate_key` its `key`). In Silent mode the summary printed without flags has one more line,
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
| `workflow.folder` | absolute path \| null | the Workflow folder of a Silent mode project (section "Full mode and Silent mode"); `~/` is expanded, a relative path is a broken profile (exit 1). `null` or absent — the folder above the repositories for a project of several repositories, otherwise `$HARNESS_HOME/projects/<name>/workflow/`. Full mode ignores it: the Workflow folder is the root of the working tree. Written when the project is connected | profile (`_resolved.workflow_folder`), all skills and agents that write workflow files, qmd-collections |
| `parallel` | `"worktrees"` \| `"single"` | `worktrees` — several implementers, each in its own worktree; `single` — one implementer, work in the main checkout, no worktree | all agents, epic-wave |
| `worktree.root` | path \| null | where working trees are created. worfy and Auction keep `.claude/worktrees/` inside the repository. The planned default for projects connected from E3 on is `<HARNESS_HOME>/worktrees/<name>/` (outside the repository, so the project's test runner and linter never walk into it, and `.gitignore` needs no entry), with a ticket's tree at `<worktree.root><NN>`. It is **not set** — the connection does not write it — and not supported until worfy-harness ticket 24: an implementer subagent edits only in a tree under `.claude/worktrees/` of the repository (`EnterWorktree` refuses any other), so until then `worktree.root` lies there, as skill `ship-ticket` requires. Ticket 22 (item 7) found one way that ticket 24 can build on: a `WorktreeCreate` hook with `isolation: "worktree"` — live probes with a test script given through `claude -p --settings` pinned the subagent to a tree outside the repository. The plugin does not register such a hook: `hooks/worktree-create.sh` is an unregistered draft, never probed through the plugin, and it is not Claude Code's own worktree creation for a root inside the repository (no reuse of an existing tree, no cleanup, no fetch, no `.worktreeinclude`). `bin/profile`, `hooks/gate.sh` and `bin/worktree-lock` recognise a tree outside the repository by `git rev-parse --git-common-dir` | implementer, reviewer, orchestrator |
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
| `numbering.adr` | `{dir, check}` \| null | the ADR directory and the check that numbers are unique | orchestrator, reviewer, ship-ticket, epic-wave |
| `numbering.migrations` | `{generate, journal, order_key, check}` \| null | how migrations are created and what sets their order | implementer, reviewer, ship-ticket, epic-wave |
| `deploy` | object \| null | `how` — how it deploys; `ci_run_check` — the command that checks the CI run by commit (`$sha` — the merge commit's SHA); `production_check` + `production_expect` — a request to the live address and the expected answer (requirements for the command — below the table); `smoke`, `auth` — explanations; `env` — names of environment variables without which the production checks cannot run (names, not values). `null` — the project does not deploy | orchestrator, ship-ticket, epic-wave |
| `github.account` | string \| null | the `gh` account that opens PRs and runs git commands against origin: the plugin's `SessionStart` hook (`hooks/gh-token-env.sh`) appends `export GH_TOKEN="$(gh auth token -u <account> 2>/dev/null)"` to `CLAUDE_ENV_FILE`, so every Bash command of the session and its agents runs as this account; the global account is not switched; no login under it — the session gets one line of context instead; absent — `gh` runs as the active account | hooks/gh-token-env.sh, overnight-fix-loop, ship-ticket, epic-wave |
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
- **Session context.** `hooks/session-start.sh` tells every session of a Silent project where the
  Workflow folder is and that the repository gets no traces, whatever `session.inject_rules` says.

**`attribution: off`** (any mode): commits and PRs of the project carry no Claude attribution lines
(`Co-Authored-By: Claude …`, `Generated with [Claude Code]`). `hooks/session-start.sh` says so in every
session of the project, and the guard refuses the commands above when their text carries such a line.
`on` (the default) — as before.

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
