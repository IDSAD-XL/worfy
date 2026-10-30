# Sessions

Two Features. **Session** is one conversation with Claude Code. A **Subagent** is an agent that a Session started.
Transcript, Claude home, Memory and Limits are on the page [Transcripts and usage](transcripts-and-usage.md). Terms are
explained in [Concepts](concepts.md).

## Session

### Behaviour

worfy runs Sessions itself and shows the ones started elsewhere. Each Session has one Node on the Canvas.

| Node | How it appears | What the user can do |
| ---- | ------------- | -------------------- |
| Orchestrator | Created locked, one per Project | Everything below, plus "New conversation". It can be moved, not removed |
| Live Session Node, 340 by 220 pixels | "New session", or Resume | Send messages from the Node or the Session view |
| Read-only Session Node, 300 by 120 pixels | A Session started in a terminal or Claude desktop | Read its transcript, Resume it once it has finished |

A Session worfy runs belongs to the app, not to a window. Its events go to every window, closing a window does not stop
it, and it stops when worfy quits.

**States.** A Session is in one of six states, shown as a chip.

| State | Chip status | Meaning |
| ----- | ----------- | ------- |
| `starting` | working | The process started. It becomes `idle` when Claude Code answers about the account |
| `idle` | ready | Waits for a message |
| `busy` | working | A turn runs |
| `needs_permission` | blocked | A turn waits for an answer to a permission request |
| `error` | blocked | The process died or failed. The tooltip shows the end of its stderr |
| `closed` | done | The Session is closed |

The chip's text is the state's name: `needs_permission` reads "needs permission". The exception is a Live Session Node whose Session is not running: it reads "finished", or "new" before the first start.

**Sending.** Return sends, Shift+Return starts a new line. ↑ and ↓ in an empty field walk the history of sent messages.
The field grows to 200 pixels. An empty message without attachments is refused. A send that fails puts the text and the
attachment chips back into the field. "/" opens the menu of the slash commands and skills that Claude Code reports for
this Session.

**Queue.** A message sent during a turn waits in a queue in main. The hint beside the send button says "Return to queue"
then. Messages go one per turn, each after the `result` of the previous turn. The chip "N queued" opens the list, where ×
removes a message. An Interrupt or a crash holds the queue: the list title changes to "Held after Interrupt", and nothing
goes until "Send queued". An empty queue is never held. A queue does not outlive its Session. The exception is the
Orchestrator, whose queue moves to the new process when Autopilot gives it back.

**Interrupt.** The Session view's button, or Esc in its input field, works in `busy` and `needs_permission`. Interrupt holds
the queue, cancels open permission requests and questions, and asks Claude Code to stop the turn.

**A crash.** The Session goes to `error`. The queue is held, open requests are cancelled and the background tasks are
forgotten. The next message starts a new process that continues the same conversation.

**Closing.** The user cannot close a Session in `busy`: "The Session is in a turn: Interrupt it before closing". Closing a live
Session Node's Session keeps the Node, and the Node then offers Resume. A message sent to such a Node resumes it first, and
so does a file dropped on it.

**Resume.** Only a finished Session continues, because two processes must not write one transcript. It continues in the
folder its transcript records, or in the Project root when none is recorded. The refusals have these labels:

| Reason | Label |
| ------ | ----- |
| worfy runs it now | Already open in worfy |
| A live process in a terminal | Still running in terminal |
| A live process in Claude desktop | Still running in Claude desktop |
| No transcript found | No transcript of this Session |
| Its folder is gone | Folder no longer exists |

A read-only Node turns live in place, keeping its id and position, and grows to the minimum live size. An archived Node
comes back to the Canvas first. A locked Node is refused. Without a Node, a new Node appears.

**Sidebar and history.** The sidebar's Sessions section lists the live Sessions of the Project, with "New session" and the
history. The history popover lists up to 100 past Sessions, newest first, each with Show and Resume, and its source: worfy,
desktop or terminal. Show puts a read-only Node on the Canvas, or goes to the Node the Session has. The title is the last
custom title, then the AI title, then the first prompt.

**Model, effort and permission mode.** Three pickers sit under the input field and the header shows the current values.

