# Product Session

A Product Session is a Session that advises the Product owner instead of writing code: it suggests, argues with a plan,
drafts Epics and records the conversation on a Mind map. The human decides. This page has three sections: Product Session
covers the Session itself and its limits, Mind map covers the live map of its conversation, and Critic, ideas and the
share of accepted advice covers the agents and the count around it. Terms are explained in [Concepts](concepts.md);
what every Session has in common is on [Sessions](sessions.md).

## Product Session

### Behaviour

**What it is for.** A Product Session advises the Product owner, the person who runs the product alone. It maps a product
question, asks the owner questions one at a time, looks facts up, makes a throwaway prototype, writes Epic drafts and
argues: every objection it raises rests on a fact. Which Epics exist and in what order they run is the owner's call: the
Product Session suggests and never queues an Epic. There are no product analytics, so it says so instead of guessing
how a feature is used.

**Opening one.** "Product Session" is a button of the sidebar's Sessions section, next to "New session" in the row
under its header (its name for a screen reader is "New Product Session"), and "New Product Session" is a command of the
Command palette. Neither offers a Vendor: a Product Session runs on Claude Code only, and any other Vendor is refused with
`Product Session runs on Claude Code only`. The new Session opens in the Session view at once. Its Node stays a Session
Node on the Canvas, with the label "Product Session" under its header. On a read-only screen of a Linked machine the
entry is inactive.

**Model.** A Product Session always runs on the strongest model, `opus`, and starts at the highest effort. Its input
field has no model picker, and a change of the model is refused. Eco mode does not reach it, and its input field has no
Modes menu: that menu belongs to the Orchestrator.

**The screen.** The Session view of a Product Session is built as the owner's prototype draws it. Its header, 48 px on
the toolbar's background, holds a violet "Product Session" label, "Product Session" and the topic of the Mind map (the
Project's name until a topic is known), the Vendor, the state, the Session switcher, the share of accepted advice (see
the last section) and Interrupt. The share shows only once the Project has advice, decided or not. It has no Model,
Effort, Permissions, Cost, "Hide tools" or layout switch. Its body is three parts side by side:

| Part | What it holds |
|---|---|
| Mind map, on the left | The Mind map of the topic the advisor works on (next section) |
| Chat, on the right | The conversation with the advisor and the input field |
| Agents strip, at the right edge | Four buttons: Agents, with the number of the Session's Subagents (hidden ones left out) on a violet badge; Critic; Idea generator; Drafts, with the number of drafts when there are some |

- The divider between the Mind map and the chat starts at 60 / 40. It moves with the mouse, with ← and → in steps of
  5 %, and with Home and End to its edges. A double click puts it back to 60 / 40. Each side keeps at least 10 %.
- The split is one per Machine. It is saved in the app settings when a drag or a key press ends, so every window and the
  next start of worfy show it.
