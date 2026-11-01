# worfy

worfy is a desktop app for macOS and Windows that shows the work of Claude Code agents on a canvas. A Project, a git repository or a folder above several repositories, has exactly one Canvas. On it lie Epic frames with their Tickets, Sessions of Claude Code with their Subagents, Cards (small HTML apps that an agent built), Browsers and Terminals. The Harness, the Claude Code plugin that worfy installs, carries out the work by each Project's Profile, and Autopilot runs the Waves of an Epic without a person.

<a href="docs/features/concepts.md">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/map-of-worfy-dark.svg">
  <img src="docs/images/map-of-worfy-light.svg" width="976" alt="The Map of worfy. A Linked machine is linked to this Machine by a 6-digit code and, if access is on, opens the Canvas. This Machine hosts the Project and has one Harness. The Harness runs the Project by its Profile, guides the agents and includes the Gate. The Project has exactly one Canvas. On the Canvas, an Epic frame holds a Ticket and the Ready wave chip; a Session starts a Subagent, and both are bound to the Ticket; the Session may change a Card and arrives signed in to a Browser; a Terminal stands beside them. Autopilot runs the Wave without a person and waits for Limits to reset.">
</picture>
</a>

The Map of worfy, the first Topic of the in-app Guide. The terms are explained in [Concepts](docs/features/concepts.md). The picture is drawn by `node scripts/map-of-worfy-svg.mjs` from the Guide's own diagram.

## Who it is for

A developer who works with Claude Code on their own machines. Two Machines, a Mac and a PC for example, can be linked by a 6-digit code, and one can then open the Projects of the other when that one allows it ([Link](docs/features/link.md)).

## Status

- macOS, and Windows 10 21H2 or newer and Windows 11 on x64. Windows is supported; its final acceptance (`worfy-windows` ticket 16) is still open.
- There is no download: worfy is built from source, and the builds are not signed by a certificate.
- No license yet: all rights reserved.

## Requirements

