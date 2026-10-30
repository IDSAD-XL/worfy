# Projects

Three Features of a Project as a whole. **Full mode and Silent mode** decide where the files of the workflow live. The
**Project switcher** is the list of Projects and the choice of the one a window shows. **ADRs and HANDOFF** are read-only
views of two kinds of workflow documents. Terms are explained in [Concepts](concepts.md).

## Full mode and Silent mode

### Behaviour

The mode of a Project decides where its Workflow folder is. In Full mode it is the root of the repository, and the files
travel in its branches. In Silent mode it is a folder outside the repositories, and the repository gets no trace of the
workflow.

| | Full mode | Silent mode |
|---|---|---|
| Workflow folder | The Project root | A folder outside the Project's repositories |
| Repositories | One | One or several |
| Ticket status | The Ticket file in the checkout and on Ticket branches | The Ticket file in the Workflow folder, one status |
| What worfy watches | The Tickets root, the git refs and the list of worktrees | The Tickets root |
| Branch of a Ticket | Named by the Ticket: `<epic>/<NN>` by default | Named by the change; the `Branch:` line of the Ticket names it |
| Agents' marks (`review`, `check/<name>`) | Commit statuses of the PR's head commit | A marks file in the Harness home |
| Claude attribution lines by default | On | Off |

Full mode keeps its marks in the same file when the Profile finishes with `local-green` and the repository has no
`origin`.

In Silent mode the Harness keeps the repository clean. Its guard refuses a commit, a branch name or a PR text with a trace
of the workflow: an Epic name, `<epic>/<NN>`, an ADR or Ticket number, the path of the Workflow folder, `.scratch` or
`HANDOFF`. A diff's added lines are not checked for a bare Epic name. Each Session of such a Project is told where the
Workflow folder is.

**Choosing the mode.** The mode is chosen once, in the "Add project" dialog, and Silent mode is the preselected one. The
dialog opens only for a folder the Harness does not know. worfy has no control that changes the mode of a connected
Project. The one other place that sets a mode is the move of an old Profile of schema 1 in the Harness migration form: it
proposes Full mode when the Tickets folder is inside a git repository and Silent mode otherwise, and the user may change
the proposal.

**"Add project".** The "+" of the Projects section opens it, and "Connect…" of Getting started asks for the same thing. The
header names five steps: Folder, Mode, Harness, Draft and Review. The footer says that nothing is written until Connect.

1. **Folder.** The system folder picker. What the folder is decides what comes next:

   | Folder | What happens |
   |---|---|
   | The Harness knows it | It joins the list at once and becomes active. No dialog |
   | A git repository | The dialog opens |
   | A subfolder or a linked worktree of a repository | Its repository root is taken, and a notice says so |
   | Outside git, with two or more repositories as direct subfolders | The dialog opens for a Project over several repositories. Folders with a leading dot are not counted |
   | Outside git, with one repository | Refused: choose that repository itself |
   | Outside git, without repositories | Refused, with the reason |
   | The Harness could not answer whether it knows the folder | Refused, with the reason. The folder is not treated as new |

   When the profile script is missing and the Harness step would stop the dialog anyway, the folder does go on, and that
   step says what to do.

2. **Mode.** Two cards. In Silent mode a field shows the Workflow folder. The default is a new folder
   `<Harness home>/projects/<name>/workflow/` with its own git history, or the folder itself for a Project over several
   repositories. "Choose…" takes another one, and "Use default" goes back. A chosen folder must exist and lie outside the
   Project's repositories, and it is taken as it is. "Write draft" goes on.
3. **Harness.** The Harness plugin must be installed, enabled and of this build's version. Otherwise the dialog names the
   reason and offers "First-run checks…".
4. **Draft.** A Claude Code Session reads the folder and proposes the Profile. The dialog shows its last action. Stop ends
   the Session and goes back to Mode with "Stopped: no draft was written." A failure shows the reason with "Back" and
   "Try again".
