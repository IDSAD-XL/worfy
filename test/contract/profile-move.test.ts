// The move of the workflow files between Full and Silent mode (worfy-polish ticket 81): `profileEdit.move` of
// src/main/ipc/profile-edit.ts over the real harness/bin/profile-set --move, in a temporary Harness home with
// one registered Project whose repository holds tickets, a spec, an ADR and a state file. Full -> Silent moves
// them into the default Workflow folder with a commit on each side, and bin/profile prints mode silent; Silent
// -> Full brings them back. A Session of the Project at work refuses the move before profile-set runs; an idle
// one does not. Uncommitted changes and an open PR of a ticket's branch are refused by the Harness with
// nothing changed; a failure half-way leaves both sides and the Profile as they were. gh is a node stand-in
// (PROFILE_SET_GH) that prints a prepared list: no real gh, no network.
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionState } from '../../src/shared/agent/events'
import type { ProfileEditRead } from '../../src/shared/ipc/profile-edit'
import { NODE } from '../harness-node'
import { removeTestTree } from '../remove'

vi.mock('electron', () => ({
  app: { on: () => undefined, getVersion: () => '0.2.0', isPackaged: false, getAppPath: () => '/' },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  dialog: {},
  shell: {},
}))
vi.mock('../../src/main/harness/script-env', () => ({ harnessScriptEnv: () => Promise.resolve(process.env) }))

const { profileEditHandlers } = await import('../../src/main/ipc/profile-edit')
type Handlers = ReturnType<typeof profileEditHandlers>
type Run = { code: number | null; stdout: string; stderr: string }

const BIN = join(process.cwd(), 'harness', 'bin')

let scratch: string
let harnessHome: string
let repo: string
let workflow: string
let profileJson: string
let ghAnswer: string
let failAt: string
let sessions: { cwd: string; state: SessionState }[]
let holds: string[]
let moves: string[][]

function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env, encoding: 'utf8' })
}

/** The temporary homes, gh as the stand-in, and nothing of the machine's registry or profiles. */
function harnessEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: join(scratch, 'home'),
    USERPROFILE: join(scratch, 'home'),
    HARNESS_HOME: harnessHome,
    PROFILE_SET_GH: join(scratch, 'gh-stand-in.mjs'),
    GH_ANSWER: ghAnswer,
    GH_TOKEN: 'invalid',
    PROFILE_SET_MOVE_FAIL_AT: failAt,
  }
  for (const key of ['CLAUDE_GATE_CONFIG', 'CLAUDE_PROFILES_DIR', 'EVAL_HARNESS_HOME', 'ELECTRON_RUN_AS_NODE', 'GITHUB_TOKEN']) delete env[key]
  return env
}

