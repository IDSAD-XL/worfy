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
import { endDescendants } from '../../src/main/terminal/pty'
import { alive, consoleHosts, folderLine, harness, home, needsWindowsPowerShellOffRunner, NODE, PROJECT, root, say, SAY_THE_FOLDER, SYSTEM_ROOT, threads, useTerminalScratch, WINDOWS, windowsEnv } from './terminal-harness'

vi.mock('electron', () => ({ app: { on: vi.fn() }, BrowserWindow: { getAllWindows: () => [] } }))

useTerminalScratch()

describe('terminal channels on a real pty', () => {
  // The shells of Windows on a real pseudo-console (worfy-windows ticket 10): only there.
  describe.runIf(WINDOWS)('on Windows', () => {
    it('open starts Windows PowerShell with -NoLogo in the Project root with TERM_PROGRAM=worfy; input reaches it, output comes back', async (context) => {
      needsWindowsPowerShellOffRunner(context)
      const h = await harness()
      const opened = await h.open()
      expect(opened).toStrictEqual({ pid: opened.pid, shell: 'powershell.exe', replay: '', end: 0, started: true, exited: null })

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
      if (findGitBash(process.env) === null) context.skip('this machine has no Git for Windows')
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
        await vi.waitFor(() => expect(h.text()).toMatch(pattern), { timeout: 10_000 })
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
  it('node-pty is the one the registry knows: its kill() has the helper process that the registry takes out', () => {
    const pty = spawnNodePty(win32.join(SYSTEM_ROOT, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoLogo', '-NoProfile'], { name: 'xterm-256color', cols: 80, rows: 24, cwd: root, env: windowsEnv(home) })
    const agent = (pty as unknown as { _agent?: { _getConsoleProcessList?: unknown } })._agent
    try {
      // When this fails after an update of node-pty, read withoutConsoleHelper in src/main/terminal/pty.ts again.
      expect(typeof agent?._getConsoleProcessList).toBe('function')
    } finally {
      // Without the helper here too: it would end this pid 5 s from now.
      if (agent !== undefined) agent._getConsoleProcessList = () => Promise.resolve([])
      pty.kill()
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
    await vi.waitFor(() => expect(h.text()).toMatch(/cmd=(\d+)\r?\n/), { timeout: 10_000 })
    const cmd = Number(/cmd=(\d+)\r?\n/.exec(h.text())?.[1])
    let grandchild = 0
    await vi.waitFor(
      async () => {
        grandchild = Number(await readFile(join(root, 'grandchild.pid'), 'utf8'))
        expect(grandchild).toBeGreaterThan(0)
      },
      { timeout: 10_000 },
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
  }, 60_000)

  it('close leaves no conhost.exe behind and starts no helper process; it is done well inside its bound', async (context) => {
    needsWindowsPowerShellOffRunner(context)
    const fork = vi.spyOn(childProcess, 'fork')
    const h = await harness({ nodes: ['n1', 'n2', 'n3'] })
    const before = consoleHosts()
    const took: number[] = []
    for (const nodeId of ['n1', 'n2', 'n3']) {
      await h.open(nodeId)
      await h.run(say('rea', 'dy'), /ready\r?\n/, nodeId)
      const started = performance.now()
      await h.ok('terminal.close', { projectId: PROJECT, nodeId })
      took.push(performance.now() - started)
    }
    expect(Math.max(...took)).toBeLessThan(3000)
    expect(h.registry.size).toBe(0)
    // Not more than before: the count before may still hold a console of an earlier test that is closing.
    // Three Terminals closed the old way would leave three more.
    await vi.waitFor(() => expect(consoleHosts()).toBeLessThanOrEqual(before), { timeout: 5000, interval: 500 })
    // node-pty's helper lists the console and, when it fails, ends the pid of the shell 5 s later.
    expect(fork).not.toHaveBeenCalled()
  }, 60_000)

  // worfy-windows ticket 22. Under the console of the system each such shell left its conhost.exe
  // until worfy quit: node-pty forgets a pseudo-console the moment its shell exits.
  it('a shell that exited on its own leaves no console host behind', async (context) => {
    needsWindowsPowerShellOffRunner(context)
    const h = await harness({ nodes: ['n1', 'n2', 'n3'] })
    const before = consoleHosts()
    for (const nodeId of ['n1', 'n2', 'n3']) {
      await h.open(nodeId)
      await h.run(say('rea', 'dy'), /ready\r?\n/, nodeId)
      await h.type('exit\r', nodeId)
      await vi.waitFor(() => expect(h.exits.map((exit) => exit.nodeId)).toContain(nodeId), { timeout: 5000 })
    }
    // Not more than before: the count before may still hold a console of an earlier test that is closing.
    await vi.waitFor(() => expect(consoleHosts()).toBeLessThanOrEqual(before), { timeout: 5000, interval: 500 })
  }, 60_000)

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
    await vi.waitFor(() => expect(h.exits).toEqual([{ projectId: PROJECT, nodeId: NODE, exitCode: 6, signal: null }]), { timeout: 8000, interval: 100 })
    expect(performance.now() - typed).toBeLessThan(8000)
    // The Node shows the exit; asking for its size again does not fail.
    expect((await h.open()).exited).toEqual({ exitCode: 6, signal: null })
  }, 60_000)

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
        await vi.waitFor(() => expect(h.exits.map((exit) => exit.nodeId)).toContain(nodeId), { timeout: 5000 })
      }
      await h.ok('terminal.close', { projectId: PROJECT, nodeId })
    }
    await vi.waitFor(() => expect(threads() - before).toBeLessThan(6), { timeout: 8000, interval: 500 })
  }, 120_000)

  it('a shell that exited on its own is asked nothing by its pid afterwards: no helper process is started', async (context) => {
    needsWindowsPowerShellOffRunner(context)
    const fork = vi.spyOn(childProcess, 'fork')
    const signals = vi.spyOn(process, 'kill')
    const h = await harness()
    const { pid } = await h.open()
    await h.run(say('rea', 'dy'), /ready\r?\n/)
    await h.type('exit 3\r')
    await vi.waitFor(() => expect(h.exits).toEqual([{ projectId: PROJECT, nodeId: NODE, exitCode: 3, signal: null }]), { timeout: 5000 })
    await h.ok('terminal.close', { projectId: PROJECT, nodeId: NODE })
    expect(fork).not.toHaveBeenCalled()
    expect(signals.mock.calls.filter(([target]) => target === pid)).toEqual([])
  })

  /** A PowerShell that starts a hidden node under itself, prints its pid and waits. */
  async function shellWithChild(): Promise<{ shell: number; child: number; startedBy: number; end: () => void }> {
    const node = findOnPath('node', process.env)
    if (node === null) throw new Error('no node on the Path')
    const script = `$p = Start-Process -WindowStyle Hidden -PassThru -FilePath '${node}' -ArgumentList '-e','setInterval(()=>{},1000)'; Write-Output ('child=' + $p.Id); Start-Sleep -Seconds 120`
    const shell = spawnProcess(win32.join(SYSTEM_ROOT, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true })
    const startedBy = Date.now()
    let output = ''
    shell.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()))
    await vi.waitFor(() => expect(output).toMatch(/child=\d+/), { timeout: 15_000 })
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
  }, 30_000)

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
  }, 30_000)
})
