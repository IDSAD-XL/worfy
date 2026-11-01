# Flight Recorder

Flight Recorder shows what happened during one Autopilot run on one time axis: its Waves, Tickets, Stages, agents, CI
runs, gate runs, retries, waits and blocks, and above them where most of the time went. The screen is **Run history**.
It reads the run's journal and the sources that already hold the details, and stores nothing of its own. The run
itself is described on the [Autopilot](autopilot.md) page. New to the terms: start with [Concepts](concepts.md).

## Run history

### Behaviour

#### Opening the screen

Run history takes the whole main area of the window, in place of the Canvas. The toolbar has no tab for it. It opens
from four places:

- **The stop toast.** When a run stops, for any reason, a toast says `Run stopped: <reason> · N done, M blocked ·
  <duration>` with the button **Open history**, which opens the screen at that run. The toast does not go away by
  itself. A Project keeps the toast of its latest stopped run only: a new stop closes the toast of the run before it,
  and a run that ended before the one whose toast is shown gets none. A window shows the toast of a run once, and not
  at all for a run that stopped before the window opened. A run started with the button, by a command in a chat or by
  the agent's tool gets the same toast. The operating system gets no notification.
- **History** right of the Autopilot status line on the Epic frame, while that Epic's run is stopped: the screen at
  that run. It goes away when the next run starts.
- **Run history** in the "⋯" menu right of the Autopilot button: the screen with the list of runs kept to this Epic,
  at its newest run. The item is always there, also on a read-only screen. An Epic whose Tickets are all done draws no
  Autopilot button, but still has "⋯" with this one item when it has past runs.
- **Open Run history** in the Command palette: the screen at the newest run of the active Project.

**Esc** goes back to the Canvas, unless a dialog, a menu or a text field takes it. Choosing another Project in the
sidebar goes back to the Canvas too.

#### The header

The header has a picker of the Project's runs, newest first, each as its local start time and Epic, with `live` for a
run that goes on. Opened from an Epic's menu, the list holds only that Epic's runs, and a chip says `Epic filter: <epic>`.
Then the facts of the chosen run:

- the Epic, the start and the end (`now` while it goes on) in local time, and the duration;
- how it stopped: `running`, `stopped: <reason>`, or `no stop in the Journal` when the journal just ends. A stop for a
  block or a failure is in the problem colour;
- the number of Waves, and the Tickets `done`, `blocked` and `cut-off`. Tickets that are none of these are counted as
  `not done yet` while the run goes on and as `stopped` after it;
- `Retries`: the attempts from `#2` on of agents, CI runs, gate runs and scripts;
- `Started by`: `the Autopilot button`, `a command in a chat`, or `the Orchestrator (autopilot_start)`. The last one
  stands for any run the tool `autopilot_start` started, whichever Session's agent called it. A journal written before
  this was recorded has no such line.

#### The summary

Under the header, three groups say where the time went:

- **Longest Stages by self time**: three cards. Self time is the duration minus the time of the spans inside it. A click
  on a card selects that Stage on the timeline and opens the rows above it.
- **Work inside Stages (summed; parallel)**: the time of implementers, verifiers, other agents, CI runs, gate runs and
  scripts, each summed over its spans, with their number. Parallel work is added up, so the sum can pass the run's
  length.
- **Waits by cause**: the total of each cause and its share of the run. The cause `background tasks` counts only the
  time when no work of the run goes on, and says `without work`: its total is shorter than its bars on the Wait lane.

#### The timeline

Over the tree are the controls: **Fit** (the whole run, which follows the end of a live run), **Zoom out** (twice the
stretch on screen), **Expand all**, **Collapse** (only the run and its Waves stay open), the filter field and
**Problems only**.

Below them is the time axis with a mini-map of the whole run. To zoom, drag along the axis or along the mini-map, or
use Ctrl or Cmd with the wheel around the pointer. Shift with the wheel moves the stretch. A plain wheel scrolls the
rows. The narrowest stretch is one minute. Times on the axis are local.

The rows, top to bottom:

