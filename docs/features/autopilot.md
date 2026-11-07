# Autopilot

Autopilot runs the Waves of one Epic one after another, with no person at the Orchestrator. It sends a Wave, waits
until the Wave is over, sends the next ready Wave, and stops when no Wave is ready or something goes wrong. One such
pass over an Epic is a **run**. New to the terms: start with [Concepts](concepts.md).

## Autopilot

### Behaviour

#### Starting a run

The frame of an Epic on the Canvas has an **Autopilot** button. The button is hidden only when every Ticket of the Epic is
done and the Epic has no run going on, no status line of a past run, no stop on its way and no "running on <Machine>"
refusal. So after a finished run it stays, inactive, until the app restarts or the Project runs another Epic. A frame
without the button still has the "⋯" menu, with **Run history** only, when the Epic has past runs. The button is active
when "Run wave" could run now and the Project's "Run wave" template names the Wave's Tickets with `{tickets}`. Its tooltip
says what it does, that the display stays on until the run ends, the Run mode the button starts in (the default of
Settings → Autopilot), and the Epic forecast of what is left of the Epic. [Run planning](run-planning.md) gives these
lines.

A click on the button does not start the run: it opens the **Start Autopilot** window inside worfy
(`src/renderer/autopilot/StartAutopilotModal.tsx`). The window shows the Project, the Epic, its Tickets and Waves left,
the Vendor and Session of the Orchestrator, the forecast against the budget, the Limits now, and the Modes (Eco mode,
Auto-approval, Auto-continue) with a "change in Modes" link to the Orchestrator's Modes menu. Main reads these facts on
the channel `autopilot.prepare`, from the same sources and with the same forecast lines as the `autopilot_start` dialog.
Below them the person picks the Run mode: Fastest, Budget-aware or Start window, the default of Settings → Autopilot
marked "(default)" and chosen. The focus is on **Cancel**, Esc is Cancel, ⌘↩ (Ctrl+Enter on Windows) is the main
button. The main button is **Start Autopilot**, or **Start when free** while the Orchestrator is busy: the window then
says what keeps it busy. The window closes once main answers; a refusal is the toast and the button's tooltip, as
below. **Start anyway** starts at once, in the default mode, without the window.

**Run all accepted** in the Command palette, and in the "⋯" menu of an Epic frame while the Project has no run, opens
the same window over a queue: every Epic of the Project whose spec
the owner accepted and that has a ready Ticket, oldest acceptance first (at most 10). Its title counts the ticked Epics
and their Waves, `Start Autopilot · 3 Epics, 6 Waves`, and under it `3 Epics are accepted and waiting. Autopilot runs
them one after another.` Instead of the Epic and its Tickets the window lists the queue
(`src/renderer/autopilot/QueueList.tsx`): per Epic a tick, its place among the ticked, its name, its Waves left and
`accepted <date>`. Untick an Epic to drop it; drag a row, or press ⌥↑/⌥↓ (Alt+↑/↓ on Windows) on its grip, to move it.
Each change asks `autopilot.prepare` again for the ticked Epics in their order, so the forecast is theirs. With nothing
ticked the forecast says `No Epic is ticked` and the main button is inactive. The start goes with the ticked Epics in
the order of the list. With no accepted Epic that has a ready Ticket, a toast says `No accepted Epic has a ready Ticket`
and no window opens. On a read-only screen of a Linked machine the command is inactive.

A start is refused in these cases. The reason shows in the button's tooltip and in an error toast:

- The Project already has a run. A Project has at most one run at a time.
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

**While the Orchestrator is busy** — in a turn, with live background tasks, or with messages waiting in its queue — a
start is not refused. The run begins at once, its journal opens with `run-started` and `orchestrator-busy`, and the status line says
`waiting for the Orchestrator · 4 min`. The run sends its first Wave once the Orchestrator is free: the turn is over, the
queue is empty, no background task lives, and two minutes passed after the last task ended with no new turn. A message
sent during the wait makes it longer. Then the checks above run again: a refusal at this moment stops the run with
`start-refused` and the reason, in the journal and as a notice in the Session that asked from a chat. keep-awake starts
only with the real start. **Stop** (and Force stop) on a waiting run cancels it: `start-cancelled`, the Orchestrator
untouched. **Start now** (channel `autopilot.startNow`) does not wait: it stops the Orchestrator's turn and background
tasks, journals them as `tasks-killed` with the reason `start-now`, and starts the run at once. The checks above run
first, so Start now can also end the run with `start-refused`. The messages of the queue
are not sent to the run: they come back, held, to the person's Session after the run
([ADR-0099](../adr/0099-run-waits-for-orchestrator.md)).

On the Canvas the status line of a waiting run has **Start now** and **Cancel** beside it. **Cancel** cancels the run at
once, with no confirmation, as Stop does, and the toast says `Autopilot cancelled; the Orchestrator was not touched`.
**Start now** first opens a small window, **Start now?**
(`src/renderer/autopilot/StartNowModal.tsx`): `Autopilot <Epic> starts right away. This stops:`, then
`✕ the running turn` while a turn runs, `✕ 3 background tasks: <names>`, and `✓ 2 queued messages stay in the queue`. The
list follows what keeps the Orchestrator busy while the window is open, and the window closes by itself once the run no
longer waits. The focus is on **Cancel**, and Esc is Cancel: the run goes on waiting. The red **Interrupt and start**
calls `autopilot.startNow`. The toast then says what stopped, as the window listed it:
`Turn interrupted, 3 background tasks stopped · Autopilot started`. A `start-refused` at that moment is an error toast
with the reason.

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
- `/worfy:epic-wave epics A, B, C`: one run over a queue of Epics, in the order typed, comma-separated as the Tickets of
  `tickets` (1 to 10 Epics). A word that is no Epic name, an Epic named twice or more than 10 Epics is refused in words,
  and so is an Epic the Project does not have. A queue of one Epic is that Epic alone.
