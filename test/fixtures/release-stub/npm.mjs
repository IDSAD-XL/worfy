// The npm stand-in of ./npm as a Node script, for Windows: a `npm.cmd` the test writes runs it with the tests' node.
import { appendFileSync } from 'node:fs'
import process from 'node:process'

const args = process.argv.slice(2)
appendFileSync(process.env.RELEASE_STUB_CALLS, `npm ${args.join(' ')} cwd=${process.cwd()}\n`)
const code = Number(process.env.RELEASE_STUB_CODE ?? 0)
if (code !== 0) {
  process.stderr.write('npm error code ENOTFOUND\nnpm error network request to https://registry.example/ failed\n')
  process.exitCode = code
} else if (` ${process.env.RELEASE_STUB_PUBLISHED ?? ''} `.includes(` ${args[1]} `)) {
  process.stdout.write(`${args[1].slice(args[1].lastIndexOf('@') + 1)}\n`)
}
