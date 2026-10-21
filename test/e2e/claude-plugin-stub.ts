// The Claude Code stand-in of the Project-connect specs (projects-connect.spec.ts, select.spec.ts)
// and of the move of the old Harness (harness-migrate.spec.ts, worfy-windows ticket 83):
// `claude plugin list --json` answers that the Harness plugin of this build is installed and
// enabled, so the connect dialog passes its Harness step; any other command prints nothing and
// exits 0. It is a `.mjs`, which worfy starts under its own Node on every system
// (src/main/program.ts). Windows cannot start a `#!/bin/sh` script: with one the Harness check failed
// there and the dialog stopped at the Harness stage (worfy-windows ticket 82).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SCRIPT = `const args = process.argv.slice(2).join(' ')
if (args === 'plugin list --json') {
  process.stdout.write(JSON.stringify([
    { id: 'worfy@worfy-harness', version: process.env.STUB_PLUGIN_VERSION, scope: 'user', enabled: true, errors: [] },
    { id: 'mattpocock-skills@claude-plugins-official', version: '1.0.0', scope: 'user', enabled: true, errors: [] },
  ]) + '\\n')
}
`

/** Writes the stand-in into `dir` and returns its path, for WORFY_CLAUDE; STUB_PLUGIN_VERSION is the version it reports. */
export function claudePluginStub(dir: string): string {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'claude.mjs')
  writeFileSync(path, SCRIPT)
  return path
}
