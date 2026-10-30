// The Eco mode switch against the real Harness (worfy-throughput ticket 60): the handlers of
// src/main/ipc/eco-mode.ts over the real harness/bin/profile-set, in a temporary Harness home with one
// registered Project. On writes `workflow.agents: "eco"` and the agents of the Pro preset, and the real
// bin/profile then reads eco; off removes both fields, and bin/profile has no `workflow.agents`
// (exit 4). A Profile changed since the read is not written; a refused write says why.
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PLAN_PRESETS } from '../../src/shared/agent/plan-preset'
import { NODE } from '../harness-node'
import { removeTestTree } from '../remove'

vi.mock('electron', () => ({
  app: { on: () => undefined, getVersion: () => '0.2.0', isPackaged: false, getAppPath: () => '/' },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  dialog: {},
  shell: {},
}))
vi.mock('../../src/main/harness/script-env', () => ({ harnessScriptEnv: () => Promise.resolve(process.env) }))

const { ecoModeHandlers } = await import('../../src/main/ipc/eco-mode')
const { HarnessScriptStartError } = await import('../../src/main/workflow/profile')
type Handlers = ReturnType<typeof ecoModeHandlers>
type Run = { code: number | null; stdout: string; stderr: string }

const BIN = join(process.cwd(), 'harness', 'bin')
const PRO = PLAN_PRESETS.pro!
const STALE = `sha256:${'0'.repeat(64)}`

let scratch: string
let harnessHome: string
let repo: string
let profileJson: string
let runs: { args: string[]; stdin: string | undefined }[]

function git(cwd: string, ...args: string[]): void {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env })
}

/** The temporary homes, and nothing of the machine's registry or profiles. */
function harnessEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: join(scratch, 'home'), USERPROFILE: join(scratch, 'home'), HARNESS_HOME: harnessHome }
  delete env.CLAUDE_GATE_CONFIG
  delete env.CLAUDE_PROFILES_DIR
  delete env.EVAL_HARNESS_HOME
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

/** The real bin/profile-set. */
function profileSet(args: readonly string[], stdin?: string): Promise<Run> {
  runs.push({ args: [...args], stdin })
  return new Promise((done, fail) => {
    const child = spawn(NODE, [join(BIN, 'profile-set'), ...args], { env: harnessEnv(), windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    child.on('error', fail)
    child.on('close', (code) => done({ code, stdout, stderr }))
    child.stdin.end(stdin ?? '')
  })
}

/** What the real bin/profile says of `workflow.agents`: its exit code and output. */
function profileField(): { code: number | null; stdout: string } {
  const run = spawnSync(NODE, [join(BIN, 'profile'), '-C', repo, '--field', 'workflow.agents'], { env: harnessEnv(), encoding: 'utf8', windowsHide: true })
  return { code: run.status, stdout: run.stdout.trim() }
}

const handlers = (run: (args: readonly string[], stdin?: string) => Promise<Run> = profileSet): Handlers => ecoModeHandlers({ projects: () => [{ path: repo }], profileSet: run })

async function call(module: Handlers, channel: string, input: unknown): Promise<unknown> {
  const handler = module.find((entry) => entry.channel.name === channel)
  if (handler === undefined) throw new Error(`no handler of ${channel}`)
  return handler.handle(input as never, {} as never)
}

type Read = { available: true; on: boolean; fingerprint: string }
const read = async (module: Handlers): Promise<Read> => (await call(module, 'ecoMode.read', { root: repo })) as Read

const PROFILE = {
  schema: 2,
  name: 'demo',
  mode: 'full',
  commands: { test: 'make test' },
  workflow: { ci: 'pr', pipeline: [{ kind: 'queued' }, { kind: 'implementing' }, { kind: 'done' }] },
  review: { lenses: ['correctness'] },
}
type Written = typeof PROFILE & { agents?: unknown; workflow: { agents?: unknown } }
const written = (): Written => JSON.parse(readFileSync(profileJson, 'utf8')) as Written
const writeProfile = (profile: object): void => writeFileSync(profileJson, `${JSON.stringify(profile, null, 2)}\n`)

beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-eco-mode-')))
  harnessHome = join(scratch, 'hh')
  repo = join(scratch, 'r', 'demo')
  mkdirSync(join(scratch, 'home'), { recursive: true })
  mkdirSync(join(harnessHome, 'gate'), { recursive: true })
  mkdirSync(join(harnessHome, 'projects', 'demo'), { recursive: true })
  mkdirSync(repo, { recursive: true })
  git(repo, 'init', '-q')
  writeFileSync(join(harnessHome, 'gate', 'config.json'), JSON.stringify({ repos: [{ key: 'demo', match: repo, profile: 'demo' }] }))
  profileJson = join(harnessHome, 'projects', 'demo', 'profile.json')
  writeProfile(PROFILE)
  writeFileSync(join(harnessHome, 'projects', 'demo', 'rules.md'), '# demo rules\n')
  git(harnessHome, 'init', '-q')
  git(harnessHome, 'add', '-A')
  git(harnessHome, 'commit', '-q', '-m', 'init')
  runs = []
})

