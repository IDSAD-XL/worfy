// The Terminal on Windows, on a real pseudo-console: the shells that start there, and what closing a
// Terminal ends and leaves behind. These run only on Windows. Split out of terminal.test.ts
// (worfy-windows ticket 22) to keep that file under the gate's 1000-line bound; the harness is in terminal-harness.ts.
import childProcess, { spawn as spawnProcess } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { join, win32 } from 'node:path'
import { performance } from 'node:perf_hooks'
import { spawn as spawnNodePty } from 'node-pty'
import { describe, expect, it, vi } from 'vitest'
import { findGitBash, findOnPath } from '../../src/main/agent/env'
import { terminalKey } from '../../src/main/ipc/terminal'
import { endDescendants, spawnShellPty, type SpawnPty } from '../../src/main/terminal/pty'
import { alive, consoleHosts, folderLine, harness, home, needsWindowsPowerShellOffRunner, NODE, PROJECT, root, say, SAY_THE_FOLDER, settledHandleCount, SYSTEM_ROOT, threads, useTerminalScratch, WINDOWS, windowsEnv } from './terminal-harness'
import { ms } from '../time-scale'

vi.mock('electron', () => ({ app: { on: vi.fn() }, BrowserWindow: { getAllWindows: () => [] } }))

useTerminalScratch()

