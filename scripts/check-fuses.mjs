#!/usr/bin/env node
// Reads the Electron fuses of a packaged worfy and fails unless RunAsNode and
// EnableNodeCliInspectArguments are off (worfy-auto-approve ticket 12, electron-builder.yml).
//
//   node scripts/check-fuses.mjs [<app>]
//
// <app> is worfy.app on macOS (the fuses sit in its Electron Framework), the folder of worfy.exe on
// Windows, or an Electron binary itself; by default the dist/ build of `pnpm package`, found as
// scripts/install-stable.mjs finds it. Prints every fuse with its state; exit 0 when both are off,
// 1 when one is not or the fuses cannot be read.
//
// `pnpm test:package` runs it last, after the Playwright tests: the packaged e2e tests drive a copy
// whose inspect fuse test/e2e/fuses.ts turns back on, and a slip of that helper into dist/ would
// show here, on the build the job made.
import console from 'node:console'
import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { FuseV1Options, getCurrentFuseWire } from '@electron/fuses'

/** The fuses that must be off in the packaged worfy. */
export const MUST_BE_OFF = ['RunAsNode', 'EnableNodeCliInspectArguments']

// The byte of a fuse in the wire (FuseState of @electron/fuses, which its index does not export):
// '0', '1', 'r'.
const STATE_NAMES = { 48: 'disabled', 49: 'enabled', 114: 'removed' }

/**
 * The file @electron/fuses reads for `app`: a .app as it is (the library finds its Electron
 * Framework), a file as it is, a folder by the worfy.exe in it.
 */
export function fuseTarget(app) {
  if (app.endsWith('.app') || !statSync(app).isDirectory()) return app
  return join(app, 'worfy.exe')
}

/** Every fuse of the wire of `app` by its name (FuseV1Options), with its state: enabled, disabled, removed. */
export async function fuseStates(app) {
  const wire = await getCurrentFuseWire(fuseTarget(app))
  const states = {}
  for (const [index, value] of Object.entries(wire)) {
    if (index === 'version') continue
    states[FuseV1Options[Number(index)] ?? `fuse ${index}`] = STATE_NAMES[value] ?? `unknown (${value})`
  }
  return states
}

/** What is wrong with `states` for a packaged worfy: one line per fuse of MUST_BE_OFF that is not disabled. */
export function fuseProblems(states) {
  return MUST_BE_OFF.filter((name) => states[name] !== 'disabled').map((name) => `${name} is ${states[name] ?? 'missing'}, and must be disabled`)
}

/** The dist/ build of `pnpm package` (builtApp of scripts/install-stable.mjs). */
async function distBuild() {
  const { builtApp } = await import('./install-stable.mjs')
  const dist = join(dirname(dirname(fileURLToPath(import.meta.url))), 'dist')
  return builtApp(process.platform, dist, existsSync(dist) ? readdirSync(dist) : [], existsSync)
}

async function main() {
  const app = process.argv[2] ?? (await distBuild())
  const states = await fuseStates(app)
  console.log(`Electron fuses of ${app}:`)
  for (const [name, state] of Object.entries(states)) console.log(`  ${name}: ${state}`)
  const problems = fuseProblems(states)
  if (problems.length === 0) return 0
  for (const problem of problems) console.error(`check-fuses: ${problem} (electron-builder.yml, electronFuses)`)
  return 1
}

if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(`check-fuses: ${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    },
  )
}
