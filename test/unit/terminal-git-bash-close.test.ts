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

const { DESCENDANTS_TIMEOUT_MS, descendantsScript, endDescendants, endShell, endShellScript, HANGUP_GRACE_MS, HANGUP_SIGNAL_BOUND_MS, HANGUP_TIMEOUT_MS } = await import('../../src/main/terminal/windows-pty')
const { gitBashKill } = await import('../../src/main/agent/env')
const { TerminalRegistry, WINDOWS_CLOSE_BOUND_MS } = await import('../../src/main/terminal/pty')
type StartedShell = import('../../src/main/terminal/windows-pty').StartedShell

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

  it('is undefined for any other shell: PowerShell, pwsh, a bash.exe outside a bin folder', () => {
    for (const file of ['C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', 'C:\\Program Files\\Git\\usr\\bin\\bash.exe', 'C:\\Windows\\System32\\bash.exe']) {
      expect(gitBashKill(file), file).toBeUndefined()
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
    const hungUp = at('$signal = [System.Diagnostics.Process]::Start($info)')
    const waited = at('$bash.WaitForExit($wait)')
    const stopped = at('Stop-Process -InputObject $process -Force')
    expect(walked).toBeLessThan(held)
    expect(held).toBeLessThan(hungUp)
    expect(hungUp).toBeLessThan(waited)
    expect(waited).toBeLessThan(stopped)
    // The launcher is the shell the walk took for the one that was started, by its start time:
    // a process that got its pid since is never suspended.
    expect(lines[at('$launcher = Get-Process')]).toBe('$launcher = Get-Process -Id 4242 -ErrorAction SilentlyContinue')
    const guard = lines.indexOf('    if ($started.AddMilliseconds(1) -ge $born -and $started.AddMilliseconds(-1) -le $born) {')
    expect(guard).toBeGreaterThan(at('$born = $shell.CreationDate.ToUniversalTime()'))
    expect(guard).toBeLessThan(held)
    // NtSuspendProcess answers an NTSTATUS, not an HRESULT: the int comes back as it is.
    expect(lines[at('SetImplementationFlags')]).toBe("      $method.SetImplementationFlags('PreserveSig')")
    expect(at('SetImplementationFlags')).toBeLessThan(at('$native = $type.CreateType()'))
  })

  it('signals only the bash right under the launcher, and only while its start time is the one the walk read', () => {
    expect(lines.slice(at('$bashes = New-Object'), at('$kill = '))).toEqual([
      '$bashes = New-Object System.Collections.ArrayList',
      'foreach ($child in $found) {',
      '  if ($child.ParentProcessId -ne $shell.ProcessId) { continue }',
      '  $process = Get-Process -Id $child.ProcessId -ErrorAction SilentlyContinue',
      "  if ($null -eq $process -or $process.ProcessName -ne 'bash') { continue }",
      '  try {',
      '    $started = $process.StartTime.ToUniversalTime()',
      '    $born = $child.CreationDate.ToUniversalTime()',
      '    if ($started.AddMilliseconds(1) -ge $born -and $started.AddMilliseconds(-1) -le $born) { [void]$bashes.Add($process) }',
      '  } catch { }',
      '}',
    ])
  })

  it('runs kill.exe with pipes of its own and ends it after HANGUP_SIGNAL_BOUND_MS', () => {
    const start = at('$info = New-Object System.Diagnostics.ProcessStartInfo')
    expect(lines.slice(start, at('$signal = [System.Diagnostics.Process]::Start($info)') + 2)).toEqual([
      "      $info = New-Object System.Diagnostics.ProcessStartInfo -ArgumentList $kill, ('-HUP -W ' + $bash.Id)",
      '      $info.UseShellExecute = $false',
      '      $info.CreateNoWindow = $true',
      '      $info.RedirectStandardInput = $true',
      '      $info.RedirectStandardOutput = $true',
      '      $info.RedirectStandardError = $true',
      '      $signal = [System.Diagnostics.Process]::Start($info)',
      `      if (-not $signal.WaitForExit(${HANGUP_SIGNAL_BOUND_MS})) { $signal.Kill() }`,
    ])
  })

  it('waits at most HANGUP_GRACE_MS from the signal', () => {
    expect(lines[at('$deadline =')]).toBe(`  $deadline = [DateTime]::UtcNow.AddMilliseconds(${HANGUP_GRACE_MS})`)
  })

  it('names kill.exe as a literal: every quote PowerShell takes for a single quote is doubled, and the script has no double quote', () => {
    // U+2018-U+201B end a single-quoted string of PowerShell as well (checked on the PC with Windows PowerShell 5.1).
    expect(descendantsScript({ ...SHELL, hangup: 'C:\\Git o\u2019Brien\\a\u2018b\u201Ac\u201Bd\\kill.exe' })).toContain(
      "$kill = 'C:\\Git o\u2019\u2019Brien\\a\u2018\u2018b\u201A\u201Ac\u201B\u201Bd\\kill.exe'",
    )
    const script = descendantsScript({ ...SHELL, hangup: "C:\\Git o'Brien\\usr\\bin\\kill.exe" })
    expect(script).toContain("$kill = 'C:\\Git o''Brien\\usr\\bin\\kill.exe'")
    expect(script).toContain('if (Test-Path -LiteralPath $kill) {')
    expect(script).not.toContain('"')
  })

  it('says `not held` only for a running launcher that could not be suspended, and still ends with the answer line', () => {
    // A launcher that has exited by itself (its shell exited as the close came) leaks nothing more.
    expect(lines).toContain("try { if ($running -and -not $held -and -not $launcher.HasExited) { 'not held' } } catch { }")
    expect(lines.indexOf('      $running = $true')).toBeLessThan(at('NtSuspendProcess($launcher.Handle)'))
    expect(lines.at(-1)).toBe("'ended ' + $ended + ' of ' + $found.Count + ' left ' + ($left -join ',')")
  })

  it('without hangup the script is the one of every other shell: no hold, no signal', () => {
    const script = descendantsScript(SHELL)
    expect(script).toBe(descendantsScript({ ...SHELL, hangup: undefined }))
    expect(script).not.toContain('NtSuspendProcess')
    expect(script).not.toContain('kill')
  })
})

