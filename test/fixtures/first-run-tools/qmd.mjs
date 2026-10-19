// The qmd 2.8.3 stand-in of ./qmd as a Node script, for Windows (README.md): `qmd --version` and `qmd pull`.
import process from 'node:process'
import { log, unsupported } from './stand-in.mjs'

const args = process.argv.slice(2)
log('qmd', args)
if (args[0] === '--version') {
  process.stdout.write('qmd 2.8.3 (facd35e)\n')
} else if (args[0] === 'pull') {
  if (process.env.FAKE_QMD_PULL_FAIL) {
    process.stderr.write(`${process.env.FAKE_QMD_PULL_FAIL}\n`)
    process.exitCode = 1
  }
} else {
  unsupported('qmd', args)
}
