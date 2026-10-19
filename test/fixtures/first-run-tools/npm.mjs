// The npm stand-in of ./npm as a Node script, for Windows (README.md): `npm prefix -g` and
// `npm install -g`, which "installs" qmd by writing a qmd.cmd into $FAKE_NPM_BIN that runs qmd.mjs
// of this folder with this node, as npm puts a qmd.cmd into its global folder.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { log, unsupported } from './stand-in.mjs'

const args = process.argv.slice(2)
log('npm', args)
if (args[0] === 'prefix') {
  process.stdout.write(`${process.env.FAKE_NPM_PREFIX || '/usr/local'}\n`)
} else if (args[0] === 'install') {
  if (process.env.FAKE_NPM_FAIL) {
    process.stderr.write(`npm error ${process.env.FAKE_NPM_FAIL}\n`)
    process.exitCode = 1
  } else {
    const qmd = join(process.env.FIRST_RUN_TOOLS_DIR ?? '', 'qmd.mjs')
    writeFileSync(join(process.env.FAKE_NPM_BIN ?? '', 'qmd.cmd'), `@"${process.execPath}" "${qmd}" %*\r\n`, { flag: 'wx' })
  }
} else {
  unsupported('npm', args)
}
