// The move of the workflow files between Full and Silent mode (worfy-polish ticket 81): `profileEdit.move` of
// src/main/ipc/profile-edit.ts over the real harness/bin/profile-set --move, in a temporary Harness home with
// one registered Project whose repository holds tickets, a spec, an ADR and a state file. Full -> Silent moves
// them into the default Workflow folder with a commit on each side, and bin/profile prints mode silent; Silent
// -> Full brings them back. A Session of the Project at work refuses the move before profile-set runs; an idle
// one does not. Uncommitted changes and an open PR of a ticket's branch are refused by the Harness with
// nothing changed; a failure half-way leaves both sides and the Profile as they were. Over the real Tickets and
// documents watches (WorkflowHub, DocsHub) and the real layout reader (bin/profile, bin/ticket), the watches
// follow the files to the Workflow folder: the layout of the root is read again, not taken from the cache, and
// a change there reaches both. gh is a node stand-in (PROFILE_SET_GH) that prints a prepared list: no real gh,
// no network.
import { execFile, execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DocsHub } from '../../src/main/docs/watch'
import { readProjectLayout, type ProjectLayout } from '../../src/main/workflow/folder'
import type { ProfileRun, ProfileRunner } from '../../src/main/workflow/profile'
import { WorkflowHub } from '../../src/main/workflow/watch'
import type { SessionState } from '../../src/shared/agent/events'
import type { DocsState } from '../../src/shared/ipc/docs'
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

const { profileEditHandlers, holdProjectWatches } = await import('../../src/main/ipc/profile-edit')
const { docsSource } = await import('../../src/main/ipc/docs')
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
let forgotten: string[]

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

/** A Harness script run as worfy runs it, in the temporary homes. */
const script =
  (name: 'profile' | 'ticket'): ProfileRunner =>
  (cwd, args) =>
    new Promise<ProfileRun>((done) => {
      execFile(NODE, [join(BIN, name), ...args], { cwd, env: harnessEnv(), encoding: 'utf8', windowsHide: true }, (error, stdout, stderr) => {
        done({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout, stderr })
      })
    })

/** The real bin/epic-status, as the Tickets watch runs it. */
const epicStatus = (cwd: string, ref: string | null): Promise<string> =>
  new Promise((done, fail) => {
    execFile(NODE, [join(BIN, 'epic-status'), '--json', ...(ref === null ? [] : ['--ref', ref])], { cwd, env: harnessEnv(), encoding: 'utf8', windowsHide: true }, (error, stdout, stderr) => {
      if (error) fail(new Error(`epic-status: ${stderr}`))
      else done(stdout)
    })
  })

/** The real layout reader over the temporary homes; the cache keeps an answer until it is forgotten, so a stale one shows. */
const readLayout = (root: string): Promise<ProjectLayout> => readProjectLayout({ root, claudeHome: join(scratch, 'home', '.claude'), env: harnessEnv(), run: script('profile'), runTicket: script('ticket'), log: () => undefined })
function layoutCache(): { get: (root: string) => Promise<ProjectLayout>; forget: (root: string) => void } {
  const cached = new Map<string, Promise<ProjectLayout>>()
  return {
    get: (root) => {
      const hit = cached.get(root) ?? readLayout(root)
      cached.set(root, hit)
      return hit
    },
    forget: (root) => {
      forgotten.push(root)
      cached.delete(root)
    },
  }
}

const profileField = (field: string): string => spawnSync(NODE, [join(BIN, 'profile'), '-C', repo, '--field', field], { env: harnessEnv(), encoding: 'utf8', windowsHide: true }).stdout.trim()