5. **Review.** A form over the draft: the GitHub account, the name, the commands, the Gate commands, the Ticket branch, the
   finish, the review lenses, the MCP servers, the languages, the attribution and `rules.md`. The mode and the Workflow
   folder are shown and cannot be edited here, and all the Profile fields can be read as JSON. Every edit is checked by the
   Harness after 350 ms without another edit, and a problem appears under its field. "Connect" stays inactive while a check
   runs or could not run, while the accounts are read and while any problem is left.
6. **Connect.** The Harness writes the Profile, and the folder joins the list and becomes active. This may take up to
   30 minutes, because the write may index the Project for qmd. A skipped qmd step comes back as a notice, and the Project
   is connected anyway.

Esc and Cancel close the dialog and stop a running draft, but not while Connect writes. A click outside closes it only on
the Mode step.

**The GitHub account.** The form lists the accounts gh knows for the hosts of the folder's `origin` remotes, each with its
write access. Preselected is the active account with write access, else the first account with it, else none. The choice
sets two Profile fields: `github.account`, and `workflow.finish`, which is `pr-green-ci` with write access to every such
repository and `local-green` otherwise. "No account" means no account and `local-green`, and so does a folder with no
`origin` on a GitHub host or a machine without gh. "Sign in with gh" runs `gh auth login` in a terminal inside the dialog,
and the accounts are read again when gh exits.

**What the form starts with.** The language of reports is the system language, `ru` or else `en`. In Silent mode the
attribution starts as `off`, whatever the Session proposed, and what the user picks in the form is written as picked. In
Full mode it stays as the Session proposed. For a git repository the worktrees go under `.claude/worktrees/` of the
repository.

**A Project over several repositories.** It is always in Silent mode: the Full mode card is inactive and says so, and main
refuses Full mode for it at the draft and again at the write. Each Ticket says which repository it belongs to with a
`Repo:` line. With two or more repositories a Ticket Node shows a chip with that name, or `no repo`. A Ticket shows the
Gate, PR and CI of its own repository, and a Ticket without a repository shows none. The folder itself has no branch, so
the list shows `—` for it.

**When the Harness gives no answer.** Each Project is read through the Harness, and there are two ways of not getting an
answer:

| Case | What worfy does |
|---|---|
| No Profile: exit code 3, no script, a Harness older than Silent mode | Full mode, with the Project root as the Workflow folder and the Tickets in `<root>/.scratch` |
| The call failed: another exit code, a timeout, output of the wrong shape | The mode is unknown. In place of the Tickets worfy shows "worfy could not ask the Harness where the workflow of this Project lives:" and the first three lines of the reason. It asks again after 10, 30 and 60 seconds, then every 5 minutes, and needs no restart. HANDOFF and the ADRs are read from the Project root meanwhile |

#### Windows

A new folder inside `%TEMP%` gets the sign `in %TEMP%` on the Folder step, with a warning that Storage Sense may delete its
files. Adding it stays allowed. A folder the Harness knows skips the dialog, and the Gate badge of such a worktree carries
the same sign.

#### On a Linked machine

With Linked machines, "Add project" first asks for the Machine: this one, then the Linked machines by name. A Machine that
is asleep, not online, without access, read-only or with a changed certificate cannot be chosen, and says why.

The system picker opens only on its own Machine, so a Linked machine's folder is chosen in a browser inside worfy. It
starts in the home folder of that Machine, has "Up" and "Show hidden folders", and shows at most the first 2000 folders by
name. Every step then runs on that Machine, and the dialog says so. It offers no gh sign-in and no first-run screen. The
Project joins the list there without changing that Machine's active Project, and this window opens it.

### How it works

- **worfy is a view over the workflow** ([ADR-0002](../adr/0002-worfy-is-a-view-over-the-workflow.md)). It asks the Harness
  where the files are, and "Add project" writes only through a Harness script. Its own state stays in its data folder
  ([ADR-0005](../adr/0005-worfy-own-state-inventory.md)).
- **The Profile is entirely on the Machine, and the Workflow folder has one layout in both modes**
  ([ADR-0042](../adr/0042-profile-on-machine-full-and-silent-modes.md)). `HANDOFF.md` and `docs/adr/` have the same places in
  it, so one reader serves both modes.
