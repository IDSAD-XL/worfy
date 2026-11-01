# Autopilot

Autopilot runs the Waves of one Epic one after another, with no person at the Orchestrator. It sends a Wave, waits
until the Wave is over, sends the next ready Wave, and stops when no Wave is ready or something goes wrong. One such
pass over an Epic is a **run**. New to the terms: start with [Concepts](concepts.md).

## Autopilot

### Behaviour

#### Starting a run

The frame of an Epic on the Canvas has an **Autopilot** button. The button is hidden only when every Ticket of the Epic is
done and the Epic has no run going on, no status line of a past run, no stop on its way and no "running on <Machine>"
refusal. So after a finished run it stays, inactive, until the app restarts or the Project runs another Epic. It is active
when "Run wave" could run now and the Project's "Run wave" template names the Wave's Tickets with `{tickets}`. Its tooltip
says what it does, that the display stays on until the run ends, the Run mode the button starts in (the default of
Settings → Autopilot), and the forecast of what is left of the Epic:

> Mode: Budget-aware (Settings → Autopilot). This Epic: 4 Waves, 11 Tickets left, usually 18–31% of the week. Used now: 41%, resets in 2 d 5 h. Recommended: 2 Waves now, the other 2 after the reset

The range is drawn from the share of the week each Ticket of the last 10 past Waves took, by the run journals of this
Machine. It counts the Waves left of the Tickets shown in the frame; Tickets without a Wave number are named as not
counted. With fewer than 5 past Waves that have fresh Limits numbers, the tooltip says there is not enough data for a
forecast. Then, for the default mode:

