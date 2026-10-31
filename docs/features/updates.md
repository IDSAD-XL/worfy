# Updates

One Feature. **Update** replaces the Stable copy with a new build of `main`, together with its Harness. An **Available
update** is a commit of `main` that is newer than the Stable copy that runs, has a green CI and changes the app or the
Harness. Terms are explained in [Concepts](concepts.md).

## Update

### Behaviour

**Where Update is on.** Only in the Stable copy: the packaged app that runs from the place `pnpm install:stable`
installs to, `~/Applications/worfy-stable.app` on macOS and `%LOCALAPPDATA%\worfy-stable` on Windows. A development
build, the copy of the installer and a packaged build anywhere else neither check for an Update nor show anything of
it. So worfy never replaces a Stable copy other than the one that runs.

**The check.** Ten seconds after the start and then once an hour, worfy asks GitHub about the head of `main` of the
public repository `IDSAD-XL/worfy`, without sign-in. The head is an Available update when all of these hold:

- it is not the commit the copy runs;
- its `ci-ok` check from the push succeeded. Pending, failed or missing means no Available update until the next check;
- GitHub's comparison says it is ahead of the commit the copy runs. A copy built from a branch GitHub does not have gets
  no Update;
- the commits between the two change at least one path outside `docs/`, `.scratch/`, `test/`, `.github/` and the
  Markdown files of the repository root. A list of 300 files, where GitHub cuts it, counts as a change.

Texts name the new version as `<version of package.json on that commit>+<short SHA>`, the form of the app's build
version. Only the head of `main` is a candidate: there are no update channels and no Update to another commit. No
network, a refusal or a failure of GitHub, or a request over 15 seconds skips the check: one line goes to the log of the
main process. A scheduled check shows nothing on the screen; one that "Check now" ran shows its reason in Settings.
Without sign-in GitHub allows 60 requests an hour from one address, and a check spends one to four.

**Where it shows.**

| Place | What |
|---|---|
| Version chip | The app version on the second line of the toolbar's Harness item turns into a button with an accent dot. Its tooltip says "worfy <version> is available", "Building worfy <version>…", "worfy <version> is ready — restart to update" or "The update to <version> failed — see Settings → Health". Its menu: "Update worfy" (once built, "Restart now" or "Restart when idle"; during a build, an inactive "Building worfy <version>…"), "What's new", and "Later", which only closes the menu |
| Toasts | See the next table |
| Settings → General | The block of three rows "Updates", "Update automatically" and "Roll back to previous version" |
| Settings → Health | The row "worfy version" of the group "worfy": "<version>, up to date", "<version> available", "update failed" with "Show log", or "<tool> not found". Its failures do not open First run by themselves |
| Command palette | "Update worfy" in the group Action, with the detail "worfy <version> available", "ready — restart" or "check for a new version" |

The dot and the Health row stay until the Update is installed. The toasts:

| Text | Buttons | When |
|---|---|---|
| "New worfy <version> available" | Update, Later | An Available update while "Update automatically" is off |
| "worfy <version> ready" | Restart now or Restart when idle, Later | A build is ready. The first button changes in place when work starts or ends |
| "worfy restarts when no Session is working and Autopilot has stopped" | None | After the button "Restart when idle" of the toast "ready", when worfy starts to wait |
| "Update failed" | Show log | A build failed |
| "Harness out of date: <from> → <to>" | Update, Later | The installed Harness is behind this copy's |
| "worfy updated to <version>. The new Harness applies from the next Session." | None | The first start after a restart into an Update |
| "worfy is back to <version>. Automatic updates wait for the next commit on main." | None | The first start after a roll back |
| "worfy was not updated to <version>: <reason>", or "rolled back" in place of "updated" | None | The restart or the roll back did not happen, or the new copy does not run after it |
| "The Harness was not updated" | Open Health | The Harness of the new copy did not install |

"Later", or any other way of closing a toast, keeps it closed until the next start; the toast "available" comes once per
window load, whatever the commit. A new state (another build, a new failure, another Harness version) is offered again.
The result of a restart is told once, not at every start.

**Settings → General → Updates.** The row "Updates" says "worfy <version>. Last checked <time>.", "worfy <version> is
available.", "Building worfy <version>…" or "worfy <version> is ready.". Its buttons are "Check now" and "Update worfy",
or, for a built Update, "Restart now" or "Restart when idle". A check that "Check now" ran and that was skipped shows
its reason under the line. While "Restart when idle" waits, the row shows "worfy restarts when no Session is working and
Autopilot has stopped" under its line, and its button "Restart when idle" is inactive. The row "Update automatically"
holds the switch, and "Roll back to previous version" the button "Roll back" (see below). Where Update is off, the block
is not there.

