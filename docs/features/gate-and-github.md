# Gate and GitHub

Three Features. **Gate** is the check of whether the changes in a worktree are ready. **Gate full** is the complete
form of that check and the situations that call for it. **PR and CI badges** are the chips on a Ticket and a Session that
show what the Gate and GitHub say. Terms are explained in [Concepts](concepts.md).

## Gate

### Behaviour

The Gate is one program that belongs to the Harness: `node gate.mjs [<profile>]` in a worktree. It runs the checks of the
Project on what changed in that worktree and gives one verdict. worfy never starts it and never writes its verdict:
agents and hooks run it, and worfy reads the result.

**Who runs it.** The hooks `TaskCompleted` and `TeammateIdle` of the Harness plugin run profile `fast`, with a limit of
900 seconds. The skills and the implementer agent run it by hand with stdin closed. Without a profile the argument is
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
  hooks use, looks further for a node of version 18 or newer. With none it answers `[gate] not verified: node not found`
  and exit code 3.

**Red or not verified.** A script that exits with a code other than 0 is red unless its output shows a missing
environment: `command not found`, `Cache entry required but missing`, `ENOENT` for a path in `node_modules`, a Docker daemon
or container runtime that is not there, a refused connection to port 5432 or `could not connect to server`. A line that
shows a live test run outranks these signs: `Tests 3 failed`, a line that starts with `FAIL`, `AssertionError`, `✗` or
`Expected … to` keep such a script red. A script that a signal ended counts as a failed script, and its report names the
signal. One red script makes the whole run red, whatever the others say. A failed script does not stop the scripts after it.

**What gets checked.** Each run prints a `[gate] scope` line with its choice and the reason. Normally the run is narrowed
to the files that differ from the merge-base with `origin/HEAD` or `origin/main`, including uncommitted and untracked files.
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
- The full output of every script, green ones too, goes to a log file. The newest 10 runs of a worktree are kept, and the
  logs of another worktree untouched for more than 8 days are removed.
- A file that the diff takes from at most 1000 lines to more than 1000 prints
  `[gate] warning: file over 1000 lines: <path> (<before> → <now>)`. A file that was already longer, a file that only moved,
  a binary file, a lock file and a generated file get no warning. The warning changes nothing else, and a cache hit prints it
  again.

**Holding a turn.** The hook `Stop` runs no checks. While the last run in the worktree is red, it holds the end of the
turn and tells the model to run the Gate and fix what it points to. It does this at most 2 times per session and worktree, and
a green run resets the count. After that it lets the turn end and says once that the Gate is still red. An unverified state
and a code 3 never hold a turn: the model hears about each once per session, the first per worktree, the second per
repository. A failure inside the hook holds nothing either.

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
run, a machine contract for worfy that carries no words of any language: outcome, profile, worktree, key, head, exit code, time,
reason, timings. A run that gets as far as knowing its worktree replaces the file whole or removes it. So a file from an older run
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
| `workflow.merge_gate` `wave` | Yes. One run for the set of a Wave's ready PRs, squash-merged in a temporary worktree (`wave-gate`). |

worfy's own repository is on the second row, with `ci-ok` as the final check. There Gate full stays a tool for the implementer
and for analysing a failure.

**The e2e lock.** With `workflow.e2e_lock` in the Profile, every e2e run and every Gate full of the Project take that folder as a
lock. A lock older than 30 minutes counts as abandoned, and its holder touches it every 5 minutes. A file inside it may name the
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
that field the Project has no queue. worfy's own repository no longer uses it.

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

The tooltip of a Gate chip adds the worktree's path, and the tooltip of the row sums up all its chips. A Ticket with a PR also has the
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
once per 5 minutes per branch. Any other Ticket has PR chips only while its PR is among those 100.

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
  fix rounds and with the Stage, so gh runs at most once per interval for all of them.
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
(`C:/Users/x/worfy`). To place a Gate call in a transcript, a `cd` to `C:\…`, `C:/…`, a UNC path or Git Bash's `/c/…` is understood.

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
