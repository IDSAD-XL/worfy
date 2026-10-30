# App shell

What surrounds the Canvas in every window, on every Project. Five Features: the **Command palette**, **Shortcuts**, the
**Menu**, **Settings** and the **Theme**. [Notifications](notifications.md), the sixth, has a page of its own. Terms are
explained in [Concepts](concepts.md).

## Command palette

### Behaviour

One field over the window that finds commands and things of the Project. The "Search or run…" field of the toolbar opens
it, and so does ⌘K (Ctrl+K on Windows). The panel is 560 pixels wide and at most 440 high.

Typing ranks the rows. ↑ and ↓ walk all the rows across the groups and wrap round, and the pointer over a row selects it.
Enter or a click runs the selected row. Esc or a press outside the panel closes the palette.

A command that worked closes the palette. A command that failed leaves it open with the reason at the bottom, until the
next typing or pick. While a command runs, another pick does nothing.

**Groups.**

| Group | Rows |
|---|---|
| Action | New session; a "New …" for each item of the Canvas menu; Tidy up; Arrange by Epic; Re-pack; Archive finished sessions now; Process gate queue; Run wave `<epic>`; Ship ticket `<epic>/<NN>`; Reconnect machine…; Remove machine… |
| View | Switch to Canvas; Switch to Session; First-run checks; Getting started; Settings…; Keyboard shortcuts; Show only tag `<tag>`; Show all Nodes |
| Project | Switch to project `<name>`, for each other Project |
| Go to | Orchestrator; each Epic, Ticket and ADR; each Node of the Layout, except those worfy draws from the workflow and binding anchors |
| Manual check | Each unchecked manual check of a Ticket. These rows appear only after typing |
| In transcripts | The Project's Sessions whose conversation contains the query |

Some rows exist only in some states:

- Process gate queue: only on the Machine whose Profile gives it the role `serve` of the cross-machine gate. Its detail
  counts the waiting PRs and the age of the oldest.
- Run wave and Ship ticket: only where the Epic frame or the Ticket has that button.
- Reconnect machine…: only for a Linked machine that is not online, or whose certificate changed. Remove machine…: for
  each Linked machine. The name of the Machine is in the detail of the row.
- Show all Nodes: only while a tag filter is on.

A "Go to" row shows the Canvas and centers it on the Node. An archived or hidden Node is brought back first. A Ticket of a
collapsed frame centers its frame. An ADR row opens that ADR read-only and does not move the Canvas. With the sidebar hidden, the ADR opens when the sidebar is shown. The Orchestrator row
opens the Session view and starts the Orchestrator if it does not run. A Manual check row goes to its Ticket and ticks
nothing. Picking an "In transcripts" row opens that Session in the Session view.

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
reads the user's messages and Claude's replies, not tool calls, their output, thinking, hooks or the records of Subagents.

At most 20 Sessions come back, newest first, each with a snippet of up to 120 characters from around the match. One search
reads at most 200 transcripts and 64 MiB. When a limit leaves some unread, the group says "Older transcripts were not
searched". It also says "Searching…" and "Could not search the transcripts: …". These rows come in addition to the 50
command rows, below them.

**Without a Project** the palette has the View rows, the Project rows and the machine rows, and no transcript search.

#### Windows