- `/worfy:epic-wave accepted`: a queue of every Epic of the Project whose spec the owner accepted and that has a ready
  Ticket, oldest acceptance first. No such Epic, or more than 10, is a refusal. `/worfy:epic-wave epic accepted` still
  names an Epic called `accepted`.

Any other text after `/worfy:epic-wave` goes to the agent as before, for example "resume after a session break", a word
that is no Epic of the Project, an argument such as `depth medium`, or a message with attachments. A toast says what
became of the command: "Autopilot started on Epic X" ("Autopilot started on a queue of 2 Epics: A, B" for a queue), or
the refusal. While a run of the Project goes on, the refusal is "Autopilot is already running Epic X. Stop it first, or
add Epics to its queue with "Add to queue…" in the ⋯ menu."; a command never adds an Epic to a running queue. A refused command writes no journal, and a running run does not
count it as a person stepping in. A message sent right after a command waits for its answer, so it reaches the run that
command started, and the run journals it as a person stepping in. Typed while the Orchestrator is busy, also in its own Session during its turn, the run
waits for it as described under "While the Orchestrator is busy", and the toast says "Autopilot waits for the Orchestrator and starts when it is free". The Waves Autopilot sends to the Orchestrator are never
read as a command.

**From a chat, by the agent.** When the user asks a Session in words to run an Epic, or some of its Tickets, on autopilot,
the agent calls the canvas tool `autopilot_start` with the Epic and, for named Tickets, their numbers. For several Epics
one after another it gives `epics` (1 to 10, each once) instead of `epic`; both fields, neither, an Epic named twice, or
`tickets` with more than one Epic is a form error before any ask. The ask then carries the queue (`epics` on
`autopilot.confirm.ask`, when it has more than one Epic). The window shows such a queue in the same list as **Run all
accepted**, in the order the Session asked, with ticks and grips: the person may untick Epics and reorder them, and the
forecast follows the ticked ones. With nothing ticked the start is inactive. The answer then carries the ticked Epics
in their order (`epics` on `autopilot.confirm.answer`), and the run starts over exactly those. Main takes that list
only when it is a part of the queue asked for: an empty list, an Epic named twice or an Epic the Session did not ask for
is refused, nothing starts, and the agent is told why. An answer without a list (an ask of one Epic) starts the queue as
asked. worfy asks the
user in the same **Start Autopilot** window as the button, in its "Agent asks" view: under the title it says
`Asked by Session "<first 8 characters of the Session id>" in a chat · answer within 9:59` and counts down 10 minutes;
the last minute is in the blocked colours. The facts, the Modes and the Run mode are as for the button, and the
person chooses the Run mode of this one run there. The focus is on **Cancel**, Esc is Cancel, ⌘↩ (Ctrl+Enter on
Windows) is **Start Autopilot**. [Run planning](run-planning.md) gives the forecast lines. The window opens on one
window of the Project's Machine, the Machine that runs the Session: the focused window, else one on screen, else a
minimised or hidden one brought back first. Main sends the ask on the channel `autopilot.confirm.ask` and takes the
answer `autopilot.confirm.answer` only from that window (`src/shared/ipc/autopilot-confirm.ts`). These channels are
closed to a Linked machine, so its screen gets no ask and cannot confirm. Without an answer in 10 minutes the window
says `time is up — the Session got "declined"`, its controls go inactive, it closes a few seconds later, and the agent
gets "No one confirmed …". Cancel, Esc and "change in Modes" are a refusal too; a window closed meanwhile answers that
no worfy window is open. Nothing guards the window against a click an agent makes in it. Main shows no native message
box for this tool any more. **Start Autopilot** starts the same run as the Autopilot button,
in the chosen mode, over the named Tickets when there are any. A command typed in a chat always starts in the default
mode. When the Orchestrator is busy, also when the asking Session is the Orchestrator in its turn, the run
waits for it as described under "While the Orchestrator is busy", and the agent gets "Autopilot waits for the Orchestrator and starts when it is free". Without an ask the tool refuses:

- a Session that runs unattended, such as the Orchestrator during a run: no one is there to confirm. The Orchestrator of a
  stopped run that still waits for its turn or background tasks is not refused: it gets the window;
- a Session worfy cannot find;
- a Project with a run under way: the same refusal as the command's, with the hint to stop it or use "Add to queue…"; the
  tool never adds an Epic to a running queue, and the journal gets nothing;
- an Epic (of the queue too) or a Ticket the Project does not have, or a workflow that cannot be read;
- a second call while an ask of the same Project waits;
- a Machine with no worfy window open;
- a Start Autopilot window already open for another start: the agent is told so.

**What is not a run.** "Run wave" on the Canvas or in the Command palette sends one Wave to the Orchestrator and starts
no run. So does a Wave that Claude Code runs in a terminal. Such a Wave has no journal, no status line, no stop toast and
no Run history.

#### During a run

The line above the button shows the state of the run:

