# Workflow

Three close Features. **Ticket and Epic on the Canvas** show the work of a Project as its Ticket files state it.
**Pipeline** says on which Stage each Ticket stands. **Binding** ties each agent to the Ticket or Epic it works on. Terms
are explained in [Concepts](concepts.md).

## Ticket and Epic on the Canvas

### Behaviour

Each Epic of the Project is a frame on the Canvas, and each Ticket is a card in its frame. How frames are placed, moved,
collapsed and put on the Done shelf is on the [Canvas](canvas.md) page. A card cannot be dragged.

**The Ticket card** shows, from the top:

- The number, two digits at least. In a Project over several repositories, a chip with the `Repo:` line of the Ticket,
  or `no repo`.
- The stepper of its Stage (see [Pipeline](#pipeline)). While main has no Stage for it, a chip with the status instead:
  `open`, `claimed`, `blocked`, `done` or `no status`.
- A `Ready` chip when the Ticket is in the ready Wave.
- The title: the first H1 of the file without its leading number, or the slug of the file name when there is no H1.
- The reason of a blocked Ticket that has one. Otherwise one line: `no blockers`, `waiting on 03, 04`,
  `blocked by 03 · done`, or why the Ticket needs attention.
- Badges and actions: the chips of [Gate and GitHub](gate-and-github.md), the count of archived Sessions, Ship ticket and
  Open PR.

Nothing on the card is cut. Text wraps and the card grows in height, from 138 pixels at a width of 240. Its tooltip shows the Status line with
the reason, and `(in <branch>)` for a status that came from a worktree branch.

**Status.** It comes from the `Status:` line of the file. No Status line, or an old form of the header, reads as `no
status`. In Full mode the status of a Ticket's worktree branch goes over the checkout's, so a Ticket claimed in its
worktree shows `claimed` at once. A branch does not change a Ticket that is `blocked` or `done` in the checkout, and a
branch that says `open` or has no status changes nothing. In Silent mode no branch is read.

**Focus mode.** A double click on the card opens the Ticket in Focus mode: the whole file as markdown under the same
header. The text follows edits of the file. "Open in editor" opens the file. A file over 1 MB is not read. When a read
fails, "The Ticket file could not be read" shows with the reason, and the text read earlier stays.

**The Epic frame.** Its header has the Epic's name, the H1 of its `spec.md`, a progress bar of 12 segments, the count
`done/total`, the count of archived Sessions when there are any, Run wave and the [Autopilot](autopilot.md) buttons. The columns inside go from left to right:

| Column | Tickets |
|---|---|
| `Done` | Done Tickets, folded into one stack with their numbers until "Expand" opens it |
| `Level 1`, `Level 2`, … | The rest, by dependency. Level 1 has no blocker that is not done, apart from blockers in `Needs attention` |
| `Needs attention` | Tickets whose blocking cannot be read: a "Blocked by" that is not a list, a blocker outside the Epic, a cycle. The card's line names the reason |

An arrow goes from a blocker to the Ticket it blocks. It is dashed while the blocker is not done, and pale until it lies on
the lit chain of a hovered or selected Node. The arrow of a done blocker is solid and is drawn only while lit. An arrow is
drawn only when both Tickets have a card on the Canvas.

**The sidebar and the palette.** The Epics section lists the Epics of the active Project with their progress and `N in
work`; a click centres the frame. The Command palette has a "Go to" row for each Epic and Ticket, and for a Ticket with no
card it centres the frame. Each unchecked manual check of a Ticket (an item of its done section with the Profile's manual
mark) is a palette row found only by typing. Picking it goes to the Ticket. worfy does not tick these items.

**The ready Wave** is computed for each Epic and stored nowhere. A Ticket is in it when:

- It is `open`.
- Its "Blocked by" reads and it has no blocker outside the Epic. A cycle whose other members are all done counts as no cycle.
- Every blocker is done in the checkout. A blocker done only in an unmerged worktree branch is not done yet.
- No file of its trail section overlaps a held file. Tickets in work and Tickets done only in a branch hold their files,
  and so does each Ticket already taken into this Wave, in number order. An entry that ends in `/` holds its whole folder.

A Ticket without a trail section can be in the Wave: it holds nothing. Tickets of the Wave have the `Ready` chip, and the
label of Level 1 shows `Ready wave · N`.

**Actions.** Ship ticket and Run wave send the Project's action template, filled in with `{epic}`, `{NN}`, `{wave}`,
`{slug}`, `{branch}` and `{tickets}`. With the Harness plugin the defaults are `/worfy:ship-ticket {epic} {NN}` and
`/worfy:epic-wave tickets {tickets} of epic {epic}`. Both actions are also rows of the Command palette. An inactive button
gives the reason in its tooltip.

| Action | Shown | Active when | What it does |
|---|---|---|---|
| Ship ticket | On a Ticket that is `open`, `blocked` or has no status | It is `open`, every blocker is done in the checkout, no Session it launched for this Ticket is alive, the template is set and renders | A new Session Node with the text as its first message, right of the strip of frames at the Ticket's height. Without those on the Canvas, where any new Node goes. From the Command palette no spot is sent: the Node goes where any new Node goes |
| Run wave | On a frame, unless all its Tickets are done | The ready Wave is not empty and the template is set and renders | The text goes to the Orchestrator, into its queue while a turn runs. Refused while Autopilot runs in the Project |
| Open PR | On a Ticket with a PR | The address is on `https://github.com/` | Opens the PR in the browser and writes nothing to GitHub |

A template with an unknown placeholder or one without a value does not render, and the error is the reason on the button.
worfy reads the workflow again when Ship ticket or Run wave is clicked and takes the same decision again, so a Ticket
claimed meanwhile in a terminal is not shipped twice. The launched agent changes the status itself, with `ticket claim`.

**Empty and failed.** A Project without Epics shows the "No epics yet" panel. "Plan first epic" opens the Orchestrator and
sends it nothing. A frame without Tickets says "No tickets in this epic." When the workflow cannot be read, the Canvas has
no frames and the Epics section shows the reason.

#### On a Linked machine

Epics and Tickets are read on the Project's Machine, for Projects of its list only. On a read-only screen Ship ticket, Run
wave, collapsing a frame and "Plan first epic" are inactive and say why. With write access the actions run on the Project's
Machine. Focus mode reads the file there too, and "Open in editor" shows the toast "File is on <Machine>".

### How it works

- **worfy reads the workflow and never writes it.** The source of truth is the files, so no code of worfy changes a status
  ([ADR-0002](../adr/0002-worfy-is-a-view-over-the-workflow.md)). The only reader of the Ticket format is `epic-status
  --json` of the Harness found on the Machine. worfy adds what that script does not carry: the files of the trail section,
  the manual checks, the Epic's title and a hash of the Ticket's text.
- **Where the workflow lives** is the Harness's answer. In Full mode it is `.scratch` of the repository (or the Profile's
  `tickets.root`), in Silent mode the Workflow folder ([ADR-0042](../adr/0042-profile-on-machine-full-and-silent-modes.md)).
  A folder with no Profile reads as Full mode. A failed call of `profile` is not guessed around: the model carries the
  reason, and the call is repeated after 10 s, 30 s, 60 s and then every 5 minutes.
- **The headings are the Profile's.** `tickets.trail_section`, `tickets.done_section` and `tickets.manual_mark` name them.
  Without them the defaults are `## Where in code`, `## Done when` and `manual`, and the older Russian names are read too.
- **Reads follow changes.** A file event under the Tickets root leads to one full `epic-status` after 300 ms of quiet, and
  at the latest 1 s after the first event of a series. Reads never overlap. In Full mode the git refs and the worktree list
  are watched too, and only branches whose head moved are read again, four at a time. On macOS a Tickets root that is not a
  folder is looked for every 2 s. Only the files `epic-status` reads are watched: Epic folders, `spec.md`, `map.md` and `issues/*.md`.
- **A branch never undoes the checkout.** This is why a blocked Ticket with an old worktree branch does not look open
  ([ADR-0033](../adr/0033-autopilot-names-wave-tickets.md)).
- **Frames and cards are computed, not saved.** The Layout keeps only a frame's offset and collapse
  ([ADR-0011](../adr/0011-epic-frames-derived-nodes.md)). ELK picks the order inside the columns and the routes of the
  arrows in a Web Worker; until its first answer a simple layout stands in ([ADR-0037](../adr/0037-epic-frame-layout-by-elk.md)).
  A card's height is computed from the Ticket's data, nothing is measured on screen.

#### Windows

- The Tickets root is watched by a watcher that reads each link before following it, not by chokidar. Reads of Ticket files
  and specs treat a link that leads to a network share, or cannot be checked, as a file that cannot be read. The Project
  root, its real path and the Tickets root may lie on a share themselves.
- A missing Tickets root is waited for at the nearest folder above it. A look at the root that fails is repeated every 2 s,
  and every 30 s after five failures in a row.
- When a folder of the branch watch is removed, the watch is closed and made anew on the same paths.
- An older Harness's bash script cannot run on Windows: `epic-status` fails with a message that says to update the Harness
  ([ADR-0055](../adr/0055-harness-scripts-in-node.md)).

### Implementation

| What | Where |
|---|---|
| Reading the model, the trail section, the branch overlay | `src/main/workflow/reader.ts` |
| The watch and the hub that shares it | `src/main/workflow/watch.ts` |
| Where the workflow lives; the Profile | `src/main/workflow/folder.ts`, `src/main/workflow/profile.ts` |
| The model and its delta | `src/shared/workflow/types.ts` |
| Levels, the ready Wave, Wave numbers | `src/shared/workflow/waves.ts` |
| Headings, manual checks | `src/shared/workflow/doc-headings.ts`, `src/shared/workflow/manual-checks.ts` |
| The IPC of the model and of a Ticket's text | `src/shared/ipc/workflow.ts`, `src/main/ipc/workflow.ts`, `src/shared/ipc/tickets.ts`, `src/main/ipc/tickets.ts` |
| The renderer's shared copy | `src/renderer/workflow/useWorkflow.ts` |
| Frames and cards as Nodes; columns; card height | `src/renderer/canvas/sources/epics.ts`, `src/renderer/canvas/epic-layout.ts`, `src/renderer/canvas/ticket-card.ts` |
| The views | `src/renderer/canvas/nodes/TicketNode.tsx`, `src/renderer/canvas/nodes/TicketBody.tsx`, `src/renderer/canvas/nodes/ticket-text.ts`, `src/renderer/canvas/nodes/EpicFrameNode.tsx` |
| The arrows | `src/renderer/canvas/edges/blocking.ts` |
| Sidebar, palette, empty panel | `src/renderer/shell/sidebar/EpicsSection.tsx`, `src/renderer/palette/commands.ts`, `src/renderer/canvas/overlays/FirstEpic.tsx` |
| The buttons | `src/renderer/canvas/actions/TicketActions.tsx`, `src/renderer/canvas/actions/EpicActions.tsx`, `src/renderer/canvas/actions/OpenPr.tsx`, `src/renderer/canvas/actions/gates.ts` |
| Whether an action can run; templates | `src/shared/actions/render-template.ts`, `src/shared/projects/action-templates.ts` |
| Starting the work | `src/main/actions/launch.ts`, `src/main/ipc/actions.ts`, `src/shared/ipc/actions.ts` |

**Data flow.** The first view of a Project in each window calls `workflow.open`. `WorkflowHub` keeps one watcher per Project, runs
`epic-status`, lays branch statuses over the checkout and answers with the model. After each read that changed something,
each subscriber gets `workflow.changed` with only the Epics and Tickets that changed. The renderer applies it to its shared
copy, and `sources/epics.ts` turns the copy into Nodes. The same hub serves the Stages, Autopilot and the notes of waits.

**Main tests.**

- `test/e2e/epic-frame.spec.ts`, `test/e2e/ticket-focus.spec.ts`, `test/e2e/ship-ticket.spec.ts`: the Feature in the app.
- `test/contract/workflow-reader.test.ts`, `test/contract/tickets-read.test.ts`, `test/contract/actions.test.ts`: a stub
  `epic-status` run as a child process, the file guard and the channels.
- `test/unit/waves.test.ts`, `test/unit/epic-layout.test.ts`, `test/unit/ticket-card.test.tsx`,
  `test/unit/render-template.test.ts`, `test/unit/launch.test.ts`: the pure rules; the last also runs `ActionLauncher` over fakes.
- `test/contract/workflow-watch-retry.test.ts`: retries of the layout.
- Windows: `test/unit/tickets-watch.test.ts`, `test/unit/workflow-remote-links.test.ts`, `test/contract/workflow-watch-links.test.ts`,
  `test/contract/workflow-branches-gone.test.ts`, `test/contract/workflow-branches-handles.test.ts`.

## Pipeline

### Behaviour

Each Project has a Pipeline, and each Ticket stands on one of its Stages. Without configuration the Pipeline is Queued,
Implementing, CI, Agent review, Gate & merge, Closing, Done.

**Where it shows.**

- **The stepper on a Ticket's card:** a dot per Stage (passed, current, future, and a skipped Check drawn apart), the name of
  the current Stage, its flags and who the Ticket waits for. When that does not fit one line, when the Ticket has the `Ready`
  chip or a repository chip, or on a card narrower than 240 pixels, it drops the dots and shows `N/M` instead. The tooltip
  has the whole picture in words.
- **The board:** the "Pipeline" item of the View switch in the toolbar. A column per Stage of the active Project, with its
  count, and a card per Ticket. Done is folded into `N done` until clicked. The board follows changes by itself, and a click
  on a card shows that Ticket on the Canvas, or its frame when the card is folded away. When facts are missing, a notice says
  "Some Stages may be short of facts" with the reason.
- **The Pipeline section of the sidebar:** the Tickets of every Project of the window's Machine that are neither on Queued
  nor on Done. A click opens the board of that Project. With no such Ticket it says "Nothing in work".

**The rule.** The Stages go in Pipeline order, and a Ticket stands on the first one not passed. Status `done` passes every
Stage but Done, and a merged PR passes every Stage up to and including the merge. A Ticket that is `open` or has no status
stands on Queued whatever else is true: only a Ticket `claimed` or `blocked` is looked up on GitHub and in git.

| Stage | Passed when |
|---|---|
| Queued | The status is not `open` and the Ticket has a status |
| Implementing | The Ticket has an open PR or a mark on its head commit, and none of the last marks of each kind there is `failure` |
| CI | It has an open PR and every CI check of it is green. An open PR without checks passes |
| Agent review | The last mark `review` on the head commit is `success` |
| Human review | GitHub's review decision on the open PR is `APPROVED` |
| Check `<name>` | The last mark `check/<name>` on the head commit is `success` or `skipped` |
| Gate & merge, Awaiting merge | Only the merge, or status `done` |
| Deploy | The merge commit is in a deployed commit: a GitHub Deployment of the Stage's environment or, without an environment, in Full mode only, a commit with the status `deploy` |
| Closing | Only status `done` passes it |
| Done | A Ticket stops here |

A mark counts only on the head commit, so a new push makes earlier verdicts stop counting. A closed PR counts as no PR.

**Flags and captions on a Ticket.**

| Flag | When | On the board | On the stepper |
|---|---|---|---|
| Blocked | Status `blocked`, on whatever Stage | `Blocked: <reason>` | `!` with the reason in its tooltip |
| Rework | On Implementing with a `failure` mark on the head commit | `Rework` | `↺` |
| `failing` | On CI with a failed check | A caption | In the tooltip |
| `gate running`, `waiting for gate`, `gate busy` | On Gate & merge while the e2e lock of the Profile is held: for this PR, for others, or with no readable holder | A caption | In the tooltip |
| Waits | The `Waits:` line, else `team` on Human review and Awaiting merge, else `agent`. None on Done | `Waits: <who>` | `<who>` |
| Stuck | The time on the Stage reached its threshold | A frame, and `stuck: on CI for 3 h` in the tooltip | The same |

**Thresholds of stuck.**

| Ticket | Threshold |
|---|---|
| The Stage has `stuck_after` | That value |
| On Human review or Awaiting merge, or `Waits:` is `owner` or `team` | 24 hours |
| On Implementing, CI, Agent review or Gate & merge | 2 hours |
| Queued, a Check, Deploy or Closing | None |
| Done | Never, also with `stuck_after` |

The time on a Stage is counted from the latest known fact: the status time, or the time of the mark, check or merge that
passed the last Stage. With no known time a Ticket is not judged. The clock on screen ticks once a minute.

**Settings → Pipeline** edits the Pipeline of the active Project within the catalogue: 11 kinds, with no conditions of the
user's own. Queued stays first and Done last. A Stage in between can be moved, removed or added, and Checks can repeat under
different names. Fields:

- Label, on every Stage.
- Stuck after, on every Stage but Done: a number from 1 and `h` or `m`.
- Name, on a Check: lower case letters, digits and dashes.
- Environment, on a Deploy.

Gate & merge and Awaiting merge cannot be in one Pipeline. Save is active only for a valid change, and under it a line says
that every Stage will be computed again. A change is never blocked by Tickets in work, but these ask first:

- Removing a Check that Tickets in work have passed or stand on.
- Saving such a Check renamed.
- "Reset to default", which removes the Project's own Pipeline.

A Pipeline changed elsewhere since the read saves nothing and offers Reload. Another write in progress offers "Try again". A
Harness without the editor's script shows the Harness item with its Update. A commit that failed in the Harness home's git
leaves the write in place, with a warning.

**A notification** comes when a Ticket starts to wait for a person, that is, its `Waits:` is `owner` or a Machine's name, and no worfy window of the Machine that shows it has focus. Its
title is `<epic> NN is waiting for you`, its text the blocked reason or `<epic> NN — <title>`, and a click opens the board of
the Project. `team` and `agent` give none, and neither do other transitions such as red CI. One wait notifies at most once: a wait that begins while a worfy window has focus gives no notification later, and a second wait of the same Ticket within 10 s gives none. A wait
already there when worfy first reads the Project gives none.

#### On a Linked machine

The Stages are computed on the Project's Machine and read like the model. Settings shows the Pipeline read-only and says "Edit
it in worfy on <Machine>": a write is refused to every Linked machine, with full access too. `Waits: owner` notifies the
Project's Machine and each Linked machine that may see its Projects and accepts the message. `Waits: <Machine name>` notifies
only that Machine, and a name no Machine has notifies nobody. A Linked machine drops the note of a Project it has in its own
list, because it notified of it itself. A click on a Linked machine's note opens the board among that Machine's Projects.

### How it works

- **A Stage is computed and stored nowhere.** Each kind has its predicate in code, and the Profile only turns kinds on, orders
  and renames them ([ADR-0067](../adr/0067-pipeline-in-profile-and-sha-bound-agent-marks.md)). PR comments are not read: a
  verdict is a mark bound to a commit.
- **The facts** come from what worfy already reads: the workflow model, the PR tracker, git and the e2e lock. Deployments are
  asked only for a Ticket standing on Deploy. worfy never fetches, so a deployed commit that the local clone lacks keeps the
  Ticket on Deploy.
- **The branch of a Ticket** is its `Branch:` line, else `<epic>/<NN>`. Its head is the open PR's head, else the local branch's.
- **Marks have two stores, both only read here.** They are the commit statuses of the PR's head commit, except in Silent mode
  and in Full mode with `workflow.finish` `local-green` and no `origin`, where they are in
  `<Harness home>/runs/<project>/marks/<epic>-<NN>.json`. A broken file counts as no marks, and the log says why once. The
  read of commit statuses carries no description, so a `skipped` mark there reads as `success`, and the stepper draws a skipped
  Check apart only from the file.
- **Recomputing.** The Stages are computed on every change of a Ticket's fields (an edit of its text alone does not count)
  and every 60 s. The PR tracker runs `gh` only when its interval has passed: 60 s, doubling up to 32 minutes while `gh`
  fails. Subscribers get the whole snapshot when anything in it changed. A Project has one computation, which stops when its
  last subscriber leaves.
- **Several repositories.** A Ticket's facts come from the repository in its `Repo:` line
  ([ADR-0045](../adr/0045-one-ticket-one-repository.md)). A `claimed` Ticket without one has no facts, so it stays on the first
  Stage that needs them, usually Implementing. `gh` never runs in a root that is a plain folder.
- **A Profile that cannot be read** gives the default Pipeline and a reason in the snapshot.
- **The editor never writes the Profile itself.** It goes through the Harness's `bin/profile-set` with the fingerprint of what
  it read ([ADR-0073](../adr/0073-profile-set-writes-the-pipeline.md)). The rules of a Pipeline exist in the Harness and in
  worfy, and a contract test gives both the same cases.

#### Windows

A root spelled `C:/…` by the Project list and `C:\…` by a window is one computation: main keys it by `path.resolve`, and each
client gets snapshots with the root as it sent it.

### Implementation

| What | Where |
|---|---|
| The catalogue, the schema, `stageOf`, stuck | `src/shared/workflow/pipeline.ts` |
| Collecting the facts; `StageReader`, `StageHub` | `src/main/workflow/stages.ts` |
| Reading the marks | `src/main/workflow/marks.ts` |
| The PR tracker; Deployments | `src/main/github/prs.ts`, `src/main/github/deployments.ts` |
| The Profile's Pipeline | `src/main/workflow/profile.ts` |
| The Harness's copy of the rules | `harness/lib/pipeline.cjs` |
| IPC, the editor's read and write | `src/shared/ipc/pipeline.ts`, `src/main/ipc/pipeline.ts` |
| The renderer's shared copy | `src/renderer/pipeline/usePipeline.ts` |
| Board, stepper, shared wording | `src/renderer/pipeline/PipelineBoard.tsx`, `src/renderer/pipeline/Stepper.tsx`, `src/renderer/pipeline/board.ts` |
| Sidebar section; opening the board | `src/renderer/shell/sidebar/PipelineSection.tsx`, `src/renderer/pipeline/open.ts` |
| The editor | `src/renderer/settings/PipelineSection.tsx` |
| Notes of waits | `src/main/workflow/waits-notify.ts`, `src/main/notify.ts`, `src/renderer/canvas/overlays/NotificationTarget.tsx` |

**Data flow.** The first view of a Project calls `pipeline.get`. `StageHub` starts a computation that subscribes to the workflow
hub for changes of fields only. For each read, `StageReader` takes the Profile, the PRs, marks and branch heads of the Tickets
in work, and the lock, then calls the pure `stageOf` per Ticket. A changed snapshot goes out on `pipeline.changed`. The notes of
waits do not use this path: `installWaitsNotifications` follows the workflow hub alone, so no `gh`, git or `profile` runs for
them while nothing changes.

**Main tests.**

- `test/e2e/pipeline.spec.ts`: the board, a claim moving a card and the sidebar row, in the app.
- `test/contract/workflow-stages.test.ts`: the facts from a real git repository in Full and Silent mode, the lock and the channels.
- `test/unit/pipeline.test.ts`: `stageOf`, the catalogue and stuck.
- `test/contract/pipeline-rules-agree.test.ts`: the two copies of the rules give one verdict.
- `test/unit/pipeline-board.test.tsx`, `test/unit/ticket-stepper.test.tsx`, `test/unit/settings-pipeline.test.tsx`: the views.
- `test/unit/notify.test.ts`: the notes of waits and whom they reach.

## Binding

### Behaviour

A Binding says which one Ticket or Epic a Session or Subagent works on. An agent has at most one, and a Ticket may have several
agents. worfy derives it from the agent's work, and the user can set it by hand.

**Where it comes from.** The strongest signal that names a target wins:

| # | Signal | Target | Reason shown |
|---|---|---|---|
| 1 | The user dropped the agent's Node on a Ticket or a frame | That target | `manual` |
| 2 | worfy started the agent: Ship ticket, Run wave | Its Ticket; its Epic | `launched` |
| 3 | The last `ticket claim` command the agent ran | The Ticket it names | `ticket claim` |
| 4 | `/epic-wave` is the agent's last call of these two skills | The last word of its arguments that is an Epic of the Project | `/epic-wave` |
| 5 | The git branch or, failing that, the worktree folder of a Session | The Ticket they name | `branch <name>`, `worktree <folder>` |
| 6 | `/ship-ticket` is the agent's last call of these two skills | The Ticket in its arguments | `/ship-ticket` |
| 7 | For a Subagent: the first Ticket file path in its task | That Ticket | `task` |

So the Orchestrator running a Wave is bound to the Epic, while its implementers and reviewers are bound to their Tickets. From
the third signal on, a signal naming a Ticket or Epic the Project does not have is skipped, and the next one decides. While the workflow cannot be
read nothing can be checked, so signals are taken as they are, and a bare number binds nothing.

**On the Canvas.** A dashed line runs from the agent's Node to the Ticket. It ends at the frame when the Binding is to the Epic
or the frame hides the Ticket, and at the chip when the Epic is on the Done shelf. With no such place on the Canvas there is no
line. The line of a working agent (a live Session, a running Subagent) is always drawn. Another's is drawn only while its Node
or target is hovered or selected, or both are in the lit Family. A pinned, hidden or archived Node has no line.

**By hand.** Drag one Session, Orchestrator or Subagent Node over a Ticket or a frame: the target is outlined with "Bind to …".
On the drop the agent is bound and its Node goes back to where it was, so nothing moves. A Ticket beats the frame around it. A
selection dragged together does not bind. Binding an agent again replaces its manual Binding.

**Removing.** Right-click a Node bound by hand and choose "Remove binding", or use the button of the same name in the Session
rail. The automatic Binding applies again. A launch Binding is not removed by this and cannot be removed by hand.

**The Session rail** has a Binding block: the target with its title, and the reason. "Show on Canvas" centres the Epic's frame.
An unbound Session reads "Not bound. Drop the Session's Node on a Ticket or an Epic frame to bind it."

**What else reads a Binding.** The Family of a Node, the "ticket done" rule of the automatic Archive, "Arrange by Epic" and the
choice of active Epics in the strip of frames; see [Canvas](canvas.md) and [Sessions](sessions.md).

#### On a Linked machine

Manual and launch Bindings are stored and transcripts are read on the Project's Machine. On a read-only screen no Node is
dragged, so nothing is bound. "Remove binding" in the Node's menu is inactive and says why. With write access a Linked machine
binds and removes as here.

### How it works

- **Automatic Bindings are never stored.** They are read from the transcripts each time
  ([ADR-0002](../adr/0002-worfy-is-a-view-over-the-workflow.md)). Only manual and launch Bindings are kept, in
  `<Project data folder>/bindings.json`, never in the repository or `~/.claude`
  ([ADR-0005](../adr/0005-worfy-own-state-inventory.md)). An agent has at most one of each. They are in a file, so a Binding survives a restart.
- **The rules are a pure list**, strongest first, so main, the renderer and tests resolve alike. `/epic-wave` comes before the
  branch because the Orchestrator's checkout often holds the branch of a Ticket it merges rather than works on.
- **The forms a signal reads.**
  - A claim is `ticket claim <epic> <NN>` or `<epic>/<NN>` as a word of a Bash command, with any path before `ticket`.
  - A branch names a Ticket by that Ticket's `Branch:` line when exactly one Ticket has it, else by `<epic>/<NN>[-<slug>]`.
  - A folder is `.claude/worktrees/<NN>[-<slug>]` or `<Harness home>/worktrees/<project>/<NN>`. It carries no Epic, so it binds
    only when one Epic has that number, or only one Ticket with it is not done.
  - `/ship-ticket` takes `<epic> <NN>`, `<epic>/<NN>` or that same bare `<NN>`.
  - A skill counts under its bare name or with the `worfy:` prefix, not under another plugin's.
  - A task is the first `.scratch/<epic>/issues/<NN>-…` path in a Subagent's first prompt.
- **A Subagent has no cwd or branch of its own.** Its file carries its Session's, so they are dropped from its signals, and its
  task decides unless it claims or calls `/epic-wave` or `/ship-ticket`.
- **Reading is incremental.** main folds the new lines of each transcript into a state, so asking again costs only what was
  appended. The renderer asks again when a transcript changes and every 3 s for a live Session, because a Subagent's file is not
  watched.
- **A launch Binding is written once Claude Code reports the session id** that names the transcript. A Session that reports none
  in 10 minutes is not bound by its launch.

#### Windows

The claim, the Ticket path and the worktree folder are read with `\` as well as `/`, so the same signals bind.

### Implementation

| What | Where |
|---|---|
| The rules and targets | `src/shared/binding/resolve.ts` |
| Signals from transcript records | `src/shared/binding/signals.ts` |
| Reading a branch or a folder as a Ticket | `src/shared/workflow/ticket-ref.ts` |
| Reading transcripts incrementally | `src/main/claude-home/binding-signals.ts` |
| The store of manual and launch Bindings | `src/main/layout/bindings.ts` |
| IPC | `src/shared/ipc/bindings.ts`, `src/main/ipc/bindings.ts` |
| The renderer's copy, resolving | `src/renderer/binding/store.ts` |
| Drop targets; the drag and the menu | `src/renderer/binding/drop.ts`, `src/renderer/canvas/overlays/BindingDrop.tsx` |
| Anchors and lines | `src/renderer/canvas/sources/workflow-bindings.ts`, `src/renderer/canvas/edges/bindings.ts` |
| The rail block | `src/renderer/session/rail/BindingRail.tsx` |
| The readers elsewhere | `src/renderer/canvas/family.ts`, `src/main/layout/archive.ts`, `src/renderer/canvas/arrange-by-epic-command.ts`, `src/renderer/canvas/arrangement-record.ts` |

**Data flow.** `useSessionSignals` calls `bindings.signals` for each Session on the plane, and `BindingSignalReader` answers with
the signals of the Session and of each Subagent that has a transcript. `useManualBindings` calls `bindings.get`, then follows
`bindings.changed`. `resolveAgentBindings` runs the rules over both and the workflow model, so a change of any of the three shows
at once. `sources/workflow-bindings.ts` hangs invisible anchor Nodes on the agents and targets, and `edges/bindings.ts` draws
the lines between them.

**Main tests.**

- `test/e2e/binding.spec.ts`: claim, worktree folder, `/epic-wave` and task in the app; a drag that survives a restart; removing.
- `test/contract/bindings.test.ts`: the reader over a synthetic Claude home, the store and the channels.
- `test/unit/binding.test.ts`: the signals in order of strength, labels, reading transcript records.
- `test/unit/binding-canvas.test.tsx`, `test/unit/done-shelf-binding.test.tsx`: anchors, which lines are drawn, drop targets, the
  rail block.
- `test/unit/ticket-ref.test.ts`, `test/unit/family.test.ts`: branch and folder forms, the Family.