**Update automatically.** The switch is on by default: "Build new versions of worfy in the background. worfy restarts
only when you say so." On, worfy builds an Available update by itself right after the check that found it. The toast
"available" does not come then: the chip shows the build, and the toast "ready" comes at its end. Off, nothing is built
until the user presses "Update worfy" in the chip menu, Settings or the Command palette, or "Update" in the toast. In
both cases a build never restarts worfy: the restart is always a press of its own.

**The build.** worfy builds in its own clone in its data folder (see [Storage and
diagnostics](storage-and-diagnostics.md)): `~/Library/Application Support/worfy/update/repo` on macOS,
`%APPDATA%\worfy\update\repo` on Windows. The clone is made once with `git clone` and fetched into after that. The build
is the one of `pnpm install:stable`: `pnpm install --frozen-lockfile`, then `pnpm package`. The user's checkout and the
folders of the Projects are never touched. The output goes to `build.log` next to the clone, a new one for each build.
One build runs at a time. With "Update automatically" on, a newer commit found during a build is built after it; with it
off, a newer commit waits for "Update worfy". Quitting worfy during a build stops it, and the commit counts as never
built, not as failed.

**A failed build** leaves the running Stable copy as it is. The chip's tooltip names the failure, the toast "Update
failed" offers "Show log", which opens `build.log` in the system's program for it, and the Health row says "update
failed" with the last line of the log. When git, node or pnpm is missing from the PATH, nothing runs: Settings says
"Updates need git, node and pnpm: <missing> not found. See Settings → Health.", and Health names the tool with the
command that installs it. A git step that runs longer than 30 minutes is stopped and fails the build. A full disk is a
failed build like any other, with its log: there is no check of free space before. worfy does not build a failed commit
again by itself: the next new commit of `main` is built as usual, and "Update worfy" builds the same one again.

**The restart.** A built Update is installed only by a press of "Restart now" or "Restart when idle", in the toast, the
chip menu, Settings or the Command palette. "Restart now" is offered while nothing works, "Restart when idle" while
something does. Nothing works when no Session is in a turn (busy or waiting for a permission), no Session has a
background task, and no Autopilot run is going, a stopped run that still waits for the background tasks of its
Orchestrator included. Terminals do not count: worfy closes their processes on quit anyway. "Restart when idle" restarts
by itself once all is quiet. A turn that starts meanwhile makes it wait longer, and quitting worfy drops it.

Then worfy quits, and a separate process does the swap. It waits for worfy to quit, two minutes at most, moves the copy
that ran aside as `worfy-stable.previous`, puts the build in its place and starts it. The press is the consent to the
Harness of the new copy too (see below). When the swap is refused, for example because a process of the old copy still
runs at its place after the wait, nothing is changed: the old copy starts again and shows "worfy was not updated to
<version>: <reason>". The restart needs the system's `node`; without it the press is refused with "node was not found: a
restart into an Update needs it (Settings → Health)".

