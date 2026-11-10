// "Edit profile" against the Harness (worfy-polish ticket 78): the handlers of src/main/ipc/profile-edit.ts
// over the real harness/bin/profile-set, in a temporary Harness home with one registered Project. A valid
// edit is written through profile-set, bin/profile prints the new value and the Harness's git has the
// commit; a value against the draft schema (an empty verify, a ticket path without NN, an unknown finish)
// is refused with its field and profile.json does not change; a stranger fingerprint is a conflict. With a
// stub of the script, every call is a run of bin/profile-set with the fields of PROFILE_EDIT_FIELDS, and
// worfy writes no profile.json of its own.
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PROFILE_EDIT_FIELDS, type ProfileEditRead } from '../../src/shared/ipc/profile-edit'
import { NODE } from '../harness-node'
import { removeTestTree } from '../remove'

vi.mock('electron', () => ({
  app: { on: () => undefined, getVersion: () => '0.2.0', isPackaged: false, getAppPath: () => '/' },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  dialog: {},
  shell: {},
}))
vi.mock('../../src/main/harness/script-env', () => ({ harnessScriptEnv: () => Promise.resolve(process.env) }))

const { profileEditHandlers, PROFILE_SET_TOO_OLD } = await import('../../src/main/ipc/profile-edit')
const { HarnessScriptStartError } = await import('../../src/main/workflow/profile')
type Handlers = ReturnType<typeof profileEditHandlers>
type Run = { code: number | null; stdout: string; stderr: string }

const BIN = join(process.cwd(), 'harness', 'bin')
const STALE = `sha256:${'0'.repeat(64)}`

let scratch: string
let harnessHome: string
let repo: string
let profileJson: string
let runs: { args: string[]; stdin: string | undefined }[]

function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env, encoding: 'utf8' })
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

/** What the real bin/profile prints of a field. */
function profileField(field: string): string {
  return spawnSync(NODE, [join(BIN, 'profile'), '-C', repo, '--field', field], { env: harnessEnv(), encoding: 'utf8', windowsHide: true }).stdout.trim()
}

const handlers = (run: (args: readonly string[], stdin?: string) => Promise<Run> = profileSet): Handlers => profileEditHandlers({ projects: () => [{ path: repo }], profileSet: run })

async function call(module: Handlers, channel: string, input: unknown): Promise<unknown> {
  const handler = module.find((entry) => entry.channel.name === channel)
  if (handler === undefined) throw new Error(`no handler of ${channel}`)
  return handler.handle(input as never, {} as never)
}

type Available = Extract<ProfileEditRead, { available: true }>
const read = async (module: Handlers): Promise<Available> => (await call(module, 'profileEdit.read', { root: repo })) as Available

const PROFILE = {
  schema: 2,
  name: 'demo',
  title: 'Demo',
  mode: 'full',
  commands: { test: 'make test', verify: 'make check' },
  tickets: { path: '.scratch/<epic>/issues/NN-*.md', branch: '<epic>/<NN>' },
  workflow: { finish: 'pr-green-ci', folder: null },
  review: { lenses: ['correctness'] },
  github: { account: 'demo-bot' },
}
const profileText = (): string => readFileSync(profileJson, 'utf8')
const commits = (): number => Number(git(harnessHome, 'rev-list', '--count', 'HEAD').trim())

beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-profile-edit-')))
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
})

afterEach(() => {
  removeTestTree(scratch)
})

