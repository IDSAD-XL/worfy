// Closing a Git Bash Terminal on Windows, on a real pseudo-console (worfy-windows ticket 93): bash
// writes its history, and the pseudo-console is closed. Bash writes ~/.bash_history only when it
// exits by itself; Stop-Process of bash, as the close did before, left no history file. The close
// now holds the launcher (bin\bash.exe), sends SIGHUP to bash through kill.exe of Git for Windows,
// and then calls node-pty's kill() while node-pty still knows the pseudo-console
// (src/main/terminal/windows-pty.ts, hangupLines). Only on Windows with Git for Windows; the shells
// run in the temporary home of the harness (windowsEnv), never in the profile of the machine.
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { findGitBash } from '../../src/main/agent/env'
import { consoleHosts, harness, home, needsWindowsPowerShellOffRunner, NODE, PROJECT, settledHandleCount, useTerminalScratch, WINDOWS, windowsEnv } from './terminal-harness'

vi.mock('electron', () => ({ app: { on: vi.fn() }, BrowserWindow: { getAllWindows: () => [] } }))

useTerminalScratch()

/** Skips a test without Git for Windows, and on the GitHub runner: the helper of the close is Windows PowerShell 5.1 there too. */
function needsGitBash(context: { skip: (condition: boolean, note?: string) => void }): void {
  // The environment the harness gives its shells, as the registry searches it (windowsEnv).
  context.skip(findGitBash(windowsEnv(home)) === null, 'this machine has no Git for Windows')
  needsWindowsPowerShellOffRunner(context)
}

/** A command whose output, not its typed line, holds `<word>-42`; the typed line is what history keeps. */
const unique = (word: string): { command: string; output: RegExp } => ({ command: `echo ${word}-$((40+2))`, output: new RegExp(`${word}-42\\r?\\n`) })

describe.runIf(WINDOWS)('closing a Git Bash Terminal on Windows, on a real pty', () => {
  it('terminal.close of a running Git Bash leaves its history: the command typed before the close is in HISTFILE of the home', async (context) => {
    needsGitBash(context)
    const h = await harness({ shell: 'git-bash' })
    expect((await h.open()).shell).toBe('bash.exe')
    const word = `worfy-history-${process.pid}-${Date.now()}`
    const { command, output } = unique(word)
    await h.run(command, output)
    await h.ok('terminal.close', { projectId: PROJECT, nodeId: NODE })
    expect(h.registry.size).toBe(0)
    // bash writes the file before it exits, and the close resolves after the exit.
    const file = join(home, '.bash_history')
    expect(existsSync(file), `${file} after the close`).toBe(true)
    expect((await readFile(file, 'utf8')).split(/\r?\n/)).toContain(command)
  }, 30_000)

  // node-pty 1.2.0-beta.15 forgets the pseudo-console of a shell that exits by itself and never
  // closes it: two handles of this process per shell (microsoft/node-pty#965). Before this ticket
  // the launcher of Git Bash exited by itself once the close ended bash: +20 for 10 in this test on
  // the PC (+21 for 10 in the probe of the ticket, which reads the count the same way).
  it('10 Git Bash Terminals closed by terminal.close leave no handle in this process, give or take a few', async (context) => {
    needsGitBash(context)
    const NOISE = 5
    const warmUp = Array.from({ length: 4 }, (_, index) => `w${index}`)
    const measured = Array.from({ length: 10 }, (_, index) => `n${index}`)
    const h = await harness({ shell: 'git-bash', nodes: [...warmUp, ...measured] })
    const hostsBefore = new Set(consoleHosts())
    /** Opens the Terminals four at a time, runs a command in each and closes it while bash runs. */
    const closeShells = async (nodeIds: readonly string[]) => {
      for (let i = 0; i < nodeIds.length; i += 4) {
        await Promise.all(
          nodeIds.slice(i, i + 4).map(async (nodeId) => {
            await h.open(nodeId)
            const { command, output } = unique(`ready-${nodeId}`)
            await h.run(command, output, nodeId)
            await h.ok('terminal.close', { projectId: PROJECT, nodeId })
          }),
        )
      }
    }
    // The first shells of a run open handles once (EtwRegistration and the like): the warm-up takes those.
    await closeShells(warmUp)
    const before = await settledHandleCount()
    await closeShells(measured)
    expect(h.registry.size).toBe(0)
    // One reading of a settled count, as in the test of ticket 92 in terminal-windows.test.ts.
    const added = (await settledHandleCount()) - before
    expect(Math.abs(added), `added ${added} handles`).toBeLessThanOrEqual(NOISE)
    await vi.waitFor(() => expect(consoleHosts().filter((pid) => !hostsBefore.has(pid))).toEqual([]), { timeout: 5000, interval: 500 })
  }, 90_000)
})

