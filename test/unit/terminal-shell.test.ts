// Which shell a Terminal starts, and how its shell is ended, by the system (worfy-windows ticket 10).
// On Windows it is PowerShell — pwsh from the Path, else Windows PowerShell — or Git Bash when the
// Project asks for it; closing ends every process under the shell, then the pty, within a bound.
// Elsewhere it is `$SHELL -l`, ended by SIGHUP, as before. The system, the Path, the function that
// ends the processes under the shell and the program that function runs are passed in or replaced,
// so the Windows branch runs on any machine.
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The disk the search of a shell sees. `links` are app execution aliases and links: stat of one
 * fails (an alias cannot be opened as a file), readlink names what it points at.
 */
const disk = vi.hoisted(() => ({ files: new Set<string>(), folders: new Set<string>(), links: new Map<string, string>() }))
/** The stand-in of execFile for the helper that ends the processes under a shell. */
const run = vi.hoisted(() => ({ execFile: vi.fn() }))

vi.mock('node:fs', async (original) => {
  const actual = await original<typeof import('node:fs')>()
  const fail = (code: string, path: string) => Object.assign(new Error(`${code}: ${path}`), { code })
  return {
    ...actual,
    statSync: (path: unknown) => {
      const file = String(path)
      if (disk.files.has(file)) return { isFile: () => true }
      if (disk.folders.has(file)) return { isFile: () => false }
      throw fail(disk.links.has(file) ? 'EACCES' : 'ENOENT', file)
    },
    readlinkSync: (path: unknown) => {
      const target = disk.links.get(String(path))
      if (target === undefined) throw fail('EINVAL', String(path))
      return target
    },
  }
})

vi.mock('node:child_process', async (original) => ({ ...(await original<typeof import('node:child_process')>()), execFile: run.execFile }))

const { DESCENDANTS_TIMEOUT_MS, descendantsScript, endDescendants, KILL_GRACE_MS, terminalEnv, terminalShell, terminalShellOptions, TerminalRegistry, WINDOWS_CLOSE_BOUND_MS } =
  await import('../../src/main/terminal/pty')
const { projectSettingsSchema, savedProjectSettingsSchema } = await import('../../src/shared/projects/action-templates')
const { readProjectSettings, settingsPath } = await import('../../src/main/projects/settings')
type PtyProcess = import('../../src/main/terminal/pty').PtyProcess
type SpawnPty = import('../../src/main/terminal/pty').SpawnPty
type TerminalSink = import('../../src/main/terminal/pty').TerminalSink