describe('profileEdit over the real bin/profile-set', () => {
  it('reads every field of the form, mode and the Workflow folder, and writes nothing', async () => {
    const before = profileText()
    const state = await read(handlers())
    expect(state.available).toBe(true)
    expect(state.name).toBe('demo')
    expect(Object.keys(state.values)).toEqual([...PROFILE_EDIT_FIELDS])
    expect(state.values).toMatchObject({ title: 'Demo', 'commands.verify': 'make check', 'tickets.path': '.scratch/<epic>/issues/NN-*.md', 'workflow.finish': 'pr-green-ci', 'github.account': 'demo-bot', 'docs.adr_dir': null })
    expect(state.fixed).toEqual({ mode: 'full', 'workflow.folder': null })
    expect(state.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/u)
    expect(profileText()).toBe(before)
  })

  it('a valid edit is written through profile-set: bin/profile prints it, and the Harness git has the commit', async () => {
    const module = handlers()
    const state = await read(module)
    const before = commits()
    const values = { ...state.values, 'commands.verify': 'make verify', 'tickets.path': 'tickets/NN-*.md', 'docs.adr_dir': 'docs/adr', 'language.team': 'en' }
    expect(await call(module, 'profileEdit.check', { root: repo, values })).toEqual([])
    const saved = (await call(module, 'profileEdit.write', { root: repo, values, expected: state.fingerprint })) as { status: string; fingerprint: string; warning: string | null }
    expect(saved).toMatchObject({ status: 'saved', warning: null })
    expect(profileField('commands.verify')).toBe('make verify')
    expect(profileField('tickets.path')).toBe('tickets/NN-*.md')
    expect(profileField('docs.adr_dir')).toBe('docs/adr')
    expect(commits()).toBe(before + 1)
    expect(git(harnessHome, 'show', '--name-only', '--format=', 'HEAD').trim()).toBe('projects/demo/profile.json')
    // The fields the form left as they were: the absent ones stay absent, the rest as written.
    const written = JSON.parse(profileText()) as Record<string, unknown>
    expect(written).not.toHaveProperty('parallel')
    expect(written).not.toHaveProperty('skills')
    expect(written.commands).toEqual({ test: 'make test', verify: 'make verify' })
    expect((await read(module)).fingerprint).toBe(saved.fingerprint)
  })

  it.each([
    ['an empty verify', 'commands.verify', '', 'must not be empty'],
    ['a ticket path without NN', 'tickets.path', '.scratch/<epic>/issues/*.md', 'must match the pattern "NN"'],
    ['an unknown finish', 'workflow.finish', 'merge-train', 'must be one of "pr-green-ci", "local-green"'],
  ])('%s is refused with its field by the check and by the write; profile.json does not change', async (_name, field, value, message) => {
    const module = handlers()
    const state = await read(module)
    const before = profileText()
    const commitsBefore = commits()
    const values = { ...state.values, [field]: value }
    expect(await call(module, 'profileEdit.check', { root: repo, values })).toEqual([{ path: field, message }])
    const refused = (await call(module, 'profileEdit.write', { root: repo, values, expected: state.fingerprint })) as { status: string; issues: unknown; reason: string }
    expect(refused).toMatchObject({ status: 'invalid', issues: [{ path: field, message }] })
    expect(refused.reason).toContain(`${field}: ${message}`)
    expect(profileText()).toBe(before)
    expect(commits()).toBe(commitsBefore)
  })

  // The unit test's check answers this way too: the form sends a cleared verify or ticket path as "", never null.
  it('null in verify and in the ticket path passes the check: it means "none", so a cleared field cannot be sent as null', async () => {
    const module = handlers()
    const state = await read(module)
    const values = { ...state.values, 'commands.verify': null, 'tickets.path': null }
    expect(await call(module, 'profileEdit.check', { root: repo, values })).toEqual([])
  })

  it('a Profile changed since the read: conflict, nothing written; a new read shows the change', async () => {
    const module = handlers()
    const stale = await read(module)
    writeFileSync(profileJson, `${JSON.stringify({ ...PROFILE, title: 'Changed' }, null, 2)}\n`)
    const before = profileText()
    expect(await call(module, 'profileEdit.write', { root: repo, values: { ...stale.values, title: 'Mine' }, expected: stale.fingerprint })).toEqual({ status: 'conflict' })
    expect(profileText()).toBe(before)
    expect((await read(module)).values.title).toBe('Changed')
  })

  it('a value for a field outside the form is not passed on: mode stays', async () => {
    const module = handlers()
    const state = await read(module)
    await call(module, 'profileEdit.write', { root: repo, values: { ...state.values, mode: 'silent', name: 'other', title: 'New' }, expected: state.fingerprint })
    expect(profileField('mode')).toBe('full')
    expect(JSON.parse(profileText())).toMatchObject({ name: 'demo', mode: 'full', title: 'New' })
  })

  it('a root that is no Project of this Machine: not available, and a check or a write is refused before profile-set runs', async () => {
    const outside = join(scratch, 'r')
    expect(await call(handlers(), 'profileEdit.read', { root: outside })).toEqual({ available: false, reason: 'not a Project of this Machine' })
    await expect(call(handlers(), 'profileEdit.check', { root: outside, values: {} })).rejects.toThrow(/not a Project of this Machine/u)
    await expect(call(handlers(), 'profileEdit.write', { root: outside, values: {}, expected: STALE })).rejects.toThrow(/not a Project of this Machine/u)
    expect(runs).toEqual([])
  })
})

