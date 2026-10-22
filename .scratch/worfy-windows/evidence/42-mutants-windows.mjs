// Mutants of ticket 42, item 5: run on the PC against the real-shell tests of Windows.
// Usage: node .scratch/worfy-windows/evidence/42-mutants-windows.mjs [<tree>] — Windows only: real ConPTY shells.
import console from 'node:console'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'
const TREE = path.resolve(process.argv[2] ?? process.cwd())
const HARNESS = path.join(TREE, 'test/contract/terminal-harness.ts')
const PTY = path.join(TREE, 'src/main/terminal/pty.ts')
const mutants = [
  ['consoleHosts does not count OpenConsole.exe', HARNESS, " AND (Name = 'conhost.exe' OR Name = 'OpenConsole.exe')", " AND (Name = 'conhost.exe')"],
  ['the helper of kill() is not taken out', PTY, '    const quiet = withoutConsoleHelper(terminal.pty)', "    const quiet = (terminal.pty as { _agent?: unknown })._agent !== undefined"],
]
let survived = 0
const env = { ...process.env, PATH: process.env.PATH.split(path.delimiter).filter((dir) => !/GitHub CLI/i.test(dir)).join(path.delimiter) }
for (const [name, file, from, to] of mutants) {
  const copy = fs.readFileSync(file, 'utf8')
  const text = copy.replace(/\r\n/g, '\n')
  if (text.split(from).length !== 2) {
    console.log(`${name}: NOT APPLIED`)
    survived += 1
    continue
  }
  fs.writeFileSync(file, text.replace(from, to))
  try {
    const run = spawnSync(process.execPath, ['scripts/vitest-electron.mjs', 'test/contract/terminal-windows.test.ts', '--reporter=verbose'], { cwd: TREE, env, encoding: 'utf8', timeout: 400_000 })
    const failed = (run.stdout ?? '').split('\n').filter((line) => /^\s+[×✗]/.test(line)).map((line) => line.trim())
    const summary = /Tests\s+([^\n]*)/.exec(run.stdout ?? '')?.[1]?.trim() ?? 'no summary'
    // Killed only by failed tests: a run that broke in another way (exit 2, a timeout) is no verdict.
    const killed = run.status === 1 && /\b[1-9]\d* failed\b/.test(summary)
    if (!killed) survived += 1
    const verdict = killed ? 'killed' : run.status === 0 ? 'SURVIVED' : 'NOT JUDGED (the run broke without failed tests)'
    console.log(`${name}: exit ${run.status} — ${verdict} (${summary})\n  ${failed.join('\n  ')}`)
  } finally {
    fs.writeFileSync(file, copy)
  }
}
console.log(`${mutants.length - survived} of ${mutants.length} killed`)
process.exitCode = survived === 0 ? 0 : 1
