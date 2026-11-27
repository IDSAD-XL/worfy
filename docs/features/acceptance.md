# Acceptance

**Acceptance** is the list of checks that wait for the owner in every Project of the Machine: the manual items of
Tickets that nobody has proved yet, and the Tickets that wait for the owner's decision. worfy keeps this queue in the
main process, in groups, with the Evidence of each item, the line that says whether the change is in the owner's Stable
copy, and a "Sent" mark for a decision that is on its way. The **Acceptance** tab of the window shows it, and the owner
passes or fails each item there. The decision goes to the Project's Orchestrator as the text of "Record owner check";
the Harness's skill `owner-check` writes the `owner-check` Evidence line, ticks the item on Pass and files a rework
Ticket on Fail ([Evidence](evidence.md), "Who writes which line"). worfy itself writes nothing into a Ticket
([ADR-0002](../adr/0002-worfy-is-a-view-over-the-workflow.md)). Acceptance is not the Stage Human review of the
[Pipeline](workflow.md): that Stage waits for a review on GitHub before the merge, and Acceptance reads the Evidence of
manual items, usually after it. Terms are explained in [Concepts](concepts.md).

## The view

### Behaviour

**Where it opens.**

- The **Acceptance** View button, on the sidebar's rail by default ([App shell](app-shell.md)). It carries the count of
  the items of Ready to check that are not Sent (an item whose decision is "Not recorded yet" counts again) in the
  toolbar and the footer — on the rail the Acceptance section next to it carries that count — and its tooltip says
  "Checks that wait for you". It works without an open Project: the view is over every Project of the Machine.
