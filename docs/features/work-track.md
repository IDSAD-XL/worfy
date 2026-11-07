# Work track

Work track shows all the work of a Project on this Machine over a Day, a Week or a Month on one time axis: Autopilot
runs and their Waves, Waves sent by hand, the turns of every Session and their Subagents, gate runs and merged PRs,
and above them how many hours went to each Epic. It is the second half of the **Runs** tab, beside Run history, which
shows one Autopilot run in detail ([Flight Recorder](flight-recorder.md)). Like Run history, it is computed from the
sources each time it is read and stores nothing of its own. New to the terms: start with [Concepts](concepts.md).

## Work track

### Behaviour

#### Opening the view

**Runs** in the View switch of the toolbar opens the Runs tab. Over it is the switch `Run history | Work track`. A
Project shows Run history until Work track is chosen for it; then the tab and the Command palette's **Open Run
history** show Work track for that Project while the app runs. The choice is kept per Project and only in the memory
of the window. An entry that names a run or an Epic shows Run history whatever was chosen: the stop toast, **History**
by the Autopilot status line, **Run history** in the "⋯" menu of an Epic, and **Open Run** of the Span panel below.

**Esc** goes back to the Canvas, as it does from Run history, unless the Span panel, another dialog, a menu or a text
field takes it. Choosing another Project in the sidebar goes back to the Canvas too.

The view reads the Work track each time it opens and each time the period changes. It does not follow the work while
it is open: the switch, the tab or another period reads it anew.

#### The controls

One row, left to right:

- the switch `Run history | Work track`;
- **Period**: `Day`, `Week` or `Month`, Week by default. A Week is the 7 days that end on the chosen day, today at
  first. A Month is the calendar month, from the 1st;
- `‹` and `›` with the words of the period (`Thu 5 Nov 2026`, `30 Oct – 5 Nov 2026`, `November 2026`): a Day, a Week or
  a Month earlier or later. `›` is off when the period ends today, with the tooltip "Nothing later: the period ends
  today";
- **Lanes**: `by Session` (the default) or `by Epic`;
- **Density**: `compact` (the default) or `comfortable`. Comfortable has taller bars, writes the name in every bar wide
  enough for it, and writes the hours in the cells of a Month. Compact writes only the names of Waves.

Main answers at once with what the quick sources gave. While the transcripts and GitHub are still read, a line in
the row says `Reading transcripts, GitHub…`, and the view fills in when they come. If the whole read fails, a notice
says "The Work track could not be read: <reason>" with **Retry**.

#### The summary

One row over the lanes:

- **Hours by Epic**: a bar and the hours of each Epic, longest first, up to six in three columns. The rest is `+N`,
  with their hours in the tooltip. Work with no Epic is `—`, last. A period without work says "No work in this period".
- **of work in total**: the hours of work in the period, each moment once. Work done in parallel counts once, so two
  Subagents in the same hour make one hour. The hours of an Epic count the same way inside that Epic, so an hour two
  Epics share is in both and the Epics may add up to more than the total.
- **PRs merged**: the PRs whose merge falls in the period.
- **Autopilot Runs**: the runs that overlap the period.
- **no-data gaps**: the parts of the period where a source holds nothing, one per source where they overlap or touch.
  The tooltip names each source and why.

Work is the turns of Sessions, the Subagents and the Waves. Gate runs, CI runs and PRs are not hours of work.

#### The lanes

Over the lanes is the time axis, in local time: every two hours on a Day, a button per day on a Week, which opens that
Day. A diamond on the axis marks each PR merged in the period, at the time of its merge. On a Day with room for them, the
diamonds carry the PR number. A line marks now.

**by Session**, top to bottom:

1. **Autopilot Runs**: each run as a framed bar, with its Waves as framed bars on it. A Wave sent by hand, outside
   any run, is here too.
2. A lane per Session, in the order of its first work in the period: its turns. A Session with Subagents has `▸` and
   the number of its Subagents, and draws them as a thin strip under its turns. `▸` unfolds them: a lane per Subagent
   name, and a Subagent that started Subagents has their lanes under its own.
3. **Gate runs**: each gate run of the Project's worktrees.

**by Epic**: a lane per Epic with its hours, longest first, `—` last, holding the Waves, turns and Subagents of that
Epic; then **Gate runs**. Run bars are not on the Epic lanes. Switching the lanes does not read again.