- **The draft Session can change nothing.** It has only Read, Glob and Grep, and everything that writes, reaches the network
  or starts agents is taken away and refused. It has no shell, so what only a command could tell (remotes, branches) is read
  first by a Harness script and handed to it as data. worfy then sets over the answer the values it owns: the mode, the
  Workflow folder, the worktree root, the language of reports, no GitHub account and the Profile name in each Gate entry.
- **What Connect writes**, all through `harness/bin/project-connect`: `profile.json` and `rules.md`, the Gate registry
  entries, the default Workflow folder with `git init`, and one commit in the Harness home. A failure half-way rolls it back.
  In Silent mode the repositories get one thing, the line `.claude/worktrees/` in `.git/info/exclude`. Nothing goes into a
  working tree or `.gitignore`.
- **One Ticket, one repository** ([ADR-0045](../adr/0045-one-ticket-one-repository.md)), so each repository answers for its
  own checks. The default attribution follows the mode, and a value in the Profile wins
  ([ADR-0061](../adr/0061-attribution-default-follows-mode.md)). Marks have two stores by mode
  ([ADR-0067](../adr/0067-pipeline-in-profile-and-sha-bound-agent-marks.md)).
- **A Ticket file outside the root stays reachable and bounded.** In Silent mode a Ticket and its links open from the
  Workflow folder and the Tickets root. A place that is the root of a disk or holds the home folder is left out, so a Profile
  naming one cannot open every file of the user to a link in a Ticket.

### Implementation

**Modules.**

- `src/main/workflow/folder.ts`: `ProjectLayout` and `readProjectLayout`, which asks `profile -C <root> --json` and
  `ticket root`. `projectLayouts()` is the app's cache, one answer per Project for 30 seconds.
- `src/main/workflow/profile.ts`: `readResolvedProfile` tells "no Profile" from "the call failed".
- `src/main/projects/connect.ts`: `ProjectConnector` runs the steps in main. `inspectFolder` and `profileKnows` are step 1,
  `harnessBlocker` is step 3, `applyChoices` sets what worfy owns. `src/main/harness/attribution.ts`: the default attribution.
- `src/main/ipc/projects.ts`, `src/shared/ipc/projects.ts`: the `projects.connect.*` channels.
- `src/renderer/projects/ConnectProject.tsx`: the dialog. `src/renderer/projects/GithubAccount.tsx`,
  `src/main/github/accounts.ts`: the account step. `src/renderer/projects/FolderBrowser.tsx`, `src/main/projects/browse.ts`: the
  folders of a Linked machine. `src/main/projects/temp-folder.ts`: the `%TEMP%` rule.
- `src/main/workflow/reader.ts`, `src/main/workflow/watch.ts`: read and watch by the layout; a failed layout is asked again
  on `LAYOUT_RETRY_MS`. `src/main/workflow/marks.ts`, `src/main/workflow/stages.ts`: the marks of both stores.
- `src/main/ipc/shell.ts`: `workflowPlaces`, the places of a Ticket outside the root.
- `harness/bin/project-connect`: the check and the write. `harness/bin/silent-check`, `harness/hooks/guard.mjs`: the traces
  and the refusal. `harness/hooks/session-start.mjs`: what a Session is told. `harness/profiles/README.md`: the Profile field
  by field.

**Data flow of "Add project".**

1. `projects.connect.inspect` answers `added`, `new` or `rejected`. For `added` it has already called `ProjectStore.add`.
2. `projects.connect.draft` checks the folder and the Harness, runs `project-connect --facts`, starts the Session with the
   draft schema as its structured output, and sends `projects.connect.activity`. The answer passes `--schema-only`, goes
   through `applyChoices` and then `--check`.
3. `projects.connect.check` runs `--check` on every edit, and an older answer is dropped.
4. `projects.connect.write` runs `project-connect` without arguments. `bin/profile -C` must then know the folder, and only
   then it is added to the list. The script has 120 seconds for the facts and the checks and 30 minutes for the write, and
   it is killed when the app quits.

