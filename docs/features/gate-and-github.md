# Gate and GitHub

Five Features. **Gate** is the check of whether the changes in a worktree are ready. **Gate full** is the complete
form of that check and the situations that call for it. **Failure records** are what a red Gate run leaves about each
failed test or step, and the command that reads them. **PR and CI badges** are the chips on a Ticket and a Session that show
what the Gate and GitHub say. **PR inbox notifications** are GitHub's notifications used to read a moved PR of the PR inbox at
once. Terms are explained in [Concepts](concepts.md).

## Gate

### Behaviour

The Gate is one program that belongs to the Harness: `node gate.mjs [<profile>]` in a worktree. It runs the checks of the
Project on what changed in that worktree and gives one verdict. worfy never starts it and never writes its verdict:
agents and hooks run it, and worfy reads the result.

**Who runs it.** The hooks `TaskCompleted` and `TeammateIdle` of the Harness plugin run profile `fast`, with a limit of
900 seconds. Codex has neither event: in a Codex Session the hooks `Stop` and `SubagentStop` run profile `fast` in a
registered Project, with the same limit. The skills and the implementer agent run it by hand with stdin closed. Without a profile the argument is
`fast`. A profile is `fast`, `full` or any other key that an entry of the registry has under `root` or `workspace`. The
scripts behind each profile are set per Project (see Gate full). `--help` and `-h` print the usage and exit with 0.

**The outcomes.** The verdict line and the exit code say the outcome together, because code 0 alone does not mean green:

| Verdict line | Exit code | Outcome | What it means |
|---|---|---|---|
| `[gate] green (<profile>): …` | 0 | `green` | Scripts ran and passed, or the cache answered for them (the line then says `(cache)`). This is the only sign of green. |
| `[gate] red (<profile>): …` | 2 | `red` | A script failed. Only this code blocks the hooks `TaskCompleted` and `TeammateIdle`. |
| `[gate] not verified — environment unavailable:` | 0 | `unverified` | A script failed for a reason in the environment and not in the code. |
| `[gate] not verified: …` | 3 | `unverified` | The project is not registered, the registry cannot be read, a resolver crashed, or the Gate itself failed (the last case leaves no verdict for worfy to read). |
| `[gate] nothing ran (<profile>): … This is not green.` | 0 | `none` | No changes, no checked package touched, or no scripts of this profile. |

Other endings:

- A run that was stopped (SIGHUP, SIGINT, SIGTERM, or Ctrl+Break on Windows) exits with 129, 130, 143 or 149, and the work
  is not verified. It writes no marker, cache entry or verdict, and it removes the verdict of the run before. A signal in
  the first tens of milliseconds of the process or during the wait for stdin ends the process with the same code, but
  an earlier verdict may stay in place.
- An unknown profile, an option such as `--verbose` among them, prints the usage and exits with 2. It writes nothing.
- A folder outside git exits with 0 and says nothing.
- `node gate.mjs` where node is not on the PATH fails with 127 before the Gate starts. The launcher `gate.sh`, which the
  hooks use, looks further for a node of version 18 or newer. With no node at all it answers `[gate] not verified: node not found`.
  When every node it found is older or did not start, it answers
  `[gate] not verified: no node 18 or newer: <path> is older or did not start`. Both exit with code 3.

**Red or not verified.** A script that exits with a code other than 0 is red unless its output shows a missing
environment: `command not found`, `Cache entry required but missing`, `ENOENT` for a path in `node_modules`, a Docker daemon
or container runtime that is not there, a refused connection to port 5432 or `could not connect to server`. A line that
shows a live test run outranks these signs: `Tests 3 failed`, a line that starts with `FAIL`, `AssertionError`, `✗` or
`Expected … to` keep such a script red. A script that a signal ended counts as a failed script, and its report names the
signal. One red script makes the whole run red, whatever the others say. A failed script does not stop the scripts after it.

**What gets checked.** A run that gets a plan prints a `[gate] scope` line with its choice and the reason. A narrowed run with no
changes answers "nothing ran" without that line. Normally the run is narrowed to the files that differ from the merge-base with `origin/HEAD` or `origin/main`, including uncommitted and untracked files.
A renamed file counts under both paths. The run takes every package instead in any of these cases:

- `GATE_SCOPE=all` is set.
- The repository has no such base, or no merge-base with it.
- HEAD is detached, or the counts of commits ahead and behind cannot be read.
- The branch is more than 50 commits ahead (`GATE_MAX_AHEAD`) or more than 300 behind (`GATE_MAX_BEHIND`).

A narrowed run takes the packages that hold a changed file and the packages that depend on them, transitively. The root
scripts run only when `root_if` of the registry entry matches a changed path, or when the entry has no `root_if`. So with a
`root_if` that leaves documents out, a change of documents alone ends as "nothing ran".

**The cache.** A package whose scripts all passed is remembered by a fingerprint: HEAD, the paths of the package and its
workspace dependencies, the uncommitted diff of those paths and the content of its untracked files. The same fingerprint
with the same scripts, on the same worktree and profile, is answered from the cache without running anything. Only green is
cached, so a red script always runs again.

**The output.**

- As each script ends, the Gate prints `[gate] time (<profile>): <label> <s> s`. Right above the verdict line it prints one
  line with the total time, each script and the cached ones. A cached script shows the time of the green run that wrote the
  entry.
- The report of a failed script holds its last 40 lines under `--- FAILED: <label>`. For output in the shape of Playwright's
  list reporter it adds the failure blocks above those lines: at most 60 lines a block, 200 in all, 500 characters a line. It
  ends with the path of the full log.
- The full output of every script, green ones too, goes to a log file. The newest 10 runs of a worktree are kept whole. An
  older run, and every run of another worktree untouched for more than 8 days, loses its script logs but keeps its
  `timings.json` for 31 days.