describe('terminal channels on a real pty', () => {
  // The shells of Windows on a real pseudo-console (worfy-windows ticket 10): only there.
  describe.runIf(WINDOWS)('on Windows', () => {
    it('open starts Windows PowerShell with -NoLogo in the Project root with TERM_PROGRAM=worfy; input reaches it, output comes back', async (context) => {
      needsWindowsPowerShellOffRunner(context)
      const h = await harness()
      const opened = await h.open()
      expect(opened).toStrictEqual({ pid: opened.pid, shell: 'powershell.exe', replay: '', end: 0, sizes: [], started: true, exited: null })

      await h.run(SAY_THE_FOLDER, folderLine(root))
      // The typed line holds the expression, the output its value.
      await h.run('Write-Output "worfy-$(2+3)"', /worfy-5\r?\n/)
      await h.run("Write-Output ('tp=' + $env:TERM_PROGRAM + ' term=' + $env:TERM)", /tp=worfy term=xterm-256color\r?\n/)
      await h.run("Write-Output ('args=' + [Environment]::CommandLine)", /args=.*powershell\.exe"? -NoLogo -NoProfile\r?\n/)
      // Every chunk carries the running length of all output.
      let total = 0
      for (const output of h.outputs) {
        total += output.data.length
        expect(output.end).toBe(total)
      }
    })

    it('pwsh from the Path is the shell when it is there, also as the alias of an MSIX install', async (context) => {
      const pwsh = findOnPath('pwsh', process.env)
      if (pwsh === null) context.skip('this machine has no pwsh on its Path')
      const h = await harness({ path: [win32.dirname(pwsh ?? '')] })
      const opened = await h.open()
      expect(opened.shell).toBe('pwsh.exe')
      await h.run('Write-Output "worfy-$(2+3)"', /worfy-5\r?\n/)
      await h.run("Write-Output ('edition=' + $PSVersionTable.PSEdition)", /edition=Core\r?\n/)
    })

    it('Git Bash is the shell when the settings of the Project ask for it', async (context) => {
      if (findGitBash(windowsEnv(home)) === null) context.skip('this machine has no Git for Windows')
      const h = await harness({ shell: 'git-bash' })
      const opened = await h.open()
      expect(opened.shell).toBe('bash.exe')
      await h.run('echo "worfy-$((2+3))"', /worfy-5\r?\n/)
      // An interactive login shell, as --login -i asks.
      await h.run('case $- in *i*) echo interactive=yes;; esac', /interactive=yes\r?\n/)
      await h.run('shopt -q login_shell && echo login=yes', /login=yes\r?\n/)
    })

    it('terminal.close ends what runs in the shell: a program started in it, and one started with Start-Process', async (context) => {
      needsWindowsPowerShellOffRunner(context)
      const node = findOnPath('node', process.env)
      if (node === null) context.skip('this machine has no node on its Path')
      await writeFile(join(root, 'keep.js'), 'setInterval(() => {}, 1000)\n')
      const h = await harness()
      const { pid } = await h.open()
      const number = async (pattern: RegExp): Promise<number> => {
        await vi.waitFor(() => expect(h.text()).toMatch(pattern), { timeout: ms(10_000) })
        return Number(pattern.exec(h.text())?.[1])
      }
      // A program with a window and a console of its own: still a child of the shell.
      await h.type(`$p = Start-Process -WindowStyle Hidden -PassThru -WorkingDirectory (Get-Location).Path -FilePath '${node}' -ArgumentList 'keep.js'; Write-Output ('started=' + $p.Id)\r`)
      const started = await number(/started=(\d+)\r?\n/)
      // A program that holds the terminal: the shell waits for it.
      await h.type(`& '${node}' -e "console.log('pid=' + process.pid); setInterval(() => {}, 1000)"\r`)
      const held = await number(/pid=(\d+)\r?\n/)
      try {
        expect([alive(pid), alive(started), alive(held)]).toEqual([true, true, true])

        await h.ok('terminal.close', { projectId: PROJECT, nodeId: NODE })

        // close() resolves when all three are gone and the registry has forgotten the shell: nothing to wait for.
        expect([alive(pid), alive(started), alive(held)]).toEqual([false, false, false])
        expect(h.registry.has(terminalKey(PROJECT, NODE))).toBe(false)
      } finally {
        // A failed test must not leave the two programs running on the machine.
        for (const left of [started, held]) {
          try {
            process.kill(left)
          } catch {
            // Gone, as it should be.
          }
        }
      }
    })
  })
})

// What closing a Terminal on Windows leaves behind, and whom it may end (worfy-windows ticket 10,
// review round 1): real pseudo-consoles and real processes, so only there.
describe.runIf(WINDOWS)('closing a Terminal on Windows, on a real pty', () => {
  // Review of PR #280 (ticket 42 of worfy-windows, item 5): this ran node-pty on the console of the
  // system, which the app no longer uses.
  it('node-pty as the app starts it (spawnShellPty) is the one the registry knows: the helper of kill(), the exit code, the input socket and the thread that reads the output', () => {
    const pty = spawnShellPty(win32.join(SYSTEM_ROOT, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoLogo', '-NoProfile'], { name: 'xterm-256color', cols: 80, rows: 24, cwd: root, env: windowsEnv(home) })
    const agent = (pty as unknown as { _agent?: { _getConsoleProcessList?: unknown; _conoutSocketWorker?: { dispose?: unknown }; inSocket?: { on?: unknown } } })._agent
    try {
      // When this fails after an update of node-pty, read src/main/terminal/windows-pty.ts again.
      expect(typeof agent?._getConsoleProcessList).toBe('function')
      expect(typeof agent?._conoutSocketWorker?.dispose).toBe('function')
      expect(typeof agent?.inSocket?.on).toBe('function')
      expect(agent !== undefined && 'exitCode' in agent).toBe(true)
    } finally {
      pty.kill()
      // As the registry does after kill() (stopOutputWorker): else the thread stays.
      if (typeof agent?._conoutSocketWorker?.dispose === 'function') (agent._conoutSocketWorker as { dispose: () => void }).dispose()
    }
  })

  it('close ends a program two levels under the shell: the shell started cmd.exe, and cmd.exe the program', async (context) => {
    needsWindowsPowerShellOffRunner(context)
    const node = findOnPath('node', process.env)
    if (node === null) context.skip('this machine has no node on its Path')
    // The program says who it is by a file in the Project folder: its output goes to no terminal.
    await writeFile(join(root, 'keep.js'), "require('node:fs').writeFileSync('grandchild.pid', String(process.pid)); setInterval(() => {}, 1000)\n")
    const h = await harness()
    const { pid } = await h.open()
    // cmd.exe in a window of its own: neither it nor what it starts is on the console of the shell.
    await h.type(`$p = Start-Process -WindowStyle Hidden -PassThru -WorkingDirectory (Get-Location).Path -FilePath $env:ComSpec -ArgumentList '/d','/c','"${node}" keep.js'; Write-Output ('cmd=' + $p.Id)\r`)
    await vi.waitFor(() => expect(h.text()).toMatch(/cmd=(\d+)\r?\n/), { timeout: ms(10_000) })
    const cmd = Number(/cmd=(\d+)\r?\n/.exec(h.text())?.[1])
    let grandchild = 0
    await vi.waitFor(
      async () => {
        grandchild = Number(await readFile(join(root, 'grandchild.pid'), 'utf8'))
        expect(grandchild).toBeGreaterThan(0)
      },
      { timeout: ms(10_000) },
    )
    try {
      expect([alive(pid), alive(cmd), alive(grandchild)]).toEqual([true, true, true])
      expect(grandchild).not.toBe(cmd)
      await h.ok('terminal.close', { projectId: PROJECT, nodeId: NODE })
      expect([alive(pid), alive(cmd), alive(grandchild)]).toEqual([false, false, false])
    } finally {
      for (const left of [cmd, grandchild]) {
        try {
          process.kill(left)
        } catch {
          // Gone, as it should be.
        }
      }
    }
  }, ms(60_000))

  // Review of PR #280 (item 5): the count of hosts was compared, not their pids, and nothing showed
  // that the host of the package's console (OpenConsole.exe) was counted at all.
  it('close leaves no console host behind, neither conhost.exe nor OpenConsole.exe; it is done well inside its bound', async (context) => {
    needsWindowsPowerShellOffRunner(context)
    const h = await harness({ nodes: ['n1', 'n2', 'n3'] })
    const before = new Set(consoleHosts())
    const seen = new Set<number>()
    const took: number[] = []
    for (const nodeId of ['n1', 'n2', 'n3']) {
      await h.open(nodeId)
      await h.run(say('rea', 'dy'), /ready\r?\n/, nodeId)
      expect(newHosts(before, seen).length, 'the host of the console of a running shell is counted').toBeGreaterThanOrEqual(1)
      const started = performance.now()
      await h.ok('terminal.close', { projectId: PROJECT, nodeId })
      took.push(performance.now() - started)
    }
    expect(Math.max(...took)).toBeLessThan(3000)
    expect(h.registry.size).toBe(0)
    // None that was not there before: the set before may still hold a console of an earlier test
    // that is closing. Three Terminals closed the old way would leave three.
    await vi.waitFor(() => expect(consoleHosts().filter((pid) => !before.has(pid))).toEqual([]), { timeout: ms(5000), interval: 500 })
  }, ms(60_000))

  // worfy-windows ticket 22. Under the console of the system each such shell left its conhost.exe
  // until worfy quit: node-pty forgets a pseudo-console the moment its shell exits.
  it('a shell that exited on its own leaves no console host behind', async (context) => {
    needsWindowsPowerShellOffRunner(context)
    const h = await harness({ nodes: ['n1', 'n2', 'n3'] })
    const before = new Set(consoleHosts())
    const seen = new Set<number>()
    for (const nodeId of ['n1', 'n2', 'n3']) {
      await h.open(nodeId)
      await h.run(say('rea', 'dy'), /ready\r?\n/, nodeId)
      expect(newHosts(before, seen).length, 'the host of the console of a running shell is counted').toBeGreaterThanOrEqual(1)
      await h.type('exit\r', nodeId)
      await vi.waitFor(() => expect(h.exits.map((exit) => exit.nodeId)).toContain(nodeId), { timeout: ms(5000) })
    }
    // None that was not there before: the set before may still hold a console of an earlier test that is closing.
    await vi.waitFor(() => expect(consoleHosts().filter((pid) => !before.has(pid))).toEqual([]), { timeout: ms(5000), interval: 500 })
  }, ms(60_000))

  // Review of PR #280. On the console of the package node-pty reports an exit only when the console
  // closes, and the console lives while any process is on it: measured on the PC, this shell was
  // reported 30 s after it had gone, when the program it left behind ended. The registry asks
  // node-pty for the exit code and reports the exit itself.
  it('a shell that exits while a program it started still holds its console is reported as exited within seconds, with its exit code', async (context) => {
    needsWindowsPowerShellOffRunner(context)
    const h = await harness()
    await h.open()
    await h.run(say('rea', 'dy'), /ready\r?\n/)
    const typed = performance.now()
    // The program is silent, sits on the console of the shell, and works in a folder no test removes.
    await h.type("Start-Process -NoNewWindow -WorkingDirectory $env:SystemRoot powershell -ArgumentList '-NoProfile','-Command','Start-Sleep 15'; exit 6\r")
    await vi.waitFor(() => expect(h.exits).toEqual([{ projectId: PROJECT, nodeId: NODE, exitCode: 6, signal: null }]), { timeout: ms(8000), interval: 100 })
    expect(performance.now() - typed).toBeLessThan(8000)
    // The Node shows the exit; asking for its size again does not fail.
    expect((await h.open()).exited).toEqual({ exitCode: 6, signal: null })
  }, ms(60_000))

  // With the console of the package node-pty stops the thread that reads the output only when output
  // comes after kill(), and none does: the registry stops it (stopOutputWorker). Without that each
  // Terminal leaves one thread, so sixteen leave sixteen; a few come and go on their own.
  it('neither a shell that exited on its own nor a closed one leaves a thread behind', async (context) => {
    needsWindowsPowerShellOffRunner(context)
    const nodes = Array.from({ length: 16 }, (_, index) => `n${index}`)
    const h = await harness({ nodes })
    const before = threads()
    for (const [index, nodeId] of nodes.entries()) {
      await h.open(nodeId)
      await h.run(say('rea', 'dy'), /ready\r?\n/, nodeId)
      if (index % 2 === 0) {
        await h.type('exit\r', nodeId)
        await vi.waitFor(() => expect(h.exits.map((exit) => exit.nodeId)).toContain(nodeId), { timeout: ms(5000) })
      }
      await h.ok('terminal.close', { projectId: PROJECT, nodeId })
    }
    await vi.waitFor(() => expect(threads() - before).toBeLessThan(6), { timeout: ms(8000), interval: 500 })
  }, ms(120_000))

  // Review of PR #280 (item 5): on the console of the package kill() starts no helper at all, so
  // this ran on that console without proving anything. On the console of the system — a spawn of
  // its own given to the registry — kill() does start one, and the registry takes it out.
  it('a shell on the console of the system that exited on its own is asked nothing by its pid afterwards: no helper process is started', async (context) => {
    needsWindowsPowerShellOffRunner(context)
    const fork = vi.spyOn(childProcess, 'fork')
    const signals = vi.spyOn(process, 'kill')
    const onTheSystemConsole: SpawnPty = (shell, args, options) => spawnNodePty(shell, [...args, '-NoProfile'], options)
    const h = await harness({ spawn: onTheSystemConsole })
    const { pid } = await h.open()
    await h.run(say('rea', 'dy'), /ready\r?\n/)
    await h.type('exit 3\r')
    await vi.waitFor(() => expect(h.exits).toEqual([{ projectId: PROJECT, nodeId: NODE, exitCode: 3, signal: null }]), { timeout: ms(5000) })
    await h.ok('terminal.close', { projectId: PROJECT, nodeId: NODE })
    expect(fork).not.toHaveBeenCalled()
    expect(signals.mock.calls.filter(([target]) => target === pid)).toEqual([])
  })

  /** The console hosts that are in neither set, added to `seen`. */
  function newHosts(before: ReadonlySet<number>, seen: Set<number>): number[] {
    const fresh = consoleHosts().filter((pid) => !before.has(pid) && !seen.has(pid))
    for (const pid of fresh) seen.add(pid)
    return fresh
  }

  /** A PowerShell that starts a hidden node under itself, prints its pid and waits. */
  async function shellWithChild(): Promise<{ shell: number; child: number; startedBy: number; end: () => void }> {
    const node = findOnPath('node', process.env)
    if (node === null) throw new Error('no node on the Path')
    const script = `$p = Start-Process -WindowStyle Hidden -PassThru -FilePath '${node}' -ArgumentList '-e','setInterval(()=>{},1000)'; Write-Output ('child=' + $p.Id); Start-Sleep -Seconds 120`
    const shell = spawnProcess(win32.join(SYSTEM_ROOT, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true })
    const startedBy = Date.now()
    let output = ''
    shell.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()))
    await vi.waitFor(() => expect(output).toMatch(/child=\d+/), { timeout: ms(15_000) })
    const child = Number(/child=(\d+)/.exec(output)?.[1])
    const end = () => {
      for (const pid of [child, shell.pid ?? 0]) {
        try {
          process.kill(pid)
        } catch {
          // Gone.
        }
      }
    }
    return { shell: shell.pid ?? 0, child, startedBy, end }
  }

  it('endDescendants ends what is under the shell and leaves the shell', async (context) => {
    if (findOnPath('node', process.env) === null) context.skip('this machine has no node on its Path')
    const started = await shellWithChild()
    try {
      expect([alive(started.shell), alive(started.child)]).toEqual([true, true])
      expect(await endDescendants({ pid: started.shell, startedBy: started.startedBy })).toBe('ended')
      expect([alive(started.shell), alive(started.child)]).toEqual([true, false])
    } finally {
      started.end()
    }
  })

  it('endDescendants ends nothing when the process with the pid of the shell was created after the shell was started: it is another process', async (context) => {
    if (findOnPath('node', process.env) === null) context.skip('this machine has no node on its Path')
    const started = await shellWithChild()
    try {
      // The registry started "its shell" a minute before this process was created: the pid was given out again.
      expect(await endDescendants({ pid: started.shell, startedBy: started.startedBy - 60_000 })).toBe('gone')
      expect([alive(started.shell), alive(started.child)]).toEqual([true, true])
      // And a pid nobody has.
      await expect(endDescendants({ pid: 4_194_300, startedBy: Date.now() })).resolves.toBe('gone')
    } finally {
      started.end()
    }
  })
})

// worfy-windows ticket 92. In node-pty 1.2.0-beta.15 the thread that waits for the shell forgets
// the pseudo-console when the shell exits and never closes it (src/win/conpty.cc, SetupExitCallback;
// upstream microsoft/node-pty#965). kill() closes it only while node-pty still knows it: after a
// close of a running shell. Every other end leaves two handles in this process until it quits:
// a Process handle to the finished OpenConsole.exe and the pipe of the pseudo-console. A close of
// Git Bash leaves none: the helper suspends its launcher (bin\bash.exe) so it cannot exit before
// kill() (ticket 93, test/contract/terminal-git-bash-close.test.ts). Nothing node-pty gives JavaScript reaches the pseudo-console after the
// exit: it keeps only a number, and the native kill(), resize() and clear() look that number up in
// the list the exit thread has already cleared.
describe.runIf(WINDOWS)('the handles a shell leaves in this process on Windows, on a real pty', () => {
  // shortcut: node-pty leaks two handles per shell that ends without a close of a running one (microsoft/node-pty#965). When a node-pty with PR #990 or #991 is in, this test goes red: set this to 0.
  const LEAK_PER_SHELL = 2
  // Handles that come and go on their own in this process (an Event, a thread, an ALPC port), and
  // the ones the first shells of a run open once (EtwRegistration): the warm-up takes those.
  const NOISE = 5
  const SHELLS = 10

  /** Opens the Terminals four at a time, waits for each prompt, types `exit`, waits for the exit and closes it. */
  async function exitShells(h: Awaited<ReturnType<typeof harness>>, nodeIds: readonly string[]): Promise<void> {
    for (let i = 0; i < nodeIds.length; i += 4) {
      await Promise.all(
        nodeIds.slice(i, i + 4).map(async (nodeId) => {
          await h.open(nodeId)
          await h.run(say('rea', 'dy'), /ready\r?\n/, nodeId)
          await h.type('exit\r', nodeId)
          await vi.waitFor(() => expect(h.exits.map((exit) => exit.nodeId)).toContain(nodeId), { timeout: ms(10_000) })
          await h.ok('terminal.close', { projectId: PROJECT, nodeId })
        }),
      )
    }
  }

  it(`PowerShell, ended by exit: ${SHELLS} shells leave ${LEAK_PER_SHELL} handles each in this process, give or take a few`, async (context) => {
    needsWindowsPowerShellOffRunner(context)
    const warmUp = Array.from({ length: 4 }, (_, index) => `w${index}`)
    const measured = Array.from({ length: SHELLS }, (_, index) => `n${index}`)
    const h = await harness({ nodes: [...warmUp, ...measured] })
    // An earlier test of this file may leave a console host open (the console of the system forgets
    // its pseudo-console, ticket 22): only the ones these shells open count.
    const hostsBefore = new Set(consoleHosts())
    await exitShells(h, warmUp)
    const before = await settledHandleCount()
    await exitShells(h, measured)
    expect(h.registry.size).toBe(0)
    // One reading of a settled count: a reading taken while the output threads still close could
    // land inside the range by chance after node-pty is fixed.
    const added = (await settledHandleCount()) - before
    expect(Math.abs(added - SHELLS * LEAK_PER_SHELL), `added ${added} handles`).toBeLessThanOrEqual(NOISE)
    await vi.waitFor(() => expect(consoleHosts().filter((pid) => !hostsBefore.has(pid))).toEqual([]), { timeout: ms(5000), interval: 500 })
  }, ms(60_000))
})