/** The real bin/profile-set. */
function profileSet(args: readonly string[], stdin?: string): Promise<Run> {
  if (args.includes('--move')) moves.push([...args])
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

const profileField = (field: string): string => spawnSync(NODE, [join(BIN, 'profile'), '-C', repo, '--field', field], { env: harnessEnv(), encoding: 'utf8', windowsHide: true }).stdout.trim()

const handlers = (): Handlers =>
  profileEditHandlers({
    projects: () => [{ path: repo }],
    profileSet,
    sessions: () => Promise.resolve(sessions),
    holdWatches: (root) => {
      holds.push(`hold ${root}`)
      return Promise.resolve(() => {
        holds.push(`watch again ${root}`)
        return Promise.resolve()
      })
    },
  })

async function call(module: Handlers, channel: string, input: unknown): Promise<unknown> {
  const handler = module.find((entry) => entry.channel.name === channel)
  if (handler === undefined) throw new Error(`no handler of ${channel}`)
  return handler.handle(input as never, {} as never)
}

type Available = Extract<ProfileEditRead, { available: true }>
const read = async (module: Handlers): Promise<Available> => (await call(module, 'profileEdit.read', { root: repo })) as Available
const move = async (module: Handlers, to: 'full' | 'silent'): Promise<unknown> => {
  const state = await read(module)
  return call(module, 'profileEdit.move', { root: repo, to, folder: null, expected: state.fixedFingerprint })
}

const PROFILE = {
  schema: 2,
  name: 'demo',
  mode: 'full',
  commands: { verify: 'make check' },
  tickets: { root: '.scratch', path: '.scratch/<epic>/issues/NN-*.md', branch: '<epic>/<NN>' },
  workflow: { folder: null },
  docs: { adr_dir: 'docs/adr', handoff: { path: 'HANDOFF.md' } },
}
const WORKFLOW_FILES = ['.scratch/epic-a/issues/01-one.md', '.scratch/epic-a/spec.md', 'docs/adr/0001-a.md', 'HANDOFF.md']
const profileText = (): string => readFileSync(profileJson, 'utf8')
const count = (cwd: string): number => Number(git(cwd, 'rev-list', '--count', 'HEAD').trim())
const has = (root: string): boolean[] => WORKFLOW_FILES.map((file) => existsSync(join(root, file)))

beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-profile-move-')))
  harnessHome = join(scratch, 'hh')
  repo = join(scratch, 'r', 'demo')
  workflow = join(harnessHome, 'projects', 'demo', 'workflow')
  ghAnswer = '[]'
  failAt = ''
  sessions = []
  holds = []
  moves = []
  mkdirSync(join(scratch, 'home'), { recursive: true })
  mkdirSync(join(harnessHome, 'gate'), { recursive: true })
  mkdirSync(join(harnessHome, 'projects', 'demo'), { recursive: true })
  for (const dir of ['.scratch/epic-a/issues', 'docs/adr', 'src']) mkdirSync(join(repo, dir), { recursive: true })
  for (const file of WORKFLOW_FILES) writeFileSync(join(repo, file), `# ${file}\n`)
  writeFileSync(join(repo, 'src', 'a.txt'), 'code\n')
  git(repo, 'init', '-q')
  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', 'init')
  git(repo, 'remote', 'add', 'origin', 'https://example.invalid/demo.git')
  writeFileSync(
    join(scratch, 'gh-stand-in.mjs'),
    'process.stdout.write(process.env.GH_ANSWER ?? "[]")\n',
  )
  writeFileSync(join(harnessHome, 'gate', 'config.json'), JSON.stringify({ repos: [{ key: 'demo', match: repo, profile: 'demo' }] }))
  profileJson = join(harnessHome, 'projects', 'demo', 'profile.json')
  writeFileSync(profileJson, `${JSON.stringify(PROFILE, null, 2)}\n`)
  writeFileSync(join(harnessHome, '.gitignore'), '/*\n!/.gitignore\n!/projects/\n/projects/*/workflow/\n!/gate/\n/gate/*\n!/gate/config.json\n')
  git(harnessHome, 'init', '-q')
  git(harnessHome, 'add', '-A')
  git(harnessHome, 'commit', '-q', '-m', 'init')
})

afterEach(() => {
  removeTestTree(scratch)
})

