# Canvas

Three Features of one plane. **Node and Layout** are the objects on the plane and how they are moved. **Find** searches
what is on the Canvas. **Inserting images** puts a picture on it. Epic frames and the Done shelf are on their own page,
[Epic frames](epic-frames.md). Terms are explained in [Concepts](concepts.md). The contents of the Nodes have their own
pages: [Cards](cards.md), [Terminal](terminal.md), [Browser](browser.md), [Sessions](sessions.md).

## Node and Layout

### Behaviour

The Canvas is an infinite plane, one per Project. A Node is any object on it. Most Nodes keep their place and size in
the Layout. The Epic frame, the Ticket and the Subagent are Derived Nodes: worfy computes their place from the workflow.

| Node | Default size | Smallest by hand |
| --- | --- | --- |
| Note | 220 × 120 | 120 × 64 |
| Card | 360 × 280 | 160 × 100 |
| Session | 300 × 120 | 240 × 140; started outside worfy 200 × 80 |
| Terminal | 560 × 340 | 240 × 120 |
| Browser | 640 × 440 | 360 × 200 |
| HANDOFF | 360 × 320 | 240 × 120 |
| Orchestrator | 360 × 200 | 240 × 120 |
| Image | by the picture, see [Inserting images](#inserting-images) | 48 × 48 |

A Node of a kind this build does not have stays in the Layout with its data. It is drawn as `Unknown node: <kind>` and
can be moved.

**Moving around.** On Windows read Ctrl for ⌘ here and below.

| Gesture | What it does |
| --- | --- |
| Wheel | Pans |
| ⌘ + wheel, pinch | Zooms around the pointer |
| ⌘= and ⌘− | Zoom |
| Drag with Space held, drag with the middle button | Pans |
| Drag on an empty spot | Selects the Nodes it covers |
| Double click on the empty plane | Creates a Note |
| Right click on the empty plane | Opens the Canvas menu |

Zoom goes from 0.2 to 2.5. The background is a dot grid with a step of 16. Nodes off screen are not drawn. With no
Project, the view says "Add a project to see its canvas." A Layout that cannot be loaded says why: "The canvas could not
be loaded: …". While a Project opens, a line at the bottom left says how far the loading is: the workflow, Epics laid
out N of M, the Sessions history. On this Machine it shows only after 300 ms, so a small Project opens without it.

**The wheel over a Node.** The first matching rule decides:

1. Nothing inside the Node takes the wheel at the pointer: the Canvas does.
2. Pinch or ⌘ + wheel: the Canvas zooms.
3. The Node is not active: the Canvas pans.
4. The Node is an active Terminal: the Terminal scrolls.
5. The active Node has something to scroll at the pointer: the content scrolls, even at the end of its scroll.
6. Otherwise: the Canvas pans.

**Active Node.** A plain click on a Node that can be selected selects it and makes it active. A click on the empty plane, a press outside the Node,
Esc outside a Terminal, or losing the selection ends it. A Card takes the mouse only while it is active. No Card takes
the mouse during a drag, a resize or a pan.

**Canvas menu.** It holds "New browser", "New terminal", then "Tidy up", "Arrange by Epic" and "Re-pack". The arrows and
Esc work in it. The Command palette has the same commands, and "New …" there creates the Node in the middle of the
Canvas.

**Selection toolbar.** It appears next to the selection: above, right, left or under the Focus button, whichever place
covers nothing, otherwise the one that covers least. A pinned selection always gets it above.

- **Pin or Unpin.**
- **Tags.** "Add tag" takes up to 40 characters. Enter adds, Esc cancels, leaving the field submits, × removes. A tag
  that only part of the selection has shows how many have it.
- **Delete.** It is inactive with the tooltip "This cannot be deleted" when nothing selected can go. Refusals show in
  the toolbar.
- **Show family.** With one selected Node that has a Family, the camera fits the Family without zooming in. It skips
  members hidden by a tag filter and also works on a read-only screen.

The Focus button under the selection and ⌘↩ open the selection in [focus mode](focus-mode.md).

**Keys.** While the Canvas is on screen and no focus mode layer covers it, with the focus on it or nowhere and not in a
text field: Delete and Backspace
move the selection to the Trash, ⌘Z and ⇧⌘Z undo and redo, and Esc with nothing selected folds the done stack opened
last.

**Nodes never overlap.** A Node dropped on another lands at the nearest clear place, keeping a gap of 16. The nearer
place wins, then the one with less vertical shift, then the one further right, then the lower one. A dashed outline
shows the landing place during the drag. A group moves as a whole and keeps its inner distances. Neighbours do not move.
Resizing stops an edge 16 short of a neighbour. Pinned Nodes, hidden Nodes, archived Nodes and Derived Nodes do not
count as obstacles for this rule.

**Snapping.** During a drag, each axis snaps to whichever is nearest within 6 screen pixels: an alignment guide (left,
centre or right; top, centre or bottom of a Node on screen) or an equal gap in a row or column. A guide wins a tie. With
neither, the axis snaps to a grid of 8. Holding ⌘ turns snapping off, and the Nodes still do not overlap. A group moves
by the shift of the Node being dragged.

**Pinning.** A pinned Node stays at its place on the screen and keeps its screen size while the Canvas pans and zooms.
It is drawn above other Nodes, is moved back inside when the window gets smaller, and stays out of the minimap corner.
It cannot be dragged: unpin it, move it, and pin it again. Pinning and unpinning do not move it on the screen.

**Tags.** A Node shows its tags on a stripe. The palette's `Show only tag <tag>` hides every Node without the tag and
the lines touching them, and a chip at the bottom centre reads `Only tag <tag>` with "Show all". The filter belongs to
the window and is not saved.

**Tidy up.** It packs every Layout Node on the plane in reading order, from the top-left corner of their current
bounding rectangle, with gaps of 24 on a grid of 8. A Session and its Subagent tree count as one rectangle. Sizes do not
change. Pinned and hidden Nodes stay, and Epic frames are not touched. With fewer than two Nodes, or with all of them in
place, it does nothing. It is one step of undo. If it fails, the Nodes keep their places.

**Arrange by Epic.** It moves only Session Nodes on the plane without Keep. They form one column 48 to the right of the
[strip of Epic frames](epic-frames.md#epic-frame), grouped by Epic from the height of the frame's header, 24 between Nodes and 48 between groups.
Sessions without a Binding, or bound to an Epic on the Done shelf, go under them as Unbound. With no strip it does
nothing, and a second run changes nothing.

**New Nodes.** A Node worfy makes by itself, such as the Orchestrator, HANDOFF or a new Session, goes to (40, 40) when
no Node on the plane overlaps that spot, otherwise under every Node on the plane. A new Session with a Binding goes to
the right of the strip, at the height of its Ticket or of its Epic's header. A Node already on the Canvas is not moved
there when a Binding shows up later.

**Undo.** ⌘Z takes back up to 40 steps of the user's gestures on this screen. Each Project has one history, and a new
step clears redo. A group move or delete is one step. What an agent, main or another screen did is not in the history.
If another screen has since changed the same side of the same Node, the step is dropped with the toast "Not undone: this
Node was changed on another screen" or "Not redone: …". Note text has its own undo inside the Note.

**Trash.** Cards, Notes, Terminals, Session Nodes and images can be deleted. Locked Nodes, such as the Orchestrator and
HANDOFF, cannot, and neither can a Session Node with a running Session. Deleted Nodes wait for 3 days in the Trash,
opened by the button at the bottom centre, newest first, each with Restore. Restore brings the Node back with the same
id, at its old place if clear, otherwise at the nearest clear place. A Card moves with its files and data, and an image with its file unless another Node shows it.

**Archive.** worfy takes finished Session Nodes off the Canvas by itself, and nothing is deleted. The rule runs when the
Project's Layout is first read and every 10 minutes. It takes a Session Node whose Session is not live, without Keep,
not pinned and not touched by the user within the threshold, once one of these holds:

- Its last transcript record is older than the threshold: Never, 6 h, 24 h (default), 3 days or 7 days in Settings →
  Canvas. Never turns the rule off.
- "…and when their Ticket is done" is on (default) and its Ticket is done, an hour after the last record.

A transcript that tells no time counts from the Node's last touch. A toast says "Archived N finished sessions" with
Undo, which brings back that batch alone and is not a step of ⌘Z. "Archive N" next to the Trash lists archived Sessions
without a Binding, newest first, with a search by title, Restore on each row and "Restore all from today". Those with a
Binding are in the history of their Ticket or Epic. A Session that resumes comes back. A restored Node returns to its
old place if clear, otherwise to the nearest clear place. The palette's "Archive finished sessions now" is one step of
⌘Z, and uses 24 h while the setting is Never.

**Camera.** Pan and zoom are saved per Project and per Machine, shared by all windows, and are saved only when they
changed.

**Minimap.** It sits at the bottom right, 200 × 150, with Nodes painted by kind. Dragging it pans, a click centres
there. View ▸ Show Minimap turns it on and off.

#### On a Linked machine

That Machine's level of access decides what the Canvas of its Project allows. With Full access, moving and editing
Nodes works as described here, and images are the exception, see [Inserting images](#inserting-images). With Read only,
a notice at the top centre says so.
Pan, zoom, Find and Show family work. Nodes do not move and have no resize handles, actions are inactive with a tooltip,
and ⌘Z does nothing. The Trash can be looked through but not restored from, and the archive's toast has no Undo.

In both cases the loading line shows at once, without the 300 ms delay, and the camera is kept on this Machine,
separately for each Linked machine's Project.

#### Windows

Ctrl takes the place of ⌘. Inside a Terminal Node, Ctrl and a key belong to the shell and not to the Canvas. The
exception is zoom: Ctrl+= and Ctrl+− still zoom the Canvas from there, and do nothing in a tile of [focus mode](focus-mode.md). Ctrl+_ stays the shell's undo.

### How it works

**main is the only writer of the Layout.** The renderer and the Canvas MCP tools send it the same operations: an agent
changes the Canvas through tools and not by editing the file ([ADR-0003](../adr/0003-cards-as-files-canvas-via-tools.md)). The
Layout is worfy's own state and not part of the workflow ([ADR-0005](../adr/0005-worfy-own-state-inventory.md)).

**The no-overlap rule lives in shared code**, so the drag preview and main's check give the same answer
([ADR-0038](../adr/0038-nodes-never-overlap.md)).

**Undo lives in the renderer, per screen.** Each screen undoes only its own gestures, because two screens can show one
Project ([ADR-0016](../adr/0016-trash-folder-per-entry-undo-in-renderer.md),
[ADR-0053](../adr/0053-several-screens-on-one-project.md)). The archive is not a user gesture
([ADR-0076](../adr/0076-auto-archive-of-finished-sessions.md)). Read only is one of the levels of access a Machine gives
each Linked machine ([ADR-0066](../adr/0066-read-only-access-for-a-linked-machine.md)).

**Node kinds come from files.** Each `*Node.tsx` file registers itself, and it supplies its own Canvas menu item
([ADR-0014](../adr/0014-canvas-menu-items-from-node-type-files.md)).

### Implementation

| Module | What it holds |
| --- | --- |
| `src/shared/layout/types.ts` | Node, Layout and the schema of operations, with limits |
| `src/shared/layout/free-place.ts` | The no-overlap rule: `NODE_GAP`, nearest clear shift, how a resize stops |
| `src/shared/layout/derived.ts` | Which Nodes are on the plane, and the ids of Derived Nodes |
| `src/main/layout/store.ts` | `LayoutStore`: applies operations, refuses, settles Nodes, saves `layout.json` |
| `src/main/layout/upgrade.ts` | What a read of an older `layout.json` removes or moves, once |
| `src/main/layout/place.ts` | The place of a new Node |
| `src/main/layout/viewports.ts` | The camera per Project per Machine, in `viewports.json` |
| `src/main/layout/trash.ts`, `src/shared/ipc/trash.ts` | Trash folders, kinds that can go, refusals, the purge at app start |
| `src/main/layout/archive.ts` | The archive rule and its timer |
| `src/main/ipc/layout.ts`, `src/shared/ipc/layout.ts` | The IPC of the Layout, and the save on quit |
| `src/renderer/canvas/Canvas.tsx` | The React Flow surface, gestures and zoom keys |
| `src/renderer/canvas/useLayout.ts` | The store of the Layout in the window, optimistic operations |
| `src/renderer/canvas/flow-nodes.ts` | Turns the Layout into React Flow Nodes, keeps selection and busy geometry |
| `src/renderer/canvas/nodes/index.ts` | The registry of Node kinds and the unknown kind |
| `src/renderer/canvas/extensions.ts` | The registries of overlays, edges and Node sources |
| `src/renderer/canvas/wheel-router.ts` | The wheel rules over a Node |
| `src/renderer/canvas/snapping.ts`, `src/renderer/canvas/NodeResizeClamp.tsx` | Snapping, and the resize stop |
| `src/renderer/canvas/pinning.ts` | Screen and plane coordinates of a pinned Node, the toolbar's place |
| `src/renderer/canvas/history.ts` | Undo and redo |
| `src/renderer/canvas/tidy.ts`, `src/renderer/canvas/arrange-by-epic.ts` | The two layout commands |
| `src/renderer/canvas/overlays/` | Menu, toolbar, Trash, Archive, minimap, read-only notice, snap guides |
| `src/renderer/settings/CanvasSection.tsx` | The archive's settings |

**Data flow of a drag.** React Flow moves the Node at once. `sendLayoutOp` sends `layout.apply`. `LayoutStore.apply`
checks the operation against the schema and its rules, settles the Node with `settle`, raises the revision and saves
after 250 ms of quiet, at most 1000 ms after the first change. It broadcasts `layout.changed`, and `acceptLayoutState`
keeps the highest revision. A refused operation puts the Nodes back at main's places.

**Limits.** Coordinates go up to ±10,000,000. A Node id takes up to 200 characters, a kind up to 100. `moveMany`,
`archive` and `restore` name up to 5000 Nodes.

**Main tests:**

- `test/contract/layout-store.test.ts`, `test/contract/layout-pin-tag.test.ts`: operations and refusals.
- `test/unit/free-place.test.ts`: the no-overlap rule.
- `test/unit/snapping.test.ts`, `test/e2e/snapping.spec.ts`: snapping.
- `test/unit/wheel-router.test.ts`, `test/e2e/wheel-over-nodes.spec.ts`: the wheel.
- `test/unit/history.test.ts`, `test/e2e/trash-undo.spec.ts`: undo.
- `test/unit/tidy.test.tsx`, `test/unit/arrange-by-epic.test.ts`: layout commands.
- `test/contract/trash.test.ts`, `test/contract/layout-archive.test.ts`: the Trash and the archive.
- `test/unit/pinning.test.tsx`, `test/e2e/pin-tags.spec.ts`: pins and tags.
- `test/contract/viewport-store.test.ts`: the camera.

## Find

### Behaviour

⌘F while the Canvas is on screen and not under the focus mode layer opens a bar at the top centre, "Find on the Canvas". A second ⌘F returns to the field,
selects its text and takes the selection again.

**What it reads:**

| Field | Text |
| --- | --- |
| title | An Epic's name and title; the title of a Node, or else the first non-empty line of its text, up to 120 characters |
| ticket | A Ticket's `epic/NN` and title |
| transcript | Assistant text, user text and notices of the Sessions open in this window, streaming text included |
| HANDOFF | The document, once, for the first shown HANDOFF Node, when it has been read |
| card | The visible text of Cards with a running page, 250 ms after the Canvas moves, with a retry at 1500 ms |

Hidden and archived Nodes are not found. A Card that does not answer keeps its last text.

**The query.** It ignores case, trims, and collapses whitespace. Two characters are the minimum. The count reads "No
matches", "N matches" or "k of N", with "1000+" at the limit of 1000. Every occurrence counts. If Nodes were selected at
the last ⌘F, the search is only in them and their children, and the bar says so.

**Moving through.** Enter and ⇧Enter or the ↑ ↓ buttons go to the next and previous match and wrap. Esc or × closes.
Matches go in reading order: top, then left, then node, ticket, handoff, card, transcript. Matches with no place come
last. Moving to a match does not change the selection.

**The camera.** It centres the match in 250 ms, at the smallest of 2.5, the zoom that fits it with a padding of 64, and
the larger of the current zoom and 0.6. A Ticket in a collapsed frame or a folded stack centres the frame. An Epic on
the [Done shelf](epic-frames.md#done-shelf) centres its chip.

**Marks.** Up to 200 matching Nodes get a dashed outline of 1 px. The current one gets a solid outline of 2 px. A line
under the field shows the field name and the text around the match, 32 characters to each side. Find changes nothing and
saves nothing.

**Go to in the palette.** It lists the Orchestrator, Epics, Tickets (by `07`, `7` or `epic/07`), Nodes and ADRs. An
archived or hidden Node comes back first. The camera waits up to 60 frames for the Node to be drawn. After 20 frames it
uses the frame around the Node, when there is one.

#### On a Linked machine

The Find bar works as here: it only reads. With Read only, the Go to row of an archived or hidden Node is inactive with a
tooltip, because bringing it back changes the Layout.

#### Windows

Ctrl+F opens the bar. Inside a Terminal Node Ctrl+F belongs to the shell.

### How it works

Typing only searches an index, which is updated when its sources change. A query that only grew narrows the previous
matches. The rule of the Terminal Node is one for all shortcuts and not specific to Find: on Windows, Ctrl and a key in
a shell are the shell's.

### Implementation

| Module | What it holds |
| --- | --- |
| `src/renderer/find/CanvasFind.tsx` | The bar, its keys, the outlines, the sources it gathers and the wait for a Node |
| `src/renderer/find/search-index.ts` | The index, the normalized query, the limit, reading order and the snippet |
| `src/renderer/find/canvas-requests.ts` | Requests from the palette |
| `src/renderer/find/node-rect.ts` | Where a match is on the plane, with the chip of an Epic on the Done shelf |
| `src/renderer/canvas/overlays/CanvasFind.tsx` | Its place on the Canvas |
| `src/renderer/palette/commands.ts` | Go to rows and layout commands |
| `src/renderer/shortcuts/match.ts` | The rule of the Terminal Node |

**Main tests:**

- `test/unit/search-index.test.ts`: the index, the query and the order.
- `test/e2e/palette-find.spec.ts`: Find and Go to on a real window.

## Inserting images

### Behaviour

**Paste and drop.** ⌘V puts an image from the clipboard on the Canvas, while the Canvas is on screen with the focus on
it or nowhere and not in a text place. It lands under the pointer when the pointer is over the Canvas, otherwise in the
middle. Drop works only on the empty plane: a file dropped on a Node belongs to the Node, and a Session takes it as an
attachment. The window itself never opens a dropped file.

**Size on the Canvas.** An image starts at its natural size, scaled down so that the longer side is at most 480 and
never scaled up. Each side is at least 48. The first image centres on the point and the next ones cascade by 32. Several
images are one step of undo. A pasted image with no file name is called "Pasted image" in messages.

**What is taken.**

| File | Answer |
| --- | --- |
| PNG, JPEG, GIF or WebP up to 20 MB | Taken |
| Over 20 MB | `<name> is too large: images on the canvas go up to 20 MB` |
| SVG | `<name> is an SVG image, which the canvas does not take: use a PNG, JPEG, GIF or WebP` |
| Another type | `<name> is not a supported image: use a PNG, JPEG, GIF or WebP` |
| A broken header | `<name> could not be read as an image` |

The type comes from the first bytes of the file and not from its name. Each refusal is shown and the other images go on.

**The Node.** It can be resized freely, width and height apart, down to 48 × 48. The picture is contained and centred,
never stretched. A photo with EXIF rotation starts with its width and height swapped, since the orientation is not read.
If the image cannot be shown, a plate says "Image not available" or "Image too large".

**Lifetime.** The file lives in the Project's data folder. ⌘Z of a paste removes the Node and keeps the file for ⇧⌘Z.
The Trash moves the file with the entry unless another Node shows it. At app start, a file no Node shows is deleted when
older than 10 minutes. Nothing is deleted when the Layout cannot be trusted: no `layout.json`, one that does not parse,
or a `layout.json.unreadable-*` next to it.

#### On a Linked machine

Images cannot be added, whatever the level of access. With Read only, a paste or drop shows the read-only notice as a
toast. With Full access it shows "Images can't be added to a Linked machine's canvas yet: paste or drop them on this
machine's canvas". main refuses such a call as well. The images already on that Canvas are shown, with no resize
handles, and Delete leaves them. If the Machine is out of reach, the plate says "Image not available: the Linked machine
is not reachable".

#### Windows

Before the `worfy-image://` protocol reads a file, it walks the path and reads each link without following it. A link
that leads to a network path gets 404, because following it would contact that host and hand it the user's credentials.

### How it works

**Images are in worfy's own data folder**, next to the Layout, so a picture on the Canvas does not touch the repository
([ADR-0005](../adr/0005-worfy-own-state-inventory.md)).

**A dedicated protocol serves them.** A window reaches the file only by a pattern of 32 hex digits and an extension in
one known folder, and the answer is locked down: `default-src 'none'`, `nosniff` and `no-store`. The same address form
serves both this Machine's and a Linked machine's images.

### Implementation

| Module | What it holds |
| --- | --- |
| `src/renderer/canvas/overlays/ImageDrop.tsx` | Paste and drop, and the rules about where they count |
| `src/renderer/canvas/image-drop.ts` | The size on the Canvas, the cascade, the check before reading |
| `src/renderer/canvas/nodes/ImageNode.tsx`, `src/renderer/canvas/nodes/image-url.ts` | The Node, its address and its plates |
| `src/shared/ipc/canvas-images.ts` | Limits, types, messages, the Node's data |
| `src/main/ipc/canvas-images.ts` | `canvasImage.add`, the sweep at app start |
| `src/main/layout/images.ts` | `storeImage` and `sweepImages` |
| `src/main/images/protocol.ts`, `src/main/images/stores.ts`, `src/shared/images.ts` | The `worfy-image://` protocol and its stores |
| `src/main/images/remote.ts`, `src/shared/ipc/images.ts` | The bytes of a Linked machine's image |
| `src/main/remote-links.ts` | The walk for links leading off the Machine |

**Data flow.** A paste or drop checks the size, reads the bytes and sends them with `canvasImage.add`. `storeImage`
checks the size and the first bytes, reads the natural size from the header and writes
`<Project data folder>/images/<id>.<ext>` without overwriting. The renderer then creates the Node in one `create` per image. The Node
asks for `worfy-image://canvas.<project label>/<file>`, or with `.<machine label>` added after the label for a Linked
machine. There the bytes come in chunks over `images.file` and are checked again: 404 for no file or an unknown Machine,
413 when too large, 502 when unreachable. Only GET and HEAD are served.

**Main tests:**

- `test/unit/image-drop-overlay.test.tsx`, `test/unit/image-node.test.tsx`: paste, drop, the Node and its plates.
- `test/contract/canvas-images.test.ts`, `test/contract/image-store.test.ts`: types, sizes, the sweep.
- `test/contract/canvas-image-protocol.test.ts`, `test/contract/linked-image-protocol.test.ts`: the protocol.
- `test/e2e/canvas-image.spec.ts`, `test/e2e/linked-images.spec.ts`: on a real window.
