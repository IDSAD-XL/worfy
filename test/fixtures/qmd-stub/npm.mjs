// The npm stand-in of ./npm as a Node script, for Windows (see ./node.mjs).
import { appendFileSync } from 'node:fs'
import process from 'node:process'

appendFileSync(process.env.CALLS, `npm ${process.argv.slice(2).join(' ')} mark=${process.env.LOGIN_MARK}\n`)
const code = Number(process.env.NPM_STUB_CODE ?? 0)
if (code !== 0) {
  process.stderr.write('npm warn something\nnpm error code EACCES\n')
  process.exitCode = code
}