describe('descendantsScript with hangup, as a whole', () => {
  it('is this text for one Git Bash, byte for byte: only tests on Windows run it', () => {
    expect(descendantsScript({ ...SHELL, hangup: KILL }).split('\n')).toEqual([
      "$ErrorActionPreference = 'Stop'",
      "$all = @(Get-CimInstance -Query 'SELECT ProcessId, ParentProcessId, CreationDate FROM Win32_Process')",
      '$shell = $all | Where-Object { $_.ProcessId -eq 4242 } | Select-Object -First 1',
      "if ($null -eq $shell -or $null -eq $shell.CreationDate -or $shell.CreationDate.ToUniversalTime().Ticks -gt 638955968002230000) { 'gone'; exit 0 }",
      '$under = @{}',
      'foreach ($each in $all) {',
      '  $key = [string]$each.ParentProcessId',
      '  if (-not $under.ContainsKey($key)) { $under[$key] = New-Object System.Collections.ArrayList }',
      '  [void]$under[$key].Add($each)',
      '}',
      '$found = New-Object System.Collections.ArrayList',
      '$seen = @{ [string]$shell.ProcessId = $true }',
      '$queue = New-Object System.Collections.Queue',
      '$queue.Enqueue($shell)',
      'while ($queue.Count -gt 0) {',
      '  $parent = $queue.Dequeue()',
      '  foreach ($child in @($under[[string]$parent.ProcessId])) {',
      '    if ($null -eq $child -or $seen.ContainsKey([string]$child.ProcessId)) { continue }',
      '    if ($null -eq $child.CreationDate -or $child.CreationDate.ToUniversalTime() -lt $parent.CreationDate.ToUniversalTime()) { continue }',
      '    $seen[[string]$child.ProcessId] = $true',
      '    [void]$found.Add($child)',
      '    $queue.Enqueue($child)',
      '  }',
      '}',
      '$held = $false',
      '$running = $false',
      '$launcher = Get-Process -Id 4242 -ErrorAction SilentlyContinue',
      'try {',
      '  if ($null -ne $launcher -and -not $launcher.HasExited) {',
      '    $started = $launcher.StartTime.ToUniversalTime()',
      '    $born = $shell.CreationDate.ToUniversalTime()',
      '    if ($started.AddMilliseconds(1) -ge $born -and $started.AddMilliseconds(-1) -le $born) {',
      '      $running = $true',
      "      $type = [AppDomain]::CurrentDomain.DefineDynamicAssembly((New-Object Reflection.AssemblyName 'WorfyHangup'), 'Run').DefineDynamicModule('WorfyHangup').DefineType('WorfyHangup', 'Public,Class')",
      "      $method = $type.DefinePInvokeMethod('NtSuspendProcess', 'ntdll.dll', 'Public,Static,PinvokeImpl', 'Standard', [int], [Type[]]@([IntPtr]), 'Winapi', 'Auto')",
      "      $method.SetImplementationFlags('PreserveSig')",
      '      $native = $type.CreateType()',
      '      $held = $native::NtSuspendProcess($launcher.Handle) -eq 0',
      '    }',
      '  }',
      '} catch { }',
      "try { if ($running -and -not $held -and -not $launcher.HasExited) { 'not held' } } catch { }",
      '$bashes = New-Object System.Collections.ArrayList',
      'foreach ($child in $found) {',
      '  if ($child.ParentProcessId -ne $shell.ProcessId) { continue }',
      '  $process = Get-Process -Id $child.ProcessId -ErrorAction SilentlyContinue',
      "  if ($null -eq $process -or $process.ProcessName -ne 'bash') { continue }",
      '  try {',
      '    $started = $process.StartTime.ToUniversalTime()',
      '    $born = $child.CreationDate.ToUniversalTime()',
      '    if ($started.AddMilliseconds(1) -ge $born -and $started.AddMilliseconds(-1) -le $born) { [void]$bashes.Add($process) }',
      '  } catch { }',
      '}',
      "$kill = 'C:\\Program Files\\Git\\usr\\bin\\kill.exe'",
      'if (Test-Path -LiteralPath $kill) {',
      '  foreach ($bash in $bashes) {',
      '    try {',
      "      $info = New-Object System.Diagnostics.ProcessStartInfo -ArgumentList $kill, ('-HUP -W ' + $bash.Id)",
      '      $info.UseShellExecute = $false',
      '      $info.CreateNoWindow = $true',
      '      $info.RedirectStandardInput = $true',
      '      $info.RedirectStandardOutput = $true',
      '      $info.RedirectStandardError = $true',
      '      $signal = [System.Diagnostics.Process]::Start($info)',
      '      if (-not $signal.WaitForExit(500)) { $signal.Kill() }',
      '    } catch { }',
      '  }',
      '  $deadline = [DateTime]::UtcNow.AddMilliseconds(1000)',
      '  foreach ($bash in $bashes) {',
      '    $wait = [int]($deadline - [DateTime]::UtcNow).TotalMilliseconds',
      '    if ($wait -gt 0) { [void]$bash.WaitForExit($wait) }',
      '  }',
      '}',
      '$ended = 0',
      '$left = New-Object System.Collections.ArrayList',
      'foreach ($child in $found) {',
      '  $process = Get-Process -Id $child.ProcessId -ErrorAction SilentlyContinue',
      '  if ($null -eq $process) { $ended++; continue }',
      '  try {',
      '    $started = $process.StartTime.ToUniversalTime()',
      '    $born = $child.CreationDate.ToUniversalTime()',
      '    if ($started.AddMilliseconds(-1) -gt $born -or $started.AddMilliseconds(1) -lt $born) { $ended++; continue }',
      '    Stop-Process -InputObject $process -Force',
      '    $ended++',
      '  } catch {',
      '    if ($null -eq (Get-Process -Id $child.ProcessId -ErrorAction SilentlyContinue)) { $ended++ } else { [void]$left.Add($child.ProcessId) }',
      '  }',
      '}',
      "'ended ' + $ended + ' of ' + $found.Count + ' left ' + ($left -join ',')",
    ])
  })
})