afterEach(() => {
  removeTestTree(scratch)
})

describe('ecoMode over the real bin/profile-set', () => {
  it('reading runs only --read and writes nothing; a Profile without workflow.agents is off', async () => {
    const before = readFileSync(profileJson, 'utf8')
    const state = await read(handlers())
    expect(state).toMatchObject({ available: true, on: false })
    expect(state.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/u)
    expect(runs.map((run) => run.args)).toEqual([['-C', realpathSync.native(repo), '--field', 'workflow.agents', '--field', 'agents', '--read']])
    expect(readFileSync(profileJson, 'utf8')).toBe(before)
  })

  it('on writes the eco set of the Pro preset, off removes both fields; the other fields stay', async () => {
    const module = handlers()
    const off = await read(module)
    const on = (await call(module, 'ecoMode.set', { root: repo, on: true, expected: off.fingerprint })) as { status: string; fingerprint: string }
    expect(on).toMatchObject({ status: 'saved', on: true, warning: null })
    const set = runs.at(-1)!
    expect(set.args).toEqual(['-C', realpathSync.native(repo), '--field', 'workflow.agents', '--field', 'agents', '--expect', off.fingerprint, '--set', '-'])
    expect(JSON.parse(set.stdin!)).toEqual(PRO.profile)
    expect(written().workflow.agents).toBe('eco')
    expect(written().agents).toEqual({
      implementer: { model: 'sonnet', effort: 'medium' },
      reviewer: { model: 'sonnet', effort: 'medium' },
      scout: { model: 'sonnet', effort: 'medium' },
      verifier: { model: 'sonnet', effort: 'medium' },
    })
    expect(profileField()).toEqual({ code: 0, stdout: 'eco' })
    // The fingerprint of the write is the one a read gives now: the next click needs no read.
    expect(await read(module)).toEqual({ available: true, on: true, fingerprint: on.fingerprint })

    expect(await call(module, 'ecoMode.set', { root: repo, on: false, expected: on.fingerprint })).toMatchObject({ status: 'saved', on: false, warning: null })
    expect(runs.at(-1)!.args).toEqual(['-C', realpathSync.native(repo), '--field', 'workflow.agents', '--field', 'agents', '--expect', on.fingerprint, '--reset'])
    expect(written()).toEqual(PROFILE)
    expect(profileField().code).toBe(4)
    expect(await read(module)).toMatchObject({ available: true, on: false, fingerprint: off.fingerprint })
  })

  it('workflow.agents "eco" is on whatever the agents say; "full" is off', async () => {
    writeProfile({ ...PROFILE, workflow: { ...PROFILE.workflow, agents: 'eco' }, agents: { implementer: { model: 'opus', effort: 'high' } } })
    expect(await read(handlers())).toMatchObject({ available: true, on: true })
    writeProfile({ ...PROFILE, workflow: { ...PROFILE.workflow, agents: 'full' }, agents: PRO.profile.agents })
    expect(await read(handlers())).toMatchObject({ available: true, on: false })
  })

  it('a Profile changed outside since the read: conflict, nothing written; a new read shows the change', async () => {
    const module = handlers()
    const stale = await read(module)
    writeProfile({ ...PROFILE, workflow: { ...PROFILE.workflow, agents: 'eco' }, agents: PRO.profile.agents })
    const before = readFileSync(profileJson, 'utf8')
    expect(await call(module, 'ecoMode.set', { root: repo, on: true, expected: stale.fingerprint })).toEqual({ status: 'conflict' })
    expect(readFileSync(profileJson, 'utf8')).toBe(before)
    expect(await call(module, 'ecoMode.set', { root: repo, on: false, expected: stale.fingerprint })).toEqual({ status: 'conflict' })
    expect(readFileSync(profileJson, 'utf8')).toBe(before)
    expect(await read(module)).toMatchObject({ available: true, on: true })
  })

  it('a root that is no Project of this Machine: not available, and a write is refused before profile-set runs', async () => {
    const outside = join(scratch, 'r')
    expect(await call(handlers(), 'ecoMode.read', { root: outside })).toEqual({ available: false, reason: 'not a Project of this Machine' })
    await expect(call(handlers(), 'ecoMode.set', { root: outside, on: true, expected: STALE })).rejects.toThrow(/not a Project of this Machine/u)
    expect(runs).toEqual([])
  })
})

