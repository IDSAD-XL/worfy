// Which shell a Terminal starts, and how its shell is ended, by the system (worfy-windows ticket 10).
// On Windows it is PowerShell — pwsh from the Path, else Windows PowerShell — or Git Bash when the
// Project asks for it, and closing ends the whole process tree of the shell; elsewhere it is
// `$SHELL -l`, ended by SIGHUP, as before. The system, the Path and the function that ends the tree
// are passed in, so the Windows branch runs on any machine.
import { afterEach, describe, expect, it, vi } from 'vitest'

/** The files there are, and the app execution aliases among them: existsSync does not see an alias, lstat does. */
const disk = vi.hoisted(() => ({ files: new Set<string>(), aliases: new Set<string>() }))

vi.mock('node:fs', async (original) => {
  const actual = await original<typeof import('node:fs')>()
  return {
    ...actual,
    existsSync: (path: unknown) => disk.files.has(String(path)),
    lstatSync: (path: unknown) => {
      if (disk.aliases.has(String(path))) return { isSymbolicLink: () => true }
      if (disk.files.has(String(path))) return { isSymbolicLink: () => false }
      throw Object.assign(new Error(`ENOENT: ${String(path)}`), { code: 'ENOENT' })
    },
  }
})

const { KILL_GRACE_MS, terminalShell, TerminalRegistry } = await import('../../src/main/terminal/pty')
type PtyProcess = import('../../src/main/terminal/pty').PtyProcess
type SpawnPty = import('../../src/main/terminal/pty').SpawnPty

