// Closing a Git Bash Terminal on Windows, on a real pseudo-console (worfy-windows ticket 93): bash
// writes its history, and the pseudo-console is closed. Bash writes ~/.bash_history only when it
// exits by itself; Stop-Process of bash, as the close did before, left no history file. The close
// now holds the launcher (bin\bash.exe), sends SIGHUP to bash through kill.exe of Git for Windows,
// and then calls node-pty's kill() while node-pty still knows the pseudo-console
// (src/main/terminal/windows-pty.ts, hangupLines). Only on Windows with Git for Windows; the shells
// run in the temporary home of the harness (windowsEnv), never in the profile of the machine.
import { existsSync, statSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { findGitBash, gitBashKill } from '../../src/main/agent/env'
import { spawnShellPty, type SpawnPty } from '../../src/main/terminal/pty'
import { endDescendants, endShell, type DescendantsVerdict, type StartedShell } from '../../src/main/terminal/windows-pty'
import { alive, consoleHosts, harness, home, needsWindowsPowerShellOffRunner, NODE, PROJECT, settledHandleCount, useTerminalScratch, WINDOWS, windowsEnv } from './terminal-harness'
import { ms } from '../time-scale'

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
 * A stand-in of kill.exe as a batch file: one process, as kill.exe is. It notes that it started,
 * writes a file once, runs `first` and rewrites the file in a loop, until the scratch folder of the
 * test is removed. `first` can end bash, and the helper then ends the stand-in at once, so what comes
 * after `first` may never run. The loop is bounded, about a minute on the PC, in case vitest dies
 * before it removes the folder.
 */
async function spinningKill(name: string, first = ''): Promise<{ file: string; started: string; beat: string }> {
  const file = join(home, `${name}.cmd`)
  await writeFile(file, ['@echo off', 'echo.>"%~f0.started"', 'echo.>"%~f0.beat"', first, 'set n=0', ':again', 'echo.>"%~f0.beat"', 'set /a n+=1', 'if %n% lss 10000 if exist "%~f0" goto again', ''].join('\r\n'))
  return { file, started: `${file}.started`, beat: `${file}.beat` }
}

/** What a test says when execFile ended the helper at HANGUP_TIMEOUT_MS: under load it took up to 4855 ms (worfy-windows ticket 116). */
const OUT_OF_TIME = 'the helper ran out of its time limit on this busy machine, so it never reached what this test reads'

interface RecordingHelper {
  run: (shell: StartedShell) => Promise<DescendantsVerdict>
  answers: DescendantsVerdict[]
  outOfTime: boolean
}

/**
 * Skips a test whose helper ran out of time, and names the skip: vitest's default reporter counts
 * skipped tests without naming them. The GitHub runner never gets here (needsGitBash).
 */
function skipWhenOutOfTime(context: { skip: (condition: boolean, note?: string) => void; task: { name: string } }, helper: RecordingHelper): void {
  if (!helper.outOfTime) return
  process.stderr.write(`skip (out of time): ${context.task.name}: ${OUT_OF_TIME}\n`)
  context.skip(true, OUT_OF_TIME)
}

/** The helper of the close with a stand-in of kill.exe; a helper ended by its time limit is told apart from a wrong answer. */
function recordingHelper(hangup: string): RecordingHelper {
  const helper: RecordingHelper = {
    answers: [],
    outOfTime: false,
    run: async (shell) => {
      try {
        const answer = await endDescendants({ ...shell, hangup })
        helper.answers.push(answer)
        return answer
      } catch (error) {
        helper.outOfTime = (error as { killed?: boolean }).killed === true
        throw error
      }
    },
  }
  return helper
}

/** Opens Git Bash, runs a command and closes it with this helper. */
async function openAndCloseWith(helper: RecordingHelper): Promise<void> {
  const h = await harness({ shell: 'git-bash', endDescendants: helper.run })
  await h.open()
  const { command, output } = unique('ready')
  await h.run(command, output)
  await h.ok('terminal.close', { projectId: PROJECT, nodeId: NODE })
  expect(h.registry.size).toBe(0)
}

describe.runIf(WINDOWS)('closing a Git Bash Terminal on Windows, on a real pty', () => {
  // A command after which bash shows no prompt, one still running at the close, is written only on the
  // SIGHUP. So this test takes PROMPT_COMMAND away: with it the file has the commands before any signal.
  it('the SIGHUP of terminal.close alone writes the history: both commands typed before the close are in HISTFILE of the home', async (context) => {
    needsGitBash(context)
    const h = await harness({ shell: 'git-bash' })
    expect((await h.open()).shell).toBe('bash.exe')
    await h.run('unset PROMPT_COMMAND; echo unset-$((40+2))', /unset-42\r?\n/)
    const word = `worfy-history-${process.pid}-${Date.now()}`
    const first = unique(`${word}-one`)
    const second = unique(`${word}-two`)
    await h.run(first.command, first.output)
    await h.run(second.command, second.output)
    const file = join(home, '.bash_history')
    const written = async (): Promise<string> => (existsSync(file) ? readFile(file, 'utf8') : '')
    expect(await written(), 'the file before the close').not.toContain(word)
    await h.ok('terminal.close', { projectId: PROJECT, nodeId: NODE })
    expect(h.registry.size).toBe(0)
    // bash wrote the file when it exited by itself, on the SIGHUP: after Stop-Process there is none.
    // The close resolves after the exit.
    expect(existsSync(file), `${file} after the close`).toBe(true)
    const lines = (await written()).split(/\r?\n/)
    expect(lines).toContain(first.command)
    expect(lines).toContain(second.command)
  }, ms(30_000))

  // PROMPT_COMMAND of the Terminal runs `history -a` (gitBashEnv), so the file has a command while bash
  // still runs, before any signal (worfy-windows ticket 118). The close then adds no line twice.
  it('a command is in .bash_history before the close, and the close writes it no second time', async (context) => {
    needsGitBash(context)
    const h = await harness({ shell: 'git-bash' })
    await h.open()
    const word = `worfy-prompt-${process.pid}-${Date.now()}`
    const first = unique(`${word}-one`)
    await h.run(first.command, first.output)
    const file = join(home, '.bash_history')
    const lines = async (): Promise<string[]> => (existsSync(file) ? (await readFile(file, 'utf8')).split(/\r?\n/) : [])
    await vi.waitFor(async () => expect(await lines()).toContain(first.command), { timeout: ms(10_000), interval: 50 })
    await h.ok('terminal.close', { projectId: PROJECT, nodeId: NODE })
    expect((await lines()).filter((line) => line === first.command)).toHaveLength(1)
  }, ms(30_000))

  it('`$?` of a command reaches the next command with `history -a` in PROMPT_COMMAND', async (context) => {
    needsGitBash(context)
    const h = await harness({ shell: 'git-bash' })
    await h.open()
    await h.run('(exit 7)', /exit 7\)/)
    await h.run('echo status-$? "[$PROMPT_COMMAND]"', /status-7 \[.*history -a/)
    await h.ok('terminal.close', { projectId: PROJECT, nodeId: NODE })
  }, ms(30_000))

  // Empty is the usual way to turn the history off in a .bashrc. Bash says nothing about it at exit, so
  // `history -a` must not say it after every command.
  for (const [name, assignment] of [
    ['empty', 'HISTFILE='],
    ['in a folder that does not exist', 'HISTFILE=$HOME/none/.h'],
  ]) {
    it(`HISTFILE ${name}: no error after a command`, async (context) => {
      needsGitBash(context)
      const h = await harness({ shell: 'git-bash' })
      await h.open()
      await h.run(`${assignment}; echo off-$((40+2))`, /off-42\r?\n/)
      await h.run('echo one-$((40+2))', /one-42\r?\n/)
      await h.run('echo two-$((40+2))', /two-42\r?\n/)
      expect(h.text()).not.toMatch(/history:|cannot create/)
      await h.ok('terminal.close', { projectId: PROJECT, nodeId: NODE })
    }, ms(30_000))
  }

  it('after `unset HISTFILE` a command reaches no file, not even a ~/.history that exists', async (context) => {
    needsGitBash(context)
    const other = join(home, '.history')
    await writeFile(other, '')
    const h = await harness({ shell: 'git-bash' })
    await h.open()
    await h.run('unset HISTFILE; echo off-$((40+2))', /off-42\r?\n/)
    const word = `worfy-secret-${process.pid}-${Date.now()}`
    const secret = unique(word)
    await h.run(secret.command, secret.output)
    await h.run('echo next-$((40+2))', /next-42\r?\n/)
    await h.ok('terminal.close', { projectId: PROJECT, nodeId: NODE })
    expect(await readFile(other, 'utf8')).toBe('')
  }, ms(30_000))

  // The two values of the ticket that `;` as the separator would break, through a real pseudo-console.
  for (const [name, value] of [
    ['ends in `;`', 'SEEN=$((40+2));'],
    ['ends in a comment', 'SEEN=$((40+2)) # note'],
  ] as const) {
    it(`a PROMPT_COMMAND of the environment that ${name} still runs, and so does \`history -a\``, async (context) => {
      needsGitBash(context)
      const h = await harness({ shell: 'git-bash', env: { PROMPT_COMMAND: value } })
      await h.open()
      const word = `worfy-preset-${process.pid}-${Date.now()}`
      const first = unique(word)
      await h.run(first.command, first.output)
      await h.run('echo seen-$SEEN', /seen-42\r?\n/)
      const file = join(home, '.bash_history')
      await vi.waitFor(async () => expect((await readFile(file, 'utf8')).split(/\r?\n/)).toContain(first.command), { timeout: ms(10_000), interval: 50 })
      await h.ok('terminal.close', { projectId: PROJECT, nodeId: NODE })
    }, ms(30_000))
  }

  // On a busy machine kill.exe took longer than the 500 ms the helper used to give it: ended by then,
  // it had not delivered the SIGHUP, and bash wrote nothing (26 of 120 closes under a full vitest,
  // all 26 without a history file; worfy-windows ticket 116). That the history is written is the
  // test above, with the real kill.exe; here the stand-in never delivers, so only its time is read.
  it('a kill.exe still running after 700 ms is not cut off: it runs until the wait for bash ends', async (context) => {
    needsGitBash(context)
    const standIn = await spinningKill('slow-kill')
    const helper = recordingHelper(standIn.file)
    await openAndCloseWith(helper)
    skipWhenOutOfTime(context, helper)
    expect(helper.answers).toEqual(['ended'])
    expect(statSync(standIn.beat).mtimeMs - statSync(standIn.started).mtimeMs).toBeGreaterThan(700)
  }, ms(30_000))

  // kill.exe inherits the stdout of the helper, so one that outlives the helper holds back its answer
  // until execFile gives up at the time limit. execFile then still reports the exit code 0 of the
  // helper, so only the stand-in itself tells. This one delivers the SIGHUP: bash exits, and the
  // helper does not spend its whole wait on the way to its answer.
  it('a kill.exe that delivers its SIGHUP and never exits: the helper ends it before it answers', async (context) => {
    needsGitBash(context)
    const kill = gitBashKill(findGitBash(windowsEnv(home)) ?? '') ?? ''
    // cmd.exe reads a batch file in the OEM code page and expands every %.
    context.skip(!/^[\x20-\x7e]+$/.test(kill) || kill.includes('%'), 'a batch file cannot name this kill.exe')
    const standIn = await spinningKill('stuck-kill', `start "" /b "${kill}" %*`)
    const helper = recordingHelper(standIn.file)
    await openAndCloseWith(helper)
    skipWhenOutOfTime(context, helper)
    expect(helper.answers).toEqual(['ended'])
    expect(existsSync(standIn.beat), 'the stand-in ran').toBe(true)
    await rm(standIn.beat, { force: true, maxRetries: 5, retryDelay: 100 })
    await new Promise((done) => setTimeout(done, ms(500)))
    expect(existsSync(standIn.beat), 'the stand-in still runs after the answer').toBe(false)
  }, ms(30_000))

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
    await vi.waitFor(() => expect(consoleHosts().filter((pid) => !hostsBefore.has(pid))).toEqual([]), { timeout: ms(5000), interval: 500 })
  }, ms(90_000))
})

