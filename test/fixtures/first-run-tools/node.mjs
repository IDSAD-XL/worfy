// The node stand-in of ./node as a Node script, for Windows (README.md): `node --version`; any other
// call goes to the real node named by FAKE_NODE_REAL, so the Harness scripts run.
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { log, unsupported } from './stand-in.mjs'

const args = process.argv.slice(2)
log('node', args)
if (args[0] === '--version') {
  process.stdout.write(`v${process.env.FAKE_NODE_VERSION || '22.11.0'}\n`)
} else if (process.env.FAKE_NODE_REAL) {
  const run = spawnSync(process.env.FAKE_NODE_REAL, args, { stdio: 'inherit' })
  process.exitCode = run.status ?? 1
} else {
  unsupported('node', args)
}