**Harness after Update.** At the first start of the new copy, worfy installs that copy's Harness when the installed one
is outdated or missing, without a second dialog and only once. Claude Code takes it from the next Session on. A failure
shows "The Harness was not updated" with "Open Health", and the Harness item shows its error state with Retry. The
details are on the [Harness](harness.md#installing-from-the-app) page.

**Harness out of date.** A Harness behind this copy's is shown in three places. The toolbar button "Update Harness" gets
the accent and a dot, the toast "Harness out of date: <from> → <to>" offers "Update", and the Health row "Harness plugin"
fails with "<from> → <to>" and "Update it to the Harness of this build". An older semver is behind in any build, though
the toast comes only where Update is on. For the same semver from another commit, worfy asks GitHub, and only while
Update is on; no answer from GitHub means no signal and the plain "Replace Harness".

**Roll back.** Settings → General → Updates, row "Roll back to previous version", button "Roll back". The row names the
copy: "Return to worfy <version>. Automatic updates wait for the next commit on main." A native dialog asks first: "Roll
back to worfy <version>?", "worfy quits, puts the previous copy back and starts it. Its Harness is installed too.", with
"Roll back" and "Cancel". Like a restart, it is refused while something works, and the same process does the swap.

Only one previous copy is kept. The copy rolled back from is removed, so the row then says "No previous version is
kept." and its button is inactive until the next Update. After a roll back, the commit rolled back from stays quiet: no
dot on the chip, no toast, no failed Health row, and "Update automatically" does not build it. Settings says "worfy is
back to <version>. Automatic updates wait for the next commit on main." The next new commit of `main` is offered as
usual, and "Check now" offers the quiet one again.

**When the new copy does not start.** The button of the roll back lives in the copy that runs. A copy that fails before
its window opens is rolled back by hand, with worfy closed. Next to the Stable copy lie the previous copy and its file:
`worfy-stable.previous` and `worfy-stable.previous.json`. On macOS, in `~/Applications`:

```sh
mv worfy-stable.app worfy-stable.failed.app
mv worfy-stable.previous worfy-stable.app
mv worfy-stable.previous.json worfy-stable.json
```

On Windows, in `%LOCALAPPDATA%`, the same three renames: `worfy-stable` aside, `worfy-stable.previous` to
`worfy-stable`, `worfy-stable.previous.json` to `worfy-stable.json`. The file names the commit the copy runs, and worfy
compares that commit with `main`. The script of the clone does the same with checks:
`node ~/"Library/Application Support/worfy/update/repo/scripts/install-stable.mjs" --rollback` on macOS. When the new
copy failed before it read how its restart ended, the first start after a roll back by hand sees that another commit
runs than the one the restart installed. It shows "worfy was not updated to <version>: <old version> runs instead: the
new copy did not start, or was rolled back by hand", and the commit rolled back from stays quiet, as after "Roll back".
A new copy that failed later has read that already: then the commit is not quiet, and "Update automatically" builds it
again; turn the setting off until a newer commit is on `main`.

**What's new.** "What's new" in the chip menu opens a popover under the chip: "What's new in worfy <version>", a line
"<PR title> #<number>" for each PR merged between the copy that runs and the new version, newest first, and the chip's
first menu item as its button. The new version is the build that runs or is ready, else the Available update. The lines
come from one comparison on GitHub: the first line of each commit that ends with `(#<number>)`, as a squash merge writes
it. A commit pushed to `main` without a PR is not listed. A comparison lists 250 commits at most; with 250 the last line
is "…and more on GitHub", a link to the comparison page. The numbers and that link open in the system's browser. While
the list is read the popover says "Reading the pull requests on GitHub…", with no PR "No pull requests between this copy
and the new version.", and on a failure it shows the reason. There is no changelog file.

#### On Windows

- The Stable copy is the folder `%LOCALAPPDATA%\worfy-stable`, the previous copy `%LOCALAPPDATA%\worfy-stable.previous`,
  and the data of Update `%APPDATA%\worfy\update\`. The swap starts `worfy.exe` of the new copy.
- The restart needs `node.exe` on the Path. A `node.cmd` alone is refused: "the node found is no program worfy can
  start by itself (node.exe)".
- The clone checks out the bytes of `main` (`core.autocrlf` off), whatever Git for Windows asks for.

#### On a Linked machine

Update belongs to the Machine that runs it. Every channel of Update is closed to a Linked machine, and each Machine
updates its own Stable copy.

### How it works

- **The source is `main`, read without sign-in.** worfy uses the public GitHub API and never the user's `gh` token: no
  request carries an Authorization header, and `GH_TOKEN` and `GITHUB_TOKEN` are not read
  ([ADR-0089](../adr/0089-update-builds-main-in-own-clone.md), point 1).
- **The build happens on the Machine, in worfy's own clone.** That needs no signed builds, and a repeated build fetches
  only the changes. The price is git, node, pnpm and the disk space of a clone on the Machine. The user's checkout is
  never used: it may hold uncommitted work and other branches, and worfy writes nothing into repositories of Projects
  ([ADR-0005](../adr/0005-worfy-own-state-inventory.md)).
- **The trust boundary is a green `ci-ok` on `main` of worfy's repository.** Before every fetch the remote of the clone
  is set to the configured address again, and a commit is built only when it is an ancestor of `main` there. So an API
  that answers anything can name only a commit of the real `main`. The steps of the build run without `GH_TOKEN` and
  `GITHUB_TOKEN`.
- **The swap happens after worfy quits, by the system's node.** The files of a running app cannot be replaced, so the
  helper is `scripts/install-stable.mjs` of the clone, run by the system's `node` as a detached process. Its working
  folder is the folder of Update, not the Stable copy, which Windows would then refuse to move. As it comes from the
  clone, its fixes arrive with the Update itself. It writes its result to a file, and the next start reads it.
- **A restart is always the user's press.** A build takes minutes, and a restart in the middle of work would be a
  surprise. The press also stands for the consent to the new Harness, so there is no second dialog
  ([ADR-0089](../adr/0089-update-builds-main-in-own-clone.md), point 5).
- **One previous copy.** The swap keeps the copy it replaces as the previous one and removes the one kept before. A
  manual `pnpm install:stable` keeps none: it removes the copy it replaces, as before.
- **Not here: signed builds.** GitHub Releases, `electron-updater`, the Developer ID signature, Apple notarisation and
  the signature of the Windows installer stay in E4 of the [roadmap](../roadmap.md)
  ([ADR-0089](../adr/0089-update-builds-main-in-own-clone.md), point 8;
  [ADR-0019](../adr/0019-harness-claude-code-plugin.md)). On macOS a copy built by Update is signed ad hoc, as one of
  `pnpm install:stable` is.

### Implementation

| What | Where |
|---|---|
| The GitHub API without sign-in: head of `main`, `ci-ok`, comparison, version | `src/main/update/github.ts` |
| Whether the head is an Available update; the schedule of the checks | `src/main/update/check.ts` |
| Where the Stable copy lies, which commit it runs, whether Update is on | `src/main/update/stable-copy.ts` |
| The state file `update/state.json` | `src/main/update/state.ts` |
| "Update automatically": which Update gets built | `src/main/update/auto.ts` |
| The clone, the build, `build.log`, the missing tools | `src/main/update/build.ts` |
| Whether anything works | `src/main/update/idle.ts` |
| "Restart now", "Restart when idle", the roll back, the result of the last restart | `src/main/update/restart.ts` |
| The Harness at the first start after a restart | `src/main/update/harness-after-update.ts` |
| Harness out of date | `src/main/update/harness-lag.ts` |
| What's new | `src/main/update/whats-new.ts` |
| The swap, `--keep-previous`, `--rollback`, `--wait-pid`, `--relaunch`, `--result` | `scripts/install-stable.mjs` |
| The `update` channels and the service behind them; the native dialog of the roll back | `src/shared/ipc/update.ts`, `src/main/ipc/update.ts` |
| Start and quit in the app | `src/main/index.ts` |
| The setting `autoUpdate` in `app-settings.json` | `src/shared/settings/app-settings.ts` |
| The Health row "worfy version" and the Harness row | `src/main/first-run/checks.ts` |
| The snapshot in the renderer | `src/renderer/update/store.ts` |
| The version chip and What's new | `src/renderer/update/UpdateChip.tsx`, `src/renderer/update/WhatsNew.tsx` |
| The toasts | `src/renderer/update/toasts.ts` |
| Settings → General → Updates | `src/renderer/settings/UpdatesBlock.tsx` |
| "Update worfy" in the Command palette | `src/renderer/palette/commands.ts` |
| The accent of "Update Harness" | `src/renderer/shell/toolbar/HarnessStatus.tsx` |

The files of Update are in `<data folder>/update`: `state.json`, the clone `repo`, `build.log`, `restart.json` (what the
restart does and from which copy), `result.json` (what the helper wrote) and `restart.log` (what the helper printed).
Environment variables for tests: `WORFY_UPDATE=1` turns Update on in an unpacked build, `WORFY_UPDATE_API` replaces the
GitHub API address, `WORFY_UPDATE_REPO` the repository of the clone, `WORFY_UPDATE_BUILD` the build command, and
`WORFY_UPDATE_STABLE` the place of the Stable copy.

Tests: the GitHub stub `test/update-stub.ts`; `test/unit/update-check.test.ts`, `test/contract/update-github.test.ts`,
`test/contract/update-state.test.ts`, `test/contract/update-build.test.ts`, `test/unit/update-idle.test.ts`,
`test/contract/update-restart.test.ts`, `test/contract/update-harness.test.ts`, `test/unit/update-harness-lag.test.ts`,
`test/unit/update-whats-new.test.ts`, `test/unit/install-stable-update.test.ts`; the interface in
`test/unit/update-chip.test.tsx`, `test/unit/update-toasts.test.tsx`, `test/unit/updates-block.test.tsx`,
`test/unit/whats-new-view.test.tsx`, and the e2e tests `test/e2e/update-toolbar.spec.ts`,
`test/e2e/update-toasts.spec.ts` and `test/e2e/update-settings.spec.ts`.
