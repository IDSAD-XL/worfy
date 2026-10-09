#!/usr/bin/env node
// Root postinstall of the repository (worfy-windows ticket 02):
//
//   node scripts/postinstall.mjs [--platform <darwin|linux|win32>] [--dry-run]
//
// On macOS and Linux it rebuilds node-pty for Electron, as before: `electron-rebuild --only node-pty`.
// On Windows it does nothing: node-pty ships a build for win32-x64 in prebuilds/, and that build loads
// in Electron as is (evidence of worfy-windows ticket 01, section 09). The rebuild from source fails on
// Windows even with Visual Studio Build Tools installed (section 08), so Build Tools are not required.
// The condition lives here and not in the package.json line: cmd.exe, which runs pnpm scripts on
// Windows, has neither `uname` nor `[ … ]`.
//
// --platform replaces process.platform and --dry-run prints the decision instead of running it — both
// for test/contract/postinstall.test.ts. The printed line is `run: <command> <args…>` or
// `skip: <reason>`. The exit code is the one of electron-rebuild, or 0 when skipped.

import { spawnSync } from 'node:child_process'
import process from 'node:process'

/** What the postinstall does on a platform: a command to run, or the reason it does nothing. */
function postinstallPlan(platform) {
  if (platform === 'win32') {
    return { skip: 'node-pty uses its prebuilt win32 binary; no rebuild on Windows' }
  }
  return { command: 'electron-rebuild', args: ['--only', 'node-pty'] }
}

function main(argv) {
  let platform = process.platform
  let dryRun = false
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--dry-run') dryRun = true
    else if (arg === '--platform' && argv[index + 1]) platform = argv[(index += 1)]
    else {
      process.stderr.write(`postinstall: unknown argument ${arg}\n`)
      return 2
    }
  }
  const plan = postinstallPlan(platform)
  if ('skip' in plan) {
    process.stdout.write(`skip: ${plan.skip}\n`)
    return 0
  }
  if (dryRun) {
    process.stdout.write(`run: ${[plan.command, ...plan.args].join(' ')}\n`)
    return 0
  }
  // pnpm puts node_modules/.bin on PATH for lifecycle scripts, as it did for the package.json line.
  const result = spawnSync(plan.command, plan.args, { stdio: 'inherit' })
  if (result.error) {
    process.stderr.write(`postinstall: ${plan.command}: ${result.error.message}\n`)
    return 1
  }
  return result.status ?? 1
}

process.exitCode = main(process.argv.slice(2))