| Status line | Meaning |
|---|---|
| `starting` | The run has begun and no Wave has gone yet. |
| `waiting for the Orchestrator · 4 min` | The run has begun and waits for the Orchestrator's turn, queue and background tasks to end. No minutes in the first minute. **Start now** and **Cancel** stand beside it. |
| `Wave 2 · running` | The run has sent its second Wave. Waves are counted per run from 1, this is not the Wave number of the Epic's plan. |
| `Wave 2 · 4 background tasks` | The same, with four live background tasks of the Orchestrator. |
| `waiting for limits · resumes 14:20` | The Limits refused a turn. The run continues at this time. |
| `API error · retry 2/5 · 14:20` | A turn ended with a temporary API error and Auto-continue is on: the second retry of five goes at this time. |
| `today's share used · resumes 00:00` | The budget stopped the next Wave. |
| `5-hour limits full · resumes 02:12` | The budget stopped the next Wave: today's share is left, the 5-hour window is full. |
| `outside start window · resumes 23:00` | The Run mode is Start window and the window is not open. The run continues when it opens. |
| `wave too long for window · resumes 23:00` | The Run mode is Start window: the next Wave usually takes longer than what is left of the window. |
| `stopping · 2 tickets in work` | A Stop came. Two Tickets of the current Wave are in work. Without any it says `stopping`. |
| `stopped: no ready wave` | The run is over, with its reason (see [Why a run stops](autopilot-faults.md#why-a-run-stops)). |
| `stopped: turn error · 2 background tasks still run` | The run is over and gave the Orchestrator back to a person at once; two of its background tasks still run there. |
| `Epic 2/3: checkout · Wave 1 · running` | A run over a queue of three Epics is on the second, `checkout`. Any line above gets this start when the queue holds more than one Epic, after the stop too. |

**A run over a queue of Epics.** The line stands on the frame of the Epic the run is on, and its tooltip lists the
queue: each Epic with its status (`done`, `running`, `next`, `skipped: waits for the owner`, `skipped: runs on another
Machine`). While the run goes on, the frame of every other Epic of the queue has a chip under its button: `In queue 3/3`
for one not started yet, `Waits for owner` for one the run passed because only the owner's Tickets were left, `Runs
elsewhere` for one it passed because another Machine ran it. A done Epic and the Epic the run is on have no chip.

The queue can change while the run goes on, from the "⋯" menu of an Epic frame: **Add to queue** on an Epic outside the
queue puts it at the end, **Remove from queue** on an Epic not started yet takes it out. Nothing reorders the queue.
Between Waves — while the run waits for its Orchestrator, for the budget or for the Start window — the change is made at
once. During a Wave it is made at the end of the Wave: the toast says `Added search to the queue · applies after this
Wave`, and until then the frame has the chip `Joins after this Wave` or `Leaves after this Wave`. **Remove from queue** on
an Epic that waits to join takes it back. A change made writes `queue-changed` to the journal, and each Epic removed
`epic-finished` with `removed`; it never starts. A change not yet made when the run stops is dropped. The items are not
there after a Stop was asked, and they are inactive on a read-only screen. A refusal (the queue already holds 10 Epics,
the Epic is not the Project's, a run over named Tickets) is an error toast and the tooltip of "⋯". Only the person
changes a running queue: the chat command and the `autopilot_start` tool are refused while a run goes on.

While a run goes on:

- The Orchestrator is **unattended**. It runs in the `bypassPermissions` mode, whatever mode the Node saved; on a Codex
  Orchestrator that is the "Full access" preset (sandbox `danger-full-access`, approvals `never`). A change of its
  permission mode is refused. When the run ends, the Node gets its own settings back. The run drives the Orchestrator's
  Session and reads its events the same way on either Vendor. Codex turns the Harness's hooks off after every install or
  update of the Harness until you approve them, and without them the gate and the guards of the workflow do not hold. So
  before each start of a run on a Codex Orchestrator, and again before each later Wave and before the gate queue's turn, worfy asks Codex (`hooks/list`)
  whether the hooks of the plugin `worfy` are approved: every hook its `hooks.json` declares on an event Codex runs
  must be listed, enabled and approved. While they are not, or Codex does not say, the run is refused with "The Harness
  hooks are not approved in Codex. Approve them in /hooks and start again."; before a later Wave no new Session
  starts, and the run stops with that reason in the journal (`session-error`). To approve them, start the Codex of
  this build in a terminal, type `/hooks` and approve the hooks of the plugin `worfy`; the step below shows the command
  to copy, as that Codex is not on PATH ([Harness, In Codex](harness.md#in-codex)). After an install or update in Codex the
  toolbar shows the step "Approve the Harness hooks in Codex" with these instructions and a "Check again" button, in the
  windows open at that moment (a window opened later does not pop it up). Until a check finds them approved, the
  Harness item says "Codex: approve hooks", and a click opens the step again. A run on Claude Code is not checked.
- A permission request, a question with answer options and a Card's `session.ask` are refused at once, because no one is
  there to answer. An approval Codex still asks for gets `decline`. Each refusal goes to the journal. When Claude Code gave a reason for a permission request, the model
  gets that reason so it can change the command.
- On either Vendor the Project's Auto-approval mode changes what happens to a permission request; it is read
  at each request, so a switch counts from the next one. Off: as above. Shadow: the approval policy judges the request,
  the journal gets an `auto-approval` line with what it would have done (`would-allow`, `would-deny`, `would-park`) and
  the rule, and the model still gets the refusal of Off. On: the policy's decision is the answer — an allowed request
  runs, a denied one is refused with the rule's hint, and a hard deny is always refused. A request only a person can
  decide is parked: it opens on the Orchestrator's Session as a permission card that names the rule and the paths, with
  Allow and Deny but no Always allow, so one answer covers that one request. During the Orchestrator's own turn the
  Session shows that it needs permission; a background task's parked request leaves an idle Session idle. A
  notification "Parked: `<tool>` in `<folder name>`" goes out, and the other Subagents go on. The owner's answer is
  the answer to the agent; with no answer in 60 minutes, or when the run stops, the request is refused with a hint, and
  while the run is stopping a request is not parked but refused at once. A parked request keeps its background task
  from counting as stalled. The journal gets `park` when it is parked, then `park-answered` or `park-expired`.
  When the run is over, the Orchestrator's chat gets one line that counts the run's decisions. It comes at the stop when
  nothing is left running, and also when the run gives the Orchestrator back to a person with its turn or background
  tasks still running ([after any other stop](autopilot-faults.md#after-any-other-stop)): their later requests go to the person, not to the
  policy. After Stop autopilot with a turn or tasks still running, and when the give-back could not change the Session,
  the line comes once the run's turn and background tasks have ended and the Orchestrator is back, the app quits, or the
  next run takes the Session over. A request of those tasks after such a stop is judged by the run's policy and
  journaled as during the run, and the line counts it; once the next run has opened its own policy, the requests are
  judged by that policy and belong to the next run. The line reads `Auto-approval: allowed 3,
  denied 1, parked 0` for On, `Shadow: would allow 2, would deny 1, would park 0` for Shadow, with `hard-denied N` added
  when there was a hard deny, and both, On first, when the mode was switched during the run. The end of a park is not
  counted again. A run with no decision gets no line. Run history lists the decisions
  ([Flight Recorder](flight-recorder.md#the-auto-approval-block)).
  On a Codex Orchestrator the request is Codex's approval of a command or a file
  change, and the answer is `accept` or `decline`: Codex's answer carries no text, so the rule's hint reaches only the
  journal. A command is judged in the folder Codex names for it. Codex wraps each command in the login shell
  (`/bin/zsh -lc '<script>'`). A wrapper of `zsh`, `bash` or `sh` — by name or from `/bin`, `/usr/bin`,
  `/usr/local/bin` or `/opt/homebrew/bin` — with `-lc` or `-c` and one quoted script word with nothing after it
  (single-quoted, or double-quoted with every `$` and backquote escaped) is judged as `<shell> -c '<script>'` (the
  login profile is the owner's own and outside every root); any other wrapper is not approved. Codex's `shell_environment_policy` may leave variables out of a command's shell. worfy pins the home
  folder and the run's variables (`TMPDIR` and its git environment) in every command's shell of the thread
  (`shell_environment_policy.set`), but Codex applies the owner's `include_only` after these pins, so it may still drop
  any of them. When a Codex request is judged, no variable has a known value: a command that uses one — `TMPDIR`,
  `HOME`, `USERPROFILE` or a secret included — or makes a folder with `mktemp -d` outside macOS is not approved, and no
  value of one reaches the journal. A `~` at the start of a word is still judged as the `HOME` the app-server started
  with, while bash, zsh and Git Bash with `HOME` dropped take the home folder from the user database: the two are
  assumed to be the same folder (on Windows with a custom `HOME`, such as `D:\home`, they may differ). Git on Codex is judged as git without the run's git environment,
  so the policy approves no git command there and parks the ones it would allow on Claude Code. A file change is
  judged by each path it writes, the new path of a rename and its `grantRoot` included. A request with a `grantRoot`
  (writes under a folder for the rest of the Session) is never accepted by the policy, input to a running command and
  a request for network access are parked, and no answer is ever "accept for this Session". A parked Codex request
  waits on the card as Claude Code's does, with Accept, Decline and "Decline and stop the turn"; the card also shows
  Codex's reason and, for network access, the host. A parked file change with a `grantRoot` offers no Accept, since
  Codex would take it as writes under that folder until the Session ends: the agent can ask again for each file. The
  owner's pick is Codex's answer, and a park that ends without one is declined. A request Codex withdraws, or one
  Interrupt cancels, while it is being judged gets no journal line on Codex
  and is not parked; on Claude Code each judged request gets one. An unattended Codex runs in Full access, so it
  asks nothing for now. Each request is judged in the environment the agent's process started with: its
  whole shell environment, so `CDPATH`, `BASH_ENV`, `ZDOTDIR`, `ENV`, `IFS` or a `GIT_` variable there makes a command
  it changes not approved. Git is read again at each request that writes a file or runs git, in the Project's root and,
  when a worktree may have config of its own (`git config --worktree`, an `includeIf`), in the checkout each git
  command runs in and in each worktree of the Wave: a hook or a program the agent put into the git config since is
  seen; where the refs are kept in reftable, the default branch is read from git as well. When git lists the config
  but will not name the git folders (a path key with no value, such as `core.excludesFile`), they are read from the
  `.git` folder or file and its `commondir`, and only when git listed that repository's config; otherwise the facts
  count as unknown and no write or git command is approved. Writing a config file the
  environment names (`GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM`, `XDG_CONFIG_HOME/git/config`), even an empty one, is
  never approved, as writing `.git/config`. A request that only reads, and runs no git, reads no git. Git in a worktree
  whose `.git` file or `commondir`
  names a git folder other than the Project's, or cannot be read, is judged as git whose hooks are not known: a command
  a hook or the config could change is not approved. Writing a config file git reads — one an
  `include.path` or `includeIf` names too, also before it exists — is never approved, as writing `.git/config`.
- In Shadow and On the run's agent (Claude Code, or Codex's app-server) starts with the run's own temporary folder as `TMPDIR`
  (`<data folder>/autopilot-tmp/<run>`) and a git environment: `GIT_CONFIG_PARAMETERS` turns off the owner's
  `log.showSignature` and `format.pretty` and keeps git from opening a bare repository above the folder, and
  `GIT_NO_LAZY_FETCH=1` keeps a partial clone from fetching through `core.sshCommand` while the repository has hooks or
  programs in its config. This does not stop hooks or filters themselves: while there are any, the policy approves git
  only for reading refs and objects. An agent whose process started without that environment (in Off, or before the
  repository got a hook) gets no git approved. On macOS `mktemp -d` ignores `TMPDIR`, so a folder it makes is outside
  every root; `mkdir -p "$TMPDIR/<name>"` is approved (not on Codex, where no variable has a known value), and the hint of a refusal in the home folder names it. In Off
  the agent starts as before, with neither. The folder is removed when the run ends; a run that could not start its
  policy has none. A Session another run took over keeps its folder, as does a crash or a quit;
  such folders go the next time worfy starts.
- "Run wave" and "Process gate queue" by hand and "New conversation" of the Orchestrator are refused.
- A person can still write to the Orchestrator. What a person does on its Session through worfy goes to the journal as
  `human-input`: a message, a Card's message, Interrupt, "Send queued", removing a queued message, a change of settings,
  also one that was refused. A refused "Run wave", "Process gate queue" or "New conversation" writes no line, and neither do
  actions in other Sessions.
- Interrupting a turn of the Wave ends the run with the reason `interrupted`.
- The Session uses only the Browser profiles marked "Available to Autopilot", must name a Ticket of the Epic when it opens
  a Browser, and never signs in. The [Browser page](browser.md) covers this.
- worfy asks the system to keep the display on, from the start of the run to its end, also during the waits ([Autopilot faults and recovery](autopilot-faults.md)).
- With Linked machines, a chip "on <Machine>" under the button says which Machine runs it. A Linked machine with full
  access can start and stop the run. With read-only access it sees the state and its buttons are inactive. The run always
  executes on the Machine of the Project.
- When the Harness in `main` of worfy's own repository has changes that this build does not have, the chip "Harness in
  main is newer than the Stable copy" stands under the button, with or without a run. The run goes on as it is.

#### Auto-approval

Auto-approval decides what worfy answers when the agent of a run asks for a permission. It is set per Project on the
Machine of the Project, in the Orchestrator's Modes menu ([Sessions](sessions.md)), and is Off until set. The mode is
kept in worfy's own `app-settings.json`, not in the Profile, which the agent could change itself. While worfy runs with
a debugging port or the Node inspector open, Off applies whatever is saved. A run reads the mode at each request.

| Mode | What the agent gets | What the journal gets |
|---|---|---|
| Off | The refusal of an unattended Session, as without Auto-approval. The policy is not asked. | `refused-dialog` |
| Shadow | The same refusal as at Off: no hint, no park. | `auto-approval` with what the policy would have done: `would-allow`, `would-deny`, `would-park`, or `hard-deny`. |
| On | The policy's decision (below). | `auto-approval` with `allow`, `deny`, `park` or `hard-deny`; a park also gets `park-answered` or `park-expired` when it ends. |

The approval policy judges each request in a fixed order and gives one outcome with the rule that decided it:

- **deny with a hint**: the agent can rewrite the request. A question with answer options is always this ("decide by
  the rules of the Project, or write the question into the owner questions of the Ticket"); so is a command the
  policy cannot read in full (a command substitution in a target, `eval`, a loop over a variable target, a variable with
  no known value), a symbolic link on the path, a delete of a whole root, and a write to git's config, hooks or
  attributes. What the policy did not read it never allows. The hint is fixed text of the rule, never a piece of the
  request.
- **allow**: every target is inside the roots of the run — the worktrees of the Tickets of the current Wave, the
  Project's `.scratch`, the run's own temporary folder and the Session's scratchpad — and an allow rule passes every
  action: file programs inside the roots without the network, an `sh`/`bash`/`zsh -c` script whose every action another
  rule passes, git in a worktree of the Wave without push and without deleting a branch, and Edit, Write, MultiEdit,
  NotebookEdit (Claude Code) or a file change (Codex) inside the roots. A push is never allowed.
- **park**: parsed, but only a person can decide, such as a push or a tool the policy does not know. The request waits
  on the Orchestrator's Session for at most 60 minutes, as described under [During a run](#during-a-run).
- **hard deny**: refused in every mode, and no answer lifts it. The secrets and settings of the home folder
  (`~/.claude`, `~/.codex`, `~/.ssh`, `~/.gnupg`, `~/.config/gh`, `~/.gitconfig`, `~/.config/git`, `~/.npmrc`, the shell
  rc files, `~/Library`) and `%APPDATA%` and worfy's data folder (except the run's own temporary folder), to write,
  delete or read; writing into the Harness home, the folders of other live Sessions and other worktrees; programs that
  change the system or app settings (`sudo`, `launchctl`, `security`, `crontab`, `defaults write` and the like);
  `chmod` and `chown` outside the roots; a force push, a push that deletes, a push to the default branch or a branch of
  another worktree, and deleting, checking out or committing on such a branch; running what was downloaded
  (`curl … | sh`); sending a file from outside the roots.

The policy sees only the requests the agent asks. In `bypassPermissions` Claude Code runs most commands without asking,
so Auto-approval makes a run no less safe than `bypassPermissions` is: it only says yes to part of what used to get no.
The decision and its reasons are recorded in [ADR-0098](../adr/0098-approval-policy.md).

Where to see the decisions: Run history lists them in its Auto-approval block, with the counters and, in Shadow, the
Project's Shadow decisions so far ([Flight Recorder](flight-recorder.md#the-auto-approval-block)). When the run is over
the Orchestrator's chat gets one line, `Auto-approval: allowed 3, denied 1, parked 0` or `Shadow: would allow 2, would
deny 1, would park 0`. A switch from Shadow to On is the owner's: worfy never changes the mode itself.

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
over. So does a change of a live task's output file — the file Claude Code writes a background command's output to, named
in the tool result that started it: when the hour runs out, the run looks at those files again, and one that changed in the
hour starts it over. That way a gate full in one silent background command, which prints a line at the end of each step,
does not stop the run, and a task that stopped writing stops it within two hours of its last line. After the last task
ends, the run waits up to 2 minutes for the turn its task-notification starts, then judges the Wave without that turn.

Every Wave after the run's first goes to a new SDK session of the Orchestrator, so the context does not grow from Wave to
Wave. Its first prompt also tells the Orchestrator to run `wave-brief <epic>`. The Wave stays in the current session when the
Orchestrator is not free (a turn, a live task or a queued message), when the wait for a last turn ran out, and with the old
Harness, which has no `wave-brief`.

#### The Run mode, the Start window and the budget

Every run goes in a Run mode, fixed when it starts: **Fastest**, **Budget-aware** or **Start window**. Before each Wave,
never inside one, the mode decides whether the next Wave starts now or waits: for the daily budget of the Limits, or for
the Start window. A refusal by the Limits inside a Wave remains the hard limit in every mode.
[Run planning](run-planning.md#run-mode-and-epic-forecast) describes the modes, the Start window, the budget and the Epic
forecast.

A run on a Codex Orchestrator weighs the budget by the Codex windows. The longest window takes the place of the 7-day
window. Every shorter window takes the place of the 5-hour one: while it is full, the next Wave waits for its reset. The
estimate of a Wave and the forecast in the journal take their samples only from earlier runs on Codex. Codex reports
whole percents only, so the estimate needs 5 such Waves, not 3. The tooltip of the Autopilot button and the
`autopilot_start` dialog of a Project whose Orchestrator runs on Codex show the forecast by the same Codex samples and
the live Codex windows, and say that the range is wide because Codex reports whole percents.

#### Waits, stops and recovery

How a run waits for the Limits and retries after an API error, how it stops, what happens after a stop and why a run
stops are on the [Autopilot faults and recovery](autopilot-faults.md) page.

#### The journal

Each run writes a journal: one text file with one JSON object per line. It is the record of what happened: each Wave with the
text sent, Tickets left out, the changes of the Tickets' status, refused dialogs, a person's actions on the Session, waits,
background tasks and the reason of the stop.
The [Run history](flight-recorder.md) screen draws a run from its journal and the other sources. An observer outside worfy may append a `human-input` line with `>>`, for a
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
| `sending` | "Run wave" is on its way, or the run waits for the budget or the Start window before sending it. |
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

**Stops, waits and refusals.** Why there are two stops, why a wait goes by the wall clock and what counts as a refusal by
the Limits: [Autopilot faults and recovery](autopilot-faults.md#how-it-works).

**The budget, the Start window and the forecast.** How the budget, the Start window and the Epic forecast are computed
from the run journals is on the [Run planning](run-planning.md#how-it-works) page.

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
| `src/main/autopilot/chat-start.ts` | `ChatStarts.startFromChat`: the start from a chat, over the Epic or named Tickets; the refusal while a run goes on, the answer that the run waits for a busy Orchestrator, and the notice when that run is refused later. The command typed in a chat and the tool `autopilot_start` call it. |
| `src/shared/autopilot/chat-command.ts` | `parseChatCommand`: which typed messages are a command, with what Epic and Tickets; the toast of its answer. |
| `src/shared/workflow/wave-plan.ts` | `parseWavePlan`, `waveTickets`: the Waves table of an Epic's `spec.md`, and the Tickets of Wave N not done yet. |
| `src/main/ipc/agent.ts` | `agent.send`: a command does not reach the agent; it starts the run through `startFromChat` and answers what became of it. |
| `src/main/autopilot/chat-confirm.ts` | The tool `autopilot_start` behind the canvas server: the refusals without an ask, the ask in the Start Autopilot window of this Machine (`WindowAsks`) and its 10 minutes. |
| `src/main/ipc/autopilot-confirm.ts` | The handler of `autopilot.confirm.answer`: an answer counts only from the window asked. |
| `src/shared/autopilot/cycle.ts` | The cycle: phases, events, effects, stop reasons and their time limits. Pure. |
| `src/main/ipc/autopilot.ts` | The IPC handlers, and `sharedAutopilot`, which wires the app's Projects, Orchestrators, Sessions, watch and journal to a run. |
| `src/shared/ipc/autopilot.ts` | The `autopilot` IPC channels, the state of a run and the text of the status line. |
| `src/main/actions/launch.ts` | `autopilotWave`, `autopilotRefusal`, `autopilotGateQueue`: the text from the template, sent to the Orchestrator. |
| `src/shared/actions/render-template.ts` | `runWaveState`: the verdict and the text, shared with the button. |
| `src/shared/workflow/waves.ts` | `readyWave`: the ready Wave and the Tickets left out. |
| `src/main/agent/orchestrator.ts` | `setUnattended`, `giveBackNow`, `newUnattendedSession`, and the refusals for a turn, tasks or a queue. `busy`: what keeps the Orchestrator busy; `takeNow`: Start now. `runsOn`: the Vendor a run goes on; `unattendedRefusal`: the refusal of a Vendor whose Harness does not hold. |
| `src/main/agent/app-orchestrators.ts` | The Orchestrator's Vendor, the Project's `defaultVendor`, read at its start. |
| `src/shared/autopilot/budget-window.ts` | Which Limits window a run's budget reads: Claude Code's 7-day and 5-hour, or the Codex windows by length. Pure. |
| `src/main/vendors/codex/harness-hooks.ts` | Whether the Harness hooks are approved in Codex (`hooks/list`), and the refusal of a Codex run while they are not. |
| `src/renderer/harness/CodexHooksStep.tsx` | The step "Approve the Harness hooks in Codex" with "Check again". |
| `src/main/agent/session-settings.ts` | The launch of a Session and the forced permission mode. |
| `src/main/agent/permissions.ts` | `unattendedCanUseTool`: the refusal of every request. |
| `src/main/agent/session.ts` | `halt` for Force stop, `refuseDialog`. |
| `src/shared/autopilot/journal.ts` | The journal format, specified in the comment at its top, with parsing and writing of a line. Pure. |
| `src/main/autopilot/journal.ts` | The journal files: open, append, list, read. |
| `src/main/autopilot/power.ts` | `KeepAwake`, over Electron's `powerSaveBlocker`. |
| `src/main/autopilot/origin.ts` | The key of remote `origin`. |
| `src/main/link/autopilot-runs.ts` | The question about runs between Linked machines, two service messages of the link. |
| `src/main/autopilot/harness-drift.ts` | Whether the Harness in `main` is newer than this build's. Read-only: no `git fetch`. Packaged builds only. |
| `src/main/mcp/browser-server.ts` | What a Session in Autopilot may do with a Browser. |
| `src/main/ipc/card-api.ts` | The refusal of a Card's `session.ask` to an unattended Session. |
| `src/renderer/canvas/actions/AutopilotAction.tsx` | The button, the "⋯" menu, the status line and the chips; Start now and Cancel of a waiting run. |
| `src/renderer/autopilot/StartNowModal.tsx` | The "Start now?" window: what Start now stops and what stays. |
| `src/renderer/autopilot/QueueList.tsx` | The queue of Epics in the Start Autopilot window: tick, drag, ⌥↑/⌥↓, Waves and acceptance date per Epic. |
| `src/renderer/settings/AutopilotSection.tsx` | Settings → Autopilot. |
| `scripts/install-stable.mjs` | `pnpm install:stable`: the Stable copy. |

The modules of the Run mode, the budget and the Epic forecast are listed on the [Run planning](run-planning.md#modules)
page.

The modules of the wait for the Limits and of the retry after an API error are listed on the
[Autopilot faults and recovery](autopilot-faults.md#modules) page.

#### Data flow

1. The button calls `autopilot.start`. `Autopilot.start` runs the checks in order: the Project has no run, the self-project refusal
   and the template, the workflow and the Epic, then the origin key and the question to the Linked machines.
2. The run opens its journal (`run-started`). While `Orchestrators.busy` reports a turn, queued messages or live tasks, it
   waits (`orchestrator-busy`); once free it writes `orchestrator-free` and runs the checks again. `setUnattended` starts the
   Orchestrator's Session again unattended, continuing its SDK session, or refuses. Then the run writes `forecast`, starts keep-awake, subscribes to the Session's events and opens a workflow watch that reports changes of
   Tickets' fields only.
3. The `start` event goes to the cycle. Its `send-wave` effect runs `sendWave` in the run: it asks the usage, checks the Run mode (the Start window and the budget), starts
   a new SDK session for a Wave after the first, and calls `autopilotWave`. The launcher reads the workflow once and takes the text,
   the Tickets and the skipped Tickets from that read. It sends the text through the Session, which starts a turn or queues it, and
   binds the Session to the Epic.
4. Events of the Session (`prompt`, `result`, `state`, `background_tasks`, `refused_dialog`) and workflow changes become cycle events,
   each with a fresh read of the workflow where the cycle needs one. Each effect goes to the journal or to the Session.
5. `end` writes `run-stopped`, takes the run's messages out of the queue, and gives the Orchestrator back through `setUnattended`. With
   a turn or a task alive, a stop of the run's own gives it back as it runs (`giveBackAsItRuns`: `Session.becomeAttended`
   changes the live process to the Node's settings), writes `orchestrator-returned` at once, and `watchReturned` keeps
   keep-awake and the status line's task count until they end. After Stop autopilot (`waitForWork`), or when that change is
   refused, the give-back waits until they end, and `linger` follows it for the journal. A Force stop goes through
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
| `run-started` | The run began. Has `origin`, and `override` or `unasked` when they apply. `by` says who started it: `button`, `command` or `tool`. `tickets` names the Tickets of a run over named Tickets. `mode` is the Run mode: `fastest`, `budget-aware` or `start-window`. `vendor` is the Vendor of the Orchestrator, `claude` or `codex`; a line without it is a run on Claude Code. `autoApproval` is the Auto-approval mode at the start, `shadow` or `on`, or `off` when the policy could not start, and the run went on as at Off; a line without it is a run at Off. |
| `orchestrator-busy` | The run waits for the busy Orchestrator: `turn`, `queued` (messages in its queue) and `tasks`, at the start of the wait and on each change. |
| `orchestrator-free` | The wait for the Orchestrator ended; the run takes it now. |
| `harness-behind` | The Harness in `main` is newer: after `run-started`, and before a `wave-started` when the count changed. |
| `forecast` | The Epic forecast at the start, once, after `run-started` and `harness-behind`, before the first `wave-started`: the Run mode, the Waves and Tickets left, the samples, `low` and `high` (p10 and p90 of the share of the week, `null` under 5 samples), `fit` (how many Waves fit before the 7-day reset with the reserve; only when the Run has a recommendation, in Budget-aware or in Start window with the budget on, else `null`), `week` (the 7-day number at the start), the p90 of a Wave's duration with its sample count, and `window` in Start window. Journals that cannot be read give `samples: 0`; the run goes on. In a run on Codex, `samples`, `fit` and `week` are of the longest Codex window and of earlier Codex Waves only. |
| `wave-started`, `wave-finished` | A Wave went or ended. `wave-started` has the text sent, the skipped Tickets and `session`, the id of the Orchestrator's SDK session the Wave went to (its transcript's name). Both may have `limits`: `{five_hour, seven_day}` in a run on Claude Code, `{windows}` with the Codex windows in a run on Codex. |
| `ticket-status` | The `Status:` of a Ticket of the run's Epic changed during the run, seen on a change the workflow watch reports or in a last read right before `run-stopped` (not on a Force stop). A Ticket whose file appeared during the run gets the status it was first seen with. Has `state` (`claimed`, `blocked`, `done`, `open`), and `statusAt`, `reason` and `waits` when the Ticket has those lines ([ADR-0092](../adr/0092-run-history.md)). |
| `narrow-round` | A state of the narrow fix round on a Wave Ticket's PR, once per Ticket and outcome. |
| `start-window` | The Start window held the next Wave back: `reason` is `outside` or `wave-too-long`. `waiting-until` follows. |
| `budget-stop` | The budget stopped the next Wave. `waiting-until` follows. |
| `limits-hit` | The Limits refused a turn. A Codex refusal with no window used up has `reason: "quota"` and `message`, and `run-stopped` with `vendor-quota` follows. |
| `waiting-until`, `resumed` | A wait began or ended. `resumed` also follows a `turn-retry` when the continuation has gone, or when a turn ends the wait. |
| `turn-retry` | A turn ended with a temporary API error and Auto-continue is on. Has `attempt` and `of` (1 of 5 …), `error` (`api-500`, `overloaded`, `connection`, …), `message` (the first 300 characters of the error text) and `until`, when the continuation goes. |
| `retry-refused` | Auto-continue is on and the failed turn is not retried. `reason` is `not-transient`, `in-flight` or `cap`; with `in-flight`, `actions` has each call without a result (`git push origin main`): a shell call's command as the model wrote it, another tool's worfy summary, secrets replaced by `***` as in `auto-approval` (`--token ***`). `session-error` and `run-stopped` with `turn-error` follow. |
| `session-error` | A Session failed. |
| `refused-dialog` | An unattended Session refused a request. Has the Subagent and the reason when given, and never the command. The home folder is written as `~`. |
| `auto-approval` | The approval policy judged a permission request in Shadow or On. Has the Session, the Subagent when given, the Vendor, the `mode`, the `outcome`, the `rule`, the tool, the `targets` and, for a shell command, the `command` cut to 200 characters with secrets replaced by `***`: the values of secret-named variables, options and JSON keys, passwords in URLs, after curl's `-u`, the `-p` of mysql, docker login and sshpass, and `password` of `.netrc`, secret-named headers and known token forms. A few commands that only look like these keep their text: `sort --key=2`, a `git commit -m "auth: …"` message, a bare search word or a letters-only quoted pattern of grep and rg (`grep -rn password src/`, `rg "apiKey: string"`), and a numeric `docker run -u 1000:1000` given before the image. Each of the `targets` has its secrets replaced the same way (`touch <worktree>/ghp_…` gives the target `<worktree>/***`). The home folder is written as `~`. |
| `human-input` | A person stepped in. `source` is `worfy` or `observer`. |
| `background-tasks` | The set of live background tasks changed. |
| `run-stopping` | A graceful Stop came during a turn or tasks. |
| `gate-queue` | The run sent "Process gate queue". |
| `gate-queue-finished` | The turn of "Process gate queue" ended. `run-stopped` follows. |
| `run-stopped` | The run ended, with its reason. `tickets` for `blocked-tickets`, and for `user-force-stop` and `session-error` after the first Wave. `lastText` for a stop for want of a Wave. `actual` once a Wave has finished, on a Force stop and a quit too: the growth of the 7-day share over the run's Waves (`share`; in a run on Codex, of the longest Codex window), the Waves finished (`waves`) and how many of them counted (`counted`; a Wave with a stale number or a week reset inside does not). |
| `orchestrator-returned` | The Orchestrator is a person's Session again, after a stop that had to wait, or after a Force stop. A stop for a reason of the run itself, not Stop or Force stop, gives it back at once, without a restart: `tasks` then lists the background tasks that go on in the person's Session. |
| `tasks-killed` | Tasks the run waited for ended with the process, on a quit or a Force stop. With the reason `start-now`: the tasks of the Orchestrator that Start now stopped. |

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
| `test/contract/autopilot-start-tool.test.ts` | The tool `autopilot_start`: the ask in the window and its answers, its 10 minutes, the window it goes to, the refusals without it, the answer of a run that waits for the Orchestrator. |
| `test/unit/auto-approve-shell.test.ts` | The parser of a shell command for Auto-approval: the examples of the spec, each construct outside the grammar, words and quotes, the variables a command surely gets, Git Bash on Windows. |
| `test/contract/auto-approve-shell-sh.test.ts` | The parser against real shells (sh, bash, dash and zsh where installed, Git Bash on Windows): the words it reads are the words the shell passes. |
| `test/unit/auto-approve-policy.test.ts` | The approval policy: hard deny in every mode, questions, commands outside the grammar, each allow rule, the attacks of the spec (delete everything, a link to the home folder), git config and hooks, other worktrees and the default branch, Windows paths, the hints. |
| `test/unit/auto-approve-roots.test.ts` | The roots and hard areas: links and globs on disk, the folder of `mktemp -d`, roots recorded at the start and moved since, what a copy brings along, Windows path forms. |
| `test/unit/auto-approve-run.test.ts` | The policy of a run: its git environment and what it reads of the repository, the context of each request, the command and the targets as the journal keeps them, the Claude driver by mode, and no write into the Project. |
| `test/unit/auto-approve-park.test.ts` | Park: the wait on the gate, the 60-minute limit, a stop of the run (also while the request is on its way), the notification. |
| `test/unit/auto-approve-summary.test.ts` | The decisions of a run in its journal, their counters for Run history and the line in the Orchestrator's chat at the end of a run. |
| `test/contract/auto-approve-claude.test.ts` | Auto-approval of an unattended Claude Code Session: Off unchanged byte for byte, Shadow, On, a switch during the run, the run's environment, a policy that cannot start or throws, a parked request of a background task, a Stop during a park. |
| `test/contract/auto-approve-codex.test.ts` | The same on Codex over the fake app-server: Off, Shadow, On, the variables pinned in Codex's shell and the owner's `include_only` that may drop them, the login-shell wrapper, a request closed while judged, a park and its ends, a file change with a `grantRoot`. |
| `test/contract/auto-approve-setting.test.ts` | The mode in `app-settings.json`: per Project, garbage read as Off, writes only through its channel, an edit made outside worfy, a Linked machine, the debugging port and the inspector. |
| `test/e2e/auto-approve.spec.ts` | The built app under Playwright's debugging port: the Modes menu shows Off in force with the reason, the saved mode is read at start, nothing is written. |
| `test/contract/codex-orchestrator.test.ts` | A run on a Codex Orchestrator on the fake app-server: Full access, the refusal while the hooks are not approved, before a later Wave and before the gate queue, the wait for a Codex window, `vendor-quota`, the budget by the Codex windows. |
| `test/unit/autopilot-vendor-limits.test.ts` | The budget window of Codex, its samples and forecast, both forms of `limits` in the journal. |
| `test/contract/autopilot-journal.test.ts` | The journal files, a line appended from outside, no write outside the data folder. |
| `test/contract/autopilot-wiring.test.ts` | The wiring of a new session per Wave in `sharedAutopilot`. |
| `test/e2e/autopilot.spec.ts` | The built app: a run, the wait for the Limits, the budget, background tasks, Force stop, the narrow fix round. |
| `test/unit/autopilot-queue-line.test.ts` | The line of a run over a queue (`Epic 2/3: …`), the chip of each status of an Epic of the queue, the queue in the tooltip, and which of Add to queue and Remove from queue "⋯" offers. |
| `test/e2e/autopilot-queue.spec.ts` | The built app: Run all accepted from "⋯", a run over two Epics (`Epic 1/2`), Add to queue during a Wave made at its end (`Epic 1/3`), Remove from queue leaving the Epic unstarted with `queue-changed` in the journal. |
| `test/e2e/linked-autopilot.spec.ts` | Two linked apps: the refusal, Start anyway, Stop pressed on two screens. |
| `test/e2e/browser-autopilot.spec.ts` | What the Session of a run may do with a Browser. |

The tests of the waits, the retry and the Fault scenarios are on the [Autopilot faults and recovery](autopilot-faults.md#tests)
page.