Inside a Terminal, Ctrl+K belongs to the shell and the palette does not open. See [Shortcuts](#shortcuts).

#### On a Linked machine

On a read-only screen, the rows that would change the Project are inactive with the hint "… gives this Machine read-only
access". These are New session, New …, Tidy up, Arrange by Epic, Re-pack, Archive finished sessions now, Process gate queue,
Run wave and Ship ticket, and a Go to row of an archived or hidden Node. The views, moving the Canvas and switching Projects
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
  An answer to an older query is dropped when it arrives.

### Implementation

| What | Where |
|---|---|
| The field, the panel, the keys, the transcript search | `src/renderer/palette/CommandPalette.tsx` |
| Building the commands from the window's state | `src/renderer/palette/commands.ts` |
| Grouping the ranked rows | `src/renderer/palette/groups.ts` |
| Ranking (`rankItems`), shared with Canvas find | `src/renderer/find/search-index.ts` |
| What makes Run wave and Ship ticket active | `src/renderer/canvas/actions/gates.ts`, `src/shared/actions/render-template.ts` |
| What Run wave, Ship ticket and Process gate queue start | `src/main/actions/launch.ts`, `src/main/ipc/actions.ts` |
| The transcript search and its limits | `src/main/claude-home/search.ts`, `src/shared/ipc/claude-home.ts` |

Main tests: `test/unit/palette-commands.test.tsx`, `test/unit/palette-groups.test.tsx`,
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
| Its state and its modal guard on `window` | `src/renderer/shortcuts/shortcuts-window.ts` |

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
| Help | Keyboard Shortcuts; on macOS also the system's search field |

- **Settings…** (⌘,) opens the [Settings](#settings) window of the window it was chosen for.
- **Bigger and Smaller** change the interface scale of the Machine by a tenth, from 80 % to 150 %, and **Actual size** sets it
  to 100 %, in every window. They stand where Electron's zoom items stand and do not zoom one window. Their keys carry ⌥ (Alt), because ⌘= and ⌘- zoom
  the Canvas. Bigger is disabled at 150 % and Smaller at 80 %, also when the scale changed in Settings.
- **Toggle Sidebar** (⌘B) hides or shows the sidebar, wherever the focus is. The one exception is inside a Terminal on Windows,
  below. The normal view and focus mode have separate answers, and the switch changes the answer of what the window it was
  chosen for shows now. Both answers are settings of the Machine: every window in that mode follows, and they outlive a
  restart. The button in the toolbar and in the focus mode bar does the same.
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
the palette. It is modal, with its sections in a column on the left. Esc or Close closes it, and the focus goes back where it
was. ↑ and ↓ move through the sections, and Tab goes round the controls of the window. While it is open, ⌘K, ⌘F and ⌘↩ do
nothing.

| Section | What it holds |
|---|---|
| General | Interface scale; Memory in the toolbar; Version |
| Health | The First run checks with their actions and "Check again". Opening the section checks |
| Shortcuts | The list of the Keyboard shortcuts window |
| Machines | The switches of the link and the access level of each Linked machine: see [Link](link.md) |
| Terminal AI | The switches and models of Terminal AI: see [Terminal](terminal.md) |
| Sessions | The autocompact window of Sessions |
| Canvas | The automatic archive of finished Sessions |
| Browser | When a Live Browser goes to sleep |
| Autopilot | The daily budget of the Limits: see [Autopilot](autopilot.md) |
| Plan | The plan Claude Code is signed in with, and for Pro a preset with an Apply button |
| Pipeline | The Pipeline of the active Project: see [Workflow](workflow.md) |

A change reaches every window of the Machine at once. When main cannot save it, the section says so with the reason, and the
setting stays as it was. Most sections word it "Not saved: …".

**Values and defaults.**

| Setting | Values | Default |
|---|---|---|
| Interface scale | 80–150 % by 10 % | 100 % |
| Memory in the toolbar | on, off | on |
| Sessions: Orchestrator | 100K–1M tokens by 10K, or Claude Code default | 400K |
| Sessions: Other Sessions | 100K–1M tokens by 10K, or Claude Code default | 500K |
| Archive finished sessions after | Never, 6 h, 24 h, 3 days, 7 days | 24 h |
| …and when their Ticket is done | on, off | on |
| Live browsers at once | 1, 2, 3, 4, 5, 6, 8, 10 | 3 |
| Sleep when off screen after | 10 s, 30 s, 1, 2, 5, 10 min | 30 s |
| Sleep when unused after | 1, 2, 5, 10, 15, 30 min, 1 h | 5 min |
| Readable from zoom | 25, 30, 40, 50, 60, 75 % | 40 % |
| Daily budget of the Limits | on, off | off |
| Reserve for your own work | 0, 5, 10, 15, 20, 25, 30, 40, 50 % of the week | 15 % |

- **Interface scale.** The whole window zooms: text, Canvas, Terminal, Cards. While the thumb is dragged, only the value next
  to the slider changes. The scale applies when the thumb is let go or a key makes a step. View ▸ Bigger, Smaller and Actual
  size change the same setting.
- **Memory in the toolbar** shows how much memory worfy's own processes use. Terminal sessions are not counted. Main samples
  the memory only while the setting is on.
- **Sessions.** A field takes thousands of tokens, and a typed value is brought into range and onto a step. A line under each
  role names where the window comes from: Custom, Claude Code default, Claude Code's settings file, or worfy default. The
  window applies after restarting the Session, and worfy restarts none by itself. When the login shell sets
  `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, the section says that it overrides both settings.
- **Canvas.** A finished Session leaves the Canvas this long after its last message, and nothing is deleted. A Session of a
  done Ticket leaves an hour after its last message while the second switch is on.
- **Autopilot.** The reserve is disabled while the budget is off.
- **Plan.** Max and plans worfy does not know get no offer. Nothing is written without the click on Apply.
- A value set by hand outside the offered list, within the bounds, shows as it is. This holds for the Browser values and the
  reserve.

The sidebar has two more settings of the same kind and no row in this window: which sections are collapsed, and whether the
sidebar is shown (separately for the normal view and focus mode).

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
  scales. Each load of a page gets the scale again, because Chromium keeps a zoom per origin of its own.

### Implementation

| What | Where |
|---|---|
| The schema, the bounds, the defaults, where a window comes from | `src/shared/settings/app-settings.ts` |
| The store and the reading of the file | `src/main/settings/store.ts`, `src/main/storage/json-file.ts` |
| The `appSettings` channels, all `local` | `src/shared/ipc/app-settings.ts`, `src/main/ipc/app-settings.ts` |
| The scale as the zoom of every window | `src/main/settings/interface-scale.ts` |
| The renderer's copy of the settings | `src/renderer/settings/useAppSettings.ts` |
| The window and its modal guard | `src/renderer/settings/SettingsDialog.tsx`, `src/renderer/settings/settings-window.ts` |
| The list of sections | `src/renderer/settings/sections.ts` |
| The scale on `<html>` | `src/renderer/settings/interface-scale.ts` |

A section is one file `src/renderer/settings/<Name>Section.tsx` that default-exports a component and exports `order` and
`title`. Adding the file is all it takes: the window finds it with `import.meta.glob`, and a file without those exports stops
the renderer with its path. The rows share `src/renderer/settings/controls.tsx`.

Main tests: `test/contract/app-settings.test.ts`, `test/unit/use-app-settings.test.tsx`, `test/unit/settings-dialog.test.tsx`,
`test/unit/interface-scale.test.tsx`, `test/e2e/settings.spec.ts`, `test/e2e/interface-scale.spec.ts`. Each section has its own
test, such as `test/unit/settings-sessions.test.tsx`.

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

No title bar. The traffic lights sit inside the toolbar, and the sidebar is translucent, so the system's vibrancy shows
through it.

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