- Model: the rows come from Claude Code. Haiku is never offered. A saved Haiku falls back to the default model and effort.
  "Default" means the `model` and `effortLevel` of the user's `settings.json`, read at each process start. When the user's
  own model is a Haiku, the Session asks for Sonnet. A picked model shows in the header at once.
- Effort: low, medium, high, xhigh, max, as far as the model supports them. A slider sends the choice after 600 ms of rest
  or when its popover closes.
- Permission mode: Bypass permissions (the default), Accept edits, Ask before tools, Plan only.

The choice is saved per Node. A damaged saved field falls back to its default.

**Permissions.** Outside Bypass permissions, Claude Code asks before a tool and a card appears in the transcript.

- Allow: this one call.
- Always allow: this tool, for the rest of this Session. It also settles other open requests for the same tool. It survives
  a crash of the process, but not a restart of worfy or Resume. worfy never writes a rule to the user's settings.
- Deny: refuses this call.

A request is cancelled by an Interrupt, by closing the Session, by a crash and when Claude Code aborts it. The card then
shows Allowed, Always allowed in this Session, Denied or Cancelled.

**Questions.** Claude Code's AskUserQuestion becomes a question card, in every permission mode. It shows one question at a
time with Back and Next. The options are buttons with descriptions, or switches when several may be picked. "Other" takes
the user's own words. 1–4 pick an option and Enter goes on. "Submit" works once every question has an answer. "Decline"
refuses the call. The card has no "Always allow".

**Attachments.** "+", a drop anywhere on the chat and a pasted image all add a chip. A message takes 20 attachments.

- Images: PNG, JPEG, GIF and WebP, up to 3.75 MB each.
- Files picked with "+" inside the Project go by their path, at any size.
- Files picked outside the Project, and every dropped file, are copied into the Project's data folder, up to 20 MB each.

**Session view.** The second view of the window, beside the Canvas. Its header holds the title ("Orchestrator" or "Session"
and the Project), the state chip, the Session picker, Model, Effort, Permissions, Cost, Hide tools and Interrupt. Cost shows
a figure for the Orchestrator only: `$0.00`, with four decimals below a dollar. Other Sessions show a dash. The view shows
the Session opened last in this Project while its Node is on the Canvas, and otherwise the Orchestrator. The memory of that
choice lives as long as the window. The Session picker lists the Orchestrator first, then the running Sessions, then the
rest. Subagents are not in it.

**Context meter.** A ring under the input field. 100% is the autocompact threshold and the figure stops there. With
autocompact off, or with no threshold known, it shows Claude Code's own percentage, which may pass 100. It changes colour
at 60% and 85%. Before the first report it says "no data". The tooltip reads
`84.2K / 200K tokens · autocompact at 167K`, or ends in `autocompact off`.

**Autocompact window.** Settings → Sessions has two rows: Orchestrator, whose window its Subagents use too, and Other
Sessions. Each is "Claude Code default" or Custom, from 100K to 1M in steps of 10K. worfy's defaults are 400K and 500K. A
window the user has not chosen gives way to `autoCompactWindow` in `settings.json`. `CLAUDE_CODE_AUTO_COMPACT_WINDOW` in the
login shell overrides both rows, and the section says so. A running Session keeps its window until it starts again.

**Orchestrator.** The Project's main Session. The Node shows its state, model, summed cost and the last status block of its
answers.

- "New conversation" is refused in `busy` and while Autopilot runs. The old conversation stays in the history, and the
  cost starts from zero.
- When the Orchestrator opens, its saved Session is resumed. With the transcript gone, a new Session starts.
- Eco mode, a switch under the Orchestrator's input field, writes `workflow.agents` in the Project's Profile. It applies
  from the next Ticket.
- Autopilot runs this Session unattended. See [Autopilot](autopilot.md). While it does, the permission mode is forced to
  Bypass permissions and not saved, a mode change is refused, and permission requests and questions are refused at once.

**Notifications.** A system notification goes out when a Session finishes a turn, asks a permission or asks a question while
no worfy window has focus. A Session from a terminal or Claude desktop notifies when its status goes from busy to idle. One
Session sends at most one notification in 10 seconds. A click opens that Session.

#### On a Linked machine

