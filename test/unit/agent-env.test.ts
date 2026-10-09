// The environment of the Claude Code process (ADR-0007): a real interactive login shell, run with
// a temporary HOME whose rc file stands in for the user's.
//
// On Windows there is no login shell (worfy-windows ticket 09, ADR-0057): the cases of
// captureAgentEnv take the platform, worfy's environment, the answer of `reg query` and the file
// checks as parameters, so they run on the Mac and on Linux CI; the last case runs the real
// agentEnv() on Windows only.
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync } from 'node:fs'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  agentEnv,
  captureAgentEnv,
  captureLoginShellEnv,
  ENV_END_MARKER,
  ENV_START_MARKER,
  expandVars,
  findGitBash,
  findOnPath,
  parseEnvDump,
  parseRegQuery,
  PERSISTENT_ENV_KEYS,
  shellBaseEnv,
  SYSTEM_PATH,
  withoutApiKeys,
  WINDOWS_SESSION_VARS,
  type CapturedEnv,
} from '../../src/main/agent/env'

let home: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'worfy-env-'))
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

/** worfy's own environment as a test sets it: a temporary HOME and whatever else is given. */
function worfyEnv(extra: Record<string, string> = {}): Record<string, string> {
  return { HOME: home, USER: 'tester', SHELL: '/bin/zsh', LANG: 'en_US.UTF-8', ...extra }
}

async function zshrc(content: string): Promise<void> {
  await writeFile(join(home, '.zshrc'), content)
}

// Cases marked onMac run a real /bin/zsh: macOS has it, the Linux CI runner does not. The Mac runs
// them in every gate.
const onMac = it.skipIf(process.platform !== 'darwin')

