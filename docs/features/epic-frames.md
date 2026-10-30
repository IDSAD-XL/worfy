# Epic frames

Two Features of the [Canvas](canvas.md). **Epic frame** draws an Epic and its Tickets. **Done shelf** holds finished
Epics as chips. Terms are explained in [Concepts](concepts.md). What Tickets and their states mean is on
[Workflow](workflow.md).

## Epic frame

### Behaviour

Each Epic of the workflow is drawn as a frame, unless it is on the Done shelf. An Epic with Tickets and no spec gets one
too. A frame cannot be selected or deleted. It is dragged by its header, and its Tickets are not dragged at all.

**Header.** It shows the tag "Epic", the name, the title, a progress bar of 12 segments (done, working, blocked, open),
the count done/total, the Epic's actions and a chevron that collapses the frame. The frame is at least 520 wide and wide
enough for the whole name. A collapsed frame is exactly 56 tall. A frame with no Tickets says "No tickets in this epic."

**Columns.**

| Column | What is in it |
| --- | --- |
| Done | Finished Tickets in a folded stack with "N done" and their numbers; first when there are any |
| Level 1 … Level n | Tickets not done, by their depth in `Blocked by` among the Tickets not done |
| Needs attention | A `Blocked by` that does not parse, a missing blocker, or a cycle |

Level 1 has the chip "Ready wave · N" when N Tickets are ready, and a ready Ticket has a Ready chip. A Ticket is 240
wide and at least 138 tall, as tall as its content. Columns are 24 apart and rows 12. Double click on a Ticket opens
focus mode.

**Done stack.** The Done column label has a toggle. Opening the stack moves neither an open Ticket nor the strip. It is
a view state: it is not saved and is not in undo. Esc with nothing selected, no dialog or menu open, and not in a text
field folds the stack opened last.

**Collapsing.** An Epic with Tickets, all done, is collapsed by default until the user opens it. The chevron is one step
of undo.

**The strip.** Frames stand in K columns in the strip's order: frame i goes to column i mod K. Every column is as wide as
the widest frame of the strip, and frames and columns are 48 apart. The strip starts at y = 0. Its left edge is the first x from 0
rightwards that stays 48 from every Node on the plane in the band of the strip's height. A Node lower than that does not
move it. The size of the window does not count.

**How many columns.** K aims for a shape of 16:10. Without an earlier K, the candidate closest to that wins, the smaller
on a tie. An earlier K stays while it is within 30 % of the target. Otherwise the fresh K replaces it when the fresh one
is within 30 %, or when the old one is more than 1.3 times further off.

**Order of the strip.** With no record of the arrangement, frames go by name. With a record, the order is kept: Epics
that are gone drop out, and new ones go to the end by name. Activity alone changes nothing. Three automatic writes change
the record, all past undo: the first opening of a Project in a calendar day puts active Epics first and picks K afresh, an
Epic on the Done shelf by default leaves the order, and a new K is written when K changes. An active Epic has a claimed Ticket, a live agent bound to it or to its Ticket,
or a running Autopilot. "Re-pack" puts active Epics first and picks K with no bias towards the old one, as one step of
undo.

