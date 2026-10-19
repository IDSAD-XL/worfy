// The GitHub CLI stand-in of ./gh as a Node script, for Windows (README.md). It never reaches GitHub.
import process from 'node:process'
import { log, unsupported } from './stand-in.mjs'

const args = process.argv.slice(2)
log('gh', args)
const [first, second] = args
if (first === '--version') {
  process.stdout.write('gh version 2.62.0 (2024-11-14)\n')
} else if (first === 'auth' && second === 'status') {
  const account = process.env.FAKE_GH_ACCOUNT
  if (account) {
    process.stdout.write(`github.com\n  ✓ Logged in to github.com account ${account} (keyring)\n  - Active account: true\n`)
  } else {
    process.stderr.write('You are not logged into any GitHub hosts. To log in, run: gh auth login\n')
    process.exitCode = 1
  }
} else if (first === 'auth' && second === 'login') {
  process.stdout.write('fake gh: auth login started\n')
} else {
  unsupported('gh', args)
}
