// The environment of the Claude Code process (ADR-0007): a real interactive login shell, run with
// a temporary HOME whose rc file stands in for the user's.
//
// On Windows there is no login shell (worfy-windows ticket 09, ADR-0057): the cases of
// captureAgentEnv take the platform, worfy's environment, the answer of `reg query` and the file
// checks as parameters, so they run on the Mac and on Linux CI; the last case runs the real
// agentEnv() on Windows only.
import { execFileSync, spawnSync } from 'node:child_process'
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
  findGitBash,
  findOnPath,
  parseEnvDump,
  MAX_VAR_LENGTH,
  parseRegistryValues,
  PERSISTENT_ENV_KEYS,
  powershellRegRead,
  registryScript,
  shellBaseEnv,
  SYSTEM_PATH,
  withoutApiKeys,
  WINDOWS_SESSION_VARS,
  type CapturedEnv,
  type RegValue,
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

const SZ = 'REG_SZ'
const EXPAND = 'REG_EXPAND_SZ'
/** The values of one registry key, as the reader returns them: [name, type, value]. */
const key = (...values: [string, string, string][]): RegValue[] => values.map(([name, type, value]) => ({ name, type, value }))

/** The two keys: the machine's Path and the user's own variables (setx). */
const regAnswers: Record<string, RegValue[]> = {
  [PERSISTENT_ENV_KEYS[1]]: key(
    ['ComSpec', EXPAND, '%SystemRoot%\\system32\\cmd.exe'],
    ['NUMBER_OF_PROCESSORS', SZ, '16'],
    ['Path', EXPAND, `%SystemRoot%\\system32;%SystemRoot%;${GIT}\\cmd;C:\\Program Files\\nodejs`],
    ['TEMP', EXPAND, '%SystemRoot%\\TEMP'],
    ['DriverData', SZ, 'C:\\Windows\\System32\\Drivers\\DriverData'],
    ['SomeFlag', 'REG_DWORD', '1'],
  ),
  [PERSISTENT_ENV_KEYS[0]]: key(
    ['Path', EXPAND, '%USERPROFILE%\\bin;%LOCALAPPDATA%\\Programs\\tool'],
    ['TEMP', EXPAND, '%USERPROFILE%\\AppData\\Local\\Temp'],
    ['ANTHROPIC_MODEL', SZ, 'opus'],
    ['ANTHROPIC_API_KEY', SZ, 'set-with-setx'],
    ['NVM_HOME', EXPAND, '%APPDATA%\\nvm'],
    ['UNKNOWN_REF', EXPAND, '%NOT_SET%\\x'],
    ['EMPTY', SZ, ''],
  ),
}
const readKey = async (name: string): Promise<RegValue[]> => regAnswers[name] ?? Promise.reject(new Error(`no ${name}`))
const files = (...present: string[]) => (path: string): boolean => present.some((file) => file.toLowerCase() === path.toLowerCase())