**Main tests.**

- `test/contract/projects-connect.test.ts`: the steps with stand-ins and with the real scripts, the tools of the draft
  Session, the time limits, the attribution held to `bin/profile`.
- `test/e2e/projects-connect.spec.ts`: Silent by default, the draft, the form, Connect, the Harness not installed, the account.
- `test/e2e/silent-project.spec.ts`: a Silent Project and a Project over two repositories in the built app, with nothing
  written into the Workflow folder or the repositories.
- `test/contract/github-accounts.test.ts`: the accounts. `test/unit/temp-folder.test.ts`: the `%TEMP%` rule.
- `test/unit/add-project-machine.test.tsx`, `test/unit/folder-browser.test.tsx`, `test/e2e/linked-add-project.spec.ts`:
  "Add project" on a Linked machine.

## Project switcher

### Behaviour

**The list.** "Projects" is the first section of the sidebar, after Getting started while that section is shown. A row shows a folder icon, the name of the folder and, on the
right, the checked-out branch: `HEAD` when detached, `—` when git cannot read it. The tooltip is the full path. The Project
the window shows is highlighted, and the toolbar repeats it as `<name> · <branch>`. The branch is read again when the window
gets focus and on every change of the list.

Without Projects the section says "No projects yet", the toolbar "No project" and the Canvas "Add a project to see its
canvas."

**Switching.** A click on a row switches, and so does `Switch to project <name>` in the Command palette, which lists every
other Project of the window's Machine. A row of the Pipeline section, or the notification of a Ticket that waits for the owner,
opens its Project the same way and shows its Pipeline board. The switch applies to the Canvas, the Session view and the
Pipeline board.

- The active Project is one per Machine, and every window of the Machine follows it.
- The list and the active Project survive a restart.
- The Orchestrator of the newly active Project opens. The Orchestrators of the other listed Projects are not closed.
- The switch writes nothing into any repository.

Adding a listed Project the Harness knows selects it and says `<name> is already in the list.`

**The context menu of a row.**

- "Project settings…" holds the message templates of "Ship ticket", "Run wave" and "Process gate queue", with the
  placeholders `{epic}`, `{NN}`, `{wave}`, `{slug}`, `{branch}` and `{tickets}`. An unknown placeholder shows an error under
  the field and turns off Save. "Reset to default" puts in the defaults of the Harness found on the Machine now. On Windows
  the dialog also has the [Terminal shell](terminal.md).
- "Process gate queue" is there only when the Project's role in the cross-machine Gate queue is `serve`. It sends the template
  to the Orchestrator of the Project.
- "Remove from list" acts at once, without a question. The Project leaves the list. If it was the active one, the first of
  the rest becomes active, or none. Its data folder stays, so a Project added again finds its settings there. Its Orchestrator closes, and
  so do the shells of its [Terminals](terminal.md). The repository and the Harness Profile are not touched.

**A broken list.** A `projects.json` with broken JSON or the wrong shape is set aside, and the app starts with an empty list. A saved active
Project that is not in the list reads as no active Project.

#### On a Linked machine

With a Linked machine the list is grouped by Machine: this one first, then the Linked machines by name.

| State of the Machine | What its group shows |
|---|---|
| Online, sharing | `Online`, and its Projects |
| Online, read-only | `Online`, a `Read only` chip, and its Projects |
| Online, access off | `<name> doesn't share its Projects` |
| Not online, or its certificate changed | `Unavailable`, no Projects |

A window shows the Projects of one Machine, named in its address (`machine` and `project`):

- A click on a Project of another Machine loads the window again on that Machine.
- A click on another Project of the same Linked machine changes only what this window shows, without a reload.
- A click on a Project of this Machine makes it active here and brings the window back to this Machine.
- A Linked machine's adds and removes keep the active Project of the Machine it looks at, and `projects.select` is not open
  to it.
- The toolbar shows `<name> · <Machine> · <branch>`.

