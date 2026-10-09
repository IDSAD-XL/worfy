// The status line bridge against the JSON Claude Code passes to the status line command (shape
// recorded from Claude Code 2.1.284, ticket 22): it copies `rate_limits` and nothing else into
// statusline-limits.json in worfy's data folder and passes stdin to the user's own command.
// The work is done by scripts/statusline-bridge.mjs (Node, worfy-windows ticket 08); every case runs
// against it and, where /bin/sh is, against the entry scripts/statusline-bridge.sh that the user's
// `statusLine` names in the .app.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, relative, win32 } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type BuildKind, dataRoot } from '../../src/main/storage/paths'

const MJS = join(__dirname, '..', '..', 'scripts', 'statusline-bridge.mjs')
const SH = join(__dirname, '..', '..', 'scripts', 'statusline-bridge.sh')
const WINDOWS = process.platform === 'win32'
/** Node itself, not the Electron that runs the tests. */
const NODE = execFileSync('node', ['-p', 'process.execPath'], { encoding: 'utf8' }).trim()

const RATE_LIMITS = { five_hour: { used_percentage: 29, resets_at: 1791202800 }, seven_day: { used_percentage: 9, resets_at: 1791777600 } }
const STATUS = {
  session_id: '00000000-0000-4000-8000-000000000001',
  transcript_path: '/Users/someone/.claude/projects/x/00000000-0000-4000-8000-000000000001.jsonl',
  cwd: '/Users/someone/project',
  model: { id: 'claude-haiku-4-5-20251001', display_name: 'Haiku 4.5' },
  version: '2.1.284',
  cost: { total_cost_usd: 0.001 },
  rate_limits: RATE_LIMITS,
}

let scratch: string
let home: string
let dataDir: string

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-bridge-')))
  home = join(scratch, 'home')
  dataDir = join(scratch, 'data')
  mkdirSync(home)
  mkdirSync(dataDir)
})

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

type Entry = 'mjs' | 'sh'

/**
 * Runs the bridge with a HOME of the test's own; on Windows also USERPROFILE, which os.homedir()
 * reads there, so the default data folders are never the user's real ones.
 */
function run(entry: Entry, stdin: string, args: string[] = [], env: Record<string, string> = { WORFY_DATA_DIR: dataDir }) {
  const base: Record<string, string> = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home }
  if (WINDOWS) Object.assign(base, { USERPROFILE: home, SystemRoot: process.env.SystemRoot ?? 'C:\\Windows' })
  const [file, fileArgs] = entry === 'mjs' ? [NODE, [MJS]] : ['/bin/sh', [SH]]
  const result = spawnSync(file, [...fileArgs, ...args], { input: stdin, encoding: 'utf8', env: { ...base, ...env } })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

const written = (dir = dataDir): unknown => JSON.parse(readFileSync(join(dir, 'statusline-limits.json'), 'utf8'))

/** The default data folder of a build kind under the test's home, as src/main/storage/paths.ts names it. */
const defaultDataDir = (kind: BuildKind): string => join(home, relative(homedir(), dataRoot({}, kind)))

const ENTRIES: Entry[] = WINDOWS ? ['mjs'] : ['mjs', 'sh']

