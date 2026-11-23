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
- A Ticket that waits for the owner by itself: `blocked` with `Waits: owner`. The check of `Waits: owner` is the one
  Autopilot's queue of Epics uses to tell the owner's Tickets apart, one function for both; Autopilot also leaves a
  Ticket with no status to the owner, the queue does not show one as waiting.
- An item that is not manual never waits for the owner. It is shown next to the manual items of its Ticket as what the
  agents and the Orchestrator prepared.

**Groups**, in this order; each has a count, the number of its rows:

| Group | What is in it |
|---|---|
| Ready to check | An item that waits, and its change can be looked at: the Ticket is done in the checkout (merged), or the Ticket itself waits for the owner (the Orchestrator prepared the acceptance). |
| Update first | The same, but the change is not in the owner's Stable copy yet (see [Stable copy](#stable-copy) below). Only a Project whose repository is worfy's own has a Stable copy. |
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
files, so no Profile command runs while nothing changes, and gh and git run only for the Stable copy line (below); the
queue is computed again when a model, the Project list or a Sent mark changes, when a mark turns "Not recorded yet",
when an answer for a Stable copy line comes, and once a minute. "Merged" is read from the model
alone: the list of Tickets is read from the Project's main branch
([ADR-0107](../adr/0107-workflow-read-from-main-branch.md)), so a Ticket done there has its change merged.

One answer covers every Project of the Machine: a window asks once, with no Project in the request, and gets the whole
queue again after each change. A row carries everything a view needs: the item with its Evidence lines, the items of
the Ticket that are not manual, the Sent mark, and the Stable copy line of an item of Ready to check or Update first.

The Sent marks are worfy's own state, in the data folder of the Project
([ADR-0005](../adr/0005-worfy-own-state-inventory.md)): the Project, the Epic, the Ticket and item numbers, a hash of
the item's text, the verdict and the time. The owner's words and the item's text are not kept there.

#### On a Linked machine

A Linked machine reads the queue of this Machine's Projects while "Linked machines can work with my Projects" is on,
as it reads the other live state of the Projects. A Project kept on this Machine only is left out of the answer and of
every change sent after it.

## Stable copy

### Behaviour

Each item of Ready to check and Update first carries one line that says whether its change is in the owner's Stable
copy, the copy of worfy the owner checks in:

- **In your Stable copy 0.4.N — the change is there since 0.4.M.** The item stays in Ready to check.
- **Not in your Stable copy yet: it runs 0.4.K, the change is in 0.4.M.** The item goes to Update first. When an
  Available update has the change, the row offers **Update worfy**; otherwise it says that `main` waits for a green CI.
- **Stable copy not checked**, with the reason: a commit this checkout does not have (worfy never fetches the
  Project's repository for it), no Stable copy on this Machine, or GitHub did not answer. The item stays in Ready to
  check, and the line is asked again a few minutes later.

The numbers are build numbers, as worfy shows its own version: `0.4.N` is the major and minor of the commit's
`package.json` and the count of commits up to it. `0.4.M` is the first build with the change.

Only a Project whose repository is worfy's own (`origin` is `IDSAD-XL/worfy`) has a Stable copy. Any other Project's
line says only **merged #N** (or **merged** for a Ticket done without a PR) or **not merged**.

### How it works

- The commit of the Stable copy is the one the file next to the copy names (`worfy-stable.json`, written by the
  install); when that file is missing and this window is the Stable copy, the commit Update gives this run.
- The merge commit is the one of the Ticket's `PR:` line, else of the merged PR of its branch, asked of gh as the
  Project's GitHub account. A Ticket that waits for the owner without a PR of its own takes the merges of its blockers
  that are done. gh is asked once per merged PR, only for the items of Ready to check and Update first, and the answer
  is kept for the rest of the run: a merged PR's merge commit does not change.
- Whether the change is there: `git merge-base --is-ancestor <merge> <Stable copy commit>` in the Project's checkout.
  The version numbers come from `git rev-list --count` and the commit's `package.json`.
- Nothing is written to the Project or to GitHub, and nothing is waited for: a line not known yet is empty, and the
  queue is sent again when it comes.

### Implementation

- `src/shared/acceptance/queue.ts`: the rule (`itemWaitsForOwner`, and `ownersOwn` of
  `src/shared/autopilot/epic-queue.ts`) and the groups (`acceptanceQueue`), pure functions over the models.
- `src/main/acceptance/service.ts`: the service. It follows every Project of the list through the workflow hub
  (`src/main/workflow/watch.ts`), keeps the Sent marks and drops those whose line has come.
- `src/main/acceptance/sent-store.ts`: the Sent marks, `acceptance-sent.json` in the Project's data folder.
- `src/main/acceptance/stable-line.ts`: the Stable copy line (`StableLine`), its gh and git questions and the answers
  kept; `src/main/ipc/acceptance.ts` gives it the PR tracker's gh and the Update service's Available update.
- `src/shared/ipc/acceptance.ts` and `src/main/ipc/acceptance.ts`: the call `acceptance.get` and the event
  `acceptance.changed`. The service starts with the app (`src/main/index.ts`).
- Tests: `test/unit/acceptance-queue.test.ts` (the rule, the groups and their order),
  `test/contract/acceptance-service.test.ts` (the service over two temporary Projects: the answer, a change after an
  edit of a Ticket file, the Sent marks across a new instance of the service),
  `test/unit/acceptance-stable-line.test.ts` (the text of the line, the versions, the merges of the blockers, one gh
  call per merged PR), `test/contract/acceptance-stable-copy.test.ts` (a temporary worfy repository and Stable copy:
  in the copy, not in it, a commit not in the checkout, and no second gh call for a later snapshot).
