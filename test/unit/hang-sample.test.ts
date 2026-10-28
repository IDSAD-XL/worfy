// scripts/hang-sample.mjs <pid> [seconds]: when a step that drives a packaged worfy over CDP stops
// answering, the script saves the thread stacks of worfy's main process and of its child processes
// from the same .app with macOS `sample`, into <data root>/logs/hang-<time>-<pid>.txt. The cases
// here run it over faked `ps`, `pgrep` and `sample`. The real `ps` and `pgrep` are asked only about
// this test run and a `sleep` it starts; the real `sample` is a manual check on a packaged worfy.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { processGoneLogPath } from '../../src/main/diagnostics/process-gone'
import { dataRoot } from '../../src/main/storage/paths'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'

const SCRIPT = join(import.meta.dirname, '..', '..', 'scripts', 'hang-sample.mjs')

interface Process {
  comm: string
  args: string
}
interface Deps {
  platform: NodeJS.Platform
  env: Record<string, string | undefined>
  home: string
  now: () => Date
  ps: (pid: number) => Process | null
  childrenOf: (pid: number) => number[]
  realpath: (path: string) => string
  mkdir: (dir: string) => void
  sample: (pid: number, seconds: number, file: string) => Promise<number>
  out: (line: string) => void
  err: (line: string) => void
}
interface HangSample {
  hangSample: (args: string[], deps: Deps) => Promise<number>
  logsFolder: (env: Record<string, string | undefined>, home: string) => string
  systemDeps: () => Deps
}
const { hangSample, logsFolder, systemDeps } = (await import(pathToFileURL(SCRIPT).href)) as HangSample

const BUNDLE = '/Users/u/Applications/worfy stable.app'
const MAIN = `${BUNDLE}/Contents/MacOS/worfy`
const HELPER = `${BUNDLE}/Contents/Frameworks/worfy Helper.app/Contents/MacOS/worfy Helper`
const RENDERER = `${BUNDLE}/Contents/Frameworks/worfy Helper (Renderer).app/Contents/MacOS/worfy Helper (Renderer)`
const CLAUDE = `${BUNDLE}/Contents/Resources/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude`
const TOKEN = 'sk-ant-secret-token'

/** worfy with a window, a GPU process, a network service, a Session, a Terminal shell and a git call. */
const PROCESSES: Record<number, Process> = {
  100: { comm: MAIN, args: `${MAIN} --remote-debugging-port=9351` },
  101: { comm: RENDERER, args: `${RENDERER} --type=renderer --user-data-dir=/Users/u/Library/Application Support/worfy --lang=en-US` },
  102: { comm: HELPER, args: `${HELPER} --type=gpu-process --user-data-dir=/Users/u/Library/Application Support/worfy` },
  103: { comm: HELPER, args: `${HELPER} --type=utility --utility-sub-type=network.mojom.NetworkService` },
  104: { comm: CLAUDE, args: `${CLAUDE} --output-format stream-json --api-key ${TOKEN}` },
  105: { comm: '/bin/zsh', args: '/bin/zsh -l' },
  106: { comm: '/opt/homebrew/bin/git', args: `git -c http.extraheader=${TOKEN} fetch` },
}

interface Run {
  code: number
  out: string[]
  err: string[]
  sampled: { pid: number; seconds: number; file: string }[]
  made: string[]
}

async function run(args: string[], overrides: Partial<Deps> = {}, processes: Record<number, Process> = PROCESSES): Promise<Run> {
  const result: Run = { code: -1, out: [], err: [], sampled: [], made: [] }
  const deps: Deps = {
    platform: 'darwin',
    env: { WORFY_DATA_DIR: '/data/worfy' },
    home: '/Users/u',
    now: () => new Date(Date.UTC(2026, 9, 10, 12, 34, 56, 789)),
    ps: (pid) => processes[pid] ?? null,
    childrenOf: (pid) => (pid === 100 ? Object.keys(processes).map(Number).filter((child) => child !== 100) : []),
    realpath: (path) => path,
    mkdir: (dir) => void result.made.push(dir),
    sample: (pid, seconds, file) => {
      result.sampled.push({ pid, seconds, file })
      return Promise.resolve(0)
    },
    out: (line) => void result.out.push(line),
    err: (line) => void result.err.push(line),
    ...overrides,
  }
  result.code = await hangSample(args, deps)
  return result
}

// The script is for macOS alone and builds its paths by the POSIX rules, whatever system the test runs on.
const LOGS = '/data/worfy/logs'
const fileOf = (pid: number): string => `${LOGS}/hang-20261010T123456Z-${pid}.txt`