- Claude Code, signed in. Sessions in worfy use the usage of that account, and its Limits apply.
- git, gh and jq; gh signed in to GitHub. On Windows, Git for Windows: Claude Code and the Harness use its Git Bash. jq is optional there.
- To build: Node.js 24, of that line 24.15 or newer, and pnpm of the version in `packageManager` of `package.json` (see [Development](#development)).

On its first start worfy checks Claude Code, the command-line tools, GitHub and the Harness itself, and offers a fix for what is missing.

## First run

```sh
git clone https://github.com/IDSAD-XL/worfy.git
cd worfy
pnpm install --frozen-lockfile
pnpm install:stable
```

`pnpm install:stable` builds the app and installs it as the Stable copy: `~/Applications/worfy-stable.app` on macOS, `%LOCALAPPDATA%\worfy-stable\worfy.exe` on Windows ([Stable copy](#stable-copy)). Start that copy.

On the first start the First run dialog lists what worfy and the Harness need and the state of each, and changes nothing until you confirm. Then the Getting started panel takes one Ticket of a Demo project, a small local repository with no GitHub, from the Orchestrator through review to merge. The agents really work there and use your Claude Code usage. Details: [Onboarding](docs/features/onboarding.md).

## Updating

In the Stable copy, "Update worfy" in the Version chip, in Settings → General or in the Command palette builds the head of `main` once its `ci-ok` check is green, in a clone of its own, and replaces the copy after worfy quits; the restart is your press. It keeps the copy it replaced as the previous one. A manual `pnpm install:stable` still works and keeps no previous copy. Details: [Updates](docs/features/updates.md).

## Learn worfy

- The Guide in the app: Help ▸ worfy Guide, or "worfy Guide" in the Command palette. Its first Topic is the Map of worfy above.
- [Feature documentation](docs/features/README.md): how each Feature behaves and how it is built. Russian translation: [docs/features/ru/](docs/features/ru/README.md).
- [CONTEXT.md](CONTEXT.md): the glossary, in Russian; the terms themselves are English.

## Development

```sh
pnpm dev            # the app from source, with data of its own (worfy-dev)
pnpm lint
pnpm typecheck
pnpm test           # unit and contract tests, under the Node of Electron
pnpm test:e2e       # builds the app, then Playwright against it
pnpm test:package   # packages the app and tests the packaged build
```

Node.js 24 is required, and of that line 24.15 or newer. `engines.node` of `package.json` is `>=24`, and `.nvmrc` and CI name 24; four dependencies in `pnpm-lock.yaml`, jsdom among them, accept nothing in that line below 24.15. `engineStrict` in `pnpm-workspace.yaml` holds pnpm to both: under a Node.js they do not accept, `pnpm install` stops before it installs anything, with `ERR_PNPM_UNSUPPORTED_ENGINE`. The tests always run under the Node of Electron, which is 24; the scripts (`pnpm install:stable`, `postinstall`) run under the Node.js of the system.

On macOS: Node.js 24 with nvm (`nvm install` in the repository reads `.nvmrc`) or the macOS installer of the newest 24.x from <https://nodejs.org/dist/latest-v24.x/>; pnpm with `corepack enable pnpm` or `npm install -g pnpm@<version>`.

A pull request needs a green `ci-ok` check to merge. CI runs lint, typecheck and the unit and contract tests on Linux, the tests, e2e tests and the packaged app on macOS, and the tests and e2e tests on Windows; a pull request runs the parts its diff needs, a push to `main` all of them ([Gate and GitHub](docs/features/gate-and-github.md)). How agents work in this repository: [Harness](docs/features/harness.md).

### Development on Windows

On Windows 10 21H2+ or 11, x64, install:

- Git for Windows (`winget install Git.Git`);
- Node.js 24, 24.15 or newer of that line: the Windows installer (`.msi`) of the newest 24.x from <https://nodejs.org/dist/latest-v24.x/>;
- pnpm of the version in `packageManager` of `package.json`: `npm install -g pnpm@<version>`. With nvm for Windows a global pnpm belongs to one version of Node.js: after `nvm use` of another version install pnpm again, or an older pnpm elsewhere on `PATH` answers and the project refuses it with `ERR_PNPM_BAD_PM_VERSION`.

Turn on Developer Mode (Settings → System → For developers): several tests create symbolic links, and without it Windows refuses them to a user without administrator rights.

Visual Studio Build Tools are not needed: on Windows `pnpm install` does not rebuild node-pty, Electron loads the prebuilt win32-x64 binary that ships with it (`scripts/postinstall.mjs`). The commands above run as on the Mac.

### Closing a Terminal on Windows

Closing a Terminal Node on Windows ends every process that is below the shell in the process tree at that moment, not only the shell. worfy first ends each process below the shell (`Stop-Process -Force`), then closes the pseudo-console, which ends the shell and what is on its console. That includes programs with a window of their own started from the Terminal, an editor for example: they are ended at once and get no request to close, so what was not saved in them is lost. worfy does not ask before it closes a Terminal. The tree is walked from the shell down through parents that are still running: a program whose parent has already exited, one started through a launcher or `cmd /c start` for example, is not found and stays, unless it is on the console of the shell.

The same happens when the Node leaves the Layout by any other route, when its Project is removed from worfy, when the last window or Linked machine that opened the Terminal goes away, and when worfy quits. A program worfy cannot end, an elevated one for example, stays, and its pid goes to the log. The step that ends the processes below the shell has a limit of 3 seconds, and 4.5 seconds for Git Bash, which first gets a hangup signal and 1.5 seconds to exit; when it fails or reaches its limit, the processes it had not ended stay. When no process has the pid of the shell any more, or the one that has it was created later than the shell worfy started, worfy ends nothing below it. In each of these cases the pseudo-console is still closed.

On macOS closing a Terminal sends SIGHUP to the shell and its process group, and SIGKILL a second later when the shell has not exited by then.

## Stable copy

Autopilot does not run on worfy's own repository from a development build, any checkout or worktree of it included: its agents would rebuild the app the run lives in. Run it from a packaged build, the Stable copy, which lies outside the repository.

`pnpm install:stable` (`scripts/install-stable.mjs`) installs or replaces the copy:

```sh
pnpm install:stable                      # macOS: ~/Applications/worfy-stable.app
pnpm install:stable /path/to/worfy.app   # any other path ending in .app
```

```powershell
pnpm install:stable                        # Windows: %LOCALAPPDATA%\worfy-stable, started by worfy.exe in it
pnpm install:stable D:\apps\worfy-stable   # any other folder
```

It builds the app (`pnpm package`), swaps it in and writes the commit and the build time next to the copy, in `worfy-stable.json`. It refuses with a non-zero exit code while the copy is running: stop Autopilot first, or wait for the gap between Waves. While it works it keeps `<target>.installing-<pid>` and `<target>.replaced-<pid>` next to the target, and the next run clears what an interrupted one left; keep nothing of your own under such names.

On Windows `pnpm package` also writes an unsigned installer, `dist\worfy Setup <version>.exe`, which installs worfy into `%LOCALAPPDATA%\Programs\worfy`; SmartScreen asks before its first run. The installer stops every running program whose path starts with that folder, so the command refuses a target inside it, around it or starting with its path (`…\Programs\worfy-stable`), a folder that holds `Uninstall worfy.exe`, and a folder that is neither empty nor an earlier copy. A folder with `worfy.exe` counts as an earlier copy and is replaced whole: keep nothing of your own in it.

The copy and `pnpm dev` keep separate data folders ([Storage and diagnostics](docs/features/storage-and-diagnostics.md)). While Autopilot runs, worfy keeps the display on, also while it waits for Limits to reset and, after Stop, for background tasks. For a run overnight on a Mac, leave the lid open and do not lock the screen by hand: with the lid closed the Mac sleeps, and on a locked screen Electron shows no window, so the agents of a Wave cannot run e2e tests.

`WORFY_PACKAGED_APP=~/Applications/worfy-stable.app pnpm exec playwright test --grep 'stable copy of the packaged app'` runs the packaged e2e tests against the installed copy, with temporary data folders.