describe('captureLoginShellEnv', () => {
  onMac('removes ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN even when worfy itself has them', async () => {
    await zshrc('export ANTHROPIC_API_KEY=from-rc\nexport ANTHROPIC_AUTH_TOKEN=from-rc\n')
    const result = await captureLoginShellEnv({
      shell: '/bin/zsh',
      source: worfyEnv({ ANTHROPIC_API_KEY: 'worfy-own-key', ANTHROPIC_AUTH_TOKEN: 'worfy-own-token' }),
    })
    expect(result.from).toBe('login-shell')
    expect(result.env).not.toHaveProperty('ANTHROPIC_API_KEY')
    expect(result.env).not.toHaveProperty('ANTHROPIC_AUTH_TOKEN')
    expect(JSON.stringify(result.env)).not.toContain('worfy-own-key')
  })

  onMac("keeps the user's own ANTHROPIC_* and CLAUDE_CODE_* variables from the rc file", async () => {
    await zshrc('export ANTHROPIC_MODEL=opus\nexport CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000\nexport PATH="$HOME/bin:$PATH"\n')
    const { env } = await captureLoginShellEnv({ shell: '/bin/zsh', source: worfyEnv() })
    expect(env.ANTHROPIC_MODEL).toBe('opus')
    expect(env.CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBe('64000')
    // ~/.zshrc is read: the shell is interactive (-i), as nvm needs.
    expect(env.PATH?.split(':')[0]).toBe(join(home, 'bin'))
  })

  onMac('does not pass the variables of whoever started worfy into the shell', async () => {
    const { env } = await captureLoginShellEnv({
      shell: '/bin/zsh',
      source: worfyEnv({ CLAUDE_CODE_SESSION_ID: 'parent-session', ANTHROPIC_BASE_URL: 'http://proxy', PATH: '/parent/bin:/usr/bin' }),
    })
    expect(env).not.toHaveProperty('CLAUDE_CODE_SESSION_ID')
    expect(env).not.toHaveProperty('ANTHROPIC_BASE_URL')
    expect(env.PATH).not.toContain('/parent/bin')
    expect(env.HOME).toBe(home)
  })

  onMac('keeps a value with a newline whole and ignores what the rc file prints', async () => {
    await zshrc("echo 'banner from zshrc'\nexport MULTI=$'line one\\nFAKE=line two'\n")
    const { env } = await captureLoginShellEnv({ shell: '/bin/zsh', source: worfyEnv() })
    expect(env.MULTI).toBe('line one\nFAKE=line two')
    expect(env).not.toHaveProperty('FAKE')
    expect(Object.keys(env).some((key) => key.includes('banner'))).toBe(false)
  })

  it('falls back to the minimal environment, without API keys, when the shell hangs past the timeout', async () => {
    const shell = join(home, 'slow-shell')
    await writeFile(shell, '#!/bin/sh\nsleep 5\n')
    await chmod(shell, 0o755)
    const started = Date.now()
    const result = await captureLoginShellEnv({ shell, source: worfyEnv({ ANTHROPIC_API_KEY: 'k' }), timeoutMs: 300 })
    expect(Date.now() - started).toBeLessThan(3000)
    expect(result.from).toBe('fallback')
    expect(result.error).toMatch(/slow-shell -ilc failed/)
    expect(result.env).toEqual({ PATH: SYSTEM_PATH, HOME: home, USER: 'tester', SHELL: '/bin/zsh', LANG: 'en_US.UTF-8' })
  })

  it('falls back when the shell does not exist', async () => {
    const result = await captureLoginShellEnv({ shell: join(home, 'no-such-shell'), source: worfyEnv() })
    expect(result.from).toBe('fallback')
    expect(result.env.PATH).toBe(SYSTEM_PATH)
  })
})

describe('environment helpers', () => {
  it('starts the shell with the user variables and the system PATH only', () => {
    expect(shellBaseEnv({ HOME: '/h', USER: 'u', PATH: '/x', ANTHROPIC_API_KEY: 'k', CLAUDE_CODE_SESSION_ID: 's' })).toEqual({ PATH: SYSTEM_PATH, HOME: '/h', USER: 'u' })
  })

  it('reads only the entries between the markers', () => {
    const dump = ['noise', ENV_START_MARKER, 'A=1', 'B=x=y', 'C=line\nnext', ENV_END_MARKER, 'TAIL=1', ''].join('\0')
    expect(parseEnvDump(dump)).toEqual({ A: '1', B: 'x=y', C: 'line\nnext' })
    expect(parseEnvDump('A=1\0')).toBeNull()
  })

  it('removes exactly the two API key variables', () => {
    expect(withoutApiKeys({ ANTHROPIC_API_KEY: 'a', ANTHROPIC_AUTH_TOKEN: 'b', ANTHROPIC_MODEL: 'm', PATH: '/p' })).toEqual({ ANTHROPIC_MODEL: 'm', PATH: '/p' })
  })
})

const GIT = 'C:\\Program Files\\Git'
const BASH = `${GIT}\\bin\\bash.exe`

/**
 * worfy's process as a parent Claude Code session leaves it when worfy runs from its Bash tool
 * (evidence of ticket 01, sections 13 and 20), with secrets of whoever started worfy.
 */
const parentEnv: Record<string, string> = {
  Path: `C:\\parent\\only;${GIT}\\mingw64\\bin;C:\\Windows\\System32`,
  SystemRoot: 'C:\\Windows',
  USERPROFILE: 'C:\\Users\\u',
  ProgramFiles: 'C:\\Program Files',
  LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local',
  APPDATA: 'C:\\Users\\u\\AppData\\Roaming',
  USERNAME: 'u',
  TEMP: 'C:\\parent\\temp',
  ANTHROPIC_API_KEY: 'key',
  anthropic_auth_token: 'token',
  ANTHROPIC_BASE_URL: 'http://proxy',
  CLAUDECODE: '1',
  CLAUDE_CODE_SESSION_ID: 'parent-session',
  NoDefaultCurrentDirectoryInExePath: '1',
  GH_TOKEN: 'gho_parent',
  GITHUB_TOKEN: 'ghp_parent',
  WORFY_DATA_DIR: 'C:\\parent\\data',
}

/** `reg query` of the two keys: the machine's Path and the user's own variables (setx). */
const regAnswers: Record<string, string> = {
  [PERSISTENT_ENV_KEYS[1]]: [
    '',
    'HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment',
    '    ComSpec    REG_EXPAND_SZ    %SystemRoot%\\system32\\cmd.exe',
    '    NUMBER_OF_PROCESSORS    REG_SZ    16',
    `    Path    REG_EXPAND_SZ    %SystemRoot%\\system32;%SystemRoot%;${GIT}\\cmd;C:\\Program Files\\nodejs`,
    '    TEMP    REG_EXPAND_SZ    %SystemRoot%\\TEMP',
    '    DriverData    REG_SZ    C:\\Windows\\System32\\Drivers\\DriverData',
    '    SomeFlag    REG_DWORD    0x1',
    '',
  ].join('\r\n'),
  [PERSISTENT_ENV_KEYS[0]]: [
    '',
    'HKEY_CURRENT_USER\\Environment',
    '    Path    REG_EXPAND_SZ    %USERPROFILE%\\bin;%LOCALAPPDATA%\\Programs\\tool',
    '    TEMP    REG_EXPAND_SZ    %USERPROFILE%\\AppData\\Local\\Temp',
    '    ANTHROPIC_MODEL    REG_SZ    opus',
    '    ANTHROPIC_API_KEY    REG_SZ    set-with-setx',
    '    NVM_HOME    REG_EXPAND_SZ    %APPDATA%\\nvm',
    '    UNKNOWN_REF    REG_EXPAND_SZ    %NOT_SET%\\x',
    '    EMPTY    REG_SZ',
    '',
  ].join('\r\n'),
}
const regQuery = async (key: string): Promise<string> => regAnswers[key] ?? Promise.reject(new Error(`no ${key}`))
const files = (...present: string[]) => (path: string): boolean => present.some((file) => file.toLowerCase() === path.toLowerCase())

const capture = (options: Partial<Parameters<typeof captureAgentEnv>[0]> = {}): Promise<CapturedEnv> =>
  captureAgentEnv({
    platform: 'win32',
    source: parentEnv,
    regQuery,
    exists: files(`${GIT}\\cmd\\git.exe`, BASH),
    captureShell: () => Promise.reject(new Error('the login shell must not run on Windows')),
    ...options,
  })

describe('captureAgentEnv on win32', () => {
  it('runs no login shell and builds the environment from the registry', async () => {
    const captureShell = vi.fn()
    const result = await capture({ captureShell })
    expect(captureShell).not.toHaveBeenCalled()
    expect(result.from).toBe('registry')
    expect(result.error).toBeNull()
  })

  it("keeps nothing of worfy's process outside the session variables: no tokens, no parent session", async () => {
    const { env } = await capture()
    for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'WORFY_DATA_DIR', 'CLAUDECODE', 'CLAUDE_CODE_SESSION_ID', 'ANTHROPIC_BASE_URL', 'NoDefaultCurrentDirectoryInExePath']) {
      expect(env).not.toHaveProperty(key)
    }
    expect(JSON.stringify(env)).not.toMatch(/gho_parent|ghp_parent|parent-session|C:\\\\parent/)
  })

  it('takes the session variables Windows sets at sign-in from the process', async () => {
    const { env } = await capture()
    expect(env).toMatchObject({ SystemRoot: 'C:\\Windows', USERPROFILE: 'C:\\Users\\u', APPDATA: 'C:\\Users\\u\\AppData\\Roaming', USERNAME: 'u' })
    expect(WINDOWS_SESSION_VARS).toContain('LOCALAPPDATA')
  })

  it("takes the user's persistent variables, the user's over the machine's, REG_EXPAND_SZ expanded", async () => {
    const { env } = await capture()
    expect(env.ANTHROPIC_MODEL).toBe('opus')
    expect(env.ComSpec).toBe('C:\\Windows\\system32\\cmd.exe')
    expect(env.TEMP).toBe('C:\\Users\\u\\AppData\\Local\\Temp')
    expect(env.NVM_HOME).toBe('C:\\Users\\u\\AppData\\Roaming\\nvm')
    expect(env.UNKNOWN_REF).toBe('%NOT_SET%\\x')
    expect(env.EMPTY).toBe('')
    expect(env).not.toHaveProperty('SomeFlag')
  })

  it('builds Path from the machine Path and then the user Path, under one key', async () => {
    const { env } = await capture()
    expect(Object.keys(env).filter((key) => key.toUpperCase() === 'PATH')).toEqual(['Path'])
    expect(env.Path).toBe(
      `C:\\Windows\\system32;C:\\Windows;${GIT}\\cmd;C:\\Program Files\\nodejs;C:\\Users\\u\\bin;C:\\Users\\u\\AppData\\Local\\Programs\\tool`,
    )
  })

  it('removes the API keys, from the process and from the registry, whatever their case', async () => {
    const { env } = await capture()
    for (const key of Object.keys(env)) expect(['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']).not.toContain(key.toUpperCase())
    expect(JSON.stringify(env)).not.toMatch(/set-with-setx|"key"|token/)
  })

  it('without an answer from reg query falls back to the session variables and the Path of the process, and says why', async () => {
    const { env, from, error } = await capture({ regQuery: () => Promise.reject(new Error('reg is missing')) })
    expect(from).toBe('fallback')
    expect(env.Path).toBe(parentEnv.Path)
    expect(env).not.toHaveProperty('GH_TOKEN')
    expect(env).not.toHaveProperty('CLAUDECODE')
    expect(error).toMatch(/reg query failed/)
    expect(error).toMatch(/reg is missing/)
  })

  it('points Claude Code at Git Bash', async () => {
    const { env } = await capture()
    expect(env.CLAUDE_CODE_GIT_BASH_PATH).toBe(BASH)
  })

  it("keeps the user's own CLAUDE_CODE_GIT_BASH_PATH from the registry", async () => {
    const own = 'D:\\tools\\git\\bin\\bash.exe'
    const { env } = await capture({
      regQuery: async (key) => (key === PERSISTENT_ENV_KEYS[0] ? `${regAnswers[key]}    CLAUDE_CODE_GIT_BASH_PATH    REG_SZ    ${own}\r\n` : regAnswers[key]!),
    })
    expect(env.CLAUDE_CODE_GIT_BASH_PATH).toBe(own)
  })

  it('without Git Bash sets no variable and says the agent has no Bash tool', async () => {
    const { env, error } = await capture({ exists: files() })
    expect(env).not.toHaveProperty('CLAUDE_CODE_GIT_BASH_PATH')
    expect(error).toBe('Git Bash not found: the agent has no Bash tool')
  })
})

