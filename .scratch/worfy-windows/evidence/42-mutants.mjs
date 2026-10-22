// Mutants of ticket 42 (items 1-3): each is applied alone, the unit test files run, and the file is
// restored from the copy taken before. A mutant counts as killed only when the run exits 1 with
// failed tests in its summary; a run that broke in another way (exit 2, a timeout, no summary) is
// not a verdict.
// Usage: node .scratch/worfy-windows/evidence/42-mutants.mjs [<tree>] — the tree defaults to the current folder; any system.
import console from 'node:console'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'
const TREE = path.resolve(process.argv[2] ?? process.cwd())
const PTY = path.join(TREE, 'src/main/terminal/pty.ts')
const WIN = path.join(TREE, 'src/main/terminal/windows-pty.ts')
const CR = path.join(TREE, 'src/main/terminal/console-request.ts')
const FILES = ['test/unit/console-request.test.ts', 'test/unit/terminal-console.test.ts', 'test/unit/terminal-shell.test.ts']
const mutants = [
  ['one scanner for all Terminals', PTY, "    const requests = this.platform === 'win32' ? new ConsoleRequests() : null", "    const requests = this.platform === 'win32' ? ((this as unknown as { shared?: ConsoleRequests }).shared ??= new ConsoleRequests()) : null"],
  ['answer after the text of the chunk', PTY, '      const read = requests.feed(raw)\n', "      const read = requests.feed(raw)\n      if (read.text !== '') deliver(read.text)\n      read.text = ''\n"],
  ['look without unref', PTY, '      exitPoll.unref?.()', '      void 0'],
  ['release returns before the stop', PTY, '    if (exited && !quiet) return this.stopOutputThread(terminal, quiet)', '    if (exited && !quiet) return'],
  ['resize said every time', PTY, '      if (!terminal.resizeFailed) console.warn(', '      console.warn('],
  ['every pty reads an exit code', WIN, "  return typeof agent === 'object' && agent !== null && 'exitCode' in agent", '  return true'],
  ['a code that is no number is running', WIN, "  return typeof code === 'number' ? code : null", "  return typeof code === 'number' ? code : undefined"],
  ['no word of a missing input socket', WIN, "    console.warn(`[terminal] the pty of the shell ${pty.pid} has no _agent.inSocket", "    void (`[terminal] the pty of the shell ${pty.pid} has no _agent.inSocket"],
  ['no check for an agent without inSocket', WIN, "  if (input === undefined || input === null || typeof input.on !== 'function') {", "  if (input === undefined || input === null) {"],
  ['scanner: nested request kept', CR, '        text += this.takenOut()\n        this.begin(char)', '        text += this.sent ? CAN : this.held\n        this.begin(char)'],
  ['scanner: no CSI', CR, '    this.state = char === ESC ? \'escape\' : \'first\'', "    this.state = char === ESC ? 'escape' : 'text'"],
  ['scanner: first parameter any digit', CR, "      } else if (this.state === 'first' && char === '0') {", "      } else if (this.state === 'first' && char >= '0' && char <= '9') {"],
  ['scanner: no CAN after a sent start', CR, '    if (this.sent) return CAN', "    if (this.sent) return 'c'"],
  ['scanner: forgets the sent start', CR, '    this.sent = true\n', '    this.state = \'text\'\n'],
  ['scanner: no hold limit', CR, '    if (this.held.length < HOLD_LIMIT) return \'\'', "    if (this.held.length < Infinity) return ''"],
  ['scanner: controls dropped', CR, '      } else if ((code < 0x20 && char !== CAN && char !== SUB) || code === 0x7f) {', '      } else if (false) {'],
  // The review of the scanner: a request taken out must still end a sequence of another program.
  ['scanner: a request does not end a foreign sequence', CR, '    const text = this.open === null ? this.controls : this.held.charAt(0) + this.controls + CAN', '    const text = this.controls'],
  ['scanner: a start cut off by the next does not end a foreign sequence', CR, '        text += this.takenOut()\n        this.begin(char)', '        text += this.sent ? CAN : this.controls\n        this.begin(char)'],
  ['scanner: every request leaves ESC and CAN', CR, '    const text = this.open === null ? this.controls : this.held.charAt(0) + this.controls + CAN', '    const text = this.held.charAt(0) + this.controls + CAN'],
  ['scanner: text given out is not followed', CR, '        this.follow(chunk, at, end)\n', ''],
  ['scanner: a start that is no request opens nothing', CR, '        this.open = failed(this.state, char)', '        this.open = null'],
  ['scanner: C1 openers in text missed', CR, '        if (found === null || found.index >= to) return', '        return'],
  ['scanner: a CSI never ends', CR, "  if (open === 'csi') return code >= 0x40 && code <= 0x7e ? null : open", "  if (open === 'csi') return open"],
  ['scanner: BEL does not end an OSC', CR, "  if (open === 'osc') return code === 0x07 ? null : open", "  if (open === 'osc') return open"],
]
const env = { ...process.env, PATH: process.env.PATH.split(path.delimiter).filter((dir) => !/GitHub CLI/i.test(dir)).join(path.delimiter) }
const results = []
let survived = 0
for (const [name, file, from, to] of mutants) {
  const copy = fs.readFileSync(file, 'utf8')
  const text = copy.replace(/\r\n/g, '\n')
  if (text.split(from).length !== 2) {
    results.push(`${name}: NOT APPLIED (found ${text.split(from).length - 1})`)
    survived += 1
    continue
  }
  fs.writeFileSync(file, text.replace(from, to))
  try {
    const run = spawnSync(process.execPath, ['scripts/vitest-electron.mjs', ...FILES], { cwd: TREE, env, encoding: 'utf8', timeout: 300_000 })
    const output = run.stdout ?? ''
    const summary = /Tests\s+([^\n]*)/.exec(output)?.[1]?.trim() ?? 'no summary'
    const killed = run.status === 1 && /\b[1-9]\d* failed\b/.test(summary)
    if (!killed) survived += 1
    const verdict = killed ? 'killed' : run.status === 0 ? 'SURVIVED' : 'NOT JUDGED (the run broke without failed tests)'
    const failed = output.split('\n').filter((line) => /^\s+[×✗]/.test(line)).map((line) => `    ${line.trim()}`)
    results.push(`${name}: exit ${run.status} — ${verdict} (${summary})${failed.length > 0 ? `\n${failed.join('\n')}` : ''}`)
  } finally {
    fs.writeFileSync(file, copy)
  }
}
console.log(results.join('\n'))
console.log(`${mutants.length - survived} of ${mutants.length} killed`)
process.exitCode = survived === 0 ? 0 : 1