**Moving a frame.** The drag is rounded and [snaps like a Node](canvas.md#node-and-layout). It is one step of undo and
moves only that frame: the frames below stay at their automatic places. A moved frame yields: if it comes closer than 16
to a Node or another frame, it is drawn at the nearest clear place and keeps its saved offset.

#### On a Linked machine

With Read only access, the frames do not move and the chevron is inactive. Opening the Done stack still works, since it
saves nothing. The automatic writes of the order do not run, and "Re-pack" is inactive.

### How it works

**A frame never covers a Node**, and it is the frame that keeps away
([ADR-0032](../adr/0032-epic-frames-avoid-nodes.md)). ELK lays out the inside of a frame in a Web Worker, for fewer
crossings and lines that go around Tickets ([ADR-0037](../adr/0037-epic-frame-layout-by-elk.md)). The Done column is one
block for ELK, so opening it changes nothing in the graph ([ADR-0039](../adr/0039-done-column-is-one-block-for-elk.md)).
The strip has K columns because one column grew to several screen heights. It does not depend on the window, so two
screens show one Project with the same places ([ADR-0075](../adr/0075-epic-frames-in-columns-and-done-shelf.md)).

**For the frames themselves, the Layout keeps only what the user changed.** The frame itself comes from the workflow
([ADR-0002](../adr/0002-worfy-is-a-view-over-the-workflow.md)). For each changed Epic, the Layout has a locked
`epic-frame` Node of size 1 × 1. Its x and y hold the offset, and its data holds `collapsed`.

### Implementation

| Module | What it holds |
| --- | --- |
| `src/renderer/canvas/sources/epics.ts` | Builds the frames and Tickets from the workflow, the first write, collapse and offset |
| `src/renderer/canvas/epic-layout.ts` | Sizes, columns, levels, the strip and the synchronous layout |
| `src/renderer/canvas/epic-arrangement.ts` | K, its bias, and the order |
| `src/renderer/canvas/arrangement-record.ts` | The `epic-arrangement` record and when it is written |
| `src/renderer/canvas/elk/client.ts`, `src/renderer/canvas/elk/layout.ts` | The ELK requests and the Web Worker's work |
| `src/renderer/canvas/nodes/EpicFrameNode.tsx`, `src/renderer/canvas/epic-frame.css` | The frame |
| `src/renderer/canvas/edges/blocking.ts`, `src/renderer/canvas/edge-types/RoutedEdge.tsx` | The `Blocked by` lines |

**Data flow.** The workflow model reaches `sources/epics.ts`. Synchronous `layoutEpic` draws Tickets by number with
straight lines until ELK has its first answer. While a newer request is out, the earlier places are kept and a new
Ticket waits. A failed request is answered with the synchronous layout, and a collapsed or empty frame always uses it.
The sizes then go to `placeStrip`, with K and the order from the record, and the frames' final places are React Flow
Nodes.

**Main tests:**

- `test/unit/epic-layout.test.ts`: sizes, columns and the strip.
- `test/unit/epic-arrangement.test.ts`, `test/unit/epic-arrangement-record.test.tsx`: K, the order and automatic writes.
- `test/unit/epic-canvas.test.tsx`, `test/unit/elk-client.test.tsx`: frames from the workflow, ELK requests and
  failures.
- `test/e2e/epic-frame.spec.ts`, `test/e2e/epic-columns.spec.ts`, `test/e2e/epic-frame-undo.spec.ts`: on a real window.

## Done shelf

### Behaviour

An Epic with Tickets, all done, and with its frame collapsed, is a chip on the shelf rather than a frame. An open frame
of a done Epic stays in the strip. An empty shelf is not drawn. The shelf cannot be selected, dragged or deleted.

**The chips.** The shelf is labelled "Done" with the number of Epics, and each chip reads `✓ <epic> N/N`. The tooltip
says `<epic>: every Ticket is done. Expand the frame`. A click opens the frame at the end of the strip's order, as one
step of undo. The chips follow the recorded order, then the others by name. A chip wider than the shelf gets its own row
and is cut with an ellipsis.

**The place.** The shelf stands at the strip's left edge, 48 under the tallest column of frames as drawn. Its width is
the strip's, at least 520. An open Done stack moves the shelf down only when its column reaches the shelf. The room for
an open stack is reserved, so opening one never moves the strip. A moved frame yields to the shelf as to a Node.

**Coming and going.** The chevron on a frame whose Tickets are all done sends it to the shelf and takes it out of the
strip's order in one step of undo. An Epic that is on the shelf by default leaves the order by an automatic write, past
undo. If a Ticket is reopened or added, the Epic returns to the strip, last. Epics on the shelf do not count in K.

**Finding.** The sidebar, the palette's Go to and Find all lead to the chip. A Binding line to an Epic on the shelf ends
at its chip, and [Arrange by Epic](canvas.md#node-and-layout) counts its Sessions as Unbound.

#### On a Linked machine

With Read only access, the chips are inactive.

### How it works

Frames of finished Epics take room in the strip, so they become a row of chips under it
([ADR-0075](../adr/0075-epic-frames-in-columns-and-done-shelf.md)). The shelf stands under the frames as drawn and not
under the room reserved for open stacks: that room can be far taller than the frames, and a distant shelf stretched the
minimap ([ADR-0082](../adr/0082-done-shelf-under-visible-frames.md)). It is computed from the workflow and the collapse
state, and the Layout has no Node for it.

### Implementation

| Module | What it holds |
| --- | --- |
| `src/renderer/canvas/epic-layout.ts` | `onDoneShelf`, `layoutShelf`, and how the room in `placeStrip` is reserved |
| `src/renderer/canvas/sources/epics.ts` | `doneShelfNode`, `expandFromShelf`, `toggleFrame`, `shelfChipRect` |
| `src/renderer/canvas/nodes/DoneShelfNode.tsx`, `src/renderer/canvas/done-shelf.css` | The shelf and chips |
| `src/renderer/find/node-rect.ts` | Where a Find match on an Epic on the shelf is |

**Sizes.** Padding is 12, the label 24 tall, a chip 24 tall, and chips 8 apart. Chip width comes from the text at 7.2
per character plus 46.

**Main tests:**

- `test/unit/done-shelf.test.tsx`: who is on the shelf, its place and chips.
- `test/unit/done-shelf-binding.test.tsx`: Binding lines to a chip.
- `test/e2e/done-shelf.spec.ts`: on a real window.
