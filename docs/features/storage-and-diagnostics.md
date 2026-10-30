# Storage and diagnostics

Two Features. The **data folder** is where worfy keeps its own state on a Machine. **Diagnostics** are what worfy
records and shows about itself when something goes wrong: the error window of a failed start, the record of a process
that ended, the stack of an uncaught exception, the stacks of a hung app, and the memory figure in the toolbar. Terms
are explained in [Concepts](concepts.md).

## Data folder

### Behaviour

worfy keeps its own state in one folder on the Machine: the list of Projects, the Settings, each Project's Layout,
Cards and trash, the sign-ins of Browser profiles, the Autopilot journals and the identity of the Machine. None of this
goes into a Project's repository. Tickets, HANDOFF, ADRs and transcripts are not here: worfy reads them where they are.

**Which folder.** A packaged build uses a folder named `worfy`, and a development build (`pnpm dev`, `electron .`) one
named `worfy-dev`. On macOS both are in Application Support of the user's Library. The variable `WORFY_DATA_DIR`
overrides the folder for either build. An empty value is ignored, and a relative one is resolved against the working
folder.

So a development build and the Stable copy can run at once and share no folder. Without the variable, all packaged
builds of one user share one folder, the Stable copy and a fresh build alike. All development builds share the other,
whichever worktree they start from.

**One process per folder.** A second start over a folder in use quits with exit code 0 and prints "another worfy already
runs over" and the folder on stderr. The running worfy restores its first window if it is minimized and focuses it. With
every window closed, it opens one. A second start made before the first process has created its first window changes
nothing on the screen.