A lane's name carries its marks. `hidden` is a Session whose Node is hidden or archived on the Canvas. `archived` is a
Session with no Node on the Canvas: its Node was removed, or it never had one. A Session on Codex has the chip `Codex`.

Bars of one lane that overlap go side by side, up to four lines; more share the last one. The colours tell Session
turns, implementers, verifiers, other Subagents, runs and Waves, and gate runs apart; a bar whose outcome is `failed`
or `rejected` is underlined in the problem colour. The legend at the bottom names them and says "All Sessions of this
Machine, hidden and archived too · titles only · times are local". A bar's tooltip has its name, its start and end as
the source has them (not cut to the period), its duration, its outcome when it is not `ok`, `going on` for work with no
end yet, its Epic and Ticket, and its PR.

Work with no end in its source is drawn up to now. A turn or a Subagent with no end whose transcript was written in the
last 15 minutes goes on; an older one ends at its last record, as `cut-off`.

#### The Month

A Month is cells, not bars. The axis has a button per day with its date, the letter of its weekday and the number of
PRs merged that day. Each lane has a cell per day, shaded by its hours of work that day: the busiest cell of the Month
is the full shade, counted between 4 and 14 hours. The Gate runs lane counts its runs instead, full at 20, and the
tooltip says how many failed. Comfortable writes the number in each cell. A click on a day, on the axis or in a cell,
opens that Day.

#### No data

Where a source holds nothing, the lanes it fills are hatched grey with `no data · <source>` and the reason in the
tooltip:

| Source | Hatched on | Reason |
|---|---|---|
| Claude Code transcripts | Session lanes on Claude Code | The part of the period before Claude Code's `cleanupPeriodDays` limit and before the oldest transcript of the Project left: "Claude Code deletes transcripts after N days (cleanupPeriodDays): none is left from this time". |
| Codex history | Session lanes on Codex | "Codex history did not answer"; "Codex did not give this thread" for one thread. Archived Codex threads are not read: a lane "Codex archived threads", hatched over the whole period, stands for them when the Project has any Codex thread. |
| gate logs (`timings.json`) | Gate runs | The part of the period before the later of 31 days ago and the Project's oldest gate record: "Gate logs are kept 31 days: the records of older gate runs are deleted". |
| Run journals, Wave markers | Autopilot Runs | The source could not be read. |
| GitHub | no lane | "GitHub did not answer: <reason>", from the part it did not read to the end of the period. |
| git log of the Ticket files | no lane | "git did not answer". |

A Session whose own transcript is gone still has its lane, hatched. Every gap counts in **no-data gaps** of the summary,
those on no lane too. A failed source never empties the view: the others still come.

#### The Span panel

A click on a bar or on a PR's diamond opens a panel on the right:

- the Span's name, what it is (`Autopilot Run`, `Wave`, `Session turn`, `Subagent · implementer`, `Gate run`, `PR`…)
  and whose Session;
- **When**, **Duration**, **Epic**, **Ticket**, **PR** and **Outcome**, with the times as the source has them, not cut
  to the period. A PR's outcome is `merged`;
- **Open Session**: the Session on its Node of the Canvas, live while worfy runs it; without a Node, its transcript
  read-only in the Session view. A Subagent opens its Session. Off for work of no Session;
- **Open Run**: Run history at the run the Span is part of. Off for work outside a run, a Wave sent by hand included;
- **Open PR**: the PR's page in the system's browser, on the repository that remote `origin` of the Project names.
  Off, with the reason in its tooltip, when no PR is known or the remote is not a repository on a GitHub host;
- the line `Source: <source>. Only titles are shown here; the contents of turns never enter Work track.`

**Esc** and `✕` close the panel; that Esc does not leave for the Canvas. Another period or Project closes it too. The
chosen bar is not highlighted, and the panel opens only with the pointer.

#### What is not in it

- **Only names.** A Session's name, a Subagent's name and description, the Epic, the Ticket, the PR number and title,
  the name of a CI workflow and of a gate run. The text of prompts, answers and reports never reaches the view.
