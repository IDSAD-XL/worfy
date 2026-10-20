// The git stand-in of ./git as a Node script, for Windows (README.md): `git --version` and
// `git config --get user.name|user.email`.
import { appendFileSync } from 'node:fs'
import process from 'node:process'
import { log, unsupported } from './stand-in.mjs'

const args = process.argv.slice(2)
log('git', args)
if (args[0] === '--version') {
  process.stdout.write('git version 2.39.5\n')
} else if (args[0] === 'config' && args[1] === '--get') {
  if (process.env.FAKE_GIT_CWD_LOG) appendFileSync(process.env.FAKE_GIT_CWD_LOG, `${process.cwd()}\n`)
  if (process.env.FAKE_GIT_CONFIG_FAIL) {
    process.stderr.write(`${process.env.FAKE_GIT_CONFIG_FAIL}\n`)
    process.exit(3)
  }
  const defaults = { 'user.name': ['FAKE_GIT_USER_NAME', 'Alice'], 'user.email': ['FAKE_GIT_USER_EMAIL', 'alice@example.com'] }
  const known = defaults[args[2]]
  const value = known === undefined ? '' : (process.env[known[0]] ?? known[1])
  if (value === '') process.exitCode = 1
  else process.stdout.write(`${value}\n`)
} else {
  unsupported('git', args)
}
