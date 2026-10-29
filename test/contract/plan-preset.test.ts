// The preset of a plan against the real Harness (worfy-throughput ticket 42): the handlers of
// src/main/ipc/plan-preset.ts over the real harness/bin/profile-set, in a temporary Harness home with
// one registered Project. Reading the offer writes nothing — not the Profile, not the app settings;
// Apply (`planPreset.apply`) runs profile-set with the preset and then turns the Autopilot budget on.
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PLAN_PRESETS } from '../../src/shared/agent/plan-preset'
import type { AppSettingsPatch } from '../../src/shared/settings/app-settings'
import { NODE } from '../harness-node'
import { removeTestTree } from '../remove'

/** The app's listeners, by event: the module subscribes the app's plan to will-quit. */
const appListeners = vi.hoisted(() => new Map<string, (() => void)[]>())
/** The signals of the app plan's asks, and how many of their Claude Code processes were closed. */
const appAsks = vi.hoisted(() => ({ signals: [] as AbortSignal[], closed: 0 }))
vi.mock('electron', () => ({
  app: {
    on: (event: string, listener: () => void) => void appListeners.set(event, [...(appListeners.get(event) ?? []), listener]),
    getVersion: () => '0.2.0',
    isPackaged: false,
    getAppPath: () => '/',
  },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  dialog: {},
  shell: {},
}))
// The app's plan and Session registry are not this test's: the handlers get their own PlanSource.
vi.mock('../../src/main/agent/app-registry', () => ({ sharedRegistry: () => ({ observe: () => () => undefined }), queryFactoryFromEnv: () => undefined }))
// The app plan's ask never answers by itself, as a Claude Code that hangs: only its signal ends it, closing the process.
vi.mock('../../src/main/ipc/first-run', () => ({
  askSignedInAccount: (signal: AbortSignal) =>
    new Promise((_, reject) => {
      appAsks.signals.push(signal)
      signal.addEventListener('abort', () => {
        appAsks.closed += 1
        reject(new Error('the account question was stopped'))
      })
    }),
}))
vi.mock('../../src/main/harness/script-env', () => ({ harnessScriptEnv: () => Promise.resolve(process.env) }))

const { default: appHandlers, planPresetHandlers, PlanSource } = await import('../../src/main/ipc/plan-preset')
const { askAccount, ACCOUNT_ASK_STOPPED } = await import('../../src/main/first-run/checks')
type Handlers = ReturnType<typeof planPresetHandlers>

const PROFILE_SET = join(process.cwd(), 'harness', 'bin', 'profile-set')
const PRO = PLAN_PRESETS.pro!

let scratch: string
let harnessHome: string
let repo: string
let profileJson: string
let runs: { args: string[]; stdin: string | undefined }[]
let settings: AppSettingsPatch[]

function git(cwd: string, ...args: string[]): void {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env })
}

/** The real bin/profile-set with the temporary homes, and nothing of the machine's registry or profiles. */
function profileSet(args: readonly string[], stdin?: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  runs.push({ args: [...args], stdin })
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: join(scratch, 'home'), USERPROFILE: join(scratch, 'home'), HARNESS_HOME: harnessHome }
  delete env.CLAUDE_GATE_CONFIG
  delete env.CLAUDE_PROFILES_DIR
  delete env.EVAL_HARNESS_HOME
  delete env.ELECTRON_RUN_AS_NODE
  return new Promise((done, fail) => {
    const child = spawn(NODE, [PROFILE_SET, ...args], { env, windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    child.on('error', fail)
    child.on('close', (code) => done({ code, stdout, stderr }))
    child.stdin.end(stdin ?? '')
  })
}

function handlers(subscriptionType: string | null): Handlers {
  return planPresetHandlers({
    plan: { get: async () => ({ subscriptionType, error: null }) },
    projects: () => [{ path: repo }],
    profileSet,
    setAppSettings: (patch) => void settings.push(patch),
  })
}

async function call(module: Handlers, channel: string, input: unknown): Promise<unknown> {
  const handler = module.find((entry) => entry.channel.name === channel)
  if (handler === undefined) throw new Error(`no handler of ${channel}`)
  return handler.handle(input as never, {} as never)
}

const PROFILE = {
  schema: 2,
  name: 'demo',
  mode: 'full',
  commands: { test: 'make test' },
  workflow: { ci: 'pr', pipeline: [{ kind: 'queued' }, { kind: 'implementing' }, { kind: 'done' }] },
  review: { lenses: ['correctness'] },
}

beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-plan-preset-')))
  harnessHome = join(scratch, 'hh')
  repo = join(scratch, 'r', 'demo')
  mkdirSync(join(scratch, 'home'), { recursive: true })
  mkdirSync(join(harnessHome, 'gate'), { recursive: true })
  mkdirSync(join(harnessHome, 'projects', 'demo'), { recursive: true })
  mkdirSync(repo, { recursive: true })
  git(repo, 'init', '-q')
  writeFileSync(join(harnessHome, 'gate', 'config.json'), JSON.stringify({ repos: [{ key: 'demo', match: repo, profile: 'demo' }] }))
  profileJson = join(harnessHome, 'projects', 'demo', 'profile.json')
  writeFileSync(profileJson, `${JSON.stringify(PROFILE, null, 2)}\n`)
  writeFileSync(join(harnessHome, 'projects', 'demo', 'rules.md'), '# demo rules\n')
  git(harnessHome, 'init', '-q')
  git(harnessHome, 'add', '-A')
  git(harnessHome, 'commit', '-q', '-m', 'init')
  runs = []
  settings = []
})

