// Where the app hands the Harness scripts their environment (worfy-harness ticket 37, slice 2).
//
// Each place in the app that starts a Harness script — the workflow hub, the reads of Ship ticket
// and Autopilot, the canvas tools, the Project store, the shared layout cache, the First run row —
// must pass the app's source of the scripts' environment (src/main/harness/script-env.ts) itself:
// not `process.env`, and not a merge of `process.env` under it. Here that source is a stand-in, and
// each test checks that the very same function, or the very same environment object, reaches the
// reader; a place that wraps it, merges into it or goes back to `process.env` fails.
//
// Then what each run of a script gets: the environment asked on that run, the retry after a
// Harness change included, nothing of worfy's own variables, and HARNESS_HOME of the Harness worfy
// found. The scripts are stubs that print what they got, in a temporary Claude home.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { captureLoginShellEnv } from '../../src/main/agent/env'
import type { HarnessScriptEnv, HarnessScriptEnvSource } from '../../src/main/harness/script-env'
import { ProjectStore } from '../../src/main/projects/store'
import { LayoutCache, readProjectLayout } from '../../src/main/workflow/folder'
import { harnessScriptRunner } from '../../src/main/workflow/profile'
import { epicStatusRunner, readWorkflow } from '../../src/main/workflow/reader'
import { WorkflowWatcher } from '../../src/main/workflow/watch'
import type { WorkflowModel } from '../../src/shared/workflow/types'
import { NODE_DIR } from '../harness-node'
import { removeTestTree } from '../remove'
import { ms } from '../time-scale'

/** The login shell environment the stand-in source answers with. */
const LOGIN: HarnessScriptEnv = Object.freeze({ PATH: '/login-shell/bin:/usr/bin:/bin', HOME: '/login-home', MARK: 'login-shell' })
const SOURCE: HarnessScriptEnvSource = () => Promise.resolve(LOGIN)
const MODEL: WorkflowModel = { root: '/r', epics: [], tickets: [], error: null, branchErrors: [] }
/** A variable of worfy's own process only: no script may see it. */
const LEAK = 'WORFY_WIRING_LEAK'
/**
 * The PATH of a login shell's environment the runs below hand the stubs: the system folders and the
 * folder of node, nothing of worfy's own PATH. The stubs are Node scripts, started as `node <script>`
 * with the node on this PATH (src/main/workflow/profile.ts, harnessScriptCommand).
 */
const LOGIN_PATH = [NODE_DIR, '/usr/bin', '/bin'].join(':')

const MOCKED = [
  'electron',
  '../../src/main/harness/script-env',
  '../../src/main/agent/env',
  '../../src/main/workflow/watch',
  '../../src/main/workflow/reader',
  '../../src/main/workflow/profile',
  '../../src/main/actions/launch',
  '../../src/main/autopilot/run',
  '../../src/main/autopilot/harness-drift',
  '../../src/main/ipc/actions',
  '../../src/main/ipc/checks',
  '../../src/main/ipc/workflow',
  '../../src/main/workflow/stages',
  '../../src/main/first-run/checks',
]

let scratch: string

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-script-wiring-')))
  vi.resetModules()
  vi.stubEnv('WORFY_DATA_DIR', join(scratch, 'data'))
  vi.stubEnv('WORFY_CLAUDE_HOME', join(scratch, 'claude-home'))
  vi.stubEnv('WORFY_HARNESS_HOME', join(scratch, 'claude-home', 'worfy-harness'))
  vi.stubEnv(LEAK, 'from worfy itself')
  mkdirSync(join(scratch, 'data'))
})

afterEach(() => {
  for (const path of MOCKED) vi.doUnmock(path)
  vi.unstubAllEnvs()
  vi.resetModules()
  removeTestTree(scratch)
})

/** Electron as far as the modules below touch it when they load and build their shared objects. */
function mockElectron(): void {
  vi.doMock('electron', () => ({
    app: { isPackaged: false, getAppPath: () => '/nowhere', on: () => undefined, quit: () => undefined },
    BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
    dialog: { showMessageBox: () => Promise.reject(new Error('no dialog in this test')) },
    powerSaveBlocker: { start: () => 0, stop: () => undefined, isStarted: () => false },
  }))
}

/** The app's source of the scripts' environment, replaced by the stand-in. */
function mockSource(): void {
  vi.doMock('../../src/main/harness/script-env', () => ({ harnessScriptEnv: SOURCE }))
}