describe('hang-sample: which processes it samples', () => {
  it("samples worfy's main process and its children from the same .app, for 3 seconds by default", async () => {
    const { code, sampled, made, err } = await run(['100'])
    expect(code).toBe(0)
    expect(err).toEqual([])
    expect(made).toEqual([LOGS])
    expect(sampled).toEqual([100, 101, 102, 103, 104].map((pid) => ({ pid, seconds: 3, file: fileOf(pid) })))
  })

  it('prints a line per file with the kind of process from --type=, and `skipped:` for a child outside the .app', async () => {
    const { out } = await run(['100'])
    expect(out).toEqual([
      'skipped: 105 /bin/zsh',
      'skipped: 106 /opt/homebrew/bin/git',
      `sampled: 100 main ${fileOf(100)}`,
      `sampled: 101 renderer ${fileOf(101)}`,
      `sampled: 102 gpu-process ${fileOf(102)}`,
      `sampled: 103 utility ${fileOf(103)}`,
      `sampled: 104 claude ${fileOf(104)}`,
    ])
  })

  it('never prints the arguments of a process: they can hold a token', async () => {
    const { out, err } = await run(['100'], { sample: () => Promise.resolve(1) })
    expect([...out, ...err].join('\n')).not.toContain(TOKEN)
    expect([...out, ...err].join('\n')).not.toContain('--user-data-dir')
  })

  it('takes the seconds from the second argument', async () => {
    const { sampled } = await run(['100', '7'])
    expect(sampled.map((sample) => sample.seconds)).toEqual([7, 7, 7, 7, 7])
  })

  it('starts every sample before any has finished: they cover the same seconds', async () => {
    const started: number[] = []
    const finish: (() => void)[] = []
    const sample = (pid: number): Promise<number> => {
      started.push(pid)
      return new Promise((done) => finish.push(() => done(0)))
    }
    const running = run(['100'], { sample })
    await new Promise((done) => setTimeout(done, 0))
    expect(started).toEqual([100, 101, 102, 103, 104])
    for (const done of finish) done()
    expect((await running).code).toBe(0)
  })

  it('does not take a child of another .app whose path only starts the same, and compares real paths', async () => {
    const other = '/Users/u/Applications/worfy stable.app2/Contents/MacOS/tool'
    const linked = '/private/Users/u/Applications/worfy stable.app/Contents/Frameworks/worfy Helper.app/Contents/MacOS/worfy Helper'
    const processes = { 100: PROCESSES[100] as Process, 201: { comm: other, args: other }, 202: { comm: linked, args: `${linked} --type=utility` } }
    const { out, sampled } = await run(['100'], { realpath: (path) => path.replace(/^\/Users\//, '/private/Users/') }, processes)
    expect(sampled.map((sample) => sample.pid)).toEqual([100, 202])
    expect(out).toContain(`skipped: 201 ${other}`)
  })

  it('a child that ended before it was looked at is skipped, not an error', async () => {
    const processes = { 100: PROCESSES[100] as Process, 101: PROCESSES[101] as Process }
    const { code, out, sampled } = await run(['100'], { childrenOf: () => [101, 999] }, processes)
    expect(code).toBe(0)
    expect(sampled.map((sample) => sample.pid)).toEqual([100, 101])
    expect(out).toContain('skipped: 999 (ended)')
  })

  it('samples the main process alone when it has no children', async () => {
    const { code, sampled } = await run(['100'], { childrenOf: () => [] })
    expect(code).toBe(0)
    expect(sampled.map((sample) => sample.pid)).toEqual([100])
  })
})

describe('hang-sample: the exit code', () => {
  it('is the first non-zero code of `sample`, in the order of the processes, and names the failed one', async () => {
    const codes: Record<number, number> = { 102: 7, 104: 9 }
    const { code, out, err } = await run(['100'], { sample: (pid) => Promise.resolve(codes[pid] ?? 0) })
    expect(code).toBe(7)
    expect(out.filter((line) => line.startsWith('sampled:')).map((line) => line.split(' ')[1])).toEqual(['100', '101', '103'])
    expect(err).toEqual(['failed: 102 gpu-process: sample exited with code 7', 'failed: 104 claude: sample exited with code 9'])
  })

  it('is 1 when `sample` could not run at all', async () => {
    const { code, err } = await run(['100'], { childrenOf: () => [], sample: () => Promise.reject(new Error('spawn /usr/bin/sample ENOENT')) })
    expect(code).toBe(1)
    expect(err).toEqual(['failed: 100 main: spawn /usr/bin/sample ENOENT'])
  })

  it('is 1, with no sample, when the logs folder cannot be created', async () => {
    const mkdir = (): void => {
      throw new Error('EACCES: permission denied')
    }
    const { code, err, sampled } = await run(['100'], { mkdir })
    expect(code).toBe(1)
    expect(sampled).toEqual([])
    expect(err).toEqual([`hang-sample: cannot create ${LOGS}: EACCES: permission denied`])
  })
})

describe('hang-sample: what it refuses, with exit code 2 and no sample', () => {
  const refused = async (args: string[], overrides: Partial<Deps> = {}): Promise<string> => {
    const { code, sampled, made, out, err } = await run(args, overrides)
    expect(code).toBe(2)
    expect(sampled).toEqual([])
    expect(made).toEqual([])
    expect(out).toEqual([])
    expect(err).toHaveLength(1)
    return err[0] ?? ''
  }

  it.each([
    ['a shell of a Terminal', 105, '/bin/zsh'],
    ["worfy's own renderer process", 101, RENDERER],
    ["worfy's own helper process", 102, HELPER],
    ['the claude of a Session', 104, CLAUDE],
  ])('%s', async (_what, pid, path) => {
    expect(await refused([String(pid)])).toBe(`hang-sample: ${pid} is not the main process of a packaged worfy (<bundle>.app/Contents/MacOS/worfy): ${path}`)
  })

  it('an executable named worfy outside a .app, or a dev run of Electron', async () => {
    for (const comm of ['/usr/local/bin/worfy', '/Users/u/worfy/Contents/MacOS/worfy', '/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron']) {
      expect(await refused(['100'], { ps: () => ({ comm, args: comm }) })).toContain('is not the main process of a packaged worfy')
    }
  })

  it('a pid no process has', async () => {
    expect(await refused(['4242'])).toBe('hang-sample: no process with pid 4242')
  })

  it.each([[[]], [['worfy']], [['-1']], [['0']], [['1.5']], [['100', '0']], [['100', 'x']], [['100', '61']], [['100', '3', 'more']]])('arguments %j', async (args) => {
    expect(await refused(args)).toBe('usage: node scripts/hang-sample.mjs <pid of the main process of a packaged worfy> [seconds, 1-60, default 3]')
  })

  it('any system but macOS: `sample` exists only there', async () => {
    expect(await refused(['100'], { platform: 'linux' })).toBe('hang-sample: macOS only (it runs /usr/bin/sample)')
    expect(await refused(['100'], { platform: 'win32' })).toBe('hang-sample: macOS only (it runs /usr/bin/sample)')
  })
})

describe('hang-sample: where the files go', () => {
  it('is the logs folder of the packaged worfy, next to process-gone.jsonl; WORFY_DATA_DIR overrides it', () => {
    expect(logsFolder({ WORFY_DATA_DIR: '/data/worfy' }, '/Users/u')).toBe('/data/worfy/logs')
    expect(logsFolder({}, '/Users/u')).toBe('/Users/u/Library/Application Support/worfy/logs')
    expect(logsFolder({ WORFY_DATA_DIR: '' }, '/Users/u')).toBe('/Users/u/Library/Application Support/worfy/logs')
  })

  // dataRoot() builds the macOS folder with the path rules of the system the test runs on.
  it.skipIf(process.platform === 'win32')('follows dataRoot() of src/main/storage/paths.ts', () => {
    const home = homedir()
    for (const env of [{}, { WORFY_DATA_DIR: '/data/worfy' }, { WORFY_DATA_DIR: '' }]) {
      expect(logsFolder(env, home)).toBe(join(dataRoot(env, 'packaged', 'darwin'), 'logs'))
      expect(join(logsFolder(env, home), 'process-gone.jsonl')).toBe(processGoneLogPath(dataRoot(env, 'packaged', 'darwin')))
    }
  })
})

// The real `ps` and `pgrep`, asked about this test run and one `sleep` it starts — nothing else on
// the machine, and nothing is sampled. The `sleep` ends by itself after 30 s if the test dies first.
describe.skipIf(process.platform !== 'darwin')('hang-sample: the real ps and pgrep of macOS', () => {
  it('ps gives the path of the executable apart from the arguments; pgrep gives the children of that pid alone', async () => {
    const { ps, childrenOf } = systemDeps()
    const child = spawn('/bin/sleep', ['30'], { stdio: 'ignore' })
    const pid = child.pid
    const ended = new Promise((done) => child.once('exit', done))
    try {
      if (pid === undefined) throw new Error('/bin/sleep did not start')
      await vi.waitFor(() => expect(ps(pid)).toEqual({ comm: '/bin/sleep', args: '/bin/sleep 30' }))
      const children = childrenOf(process.pid)
      expect(children).toContain(pid)
      expect(children).not.toContain(process.pid)
      expect(children).not.toContain(process.ppid)
      for (const each of children) expect(Number.isInteger(each) && each > 0, String(each)).toBe(true)
      expect(childrenOf(pid)).toEqual([])
    } finally {
      child.kill('SIGKILL')
      await ended
    }
    // The process is gone: no pid of a live process, no child of this one.
    if (pid !== undefined) {
      expect(ps(pid)).toBeNull()
      expect(childrenOf(process.pid)).not.toContain(pid)
    }
  })
})

describe('hang-sample run as a script', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'worfy-hang-sample-'))
  afterAll(() => removeTestTree(scratch))

  /** Under the real node (test/script-node.ts). */
  const script = (args: string[]) =>
    spawnSync(scriptNode(), [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', WORFY_DATA_DIR: scratch } })

  it('refuses the pid of a process that is not a packaged worfy — this test run — and writes nothing', () => {
    const { status, stdout, stderr } = script([String(process.pid)])
    expect(status).toBe(2)
    expect(stdout).toBe('')
    expect(stderr).toMatch(process.platform === 'darwin' ? /is not the main process of a packaged worfy/ : /macOS only/)
    expect(existsSync(join(scratch, 'logs'))).toBe(false)
  })

  it('prints the usage without arguments', () => {
    const { status, stderr } = script([])
    expect(status).toBe(2)
    expect(stderr).toMatch(/^usage: node scripts\/hang-sample\.mjs <pid/)
  })
})