- A Session in a Project local to one Machine is not visible to the other. A Linked machine starts Claude Code and reads
  files by path only inside the Projects of the Machine it connects to.
- "+" uses a hidden file input there, and the file travels as bytes.
- With read-only access, the input field, the pickers and the answers on the cards are inactive, with a tooltip that says
  why. The Session view does not open an Orchestrator there: it shows "No Orchestrator yet" when there is none.
- Eco mode says "Eco mode is set in worfy on the Machine of the Project".
- A notification also goes to the connected Linked machines. Each Machine applies its own focus rule and its own 10 seconds.

#### Windows

- Claude Code is `claude.exe`. Its environment is built from the variables of the Windows session and the registry, because
  Windows has no login shell. Git Bash is passed for the Bash tool.
- The key hints read Enter and Shift+Enter. The hint beside the send button still says Return.

### How it works

- **One Session is one long-running SDK query.** Its input is an async queue, so a message to a running Session does not
  start a new process. Interrupt and a model change also go to the running query.
- **worfy is a view.** A Session runs with the user's own settings, `CLAUDE.md` and hooks, and worfy keeps its own state only
  in its data folder ([ADR-0002](../adr/0002-worfy-is-a-view-over-the-workflow.md),
  [ADR-0005](../adr/0005-worfy-own-state-inventory.md)).
- **An id arrives late.** A new Session passes its own uuid to Claude Code. A resumed one keeps a temporary `pending-` id until
  `system/init`, and then a `renamed` event moves everything to the real id. Channels accept both.
- **The Orchestrator's Node keeps only the Session id and the cost.** Everything else comes from the transcript and the live
  events ([ADR-0010](../adr/0010-orchestrator-state-session-id-and-cost-only.md)).
- **Tools and skills are limited by the Profile.** A Session in a Project gets only the MCP servers on its Profile's list, or
  the default list when it has none. The list goes to Claude Code as a policy tier, so a Subagent gets the same set
  ([ADR-0021](../adr/0021-mcp-servers-allowlist-in-profile.md)). `worfy-canvas` is passed only when the list names it, and
  `worfy-browser` when the list names it or `worfy-canvas`. Plugins and skills follow the same idea through flag settings, to save the tokens of their descriptions
  ([ADR-0084](../adr/0084-session-skills-and-plugins-by-profile-list.md)).
- **The Harness goes inline** unless the old Harness is on the machine
  ([ADR-0040](../adr/0040-harness-delivery-local-marketplace.md),
  [ADR-0049](../adr/0049-worfy-sessions-without-inline-plugin-on-legacy-harness.md)).
- **A process is waited for.** Two processes must not continue one conversation, so a relaunch starts only after the old
  process exits ([ADR-0064](../adr/0064-orchestrator-relaunch-waits-for-old-process-exit.md)). worfy waits 7.5 seconds after
  closing, sends SIGKILL, and waits 2 more seconds. An interrupted turn gets 15 seconds before an Autopilot Stop closes the
  process.
- **An unattended Session has no one to ask.** Hence the forced mode and the refused dialogs
  ([ADR-0022](../adr/0022-unattended-session-refuses-permission-mode-change.md)). Going unattended is refused during a turn,
  with live background tasks or with queued messages, because a restart would lose them
  ([ADR-0024](../adr/0024-autopilot-wave-end-and-keep-awake.md),
  [ADR-0029](../adr/0029-autopilot-waits-for-background-tasks.md)). Giving the Session back waits for the turn and the tasks,
  plus 30 seconds after the last task for its notification turn. Autopilot's Stop does not wait
  ([ADR-0050](../adr/0050-autopilot-user-stop-interrupts-orchestrator.md)).
- **The packaged binary** is named explicitly, because nothing can be spawned from inside `app.asar`
  ([ADR-0008](../adr/0008-claude-code-native-binary-path.md)).

#### Windows

The environment is rebuilt as a new sign-in builds it, so nothing of whoever started worfy reaches Claude Code. `bash.exe`
from the Path may be the WSL launcher, so Git Bash is found and passed in `CLAUDE_CODE_GIT_BASH_PATH`
([ADR-0057](../adr/0057-agent-environment-on-windows.md)). Node's `exit` event can come seconds late on Windows, so the wait
for a process also asks the system.