With full access a Linked machine may add and remove Projects there. It may not remove that Machine's active Project: "only
its own screen removes it". With read-only access the write actions stay on screen, inactive, and the tooltip says
`<name> gives this Machine read-only access`. Switching stays active.

A Project marked local to its Machine, such as the Demo project, is not in the list a Linked machine gets. A call that names
it is refused.

### How it works

- **A Project is a folder with an id.** The id is `<folder name>-<first 8 hex of sha256(path)>`, and it also names the
  Project's data folder. The hash is of the root as git or the Harness spells it, so on Windows the `C:/…` spelling keeps ids
  stable, while the stored path is `C:\…`.
- **A list has a revision.** Every change raises it, and a client keeps the state with the highest revision, so a late answer
  does not roll the list back. An equal revision is taken, as it may carry a fresher branch.
- **A fresh renderer per Machine.** The modules of the renderer keep their state by Project id, and the same folder on two
  Machines has one id. So moving to another Machine reloads the window ([ADR-0053](../adr/0053-several-screens-on-one-project.md)).
- **A screen holds a Project.** While a screen of a Linked machine shows a Project with full access, the Project's Machine keeps
  its Orchestrator and documents open, as for its own active Project. A client that leaves lets go of everything it held.
  `projects.hold` is a `write` channel, so a read-only screen holds nothing
  ([ADR-0066](../adr/0066-read-only-access-for-a-linked-machine.md)).

### Implementation

**Modules.**

- `src/main/projects/store.ts`: `ProjectStore`, the list in `<data root>/projects.json`, the branch through `git`, and
  `onChange`, the event for "the active Project switched". `states()` gives the list for this Machine's windows and for a
  Linked machine.
- `src/main/projects/settings.ts`, `src/shared/projects/action-templates.ts`: the settings of a Project.
  `src/main/projects/holds.ts`: `ProjectHolds`. `src/main/ipc/linked.ts`: `linked.open` turns a window's choice into a hold.
- `src/main/ipc/projects.ts`, `src/shared/ipc/projects.ts`: the channels and their access. `projects.select` is `local`,
  `projects.pickFolder` is `desktop`, and `projects.list`, `projects.remove`, `projects.add` and `projects.hold` are `project`.
- `src/main/agent/app-orchestrators.ts`: follows `onChange` and the holds, and closes the Orchestrator of a removed Project.
- `src/renderer/projects/useProjects.ts`: the renderer's copy, `openProject` as the one way to open a Project, `groupProjects`
  for the Machines, and `useReadOnly`.
- `src/renderer/shell/sidebar/ProjectsSection.tsx`: the section and the menu. `src/renderer/shell/ProjectSettings.tsx`: the
  settings dialog. `src/renderer/projects/read-only.ts`: how an inactive write action looks.
- `src/renderer/palette/commands.ts`: "Switch to project". `src/renderer/pipeline/open.ts`,
  `src/renderer/canvas/overlays/NotificationTarget.tsx`: the other routes to `openProject`.

**Data flow of a switch.** `openProject` calls `projects.select` on this Machine. `ProjectStore.select` commits, and its
listeners run: `projects.changed` goes to every client, `src/main/ipc/docs.ts` moves the kept documents, and the Orchestrator of
the new Project opens. The renderer takes the answer through `acceptProjectsState`.

**Main tests.**

- `test/contract/projects.test.ts`: add, select, remove, persistence, settings, the untouched repository, `projects.browse`,
  calls from a Linked machine and Projects local to a Machine.
- `test/e2e/projects.spec.ts`: add, switch, settings, restart and remove in the built app, and a broken `projects.json`.
- `test/unit/use-projects.test.tsx`: revisions, the groups by Machine, windows on a Linked machine.
- `test/contract/projects-hold.test.ts`, `test/unit/project-holds.test.ts`: holds. `test/contract/link-access.test.ts`,
  `test/unit/link-access.test.ts`: what a Linked machine may call.

## ADRs and HANDOFF

### Behaviour