- A file that the diff takes from at most 1000 lines to more than 1000 prints
  `[gate] warning: file over 1000 lines: <path> (<before> → <now>)`. A file that was already longer, a file that only moved,
  a binary file, a lock file and a generated file get no warning. The warning changes nothing else, and a cache hit prints it
  again.

**Holding a turn.** Under Claude Code the hook `Stop` runs no checks; on Codex it runs profile `fast` first, as above, and
`SubagentStop` holds a Subagent the same way, with a count of its own. While the last run in the worktree is red, it holds
the end of the turn and tells the model to run the Gate and fix what it points to; a `worfy-reviewer` or `worfy-scout` on
Codex is told to report the red Gate instead, since it edits no file. It does this at most 2 times per session and worktree, and
a green run resets the count. After that it lets the turn end and says once that the Gate is still red. An unverified state
and a code 3 never hold a turn: the model hears about each once per session, the first per worktree, the second per
repository. On Codex the model hears such a note as a block whose reason is the note, since a Codex `Stop` hook cannot add
context: it costs the model one more turn, as the added context does under Claude Code. A failure inside the hook holds
nothing either.

#### Windows

The same file runs on Windows. The differences are in starting a package manager:

- The Gate finds the program on the Path the way cmd.exe does, without the current folder, and starts it through the cmd.exe of
  the system, in a hidden console of its own switched to UTF-8.
- A word that cmd.exe cannot be given safely (a quote, `%`, `!`, `^` or a trailing backslash) or a worktree in a network folder
  is not given to cmd.exe. An `.exe` or `.com` then starts directly, and a `.cmd` or `.bat` does not start, which gives "not
  verified — environment unavailable". A command line longer than 8000 characters does not start at all, with the same result.
- `is not recognized as an internal or external command` is one more sign of a missing environment.
- A signal to the Gate ends cmd.exe and everything under it with `taskkill /t /f`.
- A verdict file that another process holds open is retried for half a second. A file held longer can keep the outcome of the
  run before.

### How it works

**"Nothing ran" is not green.** A green badge must mean that something was really checked. So no check gives "nothing ran" and
never clears a red state. A worktree stops being red only through a run that checked something, a cache hit from a green
run included. Editing a document cannot wash red away.

**A project is found by its common git directory.** Every worktree of a repository has one registry key, wherever the worktree
lies. The entry with the longest `match` prefix wins. Each worktree has a tag, the first 8 hex digits of the SHA-1 of its root as
`git rev-parse --show-toplevel` prints it, so red in one worktree does not hold a turn in another.

**Two kinds of record.** Markers hold a state across runs: `red-<key>-<tag>` and `unverified-<key>-<tag>`, read by the hook `Stop`
and by worfy, and `nokey-<kind>-<tag>-<session>`, read by the hook. The verdict file `verdict-<tag>.json` is the outcome of the last
run, a machine contract for worfy whose fields do not depend on the wording of the verdict lines: outcome, profile, worktree, key,
head, exit code, time, reason (one line in English for `unverified` and `none`), timings. A run that gets as far as knowing its worktree replaces the file whole or removes it. So a file from an older run
stays only when another process holds it open on Windows, or when a run ended before that point.

**The launcher.** A hook command that named `node` would fail with 127 where node is not on the PATH, and the verdict of an earlier
run would stay. So the hooks call `gate.sh`, which looks on the PATH, then in `/opt/homebrew/bin` and `/usr/local/bin`, then in
the versions of nvm, newest first: the places a hook with a bare PATH misses.

**A stopped run writes nothing.** The Gate looks for a signal to itself after each child process and before it writes down an
outcome. An empty answer from a killed `git diff` is not a clean tree, and a script killed along with the Gate does not make the
run red. A git or resolver that a signal ended alone, or whose output passed the limit, ends the run as not verified.

### Implementation

| What | Where |
|---|---|
| The Gate: scope, cache, scripts, outcomes, markers, verdict file | `harness/hooks/gate.mjs` |
| The launcher that finds node | `harness/hooks/gate.sh` |
| Registry reader: which project, which packages and scripts | `harness/hooks/gate-resolve.mjs` |
| Folders of the state and the registry, the worktree tag | `harness/hooks/gate-paths.mjs` |
| Logs, timings, Playwright failure blocks | `harness/hooks/gate-log.mjs` |
| The hook that holds a turn | `harness/hooks/stop.mjs` |
| Which hook runs what | `harness/hooks/hooks.json` |

**Files.** The registry is `<Harness home>/gate/config.json`, where the Harness home is `HARNESS_HOME` or
`~/.claude/worfy-harness`. With no registry there and one in the old place, `~/.claude/gate/config.json`, the old one is read.
The state folder is `<Harness home>/gate/state`, with the markers and verdict files and the folders `cache`, `stop-blocks` and
`logs/<tag>/<run>`. `CLAUDE_GATE_CONFIG`, `CLAUDE_GATE_STATE` and `CLAUDE_GATE_RESOLVE` point the Gate elsewhere in tests.

**Data flow.** The Gate finds the worktree and the common git directory and asks the resolver for the registry entry. It works out
the scope and the changed paths and asks the resolver for a plan, one JSON line per package. For each package it looks in the cache
or runs the scripts one by one. Then it writes down the outcome in one go: cache entries, logs, markers, verdict file and the
verdict line.

**Main tests.** These shell tests run through `test/harness-scripts-suite.ts`.

- `harness/hooks/tests/gate-verdict.test.sh`, `harness/hooks/tests/gate-verdict-signals.test.sh`,
  `harness/hooks/tests/gate-verdict-inside.test.sh`: the verdict file, also when a signal comes.
