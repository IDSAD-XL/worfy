# Focus mode

Focus mode fills the main area of the window with the chosen Nodes, as tiles, and each Node keeps working in its tile.
The [Canvas](canvas.md) under it stays as it was. This is not the Focus mode of the operating system, the "do not disturb"
that [Notifications](notifications.md) mentions. Terms are explained in [Concepts](concepts.md).

## Behaviour

### Opening

- **The Focus button.** It stands 12 below the selection while at least one visible Node is selected, and shows its key.
- **⌘↩.** It opens the selection while the Canvas is the view on screen. In a place to type, the key stays with that place.
  With nothing selected it does nothing.
- **A double click on a Ticket card.** It opens focus mode on that Ticket alone, whatever is selected
  ([Workflow](workflow.md)).

Focus mode always opens with the Even preset. From a selection, the tiles go in the order the Canvas holds the Nodes, not the
order they were selected in. An Epic frame cannot be selected, so it never gets a tile.

### What is on screen

The layer covers the main area of the window: the toolbar and the Canvas. The sidebar stays next to it and keeps working.
With the sidebar hidden, the layer is the whole window.

Above the layer open the Command palette, the menus and dialogs of the sidebar, the Settings window and the Keyboard
Shortcuts window. Toasts are above it too, and keep clear of the bar, the title bars of the tiles and the header of a Node
in a tile, apart from a Browser's.

**The bar** takes the place of the toolbar and moves the window the same way. From left to right:

- The button that hides and shows the sidebar, the same one as in the toolbar.
- The title, "Focus · 1 node" or "Focus · 3 nodes".
- The presets: Even, Main + side, Columns, Rows.
- "Exit focus" with its key, Esc.

In a narrow bar the title is cut first, then the presets scroll sideways in their own box. At a width of 420 or less, the
title and the key on "Exit focus" are gone. The sidebar button and "Exit focus" always stay whole.

**A tile** has a title bar 22 tall, with a grip and the Node's title, or its kind when it has no title. Under it is the Node itself.

### Tiles

**Presets.** A preset lays out the current tiles again, in their order left to right and top to bottom, and drops what
dragging did to their sizes. With one tile they change nothing.

| Preset | Layout |
|---|---|
| Even | As square a grid as the count allows, filled row by row, with `ceil(√n)` columns: 3 tiles are 2 and 1, 5 tiles are 3 and 2. A short last row is stretched |
| Main + side | The first tile takes the left 2/3. The rest stand in one column in the right 1/3, with equal heights |
| Columns | One row with equal widths |
| Rows | One column with equal heights |

**Dividers.** Dragging a divider moves it, and only the two parts next to it change. Neither gets smaller than 10 % of the
split's length, or half of what the two have together when that is less. A double click on a divider gives all parts of its
split equal shares.

**Dragging a title bar.** A press with the main button becomes a drag after 4 of travel. The dragged tile fades, and the
target shows where the drop would go.

| Drop on another tile | Result |
|---|---|
| Within 25 % of its width or height from an edge | The target's place is divided in half at the nearest such edge, and the dragged tile takes one half. The neighbours of its old place share that place in proportion to their sizes |
| Anywhere else | The two tiles swap places |

A drop on the tile itself or outside any tile does nothing. So does a pointer that is cancelled. A release the window
missed, such as one over another app, shows at the next press: that press ends the drag with no drop.

### A Node in a tile

A tile draws the Node's own component, and what the Node changes goes to main as on the Canvas: text typed into a Note is
saved. In a tile the Node counts as not selected, so it has no resize handles and does not move. Differences by kind:

- **Ticket.** It shows its whole file under the header ([Workflow](workflow.md)). A double click there does nothing.
- **Terminal.** The tile shows the same shell as the Canvas Node, and the shell gets the size of the tile. It keeps that
  size while focus mode is open, even if the Canvas Node is resized ([Terminal](terminal.md)).
- **Browser.** While this window draws the page, the page lies over the body of the tile and takes input there. Browsers
  left on the Canvas stay rendered under the layer, invisible and without input ([Browser](browser.md)).
- **Card.** Its page runs at any zoom and takes the mouse at once ([Cards](cards.md)).