describe('profileEdit.move over the real bin/profile-set --move', () => {
  it('Full -> Silent moves the workflow files into the Workflow folder with a commit on each side, and back', async () => {
    const module = handlers()
    const state = await read(module)
    expect(state.fixed).toEqual({ mode: 'full', 'workflow.folder': null })
    expect(state.fixedFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/u)

    const toSilent = await call(module, 'profileEdit.move', { root: repo, to: 'silent', folder: null, expected: state.fixedFingerprint })
    expect(toSilent).toEqual({ status: 'moved', mode: 'silent', folder: realpathSync.native(workflow), files: 4, warning: null })
    expect(profileField('mode')).toBe('silent')
    expect(has(workflow)).toEqual([true, true, true, true])
    expect(has(repo)).toEqual([false, false, false, false])
    expect(existsSync(join(repo, 'src', 'a.txt'))).toBe(true)
    expect([count(repo), count(workflow)]).toEqual([2, 1])
    expect(git(harnessHome, 'log', '-1', '--format=%s').trim()).toBe('Move demo to Silent mode')
    expect(holds).toEqual([`hold ${repo}`, `watch again ${repo}`])

    const after = await read(module)
    expect(after.fixed).toEqual({ mode: 'silent', 'workflow.folder': realpathSync.native(workflow) })
    const toFull = await call(module, 'profileEdit.move', { root: repo, to: 'full', folder: null, expected: after.fixedFingerprint })
    expect(toFull).toEqual({ status: 'moved', mode: 'full', folder: null, files: 4, warning: null })
    expect(profileField('mode')).toBe('full')
    expect(has(repo)).toEqual([true, true, true, true])
    expect(has(workflow)).toEqual([false, false, false, false])
    expect([count(repo), count(workflow)]).toEqual([3, 2])
  })

  it('a Session of the Project at work refuses the move before profile-set runs; an idle one does not', async () => {
    const module = handlers()
    const before = profileText()
    sessions = [{ cwd: join(repo, 'src'), state: 'busy' }]
    const refused = (await move(module, 'silent')) as { status: string; reason: string }
    expect(refused.status).toBe('refused')
    expect(refused.reason).toContain('a Session of the Project is at work')
    expect(moves).toEqual([])
    expect(holds).toEqual([])
    expect(profileText()).toBe(before)
    expect(has(repo)).toEqual([true, true, true, true])

    sessions = [{ cwd: repo, state: 'idle' }, { cwd: join(scratch, 'elsewhere'), state: 'busy' }]
    expect(await move(module, 'silent')).toMatchObject({ status: 'moved', mode: 'silent' })
  })

  it('uncommitted changes and an open PR of a ticket are refused with the reason; nothing changes', async () => {
    const module = handlers()
    const before = profileText()
    writeFileSync(join(repo, 'HANDOFF.md'), '# edited\n')
    const dirty = (await move(module, 'silent')) as { status: string; reason: string }
    expect(dirty.status).toBe('refused')
    expect(dirty.reason).toContain('the repository has uncommitted changes')
    git(repo, 'checkout', '-q', '--', 'HANDOFF.md')

    ghAnswer = JSON.stringify([{ number: 41, headRefName: 'epic-a/01' }])
    const open = (await move(module, 'silent')) as { status: string; reason: string }
    expect(open.status).toBe('refused')
    expect(open.reason).toContain('#41 (epic-a/01)')

    expect(profileText()).toBe(before)
    expect(count(repo)).toBe(1)
    expect(existsSync(workflow)).toBe(false)
    expect(has(repo)).toEqual([true, true, true, true])
  })

  it('a failure half-way leaves both sides and the Profile as they were', async () => {
    const module = handlers()
    const before = profileText()
    failAt = 'from-commit'
    const failed = (await move(module, 'silent')) as { status: string; reason: string }
    expect(failed.status).toBe('refused')
    expect(failed.reason).toContain('rolled back')
    expect(profileText()).toBe(before)
    expect(count(repo)).toBe(1)
    expect(git(repo, 'status', '--porcelain')).toBe('')
    expect(has(repo)).toEqual([true, true, true, true])
    expect(existsSync(workflow)).toBe(false)
    expect(holds).toEqual([`hold ${repo}`, `watch again ${repo}`])
  })

  it('a stranger fingerprint of mode and folder is a conflict, and nothing moves', async () => {
    const module = handlers()
    const result = await call(module, 'profileEdit.move', { root: repo, to: 'silent', folder: null, expected: `sha256:${'0'.repeat(64)}` })
    expect(result).toEqual({ status: 'conflict' })
    expect(has(repo)).toEqual([true, true, true, true])
  })
})
