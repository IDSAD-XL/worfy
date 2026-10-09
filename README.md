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

Autopilot over worfy itself runs only on a stable copy of `worfy.app` outside the repository, never on a dev build: agents rebuild and test the dev build in their worktrees while Autopilot runs, and `pnpm package` replaces `dist/` on every build.

Install or update the copy:

```sh
pnpm install:stable                      # ~/Applications/worfy-stable.app
pnpm install:stable /path/to/worfy.app   # any other path ending in .app
```

The command builds the `.app` (`pnpm package`), replaces the previous copy and writes the commit and the build time next to it, in `~/Applications/worfy-stable.json` (nothing is written inside the `.app`: that would break its ad-hoc signature). It refuses with a non-zero exit code while the copy is running.

The copy and a dev run keep separate data: the packaged app uses `~/Library/Application Support/worfy`, `pnpm dev` and other unpacked runs use `~/Library/Application Support/worfy-dev`. Two processes over the same folder are not allowed: the second start quits and brings the running window to the front. The status line bridge (`scripts/statusline-bridge.sh`) writes Limits to both folders, whichever of them exist, so a dev run next to the copy sees the same Limits; with `WORFY_DATA_DIR` set it writes only there.

Update the copy in this order:

1. `main` is green: Gate full on the Mac (lint, typecheck, unit, e2e and the packaged app) and CI (lint, typecheck and unit tests on Linux).
2. Autopilot on the copy is stopped, or waits between Waves.
3. Run `pnpm install:stable`.
4. Start the copy.
5. Answer the macOS dialogs of the new copy (notifications and other permissions) before Autopilot starts. The ad-hoc signature changes with every build, so macOS may ask again.

For a run without a person (overnight): while Autopilot runs, worfy keeps the display on, from the start of the run to its end, including the wait for the Limits to reset (ADR-0034). Leave the lid open: with the lid closed the Mac sleeps and the run stands still. Do not lock the Mac by hand (Lock Screen, Ctrl-Cmd-Q, a hot corner): on a locked screen Electron shows no window, so the Wave's agents cannot run e2e or Gate full and wait for a person to unlock it.

`WORFY_PACKAGED_APP=~/Applications/worfy-stable.app pnpm exec playwright test --grep 'stable copy of the packaged app'` runs the packaged e2e tests against the installed copy, with temporary data folders; by default `pnpm test:package` installs the `dist/` build into a temporary folder with the same script and tests that copy.
