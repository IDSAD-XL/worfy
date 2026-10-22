// Mutants of ticket 42 (items 1-3): each is applied alone, the unit test files run, and the file is
// restored from the copy taken before. A mutant must make the run fail.
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
  ['scanner: nested request kept', CR, "        text += this.sent ? CAN : this.controls\n        this.begin(char)", "        text += this.sent ? CAN : this.held\n        this.begin(char)"],
  ['scanner: no CSI', CR, '    this.state = char === ESC ? \'escape\' : \'first\'', "    this.state = char === ESC ? 'escape' : 'text'"],
  ['scanner: first parameter any digit', CR, "      } else if (this.state === 'first' && char === '0') {", "      } else if (this.state === 'first' && char >= '0' && char <= '9') {"],
  ['scanner: no CAN after a sent start', CR, "        text += this.sent ? CAN : this.controls\n        this.reset()", "        text += this.sent ? 'c' : this.controls\n        this.reset()"],
  ['scanner: forgets the sent start', CR, '    this.sent = true\n    return rest', '    this.state = \'text\'\n    return rest'],
  ['scanner: no hold limit', CR, '    if (this.held.length < HOLD_LIMIT) return \'\'', "    if (this.held.length < Infinity) return ''"],
  ['scanner: controls dropped', CR, '      } else if ((code < 0x20 && char !== CAN && char !== SUB) || code === 0x7f) {', '      } else if (false) {'],
]
const env = { ...process.env, PATH: process.env.PATH.split(path.delimiter).filter((dir) => !/GitHub CLI/i.test(dir)).join(path.delimiter) }
const results = []
for (const [name, file, from, to] of mutants) {
  const copy = fs.readFileSync(file, 'utf8')
  const text = copy.replace(/\r\n/g, '\n')
  if (text.split(from).length !== 2) {
    results.push(`${name}: NOT APPLIED (found ${text.split(from).length - 1})`)
    continue
  }
  fs.writeFileSync(file, text.replace(from, to))
  try {
    const run = spawnSync(process.execPath, ['scripts/vitest-electron.mjs', ...FILES], { cwd: TREE, env, encoding: 'utf8', timeout: 300_000 })
    const summary = /Tests\s+([^\n]*)/.exec(run.stdout ?? '')?.[1] ?? 'no summary'
    results.push(`${name}: exit ${run.status} — ${run.status === 0 ? 'SURVIVED' : 'killed'} (${summary.trim()})`)
  } finally {
    fs.writeFileSync(file, copy)
  }
}
console.log(results.join('\n'))
