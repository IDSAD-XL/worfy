# Starting Autopilot from a chat

How an [Autopilot](autopilot.md) run starts from the chat of a Session: by the command `/worfy:epic-wave` the person
types, or by the canvas tool `autopilot_start` the agent calls when asked in words. New to the terms: start with
[Concepts](concepts.md).

## Starting Autopilot from a chat

### Behaviour

#### The command typed in a chat

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
waits for it as described under "While the Orchestrator is busy" ([Autopilot, Starting a run](autopilot.md#starting-a-run)), and the toast says "Autopilot waits for the Orchestrator and starts when it is free". The Waves Autopilot sends to the Orchestrator are never
read as a command.

#### Asking the agent

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
waits for it as described under "While the Orchestrator is busy" ([Autopilot, Starting a run](autopilot.md#starting-a-run)), and the agent gets "Autopilot waits for the Orchestrator and starts when it is free". Without an ask the tool refuses:

- a Session that runs unattended, such as the Orchestrator during a run: no one is there to confirm. The Orchestrator of a
  stopped run that still waits for its turn or background tasks is not refused: it gets the window;
- a Session worfy cannot find;
- a Project with a run under way: the same refusal as the command's, with the hint to stop it or use "Add to queue…"; the
  tool never adds an Epic to a running queue, and the journal gets nothing;
- an Epic (of the queue too) or a Ticket the Project does not have, or a workflow that cannot be read;
- a second call while an ask of the same Project waits;
- a Machine with no worfy window open;
- a Start Autopilot window already open for another start: the agent is told so.

### How it works

A run started from a chat is the run the Autopilot button starts. How that run works is on the
[Autopilot](autopilot.md#how-it-works) page.

### Implementation

#### Modules

| Path | What it holds |
|---|---|
| `src/main/autopilot/chat-start.ts` | `ChatStarts.startFromChat`: the start from a chat, over the Epic or named Tickets; the refusal while a run goes on, the answer that the run waits for a busy Orchestrator, and the notice when that run is refused later. The command typed in a chat and the tool `autopilot_start` call it. |
| `src/shared/autopilot/chat-command.ts` | `parseChatCommand`: which typed messages are a command, with what Epic and Tickets; the toast of its answer. |
| `src/shared/workflow/wave-plan.ts` | `parseWavePlan`, `waveTickets`: the Waves table of an Epic's `spec.md`, and the Tickets of Wave N not done yet. |
| `src/main/ipc/agent.ts` | `agent.send`: a command does not reach the agent; it starts the run through `startFromChat` and answers what became of it. |
| `src/main/autopilot/chat-confirm.ts` | The tool `autopilot_start` behind the canvas server: the refusals without an ask, the ask in the Start Autopilot window of this Machine (`WindowAsks`) and its 10 minutes. |
| `src/main/ipc/autopilot-confirm.ts` | The handler of `autopilot.confirm.answer`: an answer counts only from the window asked. |

The modules of the run itself are listed on the [Autopilot](autopilot.md#modules) page.

#### Tests

| Test | Covers |
|---|---|
| `test/unit/autopilot-chat-command.test.ts` | The forms of the command typed in a chat, and the text that is no command. |
| `test/unit/wave-plan.test.ts` | Both shapes of the Waves table, ranges, done Tickets, and the refusals. |
| `test/contract/agent-send-autopilot.test.ts` | `agent.send` with a command: the start, the refusal while a run goes on, and what still reaches the agent. |
| `test/e2e/autopilot-chat.spec.ts` | The command typed in the Session view and in a Session Node: the toasts and the status line. |
| `test/contract/autopilot-start-tool.test.ts` | The tool `autopilot_start`: the ask in the window and its answers, its 10 minutes, the window it goes to, the refusals without it, the answer of a run that waits for the Orchestrator. |
| `test/unit/autopilot-chat-start.test.ts` | `startFromChat` for the command and the tool: the checks, the refusal while a run goes on, the answer of a run that waits. |
