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

**Opening one.** "New Product Session" is a row of the sidebar's Sessions section, above the list, and a command of the
Command palette. Neither offers a Vendor: a Product Session runs on Claude Code only, and any other Vendor is refused with
`Product Session runs on Claude Code only`. The new Session opens in the Session view at once. Its Node stays a Session
Node on the Canvas, with the label "Product Session" under its header. On a read-only screen of a Linked machine the
entry is inactive.

**Model.** A Product Session always runs on the strongest model, `opus`, and starts at the highest effort. Its input
field has no model picker, and a change of the model is refused. Eco mode does not reach it, and its input field has no
Modes menu: that menu belongs to the Orchestrator.

**The screen.** The Session view of a Product Session is built as the owner's prototype draws it. Its header holds
"Product Session", the topic of the Mind map (the Project's name until a topic is known), the Vendor, the state, the
Session switcher, the share of accepted advice (see the last section) and Interrupt. It has no Model, Effort,
Permissions, Cost or "Hide tools". Its body is three parts side by side:

| Part | What it holds |
|---|---|
| Mind map, on the left | The Mind map of the topic the advisor works on (next section) |
| Chat, on the right | The conversation with the advisor and the input field |
| Agents strip, at the right edge | An icon with the number of the Session's Subagents, hidden ones left out |

- The divider between the Mind map and the chat starts at 60 / 40. It moves with the mouse, with ← and → in steps of
  5 %, and with Home and End to its edges. A double click puts it back to 60 / 40. Each side keeps at least 10 %.
- The split is one per Machine. It is saved in the app settings when a drag or a key press ends, so every window and the
  next start of worfy show it.
- A click on the agents strip opens the rail blocks of a plain Session over the chat; Escape or "›" closes them. The
  Binding block is left out: a Product Session is bound to no Ticket and no Epic.

**The chat.** It is headed "Conversation with the advisor", with the Vendor, and shows the conversation only:

- The owner's messages are bubbles at the right edge, under "You" and the time. The advisor's answers are bubbles at the
  left edge, under "Advisor" and the time. The chips of Mind map nodes stand under the message that carries them.
- A turn that failed shows its error, an interrupted turn shows "Interrupted", and an error of the Session shows too.
  Permission requests and the advisor's questions with options are cards in the chat, as in any Session.
- Thinking, tool calls and their output (a failed call too), Subagents, hooks, Claude Code's notices and the messages it
  adds, "Turn finished" and slash commands are not shown. The whole log is in the Flight Recorder.
- While a turn runs, "Advisor is thinking" stands at the end of the chat. There is no switch to show the details.
- Find (⌘F) looks only in what the chat shows, and only in the messages the view has read: the part of the transcript
  file behind "Load earlier" is not searched, and the find bar then says "Earlier messages not loaded".
- The input field keeps the text, Send, Interrupt while a turn runs, and attaching a file or a picture. It has no
  pickers, context meter, queue chip or hints. A message sent while a turn runs still waits in the queue.

**What it may not do.** A Product Session changes no code, takes no Tickets, starts no Autopilot and never changes the repository with git.
Three layers hold this, all for Claude Code:

| Layer | What it refuses |
|---|---|
| The PreToolUse hook | `Edit`, `MultiEdit`, `Write` and `NotebookEdit` outside the Product Session folder; in `Bash` and `PowerShell`, the Ticket CLI `bin/ticket`, `git add`, `commit`, `push`, `merge`, `rebase` and `reset`, `gh pr create` and `gh pr merge`, `pnpm` and `npm` |
| The canvas server | `autopilot_start`, with "A Product Session does not start Autopilot: it advises and drafts Epics. Ask the Orchestrator of the Project to run the Epic." |
| The rules of the Session | The same limits in words, and the ones the hook cannot see |

- Each refusal carries a reason that the agent reads. The hook refuses in every permission mode, `bypassPermissions` too.
- The Product Session folder is `docs/product/` of the Project in Full mode and `<Workflow folder>/product/` in Silent
  mode. When it cannot be found, every file write is refused.
- A shell command is read as the shell reads it: a word in quotes is one word (`grep "pnpm"` searches,
  `git -C "a b" commit` commits), and `$(…)`, backticks, `bash -c` and `eval` are read as commands too. Reading
  commands such as `git log`, `gh pr view` and `epic-status` go through. This is not a sandbox: a command that writes in
  a way the hook does not know goes through, and only the rules name that limit.

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
| `src/renderer/session/product-session.ts` | `shownInProductChat`: the rows the chat shows; the input field's items it leaves out |
| `src/renderer/session/Transcript.tsx`, `src/renderer/session/session.css` | The chat as bubbles and "Advisor is thinking" |
| `src/renderer/session/MessageInput.tsx`, `src/renderer/session/transcript-find.ts` | The one-line input field, find over the rows shown |
| `src/renderer/session/SplitDivider.tsx` | The divider |
| `src/shared/settings/app-settings.ts` | The saved split, `productSession.split` |
| `harness/hooks/rules/product.md`, `harness/hooks/inject-rules.mjs` | The rules of a Product Session and their choice by the variable |

**Main tests:**

- `test/contract/node-sessions.test.ts`, `test/contract/sessions-vendor.test.ts`: the kind on every start and the
  Vendor refusal.
- `test/unit/product-guard.test.ts`, `test/unit/agent-options.test.ts`: the file and shell rules, the hook and the
  environment.
- `test/contract/canvas-tools.test.ts`: `autopilot_start` in a Product Session, the Product Session folder by mode.
- `test/contract/product-save-signal.test.ts`: the save signal and its answers, also on Close and archive.
- `test/unit/product-transcript.test.tsx`, `test/unit/session-view.test.tsx`: the rows the chat shows and hides, the
  bubbles, "Advisor is thinking", find, the header and the input field against a plain Session.
- `test/unit/product-session-panel.test.tsx`, `test/unit/session-node-product.test.tsx`: the screen, the divider, the
  strip and the Node.
- `test/e2e/new-product-session.spec.ts`: the Command palette entry in the running app.

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

- The toolbar has the view switch "Tree · Graph", "Hide rejected", "−" (zoom out), the zoom percent, "+" (zoom in) and
  "Fit". The wheel zooms, from 10 % to 250 %, and a drag of the background pans.
- Both views grow left to right: the topic at the left, each node to the right of the node it grew from. "Tree" is the
  default, a tidy tree with text of 15 px. "Graph" is a layered layout with text of 12 px. The view is remembered per
  topic on this Machine.
- "Hide rejected" hides the rejected Decisions and the branches under them while the map is open. The file does not
  change.
- The legend can be collapsed.
- A click on a node opens its card: kind and status, text, Reason, Source, History (the earlier statuses of a Decision),
  Grew from (a link to the parent's card) and Message ("Show in the chat"). The card of a map Ticket shows its Status
  and its file. The card of a node of `mind-map.json` says "To change this node, ask the advisor in the chat."
- Tab moves between nodes, Enter or Space opens a card, Escape closes it.

**By hand.** The owner only moves nodes and folds branches; what a node says is the advisor's, and the card has no field
to type in.

- A node of `mind-map.json` can be dragged; the topic and the map Tickets cannot. Its new place is saved in the file.
- The fold mark of a node with children, or ← and → on the node, folds and unfolds its branch. A folded mark tells how
  many nodes it hides. The fold is saved in the file.
- When the change cannot be saved, the map says "Could not save the change:" and the reason.

**Chips in the chat.** Under the advisor's last answer of a turn, each node that the turn's `mind_map_add`,
`mind_map_update` or `mind_map_decide` calls wrote gets a chip, once per node. A turn without an answer shows its chips
under the owner's message that started it; a turn none of whose rows is shown (the loaded part starts in its tool calls)
shows them under the next message, or at the end of the chat. A click on a chip selects the node on the Mind map and brings it into view. A
hidden node is shown first: "Hide rejected" is turned off and the folded branches above it unfold. Pointing at a chip or
focusing it lights its node; pointing at a message lights the nodes of all its chips. "Show in the chat" on a card
scrolls the chat to the message that carries the node's chip.

**Live.** A change of a topic's files redraws the Mind map without a reload: a tool call, an edit by hand, another
agent's write. A file that fails the format check is not shown as empty: a line above the map names the file and each
error with the id of its node. The root and the map Tickets still show, and the nodes of the file do not until it is
mended.

#### On a Linked machine

On a read-only screen the map can be looked at, but nodes do not move and branches do not fold. A chip whose node is
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
reads. main is the only writer of `mind-map.json`: the tools and the owner's drag and fold go through the same writer. It
writes one change at a time per file, atomically, and never overwrites a file that already fails the check. On Windows,
while another process holds the file open, it tries again for a second and then writes into the file in place.

**Where a node came from.** A node keeps in `message` the id of the chat message whose tool call wrote it, when that
message is known. The chips come from the transcript itself: every `mind_map_add`, `mind_map_update` and
`mind_map_decide` call answers the node as written. Nothing new is stored for them.

**Live redraw.** The watch of the Project's documents also follows the topic folders and reads a topic 50 ms after its
last event; the screen gets `product.changed`. The watch is described on [Projects](projects.md).

**Layout.** The Mind map is drawn with React Flow. ELK lays it out in the window's Web Worker, `mrtree` for "Tree" and
`layered` for "Graph"; until ELK answers, a quick tree layout draws it. A node with `x` and `y` in the file stands where
the file says.

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
  fold, their write to the file, and chips.
- `test/e2e/product-session.spec.ts`: in the running app, a node the advisor adds shows without a reload with its
  chip, and a dragged node keeps its place after a restart. Folding is covered by the unit tests only.

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
not in the share. The tooltip gives:

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