Both are read-only views: worfy has no control that edits these files. **HANDOFF** is one file, `HANDOFF.md`, at the root of
the Workflow folder. **ADRs** are the files `docs/adr/NNNN-*.md` there: four digits and a dash, directly in that folder, so a
`README.md` next to them is not an ADR. In Full mode the Workflow folder is the Project root, and in Silent mode the Project's
files of the same name in the repository are not read. These two places are fixed: worfy does not read `docs.handoff.path` or
`docs.adr_dir` of the Profile.

**The HANDOFF Node.** It shows the text rendered as markdown, with the header `HANDOFF` and `HANDOFF.md`. Its default size is
360 by 320 pixels, and it resizes down to 240 by 120. An edit by hand or by an agent is on the Node within a second.

| Situation | The Node |
|---|---|
| A Project is seen with `HANDOFF.md` for the first time | Created locked, at the top-left spot of the plane if that is free, otherwise under every Node |
| Locked | It moves and resizes, and it cannot be removed. Delete does not apply to it |
| The file goes away | Hidden, and marked as hidden by main |
| The file comes back | Shown again |
| Hidden through the canvas tools while the file exists | Stays hidden |
| Shown by someone while the file is gone | The body says "The Project has no HANDOFF.md" |
| The documents could not be opened, or the text of a listed file could not be read | The body says "HANDOFF.md could not be read:" and the reason |

The text can be selected. The wheel moves the Canvas until the Node is clicked, and then it scrolls the text. Find searches
the text of HANDOFF.

**The ADR section.** It is in the sidebar after the Epics, with the count of ADRs in its header. A row shows the number, the
title and the status, sorted by number. The title is the first `# ` heading, or the file name without one. The status is
what follows the status label, without the final dot, looked for in the first 20 lines. The label is `docs.adr_status_label`
of the Profile, or `Status` without one; the old `Статус` is read as well. A file without such a line has no status.

Without ADRs the section says "No ADRs in docs/adr/". A file added or removed changes the list without a reload.

**The ADR panel.** A click on a row opens the ADR over the Canvas on the right, at most 680 pixels wide, with the number, the
title and the status in its header. Esc or Close closes it. A change of the file shows in the open panel, an ADR that is gone
hides it until the file is back, and another Project does not show it. "Go to" of the Command palette lists every ADR by title and finds it by
number too (`12`, `0012`, `adr 0012`). With the sidebar hidden, such a request waits until the sidebar is shown and is carried
out once.

**"Open in Editor"** hands the file to the app the system assigns to it. It goes by the path relative to the Project root.

**The text of both.** One markdown renderer, with tables, task lists and strikethrough. Raw HTML is shown as text and never
runs. Images are not loaded: the alt text is shown. `https://` links open in the default browser, and a relative link opens a
file of the Project in the default editor. An absolute path opens the same way when it lies inside the Project, one of its
worktrees, the Workflow folder or the Tickets root; elsewhere it opens nothing. A link to a file that is not a document asks first: open it, show it in the file
manager or cancel. Any other link is text.

**Limits.** A file over 1 MiB is refused and read as absent: an ADR leaves the list, and a `HANDOFF.md` of that size hides the
Node. A file that cannot be read is left out the same way. A symbolic link counts only when it leads to HANDOFF or an ADR of
the same root.

**Silent mode: file links look in the Project root.** "Open in Editor" and the relative links of HANDOFF and of an ADR resolve
against the Project root, not against the Workflow folder. With a Workflow folder outside the root the file is usually not
there: nothing opens, and the error goes only to the console. If the repository has a file at that path, that file opens. A
Project over several repositories with the default Workflow folder is not affected, because there the two folders are one.

**When the folder goes away.** The documents read as gone: the Node hides and the ADR list empties. On macOS they come back
when a folder with that path is back. A folder above the root removed or renamed gives no event on macOS, and the documents
stay as they were read.

#### Windows

- A UNC or device path outside the root is refused by its text. A link on the way to a document that leads to a share is
  treated as outside the Project, and such a document is left out of the list. Asking about it would make Windows hand that host
  the user's credentials. A Project that is itself on a share reads its documents there.
- When the root is removed, the watch closes at the first event that names the root, and the root is looked for every 2 seconds.