- **Only this Machine.** The work of a Linked machine shows only as its PRs merged on GitHub.
- **Terminal and Terminal AI.** A shell keeps no transcript, and Terminal AI asks Claude Code to keep none.
- **CI runs and Ticket status changes** are read and are in the answer of main, but no lane or mark shows them.

#### On a Linked machine

A window on a Linked machine opens the Work track of a Project of that Machine while "Linked machines can work with my
Projects" is on. It is read on the Machine the Project is on, from that Machine's sources. Reading changes nothing, so
read-only access is enough.

### How it works

**A view, not a store.** Work track is computed from the sources each time it is read. worfy writes no index of work
and copies nothing for later ([ADR-0002](../adr/0002-worfy-is-a-view-over-the-workflow.md),
[ADR-0005](../adr/0005-worfy-own-state-inventory.md), [ADR-0092](../adr/0092-run-history.md)). Only the readers' own
memory caches outlive a read: the parse of each transcript file, by its path, modification time and size, for the life
of the app; the answer of GitHub for a minute.

**The sources.**

| Source | Gives | Kept |
|---|---|---|
| The Autopilot journals | Runs and their Waves. | Never cleaned by worfy. |
| The Wave markers of the Harness | Waves sent by hand: the first row `wave-started` with the Ticket numbers, the last `wave-finished`. | worfy does not clean them. |
| Claude Code transcripts | The turns of every Session of the Project and their Subagents. | `cleanupPeriodDays` of Claude Code's settings, 30 days by default. A whole calendar Month needs 31 days, so 35 or more keeps one. |
| The Codex history | The turns of Sessions on Codex. | As long as Codex keeps the thread; archived threads are not listed. |
| GitHub | PRs merged and CI runs. | Not cleaned. |
| Gate logs | Each gate run: time, outcome, worktree. | The record of a run (`timings.json`) for 31 days. |
| The git log of the Ticket files | Each change of a Ticket's `Status:`. | Not cleaned. |

**Which work is the Project's.** A transcript is the Project's when the first folder its records name lies in the
Project's root, a worktree under it included; files last written before the period are not opened. A gate run is the
Project's when its worktree lies in the root. GitHub is the repository of remote `origin`; a Project without one reads
no GitHub. Wave markers are read from the folder of the Project's Profile name in the Harness home; a Project whose
Profile cannot be read has none.

**Which Session.** A Session's name is the title of its Node on the Canvas. Without a Node it is `Session` and the first
four characters of its id, with the last part of its folder. The title Claude Code writes into a transcript is the
model's text, so it is not used.

**A Wave of a run and its marker are one Wave** when they have the same Epic, overlap in time and share a Ticket: the
journal's stays, with its run. A marker with no `wave-finished` goes on for a day, then ends at its last row as
`stopped`. A run goes on while its journal has no stop, it is the Project's newest, and Autopilot works on its Epic.

**Which Epic.** A run, a Wave and a PR or CI run on a branch `<epic>/<NN>` name their Epic. A turn or a Subagent with no
Epic of its own takes the Epic of what it is nested in: a Subagent the Wave it worked in, a Subagent started by a
Subagent that one's. A turn or a Subagent of the Session a run's Wave went to, begun inside that Wave, is nested in it.
With no Epic anywhere up the chain, it is `—`, never a guess.

**Hours** are the union of the intervals of the work in the period, not their sum, as self time is in Run history. A
day of a Month counts the part of the work inside that day.

**Slow sources.** A Month of transcripts and GitHub take seconds on a first read. Main reads them in the background:
its first answer names them in `loading`, and the view asks again, waiting for them. GitHub is read a week at a time
(one search of the merged PRs) and a day at a time (the CI runs). The first call that fails stops the read: the rest
of the period is a gap, and what was read before it stays. Over 1000 PRs in a week or 1000 CI runs in a day, the rest
is not read.

**Ticket status changes.** Two `git log -p` reads over `.scratch/*/issues/*.md`: the main branch from the start of the
period, and the remote branches not in it with 14 days more before the start. A change is the `Status:` line in the
first 15 lines of a file going to another state. Its time comes from the value when it has one, else from the commit.

### Implementation

#### Modules

