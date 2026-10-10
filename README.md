# worfy

Personal infinite canvas where Claude agents build small apps (cards) while you chat with them. macOS, single local user.

## Development on Windows

The Windows port is in progress (epic `worfy-windows`). To work on the repository on Windows 10 21H2+ or 11, x64, install:

- Git for Windows (`winget install Git.Git`): Claude Code and the Harness use its Git Bash;
- Node.js 22 or newer (`winget install OpenJS.NodeJS.LTS`);
- pnpm of the version in `packageManager` of `package.json`: `npm install -g pnpm@<version>`.

Turn on Developer Mode (Settings → System → For developers): several tests create symbolic links, and without it Windows refuses them to a user without administrator rights.

Visual Studio Build Tools are not needed: on Windows `pnpm install` does not rebuild node-pty, Electron loads the prebuilt win32-x64 binary that ships with it (`scripts/postinstall.mjs`). Then `pnpm install --frozen-lockfile`, `pnpm dev`, `pnpm lint`, `pnpm typecheck` and `pnpm test` run as on the Mac; the test suite is not green on Windows yet.

## Stable copy

Autopilot over worfy itself runs only on a stable copy of worfy outside the repository, never on a dev build: agents rebuild and test the dev build in their worktrees while Autopilot runs, and `pnpm package` replaces `dist/` on every build.

Install or update the copy (`scripts/install-stable.mjs`). On macOS it is a `.app`:

```sh
pnpm install:stable                      # ~/Applications/worfy-stable.app
pnpm install:stable /path/to/worfy.app   # any other path ending in .app
```

On Windows it is a folder with `worfy.exe` in it:

```powershell
pnpm install:stable                        # %LOCALAPPDATA%\Programs\worfy-stable
pnpm install:stable D:\apps\worfy-stable   # any other folder
```

The command builds the app (`pnpm package`), replaces the previous copy and writes the commit and the build time next to it: in `~/Applications/worfy-stable.json` on macOS (nothing is written inside the `.app`: that would break its ad-hoc signature), in `%LOCALAPPDATA%\Programs\worfy-stable.json` on Windows. It refuses with a non-zero exit code while the copy is running.

On Windows `pnpm package` writes the installer, `dist\worfy Setup <version>.exe`, and the unpacked app, `dist\win-unpacked`. The stable copy is a copy of the unpacked app, started by `worfy-stable\worfy.exe`; it has no shortcut in the Start menu. The installer is not signed, so SmartScreen asks before its first run (More info → Run anyway). It installs worfy for the current user into `%LOCALAPPDATA%\Programs\worfy`, and the stable copy cannot go into that folder: the command refuses it, and a folder that is neither empty nor an earlier copy.

The copy and a dev run keep separate data: the packaged app uses `~/Library/Application Support/worfy`, `pnpm dev` and other unpacked runs use `~/Library/Application Support/worfy-dev`. Two processes over the same folder are not allowed: the second start quits and brings the running window to the front. The status line bridge (`scripts/statusline-bridge.sh`) writes Limits to both folders, whichever of them exist, so a dev run next to the copy sees the same Limits; with `WORFY_DATA_DIR` set it writes only there.

Update the copy in this order:

1. `main` is green: Gate full on the Mac (lint, typecheck, unit, e2e and the packaged app) and CI (lint, typecheck and unit tests on Linux).
2. Autopilot on the copy is stopped, or waits between Waves.
3. Run `pnpm install:stable`.
4. Start the copy.
5. Answer the macOS dialogs of the new copy (notifications and other permissions) before Autopilot starts. The ad-hoc signature changes with every build, so macOS may ask again.

For a run without a person (overnight): while Autopilot runs, worfy keeps the display on, from the start of the run to its end, including the wait for the Limits to reset (ADR-0034). Leave the lid open: with the lid closed the Mac sleeps and the run stands still. Do not lock the Mac by hand (Lock Screen, Ctrl-Cmd-Q, a hot corner): on a locked screen Electron shows no window, so the Wave's agents cannot run e2e or Gate full and wait for a person to unlock it.

When a step that drives the copy over CDP (the Chrome DevTools Protocol, a start with `--remote-debugging-port`) gets no answer in time, save the stacks before ending the process: run `node scripts/hang-sample.mjs <pid>` with the pid of the copy's main process, the exact pid got at its start. It runs macOS `sample` for 3 seconds on the main process and on its child processes from the same `.app` (the renderer, where a CDP call runs, the GPU and utility helpers, `claude` of a Session), prints one `sampled: <pid> <kind> <file>` line per file, and writes the files to `~/Library/Application Support/worfy/logs/hang-<time>-<pid>.txt`. Attach them to the report as evidence, then end the process by that pid. The stacks are native, without JavaScript frames. If the file of the main process has `NSPersistentUIRestorer` and `NSAlert runModal`, macOS is asking whether to restore the windows and waits for an answer (`docs/lessons/agents.md`). The same folder holds `process-gone.jsonl`: one line with the time, the kind of process, the reason and the exit code for every renderer or helper process that ended.

`WORFY_PACKAGED_APP=~/Applications/worfy-stable.app pnpm exec playwright test --grep 'stable copy of the packaged app'` runs the packaged e2e tests against the installed copy, with temporary data folders; by default `pnpm test:package` installs the `dist/` build into a temporary folder with the same script and tests that copy.