- The **Acceptance** section of the sidebar counts the queue by Project, and its rail button carries the count of Ready
  to check ([App shell](app-shell.md#sidebar)). A click on a row opens the view on that Project's first row of that
  group.
- The Command palette has **Acceptance** in its View group. A Manual check row of the palette (found only by typing)
  opens the view on its item when the item is in the queue, else goes to its Ticket.
- A click on an "is waiting for you" notification opens the view on that Ticket when the queue holds it, else the
  Pipeline board of its Project ([Notifications](notifications.md)). A queue that has not answered by the time the
  notification stops waiting for its page counts as not holding it.

**Two panes**, as in [Pull requests](pr-inbox.md). On the left, the groups that hold a row, each with its count;
**In work** and **Older** are closed until the owner opens them by their title. A row shows:

- the Ticket and the item's number;
- at its right, the platform the item's `needs:` line names, or "Sent" while a decision waits for its line, or "Not
  recorded" once it has waited 24 hours;
- the start of the item's text as plain text, without its manual mark and Markdown markers; for a row of Failed, the
  words of its last `fail` line instead; for a row of Waits for you, its `Blocked reason:`;
- the Project.

A click selects a row. **↑** and **↓** move the selection along the open groups from anywhere in the view except a text
field, a menu or a dialog, and stop at its ends; with a modifier key held they do nothing. No other key is new. Before
the owner chooses, the first row of the open groups is selected, which is the first of Ready to check when it has one.
When the selected row leaves the queue, the row that now stands in its place is selected. While the queue is read the
view says "Reading the Tickets…"; with no row in any group it says "No check waits for you".

**The selected item**, on the right:

- the Project, the Epic, the Ticket and its title; under them "Item N of M · manual · needs <platform> <copy>", M the
  checkbox items of the Ticket's done section ("Item N" until the Project's workflow model is read; no `needs` part for
  an item without a `needs:` line);
- the Stable copy line of an item of Ready to check or Update first (see [Stable copy](#stable-copy)), with **Update
  worfy** when an Available update has the change, or the sentence that says why there is none;
- for an item whose `needs:` line names another platform than this Machine's, the build of the Linked machine of that
  platform (see [On a Linked machine](#on-a-linked-machine));
- the item's text, drawn as Markdown;
- the item's Evidence: the matrix of this one item, with the thumbnail of a screenshot that opens over the window and
  a clip that plays in place, with its contact sheet ([Evidence](evidence.md)). The view is the first place outside
  focus mode where they show;
- **Prepared by the Orchestrator · n of m verified**: the items of the same Ticket that are not manual, each with ✓ for
  verified, ✕ for failed and ○ for not yet;
- **Open Ticket** (the Ticket's card on the Canvas of its Project, which the view selects first) and **Open PR #N**
  when the Ticket has a `PR:` line and the repository's page is known.

**The decision row**, under the item:

- a comment field, "Comment (required for Fail)". Fail needs a comment: without one it is inactive, and its tooltip
  says so. In a Project in Full mode a line under the field says that the words go into the repository with the
  `owner-check` line;
- **Checked in:** the platform and the copy, each a choice. The platform starts at the one of the window's Machine; the
  copy at the one the item's `needs:` line names, else `stable` when the change is in the Stable copy, else
  `installed`. On the platform of a Linked machine (the window's Machine, or a connected one of the platform chosen),
  the decision carries the commit of the build that Machine runs (none, `-`, for a build with uncommitted changes), and
  the row shows that build. Otherwise, with the
  copy `stable` on the platform of this Machine, it carries the commit of this Machine's Stable copy (the one its Stable
  copy line reads, which main sends with the queue), and the row shows its version when the window is that copy, else
  its short commit. In every other case the commit is `-`, and the skill writes the line without one;
- **Pass** and **Fail**. A click sends "Record owner check" ([Projects](projects.md), "Project settings…"): the
  Project's template with the item, the verdict, the platform, the copy and the commit, and the owner's words after it,
  to the Project's Orchestrator, into its queue while a turn runs. The item's text as the view shows it goes too: main
  refuses a decision on an item whose text has changed since ("… has changed since you looked at it: reload the
  Acceptance view"). While main has not answered, both buttons are inactive with the tooltip "Sending…". Once it has,
  the row reads **Sent · waits for the line (pass)** (or `fail`) and the next row is selected. While the item is Sent,
  its Pass and Fail stay inactive ("Sent: the decision waits for its line in the Ticket"), so a second decision is never
  sent by mistake. After 24 hours without the line, the row reads **Not recorded yet (pass)**, with **Send again**, and
  Pass and Fail are active again. A refusal of main stays under the buttons: an empty template, Autopilot, an item that
  is no longer a manual item waiting for the owner, a changed text, an Orchestrator without a Session.
- While Autopilot runs in the item's Project, Pass and Fail are inactive, and the row says why: "Autopilot is running in
  this Project: stop it to record an owner check". On a read-only screen the tooltip of a read-only screen comes first.

**A Ticket of Waits for you** shows "Waits for you", its `Blocked reason:`, **Open Ticket** and **Open Orchestrator**
(the Session view of the Project's Orchestrator); it has no Pass and no Fail: it waits for a decision, not a check.

#### On a Linked machine

The Acceptance tab of a window on a Linked machine shows the queue of that Machine's Projects, as Pull requests shows
its pull requests. With Read only, Pass and Fail are inactive with the read-only tooltip, and that Machine refuses the
decision anyway. With Full access, a decision goes to the Orchestrator of the Project on that Machine. "Checked in"
starts at that Machine's platform, and the commit is the one of the build it runs, from its `hello`. The Stable copy line
is that Machine's too: in Update first it says "Update worfy on <name>" in place of the Update worfy button, which would
update this Machine.

An item whose `needs:` line names another platform than this Machine's shows the build of the Linked machine of that
platform: `PC build: <build> (<name>)` on a Mac while the PC is connected (`Mac build: …` and `Linux machine build: …`
the same way), `PC not connected` otherwise, also while a connection is open but its `hello` has not come yet. A worfy
over there without the view makes the view say `Update worfy on <name>: its worfy has no Acceptance view yet`; a window
whose Machine's `hello` names its build but no platform says `Update worfy on <name>: it does not say its platform`.
Another Linked machine without a platform may as well be a Mac, and is not counted. Screenshots and clips are not sent
over the link, as on [Evidence](evidence.md). See [Link](link.md), "On a Linked machine".

### How it works

The window reads the queue once with `acceptance.get` and then takes every `acceptance.changed`; the tab's count and the
sidebar section read the same copy, so the window asks main once whatever shows it. The view only draws: the groups,
the Stable copy line and the Sent marks come from main. What the window keeps itself is the selection, which groups are
open, the decisions main has not answered yet, and those it answered before the queue marks them Sent. Whether Autopilot
runs comes from `autopilot.state` and `autopilot.changed` for the selected row's Project; the Project's mode from
`checks.repos`; the Evidence links and previews take the Project's workflow model and the Ticket file's folder, as focus
mode does. The view opens that model only while it is on screen, and keeps it while the selection moves among the rows
of one Project: an open model fetches the Project's main branch
([ADR-0107](../adr/0107-workflow-read-from-main-branch.md)). The keyboard focus in the list follows the selection. The
item's text in the list row and in the Evidence matrix is plain text; the pane draws it as Markdown.

A window on a Linked machine sends `acceptance.get`, `acceptance.changed` and `actions.ownerCheck` to that Machine by
their access marks, as any other channel ([Link](link.md)). The build and platform of each Linked machine come from its
`hello`, which main keeps while the connection is open and gives to the windows with `linked.state`. A platform value
this build does not know is dropped and the rest of the `hello` kept, so such a Machine reads as one without a
platform.

### Implementation

- `src/renderer/acceptance/AcceptanceView.tsx`: the view, its two panes and the decision row.
- `src/renderer/acceptance/useAcceptance.ts`: the queue in the window, the selection, `sendDecision`.
- `src/renderer/acceptance/open.ts`: opening the view on a row, Open Ticket and Open Orchestrator.
- `src/renderer/acceptance/acceptance.css`; the View button is in `src/renderer/shell/views.tsx`, drawn in its zone by
  `src/renderer/shell/ViewZone.tsx`, and the view is mounted in `src/renderer/shell/AppShell.tsx`.
- The ways in: `src/renderer/shell/sidebar/AcceptanceSection.tsx` (the section and its rail badge),
  `src/renderer/palette/commands.ts` (Acceptance and the Manual check rows),
  `src/renderer/canvas/overlays/NotificationTarget.tsx` (the click on an "is waiting for you" notification).
- `src/shared/acceptance/linked-build.ts`: the build of a Linked machine for an item, the commit of a decision checked
  there, and "Update worfy on <name>".
- The decision in main: `actions.ownerCheck` (`src/shared/ipc/actions.ts`), handled by `ActionLauncher.ownerCheck`
  (`src/main/actions/launch.ts`), the template and its placeholders in `src/shared/projects/action-templates.ts`.
- Tests: `test/unit/acceptance-view.test.tsx` (the groups, the tab, ↑ ↓, every kind of Stable copy line, Fail without a
  comment, Autopilot, Pass, Sent and Not recorded yet, a refusal, Waits for you, a window on a Linked machine),
  `test/unit/acceptance-section.test.tsx` (counts by Project, the rail badge, a click), the "where a Manual check row
  leads" cases of `test/unit/palette-manual-check-row.test.tsx`, `test/unit/notification-ticket-click.test.tsx` (the
  click on an "is waiting for you" notification), `test/unit/acceptance-linked-build.test.ts` (the build line and the
  commit of a Linked machine); `test/e2e/acceptance.spec.ts` (the built app on the fake agent: an item with a screenshot
  and a clip, Pass reaching the Orchestrator, the line written into the Ticket taking the item away, ↑ ↓, screenshots
  at 1280 and 1600 px in both themes), `test/e2e/sidebar-rail.spec.ts` (the badge on the rail and the way into the view
  in the built app), `test/e2e/linked-acceptance.spec.ts` (two built worfy: the queue of the other Machine, Read only).

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
files, so no Profile command runs while nothing changes; the queue itself runs gh and git only for the Stable copy line
(below). The queue is computed again when a model, the Project list or a Sent mark changes, when a mark turns "Not
recorded yet", when an answer for a Stable copy line comes, and once a minute. "Merged" is read from the model alone:
the list of Tickets is read from the Project's main branch
([ADR-0107](../adr/0107-workflow-read-from-main-branch.md)), so a Ticket done there has its change merged.

One answer covers every Project of the Machine: a window asks once, with no Project in the request, and gets the whole
queue again after each change. A row carries everything a view needs: the item with its Evidence lines, the items of
the Ticket that are not manual, the Sent mark, and the Stable copy line of an item of Ready to check or Update first.

The Sent marks are worfy's own state, in the data folder of the Project
([ADR-0005](../adr/0005-worfy-own-state-inventory.md)): the Project, the Epic, the Ticket and item numbers, a hash of
the item's text, the verdict, the time, and the number of `owner-check` lines with that verdict the item had then; a
line comes when the item has more. The owner's words and the item's text are not kept there. Main keeps a mark only
after the decision's text has gone to the Orchestrator, so an item never reads "Sent" for a decision that did not go.
A Ticket the model no longer has keeps its marks, and a model that could not be read settles none.

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
  edit of a Ticket file, the Sent marks across a new instance of the service), `test/contract/acceptance-linked.test.ts`
  (the queue and the decision over the link, the build from `hello`).

## Stable copy

### Behaviour

Each item of Ready to check and Update first carries one line that says whether its change is in the owner's Stable
copy, the copy of worfy the owner checks in:

- **In your Stable copy 0.4.N — the change is there since 0.4.M.** The item stays in Ready to check.
- **Not in your Stable copy yet: it runs 0.4.K, the change is in 0.4.M.** The item goes to Update first. When an
  Available update has the change, the row offers **Update worfy**; otherwise it says that `main` waits for a green CI.
  A copy that does not check for updates (a dev run: Update is on only in the Stable copy) cannot know either, and the
  row says so: "This copy does not check for updates: update from your Stable copy".
- **Stable copy not checked**, with the reason: no Stable copy found on this Machine, GitHub did not answer, no merged
  PR found, the Stable copy's commit or the merge commit is not in this checkout (worfy never fetches the Project's
  repository for this line), or git did not answer. The item stays in Ready to check, and the line is asked again
  about 5 minutes later.

The numbers are build numbers, as worfy shows its own version: `0.4.N` is the major and minor of the commit's
`package.json` and the count of commits up to it. `0.4.M` is the first build with the change; a Ticket of several merges
is in the copy only when all of them are, since the build of its latest one. A shallow clone has no honest count, so
there the line names the commits by their short SHA instead.

Only a Project whose repository is worfy's own (`origin` is `IDSAD-XL/worfy`) has a Stable copy. Any other Project's
line says only **merged #N** (or **merged** for a Ticket done without a PR) or **not merged**.

### How it works

- The commit of the Stable copy: when this window is the Stable copy, this run's own commit, read once (not the one the
  last update check saved, which right after a restart into an Update still names the copy before); otherwise, and
  until that commit is known, the one the file next to the copy names (`worfy-stable.json`, written by the install).
  The queue names this commit too (`stableCommit`): the commit of a decision the owner checked in the Stable copy.
- The merge commit is the one of the Ticket's `PR:` line, else of the merged PR of its branch, asked of gh as the
  Project's GitHub account. A Ticket that waits for the owner without a PR of its own takes the merges of its blockers
  that are done. gh is asked once per merged PR, only for the items of Ready to check and Update first, and the answer
  is kept for the rest of the run: a merged PR's merge commit does not change. An answer that may still change (not
  merged yet, not in the checkout, a refusal) is asked again about 5 minutes later.
- Whether the change is there: `git merge-base --is-ancestor <merge> <Stable copy commit>` in the Project's checkout.
  A yes or a no is kept for the rest of the run. A yes is shared by every worktree of the repository; a no only by its
  own checkout, because a shallow clone may lack the history between two commits it has. A checkout that lacks the
  Stable copy's commit is asked only that (`git cat-file -e`), not once per merge. These git commands run at most three
  at a time.
  The version numbers come from `git rev-list --count` and the commit's `package.json`, none in a shallow clone.
- Whether the Available update has the change: by the build numbers when both are known, else by
  `git merge-base --is-ancestor <merge> <its commit>`; Update worfy is offered only when one of them says yes. When
  that commit is not in the checkout, the row says so: "The update's commit is not in this checkout: fetch to check".
- Nothing is written to the Project or to GitHub, and nothing is waited for: a line not known yet is empty, and the
  queue is sent again when it comes.

### Implementation

- `src/main/acceptance/stable-line.ts`: the Stable copy line (`StableLine`), its gh and git questions and the answers
  kept; `src/main/ipc/acceptance.ts` gives it the PR tracker's gh and the Update service's Available update.
- The file next to the Stable copy: `src/main/update/stable-copy.ts`; the version text:
  `src/shared/version-number.ts`.
- `src/main/workflow/git-ancestry.ts`: the `merge-base --is-ancestor` answers kept for the run, one question per pair
  at a time, and the limit of three git processes.
- Tests: `test/unit/acceptance-stable-line.test.ts` (the text of the line, the versions, the merges of the blockers, one
  gh call per merged PR, no git process in a second cycle, at most three at once), `test/unit/git-ancestry.test.ts`,
  `test/contract/acceptance-stable-copy.test.ts` (a temporary worfy repository and Stable copy:
  in the copy, not in it, a commit not in the checkout, and no second gh call for a later snapshot).