1. The **Waits** lane: the waits of the run, one bar each, named by cause: `Limits`, `Limits budget`, `Background
   tasks`, `Gate queue` or `Other Machine`.
2. The **Orchestrator** lane: the Orchestrator's turns. A turn links to the Tickets it touched and is not nested in
   them. An `i` mark stands for each refused dialog and each time a person stepped in.
3. The tree: Run → Wave → Ticket → Stage → work. Work is an agent (implementer, verifier or other), a CI run, a gate run
   or a script. A Ticket that went through several Waves is one row, under the Wave it started in, with one part per
   Wave and the gap between them.

At first the run, its Waves and Tickets and the Waits lane are open. A row has `▸` or `▾`, a dot in the colour of its
kind, its name, and its outcome in words when it is not `ok`. A collapsed row draws its children as thin bars under its
own. A bar's label stands whole inside the bar or right of its end, never across another bar of the row. With room for
neither it is not drawn, and the bar's tooltip has it.

What the bars show:

| On screen | Meaning |
|---|---|
| `#2` on a bar and in its row | A retry: an implementer sent back after a REJECTED verifier, a narrow fix round, an agent started again after a Session error, a CI run again. Selecting it outlines the span that caused it with a dashed line. |
| Red `!` on a Ticket's row | A block, with its `Blocked reason:` and `Waits:`. The row is hatched grey from there until the block is cleared or the run ends. |
| A jagged, fading end | Cut off: the span has no end in any source, so it ends at the last event about it. |
| Grey hatching and a label | The source of the details is gone: `transcript deleted`, `gate logs deleted (10 runs or 8 days)`, `GitHub did not answer` or `branch deleted`. |
| One Stage bar with several names | No source marks the boundaries between these Stages; the span notes `no boundary in sources`. |

A step that neither the journal nor any other source mentions did not happen, and has no bar.

Selecting a Wait or an Orchestrator turn highlights the rows of its Tickets.

#### Filter and Problems only

The filter field takes a Ticket (`07`, `Ticket 7`, or `worfy-pipeline/07`), an agent (its name, such as `verify-05`, or
the start of its id), a PR (`#460`, `PR 460`, `460`) or a word of a reason or of a wait's cause (`rejected`,
`background`). Digits alone match a Ticket or a PR number, never a part of a sha, an agent id or a reason.

**Problems only** keeps the failures (`failed`, `rejected`, `blocked`, `stopped`, `cut-off`), the retries, the Tickets
with a block mark, and every wait. The run itself never counts. A Ticket the run left unfinished is `stopped` only once
the run has stopped: while it goes on, such a Ticket has no outcome and is not a problem.

The filter and Problems only work together. The rows above a kept span stay, as the way to it. Under a filter every
row is open, and a row closed there opens again with the next filter. Each run has its own filter.

#### The detail panel

A click on a bar or a row opens the panel at the bottom, with three tabs:

- **Overview**: the kind, start, end, duration, self time, outcome, attempt (with a link to the span a retry repeats),
  reason, the path in the tree, the span's note, and for a Ticket its blocks.
- **Links**: the PR and the commit, the transcript, the Tickets, the verdict, the agent id and the Session id, those the
  span has. The PR and the commit open in the system's browser, on the page of the repository that remote `origin` of
  the Project names, on the host of that remote. Without such a remote they are text, and their tooltip says why. The transcript
  opens where worfy shows it already, read-only from the file: an agent's in the Subagent's view, the Orchestrator's in
  the Session view. A Ticket selects its row.
- **Source**: where the start and the end come from (the Autopilot journal, a transcript, GitHub, a gate log, the
  marks file of the Harness, git), and what limits the source, for example a gate run answered wholly from the green
  cache, which leaves no log.

#### A live run

The screen can be open while the run goes on. The timeline follows it: it is computed again at most every 5 seconds
when the journal or a transcript has grown, and GitHub is asked at most once a minute. A line marks now, a span still
going stretches to it with the word `running`, and an agent whose transcript is not there yet says
`transcript not found yet`. When the run stops on screen, the header and the list say so with the next change.

