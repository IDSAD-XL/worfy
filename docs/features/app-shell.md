# App shell

What surrounds the Canvas in every window, on every Project. Eight Features: the **Sidebar**, the **Footer**, the
**Command palette**, **Shortcuts**, the **Menu**, **Settings**, the **worfy Guide** and the **Theme**. [Notifications](notifications.md), the ninth, has a page of its own. Terms are
explained in [Concepts](concepts.md).

Six View buttons pick what the main area shows: **Canvas**, **Session**, **Pipeline** (see [Workflow](workflow.md)),
**Runs** (see [Flight Recorder](flight-recorder.md) and [Work track](work-track.md)), **Pull requests** (see
[Pull requests](pr-inbox.md)) and **Acceptance** (see [Acceptance](acceptance.md)). Each stands in one of three zones,
as the layout in the app settings of this computer says; by default Canvas and Session are in the toolbar, Pull requests
and Acceptance on the sidebar's rail under a thin line, after the sections of the top, and Pipeline and Runs on the left
of the footer. A window on a Linked machine's Project shows the layout of this computer. The button of the view on screen
is pressed in whatever zone it stands. Their tooltips are "Canvas", "Session view", "Pipeline board", "Run history",
"Pull requests of the open Project" and "Checks that wait for you". Pull requests counts the pull requests of the open
Project that need you, Acceptance the checks Ready to check, and Pipeline has a dot while a Ticket of the open Project is
blocked or waits for a person. On the rail a button shows no count while the section of the same name stands there with
its own, and its icon carries a small window mark: it opens a view of the main area, not a section. In the toolbar the
buttons show icons and labels, from four buttons on their icons alone in a window under 1400 pixels, and in any number
at 1100 pixels or less; on the rail always their icons; in the footer their labels over 1100 pixels. While the sidebar
is hidden, its buttons stand at the end of the toolbar's group after a thin line. In focus mode the buttons of the rail
and of the footer are inert, as the toolbar is. Runs and Pull requests are inactive without a Project, and their tooltip
then says to open one. Every view stays mounted while another one is shown, so switching back finds it as it was.

A part that fails to render stays a part: a sidebar section, a tab of the Assistant or a view shows "This section failed
to render" (or "This tab…", "This view…") with the error's message and **Reload**, and the rest of the window keeps
working. An error outside all of them shows the message and **Reload window** instead of a blank window.

## Sidebar

### Behaviour

The column on the left of the window, 264 pixels wide until you drag its right edge (worfy-polish ticket 158). From the
top:

- **The strip**, as high as the toolbar. On macOS the traffic lights sit on its left. Then comes the wordmark "worfy" and,
  at the right edge, the button that hides the sidebar (⌘B, Ctrl+B on Windows). Dragging the strip moves the window.
- **The Project switcher**, a row of its own under the strip, as wide as the sidebar: the name of what the sidebar shows
  and a chevron at its right end. A long Project name has the whole row.
- **The rail**, a column of icons, one per section: first the Assistant, in its own colour and above a rule, then
  Projects, Sessions, Pull requests, Acceptance, Pipeline, Epics, ADR, and at its foot Health check, Machines and Settings. The chosen section has an accent bar. A section's icon carries a badge that shows while
  another section is open: the number of busy Sessions of the Projects the switcher shows, in the colour of work, the
  number of pull requests that need you (review, answer or fix), the number of checks in Ready to check of
  [Acceptance](acceptance.md), in the colour of work, a dot while a Ticket in work is blocked or waits for
  someone, and the dot of the Linked machines.
- **The panel**, next to the rail. It shows one section: its name, which Projects it shows, its own buttons, and its list,
  which scrolls by itself.

**The width.** The right edge of the sidebar is a handle about 6 pixels wide: the pointer turns into a resize cursor over
it, and a line of the accent colour shows while the pointer rests on it, while it has the keyboard focus and while it is
dragged. Dragging it changes the width of the whole sidebar, live. The width is saved once, when the mouse button is let
go; Escape during a drag puts the width back where the drag started and saves nothing. The handle is a Tab stop: ← and →
move it by 16 pixels, Home and End to its bounds, and a key that moves it saves. A double click puts the default 264
pixels back. A press without a move, a drag back to where it started and a key against a bound save nothing; the drag
is also cancelled when the window loses focus, at the next press if a release was missed, and when the sidebar is hidden
mid-drag.
The width stays between 220 and 640 pixels, and never wider than leaves the rest of the window 480 pixels; a window made
narrower only shows the sidebar narrower, never below 264 pixels, and a wider one shows the saved width again. The width
is one per Machine, the same in the normal view and in focus mode, and a sidebar shown again after hiding comes back at
it. It counts in pixels of the page, so the interface scale enlarges it as it enlarges the rest of the window.

The rail is one Tab stop. ↑ and ↓ walk it and wrap round, Home and End go to its ends, and the section under the focus
opens at once. The section that is open is remembered for the window. A window that never chose a section opens on
Projects, not on the Assistant above it.

**The [Assistant](assistant.md)** (worfy-assistant ticket 14) is a section of its own: what waits over every Project of this Machine,
each item with its reason, its source and its duty, and Open, Prepare, Snooze and Dismiss; like and dislike on each of
its messages; the journal of its actions, each row with the item that caused it; a summary; the conversation; and its
usage line, whose share of Limits is marked as an estimate. Prepare shows the exact text of the Session before it starts;
nothing starts until Start. While the Assistant is on, its own notification is a card next to its rail icon, in its
colour, one at a time, the rest a number on the icon; when worfy is not in front, a system notification titled
"worfy Assistant" comes only for an urgent item and only in work hours, and a click opens the section. Settings →
Assistant → Notifications narrows them (worfy-assistant ticket 25): the card in the window tells of urgent and batched
items, of urgent ones only, or of none (the number on the icon and the list stay), and the system notification can be
turned off. Under an applied «before → after» card of the Assistant, Undo puts its settings back, unless one of them
changed since Apply.

The Assistant is off until the user turns it on (worfy-assistant ticket 16). worfy offers it once: on the page "Meet
Assistant" of [First run](onboarding.md#first-run) for a new user, in one notice in the corner for an existing one, and at
the top of the section while the offer stands — "Turn on and meet" or "Not now", which ends the offer for good. The first
time the Assistant is turned on, by the offer or in Settings → Assistant, it introduces itself in the conversation, in the
language of the Guide: who it is, what it does and what it can, which of Slack and Jira it sees connected in claude.ai
and where to connect the others (claude.ai → Settings → Connectors). It never asks for a token. It asks the work hours,
and a card "before → after" with the first setup follows: the work hours Monday to Friday, 09:00–18:00 in this Machine's
zone, unless chosen, and the check of each connected source. Nothing changes until Apply. worfy writes the introduction
itself, without a model, so it costs no tokens; an Assistant that was on before the introduction existed is not
introduced.