| Path | What it holds |
|---|---|
| `src/shared/work-track/facts.ts` | The contract between the readers and the model: the kinds of fact, the sources and their names on screen, a Session, a gap, the period. |
| `src/shared/work-track/lanes.ts` | The spans of the period, the lanes `by Session` and `by Epic`, the work on no lane. Pure. |
| `src/shared/work-track/summary.ts` | The summary: hours, hours by Epic, PRs merged, runs, gaps, and each day's hours and merges. Pure. |
| `src/shared/work-track/status-value.ts` | The parse of a `Status:` value: the state and its time. Pure. |
| `src/main/work-track/service.ts` | The service: every source of a period, the slow ones in the background, the summary. Writes nothing. |
| `src/main/work-track/transcripts.ts` | The transcripts of every Session of the Project, cut to names as each line is read, and the Codex threads. |
| `src/main/work-track/github.ts` | The PRs merged and the CI runs of a period through `gh`. |
| `src/main/work-track/harness-state.ts` | The gate runs and the Wave markers in the Harness home. |
| `src/main/work-track/ticket-status.ts` | The Ticket status changes from git. |
| `src/main/ipc/work-track.ts`, `src/shared/ipc/work-track.ts` | The channel `workTrack.read` and the shape of its answer. |
| `src/renderer/flight-recorder/RunsView.tsx` | The Runs tab: the switch `Run history \| Work track` and which half each Project shows. |
| `src/renderer/work-track/WorkTrackView.tsx` | The view: the controls, the summary, the lanes, the panel, the legend. |
| `src/renderer/work-track/Lanes.tsx` | The axis, the names of the lanes and their bars, the gaps. |
| `src/renderer/work-track/MonthGrid.tsx` | The Month: the days and their cells. |
| `src/renderer/work-track/SummaryRow.tsx` | The summary row. |
| `src/renderer/work-track/SpanPanel.tsx` | The Span panel and its buttons. |
| `src/renderer/work-track/store.ts` | The state of the view, the periods and the reads. |
| `src/renderer/work-track/work-track.css` | The styles, over the tokens of `src/renderer/theme/tokens.css`. |

#### Data flow

1. The view asks `workTrack.read` with the Project and the period.
2. The service reads the journals, the Wave markers, the gate logs and git, starts the transcripts and GitHub in the
   background, and answers with the facts, the Sessions, the gaps, the summary and `loading`.
3. With `loading` not empty, the view asks again with `wait` and shows the answer once every source is in.
4. The view builds the lanes itself from the answer with `lanesBySession` or `lanesByEpic`: which Sessions are unfolded
   is the view's state, so switching the lanes or unfolding a Session reads nothing.

#### Windows

The model has no branch by platform. Worktree paths are compared in the one canonical form of
`src/main/flight-recorder/worktree-path.ts`, so a gate run of a worktree inside the Project is found on every system.
The times of the work come from inside the files and from git. A file's modification time only picks the files to open
and tells whether a turn with no end still goes on.

#### Tests

These tests call no model and no GitHub: transcripts and the Harness home are fixtures in a temporary folder, and `gh`
is a stand-in named by `WORFY_GH` (`test/fixtures/work-track/gh/gh-work-track.mjs`).

| Test | Covers |
|---|---|
| `test/unit/work-track-lanes.test.ts`, `test/unit/work-track-summary.test.ts` | The lanes, the Epic up the chain, the gaps; hours without double counting, merges, days. |
| `test/unit/work-track-status-value.test.ts` | The forms of a `Status:` value. |
| `test/contract/work-track-transcripts.test.ts` | The transcripts of every Session, names only, the cleanup gap, Codex. |
| `test/contract/work-track-github.test.ts` | The weekly and daily reads, the answer kept for a minute, the stop on the first failure. |
| `test/contract/work-track-ticket-status.test.ts` | The status changes of a branch squashed into the main branch and of the main branch alone, their times. |
| `test/contract/work-track-service.test.ts` | Every source together, a Wave sent by hand, the gate gap, GitHub not answering, and that nothing is written. |
| `test/unit/work-track-view.test.tsx` | The switch of the Runs tab, the periods and `‹ ›`, the lanes, the gaps, the Month, the slow sources, Retry. |
| `test/unit/work-track-panel.test.tsx` | The summary and the Span panel with its buttons and Esc. |
| `test/e2e/work-track.spec.ts` | The built app: the Week, a Day, the Month, the summary, and Open Run into Run history. |
