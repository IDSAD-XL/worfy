# Cards

A Card is a small HTML app that an agent builds and that runs inside a Node on the Canvas. This page has two sections:
Card as a file covers the Card itself, and Card MCP covers the tools through which an agent creates a Card and changes the
Canvas. Terms are explained in [Concepts](concepts.md).

## Card as a file

### Behaviour

**Where a Card comes from.** An agent creates a Card with the tool `create_card`, then writes its files with its ordinary
file tools. The Canvas menu has no item for a new Card. A Card belongs to the Project: any Session of the Project may
change it. A Card is a folder with an `index.html` and whatever other files it needs. There is no build step: the files
run as they are.

**What the Node shows.** The header shows the text of the `<title>` in `index.html`, or `Card` when there is none. A long
title ends in "…" and is shown in full in a tooltip. The body of the Node depends on the state of the Card:

| State | What the body shows |
|---|---|
| The Card's folder does not exist | The text `Card files missing` |
| The folder exists, and the zoom is 0.4 or more | The running page |
| The folder exists, and the zoom is below 0.4 | The title in a dashed frame; the page does not run |

A pinned Card and a Card in a tile of focus mode run at any zoom. On the Canvas, a Card whose Node is off screen does not
run, because Nodes off screen are not drawn. A folder without `index.html` counts as existing: its frame shows the plain
answer `Not found`.

**Reloading.** When a file of the Card is written or removed, the Node reloads the page within a second. A burst of writes
reloads it once, after 100 ms of quiet. A reload loads a new document, so anything the page keeps only in memory is lost.
Data saved with `worfy.data` stays.

**Mouse.** On the Canvas, a Card's page takes the mouse only while its Node is the active one. Until then the wheel over a
Card moves the Canvas, and the first click activates the Card and does not reach the page. While a Node is dragged or
resized, or the Canvas is panned, no Card takes the mouse. A Card is dragged by its title and resized by hand down to
160 × 100. The dashed frame shown below zoom 0.4 has no page, so it can also be dragged by its body. A tile of focus mode is
drawn outside the Canvas, so its page takes the mouse at once.

**What a page may do:**

- Run scripts and styles from its own files and inline.
- Load images and fonts from its own files, from `data:` and from https.
- Send network requests to https addresses only. This rule also stops `fetch` of the Card's own files.
- Go to other files of its own Card.
- Use `localStorage` on its own origin, which no other Card shares.
- Use the Card API, described below.

**What a page may not do:**

- Reach the worfy window, another Card or `file://`.
- Open a window, navigate the worfy window or navigate its frame away from its own Card.
- Use frames, forms, plugins or `<base>`.
- Get a web permission such as the camera, the microphone or notifications.
- Serve a file with another extension, or a file outside its folder. Such a request gets a 404. The served types are HTML,
  CSS, JavaScript, JSON, plain text, SVG and common image, font, audio and video formats.

**Card API.** Every HTML page of a Card has `window.worfy`, and the page cannot replace it. Every call except
`worfy.workflow.subscribe` returns a Promise, and a refused call rejects it with the reason. `worfy.workflow.subscribe`
returns its stop function at once, and a failed subscription is only written to the page's console.

| Call | What it does |
|---|---|
| `worfy.data.get()` | Gives the Card's own saved JSON value, or `null` before the first save |
| `worfy.data.set(value)` | Replaces that value. The limit is 1 MB of compact JSON. The value survives a restart |
| `worfy.ask(text)` | Asks the user to send up to 10 000 characters to a Session |
| `worfy.workflow.get()` | Gives a read-only snapshot of the Project's workflow |
| `worfy.workflow.subscribe(listener)` | Calls `listener` with the snapshot now and on each change, and returns a function that stops it |

A Card cannot change the workflow: the API has no such call. The snapshot lists the Epics and the Tickets. For each Ticket
it gives the state, blockers, Wave, Gate outcome, PR and CI. Its `error` field says why the workflow could not be read.
The first read of the workflow has 15 seconds. After that `worfy.workflow.get` rejects its Promise, and
`worfy.workflow.subscribe` writes the failure to the console.

