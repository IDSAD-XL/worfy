// The environment of the Claude Code process (ADR-0007): a real interactive login shell, run with
// a temporary HOME whose rc file stands in for the user's.
//
// On Windows there is no login shell (worfy-windows ticket 09, ADR-0057): the cases of
// captureAgentEnv take the platform, worfy's environment, the registry reader (`readKey`, values
// already parsed) and the file checks as parameters, and the reader takes the process runner, so
// they run on the Mac and on Linux CI. The last two blocks run the real reader and agentEnv() on
// Windows only.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
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
  powershellCommand,
  powershellRegRead,
  powershellScriptCommand,
  fileRegRead,
  REGISTRY_HIVE_VAR,
  REGISTRY_SCRIPT,
  REGISTRY_STAND_IN_VAR,
  REGISTRY_SUBKEY_VAR,
  registryReader,
  registryVars,
  runFile,
  stderrLine,
  shellBaseEnv,
  SYSTEM_PATH,
  withoutApiKeys,
  WINDOWS_SESSION_VARS,
  type CapturedEnv,
  type RegRead,
  type RegValue,
  type RunFile,
} from '../../src/main/agent/env'
import { removeTestTree } from '../remove'

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

// Cases marked onMac run a real /bin/zsh: macOS has it, the Linux CI runner does not. Windows has
// no login shell at all: there captureAgentEnv reads the registry and never calls
// captureLoginShellEnv ('captureAgentEnv on win32' below, and the two blocks that run on Windows
// only). The Mac runs them in every gate.
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
    expect(WINDOWS_SESSION_VARS).toEqual([
      'SystemRoot', 'SystemDrive', 'windir', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP',
      'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'HOMESHARE', 'APPDATA', 'LOCALAPPDATA', 'ProgramData',
      'LOGONSERVER', 'USERDOMAIN_ROAMINGPROFILE', 'USERDNSDOMAIN', 'SESSIONNAME', 'CLIENTNAME',
      'ProgramFiles', 'ProgramFiles(x86)', 'ProgramFiles(Arm)', 'ProgramW6432',
      'CommonProgramFiles', 'CommonProgramFiles(x86)', 'CommonProgramFiles(Arm)', 'CommonProgramW6432',
      'PUBLIC', 'ALLUSERSPROFILE', 'COMPUTERNAME', 'USERNAME', 'USERDOMAIN', 'OS',
      'PROCESSOR_ARCHITECTURE', 'PROCESSOR_IDENTIFIER', 'PROCESSOR_LEVEL', 'PROCESSOR_REVISION', 'NUMBER_OF_PROCESSORS',
    ])
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
      name: 'once past 32,767 characters a value stays as written, even if later references make it shorter',
      machine: key(['BIG', SZ, 'x'.repeat(32_760)], ['E', SZ, ''], ['STICKY', EXPAND, '%BIG%%E%%E%%E%']),
      user: key(),
      expected: { STICKY: '%BIG%%E%%E%%E%' },
    },
    {
      name: 'a value is cut at its first NUL, and a name with a NUL is dropped',
      machine: key(['TOOLS', EXPAND, '%SystemRoot%\\tools\0junk'], ['SZ_NUL', SZ, 'C:\\a\0b'], ['BAD\0NAME', SZ, 'x'], ['USES', EXPAND, '%TOOLS%\\bin']),
      user: key(),
      expected: { TOOLS: 'C:\\Windows\\tools', SZ_NUL: 'C:\\a', USES: 'C:\\Windows\\tools\\bin' },
      absent: ['BAD\0NAME', 'BAD'],
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

  it('a failure reading only the machine key still falls back', async () => {
    const { env, from, error } = await capture({ readKey: async (name) => (name === PERSISTENT_ENV_KEYS[1] ? Promise.reject(new Error('machine key unreadable')) : regAnswers[name]!) })
    expect(from).toBe('fallback')
    expect(error).toMatch(/machine key unreadable/)
    expect(env).not.toHaveProperty('ANTHROPIC_MODEL')
  })

  it('a failure reading only the user key still falls back', async () => {
    const { env, from, error } = await capture({ readKey: async (name) => (name === PERSISTENT_ENV_KEYS[0] ? Promise.reject(new Error('user key unreadable')) : regAnswers[name]!) })
    expect(from).toBe('fallback')
    expect(error).toMatch(/user key unreadable/)
    expect(env).not.toHaveProperty('DriverData')
  })

  it('an environment with a NUL in the registry still starts a process', async () => {
    const { env } = await capture({ readKey: async (name) => (name === PERSISTENT_ENV_KEYS[0] ? key(['TOOLS', SZ, 'C:\\tools\0junk'], ['N\0UL', SZ, 'x']) : regAnswers[name]!) })
    expect(env.TOOLS).toBe('C:\\tools')
    const started = spawnSync(process.execPath, ['-e', ''], { env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 20_000 })
    expect(started.error).toBeUndefined()
    expect(started.status).toBe(0)
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

// worfy-windows ticket 81: an e2e sandbox names a JSON file that stands in for the registry.
describe('the registry stand-in of WORFY_REGISTRY_STAND_IN', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'worfy-registry-stand-in-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('without the variable, or with it empty, the registry is read through Windows PowerShell of %SystemRoot%, as before', () => {
    for (const source of [parentEnv, { ...parentEnv, [REGISTRY_STAND_IN_VAR]: '' }]) {
      const reader: RegRead = vi.fn()
      const powershell = vi.fn(() => reader)
      expect(registryReader(source, powershell)).toBe(reader)
      expect(powershell).toHaveBeenCalledWith(parentEnv.SystemRoot)
    }
  })

  it('with the variable, captureAgentEnv builds the environment from the file, read anew on every capture', async () => {
    const file = join(dir, 'registry.json')
    const write = (path: string): Promise<void> =>
      writeFile(file, JSON.stringify({ [PERSISTENT_ENV_KEYS[0]]: key(['Path', SZ, path], ['FAKE_GH_ACCOUNT', SZ, 'alice']), [PERSISTENT_ENV_KEYS[1]]: [] }))
    await write('C:\\sandbox\\bin')
    const source = { ...parentEnv, [REGISTRY_STAND_IN_VAR]: file }
    const first = await capture({ source, readKey: undefined })
    expect(first).toMatchObject({ from: 'registry', env: { Path: 'C:\\sandbox\\bin', FAKE_GH_ACCOUNT: 'alice' } })
    expect(first.env).not.toHaveProperty('NVM_HOME')
    await write('C:\\other\\bin')
    expect((await capture({ source, readKey: undefined })).env.Path).toBe('C:\\other\\bin')
  })

  it('a key the file lacks is a registry that cannot be read: the capture falls back and says why', async () => {
    const file = join(dir, 'registry.json')
    await writeFile(file, JSON.stringify({ [PERSISTENT_ENV_KEYS[0]]: [] }))
    await expect(fileRegRead(file)(PERSISTENT_ENV_KEYS[1])).rejects.toThrow(`${PERSISTENT_ENV_KEYS[1]} is not in the registry stand-in ${file}`)
    const { from, error } = await capture({ source: { ...parentEnv, [REGISTRY_STAND_IN_VAR]: file }, readKey: undefined })
    expect(from).toBe('fallback')
    expect(error).toContain('is not in the registry stand-in')
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

  it('looks under %ProgramFiles(x86)% too, after %ProgramFiles% and before the folder of the user', () => {
    const x86 = 'C:\\Program Files (x86)\\Git\\bin\\bash.exe'
    const userGit = 'C:\\Users\\u\\AppData\\Local\\Programs\\Git\\bin\\bash.exe'
    const withX86 = { ...env('C:\\Windows\\System32'), 'ProgramFiles(x86)': 'C:\\Program Files (x86)' }
    expect(findGitBash(withX86, files(x86, userGit))).toBe(x86)
    expect(findGitBash(withX86, files(BASH, x86))).toBe(BASH)
    // Without the variable that folder is not guessed.
    expect(findGitBash(env('C:\\Windows\\System32'), files(x86))).toBeNull()
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

  it('passes by an entry of the Path that is not a full path: it would be looked for in the folder worfy runs in', () => {
    // Every one of these "has" the program; only the entry with a drive or a server is asked.
    const everywhere = () => true
    for (const entry of ['.', 'tools', '..\\bin', '\\bin', 'C:tools', '%NOPE%\\bin']) {
      expect(findOnPath('node', { Path: `${entry};D:\\last` }, everywhere), entry).toBe('D:\\last\\node.exe')
      expect(findOnPath('node', { Path: entry }, everywhere), entry).toBeNull()
    }
    expect(findOnPath('node', { Path: '\\\\server\\tools' }, everywhere)).toBe('\\\\server\\tools\\node.exe')
    expect(findOnPath('node', { Path: 'c:/tools' }, everywhere)).toBe('c:\\tools\\node.exe')
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

  // worfy-windows ticket 21: one text for every key. On the owner's PC, from Electron, a script that
  // decodes base64 — its own text with -EncodedCommand, or a string with FromBase64String — cost
  // about a second more the first time a process ran it; this one is handed over as text and only
  // encodes.
  it('the registry script is one text: it opens the key the environment names through the .NET API, reads values unexpanded, and prints only String and ExpandString, in base64', () => {
    expect(REGISTRY_SCRIPT).toBe(
      [
        "$ErrorActionPreference = 'Stop'",
        '$b64 = { param($s) [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$s)) }',
        'try {',
        '  $hives = @{ CurrentUser = [Microsoft.Win32.Registry]::CurrentUser; LocalMachine = [Microsoft.Win32.Registry]::LocalMachine }',
        '  $hive = $hives[[string]$env:WORFY_REGISTRY_HIVE]',
        '  if ($null -eq $hive) { throw "not a hive this script reads: $env:WORFY_REGISTRY_HIVE" }',
        '  $path = [string]$env:WORFY_REGISTRY_SUBKEY',
        '  $key = $hive.OpenSubKey($path)',
        '  if ($null -eq $key) { throw "no such key: $path" }',
        '  foreach ($name in $key.GetValueNames()) {',
        "    if ($name -eq '') { continue }",
        '    $kind = $key.GetValueKind($name).ToString()',
        "    if ($kind -ne 'String' -and $kind -ne 'ExpandString') { continue }",
        "    $value = $key.GetValue($name, '', 'DoNotExpandEnvironmentNames')",
        '    "$kind $(& $b64 $name) $(& $b64 $value)"',
        '  }',
        '} catch {',
        '  "Error $(& $b64 $_.Exception.Message)"',
        '  exit 1',
        '}',
      ].join('\n'),
    )
    expect(REGISTRY_SCRIPT).not.toMatch(/FromBase64String/i)
    expect([REGISTRY_HIVE_VAR, REGISTRY_SUBKEY_VAR]).toEqual(['WORFY_REGISTRY_HIVE', 'WORFY_REGISTRY_SUBKEY'])
  })

  it('the key goes into two variables as it is written, whatever is in its name; a key of another hive is refused', () => {
    // A / is part of the name of a key, not a separator (worfy-windows ticket 29).
    const subkey = 'Software\\it’s ‘quoted’ "and" $(more); Ключ a/b'
    expect(registryVars(`HKCU\\${subkey}`)).toEqual({ WORFY_REGISTRY_HIVE: 'CurrentUser', WORFY_REGISTRY_SUBKEY: subkey })
    expect(registryVars(PERSISTENT_ENV_KEYS[0])).toEqual({ WORFY_REGISTRY_HIVE: 'CurrentUser', WORFY_REGISTRY_SUBKEY: 'Environment' })
    expect(registryVars(PERSISTENT_ENV_KEYS[1])).toEqual({ WORFY_REGISTRY_HIVE: 'LocalMachine', WORFY_REGISTRY_SUBKEY: 'SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment' })
    expect(registryVars('hklm\\x')).toEqual({ WORFY_REGISTRY_HIVE: 'LocalMachine', WORFY_REGISTRY_SUBKEY: 'x' })
    expect(() => registryVars('HKCR\\x')).toThrow(/not a key of HKCU or HKLM/)
    expect(() => registryVars('CurrentUser\\x')).toThrow(/not a key of HKCU or HKLM/)
  })

  it('starts Windows PowerShell of SystemRoot by its absolute path, without a profile or prompts, hidden, with a timeout; the script as text, the key in the environment', () => {
    const env = { SystemRoot: 'D:\\Win', Path: 'D:\\bin', WORFY_REGISTRY_SUBKEY: 'left over' }
    const { file, args, options } = powershellCommand('D:\\Win', PERSISTENT_ENV_KEYS[0], env)
    expect(file).toBe('D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    expect(args).toEqual(['-NoProfile', '-NonInteractive', '-Command', REGISTRY_SCRIPT])
    expect(options).toEqual({ encoding: 'utf8', timeout: 10_000, windowsHide: true, env: { SystemRoot: 'D:\\Win', Path: 'D:\\bin', WORFY_REGISTRY_HIVE: 'CurrentUser', WORFY_REGISTRY_SUBKEY: 'Environment' } })
    // The other key: the same arguments, another environment.
    const machine = powershellCommand('D:\\Win', PERSISTENT_ENV_KEYS[1], env)
    expect(machine.args).toEqual(args)
    expect(machine.options.env).toMatchObject({ WORFY_REGISTRY_HIVE: 'LocalMachine', WORFY_REGISTRY_SUBKEY: 'SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment' })
    // By default the data is added to the environment of worfy itself.
    expect(powershellCommand('D:\\Win', PERSISTENT_ENV_KEYS[0]).options.env).toEqual({ ...process.env, WORFY_REGISTRY_HIVE: 'CurrentUser', WORFY_REGISTRY_SUBKEY: 'Environment' })
    for (const root of [undefined, '', 'Windows', 'C:Windows', '\\Windows', '/Windows']) {
      expect(powershellCommand(root, PERSISTENT_ENV_KEYS[0]).file).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    }
  })

  it('a script without data runs in the environment of worfy as it is: no environment is given', () => {
    const { args, options } = powershellScriptCommand('C:\\Windows', 'exit 0')
    expect(args).toEqual(['-NoProfile', '-NonInteractive', '-Command', 'exit 0'])
    expect(options).toEqual({ encoding: 'utf8', timeout: 10_000, windowsHide: true })
    expect(powershellScriptCommand('C:\\Windows', 'exit 0', { A: '1' }, { B: '2' }).options.env).toEqual({ A: '1', B: '2' })
  })

  // The process runner of powershellRegRead, answering with `answer` and recording what it ran.
  const runner = (answer: { error?: { code?: unknown; killed?: boolean }; stdout?: string; stderr?: string }) => {
    const calls: { file: string; args: string[]; key: (string | undefined)[] }[] = []
    const run: RunFile = (file, args, options, done) => {
      calls.push({ file, args, key: [options.env?.[REGISTRY_HIVE_VAR], options.env?.[REGISTRY_SUBKEY_VAR]] })
      done(answer.error ?? null, answer.stdout ?? '', answer.stderr ?? '')
    }
    return { run, calls }
  }

  it('the reader runs powershellCommand with the key in the environment and gives [] for empty output', async () => {
    const { run, calls } = runner({ stdout: '' })
    await expect(powershellRegRead('C:\\Windows', run)(PERSISTENT_ENV_KEYS[0])).resolves.toEqual([])
    await expect(powershellRegRead('C:\\Windows', run)(PERSISTENT_ENV_KEYS[1])).resolves.toEqual([])
    const { file, args } = powershellCommand('C:\\Windows', PERSISTENT_ENV_KEYS[0])
    expect(calls).toEqual([
      { file, args, key: ['CurrentUser', 'Environment'] },
      { file, args, key: ['LocalMachine', 'SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'] },
    ])
  })

  it("the reader's error says the timeout, the script's own message, or the first line of stderr", async () => {
    const read = (answer: Parameters<typeof runner>[0]) => powershellRegRead('C:\\Windows', runner(answer).run)(PERSISTENT_ENV_KEYS[0])
    await expect(read({ error: { killed: true, code: null } })).rejects.toThrow(/could not read HKCU\\Environment: timed out after 10 s$/)
    await expect(read({ error: { code: 1 }, stdout: `Error ${b64('no such key: Ключ')}\r\n` })).rejects.toThrow(/: no such key: Ключ$/)
    await expect(read({ error: { code: 1 }, stderr: '\r\nAccess is denied.\r\nsecond\r\n\r\n' })).rejects.toThrow(/: exit 1: Access is denied\.$/)
    // powershell.exe writes a redirected error stream as CLIXML: its first Error string is the message.
    const clixml = '#< CLIXML\r\n<Objs Version="1.1.0.1"><Obj S="progress" RefId="0"></Obj><S S="Error">Get-Item : Cannot find path &apos;x&apos;._x000D__x000A_</S><S S="Error">At line:2 char:1_x000D__x000A_</S></Objs>'
    await expect(read({ error: { code: 1 }, stderr: clixml })).rejects.toThrow(/: exit 1: Get-Item : Cannot find path 'x'\.$/)
    expect(stderrLine('#< CLIXML\r\n<Objs Version="1.1.0.1"></Objs>')).toBeNull()
    expect(stderrLine(' \r\n\r\n')).toBeNull()
    await expect(read({ error: { code: 'ENOENT' } })).rejects.toThrow(/: exit ENOENT$/)
  })

  // worfy-windows ticket 29: the stderr of `throw 'boom'` from powershell.exe, measured on the
  // owner's PC (Windows 11, Russian locale) from Node 24.21.0 with the output redirected. With
  // -Command it is plain text, 176 characters, the message on its first line and the line of the
  // script on the second, in the OEM code page, so not UTF-8 (U+FFFD here); with -EncodedCommand it
  // is CLIXML, 477 characters, the same lines as Error strings.
  const OEM_POSITION = '\uFFFD\uFFFD\u0BAA\uFFFD:1 \uFFFD\uFFFD\uFFFD\uFFFD:1'
  const BOOM_TEXT = `boom\r\n${OEM_POSITION}\r\n+ throw 'boom'\r\n+ ~~~~~~~~~~~~\r\n    + CategoryInfo          : OperationStopped: (boom:String) [], RuntimeException\r\n    + FullyQualifiedErrorId : boom\r\n \r\n`
  const BOOM_CLIXML =
    '#< CLIXML\r\n<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04">' +
    [`boom`, OEM_POSITION, "+ throw 'boom'", '+ ~~~~~~~~~~~~', '    + CategoryInfo          : OperationStopped: (boom:String) [], RuntimeException', '    + FullyQualifiedErrorId : boom', ' ']
      .map((line) => `<S S="Error">${line}_x000D__x000A_</S>`)
      .join('') +
    '</Objs>'

  it('takes the message of a failure from the first line of stderr, plain text (-Command) or CLIXML (-EncodedCommand)', async () => {
    expect([BOOM_TEXT.length, BOOM_CLIXML.length]).toEqual([176, 477])
    expect(stderrLine(BOOM_TEXT)).toBe('boom')
    expect(stderrLine(BOOM_CLIXML)).toBe('boom')
    await expect(powershellRegRead('C:\\Windows', runner({ error: { code: 1 }, stderr: BOOM_TEXT }).run)(PERSISTENT_ENV_KEYS[0])).rejects.toThrow(/: exit 1: boom$/)
  })

  // worfy-windows ticket 29: the scripts get their data only through the environment runFile hands
  // on; were it lost, the script of the live Session check would read no pids at all.
  it('runFile starts the program with the environment it is given', async () => {
    // Under `pnpm test` process.execPath is Electron, a Node only with ELECTRON_RUN_AS_NODE: checked
    // first, so that even a runFile that dropped `env` starts no Electron window.
    expect(process.versions.electron === undefined || process.env.ELECTRON_RUN_AS_NODE === '1').toBe(true)
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', WORFY_RUN_FILE_TEST: 'given Ключ' }
    const script = 'process.stdout.write(String(process.env.WORFY_RUN_FILE_TEST))'
    const answer = await new Promise<{ error: unknown; stdout: string }>((resolve) =>
      runFile(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 10_000, windowsHide: true, env }, (error, stdout) => resolve({ error, stdout })),
    )
    expect(answer).toEqual({ error: null, stdout: 'given Ключ' })
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
    await expect(powershellRegRead(process.env.SystemRoot ?? 'C:\\Windows')(`${SCRATCH}\\missing`)).rejects.toThrow(/could not read .*: no such key: Software/)
  })

  // worfy-windows ticket 21: the key reaches the script through the environment, not through its text.
  it('reads a key whose name has Cyrillic, quotes and what PowerShell would take for code', async () => {
    const subkey = 'Ключ ‘it’s’ $(Get-Date); `x`'
    execFileSync('reg', ['add', `${SCRATCH}\\${subkey}`, '/v', 'V', '/t', 'REG_SZ', '/d', 'значение 😀', '/f'], { stdio: 'ignore' })
    await expect(powershellRegRead(process.env.SystemRoot ?? 'C:\\Windows')(`${SCRATCH}\\${subkey}`)).resolves.toEqual([{ name: 'V', type: 'REG_SZ', value: 'значение 😀' }])
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

  it('findOnPath passes by what cannot start — a folder of that name, a link to nothing, a link to a folder — and takes a file, also through a link', () => {
    const dir = mkdtempSync(join(tmpdir(), 'worfy-find-on-path-'))
    const links: string[] = []
    const link = (target: string, at: string, kind: 'file' | 'junction'): void => {
      symlinkSync(target, at, kind)
      links.push(at)
    }
    try {
      for (const name of ['folder', 'dangling', 'to-a-folder', 'real', 'linked', 'elsewhere']) mkdirSync(join(dir, name))
      mkdirSync(join(dir, 'folder', 'tool.exe'))
      link(join(dir, 'nothing.exe'), join(dir, 'dangling', 'tool.exe'), 'file')
      link(join(dir, 'elsewhere'), join(dir, 'to-a-folder', 'tool.exe'), 'junction')
      writeFileSync(join(dir, 'real', 'tool.exe'), '')
      link(join(dir, 'real', 'tool.exe'), join(dir, 'linked', 'tool.exe'), 'file')
      const path = (...names: string[]) => ({ Path: names.map((name) => join(dir, name)).join(';') })
      expect(findOnPath('tool', path('folder', 'dangling', 'to-a-folder'))).toBeNull()
      expect(findOnPath('tool', path('folder', 'dangling', 'to-a-folder', 'real'))).toBe(join(dir, 'real', 'tool.exe'))
      expect(findOnPath('tool', path('dangling', 'linked', 'real'))).toBe(join(dir, 'linked', 'tool.exe'))
    } finally {
      // Links first, as links. (From the time this folder went with rmSync; removeTestTree takes a link as a link too.)
      for (const at of links) {
        try {
          rmdirSync(at)
        } catch {
          unlinkSync(at)
        }
      }
      removeTestTree(dir)
    }
  })
})