// The launcher of Git Bash the helper suspended cannot exit by itself: whatever fails on the way,
// the close must still end it. The bound of the close is put out of reach (60 s), so only the
// release of the close itself can end the launcher within the test.
describe.runIf(WINDOWS)('closing a Git Bash Terminal on Windows when a step fails: the suspended launcher is ended', () => {
  const FAR_BOUND_MS = 60_000

  /** Opens Git Bash, runs a command, closes it; answers the launcher pid and how long the close took. */
  async function openAndClose(h: Awaited<ReturnType<typeof harness>>): Promise<{ launcher: number; ms: number }> {
    const { pid: launcher } = await h.open()
    const { command, output } = unique('ready')
    await h.run(command, output)
    const started = Date.now()
    await h.ok('terminal.close', { projectId: PROJECT, nodeId: NODE })
    return { launcher, ms: Date.now() - started }
  }

  async function expectNothingLeft(launcher: number, hostsBefore: Set<number>): Promise<void> {
    expect(alive(launcher), `the launcher ${launcher}`).toBe(false)
    await vi.waitFor(() => expect(consoleHosts().filter((pid) => !hostsBefore.has(pid))).toEqual([]), { timeout: ms(5000), interval: 500 })
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
  }, ms(40_000))

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
  }, ms(40_000))

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
  }, ms(40_000))

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
  }, ms(40_000))

  it('closeAll with six Git Bash Terminals open, as quitting the app does, leaves no launcher, bash or console host', async (context) => {
    needsGitBash(context)
    const hostsBefore = new Set(consoleHosts())
    const nodeIds = Array.from({ length: 6 }, (_, index) => `q${index}`)
    const h = await harness({ shell: 'git-bash', nodes: nodeIds })
    const launchers = await Promise.all(
      nodeIds.map(async (nodeId) => {
        const { pid } = await h.open(nodeId)
        const { command, output } = unique(`open-${nodeId}`)
        await h.run(command, output, nodeId)
        return pid
      }),
    )
    await h.registry.closeAll()
    expect(h.registry.size).toBe(0)
    expect(launchers.filter((pid) => alive(pid))).toEqual([])
    await vi.waitFor(() => expect(consoleHosts().filter((pid) => !hostsBefore.has(pid))).toEqual([]), { timeout: ms(5000), interval: 500 })
  }, ms(60_000))
})