**Messages to a Session.** `worfy.ask` opens a dialog titled `Message from a Card`, with the buttons `Send` and `Cancel`. The
dialog names the Card and the recipient and shows the exact text. Nothing is sent without `Send`. The result is
`{sent: true}`, or `{sent: false, canceled: true}` for any other answer.

- **The recipient** is the Session that last edited the Card, if it is live in worfy. Otherwise it is the Project's
  Orchestrator, which worfy opens if it is not running. The Card cannot choose the recipient.
- **The message** arrives as `Message from Card "<title>" (<id>):`, then an empty line and the text. Without a title the id
  takes its place.
- **One question per Card.** A second `worfy.ask` is refused while the first waits. A question stops waiting when it is
  answered, when the window that asked goes away, or after 10 minutes.
- **An unattended recipient.** A Session run by Autopilot has nobody to answer the dialog. The call is refused without a
  dialog, and nothing is sent. The same check runs again after `Send`, in case the Session became unattended meanwhile.

**Find.** The Canvas search also reads the visible text of Cards, up to 100 000 characters. Only a Card whose page is
running can answer, and it has 2 seconds.

**Deleting.** The user can delete a Card Node. Its folder and its data move to the Project's trash, are kept for 3 days and
can be restored. They stay in place if another Node still shows the same Card. Agents cannot delete a Node.

#### On a Linked machine

A window can show a Card of a Project on a Linked machine. Its files, its saved data and the Session that gets its messages
are on the Machine of the Project. The dialog of `worfy.ask` appears on the Machine of the window. A file change on the
Machine of the Project reloads the Card in the window.

- A file larger than 20 MB gets the answer 413.
- When the Linked machine cannot be reached, the answer is 502.
- On a read-only screen `worfy.data.set` and `worfy.ask` fail at once with the read-only hint. Reading still works.

### How it works

**Files, not an API.** An agent writes Cards with the file tools it already has, and worfy only reads them
([ADR-0003](../adr/0003-cards-as-files-canvas-via-tools.md)). The files and the saved data are in the Project data folder,
so they never reach the Project's repository ([ADR-0005](../adr/0005-worfy-own-state-inventory.md)). The folders are
`<Project data folder>/cards/<id>/` and `<Project data folder>/card-data/<id>.json`. See
[Storage and diagnostics](storage-and-diagnostics.md).

**A separate origin for each Card.** A Card is code that an agent wrote, so it is isolated from the app
([ADR-0012](../adr/0012-card-origin-worfy-card-scheme.md)). The address is `worfy-card://<card id>.<project label>/<path>`,
where the label is the 8 hex characters that end the Project id. The app registers this scheme as standard and secure, so
each host is an origin of its own. The iframe has `sandbox="allow-scripts allow-same-origin"`. "Same origin" here means the
Card's own origin, never that of the window. An address whose label matches no Project, or more than one, gets a 404.

**Three separate checks.** The protocol serves only files of the Card and sends the same headers on every answer: a
Content-Security-Policy, `nosniff` and `no-store`. The main process decides which navigations a frame may make, and refuses
new windows and web permissions. The worfy window accepts a Card's message only from the frame of that Card and with that
frame's origin. It drops any other message without an answer.

**The Card API is messages.** A Card has no Node.js and no IPC. It talks to its parent window with `postMessage`
([ADR-0015](../adr/0015-card-api-window-worfy-postmessage.md)). The protocol puts the small script that provides
`window.worfy` at the start of the `<head>` of each HTML file it serves, so it runs before the Card's own scripts. The file
on disk does not change. The window validates each request with a schema and passes on only the parsed request. Saved data
and messages go to the main process over IPC. The window builds the workflow snapshot from what it already reads, and it
starts reading only after a Card first asks. A subscribed Card hears only of a real change. worfy does not own the workflow,
so a Card only reads it ([ADR-0002](../adr/0002-worfy-is-a-view-over-the-workflow.md)).

