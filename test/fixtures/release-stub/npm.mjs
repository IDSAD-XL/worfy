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
} else if (process.env.RELEASE_STUB_MISSING === 'e404') {
  const version = args[1].slice(args[1].lastIndexOf('@') + 1)
  process.stderr.write(
    `npm error code E404\nnpm error 404 No match found for version ${version}\nnpm error 404\nnpm error 404  The requested resource '${args[1]}' could not be found or you do not have permission to access it.\nnpm error A complete log of this run can be found in: /npm/_logs/${process.pid}-debug-0.log\n`,
  )
  process.exitCode = 1
}