afterEach(() => {
  removeTestTree(scratch)
})

describe('planPreset over the real bin/profile-set', () => {
  it('Pro: reading the offer runs only --read, and the Profile and the app settings stay as they were', async () => {
    const before = readFileSync(profileJson, 'utf8')
    const read = (await call(handlers('Claude Pro'), 'planPreset.read', { root: repo })) as { subscriptionType: string; profile: { available: boolean; fields: unknown; fingerprint: string } }
    expect(read.subscriptionType).toBe('Claude Pro')
    expect(read.profile).toMatchObject({ available: true, fields: { 'workflow.agents': null, agents: null } })
    expect(read.profile.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/u)
    expect(runs.map((run) => run.args)).toEqual([['-C', realpathSync.native(repo), '--field', 'workflow.agents', '--field', 'agents', '--read']])
    expect(readFileSync(profileJson, 'utf8')).toBe(before)
    expect(settings).toEqual([])
  })

  it('Apply: profile-set writes the preset, the other fields stay, and the budget is turned on after it', async () => {
    const module = handlers('Claude Pro')
    const read = (await call(module, 'planPreset.read', { root: repo })) as { profile: { fingerprint: string } }
    const result = await call(module, 'planPreset.apply', { root: repo, plan: 'pro', expected: read.profile.fingerprint })
    expect(result).toEqual({ status: 'saved', warning: null })
    const set = runs.at(-1)!
    expect(set.args).toEqual(['-C', realpathSync.native(repo), '--field', 'workflow.agents', '--field', 'agents', '--expect', read.profile.fingerprint, '--set', '-'])
    expect(JSON.parse(set.stdin!)).toEqual(PRO.profile)
    const written = JSON.parse(readFileSync(profileJson, 'utf8')) as typeof PROFILE & { agents?: unknown; workflow: { agents?: unknown } }
    expect(written.workflow.agents).toBe('eco')
    expect(written.agents).toEqual(PRO.profile.agents)
    // Everything else of profile.json is as it was.
    const others = structuredClone(written)
    delete others.agents
    delete others.workflow.agents
    expect(others).toEqual(PROFILE)
    expect(settings).toEqual([{ autopilotBudget: { enabled: true } }])

    const again = (await call(module, 'planPreset.read', { root: repo })) as { profile: { fields: unknown } }
    expect(again.profile.fields).toEqual(PRO.profile)
  })

  it('Apply over a Profile changed since the read: conflict, nothing written, the budget stays', async () => {
    const module = handlers('Claude Pro')
    const read = (await call(module, 'planPreset.read', { root: repo })) as { profile: { fingerprint: string } }
    const changed = { ...PROFILE, workflow: { ...PROFILE.workflow, agents: 'full' } }
    writeFileSync(profileJson, `${JSON.stringify(changed, null, 2)}\n`)
    const before = readFileSync(profileJson, 'utf8')
    expect(await call(module, 'planPreset.apply', { root: repo, plan: 'pro', expected: read.profile.fingerprint })).toEqual({ status: 'conflict' })
    expect(readFileSync(profileJson, 'utf8')).toBe(before)
    expect(settings).toEqual([])
  })

  it.each(['Claude Max', 'Claude Max 20x', 'Claude Team', 'Claude Something New', null])('%j: no offer, and profile-set is not even run', async (subscriptionType) => {
    const read = await call(handlers(subscriptionType), 'planPreset.read', { root: repo })
    expect(read).toEqual({ subscriptionType, planError: null, profile: null })
    expect(runs).toEqual([])
  })

  it('Apply takes the plan from main: signed in with Max by now, the Pro preset is refused before profile-set runs', async () => {
    const module = handlers('Claude Pro')
    const read = (await call(module, 'planPreset.read', { root: repo })) as { profile: { fingerprint: string } }
    const before = readFileSync(profileJson, 'utf8')
    runs = []
    const now = planPresetHandlers({ plan: { get: async () => ({ subscriptionType: 'Claude Max', error: null }) }, projects: () => [{ path: repo }], profileSet, setAppSettings: (patch) => void settings.push(patch) })
    await expect(call(now, 'planPreset.apply', { root: repo, plan: 'pro', expected: read.profile.fingerprint })).rejects.toThrow(/signed in with Claude Max now, not Pro/u)
    expect(runs).toEqual([])
    expect(readFileSync(profileJson, 'utf8')).toBe(before)
    expect(settings).toEqual([])
  })

  it('Apply with the plan known asks Claude Code no more', async () => {
    const ask = vi.fn(async () => ({ subscriptionType: 'Claude Pro' }))
    const plan = new PlanSource(ask)
    const module = planPresetHandlers({ plan, projects: () => [{ path: repo }], profileSet, setAppSettings: (patch) => void settings.push(patch) })
    const read = (await call(module, 'planPreset.read', { root: repo })) as { profile: { fingerprint: string } }
    expect(await call(module, 'planPreset.apply', { root: repo, plan: 'pro', expected: read.profile.fingerprint })).toEqual({ status: 'saved', warning: null })
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('Apply for a root that is no Project of this Machine is refused before profile-set runs', async () => {
    const outside = join(scratch, 'r')
    await expect(call(handlers('Claude Pro'), 'planPreset.apply', { root: outside, plan: 'pro', expected: `sha256:${'0'.repeat(64)}` })).rejects.toThrow(/not a Project of this Machine/u)
    expect(runs).toEqual([])
    expect(settings).toEqual([])
  })

  it('a Harness whose profile-set has no --field: too old, nothing written', async () => {
    const old = planPresetHandlers({
      plan: { get: async () => ({ subscriptionType: 'Claude Pro', error: null }) },
      projects: () => [{ path: repo }],
      profileSet: async () => ({ code: 2, stdout: '', stderr: 'profile-set: unknown argument: --field\nusage: …' }),
      setAppSettings: (patch) => void settings.push(patch),
    })
    expect(await call(old, 'planPreset.read', { root: repo })).toMatchObject({ profile: { available: false } })
    expect(await call(old, 'planPreset.apply', { root: repo, plan: 'pro', expected: `sha256:${'0'.repeat(64)}` })).toEqual({ status: 'too-old' })
    expect(settings).toEqual([])
  })
})

describe('PlanSource', () => {
  const account = (subscriptionType: string | null) => ({ type: 'account', loggedIn: subscriptionType !== null, subscriptionType, apiProvider: 'firstParty', tokenSource: null }) as const

  it('a Session that reported its account answers; Claude Code is not asked', async () => {
    const ask = vi.fn(async () => ({ subscriptionType: 'Claude Max' }))
    const plan = new PlanSource(ask)
    plan.note('s1', account('Claude Pro'))
    expect(await plan.get()).toEqual({ subscriptionType: 'Claude Pro', error: null })
    expect(ask).not.toHaveBeenCalled()
  })

  it('no Session yet: Claude Code is asked once, two reads at a time share the answer, and it is kept', async () => {
    const ask = vi.fn(async () => ({ subscriptionType: 'Claude Pro' }))
    const plan = new PlanSource(ask)
    expect(await Promise.all([plan.get(), plan.get()])).toEqual([
      { subscriptionType: 'Claude Pro', error: null },
      { subscriptionType: 'Claude Pro', error: null },
    ])
    expect(await plan.get()).toEqual({ subscriptionType: 'Claude Pro', error: null })
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('a later Session event replaces the plan; one that came while Claude Code was asked wins over its answer', async () => {
    let answer: (value: { subscriptionType: string }) => void = () => undefined
    const plan = new PlanSource(() => new Promise((done) => (answer = done)))
    const reading = plan.get()
    plan.note('s1', account('Claude Max'))
    answer({ subscriptionType: 'Claude Pro' })
    expect(await reading).toEqual({ subscriptionType: 'Claude Max', error: null })
    plan.note('s2', account('Claude Pro'))
    expect(await plan.get()).toEqual({ subscriptionType: 'Claude Pro', error: null })
  })

  it('an answer without a plan is not kept, nor a Session that reported no sign-in: the next read asks again', async () => {
    const ask = vi.fn().mockResolvedValueOnce({ tokenSource: 'none' }).mockResolvedValueOnce({ subscriptionType: 'Claude Pro' }).mockResolvedValueOnce({ subscriptionType: 'Claude Max' })
    const plan = new PlanSource(ask)
    expect(await plan.get()).toEqual({ subscriptionType: null, error: null })
    expect(await plan.get()).toEqual({ subscriptionType: 'Claude Pro', error: null })
    plan.note('s1', account(null))
    expect(await plan.get()).toEqual({ subscriptionType: 'Claude Max', error: null })
    expect(ask).toHaveBeenCalledTimes(3)
  })

  it('stop(): the ask in flight closes its Claude Code process at once and the read ends; no new ask starts', async () => {
    const query = { closed: 0, accountInfo: () => new Promise<never>(() => undefined), close: () => void (query.closed += 1) }
    // The real askAccount over a Claude Code that never answers, with the first-run timeout of 60 s.
    const ask = vi.fn((signal: AbortSignal) => askAccount(() => Promise.resolve(query), 60_000, signal))
    const plan = new PlanSource(ask)
    const reading = plan.get()
    await vi.waitFor(() => expect(ask).toHaveBeenCalledTimes(1))
    const started = Date.now()
    plan.stop()
    expect(await reading).toEqual({ subscriptionType: null, error: ACCOUNT_ASK_STOPPED })
    expect(Date.now() - started).toBeLessThan(1_000)
    expect(query.closed).toBe(1)
    expect(await plan.get()).toEqual({ subscriptionType: null, error: 'worfy is quitting' })
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('askAccount stopped while Claude Code is still starting: the process is closed once it is there', async () => {
    const query = { closed: 0, accountInfo: () => new Promise<never>(() => undefined), close: () => void (query.closed += 1) }
    let started: (value: typeof query) => void = () => undefined
    const stop = new AbortController()
    const asked = askAccount(() => new Promise((done) => (started = done)), 60_000, stop.signal)
    stop.abort()
    await expect(asked).rejects.toThrow(ACCOUNT_ASK_STOPPED)
    started(query)
    await vi.waitFor(() => expect(query.closed).toBe(1))
    await expect(askAccount(() => Promise.resolve(query), 60_000, stop.signal)).rejects.toThrow(ACCOUNT_ASK_STOPPED)
    expect(query.closed).toBe(1)
  })

  it('the app: a read waiting on Claude Code ends when the app quits (will-quit), its process closed', async () => {
    const reading = call(appHandlers, 'planPreset.read', { root: '/nowhere' })
    await vi.waitFor(() => expect(appAsks.signals).toHaveLength(1))
    for (const listener of appListeners.get('will-quit') ?? []) listener()
    expect(await reading).toEqual({ subscriptionType: null, planError: 'the account question was stopped', profile: null })
    expect(appAsks.closed).toBe(1)
  })

  it('a failed ask is reported and not kept: the next read asks again', async () => {
    const ask = vi.fn().mockRejectedValueOnce(new Error('Claude Code did not answer within 20 s')).mockResolvedValueOnce({ subscriptionType: 'Claude Pro' })
    const plan = new PlanSource(ask)
    expect(await plan.get()).toEqual({ subscriptionType: null, error: 'Claude Code did not answer within 20 s' })
    expect(await plan.get()).toEqual({ subscriptionType: 'Claude Pro', error: null })
  })
})