afterEach(() => {
  disk.files.clear()
  disk.folders.clear()
  disk.links.clear()
  run.execFile.mockReset()
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

const WINDOWS_POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
const ALIAS = 'C:\\Users\\dev\\AppData\\Local\\Microsoft\\WindowsApps\\pwsh.exe'
const ALIAS_TARGET = 'C:\\Program Files\\WindowsApps\\Microsoft.PowerShell_7.6.6.0_x64__8wekyb3d8bbwe\\pwsh.exe'
const GIT_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe'
const WIN_ENV = {
  Path: 'C:\\Tools;C:\\Program Files\\Git\\cmd;C:\\Users\\dev\\AppData\\Local\\Microsoft\\WindowsApps',
  SystemRoot: 'C:\\Windows',
  ProgramFiles: 'C:\\Program Files',
  LOCALAPPDATA: 'C:\\Users\\dev\\AppData\\Local',
}
const win = (setting?: 'powershell' | 'git-bash', env: Record<string, string> = WIN_ENV) => terminalShell(env, setting, { platform: 'win32' })
/** pwsh installed from MSIX: the alias in WindowsApps and the program it starts. */
const installAlias = () => {
  disk.links.set(ALIAS, ALIAS_TARGET)
  disk.files.add(ALIAS_TARGET)
}

describe('terminalShell on Windows', () => {
  it('is pwsh.exe from the Path, with -NoLogo and no -l', () => {
    disk.files.add('C:\\Tools\\pwsh.exe')
    expect(win()).toEqual({ file: 'C:\\Tools\\pwsh.exe', args: ['-NoLogo'], name: 'pwsh.exe', note: null })
    expect(win('powershell')).toEqual(win())
  })

  it('finds pwsh installed from MSIX: an alias in WindowsApps that cannot be opened as a file', () => {
    installAlias()
    expect(win()).toEqual({ file: ALIAS, args: ['-NoLogo'], name: 'pwsh.exe', note: null })
  })

  it('is Windows PowerShell of %SystemRoot% when there is no pwsh, whatever the case of the variable name', () => {
    expect(win()).toEqual({ file: WINDOWS_POWERSHELL, args: ['-NoLogo'], name: 'powershell.exe', note: null })
    expect(win(undefined, { PATH: 'D:\\x', SYSTEMROOT: 'D:\\WinNT' }).file).toBe('D:\\WinNT\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    // Without the variable, or with one that is not a folder of a disk: C:\Windows.
    expect(win(undefined, { Path: 'D:\\x' }).file).toBe(WINDOWS_POWERSHELL)
    expect(win(undefined, { Path: 'D:\\x', SystemRoot: '\\Windows' }).file).toBe(WINDOWS_POWERSHELL)
  })

  it('passes by a pwsh.exe that cannot start — a folder of that name, a link to nothing — and goes on along the Path', () => {
    disk.folders.add('C:\\Tools\\pwsh.exe')
    disk.links.set('C:\\Program Files\\Git\\cmd\\pwsh.exe', 'C:\\gone\\pwsh.exe')
    expect(win().file).toBe(WINDOWS_POWERSHELL)
    installAlias()
    expect(win().file).toBe(ALIAS)
  })

  it('does not look in an entry of the Path that is not a full path: that would be a folder of worfy itself', () => {
    for (const entry of ['.', 'tools', '\\bin', 'C:tools', '']) {
      disk.files.add(`${entry}\\pwsh.exe`).add('pwsh.exe')
      expect(win(undefined, { ...WIN_ENV, Path: `${entry};C:\\Tools` }).file, entry).toBe(WINDOWS_POWERSHELL)
    }
    // A share is a full path.
    disk.files.add('\\\\server\\tools\\pwsh.exe')
    expect(win(undefined, { ...WIN_ENV, Path: '\\\\server\\tools' }).file).toBe('\\\\server\\tools\\pwsh.exe')
  })

  it('is Git Bash with --login -i when the Project asks for it and it is there', () => {
    disk.files.add('C:\\Tools\\pwsh.exe').add('C:\\Program Files\\Git\\cmd\\git.exe').add(GIT_BASH)
    expect(win('git-bash')).toEqual({ file: GIT_BASH, args: ['--login', '-i'], name: 'bash.exe', note: null })
  })

  it('finds a 32-bit Git for Windows in %ProgramFiles(x86)% when Git is not on the Path', () => {
    const bash = 'C:\\Program Files (x86)\\Git\\bin\\bash.exe'
    disk.files.add(bash)
    expect(win('git-bash', { SystemRoot: 'C:\\Windows', ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)' }).file).toBe(bash)
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

describe('terminalShellOptions: the shells there are to choose from', () => {
  it.each(['darwin', 'linux'] as const)('on %s there is nothing to choose: the shell is $SHELL', (platform) => {
    expect(terminalShellOptions({ SHELL: '/bin/zsh' }, { platform })).toEqual([])
  })

  it('on Windows names the PowerShell that would start, and says whether Git Bash is there', () => {
    const options = () => terminalShellOptions(WIN_ENV, { platform: 'win32' })
    expect(options()).toEqual([
      { id: 'powershell', label: 'Windows PowerShell', found: true },
      { id: 'git-bash', label: 'Git Bash', found: false },
    ])
    installAlias()
    disk.files.add('C:\\Program Files\\Git\\cmd\\git.exe').add(GIT_BASH)
    expect(options()).toEqual([
      { id: 'powershell', label: 'PowerShell (pwsh)', found: true },
      { id: 'git-bash', label: 'Git Bash', found: true },
    ])
  })
})

describe('terminalEnv: LANG by the system', () => {
  it.each(['darwin', 'linux'] as const)('on %s a shell without LANG gets en_US.UTF-8, and one that has LANG keeps it', (platform) => {
    expect(terminalEnv({}, '/repo', platform).LANG).toBe('en_US.UTF-8')
    expect(terminalEnv({ LANG: 'ru_RU.UTF-8' }, '/repo', platform).LANG).toBe('ru_RU.UTF-8')
  })

  it('on Windows LANG is not added: Git Bash takes its locale from Windows only while LANG is unset', () => {
    expect('LANG' in terminalEnv({}, 'C:\\p\\repo', 'win32')).toBe(false)
    expect(terminalEnv({ LANG: 'ru_RU.UTF-8' }, 'C:\\p\\repo', 'win32').LANG).toBe('ru_RU.UTF-8')
    // The terminal variables are the same everywhere.
    expect(terminalEnv({}, 'C:\\p\\repo', 'win32')).toMatchObject({ PWD: 'C:\\p\\repo', TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'worfy' })
  })
})

describe('the setting terminalShell of a Project', () => {
  const templates = { shipTicket: '', runWave: '' }

  it('is not added to settings that do not have it, is kept when it names a shell, and anything else is refused when saved', () => {
    expect(projectSettingsSchema.parse({ actionTemplates: templates })).toStrictEqual({ actionTemplates: templates })
    for (const terminalShell of ['powershell', 'git-bash']) {
      expect(projectSettingsSchema.parse({ actionTemplates: templates, terminalShell })).toStrictEqual({ actionTemplates: templates, terminalShell })
    }
    for (const terminalShell of ['cmd', 'bash', 'wsl', '', 3, null]) {
      expect(projectSettingsSchema.safeParse({ actionTemplates: templates, terminalShell }).success, String(terminalShell)).toBe(false)
    }
  })

  it('reads as not chosen when settings.json names a shell this version does not know, and the rest is read', () => {
    for (const terminalShell of ['wsl', 'cmd', '', 3, null]) {
      const read = savedProjectSettingsSchema.parse({ actionTemplates: { shipTicket: 'mine {epic} {NN}', runWave: 'wave' }, terminalShell })
      expect(read.actionTemplates, String(terminalShell)).toEqual({ shipTicket: 'mine {epic} {NN}', runWave: 'wave' })
      expect(read.terminalShell, String(terminalShell)).toBeUndefined()
    }
    expect(savedProjectSettingsSchema.parse({ actionTemplates: templates, terminalShell: 'git-bash' }).terminalShell).toBe('git-bash')
    // What is wrong with the templates still fails the file.
    expect(savedProjectSettingsSchema.safeParse({ actionTemplates: { shipTicket: '{nope}', runWave: '' } }).success).toBe(false)
  })

  it('a settings.json with such a shell keeps the action templates of the Project, and the file is not set aside', () => {
    const dir = mkdtempSync(join(tmpdir(), 'worfy-settings-shell-'))
    try {
      writeFileSync(settingsPath(dir), JSON.stringify({ actionTemplates: { shipTicket: 'my own {epic} {NN}', runWave: 'my wave' }, terminalShell: 'wsl' }))
      const read = readProjectSettings(dir, 'none')
      expect(read.actionTemplates).toEqual({ shipTicket: 'my own {epic} {NN}', runWave: 'my wave' })
      expect(read.terminalShell).toBeUndefined()
      expect(readdirSync(dir)).toEqual(['settings.json'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

interface FakeOptions {
  /** node-pty's private agent with its helper process, as 1.1.0 has it. */
  agent?: boolean
  /** kill() does not end it: node-pty reports no exit. */
  deaf?: boolean
}

/** A pty that only records. `kill` ends it, as node-pty's does, unless it is `deaf`. */
function fakePty(pid: number, options: FakeOptions = {}) {
  const kills: (string | undefined)[] = []
  /** What node-pty's helper would answer at each kill(): 'ran' when it is still node-pty's own. */
  const helper: unknown[] = []
  let onExit: (event: { exitCode: number; signal?: number }) => void = () => undefined
  const agent = { _getConsoleProcessList: (): Promise<unknown> => Promise.resolve('ran') }
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
      if (options.agent) helper.push(agent._getConsoleProcessList())
      if (!options.deaf) onExit({ exitCode: 0 })
    },
    ...(options.agent ? { _agent: agent } : {}),
  }
  return { pty, kills, helper, agent, exit: (exitCode = 0) => onExit({ exitCode }) }
}

const SINK: TerminalSink = { output: () => undefined, exit: () => undefined, started: () => undefined }
const OPEN = { cwd: 'C:\\p\\repo', cols: 80, rows: 24 }
const winEnv = () => Promise.resolve({ ...WIN_ENV })
/** A promise and the function that settles it. */
function deferred(): { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void } {
  let resolve: () => void = () => undefined
  let reject: (error: Error) => void = () => undefined
  const promise = new Promise<void>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

describe('TerminalRegistry: which shell starts, by the system', () => {
  it('on Windows starts the shell of terminalShell: PowerShell by default, Git Bash when the settings of the Project name it', async () => {
    disk.files.add('C:\\Tools\\pwsh.exe').add('C:\\Program Files\\Git\\cmd\\git.exe').add(GIT_BASH)
    const started: { file: string; args: string[]; lang: string | undefined }[] = []
    const spawn: SpawnPty = (file, args, options) => {
      started.push({ file, args, lang: options.env['LANG'] })
      return fakePty(4001 + started.length).pty
    }
    const registry = new TerminalRegistry({ env: winEnv, spawn, platform: 'win32', endDescendants: () => undefined })
    const first = await registry.open('a', OPEN, {}, SINK)
    const second = await registry.open('b', { ...OPEN, shell: () => 'git-bash' }, {}, SINK)
    expect(started).toEqual([
      { file: 'C:\\Tools\\pwsh.exe', args: ['-NoLogo'], lang: undefined },
      { file: GIT_BASH, args: ['--login', '-i'], lang: undefined },
    ])
    // The name a Terminal Node shows is the file name, by the rules of that system.
    expect([first.shell, second.shell]).toEqual(['pwsh.exe', 'bash.exe'])
    await registry.closeAll()
  })

  it('on Windows asks for the setting once, when the shell starts: not when a second screen attaches to it', async () => {
    const setting = vi.fn(() => 'powershell' as const)
    const registry = new TerminalRegistry({ env: winEnv, spawn: () => fakePty(4011).pty, platform: 'win32', endDescendants: () => undefined })
    expect((await registry.open('a', { ...OPEN, shell: setting }, {}, SINK)).started).toBe(true)
    expect((await registry.open('a', { ...OPEN, shell: setting }, {}, SINK)).started).toBe(false)
    expect(setting).toHaveBeenCalledTimes(1)
    await registry.closeAll()
  })

  it.each(['darwin', 'linux'] as const)('on %s the setting is never asked for: the settings of the Project are not read for a Terminal', async (platform) => {
    const fake = fakePty(4021)
    const setting = vi.fn((): 'git-bash' => {
      throw new Error('settings.json cannot be read')
    })
    const started: string[] = []
    const registry = new TerminalRegistry({
      env: () => Promise.resolve({ SHELL: '/bin/sh' }),
      spawn: (file) => {
        started.push(file)
        return fake.pty
      },
      platform,
    })
    vi.spyOn(process, 'kill').mockImplementation(() => true)
    expect((await registry.open('a', { cwd: '/p/repo', cols: 80, rows: 24, shell: setting }, {}, SINK)).shell).toBe('sh')
    expect(started).toEqual(['/bin/sh'])
    expect(setting).not.toHaveBeenCalled()
    const closed = registry.close('a')
    fake.exit()
    await closed
  })

  it('on Windows starts PowerShell when the setting cannot be read, and says so', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const started: string[] = []
    const registry = new TerminalRegistry({
      env: winEnv,
      spawn: (file) => {
        started.push(file)
        return fakePty(4031).pty
      },
      platform: 'win32',
      endDescendants: () => undefined,
    })
    const shell = () => {
      throw new Error('EACCES: settings.json')
    }
    expect((await registry.open('a', { ...OPEN, shell }, {}, SINK)).shell).toBe('powershell.exe')
    expect(started).toEqual([WINDOWS_POWERSHELL])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('the shell setting of a could not be read'), expect.any(Error))
    await registry.closeAll()
  })

  it('on Windows says why PowerShell runs when the settings ask for a Git Bash that is not there', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const registry = new TerminalRegistry({ env: winEnv, spawn: () => fakePty(4041).pty, platform: 'win32', endDescendants: () => undefined })
    expect((await registry.open('a', { ...OPEN, shell: () => 'git-bash' }, {}, SINK)).shell).toBe('powershell.exe')
    expect(warn).toHaveBeenCalledWith('[terminal] a: Git Bash was not found on this machine: PowerShell runs instead')
    await registry.closeAll()
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
        endDescendants: () => undefined,
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

describe('TerminalRegistry: closing a Terminal on Windows', () => {
  it('ends the processes under the shell first and asks the pty only when that is done; no signal goes to any pid', async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const signals = vi.spyOn(process, 'kill').mockImplementation(() => true)
    const fake = fakePty(4242)
    const under = deferred()
    const endDescendants = vi.fn(() => under.promise)
    const registry = new TerminalRegistry({ env: winEnv, spawn: () => fake.pty, platform: 'win32', endDescendants })
    const before = Date.now()
    await registry.open('a', OPEN, {}, SINK)
    const after = Date.now()
    let closed = false
    const closing = registry.close('a').then(() => (closed = true))
    await vi.advanceTimersByTimeAsync(1000)
    // The shell is named by its pid and by when it was started, so that another process with that pid is told apart.
    expect(endDescendants).toHaveBeenCalledTimes(1)
    const [[shell]] = endDescendants.mock.calls as unknown as [[{ pid: number; startedBy: number }]]
    expect(shell.pid).toBe(4242)
    expect(shell.startedBy).toBeGreaterThanOrEqual(before)
    expect(shell.startedBy).toBeLessThanOrEqual(after)
    // The pty waits: the shell must be the living parent of what is being ended.
    expect(fake.kills).toEqual([])
    expect(closed).toBe(false)
    under.resolve()
    await closing
    // node-pty on Windows throws for a signal; kill() without one closes the pseudo-console.
    expect(fake.kills).toEqual([undefined])
    expect(registry.has('a')).toBe(false)
    // The exit came: the bound has nothing left to do.
    await vi.advanceTimersByTimeAsync(WINDOWS_CLOSE_BOUND_MS * 2)
    expect(fake.kills).toEqual([undefined])
    expect(warn).not.toHaveBeenCalled()
    expect(signals).not.toHaveBeenCalled()
  })

  it('asks the pty even when ending the processes under the shell fails', async () => {
    const fake = fakePty(4243)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const registry = new TerminalRegistry({ env: winEnv, spawn: () => fake.pty, platform: 'win32', endDescendants: () => Promise.reject(new Error('powershell.exe is not there')) })
    await registry.open('a', OPEN, {}, SINK)
    await registry.close('a')
    expect(fake.kills).toEqual([undefined])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ending the processes under the shell of a failed'), expect.any(Error))
  })

  it('takes node-pty\'s helper process out before kill(): the helper would end the pid of the shell 5 s later, whoever has it', async () => {
    const fake = fakePty(4244, { agent: true })
    const registry = new TerminalRegistry({ env: winEnv, spawn: () => fake.pty, platform: 'win32', endDescendants: () => undefined })
    await registry.open('a', OPEN, {}, SINK)
    await registry.close('a')
    expect(fake.kills).toEqual([undefined])
    // At kill() the helper was already the empty list.
    expect(await Promise.all(fake.helper)).toEqual([[]])
  })

  it('has an upper bound: when the helper never answers and node-pty never reports the exit, the pty is asked and the Terminal is closed without the exit', async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const first = fakePty(4245, { deaf: true })
    const second = fakePty(4249)
    const ptys = [first.pty, second.pty]
    const exits: [number, number | null][] = []
    const registry = new TerminalRegistry({ env: winEnv, spawn: () => ptys.shift()!, platform: 'win32', endDescendants: () => new Promise<void>(() => undefined) })
    await registry.open('a', OPEN, {}, { ...SINK, exit: (code, signal) => exits.push([code, signal]) })
    let closed = false
    const closing = registry.close('a').then(() => (closed = true))
    // A second open of the same Node waits for the close, as it does elsewhere.
    const later: [number, number | null][] = []
    const reopened = registry.open('a', OPEN, {}, { ...SINK, exit: (code, signal) => later.push([code, signal]) })
    await vi.advanceTimersByTimeAsync(WINDOWS_CLOSE_BOUND_MS - 1)
    expect([closed, first.kills.length, registry.has('a'), exits.length]).toEqual([false, 0, true, 0])
    await vi.advanceTimersByTimeAsync(1)
    await closing
    expect(first.kills).toEqual([undefined])
    expect(exits).toEqual([[1, null]])
    expect(warn).toHaveBeenCalledWith(`[terminal] a did not report its exit in ${WINDOWS_CLOSE_BOUND_MS} ms: closed without it`)
    // The Node is free again: the open that waited starts a new shell.
    expect(await reopened).toMatchObject({ pid: 4249, started: true })
    // The screen that waited heard the exit of the old shell, as every screen of that Node did.
    expect(later).toEqual([[1, null]])
    // node-pty's late exit of the old shell changes nothing: the screen of the new shell hears no second exit.
    first.exit()
    expect(exits).toEqual([[1, null]])
    expect(later).toEqual([[1, null]])
    expect(registry.has('a')).toBe(true)
    const end = registry.closeAll()
    await vi.advanceTimersByTimeAsync(WINDOWS_CLOSE_BOUND_MS)
    await end
  })

  it('the bound also covers a pty that was asked and reports no exit, and one whose kill() throws', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const deaf = fakePty(4246, { deaf: true })
    const broken = fakePty(4247, { deaf: true })
    broken.pty.kill = () => {
      throw new Error('the pseudo-console is closed')
    }
    const ptys = [deaf.pty, broken.pty]
    const registry = new TerminalRegistry({ env: winEnv, spawn: () => ptys.shift()!, platform: 'win32', endDescendants: () => undefined, closeBoundMs: 700 })
    await registry.open('a', OPEN, {}, SINK)
    await registry.open('b', OPEN, {}, SINK)
    let closed = false
    const closing = registry.closeAll().then(() => (closed = true))
    await vi.advanceTimersByTimeAsync(699)
    // Asked at once, since nothing was under the shell; then only the bound is left.
    expect(deaf.kills).toEqual([undefined])
    expect(closed).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await closing
    expect(deaf.kills).toEqual([undefined])
    expect(registry.size).toBe(0)
  })

  it('a kill() that throws when the bound asks the pty does not stop the close', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const broken = fakePty(4248, { deaf: true })
    let asked = 0
    broken.pty.kill = () => {
      asked += 1
      throw new Error('the pseudo-console is closed')
    }
    const registry = new TerminalRegistry({ env: winEnv, spawn: () => broken.pty, platform: 'win32', endDescendants: () => new Promise<void>(() => undefined), closeBoundMs: 300 })
    await registry.open('a', OPEN, {}, SINK)
    const closing = registry.close('a')
    await vi.advanceTimersByTimeAsync(300)
    await closing
    expect(asked).toBe(1)
    expect(registry.size).toBe(0)
  })

  it('a shell that exited on its own gets kill() once — node-pty stops its worker thread only there — and only without the helper', async () => {
    const withAgent = fakePty(4251, { agent: true, deaf: true })
    const plain = fakePty(4252, { deaf: true })
    const ptys = [withAgent.pty, plain.pty]
    const registry = new TerminalRegistry({ env: winEnv, spawn: () => ptys.shift()!, platform: 'win32', endDescendants: () => undefined })
    await registry.open('a', OPEN, {}, SINK)
    await registry.open('b', OPEN, {}, SINK)
    withAgent.exit(3)
    plain.exit(3)
    expect(withAgent.kills).toEqual([undefined])
    expect(await Promise.all(withAgent.helper)).toEqual([[]])
    // Not node-pty as 1.1.0 builds it: its kill() might end the pid of the shell that is gone.
    expect(plain.kills).toEqual([])
    expect([registry.hasExited('a'), registry.hasExited('b')]).toEqual([true, true])
    // Closing the Node of an exited shell asks nothing more.
    await registry.closeAll()
    expect(withAgent.kills).toEqual([undefined])
    expect(plain.kills).toEqual([])
  })
})

describe('TerminalRegistry: closing a Terminal off Windows', () => {
  it.each(['darwin', 'linux'] as const)('on %s close sends SIGHUP to the group and the shell, and SIGKILL after the grace period, as before', async (platform) => {
    vi.useFakeTimers()
    const fake = fakePty(5151, { agent: true, deaf: true })
    const signals = vi.spyOn(process, 'kill').mockImplementation(() => true)
    const endDescendants = vi.fn()
    const started: { file: string; args: string[]; lang: string | undefined }[] = []
    const spawn: SpawnPty = (file, args, options) => {
      started.push({ file, args, lang: options.env['LANG'] })
      return fake.pty
    }
    const registry = new TerminalRegistry({ env: () => Promise.resolve({ SHELL: '/bin/sh' }), spawn, platform, endDescendants })
    const opened = await registry.open('a', { cwd: '/p/repo', cols: 80, rows: 24, shell: () => 'git-bash' }, {}, SINK)
    // The shell of that system, whatever system the test runs on and whatever the settings name.
    expect(started).toEqual([{ file: '/bin/sh', args: ['-l'], lang: 'en_US.UTF-8' }])
    expect(opened.shell).toBe('sh')
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
    // No bound of the Windows way: the shell is waited for.
    await vi.advanceTimersByTimeAsync(WINDOWS_CLOSE_BOUND_MS * 2)
    expect(registry.has('a')).toBe(true)
    fake.exit()
    await closed
    // The pty itself is not asked to end, its helper is left alone, and nothing of the Windows way runs.
    expect(fake.kills).toEqual([])
    expect(await fake.agent._getConsoleProcessList()).toBe('ran')
    expect(endDescendants).not.toHaveBeenCalled()
  })

  it.each(['darwin', 'linux'] as const)('on %s no SIGKILL follows once the shell has exited inside the grace period', async (platform) => {
    vi.useFakeTimers()
    const fake = fakePty(5252, { deaf: true })
    const signals = vi.spyOn(process, 'kill').mockImplementation(() => true)
    const registry = new TerminalRegistry({ env: () => Promise.resolve({ SHELL: '/bin/sh' }), spawn: () => fake.pty, platform })
    await registry.open('a', { cwd: '/p/repo', cols: 80, rows: 24 }, {}, SINK)
    const closed = registry.close('a')
    await vi.advanceTimersByTimeAsync(KILL_GRACE_MS / 2)
    fake.exit()
    await closed
    await vi.advanceTimersByTimeAsync(KILL_GRACE_MS * 3)
    // The pid may belong to another process by then.
    expect(signals.mock.calls).toEqual([
      [-5252, 'SIGHUP'],
      [5252, 'SIGHUP'],
    ])
  })
})

describe('endDescendants: the helper that ends the processes under a shell of Windows', () => {
  type Callback = (error: Error | null, stdout: string, stderr: string) => void
  /** The helper answers `stdout`, or fails with `error`. */
  const answer = (stdout: string, error: Error | null = null) =>
    run.execFile.mockImplementation((_file: string, _args: string[], _options: unknown, done: Callback) => done(error, stdout, ''))
  const SHELL = { pid: 4242, startedBy: 1_760_000_000_123 }

  it('runs Windows PowerShell of %SystemRoot% by its full path, without a profile or a prompt, hidden, with a time limit', async () => {
    vi.stubEnv('SystemRoot', 'D:\\WinNT')
    answer('ended 0 of 0\r\n')
    await endDescendants(SHELL)
    expect(run.execFile).toHaveBeenCalledTimes(1)
    const [file, args, options] = run.execFile.mock.calls[0] as [string, string[], { timeout: number; windowsHide: boolean }]
    expect(file).toBe('D:\\WinNT\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    // As text, not -EncodedCommand: an encoded script not seen before costs seconds on the owner's PC.
    expect(args).toEqual(['-NoProfile', '-NonInteractive', '-Command', descendantsScript(SHELL)])
    expect(options).toEqual({ encoding: 'utf8', timeout: DESCENDANTS_TIMEOUT_MS, windowsHide: true })
    expect(DESCENDANTS_TIMEOUT_MS).toBeLessThan(WINDOWS_CLOSE_BOUND_MS)
  })

  it('takes C:\\Windows when %SystemRoot% is not a folder of a disk: never a program found by its name', async () => {
    for (const root of ['', '\\Windows', 'Windows']) {
      vi.stubEnv('SystemRoot', root)
      run.execFile.mockReset()
      answer('gone\n')
      await endDescendants(SHELL)
      expect(run.execFile.mock.calls[0]?.[0], root).toBe(WINDOWS_POWERSHELL)
    }
  })

  it('the script names the shell by its pid and by the latest moment it can have been created at', () => {
    const script = descendantsScript(SHELL)
    expect(script).toContain('$_.ProcessId -eq 4242 }')
    // (1 760 000 000 123 ms + 1 ms + the ms from year 1 to 1970) in ticks of 100 ns.
    expect(script).toContain('.ToUniversalTime().Ticks -gt 638955968001240000)')
    expect(descendantsScript({ pid: 8, startedBy: 0 })).toContain('.Ticks -gt 621355968000010000)')
    // A pid and a time that are not whole numbers are cut, never pasted as they came.
    expect(descendantsScript({ pid: 4242.9, startedBy: 0.9 })).toBe(descendantsScript({ pid: 4242, startedBy: 0 }))
    // The shell itself is never among what is ended, and taskkill is not used.
    expect(script).not.toMatch(/taskkill|Stop-Process -Id/)
    // A process older than the one it names as its parent is passed by: that pid had another owner before.
    // Only the text is pinned: a pid given out again cannot be made on demand.
    expect(script).toContain('$child.CreationDate -lt $parent.CreationDate) { continue }')
    // One argument of a command line: a double quote in it would have to survive two parsers.
    expect(script).not.toContain('"')
  })

  it('resolves for "ended n of n" and for "gone", quietly', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    for (const stdout of ['ended 3 of 3\r\n', 'ended 0 of 0', 'gone\r\n', 'a warning line\r\nended 2 of 2\r\n']) {
      answer(stdout)
      await expect(endDescendants(SHELL)).resolves.toBeUndefined()
    }
    expect(warn).not.toHaveBeenCalled()
  })

  it('says so when a process under the shell could not be ended', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    answer('ended 1 of 3\r\n')
    await expect(endDescendants(SHELL)).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/1 of 3 processes under the shell 4242 were ended/))
  })

  it('rejects when the helper cannot start, runs out of time or fails, and when its answer is not one of the two', async () => {
    const failure = Object.assign(new Error('spawn powershell.exe ENOENT'), { code: 'ENOENT' })
    answer('', failure)
    await expect(endDescendants(SHELL)).rejects.toBe(failure)
    const timedOut = Object.assign(new Error('Command failed'), { killed: true, signal: 'SIGTERM' })
    answer('ended 1 of 1', timedOut)
    await expect(endDescendants(SHELL)).rejects.toBe(timedOut)
    for (const stdout of ['', 'ended', 'ended 1 of', 'Ended 1 of 1', 'gone away', 'ended 1 of 1 x']) {
      answer(stdout)
      await expect(endDescendants(SHELL), stdout).rejects.toThrow(/the helper answered/)
    }
  })
})
