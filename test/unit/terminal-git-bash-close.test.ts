// How a Git Bash Terminal of Windows is closed (worfy-windows ticket 93): the helper that ends the
// processes under the shell first holds the launcher (bin\bash.exe), sends SIGHUP to bash through
// kill.exe of the same Git for Windows and waits up to HANGUP_GRACE_MS, and only then ends what is
// left; the registry asks for that for Git Bash only. The real close is in
// test/contract/terminal-git-bash-close.test.ts; here the script text, the choice of kill.exe and
// what the registry passes, on any machine.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakePty, OPEN, SINK, winEnv } from './terminal-fake-pty'

/** The stand-in of execFile for the helper. */
const run = vi.hoisted(() => ({ execFile: vi.fn() }))
vi.mock('node:child_process', async (original) => ({ ...(await original<typeof import('node:child_process')>()), execFile: run.execFile }))
vi.mock('electron', () => ({ app: { on: vi.fn() }, BrowserWindow: { getAllWindows: () => [] } }))

const { DESCENDANTS_TIMEOUT_MS, descendantsScript, endDescendants, gitBashKill, HANGUP_GRACE_MS, KILL_GRACE_MS, TerminalRegistry } = await import('../../src/main/terminal/pty')
type StartedShell = import('../../src/main/terminal/pty').StartedShell

afterEach(() => {
  run.execFile.mockReset()
  vi.restoreAllMocks()
})

const KILL = 'C:\\Program Files\\Git\\usr\\bin\\kill.exe'
const SHELL = { pid: 4242, startedBy: 1_760_000_000_123 }

describe('gitBashKill: kill.exe of the Git for Windows of a shell', () => {
  it('is usr\\bin\\kill.exe next to the bin folder of the launcher, by any case of the names', () => {
    expect(gitBashKill('C:\\Program Files\\Git\\bin\\bash.exe')).toBe(KILL)
    expect(gitBashKill('D:\\Tools\\PortableGit\\BIN\\Bash.EXE')).toBe('D:\\Tools\\PortableGit\\usr\\bin\\kill.exe')
  })

  it('is null for any other shell: PowerShell, pwsh, a bash.exe outside a bin folder', () => {
    for (const file of ['C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', 'C:\\Program Files\\Git\\usr\\bin\\bash.exe', 'C:\\Windows\\System32\\bash.exe']) {
      expect(gitBashKill(file), file).toBeNull()
    }
  })
})

describe('descendantsScript with hangup: the order of a Git Bash close', () => {
  const lines = descendantsScript({ ...SHELL, hangup: KILL }).split('\n')
  const at = (text: string): number => {
    const index = lines.findIndex((line) => line.includes(text))
    expect(index, text).toBeGreaterThan(-1)
    return index
  }

  it('walks the tree, holds the launcher, sends SIGHUP to bash, waits, and only then ends what is left', () => {
    const walked = at('$queue.Enqueue($child)')
    const held = at('NtSuspendProcess($launcher.Handle)')
    const hungUp = at('& $kill -HUP -W $bash.Id')
    const waited = at('$bash.WaitForExit($wait)')
    const stopped = at('Stop-Process -InputObject $process -Force')
    expect(walked).toBeLessThan(held)
    expect(held).toBeLessThan(hungUp)
    expect(hungUp).toBeLessThan(waited)
    expect(waited).toBeLessThan(stopped)
    // The launcher is the shell the walk took for the one that was started, by its start time.
    expect(lines[at('$launcher = Get-Process')]).toBe('  $launcher = Get-Process -Id 4242')
    // Only the bash right under the launcher gets the signal; the rest is ended as before.
    expect(lines.slice(at('foreach ($child in $found)'), hungUp).join('\n')).toContain("$process.ProcessName -eq 'bash'")
  })

  it('waits at most HANGUP_GRACE_MS from the signal, and that leaves the helper time inside its own limit', () => {
    expect(lines[at('$deadline =')]).toBe(`  $deadline = [DateTime]::UtcNow.AddMilliseconds(${HANGUP_GRACE_MS})`)
    expect(HANGUP_GRACE_MS).toBe(KILL_GRACE_MS)
    // Windows PowerShell starts in about 0.45 s on the owner's PC, kill.exe in about 0.05 s.
    expect(DESCENDANTS_TIMEOUT_MS - HANGUP_GRACE_MS).toBeGreaterThanOrEqual(2000)
  })

  it('names kill.exe as a literal: a single quote in its path is doubled, and the script has no double quote', () => {
    const script = descendantsScript({ ...SHELL, hangup: "C:\\Git o'Brien\\usr\\bin\\kill.exe" })
    expect(script).toContain("$kill = 'C:\\Git o''Brien\\usr\\bin\\kill.exe'")
    expect(script).toContain('if (Test-Path -LiteralPath $kill) {')
    expect(script).not.toContain('"')
  })

  it('says `not held` when the launcher could not be suspended, and still ends with the answer line', () => {
    expect(lines).toContain("if (-not $held) { 'not held' }")
    expect(lines.at(-1)).toBe("'ended ' + $ended + ' of ' + $found.Count + ' left ' + ($left -join ',')")
  })

  it('without hangup the script is the one of every other shell: no hold, no signal', () => {
    const script = descendantsScript(SHELL)
    expect(script).toBe(descendantsScript({ ...SHELL, hangup: undefined }))
    expect(script).not.toContain('NtSuspendProcess')
    expect(script).not.toContain('kill')
  })
})

