#!/usr/bin/env node
// Runs vitest under Electron's Node (`pnpm test`, worfy-windows ticket 02):
//
//   node scripts/vitest-electron.mjs [<vitest args>…]     → electron node_modules/vitest/vitest.mjs run <args>
//
// The tests run in Electron's Node so that native modules (node-pty) load with Electron's ABI, as the
// app loads them. The script used to be `ELECTRON_RUN_AS_NODE=1 electron …`, but a `VAR=value`
// prefix is POSIX shell syntax and cmd.exe, which runs pnpm scripts on Windows, does not understand
// it (evidence of worfy-windows ticket 01, section 10). Here the variable is set for the child alone.
// The arguments after `pnpm test` go to `vitest run` as before; the exit code is vitest's, and
// Ctrl+C and TERM are passed on to it.

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
// The electron package exports the path of its binary when required from Node.
const electron = createRequire(import.meta.url)('electron')
const vitest = join(REPO, 'node_modules', 'vitest', 'vitest.mjs')

const child = spawn(electron, [vitest, 'run', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
})
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (child.exitCode === null) child.kill(signal)
  })
}
child.on('error', (error) => {
  process.stderr.write(`vitest-electron: ${electron}: ${error.message}\n`)
  process.exitCode = 1
})
child.on('close', (code, signal) => {
  if (signal) process.stderr.write(`vitest-electron: vitest ended by ${signal}\n`)
  process.exitCode = typeof code === 'number' && code >= 0 ? code : 1
})