**Reloads come from a revision number.** The main process watches a Project's Cards from the first time one of them is asked
for, until the Project leaves the list. Each change raises the Card's revision, which is kept in memory only. The Node makes
a new iframe for each new revision, and a later revision always wins over an earlier answer.

**The last editor comes from tool calls.** For a Session attached to a Project, the main process watches the `Write`, `Edit`,
`MultiEdit` and `NotebookEdit` calls against the Cards folder of that Project. A call that names a file inside a Card's folder
makes that Session the Card's last editor, whatever the agent says about itself. A Session in no Project, or one whose canvas
failed to start, is not watched. A change made through Bash does not count. The value is kept in the Card Node's data, so it
survives a restart. Paths are compared as text, and symlinks are not followed.

**A message takes three steps.** The Machine of the Project picks the recipient and keeps the question waiting. The Machine
of the window shows the dialog. The Machine of the Project then sends the message, or does not. A dialog belongs to the
screen that asked ([ADR-0053](../adr/0053-several-screens-on-one-project.md)). Only the window that asked can finish a
question. A refusal to an unattended Session also reaches that Session's subscribers as a `refused_dialog` event, and the
Autopilot journal records it. A message the user sends to a Session of an Autopilot run is recorded there as human input.

**A Card on a Linked machine has its own origin.** Its host gets a third part, the Machine id without dashes:
`worfy-card://<card id>.<project label>.<machine label>/<path>`. Its origin therefore differs from that of any Card of this
Machine, even one with the same id and label. The Machine of the Project finds and checks the file as for its own frames and
sends it in pieces of at most 4 MB, without the Card API script. The Machine of the window adds its own script.

#### Windows

On Windows, a system call that follows a link to `\\host\share\…` makes the system contact that host with the user's
credentials. So the links on the way to a Card are read first, without being followed:

- A Card whose folder leads to a share counts as missing. A Card whose `index.html` leads there has no title.
- A file behind such a link is not served.
- A Cards folder that leads to a share is not watched. A link inside a Card that leads there is left alone, and the other
  Cards are watched as usual. A link to a folder or a file on this machine is still followed.

The watch itself differs too. It uses one recursive handle instead of chokidar and does not create the Cards folder: it waits
for the folder to appear. Links are looked for down to the folders right inside a Card. When Windows reports lost events,
every Card asked about so far in that Project is read again. Swap and backup files of an editor are not a change.

For the last editor, a Windows path takes `\` and `/` as one separator and is compared without regard to case. A Git Bash path
such as `/c/Users/…` is read as drive C:.

### Implementation

| Module | What it holds |
|---|---|
| `src/main/cards/store.ts` | `CardStore`: Card folders, the `<title>`, the watch and revisions |
| `src/main/cards/protocol.ts` | The `worfy-card://` handler, CSP, file types, address parsing, script insertion, navigation rule |
| `src/main/cards/data.ts` | `CardDataStore`: one JSON file per Card |
| `src/main/cards/ask.ts` | `CardAsk`: the recipient and the waiting questions |
| `src/main/cards/remote.ts` | The second source of files: Cards of Linked machines |
| `src/main/link/file-chunks.ts` | Sending a file over the link in pieces |
| `src/main/ipc/cards.ts`, `src/main/ipc/card-api.ts` | IPC handlers, the dialog and the check for an unattended recipient |
| `src/main/window.ts` | `installWebPolicy`: navigation, new windows and permissions for all pages |
| `src/main/link-safe-watch.ts`, `src/main/remote-links.ts` | The Windows watch and the reading of links |
| `src/shared/cards/bridge.ts` | The message formats and limits, the workflow snapshot, the origin and machine label |
| `src/shared/cards/last-editor.ts` | Which Card a tool call wrote into |
| `src/shared/ipc/cards.ts`, `src/shared/ipc/card-api.ts` | IPC channels and the Card id format |
| `src/card-runtime/worfy-card.ts` | The source of `window.worfy` |
| `src/renderer/canvas/nodes/CardNode.tsx` | The Node, its states and the iframe |
| `src/renderer/canvas/card-bridge.ts` | The window's side of the messages, with no DOM globals |
| `src/renderer/canvas/overlays/CardBridge.tsx` | Mounts the bridge, finds the frames and feeds the workflow |
| `src/main/layout/trash.ts` | Moving a Card to the trash and back |