const capture = (options: Partial<Parameters<typeof captureAgentEnv>[0]> = {}): Promise<CapturedEnv> =>
  captureAgentEnv({
    platform: 'win32',
    source: parentEnv,
    readKey,
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
    expect(WINDOWS_SESSION_VARS).toEqual(expect.arrayContaining(['LOCALAPPDATA', 'USERDNSDOMAIN', 'ProgramFiles(Arm)', 'CommonProgramFiles(Arm)', 'ProgramW6432', 'CommonProgramW6432']))
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

  // V0 = xx, Vi = %V(i-1)%%V(i-1)%: V13 has 16,384 characters, V14 would have 32,768.
  const doubling = key(['V0', SZ, 'xx'], ...Array.from({ length: 24 }, (_, i): [string, string, string] => [`V${i + 1}`, EXPAND, `%V${i}%%V${i}%`]))
  it.each<{ name: string; machine: RegValue[]; user: RegValue[]; source?: Record<string, string>; expected: Record<string, string>; absent?: string[] }>([
    {
      name: 'nvm-windows: Path names NVM_HOME and NVM_SYMLINK, which come after it in the key',
      machine: key(['Path', EXPAND, '%SystemRoot%\\system32;%NVM_HOME%;%NVM_SYMLINK%'], ['NVM_HOME', EXPAND, '%APPDATA%\\nvm'], ['NVM_SYMLINK', SZ, 'C:\\Program Files\\nodejs']),
      user: key(),
      expected: { Path: 'C:\\Windows\\system32;C:\\Users\\u\\AppData\\Roaming\\nvm;C:\\Program Files\\nodejs' },
    },
    {
      name: 'a forward reference in another case: %nvm_home% before NVM_HOME',
      machine: key(['Path', EXPAND, '%nvm_home%'], ['NVM_HOME', EXPAND, '%APPDATA%\\nvm']),
      user: key(),
      expected: { Path: 'C:\\Users\\u\\AppData\\Roaming\\nvm' },
    },
    {
      name: "nvm-windows for one user: the user's Path names NVM_HOME, set after it in the user's key",
      machine: key(['Path', EXPAND, '%SystemRoot%\\system32']),
      user: key(['Path', EXPAND, '%NVM_HOME%;%NVM_SYMLINK%'], ['NVM_HOME', EXPAND, '%APPDATA%\\nvm'], ['NVM_SYMLINK', SZ, 'C:\\Program Files\\nodejs']),
      expected: { Path: 'C:\\Windows\\system32;C:\\Users\\u\\AppData\\Roaming\\nvm;C:\\Program Files\\nodejs' },
    },
    {
      name: "the machine's key is final before the user's is read: it does not see a variable set only for the user",
      machine: key(['Path', EXPAND, '%SystemRoot%\\system32;%NVM_HOME%']),
      user: key(['NVM_HOME', EXPAND, '%APPDATA%\\nvm']),
      expected: { Path: 'C:\\Windows\\system32;%NVM_HOME%', NVM_HOME: 'C:\\Users\\u\\AppData\\Roaming\\nvm' },
    },
    {
      name: 'a chain: Path → TOOLS → BASE → USERPROFILE of the session, each listed before what it names',
      machine: key(),
      user: key(['Path', EXPAND, '%TOOLS%\\bin'], ['TOOLS', EXPAND, '%BASE%\\tools'], ['BASE', EXPAND, '%USERPROFILE%\\base']),
      expected: { Path: 'C:\\Users\\u\\base\\tools\\bin', TOOLS: 'C:\\Users\\u\\base\\tools', BASE: 'C:\\Users\\u\\base' },
    },
    {
      name: "the user's PATHEXT extends the machine's: %PATHEXT% is the machine's value",
      source: { PATHEXT: '.COM;.EXE;.BAT;.CMD;.PY' },
      machine: key(['PATHEXT', SZ, '.COM;.EXE;.BAT;.CMD']),
      user: key(['PATHEXT', EXPAND, '%PATHEXT%;.PY']),
      expected: { PATHEXT: '.COM;.EXE;.BAT;.CMD;.PY' },
    },
    {
      name: "the user's PSModulePath extends the machine's, itself expanded",
      machine: key(['PSModulePath', EXPAND, '%ProgramFiles%\\WindowsPowerShell\\Modules;%SystemRoot%\\system32\\WindowsPowerShell\\v1.0\\Modules']),
      user: key(['PSModulePath', EXPAND, '%PSModulePath%;%USERPROFILE%\\Modules']),
      expected: { PSModulePath: 'C:\\Program Files\\WindowsPowerShell\\Modules;C:\\Windows\\system32\\WindowsPowerShell\\v1.0\\Modules;C:\\Users\\u\\Modules' },
    },
    {
      name: 'REG_SZ stays literal, and so does the text it brings into a REG_EXPAND_SZ value',
      machine: key(),
      user: key(['USES', EXPAND, '[%LIT%]'], ['LIT', SZ, '50%USERPROFILE%done']),
      expected: { LIT: '50%USERPROFILE%done', USES: '[50%USERPROFILE%done]' },
    },
    {
      name: "the user's value replaces the machine's for any variable but Path, which goes after the machine's",
      machine: key(['Path', SZ, 'C:\\m'], ['TEMP', EXPAND, '%SystemRoot%\\TEMP'], ['EDITOR', SZ, 'notepad']),
      user: key(['Path', SZ, 'C:\\u'], ['TEMP', EXPAND, '%USERPROFILE%\\Temp'], ['EDITOR', SZ, 'code']),
      expected: { Path: 'C:\\m;C:\\u', TEMP: 'C:\\Users\\u\\Temp', EDITOR: 'code' },
    },
    {
      name: "the machine's Path and the user's PATH make one Path",
      machine: key(['Path', SZ, 'C:\\m']),
      user: key(['PATH', SZ, 'C:\\u']),
      expected: { Path: 'C:\\m;C:\\u' },
    },
    {
      name: "an empty user Path adds no ';'",
      machine: key(['Path', SZ, 'C:\\m']),
      user: key(['Path', SZ, '']),
      expected: { Path: 'C:\\m' },
    },
    {
      name: 'no Path in either key, or both empty: no Path at all',
      machine: key(['OTHER', SZ, 'x']),
      user: key(['Path', SZ, '']),
      expected: { OTHER: 'x' },
      absent: ['PATH'],
    },
    {
      name: 'an API key set in the registry in lower case is removed',
      machine: key(),
      user: key(['anthropic_api_key', SZ, 'from-setx'], ['Anthropic_Auth_Token', EXPAND, 'from-setx']),
      expected: {},
      absent: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'],
    },
    {
      name: 'an unknown name and a cycle stay as written, the rest of a value in a cycle is expanded; a name matches in any case',
      machine: key(),
      user: key(['UNKNOWN_REF', EXPAND, '%NOT_SET%\\x'], ['A', EXPAND, '%B%a'], ['B', EXPAND, '%A%b'], ['C', EXPAND, '%A%\\c;%SystemRoot%'], ['LOWER', EXPAND, '%systemroot%\\x']),
      expected: { UNKNOWN_REF: '%NOT_SET%\\x', A: '%B%a', B: '%A%b', C: '%A%\\c;C:\\Windows', LOWER: 'C:\\Windows\\x' },
    },
    {
      name: "a name holds no ';': %P;% is no reference, %Q% after it is",
      machine: key(),
      user: key(['Q', SZ, 'q'], ['X', EXPAND, '%P;%Q%']),
      expected: { X: '%P;q' },
    },
    {
      name: 'a value longer than 32,767 characters stays as written; one of exactly 32,767 is expanded',
      machine: key(['BIG', SZ, 'x'.repeat(20_000)], ['DOUBLE', EXPAND, '%BIG%%BIG%'], ['EXACT', EXPAND, `%BIG%${'y'.repeat(12_767)}`]),
      user: key(),
      expected: { DOUBLE: '%BIG%%BIG%', EXACT: `${'x'.repeat(20_000)}${'y'.repeat(12_767)}` },
    },
    {
      name: 'a value that doubles at every step stops at 32,767 characters',
      machine: doubling,
      user: key(),
      // V14 stays as written; the values after it take that text in, not scanned again.
      expected: { V13: 'x'.repeat(16_384), V14: '%V13%%V13%', V24: '%V13%'.repeat(2_048) },
    },
  ])('expands as a sign-in does: $name', async ({ machine, user, source, expected, absent }) => {
    const answers: Record<string, RegValue[]> = { [PERSISTENT_ENV_KEYS[1]]: machine, [PERSISTENT_ENV_KEYS[0]]: user }
    const { env } = await capture({ source: { ...parentEnv, ...source }, readKey: async (name) => answers[name]! })
    expect(env).toMatchObject(expected)
    const names = Object.keys(env).map((name) => name.toUpperCase())
    expect(new Set(names).size).toBe(names.length)
    for (const name of absent ?? []) expect(names).not.toContain(name)
    expect(MAX_VAR_LENGTH).toBe(32_767)
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

  it('without an answer from the registry falls back to the session variables and the Path of the process, and says why', async () => {
    const { env, from, error } = await capture({ readKey: () => Promise.reject(new Error('powershell is missing')) })
    expect(from).toBe('fallback')
    expect(env.Path).toBe(parentEnv.Path)
    expect(env).not.toHaveProperty('GH_TOKEN')
    expect(env).not.toHaveProperty('CLAUDECODE')
    expect(error).toMatch(/the registry could not be read/)
    expect(error).toMatch(/powershell is missing/)
  })

  it('a failure while the registry is applied leaves nothing of it in the fallback', async () => {
    const broken = { type: 'REG_SZ', value: 'x', get name(): string { throw new Error('broken value') } }
    const { env, from, error } = await capture({ readKey: async (name) => (name === PERSISTENT_ENV_KEYS[0] ? [broken] : regAnswers[name]!) })
    expect(from).toBe('fallback')
    expect(error).toMatch(/broken value/)
    const session = Object.fromEntries(WINDOWS_SESSION_VARS.flatMap((name) => (parentEnv[name] === undefined ? [] : [[name, parentEnv[name]]])))
    expect(env).toEqual({ ...session, Path: parentEnv.Path, CLAUDE_CODE_GIT_BASH_PATH: BASH })
  })

  it('points Claude Code at Git Bash', async () => {
    const { env } = await capture()
    expect(env.CLAUDE_CODE_GIT_BASH_PATH).toBe(BASH)
  })

  it("keeps the user's own CLAUDE_CODE_GIT_BASH_PATH from the registry", async () => {
    const own = 'D:\\tools\\git\\bin\\bash.exe'
    const { env } = await capture({
      readKey: async (name) => (name === PERSISTENT_ENV_KEYS[0] ? [...regAnswers[name]!, ...key(['CLAUDE_CODE_GIT_BASH_PATH', SZ, own])] : regAnswers[name]!),
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
    const readKey = vi.fn()
    expect(await captureAgentEnv({ platform, source: parentEnv, captureShell, readKey })).toBe(shellResult)
    expect(captureShell).toHaveBeenCalledOnce()
    expect(readKey).not.toHaveBeenCalled()
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

describe('findOnPath and the registry reader', () => {
  it('finds <name>.exe on the Path, whatever the case of the key, first match first', () => {
    const exists = files('C:\\a\\node.exe', 'C:\\b\\node.exe')
    expect(findOnPath('node', { PATH: 'C:\\x;C:\\a;C:\\b' }, exists)).toBe('C:\\a\\node.exe')
    expect(findOnPath('node', { Path: '"C:\\b";C:\\a' }, exists)).toBe('C:\\b\\node.exe')
    expect(findOnPath('pwsh', { Path: 'C:\\a' }, exists)).toBeNull()
  })

  const b64 = (text: string): string => Buffer.from(text, 'utf8').toString('base64')

  it('reads the lines of the registry script: name and value in base64 of UTF-8, REG_EXPAND_SZ not expanded', () => {
    const value = 'C:\\Users\\Алексей\\日本\\😀;%USERPROFILE%\\bin'
    expect(parseRegistryValues(`ExpandString ${b64('Path')} ${b64(value)}\r\nString ${b64('ANTHROPIC_MODEL')} ${b64('opus')}\r\n`)).toEqual([
      { name: 'Path', type: 'REG_EXPAND_SZ', value },
      { name: 'ANTHROPIC_MODEL', type: 'REG_SZ', value: 'opus' },
    ])
  })

  it('reads an empty value, an empty key, and skips any other line', () => {
    expect(parseRegistryValues(`String ${b64('EMPTY')} \r\n`)).toEqual([{ name: 'EMPTY', type: 'REG_SZ', value: '' }])
    expect(parseRegistryValues(`String ${b64('EMPTY')}`)).toEqual([{ name: 'EMPTY', type: 'REG_SZ', value: '' }])
    expect(parseRegistryValues('')).toEqual([])
    expect(parseRegistryValues(`#< CLIXML\r\nDWord ${b64('Flag')} ${b64('1')}\r\nwarning: something\r\n`)).toEqual([])
  })

  it('the registry script names the key literally, reads values unexpanded, and prints only String and ExpandString', () => {
    const script = registryScript("HKCU\\Software\\it's")
    expect(script).toContain("Get-Item -LiteralPath 'Registry::HKCU\\Software\\it''s'")
    expect(script).toContain("'DoNotExpandEnvironmentNames'")
    expect(script).toContain("$kind -ne 'String' -and $kind -ne 'ExpandString'")
  })
})

// Each test starts Windows PowerShell: about half a second alone, several under the load of the whole run.
describe.runIf(process.platform === 'win32')('the registry reader on this Windows machine', { timeout: 30_000 }, () => {
  // A scratch key of the test only; Environment is never written.
  const SCRATCH = 'HKCU\\Software\\worfy-test-registry-reader'
  afterEach(() => {
    spawnSync('reg', ['delete', 'HKCU\\Software\\worfy-test-registry-reader', '/f'], { stdio: 'ignore' })
  })

  it('reads Cyrillic, CJK and emoji without loss and REG_EXPAND_SZ unexpanded, where reg query garbles them', async () => {
    const value = 'C:\\Users\\Алексей\\日本\\😀\\%USERPROFILE%'
    execFileSync('reg', ['add', SCRATCH, '/v', 'T', '/t', 'REG_EXPAND_SZ', '/d', value, '/f'], { stdio: 'ignore' })
    execFileSync('reg', ['add', SCRATCH, '/v', 'E', '/t', 'REG_SZ', '/d', '', '/f'], { stdio: 'ignore' })
    execFileSync('reg', ['add', SCRATCH, '/v', 'D', '/t', 'REG_DWORD', '/d', '1', '/f'], { stdio: 'ignore' })
    const values = await powershellRegRead(process.env.SystemRoot ?? 'C:\\Windows')(SCRATCH)
    expect(values).toEqual(expect.arrayContaining([{ name: 'T', type: 'REG_EXPAND_SZ', value }, { name: 'E', type: 'REG_SZ', value: '' }]))
    expect(values).toHaveLength(2)
    expect(execFileSync('reg', ['query', SCRATCH], { encoding: 'utf8' })).not.toContain(value) // the reason reg query is not used
  })

  it('rejects for a key that does not exist', async () => {
    execFileSync('reg', ['add', SCRATCH, '/f'], { stdio: 'ignore' })
    await expect(powershellRegRead(process.env.SystemRoot ?? 'C:\\Windows')(`${SCRATCH}\\missing`)).rejects.toThrow(/could not read/)
  })
})

describe.runIf(process.platform === 'win32')('agentEnv on this Windows machine', { timeout: 30_000 }, () => {
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
  })

  it("with the real registry, drops what a parent session puts into worfy's process", async () => {
    const planted = { CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'planted', NoDefaultCurrentDirectoryInExePath: '1', GH_TOKEN: 'gho_planted', GITHUB_TOKEN: 'ghp_planted', WORFY_DATA_DIR: 'C:\\planted', ANTHROPIC_API_KEY: 'planted' }
    const { env, from, error } = await captureAgentEnv({ platform: 'win32', source: { ...process.env, ...planted } })
    expect(from).toBe('registry')
    expect(error).toBeNull()
    for (const key of Object.keys(env)) expect(Object.keys(planted).map((name) => name.toUpperCase())).not.toContain(key.toUpperCase())
    expect(JSON.stringify(env)).not.toContain('planted')
    expect(env.USERPROFILE).toBe(process.env.USERPROFILE)
  })

  it('findOnPath sees the app execution alias of pwsh from MSIX, when one is installed', (ctx) => {
    const alias = win32.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WindowsApps', 'pwsh.exe')
    const isAlias = (() => {
      try {
        return lstatSync(alias).isSymbolicLink()
      } catch {
        return false
      }
    })()
    if (!isAlias) ctx.skip('no MSIX pwsh on this machine')
    expect(existsSync(alias)).toBe(false) // the reason findOnPath has its own check (evidence of ticket 01, section 25)
    expect(findOnPath('pwsh', { Path: win32.dirname(alias) })).toBe(alias)
  })
})