describe.each(ENTRIES)('statusline-bridge (%s)', (entry) => {
  it('writes rate_limits and nothing else of the status line JSON', () => {
    expect(run(entry, JSON.stringify(STATUS))).toEqual({ status: 0, stdout: '', stderr: '' })
    expect(written()).toEqual(RATE_LIMITS)
    expect(readdirSync(dataDir)).toEqual(['statusline-limits.json'])
  })

  it('gives the wrapped status line command the same stdin and passes its output and exit code through', () => {
    const result = run(entry, JSON.stringify(STATUS), [`grep -o '"display_name":"[^"]*"'; exit 3`])
    expect(result).toMatchObject({ status: 3, stdout: '"display_name":"Haiku 4.5"\n' })
    expect(written()).toEqual(RATE_LIMITS)
  })

  it('leaves the file alone when the status line JSON has no rate_limits or is not JSON', () => {
    run(entry, JSON.stringify(STATUS))
    expect(run(entry, JSON.stringify({ ...STATUS, rate_limits: undefined, cwd: '/elsewhere' }), ['cat >/dev/null; echo ok'])).toMatchObject({ status: 0, stdout: 'ok\n' })
    expect(run(entry, '{"rate_limits": "soon"}')).toMatchObject({ status: 0 })
    expect(run(entry, '{"rate_limits": [1, 2]}')).toMatchObject({ status: 0 })
    expect(run(entry, 'not json', ['echo still here'])).toMatchObject({ status: 0, stdout: 'still here\n' })
    expect(written()).toEqual(RATE_LIMITS)
    expect(readdirSync(dataDir)).toEqual(['statusline-limits.json'])
  })

  it('writes nowhere when the data directory does not exist', () => {
    const missing = join(scratch, 'no-worfy-yet')
    expect(run(entry, JSON.stringify(STATUS), [], { WORFY_DATA_DIR: missing })).toMatchObject({ status: 0 })
    expect(existsSync(missing)).toBe(false)
    // Without WORFY_DATA_DIR the defaults are under this home, which has none of them.
    expect(run(entry, JSON.stringify(STATUS), [], {})).toMatchObject({ status: 0 })
    expect(readdirSync(home)).toEqual([])
  })

  it('without WORFY_DATA_DIR writes to the packaged and the dev data folders that paths.ts names', () => {
    const packaged = defaultDataDir('packaged')
    const dev = defaultDataDir('dev')
    expect(packaged).not.toBe(dev)
    mkdirSync(packaged, { recursive: true })
    mkdirSync(dev, { recursive: true })
    expect(run(entry, JSON.stringify(STATUS), [], {})).toEqual({ status: 0, stdout: '', stderr: '' })
    expect(written(packaged)).toEqual(RATE_LIMITS)
    expect(written(dev)).toEqual(RATE_LIMITS)
    expect(readdirSync(packaged)).toEqual(['statusline-limits.json'])
    expect(readdirSync(dev)).toEqual(['statusline-limits.json'])
  })

  it('without WORFY_DATA_DIR writes only to the data folders that exist', () => {
    const dev = defaultDataDir('dev')
    mkdirSync(dev, { recursive: true })
    expect(run(entry, JSON.stringify(STATUS), [], { WORFY_DATA_DIR: '' })).toMatchObject({ status: 0 })
    expect(written(dev)).toEqual(RATE_LIMITS)
    expect(existsSync(defaultDataDir('packaged'))).toBe(false)
  })

  it('with WORFY_DATA_DIR writes there and leaves the default data folders alone', () => {
    const packaged = defaultDataDir('packaged')
    const dev = defaultDataDir('dev')
    mkdirSync(packaged, { recursive: true })
    mkdirSync(dev, { recursive: true })
    expect(run(entry, JSON.stringify(STATUS))).toMatchObject({ status: 0 })
    expect(written()).toEqual(RATE_LIMITS)
    expect(readdirSync(packaged)).toEqual([])
    expect(readdirSync(dev)).toEqual([])
  })
})