If computing again fails, a notice says "The timeline stopped following the Run" with the reason. The timeline on
screen is the last one. Opening the run again tries anew.

#### GitHub

For a Project whose Tickets end with a PR, the PR, CI and merge facts come from GitHub with the account of the
Profile. When `gh` fails, the line "GitHub did not answer" stands over the summary, the PR and CI bars carry the same
label, and the timeline is built from the local sources. **Retry** asks GitHub at once. A Project in Silent mode or with
`local-green` does not ask GitHub: its verdicts and merges come from the marks file and git.

#### What is kept and for how long

Run history keeps no copy. A run lasts as long as its sources:

| Source | Kept |
|---|---|
| The Autopilot journal | Never cleaned by worfy, so the frame of every run stays: its Waves, waits, Tickets' statuses and stop. |
| Transcripts | As long as Claude Code keeps them: `cleanupPeriodDays` of its settings, 30 days by default. |
| Gate logs | The last 10 runs of each worktree. A later gate run removes the folder of a worktree untouched for more than 8 days. |
| GitHub | Not cleaned. |

A detail whose source is gone shows as grey hatching with the label of that source. Lines of the journal that are not
JSON or of an unknown kind are left out, and a footnote counts them.

#### On a Linked machine

A window on a Linked machine opens the Run history of a Project of that Machine while "Linked machines can work with my
Projects" is on. The runs are read on the Machine where they ran. Opening and Retry only read, so read-only access is
enough.

### How it works

**A view, not a store.** The timeline is computed from the sources each time a run is opened. worfy writes no index of
spans and copies nothing for later ([ADR-0002](../adr/0002-worfy-is-a-view-over-the-workflow.md),
[ADR-0005](../adr/0005-worfy-own-state-inventory.md)). The run id of the journal ties the sources together. PRs and
commits are found by the branch of a Ticket and by sha; nothing is stamped into them.

**What each source gives.**

| Source | Gives |
|---|---|
| The Autopilot journal | The run and its Waves, the waits for the Limits, the budget, background tasks and the gate queue, the Tickets' statuses (`ticket-status`), the narrow fix round, Session errors, refused dialogs, a person's actions, the stop. |
| The Orchestrator's transcript | Its turns, the `Agent` calls and the `SendMessage` calls that resume an agent, the task-notifications. |
| The Subagents' transcripts | The start, the end and the outcome of each agent. |
| GitHub | The PR opened and its new heads, CI runs and their retries, verdict comments, marks of agents on the head, the merge, and the label of the cross-machine gate (the wait `Other Machine`). |
| Gate logs | Each gate run: its time, outcome, head, worktree and steps. |
| The marks file and git | For Tickets without a PR: the marks, the `gate:` commits of `local-green`, the new heads and the local merge. |

