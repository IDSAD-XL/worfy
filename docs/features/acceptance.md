# Acceptance

**Acceptance** is the list of checks that wait for the owner in every Project of the Machine: the manual items of
Tickets that nobody has proved yet, and the Tickets that wait for the owner's decision. worfy keeps this queue in the
main process, in groups, with the Evidence of each item and a "Sent" mark for a decision that is on its way. The view
that draws the queue is not in the app yet: today the queue is served to the renderer over IPC only. worfy writes
nothing into a Ticket for it ([ADR-0002](../adr/0002-worfy-is-a-view-over-the-workflow.md)). Terms are explained in
[Concepts](concepts.md); Evidence lines and manual items are on [Evidence](evidence.md).

## The queue

### Behaviour

**What waits for the owner.**

- A manual item of a Ticket's done section (an item with the Profile's manual mark, `(manual)` or the old Russian one)
  that has no `[x]` and is not verified. "Verified" is the state the item's Evidence lines give it: for a manual item,
  an `owner-check`, `screenshot` or `video` line with `pass`, on the platform and copy its `needs:` line names. An item
  whose last Evidence line is `fail` still waits.
- A Ticket that waits for the owner by itself: `blocked` with `Waits: owner`, or a Ticket with no status Autopilot can
  take. This is the same rule Autopilot's queue of Epics uses to tell the owner's Tickets apart, one function for both.
- An item that is not manual never waits for the owner. It is shown next to the manual items of its Ticket as what the
  agents and the Orchestrator prepared.

**Groups**, in this order; each has a count, the number of its rows:

| Group | What is in it |
|---|---|
| Ready to check | An item that waits, and its change can be looked at: the Ticket is done in the checkout (merged), or the Ticket itself waits for the owner (the Orchestrator prepared the acceptance). |
| Update first | The same, but the change is not in the Stable copy yet. The answer to "is it in the Stable copy" is not computed yet, so this group stays empty for now. |
| Waits for you | A Ticket that waits for the owner and has no item waiting: a decision, not a check. The row shows its `Blocked reason:`. |
| Failed | A manual item whose last Evidence line is `fail`, whatever the state of its Ticket. |
| In work | An item that waits, and its change is not merged: the Ticket is open, claimed, blocked for someone else, or done only in its worktree branch. |
| Older | An item of a Ticket closed more than 14 days ago (the time of its `Status:` line). A Ticket whose Status has no time readable stays out of Older. |

Inside a group the rows go by Project, in the order of the Project list, then by Epic, Ticket number and item number.

**Sent.** A decision the owner sends on an item (Pass or Fail) is marked "Sent" on that item until the Ticket file in
the checkout has a new `owner-check` line with the same verdict; then the mark goes. An older line with the same
verdict does not count: a Fail sent on an item that already failed waits for a new fail line. 24 hours after it was
sent without the line, the mark reads "Not recorded yet". A second decision on the item replaces the first. The mark
also goes when the item no longer waits for the owner, or its text was rewritten. A restart of worfy keeps the marks.

### How it works

The queue is computed in the main process over the workflow model of each Project, the same model the Canvas and the
"is waiting for you" notifications read ([Notifications](notifications.md)). The model is kept by watching the Ticket
files, so no gh, git or Profile command runs while nothing changes; the queue is computed again only when a model,
the Project list or a Sent mark changes, and when a mark turns "Not recorded yet". "Merged" is read from the model
alone: the list of Tickets is read from the Project's main branch
([ADR-0107](../adr/0107-workflow-read-from-main-branch.md)), so a Ticket done there has its change merged.

One answer covers every Project of the Machine: a window asks once, with no Project in the request, and gets the whole
queue again after each change. A row carries everything a view needs: the item with its Evidence lines, the items of
the Ticket that are not manual, the Sent mark, and a place for the Stable copy line, which is empty for now.

The Sent marks are worfy's own state, in the data folder of the Project
([ADR-0005](../adr/0005-worfy-own-state-inventory.md)): the Project, the Epic, the Ticket and item numbers, a hash of
the item's text, the verdict and the time. The owner's words and the item's text are not kept there.

#### On a Linked machine

A Linked machine reads the queue of this Machine's Projects while "Linked machines can work with my Projects" is on,
as it reads the other live state of the Projects. A Project kept on this Machine only is left out of the answer and of
every change sent after it.

### Implementation

- `src/shared/acceptance/queue.ts`: the rule (`itemWaitsForOwner`, and `ownersOwn` of
  `src/shared/autopilot/epic-queue.ts`) and the groups (`acceptanceQueue`), pure functions over the models.
- `src/main/acceptance/service.ts`: the service. It follows every Project of the list through the workflow hub
  (`src/main/workflow/watch.ts`), keeps the Sent marks and drops those whose line has come.
- `src/main/acceptance/sent-store.ts`: the Sent marks, `acceptance-sent.json` in the Project's data folder.
- `src/shared/ipc/acceptance.ts` and `src/main/ipc/acceptance.ts`: the call `acceptance.get` and the event
  `acceptance.changed`. The service starts with the app (`src/main/index.ts`).
- Tests: `test/unit/acceptance-queue.test.ts` (the rule, the groups and their order),
  `test/contract/acceptance-service.test.ts` (the service over two temporary Projects: the answer, a change after an
  edit of a Ticket file, the Sent marks across a new instance of the service).