- `harness/hooks/tests/gate-notverified.test.sh`, `harness/hooks/tests/gate-unregistered.test.sh`: code 3 and the hook `Stop`.
- `harness/hooks/tests/gate-scope.test.sh`, `harness/hooks/tests/gate-file-size.test.sh`: the scope and the size warning.
- `harness/hooks/tests/gate-log.test.sh`, `harness/hooks/tests/gate-timings.test.sh`, `harness/hooks/tests/gate-shim.test.sh`,
  `harness/hooks/tests/gate-args.test.sh`: logs, timings, the launcher and the profile argument.

## Gate full

### Behaviour

Gate full is the same program with the profile `full`: `node gate.mjs full`. It has the same outcomes, scope rules and cache
as any other profile, so a run on a branch still narrows by the diff unless `GATE_SCOPE=all` is set.

**What it runs is set per Project.** A registry entry lists scripts of `package.json` under `root` and `workspace`, by profile.
Only scripts that exist in the package run. "Add project" shows the `root` lists as the fields "Gate fast" and "Gate full".

| Project | `fast` | `full` |
|---|---|---|
| worfy's own repository | `lint`, `typecheck`, `test` | those, plus `test:e2e` and `test:package` (the packaged app) |
| The Demo project | `test:fast` | `test` |

**When it is required.** The Profile says it, not the Gate:

| Profile | Gate full before the merge |
|---|---|
| `workflow.finish` `local-green` | Yes. On the Ticket branch, by the Orchestrator, before the local merge. A red run stops the finish. |
| `workflow.finish` `pr-green-ci`, `workflow.merge_gate` null or absent | No. With `workflow.ci` `pr` the merge condition is the final CI check on the PR's head and the `review` mark on the same head. |
| `workflow.merge_gate` `each` | Yes. Each PR is rebased and gets its own run with `GATE_SCOPE=all`. |
| `workflow.merge_gate` `wave` | Yes. One run for the set of a Wave's ready PRs, squash-merged in a temporary worktree (`wave-gate`). A red run is repeated once on the same tree; red again, it bisects the set by prefixes, at most 2 + ceil(log2 N) finished runs. |

worfy's own repository is on the second row, with `ci-ok` as the final check. There Gate full stays a tool for the implementer
and for analysing a failure.

**The e2e lock.** With `workflow.e2e_lock` in the Profile, `wave-gate`, the skills and the Project's rules take that folder as a
lock for each local e2e run and Gate full. The Gate itself does not take it, so a bare `node gate.mjs full` holds nothing, and CI
jobs do not use it. A lock older than 30 minutes counts as abandoned, and its holder touches it every 5 minutes. A file inside it may name the
PRs of the run. While the lock is taken and a Ticket stands on the Stage "Gate & merge", its Stage says `gate running`, `waiting
for gate` or `gate busy` ([Workflow](workflow.md)).

**A locked screen on a Mac.** A locked screen shows no Electron window, so every e2e test fails on its first window.
`wave-gate check` asks the system before each run and, while the screen is locked, prints `screen locked: gate full waits` and
polls every 30 seconds, without holding the e2e lock. A red run in which `test:e2e` or `test:package` failed while the screen was
locked counts as not verified and runs again after the unlock, at most 3 runs. Then the check ends unverified. `wave-gate check`
and `wave-gate merge` also keep the display awake while they run.

#### The cross-machine gate queue

For a Project on two Machines, one of which cannot run the other's Gate full. The Profile of each Machine has
`cross_machine_gate` with its role, `serve` or `request`, a GitHub label and the name of a section of the PR description. Without
that field the Project has no queue. worfy's own repository does not use it.

**Which PR waits.** A PR waits for the Machine with `serve` when it is open, carries the label, is not from a fork and has no red
report newer than its last commit. A report is a comment by the Project's GitHub account whose first line starts with
`<section> report: red`. A green report ends no wait, because a PR still open after one had its merge fail. The wait counts from
the later of the PR's creation and its last commit.

**What the user sees.**

- On the Machine with `serve`, "Process gate queue" is in the Project menu and in the Command palette. The palette row shows `1 PR
  waiting, oldest 2 h`, `queue empty` or `gh failed: <reason>`.
- The action sends the Project's template to its Orchestrator. With the Harness plugin the template is `/worfy:gate-queue` by
  default. The action is refused with the reason when Autopilot runs in the Project, when the role of this Machine is not `serve`,
  or when the template is empty.
- A PR that has waited over an hour gets one notification per PR and last commit, on either Machine. While a worfy window has
  focus, it waits for the next read of the queue. A click raises the window and opens nothing.
- Autopilot on the Machine with `serve` sends the same text once before it stops for want of a Wave.

The queue is read at most once per 5 minutes per Project, and on a failure of gh the interval doubles up to 30 minutes. At most
100 labelled PRs are read. The skill does the work in a Session: worfy never comments, merges or edits a label.

#### On a Linked machine

`gateQueue.get` is open to a Linked machine with read-only access, and `actions.gateQueue` only with full access. The queue is
read and the Session runs on the Machine of the Project.

#### Windows

Each Machine has its own registry and Profile. For worfy's own repository, the `windows` jobs of `ci-ok` give the Windows verdict of
a PR. After the merge of a PR for which `scripts/windows-verdict-scope.mjs` prints `pc`, the owner's Windows PC runs Gate full on `main`
([ADR-0086](../adr/0086-pc-gate-full-once-per-wave.md)).

### How it works

CI on GitHub runs the same kinds of checks on Linux, macOS and Windows, so in worfy's own repository Gate full does not hold up a merge:
[ADR-0083](../adr/0083-ci-ok-on-every-pr-is-the-merge-condition.md). The queue serves a Project in which one Machine must check
the PRs of the other: [ADR-0069](../adr/0069-cross-machine-gate-label-and-roles.md).

