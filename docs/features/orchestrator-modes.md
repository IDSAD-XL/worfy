# Orchestrator modes

One Feature. The **Orchestrator modes** are three settings of a Project that change how its Orchestrator works: Eco
mode, Auto-approval and Auto-continue. They sit in one button under the Orchestrator's input field, "Modes". This page
covers the menu, the three items, the continuation of a manual turn of the Orchestrator after an API error or the
Limits, and the countdown in its chat. The Orchestrator itself is on [Sessions](sessions.md). What Auto-approval answers
in a run is on [Auto-approval](auto-approval.md), and how a run waits and retries is on
[Autopilot faults and recovery](autopilot-faults.md). New to the terms: start with [Concepts](concepts.md).

## Orchestrator modes

### Behaviour

#### The Modes menu

- The button stands under the Orchestrator's input field only; a regular Session has none. It always shows one icon per
  mode, in a fixed order — Eco mode, Auto-approval, then Auto-continue: bright when on, muted when off, an outline for
  Auto-approval Shadow, faint while the state is not known. Its width does not change with the states; only its caption
  goes first when the bar is short of room.
- A click, or Enter, Space or ArrowDown, opens the menu over it: Eco mode (on or off), Auto-approval with its three
  positions Off, Shadow and On, then Auto-continue (on or off), each with a line next to it and a tooltip. The arrows,
  Home and End move through the items, Enter and Space choose, Esc closes the menu back to the button, Tab closes it.
  Choosing an item does not close the menu: it shows the new state.
- An item whose state is still being read is unavailable with "Reading …" in its tooltip; one whose state could not be
  read is unavailable with the reason. A write that did not go through shows a toast with the reason, and the item reads
  the state again.

#### Eco mode

Eco mode writes two fields of the Project's Profile: `workflow.agents` set to `eco`, and `agents`, which is Sonnet with
effort medium for each agent role. Off removes both fields, and the models the roles had before are not restored. It
applies from the next Ticket. When the Profile changed outside worfy since the menu read it, nothing is written: a toast
says so and the item shows the Profile as it is now.

#### Auto-approval

