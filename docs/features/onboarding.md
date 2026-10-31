# Onboarding

How a developer gets from a fresh install to one Ticket merged. This page has three sections. First run covers the checks
of the Machine and the actions that fix what they find. Getting started covers the guided list of six steps in a panel at the top right of the window.
Demo project covers the small Project that worfy creates for that list. Terms are explained in [Concepts](concepts.md).

## First run

### Behaviour

First run is a dialog over the window. It lists what worfy and the Harness need on this Machine, and it offers an action
for what can be fixed from there. Nothing changes until the user confirms it.

**When it opens by itself.** worfy decides once per window load. "Closed once" means the dialog was closed at least once on
this Machine, in any way.

| At the start | What opens |
|---|---|
| Never closed, new user | The page "Welcome to worfy", then the checks |
| Never closed, existing user | The checks |
| Closed once, and a check fails now that did not fail at the last close | The checks |
| Closed once, and no check fails that did not fail at the last close | Nothing |

New and existing are defined under [Getting started](#getting-started).

**Other ways in.** The Command palette's "First-run checks" opens the checks at any time, with or without a Project.
"Open checks" of step 1 of Getting started does the same. So do the buttons "First-run checks…" of the "Add project" dialog,
when the Harness stops the connection or gh is missing. Settings → Health shows the same rows, actions and "Check again".
Opening that section runs the checks, and closing Settings does not count as closing First run.

**The page "Welcome to worfy".** It explains three concepts in short texts: Project + Harness, Orchestrator and Canvas. The
checks already run behind it. "Next" goes to them. "Close" closes the dialog like any other close, so the page does not come
again by itself. Opened in any other way, First run starts on the checks.

**The checks.** Each row has a chip (OK, Warning, Failed, or Running… while its action runs), what was found, a line of what
to do, and sometimes a command with "Copy" or an action button. A chip at the top sums up: "Checking…", "Everything is ready"
or "2 failed · 1 warning".

| Group | Row | What it asks | When it is not OK |
|---|---|---|---|
| Claude Code | Sign-in | The account of a Claude Code process, within 60 s | Failed when not signed in, with `claude` to run and then /login, and when there is no answer |
| Claude Code | Claude Code in the terminal | `claude --version` against the version this build carries | Warning when missing, older or unreadable, with `claude update` unless it is missing. Sessions in worfy run their own copy either way |
| Command-line tools | git, gh, jq | `--version` | Failed, with `brew install <tool>` |
| Command-line tools | git identity | `user.name` and `user.email`, asked outside any repository | Warning, with the two `git config --global` commands |
| Command-line tools | node | Version 22 or newer | Failed, with `brew install node` |
| GitHub | GitHub accounts | `gh auth status` | Failed when gh is missing, and when no account is signed in, with "Sign in…" |
| Harness | Harness plugin | The installer's state | Failed when not installed ("Install") or on an installer error ("Retry"). Warning when disabled, with `claude plugin enable worfy@worfy-harness`, or when another version ("Update") or the same version from another build ("Replace") is installed |
| Harness | Plugin dependencies | The plugins the Harness plugin needs | Failed when one is missing, with "Install…". Warning when they could not be checked yet |
| Harness | Harness scripts | `profile --help`, run the way the Epics read runs it, within 15 s | Failed with the exit code or signal and what the script said: worfy then reads no Epics. Warning without a Harness or without that script |
| Harness | Old Harness in ~/.claude | Files of the old Harness | Warning, with "Move…" |
| qmd | qmd | Version 2.8.3 | Warning when another version is there, or when it is not installed: "Install…", or a command to install node first when node is missing or older than 22 |
| qmd | qmd models | Whether the question of the models was answered | Warning with the size and "Skip…", and "Download…" once qmd is installed. After a skip the row is OK, and "Download…" stays while qmd is installed |
| qmd | qmd collections | The collections of each connected Project that has a Profile | Warning with "Set up…", or with what to install first |

The size of the models is 2.4 GiB, or 2.2 GiB when a Profile has its documents in Russian. The qmd rows report what they find
only as a warning, because the Harness searches with grep without qmd. A tool gets 15 s to answer. A check that throws is
Failed with the error, and the other rows still run.

**Actions.** An action that changes something first shows a native dialog with "Confirm" and "Cancel" that names what will
happen: the command, the folder and the download. Only "Confirm" runs it. Actions run one at a time, and the First run dialog
cannot be closed while one runs. After an action the checks run again, except after "Sign in…". An action that failed makes the row of its check Failed with "The last
attempt failed: …", until the next attempt or until the check itself passes.

- "Install", "Update", "Replace", "Retry" and "Install…" on the Harness rows run the Harness installer. A development build
  shows the state and offers no such button, unless `WORFY_CLAUDE_HOME` points it at a sandbox.
- "Install…" on the qmd row runs `npm install -g` for qmd in the login shell. The models are a separate step.
- "Download…" and "Skip…" answer the question of the models. "Set up…" runs the collections script for each Project that lacks
  them.
- "Sign in…" asks, then puts a Terminal Node on the Canvas of the active Project with `gh auth login` typed in, and the dialog
  closes. The user answers gh's questions there and checks again. Without a Project the row has no button and shows the command
  to copy.
- "Move…" opens the move form of the old Harness, which asks on its own.

**"Check again"** first reads the login shell environment again, so a tool added by an rc file since the start shows up. A
Project of the sidebar whose Layout failed to read then tries again at once.

**"Start Getting started"** stands beside "Close" for a new user until step 6 of Getting started is marked. It closes First run
like "Close" and shows the Getting started panel, expanded and with the focus on its heading.

#### Windows

The list is the same, with these differences. The first line of the dialog says "PC" in place of "Mac". Tools are looked for
on the PATH of the environment worfy builds for a Session, not of a login shell. A missing tool's command is `winget install`
with `Git.Git`, `GitHub.cli`, `jqlang.jq` or `OpenJS.NodeJS.LTS`. A tool that does not answer has its whole process tree ended.

- jq is not required: missing or broken, it is a Warning.
- **Git Bash** (Command-line tools): found as Sessions find it. Failed when it is not found, and when
  `CLAUDE_CODE_GIT_BASH_PATH` names a missing file or a file under the Windows folder, such as the WSL launcher.
- **Windows version** (group Windows): build 19044, Windows 10 21H2, or newer, else Failed. An unreadable build is a Warning.
- **Architecture** (group Windows): anything other than x64 is a Warning. It prefers the architecture of the machine over that of
  the worfy process.
- **PowerShell** (group Windows): OK with PowerShell 7. With Windows PowerShell only, a Warning with
  `winget install Microsoft.PowerShell`.
- **Limits from terminal** (Claude Code): whether the status line of Claude Code runs the Limits bridge of this build, else a
  Warning. "Set up…" changes only that one setting, after a dialog that shows the command now and the new one. A development
  build has no bridge of its own, and the row has no button.

#### On a Linked machine

First run and Settings → Health always describe the Machine whose screen shows them. A Linked machine cannot run these checks
or actions here. In "Add project" for a folder on a Linked machine, the dialog says that the Harness is set up on that Machine
itself, in its own first-run checks, and that gh is signed in there.

### How it works

**Checks only read, and actions always ask.** A check writes nothing. worfy does not install git, gh, node or jq: it gives the
command to copy. What it does run, it names first.

**The environment is the one agents get.** A check that passes here has to mean that a Session will find the tool. So the
tools run with the login shell environment ([ADR-0007](../adr/0007-claude-code-launch-environment.md)) and on Windows with the
environment built for a Session ([ADR-0057](../adr/0057-agent-environment-on-windows.md)). The Harness scripts row uses the
runner and environment of the Epics read, so it fails for the same reasons as that read.

**Sign-in is a question to Claude Code.** A Claude Code process starts as for a Session and answers `accountInfo()`
([ADR-0009](../adr/0009-claude-code-login-check-account-info.md)). It gets no prompt and may use no tool, and it closes after
the answer, an error or the timeout.

**The mark.** Closing the dialog writes worfy's own file `first-run.json` in the data folder
([ADR-0005](../adr/0005-worfy-own-state-inventory.md)) with the checks that failed at that moment. At each later start main runs
the checks and opens the dialog only for a failure that is new, so a known failure does not come back at every start. A failed
action counts only while its check does not pass, so a cause fixed outside worfy does not open the dialog.

### Implementation

- `src/main/first-run/checks.ts` holds every check and `runChecks`. The system, its release, its architecture and the
  answers of the tools come in through `CheckDeps`, so tests check Windows on any machine.
- `src/main/first-run/actions.ts` holds `FirstRunActions`: the dialogs, one action at a time, and the failures kept per row. The
  work itself is in `src/main/harness/install.ts`, `src/main/harness/qmd.ts` and, for Limits from terminal,
  `src/main/harness/migrate/apply.ts`.
- `src/main/ipc/first-run.ts` wires them to the app, writes and reads the mark, and tells Getting started about each report. The
  channels are in `src/shared/ipc/first-run.ts`, all with the access mark `local`.
- `src/renderer/shell/FirstRun.tsx` is the dialog. `src/renderer/shell/FirstRunConcepts.tsx` is the welcome page.
  `src/renderer/shell/FirstRunChecks.tsx` draws the rows and runs the actions for the dialog and for
  `src/renderer/settings/HealthSection.tsx`. `src/renderer/shell/first-run-store.ts` keeps the state outside React.
- `WORFY_FIRST_RUN_AUTO=0` keeps the dialog from opening by itself, for e2e runs other than its own.
- Main tests: `test/contract/first-run-checks.test.ts`, `test/unit/first-run-windows.test.ts`,
  `test/unit/first-run-concepts.test.tsx` and `test/e2e/first-run.spec.ts`, which uses the stand-in tools of
  `test/fixtures/first-run-tools/`.

## Getting started

### Behaviour

Getting started is a floating panel in the top right corner of the window, under the toolbar. It is about 320 px wide and as
tall as its content, up to 70 % of the window; only a smaller window makes its content scroll inside. It holds six steps that take
one Ticket of the Demo project from the Orchestrator through review to merge. It blocks nothing and is never a modal window.

**The panel's layer.** The panel stands above the Canvas, the Sessions and the sidebar, and below every dialog and menu: First run,
Add project, Connect, the folder browser, the Command palette, Settings and the menus all open over it. It has no backdrop and does
not hold the focus. A click outside its box reaches what is under it. Toasts keep out of the panel and of its pill: they stack below
it in the same column.

**Collapsed.** The button at the right of the panel's heading, with the tooltip "Collapse", leaves only a pill "Getting started ·
n/6" in the same corner, where n is the number of marked steps. A click on the pill expands the panel again. Collapsed or not is kept
in the app settings, so it outlives a restart and is the same in every window of the Machine. A pill is not hidden Getting started:
"Skip" hides both.

**New and existing user.** worfy decides this once, before the first window, and does not decide it again.

| User | Decided by | What they get |
|---|---|---|
| New | No Project in the list, not counting the Demo project | The panel shows by itself, and First run, if it was never closed, starts with the welcome page |
| Existing | A Project in the list, or a Project list that did not read and was set aside | The panel stays hidden, with no pill. One notice in the corner, "New: Getting started — a guided demo of worfy.", with "Open" and "Not now" |

The notice stays until the user answers or closes it. However it left, it does not come back in a later window or start. "Open"
shows the panel.

**The steps.** A step marks itself when the fact is true, in any order, also when the work was done another way. The first
unmarked step is the current one, and only it has a button. A button is a shortcut, not a condition. A marked step shows a
check mark, with the time in a tooltip.

| Step | Marked when | Button |
|---|---|---|
| 1 Check your setup | A report of the checks has no failed row among those the demo needs (below). A warning does not count | "Open checks" |
| 2 Open the demo project | The Demo project exists and is in the list of Projects | "Create demo project" |
| 3 Meet the Orchestrator | A turn of the demo's Orchestrator ends | "Open the Orchestrator" |
| 4 Ship the ticket | The demo Ticket has passed Implementing | "Ship the ticket" |
| 5 See the review | The demo Ticket has passed Agent review | None |
| 6 Merge | The demo Ticket's status is `done` | None |

The checks that step 1 looks at are Sign-in, git, git identity, node, jq, Harness plugin, Plugin dependencies and Harness scripts.
Any report counts: at the start, "Check again", after an action, or in Settings → Health. git identity only warns, so step 1 can be
marked while "Create demo project" would still refuse for lack of a commit author.

Steps 3 and 4 make the demo the window's Project, open its Orchestrator and put a ready text in the input field: "What is planned
in this project?" and `/worfy:ship-ticket todo 01`. Nothing is sent: the user sends it. A text is not put over what the user has
already typed.

Removing the Demo project takes back steps 2 to 6. Apart from that a marked step stays: a later failed check does not take back
step 1. The steps go on being marked while the panel is hidden or collapsed, or the window shows another Project.

**Hints.** While Getting started shows, as the panel or as its pill, and the demo Ticket stands on a Stage with a hint, the hint is a line under the current step,
or under step 6 once all are marked and "Show steps" has brought the list back. Each hint is also a toast once, across windows and restarts. That toast belongs to the Demo project, so it shows only while that
Project is active.

| The demo Ticket | Hint |
|---|---|
| Queued, with step 3 marked and step 4 not | An Epic is a goal; a Ticket is one piece of work in it. Both are files in the project, under .scratch/. |
| Implementing | Implementer started in its own worktree — a separate checkout, so main stays untouched. |
| Agent review | The reviewer started. It reads the change and runs the project's checks itself. |
| Implementing again after a failed review | The reviewer found a problem — this is the rework round. The implementer fixes it on the same branch. |
| Gate & merge | Review passed. The Orchestrator runs the Gate — the project's full checks — and merges. |
| Done | Merged. The ticket is done. |

**A review that finds nothing.** The demo is made so that the review probably finds a problem, but this is not certain. When step 5
is marked and no rework round was seen, the step says "This time the review found nothing." and offers "Show an example". That opens
a recorded example in place: the reviewer's REJECTED with its finding, the implementer's fix and the reviewer's VERIFIED.

**Done.** Once step 6 is marked, the panel shows "Done — the ticket is merged" in place of the steps, with "Connect your own
project" and "Remove the demo project". "Show steps" brings the list back until the panel is next mounted.

**Leaving and coming back.** "Skip" at the bottom hides the panel and leaves no pill, removes nothing and says where it comes back
from. The Command palette's "Getting started" shows the panel again at any time, expanded and with the focus on its heading, with or
without a Project.
"Connect your own project" under the steps is not part of the demo: "Connect…" opens the same "Add project" as "+" of Projects.

#### Windows

The steps and texts are the same. Step 1 also looks at Windows version, Architecture, PowerShell and Git Bash.

#### On a Linked machine

The state belongs to the Machine it is on, and a Linked machine cannot read or change it. A window that shows a Linked machine still
shows the Getting started of its own Machine.

### How it works

**A view over facts.** Steps come from what happened, not from what was pressed: the checks, the list of Projects, the Sessions, and
the Stages and status of the Ticket. So a step done another way counts, and a review that ran while the window was elsewhere counts
too. Main writes no status of a Ticket: the Stages and the Harness's files stay the source
([ADR-0002](../adr/0002-worfy-is-a-view-over-the-workflow.md)). The state itself is worfy's own file `getting-started.json`
([ADR-0005](../adr/0005-worfy-own-state-inventory.md)).

**The user sends the messages.** The buttons of steps 3 and 4 only prepare the text, so the Orchestrator is seen as the Session that
does the work.

### Implementation

- `src/main/getting-started/state.ts` is the state file. Each write is one synchronous read, change and write, and nothing is kept in
  memory between calls, so several sources cannot drop each other's mark. Keys this build does not know are kept.
- `src/main/getting-started/progress.ts` marks the steps. Its `GettingStartedProgress` subscribes to the state, the Project list, all
  Session events and the Stages of the demo, whose subscription closes when the Project leaves the list. `firstRunPasses` holds the
  checks that step 1 looks at.
- `src/main/ipc/getting-started.ts` holds the handlers and `startGettingStarted`, which `src/main/index.ts` runs before the first
  window. That first read decides new or existing. The channels are in `src/shared/ipc/getting-started.ts`, all with the access mark
  `local`.
- `src/renderer/getting-started/GettingStartedPanel.tsx` is the panel and its pill, drawn into `<body>` at z-index 80 and mounted by
  `src/renderer/shell/AppShell.tsx`. Its root and the pill carry `data-toast-keep-out`, which the toasts' placement avoids. Collapsed
  is `sidebar.collapsed.GettingStartedSection` of the app settings, the key of the sidebar section the panel replaced.
  `src/renderer/getting-started/store.ts` holds main's snapshot in the window. The window marks no step: it changes the state only by
  asking main to show or hide Getting started (`section`), the notice, a hint shown, the
  cost, and creating or removing the demo. `src/renderer/getting-started/hints.ts` chooses the hint.
  `src/renderer/getting-started/notice.ts` is the notice. `src/renderer/getting-started/ReviewExample.tsx` and
  `src/renderer/getting-started/DoneScreen.tsx` are the recorded example and the screen Done. `src/renderer/session/pending-input.ts`
  holds the ready text.
- `WORFY_GETTING_STARTED_AUTO=0` keeps the panel hidden for a new user and reads the notice as shown, for the e2e tests.
- Main tests: `test/contract/getting-started-state.test.ts`, `test/unit/getting-started-progress.test.ts`,
  `test/unit/getting-started-panel.test.tsx`, `test/unit/getting-started-hints.test.ts`, `test/unit/getting-started-notice.test.tsx`,
  `test/e2e/getting-started.spec.ts`, `test/e2e/getting-started-entry.spec.ts`, `test/e2e/getting-started-hints.spec.ts` and
  `test/e2e/getting-started-done.spec.ts`.

## Demo project

### Behaviour

The Demo project is a small todo CLI in a local git repository, with no GitHub. It has one Epic, `todo`, and one Ticket, `01`: add
`done <n>`, which marks a task done. Agents really work in it and use the user's Claude Code usage. worfy says so under step 2, with
no prices.

**Creating it.** "Create demo project" in step 2 asks nothing and spends no tokens. The step shows each stage as a line:

1. Creating the folder: `worfy-demo` in the home folder, or `worfy-demo-2`, `-3` and so on up to `-100` when the name is taken.
   The user does not choose the folder.
2. Writing the files.
3. Making the first commit, by the author git knows, with signing and the `pre-commit` and `commit-msg` hooks turned off for that
   one commit.
4. Connecting the project to the Harness, with its own Profile `worfy-demo`.
5. Adding the project to the list.
6. Opening the Orchestrator. The Project then becomes active. No message is sent.

**When it cannot be created.** The step shows "Could not create the demo project:" and the reason. The main reasons:

| Reason | What to do |
|---|---|
| The home folder is inside the system's temporary folder, which the system cleans | Nothing is created there, ever |
| git knows no commit author | Run the two `git config --global` commands in the message |
| git cannot be run | Install git |
| The name and the 99 folders after it are taken | Free one of the folders |
| The Harness cannot be run, or does not know `--no-qmd` | Check or update the Harness in the first-run checks |
| The Harness has a Profile named `worfy-demo` that this demo did not create | Remove or rename it. worfy leaves it as it is |
| The Harness refuses the Project for another reason | The message gives the Harness's words |

A failure while creating undoes what this call made: the Project leaves the list, the previously active Project is active again, the
Profile is removed and the folder is deleted. What could not be undone is named after "Not undone:". The checks of the author and the
home folder come first, so a refusal there creates nothing.

**How it differs from another Project.** It is in Full mode, and a Ticket finishes locally: a green Gate full, then the branch is merged
into `main` of that repository. There are no PRs and no CI. Its Pipeline has five Stages: Queued, Implementing, Agent review, Gate &
merge and Done. Its review lenses are correctness and tests. qmd is not set up for it.

**What makes a rework round likely.** The check of a change and Gate fast run only the fast tests, which cover `add` and `list`. Gate
full runs every test, including a task that is already done and a number outside the list. The Ticket does not mention these cases.
Until the Ticket is done, the fast tests pass and the whole suite fails only in the tests of `done`.

**Cost.** Under step 2, while there is a demo, the switch "Demo agents" offers "Sonnet — a bit cheaper" and "Opus — a bit more
expensive". The demo starts on Sonnet with effort medium. Opus uses the model's default effort. The pick is saved for the demo's
Orchestrator and reaches a running Session from its next turn. If that Session refuses it, the switch says that the pick is saved for
the next start and that the running Session kept its settings. The switch changes only the demo.

**Removing it.** "Remove the demo project" is on the screen Done, so it is offered once step 6 is marked. Nothing removes the demo by
itself: not Skip, not Done, not a restart. First worfy checks that the folder is the demo it made, and otherwise refuses with nothing
touched, before asking anything. The folder may not be the root of a disk, the home folder or a folder above it, or overlap worfy's
data folder. The Harness must also know it as `worfy-demo`, with that Profile tied to this folder alone.

Then a native dialog asks "Remove the demo project?", names the folder and says that this cannot be undone. "Cancel" is the default and
does nothing. After "Confirm":

1. The demo's Orchestrator stops and cannot open until the removal ends, and every Session and Terminal working inside the folder is
   closed and waited for.
2. The Profile goes, with its entries in the Gate registry and its runs. If this fails, nothing is deleted and the panel says why.
3. The Project leaves the list, and its folder in worfy's data folder is deleted.
4. Steps 2 to 6 are taken back. Step 1 stays.
5. The folder is deleted, with 5 tries at most and 1 s between them.

The toast "The demo project was removed." says that it worked. If something stays, the panel names it with the reason. Claude Code's
transcripts of the demo stay, since they are Claude Code's data. After a removal the list of steps is back, and step 2 can create a new
demo.

#### Windows

Creating and removing the demo run the same code on both systems. The temporary folder that is refused is `%TEMP%`. The Profile writes
its worktree commands with `/` separators and single quotes, for Git Bash.

#### On a Linked machine

The Demo project does not exist for a Linked machine. It is not in the list the Linked machine gets. A call that names it, by id or by
a path inside it, is refused with `<name> is local to this Machine`, and events that name it are not passed on. "Linked machines can
work with my Projects" does not change this.

### How it works

**A template, not a draft.** Connecting another Project asks a Session to draft the Profile. The demo has its Profile ready in the
template, so nothing spends tokens until the user sends the first message.

**The files.** The template is code, not a build resource, so the packaging does not change for it:

```text
worfy-demo/
  package.json                          no dependencies; scripts test:fast and test
  bin/todo.js                           the CLI: add and list
  src/todo.js                           reads and writes todo.json in the current folder
  test/fast/todo.test.js                add and list
  test/full/cli.test.js                 the CLI as a user runs it, done and its edge cases included
  README.md
  .gitignore                            todo.json and .claude/worktrees/
  .scratch/todo/spec.md                 the Epic
  .scratch/todo/issues/01-done-command.md   the Ticket
```

**Marks without GitHub.** The agents' `review` mark is normally a commit status on GitHub, and this repository has no `origin`. In Full
mode with `workflow.finish` `local-green` and no `origin`, `bin/ticket mark` writes the marks file that Silent mode uses, and worfy reads
the Stages from it ([ADR-0045](../adr/0045-one-ticket-one-repository.md),
[ADR-0067](../adr/0067-pipeline-in-profile-and-sha-bound-agent-marks.md)). Both sides apply the same rule. The file is
`<Harness home>/runs/worfy-demo/marks/todo-01.json`.

**Sonnet or Opus for the whole demo.** The switch changes only the Orchestrator's picks. The implementer and the reviewer inherit its
model, and their effort comes from their own definitions.

**Removal is proven first.** The removal deletes a folder that a file names, so it trusts the file only when the Harness agrees. The
Orchestrator is held closed because a window that opens meanwhile would otherwise start a Session in that folder. The record goes before
the folder, because the Stages watch the folder while the record names it, and a watched folder can be busy on Windows.

### Implementation

- `src/main/getting-started/demo-template.ts` holds the files and the Profile draft, including the Gate registry entry with the fast
  script `test:fast` and the full script `test`. It does no input or output.
- `src/main/getting-started/demo.ts` holds `createDemo`, its `DemoCreator` (one creation at a time, a second call gets the same answer),
  and `DemoCostSwitch`. A record whose folder is there reopens that demo. A record whose folder is gone is dropped, and its Profile is
  removed only while the Gate registry still ties it to that folder. The Orchestrator opens with `CHEAPER_SETTINGS` before the Project
  becomes active, because the app opens the active Project's Orchestrator by itself and it would start on the default settings.
- `src/main/getting-started/remove.ts` holds `removeDemo`, `DemoRemover` and `protectedReason`. `keepClosed` of
  `src/main/agent/app-orchestrators.ts` holds the Orchestrator closed.
- `harness/bin/project-connect` connects with `--no-qmd` and removes with `--remove`. `harness/bin/ticket` writes the marks, and
  `marksInFile` of `src/main/workflow/stages.ts` reads the same rule.
- `localOnly` of `src/main/projects/store.ts` marks the Project. `src/main/link/caller.ts` and `src/main/link/ipc-adapter.ts` refuse the
  calls and drop the events.
- git, the Harness scripts, the Project list, the Orchestrators and the state come in through `DemoDeps`, `CostDeps` and `RemoveDeps`.
  `src/main/ipc/getting-started.ts` wires the app's. `src/renderer/getting-started/CostSwitch.tsx` is the switch.
- Main tests: `test/contract/getting-started-demo.test.ts`, `test/contract/getting-started-remove.test.ts`,
  `test/contract/getting-started-cost.test.ts`, `test/contract/demo-template.test.ts`, which runs the template's own tests and the real
  `project-connect --check`, `test/unit/demo-template.test.ts`, `test/unit/getting-started-cost-switch.test.tsx` and
  `test/unit/link-caller-local-only.test.ts`.