/** readWorkflow and epicStatusRunner record what they are handed; the rest of the reader is real. */
function mockReader(seen: { read?: { env: unknown }; runner?: unknown }): void {
  vi.doMock('../../src/main/workflow/reader', async (original) => ({
    ...(await original<object>()),
    readWorkflow: (options: { env: unknown }) => {
      seen.read = options
      return Promise.resolve({ model: MODEL, checkout: MODEL, branches: new Map() })
    },
    epicStatusRunner: (_claudeHome: string, env: unknown) => {
      seen.runner = env
      return () => Promise.resolve(JSON.stringify({ ref: 'main', epics: [], tickets: [] }))
    },
  }))
}

/** readResolvedProfile records the environment it is handed. */
function mockProfile(seen: { env?: unknown }): void {
  vi.doMock('../../src/main/workflow/profile', async (original) => ({
    ...(await original<object>()),
    readResolvedProfile: (options: { env: unknown }) => {
      seen.env = options.env
      return Promise.resolve({ ok: false, reason: 'stand-in', miss: 'none' })
    },
  }))
}

describe('every place of the app hands the scripts the source of src/main/harness/script-env.ts', () => {
  it("harnessScriptEnv answers with the environment agentEnv() holds, nothing of worfy's own merged in", async () => {
    vi.doMock('../../src/main/agent/env', () => ({ agentEnv: () => Promise.resolve({ env: LOGIN, from: 'login-shell', error: null }) }))
    const { harnessScriptEnv } = await import('../../src/main/harness/script-env')
    const env = await harnessScriptEnv()
    expect(env).toBe(LOGIN)
    expect(env[LEAK]).toBeUndefined()
  })

  it.each([
    ['no request', undefined, 'login-shell', 0],
    ['always', 'always', 'login-shell', 1],
    ['if-fallback, the held capture is good', 'if-fallback', 'login-shell', 0],
    ['if-fallback, the held capture fell back', 'if-fallback', 'fallback', 1],
  ] as const)('harnessScriptEnv takes the login shell again only when asked to: %s', async (_case, fresh, from, expected) => {
    const AGAIN = { PATH: '/captured/again/bin' }
    let recaptures = 0
    vi.doMock('../../src/main/agent/env', () => ({
      agentEnv: () => Promise.resolve({ env: LOGIN, from, error: null }),
      recaptureAgentEnv: () => ((recaptures += 1), Promise.resolve({ env: AGAIN, from: 'login-shell', error: null })),
    }))
    const { harnessScriptEnv } = await import('../../src/main/harness/script-env')
    const env = await harnessScriptEnv(fresh === undefined ? undefined : { fresh })
    expect(recaptures).toBe(expected)
    expect(env).toBe(expected === 1 ? AGAIN : LOGIN)
  })

  it('the workflow hub of the window (src/main/ipc/workflow.ts)', async () => {
    mockElectron()
    mockSource()
    const seen: { hub?: { env: unknown } } = {}
    vi.doMock('../../src/main/workflow/watch', async (original) => ({
      ...(await original<object>()),
      WorkflowHub: class {
        constructor(options: { env: unknown }) {
          seen.hub = options
        }
      },
    }))
    await import('../../src/main/ipc/workflow')
    expect(seen.hub?.env).toBe(SOURCE)
  })

  it('the Pipeline the Stages are computed by (src/main/ipc/pipeline.ts)', async () => {
    mockElectron()
    mockSource()
    const seen: { env?: unknown; sources?: { profile: (root: string) => Promise<unknown> } } = {}
    vi.doMock('../../src/main/workflow/profile', async (original) => ({
      ...(await original<object>()),
      readPipelineProfile: (options: { env: unknown }) => {
        seen.env = options.env
        return Promise.resolve({ ok: false, reason: 'stand-in', miss: 'none' })
      },
    }))
    vi.doMock('../../src/main/workflow/stages', async (original) => ({
      ...(await original<object>()),
      StageHub: class {
        constructor(sources: { profile: (root: string) => Promise<unknown> }) {
          seen.sources = sources
        }
      },
    }))
    await import('../../src/main/ipc/pipeline')
    await seen.sources?.profile(scratch)
    expect(seen.env).toBe(LOGIN)
  })

  it('the read of Ship ticket and Run wave (src/main/ipc/actions.ts)', async () => {
    mockElectron()
    mockSource()
    const seen: { launcher?: { workflow: (root: string) => Promise<unknown> }; read?: { env: unknown } } = {}
    mockReader(seen)
    vi.doMock('../../src/main/actions/launch', () => ({
      ActionLauncher: class {
        constructor(options: { workflow: (root: string) => Promise<unknown> }) {
          seen.launcher = options
        }
      },
    }))
    const { sharedLauncher } = await import('../../src/main/ipc/actions')
    sharedLauncher()
    expect(await seen.launcher?.workflow('/r')).toBe(MODEL)
    expect(seen.read?.env).toBe(SOURCE)
  })

  it("Autopilot's read (src/main/ipc/autopilot.ts)", async () => {
    mockElectron()
    mockSource()
    const seen: { autopilot?: { workflow: (root: string) => Promise<unknown> }; read?: { env: unknown } } = {}
    mockReader(seen)
    vi.doMock('../../src/main/autopilot/run', async (original) => ({
      ...(await original<object>()),
      Autopilot: class {
        constructor(options: { workflow: (root: string) => Promise<unknown> }) {
          seen.autopilot = options
        }
      },
    }))
    vi.doMock('../../src/main/autopilot/harness-drift', () => ({ harnessDriftWatch: () => ({}) }))
    vi.doMock('../../src/main/ipc/actions', () => ({ sharedLauncher: () => ({ attachAutopilot: () => undefined }) }))
    vi.doMock('../../src/main/ipc/checks', () => ({ sharedPrTracker: () => ({}) }))
    vi.doMock('../../src/main/ipc/workflow', () => ({ workflowHub: {} }))
    const { sharedAutopilot } = await import('../../src/main/ipc/autopilot')
    sharedAutopilot()
    expect(await seen.autopilot?.workflow('/r')).toBe(MODEL)
    expect(seen.read?.env).toBe(SOURCE)
  })

  it('the canvas tools of a Session (src/main/mcp/canvas-server.ts)', async () => {
    mockElectron()
    mockSource()
    const seen: { runner?: unknown } = {}
    mockReader(seen)
    const { appDeps } = await import('../../src/main/mcp/canvas-server')
    await appDeps().workflow(scratch)
    expect(seen.runner).toBe(SOURCE)
  })

  it('the Project store, for a folder outside git (src/main/projects/store.ts)', async () => {
    mockSource()
    const seen: { env?: unknown } = {}
    mockProfile(seen)
    const folder = join(scratch, 'not-a-repository')
    mkdirSync(folder)
    const { projectStore } = await import('../../src/main/projects/store')
    expect(await projectStore().add(folder)).toMatchObject({ status: 'rejected' })
    expect(seen.env).toBe(LOGIN)
  })

  it('the shared layout cache of the documents and the checks (src/main/workflow/folder.ts)', async () => {
    mockSource()
    const seen: { env?: unknown } = {}
    mockProfile(seen)
    const { projectLayouts } = await import('../../src/main/workflow/folder')
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await projectLayouts().get(scratch)
    expect(seen.env).toBe(LOGIN)
  })

  it('the First run row «Harness scripts» gets that source, not the environment of the screen; "Check again" captures the login shell again first, then asks the failed layouts of the sidebar (src/main/ipc/first-run.ts)', async () => {
    mockElectron()
    // The stand-in source, with the module's own recaptureForCheckAgain.
    vi.doMock('../../src/main/harness/script-env', async (original) => ({ ...(await original<object>()), harnessScriptEnv: SOURCE }))
    const order: string[] = []
    let held: Record<string, string> = { PATH: '/screen/bin' }
    let recaptures = 0
    vi.doMock('../../src/main/agent/env', () => ({
      agentEnv: () => Promise.resolve({ env: held, from: 'login-shell', error: null }),
      recaptureAgentEnv: () => {
        recaptures += 1
        order.push('recapture')
        held = { PATH: '/captured/again/bin' }
        return Promise.resolve({ env: held, from: 'login-shell', error: null })
      },
    }))
    // The app's hub, as the handler imports it: not looked up through another handler.
    vi.doMock('../../src/main/ipc/workflow', () => ({ workflowHub: { retryFailedLayouts: () => (order.push('failed layouts asked'), Promise.resolve(1)) } }))
    const seen: { deps?: { env: unknown; scriptEnv: unknown } } = {}
    vi.doMock('../../src/main/first-run/checks', async (original) => ({
      ...(await original<object>()),
      runChecks: (deps: { env: unknown; scriptEnv: unknown }) => {
        order.push('checks')
        seen.deps = deps
        return Promise.resolve({ checks: [], checkedAt: new Date(0).toISOString() })
      },
    }))
    const handlers = (await import('../../src/main/ipc/first-run')).default as unknown as { channel: unknown; handle: (input: unknown, context: unknown) => Promise<unknown> }[]
    // The channel of this module load: the modules were loaded again after vi.resetModules().
    const { firstRunChecks } = await import('../../src/shared/ipc/first-run')
    const checks = handlers.find((handler) => handler.channel === firstRunChecks)
    if (checks === undefined) throw new Error('no handler of firstRun.checks')
    await checks.handle(undefined, {})
    expect(recaptures).toBe(1)
    expect(order).toEqual(['recapture', 'failed layouts asked', 'checks'])
    expect(seen.deps?.env).toEqual({ PATH: '/captured/again/bin' })
    expect(seen.deps?.scriptEnv).toBe(SOURCE)
  })

  it('the environment stays a required parameter: a reader without it does not compile', () => {
    const git = (): Promise<string> => Promise.resolve('')
    // Never called: the lines below are checked by `pnpm typecheck`, which fails when one compiles.
    const forgotten = (): unknown[] => [
      // @ts-expect-error -- the Project store without the workspace reader (and so without its environment)
      new ProjectStore(scratch, git),
      // @ts-expect-error -- the layout without the scripts' environment
      readProjectLayout({ root: scratch, claudeHome: scratch }),
      // @ts-expect-error -- the layout cache without the scripts' environment
      new LayoutCache({ claudeHome: () => scratch }),
      // @ts-expect-error -- the workflow read without the scripts' environment
      readWorkflow({ root: scratch, claudeHome: scratch }),
      // @ts-expect-error -- the epic-status runner without the scripts' environment
      epicStatusRunner(scratch),
    ]
    expect(typeof forgotten).toBe('function')
  })
})

