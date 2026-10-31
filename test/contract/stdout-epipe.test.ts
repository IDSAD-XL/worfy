// A stdout nobody reads any more must not stop the process (worfy-link ticket 38,
// src/main/diagnostics/closed-stdio.ts). A child node gets a pipe for stdout, the test closes its
// reading end, and only then tells the child, over stdin, to console.log. Without ignoreClosedStdio
// the write's EPIPE is an uncaught exception and the child dies; in Electron's main that is the modal
// error box that kept the old Stable on the PC from quitting. With it the child writes its marker
// file after the failed write and exits 0.
//
// The child loads closed-stdio.ts as it is: node 24 strips its types, and the file imports nothing.
// What this does not cover: the PC's case, a Windows console (\Device\ConDrv) whose owner has gone.
// The listener there does not depend on the kind of stream, but no test here makes such a console.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'

const MODULE = join(__dirname, '..', '..', 'src', 'main', 'diagnostics', 'closed-stdio.ts')

// The child: listens (or not) for closed-stream errors, waits for the go-ahead on stdin, then
// console.logs three lines, giving the stream's events their turn after each. Node's Console keeps the
// error of the first failed write from being uncaught, and the stream only closes; a later one, as the
// link's next `[link]` line did on the PC, is the uncaught EPIPE (measured with node 24.19 on macOS). The marker says how often stdout closed:
// at least once, or the reader was still open and the test proved nothing.
const CHILD = `
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
const [modulePath, marker, listen] = process.argv.slice(2)
if (listen === 'listen') (await import(pathToFileURL(modulePath).href)).ignoreClosedStdio()
let closed = 0
process.stdout.on('close', () => closed++)
const settle = () => new Promise((resolve) => setImmediate(() => setImmediate(resolve)))
process.stdin.once('data', async () => {
  for (let i = 1; i <= 3; i++) {
    console.log('[link] line ' + i + ' nobody reads')
    await settle()
  }
  writeFileSync(marker, 'after the writes, stdout closed ' + closed + ' times')
  process.exit(0)
})
`

interface Run {
  code: number | null
  stderr: string
  marker: string | null
}

let scratch: string

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-stdout-epipe-')))
})

afterEach(() => {
  removeTestTree(scratch)
})

/** Starts the child, closes the reading end of its stdout, then lets it write. */
function run(listen: boolean): Promise<Run> {
  const script = join(scratch, 'child.mjs')
  const marker = join(scratch, 'marker.txt')
  writeFileSync(script, CHILD)
  const child = spawn(scriptNode(), [script, MODULE, marker, listen ? 'listen' : 'no'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  let stderr = ''
  child.stderr.setEncoding('utf8').on('data', (text: string) => (stderr += text))
  child.stdout.once('close', () => child.stdin.end('go\n'))
  child.stdout.destroy()
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code) => resolve({ code, stderr, marker: existsSync(marker) ? readFileSync(marker, 'utf8') : null }))
  })
}

describe('a stdout whose reader has gone', () => {
  it('kills a process with no listener: the write error is an uncaught exception', async () => {
    const result = await run(false)
    expect(result.marker).toBeNull()
    expect(result.code).not.toBe(0)
    expect(result.stderr).toMatch(/EPIPE|EOF/)
  })

  it('leaves the process running with ignoreClosedStdio: exit code 0 and the line after the write', async () => {
    const result = await run(true)
    expect(result.stderr).toBe('')
    expect(result.marker).toMatch(/^after the writes, stdout closed [1-9]\d* times$/)
    expect(result.code).toBe(0)
  })
})