- Auto-approval is Off for a Project until set. The mode is kept per Project in worfy's own settings on this Machine
  (`app-settings.json` in worfy's data folder), not in the Profile, and only the Modes menu writes it. worfy reads that
  file once at start: an edit of it made outside worfy shows after the next start, and the next change of any setting
  of the Machine writes worfy's own state back over it.
- While worfy runs with a debugging port or pipe (`--remote-debugging-port`, `--remote-debugging-pipe`) or the Node
  inspector (`--inspect`) open, Auto-approval is Off whatever is saved: any program on the Machine could script worfy's
  window then. The menu shows Off, its three positions are unavailable, and their tooltip names the reason and the saved
  mode, which applies again after a start without them. The saved mode cannot be changed from the menu meanwhile. The
  packaged worfy has the Electron fuses RunAsNode and EnableNodeCliInspectArguments off (`electronFuses` in
  `electron-builder.yml`): it ignores `--inspect` and its kin, `kill -USR1` opens no inspector (the signal ends worfy),
  and `ELECTRON_RUN_AS_NODE=1` starts worfy, not a Node. A development run (`pnpm dev`) is the stock Electron and keeps
  both.
- In an Autopilot run the mode decides the answer to a permission request: Off refuses it, Shadow refuses it and
  records what the approval policy would have done, On answers by the policy ([Auto-approval](auto-approval.md)).

#### Auto-continue

- Auto-continue is off for a Project until turned on. Its line in the menu reads "Retry after API errors and Limits", and
  its tooltip says what it does: after a temporary API error worfy sends the Orchestrator "continue" up to 5 times with
  growing pauses, after the Limits refuse it waits for the reset and continues, and it never resends the person's
  message or the Wave command.
- It is kept per Project in the same `app-settings.json`, and only the Modes menu writes it: on adds the Project's entry,
  off removes it, other Projects keep theirs. A change shows at once in the Modes menu of every window, on a Linked
  machine too. A debugging port does not hold it off.
- It acts on the Orchestrator only, in two places. An Autopilot run reads it before each retry after a temporary API
  error and when a wait for the Limits would pass 24 hours
  ([Autopilot faults and recovery](autopilot-faults.md#waiting-for-the-limits)). A turn of the Orchestrator outside a run
  is continued as the next section says. A regular Session is never continued.

#### Continuing a manual turn

- With Auto-continue on, a turn of the Orchestrator outside a run that ends with a temporary API error (500, 502, 503,
  504, 529, a lost connection, a timed-out request, a broken response stream) is continued the same way as in a run:
  after 1, 5, 15, 30 and 60 minutes (±20 %), five in a row at most, worfy sends the Orchestrator a new message that asks
  it to continue and names what the failed turn already did outside the Session — never the person's message again.
  A call that reaches outside and has no result (a `git push` cut off) is not retried. Each turn is judged by its own
  calls and its own Limits status, a turn a background task's notification starts too.
- A refusal by the Limits waits for the reset of the window the Vendor reported, plus 2 minutes, however far away;
  without a reset time it tries again every 30 minutes, for 24 hours at most. Then it sends the continuation a run sends
  after the Limits. On Codex the windows are read again first, as a run reads them (free, no model tokens): while one
  is still used up, nothing goes, and the wait goes on until that window's new reset. A turn the person interrupted is
  never continued.
- On a Codex Orchestrator the kind of the error is Codex's own: `serverOverloaded`, `internalServerError`, a connection
  or a response stream that failed, and `responseTooManyFailedAttempts` are temporary; any of them with HTTP status 429
  is not (Codex already spent its own retries on a rate limit). An error Codex retries by itself (its line ends with
  "It tries again") is left to Codex: worfy waits for nothing and sends nothing. A Subagent call of Codex
  (`collabAgentToolCall`) counts as a call that reaches outside: without its result the turn is not retried.
- Each step is a line of worfy's own in the transcript, below the row it tells of; the model does not get it:
  `worfy: API error 529, retry 2 of 5 at 14:20`, `worfy: sent "continue" (retry 2 of 5)`, ``worfy: not retried: `git
  push origin main` may or may not have run``, `worfy: not retried: gave up after 5 retries`, `worfy: waiting for the
  Limits, resumes 14:20` (without a reset time `…, no reset time reported, next try at 14:20`), `worfy: sent "continue"
  after the Limits wait`, `worfy: not continued: …` (a quota, or no reset time for 24 hours), `worfy: Auto-continue is
  off; nothing was sent` and `worfy: a turn is under way; nothing was sent, its end decides`. Times are local; a time on
  another day carries its date. These lines live only while the app runs: worfy does not write them into the transcript
  file, so after a restart they are gone.
- A message of the person during the wait takes the continuation's place; a message queued during the turn goes
  right after it, so no wait starts and no line about one shows. A turn under way when the time comes (a
  background task's notification) takes its place too, and its end decides. Auto-continue turned off, the Session closed
  or the app quit cancel the wait, and nothing is sent. While an Autopilot run owns the Orchestrator, only the run
  retries. Outside a run worfy does not keep the Mac awake for the wait: a Mac that sleeps through the time continues
  when it wakes. With Auto-continue off a turn outside a run stops on an API error or the Limits as before.

#### The countdown

- While the Orchestrator waits to be continued — by its Autopilot run when one waits, else after a manual turn — a line
  over its input field counts down by the second: `API error 529 (overloaded) · retry 2 of 5 in 4:12` with **Retry now**
  and **Cancel**, `Limits: 7-day window · resumes 14:20 (in 2:13:05)` or `Limits: no reset time reported · next try in
  27:40` with **Cancel** only. The window is named by the label the Vendor's window has (`5-hour`, `7-day`, Codex's
  own); the time is local, with its date on another day. A regular Session has no such line.
- Retry now sends the continuation of the same retry at once, and its timer sends nothing after it. Cancel ends the wait
  and nothing is sent, also when its time passes: a manual turn stays as it ended, with the line `worfy: the wait was
  cancelled; nothing was sent`; a run stops as it would have without Auto-continue
  ([Autopilot faults and recovery, Retry after an API error](autopilot-faults.md#retry-after-an-api-error)). The tooltip
  of Cancel says which: "Stop waiting: the run stops" or "Stop waiting: nothing is sent". A click that does not go
  through shows a toast with the reason.

#### On a Linked machine

- The Modes menu shows the modes of the Project on the Machine it lives on. With full access each item changes them
  there: Eco mode writes that Machine's Profile, Auto-approval and Auto-continue its `app-settings.json`; nothing is
  written on the Machine of the window. With read-only access the icons and the menu show the states, and each item is
  unavailable with the read-only hint; the Machine of the Project refuses such a write too. A change made on either
  Machine shows in an open menu on the other at once. A write whose answer did not come back shows a toast with the
  reason, and the item reads the state again; while that read fails, the item is unavailable with why.
- While worfy on the Machine of the window runs with a debugging port or the Node inspector open, Auto-approval there
  is unavailable with the reason, and only Off leaves that Machine; Eco mode and Auto-continue still change.
- The countdown shows the wait of the Project's Orchestrator on its Machine. On a read-only window its buttons show and
  do nothing.

### How it works

- **Modes of the Orchestrator, not of Autopilot.** Auto-continue acts on the turns a person started too, and Eco mode on
  any Ticket handed out, so the three live with the Orchestrator and the Start Autopilot window only shows them.
- **Where each mode is kept.** Eco mode is in the Profile, because the Harness reads it when it hands out a Ticket.
  Auto-approval and Auto-continue are worfy's own state on the Machine, in its data folder
  ([ADR-0005](../adr/0005-worfy-own-state-inventory.md)): only worfy acts on them, and the agent, which changes the
  Profile with an ordinary command, cannot turn them on ([ADR-0098](../adr/0098-approval-policy.md)).
- **A continuation, not a repeat.** The only way not to redo what the failed turn already did is to give the model its
  own history and ask it to go on, so the continuation is a new message in the same Session and the original message
  never goes again. It names what reached outside by worfy's own summary — the program, the subcommand and a short
  target such as a branch or a PR number — never by text the model wrote, which must not come back to the model as
  instructions.
- **One owner of a wait.** While a run owns the Orchestrator, the run alone retries and waits; the manual Auto-continue
  stays silent. The countdown asks for the run's wait first, then the manual one, and Retry now and Cancel go to
  whichever waits.
- **The wait goes by the wall clock**, as a run's does: a Mac that slept does not continue late by the time it slept.
  A manual wait does not keep the Mac awake, unlike a run
  ([ADR-0034](../adr/0034-autopilot-keeps-display-awake.md)).

### Implementation

#### Modules

| What | Where |
| ---- | ----- |
| The Modes button and menu | `src/renderer/session/composer/Modes.tsx` |
| Eco mode | `src/main/ipc/eco-mode.ts`, `src/shared/ipc/eco-mode.ts`, `src/shared/agent/plan-preset.ts`, `src/renderer/session/modes/eco-mode.ts` |
| Auto-approval | `src/main/ipc/auto-approve.ts`, `src/shared/ipc/auto-approve.ts`, `src/main/settings/store.ts`, `src/renderer/session/modes/auto-approval.ts` |
| Auto-continue, the setting and the wait's channels | `src/main/ipc/auto-continue.ts`, `src/shared/ipc/auto-continue.ts`, `src/main/settings/store.ts`, `src/shared/settings/app-settings.ts`, `src/renderer/session/modes/auto-continue.ts` |
| Continuing a manual turn | `src/main/agent/orchestrator-continue.ts`, wired in `src/main/agent/app-orchestrators.ts` |
| The plan of a retry and which error is temporary (shared with a run) | `src/shared/agent/continue-plan.ts`, `src/shared/agent/turn-failure.ts`, `src/main/autopilot/turn-retry.ts`, `src/main/autopilot/limits-wait.ts` |
| The countdown | `src/renderer/session/composer/ContinueCountdown.tsx` |

**Data flow.** The menu reads each mode on its channel (`ecoMode`, `autoApproval`, `autoContinue`) and writes the other
value on a click; main answers the state after the write and sends a change event to every client, the Linked machines
with access included. The continuation of a manual turn follows the events of each Project's Orchestrator Session; at
the end of a turn it asks the Limits first, then the kind of the error, and waits with the same parts a run uses. The
countdown reads `autoContinue.wait` and reads it again on `autoContinue.waitChanged` and on each change of the run's
state.

#### Tests

| Test | Covers |
|---|---|
| `test/unit/modes-menu.test.tsx` | The Modes button and menu: only on the Orchestrator, the icons in a fixed order and a fixed width, the keyboard, Eco mode, Auto-approval and Auto-continue items, their reads, writes, toasts and unavailable states. |
| `test/contract/auto-continue-setting.test.ts` | The setting in `app-settings.json` and the countdown's channels: the run's wait before a manual one, the window's label, Retry now and Cancel to whoever waits, read-only access. |
| `test/contract/orchestrator-continue.test.ts` | A manual turn: a 529 and one continuation with its lines, the switch off, a person's message during the wait, the switch turned off and the Session closed during it, a push without its result (also across a permission answered mid-turn), a turn the person interrupted, a message queued during the turn, a refusal by the Limits, two Projects, the app's wiring, an Autopilot run on the same Session, and the countdown's Retry now (one continuation, also after a double click and the timer) and Cancel (nothing sent, also when the timer fires). |
| `test/contract/app-orchestrators-continue.test.ts` | The app's wiring on Codex: the windows as last read and the free read of the Limits reach the manual continuation. |
| `test/contract/codex-auto-continue.test.ts` | Auto-continue on a Codex Orchestrator on the fake app-server, in a run and in a manual turn: `serverOverloaded` and one continuation, an error Codex retries by itself, a quota, a Subagent call without its result, and the windows read again at the reset (still used up, then open). |
| `test/unit/continue-countdown.test.tsx` | The three kinds of line and the format of the countdown. |
| `test/contract/modes-linked.test.ts` | The three modes from a Linked machine: full access writes on the Machine of the Project, read-only access is refused, a change shows on the other Machine, the link dropping or the access level changing in the middle of a write, both Machines writing at once, a debugging port on either Machine. |
| `test/contract/auto-approve-setting.test.ts` | The Auto-approval mode in `app-settings.json` (listed on [Auto-approval](auto-approval.md#tests)). |
| `test/e2e/auto-continue.spec.ts` | The countdown in the built app: the line after a 529, Retry now and Cancel. |
| `test/e2e/linked-modes.spec.ts` | The Modes menu in a window on a Linked machine, two built worfy: full access writes Eco mode and Auto-continue on the other Machine, a change there shows at once, read-only access only shows the states. |