**Health check** is a button of the rail right above Machines, always there. It is not a section: it shows nothing in the
panel, and a click opens Settings → Health ([First run](onboarding.md#first-run) describes the rows). Like Settings, it is
not one of the tabs that ↑ and ↓ walk; Tab reaches it after them. Its dot is the worst level of the Health check report of
this Machine and every Project open on it:

| Dot | When |
|---|---|
| Red | A critical row is not OK: git, the Claude Code sign-in, the Harness, gh while a Project is on GitHub |
| Yellow | Only non-critical rows are not OK, such as the qmd models or git identity, or a row could not be checked |
| None | Every row is OK |
| Grey ring | There is no report yet at this start, or "Check again" runs |

A row that could not be checked (no network, a timeout) never makes the dot red. The tooltip says "Health check" and why
the dot is there: "critical: Harness plugin", "non-critical: qmd models", "Couldn't check: <reason>", "everything works".
The button reads the report main already keeps and runs no check itself. There is no toast and no system notification
about a new red row: only the dot.

**The Project switcher** answers "All Projects" or one Project of the window's Machine:

- **All Projects** mixes the Projects in Sessions, Pull requests, Acceptance, Pipeline, Epics and ADR. Each of Sessions, Epics and
  ADR shows the open Project's list first, then the list of every other Project that has one, each under its name. A
  click on an Epic of another Project opens that Project and centres the Epic on its Canvas. A click on a Session of
  another Project opens that Project, then the Session as a click in its own list does, once its Node is on the Canvas
  (within 15 seconds). A click on an ADR of another Project opens that Project, then the ADR.
- **One Project** opens that Project, as its row in the Projects section does, and the sections show it alone once it is
  open. When the Project cannot be opened, the switcher says why and keeps its answer. While the switcher is on one
  Project it follows the open one: opening another Project shows that one.
- Projects and Machines are not filtered: Projects is where Projects are opened, added and removed.

**The Projects section** shows each Project of the window's Machine as a card of two lines: the name and the branch, then
its live state, "N busy · N PR need you · N waits", or "quiet". A long branch stays on one line, takes at most half of it
and is cut with an ellipsis, so the name keeps the rest; its tooltip holds the whole branch. The switcher's menu gives a
branch at most half of an item the same way. Busy is in the colour of work, the other two in the
colour of a block. A part that is zero or unknown is left out. "PR need you" counts the pull requests that need your
review, answer or fix; it is unknown while the Project's PR inbox is off. "Waits" counts the Tickets in work that are
blocked or wait for a person, not for an agent. It is known only while a window shows the Project's Pipeline, which "All
Projects" does. No part of the live line is cut: a part that does not fit moves whole to the next line, without the
" · " before it, and the card grows with it. Each part has a tooltip that says what it counts: busy — the Sessions in a
turn; PR need you — the pull requests that need your review, answer or fix; waits — the Tickets that are blocked, or wait
for a person, not an agent. The same words are the description of the card itself, so the keyboard focus on the card
and a screen reader give them too. A Project of a Linked machine keeps its single line.

**The Acceptance section** shows the [Acceptance](acceptance.md) queue by Project: each Project's name, then a row per
group that holds a check of that Project — Ready to check, Update first, Waits for you, Failed — with its count. In work
and Older have no row there. A click opens the Acceptance view on that Project's first row of that group; the view is
over every Project, so the click opens no Project. With no row in any of those groups the section says "Nothing to
check". Its rail badge is the number of Ready to check of the Projects the switcher shows: under "All Projects" it is
the number the Acceptance View button counts.

In another Project's group, a Session shows the name Claude Code gives it, else "Session <id>", and "terminal" or
"desktop". That Project's Canvas is not read, so its worfy Sessions are not marked "worfy" there. "New session", "Product
Session" and History work with the open Project.

The answer is remembered for the window, as the open section is. A new window and a restart start from the last choice
made in any window. On one Project with no Project open, the sections show every Project. With no Project open, Epics,
Sessions and ADR keep their header and say "Open a Project to see its …".

While the sidebar is hidden, the button that shows it again is at the left of the toolbar. In focus mode the bar of focus
mode has that button, and the sidebar's strip has none. The keyboard focus follows the button: hidden from its strip, the
focus is on the toolbar's button; shown from the toolbar, it is on the button in the strip. The toolbar's title names the open
Project alone while the sidebar shows the wordmark ("No Project open" with none), and "worfy — <Project>" while the sidebar
is hidden.

### How it works

Each section is a file `src/renderer/shell/sidebar/<Name>Section.tsx` with its order and its rail entry: a title, an icon,
whether it stands at the foot and whether a window that chose no section may start on it. Every section stays mounted while another one is shown, so it keeps what it read and its
badge stays current; the others are only hidden. The switcher's answer and the open section are kept in the window's local
storage, in worfy's data folder. No setting of the app holds them.

The other Projects cost no watcher per Project in each window. Their Sessions, busy counts, pull requests that need you
and waits come in one answer from main, `projectPulse.get`, and one event, `projectPulse.changed`. Main keeps one reader
for every window. It lists the folder of live Sessions in the Claude home every second while a window is subscribed, and
reads it again when it changed. A process that died without removing its file changes no file, so while a Session is
live each poll also asks the system whether its process still runs, which starts no other process. The whole folder,
with the start-time check that tells a reused process number apart, is read again once a minute. A Session of a
Project inside the open one is listed and counted once, under its own Project. A Linked machine gets no Project that
is kept on this Machine only. It takes the pull requests from the PR inbox as last read, so it makes no GitHub call of its own. It
takes the waits from the Stages it already computes for the windows. A window subscribes once and stays subscribed until
it closes. The other Projects' ADRs are read once with `docs.adrs`, each time the ADR section comes into the panel, with no
watcher. Only the open Project's documents are watched.

### Implementation

| What | Where |
|---|---|
| Strip, rail and panel | `src/renderer/shell/Sidebar.tsx`, `src/renderer/shell/shell.css` |
| Width of the sidebar and its edge | `src/renderer/shell/sidebar-width.ts`, `src/renderer/shell/SidebarResizeHandle.tsx`, the divider `src/renderer/theme/kit/Divider.tsx`, the bounds in `src/shared/settings/app-settings.ts` |
| The Assistant's section, speech card and Prepare | `src/renderer/shell/sidebar/AssistantSection.tsx`, `src/renderer/assistant/`, in main `src/main/assistant/window/` and `src/main/ipc/assistant.ts`, channels in `src/shared/ipc/assistant.ts`, tokens `--assistant*` in `src/renderer/theme/tokens.css` |
| The offer of the Assistant and its introduction | `src/renderer/assistant/Offer.tsx`, `src/renderer/assistant/offer-notice.ts`, the page in `src/renderer/shell/FirstRun.tsx`, in main `src/main/assistant/intro/` (its words in `src/main/assistant/intro/words/`), the state in `src/shared/assistant/intro.ts` |
| Health check button and its dot | `HealthRailButton` in `src/renderer/shell/Sidebar.tsx`, `openHealthCheck` in `src/renderer/settings/settings-window.ts`, the worst level in `src/shared/health/severity.ts`, the tokens `--health-critical` and `--health-warning` in `src/renderer/theme/tokens.css` |
| Frame of a section | `src/renderer/shell/SidebarSection.tsx`, `src/renderer/shell/sidebar-section.css` |
| Project switcher | `src/renderer/shell/ProjectSwitcher.tsx` |
| Answer, open section, badges | `src/renderer/shell/sidebar-scope.ts` |
| Live state of every Project | `src/shared/ipc/project-pulse.ts`, `src/main/claude-home/pulse.ts`, `src/main/ipc/project-pulse.ts`, `src/renderer/projects/useProjectPulse.ts` |
| A Session of another Project, opened after its Project | `src/renderer/shell/session-request.ts` |
| Sections | `src/renderer/shell/sidebar/` |
| What a part that fails to render shows | `src/renderer/shell/ErrorBoundary.tsx`, `src/renderer/shell/error-boundary.css`; placed in `Sidebar.tsx`, `AppShell.tsx`, `src/renderer/assistant/AssistantPanel.tsx` and `src/renderer/main.tsx` |
| Rail entries of the sections | `src/renderer/shell/registry.ts` |
| The views: names, tab tooltips, icons, the Acceptance count and their View rows of the palette | `src/renderer/shell/views.tsx` |

Main tests: `test/unit/sidebar-scope.test.tsx`, `test/unit/error-boundary.test.tsx`, `test/unit/sidebar-resize.test.tsx`, `test/e2e/sidebar-resize.spec.ts`, `test/unit/assistant-window.test.ts`, `test/unit/assistant-panel.test.tsx`, `test/unit/assistant-speech.test.tsx`, `test/unit/assistant-intro.test.ts`, `test/unit/assistant-offer.test.tsx`, `test/e2e/assistant.spec.ts`, `test/unit/sidebar-section.test.tsx`, `test/unit/health-rail-button.test.tsx`, `test/unit/acceptance-section.test.tsx`, `test/e2e/sidebar-rail.spec.ts`,
`test/e2e/sidebar-sections.spec.ts`.

## Footer

### Behaviour

A strip 28 pixels high across the whole window, under the sidebar and the main area, at an interface scale of 100 %. It
grows with the interface scale, as the rest of the window does: there are no window buttons under it. Its left part
holds the View buttons of the footer, 22 pixels high, its middle stays empty, and the version chip stands at its right
end. It is no area to
drag the window by, and toasts keep clear of it. In focus mode the footer stays on screen under the focus layer, and the
chip keeps working.

The version chip is the app version, `v<major>.<minor>.<N>`, with one dot: red while the Harness needs the user, amber
while an update waits, none otherwise ([Harness](harness.md), [Updates](updates.md)). Its accessible name and the first
line of its tooltip say what the dot is for. A press opens a popover above it with the app version and the Update's
actions, the Harness line, the Codex line and worfy's memory; Esc, a press outside or a second press on the chip closes
it. While an Update builds, the chip shows its step; in a window 1100 pixels wide or less, the version alone.

### Implementation

| What | Where |
|---|---|
| The strip | `src/renderer/shell/footer/Footer.tsx`, `src/renderer/shell/AppShell.tsx`, `src/renderer/shell/shell.css`, `--footer-height` in `src/renderer/theme/tokens.css` |
| The View buttons of the three zones | `src/renderer/shell/ViewZone.tsx`, `src/renderer/shell/ViewButton.tsx`, the registry `src/renderer/shell/views.tsx`, the layout `src/shared/layout/view-buttons.ts` |
| The version chip, its dot and its popover | `src/renderer/shell/footer/VersionChip.tsx`, `src/renderer/shell/footer/version-dot.ts` |

Main tests: `test/unit/version-dot.test.tsx`, `test/unit/update-chip.test.tsx`, `test/unit/view-zones.test.tsx`, `test/e2e/footer.spec.ts`, `test/e2e/view-buttons.spec.ts`.

## Command palette

### Behaviour

One field over the window that finds commands and things of the Project. The "Search or run…" field of the toolbar opens
it, and so does ⌘K (Ctrl+K on Windows). In a window up to 1100 px wide the field shows its icon and the shortcut alone,
so the toolbar fits the smallest window with the sidebar open. The panel is 560 pixels wide and at most 440 high.

Typing ranks the rows. ↑ and ↓ walk all the rows across the groups and wrap round, and the pointer over a row selects it.
Enter or a click runs the selected row. Esc or a press outside the panel closes the palette.

The palette is modal. Tab and Shift+Tab stay inside it. While it is open, the window's own ⌘ shortcuts (⌘F, ⌘↩) do
nothing; the items of the app menu still work. On closing, the focus goes back where it was before the palette opened. Settings opened over the palette with ⌘, lies on
top of it and takes the keys; when Settings closes, the focus goes back to the palette's field, with the query kept.

A command that worked closes the palette. A command that failed leaves it open with the reason at the bottom, until the
next typing or pick. While a command runs, another pick does nothing.

**Groups.**

| Group | Rows |
|---|---|
| Action | New session; New Product Session; a "New …" for each item of the Canvas menu; Tidy up; Arrange by Epic; Re-pack; Archive finished sessions now; Process gate queue; Run wave `<epic>`; Ship ticket `<epic>/<NN>`; Open changes `<epic>/<NN>`; Resolve conflicts, Fix checks and Address comments `<owner>/<repo>#<N>`; Reconnect machine…; Remove machine…; Update worfy |
| View | Switch to Canvas; Switch to Session; Pipeline board; Open Run history, with a Project; Pull requests, with a Project; Acceptance; First-run checks; Health check; Getting started; Settings…; Keyboard shortcuts; worfy Guide; Guide: `<Topic>`, for each Topic; Show only tag `<tag>`; Show all Nodes |
| Project | Switch to project `<name>`, for each other Project |
| Go to | Orchestrator; each Epic, Ticket and ADR; each Node of the Layout, except those worfy draws from the workflow and binding anchors |
| Manual check | Each unchecked manual check of a Ticket. These rows appear only after typing |
| In transcripts | The Project's Sessions whose conversation contains the query |

"Health check" opens Settings → Health, as the Health check button of the rail does. "First-run checks" opens the First run
dialog, the window of the first setup of the Machine; the two names are not interchangeable.

Some rows exist only in some states:

- Process gate queue: only on the Machine whose Profile gives it the role `serve` of the cross-machine gate. Its detail
  counts the waiting PRs and the age of the oldest.
- Run wave and Ship ticket: only where the Epic frame or the Ticket has that button.
- Open changes `<epic>/<NN>`: for a Ticket with a worktree branch, a `Branch:` line or in work, the Ticket in the detail.
  It opens the Ticket's [Changes view](changes.md#the-changes-view) over the whole window, as the button Changes of the
  card does; **← Canvas** and Esc go back. It reads git only, so a read-only screen keeps it active.
- Resolve conflicts, Fix checks and Address comments `<owner>/<repo>#<N>`: a row for each action the button of a
  Ticket and its «▾» offer, the Ticket in the detail. An inactive row gives the same reason as the button. Picked from
  the palette, a new Session Node goes where any new Node goes.
- Reconnect machine…: only for a Linked machine that is not online, or whose certificate changed. Remove machine…: for
  each Linked machine. The name of the Machine is in the detail of the row.
- Show all Nodes: only while a tag filter is on.
- Guide: `<Topic>`: only after typing. It opens the [worfy Guide](#worfy-guide) at that Topic.
- Update worfy: only where Update is on, with or without a Project. It restarts into a built Update, builds the
  Available update, or checks for one, and its detail says which: see [Updates](updates.md).

A "Go to" row shows the Canvas and centers it on the Node. An archived or hidden Node is brought back first. A Ticket of a
collapsed frame centers its frame. An ADR row opens that ADR read-only and does not move the Canvas. With the sidebar hidden, the ADR opens when the sidebar is shown. The Orchestrator row
opens the Session view and starts the Orchestrator if it does not run. "Acceptance" opens the
[Acceptance](acceptance.md) view, with or without a Project. A Manual check row opens the Acceptance view on that item
when the item is in its queue, and otherwise goes to its Ticket; it ticks nothing. Picking an "In transcripts" row opens that Session in the Session view.

**Ranking.** An exact key beats every title, for example a Ticket number (`07`, `7`, `worfy-mvp/07`) or an ADR number. Then
come, in order: the start of the title, the start of a word in the title, anywhere in the title, the detail, all the words of
the query, and the characters of the query in order with gaps. At most 50 command rows are shown, and typing more reaches the
rest. A group stands where its best row stands. With an empty field in a Project, the groups come as Action, View, Project,
Go to.

**Inactive rows.** A Run wave or Ship ticket that cannot run now stays in the list, grey, with the reason next to the title
and in its tooltip. It is the same reason the button shows. A click or Enter on such a row does nothing.

**Long titles.** On a row with no state of its own, a title cut on screen has its whole text in the tooltip. A Manual check
row wraps its title onto up to 3 lines and then cuts it. The tooltip of an "In transcripts" row is its whole snippet.

**In transcripts.** The search starts 250 ms after the last key, for a query of 3 to 200 characters. Case is ignored. It
covers every Session Claude Code recorded for the Project, wherever it was started: worfy, a terminal or Claude Desktop. It
also covers the Project's Codex Sessions, those the last list of them found (see [Sessions](sessions.md)). It reads the
user's messages and the agent's replies, not tool calls, their output, thinking, hooks or the records of Subagents.

At most 20 Sessions come back, newest first, Claude Code's and Codex's together, each with a snippet of up to 120
characters from around the match. Each row ends with the logo of the Vendor whose agent ran the Session; its tooltip names
the Vendor. One search reads at most 200 transcripts and 64 MiB; a Codex thread counts as one transcript, and its messages
count against the 64 MiB. When a limit leaves some unread, the group says "Older transcripts were not searched". It says the
same when Codex fails to read a thread: the rest of that search asks Codex for no other thread. It also says "Searching…" and
"Could not search the transcripts: …". These rows come in addition to the 50 command rows, below them.

**Without a Project** the palette has the View rows, the Project rows and the machine rows, and no transcript search.

#### Windows

Inside a Terminal, Ctrl+K belongs to the shell and the palette does not open. See [Shortcuts](#shortcuts).

#### On a Linked machine

On a read-only screen, the rows that would change the Project are inactive with the hint "… gives this Machine read-only
access". These are New session, New Product Session, New …, Tidy up, Arrange by Epic, Re-pack, Archive finished sessions now, Process gate queue,
Run wave, Ship ticket, Fix checks, Resolve conflicts and Address comments, and a Go to row of an archived or hidden Node. The views, moving the Canvas and switching Projects
stay active. The Orchestrator row only shows the Orchestrator and does not start it.

The machine rows stay active: they concern this Machine's link and not the Project. The transcript search runs on the
Machine of the Project.

### How it works

- **The palette keeps no list of its own.** Commands are built from what the window already knows: the workflow model, the
  Layout, the Sessions, the ADRs, the Projects. A Node type that exports `createLabel` gets a "New …"
  row the same way it gets an item in the Canvas menu ([ADR-0014](../adr/0014-canvas-menu-items-from-node-type-files.md)).
- **A command only asks.** It goes through the same requests of the Canvas and the same IPC calls as the button it stands
  for. Whether Run wave or Ship ticket is active comes from the code the buttons use, and main checks again before it starts
  anything. Nothing here writes a Ticket's status or a file of the Project
  ([ADR-0002](../adr/0002-worfy-is-a-view-over-the-workflow.md)).
- **Commands rank in the renderer, transcripts search in main.** Ranking is a pure function that runs on every keystroke.
  The transcript search runs in main and keeps the text of a transcript in memory, by its file's size and modification time.
  It keeps the text of a Codex thread the same way, by the thread's time; a thread whose time changed is read again.
  An answer to an older query is dropped when it arrives.

### Implementation

| What | Where |
|---|---|
| The field, the panel, the keys, the transcript search | `src/renderer/palette/CommandPalette.tsx` |
| The modal window under the panel: focus, Esc, the layer | `src/renderer/theme/kit/Dialog.tsx`, `src/renderer/theme/layers.ts` |
| Building the commands from the window's state | `src/renderer/palette/commands.ts` |
| Grouping the ranked rows | `src/renderer/palette/groups.ts` |
| Ranking (`rankItems`), shared with Canvas find | `src/renderer/find/search-index.ts` |
| What makes Run wave and Ship ticket active | `src/renderer/canvas/actions/gates.ts`, `src/shared/actions/render-template.ts` |
| What Run wave, Ship ticket and Process gate queue start | `src/main/actions/launch.ts`, `src/main/ipc/actions.ts` |
| The transcript search and its limits | `src/main/claude-home/search.ts`, `src/shared/ipc/claude-home.ts` |
| The Codex threads the search reads | `src/main/ipc/claude-home.ts`, `src/main/vendors/codex/sessions-on-canvas.ts` |

Main tests: `test/unit/palette-commands.test.tsx`, `test/unit/palette-groups.test.tsx`, `test/unit/palette-dialog.test.tsx`,
`test/unit/palette-transcripts.test.tsx`, `test/unit/palette-manual-check-row.test.tsx`,
`test/contract/claude-home-search.test.ts`, `test/e2e/palette-find.spec.ts`, `test/e2e/palette-groups.spec.ts`.

## Shortcuts

### Behaviour

Every shortcut of the list below is written in one registry in the code, and the user cannot change them. On Windows the
primary key is Ctrl, where macOS has ⌘.

| Group | Action | macOS | Windows |
|---|---|---|---|
| Window | Search or run a command | ⌘K | Ctrl+K |
| Window | Settings | ⌘, | Ctrl+, |
| Window | Hide or show the sidebar | ⌘B | Ctrl+B |
| Window | Keyboard shortcuts | ⌘/ | Ctrl+/ |
| Window | Keyboard shortcuts, outside a text field | ? | ? |
| Window | Bigger, Smaller, Actual size of the interface | ⌥⌘=, ⌥⌘-, ⌥⌘0 | Ctrl+Alt+=, Ctrl+Alt+-, Ctrl+Alt+0 |
| Canvas | Zoom in, Zoom out | ⌘=, ⌘- | Ctrl+=, Ctrl+- |
| Canvas | Undo, Redo | ⌘Z, ⇧⌘Z | Ctrl+Z, Ctrl+Shift+Z |
| Canvas | Move the selection to the trash | ⌫ or Delete | Backspace or Delete |
| Canvas | Drag without snapping | ⌘ + drag | Ctrl + drag |
| Focus mode | Open the selection in focus mode | ⌘↩ | Ctrl+Enter |
| Focus mode | Leave focus mode | Esc | Esc |
| Find | Find on the Canvas, or in the Session | ⌘F | Ctrl+F |
| Find | Next match, Previous match | Enter, ⇧Enter | Enter, Shift+Enter |
| Find | Close the find bar | Esc | Esc |
| Session | Back to what started the Subagent | ⌘[ | Ctrl+[ |
| Session | Send the message, New line | ⏎, ⇧⏎ | Enter, Shift+Enter |
| Session | Interrupt the turn | Esc | Esc |
| Session | Earlier and later messages | ↑↓ | ↑↓ |
| Session | Choose the slash command | ⏎ | Enter |
| Terminal | Command request (zsh with Terminal AI) | ⌘I | none |

The zoom keys also answer to `+` and `_`.

**The Keyboard shortcuts window** lists these entries in the groups above, with the keys as this system writes them. It
opens from Help ▸ Keyboard Shortcuts, from ⌘/, from `?` outside a text field and outside a Terminal, and from the palette.
Esc, Close or a press on the backdrop closes it, and the focus goes back where it was. While it is open, no key reaches the
app behind it, except the accelerators of the app menu. Settings → Shortcuts shows the same list. With Settings open, "open
the shortcuts" shows that section, and Settings opening over the window closes the window.

**Keyboard layouts.** A Latin letter is read from the key cap, so a shortcut follows the letter on QWERTZ, AZERTY, Dvorak
and BÉPO. With a layout of another script, the letter comes from the place of the key: the Cyrillic letter on the key of K
is K. `[` of Back is also read by place when the layout has a letter there. For other punctuation Shift is not counted,
because it only picks the character: `?` works wherever the layout puts it. A press with the other modifier held matches no
entry: Ctrl on macOS, the Windows key on Windows.

#### Windows

- Inside a Terminal, an entry with Ctrl does not match, so Ctrl+K and Ctrl+F reach the shell. Zooming the Canvas is the
  exception: Ctrl+= and Ctrl+- still zoom, and only Ctrl+\_ stays with the shell. See [Terminal](terminal.md).
- AltGr types a character and is never a shortcut, although it arrives as Ctrl+Alt. Ctrl+Alt pressed as two keys is a
  combination.
- The menu shows Ctrl+/ but does not take it. The page catches it, outside a Terminal, where it stays with the shell. With
  Settings open the key does nothing. Ctrl+B stays with the shell by itself: xterm.js cancels it, and the menu gets only the presses the page did not cancel.
- ⌘I has no entry here, because Ctrl+I is Tab of the shell.

### How it works

- **One list for everything that speaks about a key.** The handlers of the renderer, the labels next to buttons, the
  accelerators of the app menu and the Keyboard shortcuts window all read one registry, so a key and what is written about it
  cannot drift apart. An entry is written without the system: `primary` is ⌘ on macOS and Ctrl elsewhere.
- **Places do not clash.** An entry has a scope such as `app`, `canvas` or `terminal`. Two entries of one scope never share
  keys, and no entry shares the keys of an `app` entry. A test checks this.
- **The rule of the Terminal is one rule.** On Windows the shell's keys share Ctrl with worfy's, so an entry with the primary
  key gives up a press inside a terminal. An entry names in `shellKeeps` the keys the shell keeps, and the entry keeps the
  rest. Without `shellKeeps`, the shell keeps all of them. On macOS the shell's keys are on Ctrl and worfy's on ⌘, so nothing
  is given up there.
- **The system comes from the user agent**, with no IPC channel: `src/renderer/main.tsx` writes it on `<html>` as
  `data-platform`, and the styles and `currentPlatform` read it there.

### Implementation

| What | Where |
|---|---|
| The registry, and the accelerator of an entry | `src/shared/shortcuts.ts` |
| Matching a press, the label, text fields and Terminal Nodes | `src/renderer/shortcuts/match.ts` |
| The system, the primary key, the key of a press, the writing of a combination | `src/renderer/platform.ts` |
| The window and the list | `src/renderer/shortcuts/ShortcutsOverlay.tsx`, `src/renderer/settings/ShortcutsSection.tsx` |
| Its state | `src/renderer/shortcuts/shortcuts-window.ts` |
| The modal window it is drawn in, and the keys of the app while it is open | `src/renderer/theme/kit/Dialog.tsx` |

Main tests: `test/unit/shortcuts.test.tsx`, `test/unit/shortcuts-overlay.test.tsx`, `test/unit/platform-shortcuts.test.tsx`,
`test/unit/platform-keys.test.ts`, `test/e2e/shortcuts.spec.ts`.

## Menu

### Behaviour

The app menu is built on Electron's default menu, plus worfy's own items.

| Menu | Items |
|---|---|
| App menu, named after the app (macOS) | About; Settings…; Services; Hide, Hide Others, Show All; Quit |
| File | macOS: Electron's default. Windows: Settings…; Quit |
| Edit | Electron's default |
| View | Reload; Force Reload; Toggle Developer Tools; Actual size; Bigger; Smaller; Toggle Full Screen; Toggle Sidebar; Show Minimap |
| Window | Electron's default |
| Help | worfy Guide; Keyboard Shortcuts; on macOS also the system's search field |

- **Settings…** (⌘,) opens the [Settings](#settings) window of the window it was chosen for.
- **Bigger and Smaller** change the interface scale of the Machine by a tenth, from 80 % to 150 %, and **Actual size** sets it
  to 100 %, in every window. They stand where Electron's zoom items stand and do not zoom one window. Their keys carry ⌥ (Alt), because ⌘= and ⌘- zoom
  the Canvas. Bigger is disabled at 150 % and Smaller at 80 %, also when the scale changed in Settings.
- **Toggle Sidebar** (⌘B) hides or shows the sidebar, wherever the focus is. The one exception is inside a Terminal on Windows,
  below. The normal view and focus mode have separate answers, and the switch changes the answer of what the window it was
  chosen for shows now. Both answers are settings of the Machine: every window in that mode follows, and they outlive a
  restart. The button in the toolbar and in the focus mode bar does the same.
- **worfy Guide** opens the [worfy Guide](#worfy-guide). It has no key.
- **Show Minimap** is a checkbox, on at first. It applies to every window and lasts until worfy quits.
- A command chosen right after a window appears is carried out and not lost. It waits for the page for up to 10 seconds, and
  up to 8 commands per window wait. A reload of the page drops what waited.

#### Windows

The window has the system's own frame, and the menu is under its title bar. There is no app menu, so Settings… is in File.
Inside a Terminal, Ctrl+B stays with the shell: see [Shortcuts](#shortcuts).

#### On a Linked machine

The menu belongs to the Machine whose screen shows it. Its commands never go to a Linked machine, and a window that shows a
Linked machine's Project opens the Settings of its own Machine.

### How it works

Setting a menu replaces the default one as a whole, so the default's roles are spelled out and the app menu and File are
spelled out item for item. Every accelerator comes from the registry of [Shortcuts](#shortcuts). The accelerator is the
menu's and not a key handler of the page, which is why ⌘B works wherever the focus is.

An item that needs the window's renderer sends it `menu.command`: to the window the item was clicked for, else the focused
one, else nobody. A window may be on screen before React has mounted. So main sends a command only after the page has said,
with `menu.ready`, that it follows that command, and holds it until then. The order is kept within one command, not across
commands.

The minimap state is kept in main's memory and is not a setting.

### Implementation

| What | Where |
|---|---|
| The template and its installation | `src/main/menu.ts` |
| Holding and delivering `menu.command` | `src/main/ipc/menu.ts`, `src/shared/ipc/menu.ts` |
| Following a command in the page | `src/renderer/menu-command.ts` |
| The state of Show Minimap | `src/main/ipc/view.ts`, `src/shared/ipc/view.ts` |
| The steps of the scale | `src/main/settings/interface-scale.ts` |
| Toggle Sidebar in the page | `src/renderer/shell/sidebar-visibility.ts` |

Main tests: `test/contract/view-menu.test.ts`, `test/unit/menu-command.test.tsx`, `test/e2e/focus-sidebar.spec.ts`.

## Settings

### Behaviour

Settings are the settings of worfy itself on this Machine. The window opens from "Settings…" of the app menu (⌘,) and from
the palette. It is modal, with its sections in a column on the left, under the headings of four groups: App, Agents,
Workflow and Workspace. Each row has an icon before its name. The column scrolls when the rows are taller than the window.
Esc or Close closes it, and the focus goes back where it was. ↑ and ↓ move through the sections from one group into the next,
and Tab goes round the controls of the window. A group heading is a label: it takes no click and no focus. While it is
open, ⌘K, ⌘F and ⌘↩ do nothing. A press beside the window leaves it open, and so does a press on a toast. Settings, Keyboard shortcuts and the
Guide are one modal window of the app's own kit: the app behind it is hidden from a screen reader, the toasts are not, and
they stay above the window.

| Group | Section | What it holds |
|---|---|---|
| App | General | Interface scale; Memory in the version popover; Fold Epics without work after (the «Older» group of the Epics section, see [Workflow](workflow.md)); Version; Updates, where Update is on: see [Updates](updates.md) |
| App | Health | The First run checks with their actions and "Check again". Opening the section checks. A pressed button shows its work with a spinner and its own words ("Checking…", "Installing…", "Downloading…"), and its row says "Running…" (every row says "Checking…" while "Check again" runs); the other buttons are off, and their tooltip says another check is running. A long action (npm, qmd models, qmd collections, the Harness) names its step and the time it has taken under its row |
| App | Shortcuts | The list of the Keyboard shortcuts window |
| App | Machines | The switches of the link and the access level of each Linked machine: see [Link](link.md) |
| Agents | Assistant | The Assistant on this Machine: its switch, work hours, checks of sources and notifications, its duties, usage and limits, and the rules it remembers: see [Assistant](assistant.md) |
| Agents | Terminal AI | The switches and models of Terminal AI: see [Terminal](terminal.md) |
| Agents | Vendors | One row per Vendor this build runs, with its account or a sign-in: see [Vendors](vendors.md) |
| Agents | Sessions | The autocompact window of Sessions |
| Workflow | Autopilot | The default Run mode, the Start window and the daily budget of the Limits: see [Run planning](run-planning.md#settings--autopilot) |
| Workflow | Plan | The plan Claude Code is signed in with, and for Pro a preset with an Apply button |
| Workflow | Pipeline | The Pipeline of the active Project: see [Workflow](workflow.md) |
| Workflow | Pull requests | The notifications and the morning digest of the PR inbox, both on by default: see [Notifications](notifications.md#the-morning-digest) |
| Workspace | Canvas | The automatic archive of finished Sessions |
| Workspace | Browser | When a Live Browser goes to sleep |
| Workspace | Integrations | Every Integration of the Machine, its status and the Projects that use it, with Sign in, Sign out, Remove and Clean up: see [Integrations](integrations.md#settings--integrations) |

A change reaches every window of the Machine at once. When main cannot save it, the section says so with the reason, and the
setting stays as it was. Most sections word it "Not saved: …".

**Values and defaults.**

| Setting | Values | Default |
|---|---|---|
| Interface scale | 80–150 % by 10 % | 100 % |
| Memory in the version popover | on, off | on |
| Sessions: Orchestrator | 100K–1M tokens by 10K, or Claude Code default | 400K |
| Sessions: Other Sessions | 100K–1M tokens by 10K, or Claude Code default | 500K |
| Archive finished sessions after | Never, 6 h, 24 h, 3 days, 7 days | 24 h |
| …and when their Ticket is done | on, off | on |
| Notify about new review requests and replies | on, off | on |
| Morning digest | on, off | on |
| Live browsers at once | 1, 2, 3, 4, 5, 6, 8, 10 | 3 |
| Sleep when off screen after | 10 s, 30 s, 1, 2, 5, 10 min | 30 s |
| Sleep when unused after | 1, 2, 5, 10, 15, 30 min, 1 h | 5 min |
| Readable from zoom | 25, 30, 40, 50, 60, 75 % | 40 % |
| Default run mode | Fastest, Budget-aware, Start window | Budget-aware with the budget on, Fastest with it off |
| Start window from | 00:00–23:00 by whole hours | 23:00 |
| Start window to | 00:00–23:00 by whole hours | 07:00 |
| Daily budget of the Limits | on, off | off |
| Reserve for your own work | 0, 5, 10, 15, 20, 25, 30, 40, 50 % of the week | 15 % |

- **Interface scale.** The whole window zooms: text, Canvas, Terminal, Cards. While the thumb is dragged, only the value next
  to the slider changes. The scale applies when the thumb is let go or a key makes a step. View ▸ Bigger, Smaller and Actual
  size change the same setting.
- **Memory in the version popover** shows how much memory worfy's own processes use, on the last row of the popover of
  the version chip in the footer. Terminal sessions are not counted. Main samples the memory only while the setting is on
  and a version popover is open.
- **Version** is the build number, `<major>.<minor>.<N>`, as the version chip of the footer shows it: N counts the commits from the start of
  the history to the commit worfy was built from (`git rev-list --count HEAD`), so a newer build of `main` has a bigger
  number, and one commit gives one number on every Machine. Next to it, in brackets, is the build version
  `<semver>+<short SHA>`, which names the commit. A build with uncommitted changes ends in `.dirty`: it does not match its
  commit. A build from a shallow clone or from a folder outside git has no number and shows the build version alone.
- **Sessions.** A field takes thousands of tokens, and a typed value is brought into range and onto a step. A line under each
  role names where the window comes from: Custom, Claude Code default, Claude Code's settings file, or worfy default. The
  window applies after restarting the Session, and worfy restarts none by itself. When the login shell sets
  `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, the section says that it overrides both settings.
- **Canvas.** A finished Session leaves the Canvas this long after its last message, and nothing is deleted. A Session of a
  done Ticket leaves an hour after its last message while the second switch is on.
- **Autopilot.** While no run mode is chosen, the default follows the budget switch. The Start window is local time and may
  go across midnight. Its two hours are disabled unless the default run mode is Start window, and an hour equal to the other
  edge is not saved. The reserve is disabled while the budget is off, unless the default run mode is Budget-aware.
- **Plan.** Max and plans worfy does not know get no offer. Nothing is written without the click on Apply.
- A value set by hand outside the offered list, within the bounds, shows as it is. This holds for the Browser values and the
  reserve.

The sidebar has three more settings of the same kind and no row in this window: whether the «Older» Epics of a Project are
folded, whether the sidebar is shown (separately for the normal view and focus mode), and its width (dragged at its right
edge, see [Sidebar](#sidebar)).

Settings of a Project, such as its Terminal shell, are not here. They are in "Project settings…": see
[Projects](projects.md).

#### On a Linked machine

A window that shows a Linked machine's Project reads and writes the settings of its own Machine, and a Linked machine never
reaches them. Pipeline shows the Pipeline of that Machine read-only and says where to edit it. Plan says that the plan and its
settings are applied in worfy on the Machine of the Project.

### How it works

- **Settings are worfy's own state** ([ADR-0005](../adr/0005-worfy-own-state-inventory.md)). They go in no repository and no
  Profile. Two sections are the exception: Pipeline and the preset of Plan change the Profile, and main does it through the
  Harness's `bin/profile-set`.
- **Most sections share one file**, `app-settings.json` in the data folder. Terminal AI keeps `terminal-ai.json` and Machines
  keeps `link/settings.json`.
- **What is read is forgiving, what is written is strict.** No file gives the defaults. A file that cannot be parsed, or has
  a field of the wrong type, is set aside as `app-settings.json.unreadable-<time>` and the defaults apply. A missing field takes
  its default, an unknown one is dropped, and a scale or an autocompact window out of range is brought into range. An archive
  threshold this version does not know, or a Browser or Autopilot value outside its bounds, reads as not chosen, and the rest
  of the file stays.
- **A choice outlives the defaults.** `sessionArchive`, `browserSleep` and `autopilotBudget` keep only the fields the person
  chose, so a later change of a default does not touch them. An autocompact window not chosen gives way to `autoCompactWindow`
  in `~/.claude/settings.json`: then worfy passes nothing. Otherwise worfy passes its own default.
- **Each window keeps the newest state.** Main owns the settings, and a change that changes nothing writes nothing. Each other
  change raises `revision` and goes to every window as `appSettings.changed`. A renderer keeps the state with the highest
  revision, because an answer and an event can arrive out of order.
- **A setting is read when it is needed.** Main reads the autocompact window at every start of a Session's Claude Code, the
  archive settings at every run of the archive, the sleep settings at every check of the rules, and the budget before every Wave.
- **The strips around the window buttons keep their size.** The scale zooms the whole window, but the macOS window buttons stay
  where they are in window pixels. So `--toolbar-height` is 52 pixels of the window at any scale, and what is inside it still
  scales. The footer has no window buttons, so its `--footer-height` scales with the rest. Each load of a page gets the scale again, because Chromium keeps a zoom per origin of its own.

### Implementation

| What | Where |
|---|---|
| The schema, the bounds, the defaults, where a window comes from | `src/shared/settings/app-settings.ts` |
| The store and the reading of the file | `src/main/settings/store.ts`, `src/main/storage/json-file.ts` |
| The `appSettings` channels, all `local` | `src/shared/ipc/app-settings.ts`, `src/main/ipc/app-settings.ts` |
| The scale as the zoom of every window | `src/main/settings/interface-scale.ts` |
| The renderer's copy of the settings | `src/renderer/settings/useAppSettings.ts` |
| The window and its state | `src/renderer/settings/SettingsDialog.tsx`, `src/renderer/settings/settings-window.ts` |
| The modal window, its focus and the keys of the app while it is open | `src/renderer/theme/kit/Dialog.tsx`, `src/renderer/theme/kit/layer.ts` |
| The list of sections, their groups and icons: each `*Section.tsx` exports `order`, `title`, `group` and `icon` | `src/renderer/settings/sections.ts`, `src/renderer/settings/icons.tsx` |
| The scale on `<html>` | `src/renderer/settings/interface-scale.ts` |

A section is one file `src/renderer/settings/<Name>Section.tsx` that default-exports a component and exports `order` and
`title`. Adding the file is all it takes: the window finds it with `import.meta.glob`, and a file without those exports stops
the renderer with its path. The rows share `src/renderer/settings/controls.tsx`.

Main tests: `test/contract/app-settings.test.ts`, `test/unit/use-app-settings.test.tsx`, `test/unit/settings-dialog.test.tsx`,
`test/unit/interface-scale.test.tsx`, `test/e2e/settings.spec.ts`, `test/e2e/interface-scale.spec.ts`. Each section has its own
test, such as `test/unit/settings-sessions.test.tsx`.

## worfy Guide

### Behaviour

The worfy Guide is short visual help inside the app. It is a window over the app window: the list of Topics on the left, the
Topic on the right. A Topic is one screen: a diagram, a short text, **Under the hood** folded below it (more text, a table of
the main files, the limits) and **Full page**.

- **Opening.** Help ▸ worfy Guide and the palette's "worfy Guide" open it where it was. Each Topic also has a palette row,
  "Guide: `<Topic>`", that opens the Guide at that Topic. The link "worfy Guide" at the bottom of the
  [Getting started](onboarding.md#getting-started) panel and under the concepts of First run's "Welcome to worfy" opens it
  too; the panel and First run stay as they were behind it. Nothing opens it by itself.
- **Closing.** Esc, Close or a click outside the window closes it, and the focus goes back where it was. While it is open, no
  key reaches a shortcut of the app.
- **One modal window.** Opening the Guide closes Settings and Keyboard shortcuts, and either of them closes the Guide.
- **Language.** EN / RU in the header switches the Guide between English and Russian. The rest of worfy stays English.
  Until a choice is made, the Guide is Russian when the first language of the system is Russian, and English otherwise. The
  choice is a setting of the Machine and outlives a restart.
- **Links.** Full page and the files of Under the hood open GitHub in the system's browser, at the commit of this build. A
  build that does not know its commit links to `main`.
- **Diagrams.** Dots run along the arrows of a Topic's diagram. The pointer or the keyboard focus on a block lights the
  block, its neighbours and its connections, shows the labels of those connections and fades the rest. A block that names
  another Topic opens it on a click or Enter. Under the diagram, Play goes through its steps, one every 4 seconds, and stops
  on the last; a step button shows one step and says what happens in it, and pressing it again shows the whole diagram. The
  dots move only while the Guide is open and the diagram is in view. With Reduce motion in the system settings they stand
  still and the highlight changes at once. A screen reader reads the diagram's description and each of its connections.
- **No Project and no network** are needed.
- The test Topic "How the Guide works" is shown only when worfy runs from a build that is not packaged (`pnpm dev`, the e2e
  tests). Until the first real Topics come, the Guide of the packaged app says "No Topics yet."

### How it works

The Guide's window, its texts and its diagrams are a chunk of their own. The app loads it the first time the Guide opens, so
the start of worfy does not load it. The first chunk holds only the registry of Topics: one line per Topic with its id and
English title, which the palette needs.

A diagram is SVG drawn by the Guide's own scene kit (`src/renderer/guide/scene/`), with no animation library. Its dots
follow the path that draws their line, frame by frame (`requestAnimationFrame`); the frames stop while the page is hidden or
the diagram is out of view, and end when the Guide closes. Block colours follow the block's group: three groups take the
colours of the Node kinds, and Machine, Project and Tools have colours of the Guide's own, kept apart from the status
colours.

Each Topic is a folder with `topic.json` (the pages of `docs/features/` it was checked against, each with a commit, and its
main files), `en.json` and `ru.json` (every text, the same keys in both) and its diagram. A test fails when a string has only
one of its two versions, or when a page or a file a Topic names is not in the repository. `scripts/guide-lag.mjs` reports
Topics whose page has commits after the one they were checked at, and Russian texts older than their English ones. It is not
part of `pnpm lint`: a lag does not fail a PR. The decisions are in ADR-0090.

### Implementation

| What | Where |
|---|---|
| The registry of Topics, read by the palette | `src/renderer/guide/registry.ts` |
| Open, closed, the Topic on screen | `src/renderer/guide/store.ts` |
| The modal window it is drawn in | `src/renderer/theme/kit/Dialog.tsx` |
| Loading the window on the first opening | `src/renderer/guide/GuideHost.tsx` |
| The window | `src/renderer/guide/GuideWindow.tsx`, `src/renderer/guide/guide.css` |
| The texts and Topics | `src/renderer/guide/content.ts`, `src/renderer/guide/strings/en.json`, `src/renderer/guide/topics/skeleton/topic.json` |
| Language and links | `src/renderer/guide/language.ts`, `src/renderer/guide/links.ts` |
| The report of lagging Topics | `scripts/guide-lag.mjs` |

Main tests: `test/unit/guide.test.tsx`, `test/unit/guide-content.test.tsx`, `test/unit/guide-window.test.tsx`,
`test/unit/guide-lag.test.ts`, `test/e2e/guide.spec.ts`.

## Theme

### Behaviour

worfy has no theme setting. The window follows the light or dark appearance of the system, and changes at once, a running
Terminal included.

- The light palette has a pale grey ground and a blue primary colour (`#0071e3`). The dark palette, called Graphite, has a warm
  dark ground and a lime primary colour (`#c8f25a`).
- A Terminal has a dark ground in both.
- Light has soft layered shadows. Dark has no shadows, only 1 px borders.
- An Orchestrator, a Session and an Epic each have a colour of their own, used for the header band, the kind icon and the
  minimap. A Subagent has the colour of its Session, as an outline only. These colours are never status text.
- A control a click acts on shows the pointer cursor, a veil under the pointer and the accent ring on keyboard focus. An
  inactive control shows none of them and has the "not allowed" cursor.

#### macOS

No title bar. The traffic lights sit in the sidebar's top strip, at the toolbar's height, before the wordmark, and over
the toolbar while the sidebar is hidden. The sidebar is translucent, so the system's vibrancy shows through it.

#### Windows

The system's own frame with its title bar, and an opaque page and sidebar. Until the page has painted, the window shows the
ground colour of the theme the system had when the window was created.

### How it works

The system appearance picks the set of tokens through `prefers-color-scheme`. The shared building blocks take their colours
only from the tokens, so they need no code for each theme. A Terminal hands the colours of the tokens to xterm.js as options,
and hands them again when the scheme changes. The design is variant F ([docs/design/F-SPEC.md](../design/F-SPEC.md)), and the colours by
Node kind are [ADR-0077](../adr/0077-node-kind-tokens.md).

The tokens are checked by tests: every colour against the table of the design spec, and each pair of text and ground for a
contrast of at least 4.5:1, on a hovered ground too. The dark shadows are a transparent zero shadow and not `none`, because
rules put them into comma-separated lists, and `none` in a list makes the browser drop the whole declaration.

### Implementation

| What | Where |
|---|---|
| The tokens of both themes, and the rules for controls | `src/renderer/theme/tokens.css` |
| Shared building blocks | `src/renderer/theme/primitives.tsx`, `src/renderer/theme/primitives.css` |
| The shared list control in place of the native one | `src/renderer/theme/Select.tsx`, `src/renderer/theme/select.css` |
| The frame of the window by system | `src/main/window-frame.ts`, `src/main/window.ts` |
| The opaque page outside macOS | `src/renderer/shell/shell.css` |
| The colours of a Terminal | `src/renderer/canvas/nodes/TerminalNode.tsx` |

Main tests: `test/e2e/theme.spec.ts`, `test/e2e/theme-shadows.spec.ts`, `test/e2e/controls.spec.ts`,
`test/unit/contrast.test.ts`, `test/unit/kind-tokens.test.ts`, `test/unit/shadow-tokens.test.ts`,
`test/unit/terminal-theme.test.tsx`, `test/unit/window-options.test.ts`.