afterEach(() => {
  disk.files.clear()
  disk.aliases.clear()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const WINDOWS_POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
const ALIAS = 'C:\\Users\\dev\\AppData\\Local\\Microsoft\\WindowsApps\\pwsh.exe'
const GIT_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe'
const WIN_ENV = {
  Path: 'C:\\Tools;C:\\Program Files\\Git\\cmd;C:\\Users\\dev\\AppData\\Local\\Microsoft\\WindowsApps',
  SystemRoot: 'C:\\Windows',
  ProgramFiles: 'C:\\Program Files',
  LOCALAPPDATA: 'C:\\Users\\dev\\AppData\\Local',
}
const win = (setting?: 'powershell' | 'git-bash', env: Record<string, string> = WIN_ENV) => terminalShell(env, setting, { platform: 'win32' })

describe('terminalShell on Windows', () => {
  it('is pwsh.exe from the Path, with -NoLogo and no -l', () => {
    disk.files.add('C:\\Tools\\pwsh.exe')
    expect(win()).toEqual({ file: 'C:\\Tools\\pwsh.exe', args: ['-NoLogo'], name: 'pwsh.exe', note: null })
    expect(win('powershell')).toEqual(win())
  })

  it('finds pwsh installed from MSIX: an alias in WindowsApps that existsSync does not see', () => {
    disk.aliases.add(ALIAS)
    expect(win()).toEqual({ file: ALIAS, args: ['-NoLogo'], name: 'pwsh.exe', note: null })
  })

  it('is Windows PowerShell of %SystemRoot% when there is no pwsh, whatever the case of the variable name', () => {
    expect(win()).toEqual({ file: WINDOWS_POWERSHELL, args: ['-NoLogo'], name: 'powershell.exe', note: null })
    expect(win(undefined, { PATH: 'D:\\x', SYSTEMROOT: 'D:\\WinNT' }).file).toBe('D:\\WinNT\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    // Without the variable, or with one that is not a folder of a disk: C:\Windows.
    expect(win(undefined, { Path: 'D:\\x' }).file).toBe(WINDOWS_POWERSHELL)
    expect(win(undefined, { Path: 'D:\\x', SystemRoot: '\\Windows' }).file).toBe(WINDOWS_POWERSHELL)
  })

  it('is Git Bash with --login -i when the Project asks for it and it is there', () => {
    disk.files.add('C:\\Tools\\pwsh.exe').add('C:\\Program Files\\Git\\cmd\\git.exe').add(GIT_BASH)
    expect(win('git-bash')).toEqual({ file: GIT_BASH, args: ['--login', '-i'], name: 'bash.exe', note: null })
  })

  it('is PowerShell when Git Bash is asked for and not found, and says so', () => {
    disk.files.add('C:\\Tools\\pwsh.exe')
    const choice = win('git-bash')
    expect(choice).toMatchObject({ file: 'C:\\Tools\\pwsh.exe', args: ['-NoLogo'], name: 'pwsh.exe' })
    expect(choice.note).toMatch(/Git Bash was not found/)
  })

  it('never takes $SHELL there, nor cmd.exe', () => {
    disk.files.add('C:\\Windows\\System32\\cmd.exe')
    expect(win(undefined, { ...WIN_ENV, SHELL: '/usr/bin/bash', ComSpec: 'C:\\Windows\\System32\\cmd.exe' }).file).toBe(WINDOWS_POWERSHELL)
  })
})

describe('terminalShell off Windows', () => {
  it.each(['darwin', 'linux'] as const)('on %s is $SHELL -l, or /bin/zsh -l without it, whatever the Project asks for', (platform) => {
    expect(terminalShell({ SHELL: '/opt/homebrew/bin/fish' }, undefined, { platform })).toEqual({ file: '/opt/homebrew/bin/fish', args: ['-l'], name: 'fish', note: null })
    expect(terminalShell({}, undefined, { platform })).toEqual({ file: '/bin/zsh', args: ['-l'], name: 'zsh', note: null })
    expect(terminalShell({ SHELL: '/bin/bash' }, 'git-bash', { platform })).toEqual({ file: '/bin/bash', args: ['-l'], name: 'bash', note: null })
  })
})

/** A pty that only records: `kill` ends it, as node-pty's does. */
function fakePty(pid: number) {
  const kills: (string | undefined)[] = []
  let onExit: (event: { exitCode: number; signal?: number }) => void = () => undefined
  const pty: PtyProcess = {
    pid,
    onData: () => undefined,
    onExit: (listener) => {
      onExit = listener
    },
    write: () => undefined,
    resize: () => undefined,
    kill: (signal) => {
      kills.push(signal)
      onExit({ exitCode: 0 })
    },
  }
  return { pty, kills, exit: () => onExit({ exitCode: 0 }) }
}

const SINK = { output: () => undefined, exit: () => undefined, started: () => undefined }

describe('TerminalRegistry by the system', () => {
  it('on Windows starts the shell of terminalShell: PowerShell by default, Git Bash for a request that names it', async () => {
    disk.files.add('C:\\Tools\\pwsh.exe').add('C:\\Program Files\\Git\\cmd\\git.exe').add(GIT_BASH)
    const started: { file: string; args: string[] }[] = []
    const spawn: SpawnPty = (file, args) => {
      started.push({ file, args })
      return fakePty(4000 + started.length).pty
    }
    const registry = new TerminalRegistry({ env: () => Promise.resolve({ ...WIN_ENV }), spawn, platform: 'win32', killTree: () => undefined })
    const first = await registry.open('a', { cwd: 'C:\\p\\repo', cols: 80, rows: 24 }, {}, SINK)
    const second = await registry.open('b', { cwd: 'C:\\p\\repo', cols: 80, rows: 24, shell: 'git-bash' }, {}, SINK)
    expect(started).toEqual([
      { file: 'C:\\Tools\\pwsh.exe', args: ['-NoLogo'] },
      { file: GIT_BASH, args: ['--login', '-i'] },
    ])
    // The name a Terminal Node shows is the file name, by the rules of that system.
    expect([first.shell, second.shell]).toEqual(['pwsh.exe', 'bash.exe'])
    await registry.closeAll()
  })

  it('on Windows close ends the process tree of the shell first, then the pty, and sends no signal', async () => {
    const order: string[] = []
    const fake = fakePty(4242)
    const signals = vi.spyOn(process, 'kill').mockImplementation(() => true)
    const registry = new TerminalRegistry({
      env: () => Promise.resolve({ ...WIN_ENV }),
      spawn: () => fake.pty,
      platform: 'win32',
      killTree: async (pid) => {
        // The shell is still running while its tree is ended: Windows finds the children by their living parent.
        order.push(`tree ${pid} (pty killed ${fake.kills.length} times so far)`)
        await Promise.resolve()
      },
    })
    await registry.open('a', { cwd: 'C:\\p\\repo', cols: 80, rows: 24 }, {}, SINK)
    await registry.close('a')
    expect(order).toEqual(['tree 4242 (pty killed 0 times so far)'])
    // node-pty on Windows throws for a signal; kill() without one ends the console and closes ConPTY.
    expect(fake.kills).toEqual([undefined])
    expect(signals).not.toHaveBeenCalled()
    expect(registry.has('a')).toBe(false)
  })

  it('on Windows the pty is ended even when ending the tree fails, and a shell that already left is not an error', async () => {
    const fake = fakePty(4243)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const registry = new TerminalRegistry({
      env: () => Promise.resolve({ ...WIN_ENV }),
      spawn: () => fake.pty,
      platform: 'win32',
      killTree: () => Promise.reject(new Error('taskkill is not there')),
    })
    await registry.open('a', { cwd: 'C:\\p\\repo', cols: 80, rows: 24 }, {}, SINK)
    await registry.close('a')
    expect(fake.kills).toEqual([undefined])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ending the process tree'), expect.any(Error))
  })

  it.each(['darwin', 'linux'] as const)('on %s close sends SIGHUP to the group and the shell, and SIGKILL after the grace period, as before', async (platform) => {
    vi.useFakeTimers()
    const fake = fakePty(5151)
    const signals = vi.spyOn(process, 'kill').mockImplementation(() => true)
    const killTree = vi.fn()
    const registry = new TerminalRegistry({ env: () => Promise.resolve({ SHELL: '/bin/sh' }), spawn: () => fake.pty, platform, killTree })
    await registry.open('a', { cwd: '/p/repo', cols: 80, rows: 24 }, {}, SINK)
    const closed = registry.close('a')
    await vi.advanceTimersByTimeAsync(0)
    expect(signals.mock.calls).toEqual([
      [-5151, 'SIGHUP'],
      [5151, 'SIGHUP'],
    ])
    await vi.advanceTimersByTimeAsync(KILL_GRACE_MS - 1)
    expect(signals.mock.calls).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(signals.mock.calls.slice(2)).toEqual([
      [-5151, 'SIGKILL'],
      [5151, 'SIGKILL'],
    ])
    // The pty itself is not asked to end, and nothing of the Windows way runs.
    expect(fake.kills).toEqual([])
    expect(killTree).not.toHaveBeenCalled()
    fake.exit()
    await closed
  })

  it('types a command with the Enter of the system: a carriage return on Windows, a newline elsewhere', async () => {
    const typed: Record<string, string[]> = { win32: [], darwin: [] }
    for (const platform of ['win32', 'darwin'] as const) {
      const fake = fakePty(platform === 'win32' ? 6001 : 6002)
      fake.pty.write = (data) => void typed[platform]!.push(data)
      const registry = new TerminalRegistry({
        env: () => Promise.resolve<Record<string, string>>(platform === 'win32' ? { ...WIN_ENV } : { SHELL: '/bin/sh' }),
        spawn: () => fake.pty,
        platform,
        killTree: () => undefined,
        commandDelayMs: 5,
      })
      await registry.open('a', { cwd: 'x', cols: 80, rows: 24, command: 'gh auth login' }, {}, SINK)
      await vi.waitFor(() => expect(typed[platform]).toHaveLength(1))
      vi.spyOn(process, 'kill').mockImplementation(() => true)
      const closed = registry.close('a')
      fake.exit()
      await closed
      vi.restoreAllMocks()
    }
    expect(typed).toEqual({ win32: ['gh auth login\r'], darwin: ['gh auth login\n'] })
  })
})