/** The lines of a script without its comments. */
const codeOf = (path: string): string[] =>
  readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|\s)(#|\/\/).*$/, '').trim())
    .filter((line) => line !== '' && !line.startsWith('#!'))

describe('statusline-bridge scripts', () => {
  // Both ship in the .app (worfy-harness ticket 15) and run from there, with no checkout of the
  // repository next to them: their commands name no path of the owner's machine or of the repository.
  it('name no path of a checkout in their executable lines; the entry names only the .mjs next to it', () => {
    const mjs = codeOf(MJS)
    expect(mjs.join('\n')).toContain('rateLimitsOf')
    const sh = codeOf(SH)
    expect(sh.join('\n')).toContain(`[ "$(printf '%s' "$input" | node "$here/statusline-bridge.mjs" --worfy-limits-only 2>/dev/null)" = written ]`)
    for (const line of [...mjs, ...sh]) {
      expect(line).not.toContain('/Users/')
      expect(line).not.toContain('CanvasForAI')
      expect(line).not.toContain('scripts/')
    }
    expect(mjs.join('\n')).not.toContain('statusline-bridge')
    expect(sh.join('\n').replaceAll('$here/statusline-bridge.mjs', '')).not.toContain('statusline-bridge')
  })

  // Review round 2 of PR #200: readFileSync(0) failed with EAGAIN past 64 KB on a pipe, and stray
  // bytes after the JSON made the script write nothing while it exited 0.
  it('reads a status line JSON over 64 KB, and the first object of JSON followed by stray bytes', () => {
    const big = JSON.stringify({ ...STATUS, padding: 'x'.repeat(70_000) })
    expect(run('mjs', big, ['cat >/dev/null; echo ok'])).toMatchObject({ status: 0, stdout: 'ok\n' })
    expect(written()).toEqual(RATE_LIMITS)
    rmSync(join(dataDir, 'statusline-limits.json'))
    expect(run('mjs', `${JSON.stringify(STATUS)}\n{"not": "closed"`)).toMatchObject({ status: 0 })
    expect(written()).toEqual(RATE_LIMITS)
    rmSync(join(dataDir, 'statusline-limits.json'))
    expect(run('mjs', `  ${JSON.stringify({ ...STATUS, note: 'a } and a " inside' })} junk`)).toMatchObject({ status: 0 })
    expect(written()).toEqual(RATE_LIMITS)
    // Arrays nest like objects, brackets inside strings do not (review round 3).
    rmSync(join(dataDir, 'statusline-limits.json'))
    expect(run('mjs', `${JSON.stringify({ tags: [1, [2, { a: '] }' }]], ...STATUS, after: [] })} ] junk`)).toMatchObject({ status: 0 })
    expect(written()).toEqual(RATE_LIMITS)
  })

  it(`with ${'--worfy-limits-only'} prints written when it wrote the file, and exits 2 with nothing when it did not`, () => {
    expect(run('mjs', JSON.stringify(STATUS), ['--worfy-limits-only'])).toEqual({ status: 0, stdout: 'written\n', stderr: '' })
    expect(run('mjs', JSON.stringify({ ...STATUS, rate_limits: undefined }), ['--worfy-limits-only'])).toEqual({ status: 2, stdout: '', stderr: '' })
    expect(run('mjs', 'not json', ['--worfy-limits-only'])).toEqual({ status: 2, stdout: '', stderr: '' })
    expect(run('mjs', JSON.stringify(STATUS), ['--worfy-limits-only'], { WORFY_DATA_DIR: join(scratch, 'missing') })).toEqual({ status: 2, stdout: '', stderr: '' })
  })

  it('writes the file with no jq anywhere on PATH', () => {
    const emptyPath = join(scratch, 'empty-path')
    mkdirSync(emptyPath)
    const result = spawnSync(NODE, [MJS], { input: JSON.stringify(STATUS), encoding: 'utf8', env: { PATH: emptyPath, HOME: home, USERPROFILE: home, WORFY_DATA_DIR: dataDir } })
    expect(result).toMatchObject({ status: 0, stdout: '', stderr: '' })
    expect(written()).toEqual(RATE_LIMITS)
  })
})

// The entry the user's `statusLine` names on macOS: whatever happens to node, the user's own line
// keeps its output and exit code, and the Limits are written through jq as before (round 1 of the
// review of PR #200). A PATH of its own holds only the tools the entry uses, and a `node` stub.
describe.skipIf(WINDOWS)('statusline-bridge.sh without a working node', () => {
  // Asked while the tests are collected, also on Windows, where there is no /bin/sh: then null.
  const tool = (name: string): string | null => (spawnSync('/bin/sh', ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout ?? '').trim() || null
  const JQ = tool('jq')
  const STUBS = {
    // An asdf or mise shim with no version selected.
    fails: '#!/bin/sh\necho "No version is set for command node" >&2\nexit 126\n',
    // A Node too old for `?.`.
    old: "#!/bin/sh\necho \"SyntaxError: Unexpected token '.'\" >&2\nexit 1\n",
    // A `node` that exits 0 without running the script.
    silent: '#!/bin/sh\nexit 0\n',
  }

  /** `node`: a stub, the real one, or none. */
  function binDir(node: keyof typeof STUBS | 'real' | null, withJq = true): string {
    const dir = join(scratch, 'bin')
    mkdirSync(dir)
    for (const name of ['cat', 'mv', 'rm', 'sh', 'grep', ...(withJq ? ['jq'] : [])]) {
      const found = tool(name)
      if (found) symlinkSync(found, join(dir, name))
    }
    if (node === 'real') symlinkSync(NODE, join(dir, 'node'))
    else if (node !== null) writeFileSync(join(dir, 'node'), STUBS[node], { mode: 0o755 })
    return dir
  }

  it('with node and no jq, writes the Limits through the Node script', () => {
    const result = spawnSync('/bin/sh', [SH, `grep -o '"display_name":"[^"]*"'; exit 3`], { input: JSON.stringify(STATUS), encoding: 'utf8', env: { PATH: binDir('real', false), HOME: home, WORFY_DATA_DIR: dataDir } })
    expect(result).toMatchObject({ status: 3, stdout: '"display_name":"Haiku 4.5"\n', stderr: '' })
    expect(written()).toEqual(RATE_LIMITS)
  })

  it('with node, writes the Limits of a status line JSON over 64 KB and of JSON followed by stray bytes', () => {
    const path = binDir('real', false)
    for (const input of [JSON.stringify({ ...STATUS, padding: 'x'.repeat(70_000) }), `${JSON.stringify(STATUS)} junk`]) {
      rmSync(join(dataDir, 'statusline-limits.json'), { force: true })
      const result = spawnSync('/bin/sh', [SH, 'cat >/dev/null; echo ok'], { input, encoding: 'utf8', env: { PATH: path, HOME: home, WORFY_DATA_DIR: dataDir } })
      expect(result).toMatchObject({ status: 0, stdout: 'ok\n' })
      expect(written()).toEqual(RATE_LIMITS)
    }
  })

  const userLine = `grep -o '"display_name":"[^"]*"'; exit 3`

  it.each([
    ['no node on PATH', null],
    ['a node that fails', 'fails'],
    ['a node too old for the script', 'old'],
    ['a node that exits 0 without running the script', 'silent'],
  ] as const)('with %s, runs the user command with its output and exit code, and writes the Limits through jq', (_case, node) => {
    const result = spawnSync('/bin/sh', [SH, userLine], { input: JSON.stringify(STATUS), encoding: 'utf8', env: { PATH: binDir(node), HOME: home, WORFY_DATA_DIR: dataDir } })
    expect(result).toMatchObject({ status: 3, stdout: '"display_name":"Haiku 4.5"\n', stderr: '' })
    if (JQ !== null) expect(written()).toEqual(RATE_LIMITS)
  })

  it('without node and jq, still runs the user command and writes nothing', () => {
    const result = spawnSync('/bin/sh', [SH, userLine], { input: JSON.stringify(STATUS), encoding: 'utf8', env: { PATH: binDir(null, false), HOME: home, WORFY_DATA_DIR: dataDir } })
    expect(result).toMatchObject({ status: 3, stdout: '"display_name":"Haiku 4.5"\n', stderr: '' })
    expect(readdirSync(dataDir)).toEqual([])
  })

  // Review round 3 of PR #200: run by bare name, `$0` has no `/`, and the entry took `.` for its own
  // folder, so a statusline-bridge.mjs in Claude Code's cwd (the user's project) ran instead.
  it('run by bare name through PATH, runs the .mjs next to it and never one in the current folder', () => {
    const app = join(scratch, 'app')
    mkdirSync(app)
    writeFileSync(join(app, 'statusline-bridge.sh'), readFileSync(SH), { mode: 0o755 })
    writeFileSync(join(app, 'statusline-bridge.mjs'), readFileSync(MJS))
    const project = join(scratch, 'project')
    mkdirSync(project)
    const decoy = `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(join(scratch, 'decoy-ran'))}, '')\nconsole.log('written')\n`
    writeFileSync(join(project, 'statusline-bridge.mjs'), decoy)
    // No jq: the Limits can only come from the .mjs in the app folder.
    const path = `${binDir('real', false)}:${app}`
    const result = spawnSync('/bin/sh', ['-c', 'statusline-bridge.sh "$1"', 'sh', 'cat >/dev/null; echo ok'], { cwd: project, input: JSON.stringify(STATUS), encoding: 'utf8', env: { PATH: path, HOME: home, WORFY_DATA_DIR: dataDir } })
    expect(result).toMatchObject({ status: 0, stdout: 'ok\n' })
    expect(existsSync(join(scratch, 'decoy-ran'))).toBe(false)
    expect(written()).toEqual(RATE_LIMITS)
    // `sh statusline-bridge.sh`, where sh looks the script up on PATH (bash does), gives `$0` no `/` at all.
    rmSync(join(dataDir, 'statusline-limits.json'))
    const bare = spawnSync('/bin/sh', ['statusline-bridge.sh', 'cat >/dev/null; echo ok'], { cwd: project, input: JSON.stringify(STATUS), encoding: 'utf8', env: { PATH: path, HOME: home, WORFY_DATA_DIR: dataDir } })
    expect(existsSync(join(scratch, 'decoy-ran'))).toBe(false)
    // A sh that does not look scripts up on PATH (dash) cannot open it at all.
    if (bare.status === 0) expect(written()).toEqual(RATE_LIMITS)
  })

  it('gives the user command stdin byte for byte, trailing newlines included', () => {
    const input = `${JSON.stringify(STATUS)}\n\n`
    const result = spawnSync('/bin/sh', [SH, 'cat'], { input, encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, WORFY_DATA_DIR: dataDir } })
    expect(result).toMatchObject({ status: 0, stdout: input })
  })
})

interface Bridge {
  limitsFolders: (env: Record<string, string | undefined>, platform: NodeJS.Platform, home?: string) => string[]
  commandRunner: (command: string, platform: NodeJS.Platform, env: Record<string, string | undefined>, exists: (path: string) => boolean) => { file: string; args: string[]; shell: boolean }
}
const bridge = async (): Promise<Bridge> => (await import(pathToFileURL(MJS).href)) as Bridge

describe('statusline-bridge.mjs: folders and shell by platform', () => {
  it('on Windows writes to %APPDATA%\\worfy and %APPDATA%\\worfy-dev, as dataRoot() names them', async () => {
    const { limitsFolders } = await bridge()
    const appData = 'C:\\Users\\u\\AppData\\Roaming'
    expect(limitsFolders({ APPDATA: appData }, 'win32')).toEqual([dataRoot({ APPDATA: appData }, 'packaged', 'win32'), dataRoot({ APPDATA: appData }, 'dev', 'win32')])
    expect(limitsFolders({ APPDATA: appData }, 'win32')).toEqual(['C:\\Users\\u\\AppData\\Roaming\\worfy', 'C:\\Users\\u\\AppData\\Roaming\\worfy-dev'])
    expect(limitsFolders({ USERPROFILE: 'C:\\Users\\u' }, 'win32')).toEqual(['C:\\Users\\u\\AppData\\Roaming\\worfy', 'C:\\Users\\u\\AppData\\Roaming\\worfy-dev'])
    expect(limitsFolders({ APPDATA: 'Roaming' }, 'win32', 'C:\\Users\\h')).toEqual(['C:\\Users\\h\\AppData\\Roaming\\worfy', 'C:\\Users\\h\\AppData\\Roaming\\worfy-dev'])
    expect(limitsFolders({ APPDATA: appData, WORFY_DATA_DIR: 'D:\\data' }, 'win32')).toEqual(['D:\\data'])
  })

  it('takes APPDATA by the same rule as dataRoot(), so the Limits land where worfy reads them', async () => {
    const { limitsFolders } = await bridge()
    for (const APPDATA of ['C:\\Users\\u\\AppData\\Roaming', 'C:/Users/u/AppData/Roaming', '\\\\srv\\share\\roaming', '//srv/share/roaming', '/x', '\\x', 'C:x', 'Roaming', '']) {
      const env = { APPDATA, USERPROFILE: homedir() }
      expect(limitsFolders(env, 'win32', homedir()), APPDATA).toEqual([dataRoot(env, 'packaged', 'win32'), dataRoot(env, 'dev', 'win32')])
    }
  })

  it('on macOS and Linux writes to ~/Library/Application Support/worfy and worfy-dev', async () => {
    const { limitsFolders } = await bridge()
    for (const platform of ['darwin', 'linux'] as const) {
      expect(limitsFolders({}, platform, '/Users/u')).toEqual(['/Users/u/Library/Application Support/worfy', '/Users/u/Library/Application Support/worfy-dev'])
    }
    if (!WINDOWS) expect(limitsFolders({}, 'darwin', homedir())).toEqual([dataRoot({}, 'packaged', 'darwin'), dataRoot({}, 'dev', 'darwin')])
  })

  it('runs the user command with sh -c on macOS and Linux, and on Windows with Git Bash, as Claude Code runs statusLine there', async () => {
    const { commandRunner } = await bridge()
    const none = (): boolean => false
    expect(commandRunner('echo hi', 'darwin', {}, none)).toEqual({ file: 'sh', args: ['-c', 'echo hi'], shell: false })
    const gitCmd = 'C:\\Program Files\\Git\\cmd'
    const bash = 'C:\\Program Files\\Git\\bin\\bash.exe'
    const has = (...files: string[]) => (path: string): boolean => files.includes(path)
    expect(commandRunner('echo hi', 'win32', { PATH: `C:\\Windows\\System32;${gitCmd}` }, has(win32.join(gitCmd, 'git.exe'), bash, 'C:\\Windows\\System32\\bash.exe'))).toEqual({ file: bash, args: ['-c', 'echo hi'], shell: false })
    expect(commandRunner('echo hi', 'win32', { CLAUDE_CODE_GIT_BASH_PATH: 'D:\\g\\bin\\bash.exe' }, has('D:\\g\\bin\\bash.exe'))).toMatchObject({ file: 'D:\\g\\bin\\bash.exe' })
    expect(commandRunner('echo hi', 'win32', { ProgramFiles: 'C:\\Program Files' }, has(bash))).toMatchObject({ file: bash })
    // The WSL launcher is never taken; without Git Bash the command goes to Node's default shell.
    expect(commandRunner('echo hi', 'win32', { CLAUDE_CODE_GIT_BASH_PATH: 'C:\\Windows\\System32\\bash.exe', SystemRoot: 'C:\\Windows' }, has('C:\\Windows\\System32\\bash.exe'))).toEqual({ file: 'echo hi', args: [], shell: true })
  })
})