- **Budget-aware**, or **Start window** with **Daily budget of the Limits** on: how many Waves fit before the 7-day
  window resets without touching the reserve ("Recommended: …", or "All 4 Waves fit before the reset without the
  reserve").
- **Fastest**, or **Start window** with the budget off: a warning when not all Waves fit before the reset ("Only 2 of 4
  Waves fit before the reset: then the run waits for the Limits").
- **Start window**: the window and how long a Wave usually takes ("Start window 23:00–07:00: a Wave usually takes up to
  1 h 40 min"), or that there is not enough data on Wave duration.

The recommendation and the warning need a 7-day number no older than 30 minutes; without one the tooltip says
"Used now: unknown" and gives neither. They are words only: the run itself is led by its Run mode.

A start is refused, with the reason on the button, in these cases:

- The Project already has a run. A Project has at most one run at a time.
- The Orchestrator is in a turn, has live background tasks, or has messages waiting in its queue.
- The "Run wave" template is empty or does not contain `{tickets}`.
- The Project has no such Epic, or the workflow cannot be read.
- The Project is worfy's own repository and this is a development build. Any checkout of that repository counts, the
  worktrees included.
- The same Epic of the same repository runs, or is starting, on a Linked machine or in another Project of this Machine.
  A chip "running on <Machine>" appears under the button, with a **Start anyway** button beside it.

A refused start writes no journal and does not keep the display on. "Start anyway" starts the run even though both runs
will take the same Tickets. It is the only way past that refusal. A Linked machine that is not connected, or that does
not answer within 3 seconds, does not block a start: the chip "on <Machine>" names it in its tooltip. A Project without
remote `origin` asks no one.

No run starts by itself, also not after the app restarts.

#### Starting a run from a chat

The command `/worfy:epic-wave`, typed in the chat of a Session inside worfy (the Session view or a Session Node on the
Canvas), starts the same run as the button. It does not reach the agent, and worfy asks no confirmation: the person
typed it. These forms are commands:

- `/worfy:epic-wave tickets 05, 06 of epic X`, and the older form `Ticket-ы 05, 06 эпика X`: a run over these Tickets only.
- `/worfy:epic-wave wave N of epic X` (also `run wave N of epic X`), and the older form `волна N эпика X`: a run over the
  Tickets of row N of the Waves table in the Epic's `spec.md` that are not done yet. The table may have one row per
  Ticket (`Ticket | Files | Wave`) or one row per Wave (`Wave | Tickets`, with lists and ranges such as `11–19`). A table
  that cannot be read, or that has no Wave N, gives a refusal that asks to name the Tickets:
  "name the Tickets: tickets NN, NN of epic X".
- `/worfy:epic-wave epic X`: the whole Epic. `/worfy:epic-wave X` too, when the Project has Epic X.

Any other text after `/worfy:epic-wave` goes to the agent as before, for example "resume after a session break", a word
that is no Epic of the Project, an argument such as `depth medium`, or a message with attachments. A toast says what
became of the command: "Autopilot started on Epic X", or the refusal. While a run of the Project goes on, the refusal is
"Autopilot is already running Epic X. Stop it first." A refused command writes no journal, and a running run does not
count it as a person stepping in. A message sent right after a command waits for its answer, so it reaches the run that
command started, and the run journals it as a person stepping in. Typed in the Orchestrator's own Session during its turn, the run starts once that turn
is over, and the toast says "Autopilot starts after this turn". The Waves Autopilot sends to the Orchestrator are never
read as a command.

**From a chat, by the agent.** When the user asks a Session in words to run an Epic, or some of its Tickets, on autopilot,
the agent calls the canvas tool `autopilot_start` with the Epic and, for named Tickets, their numbers. worfy then asks the
user in a dialog that names the Project, the Epic and the Tickets. Its text has the same forecast as the button's
tooltip, one line per mode:

```
Forecast: This Epic: 4 Waves, 11 Tickets left, usually 18–31% of the week. Used now: 41%, resets in 2 d 5 h.
Budget-aware: Recommended: 2 Waves now, the other 2 after the reset.
Fastest: Only 2 of 4 Waves fit before the reset: then the run waits for the Limits.
Start window 23:00–07:00: a Wave usually takes up to 1 h 40 min.
```

A run over named Tickets forecasts only those. A line with nothing to say is left out, and when the run journals cannot
be read the dialog has no forecast. The person chooses the Run mode of this one run with **Start: Fastest**,
**Start: Budget-aware** or **Start: Start window**; the default mode of Settings ends with "(default)". **Cancel** is the
default button, so Enter or Escape alone start nothing. The dialog is on a window of the Project's Machine, the Machine
that runs the Session: the focused window, else one on screen, else a minimised or hidden one brought back first. A
Linked machine's window gets no dialog and cannot confirm. Without an answer in 10 minutes the dialog closes and the
agent gets "No one confirmed …"; Cancel is a refusal too. A start button starts the same run as the Autopilot button,
in the chosen mode, over the named Tickets when there are any. The Autopilot button and a command typed in a chat
always start in the default mode. When the asking Session is the Project's Orchestrator in its turn, the run starts once that turn
is over, and the agent gets "Autopilot starts after this turn". Without a dialog the tool refuses:

- a Session that runs unattended, such as the Orchestrator during a run: no one is there to confirm;
- a Session worfy cannot find;
- a Project with a run under way: "Autopilot is already running Epic X. Stop it first.", and the journal gets nothing;
- a Project whose start from a chat waits for the Orchestrator's turn to end;
- an Epic or a Ticket the Project does not have, or a workflow that cannot be read;
- a second call while a dialog of the same Project waits;
- a Machine with no worfy window open: a box without a window would block worfy on macOS.

#### During a run

The line above the button shows the state of the run:

| Status line | Meaning |
|---|---|
| `starting` | The run has begun and no Wave has gone yet. |
| `Wave 2 · running` | The run has sent its second Wave. Waves are counted per run from 1, this is not the Wave number of the Epic's plan. |
| `Wave 2 · 4 background tasks` | The same, with four live background tasks of the Orchestrator. |
| `waiting for limits · resumes 14:20` | The Limits refused a turn. The run continues at this time. |
| `today's share used · resumes 00:00` | The budget stopped the next Wave. |
| `5-hour limits full · resumes 02:12` | The budget stopped the next Wave: today's share is left, the 5-hour window is full. |
| `outside start window · resumes 23:00` | The Run mode is Start window and the window is not open. The run continues when it opens. |
| `wave too long for window · resumes 23:00` | The Run mode is Start window: the next Wave usually takes longer than what is left of the window. |
| `stopping · 2 tickets in work` | A Stop came. Two Tickets of the current Wave are in work. Without any it says `stopping`. |
| `stopped: no ready wave` | The run is over, with its reason (see below). |

While a run goes on:

- The Orchestrator is **unattended**. It runs in the `bypassPermissions` mode, whatever mode the Node saved. A change of
  its permission mode is refused. When the run ends, the Node gets its own settings back.
- A permission request, a question with answer options and a Card's `session.ask` are refused at once, because no one is
  there to answer. Each refusal goes to the journal. When Claude Code gave a reason for a permission request, the model
  gets that reason so it can change the command.
- "Run wave" and "Process gate queue" by hand and "New conversation" of the Orchestrator are refused.
- A person can still write to the Orchestrator. What a person does on its Session through worfy goes to the journal as
  `human-input`: a message, a Card's message, Interrupt, "Send queued", removing a queued message, a change of settings,
  also one that was refused. A refused "Run wave", "Process gate queue" or "New conversation" writes no line, and neither do
  actions in other Sessions.
- Interrupting a turn of the Wave ends the run with the reason `interrupted`.
- The Session uses only the Browser profiles marked "Available to Autopilot", must name a Ticket of the Epic when it opens
  a Browser, and never signs in. The [Browser page](browser.md) covers this.
- worfy asks the system to keep the display on, from the start of the run to its end, also during the waits below.
- With Linked machines, a chip "on <Machine>" under the button says which Machine runs it. A Linked machine with full
  access can start and stop the run. With read-only access it sees the state and its buttons are inactive. The run always
  executes on the Machine of the Project.
- When the Harness in `main` of worfy's own repository has changes that this build does not have, the chip "Harness in
  main is newer than the Stable copy" stands under the button, with or without a run. The run goes on as it is.

#### When a Wave is over

A Wave is over when all of this is true:

1. A turn of the Wave ended without an error and without an interrupt.
2. The Session is idle and has no live background task.
3. In a fresh read of the workflow no Ticket of the Wave is in work (`claimed`).

The run then computes the ready Wave again. If it is the same set of Tickets as the Wave just finished, the run stops
with `no-progress`. A Ticket of the Wave that is still open after the turn does not hold the Wave.

A Ticket still in work after the turn makes the run wait up to 10 minutes. Each change of the workflow checks again, and a
new turn of the Orchestrator waits for its own result. After that the run stops with `wave-unfinished`.

Live background tasks make the run wait up to one hour without any event from them. Each event of a task starts this time
over. After the last task ends, the run waits up to 2 minutes for the turn its task-notification starts, then judges the
Wave without that turn.

Every Wave after the run's first goes to a new SDK session of the Orchestrator, so the context does not grow from Wave to
Wave. Its first prompt also tells the Orchestrator to run `wave-brief <epic>`. The Wave stays in the current session when the
Orchestrator is not free (a turn, a live task or a queued message), when the wait for a last turn ran out, and with the old
Harness, which has no `wave-brief`.

#### Waiting for the Limits

When the Limits refuse a turn of the Wave, the Wave does not end. The run waits until the refused window resets, plus
2 minutes. If no reset time is known, it tries again every 30 minutes. If the wait would pass 24 hours from the first
refusal, the run stops with `limits-timeout`.

When the time comes, the Orchestrator gets one message: continue from where it stopped, and first add an entry about the
pause to HANDOFF. worfy does not write that entry itself.

#### The budget of the Limits

The budget keeps Autopilot from using the whole week before the owner gets to work by hand. It is in Settings → Autopilot
and is off by default:

- **Daily budget of the Limits** turns it on. The Pro preset in Settings → Plan turns it on too.
- **Reserve for your own work** is the share of the week Autopilot leaves, from 0 to 50 %, by default 15 %.

These settings belong to the Machine. They are read before each Wave and never cut a Wave in work. When the budget stops the
next Wave, the run is `waiting` until the time in the status line, and then the check runs again. The Wave does not start
when:

- nothing is left of today's share, or less than the estimate of the Wave once something of today is used. The run
  continues at the start of the next local day, or at the 7-day reset when that comes first;
- today's share is left but the 5-hour window is full. The run continues at the 5-hour reset, or at the start of the next
  day when that comes first.

The first Wave of a day goes whenever the day has a share, so a Wave estimated above the whole share does not wait forever.
A 7-day number that is unknown or older than 30 minutes stops nothing. A refusal by the Limits inside a Wave remains the
hard limit.

#### The Run mode

Every run goes in a Run mode, fixed when it starts. A start takes the default mode of Settings → Autopilot (**Default run
mode**), unless the person chose another one in the dialog of `autopilot_start`. The mode acts only before a Wave, never
inside one:

- **Fastest**: the next Wave goes at once. Neither the budget nor the Start window is checked.
- **Budget-aware**: the budget above, with its reserve, whether **Daily budget of the Limits** is on or off.
- **Start window**: a new Wave starts only inside the window of local time (**Start window from** and **to**, 23:00–07:00 by
  default). It also does not start when the 90th percentile of the last Waves' durations would end it after the window. With
  fewer than 5 past Waves there is no such number, the Wave goes, and the tooltip says it went without that check. After
  the window, the budget is checked too, when **Daily budget of the Limits** is on.

When the Waves usually take longer than the whole window, no night would let the next one start: the run stops at
once with `window-too-short` instead of waiting. The window and the budget are read again before each Wave. The mode stays the same for the whole run. Outside the window
the run waits as it does for the budget: it is `waiting` until the window opens, keeps the display on, and checks
again then. A Stop during that wait ends the run at once. A Wave that started inside the window runs to its end, also
after the window has closed.

#### Stopping

**Stop autopilot** is graceful: the run sends no new Wave. A click before "Run wave" is sent keeps that Wave from going. A click
while "Run wave" is on its way does not: the Wave goes out, and the stop message follows it, unless the Wave still waits in the
Session's queue (the first case below).

- With no Wave in work, the run ends at once with `user-stop`. This covers the time before the first Wave, a Wave still
  waiting in the Session's queue (it is taken out), a run waiting for the budget, and a run waiting for Tickets to leave work
  after the turn.
- During a turn of the Wave or its background tasks, the button says **Stopping…** and takes no click. The Orchestrator gets
  a message: take no new Tickets, finish the ones in work, then end the turn. The run ends with the first turn end that leaves
  the Session idle with no live task. It does not wait for the Ticket files and does not check that the Orchestrator obeyed,
  so a Ticket may still be `claimed` after it.
- During a wait for the Limits, the same message goes together with the continuation, at the reset. Until then the run stays
  `waiting`.

**Force stop** is the one item of the "⋯" menu right of the button, also while a graceful Stop goes on. It does not wait. It
interrupts the turn (up to 15 seconds), closes the Claude Code process and with it every background task, cancels any wait,
and gives the Orchestrator back to the person. Worktrees and branches stay. A message a person queued stays, held, in the
new Session's queue. The Wave and the stop message leave the queue.

The next run of the same Epic takes the Tickets interrupted by a Force stop into its first Wave, if they are still in work,
even when nothing else is ready. After a graceful Stop it takes none. A run that stops before its first Wave, for example
during the wait for the Start window, took none of those Tickets, so the next run still gets them. worfy keeps this list in memory only, so it does not
survive a restart of the app.

**Quitting the app** stops every run with `app-quit`. The quit waits up to 3 seconds for the run to write its end. The
Orchestrator is not started again, and background tasks end with the app.

#### After any other stop

The Orchestrator goes back to the person at once when nothing runs. If a turn or a background task is still alive, the status
already says `stopped`, but the Orchestrator stays unattended and the display stays on until they end, and a new start is
refused. The tasks may keep working during that time. After the last task the Orchestrator waits 30 seconds for the turn its
task-notification starts, then goes back.

#### Why a run stops

| Reason | Meaning |
|---|---|
| `no-ready-wave` | Nothing is ready, and no `blocked` or status-less Ticket has all its blockers done. A run that finished the Epic ends this way. |
| `tickets-done` | A run over named Tickets ended: every one of them is done in the checkout. Such a run takes only the ready Tickets of its list into each Wave. The button always runs the whole Epic, so a run it starts never ends this way. |
| `blocked-tickets` | Nothing open is ready, and some `blocked` or status-less Tickets have all their blockers done. In a run over named Tickets, only Tickets of the list count. |
| `no-progress` | The next ready Wave is the same set of Tickets as the one just finished. |
| `wave-unfinished` | A Ticket of the Wave stayed in work past the 10 minutes after the turn. |
| `background-stalled` | Background tasks gave no event for an hour. |
| `limits-timeout` | The wait for the Limits would pass 24 hours. |
| `window-too-short` | The Run mode is Start window, and the next Wave usually takes longer than the whole window. The tooltip names the Wave, its usual duration and the window. |
| `interrupted` | A turn of the Wave was interrupted, or a person's turn was, leaving the Wave held in the queue. |
| `turn-error` | A turn of the Wave ended with an error that is not a refusal by the Limits. |
| `session-error` | The Orchestrator's Session failed. |
| `session-closed` | The Orchestrator's Session closed. |
| `send-failed` | "Run wave" could not be sent. |
| `workflow-error` | The workflow could not be read when the run had to judge the Wave. |
| `user-stop` | Stop autopilot. |
| `user-force-stop` | Force stop. |
| `app-quit` | The app quit. |

The tooltip of the status line gives the error in words when there is one.

On a Machine with the role `serve` of the cross-machine gate, before stopping with `no-ready-wave` or `blocked-tickets` the
run sends the Orchestrator the "Process gate queue" template, once per run. It follows that turn as a Wave's and then stops
with the reason it had, even if the turn made a Ticket ready. A Stop before it skips it.

#### The journal

Each run writes a journal: one text file with one JSON object per line. It is the record of what happened: each Wave with the
text sent, Tickets left out, the changes of the Tickets' status, refused dialogs, a person's actions on the Session, waits,
background tasks and the reason of the stop.
The app has no screen for it, so read the file. An observer outside worfy may append a `human-input` line with `>>`, for a
touch that only the screen shows, such as a system dialog.

### How it works

**A run is a view over the workflow.** worfy writes no Ticket status: the agents do, through the `ticket` script
([ADR-0002](../adr/0002-worfy-is-a-view-over-the-workflow.md)). The end of a Wave comes as no event, so the run works it out from
the events of the Orchestrator's Session and fresh reads of the workflow
([ADR-0024](../adr/0024-autopilot-wave-end-and-keep-awake.md)). The run sends the text of the same template as "Run wave" and knows
no protocol of the skill. The stop message is a request and not a protocol.

**The cycle.** A pure function takes the state of a run and one event and answers the next state and a list of effects. The
phases are:

| Phase | Meaning |
|---|---|
| `starting` | Nothing is sent yet. |
| `sending` | "Run wave" is on its way, or the run waits for the budget before sending it. |
| `turn` | The Wave is sent and a turn runs. |
| `tasks` | The turn ended with background tasks alive. |
| `settling` | The turn ended with Tickets of the Wave still in work. |
| `stopped` | The run is over. |

Every step of a run goes through one queue per run, so events are handled in order, and a click on Stop is noted before its
step waits in that queue. A step under way reads that note right before it sends "Run wave", so a click until then keeps the Wave
from going. A later click cannot take the send back: the cycle notes the stop in phase `sending`, and the stop message follows the Wave.

**Which turn is the Wave's.** A Wave may wait in the Session's queue behind a person's message. Only the turn that started with
the Wave's prompt, or a later one, can end the Wave. The result of an earlier turn cannot.

**Background tasks.** The `/epic-wave` skill starts implementers in the background and ends its turn while the Tickets are still
open, so a turn end alone says nothing. Their task-notifications start new turns of the same Wave
([ADR-0029](../adr/0029-autopilot-waits-for-background-tasks.md)).

**The Wave names its Tickets.** The run's text names the Tickets of one read of the workflow, and the journal has exactly what
went, because a Wave number from the plan once sent the Orchestrator a closed Wave
([ADR-0033](../adr/0033-autopilot-names-wave-tickets.md)).

**Unattended.** In any mode other than `bypassPermissions` Claude Code would ask before a tool and no one would answer. So a
change of mode is refused and not applied, and the launch is not saved with the Node
([ADR-0022](../adr/0022-unattended-session-refuses-permission-mode-change.md)). Claude Code still asks for a few of its own checks
in that mode, which is why refusals exist at all.

**Two stops.** The graceful Stop does not leave an implementer in the middle of a merge
([ADR-0051](../adr/0051-autopilot-graceful-stop-force-stop-in-menu.md)). Force stop is the last resort: closing the process is what
ends the background tasks ([ADR-0050](../adr/0050-autopilot-user-stop-interrupts-orchestrator.md)). A new process starts only after
the old one has exited, killed past a limit, so two processes never continue one SDK session
([ADR-0064](../adr/0064-orchestrator-relaunch-waits-for-old-process-exit.md)).

**The wait goes by the wall clock.** The timer of a wait checks the time at least once a minute instead of using one long timeout,
so a Machine that slept does not continue late by the time it slept.

**What counts as a refusal.** A turn that ended with an error is refused by the Limits when the Session reported `rejected` during
that turn, or when its error text is about the Limits. Claude Code reports the status only when it changes, so an old `rejected`
does not turn a later error of another kind into a refusal.

**The budget.** All of it is computed from the 7-day window:

- Today's share = (1 − reserve − the 7-day share at the start of the day) / the days until the 7-day reset, today included.
- Used today = the 7-day share now − the 7-day share at the start of the day.
- The start of the day is the first number of today in the Project's journals, for the same 7-day window. So the share stays the
  same all day, and a reset of the window starts it anew. What was used by hand before the first Wave of the day is therefore not
  counted as today's.

**The estimate.** A Wave's sample is the growth of the 7-day share between its `wave-started` and `wave-finished` lines, divided by
its Tickets. The estimate is the median of the last 10 samples and needs at least 3. A Wave with a number older than 30 minutes at
either end, or with a window reset inside it, gives no sample. The numbers are shares of the week, without prices. Before these two
lines the run asks the usage once when its number is older than 5 minutes, which costs no model tokens.

**One run per Epic and repository.** One repository on two Machines is two Projects, so a run is keyed by the Epic and the normalized
address of remote `origin` ([ADR-0053](../adr/0053-several-screens-on-one-project.md)). A start counts itself among this Machine's
runs before it asks. So while both Machines answer, two starts of one key at once may both be refused, but do not both go. A Machine that
is not connected, or gives no answer within 3 seconds, counts as `unasked`, and then both runs can go. The question goes whether or not
access for Linked machines is on: the answer carries only the Epic and the key of each run.

**worfy on itself.** The agents of a Wave over worfy rebuild the app, so a development build refuses a run there. The Harness in a
running build does not change during a run. worfy only shows that it is behind, and the Stable copy is rebuilt between runs
([ADR-0047](../adr/0047-harness-lessons-by-pr-early-owner-switch.md)).

**The display.** The run asks the system, through a power save blocker, to keep the display on and not only the system: the agents' e2e
tests need a window ([ADR-0034](../adr/0034-autopilot-keeps-display-awake.md)). worfy changes no system setting.

**The narrow fix round.** The `/epic-wave` skill writes its verdicts as `NARROW: …` comments on a Ticket's PR
([ADR-0046](../adr/0046-autopilot-narrow-round-without-owner.md)). The run only copies them to the journal. It reads them through the
same PR tracker as the PR badges. The tracker limits `gh` for both together: one PR list per repository folder per minute, and one lookup per
5 minutes for a branch missing from that list. The badges poll only while a window has focus, so without focus the run's own read starts `gh`.

### Implementation

#### Modules

| Path | What it holds |
|---|---|
| `src/main/autopilot/run.ts` | The `Autopilot` class and one `Run`: start checks, events of the Session, effects of the cycle, stops, give-back. |
| `src/main/autopilot/chat-start.ts` | `ChatStarts.startFromChat`: the start from a chat, over the Epic or named Tickets; the refusal while a run goes on, and the start after the asking Orchestrator's turn. The command typed in a chat and the tool `autopilot_start` call it. |
| `src/shared/autopilot/chat-command.ts` | `parseChatCommand`: which typed messages are a command, with what Epic and Tickets; the toast of its answer. |
| `src/shared/workflow/wave-plan.ts` | `parseWavePlan`, `waveTickets`: the Waves table of an Epic's `spec.md`, and the Tickets of Wave N not done yet. |
| `src/main/ipc/agent.ts` | `agent.send`: a command does not reach the agent; it starts the run through `startFromChat` and answers what became of it. |
| `src/main/autopilot/chat-confirm.ts` | The tool `autopilot_start` behind the canvas server: the refusals without a dialog, the confirmation dialog on this Machine and its 10 minutes. |
| `src/shared/autopilot/cycle.ts` | The cycle: phases, events, effects, stop reasons and their time limits. Pure. |
| `src/main/ipc/autopilot.ts` | The IPC handlers, and `sharedAutopilot`, which wires the app's Projects, Orchestrators, Sessions, watch and journal to a run. |
| `src/shared/ipc/autopilot.ts` | The `autopilot` IPC channels, the state of a run and the text of the status line. |
| `src/main/actions/launch.ts` | `autopilotWave`, `autopilotRefusal`, `autopilotGateQueue`: the text from the template, sent to the Orchestrator. |
| `src/shared/actions/render-template.ts` | `runWaveState`: the verdict and the text, shared with the button. |
| `src/shared/workflow/waves.ts` | `readyWave`: the ready Wave and the Tickets left out. |
| `src/main/agent/orchestrator.ts` | `setUnattended`, `giveBackNow`, `newUnattendedSession`, and the refusals for a turn, tasks or a queue. |
| `src/main/agent/session-settings.ts` | The launch of a Session and the forced permission mode. |
| `src/main/agent/permissions.ts` | `unattendedCanUseTool`: the refusal of every request. |
| `src/main/agent/session.ts` | `halt` for Force stop, `refuseDialog`. |
| `src/main/autopilot/limits-wait.ts` | The wait for the Limits, the wall-clock timer, the continuation text. |
| `src/shared/autopilot/resume-at.ts` | When a run continues after a refusal. Pure. |
| `src/shared/autopilot/budget.ts` | The budget and its decision before a Wave. Pure. |
| `src/shared/autopilot/limits-estimate.ts` | The estimate of a Wave and the line of the tooltip. Pure. |
| `src/shared/autopilot/journal.ts` | The journal format, specified in the comment at its top, with parsing and writing of a line. Pure. |
| `src/main/autopilot/journal.ts` | The journal files: open, append, list, read. |
| `src/main/autopilot/power.ts` | `KeepAwake`, over Electron's `powerSaveBlocker`. |
| `src/main/autopilot/origin.ts` | The key of remote `origin`. |
| `src/main/link/autopilot-runs.ts` | The question about runs between Linked machines, two service messages of the link. |
| `src/main/autopilot/harness-drift.ts` | Whether the Harness in `main` is newer than this build's. Read-only: no `git fetch`. Packaged builds only. |
| `src/main/mcp/browser-server.ts` | What a Session in Autopilot may do with a Browser. |
| `src/main/ipc/card-api.ts` | The refusal of a Card's `session.ask` to an unattended Session. |
| `src/renderer/canvas/actions/AutopilotAction.tsx` | The button, the "⋯" menu, the status line and the chips. |
| `src/renderer/settings/AutopilotSection.tsx` | Settings → Autopilot. |
| `src/shared/settings/app-settings.ts` | `autopilotBudget` and its defaults. |
| `scripts/install-stable.mjs` | `pnpm install:stable`: the Stable copy. |

#### Data flow

1. The button calls `autopilot.start`. `Autopilot.start` runs the checks in order: the Project has no run, the self-project refusal
   and the template, the workflow and the Epic, then the origin key and the question to the Linked machines.
2. `setUnattended` starts the Orchestrator's Session again unattended, continuing its SDK session, or refuses. Then the run opens the
   journal (`run-started`), starts keep-awake, subscribes to the Session's events and opens a workflow watch that reports changes of
   Tickets' fields only.
3. The `start` event goes to the cycle. Its `send-wave` effect runs `sendWave` in the run: it asks the usage, checks the budget, starts
   a new SDK session for a Wave after the first, and calls `autopilotWave`. The launcher reads the workflow once and takes the text,
   the Tickets and the skipped Tickets from that read. It sends the text through the Session, which starts a turn or queues it, and
   binds the Session to the Epic.
4. Events of the Session (`prompt`, `result`, `state`, `background_tasks`, `refused_dialog`) and workflow changes become cycle events,
   each with a fresh read of the workflow where the cycle needs one. Each effect goes to the journal or to the Session.
5. `end` writes `run-stopped`, takes the run's messages out of the queue, and gives the Orchestrator back through `setUnattended`. With
   a turn or a task alive that waits until they end, and `linger` follows it for the journal. A Force stop goes through
   `interruptAndGiveBack` instead.
6. Every new state goes to every window as `autopilot.changed`. A client keeps the state with the highest revision.

The other channels are `autopilot.stop`, `autopilot.forceStop`, `autopilot.state` and `autopilot.estimate`. Asking the state also asks
again, at most once a minute, whether the Harness is behind.

#### The journal file

The file is `<data folder>/autopilot/<run>.jsonl`, one per run, with no rotation. On macOS the data folder of a packaged app is
`~/Library/Application Support/worfy`, of a development build `~/Library/Application Support/worfy-dev`, and `WORFY_DATA_DIR` overrides
both. Nothing is written outside it ([ADR-0005](../adr/0005-worfy-own-state-inventory.md)). The run id is the start time in UTC and six
hex digits, so file names sort by start time. Each line has `at`, `run`, `project`, `epic` and `kind`. A reader skips and counts a line
it cannot read.

| Kind | Written when |
|---|---|
| `run-started` | The run began. Has `origin`, and `override` or `unasked` when they apply. `by` says who started it: `button`, `command` or `tool`. `tickets` names the Tickets of a run over named Tickets. `mode` is the Run mode: `fastest`, `budget-aware` or `start-window`. |
| `harness-behind` | The Harness in `main` is newer: after `run-started`, and before a `wave-started` when the count changed. |
| `forecast` | The Epic forecast at the start, once, after `run-started` and `harness-behind`, before the first `wave-started`: the Run mode, the Waves and Tickets left, the samples, `low` and `high` (p10 and p90 of the share of the week, `null` under 5 samples), `fit` (how many Waves fit before the 7-day reset with the reserve; only when the Run has a recommendation, in Budget-aware or in Start window with the budget on, else `null`), `week` (the 7-day number at the start), the p90 of a Wave's duration with its sample count, and `window` in Start window. Journals that cannot be read give `samples: 0`; the run goes on. |
| `wave-started`, `wave-finished` | A Wave went or ended. `wave-started` has the text sent, the skipped Tickets and `session`, the id of the Orchestrator's SDK session the Wave went to (its transcript's name). Both may have `limits`. |
| `ticket-status` | The `Status:` of a Ticket of the run's Epic changed during the run, seen on a change the workflow watch reports or in a last read right before `run-stopped` (not on a Force stop). A Ticket whose file appeared during the run gets the status it was first seen with. Has `state` (`claimed`, `blocked`, `done`, `open`), and `statusAt`, `reason` and `waits` when the Ticket has those lines ([ADR-0092](../adr/0092-run-history.md)). |
| `narrow-round` | A state of the narrow fix round on a Wave Ticket's PR, once per Ticket and outcome. |
| `start-window` | The Start window held the next Wave back: `reason` is `outside` or `wave-too-long`. `waiting-until` follows. |
| `budget-stop` | The budget stopped the next Wave. `waiting-until` follows. |
| `limits-hit` | The Limits refused a turn. |
| `waiting-until`, `resumed` | A wait began or ended. |
| `session-error` | A Session failed. |
| `refused-dialog` | An unattended Session refused a request. Has the Subagent and the reason when given, and never the command. The home folder is written as `~`. |
| `human-input` | A person stepped in. `source` is `worfy` or `observer`. |
| `background-tasks` | The set of live background tasks changed. |
| `run-stopping` | A graceful Stop came during a turn or tasks. |
| `gate-queue` | The run sent "Process gate queue". |
| `gate-queue-finished` | The turn of "Process gate queue" ended. `run-stopped` follows. |
| `run-stopped` | The run ended, with its reason. `tickets` for `blocked-tickets` and `user-force-stop`. `lastText` for a stop for want of a Wave. `actual` once a Wave has finished, on a Force stop and a quit too: the growth of the 7-day share over the run's Waves (`share`), the Waves finished (`waves`) and how many of them counted (`counted`; a Wave with a stale number or a week reset inside does not). |
| `orchestrator-returned` | The Orchestrator is a person's Session again, after a stop that had to wait, or after a Force stop. |
| `tasks-killed` | Tasks the run waited for ended with the process, on a quit or a Force stop. |

#### Windows

The Autopilot modules have no branch by platform. The differences are in what they rely on:

- `src/main/storage/paths.ts` gives the data folder `%APPDATA%\worfy`, and for a development build `%APPDATA%\worfy-dev`, so the journal
  is in `autopilot` under it.
- The Stable copy is the folder `%LOCALAPPDATA%\worfy-stable`, copied from `dist\win-unpacked`. The install script refuses a target
  inside the installer's folder `%LOCALAPPDATA%\Programs\worfy`.

Two things in the code shared by every platform matter on Windows. `refused-dialog` writes the home folder as `~` in every form of the path,
the drive and the MSYS forms included. The origin key of a run reads the drive letter of a Windows path as a host: `C:/repos/x.git` gives
`c/repos/x`. Only `remoteHasHost`, which the Project match key calls, takes a drive as a local path.

#### Tests

These tests call no model. The contract tests use the real Session registry, Orchestrators, launcher, journal and cycle over a fake
agent, which plays the scripts in `test/fixtures/agent-scripts/`. The tests check that the blocker is taken and released, over a fake or
a replaced `powerSaveBlocker`, and not what the display does.

| Test | Covers |
|---|---|
| `test/unit/autopilot-cycle.test.ts` | The cycle: when a Wave counts as finished and every reason to stop. |
| `test/unit/autopilot-run.test.ts` | A run over a scripted Session: which result ends a Wave, both stops, the narrow fix round, the gate queue, a new session per Wave, one run per Epic and origin. |
| `test/unit/autopilot-budget.test.ts` | The budget and its decision. |
| `test/unit/autopilot-limits-estimate.test.ts` | The estimate. |
| `test/unit/autopilot-resume-at.test.ts` | When a run continues after a refusal. |
| `test/unit/autopilot-journal.test.ts` | The journal format. |
| `test/unit/autopilot-origin.test.ts` | The origin key. |
| `test/unit/autopilot-power.test.ts` | Keep-awake. |
| `test/unit/canvas-actions.test.tsx` | The button, the status line and the "⋯" menu. |
| `test/unit/settings-autopilot.test.tsx` | Settings → Autopilot. |
| `test/unit/install-stable.test.ts` | The install script of the Stable copy. |
| `test/contract/autopilot.test.ts` | A whole run: unattended and back, refusals, `human-input`, the self-project refusal, the IPC channels. |
| `test/unit/autopilot-chat-command.test.ts` | The forms of the command typed in a chat, and the text that is no command. |
| `test/unit/wave-plan.test.ts` | Both shapes of the Waves table, ranges, done Tickets, and the refusals. |
| `test/contract/agent-send-autopilot.test.ts` | `agent.send` with a command: the start, the refusal while a run goes on, and what still reaches the agent. |
| `test/e2e/autopilot-chat.spec.ts` | The command typed in the Session view and in a Session Node: the toasts and the status line. |
| `test/contract/autopilot-background.test.ts` | Background tasks, and stops while they live. |
| `test/contract/autopilot-start-tool.test.ts` | The tool `autopilot_start`: the dialog, its 10 minutes, the window it is on, the refusals without it, the start after the Orchestrator's turn. |
| `test/contract/autopilot-limits.test.ts` | The wait for the Limits and the budget, with a clock the test moves. |
| `test/contract/autopilot-journal.test.ts` | The journal files, a line appended from outside, no write outside the data folder. |
| `test/contract/autopilot-wiring.test.ts` | The wiring of a new session per Wave in `sharedAutopilot`. |
| `test/e2e/autopilot.spec.ts` | The built app: a run, the wait for the Limits, the budget, background tasks, Force stop, the narrow fix round. |
| `test/e2e/linked-autopilot.spec.ts` | Two linked apps: the refusal, Start anyway, Stop pressed on two screens. |
| `test/e2e/browser-autopilot.spec.ts` | What the Session of a run may do with a Browser. |