### Implementation

| What | Where |
|---|---|
| The run itself | `harness/hooks/gate.mjs` |
| One Gate full for a set of PRs, the screen check | `harness/bin/wave-gate` |
| Gate before merge, the e2e lock | `harness/skills/epic-wave/SKILL.md` |
| Local finish | `harness/skills/ship-ticket/step-11-close.md` |
| The pass over the queue | `harness/skills/gate-queue/SKILL.md` |
| The queue as worfy reads it: role, rule of waiting, intervals | `src/main/github/gate-queue.ts` |
| Its IPC and the app's one reader | `src/shared/ipc/gate-queue.ts`, `src/main/ipc/gate-queue.ts` |
| "Process gate queue": refusals and the text | `src/main/actions/launch.ts` |
| Autopilot's turn for the queue | `src/main/autopilot/run.ts` |
| Notifications of a waiting PR | `src/main/notify.ts` |
| The menu, the palette and the read on opening | `src/renderer/shell/sidebar/ProjectsSection.tsx`, `src/renderer/palette/commands.ts`, `src/renderer/projects/useGateQueue.ts` |
| The fields "Gate fast" and "Gate full" | `src/renderer/projects/ConnectProject.tsx` |
| The e2e lock as the Stage reads it | `src/main/workflow/stages.ts`, `src/shared/workflow/pipeline.ts` |
| The registry entry of the Demo project | `src/main/getting-started/demo-template.ts` |

**Main tests.**

- `harness/bin/tests/wave-gate.test.sh`, `harness/bin/tests/wave-gate-screen.test.sh`, `harness/bin/tests/wave-gate-lock.test.sh`:
  the run over a set, the locked screen and the lock.
- `test/contract/gate-queue.test.ts`: which PR waits, and the read of the queue.

## Failure records

### Behaviour

A red Gate run leaves a record of what failed, so that a red run can be read later: a flaky test told apart from a test
that stays red, over many runs and more than one computer. The records change nothing in the Gate: the verdict file, the
markers, the cache, the `[gate] …` lines and the exit codes are the same with them or without them.

**What a red run leaves.** One entry per failed test: the runner, the file, the line of the test, its name (the describe
blocks and the test joined by ` > `), the Gate step, how long it took, the first line of its error (at most 200
characters), the attempt and the command that runs this test alone. The vitest reporter also writes an entry without a test name for a
test file that failed outside its tests, such as one that did not load, and one entry with neither a file nor a command
for the unhandled errors of the vitest run. Both count among the `<n> tests` of the line below, while `list`,
`rerun` and `report` treat them as steps without tests. The run adds the SHA, the profile, the time, the
computer and `dirty`: true when `git status --porcelain` printed anything, or failed, before the first script. The red report ends with
`--- failure records: <file> (<n> tests, <m> steps without tests)`, or with `--- failure records: not saved, <why>`
when the file could not be written. A green run, a run where nothing ran, a stopped run and a script whose environment
is missing leave no record.

**Steps without tests.** The Gate does not know the tests inside a script: the Project's test reporters tell it. A failed
script that left no usable entry, such as lint, typecheck, a build or any script of a Project without reporters, gets
one entry of the step. Its error is the first line of the script's output that holds `error`, `Error` or `FAIL`, else
its last line that holds anything. worfy's own repository has a reporter for vitest and one for Playwright. In
Playwright a test that passed on a retry, and a skipped test, give no entry.

**CI writes no records.** The reporters write only into the file the Gate gives them, and CI jobs do not run the Gate.
A `pnpm test` by hand writes none either.

**The command.** `gate-failures` is a command of the Harness, `<Harness>/bin/gate-failures <subcommand>`. `--help` lists
the subcommands, and each subcommand takes `--help` too. A missing or unknown subcommand prints the usage and exits
with 2, and so does a wrong argument of any subcommand.

| Subcommand | What it does | Other exit codes |
|---|---|---|
| `list [--json] [--days N]` | The runs that left records, own and imported, newest first: run id, time, computer, SHA, profile, number of entries, and the marks `dirty`, `imported` and the number of reruns. | 0 |
| `rerun [--run <id> \| --last] [--file <path>] [--limit N] [--dry-run]` | Runs each failed test of a red run again, alone, on the same SHA, and writes a rerun file. | 0: every test green alone. 2: at least one red alone. 3: refused, nothing to rerun, or a test without a rerun command and none red. 128 + the signal number: stopped |
| `report [--days N] [--computer <name>] [--json]` | The classes below over the runs of the last 14 days by default, and the candidates. | 0 |
| `export [--run <id> ...] [--since <days>] [--out <file>]` | The own runs of this computer, each with its rerun files, as text for another computer. | 0, also with nothing to export. 2: an unknown `--run`, personal data found, a run too long for a part |
| `import <file> \| - \| --gh <owner/repo> (--issue N \| --pr N)` | The records another computer exported, kept apart as imported. | 0. 2: a file or an export refused. 1: the source could not be read |
| `machine [--json] [--name <name>]` | The computer the records name, or a new name for it. | 0. 2: the name refused |

`list` and `report` only read. A file that is broken or of another version is skipped. Without `--json` its reason goes
to stderr. With `--json` the file and its reason are in the `skipped` field of the JSON object, and nothing goes to
stderr.

