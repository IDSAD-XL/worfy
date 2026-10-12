# worfy

Personal infinite canvas where Claude agents build small apps (cards) while you chat with them. macOS, single local user.

## Development

Node.js 24 is required on both machines, the Mac and the Windows PC: `engines.node` of `package.json` is `>=24`, and `.nvmrc` and CI name 24. Under an older Node `pnpm install` stops before it installs anything, with `ERR_PNPM_UNSUPPORTED_ENGINE`, exit code 1, the version it expects and the one it got (`engineStrict` in `pnpm-workspace.yaml`). The tests always run under the Node of Electron, which is 24; the scripts (`pnpm icons`, `pnpm install:stable`, `postinstall`) run under the Node of the system: with an older one there, a script can behave differently from the test that covers it.

On macOS install:

- Node.js 24: with nvm, `nvm install` in the repository takes the version from `.nvmrc`; without nvm, the macOS installer (`.pkg`) of the newest 24.x from <https://nodejs.org/dist/latest-v24.x/>;
- pnpm of the version in `packageManager` of `package.json`: `corepack enable pnpm`, or `npm install -g pnpm@<version>`.

Then `pnpm install --frozen-lockfile`. `node --version` must print `v24.` and a version after it.

## Development on Windows

The Windows port is in progress (epic `worfy-windows`). To work on the repository on Windows 10 21H2+ or 11, x64, install:

- Git for Windows (`winget install Git.Git`): Claude Code and the Harness use its Git Bash;
- Node.js 24 (`winget install OpenJS.NodeJS.LTS --version 24.20.0`). Without `--version` winget installs the newest LTS line, and that is 24 only until the next line becomes LTS, planned for 2026-10-28; `winget show OpenJS.NodeJS.LTS --versions` lists the 24.x versions the package has. `node --version` must then print `v24.` and a version after it;
- pnpm of the version in `packageManager` of `package.json`: `npm install -g pnpm@<version>`.

Turn on Developer Mode (Settings → System → For developers): several tests create symbolic links, and without it Windows refuses them to a user without administrator rights.

Visual Studio Build Tools are not needed: on Windows `pnpm install` does not rebuild node-pty, Electron loads the prebuilt win32-x64 binary that ships with it (`scripts/postinstall.mjs`). Then `pnpm install --frozen-lockfile`, `pnpm dev`, `pnpm lint`, `pnpm typecheck` and `pnpm test` run as on the Mac; the test suite is not green on Windows yet.

### Closing a Terminal on Windows

Closing a Terminal Node on Windows ends every process started under its shell, not only the shell. worfy first ends each process below the shell in the process tree (`Stop-Process -Force`), then closes the pseudo-console, which ends the shell and what is on its console (`src/main/terminal/pty.ts`). That includes programs with a window of their own that were started from the Terminal, an editor or a browser for example: they are ended at once and get no request to close, so what was not saved in them is lost. worfy does not ask before it closes a Terminal either.

The same happens when the Node leaves the Layout by any other route, when its Project is removed from worfy, when the last window or Linked machine that opened the Terminal goes away, and when worfy quits. A program worfy cannot end, an elevated one for example, stays, and its pid goes to the log. When the step that ends the processes below the shell fails or takes longer than 3 seconds, only the shell and what is on its console end.

On macOS closing a Terminal sends SIGHUP to the shell and its process group, and SIGKILL a second later when the shell has not exited by then: the program in the foreground and the jobs of the shell are ended too.

## Stable copy

Autopilot over worfy itself runs only on a stable copy of worfy outside the repository, never on a dev build: agents rebuild and test the dev build in their worktrees while Autopilot runs, and `pnpm package` replaces `dist/` on every build.

Install or update the copy (`scripts/install-stable.mjs`). On macOS it is a `.app`:

```sh
pnpm install:stable                      # ~/Applications/worfy-stable.app
pnpm install:stable /path/to/worfy.app   # any other path ending in .app
```

On Windows it is a folder with `worfy.exe` in it:

```powershell
pnpm install:stable                        # %LOCALAPPDATA%\worfy-stable
pnpm install:stable D:\apps\worfy-stable   # any other folder
```

The command builds the app (`pnpm package`), replaces the previous copy and writes the commit and the build time next to it: in `~/Applications/worfy-stable.json` on macOS (nothing is written inside the `.app`: that would break its ad-hoc signature), in `%LOCALAPPDATA%\worfy-stable.json` on Windows. It refuses with a non-zero exit code while the copy is running. The previous copy is moved aside until the new one is in place; when the swap fails, it is put back.