describe('endDescendants with hangup', () => {
  type Callback = (error: Error | null, stdout: string, stderr: string) => void
  const answer = (stdout: string) => run.execFile.mockImplementation((_file: string, _args: string[], _options: unknown, done: Callback) => done(null, stdout, ''))

  it('passes the script with the hold and the signal to Windows PowerShell', async () => {
    answer('ended 1 of 1 left \r\n')
    await expect(endDescendants({ ...SHELL, hangup: KILL })).resolves.toBe('ended')
    const [, args] = run.execFile.mock.calls[0] as [string, string[]]
    expect(args).toEqual(['-NoProfile', '-NonInteractive', '-Command', descendantsScript({ ...SHELL, hangup: KILL })])
  })

  it('warns once when the launcher was not held, and still answers by the last line', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    answer('not held\r\nended 1 of 1 left \r\n')
    await expect(endDescendants({ ...SHELL, hangup: KILL })).resolves.toBe('ended')
    expect(warn.mock.calls).toEqual([['[terminal] the launcher 4242 of Git Bash could not be suspended: closing it may leave two handles of its pseudo-console in this process']])
  })
})

describe('TerminalRegistry on Windows: what the close of Git Bash asks of the helper', () => {
  const GIT_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe'
  const exists = (path: string): boolean => path === GIT_BASH

  async function closeWith(setting: 'git-bash' | 'powershell'): Promise<{ shells: StartedShell[]; killsAtHelper: number[]; kills: number }> {
    const fake = fakePty(999_993_093)
    const shells: StartedShell[] = []
    const killsAtHelper: number[] = []
    const registry = new TerminalRegistry({
      env: winEnv,
      spawn: () => fake.pty,
      platform: 'win32',
      exists,
      endDescendants: (shell) => {
        shells.push(shell)
        killsAtHelper.push(fake.kills.length)
      },
    })
    await registry.open('a', { ...OPEN, shell: () => setting }, {}, SINK)
    await registry.close('a')
    return { shells, killsAtHelper, kills: fake.kills.length }
  }

  it('Git Bash: the helper gets kill.exe of its Git for Windows, before kill() of the pty', async () => {
    const { shells, killsAtHelper, kills } = await closeWith('git-bash')
    expect(shells).toEqual([{ pid: 999_993_093, startedBy: expect.any(Number) as number, hangup: KILL }])
    expect(killsAtHelper).toEqual([0])
    expect(kills).toBe(1)
  })

  it('PowerShell: the helper gets no hangup, as before', async () => {
    const { shells } = await closeWith('powershell')
    expect(shells).toEqual([{ pid: 999_993_093, startedBy: expect.any(Number) as number }])
  })
})