**A folder that cannot be used stops the start.** When the path is a file, lies under a file, or is a folder worfy may
not write to, worfy shows the error window of a failed start (see [Diagnostics](#diagnostics)) and exits with code 1. A
folder that does not exist yet is fine.

**Each Project has its own subfolder.** Its name is the Project's id: the name of the Project's folder, a dash and the
first 8 hex characters of the SHA-256 of its path. So the id follows the path. The same path added again finds the same
data and keeps its settings. A repository moved to another path and added again is a new Project with default settings,
and the old subfolder stays where it was.

Removing a Project from the list keeps its subfolder and drops its saved camera. Only the removal of the Demo project
deletes a Project's subfolder. When the app starts, entries older than 3 days are deleted from the trash of each Project
in the list.

**A state file that cannot be read.** A JSON state file that does not parse or does not match its schema is not
overwritten. It is renamed next to itself as `<name>.unreadable-<time>`, with a warning on the console, and that part of
worfy starts empty. The user keeps the data to look at or restore by hand, and the app still starts. When Getting started
decides whether a user is new, a set-aside Project list counts as an existing user.

Three files are not set aside. A window position or a First run mark that cannot be read counts as missing, and the next
write replaces it. The file with the Limits of the status line is not worfy's to move: worfy only reads it.

A read that fails for another reason, such as a missing permission, throws and does not count as an empty state.

#### Windows

The two folders are `%APPDATA%\worfy` and `%APPDATA%\worfy-dev`. When `APPDATA` is missing or is not an absolute path,
they are in `AppData\Roaming` of the user's home folder.

#### On a Linked machine

A Machine is tied to its data folder, and its identity is kept there. Two data folders on one computer, such as a
development build and the Stable copy, are two Machines. The Layout of a Project stays on the Machine of the Project. A
screen on a Linked machine keeps the camera of that Canvas in its own folder, and the camera stays there while the
Project is not in this Machine's list.

### How it works

- **State apart from the workflow.** What the workflow already records, worfy reads and does not copy
  ([ADR-0005](../adr/0005-worfy-own-state-inventory.md)).
- **Two folders and a lock.** Separate folders let a development build run beside the Stable copy, and the lock stops
  two packaged builds from overwriting each other's files
  ([ADR-0023](../adr/0023-separate-data-roots-packaged-and-dev.md)). The lock is Electron's single-instance lock, which
  belongs to the `userData` folder. So worfy checks the folder first, sets `userData` to it and only then takes the lock.
  Otherwise a path that names a file would end as "another worfy already runs" with exit code 0.
- **Electron's files live there too.** Setting `userData` puts Electron's caches and local storage in the data folder,
  and the `persist:` partition of each Browser profile with them. A test run with a temporary `WORFY_DATA_DIR` leaves
  none of them in the real folder.
- **A write is all or nothing.** A write goes to a temporary file in the same folder, which is then renamed over the
  target. A crash leaves the old file or the new one. A value outside its schema throws before anything is written.
- **A read gives the parsed value.** Keys the schema does not declare are dropped, unless the schema is loose. The one of
  `getting-started.json` is, so an older build does not lose what a newer one wrote.
- **The calls are synchronous.** The files are small, a window position has to be saved inside a `close` handler, and two
  synchronous read-modify-write cycles cannot interleave in one process.
- **The Layout and the camera wait for a quiet moment.** They are written 250 ms after the last change, the Layout at
  most 1 second after the first unsaved one, and both at once when the app quits.
- **A removal does not follow a link.** A link at the path or anywhere below is removed as the link it is, and what it
  leads to is not touched. This holds as long as nobody else changes the tree meanwhile. The one exception is on macOS:
  a path given with a separator at its end is read as the folder behind the link, and no caller writes one.

#### macOS

`fs.rmSync` with `recursive` would remove the files of a volume mounted in the tree. So before it runs, worfy looks
through the whole tree, without following a link. A folder on another volume than the folder it lies in ends the removal
with the code `EXDEV`, and nothing is removed. A part of the tree that cannot be looked at ends it the same way, with its
own error. A mount point with the same `dev` as the folder it lies in is not seen.

#### Windows

Measured under the Node of Electron, `fs.rmSync` with `recursive` goes through a junction and empties the folder behind
it. So on Windows a tree is removed by a walk of worfy's own. It lists a folder only after one `rmdir` has answered that
the folder is not empty, and it does not list a folder it knows to be on another volume than the folder it lies in. An
entry that cannot be removed does not stop the walk: the others go, and the first error is thrown at the end.

Another process, such as an antivirus or the indexer, can hold a file for a moment. So a removal waits up to 5 times, 100
ms each, half a second at most for the whole removal. A move of a file or folder waits in the same steps when it meets
`EBUSY`, `EPERM` or `EACCES`. On macOS a move is one call.

### Implementation

| Module | What it does |
|---|---|
| `src/main/storage/paths.ts` | `dataRoot`, with the build kind that `setBuildKind` sets; also the Claude home and the Harness home. The one module of the app that knows where the data folder is. |
| `src/main/storage/json-file.ts` | The read with a schema and the set-aside; the atomic write. Most state files go through it. |
| `src/main/storage/remove.ts` | `removeTree` and `removeFile`. The comment at its top records the measurements behind each rule. |
| `src/main/storage/move.ts` | `moveWhenFree`, the move with its waits on Windows. |
| `src/main/startup-failure.ts` | `checkDataFolder`, which only reads. |
| `src/main/index.ts` | The order at the start: build kind, folder check, `userData`, lock, then the `second-instance` handler. |
| `src/main/projects/store.ts` | `projectId`, the Project list and `dataDir`, the subfolder of a Project. |

`test/unit/no-rmsync.test.ts` searches the text of `src/` and `scripts/` and allows `fs.rmSync` only in
`src/main/storage/remove.ts` and its copies. `rm` of `node:fs/promises` is not covered by that search:
`src/main/harness/install.ts` uses it.

Scripts that run without the app keep copies, and tests keep the copies in step:

- `scripts/statusline-bridge.mjs` writes the Limits of the status line into each default folder that exists, or only
  into `WORFY_DATA_DIR` when it is set (`test/contract/statusline-bridge.test.ts`).
- `scripts/hang-sample.mjs` knows the folder of a packaged build on macOS (`test/unit/hang-sample.test.ts`).
- `scripts/remove-tree.mjs`, `scripts/install-stable.mjs` and the restore script in
  `src/main/harness/migrate/restore.ts` copy the removal (`test/unit/remove-tree-copies.test.ts`,
  `test/unit/remove-tree-mounted.test.ts`).

#### The folder

On macOS the packaged build uses `~/Library/Application Support/worfy`, the development build
`~/Library/Application Support/worfy-dev`. What lies directly in the folder:

| Name | What it holds | Module |
|---|---|---|
| `projects.json` | The Project list and the active Project | `src/main/projects/store.ts` |
| `app-settings.json` | Settings of the Machine | `src/main/settings/store.ts` |
| `window-state.json` | The position and size of the window | `src/main/window.ts` |
| `viewports.json` | The camera of each Canvas, by Project id or `<machine id>/<project id>` | `src/main/layout/viewports.ts` |
| `limits.json` | The last known Limits | `src/main/agent/limits.ts` |
| `statusline-limits.json` | The Limits of the status line, written by the bridge script | `scripts/statusline-bridge.mjs` |
| `first-run.json` | When the First run screen was closed and which checks failed then | `src/main/ipc/first-run.ts` |
| `getting-started.json` | The state of Getting started and the record of the Demo project | `src/main/getting-started/state.ts` |
| `terminal-ai.json` | Terminal AI settings | `src/main/terminal-ai/settings.ts` |
| `terminal-ai` (folder) | The empty folder where Terminal AI requests and the Limits refresh run | `src/main/terminal-ai/options.ts` |
| `attachments` (folder) | `images/<sha256>.<ext>`, the copies of sent images, and `<id>/<name>`, copies of files attached outside every Project | `src/main/agent/attachments.ts` |
| `autopilot` (folder) | `<run>.jsonl`, the journal of each run | `src/main/autopilot/journal.ts` |
| `link` (folder) | `machine.json`, `linked.json`, `settings.json`, `secrets.json` and `link.log` | `src/main/link/` ([Link](link.md)) |
| `logs` (folder) | `process-gone.jsonl` and `hang-<time>-<pid>.txt` | See [Diagnostics](#diagnostics) |

`secrets.json` has its own read and write, also atomic and with the same set-aside, because its error messages must not
quote the file: it holds the private key and the outgoing tokens. Its mode is 0600, in a folder of mode 0700.

The subfolder of a Project:

| Name | What it holds | Module |
|---|---|---|
| `settings.json` | The action templates and, for Windows, the shell of the Terminals | `src/main/projects/settings.ts` |
| `layout.json` | The Layout | `src/main/layout/store.ts` |
| `bindings.json` | Manual Bindings | `src/main/layout/bindings.ts` |
| `session-settings.json` | Model, effort and permission mode by Session Node | `src/main/agent/session-settings.ts` |
| `hidden-subagents.json` | The Subagent entries the user hid, by Session | `src/main/claude-home/hidden-subagents.ts` |
| `browser-profiles.json` | The Browser profiles; their sign-ins are in the `persist:` partitions | `src/main/browser/profiles.ts` |
| `cards` (folder) | `<id>/`, the files of each Card | `src/main/cards/store.ts` |
| `card-data` (folder) | `<id>.json`, the data of each Card | `src/main/cards/data.ts` |
| `images` (folder) | `<id>.<ext>`, the images on the Canvas | `src/main/layout/images.ts` |
| `attachments` (folder) | `<id>/<name>`, copies of attached files from outside the Project | `src/main/agent/attachments.ts` |
| `trash` (folder) | `<label>/`, one folder per deleted Node | `src/main/layout/trash.ts` |

#### Tests

- `test/unit/paths.test.ts`: the folder by build kind and system, and the override.
- `test/unit/json-file.test.ts`: the set-aside and the atomic write.
- `test/unit/remove-tree.test.ts`, `test/unit/remove-tree-walk.test.ts`, `test/unit/remove-tree-mounted.test.ts` and
  `test/unit/move-when-free.test.ts`: the removal and the move, with links, busy files and mounted volumes.
- `test/contract/projects.test.ts`: the name of a Project's subfolder, which stays after a removal from the list.
- `test/contract/claude-home-isolation.test.ts`: a contract test file gets a data folder of its own.
- `test/contract/startup-failure.test.ts`: the check of the folder, before the lock.
- `test/e2e/packaged.spec.ts`: the real folders of a packaged and a development build, and a second start.

## Diagnostics

### Behaviour

| What happened | Where it shows |
|---|---|
| worfy could not start | An error window and stderr, then exit code 1 |
| A renderer or helper process ended | One line in a log file in the data folder |
| An uncaught exception in main | The stack on stderr, then Electron's error box |
| worfy stopped answering (macOS) | Thread stacks in files, from a script run by hand |
| How much memory worfy uses | A figure in the toolbar |

worfy has no general log file. Console output goes to the stdout and stderr of the process. Two Features keep files of
their own: the [Autopilot](autopilot.md) journal, and the `[link]` lines of [Link](link.md), which rotate at 1 MiB and
take 4 MiB at most.

#### A failed start

The window is titled "worfy could not start". It has four parts: the step that failed and what that step was doing, the
error, what to try, and the path of the data folder. The advice depends on the step:

| Step | What to try |
|---|---|
| The check of the data folder | Make the path a folder you can write to, or point `WORFY_DATA_DIR` at one |
| Loading the window from the dev server | Make sure the dev server is running |
| Loading the window from the app bundle | The bundle may be incomplete: install or rebuild |
| Any other step | This looks like a bug in the build: install or rebuild, and report the error if it stays |

The same text goes to stderr, followed by the stack of the error. worfy then exits with code 1. Only the first failure
opens a window, and a later one goes to stderr only. `WORFY_STARTUP_DIALOG=off` skips the window, since an e2e test cannot
dismiss a native window.

The steps are the data folder check, the record of ended processes, the menu, the IPC handlers, the web policy, the Card
runtime, the image protocol, the Orchestrators, the notifications, the first window and the load of its page. An error
outside a named step that reaches the start still opens the window, which then says "An unexpected step of the start
failed."

Some parts of the start catch their own failures, and worfy runs without them: the link with other Machines, the
automatic archive, Getting started, the refresh of the Limits and the Dock icon of a development build. Their failure is
a line on the console.

A page that fails to load in a window opened later, from the Dock icon or by a second start, is only logged. A first
window closed while loading, or a load replaced by a newer navigation, is not a failure.

#### A process that ended

When a renderer process or a helper process (GPU, utility) ends, worfy appends one JSON line to `process-gone.jsonl` in
the `logs` folder of the data folder:

```json
{"time":"2026-10-10T12:00:00.000Z","process":"renderer","reason":"crashed","exitCode":11}
{"time":"2026-10-10T12:00:05.000Z","process":"Utility","reason":"oom","exitCode":-1,"service":"network.mojom.NetworkService"}
```

The line holds the time, the kind of process, the reason, the exit code and, when Electron names one, the service. It
holds no URL, no path and nothing of a Session. In a text value, each character other than a letter, a digit, a space,
`.`, `_` or `-` becomes `?`, and the value is cut to 80 characters. A value that is not text is `unknown`, and an exit
code that is not a whole number is `null`.

This is only a record: worfy shows nothing and does not reopen the window. The file appears with the first event and is
not trimmed. A line that cannot be written goes to `console.error`.

#### An uncaught exception

An uncaught exception in main writes `[worfy] uncaught exception in main (<origin>): <stack>` to stderr. Electron's own
error box then appears as usual and blocks the main thread until someone clicks it.

#### Stacks of a hung app (macOS)

A script saves the thread stacks of a packaged worfy that stopped answering, without stopping it. Its arguments are the
pid of the main process and, optionally, the seconds to sample: 1 to 60, by default 3. The stacks are native, with no
JavaScript frames. They tell a wait for I/O or for a system window from a busy loop.

It samples the main process and those of its direct children whose real path is inside the same `.app`, all at once. It
prints one line per process:

```text
sampled: <pid> <kind> <file>
skipped: <pid> <path>
failed: <pid> <kind>: <why>
```

`kind` is `main`, the `--type=` of a helper, such as `renderer`, or the name of the executable. A child outside the
`.app`, such as a Terminal's shell, is skipped, and a child that already ended is `skipped: <pid> (ended)`. `failed` goes
to stderr. The arguments of a process can hold a token, so they are read only for `--type=` and never printed.

The exit code is 0 when each `sample` returned 0, otherwise the first non-zero code of a `sample`, and 1 when `sample`
could not run or the folder could not be created. Code 2, with no file written, means wrong arguments, a system other
than macOS, or a pid that is not the main process of a packaged worfy, such as a helper, a shell or a development build.

The files are `hang-<time>-<pid>.txt` in the `logs` folder of the packaged build's data folder. The script reads
`WORFY_DATA_DIR` from its own environment and not from the process it samples.

#### The memory figure

The toolbar shows how much memory worfy's own processes use, on the second line of the Harness column, after the app
version. It reads "412 MB" below 1024 MB, "1.3 GB" from there, and "…" until the first sample. Its tooltip gives the
split:

```text
Memory used by worfy's own processes (not counting terminal sessions)
Main 180 MB · Windows 200 MB · GPU 20 MB · Other 12 MB
```

The figure is the sum of the working sets of Electron's processes, and a new sample comes every 5 seconds. A failed read
keeps the last value, with one warning until a read succeeds.

"Memory in the toolbar" in Settings → General turns it off, in every open window at once and without a reload. It is on
by default, also with a settings file written before the setting existed. While it is off, nothing is sampled.

#### Windows

The script for a hung app refuses with code 2, since it runs the `sample` program of macOS. The code of the other
diagnostics on this page has no branch by system, and their files go to the data folder of Windows.

#### On a Linked machine

The memory figure is always that of the screen's own Machine: its channels are `local`, and a Linked machine never
reaches them. Each Machine writes its own `process-gone.jsonl` and `link.log`, and no IPC channel reads them.

### How it works

- **Only what cannot leak goes to the record.** The line of an ended process is built field by field, so nothing Electron
  adds later can reach the file. The URL of a window stays out because in a packaged app it is a path under the user's
  home folder.
- **A monitor, not a handler.** Electron shows its box only while its own `uncaughtException` listener is the only one.
  So worfy listens to `uncaughtExceptionMonitor`, which changes nothing about what the app does next. It writes to file
  descriptor 2 synchronously, because output still queued in a pipe would never leave a process blocked by that box.
- **A failed start uses `app.exit(1)`.** `app.quit()` has no exit code, and its `before-quit` and `will-quit` handlers
  were written for an app that started. Before `ready` the exit is immediate. After `ready` it comes on a later turn of
  the event loop, because on Windows an exit from a callback of `ready` left a network utility process running.
- **Each step runs in `inStep`.** A throw or a rejection comes out as a `StartupError` that names the step, and a nested
  step keeps its own name.
- **The sampler runs only when someone looks.** The timer exists only while the setting is on and at least one window
  has the figure open. A window that opens the figure on a stopped sampler gets a sample at once. Each window's opens are
  counted. They are dropped when the window is destroyed or a new document commits in its main frame, because a page that
  reloads sends no close.

### Implementation

| Module | What it does |
|---|---|
| `src/main/startup-failure.ts` | The steps with their advice, `inStep`, `reportStartupFailure` and the text of the window. |
| `src/main/index.ts` | The order of the start and which parts are steps. |
| `src/main/window.ts` | Reports a failed page load of the first window as step `loadURL` or `loadFile`. |
| `src/main/diagnostics/process-gone.ts` | `installProcessGone` subscribes to `render-process-gone` and `child-process-gone`, as the first step after `ready`. |
| `src/main/diagnostics/uncaught-stderr.ts` | `reportUncaughtToStderr`, the first statement of `src/main/index.ts` after its imports. |
| `src/main/diagnostics/memory.ts` | `MemorySampler` over `app.getAppMetrics()`, following the `memoryIndicator` setting. |
| `src/shared/memory.ts` | The sum by process kind, the format and the tooltip. Pure. |
| `src/shared/ipc/memory.ts`, `src/main/ipc/memory.ts` | The channels `memory.open`, `memory.close` and `memory.changed`, and the count of opens per window. |
| `src/renderer/memory/AppMemory.tsx`, `src/renderer/memory/useAppMemory.ts` | The figure and its subscription. |
| `scripts/hang-sample.mjs` | The stacks: `node scripts/hang-sample.mjs <pid> [seconds]`. |

The kinds in the memory split come from Electron's process types: `Browser` is Main, `Tab` is Windows, `GPU` is GPU, and
every other type is Other.

#### e2e tests

This part is not in the app. When the first window of a start in an e2e test is not shown,
`test/e2e/start-diagnostics-run.ts` asks the app for the state of its window, the page's `readyState` and a capture of
the page. It keeps the last 256 KB of the app's output, copies the files of the `logs` folder and attaches all of it to
the test. Each step that asks the app gets at most 3 seconds. The pure parts are in `test/e2e/start-diagnosis.ts`.

#### Tests

- `test/contract/startup-failure.test.ts`: the window, the advice, the exit code and the steps, over a mocked Electron.
- `test/unit/process-gone.test.ts`: the record, what stays out of it, and that the start subscribes before the first
  window.
- `test/unit/uncaught-stderr.test.ts`: the text, and that only the monitor event is used.
- `test/unit/hang-sample.test.ts`: which processes are sampled, the exit codes and the folder, with `ps`, `pgrep` and
  `sample` faked.
- `test/unit/memory.test.ts`, `test/unit/app-memory.test.tsx`: the sum, the format and the figure.
- `test/contract/memory.test.ts`, `test/contract/memory-app.test.ts`: the sampler, the channels and the setting.
- `test/e2e/memory.spec.ts`: the figure and the switch in Settings, in real windows.