**`rerun`.** By default (`--last`) it takes the newest red run of this worktree. It refuses with code 3 and the reason
on one line when the run was imported or names another computer, since the commands of its entries are never run here,
when HEAD is not the SHA of the run, or when `git status --porcelain` is not empty. Before the first test it prints the
list and an estimate of the time from the recorded durations, and `--dry-run` stops there. `--file` keeps the tests of
one file, `--limit N` the first N. Without `--file`, a failed step without tests is named with
`step without tests, not rerun: <step>` and not run. A test whose entry has no rerun command is not run either: the
rerun file keeps it as `cannot rerun`. Playwright tests run last. When the Profile sets `workflow.e2e_lock`, they run
under that lock after the screen check, as `wave-gate` does, and the other tests take no lock. A signal ends the
running test, releases the lock and writes the rerun file with the tests that finished.

**The classes.** `report` gives each failure of a test in a run one class, from the reruns of that run on its SHA and its
computer:

| Class | Its group in the report | When |
|---|---|---|
| Flaky | `flaky` | Red in the run, green alone in a rerun. |
| Stable red | `stable red` | Red in the run, and red alone in the reruns that ran it, never green. |
| Without rerun | `without rerun` | No rerun ran it on that SHA, or its entry has no rerun command. |

A run marked `dirty` counts in no class: one line gives the number of such runs. A run in which more than half of the
failed tests were green alone is shown as `under load: <run> … <n> failed, <k> green alone`. Steps without tests are a
list of their own, by step.

**Candidates**, from the failures of the last 14 days, or fewer when `--days` is smaller:

- quarantine: flaky in at least 2 different runs, that is on another SHA or on another computer;
- Windows exception: stable red on `win32`, and on those SHAs the test did not fail on another platform other than as
  flaky. A test that is both is a Windows exception candidate only.

`node scripts/quarantine-suggest.mjs [<report.json>]` turns the candidates of `report --json` into entries of
`test/quarantine/`. Without a file it runs `report --json` of this repository's copy of the Harness. It prints the file
name and the JSON of each entry and writes nothing. A quarantine entry gets the owner `<ticket>` for a person to fill in
and lasts 14 days. A Windows exception gets the owner `worfy-windows 117` and lasts 45 days. A test that already has an
entry, or is not a test of this repository's runners, is skipped with a line on stderr. A warning says when the entries
would take the quarantine past 15 entries or the Windows exceptions past 30. Exit codes: 0, also with no candidate; 1
when there is no report to read or it is not a report; 2 for a wrong argument.

**Moving records between computers.** `export` prints parts of at most 60000 characters, so that each fits one GitHub
comment, and keeps a run with its reruns in one part. A run longer than a part has the errors of its entries cut to 80
characters. `--out <file>` writes part k to `<file>.k`. `import` reads every block that starts with
`gate-failures export v1 part <k>/<n>`, wherever it is in the text, and puts the parts of one export together. An
export with a part missing is refused whole. With `--gh` it reads the body and the comments of the issue or PR through
`gh api`, and only those by the Profile's `github.account` count. A record of this computer is not imported, one that is
already there is skipped, and the rerun commands of an imported record are never run.

**The computer.** A record names its computer by an id of 8 random hex digits, made once, and a name: `mac`, `windows`
or `linux` by the platform, until `gate-failures machine --name <name>` gives another one. A name that is the host name,
the user name or other personal data is refused. This is not the Machine of worfy Link, which keeps a file of its own.

**Retention.** Records live 60 days, counted by the time inside the file. Each time a red run writes its file, the Gate
removes the older records, own and imported. A broken file, or one of another version, stays.

#### Windows

- The Gate starts a script through cmd.exe, or directly as an `.exe` or `.com` when cmd.exe cannot be given its command
  line (see Windows under Gate). `GATE_FAILURES_FILE` is in the environment of the script on both paths.
- File paths in the records are from the root of the repository, with `/`. Scrubbing knows a Windows home folder written
  with `\`, a doubled `\` or `/`, as Git Bash (`/c/…`) and WSL (`/mnt/c/…`) write it, in any letter case, and the 8.3
  form such as `RUNNER~1`.
- `gate-failures` is a Node file without an extension: `node <Harness>/bin/gate-failures <subcommand>` starts it in any
  shell, and a shell that reads its `#!/usr/bin/env node` line, such as Git Bash, starts it by its path.
- `rerun` takes the e2e lock whenever the Profile sets `workflow.e2e_lock`, on any computer. The screen check asks the
  macOS `ioreg`, so on Windows it never waits.

### How it works

**The contract with a Project.** Each script of a Gate run gets the variable `GATE_FAILURES_FILE`: the path of a file of
its own in the Gate's state folder, which no other script sees. The Project's reporters append one JSON line per failed
test, with the fields of an entry except the step. worfy's reporters write nothing without the variable. The Gate reads and
removes the file as soon as the script ends, keeps only those fields, adds the step, and writes the run file only for a
red run. A line that is not a valid entry is skipped, and its step then also gets an entry of its own that counts the
skipped lines.

**A test id without a line.** Runs are compared by `<runner> <file> > <name>`. The line moves from commit to commit, so
it is not part of the id. A renamed test, or a moved file, starts a new history.

**Scrubbing.** An export may be published in a public repository, so every text of an entry is scrubbed before it is
written, whatever the reporter did. The root of the worktree becomes `<repo>` and the home folder `~`, and the rest of
such a path is written with `/`. The user name in any home folder path becomes `<user>`. The host name becomes `<host>`
as a whole word, and the user name `<user>` when it has at least 3 characters and is not a stand-in such as `test` or
`runner`. The privacy rules of the Harness then mask what they find by shape (UUIDs, email addresses, tokens, Tailscale
addresses, host names of known shapes) and the words of the personal list `<Harness home>/user/privacy.json`.
`export` checks every field and the whole text once more, against those rules and the host name, the user name, the
home folder and the worktree root of this computer. On a finding it names the record, the field and the rule, never the
value, prints nothing else and exits with 2. `import` checks each file against the same rules and the host name, the user name and the home folder of this
computer, and refuses one that fails.