// ── what each run gets ───────────────────────────────────────────────────────

/**
 * The stand-ins of the Harness scripts (test/fixtures/harness-stub/): `answer` logs what it got to
 * $CALLS and answers as the script it is linked as; `gone` logs, removes the link it was started
 * by, and fails. Tests link them, never write a script: macOS checks each new executable file on
 * its first run, a few hundred ms and one file at a time for the whole machine, and the copies
 * each test used to write made these tests time out in a loaded full run.
 */
const STUBS = join(__dirname, '..', 'fixtures', 'harness-stub')

/** Links the stand-in `stub` at `path`. */
function linkStub(path: string, stub: 'answer' | 'gone'): void {
  mkdirSync(join(path, '..'), { recursive: true })
  symlinkSync(join(STUBS, stub), path)
}

/**
 * The Harness plugin in `<claudeHome>/worfy-harness/plugin` (src/main/harness/locate.ts): its
 * `epic-status`, `profile` and `ticket` log what they got and answer as the real ones would.
 */
function pluginHarness(claudeHome: string): string {
  const harnessHome = join(claudeHome, 'worfy-harness')
  const plugin = join(harnessHome, 'plugin')
  mkdirSync(join(plugin, '.claude-plugin'), { recursive: true })
  writeFileSync(join(plugin, '.claude-plugin', 'plugin.json'), '{"name": "worfy", "version": "0.0.0+test"}\n')
  for (const name of ['epic-status', 'profile', 'ticket']) linkStub(join(plugin, 'bin', name), 'answer')
  return harnessHome
}

