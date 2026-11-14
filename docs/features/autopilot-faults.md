# Autopilot faults and recovery

How an [Autopilot](autopilot.md) run waits for the Limits and retries after an API error, how it stops, what happens
after a stop, and the Fault scenarios that test the recovery. New to the terms: start with [Concepts](concepts.md).

## Waits, stops and recovery

### Behaviour

#### Waiting for the Limits

When the Limits refuse a turn of the Wave, the Wave does not end. The run waits until the refused window resets, plus
2 minutes: the window the refusal names, or else the latest refused window known to worfy. Nothing depends on the 5-hour
window: on a plan without it the run waits for the 7-day window. If no reset time is known, it tries again every 30
minutes. If the wait would pass 24 hours from the first refusal, the run stops with `limits-timeout`.

With Auto-continue on for the Project, a known reset more than 24 hours away does not stop the run: it waits until that
reset, for example 3 days for the 7-day window. While the continuation is more than 24 hours away, no turn runs and no
background task lives, the run releases keep-awake ([ADR-0097](../adr/0097-far-limits-wait-releases-keep-awake.md)): the
display may go dark and macOS may lock the screen, and the Mac may sleep. keep-awake comes back 24 hours before the
continuation, and as soon as a turn or a background task starts. A Mac asleep at the reset continues when it next wakes.
A locked screen stays locked: after the continuation, agents that need a window (e2e, `gate full`) wait for a person.
Auto-continue switched off during such a wait stops the run at once with `limits-timeout`, and Stop during it with no turn
running, or a Stop that came before the refusal, stops the run at once with `user-stop`. After the continuation, the 24 hours of 30-minute tries without a reset
time count from the next refusal. Those tries keep their 24-hour limit whatever the switch.

On a Codex Orchestrator the refusal is Codex's `usageLimitExceeded`. When a Codex window is used up and has a reset time,
the run waits for that reset, as above. When the time comes, worfy reads the Codex windows again: while one is still used
up, the run waits once more. When no window is used up, Codex has nothing to reset: the plan does not include Codex, or a
quota ran out. The run then stops at once with `vendor-quota`, and the tooltip shows Codex's error text. When worfy
knows no Codex window at the refusal and cannot read them either, it does not take that for a quota: the run waits as
for a window without a reset time and tries again every 30 minutes.

When the time comes, the Orchestrator gets one message: continue from where it stopped, and first add an entry about the
pause to HANDOFF. worfy does not write that entry itself.

#### Retry after an API error

With Auto-continue on for the Project (the Modes menu of the Orchestrator, see [Orchestrator modes](orchestrator-modes.md)), a turn that ends
with a temporary API error does not end the run. Temporary are a 500, 502, 503 or 504, a 529 (overloaded), a connection that dropped or
could not be made, a timeout and a broken response stream; a refusal by the Limits is not one, it waits as above. The run
waits 1, 5, 15, 30, then 60 minutes, each spread by up to 20 % either way, by the wall clock. Then the Orchestrator gets one
message: the previous turn ended with a temporary API error, continue from where you stopped, with the actions of that turn
that reached outside the Session (a commit, a push, a PR, an Agent) named. The message never says that nothing reached
outside: a script (`node <file>`, every Harness script) reads as local to worfy and may still push, merge or mark a Ticket
done, so it always asks the model to check what every command of that turn did before it repeats one. The Wave's command
and the original message never go again. A turn that ends without an error resets the count.

On a Codex Orchestrator the kind comes from Codex's own error kind: `serverOverloaded` waits as a 529 does; Codex's
`responseTooManyFailedAttempts` with HTTP status 429 is not temporary (Codex already spent its retries on a rate limit).
An error Codex retries by itself is left to Codex: no `turn-retry`, nothing sent. A Codex Subagent call
(`collabAgentToolCall`) without its result refuses the retry with `in-flight`, as an `Agent` call does.