**What scrubbing does not catch.** A word that a test prints in its own message, not inside a path: the name of a
branch, of a project or of a person, when it is not the user name, not the host name, not on the personal list and not
of a shape the rules know. Both layers miss it. Such a word belongs on the personal list.

**A computer without a host name.** The id is random and the default name is the platform, so a record says which
computer it came from without naming the host.

**The rerun is a command, not part of the Gate.** The Gate does not retry within a run, and its verdict stays as it is.
`rerun` runs the failed tests afterwards, alone, without `GATE_FAILURES_FILE`, on the same SHA and in a clean worktree.
How a red Gate full on `main` on the Windows PC is checked with `rerun`, `export`, `import` and `report`:
[ADR-0096](../adr/0096-failure-records-and-solo-rerun.md), which changes points 2–4 of
[ADR-0086](../adr/0086-pc-gate-full-once-per-wave.md).

### Implementation

| What | Where |
|---|---|
| The format of a record, scrubbing, the computer, the files, retention | `harness/hooks/gate-failures.mjs`, types in `harness/hooks/gate-failures.d.mts` |
| `GATE_FAILURES_FILE`, the run file of a red run, the line of the red report | `harness/hooks/gate.mjs` |
| The command: one module per subcommand | `harness/bin/gate-failures`, `harness/lib/gate-failures/` |
| The text of an export and its check for personal data | `harness/lib/gate-failures/transfer-common.mjs` |
| The privacy rules and the personal list | `harness/lib/privacy.cjs` |
| The e2e lock and the screen check of a rerun | `harness/lib/e2e-lock.cjs` |
| worfy's reporters | `test/failure-records.ts`, `test/failures-reporter.ts` (in `vitest.config.ts`), `test/e2e/failures-reporter.ts` (in `playwright.config.ts`) |
| Quarantine entries from the candidates | `scripts/quarantine-suggest.mjs`, with the rules of `test/quarantine.ts` |
| The order of the commands after a red Gate full on `main` | `harness/skills/epic-wave/SKILL.md` |

**Files.** All of them are outside every repository. In the Gate's state folder: the run file
`failures/<tag>--<run>.json`, where `<tag>/<run>` is the name of the run's log folder and the run id, the rerun file
`failures/<tag>--<run>.rerun-<time>.json`, and the files of another computer under `failures/imported/<computer id>/`.
The computer is `<Harness home>/gate/machine.json`.

**Main tests.**

- `harness/hooks/tests/gate-failures.test.sh`: `GATE_FAILURES_FILE` per script, the run file, the report line, the runs
  that write nothing, retention.
- `test/unit/gate-failures-format.test.ts`: the format, the test id, scrubbing.
- `test/unit/failures-reporter.test.ts`, `test/contract/failures-reporter-rerun.test.ts`: the reporters, and that the
  rerun command of an entry runs exactly its test.
- `test/contract/gate-failures-cli.test.ts`, `test/contract/gate-failures-rerun.test.ts`,
  `test/contract/gate-failures-report.test.ts`, `test/contract/gate-failures-transfer.test.ts`: the subcommands.
- `test/unit/quarantine-suggest.test.ts`: entries from candidates.

## PR and CI badges

### Behaviour

Chips on the workflow Nodes. A Ticket shows them as the details of its Stage. A Session shows only the Gate of its worktree. An
Epic frame shows none. Chips wrap onto a second line and are not cut. The colours are the status colours, always with a label.

| Chip | When | Meaning |
|---|---|---|
| `gate green` | Ticket, Session | The Gate's outcome is green. |
| `gate red` | Ticket, Session | The Gate's outcome is red. |
| `gate unverified` | Ticket, Session | The Gate could not verify. |
| `gate: no data` | Ticket, Session | No marker, verdict or Gate line is known, or the last run said "nothing ran". This is never green. |
| `PR #31`, `PR #31 merged`, `PR #31 closed` | Ticket | The PR of its branch. The tooltip has the address. |
| `CI passing`, `CI failing`, `CI running` | Ticket | The checks of the PR. No chip when the PR has none. |
| `VERIFIED`, `REJECTED` | Ticket | The reviewer's verdict on the head commit. No chip when there is none. |
| `gh unavailable` | Ticket | gh did not answer. The tooltip has the reason. |
| `in %TEMP%` | Ticket, Session | The worktree lies in the Windows temporary folder. The tooltip has the warning and the path. |

The tooltip of a Gate chip adds the worktree's path, and the tooltip of a Ticket's row sums up all its chips. A Ticket with a PR also has the
action **Open PR**, which opens the address in the browser. An address that is not a page on `https://github.com/` leaves the button
inactive, and its tooltip says why.

**The Gate chip.** What it shows, in this order of priority:

1. The red marker of the worktree.
2. The unverified marker.
3. The verdict file. It is not taken when it is about another worktree or another commit than the worktree's HEAD now, so a new
   commit sets an older verdict aside.
4. The last Gate line in the transcripts of the Sessions started in that worktree. It counts only from a Bash call that ran the Gate
   about that worktree, or from hook output. A line quoted in a prompt or printed by another command does not count.

A marker goes first because a run that checked nothing does not clear it: after a red run, "nothing ran" leaves the worktree red.

**Which worktree.**

- A Ticket takes the worktree whose branch names it: its `Branch:` line or `<epic>/<NN>`. Otherwise it takes one whose folder carries
  its number while its branch names no Ticket. That is not taken when another Epic of the Project has a Ticket with the same number,
  because a folder names no Epic. With no worktree, a Ticket has no Gate chip.