const lines = (calls: string): string[] => readFileSync(calls, 'utf8').trim().split('\n')

/** What one test of the runs works with, fixed when the test starts. */
interface ScriptRun {
  claudeHome: string
  /** The file the stubs log to. */
  calls: string
  /** How many times `source` was asked so far. */
  asked(): number
  /** The login shell's environment as the app hands it: CALLS tells the stubs where to log. */
  source: HarnessScriptEnvSource
}

/**
 * A test's own Claude home, calls file and source under `root`. The source closes over these
 * values, not over variables of the describe that the next test's beforeEach reassigns: a run that
 * a test cut off by its timeout left going still logs into that test's calls file.
 */
function scriptRun(root: string): ScriptRun {
  const calls = join(root, 'calls.txt')
  let asked = 0
  return {
    claudeHome: join(root, 'claude-home'),
    calls,
    asked: () => asked,
    source: () => {
      asked += 1
      return Promise.resolve({ PATH: LOGIN_PATH, HOME: root, MARK: 'login-shell', CALLS: calls, WORKFLOW: join(root, 'workflow') })
    },
  }
}

describe.skipIf(process.platform === 'win32')('what each run of a script gets', { shuffle: false }, () => {
  let run: ScriptRun
  /** The run of the first of the two leak tests, and the folder it ran in; the second asks it. */
  let leftover: { run: ScriptRun; root: string } | undefined

  beforeEach(() => {
    run = scriptRun(scratch)
  })

  // The two tests below go together, in this order. The first ends and leaves its run behind, as a
  // test cut off by its timeout leaves its chain going; the second, after the real hooks gave it a
  // new folder and a new run, asks the source of the first.
  it('a test leaves its run behind (the first of two)', () => {
    leftover = { run, root: scratch }
    expect(run.asked()).toBe(0)
  })

  it("the run a test left behind still logs into that test's calls file, not into the next test's (the second of two)", async () => {
    const left = leftover
    // Run alone (-t, .only), the pair proves nothing: then this test fails rather than passes.
    expect(left).toBeDefined()
    if (left === undefined) return
    expect(left.root).not.toBe(scratch)
    const env = await left.run.source()
    expect(env.CALLS).toBe(left.run.calls)
    expect(env.CALLS).not.toBe(run.calls)
    expect(env.HOME).toBe(left.root)
  })

  it("epic-status: the environment asked on each run, nothing of worfy's own, HARNESS_HOME of the plugin", async () => {
    const { claudeHome, calls, source, asked } = run
    const harnessHome = pluginHarness(claudeHome)
    const runner = epicStatusRunner(claudeHome, source)
    await runner(scratch, null)
    await runner(scratch, null)
    expect(asked()).toBe(2)
    expect(lines(calls)).toEqual([`epic-status MARK=login-shell ${LEAK}=unset HARNESS_HOME=${harnessHome}`, `epic-status MARK=login-shell ${LEAK}=unset HARNESS_HOME=${harnessHome}`])
  })

  it('epic-status: the run again after the Harness moved under it gets the same environment', async () => {
    const { claudeHome, calls, source, asked } = run
    const harnessHome = pluginHarness(claudeHome)
    // The old Harness wins while it is there (ADR-0049); its epic-status is taken away while it
    // runs, as the move of ticket 14 takes it away, and fails.
    linkStub(join(claudeHome, 'bin', 'epic-status'), 'gone')
    const out = await epicStatusRunner(claudeHome, source)(scratch, null)
    expect(JSON.parse(out)).toMatchObject({ epics: [{ epic: 'demo' }] })
    expect(asked()).toBe(1)
    expect(lines(calls)).toEqual([`epic-status MARK=login-shell ${LEAK}=unset HARNESS_HOME=unset`, `epic-status MARK=login-shell ${LEAK}=unset HARNESS_HOME=${harnessHome}`])
  })

  it("profile and ticket of the layout: the environment handed, nothing of worfy's own", async () => {
    const { claudeHome, calls, source } = run
    const harnessHome = pluginHarness(claudeHome)
    const layout = await readProjectLayout({ root: scratch, claudeHome, env: await source(), log: () => undefined })
    expect(layout).toMatchObject({ mode: 'silent', failed: false, ticketsRoot: join(scratch, 'workflow', '.scratch') })
    expect(lines(calls)).toEqual([`profile MARK=login-shell ${LEAK}=unset HARNESS_HOME=${harnessHome}`, `ticket MARK=login-shell ${LEAK}=unset HARNESS_HOME=${harnessHome}`])
  })

  it('the layout cache and the workflow read ask the source on each read', async () => {
    const { claudeHome, source, asked } = run
    pluginHarness(claudeHome)
    let now = 0
    const cache = new LayoutCache({ claudeHome: () => claudeHome, env: source, ttlMs: 1000, now: () => now })
    await cache.get(scratch)
    await cache.get(scratch)
    expect(asked()).toBe(1)
    now = 2000
    await cache.get(scratch)
    expect(asked()).toBe(2)
    await readWorkflow({ root: scratch, claudeHome, env: source })
    // Two asks more: one for the layout, one for the run of epic-status.
    expect(asked()).toBe(4)
  })

  it('a HARNESS_HOME the user exports in the login shell does not win over the Harness home worfy found', async () => {
    const { claudeHome, calls } = run
    const harnessHome = pluginHarness(claudeHome)
    const exported = (): Promise<HarnessScriptEnv> => Promise.resolve({ PATH: LOGIN_PATH, HOME: scratch, MARK: 'login-shell', CALLS: calls, HARNESS_HOME: join(scratch, 'elsewhere') })
    await epicStatusRunner(claudeHome, exported)(scratch, null)
    await harnessScriptRunner(claudeHome, await exported(), 'profile')(scratch, ['--help'])
    expect(lines(calls)).toEqual([`epic-status MARK=login-shell ${LEAK}=unset HARNESS_HOME=${harnessHome}`, `profile MARK=login-shell ${LEAK}=unset HARNESS_HOME=${harnessHome}`])
  })
})