A Node that leaves the Canvas, removed or hidden, leaves its tile, and its neighbours share the place. With no Node left,
focus mode ends.

### Leaving

- **Esc**, by the table below.
- **"Exit focus"** in the bar.
- **The last Node leaving the Canvas.**
- **Another Project becoming active.**
- **A request to the main area.** Carried out under the layer, it would look ignored, so focus mode leaves on it. The
  requests are: the Session view or the Pipeline view; a click on an Epic or a Session in the sidebar; "Go to" of the Command palette; a new Node;
  "Tidy up", "Arrange by Epic" and "Re-pack"; a tag filter set or taken off; an ADR opened.

Where the keyboard focus decides what Esc does:

| Keyboard focus | Esc |
|---|---|
| In the layer, a Note's field included, or nowhere | Leaves, unless a Node in a tile took the press first, as when it closes a popup of its own |
| On the screen of a Terminal tile | Goes to the shell. Focus mode stays |
| On the page of a Browser tile | Stays with the page. Focus mode stays |
| In the sidebar, or inside a menu or a dialog outside the layer | Stays there. Focus mode stays |

With the focus in the layer or nowhere, a menu or a dialog open outside the layer goes first: one press, one action. If it
reacts, by closing or by keeping the press for itself, focus mode stays and the next press can leave. If it does not react,
the press leaves focus mode and it stays open.

### Keys

| Key | In focus mode |
|---|---|
| ⌘↩ | Opens focus mode from the Canvas; it opens nothing more while focus mode is open |
| Esc | Leaves, by the table above |
| ⌘B | Hides or shows the sidebar |
| ⌘K | Opens the Command palette above the layer |
| ⌘F | Does nothing: the find bar of the Canvas does not open under the layer |
| ⌘=, ⌘-, ⌘0 | Do nothing: the Canvas does not zoom unseen |
| ⌥⌘=, ⌥⌘-, ⌥⌘0 | Reach the interface scale items of the View menu ([App shell](app-shell.md)) |
| Tab | Walks the layer's controls and the sidebar, never the toolbar or the Canvas under the layer |

Pressed with the focus in the layer or nowhere, arrow keys move no Canvas Node, and Delete, Backspace, ⌘Z and ⇧⌘Z do not
act on the Canvas. With the focus nowhere, ⌘Z and ⇧⌘Z go to the undo of the Edit menu, which can undo typing in a Note's
field in a tile. The wheel does not pan or zoom it.

### What stays and what is dropped

| What | On leaving |
|---|---|
| The tiling: preset, dividers, drags | Dropped. The next opening starts from Even again |
| Layout, camera and selection of the Canvas | As they were. Focus mode itself changes none of them and sends no Layout operation |
| What was done to a Node in a tile | Stays, as on the Canvas |
| A Terminal's size | The shell gets the size of the Canvas Node back |
| A Browser's page | Back on its frame: the same page, with its history, scroll and typed text |
| Whether the sidebar is shown | Saved, apart for the normal view and focus mode. Both answers outlive a restart and are the same in every window of the Machine |
| The keyboard focus | Back where it was before opening. A focus that went to the sidebar meanwhile stays there, and it does not go back to a Canvas Node out of view, because React Flow would pan the Canvas to it |

### Windows

Ctrl takes the place of ⌘: Ctrl+Enter opens focus mode, and the key label on the Focus button says so. In a Terminal tile
Ctrl+= and Ctrl+- do nothing, as elsewhere in focus mode, and Ctrl+_ stays the shell's undo ([Terminal](terminal.md)). In a Terminal tile Ctrl+F stays with the
shell.

With the sidebar hidden on macOS, the bar keeps 80 clear for the traffic lights. On Windows there are none, and it does not.

### On a Linked machine

Focus mode opens on a read-only screen too, and the tiling stays in this window.

With Read only access, a Terminal tile shows the same stand-in as the Canvas and never opens the shell, and a Browser tile
has no address bar and no page. With Full access, a Terminal tile shows the Terminal. A Ticket tile reads its file on the
Linked machine, and "Open in editor" shows where the file is ([Workflow](workflow.md)).