The journal is the frame. Two of its lines exist for Run history: `ticket-status`, because a Ticket's file holds only
its present status, and `gate-queue-finished`, the end of the "Process gate queue" turn. Three optional fields help it
too: `wave-started.session` names the Orchestrator's transcript a Wave went to, and `run-started.by` and
`run-started.tickets` say who started the run and over which Tickets. The [Autopilot](autopilot.md#the-journal-file)
page lists the lines. The Harness writes nothing into the journal, and the gate is not changed for it
([ADR-0092](../adr/0092-run-history.md)).

**Which transcript is a Wave's.** `wave-started.session` names it. A journal without that field has the Wave's text, and
the Session whose prompt with that text lies nearest the Wave's start is taken. A journal with neither, or a file that
is gone, gives the label `transcript deleted`. A transcript belongs to the Project when the folder its records name
lies in the Project's root, not by the name of its folder.

**Which Ticket a piece of work is.** An agent's Ticket comes from its name (`impl-NN`, `verify-NN`), else from its
description, branch or Ticket path in its prompt. An agent with no Ticket named, in the worktree of an agent of a
Ticket, gets that Ticket; any other belongs to the run. A gate run belongs to a Ticket by the head of its PR, and
without a PR by its worktree.

**Spans.** A span has a kind, a start, an end or none, an outcome, a reason, an attempt, links and the sources of its
start and end. The kinds are fixed: run, wave, ticket, stage, agent, ci, gate, script, wait and orchestrator turn. A
wait, a retry and every outcome other than `ok` carry a reason. An agent's span is one stretch of active work, from
the `Agent` call or a resuming `SendMessage` to its report, and not the life of its Session.

**Stages are computed.** A Stage is not stored ([ADR-0067](../adr/0067-pipeline-in-profile-and-sha-bound-agent-marks.md)). At each
event of a source, the Stage of the Ticket is computed over the facts known up to it, by the same rules as the board of
the [Workflow](workflow.md) page. An event is a boundary: the claim, a PR opened, CI started and ended, a verdict or a
mark, the merge, `done`. Without one there is no boundary.

**A block is a mark, a retry is a span.** A block is not a span: it is a mark on the Ticket's row that lasts until it
is cleared or the run ends. A retry is a new span of the same kind with the next attempt number, linked to the span that
caused it.

**Self time** is the duration minus the union of the intervals of the spans inside, not their sum, because children run
in parallel. What happened after the run ended, such as a merge by hand the next day, is not part of the run.

**The live timeline.** While a window holds a live run open, main looks every 5 seconds whether the journal or a
transcript it read has grown, and computes again only then. Transcripts are read on from where the last read stopped,
and each file's parse takes only the new lines. GitHub keeps its answer for a minute, as the PR badges do. A run that
is over is read whole, once per computation, and kept nowhere.

### Implementation

#### Modules

| Path | What it holds |
|---|---|
| `src/shared/flight-recorder/facts.ts` | The contract between the readers and the model: the facts of a run, the kinds of span, outcomes, wait causes, sources and the labels of a lost source, and which reader fills each field. |
| `src/shared/flight-recorder/spans.ts` | `buildTimeline`: the spans, the tree, the Stages, the block marks, retries, cut-off spans. Pure. |
| `src/shared/flight-recorder/summary.ts` | Self time and the summary: the longest Stages, work by subkind, waits by cause. Pure. |
| `src/shared/flight-recorder/from-journal.ts` | The facts of the Autopilot journal. |
| `src/shared/flight-recorder/from-transcript.ts` | The facts of the transcripts: agents, attempts, the Orchestrator's turns, read a part at a time for a live run. |
| `src/shared/flight-recorder/from-github.ts` | The facts of GitHub: PRs, CI runs, verdicts, marks, merges, the wait `other-machine`. |
| `src/shared/flight-recorder/from-gate.ts` | The facts of a gate log and of the `gate:` commits. |
| `src/shared/flight-recorder/journal-walk.mjs`, `src/shared/flight-recorder/pr-facts.mjs` | The journal and PR parse shared with `scripts/critical-path.mjs`, plain modules with declarations. |
| `src/main/flight-recorder/service.ts` | The service: the runs of a Project, one run's timeline from all readers, the live recompute and Retry. |
| `src/main/flight-recorder/transcripts.ts` | Finds and reads the Orchestrator's and the Subagents' transcripts of a run. |
| `src/main/flight-recorder/github.ts` | Asks `gh`, at most once a minute, and the repository's page from remote `origin`. |
| `src/main/flight-recorder/gate-logs.ts` | Reads the gate logs under the Harness home. |
| `src/main/flight-recorder/local-verdicts.ts` | The marks file and git, for Tickets without a PR. |
| `src/main/flight-recorder/worktree-path.ts` | The one form of a worktree path that every reader hands over. |
| `src/main/ipc/runs.ts`, `src/shared/ipc/runs.ts` | The `runs` IPC channels and the shape of a run's view. |
| `src/renderer/flight-recorder/RunHistoryView.tsx` | The screen: header, notices, summary, timeline, panel; Esc. |
| `src/renderer/flight-recorder/Timeline.tsx` | The controls, the axis and mini-map, the zoom, the rows and bars. |
| `src/renderer/flight-recorder/label-layout.ts` | Where a bar's label goes. Pure. |
| `src/renderer/flight-recorder/filter.ts` | The filter, Problems only, what a selection highlights. Pure. |
| `src/renderer/flight-recorder/DetailPanel.tsx` | The detail panel, the GitHub notice and Retry. |
| `src/renderer/flight-recorder/SummaryStrip.tsx` | The summary. |
| `src/renderer/flight-recorder/store.ts` | The state of the screen and the rows of the tree. |
| `src/renderer/flight-recorder/stop-toast.ts` | The stop toast. |
| `src/renderer/flight-recorder/open.ts` | `openRunHistory`, which every entry calls. |
| `src/renderer/canvas/actions/AutopilotAction.tsx` | "History" by the status line and "Run history" in "⋯". |
| `src/renderer/palette/commands.ts` | "Open Run history". |
| `src/renderer/theme/tokens.css` | The `--span-*` colours of both themes. |

#### Data flow

1. An entry calls `openRunHistory`. The window shows the view `history`, asks `runs.list` for the Project's runs and
   `runs.open` for the chosen one.
2. The service reads the run's journal from the data folder, then the transcripts, GitHub (only for Projects whose
   Tickets end with a PR), the gate logs, and the marks file and git for Tickets without a PR. Each reader hands facts
   over; `buildTimeline` makes the spans and `summarize` the summary.