const handlers = (): Handlers =>
  profileEditHandlers({
    projects: () => [{ path: repo }],
    profileSet,
    layouts: layoutCache(),
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
  forgotten = []
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
    expect(toSilent).toEqual({ status: 'moved', mode: 'silent', folder: realpathSync.native(workflow), files: 4, warning: null, ignored: [], recovered: null, qmd: [] })
    expect(profileField('mode')).toBe('silent')
    expect(has(workflow)).toEqual([true, true, true, true])
    expect(has(repo)).toEqual([false, false, false, false])
    expect(existsSync(join(repo, 'src', 'a.txt'))).toBe(true)
    expect([count(repo), count(workflow)]).toEqual([2, 1])
    expect(git(harnessHome, 'log', '-1', '--format=%s').trim()).toBe('Move demo to Silent mode')
    expect(holds).toEqual([`hold ${repo}`, `watch again ${repo}`])
    expect(forgotten).toEqual([repo])

    const after = await read(module)
    expect([after.interrupted, after.severalRepos]).toEqual([false, false])
    expect(after.fixed).toEqual({ mode: 'silent', 'workflow.folder': realpathSync.native(workflow) })
    const toFull = await call(module, 'profileEdit.move', { root: repo, to: 'full', folder: null, expected: after.fixedFingerprint })
    expect(toFull).toEqual({ status: 'moved', mode: 'full', folder: null, files: 4, warning: null, ignored: [], recovered: null, qmd: [] })
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

  it('a stopped move shows on the read; a rollback that left something is a failure with what is left, not a refusal', async () => {
    writeFileSync(join(harnessHome, 'projects', 'demo', '.move-in-progress.json'), '{}\n')
    expect((await read(handlers())).interrupted).toBe(true)
    const left = ['taking back the commit in /x: git reset --keep failed']
    const answer = { code: 1, stdout: JSON.stringify({ ok: false, errors: [{ path: '', message: 'failed at to-commit; the move was rolled back, except: …' }], leftover: left }), stderr: '' }
    const module = profileEditHandlers({
      projects: () => [{ path: repo }],
      profileSet: (args, stdin) => (args.includes('--move') ? Promise.resolve(answer) : profileSet(args, stdin)),
      layouts: layoutCache(),
      sessions: () => Promise.resolve([]),
      holdWatches: () => Promise.resolve(() => Promise.resolve()),
    })
    expect(await move(module, 'silent')).toEqual({ status: 'failed', reason: 'failed at to-commit; the move was rolled back, except: …', left })
  })

  it('a stranger fingerprint of mode and folder is a conflict, and nothing moves', async () => {
    const module = handlers()
    const result = await call(module, 'profileEdit.move', { root: repo, to: 'silent', folder: null, expected: `sha256:${'0'.repeat(64)}` })
    expect(result).toEqual({ status: 'conflict' })
    expect(has(repo)).toEqual([true, true, true, true])
  })

  it('the real Tickets and documents watches follow the files to the Workflow folder and back', async () => {
    const workflowHub = new WorkflowHub({ claudeHome: join(scratch, 'home', '.claude'), env: () => Promise.resolve(harnessEnv()), run: epicStatus, layout: (root) => readLayout(root) })
    const states: DocsState[] = []
    const docsHub = new DocsHub({ debounceMs: 20, onState: (state) => void states.push(state) })
    try {
      const layouts = layoutCache()
      const module = profileEditHandlers({
        projects: () => [{ path: repo }],
        profileSet,
        layouts,
        sessions: () => Promise.resolve([]),
        holdWatches: (root) => holdProjectWatches({ workflowHub, docsHub, docsSource: (at) => docsSource(at, layouts) }, root, ['p1']),
      })
      const ticketsSeen: number[][] = []
      const first = await workflowHub.open(repo, { id: 'window', send: (delta) => void ticketsSeen.push(delta.tickets.map((ticket) => ticket.num)) })
      expect(first.tickets.map((ticket) => ticket.num)).toEqual([1])
      const opened = await docsHub.open('p1', (await docsSource(repo, layouts)).root, { id: 'window', send: () => undefined })
      expect(opened.adrs.map((adr) => adr.number)).toEqual(['0001'])
      // The cache answers Full mode until the move forgets it.
      expect((await layouts.get(repo)).mode).toBe('full')

      expect(await move(module, 'silent')).toMatchObject({ status: 'moved', mode: 'silent' })
      expect((await layouts.get(repo)).mode).toBe('silent')
      expect((await workflowHub.model(repo))?.tickets.map((ticket) => ticket.num)).toEqual([1])
      await until('the documents state of the Workflow folder', () => states.at(-1)?.handoff !== null && states.at(-1)?.adrs.length === 1)

      // A change in the Workflow folder reaches both watches: they watch it now, not the repository.
      mkdirSync(join(workflow, '.scratch', 'epic-a', 'issues'), { recursive: true })
      writeFileSync(join(workflow, '.scratch', 'epic-a', 'issues', '02-two.md'), '# 02 — two\n\nStatus: open\n')
      writeFileSync(join(workflow, 'docs', 'adr', '0002-b.md'), '# 0002 — b\n')
      await until('the new Ticket from the Workflow folder', () => ticketsSeen.some((nums) => nums.includes(2)))
      await until('the new ADR from the Workflow folder', () => states.at(-1)?.adrs.length === 2)
      git(workflow, 'add', '-A')
      git(workflow, 'commit', '-q', '-m', 'two more')

      expect(await move(module, 'full')).toMatchObject({ status: 'moved', mode: 'full', files: 6 })
      writeFileSync(join(repo, 'docs', 'adr', '0003-c.md'), '# 0003 — c\n')
      await until('the documents state of the repository again', () => states.at(-1)?.adrs.length === 3)
      expect((await workflowHub.model(repo))?.tickets.map((ticket) => ticket.num)).toEqual([1, 2])
    } finally {
      await Promise.all([workflowHub.closeAll(), docsHub.closeAll()])
    }
  })
})

async function until(what: string, ready: () => boolean): Promise<void> {
  for (let tries = 0; !ready(); tries += 1) {
    if (tries > 400) throw new Error(`timed out waiting for ${what}`)
    await new Promise((done) => setTimeout(done, 25))
  }
}