describe('endShellScript and endShell: a launcher of Git Bash ended by its pid', () => {
  type Callback = (error: Error | null, stdout: string, stderr: string) => void
  const answer = (stdout: string) => run.execFile.mockImplementation((_file: string, _args: string[], _options: unknown, done: Callback) => done(null, stdout, ''))

  it('is this text, byte for byte: the process with the pid only when it was created by startedBy and its start time is the one CIM reads', () => {
    expect(endShellScript({ ...SHELL, hangup: KILL }).split('\n')).toEqual([
      "$ErrorActionPreference = 'Stop'",
      "$shell = Get-CimInstance -Query 'SELECT ProcessId, CreationDate FROM Win32_Process WHERE ProcessId = 4242' | Select-Object -First 1",
      "if ($null -eq $shell -or $null -eq $shell.CreationDate -or $shell.CreationDate.ToUniversalTime().Ticks -gt 638955968002230000) { 'gone'; exit 0 }",
      '$process = Get-Process -Id 4242 -ErrorAction SilentlyContinue',
      "if ($null -eq $process) { 'gone'; exit 0 }",
      '$started = $process.StartTime.ToUniversalTime()',
      '$born = $shell.CreationDate.ToUniversalTime()',
      "if ($started.AddMilliseconds(-1) -gt $born -or $started.AddMilliseconds(1) -lt $born) { 'gone'; exit 0 }",
      'Stop-Process -InputObject $process -Force',
      "'ended'",
    ])
    expect(endShellScript(SHELL)).not.toContain('"')
  })

  it('runs Windows PowerShell with the script and DESCENDANTS_TIMEOUT_MS, and answers ended or gone', async () => {
    answer('ended\r\n')
    await expect(endShell(SHELL)).resolves.toBe('ended')
    const [, args, options] = run.execFile.mock.calls[0] as [string, string[], { timeout: number }]
    expect(args).toEqual(['-NoProfile', '-NonInteractive', '-Command', endShellScript(SHELL)])
    expect(options.timeout).toBe(DESCENDANTS_TIMEOUT_MS)
    answer('gone\r\n')
    await expect(endShell(SHELL)).resolves.toBe('gone')
    answer('something else')
    await expect(endShell(SHELL)).rejects.toThrow('the helper answered "something else"')
  })
})