3. While the run is live and the window holds it, the service computes again on growth of its files and sends
   `runs.changed`. `runs.close` lets the run go when the window shows another run or leaves the view.
4. `runs.retry` asks GitHub at once and answers the new timeline.
5. The stop toast comes from `autopilot.changed`: a stopped state carries the run id and its counts.

#### Windows

The model has no branch by platform. The journal is in the data folder under `%APPDATA%`, transcripts under the Claude
home in the user's profile folder, and the gate logs under the Harness home. Worktree paths are compared after
`realpath`, with `/` for `\` and in lower case on Windows, so an agent and a gate run of one worktree meet. Times come
only from inside the files, never from when a file changed.

#### Tests

These tests call no model and no GitHub: the journal and transcripts are fixtures under `WORFY_DATA_DIR` and
`WORFY_CLAUDE_HOME`, `gh` is a stand-in named by `WORFY_GH`. The shared fixture is an anonymised night run in
`test/fixtures/flight-recorder/night-run/`.

| Test | Covers |
|---|---|
| `test/unit/flight-recorder-spans.test.ts` | The span model: the tree, Stages, blocks, retries, cut-off spans, lost sources. |
| `test/unit/flight-recorder-summary.test.ts`, `test/unit/flight-recorder-summary-waits.test.ts` | Self time and the summary; the background-tasks wait without work. |
| `test/unit/flight-recorder-journal.test.ts`, `test/unit/flight-recorder-transcript.test.ts`, `test/unit/flight-recorder-github.test.ts`, `test/unit/flight-recorder-gate.test.ts` | The facts of each source. |
| `test/unit/flight-recorder-sources.test.ts` | The parse shared with `scripts/critical-path.mjs`. |
| `test/unit/flight-recorder-view.test.tsx`, `test/unit/flight-recorder-detail.test.tsx` | The screen over the night run: header, summary, `#N`, blocks, the panel. |
| `test/unit/flight-recorder-filter.test.ts`, `test/unit/flight-recorder-label-layout.test.ts` | The filter and Problems only; the place of labels. |
| `test/unit/flight-recorder-stop-toast.test.ts` | The stop toast: one per run, the latest per Project. |
| `test/unit/canvas-actions.test.tsx`, `test/unit/palette-commands.test.tsx` | "History", "Run history" in "⋯", "Open Run history". |
| `test/contract/flight-recorder-service.test.ts` | The service over all readers, the live recompute, Retry. |
| `test/contract/flight-recorder-transcripts.test.ts`, `test/contract/flight-recorder-github.test.ts`, `test/contract/flight-recorder-gate-logs.test.ts` | The readers in main. |
| `test/contract/runs-ipc.test.ts` | The `runs` channels. |
| `test/e2e/flight-recorder.spec.ts`, `test/e2e/flight-recorder-detail.spec.ts` | The built app: the screen, labels that cross no bar, the panel, Retry, Problems only. |
