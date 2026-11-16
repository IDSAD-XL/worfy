// The npm stand-in of ./npm as a Node script, for Windows: a `npm.cmd` the test writes runs it with the tests' node.
import { appendFileSync } from 'node:fs'
import process from 'node:process'

const args = process.argv.slice(2)
appendFileSync(process.env.RELEASE_STUB_CALLS, `npm ${args.join(' ')} cwd=${process.cwd()}\n`)
const code = Number(process.env.RELEASE_STUB_CODE ?? 0)
const missing = process.env.RELEASE_STUB_MISSING
/** Writes npm 11's error lines and its last line, the debug log, whose path is different on every run. */
const fail = (lines, exitCode) => {
  process.stderr.write(`${[...lines, `A complete log of this run can be found in: /npm/_logs/${process.pid}-debug-0.log`].map((line) => `npm error ${line}`.trimEnd()).join('\n')}\n`)
  process.exitCode = exitCode
}
const resource = `The requested resource '${args[1]}' could not be found or you do not have permission to access it.`
if (code !== 0) {
  fail(
    [
      'code ENOTFOUND',
      'syscall getaddrinfo',
      'errno ENOTFOUND',
      'network request to https://registry.example/ failed',
      'network This is a problem related to network connectivity.',
      'network In most cases you are behind a proxy or have bad network settings.',
      'network',
      'network If you are behind a proxy, please make sure that the',
      "network 'proxy' config is set properly.  See: 'npm help config'",
    ],
    code,
  )
} else if (` ${process.env.RELEASE_STUB_PUBLISHED ?? ''} `.includes(` ${args[1]} `)) {
  process.stdout.write(`${args[1].slice(args[1].lastIndexOf('@') + 1)}\n`)
} else if (missing === 'e404') {
  fail(['code E404', `404 No match found for version ${args[1].slice(args[1].lastIndexOf('@') + 1)}`, '404', `404  ${resource}`], 1)
} else if (missing === 'package') {
  const name = args[1].slice(0, args[1].lastIndexOf('@'))
  fail(
    [
      'code E404',
      `404 Not Found - GET https://registry.example/${name} - Not found`,
      '404',
      `404  ${resource}`,
      '404',
      '404 Note that you can also install from a',
      '404 tarball, folder, http url, or git url.',
    ],
    1,
  )
}
