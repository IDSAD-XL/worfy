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
import { spawnShellPty, type SpawnPty } from '../../src/main/terminal/pty'
import { endDescendants, endShell, type StartedShell } from '../../src/main/terminal/windows-pty'
import { alive, consoleHosts, harness, home, needsWindowsPowerShellOffRunner, NODE, type OpenResult, PROJECT, settledHandleCount, useTerminalScratch, WINDOWS, windowsEnv } from './terminal-harness'

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

/**
 * Opens a Git Bash Terminal and waits until its readline asks for the first line: bash turns
 * bracketed paste on (ESC[?2004h) right before its first prompt. Under the load of a full run a
 * Git Bash started later than the 5 s that h.run gives a command's output, and the case failed with
 * only the start codes of the console in the output. The start is waited for apart from the
 * command, with no clock of its own: the timeout of the test bounds it.
 */
async function openBash(h: Awaited<ReturnType<typeof harness>>, nodeId = NODE): Promise<OpenResult> {
  const opened = await h.open(nodeId)
  while (!h.text(nodeId).includes('\u001b[?2004h')) await new Promise((done) => setTimeout(done, 50))
  return opened
}

describe.runIf(WINDOWS)('closing a Git Bash Terminal on Windows, on a real pty', () => {
  it('terminal.close of a running Git Bash leaves its history: both commands typed before the close are in HISTFILE of the home', async (context) => {
    needsGitBash(context)
    const h = await harness({ shell: 'git-bash' })
    expect((await openBash(h)).shell).toBe('bash.exe')
    const word = `worfy-history-${process.pid}-${Date.now()}`
    const first = unique(`${word}-one`)
    const second = unique(`${word}-two`)
    await h.run(first.command, first.output)
    await h.run(second.command, second.output)
    await h.ok('terminal.close', { projectId: PROJECT, nodeId: NODE })
    expect(h.registry.size).toBe(0)
    // bash writes the file only when it exits by itself, on the SIGHUP: after Stop-Process there is
    // none. The close resolves after the exit.
    const file = join(home, '.bash_history')
    expect(existsSync(file), `${file} after the close`).toBe(true)
    const lines = (await readFile(file, 'utf8')).split(/\r?\n/)
    expect(lines).toContain(first.command)
    expect(lines).toContain(second.command)
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
            await openBash(h, nodeId)
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

// The launcher of Git Bash the helper suspended cannot exit by itself: whatever fails on the way,
// the close must still end it. The bound of the close is put out of reach (60 s), so only the
// release of the close itself can end the launcher within the test.
describe.runIf(WINDOWS)('closing a Git Bash Terminal on Windows when a step fails: the suspended launcher is ended', () => {
  const FAR_BOUND_MS = 60_000

  /** Opens Git Bash, runs a command, closes it; answers the launcher pid and how long the close took. */
  async function openAndClose(h: Awaited<ReturnType<typeof harness>>): Promise<{ launcher: number; ms: number }> {
    const { pid: launcher } = await openBash(h)
    const { command, output } = unique('ready')
    await h.run(command, output)
    const started = Date.now()
    await h.ok('terminal.close', { projectId: PROJECT, nodeId: NODE })
    return { launcher, ms: Date.now() - started }
  }

  async function expectNothingLeft(launcher: number, hostsBefore: Set<number>): Promise<void> {
    expect(alive(launcher), `the launcher ${launcher}`).toBe(false)
    await vi.waitFor(() => expect(consoleHosts().filter((pid) => !hostsBefore.has(pid))).toEqual([]), { timeout: 5000, interval: 500 })
  }

  it('the helper fails after it held the launcher: the close still calls kill(), and the launcher is ended', async (context) => {
    needsGitBash(context)
    const hostsBefore = new Set(consoleHosts())
    const h = await harness({
      shell: 'git-bash',
      closeBoundMs: FAR_BOUND_MS,
      endDescendants: async (shell) => {
        await endDescendants(shell)
        throw new Error('the helper failed (stand-in)')
      },
    })
    const { launcher, ms } = await openAndClose(h)
    expect(ms).toBeLessThan(10_000)
    await expectNothingLeft(launcher, hostsBefore)
  }, 40_000)

  it('the helper answers gone after it held the launcher: the close still calls kill(), and the launcher is ended', async (context) => {
    needsGitBash(context)
    const hostsBefore = new Set(consoleHosts())
    const h = await harness({
      shell: 'git-bash',
      closeBoundMs: FAR_BOUND_MS,
      endDescendants: async (shell) => {
        await endDescendants(shell)
        return 'gone' as const
      },
    })
    const { launcher, ms } = await openAndClose(h)
    expect(ms).toBeLessThan(10_000)
    await expectNothingLeft(launcher, hostsBefore)
  }, 40_000)

  it('kill() of the pty throws: the launcher is ended by its pid', async (context) => {
    needsGitBash(context)
    const hostsBefore = new Set(consoleHosts())
    const spawn: SpawnPty = (file, args, options) => {
      const pty = spawnShellPty(file, args, options)
      pty.kill = () => {
        throw new Error('kill() failed (stand-in)')
      }
      return pty
    }
    const h = await harness({ shell: 'git-bash', closeBoundMs: FAR_BOUND_MS, spawn, endDescendants, endShell })
    const { launcher, ms } = await openAndClose(h)
    expect(ms).toBeLessThan(10_000)
    await expectNothingLeft(launcher, hostsBefore)
  }, 40_000)

  // node-pty reports the exit 1 s after the close stops its output thread, whether or not the
  // launcher is gone; the end by pid took 840-900 ms on the owner's PC, so a slower start of its
  // PowerShell let the close resolve with the launcher alive. Here it starts 1.5 s late on purpose.
  it('kill() of the pty throws and the end by pid comes after node-pty reported the exit: the close still waits for the launcher to end', async (context) => {
    needsGitBash(context)
    const hostsBefore = new Set(consoleHosts())
    const spawn: SpawnPty = (file, args, options) => {
      const pty = spawnShellPty(file, args, options)
      pty.kill = () => {
        throw new Error('kill() failed (stand-in)')
      }
      return pty
    }
    const lateEndShell = async (shell: StartedShell) => {
      await new Promise((done) => setTimeout(done, 1500))
      return endShell(shell)
    }
    const h = await harness({ shell: 'git-bash', closeBoundMs: FAR_BOUND_MS, spawn, endDescendants, endShell: lateEndShell })
    const { launcher, ms } = await openAndClose(h)
    expect(ms).toBeLessThan(10_000)
    await expectNothingLeft(launcher, hostsBefore)
  }, 40_000)

  it('closeAll with six Git Bash Terminals open, as quitting the app does, leaves no launcher, bash or console host', async (context) => {
    needsGitBash(context)
    const hostsBefore = new Set(consoleHosts())
    const nodeIds = Array.from({ length: 6 }, (_, index) => `q${index}`)
    const h = await harness({ shell: 'git-bash', nodes: nodeIds })
    const launchers = await Promise.all(
      nodeIds.map(async (nodeId) => {
        const { pid } = await openBash(h, nodeId)
        const { command, output } = unique(`open-${nodeId}`)
        await h.run(command, output, nodeId)
        return pid
      }),
    )
    await h.registry.closeAll()
    expect(h.registry.size).toBe(0)
    expect(launchers.filter((pid) => alive(pid))).toEqual([])
    await vi.waitFor(() => expect(consoleHosts().filter((pid) => !hostsBefore.has(pid))).toEqual([]), { timeout: 5000, interval: 500 })
  }, 60_000)
})