### Implementation

| What | Where |
| ---- | ----- |
| One Session: states, send, Interrupt, crash | `src/main/agent/session.ts`, `src/main/agent/session/` |
| The registry of live Sessions, the test agent | `src/main/agent/session/registry.ts`, `src/main/agent/app-registry.ts`, `src/main/agent/fake-query.ts` |
| Query options, MCP and skills lists, autocompact | `src/main/agent/options.ts` |
| Process environment | `src/main/agent/env.ts` |
| Queue, permissions, saved settings | `src/main/agent/queue.ts`, `src/main/agent/permissions.ts`, `src/main/agent/session-settings.ts` |
| Rules of Resume and closing | `src/main/agent/resume.ts` |
| Live Session Nodes, Orchestrator | `src/main/agent/node-sessions.ts`, `src/main/agent/orchestrator.ts` |
| Attachments | `src/main/agent/attachments.ts`, `src/shared/agent/attachments.ts` |
| Events, settings and channels | `src/shared/agent/events.ts`, `src/shared/agent/settings.ts`, `src/shared/ipc/agent.ts`, `src/shared/ipc/sessions.ts`, `src/shared/ipc/orchestrator.ts` |
| Handlers | `src/main/ipc/agent.ts`, `src/main/ipc/sessions.ts`, `src/main/ipc/orchestrator.ts`, `src/main/ipc/session-autocompact.ts` |
| Session view | `src/renderer/session/SessionView.tsx`, `src/renderer/session/MessageInput.tsx`, `src/renderer/session/navigation.ts` |
| Renderer store, the join of past and live events | `src/renderer/session/store.ts` |
| Cards | `src/renderer/session/PermissionCard.tsx`, `src/renderer/session/QuestionCard.tsx` |
| Items under the input field, found by glob | `src/renderer/session/composer/` |
| Nodes | `src/renderer/canvas/nodes/SessionNode.tsx`, `src/renderer/canvas/nodes/OrchestratorNode.tsx`, `src/renderer/canvas/overlays/SessionNodes.tsx` |
| Autocompact settings | `src/renderer/settings/SessionsSection.tsx`, `src/shared/settings/app-settings.ts` |
| Notifications | `src/main/notify.ts`, `src/renderer/session/notification-target.ts` |

**Data flow.** A window calls `agent.send`. The handler tells the input observers, checks the attachments and passes the
message to the Session, keeping the order of one Session's messages. The Session pushes it to the query's input, or to the
queue during a turn. Each SDK message becomes `AgentEvent`s in the shared schema that transcript files are parsed into. The
events go to every client on `agent.event`, and the renderer store keeps the newest 5000 per Session. `queue`, `settings` and
`context` events are not transcript rows: the store keeps only the latest of each.

**Main tests.**

- `test/contract/agent-session.test.ts`, `test/contract/agent-controls.test.ts`, `test/contract/agent-attachments.test.ts`: a
  Session over the fake agent.
- `test/contract/orchestrator.test.ts`, `test/contract/orchestrator-relaunch.test.ts`, `test/contract/node-sessions.test.ts`,
  `test/contract/permissions.test.ts`.
- `test/unit/agent-queue.test.ts`, `test/unit/agent-options.test.ts`, `test/unit/resume-rule.test.ts`,
  `test/unit/session-process-exit.test.ts`.
- `test/e2e/session-view.spec.ts`, `test/e2e/session-controls.spec.ts`, `test/e2e/permissions.spec.ts`,
  `test/e2e/session-question.spec.ts`, `test/e2e/session-resume.spec.ts`, `test/e2e/own-sessions.spec.ts`,
  `test/e2e/orchestrator.spec.ts`, `test/e2e/chat-attachments.spec.ts`, `test/e2e/context-meter.spec.ts`.

## Subagent

### Behaviour

A Subagent is an agent a Session started with the Agent tool, or one agent of a workflow script. worfy finds them for any
Session, wherever it was started, and shows them in two places.