- A click on the agents strip widens its column to 300 px and the chat narrows; nothing covers the chat. The column
  lists the Session's agents, the hidden ones left out: a status dot and a name, the task under them, and the state on
  a muted line of its own with its time, such as "working · 1 min · 3 objections" or "done · 4 min ago". A running
  agent shows how long it has worked ("under 1 min" in its first minute), a finished one how long ago it ended ("just
  now" in the first minute); an agent with no time known shows none. `worfy:critic` reads "Critic",
  `worfy:product-ideas` "Idea generator", any other Subagent its type. The states are "working", "done", "error" and
  "interrupted". The critic's number of objections comes from the review it wrote, read from its transcript; until it
  has written one, no number shows. The working agents come first, the later started higher, each nested agent under
  its parent. Escape or "›" closes the list. The rail blocks of a plain Session are not shown: a
  Product Session is bound to no Ticket and no Epic.
- The other three buttons open their own panel in the same 300 px column. One panel is open at a time: another button
  switches to its panel, the same button, "›" or Escape closes it.
  - Critic shows the review the Session's last critic wrote: its state line with the number of objections, the file
    name and the review, from its last Write that ended well. It is read from the critic's own transcript, so a
    review written outside this Session (by the Orchestrator's critic, or edited by hand) is not shown. With no critic it reads "No critic in this Session yet";
    before the review, "No review written yet".
  - Idea generator shows the Session's last `worfy:product-ideas` agent: its task, its state line and its last answer.
    With none it reads "No idea generator in this Session yet"; before an answer, "No ideas written yet".
  - Drafts lists the advisor's drafts (`<topic>/drafts/*.md`) that the loaded part of the chat wrote or edited, the
    last written first, each with its topic and how many times it was written. A click shows the text of its last
    Write, with a note when an Edit came after it. Only a Write or Edit whose result says it ended well counts: a call
    refused in the permission card or by Claude Code, a failed Edit and a call still waiting for its result do not.
    The same file written by an absolute path or one relative to the Project is one draft. A draft written before the loaded part of the chat, or by hand, is
    not listed. With none it reads "No drafts in this chat yet".

**The chat.** It is headed "Conversation with the advisor", with the Vendor as a small bordered tag, and shows the
conversation only. The heading stays on one line: a narrow chat cuts its words with "…", and the Vendor tag stays whole.
The input field keeps about 126 px in a chat as narrow as the agents list leaves in a 1160-wide window:

- The owner's messages are bubbles at the right edge, under "You", the time and the message's number in the chat
  ("#1"). The advisor's answers are bubbles at the left edge, under a violet "A", "Advisor", the time and the number.
  The numbers count the messages the view has read: with "Load earlier" not pressed, they start at the first message
  loaded. The chips of Mind map nodes stand under the message that made them.
- A turn that failed shows its error, an interrupted turn shows "Interrupted", and an error of the Session shows too.
  Permission requests and questions with options, the advisor's own and its Subagents', are cards in the chat, as in
  any Session. They stay inside the narrowest chat, and a window that reloaded while one was open draws it again.
- Thinking, tool calls and their output (a failed call too), Subagents, hooks, Claude Code's notices and the messages it
  adds, "Turn finished" and slash commands are not shown. The whole log is in the Flight Recorder.
- While a turn runs, one status line stands at the end of the chat: what the advisor is doing right now and how long this
  step has taken, for example "Reading map.md · 4 s". It changes at each step and goes when the turn ends. A tool call
  that has not answered names the step: the tool as a verb and its main argument made short, a file by its name
  without the path ("Writing roadmap-section.md", "Searching the files for “pricing”", "Searching the web for …").
  The Mind map tools read as "Reading the roadmap Mind map", "Adding an idea to the Mind map", "Recording a decision
  on the Mind map"; `product_save` as "Asking to save the work"; qmd as "Searching the docs". A Subagent shows its type
  and description ("Critic is reviewing: Review the roadmap draft"); what it does inside does not change the line. A
  tool worfy does not know reads "Using <name>". Thinking, and the time between a tool's answer and the next step,
  read "Thinking…"; the answer as it comes, "Writing the answer". The line is derived from the Session's events only:
  the advisor is not asked for it. There is no switch to show the details.
- Under the status line, a live summary: the last one to three short lines, oldest first, of what the advisor is doing
  and why, for example "Compares three sources on competitor prices to size the niche". They are dimmed, small and
  tagged "summary", with the tooltip "Short summary by Haiku while the advisor works". worfy asks Haiku for a line
  once the turn has run 20 s, then at most once every 30 s and only when the advisor did something since the last
  line. A line is at most 120 characters, in the language the owner writes in (English when Haiku cannot tell). The
  lines are not chat messages: they are not in the transcript or the Session's history, and they all go when the
  answer comes, the turn is interrupted or it fails. If a request fails, hits a limit or the login has no Haiku, the
  summary stays silent for the rest of the turn and the chat shows no error. Settings → Sessions → "Live summary while
  the advisor works" turns it off; it is on by default, and off means no request to Haiku at all.
- Find (⌘F) looks only in what the chat shows, and only in the messages the view has read: the part of the transcript
  file behind "Load earlier" is not searched, and the find bar then says "Earlier messages not loaded".
- The input field is one line, as in the prototype: the attach button, a field in the interface font, Interrupt while a
  turn runs, and a text "Send" button. It keeps attaching a file or a picture. It has no pickers, context meter, queue
  chip or hints.
- A message sent while a turn runs waits in the Session's queue, and the chat shows it at once: the owner's bubble,
  dimmed, with "queued" and no number, last in the chat, below the status line and below whatever the advisor
  writes meanwhile. Several wait in the order sent. Once the turn ends, worfy gives the next one to the advisor, and it
  becomes an ordinary message with its number. "×" takes a queued message out before it is sent.
- Interrupt, or a crash of the agent's process, holds the queue: its messages say "queued · held", and "Send queued"
  under the last of them lets the queue go again. A message sent after Interrupt goes at once and does not free the
  held ones. When the Session is closed, its queued messages are never sent: they stay last in the chat, marked
  "not sent".

**What it may not do.** A Product Session changes no code, takes no Tickets, starts no Autopilot and never changes the repository with git.
Three layers hold this, all for Claude Code:

| Layer | What it refuses |
|---|---|
| The PreToolUse hook | `Edit`, `MultiEdit`, `Write` and `NotebookEdit` outside the Product Session folder unless the owner allows it (below), and outside it in `.git`, worfy's data folder and `~/.claude` always; in `Bash` and `PowerShell`, the Ticket CLI `bin/ticket`, `git add`, `commit`, `push`, `merge`, `rebase` and `reset`, `gh pr create` and `gh pr merge`, `pnpm` and `npm` |
| The canvas server | `autopilot_start`, with "A Product Session does not start Autopilot: it advises and drafts Epics. Ask the Orchestrator of the Project to run the Epic." |
| The rules of the Session | The same limits in words, and the ones the hook cannot see |

- Each refusal carries a reason that the agent reads. The hook refuses in every permission mode, `bypassPermissions` too.
- The Product Session folder is `docs/product/` of the Project in Full mode and `<Workflow folder>/product/` in Silent
  mode. When it cannot be found, every file write is refused.
- A file write outside that folder is a question, not a refusal: the chat shows the permission card "Product Session
  wants to write <path>" with **Allow once**, **Always allow in <folder>** and **Deny**, in every permission mode,
  `bypassPermissions` too. Allow once lets this write through; Deny refuses it, and the agent reads that the owner
  denied it. Always allow in <folder> lets it through and adds the file's folder (not the whole repository) to the
  Project's list "Product Session may also write here"; a later write anywhere below that folder goes without a
  question, a write next to it is asked about again. The list lives in worfy's own settings of the Project
  (`<Project data folder>/settings.json`), not in the Profile; Project settings shows it, one row per folder with
  Remove, and a removal takes effect on Save. A path is judged by where it really leads: `..` or a link out of a listed
  folder is asked about where it lands.
- Never asked, always refused with the reason: a write outside the Product Session folder into `.git` of any repository,
  into worfy's data folder (of both builds, `worfy` and `worfy-dev`) and into `~/.claude` (the Harness in it included);
  Always allow never lists them. Written as `/System/Volumes/Data/…` on macOS, such a path is the same place and is
  refused too. The Product Session folder itself is written as always, also when it lies in one of them (Silent mode's
  `<Workflow folder>/product/` is in `~/.claude/worfy-harness/`). An unattended Session has no one to ask:
  a write outside the folder and outside the list is refused, as before.
- A shell command is read as the shell reads it: a word in quotes is one word (`grep "pnpm"` searches,
  `git -C "a b" commit` commits), and `$(…)`, backticks, `bash -c` and `eval` are read as commands too. Reading
  commands such as `git log`, `gh pr view` and `epic-status` go through. This is not a sandbox: a command that writes in
  a way the hook does not know goes through, and only the rules name that limit: the rules allow files outside the
  folder only through `Write` or `Edit`, where the owner is asked, and never through the shell (`cp`, `mv`, `>`, `tee`).

**Its rules.** At its start a Product Session gets the Harness rules `product` and the common rules, not the Orchestrator
rules. They give the process: map the topic with `worfy:wayfinder`, ask with `worfy:grilling`, look facts up with
`worfy:research` (the note goes into the topic folder), prototype with `worfy:prototype` as one HTML file or a Markdown
outline in the topic folder, and write an Epic draft with `worfy:to-spec` into `drafts/<epic>.md` of the topic, with
`Advisor draft` as its first line under the title. The owner accepts a draft, and the Orchestrator then moves it.

**Saving.** A Product Session's files are new or changed files in the Project's working tree until someone commits them,
and the Product Session never does. Three events give the save signal: the owner says "save" and the agent calls
`product_save`, the user closes the Node, or the Node is archived, by hand or automatically.

| Situation | What happens | `product_save` answers |
|---|---|---|
| Full mode, files under `docs/product/` changed | The Project's Orchestrator gets a message: the changed files, their topics, and the request to save exactly these files with an ordinary docs PR without touching other changes. A busy Orchestrator gets it after its turn | `Asked the Orchestrator to save …` with the files |
| The same files with the same contents asked for before | Nothing is sent again | `The Orchestrator was already asked to save these changes; nothing new to save.` |
| No changes | Nothing is sent | `nothing to save` |
| Silent mode | Nothing is sent: the folder is outside git | `Silent mode: nothing to save` |
| Autopilot runs the Orchestrator | Nothing is sent | `Autopilot runs the Orchestrator now: nothing was sent. …` |

### How it works

**A Session of a kind, not a new Node.** A Product Session is a Session Node whose data carries `kind: 'product'`. The
Node stays a Session Node, so the Canvas, the Layout and the sidebar treat it as any other. Every start of the Node, Start,
Resume or after a restart, reads the kind from the Node and starts the Session with it. A Node of a kind this build does
not know keeps its kind and refuses to start.

**The limits travel with the kind.** The kind reaches the Claude Code driver. There it adds the PreToolUse guard,
`WORFY_SESSION_KIND=product` in the environment of Claude Code, the Mind map server, and a canvas server without the
Autopilot starter. The rules hook of the Harness reads the variable: with it, the `product` rules print and the
`orchestrator` rules do not. The guard fails closed: input it cannot read, a folder it cannot resolve or an error of its
own is a refusal.

**A file write is judged twice.** The target must lie below the Product Session folder both as written, with `..` folded
and in the same case, and as it really leads, with every link and junction followed. On Windows, a name the system
rewrites before it opens a file (`x.`, `x:stream`, a short `PRODUC~1` name) is refused too. The folder and its layout are
in [ADR-0101](../adr/0101-product-session-folder-and-mind-map.md).

**The live summary is not a Session.** main follows the turn's events and sends Haiku a digest of the turn: the owner's
message, the latest tool calls with short inputs, the latest text and thinking, and the summary's previous lines, 5000
characters at most. Each request is a single Agent SDK `query()` under the owner's own
Claude Code login, never an API key: model `haiku`, no thinking, no settings, no MCP servers, no tools, one turn, no
transcript, in an empty folder of worfy's own outside every Project. Sessions never run on haiku; the live summary
does, as it is not one. The limit is per Product Session: each runs its own live summary, never two of its requests at
once, and there is no limit across the app. The end of the turn aborts a request still out, and its answer is dropped.
The lines reach the windows as events of their own, which the window keeps beside the transcript, not in it; each line
keeps its number in the turn, so a screen reader hears only the new one.

**Saving without git.** main runs one read, `git status --porcelain=v2` of `docs/product` in the Project root, and
commits nothing. It remembers a fingerprint of the files it last asked about, path and contents, per Project, so the same
changes make one message. One signal runs at a time per Project.

### Implementation

| Module | What it holds |
|---|---|
| `src/shared/ipc/sessions.ts` | The kind `product`, the one Vendor of a Product Session and its refusal text |
| `src/main/agent/node-sessions.ts` | "New session" of a kind, the kind on every start, the save signal on Close and archive |
| `src/main/agent/session-settings.ts` | The model `opus` and the highest effort, the refusal of another model |
| `src/main/agent/product-guard.ts` | `productToolDecision`: the file and shell rules of a Product Session |
| `src/main/vendors/claude/options.ts` | The PreToolUse hook with the guard, `WORFY_SESSION_KIND`, the Mind map server |
| `src/main/vendors/claude/query.ts` | The Product Session folder of the Project, the Mind map server for a Product Session only |
| `src/main/mcp/canvas-server.ts` | `autopilot_start` refused in a Product Session |
| `src/main/product/save-signal.ts` | `SaveSignal`: the `git status` read, the message to the Orchestrator, the answers |
| `src/shared/product/paths.ts` | `productFolder` and the names of a topic folder |
| `src/renderer/shell/sidebar/SessionsSection.tsx`, `src/renderer/palette/commands.ts` | The two entries "New Product Session" |
| `src/renderer/session/SessionView.tsx`, `src/renderer/session/ProductSessionPanel.tsx` | The header, the body, the chat's heading and the agents strip |
| `src/renderer/session/ProductAgentsList.tsx`, `src/renderer/session/product-agents.ts` | The agents list: names, states, the critic's objections |
| `src/renderer/session/ProductRailPanels.tsx` | The Critic, Idea generator and Drafts panels of the strip |
| `src/renderer/session/product-session.ts` | `shownInProductChat`: the rows the chat shows; the input field's items it leaves out; `chatQueue`: the queue as the chat draws it |
| `src/renderer/session/Transcript.tsx`, `src/renderer/session/session.css` | The chat as bubbles |
| `src/renderer/session/advisor-status.ts`, `src/renderer/session/AdvisorStatus.tsx` | The status line: the step from the latest events, and its time |
| `src/main/agent/narrator.ts`, `src/main/agent/app-narrator.ts`, `src/main/vendors/claude/narrator.ts` | The live summary: when to ask, the digest, the switch read before each request, and Haiku's request |
| `src/renderer/session/Narration.tsx`, `src/renderer/settings/SessionsSection.tsx` | The live summary under the status line, and its switch |
| `src/renderer/session/QueuedMessages.tsx` | The queued messages at the end of the chat, "Send queued" and "×" |
| `src/renderer/session/MessageInput.tsx`, `src/renderer/session/transcript-find.ts` | The one-line input field, find over the rows shown |
| `src/renderer/session/SplitDivider.tsx` | The divider |
| `src/shared/settings/app-settings.ts` | The saved split, `productSession.split`, and the live summary switch, `productSession.liveSummary` |
| `harness/hooks/rules/product.md`, `harness/hooks/inject-rules.mjs` | The rules of a Product Session and their choice by the variable |

**Main tests:**

- `test/contract/node-sessions.test.ts`, `test/contract/sessions-vendor.test.ts`: the kind on every start and the
  Vendor refusal.
- `test/unit/product-guard.test.ts`, `test/unit/agent-options.test.ts`: the file and shell rules, the hook and the
  environment.
- `test/contract/canvas-tools.test.ts`: `autopilot_start` in a Product Session, the Product Session folder by mode.
- `test/contract/product-save-signal.test.ts`: the save signal and its answers, also on Close and archive.
- `test/unit/product-transcript.test.tsx`, `test/unit/session-view.test.tsx`: the rows the chat shows and hides, the
  bubbles, the status line, the queued messages, find, the header and the input field against a plain Session.
- `test/unit/advisor-status.test.tsx`: the status line of each kind of step, short arguments, its time and when it
  starts again.
- `test/unit/product-session-panel.test.tsx`, `test/unit/session-node-product.test.tsx`: the screen, the divider, the
  strip, its four panels and the Node.
- `test/e2e/new-product-session.spec.ts`: the Command palette entry in the running app.
- `test/e2e/product-session.spec.ts` (question and permission cards), `test/unit/waiting-requests.test.tsx`,
  `test/contract/permissions.test.ts` (`agent.requests`): the cards of the Session and its Subagents in the narrow chat,
  and the open requests a reloaded window asks main for.
- `test/e2e/product-session.spec.ts`: in the running app, the status line names the steps of a scripted turn (a file
  read, then the critic) and goes when the turn ends.
- `test/unit/narrator.test.ts`, `test/unit/narrator-options.test.ts`: the live summary's cadence, its stop at the end
  of a turn, the switch, the digest and its cap, a failure that silences the turn, and the options of Haiku's request,
  all against the fake agent; `test/e2e/product-session.spec.ts`: the lines under the status line and their end with
  the answer in the running app.

## Mind map

### Behaviour

**A topic is a folder.** One product question is one topic, in its own folder of the Product Session folder:

```text
docs/product/
  onboarding-flow/          a topic
    map.md                  the map of the topic, written by worfy:wayfinder
    issues/01-pricing.md    the Tickets of the map: the large nodes of the Mind map
    mind-map.json           the small nodes, their places and folded branches
    drafts/<epic>.md        Epic drafts
  critic/                   the critic's reviews; never a topic
```

A topic name is one folder name of letters, digits, `.`, `_` and `-`, up to 80 characters. It is never `critic` and
never a Windows device name such as `CON`.

**Nodes.** The topic is the root and the Tickets of its map are the large nodes. Each node of `mind-map.json` is one of
four kinds, and an arrow leads to it from the node it grew from:

| Kind | Mark | Shape | What it needs |
|---|---|---|---|
| Idea | ✦ | Pill | A text |
| Question | ? | Hexagon, dashed outline | A text |
| Decision | ✓ accepted, ✕ rejected | Box | A status and a reason |
| Objection | ! | Slanted box | A source: the fact it rests on, such as a path, a Ticket, a PR or a URL |

A rejected Decision stays on the map, struck through, grey and faded, with a dashed outline. A Decision that overturned
an earlier one has a red dashed "Replaces" arrow to it. The legend under the map shows each kind's shape and both arrows.

**Which topic shows.** A Product Session is bound to no topic. While the Session view is open, the Mind map follows the topic
of the Project whose files changed last; that following is live in this window only. The last topic is remembered per Node
on this Machine and shows again when the Session is opened once more. Until then it says "The Mind map
appears once the advisor adds its first node". When the topic cannot be read, it says "Could not read the Mind map:"
and the reason.

**Looking at it.**

- The toolbar has the view switch "Tree · Graph", "Hide rejected", "Move nodes", "Prettify", "−" (zoom out), the zoom
  percent, "+" (zoom in) and "Fit". It stays one row: a narrow map tightens its gaps, and a row that still does not fit scrolls sideways. The wheel zooms, from 10 % to 250 %, and a drag of the background pans.
- When the map's area changes size (the window, the divider beside the chat), the map fits into it again. After the
  owner zooms or pans by hand, the map keeps that view instead; "Fit", or another topic or view, fits it again.
- A node is as tall as its text needs, measured in the app's font, up to four lines; a longer text ends in "…", and
  the node's card shows it whole.
- "Tree" is the default: a tidy tree with text of 15 px that grows left to right, the topic at the left, each node to
  the right of the node it grew from. "Graph" is radial, with text of 12 px: the topic in the middle, the branches
  around it, straight "grew from" arrows, no node over another; the same map always gets the same layout. The view is
  remembered per topic on this Machine.
- "Hide rejected" hides the rejected Decisions and the branches under them while the map is open. The file does not
  change.
- The legend can be collapsed.
- A click on a node opens its card beside the node: to its right, to its left where the right has no room, under or
  above it where neither side has, always inside the map. The card shows the kind and status as a pill (struck through
  for a rejected Decision), text, Reason, Source, History (every status of a Decision, oldest first, the one that
  rejected it in red; "step 5: …" names each by its message's number in the chat when the chat has loaded every
  one of them, else the list is numbered 1, 2, …), Grew from (a link to the parent's card), Message (where the node appeared)
  and Changed by (the message of each later status). A message the chat has loaded is quoted: "#2 Advisor: “…”", its
  start cut to 60 characters, the number a link to it; any other reads "Show in the chat". The card of a map Ticket shows its Status
  and its file. The card of a node of `mind-map.json` says "To change this node, ask the advisor in the chat."
- Tab moves between nodes, Enter or Space opens a card, Escape closes it. Closing the card (Escape, its "×", a click on
  the empty map) takes the ring off the chat's message.

**By hand.** The owner only moves nodes and folds branches; what a node says is the advisor's, and the card has no field
to type in.

- Nodes move only while the "Move nodes" toggle (a hand icon) is on. It is off each time the map opens and when it
  shows another topic, and it is not remembered. While it is off, a drag on a node pans the map, as a drag of the
  background does; a click on a node still opens its card, and folding still works.
- With "Move nodes" on, a node of `mind-map.json` can be dragged; the topic and the map Tickets cannot. In "Tree" its
  new place is saved in the file. In "Graph" a drag moves the node only until the map is laid out again (a node added, a text changed, a
  branch folded, the view switched) and saves nothing; "Graph" also ignores the places saved in the file, which are
  "Tree" places.
- The fold mark of a node with children, or ← and → on the node, folds and unfolds its branch. A folded mark tells how
  many nodes it hides. The fold is saved in the file.
- "Prettify" lays the view shown out again. In "Tree" it drops the places saved in the file for every node of the topic,
  hidden ones included, in one write through the same writer as a drag. The map has no undo, so it asks first in the
  toolbar: "Drop N moved places?" with "Prettify" and "Cancel". The focus goes to "Cancel", and Escape closes the
  question as "Cancel" does; once it closes, the focus is back on "Prettify", or on "Move nodes" when nothing is left to
  drop. In "Graph" it drops the moves made since the last layout at once, without asking, and leaves the file alone.
  Then the map fits into view as "Fit" fits it. The button is inactive while the view has no place moved by hand.
- When the change cannot be saved, the map says "Could not save the change:" and the reason, and the places stay.

**Chips in the chat.** A node that a `mind_map_add`, `mind_map_update` or `mind_map_decide` call wrote gets a chip
under the message that made it: the last message of the turn shown before the call. A call after an answer puts its
chip under that answer; a call before any answer of the turn puts it under the owner's message that started the turn.
One message shows a node once, as its last call there left it. A turn none of whose rows is shown (the loaded part
starts in its tool calls) shows its chips under the next message, or at the end of the chat. A chip is a pill with a
small square of the node's kind colour and a muted line that names the kind: "+ Idea: …", "+ Question: …",
"+ Decision ✓: …", "+ Decision ✕: …", "+ Objection: …" for a node the call added, the same without "+" for a node it
changed. A `mind_map_decide` that turned a Decision's status the other way shows a red chip, "↺ “…” → rejected". A chip is never wider than the chat: a text that does not fit ends in "…". A click on a chip selects the node on the
Mind map, brings it into view and rings the message the chip stands under; the chat does not move. A
hidden node is shown first: "Hide rejected" is turned off and the folded branches above it unfold. Pointing at a chip or
focusing it lights its node; pointing at a message lights the nodes of all its chips. "Show in the chat" on a card
scrolls the chat to the message that carries the node's chip.

**Live.** A change of a topic's files redraws the Mind map without a reload: a tool call, an edit by hand, another
agent's write. A file that fails the format check is not shown as empty: a line above the map names the file and each
error with the id of its node. The root and the map Tickets still show, and the nodes of the file do not until it is
mended.

#### On a Linked machine

On a read-only screen the map can be looked at, but nodes do not move and branches do not fold: "Move nodes" and
"Prettify" are inactive and their tooltip says why. A chip whose node is
inside a folded branch selects the folded node above it, and a note says why.

### How it works

**The agent's tools.** Only a Product Session gets the MCP server `worfy-mind-map`; a plain Session and the Orchestrator
never do. It is the only way the agent changes a Mind map:

| Tool | What it does |
|---|---|
| `mind_map_read` | Lists the topics, or reads one: its map Tickets, its nodes and its format errors |
| `mind_map_add` | Adds a node to a topic that already has a folder; a Decision with its status and reason, an Objection with its source |
| `mind_map_update` | Changes the text, kind, source or `advice` of a node; a node becomes a Decision only through `mind_map_decide` |
| `mind_map_decide` | Makes a node a Decision, `accepted` or `rejected` with the reason; the earlier status and reason go to its history |
| `mind_map_remove` | Removes a node added by mistake: one without children, never a Decision |
| `product_save` | The save signal of the first section |

A refused call changes nothing, and its error is a result the agent reads. A new topic starts with its `map.md`, which
the agent writes with `Write`.

**One check, one writer.** One function checks the whole file: a node's fields, two nodes with one id, a parent that is
neither a node nor a Ticket of the map (`ticket:02`), a cycle, `replaces` on anything but a Decision, a Decision without
a status or a reason, an Objection without a source. The tools run it before they write and the screen runs it when it
reads. main is the only writer of `mind-map.json`: the tools and the owner's drag, fold and "Prettify" go through the same writer. It
writes one change at a time per file, atomically, and never overwrites a file that already fails the check. On Windows,
while another process holds the file open, it tries again for a second and then writes into the file in place.

**Where a node came from.** A node keeps in `message` the id of the chat message whose tool call wrote it, when that
message is known. The chips come from the transcript itself: every `mind_map_add`, `mind_map_update` and
`mind_map_decide` call answers the node as written. Nothing new is stored for them.

**Live redraw.** The watch of the Project's documents also follows the topic folders and reads a topic 50 ms after its
last event; the screen gets `product.changed`. The watch is described on [Projects](projects.md).

**Layout.** The Mind map is drawn with React Flow. ELK lays out "Tree" in the window's Web Worker with `mrtree`; until
ELK answers, a quick tree layout draws it. "Graph" is laid out at once in the window by the prototype's algorithm: the
leaves spread round the topic, each parent at the mean direction of its children, then springs on the arrows and
pushes between boxes, and a last pass that moves a node straight away from the topic until it overlaps no other; it
runs once per change of what it reads (the nodes, their parents, texts, kinds and fold marks). In "Tree" a node with `x`
and `y` in the file stands where the file says; a place written before the Tree grew left to right (without `"placed": 2`) is ignored and the node is laid
out again.

### Implementation

| Module | What it holds |
|---|---|
| `src/shared/product/mind-map.ts` | The format of `mind-map.json` and `checkMindMap` |
| `src/shared/product/tools.ts` | The tools of `worfy-mind-map`: names, argument shapes, descriptions |
| `src/main/mcp/mind-map-server.ts` | The server, `MindMapWriter` and the message of each call |
| `src/main/mcp/agent-instructions-mind-map.md` | What the agent is told about the Mind map |
| `src/main/product/topic.ts` | `readTopic`: the map, its Tickets and the nodes of a topic |
| `src/main/docs/watch.ts` | The watch of the topic folders |
| `src/shared/ipc/product.ts`, `src/main/ipc/product.ts` | `product.topic`, `product.changed`, `product.layout` and `product.share` |
| `src/renderer/product/useMindMap.ts` | One topic kept current in the window |
| `src/renderer/product/MindMap.tsx`, `src/renderer/product/mind-map-layout.ts` | The map, its card, drag and fold, and its layout |
| `src/renderer/product/NodeChips.tsx`, `src/renderer/product/node-chips.ts`, `src/renderer/session/Transcript.tsx` | The chips under a message, the light on the Mind map |

**Main tests:**

- `test/unit/product-mind-map.test.ts`, `test/unit/product-topic.test.ts`: the format and the reading of a topic.
- `test/contract/mind-map-tools.test.ts`: every tool, its refusals and the writer.
- `test/contract/product-watch.test.ts`, `test/unit/product-use-mind-map.test.tsx`: the redraw after a change.
- `test/unit/mind-map-view.test.tsx`, `test/unit/mind-map-layout.test.ts`: the views, "Hide rejected", the card and the
  layout.
- `test/unit/mind-map-hand.test.tsx`, `test/unit/node-chips.test.tsx`, `test/contract/product-layout.test.ts`: drag,
  "Move nodes", "Prettify", fold, their write to the file, and chips.
- `test/e2e/product-session.spec.ts`: in the running app, a node the advisor adds shows without a reload with its
  chip, the open agents list widens its column without covering the chat, a drag with "Move nodes" off writes nothing,
  a node dragged with it on keeps its place after a restart, and "Prettify" drops that place; in a 1160-wide window with the agents list open, the chat heading, the chips, the map's toolbar and the
  input field fit the narrow column, a chip rings its message, the card quotes it, and closing the card takes the
  ring off. Folding is covered by the unit
  tests only.

## Critic, ideas and the share of accepted advice

### Behaviour

**The critic.** The Subagent `worfy:critic` looks for objections to a spec or a plan, not for reasons to agree. It gets
the path of the plan, never its author's verdict; before a spec is accepted, it also gets the path of the project's
roadmap, when there is one, and the `epic-status` lines of the project. It writes one review file, `critic/<epic>-<YYYY-MM-DD>.md` of the
Product Session folder, and answers with its path and the verdict in one line. The review holds:

- a verdict: `Keep`, `Reorder`, `Split` or `Defer`, with its reason;
- at most three objections, each with a `Fact:` line that a reader can check at its reference, a `Judgement:` line with
  the critic's conclusion, and an empty `Owner decision:` line;
- one alternative, even for `Keep`;
- what the critic cannot know.

A Product Session calls the critic when the owner asks for one.

**Before a spec is accepted.** The Orchestrator runs the critic before it asks the owner to accept the `spec.md` of a new
Epic. It adds a line with a link to the review to the header of the spec, labelled with the word "Critic" in the
project's documents language (`language.docs` of the Profile), so the label is not always English. It shows the owner the
verdict and the objections in one table. For each objection the owner answers, it fills in `Owner decision: accepted — <reason>` or
`Owner decision: rejected — <reason>`. An unanswered objection stays empty and waits. The owner may accept a spec against
the critic: it is then an ordinary accepted spec, and worfy neither checks nor blocks it.

**Ideas.** When the owner asks for ideas or "what next", the skill `worfy:product-ideas` gives three to five ideas. Each
has the fields `For whom:`, `Why now:` (with a fact), `Cost:` in Tickets and `How we will know it worked:`, and at least
one idea goes against the roadmap, with an `Against the roadmap:` line. In a Product Session each idea becomes a node of
the Mind map with `advice: true`; elsewhere, without the Mind map tools, the ideas stay in the answer.

**The share of accepted advice.** The header of a Product Session shows how much of the advice the owner accepted in this
Project, for example "Advice accepted 3 of 5 · 60%", or "No advice decided yet". Advice still waiting for a decision is
not in the share. While the Project has no advice at all, the header shows nothing in its place; a share that cannot
be counted shows "Advice accepted —" with the reason in its tooltip. The tooltip gives:

- how many pieces of advice wait, in the Mind map and in the critic's reviews;
- the files that could not be read;
- that a decision written in a critic's review shows after the next change of a topic;
- that the share counts the owner's decisions and is no measure of how good the advice is.

### How it works

**What is counted.** Two kinds of advice across the whole Product Session folder of the Project:

- every Mind map node with `advice: true`: a Decision by its status, any other node as waiting;
- every objection of every critic's review, by its `Owner decision:` line.

An objection taken from a critic's review onto the Mind map has the review file as its source, and is counted once, by
the review. The share is counted each time it is asked for and stored nowhere. The header asks again on every
`product.changed` of the Project, so a `mind_map_decide` shows at once. A review change alone does not send
`product.changed`, so it shows with the next change of a topic or the next open of the Session.

**Why a separate critic.** An advisor that agrees easily is the risk, so the objections come from an agent that gets the
plan without its author's verdict and must name a fact behind each one. The labels of a review stay in English in every
language, because tools read them: the share reads the `Owner decision:` lines.

### Implementation

| Module | What it holds |
|---|---|
| `harness/agents/critic.md` | The critic, its review file and "Before a spec is accepted" |
| `harness/hooks/rules/orchestrator.md` | The Orchestrator rule: the critic before a spec is accepted |
| `harness/skills/product-ideas/SKILL.md` | The ideas skill |
| `src/shared/product/share.ts` | The count of accepted advice |
| `src/main/ipc/product.ts` | `product.share`: reading the topics and the reviews |
| `src/renderer/session/ProductSessionPanel.tsx` | `AcceptedAdvice`, the header figure and its tooltip |

**Main tests:**

- `test/unit/product-share.test.ts`: the count, the critic's objections counted once, files left out.
- `test/unit/product-session-panel.test.tsx`: the header figure and its tooltip.
- `harness/evals/critic-verdict/` and `harness/evals/product-ideas/`: eval cases of the critic and the ideas skill. A run
  with `scripts/eval-harness.mjs` calls a real Claude Code; CI does not run them.