The protocol is installed once before the first window, from `src/main/index.ts`. Its privileges are registered in
`src/main/schemes.ts`.

**Data flow of a request.** A page calls `window.worfy`. The script posts a message to the parent window.
`src/renderer/canvas/card-bridge.ts` checks the sender and the schema. Saved data and messages then go over IPC to
`src/main/ipc/card-api.ts`. The answer goes back to the same frame, addressed to its origin.

**Data flow of a file change.** A file changes in the Cards folder. `CardStore` waits for the quiet period, raises the
revision and reads the Card again. `src/main/ipc/cards.ts` sends `cards.changed` to every window. `CardNode` picks out its own
Card and makes a new iframe.

**Main tests:**

- `test/contract/card-protocol.test.ts`: serving files and refusing others, addresses, Linked machine files, navigation, the
  store.
- `test/contract/card-bridge.test.ts`: messages, who may talk to the bridge, saved data, the snapshot, `window.worfy`.
- `test/contract/card-api.test.ts`: the three steps of a message, the dialog, an unattended recipient.
- `test/contract/card-last-editor.test.ts`: paths and the last editor, Windows paths included.
- `test/contract/card-links.test.ts`, `test/unit/cards-watch.test.ts`, `test/contract/cards-watch-links.test.ts`: links and
  the watch by the Windows rules.
- `test/e2e/card-runtime.spec.ts`: reload, isolation, CSP and zoom in the running app.
- `test/e2e/card-api.spec.ts`: saved data across a restart and the message dialog.
- `test/e2e/card-drag.spec.ts`: drag, resize and pan across a Card's iframe.
- `test/e2e/linked-cards.spec.ts`: a Card shown from a Linked machine.
- `test/contract/trash.test.ts`: deleting and restoring a Card.

## Card MCP

### Behaviour

**Who gets the tools.** A Session that worfy starts in a Project gets the MCP server `worfy-canvas`. It also gets the Project's
Cards folder as an extra writable directory, and a short instruction in its system prompt. Despite this section's name, the
server is not only about Cards: it is the agent's way to change the Canvas.

- The Session gets the server only if the Project's Profile lists it. The default list does.
- A Session whose working directory is in no Project runs without these tools. So does a Session whose canvas failed to start.
- The draft Session that worfy runs when a Project is connected has no MCP server at all.

**The tools:**

| Tool | What it does |
|---|---|
| `list_nodes` | Lists the Nodes, hidden ones included: id, kind, title, position, size, hidden and locked |
| `create_card` | Makes a Card folder and its Node, and answers with the Node, the folder and the `index.html` path |
| `create_note` | Makes a note Node with up to 20 000 characters of text |
| `update_node` | Changes a Card's title or a note's text |
| `move_node` | Moves a Node |
| `resize_node` | Resizes a Node |
| `hide_node` | Hides a Node or, with `hidden=false`, shows it again |
| `link_card` | Links a Card to an Epic (`<epic>`) or a Ticket (`<epic>/<NN>`), or removes the link with `remove=true` |

**Limits.**

- Sizes are from 40 to 4000 and coordinates within ±100 000, in canvas units.
- A new Card is 360 × 280 and a new note 220 × 120, unless the call gives a size.
- A Card id is made by the tool, in the form `card-` and 8 hex characters.
- There is no tool that removes a Node.

**Placement.** Without coordinates a new Node goes to the right of the calling Session's Node, moving down until it is clear
of other Nodes. Without such a Node it goes to the right of everything visible. Nodes never overlap: a place that is taken, or
closer than 16 px to another Node, is corrected to the nearest free place. A resized edge stops 16 px short of another Node.
Other Nodes do not move, and the answer holds the real position and size
([ADR-0038](../adr/0038-nodes-never-overlap.md)).