**On the Canvas.** Each Subagent is a Node of 260 by 84 pixels to the right of its parent, and the Subagents it started are to
the right of it. It shows the name, type, model, status with the time it has run, and the first line of its final answer. A
reviewer's VERIFIED or REJECTED shows as a chip. A parent's done and interrupted Subagents fold into one "N done" row under
the running ones. A click opens the row, and that choice is not saved. These Nodes are not saved in the Layout and cannot be
moved by hand. They move with the Session's Node. A Subagent's Node dragged onto a Ticket or an Epic frame binds it, and the
Node goes back to its place.

**In the Session view.** The rail lists them newest first, with a "Done (N)" group that adds " · N interrupted". The group's
open state is kept per Session in the window's memory. With none there, the block says "No Subagents yet". A click opens the
Subagent's transcript, read-only.

**Status.**

| Status | When |
| ------ | ---- |
| `running` | No end is known and the Session runs |
| `done` | A task-notification or its workflow journal reports completion, a synchronous call returned, or the file's last answer ended the turn |
| `error` | A failed end or call, stopped by the user, or cut off when the Session's process or its workflow run ended |
| `interrupted` | No end is known, and the Session's running process started after its last record |

A Subagent without an end stays `running` however long its file has not changed, while its Session runs. The tooltip of
`interrupted` says that the process restarted after the agent's last record: "it was stopped from outside, not by a failure".
Elapsed time reads `45s`, `6m 05s`, `1h 02m`.

**Workflow scripts.** A run of a workflow script is an entry of type `workflow`, named by the script, with its agents under
it. A run resumed under the same id is shown once, by its latest call.

**Hide.** "Hide" on an entry hides it, whatever its status. Its children take its place. "Hide finished" hides everything that
has ended, and "Show hidden Subagents (N)" brings a Session's entries back. The rail says "Every Subagent is hidden" when
nothing is left. Hidden entries survive a restart, up to the latest 20 000 per Session.

#### On a Linked machine

The answer has to fit one link message. When it does not, the texts of results and answers are cut, first to 1000 characters,
then to 200, then to the summary line, and the answer says that it was truncated. With read-only access, Hide does not show.

### How it works

- **Several sources, one tree.** The Session's events and the files of its `subagents/` folder may each lack what the other has.
  So one record gathers both, joined by agent id or tool call id. A background Bash task also sends notifications, so only
  records with an Agent call, files or a Subagent type stay.
- **A closed Session ends its Subagents.** Its process is gone, so a Subagent without an end was cut off
  ([ADR-0031](../adr/0031-closed-session-ends-its-subagents.md)).
- **`interrupted` tells a restart from a failure.** The start time of the running process is compared with the Subagent's last
  record ([ADR-0085](../adr/0085-interrupted-subagents.md)). When whether a process runs cannot be told, the Session does not
  count as closed.
- **Workflow agents** take their label and their end from the run's `journal.jsonl`
  ([ADR-0035](../adr/0035-workflow-script-subagents-in-tree.md)).

### Implementation

| What | Where |
| ---- | ----- |
| Signals and the tree (pure) | `src/shared/transcript/subagents.ts` |
| Reading files, incrementally | `src/main/claude-home/subagents.ts` |
| Hidden entries, `hidden-subagents.json` in the Project's data folder | `src/main/claude-home/hidden-subagents.ts` |
| The answer for a Linked machine | `src/main/ipc/claude-home.ts` |
| Renderer state, fold, labels | `src/renderer/claude-home/subagents.ts` |
| Rail | `src/renderer/session/rail/SubagentsRail.tsx` |
| Canvas | `src/renderer/canvas/sources/subagents.ts`, `src/renderer/canvas/nodes/SubagentNode.tsx` |

**Data flow.** The renderer asks `claudeHome.subagents` every 2 seconds while a Subagent runs. `SubagentReader` reads only what
was appended to each file since the last call, adds `session-closed` when the Session's process is gone, and
`buildSubagentTree` makes the tree.

**Main tests.** `test/unit/subagents.test.ts`, `test/contract/claude-home-subagents.test.ts`,
`test/contract/claude-home-subagents-link.test.ts`, `test/unit/subagent-trees.test.tsx`, `test/unit/subagent-nodes.test.tsx`,
`test/e2e/subagent-tree.spec.ts`.