describe('captureAgentEnv elsewhere', () => {
  it.each(['darwin', 'linux'] as const)('on %s takes the login shell environment, as before', async (platform) => {
    const shellResult: CapturedEnv = { env: { PATH: '/usr/bin' }, from: 'login-shell', error: null }
    const captureShell = vi.fn(async () => shellResult)
    const regQuery = vi.fn()
    expect(await captureAgentEnv({ platform, source: parentEnv, captureShell, regQuery })).toBe(shellResult)
    expect(captureShell).toHaveBeenCalledOnce()
    expect(regQuery).not.toHaveBeenCalled()
  })
})

describe('findGitBash', () => {
  const env = (path: string) => ({ Path: path, ProgramFiles: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local', SystemRoot: 'C:\\Windows' })

  it.each([
    ['cmd', 'D:\\Git\\cmd\\git.exe'],
    ['bin', 'D:\\Git\\bin\\git.exe'],
    ['mingw64\\bin', 'D:\\Git\\mingw64\\bin\\git.exe'],
  ])('finds it from git.exe in <Git>\\%s', (_dir, git) => {
    const path = win32.dirname(git)
    expect(findGitBash(env(`C:\\Windows\\System32;${path}`), files(git, 'D:\\Git\\bin\\bash.exe'))).toBe('D:\\Git\\bin\\bash.exe')
  })

  it('then under %ProgramFiles%, then under %LOCALAPPDATA%\\Programs', () => {
    expect(findGitBash(env('C:\\Windows\\System32'), files(BASH))).toBe(BASH)
    const userGit = 'C:\\Users\\u\\AppData\\Local\\Programs\\Git\\bin\\bash.exe'
    expect(findGitBash(env('C:\\Windows\\System32'), files(userGit))).toBe(userGit)
  })

  it('takes Git Bash, not the WSL launcher that comes first on the Path', () => {
    // As on the owner's PC: C:\Windows\System32 (with bash.exe of WSL) before Git's cmd.
    const wsl = 'C:\\Windows\\System32\\bash.exe'
    expect(findGitBash(env(`C:\\Windows\\System32;${GIT}\\cmd`), files(wsl, `${GIT}\\cmd\\git.exe`, BASH))).toBe(BASH)
    expect(findGitBash(env('C:\\Windows\\System32'), files(wsl))).toBeNull()
  })

  it('refuses a candidate under the Windows folder', () => {
    // A git.exe under the Windows folder would make <SystemRoot>\bin\bash.exe the candidate.
    expect(findGitBash(env('C:\\Windows\\cmd'), files('C:\\Windows\\cmd\\git.exe', 'C:\\Windows\\bin\\bash.exe'))).toBeNull()
  })
})

describe('findOnPath and the reg query reader', () => {
  it('finds <name>.exe on the Path, whatever the case of the key, first match first', () => {
    const exists = files('C:\\a\\node.exe', 'C:\\b\\node.exe')
    expect(findOnPath('node', { PATH: 'C:\\x;C:\\a;C:\\b' }, exists)).toBe('C:\\a\\node.exe')
    expect(findOnPath('node', { Path: '"C:\\b";C:\\a' }, exists)).toBe('C:\\b\\node.exe')
    expect(findOnPath('pwsh', { Path: 'C:\\a' }, exists)).toBeNull()
  })

  it('reads name, type and value of reg query, not the key line', () => {
    expect(parseRegQuery(regAnswers[PERSISTENT_ENV_KEYS[0]]!).slice(0, 3)).toEqual([
      { name: 'Path', type: 'REG_EXPAND_SZ', value: '%USERPROFILE%\\bin;%LOCALAPPDATA%\\Programs\\tool' },
      { name: 'TEMP', type: 'REG_EXPAND_SZ', value: '%USERPROFILE%\\AppData\\Local\\Temp' },
      { name: 'ANTHROPIC_MODEL', type: 'REG_SZ', value: 'opus' },
    ])
    expect(parseRegQuery('    EMPTY    REG_SZ')).toEqual([{ name: 'EMPTY', type: 'REG_SZ', value: '' }])
  })

  it('expands %NAME% in any case and leaves an unknown one', () => {
    expect(expandVars('%systemroot%\\x;%NOPE%', { SystemRoot: 'C:\\Windows' })).toBe('C:\\Windows\\x;%NOPE%')
  })
})

describe.runIf(process.platform === 'win32')('agentEnv on this Windows machine', () => {
  it('finds git, node and gh, points CLAUDE_CODE_GIT_BASH_PATH at a Git Bash outside System32, and carries no parent session', async () => {
    const { env, from, error } = await agentEnv()
    expect(from).toBe('registry')
    expect(error).toBeNull()
    for (const tool of ['git', 'node', 'gh']) {
      const found = execFileSync('where.exe', [tool], { env, encoding: 'utf8' })
      expect(found.trim()).not.toBe('')
    }
    const bash = env.CLAUDE_CODE_GIT_BASH_PATH ?? ''
    expect(existsSync(bash)).toBe(true)
    expect(bash.toLowerCase()).not.toContain('\\system32\\')
    // The tests themselves run inside a Claude Code session on this machine, so these are in process.env.
    for (const key of Object.keys(env)) {
      expect(key.toUpperCase()).not.toMatch(/^(CLAUDECODE|CLAUDE_CODE_SESSION_ID|NODEFAULTCURRENTDIRECTORYINEXEPATH|GH_TOKEN|ANTHROPIC_API_KEY)$/)
    }
  })

  it('findOnPath sees the app execution alias of pwsh from MSIX, when one is installed', () => {
    const alias = win32.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WindowsApps', 'pwsh.exe')
    let isAlias = false
    try {
      isAlias = lstatSync(alias).isSymbolicLink()
    } catch {
      isAlias = false
    }
    if (!isAlias) return // no MSIX pwsh on this machine: nothing to check
    expect(existsSync(alias)).toBe(false) // the reason findOnPath has its own check (evidence of ticket 01, section 25)
    expect(findOnPath('pwsh', { Path: win32.dirname(alias) })).toBe(alias)
  })
})