describe('profileEdit with a stub of profile-set', () => {
  const answering =
    (answer: (args: readonly string[]) => Run) =>
    async (args: readonly string[], stdin?: string): Promise<Run> => {
      runs.push({ args: [...args], stdin })
      return answer(args)
    }
  const FIELD_ARGS = PROFILE_EDIT_FIELDS.flatMap((field) => ['--field', field])

  it('every call is a run of bin/profile-set with the fields of the form, and worfy writes no profile.json itself', async () => {
    const before = profileText()
    const fields = Object.fromEntries(PROFILE_EDIT_FIELDS.map((field) => [field, null]))
    const module = handlers(
      answering((args) =>
        args.includes('--read')
          ? { code: 0, stdout: JSON.stringify({ name: 'demo', fields: args.includes('mode') ? { mode: 'full', 'workflow.folder': null } : fields, fingerprint: STALE }), stderr: '' }
          : args.includes('--check')
            ? { code: 0, stdout: '{"ok":true}', stderr: '' }
            : { code: 0, stdout: JSON.stringify({ written: true, fingerprint: STALE, warning: null }), stderr: '' },
      ),
    )
    const state = await read(module)
    await call(module, 'profileEdit.check', { root: repo, values: { ...state.values, title: 'T' } })
    expect(await call(module, 'profileEdit.write', { root: repo, values: { ...state.values, title: 'T' }, expected: STALE })).toEqual({ status: 'saved', fingerprint: STALE, warning: null })
    const root = realpathSync.native(repo)
    expect(runs.map((run) => run.args)).toEqual([
      ['-C', root, ...FIELD_ARGS, '--read'],
      ['-C', root, '--field', 'mode', '--field', 'workflow.folder', '--read'],
      ['-C', root, ...FIELD_ARGS, '--check', '-'],
      ['-C', root, ...FIELD_ARGS, '--expect', STALE, '--set', '-'],
    ])
    expect(JSON.parse(runs[3]!.stdin!)).toEqual({ ...fields, title: 'T' })
    // The stub wrote nothing, and nothing else did.
    expect(profileText()).toBe(before)
  })

  it('exit 1 without a JSON answer: invalid, the reason as a problem of the whole form', async () => {
    const module = handlers(answering(() => ({ code: 1, stdout: '', stderr: 'profile-set: cannot write /x/profile.json: EACCES\n' })))
    expect(await call(module, 'profileEdit.write', { root: repo, values: {}, expected: STALE })).toEqual({
      status: 'invalid',
      reason: 'cannot write /x/profile.json: EACCES',
      issues: [{ path: '', message: 'cannot write /x/profile.json: EACCES' }],
    })
  })

  it('exit 6: busy; any other exit: an error naming it', async () => {
    expect(await call(handlers(answering(() => ({ code: 6, stdout: '', stderr: '' }))), 'profileEdit.write', { root: repo, values: {}, expected: STALE })).toEqual({ status: 'busy' })
    await expect(call(handlers(answering(() => ({ code: 9, stdout: '', stderr: 'profile-set: boom\n' }))), 'profileEdit.write', { root: repo, values: {}, expected: STALE })).rejects.toThrow(
      /--set failed \(exit 9\): profile-set: boom/u,
    )
    await expect(call(handlers(answering(() => ({ code: 9, stdout: '', stderr: '' }))), 'profileEdit.check', { root: repo, values: {} })).rejects.toThrow(/--check failed \(exit 9\)/u)
  })

  it('a Harness whose profile-set writes only workflow.agents and agents, or has none: not available, nothing written', async () => {
    const old = handlers(answering(() => ({ code: 2, stdout: '', stderr: 'profile-set: --field takes workflow.agents or agents, not title\nusage: …' })))
    expect(await call(old, 'profileEdit.read', { root: repo })).toEqual({ available: false, reason: PROFILE_SET_TOO_OLD })
    expect(await call(old, 'profileEdit.check', { root: repo, values: {} })).toEqual([{ path: '', message: PROFILE_SET_TOO_OLD }])
    expect(await call(old, 'profileEdit.write', { root: repo, values: {}, expected: STALE })).toEqual({ status: 'invalid', reason: PROFILE_SET_TOO_OLD, issues: [] })
    const none = handlers(async () => {
      throw new HarnessScriptStartError('ENOENT', 'no profile-set')
    })
    expect(await call(none, 'profileEdit.read', { root: repo })).toEqual({ available: false, reason: PROFILE_SET_TOO_OLD })
  })
})
