// The switch "Code stories for PRs" against the real Harness (worfy-code-stories ticket 03): the handlers of
// src/main/ipc/code-stories-setting.ts over the real harness/bin/profile-set, in a temporary Harness home with
// one registered Project. A Profile without `code_stories.pr` reads on, as the real bin/profile resolves it; off
// writes "off" through profile-set with `--expect`, and the other fields stay; a Profile changed since the read
// is not written; a refused write says why.
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NODE } from '../harness-node'
import { removeTestTree } from '../remove'

vi.mock('electron', () => ({
  app: { on: () => undefined, getVersion: () => '0.2.0', isPackaged: false, getAppPath: () => '/' },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  dialog: {},
  shell: {},
}))
vi.mock('../../src/main/harness/script-env', () => ({ harnessScriptEnv: () => Promise.resolve(process.env) }))

const { codeStoriesSettingHandlers } = await import('../../src/main/ipc/code-stories-setting')
const { HarnessScriptStartError } = await import('../../src/main/workflow/profile')
type Handlers = ReturnType<typeof codeStoriesSettingHandlers>
type Run = { code: number | null; stdout: string; stderr: string }

const BIN = join(process.cwd(), 'harness', 'bin')
const STALE = `sha256:${'0'.repeat(64)}`

let scratch: string
let harnessHome: string
let repo: string
let profileJson: string
let runs: string[][]

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
function profileSet(args: readonly string[]): Promise<Run> {
  runs.push([...args])
  return new Promise((done, fail) => {
    const child = spawn(NODE, [join(BIN, 'profile-set'), ...args], { env: harnessEnv(), windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    child.on('error', fail)
    child.on('close', (code) => done({ code, stdout, stderr }))
    child.stdin.end('')
  })
}

/** What the real bin/profile says of `code_stories.pr`. */
function profileField(): { code: number | null; stdout: string } {
  const run = spawnSync(NODE, [join(BIN, 'profile'), '-C', repo, '--field', 'code_stories.pr'], { env: harnessEnv(), encoding: 'utf8', windowsHide: true })
  return { code: run.status, stdout: run.stdout.trim() }
}

const handlers = (run: (args: readonly string[]) => Promise<Run> = profileSet): Handlers => codeStoriesSettingHandlers({ projects: () => [{ path: repo }], profileSet: run })

async function call(module: Handlers, channel: string, input: unknown): Promise<unknown> {
  const handler = module.find((entry) => entry.channel.name === channel)
  if (handler === undefined) throw new Error(`no handler of ${channel}`)
  return handler.handle(input as never, {} as never)
}

type Read = { available: true; on: boolean; fingerprint: string }
const read = async (module: Handlers): Promise<Read> => (await call(module, 'codeStoriesSetting.read', { root: repo })) as Read

const PROFILE = {
  schema: 2,
  name: 'demo',
  mode: 'full',
  commands: { test: 'make test' },
  workflow: { ci: 'pr', agents: 'eco' },
  review: { lenses: ['correctness'] },
}
const written = (): typeof PROFILE & { code_stories?: unknown } => JSON.parse(readFileSync(profileJson, 'utf8')) as typeof PROFILE & { code_stories?: unknown }
const writeProfile = (profile: object): void => writeFileSync(profileJson, `${JSON.stringify(profile, null, 2)}\n`)

beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-code-stories-setting-')))
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

describe('codeStoriesSetting over the real bin/profile-set', () => {
  it('reading runs only --read and writes nothing; a Profile without the field is on, as bin/profile reads it', async () => {
    const before = readFileSync(profileJson, 'utf8')
    const state = await read(handlers())
    expect(state).toMatchObject({ available: true, on: true })
    expect(state.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/u)
    expect(runs).toEqual([['-C', realpathSync.native(repo), '--field', 'code_stories.pr', '--read']])
    expect(readFileSync(profileJson, 'utf8')).toBe(before)
    expect(profileField()).toEqual({ code: 0, stdout: 'on' })
  })

  it('off writes "off" with --expect, on writes "on"; the other fields stay; bin/profile reads each', async () => {
    const module = handlers()
    const first = await read(module)
    const off = (await call(module, 'codeStoriesSetting.set', { root: repo, on: false, expected: first.fingerprint })) as { status: string; fingerprint: string }
    expect(off).toMatchObject({ status: 'saved', on: false, warning: null })
    expect(runs.at(-1)).toEqual(['-C', realpathSync.native(repo), '--field', 'code_stories.pr', '--expect', first.fingerprint, '--set', '{"code_stories.pr":"off"}'])
    expect(written()).toEqual({ ...PROFILE, code_stories: { pr: 'off' } })
    expect(profileField()).toEqual({ code: 0, stdout: 'off' })
    // The fingerprint of the write is the one a read gives now: the next click needs no read.
    expect(await read(module)).toEqual({ available: true, on: false, fingerprint: off.fingerprint })

    expect(await call(module, 'codeStoriesSetting.set', { root: repo, on: true, expected: off.fingerprint })).toMatchObject({ status: 'saved', on: true, warning: null })
    expect(runs.at(-1)).toEqual(['-C', realpathSync.native(repo), '--field', 'code_stories.pr', '--expect', off.fingerprint, '--set', '{"code_stories.pr":"on"}'])
    expect(written()).toEqual({ ...PROFILE, code_stories: { pr: 'on' } })
    expect(profileField()).toEqual({ code: 0, stdout: 'on' })
  })

  it('a Profile changed outside since the read: conflict, nothing written; a new read shows the change', async () => {
    const module = handlers()
    const stale = await read(module)
    writeProfile({ ...PROFILE, code_stories: { pr: 'off' } })
    const before = readFileSync(profileJson, 'utf8')
    expect(await call(module, 'codeStoriesSetting.set', { root: repo, on: false, expected: stale.fingerprint })).toEqual({ status: 'conflict' })
    expect(await call(module, 'codeStoriesSetting.set', { root: repo, on: true, expected: stale.fingerprint })).toEqual({ status: 'conflict' })
    expect(readFileSync(profileJson, 'utf8')).toBe(before)
    expect(await read(module)).toMatchObject({ available: true, on: false })
  })

  it('a root that is no Project of this Machine: not available, and a write is refused before profile-set runs', async () => {
    const outside = join(scratch, 'r')
    expect(await call(handlers(), 'codeStoriesSetting.read', { root: outside })).toEqual({ available: false, reason: 'not a Project of this Machine' })
    await expect(call(handlers(), 'codeStoriesSetting.set', { root: outside, on: false, expected: STALE })).rejects.toThrow(/not a Project of this Machine/u)
    expect(runs).toEqual([])
  })
})

describe('codeStoriesSetting when profile-set refuses or fails', () => {
  const answering =
    (run: Run) =>
    async (args: readonly string[]): Promise<Run> => {
      runs.push([...args])
      return run
    }

  it('exit 1: invalid, with the reason profile-set gave', async () => {
    const module = handlers(answering({ code: 1, stdout: '', stderr: 'profile-set: cannot write /x/profile.json: EACCES: permission denied\n' }))
    expect(await call(module, 'codeStoriesSetting.set', { root: repo, on: false, expected: STALE })).toEqual({ status: 'invalid', reason: 'cannot write /x/profile.json: EACCES: permission denied' })
  })

  it('exit 6: busy', async () => {
    expect(await call(handlers(answering({ code: 6, stdout: '', stderr: '' })), 'codeStoriesSetting.set', { root: repo, on: false, expected: STALE })).toEqual({ status: 'busy' })
  })

  it('a write that went through but was not committed: saved, with the warning', async () => {
    const stdout = JSON.stringify({ fingerprint: STALE, warning: 'the Harness home is not a git repository' })
    expect(await call(handlers(answering({ code: 0, stdout, stderr: '' })), 'codeStoriesSetting.set', { root: repo, on: false, expected: STALE })).toEqual({
      status: 'saved',
      on: false,
      fingerprint: STALE,
      warning: 'the Harness home is not a git repository',
    })
  })

  it('any other exit, or a run that was stopped: an error naming it', async () => {
    await expect(call(handlers(answering({ code: 9, stdout: '', stderr: 'profile-set: boom\n' })), 'codeStoriesSetting.set', { root: repo, on: false, expected: STALE })).rejects.toThrow(/--set failed \(exit 9\): profile-set: boom/u)
    await expect(call(handlers(answering({ code: null, stdout: '', stderr: '' })), 'codeStoriesSetting.set', { root: repo, on: true, expected: STALE })).rejects.toThrow(/--set failed \(stopped\)/u)
    await expect(call(handlers(answering({ code: 9, stdout: '', stderr: '' })), 'codeStoriesSetting.read', { root: repo })).rejects.toThrow(/--read failed \(exit 9\)/u)
  })

  it('an answer that does not read is an error, not a state', async () => {
    await expect(call(handlers(answering({ code: 0, stdout: 'not json', stderr: '' })), 'codeStoriesSetting.read', { root: repo })).rejects.toThrow(/--read printed an unexpected answer/u)
    await expect(call(handlers(answering({ code: 0, stdout: JSON.stringify({ fingerprint: STALE }), stderr: '' })), 'codeStoriesSetting.read', { root: repo })).rejects.toThrow(/--read printed an unexpected answer/u)
    await expect(call(handlers(answering({ code: 0, stdout: '{"written":true}', stderr: '' })), 'codeStoriesSetting.set', { root: repo, on: false, expected: STALE })).rejects.toThrow(/--set printed an unexpected answer/u)
  })

  it('a Harness without profile-set --field, or without profile-set: too old, nothing written', async () => {
    const old = handlers(answering({ code: 2, stdout: '', stderr: 'profile-set: unknown argument: --field\nusage: …' }))
    expect(await call(old, 'codeStoriesSetting.read', { root: repo })).toEqual({ available: false, reason: 'this Harness has no bin/profile-set --field' })
    expect(await call(old, 'codeStoriesSetting.set', { root: repo, on: false, expected: STALE })).toEqual({ status: 'too-old' })
    const none = handlers(async () => {
      throw new HarnessScriptStartError('ENOENT', 'no profile-set')
    })
    expect(await call(none, 'codeStoriesSetting.set', { root: repo, on: false, expected: STALE })).toEqual({ status: 'too-old' })
  })
})
