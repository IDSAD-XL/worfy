# Notifications

worfy tells the user things in two ways. A **system notification** is a banner of the operating system for when worfy is not
in front. A **toast** is a short message inside a window. This Feature is part of the [App shell](app-shell.md) and has a page
of its own because of its length. Terms are explained in [Concepts](concepts.md).

## Behaviour

### System notifications

| Event | Title | Text | A click opens |
|---|---|---|---|
| A Session worfy runs finished its turn | Its folder name | What it said, else "Finished its turn" | The Session |
| It waits for a permission answer | Its folder name | "Needs permission: `<tool>` `<input>`" | The Session |
| It asks a question | Its folder name | "Asks: `<first question>`" | The Session |
| A Session of a terminal or Claude Desktop went from busy to idle | Its name, else its folder name | "Finished its turn" | The Session |
| A Ticket came to wait for the owner or this Machine | `<epic> NN` is waiting for you | Its Blocked reason, else `<epic> NN — <title>` | The Pipeline board of its Project |
| A PR with the cross-machine gate's label waited over an hour | The Project's name | The PR and what to do next | Nothing: it raises the window |
| Too many pairing attempts failed within an hour | Link a machine is paused | How many, from which addresses, until when | Nothing: it raises the window |

A turn the user interrupted gives no notification. The text of a Session's note is cut to 160 characters. For Bash the input is
the command, and for another tool it is the input as JSON. A Session whose folder is not known yet is titled "Session".

The rules:

- **Nothing shows while a worfy window has focus.** The pairing pause is the exception: it is a warning about the network and
  shows whatever has focus.
- **One Session shows at most one notification in 10 seconds.** A note held back by focus does not count. A Ticket's note is
  counted the same way, by Project and Ticket.
- **A Ticket's wait notifies once**, and only for a wait worfy saw begin: what already waited at the first read of a Project
  gives nothing. `team` and `agent` waits give nothing. A new wait of the same Ticket notifies again.
- **A PR of the gate queue notifies once per last commit.** A new commit, a report or a merge ends that wait. The queue's read
  is looked at every minute, and while a window has focus the PR waits for the next read.
- **A Session from a terminal or Claude Desktop** is seen through the registry watchers, which run while a window or a connected
  Linked machine has its Project open. The first sight of a Session is not a change.
- worfy has no switch for notifications. The system's own Focus mode applies to them as to any app.

A click raises the window and restores it if minimized. On macOS worfy lives on without windows, and then a click opens a new
one. The note waits for its window's page for up to 30 seconds, and after that a reload opens nothing.

### Toasts

Toasts stand at the right edge of a window, above everything else in it, the Settings window included. Each has a Dismiss
button.

| Kind | Stays | Buttons |
|---|---|---|
| `info`, `success` | 4 seconds | none |
| `error` | until closed | none |
| `action` | until closed | 1 to 3; a press runs the action and closes the toast |

- At most 3 toasts are on screen. A new one pushes out the oldest self-hiding toast. When all on screen stay until closed, the
  new one waits in a queue, and its time starts when it comes out.
- A toast with a key replaces the one with the same key, in place, and its time starts again.
- A toast of a Project shows only while that Project is active. An example is "Archived N finished sessions" with Undo.
- The pointer or the keyboard focus on a toast stops its time. When both have left, the time starts again in full.
- A toast never takes the focus. Tab reaches its buttons, and Esc on a toast in focus closes it and gives the focus back.
- The stack moves out of the way. It goes into the first free band from the top of its column, clear of the toolbar, a view's
  header, the header of an Epic frame on the Canvas (its Run wave, Autopilot and Stop buttons), the minimap, an open dialog or menu, by a margin of 12 pixels. The place is measured again every 200 ms while a toast
  is shown. When no band holds the stack whole, it is cut to the tallest band of at least 40 pixels and scrolls. When no such band
  exists, it stays under the toolbar and covers the popup, so an error is still seen.
- The area is a landmark "Notifications". `error` toasts are announced as alerts, the others politely.

### Windows

- "Has focus" is checked against the system. Electron can call a window focused that Windows never let to the front, so when
  Electron says yes, worfy asks Windows which process owns the foreground window. The check is one call of Windows PowerShell and
  runs only when a notification is about to be decided. When it fails or takes more than 2 seconds, Electron's answer stands, and
  the first such failure goes to the log.
- The packaged app shows notifications under the AppUserModelId `dev.worfy.app`, set before the first window. A dev run uses the
  path of its `electron.exe` as the id.