describe('endDescendants with hangup', () => {
  type Callback = (error: Error | null, stdout: string, stderr: string) => void
  const answer = (stdout: string) => run.execFile.mockImplementation((_file: string, _args: string[], _options: unknown, done: Callback) => done(null, stdout, ''))

  it('passes the script with the hold and the signal to Windows PowerShell, with the longer limit of Git Bash', async () => {
    answer('ended 1 of 1 left \r\n')
    await expect(endDescendants({ ...SHELL, hangup: KILL })).resolves.toBe('ended')
    const [, args, options] = run.execFile.mock.calls[0] as [string, string[], { timeout: number }]
    expect(args).toEqual(['-NoProfile', '-NonInteractive', '-Command', descendantsScript({ ...SHELL, hangup: KILL })])
    // The waits of the hangup come on top of the limit of every other shell.
    expect(options.timeout).toBe(DESCENDANTS_TIMEOUT_MS + HANGUP_GRACE_MS + HANGUP_SIGNAL_BOUND_MS)
    // The pty of Git Bash is still released by the close itself, before the bound of the close.
    expect(HANGUP_TIMEOUT_MS).toBeLessThan(WINDOWS_CLOSE_BOUND_MS)
    run.execFile.mockClear()
    await endDescendants(SHELL)
    expect((run.execFile.mock.calls[0] as [string, string[], { timeout: number }])[2].timeout).toBe(DESCENDANTS_TIMEOUT_MS)
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

  interface Failure {
    /** What the helper does: answers nothing, answers `gone`, or fails. */
    helper?: 'quiet' | 'gone' | 'rejects'
    /** kill() of the pty throws, and the pty reports no exit. */
    killThrows?: boolean
    /** The clock of this process moves on by this many ms between the open and the close. */
    clockMovesMs?: number
  }

  async function closeWith(setting: 'git-bash' | 'powershell', failure: Failure = {}): Promise<{ shells: StartedShell[]; killsAtHelper: number[]; kills: number; ended: StartedShell[]; openedAt: number }> {
    const fake = fakePty(999_993_093)
    if (failure.killThrows === true) {
      fake.pty.kill = (signal) => {
        fake.kills.push(signal)
        throw new Error('kill() failed (stand-in)')
      }
    }
    const shells: StartedShell[] = []
    const killsAtHelper: number[] = []
    const ended: StartedShell[] = []
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const registry = new TerminalRegistry({
      env: winEnv,
      spawn: () => fake.pty,
      platform: 'win32',
      exists,
      closeBoundMs: 60_000,
      endDescendants: (shell) => {
        shells.push(shell)
        killsAtHelper.push(fake.kills.length)
        if (failure.helper === 'rejects') return Promise.reject(new Error('the helper failed (stand-in)'))
        return failure.helper === 'gone' ? 'gone' : undefined
      },
      endShell: (shell) => {
        ended.push(shell)
        // As the real one does: the launcher is gone, so node-pty reports its exit.
        fake.exit(1)
      },
    })
    // Only Date is replaced: the timers of the registry run as they do.
    if (failure.clockMovesMs !== undefined) vi.useFakeTimers({ toFake: ['Date'], now: 1_760_000_000_000 })
    try {
      const openedAt = Date.now()
      await registry.open('a', { ...OPEN, shell: () => setting }, {}, SINK)
      if (failure.clockMovesMs !== undefined) vi.setSystemTime(openedAt + failure.clockMovesMs)
      await registry.close('a')
      return { shells, killsAtHelper, kills: fake.kills.length, ended, openedAt }
    } finally {
      if (failure.clockMovesMs !== undefined) vi.useRealTimers()
    }
  }

  it('Git Bash, the helper fails: the close still calls kill(), which ends the launcher it suspended', async () => {
    const { shells, kills, ended } = await closeWith('git-bash', { helper: 'rejects' })
    expect(shells).toHaveLength(1)
    expect(kills).toBe(1)
    expect(ended).toEqual([])
  })

  it('Git Bash, the helper answers gone: the close still calls kill(), which ends the launcher it suspended', async () => {
    const { shells, kills, ended } = await closeWith('git-bash', { helper: 'gone' })
    expect(shells).toHaveLength(1)
    expect(kills).toBe(1)
    expect(ended).toEqual([])
  })

  it('Git Bash, kill() throws: the launcher is ended by its pid, by the shell the helper was given', async () => {
    const { shells, kills, ended } = await closeWith('git-bash', { killThrows: true })
    expect(kills).toBe(1)
    expect(ended).toEqual(shells)
    expect(ended).toEqual([{ pid: 999_993_093, startedBy: expect.any(Number) as number, hangup: KILL }])
  })

  // node-pty reports the exit 1 s after the output thread is stopped (FLUSH_DATA_INTERVAL of its
  // conout connection), whether or not the launcher is gone; ending the launcher by its pid took
  // 840-900 ms on the owner's PC, and longer under load.
  for (const outcome of ['answers', 'fails'] as const) {
    it(`Git Bash, kill() throws and the exit is reported before the launcher is ended: the close resolves only once ending it by its pid ${outcome}`, async () => {
      const fake = fakePty(999_993_095)
      fake.pty.kill = (signal) => {
        fake.kills.push(signal)
        throw new Error('kill() failed (stand-in)')
      }
      vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      let settle: () => void = () => undefined
      const ended: StartedShell[] = []
      const registry = new TerminalRegistry({
        env: winEnv,
        spawn: () => fake.pty,
        platform: 'win32',
        exists,
        closeBoundMs: 60_000,
        endDescendants: () => undefined,
        endShell: (shell) => {
          ended.push(shell)
          fake.exit(1)
          return new Promise<void>((done, fail) => {
            settle = outcome === 'answers' ? done : () => fail(new Error('the helper failed (stand-in)'))
          })
        },
      })
      await registry.open('a', { ...OPEN, shell: () => 'git-bash' }, {}, SINK)
      let closed = false
      const closing = registry.close('a').then(() => {
        closed = true
      })
      await vi.waitFor(() => expect(ended).toHaveLength(1))
      expect(registry.has('a')).toBe(false)
      await new Promise((done) => setTimeout(done, 20))
      expect(closed).toBe(false)
      settle()
      await closing
      expect(closed).toBe(true)
    })
  }

  it('Git Bash, kill() throws: the launcher is ended by the moment it was started, not the moment of the close', async () => {
    const { shells, ended, openedAt } = await closeWith('git-bash', { killThrows: true, clockMovesMs: 30_000 })
    expect(ended.map((shell) => shell.startedBy)).toEqual([openedAt])
    expect(shells.map((shell) => shell.startedBy)).toEqual([openedAt])
  })

  it('Git Bash that exited by itself, kill() throws: nothing is ended by its pid, as its launcher was never held', () => {
    const fake = fakePty(999_993_094)
    fake.pty.kill = (signal) => {
      fake.kills.push(signal)
      throw new Error('kill() failed (stand-in)')
    }
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const ended: StartedShell[] = []
    const registry = new TerminalRegistry({ env: winEnv, spawn: () => fake.pty, platform: 'win32', exists, endDescendants: () => undefined, endShell: (shell) => void ended.push(shell) })
    return registry.open('a', { ...OPEN, shell: () => 'git-bash' }, {}, SINK).then(() => {
      fake.exit(0)
      // The exit releases the pty at once: kill() was asked, and it threw.
      expect(fake.kills).toHaveLength(1)
      expect(registry.hasExited('a')).toBe(true)
      expect(ended).toEqual([])
    })
  })

  it('PowerShell, kill() throws: nothing is ended by its pid, as before (the launcher of Git Bash alone is held)', async () => {
    vi.useFakeTimers()
    try {
      const closing = closeWith('powershell', { killThrows: true })
      await vi.advanceTimersByTimeAsync(60_000)
      const { kills, ended } = await closing
      expect(kills).toBe(1)
      expect(ended).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

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