**What the tools do not touch.** Epic frames, Tickets and Subagents are laid out by worfy, so the tools do not list or change
them. Archived Nodes are off the Canvas: the tools do not list them, and a call that names one is refused until the user brings
it back. Other Nodes can be moved, resized and hidden, except that a locked Node, such as the Orchestrator, cannot be hidden.
`update_node` works only on Cards and notes. Hiding a Session Node first asks the pages of its Browsers for unsaved changes.

**Refusals.** A refused call is a tool error with a message the agent can read. A call that names a Node of another Project is
refused as an unknown Node. If the Layout change of `create_card` fails, the new folder is removed.

**The title of a Card has two sources.** The title given to `create_card` or `update_node` is kept in the Layout.
`list_nodes`, the Command palette, Find and the title bar of a focus mode tile show it. The Node's header shows the `<title>` of `index.html` instead, so an agent
that wants to change the header edits that file.

**Links.** `link_card` checks that the Epic or Ticket exists, unless it is removing a link. Linking twice keeps one link. The
links are kept in the Card Node's data, and only `link_card` reads them today: the Canvas draws nothing for them.

### How it works

**Files for content, tools for the Canvas.** The Layout has one writer, the main process, so a change by an agent takes the same
path and the same checks as a change by the user ([ADR-0003](../adr/0003-cards-as-files-canvas-via-tools.md)). The set of tools
is a contract between the agent and the app, and it changes together with the instructions to the agent.

**One server per Session.** The server runs in the worfy process and is bound to one Project. The Project comes from the
Session's working directory: the deepest Project holding it, with paths compared in their spelling on disk. A linked git worktree
outside the Project's root is found through git. The Session's own id comes from its messages and decides which Node a new Node
goes next to. A resumed Session starts with its resume id, and each turn's first message can replace it.

**Only the servers on the list.** Every tool costs context in each turn, so a Session in a Project gets only the MCP servers its
Profile lists ([ADR-0021](../adr/0021-mcp-servers-allowlist-in-profile.md)). The Cards folder stays writable even when the list
leaves `worfy-canvas` out.

**Arguments are checked twice.** The MCP server checks them against the tool's schema, and the handler parses them again with the
same schema. Keys a tool does not declare never reach the Layout.

#### Windows

When the Cards folder leads to a share, or the links on the way cannot be checked, `create_card` is refused with a message and
the folder is not created. A working directory in the 8.3 short spelling of a Project root still finds that Project.

### Implementation

| Module | What it holds |
|---|---|
| `src/shared/canvas/tools.ts` | The tool names, schemas, descriptions, limits and the default placement |
| `src/main/mcp/canvas-server.ts` | The handlers, the server, the Project of a Session and the recording of the last editor |
| `src/main/mcp/agent-instructions.md` | The text appended to the system prompt; it names the Cards folder |
| `src/main/agent/options.ts` | Passes the server, the Cards folder and the instructions to Claude Code |
| `src/main/agent/app-registry.ts` | Resolves the canvas when a Session starts |
| `src/main/workflow/profile.ts` | The Profile's list of MCP servers and the default list |
| `src/main/layout/store.ts` | `LayoutStore`, which every Layout change goes through |
| `src/shared/layout/free-place.ts` | The nearest free place and the 16 px gap |

The same folder also holds the server `worfy-browser`, described on the [Browser](browser.md) page.

**Data flow of `create_card`.** The agent calls the tool. `canvasToolCaller` in `src/main/mcp/canvas-server.ts` parses the
arguments. The handler picks a free id, makes the folder and applies a `create` operation to the Layout. The renderer draws
the new Node and asks for its Card with `cards.get`, which starts the watch. The agent then writes `index.html`. The file change
reloads the Node, and the Session's tool call makes it the Card's last editor.

**Main tests:**

- `test/contract/canvas-tools.test.ts`: each tool, refusals, Nodes the tools do not touch, parallel changes, the Project of a
  Session, and that nothing is written to the Project's repository.
- `test/unit/agent-options.test.ts`: which servers a Session gets from the Profile's list.
- `test/contract/card-last-editor.test.ts`: the recording of the last editor on a fake agent.