- A Session takes the deepest worktree that holds its folder. The main checkout counts as a worktree.

**Which PR.** An open PR of the Ticket's branch first, then a merged one, then a closed one, the higher number first within each.

**The CI chip.** The checks of the PR's head are reduced to one word:

- `failing` when any check failed: `FAILURE`, `TIMED_OUT`, `CANCELLED`, `ACTION_REQUIRED`, `STARTUP_FAILURE` or `ERROR`;
- otherwise `running` when any check has not finished;
- otherwise `passing`.

It counts every check on the head. The merge condition of a Project may read one check (`ci-ok` in worfy's own repository), so the
chip and that condition can differ. The commit statuses `review`, `check/<name>` and `deploy` are marks of agents and not CI, so a
failed review does not turn CI red.

**The verdict chip.** It comes from the `review` mark on the PR's head commit: `success` is VERIFIED, `failure` or `error` is REJECTED.
`pending`, no mark, or a mark on an older commit gives no chip. The text of the PR's comments does not count, even when it disagrees.

**`gh unavailable`.** gh is not installed, is not signed in or has no network. It shows on a Ticket that has a worktree, is in work or
was claimed in a branch, and a Ticket with none of these shows nothing. While it lasts, no Ticket has PR chips. The first success brings
them back.

**How fresh.** The renderer asks when the first badge of a Project appears, when the set of Ticket branches in work changes, when the
window gets focus, and every 10 seconds while the window has focus. It stops when the last badge of the Project is gone. Each answer
reads the Gate's files and `git worktree list` again, while main lists the PRs with gh at most once per 60 seconds per folder asked,
whatever the rate of asking. After a failure the interval doubles, up to 32 minutes, and the first success brings it back to 60 seconds.

**Old and many PRs.** One read lists the 100 latest PRs in any state. A branch of a Ticket that is in work or was claimed in a branch, and a
worktree's branch that names a Ticket, are looked up on their own when not in that list: at most 10 such lookups per read, and at most
once per 5 minutes per branch. Any other Ticket has PR chips only while its PR is among those 100. A lookup that fails does not make
gh unavailable: the PRs of the list keep their chips, the branch keeps the PR of its last answer and waits 10 minutes, twice as long after each
further failure in a row, up to 32 minutes, and the Stage names that branch. No other lookup runs in that read. When the failure is GitHub's rate limit, the 60-second
interval also doubles from that moment, and neither the list nor a lookup runs until it ends.

**A Project over several repositories, and Silent mode.** Each repository is asked on its own
([ADR-0045](../adr/0045-one-ticket-one-repository.md)), and a Ticket gets its chips from the
repository its `Repo:` line names. A Ticket that names none of them has no Gate, PR or CI chip. The Gate chip of a Session is read from
the Project root in every case. In Silent mode a Ticket's `Branch:` line ties it to its branch.

**The GitHub account.** When the Profile names `github.account`, every gh call of a read runs as that account, and the global gh account
is never switched. Without an account, or with a value that is not a GitHub login, gh runs with the account of the login shell. An account
that gh has no sign-in for gives `gh unavailable`, with a tooltip that names it and `gh auth login`, and never falls back to another
account. An edited Profile counts from the next read that runs gh.

**Nothing is written.** The badges read. worfy runs no gh command for them but `gh pr list` and `gh auth token -u <account>`, and changes
nothing on GitHub, in the Project or in the Gate's state.

#### On a Linked machine

`checks.get` and `checks.repos` are open to a Linked machine with read-only access, and its Canvas shows the same chips. Everything runs on
the Machine of the Project: its Gate files, its git, its gh and its account. A root outside the Projects of that Machine is refused.

#### Windows

`in %TEMP%` appears only on Windows, whether or not Storage Sense is on, because Storage Sense may delete files from that folder when
the disk runs low.

### How it works

- **A view over what others write.** The chips come from the Gate's files, transcripts, git and gh. worfy stores nothing of its own about
  them ([ADR-0002](../adr/0002-worfy-is-a-view-over-the-workflow.md), [ADR-0005](../adr/0005-worfy-own-state-inventory.md)).
- **The rate of asking and the rate of gh are separate.** The renderer may ask often because the tracker decides when gh runs. The
  renderer keeps one copy per Project and folder asked, shared by all badges. main has one tracker, shared with Autopilot's reads of the narrow
  fix rounds and with the Stage, so `gh pr list` of the whole list runs at most once per interval for all of them.
- **A verdict is bound to a commit.** A mark is a commit status on a SHA, and the rollup that gh gives is of the head commit only, so a push
  makes the old verdict disappear by itself ([ADR-0067](../adr/0067-pipeline-in-profile-and-sha-bound-agent-marks.md)). A comment's first line
  `NARROW:` is still read, for Autopilot's journal and not for a chip ([ADR-0046](../adr/0046-autopilot-narrow-round-without-owner.md)).
- **Lookups match exactly.** `--head <branch>` matches the name exactly, where `--search head:<branch>` would find `demo/18` for `demo/1`.
- **What main accepts.** `checks.get` takes a Project root or one of its repositories, and branches that are `<epic>/<NN>` or named by the
  workflow model for that repository's Tickets. Any other refuses the whole call, so the renderer sends only branches that pass. At most 500
  branches of at most 200 characters each go in one call.
- **The token.** `GH_TOKEN` comes from `gh auth token -u <account>`, once per read. It lives only in the environment of that read's gh
  processes and is not kept, logged or put into an answer ([ADR-0020](../adr/0020-profile-shared-and-personal-parts.md)).

#### Windows

Paths are compared with either separator and without regard to letter case, and the worktree tag is taken from git's spelling
(`C:/Users/someone/worfy`). To place a Gate call in a transcript, a quoted `cd` to `C:\…`, a `cd` to `C:/…`, a UNC path in quotes or Git Bash's `/c/…` is understood.

### Implementation

| What | Where |
|---|---|
| The IPC contract, and which worktree or PR a Ticket gets | `src/shared/ipc/checks.ts` |
| Handlers, what `checks.get` accepts, the app's tracker | `src/main/ipc/checks.ts` |
| Reading the Gate: registry key, markers, verdict file, transcripts, worktrees | `src/main/gate/state.ts` |
| Where the Gate's folder is | `src/main/harness/locate.ts` |
| Reading gh: runner, account, tracker, CI and verdict | `src/main/github/prs.ts` |
| The Project's GitHub account from its Profile | `src/main/workflow/profile.ts` |
| The chips | `src/renderer/canvas/badges/ChecksBadges.tsx`, `src/renderer/canvas/badges/checks-badges.css` |
| The renderer's copy, polling, branches in work | `src/renderer/canvas/badges/use-checks.ts` |
| Open PR | `src/renderer/canvas/actions/OpenPr.tsx` |
| The Windows temporary folder | `src/main/projects/temp-folder.ts`, `src/shared/temp-folder.ts` |

Choosing an account when a Project is connected is in `src/main/github/accounts.ts` ([Projects](projects.md)). Deployments for the Stage
"Deploy" are in `src/main/github/deployments.ts` ([Workflow](workflow.md)).

**Data flow.** `useChecks` calls `checks.get` with the folder, the Project and the Ticket branches in work. The handler checks them and calls
`readChecks`: `git worktree list`, then `GateReader.read` for each worktree and `PrTracker.read` for the branches, plus the Ticket branches of
the worktrees. The answer is parsed against its schema, so the extra fields of a tracked PR that the Stage needs do not reach the renderer.
`ChecksBadges` picks the Ticket's worktree and PR from the snapshot and draws the chips. The slot system picks up this file by itself, through
`src/renderer/canvas/badges/index.ts`.

**Main tests.**

- `test/e2e/checks-badges.spec.ts`: the whole Feature in the app over a gh stub, with nothing written, and gh missing.
- `test/unit/checks-badges.test.tsx`: what each subject shows, polling, several repositories, the same folder asked by two Projects.
- `test/unit/gate-state.test.ts`, `test/unit/gate-key-spelling.test.ts`, `test/contract/gate-key-agreement.test.ts`: reading the Gate,
  and the registry key agreeing with the Gate's resolver.
- `test/contract/github-prs.test.ts`: CI, the verdict, the tracker's intervals and lookups, the account and the token, what `checks.get` refuses.
- `test/contract/link-access.test.ts`: `checks.get` from a Linked machine.
- `test/unit/read-checks.test.ts`: the `in %TEMP%` mark.

## PR inbox notifications

### Behaviour

The PR inbox reads the open PRs of the user in a Project's repositories with one search every 5 minutes. GitHub's own
notifications of the user make it faster: when a notification names a PR of the Project, that PR's details are read at
once instead of at the next search. The inbox works without them.

- **What is read.** `GET /notifications?participating=true` through `gh api -i`, with the Project's GitHub account, once per
  account. With a focused worfy window the pace is GitHub's `X-Poll-Interval` (60 s when it gives none); without, every 5
  minutes. Less than 10 % of the REST rate limit left: no call until the limit resets.
- **304 means "nothing changed".** Each call after the first sends `If-Modified-Since` with the last `Last-Modified`. gh exits
  with code 1 and prints `gh: HTTP 304` on such an answer; worfy reads that as an answer, not a failure: no error in the
  view, no details read, the pace unchanged. GitHub does not count a 304 against the rate limit.
- **200.** Only threads of type `PullRequest` in the Project's repositories, updated after the previous `Last-Modified`,
  count. Each such PR is read again once. Issues, releases and other repositories are ignored.
- **403.** A fine-grained token, a GitHub App or a token without the `notifications` or `repo` scope may not read
  notifications. The trigger stops for that account until worfy restarts, and the view says "GitHub notifications
  unavailable for this token — checking every 5 minutes". The search goes on as before. A 403 of the rate limit only
  pauses the trigger until the reset.
- **Any other failure** doubles the trigger's interval, up to 30 minutes. The search is not touched.
- **Never "read".** worfy only reads. It never marks a notification as read: that is the user's own inbox on github.com.

### How it works

- **gh's exit code is not the answer.** gh exits with code 1 on every status above 299, a 304 included. The trigger runs gh
  in the runner's output mode `all`, so a non-zero exit still brings what `-i` printed: the status line and the headers.
  The status, `Last-Modified`, `X-Poll-Interval` and the rate limit headers are read from there.
- **The cursor.** The last `Last-Modified` is kept per account in `pr-inbox.json` of every Project of that account, so a
  restart goes on from it. Without a cursor no notification counts: the first search reads every PR anyway.
- **Read-only.** The call has no `--method`; the tests check the gh stub's log for any other method, `PATCH` or a call on a
  thread ([ADR-0105](../adr/0105-pr-reply-only-on-the-users-click.md)).

### Implementation

| What | Where |
|---|---|
| The trigger: the call, the answer, the pace, which PRs are read again | `src/main/github/inbox-notifications.ts` |
| The reader it calls (`refresh`), the snapshot's `notice` | `src/main/github/inbox.ts` |
| The cursor per account | `src/main/projects/pr-inbox-state.ts` |
| The focus of the window | `src/main/ipc/pr-inbox.ts` |

**Main tests.** `test/contract/pr-inbox-notifications.test.ts`: 304, 200, `If-Modified-Since` and the pace, 403, 500, the rate
limit and the stub's log, against `test/fixtures/gh/gh-stub.mjs`.