#### On a Linked machine

The `docs.*` channels are `read`, so a Linked machine with read-only access sees the documents too. The watch runs on the
Project's Machine. "Open in Editor" and file links show `File is on <Machine>` instead of opening anything, and an `https://`
link opens on the Machine where it was clicked.

### How it works

- **Read-only by construction** ([ADR-0002](../adr/0002-worfy-is-a-view-over-the-workflow.md),
  [ADR-0005](../adr/0005-worfy-own-state-inventory.md)). `docs.read` hands out only these files: a path is resolved with its
  symbolic links, and must then be `HANDOFF.md` at the root or an ADR directly in `docs/adr` of the same root. The text of
  HANDOFF is never copied into the Layout.
- **One watch per Project.** One recursive `fs.watch` of the root is shared by everyone who opened the documents, and it stops
  when the last one leaves. Events for other paths are dropped by name before any read. A read runs 50 ms after the last event,
  and a state goes out only when something changed. The event stream starts a moment after the watch is made, so reads at 100,
  400 and 1000 ms pick up what changed in that moment.
- **A version per file.** The state carries a hash of each file, not its text. A view reads the text through `docs.read` when
  the hash changes and keeps the old text on screen until the new one is in.
- **main keeps the active Project's documents open itself,** so the HANDOFF Node follows the file with the sidebar hidden too. It
  does the same for a Project held by a screen of a Linked machine.
- **A hide has an owner.** The mark `missing` tells main's own hide from anyone else's, so main undoes only its own.

### Implementation

**Modules.**

- `src/main/docs/watch.ts`: `resolveDocPath`, `readDoc`, `parseAdr`, `readDocs`, then `DocsWatcher` for one root and `DocsHub`
  for one watcher per Project. `DOC_SIZE_MAX`, `SETTLE_READS_MS` and `ROOT_RETRY_MS` are the numbers above.
- `src/main/ipc/docs.ts`: the channels, `docsSource`, which picks the root by the mode, `syncHandoffNode`, and the documents kept
  for the active and the held Projects.
- `src/main/watch-gone.ts`, `src/main/remote-links.ts`: a root that is gone, and links that lead to a share.
- `src/shared/ipc/docs.ts`: the channels and the names and sizes of the files and the Node.
  `src/shared/workflow/doc-headings.ts`: the status label. `src/main/layout/place.ts`: the place of a new Node.
- `src/renderer/docs/useDocs.ts`: `useDocs`, one shared copy per Project, and `useDocText`.
- `src/renderer/canvas/nodes/HandoffNode.tsx`: the Node. `src/renderer/shell/sidebar/AdrSection.tsx`: the section and the panel.
- `src/renderer/markdown/Markdown.tsx`, `src/renderer/markdown/links.ts`: the renderer and what a link leads to.
- `src/main/ipc/shell.ts`: `shell.openInEditor`. `src/renderer/machines/useFileElsewhere.ts`: `File is on <Machine>`.
- `src/renderer/palette/commands.ts`: "Go to" an ADR. `src/renderer/find/search-index.ts`: Find in HANDOFF.

**Data flow.** The first user in the renderer calls `docs.open`. `docsSource` asks the layout for the root, and `DocsHub.open`
starts the watcher and answers with the state. Each change sends `docs.changed` to the subscribers and passes through
`syncHandoffNode`, which applies Layout operations. A view with a new version calls `docs.read`.

**Main tests.**

- `test/contract/docs.test.ts`: `docs.read` and its refusals, `docs.open`, the HANDOFF Node and its hides, a Silent Project, the
  status label, nothing written.
- `test/e2e/handoff.spec.ts`: the Node, an edit within a second, the ADR list and panel in the built app, and the repository
  untouched.
- `test/unit/adr-section.test.tsx`: palette requests, "Open in Editor", and the window on a Linked machine.
- `test/contract/docs-watch-root.test.ts`, `test/unit/docs-watch-root-gone.test.ts`: a root that is removed and comes back.
- `test/unit/docs-remote-links.test.ts`: the rules for shares, under Windows paths on any system.