### On a Linked machine

The Machine of a Project decides what to notify about and hands each note to two places: its own display and the Linked machines
([ADR-0053](../adr/0053-several-screens-on-one-project.md)). Its own focus does not hold a note back from them.

- A note goes to a Linked machine that is connected now and has access: "Linked machines can work with my Projects" on, and its
  own level `read` or `all`. Read-only access gets the notes. A Machine that is not connected misses the note, and nothing is
  kept for it.
- Every Machine shows a note by its own rules: the focus of its own window, its own 10 seconds, its own system's Focus mode.
- A click acts on the Machine where it was made: that Machine's window rises and opens the Session among the Projects of the other
  Machine.
- A Ticket waiting for `owner` reaches this Machine and every Linked machine that has access and accepts the message. A wait for a
  Machine's name reaches only that Machine, by the whole name as Settings → Machines shows it. The Machine of the Project decides.
- A Linked machine drops a Ticket's note when its own list has a Project of the same repository, because it notified of it
  itself. It shows the others with the sender's name in the title, and a click opens the Pipeline board of that Project on that
  Machine, read-only.
- The pairing pause and the notes of the gate queue stay on their own Machine.
- Toasts belong to their window and do not travel.

## How it works

- **Rules live apart from Electron.** `Notifier` and `NoteDisplay` take their Electron parts as dependencies, so tests pass their
  own. macOS takes the name and the icon of a notification from the bundle of the process, so a notification sets no icon of its
  own.
- **Waits are read from the Ticket files.** The Ticket notes follow the workflow model, which the workflow hub keeps by watching
  files, and not the Stage hub, which runs `bin/profile`, git and gh every minute. One wait has one key: its Status time when that
  has a time of day, else its Status word and Blocked reason.
- **A click does not depend on the page being ready.** The note always waits in main, and `notify.open` only tells a mounted
  overlay to take it now. An overlay that mounts later takes it then.
- **Tickets travel as their own message** that only a Machine naming it in `accepts` gets
  ([ADR-0079](../adr/0079-link-machines-announce-accepted-messages.md)). It names the Project by id, name and match key and never
  by a local path, and the wait goes as a hash. A Machine reads a Project's match key with git at most once a minute, and it
  remembers the last 10,000 waits it received, to show each once. A note is sooner shown twice than lost: a Project whose key
  cannot be read matches nothing.
- **The gate queue's notes** follow the roles of [ADR-0069](../adr/0069-cross-machine-gate-label-and-roles.md): the text says
  "Run Process gate queue" on the serving Machine and "No machine has taken it yet" on the requesting one.
- **e2e runs show no banner.** Quiet windows never have the focus, so every finished turn of a test would show one. The note is
  still decided on and still goes to the Linked machines.
- **Toasts are one store per renderer.** Any code of the renderer calls `showToast`, and one component draws them.

## Implementation

| What | Where |
|---|---|
| The rules, the display, the Tickets' and the gate queue's notes, the click | `src/main/notify.ts` |
| The note that waits for its page | `src/main/notify-pending.ts`, `src/main/ipc/notify.ts`, `src/shared/ipc/notify.ts` |
| Installing it at the start of the app | `src/main/index.ts` |
| A wait of a Ticket, and its key | `src/main/workflow/waits-notify.ts` |
| The foreground check of Windows | `src/main/foreground.ts` |
| The AppUserModelId | `src/main/app-id.ts` |
| Quiet windows | `src/main/quiet-windows.ts` |
| The messages between Machines | `src/main/link/notes.ts` |
| Opening what a click names, in the page | `src/renderer/canvas/overlays/NotificationTarget.tsx`, `src/renderer/session/notification-target.ts` |
| The store of toasts | `src/renderer/toast/toasts.ts` |
| Drawing them, and finding the free band | `src/renderer/toast/ToastRegion.tsx`, `src/renderer/toast/placement.ts`, `src/renderer/toast/toast.css` |

Main tests: `test/unit/notify.test.ts`, `test/unit/link-notify.test.ts`, `test/unit/foreground.test.ts`,
`test/unit/e2e-notifications.test.ts`, `test/contract/app-user-model-id.test.ts`, `test/e2e/linked-notify.spec.ts`,
`test/unit/toasts.test.ts`, `test/unit/toasts-view.test.tsx`, `test/unit/toast-placement.test.ts`,
`test/e2e/toast-placement.spec.ts`.