describe.skipIf(process.platform === 'win32')('the watcher asks for a fresh environment after a failure', () => {
  it('after exit code 127 the retry takes the login shell again; after another failure only when the held one fell back', async () => {
    const claudeHome = join(scratch, 'claude-home')
    const calls = join(scratch, 'calls.txt')
    pluginHarness(claudeHome)
    const exit = join(scratch, 'profile-exit')
    writeFileSync(exit, '127\n')
    // profile fails with the exit code in the file, as a profile without node or with a broken registry does.
    const requests: (string | null)[] = []
    const source: HarnessScriptEnvSource = (request) => {
      requests.push(request?.fresh ?? null)
      return Promise.resolve({ PATH: LOGIN_PATH, HOME: scratch, MARK: 'login-shell', CALLS: calls, WORKFLOW: join(scratch, 'workflow'), PROFILE_EXIT_FILE: exit })
    }
    const until = async (done: () => boolean): Promise<void> => {
      // Generous: the whole suite runs in parallel, and each retry starts a shell script.
      for (let i = 0; i < 750 && !done(); i++) await new Promise((resolve) => setTimeout(resolve, 20))
      expect(done()).toBe(true)
    }
    const watcher = await WorkflowWatcher.start({ root: scratch, claudeHome, env: source, layoutRetryMs: 30, onChange: () => undefined })
    try {
      expect(watcher.current.error?.message).toMatch(/exit code 127/)
      await until(() => requests.length >= 3)
      writeFileSync(exit, '1\n')
      await until(() => requests.includes('if-fallback'))
      writeFileSync(exit, '0\n')
      await until(() => watcher.current.error === null)
    } finally {
      await watcher.close()
    }
    const first = requests.indexOf('if-fallback')
    // The start asks plainly; every retry after a 127 asks for a fresh capture; after exit code 1 none does.
    expect(requests[0]).toBeNull()
    expect(requests.slice(1, 3)).toEqual(['always', 'always'])
    expect(requests.slice(first).filter((each) => each === 'always')).toEqual([])
    expect(watcher.current.epics.map((epic) => epic.epic)).toEqual(['demo'])
  }, ms(60_000))
})

describe.skipIf(process.platform === 'win32')('an empty SHELL', () => {
  it('the capture reads it as unset and resolves', async () => {
    const captured = await captureLoginShellEnv({ source: { SHELL: '', HOME: scratch, PATH: '/usr/bin:/bin' }, timeoutMs: 10_000 })
    expect(['login-shell', 'fallback']).toContain(captured.from)
    expect(captured.env.PATH).toBeTruthy()
  })

  it("the app's source resolves, and the workflow read gives a model instead of rejecting", async () => {
    vi.stubEnv('SHELL', '')
    vi.stubEnv('HOME', scratch)
    const { harnessScriptEnv } = await import('../../src/main/harness/script-env')
    const env = await harnessScriptEnv()
    expect(env.PATH).toBeTruthy()
    const { readWorkflow: read } = await import('../../src/main/workflow/reader')
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { model } = await read({ root: scratch, claudeHome: join(scratch, 'no-claude-home'), env: harnessScriptEnv })
    expect(model.root).toBe(scratch)
  })
})