The run does not retry, and stops with `turn-error` as before, after an error that is not temporary (`not-transient`),
when an action of the turn that reaches outside has no result (`in-flight`: a push or a merge may or may not have run),
and after the fifth retry in a row (`cap`; the message says "gave up after 5 retries"). The journal has `retry-refused`
with the reason first.

During the wait a turn of a background task or of a person holds the retry: the wait ends there (`resumed`), the status
line shows the run running, and that turn's end decides. Without an error the count starts over and no continuation goes;
with a temporary error again the next retry waits. A refusal by the Limits during the wait ends it too: the run waits for
the Limits alone. **Stop autopilot** during the wait, with no turn under way, ends the run at once with `user-stop`, also
when an earlier Stop already made the run stopping; Force stop, the end of the Session and the app's quit cancel the wait. Auto-continue switched off during the
wait is read when the time comes: the wait is dropped and the run stops with `turn-error`. With Auto-continue off a turn
with an API error stops the run with `turn-error`, as before.

The Orchestrator's chat shows the wait as a line over its input field that counts down by the second
([Orchestrator modes](orchestrator-modes.md#the-countdown)): `API error 529 (overloaded) · retry 2 of 5 in 4:12` with **Retry now** and **Cancel**, and for a
Limits wait `Limits: 7-day window · resumes 14:20 (in 2:13:05)` or `Limits: no reset time reported · next try in 27:40`
with **Cancel** only. Retry now sends the continuation of the same retry at once, in the run's order, as its timer would
(`resumed` in the journal); the timer and a second click send nothing more. Cancel ends the wait with nothing sent, and the
run stops as it would have without Auto-continue: with `turn-error` during a retry wait, with `limits-timeout` during a
Limits wait. A Cancel that comes after the continuation already went finds nothing to cancel, and the run goes on.

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
- During a wait to retry after an API error, with no turn under way, the run ends at once with `user-stop`, and the
  continuation does not go.

**Force stop** is in the "⋯" menu right of the button while this Epic's run goes on, also while a graceful Stop goes on. The
other item of that menu is **Run history**. Force stop does not wait. It
interrupts the turn (up to 15 seconds), closes the Claude Code process and with it every background task, cancels any wait,
and gives the Orchestrator back to the person. Worktrees and branches stay. A message a person queued stays, held, in the
new Session's queue. The Wave and the stop message leave the queue.

The next run of the same Epic takes the Tickets interrupted by a Force stop into its first Wave, if they are still in work
(claimed, or open with a worktree branch whose read failed, which may hold the claim), even when nothing else is ready. So it does after a run that stopped with `session-error` during a Wave: the implementers
died with the Orchestrator's process, and a Ticket one of them claimed stays `claimed`. The first Wave command of the next run
names it along with the ready Tickets, and the Orchestrator resumes it as a resumed Wave (the `epic-wave` skill, "How to
resume a wave"): by its branch, PR and result it carries the work on or hands the Ticket out again. worfy writes no
`Status:` of its own. After a graceful Stop it takes none, also when the Orchestrator's Session fails after that Stop. A run that stops before its first Wave, for example
during the wait for the Start window, took none of those Tickets, so the next run still gets them. worfy keeps this list in memory only, so it does not
survive a restart of the app.

**Quitting the app** stops every run with `app-quit`. The quit waits up to 3 seconds for the run to write its end. The
Orchestrator is not started again, and background tasks end with the app.

#### After any other stop

The Orchestrator goes back to the person at once. When nothing runs, it is started again attended. If a turn or a
background task is still alive, it is not started again, which would kill them: the same process goes on as the
person's Session, in the permission mode the Node keeps (on Codex from its next turn). The turn and the tasks keep
working there, their task-notification turns run in the person's Session, and their permission requests go to the
person. The journal gets `orchestrator-returned` at once, with the tasks still alive. The status says, for example,
`stopped: turn error · 2 background tasks still run`, and the display stays on until the turn and the tasks end. A
message Start now kept aside comes back to the person's queue, held. A new run during that time waits for the
Orchestrator (`orchestrator-busy`) like any run that finds it busy; Start now stops the tasks.

After **Stop autopilot**, should a turn or a background task still be alive, and after any stop whose give-back could
not change the Session (the agent refused the change of permission mode), the old way holds: the status already says
`stopped`, but the Orchestrator stays unattended and the display stays on until they end. The tasks may keep working
during that time. After the last task the Orchestrator waits 30 seconds for the turn its task-notification starts, then
goes back.

A new run may start during that wait, from the Autopilot button or from `autopilot_start`, unless a turn is still running.
It takes the same unattended Orchestrator over as it is. The Orchestrator is not started again, so its background tasks
keep running. They become the new run's tasks, and the old run's journal gets no more lines.

#### Why a run stops

| Reason | Meaning |
|---|---|
| `no-ready-wave` | Nothing is ready, and no `blocked` or status-less Ticket has all its blockers done. A run that finished the Epic ends this way. |
| `tickets-done` | A run over named Tickets ended: every one of them is done in the checkout. Such a run takes only the ready Tickets of its list into each Wave. The button always runs the whole Epic, so a run it starts never ends this way. |
| `blocked-tickets` | Nothing open is ready, and some `blocked` or status-less Tickets have all their blockers done. In a run over named Tickets, only Tickets of the list count. |
| `waits-owner` | A run over a queue of Epics reached its last Epic, and only Tickets for the owner are left in it (`blocked` with `Waits: owner`, no status, or blocked only by such Tickets). The line says `stopped: waits for owner`; `tickets` names them. A run of one Epic stops with `blocked-tickets` then. |
| `no-progress` | The next ready Wave is the same set of Tickets as the one just finished. |
| `wave-unfinished` | A Ticket of the Wave stayed in work past the 10 minutes after the turn. |
| `background-stalled` | Background tasks gave no event for an hour, and none of their output files changed in it. |
| `limits-timeout` | The wait for the Limits would pass 24 hours (with Auto-continue on, only when no reset time is known), Auto-continue was switched off during a wait for a reset more than 24 hours away, or the wait was cancelled with Cancel in the Orchestrator's chat. |
| `vendor-quota` | Codex refused a turn by its Limits, and no window is used up, so nothing will reset. Codex's error text is the message of the run's state (the status line's tooltip) and `message` of the `limits-hit` line. |
| `window-too-short` | The Run mode is Start window, and the next Wave usually takes longer than the whole window. The tooltip names the Wave, its usual duration and the window. |
| `interrupted` | A turn of the Wave was interrupted, or a person's turn was, leaving the Wave held in the queue. |
| `turn-error` | A turn of the Wave ended with an error that is not a refusal by the Limits, and was not retried (Auto-continue off, a `retry-refused`, or the retry wait cancelled with Cancel in the Orchestrator's chat). |
| `session-error` | The Orchestrator's Session failed, or, before a later Wave or the gate queue's turn, Codex no longer runs the Harness's hooks. |
| `session-closed` | The Orchestrator's Session closed. |
| `send-failed` | "Run wave" could not be sent. |
| `workflow-error` | The workflow could not be read when the run had to judge the Wave, including a `git worktree list` that failed twice in a row. |
| `user-stop` | Stop autopilot. |
| `user-force-stop` | Force stop. |
| `start-cancelled` | Cancel, Stop or Force stop while the run waited for the Orchestrator. |
| `start-refused` | A check refused when the Orchestrator became free. The reason is in the journal's `message`. |
| `app-quit` | The app quit. |

The tooltip of the status line gives the error in words when there is one.

In a run over a queue of Epics, `no-ready-wave`, `blocked-tickets` and `tickets-done` may end only the Epic, and the run
goes on to the next one ([Autopilot, a run over a queue of Epics](autopilot.md#during-a-run)); the table names how
the run itself stopped.

After any stop, a toast says how the run ended, with **Open history**, and **History** stands right of the status line
until the next run starts. Both open the run in Run history, which the [Flight Recorder](flight-recorder.md) page describes.

On a Machine with the role `serve` of the cross-machine gate, before stopping with `no-ready-wave`, `blocked-tickets` or `waits-owner` the
run sends the Orchestrator the "Process gate queue" template, once per run. It follows that turn as a Wave's and then stops
with the reason it had, even if the turn made a Ticket ready. A Stop before it skips it.

### How it works

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

### Implementation

#### Modules

| Path | What it holds |
|---|---|
| `src/main/autopilot/limits-wait.ts` | The wait for the Limits, the wall-clock timer, the continuation text. |
| `src/main/autopilot/turn-retry.ts` | The retry after a temporary API error: the count, the timer, the continuation. The pauses, the refusals and the text are `src/shared/agent/continue-plan.ts`, which error is temporary `src/shared/agent/turn-failure.ts`. |
| `src/shared/autopilot/resume-at.ts` | When a run continues after a refusal. Pure. |

#### Tests

These tests call no model. The contract tests use the real Session registry, Orchestrators, launcher, journal and cycle over a fake
agent, which plays the scripts in `test/fixtures/agent-scripts/`.

| Test | Covers |
|---|---|
| `test/unit/autopilot-resume-at.test.ts` | When a run continues after a refusal. |
| `test/unit/turn-failure.test.ts` | Which failed turn is a temporary API error: the error texts of Claude Code, the Codex error kinds with and without the HTTP status (429 is not temporary), an interrupted turn. |
| `test/unit/continue-plan.test.ts` | The plan of a retry: the pauses and the cap, the order of the refusals (`not-transient`, then `in-flight`, then `cap`), which calls of a turn reach outside, and the continuation text, which never carries the original message or the model's own words. |
| `test/unit/limits-wait-still-refused.test.ts` | The windows read again before a continuation after the Limits on Codex: one still used up waits again, a read that fails leaves the known windows to decide, Force stop and the quit do not wait for the read. |
| `test/contract/autopilot-limits.test.ts` | The wait for the Limits and the budget, with a clock the test moves. |
| `test/contract/autopilot-limits-switch.test.ts` | The wait for the Limits with Auto-continue off and on: the 7-day window without the 5-hour one, a reset in 3 days with keep-awake released and taken again, no reset time, the switch turned off during the wait. |
| `test/contract/autopilot-retry.test.ts` | The retry after an API error with Auto-continue off and on: a 500 and one continuation, 529 until `cap` with the pauses of the plan, a 400, a push without its result and the secrets of its command, the Limits (also during the wait), a background task's turn, Stop (also a second one while stopping), Force stop, the quit and the switch turned off during the wait; the countdown's Retry now (one continuation, also after a double click and the timer) and Cancel (`turn-error`, `limits-timeout`, nothing sent; a Cancel queued behind the continuation finds nothing and the run goes on). |
| `test/contract/codex-auto-continue.test.ts` | Auto-continue on a Codex Orchestrator on the fake app-server, in a run and in a manual turn: `serverOverloaded` and one continuation, an error Codex retries by itself, `vendor-quota`, a Subagent call without its result (`in-flight`), and the windows read again at the reset of a manual Limits wait. |
| `test/unit/autopilot-invariants.test.ts` | The recovery rules over the journals of `test/fixtures/autopilot-faults/`: a good run breaks none, and each rule catches a broken copy made for it. |
| `test/contract/autopilot-faults-api.test.ts` | Fault scenarios of the model API: an API 500, a 529 in the middle of a streamed answer (not taken for the Limits) and a dropped connection stop the run with `turn-error`, and a new start sends its Wave command once; Limits that refuse the turn of Wave 2 make the run wait and resume after the reset with one continuation, and Wave 1 does not go again. |
| `test/contract/autopilot-faults-retry.test.ts` | The same Fault scenarios of the model API with Auto-continue on: an API 500, a 529 in the middle of a streamed answer and a dropped connection give `turn-retry`, one continuation and `resumed`, and the run goes on; five 529 in a row end with `retry-refused` `cap`, and a `git push` without its result with `retry-refused` `in-flight`, both then `turn-error`; Limits that refuse the turn of Wave 2 by the 7-day window, with no 5-hour one, make the run wait for that reset. The rules I1–I8 below hold in each. |
| `test/contract/autopilot-faults-process.test.ts` | Fault scenarios of the processes: Claude Code of the Orchestrator dies while both implementers work (`session-error`, and a new start goes to a new Session, its first Wave naming the Ticket still `claimed` by the dead implementer along with the ready one); an implementer fails and its Ticket stays `claimed` (`wave-unfinished`) or goes back to `open` (the next Wave holds only that Ticket). |
| `test/contract/autopilot-faults-github.test.ts` | Fault scenarios on the GitHub side: the gh stub's `hang` mode; gh hangs for the whole run (the Waves go on, and the stop waits no longer than the limit of the last read); gh answers 502 (the next read comes after the doubled interval); a merge conflict (the run stops with `blocked-tickets`, and a new run does not take the blocked Ticket). |
| `test/contract/autopilot-faults-codex.test.ts` | Fault scenarios on a Codex Orchestrator: a failed turn stops the run with `turn-error`; an app-server that exits in the middle of a Wave gives `session-error`, and a new run starts in a new Session. |
| `test/e2e/autopilot-faults.spec.ts` | Fault scenarios in the built app: the app killed with SIGKILL in the middle of a Wave and started again (nothing goes to the Orchestrator at the start, Run history shows the old run cut off, the button starts a new run that sends its Wave once); GitHub out of reach for the whole run (both Waves go through, and `gh` was only read). |

**Fault scenarios.** A fault scenario is a test that injects one fault into a run on the fake agent over a temporary Project — a
model API error, a dead process, a `gh` that hangs or fails, a merge conflict, an app killed in the middle of a Wave — and then checks the
recovery rules. `checkRecovery` in `test/autopilot-invariants.ts` takes what the run left behind: the journal files, the messages the
Orchestrator got, the `gh` calls, the `Status:` changes the test wrote for the Orchestrator, and the Project's files before and after. It
returns one line per violation, and every scenario expects none. The rules:

- **I1.** Each `wave-started` has exactly one `/epic-wave` command that names its Tickets, and there are as many Waves as the scenario
  expects.
- **I2.** Every `gh` call is a read: `pr list`, `auth status`, `auth token`, or `api` on a repository without an option that writes.
- **I3.** For each Ticket, the run's `ticket-status` lines are the changes of its `Status:` during the run, in order. After a Force stop,
  a quit, or in a run without `run-stopped` (as after a killed app) the latest changes may be missing, never earlier ones.
- **I4.** The scenario's run has one `run-stopped` with the expected reason, after the line that reason needs (for example `session-error`
  before `turn-error`). A killed app leaves no `run-stopped`. A run that outlived the fault has a `resumed` line.
- **I5.** No person stepped in: no `human-input` and no `refused-dialog` line.
- **I6.** The new start after the stop is not refused and begins a journal of its own with `run-started`.
- **I7.** worfy writes nothing into the Project: every file that differs afterwards is one the test wrote.
- **I8.** Every line of every journal reads. A killed app may leave one torn last line.

The contract scenarios build their run with `faultRun()` of `test/contract/autopilot-faults-setup.ts`: the real Session registry,
Orchestrators, launcher, journal, `LimitsTracker`, `PrTracker` and `Autopilot`, a clock that moves only when the test moves it, and the gh
stub of `test/contract/gh-world.ts`. The e2e scenarios prepare their Project, data folder and gh stub with `test/e2e/autopilot-world.ts`.