describe('ecoMode when profile-set refuses or fails', () => {
  const answering =
    (run: Run) =>
    async (args: readonly string[], stdin?: string): Promise<Run> => {
      runs.push({ args: [...args], stdin })
      return run
    }

  it('exit 1: invalid, with the reason profile-set gave', async () => {
    const module = handlers(answering({ code: 1, stdout: '', stderr: 'profile-set: cannot write /x/profile.json: EACCES: permission denied\n' }))
    expect(await call(module, 'ecoMode.set', { root: repo, on: true, expected: STALE })).toEqual({ status: 'invalid', reason: 'cannot write /x/profile.json: EACCES: permission denied' })
  })

  it('exit 6: busy', async () => {
    expect(await call(handlers(answering({ code: 6, stdout: '', stderr: '' })), 'ecoMode.set', { root: repo, on: false, expected: STALE })).toEqual({ status: 'busy' })
  })

  it('any other exit, or a run that was stopped: an error naming it', async () => {
    await expect(call(handlers(answering({ code: 9, stdout: '', stderr: 'profile-set: boom\n' })), 'ecoMode.set', { root: repo, on: true, expected: STALE })).rejects.toThrow(/--set failed \(exit 9\): profile-set: boom/u)
    await expect(call(handlers(answering({ code: null, stdout: '', stderr: '' })), 'ecoMode.set', { root: repo, on: false, expected: STALE })).rejects.toThrow(/--reset failed \(stopped\)/u)
    await expect(call(handlers(answering({ code: 9, stdout: '', stderr: '' })), 'ecoMode.read', { root: repo })).rejects.toThrow(/--read failed \(exit 9\)/u)
  })

  it('an answer that does not read is an error, not a state', async () => {
    await expect(call(handlers(answering({ code: 0, stdout: 'not json', stderr: '' })), 'ecoMode.read', { root: repo })).rejects.toThrow(/--read printed an unexpected answer/u)
    await expect(call(handlers(answering({ code: 0, stdout: '{"written":true}', stderr: '' })), 'ecoMode.set', { root: repo, on: true, expected: STALE })).rejects.toThrow(/--set printed an unexpected answer/u)
  })

  it('a Harness without profile-set --field, or without profile-set: too old, nothing written', async () => {
    const old = handlers(answering({ code: 2, stdout: '', stderr: 'profile-set: unknown argument: --field\nusage: …' }))
    expect(await call(old, 'ecoMode.read', { root: repo })).toEqual({ available: false, reason: 'this Harness has no bin/profile-set --field' })
    expect(await call(old, 'ecoMode.set', { root: repo, on: true, expected: STALE })).toEqual({ status: 'too-old' })
    const none = handlers(async () => {
      throw new HarnessScriptStartError('ENOENT', 'no profile-set')
    })
    expect(await call(none, 'ecoMode.set', { root: repo, on: false, expected: STALE })).toEqual({ status: 'too-old' })
  })
})
