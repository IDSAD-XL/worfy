# Sessions

Two Features. **Session** is one conversation with the agent of one Vendor, Claude Code or Codex. A **Subagent** is an agent that a Session started.
Transcript, Claude home, Memory and Limits are on the page [Transcripts and usage](transcripts-and-usage.md). Terms are
explained in [Concepts](concepts.md). Picking a Vendor, signing in to it and what a Codex Session offers are on [Vendors](vendors.md).

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

**Vendor.** Each Session runs on one Vendor's agent: Claude Code or Codex. A live Node keeps its Vendor next to its Session
id, and a Node saved before Vendors existed is Claude Code's. "New session" uses the Vendor it is given, else the Project's
default Vendor (`defaultVendor` in the Project's `settings.json`), else Claude Code. Start and Resume use the Node's
Vendor. "New session" refuses a Vendor this build does not run, or one nobody is signed in to, with the reason, before any
Node appears; the reason of one nobody is signed in to is `Sign in to Codex in Settings → Vendors`. Claude Code is not
asked again, because the first-run check already requires its sign-in. A sign-in check that fails or takes more than 15
seconds refuses nothing, and the Session then shows the Vendor's own error. A Node whose Vendor this build does not know
keeps it and refuses to start. The Orchestrator runs on the Project's default Vendor (see **Orchestrator** below). A Session that "Ship ticket" starts is always Claude Code, whatever the Project's default Vendor.

**Picking the Vendor and signing in.** "New session" in the sidebar opens the list "New session on", Settings → Vendors holds
each Vendor's sign-in, and a badge shows each Session's Vendor: all three are on [Vendors](vendors.md).

**Product Session.** A Product Session is a Session of kind `product`: the Product owner's advisor, apart from the
development Sessions. It starts from the "Product Session" button of the sidebar's Sessions section, next to "New session"
under its header, and from the command "New Product Session" of the Command palette. It offers no Vendor: a Product Session runs on Claude Code only, and `sessions.new`
refuses any other Vendor with `Product Session runs on Claude Code only`. The new Session opens in the Session view at
once. Its Node stays a Session Node on the Canvas, with the label "Product Session" under its header, and its name says
"Product Session" where a plain one says "Session" ("New Product Session" before its Session has an id).
Its screen, its limits, the Mind map, the critic and the share of accepted advice are on the page
[Product Session](product-session.md).

A Product Session in a Project also gets the MCP server `worfy-mind-map`; a plain Session and the Orchestrator never
do. Its tools `mind_map_read`, `mind_map_add`, `mind_map_update`, `mind_map_decide` and `mind_map_remove` read and
change `mind-map.json` of a topic folder in the Product Session folder (`docs/product/<topic>/`, in Silent mode
`<Workflow folder>/product/<topic>/`). main checks the whole file against its format before every write and writes it
atomically, one write at a time per file. A refused change is an error the agent reads, and the file stays as it was.
`mind_map_decide` keeps the earlier status and reason of a Decision in its history; `mind_map_remove` takes only a node
without children that is not a Decision; `mind_map_add` refuses a topic that has no folder yet. The Product Session
never runs git: its tool `product_save`, the Close of its Node and the archive of its Node (automatic or by hand) check `git status` of the Project's `docs/product/<topic>` folders and, when files there changed, send the Project's Orchestrator a
message with the changed files and the request to save them with a docs PR. The same changes are asked for once. With
no changes, and in Silent mode, nothing is sent; `product_save` answers "nothing to save" or "Silent mode: nothing to
save". While Autopilot runs the Orchestrator, nothing is sent and `product_save` says so.

**States.** A Session is in one of six states, shown as a chip.

| State | Chip status | Meaning |
| ----- | ----------- | ------- |
| `starting` | working | The process started. It becomes `idle` when the agent answers its start check: Claude Code about the account, Codex with its thread |
| `idle` | ready | Waits for a message |
| `busy` | working | A turn runs |
| `needs_permission` | blocked | A turn waits for an answer to a permission request |
| `error` | blocked | The process died or failed. The tooltip shows the end of its stderr |
| `closed` | done | The Session is closed |

The chip's text is the state's name: `needs_permission` reads "needs permission". The exception is a Live Session Node whose Session is not running: it reads "finished", or "new" before the first start.

**Sending.** Return sends, Shift+Return starts a new line. ↑ and ↓ in an empty field walk the history of sent messages.
The field grows to 200 pixels. An empty message without attachments is refused. A send that fails puts the text and the
attachment chips back into the field. "/" at the start of the field or after a space or a line break opens the menu of
the slash commands and skills that the Session's Vendor reports. The menu opens and closes as the caret enters or
leaves such a word, and stays closed while text in the field is selected. The whole word filters the menu, and a picked
command replaces only that word: the text around it stays. Escape closes the menu until the caret leaves the word. A
message that starts with a skill's name calls that skill. A Codex Session's menu is on [Vendors](vendors.md).

**Draft.** Text typed and not sent stays in the field as its draft. It is still there after another view, another
Session picked and back, another Project, or a restart of worfy. Line breaks are kept; the caret position is not.
Every Session has one draft in the Session view, whatever its Vendor, the Orchestrator and a Product Session too. The
field of a Session Node on the Canvas keeps its own. Sending clears the draft. A Node deleted or taken by the automatic
archive drops its drafts, and Undo does not bring them back. Drafts live in the window's storage inside worfy's data
folder, written a moment after the last keystroke and when the window goes. A draft over about 100 kB is cut to that
size there; the open window keeps it whole.

**Queue.** A message sent during a turn waits in a queue in main. The hint beside the send button says "Return to queue"
then. Messages go one per turn, each after the `result` of the previous turn. The chip "N queued" opens the list, where ×
removes a message. An Interrupt or a crash holds the queue: the list title changes to "Held after Interrupt", and nothing
goes until "Send queued". An empty queue is never held. A queue does not outlive its Session. The exception is the
Orchestrator, whose queue moves to the new process when Autopilot gives it back.

**Interrupt.** The Session view's button, or Esc in its input field, works in `busy` and `needs_permission`. Interrupt holds
the queue, cancels open permission requests and questions, and asks Claude Code to stop the turn.

**A crash.** The Session goes to `error`. The queue is held, open requests are cancelled and the background tasks are
forgotten. The next message starts a new process that continues the same conversation. If the old process still runs,
the new one starts only after it exits, or after the SIGKILL that worfy sends it 7.5 seconds after the message; the
message waits for the new process. An Orchestrator relaunched meanwhile hands that message to its new Session with the
queue.

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

**Sidebar and history.** The sidebar's Sessions section lists the live Sessions of the active Project, with "New session"
and the history. Under "All Projects" of the sidebar's Project switcher, the live Sessions of every other Project of the
Machine follow, each Project under its name. A click on one opens its Project first, then the Session (see
[App shell](app-shell.md)). Its rail icon counts the busy Sessions of the Projects the switcher shows. The history popover lists up to 100 past Sessions, newest first, each with Show and Resume, and its source: worfy,
desktop or terminal. Show puts a read-only Node on the Canvas, or goes to the Node the Session has. The title is the last
custom title, then the AI title, then the first prompt.

**Codex Sessions of the Project.** The Codex threads whose folder is the Project root, one of its worktrees or a folder inside
one of them are in the history too, as `terminal · Codex` or `worfy · Codex`. On Windows the folder is compared with either
separator and in any case. Codex keeps no list of its running Sessions, so while the Project is open worfy asks Codex again
every 30 seconds, and not at all without a Codex home folder; a Codex that does not answer stops the asking without an
error. The list of Sessions never waits for Codex: its threads come with a later answer, which the window asks for every
2 seconds while Codex gives its first list. A thread started outside worfy that changed in the last 10 minutes gets a read-only Node by itself, with the Codex
badge and the chip `unknown`; an older one gets its Node through Show. Its transcript is read from Codex and its answers are
labelled `codex`. Resume of such a Node, or of its history row, continues the same Codex thread on a live Node in its place;
for a thread worfy did not start it first asks "This Session may be open in a terminal", with Cancel and "Resume anyway".

**Model, effort and permission mode.** Three pickers sit under the input field and the header shows the current values.
The lists below are Claude Code's; a Codex Session's, and its permission requests, are on [Vendors](vendors.md).

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

**A window that missed the request.** A window that opened or reloaded after a request or a question went out asks main
for the open ones and draws their cards, so a Session at "needs permission" always has its card. The Node's badge then
tells a question ("Waits for answer") from a permission request ("Needs permission") as before. Should main have no open
request either, the chat says the Session waits for an answer this window cannot show; Interrupt refuses it.

**Attachments.** "+", a drop anywhere on the chat and a pasted image all add a chip. A message takes 20 attachments.

- Images: PNG, JPEG, GIF and WebP, up to 3.75 MB each.
- Files picked with "+" inside the Project go by their path, at any size.
- Files picked outside the Project, and every dropped file, are copied into the Project's data folder, up to 20 MB each.

**Comments on quotes.** In the Session view, text selected inside one agent answer, of Claude Code or Codex, can be
commented on. A button next to the selection says "Comment ⇧⌘M"; a right click (a two-finger click on a trackpad) opens
"Comment" and "Copy"; ⇧⌘M (Ctrl+Shift+M) does the same. A selection across two messages says "Select inside one message
to comment". The popover shows the quote, takes a text and up to 3 images (a file from "Add image", ⌘V, or a drop), and
saves with ⌘↵; Esc cancels. A comment may be images alone. The images of one message's comments are 10 at most, and an
image's long side is scaled down to 1568 pixels before main checks it.

- The quote gets a light green ground and a green underline: the accent in the dark theme, the ready dot's green in the
  light one. Hovering it shows the comment with Edit and Delete; Delete offers Undo.
- A new selection may not overlap a comment not sent yet: the button says "Overlaps a comment · Open it". Right next to
  one, or over a sent quote, it may.
- The tray above the input field says "N comments on M messages", with a chip per comment in text order and Clear. A
  chip's click scrolls to its quote and flashes it; its × removes the comment.
- Send sends one message, and the field may be empty then. The comments come first, in the order they stand in the
  agent's text: a numbered quote, the time of its message, the comment indented under it and an `[image N]` mark per
  image, then "General:" and the field's text. The comments' images are the message's first attachments, in that order.
  A quote over 200 characters is cut in the middle for the agent. A message that starts with `/` (a command) is refused
  while there are comments: send it alone, or clear the comments first. More than 10 images of comments are refused at
  Send too, however they came into the tray (Undo of a deletion as well).
- While the agent works, the message waits in the queue, and its comments wait with it: out of the tray and lit dimly.
  They become sent quotes when the message goes to the agent. A message the user removes from the queue (the × in the
  "N queued" list, or on the queued message in a Product Session's chat) puts its comments back in the tray, and a
  notice says so. A queue that empties otherwise (Autopilot's "Start now" keeps it for the person's Session) leaves them
  waiting for the message to go. A line above the input field says "Waiting to send · N comments" while they wait; its
  "Back to drafts" puts them back in the tray, and a prompt of that message that comes later counts nothing twice.
- The user's message draws a block per quote: a green bar, the quote folded to three lines with "Show all", the comment
  and its images. The window that sent it shows the whole quote, and the block's source line leads back to the quote. The
  block is read from the message's own text, so it is the same after a restart.
- A sent quote stays lit, dimly, in that Session; a click on it scrolls to its block. It leaves the tray and can no
  longer be edited. ↑ in the input field brings back the text typed after the comments, not the comments.
- The comments not sent yet survive another Session, another Project and a restart, as the field's draft does, and go
  with their Node when it leaves the Canvas or is archived. A Node keeps the comments of its three Sessions changed last,
  and a Session its 500 newest sent quotes. A read-only screen, with no input field, offers no comments.
- An image of a comment is kept in worfy's data folder when it is added (`attachments/images`, by the sha256 of its
  bytes); the comment names it, and no image bytes go into the window's storage. A round after a restart reads the image
  back from there; one that is gone is refused with "attach it again". When the window's storage refuses to save the
  comments, a notice says they stay in this window until it closes.

**Session view.** The second view of the window, beside the Canvas. Its header holds the title ("Orchestrator" or "Session"
and the Project), the Vendor badge of a Session Node, the state chip, the Session picker, Model, Effort, Permissions, Cost, Hide tools and Interrupt. Cost shows
a figure for the Orchestrator only: `$0.00`, with four decimals below a dollar. Other Sessions show a dash. A Product
Session's header also shows the share of accepted advice of its Project: "Advice accepted 3 of 5 · 60%", or "No advice
decided yet" while nothing is decided. It counts the Mind map nodes with `advice: true` of every topic, a Decision by its
status, and the objections of every critic's review in `critic/` by their `Owner decision:` lines; advice still waiting
is not in the share. A critic's objection is counted once, by its review: a Mind map node whose source is a file of
`critic/` is not counted, whatever its `advice`. The tooltip gives how many wait for a decision, in the Mind map and in
the critic's reviews, names the files it could not read, says that a decision written in a critic's review shows after
the next change of a topic, and says that the share counts the owner's decisions and is no measure of how good the
advice is. main counts it from the files on `product.share` and the header asks again on every `product.changed` of the
Project, so a `mind_map_decide` shows at once; a change of a critic's review alone shows with the next change of a topic
or the next open of the Session. Nothing of it is stored. The view shows
the Session opened last in this Project while its Node is on the Canvas, and otherwise the Orchestrator. The memory of that
choice lives as long as the window. The Session picker lists the Orchestrator first, then the running Sessions, then the
rest. Subagents are not in it.

**Context meter.** A ring under the input field. 100% is the autocompact threshold and the figure stops there. With
autocompact off, or with no threshold known, it shows Claude Code's own percentage, which may pass 100. It changes colour
at 60% and 85%. Before the first report it says "no data". The tooltip reads
`84.2K / 200K tokens · autocompact at 167K`, or ends in `autocompact off`.

**Autocompact window.** Settings → Sessions has three rows. The first two are the autocompact windows: Orchestrator,
whose window its Subagents use too, and Other Sessions. The third, "Live summary while the advisor works", is the switch of
a Product Session's live summary ([Product Session](product-session.md)). Each is "Claude Code default" or Custom, from 100K to 1M in steps of 10K. worfy's defaults are 400K and 500K. A
window the user has not chosen gives way to `autoCompactWindow` in `settings.json`. `CLAUDE_CODE_AUTO_COMPACT_WINDOW` in the
login shell overrides both rows, and the section says so. A running Session keeps its window until it starts again.

**Orchestrator.** The Project's main Session. The Node shows its state, model, summed cost and the last status block of its
answers.

- "New conversation" is refused in `busy` and while Autopilot runs. The old conversation stays in the history, and the
  cost starts from zero.
- When the Orchestrator opens, its saved Session is resumed. With the transcript gone, a new Session starts.
- It runs on the Project's "Default vendor" ([Project settings](projects.md)), Claude Code while none is chosen. A change
  of it applies from the Orchestrator's next start: "New conversation", or the next start of worfy. A saved Session of
  the other Vendor is not resumed then: a new one starts on the new Vendor, with that Vendor's default model and effort,
  and the old one stays in the history. The permission mode moves to its equivalent on the new Vendor: Bypass
  permissions and Full access, Accept edits and Auto, Ask before tools and Read only (Plan only becomes Read only). The
  Node keeps the old Session until the new one has started: when that start fails, a change back to the old Vendor
  resumes the old Session. A Codex Orchestrator shows its model and status block from its first answer after a start,
  not from its transcript.
- The Orchestrator modes — Eco mode, Auto-approval and Auto-continue — sit in one button under the Orchestrator's input
  field, "Modes". With Auto-continue on, worfy continues a turn of the Orchestrator that ended with a temporary API error
  or a refusal by the Limits, and a line over the input field counts down to the continuation. Both are on the
  [Orchestrator modes](orchestrator-modes.md) page. A regular Session has neither.
- Autopilot runs this Session unattended. On Codex a run is refused, with the reason, while the Harness's hooks are not
  approved in Codex's `/hooks`; see [Autopilot, During a run](autopilot.md#during-a-run). While it does, the permission
  mode is forced to Bypass permissions (Full access on Codex) and not saved, a mode change is refused, and permission
  requests and questions are refused at once.

**Notifications.** A system notification goes out when a Session finishes a turn, asks a permission or asks a question while
no worfy window has focus. A Session from a terminal or Claude desktop notifies when its status goes from busy to idle. One
Session sends at most one notification in 10 seconds. A click opens that Session.

#### On a Linked machine

- A Session in a Project local to one Machine is not visible to the other. A Linked machine starts Claude Code and reads
  files by path only inside the Projects of the Machine it connects to.
- "+" uses a hidden file input there, and the file travels as bytes.
- With read-only access, the input field, the pickers and the answers on the cards are inactive, with a tooltip that says
  why. The Session view does not open an Orchestrator there: it shows "No Orchestrator yet" when there is none.
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
- **The Orchestrator's Node keeps only the Session id, its Vendor and the cost.** Everything else comes from the transcript
  and the live events ([ADR-0010](../adr/0010-orchestrator-state-session-id-and-cost-only.md)). A Node without the Vendor
  is a Claude Code session.
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
| Query options, MCP and skills lists, autocompact | `src/main/vendors/claude/options.ts`, `src/main/vendors/claude/query.ts` |
| Codex slash menu: skills, `/compact`, `/review` | `src/main/vendors/codex/commands.ts`, `src/main/vendors/codex/session.ts` |
| Codex Sessions of the Project in the history and on the Canvas | `src/main/vendors/codex/sessions-on-canvas.ts`, `src/main/ipc/claude-home.ts`, `src/renderer/claude-home/session-nodes.ts` |
| Process environment | `src/main/agent/env.ts` |
| Queue, permissions, saved settings | `src/main/agent/queue.ts`, `src/main/agent/permissions.ts`, `src/main/agent/session-settings.ts` |
| Rules of Resume and closing | `src/main/agent/resume.ts` |
| Live Session Nodes, Orchestrator | `src/main/agent/node-sessions.ts`, `src/main/agent/orchestrator.ts` |
| Mind map tools and the save signal of a Product Session | `src/shared/product/tools.ts`, `src/main/mcp/mind-map-server.ts`, `src/main/product/save-signal.ts` |
| The share of accepted advice | `src/shared/product/share.ts`, `src/main/ipc/product.ts`, `src/renderer/session/ProductSessionPanel.tsx` |
| Attachments | `src/main/agent/attachments.ts`, `src/shared/agent/attachments.ts` |
| Events, settings and channels | `src/shared/agent/events.ts`, `src/shared/agent/settings.ts`, `src/shared/ipc/agent.ts`, `src/shared/ipc/sessions.ts`, `src/shared/ipc/orchestrator.ts` |
| Handlers | `src/main/ipc/agent.ts`, `src/main/ipc/sessions.ts`, `src/main/ipc/orchestrator.ts`, `src/main/ipc/session-autocompact.ts` |
| Session view | `src/renderer/session/SessionView.tsx`, `src/renderer/session/MessageInput.tsx`, `src/renderer/session/navigation.ts` |
| Drafts of the input fields | `src/renderer/session/drafts.ts` |
| Comments on quotes: the model and the agent's text, the store, the layer and the bubble | `src/renderer/session/quote-comments.ts`, `src/renderer/session/quote-store.ts`, `src/renderer/session/QuoteComments.tsx`, `src/renderer/session/QuoteCommentParts.tsx`, `src/renderer/session/QuotedPrompt.tsx`, `src/renderer/session/comment-image.ts` |
| Renderer store, the join of past and live events | `src/renderer/session/store.ts` |
| Cards | `src/renderer/session/PermissionCard.tsx`, `src/renderer/session/QuestionCard.tsx` |
| Items under the input field, found by glob | `src/renderer/session/composer/` |
| Nodes | `src/renderer/canvas/nodes/SessionNode.tsx`, `src/renderer/canvas/nodes/OrchestratorNode.tsx`, `src/renderer/canvas/overlays/SessionNodes.tsx` |
| Autocompact settings | `src/renderer/settings/SessionsSection.tsx`, `src/shared/settings/app-settings.ts` |
| Notifications | `src/main/notify.ts`, `src/renderer/session/notification-target.ts` |

The modules of the Modes menu, of Auto-continue and of the countdown are on the
[Orchestrator modes](orchestrator-modes.md#modules) page.

**Data flow.** A window calls `agent.send`. The handler tells the input observers, checks the attachments and passes the
message to the Session, keeping the order of one Session's messages. The Session passes it to its Vendor's SessionHandle, or to
the queue during a turn. The driver of the Vendor turns its agent's messages into `AgentEvent`s, the shared schema that
transcript files are parsed into ([Vendors](vendors.md)). The
events go to every client on `agent.event`, and the renderer store keeps the newest 5000 per Session. `queue`, `settings` and
`context` events are not transcript rows: the store keeps only the latest of each.

**Main tests.**

- `test/contract/agent-session.test.ts`, `test/contract/agent-controls.test.ts`, `test/contract/agent-attachments.test.ts`: a
  Session over the fake agent.
- `test/contract/orchestrator.test.ts`, `test/contract/orchestrator-relaunch.test.ts`, `test/contract/node-sessions.test.ts`,
  `test/contract/permissions.test.ts`.
- `test/contract/sessions-vendor.test.ts`: the Vendor of a Node and of a Project, Claude Code on the fake agent and Codex on
  the fake app-server, and what the Vendor list of "New session" offers.
- `test/contract/codex-sessions-on-canvas.test.ts`: the Codex threads of a Project's root and worktrees on the fake
  app-server, the Windows path rule, the 30-second limit and the `claudeHome` answers; `test/e2e/codex-sessions-on-canvas.spec.ts`:
  a Codex Session from a terminal, its transcript and Resume with the question.
- `test/unit/agent-queue.test.ts`, `test/unit/agent-options.test.ts`, `test/unit/resume-rule.test.ts`,
  `test/unit/session-process-exit.test.ts`.
- `test/e2e/session-view.spec.ts`, `test/e2e/session-controls.spec.ts`, `test/e2e/permissions.spec.ts`,
  `test/e2e/session-question.spec.ts`, `test/e2e/session-resume.spec.ts`, `test/e2e/own-sessions.spec.ts`,
  `test/e2e/orchestrator.spec.ts`, `test/e2e/chat-attachments.spec.ts`, `test/e2e/context-meter.spec.ts`.
- `test/unit/quote-comments.test.ts`, `test/unit/quote-store.test.tsx`, `test/unit/quote-comments-ui.test.tsx`,
  `test/contract/agent-quote-comments.test.ts`, `test/e2e/quote-comments.spec.ts`: comments on quotes.

## Subagent

### Behaviour

A Subagent is an agent a Session started with the Agent tool, or one agent of a workflow script. worfy finds them for any
Session, wherever it was started, and shows them in two places. The Subagents of a Codex Session come from Codex's own
threads, with no transcript to open. They show the same way, but their statuses are read from Codex, as
[Vendors](vendors.md) describes; the table of statuses and How it works below are Claude Code's.

**On the Canvas.** Each Subagent is a Node of 260 by 84 pixels to the right of its parent, and the Subagents it started are to
the right of it. It shows the name, type, model, status with the time it has run, and the first line of its final answer. A
reviewer's verdict shows as a chip: the first line of its answer that starts with VERIFIED or REJECTED, bold, a heading mark or a
backtick in front of the word included, a fenced code block left out. A sentence above that line is skipped, in the chip and in the first line shown; a word inside a
sentence or behind a label is no verdict. A parent's done and interrupted Subagents fold into one "N done" row under
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

