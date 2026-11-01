# update

Stand-ins for the Update build of worfy-update ticket 03 (`src/main/update/build.ts`), used by
`test/contract/update-build.test.ts`. They are Node scripts, so they run on macOS, Linux and Windows
alike; the test starts `pnpm.mjs` through a `pnpm` (`pnpm.cmd` on Windows) it puts on the PATH, and
hands `build-ok.mjs`, `build-fail.mjs` or `build-hang.mjs` to the builder in place of `pnpm package` (`WORFY_UPDATE_BUILD`).

| file | stands in for | does |
|---|---|---|
| `pnpm.mjs` | `pnpm install --frozen-lockfile` | appends a line to `node_modules/.installs` of the clone; puts the Electron of `electron.mjs` there when `node_modules/electron` is not there yet, unless `FAKE_PNPM_ELECTRON=none` |
| `electron.mjs` | — | `node_modules/electron` as a finished download leaves it: the program in `dist` (`Electron.app/Contents/MacOS/Electron`, `electron.exe`, `electron`) and `path.txt` naming it; the e2e specs `update-toasts` and `update-toolbar` commit it into their bare repository (types: `electron.d.mts`) |
| `electron-install.mjs` | `node_modules/electron/install.js` | the test puts an `install.js` into the clone that imports it; puts the Electron of `electron.mjs` there, puts nothing with `FAKE_ELECTRON_INSTALL=nothing`, exits 1 with `FAKE_ELECTRON_INSTALL=fail` |
| `build-ok.mjs` | `pnpm package` | makes `dist/mac-arm64/worfy.app` (`dist\win-unpacked` on Windows) with the commit's `marker.txt` |
| `build-fail.mjs` | `pnpm package` | prints `fake build failed: …` to stderr, exits 1 |
| `build-hang.mjs` | `pnpm package` | does not end by itself, until the test stops the build |
| `build-grandchild.mjs` | `pnpm package` with electron-builder under it | starts `hang.mjs` as a process of its own, then does not end by itself |
| `hang.mjs` | a git that hangs; the grandchild above | appends its pid to `FAKE_UPDATE_PIDS`, does not end by itself |
| `report.mjs` | — | what each one does first: the line of `FAKE_UPDATE_TRACE` and `tokens=<names>` of the `GH_TOKEN` and `GITHUB_TOKEN` variables, in any case of the letters, that reached it (`tokens=none`) |

| variable | meaning |
|---|---|
| `FAKE_UPDATE_TRACE` | a file each stand-in appends `<install|electron-install|build> <marker.txt of the commit>` to |
| `FAKE_PNPM_ELECTRON` | `none`: `pnpm.mjs` puts no `node_modules/electron` |
| `FAKE_ELECTRON_INSTALL` | `nothing` or `fail`: what `electron-install.mjs` does in place of the download |
| `FAKE_UPDATE_PIDS` | a file `hang.mjs` appends its pid to |