## How it works

**The tiling is a tree in memory.** A split lays its children side by side or one under another, each with a share of the
split's length, and the leaves are Node ids. Every operation returns a new tree in one canonical shape: no split with a single
child, and no split directly inside a split of the same direction. The tree is never sent to main and never saved, which is why
leaving shows the Canvas exactly as it was.

**A tile is a second view of the Node.** Its data comes from the same React Flow store as on the Canvas, and the Canvas keeps
its own copy mounted under the layer. Tiles are only positioned, so a new tiling does not mount a Node again. A Node can ask
whether it is in a tile and show more there, as a Ticket does.

**See-through tiles.** A `<webview>` moved in the DOM loads its page again, so a Browser's page stays where it is, under the
layer. Its frame declares the tile see-through, and the page is laid over the tile's body.

**The cover.** What the layer covers is inert, so no key or click reaches a Node underneath. While a tile is see-through, the
covered part is hidden and inert instead, except the pages marked to stay rendered. Inert does not stop a frame's script
from taking the keyboard focus, so a focus that lands under the cover goes back to the layer, unless it is on the page
shown in a tile.

**Esc is decided in two steps.** The capture phase reads where the focus is and what is open outside the layer, before anyone
handles the press: a menu that closes on Esc has left the page by the time the press bubbles up. The bubble phase checks
whether someone took the press. With a menu or a dialog open outside the layer, the answer waits for the task of the press to
end, because such listeners can run after focus mode's own.

**Gestures follow the pointer on the window.** Chromium can take the pointer capture away in the middle of a drag with no
pointercancel, so a lost capture does not end a gesture, and a pointermove with the button up is skipped and not taken for a
release.

## Implementation

- `src/renderer/focus/FocusMode.tsx`: the layer, drawn with a portal in the element the shell names. Also the bar, tiles,
  gestures, Esc and the keyboard focus.
- `src/renderer/focus/split-tree.ts`: the tree as pure functions, the presets and their shares, the geometry, the drop zones.
- `src/renderer/focus/cover.ts`: the cover while a tile is see-through, and the guard that brings the focus back.
- `src/renderer/focus/focus-state.ts`: what the shell and focus mode know of each other outside React (the slot, whether
  focus mode is active, a request from a Node, the sequence number of layout changes). Nothing there is saved.
- `src/renderer/focus/focus-tile.ts`: the contexts a Node reads, whether it is in a tile and how to make the tile see-through.
- `src/renderer/focus/focus.css`: the layer, tiles and see-through rules.
- `src/renderer/canvas/overlays/FocusEntry.tsx`: the Focus button and ⌘↩, the state of the tiling, and leaving on a request.
  It is mounted anew with the Canvas of each Project.
- `src/renderer/shell/AppShell.tsx`: names the main area as the slot.
- `src/renderer/shell/sidebar-visibility.ts`: the two saved answers for the sidebar, kept in the app settings
  (`src/shared/settings/app-settings.ts`).
- `src/renderer/canvas/nodes/TicketNode.tsx` and `src/renderer/canvas/nodes/TicketBody.tsx`: the double click and the whole file.
- `src/renderer/canvas/nodes/terminal-views.ts`: which view of a shell sets its size.
- `src/renderer/canvas/nodes/BrowserNode.tsx` and `src/renderer/canvas/overlays/BrowserLayer.tsx`: the page over a tile.
- `src/shared/shortcuts.ts`: the entries for ⌘↩ and Esc.

Data flow: a selection or a request builds a tree in `FocusEntry.tsx`, which renders `FocusMode.tsx` with it. Each change of
the tiling goes back to that state. On closing, the state is dropped and the layer's effects take the cover off and return the
focus.

Main tests: `test/unit/split-tree.test.ts`, `test/unit/focus-mode.test.tsx`, `test/unit/focus-cover.test.tsx`,
`test/unit/ticket-focus.test.tsx`, `test/unit/interface-scale.test.tsx`, `test/e2e/focus.spec.ts`,
`test/e2e/focus-sidebar.spec.ts`, `test/e2e/browser-focus.spec.ts`, `test/e2e/ticket-focus.spec.ts`.
