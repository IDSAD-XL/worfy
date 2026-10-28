#!/usr/bin/env node
// Which machine gives the Windows verdict of a platform pull request (ADR-0071 and ADR-0083,
// worfy-windows ticket 66):
//
//   node scripts/windows-verdict-scope.mjs <base> <head>
//
// The files of the pull request are `git diff --name-only --no-renames <base>...<head>`: what the
// head changed since it left the base. --no-renames lists a renamed file under both names, so a file
// moved out of a listed path still counts. When at least one file matches a path of PC_ONLY, the
// script prints `pc` and then each matching file on a line of its own, and the exit code is 1: the
// verdict is gate full on the owner's Windows PC (ADR-0056). When none matches, it prints `runner`
// and the exit code is 0: the verdict is the green job `windows / full-suite` of the pull request's
// own CI run on the head (part of the check `ci-ok`), also for a pull request that changes the CI
// workflows themselves — that run already runs with the changed workflow. An empty diff is `runner`.
// Any other exit code — 2: wrong arguments, or git could not compute the diff — is no verdict.
//
// The rule is for platform pull requests only. Which pull request is a platform one is decided as
// before (ADR-0056, point 2); an ordinary one gets its Windows verdict from `ci-ok` alone, whatever
// this prints.
//
// Run it from a checkout of main, not of the pull request: the pull request must not decide its own
// verdict by changing this list. The arguments are commits or refs of the repository in the working
// directory. Only Node's own modules are used.

import { spawnSync } from 'node:child_process'
import process from 'node:process'

// What the runner cannot check: a real Terminal (ConPTY, PowerShell, node-pty), windows, menus and
// notifications, e2e and the packaged app — and the one file that tells the run to skip tests the PC
// still runs.
// `**` is any number of folders (none too), `*` any characters but `/`; a pattern matches the whole
// path from the repository root. An error toward `pc` costs one more gate full on the PC; an error
// toward `runner` lets a regression through to the next gate full there.
const PC_ONLY = [
  // Terminal
  'src/main/terminal/**',
  'src/main/terminal-ai/**',
  'src/main/ipc/terminal*.ts',
  'src/main/ipc/shell.ts',
  'src/shared/ipc/terminal*.ts',
  'src/shared/terminal/**',
  'src/renderer/canvas/nodes/Terminal*',
  'src/renderer/canvas/nodes/terminal-*',
  'src/renderer/canvas/ReadOnlyTerminal.tsx',
  'test/**/terminal*',
  // Windows, menus, notifications
  'src/main/window.ts',
  'src/main/window-frame.ts',
  'src/main/window-show.ts',
  'src/shared/window/**',
  'src/main/quiet-windows.ts',
  'src/main/broadcast.ts',
  'src/main/settings/interface-scale.ts',
  'src/main/menu.ts',
  'src/main/ipc/menu.ts',
  'src/shared/ipc/menu.ts',
  'src/main/notify.ts',
  'src/main/notify-pending.ts',
  'src/main/ipc/notify.ts',
  'src/shared/ipc/notify.ts',
  'src/main/dock-icon.ts',
  // src/main/index.ts, which wires every module of the main process, is left out on purpose: almost
  // every pull request with main-process code touches it, and its own Windows behaviour lives in the
  // modules above.
  // The Browser layer: web pages in windows of the app, counted as window code (ADR-0071)
  'src/main/browser/**',
  'src/main/ipc/browser.ts',
  'src/renderer/browser/**',
  'src/shared/browser/**',
  // Its files outside those folders, by exact path: a name pattern would also catch
  // src/renderer/projects/FolderBrowser.tsx and the Browser section of the settings.
  'src/renderer/canvas/overlays/BrowserLayer.tsx',
  'src/renderer/canvas/overlays/browser-pages.ts',
  'src/renderer/canvas/nodes/BrowserNode.tsx',
  'src/renderer/canvas/nodes/BrowserNode.css',
  'src/renderer/canvas/nodes/browser-frame.ts',
  'src/shared/ipc/browser.ts',
  'src/main/mcp/browser-server.ts',
  // e2e and acceptance
  'test/e2e/**',
  'test/acceptance/**',
  'playwright.config.ts',
  'playwright.acceptance.config.ts',
  // Packaging and install
  'electron-builder.yml',
  'build/**',
  'electron.vite.config.ts',
  'scripts/build-version.ts',
  'scripts/dev-bundle.ts',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'scripts/install-stable.mjs',
  'scripts/make-icons.mjs',
  'scripts/ico.mjs',
  'scripts/postinstall.mjs',
  // The skip list of the runner alone: tests it names are skipped on the GitHub Windows runner and
  // run on the PC, so a pull request that widens it hides those tests from its own run.
  'test/windows-runner.ts',
  // Not listed, because the pull request's own CI run judges them: the workflows (the run already
  // uses the changed workflow, ADR-0083), this script (run from a checkout of main, so a pull request
  // never decides its own verdict; its tests run on the runner) and the vitest setup —
  // scripts/vitest-electron.mjs, vitest.config.ts, test/setup-contract.ts, test/setup-dom.ts — which
  // the runner and the PC run alike.
]

const escape = (text) => text.replace(/[.+^${}()|[\]\\?]/g, '\\$&')

/** A pattern of PC_ONLY as a regular expression over the whole path. */
function patternToRegExp(pattern) {
  const source = pattern
    .split('**/')
    .map((part) =>
      part
        .split('**')
        .map((piece) => piece.split('*').map(escape).join('[^/]*'))
        .join('.*'),
    )
    .join('(?:.*/)?')
  return new RegExp(`^${source}$`)
}

const MATCHERS = PC_ONLY.map(patternToRegExp)

/** The files of `paths` that match a pattern of PC_ONLY, in the order given, each once. */
function pcOnly(paths) {
  return [...new Set(paths)].filter((path) => MATCHERS.some((matcher) => matcher.test(path)))
}

function main(args) {
  if (args.length !== 2 || args.some((arg) => arg === '' || arg.startsWith('-'))) {
    process.stderr.write('usage: node scripts/windows-verdict-scope.mjs <base> <head>\n')
    return 2
  }
  const [base, head] = args
  // -z: one path per NUL, never quoted; quotepath has no effect then, and a name with a space or a
  // non-ASCII letter comes through as it is.
  const diff = spawnSync('git', ['diff', '--name-only', '--no-renames', '-z', `${base}...${head}`, '--'], { encoding: 'utf8' })
  if (diff.error || diff.status !== 0) {
    process.stderr.write(`windows-verdict-scope: git diff ${base}...${head} failed: ${diff.error?.message ?? diff.stderr.trim()}\n`)
    return 2
  }
  const matched = pcOnly(diff.stdout.split('\0').filter((path) => path !== ''))
  if (matched.length === 0) {
    process.stdout.write('runner\n')
    return 0
  }
  process.stdout.write(`pc\n${matched.join('\n')}\n`)
  return 1
}

process.exitCode = main(process.argv.slice(2))