While it works, the command keeps two folders next to the target: `<target>.installing-<pid>`, the copy being made, and `<target>.replaced-<pid>`, the previous copy moved aside. A run that was interrupted leaves them there. The next run that has a build to install removes the first and puts the second back when nothing is at the target. These two names are the command's own: keep no folder of such a name next to the copy.

On Windows `pnpm package` writes the installer, `dist\worfy Setup <version>.exe`, and the unpacked app, `dist\win-unpacked`. The stable copy is a copy of the unpacked app, started by `worfy-stable\worfy.exe`; it has no shortcut in the Start menu. The installer is not signed, so SmartScreen asks before its first run (More info → Run anyway). It installs worfy for the current user into `%LOCALAPPDATA%\Programs\worfy`.

The stable copy on Windows does not go under `Programs`. The installer stops every running program whose path starts with the path of its folder, so a copy in `…\Programs\worfy-stable` would be stopped by an install, an update or an uninstall of worfy. The command refuses:

- the installer's folder, a folder inside it or around it, and any path that starts with its path (`…\Programs\worfy-2`);
- a folder that holds `Uninstall worfy.exe`: the installer put that worfy there, wherever the folder is;
- a folder that is neither empty nor an earlier copy.

A folder that holds `worfy.exe` counts as an earlier copy and is replaced whole: every other file in it is removed with it. Keep nothing of your own in the folder of the copy.

The copy and a dev run keep separate data: the packaged app uses `~/Library/Application Support/worfy` (on Windows `%APPDATA%\worfy`), `pnpm dev` and other unpacked runs use `~/Library/Application Support/worfy-dev` (on Windows `%APPDATA%\worfy-dev`). Two processes over the same folder are not allowed: the second start quits and brings the running window to the front. The status line bridge (`scripts/statusline-bridge.sh`) writes Limits to both folders, whichever of them exist, so a dev run next to the copy sees the same Limits; with `WORFY_DATA_DIR` set it writes only there.

Update the copy in this order:

1. `main` is green: Gate full on the Mac (lint, typecheck, unit, e2e and the packaged app) and CI (lint, typecheck and unit tests on Linux).
2. Autopilot on the copy is stopped, or waits between Waves.
3. Run `pnpm install:stable`.
4. Start the copy.
5. Answer the macOS dialogs of the new copy (notifications and other permissions) before Autopilot starts. The ad-hoc signature changes with every build, so macOS may ask again.

For a run without a person (overnight): while Autopilot runs, worfy keeps the display on, from the start of the run to its end, including the wait for the Limits to reset (ADR-0034). Leave the lid open: with the lid closed the Mac sleeps and the run stands still. Do not lock the Mac by hand (Lock Screen, Ctrl-Cmd-Q, a hot corner): on a locked screen Electron shows no window, so the Wave's agents cannot run e2e or Gate full and wait for a person to unlock it.

When a step that drives the copy over CDP (the Chrome DevTools Protocol, a start with `--remote-debugging-port`) gets no answer in time, save the stacks before ending the process: run `node scripts/hang-sample.mjs <pid>` with the pid of the copy's main process, the exact pid got at its start. It runs macOS `sample` for 3 seconds on the main process and on its child processes from the same `.app` (the renderer, where a CDP call runs, the GPU and utility helpers, `claude` of a Session), prints one `sampled: <pid> <kind> <file>` line per file, and writes the files to `~/Library/Application Support/worfy/logs/hang-<time>-<pid>.txt`. Attach them to the report as evidence, then end the process by that pid. The stacks are native, without JavaScript frames. If the file of the main process has `NSPersistentUIRestorer` and `NSAlert runModal`, macOS is asking whether to restore the windows and waits for an answer (`docs/lessons/agents.md`). The same folder holds `process-gone.jsonl`: one line with the time, the kind of process, the reason and the exit code for every renderer or helper process that ended.

`WORFY_PACKAGED_APP=~/Applications/worfy-stable.app pnpm exec playwright test --grep 'stable copy of the packaged app'` runs the packaged e2e tests against the installed copy, with temporary data folders; by default `pnpm test:package` installs the `dist/` build into a temporary folder with the same script and tests that copy.
