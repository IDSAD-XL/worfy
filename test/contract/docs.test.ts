// The `docs` channels in main: src/main/ipc/docs.ts registered through registerIpc (the same
// wrapper the app uses) over a mocked `electron`, against a real git repository in a temporary
// folder. `docs.read` hands out the text of HANDOFF.md and docs/adr/NNNN-*.md only, after
// symlinks are resolved; the watcher reports edits within a second; the HANDOFF Node follows the
// file. Nothing here writes into the repository (ADR-0002, ADR-0005): the last test checks that
// the files and `git status --porcelain` are exactly as they were.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, renameSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import type { DocsState } from '../../src/shared/ipc/docs'
import type { LayoutState } from '../../src/shared/layout/types'
import { APP_URL, INDEX_HTML } from '../app-url'
import { removeTestTree, saveLayoutNow } from '../remove'
import { ms } from '../time-scale'

const PROJECT_ID = 'repo-00000001'
/** The canned Harness script: prints <link>.out (test/fixtures/harness-stub/canned). */
const CANNED = join(import.meta.dirname, '..', 'fixtures', 'harness-stub', 'canned')

const electron = vi.hoisted(() => ({ listeners: new Map<string, (() => void)[]>() }))

vi.mock('electron', () => ({
  app: {
    on: (name: string, listener: () => void) => {
      electron.listeners.set(name, [...(electron.listeners.get(name) ?? []), listener])
    },
  },
  BrowserWindow: { getAllWindows: () => [] },
}))
// The app runs the Harness scripts with the login shell environment; a test does not start the
// login shell of the machine it runs on, so the scripts get this process's environment here.
vi.mock('../../src/main/harness/script-env', () => ({ harnessScriptEnv: () => Promise.resolve(process.env) }))

type Listener = (event: IpcMainInvokeEvent, input: unknown) => unknown

interface FakeSender {
  id: number
  sent: DocsState[]
  send: (channel: string, payload: unknown) => void
  once: (event: string, listener: () => void) => void
  isDestroyed: () => boolean
}

let scratch: string
let repo: string
let outside: string
let handlers: Map<string, Listener>
let sender: FakeSender
let docsModule: typeof import('../../src/main/ipc/docs')
let layoutModule: typeof import('../../src/main/layout/store')

const HANDOFF = '# HANDOFF\n\n## Сейчас в работе\n\n- тикет 12\n'
const ADR_1 = '# worfy — чистая реализация\n\nДата: 2026-10-05. Статус: принят.\n\nТекст.\n'
const ADR_2 = '# Каналы IPC\n\nДата: 2026-10-05. Статус: заменён 0099.\n\nТекст.\n'

function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env, encoding: 'utf8' }).trim()
}

function makeSender(id: number): FakeSender {
  const sent: DocsState[] = []
  return {
    id,
    sent,
    send: (channel, payload) => {
      if (channel === `${IPC_CHANNEL_PREFIX}docs.changed`) sent.push(payload as DocsState)
    },
    once: () => undefined,
    isDestroyed: () => false,
  }
}

async function call(channel: string, input?: unknown, from: FakeSender = sender): Promise<IpcResult<unknown>> {
  const listener = handlers.get(IPC_CHANNEL_PREFIX + channel)
  if (!listener) throw new Error(`no handler for ${channel}`)
  const event = { senderFrame: { url: APP_URL }, sender: from } as unknown as IpcMainInvokeEvent
  return (await listener(event, input)) as IpcResult<unknown>
}

async function value<T>(channel: string, input?: unknown): Promise<T> {
  const result = await call(channel, input)
  if (!result.ok) throw new Error(result.error)
  return result.value as T
}

async function refused(input: unknown, reason: RegExp): Promise<void> {
  const result = await call('docs.read', input)
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error).toMatch(reason)
}

const handoffNodes = () => layoutModule.layoutStore().get(PROJECT_ID).layout.nodes.filter((node) => node.kind === 'handoff')

/**
 * Waits until the reads the watcher makes after its start (SETTLE_READS_MS) are over. An edit made
 * after this reaches the app through the file events only, so a test that edits after it checks
 * the watch itself, and how long its events take.
 */
async function pastStartReads(): Promise<void> {
  const { SETTLE_READS_MS } = await import('../../src/main/docs/watch')
  await new Promise((resolve) => setTimeout(resolve, Math.max(...SETTLE_READS_MS) + 200))
}

/** Every file and folder under `dir` with its size and modification time, `.git` included. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      const stat = statSync(path, { throwIfNoEntry: false })
      out[relative(dir, path)] = stat ? `${stat.size}:${stat.mtimeMs}` : 'dangling'
      if (entry.isDirectory()) walk(path)
    }
  }
  walk(dir)
  return out
}

beforeEach(async () => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-docs-')))
  repo = join(scratch, 'repo')
  mkdirSync(join(repo, 'docs', 'adr'), { recursive: true })
  git(repo, 'init', '-q')
  writeFileSync(join(repo, 'HANDOFF.md'), HANDOFF)
  writeFileSync(join(repo, 'README.md'), 'repo')
  writeFileSync(join(repo, 'docs', 'adr', '0002-ipc.md'), ADR_2)
  writeFileSync(join(repo, 'docs', 'adr', '0001-clean-room.md'), ADR_1)
  writeFileSync(join(repo, 'docs', 'adr', 'README.md'), 'not an ADR')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  outside = join(scratch, 'outside')
  mkdirSync(outside)
  writeFileSync(join(outside, 'secret.md'), 'not the Project')
  writeFileSync(join(scratch, 'passwd'), 'root:x:0:0')

  const dataDir = join(scratch, 'data')
  mkdirSync(join(dataDir, PROJECT_ID), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT_ID, name: 'repo', path: repo }], activeId: PROJECT_ID }))

  electron.listeners.clear()
  sender = makeSender(1)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)

  vi.resetModules()
  process.env.WORFY_DATA_DIR = dataDir
  // No Harness in this Claude home: every Project reads as Full mode, the machine's ~/.claude is not asked.
  process.env.WORFY_CLAUDE_HOME = join(scratch, 'claude-home')
  const { registerIpc, appUrlMatcher } = await import('../../src/main/ipc/index')
  docsModule = await import('../../src/main/ipc/docs')
  layoutModule = await import('../../src/main/layout/store')
  handlers = new Map()
  await registerIpc(
    { handle: (channel, listener) => handlers.set(channel, listener as Listener) },
    {
      modules: { './docs.ts': () => Promise.resolve(docsModule.default) },
      isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }),
    },
  )
})

afterEach(async () => {
  await docsModule.docsHub.closeAll()
  vi.restoreAllMocks()
  // Before the folder goes: the Layout store saves a moment after the last change, and a save
  // that came after the removal made the folder again.
  await saveLayoutNow()
  delete process.env.WORFY_DATA_DIR
  delete process.env.WORFY_CLAUDE_HOME
  removeTestTree(scratch)
})

describe('docs.read', () => {
  it('reads HANDOFF.md and an ADR, and answers with the relative path and the text only', async () => {
    expect(await call('docs.read', { projectId: PROJECT_ID, path: 'HANDOFF.md', root: '/etc' })).toStrictEqual({
      ok: true,
      value: { path: 'HANDOFF.md', text: HANDOFF },
    })
    expect(await call('docs.read', { projectId: PROJECT_ID, path: join(repo, 'docs', 'adr', '0001-clean-room.md') })).toStrictEqual({
      ok: true,
      value: { path: 'docs/adr/0001-clean-room.md', text: ADR_1 },
    })
    expect(await value('docs.read', { projectId: PROJECT_ID, path: 'docs/./adr/../adr/0002-ipc.md' })).toStrictEqual({ path: 'docs/adr/0002-ipc.md', text: ADR_2 })
  })

  it('follows a symlink whose target is HANDOFF.md or an ADR of the same Project', async () => {
    unlinkSync(join(repo, 'HANDOFF.md'))
    symlinkSync(join(repo, 'docs', 'adr', '0001-clean-room.md'), join(repo, 'HANDOFF.md'))
    expect(await value('docs.read', { projectId: PROJECT_ID, path: 'HANDOFF.md' })).toStrictEqual({ path: 'docs/adr/0001-clean-room.md', text: ADR_1 })
  })

  it('refuses ../ out of the Project, an absolute path outside and a symlink that points out', async () => {
    await refused({ projectId: PROJECT_ID, path: '../../etc/passwd' }, /outside the Project/)
    await refused({ projectId: PROJECT_ID, path: '../passwd' }, /outside the Project/)
    await refused({ projectId: PROJECT_ID, path: join(scratch, 'passwd') }, /outside the Project/)
    await refused({ projectId: PROJECT_ID, path: '/etc/passwd' }, /outside the Project/)
    symlinkSync(join(outside, 'secret.md'), join(repo, 'docs', 'adr', '0003-evil.md'))
    await refused({ projectId: PROJECT_ID, path: 'docs/adr/0003-evil.md' }, /outside the Project/)
    unlinkSync(join(repo, 'HANDOFF.md'))
    symlinkSync(join(outside, 'secret.md'), join(repo, 'HANDOFF.md'))
    await refused({ projectId: PROJECT_ID, path: 'HANDOFF.md' }, /outside the Project/)
    // docs/adr itself swapped for a link to a folder outside.
    removeTestTree(join(repo, 'docs', 'adr'))
    symlinkSync(outside, join(repo, 'docs', 'adr'))
    await refused({ projectId: PROJECT_ID, path: 'docs/adr/secret.md' }, /outside the Project/)
  })

  it('refuses files of the Project that are neither HANDOFF.md nor docs/adr/NNNN-*.md', async () => {
    await refused({ projectId: PROJECT_ID, path: 'README.md' }, /only HANDOFF\.md and docs\/adr/)
    await refused({ projectId: PROJECT_ID, path: 'docs/adr/README.md' }, /only HANDOFF\.md and docs\/adr/)
    await refused({ projectId: PROJECT_ID, path: '.git/config' }, /only HANDOFF\.md and docs\/adr/)
    mkdirSync(join(repo, 'docs', 'adr', 'old'))
    writeFileSync(join(repo, 'docs', 'adr', 'old', '0001-x.md'), 'x')
    await refused({ projectId: PROJECT_ID, path: 'docs/adr/old/0001-x.md' }, /only HANDOFF\.md and docs\/adr/)
    // A link inside the Project to a file that is not a document is refused by its target.
    symlinkSync(join(repo, 'README.md'), join(repo, 'docs', 'adr', '0004-readme.md'))
    await refused({ projectId: PROJECT_ID, path: 'docs/adr/0004-readme.md' }, /only HANDOFF\.md and docs\/adr/)
    await refused({ projectId: PROJECT_ID, path: 'docs/adr/0009-missing.md' }, /does not exist/)
  })

  it('refuses a folder with an ADR name and a file larger than DOC_SIZE_MAX, and reads one of exactly that size', async () => {
    const { DOC_SIZE_MAX } = await import('../../src/main/docs/watch')
    mkdirSync(join(repo, 'docs', 'adr', '0005-folder.md'))
    await refused({ projectId: PROJECT_ID, path: 'docs/adr/0005-folder.md' }, /is not a file/)
    writeFileSync(join(repo, 'docs', 'adr', '0006-big.md'), 'x'.repeat(DOC_SIZE_MAX + 1))
    await refused({ projectId: PROJECT_ID, path: 'docs/adr/0006-big.md' }, /larger than/)
    writeFileSync(join(repo, 'docs', 'adr', '0007-max.md'), 'x'.repeat(DOC_SIZE_MAX))
    expect(await value<{ text: string }>('docs.read', { projectId: PROJECT_ID, path: 'docs/adr/0007-max.md' })).toMatchObject({ path: 'docs/adr/0007-max.md' })
    // The ADR list leaves out what docs.read refuses.
    const state = await value<DocsState>('docs.open', { projectId: PROJECT_ID })
    expect(state.adrs.map((adr) => adr.number)).toStrictEqual(['0001', '0002', '0007'])
  })

  it('refuses an input of the wrong type and an unknown Project', async () => {
    await refused({ projectId: PROJECT_ID, path: 42 }, /invalid input/)
    await refused({ projectId: PROJECT_ID }, /invalid input/)
    await refused({ projectId: PROJECT_ID, path: '' }, /invalid input/)
    await refused({ projectId: 'nope-00000000', path: 'HANDOFF.md' }, /nope-00000000/)
  })
})

describe('docs.open', () => {
  it('lists HANDOFF.md and the ADRs by number, with title and status, and nothing else', async () => {
    const state = await value<DocsState>('docs.open', { projectId: PROJECT_ID, extra: true })
    expect(Object.keys(state).sort()).toStrictEqual(['adrs', 'handoff', 'projectId'])
    expect(state.projectId).toBe(PROJECT_ID)
    expect(state.handoff).toStrictEqual({ path: 'HANDOFF.md', version: expect.stringMatching(/^[0-9a-f]{16}$/) as unknown })
    const version = expect.stringMatching(/^[0-9a-f]{16}$/) as unknown
    expect(state.adrs).toStrictEqual([
      { path: 'docs/adr/0001-clean-room.md', number: '0001', title: 'worfy — чистая реализация', status: 'принят', version },
      { path: 'docs/adr/0002-ipc.md', number: '0002', title: 'Каналы IPC', status: 'заменён 0099', version },
    ])
    expect(state.adrs[0]!.version).not.toBe(state.adrs[1]!.version)
  })

  it('refuses an input of the wrong type', async () => {
    const result = await call('docs.open', { projectId: 7 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/invalid input/)
  })

  it('sends docs.changed within a second of an edit of HANDOFF.md and of a new ADR', async () => {
    const first = await value<DocsState>('docs.open', { projectId: PROJECT_ID })
    await pastStartReads()
    expect(sender.sent).toStrictEqual([])
    writeFileSync(join(repo, 'HANDOFF.md'), `${HANDOFF}\n- ещё строка\n`)
    await vi.waitFor(() => expect(sender.sent.at(-1)?.handoff?.version).not.toBe(first.handoff?.version), { timeout: ms(1000), interval: 20 })
    expect(await value('docs.read', { projectId: PROJECT_ID, path: 'HANDOFF.md' })).toStrictEqual({ path: 'HANDOFF.md', text: `${HANDOFF}\n- ещё строка\n` })

    writeFileSync(join(repo, 'docs', 'adr', '0003-new.md'), '# Новое\n\nДата: 2026-10-06. Статус: принят.\n')
    await vi.waitFor(() => expect(sender.sent.at(-1)?.adrs.map((adr) => adr.number)).toStrictEqual(['0001', '0002', '0003']), { timeout: ms(1000), interval: 20 })

    unlinkSync(join(repo, 'HANDOFF.md'))
    await vi.waitFor(() => expect(sender.sent.at(-1)?.handoff).toBeNull(), { timeout: ms(1000), interval: 20 })
  })

  it('stops sending after docs.close', async () => {
    await value('docs.open', { projectId: PROJECT_ID })
    expect(await value('docs.close', { projectId: PROJECT_ID })).toStrictEqual({ closed: true })
    expect(await value('docs.close', { projectId: PROJECT_ID })).toStrictEqual({ closed: false })
    expect(docsModule.docsHub.projects).toStrictEqual([])
  })
})

describe('the HANDOFF Node', () => {
  it('is created locked when HANDOFF.md exists, hidden when it goes, shown when it comes back', async () => {
    await value('docs.open', { projectId: PROJECT_ID })
    const [node] = handoffNodes()
    expect(handoffNodes()).toHaveLength(1)
    expect(node).toMatchObject({ kind: 'handoff', locked: true, hidden: false })

    await pastStartReads()
    unlinkSync(join(repo, 'HANDOFF.md'))
    await vi.waitFor(() => expect(handoffNodes()[0]?.hidden).toBe(true), { timeout: ms(1000), interval: 20 })
    writeFileSync(join(repo, 'HANDOFF.md'), HANDOFF)
    await vi.waitFor(() => expect(handoffNodes()[0]?.hidden).toBe(false), { timeout: ms(1000), interval: 20 })
    // The same Node all along: its place and size stay the user's.
    expect(handoffNodes().map((n) => n.id)).toStrictEqual([node!.id])
  })

  // macOS only (worfy-windows ticket 38): there the root renamed away and back gives one event
  // each time, named by the root's last name, and the same watch reports the root back. On Linux
  // a root that is gone is not followed (the header of DocsWatcher); on Windows it is waited for,
  // test/contract/docs-watch-root.test.ts.
  it.runIf(process.platform === 'darwin')('is hidden and marked while the Project root is renamed away, shown when it is back', async () => {
    await value('docs.open', { projectId: PROJECT_ID })
    const [node] = handoffNodes()
    await pastStartReads()

    const moved = join(scratch, 'moved')
    renameSync(repo, moved)
    await vi.waitFor(() => expect(handoffNodes()[0]).toMatchObject({ hidden: true, data: { missing: true } }), { timeout: ms(1000), interval: 20 })
    expect(sender.sent.at(-1)).toMatchObject({ handoff: null, adrs: [] })
    renameSync(moved, repo)
    await vi.waitFor(() => expect(handoffNodes()[0]).toMatchObject({ hidden: false, data: { missing: false } }), { timeout: ms(1000), interval: 20 })
    expect(sender.sent.at(-1)?.adrs.map((adr) => adr.number)).toStrictEqual(['0001', '0002'])
    expect(handoffNodes().map((n) => n.id)).toStrictEqual([node!.id])
  })

  it('is not created when the Project has no HANDOFF.md, and a Node the user hid stays hidden', async () => {
    unlinkSync(join(repo, 'HANDOFF.md'))
    await value('docs.open', { projectId: PROJECT_ID })
    expect(handoffNodes()).toStrictEqual([])

    await pastStartReads()
    writeFileSync(join(repo, 'HANDOFF.md'), HANDOFF)
    await vi.waitFor(() => expect(handoffNodes()).toHaveLength(1), { timeout: ms(1000), interval: 20 })
    const id = handoffNodes()[0]!.id
    layoutModule.layoutStore().apply(PROJECT_ID, { op: 'hide', id, hidden: true })
    writeFileSync(join(repo, 'HANDOFF.md'), `${HANDOFF}x\n`)
    await vi.waitFor(() => expect(sender.sent.length).toBeGreaterThan(1), { timeout: ms(1000), interval: 20 })
    expect(handoffNodes()[0]?.hidden).toBe(true)
  })

  it('takes a hide for the user\'s once someone showed the Node while HANDOFF.md was gone', async () => {
    await value('docs.open', { projectId: PROJECT_ID })
    const id = handoffNodes()[0]!.id
    const store = layoutModule.layoutStore()
    await pastStartReads()

    unlinkSync(join(repo, 'HANDOFF.md'))
    await vi.waitFor(() => expect(handoffNodes()[0]).toMatchObject({ hidden: true, data: { missing: true } }), { timeout: ms(1000), interval: 20 })
    // An agent shows it again through the canvas tools while the file is still gone.
    store.apply(PROJECT_ID, { op: 'hide', id, hidden: false })
    writeFileSync(join(repo, 'HANDOFF.md'), HANDOFF)
    await vi.waitFor(() => expect(handoffNodes()[0]?.data.missing).toBe(false), { timeout: ms(1000), interval: 20 })
    expect(handoffNodes()[0]?.hidden).toBe(false)

    // Now the user hides it; the next edit of HANDOFF.md leaves it hidden.
    store.apply(PROJECT_ID, { op: 'hide', id, hidden: true })
    const sent = sender.sent.length
    writeFileSync(join(repo, 'HANDOFF.md'), `${HANDOFF}y\n`)
    await vi.waitFor(() => expect(sender.sent.length).toBeGreaterThan(sent), { timeout: ms(1000), interval: 20 })
    expect(handoffNodes()[0]?.hidden).toBe(true)
  })

  it('is kept for the active Project by main itself once a window exists', async () => {
    expect(handoffNodes()).toStrictEqual([])
    for (const listener of electron.listeners.get('browser-window-created') ?? []) listener()
    await vi.waitFor(() => expect(handoffNodes()).toHaveLength(1), { timeout: ms(1000), interval: 20 })
  })

  it('cannot be removed', async () => {
    await value('docs.open', { projectId: PROJECT_ID })
    const id = handoffNodes()[0]!.id
    expect(() => layoutModule.layoutStore().apply(PROJECT_ID, { op: 'remove', id })).toThrow(/locked/)
  })
})

describe('a Silent Project (worfy-harness ticket 23)', () => {
  let folder: string

  /** Makes the Project Silent: stub bin/profile and bin/ticket name `folder` as its Workflow folder. */
  beforeEach(() => {
    folder = join(scratch, 'workflow-folder')
    mkdirSync(join(folder, 'docs', 'adr'), { recursive: true })
    writeFileSync(join(folder, 'HANDOFF.md'), '# HANDOFF of the Workflow folder\n')
    writeFileSync(join(folder, 'docs', 'adr', '0007-silent.md'), '# Тихий режим\n\nДата: 2026-10-09. Статус: принят.\n')
    const bin = join(scratch, 'claude-home', 'bin')
    mkdirSync(bin, { recursive: true })
    const json = { mode: 'silent', _resolved: { mode: 'silent', workflow_folder: folder, workspace: null, repos: [{ name: 'repo', path: repo }] } }
    // Links to the canned Harness script, the answer next to each: a new executable file per test
    // waits for the macOS check of new files, which times out under load (worfy-polish ticket 30).
    for (const [name, out] of [['profile', JSON.stringify(json)], ['ticket', `${join(folder, '.scratch')}\n`]] as const) {
      symlinkSync(CANNED, join(bin, name))
      writeFileSync(join(bin, `${name}.out`), out)
    }
  })

  it('lists and reads HANDOFF.md and the ADRs of the Workflow folder, not those of the repository', async () => {
    const state = await value<DocsState>('docs.open', { projectId: PROJECT_ID })
    expect(state.adrs.map((adr) => [adr.path, adr.title])).toStrictEqual([['docs/adr/0007-silent.md', 'Тихий режим']])
    expect(await value('docs.read', { projectId: PROJECT_ID, path: 'HANDOFF.md' })).toStrictEqual({ path: 'HANDOFF.md', text: '# HANDOFF of the Workflow folder\n' })
    expect(await value('docs.read', { projectId: PROJECT_ID, path: 'docs/adr/0007-silent.md' })).toMatchObject({ path: 'docs/adr/0007-silent.md' })
    // The repository's own ADR is not one of this Project's documents now.
    await refused({ projectId: PROJECT_ID, path: 'docs/adr/0001-clean-room.md' }, /does not exist/)
  })

  it('refuses paths outside the Workflow folder: the repository\'s HANDOFF.md by absolute path or by ../', async () => {
    await refused({ projectId: PROJECT_ID, path: join(repo, 'HANDOFF.md') }, /outside the Project/)
    await refused({ projectId: PROJECT_ID, path: '../repo/HANDOFF.md' }, /outside the Project/)
    await refused({ projectId: PROJECT_ID, path: join(outside, 'secret.md') }, /outside the Project/)
  })

  it('follows edits in the Workflow folder and writes nothing there or in the repository', async () => {
    const status = git(repo, 'status', '--porcelain')
    const before = { repo: snapshot(repo), folder: snapshot(folder) }
    const first = await value<DocsState>('docs.open', { projectId: PROJECT_ID })
    await pastStartReads()
    writeFileSync(join(folder, 'HANDOFF.md'), '# HANDOFF, edited\n')
    await vi.waitFor(
      () => {
        expect(sender.sent.length).toBeGreaterThan(0)
        expect(sender.sent.at(-1)?.handoff?.version).not.toBe(first.handoff?.version)
      },
      { timeout: ms(1000), interval: 20 },
    )
    expect(await value('docs.read', { projectId: PROJECT_ID, path: 'HANDOFF.md' })).toStrictEqual({ path: 'HANDOFF.md', text: '# HANDOFF, edited\n' })
    // An edit of the repository's HANDOFF.md is not this Project's.
    const count = sender.sent.length
    writeFileSync(join(repo, 'HANDOFF.md'), `${HANDOFF}\n- в репозитории\n`)
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(sender.sent).toHaveLength(count)
    writeFileSync(join(repo, 'HANDOFF.md'), HANDOFF)
    writeFileSync(join(folder, 'HANDOFF.md'), '# HANDOFF of the Workflow folder\n')
    await docsModule.docsHub.closeAll()
    expect(git(repo, 'status', '--porcelain')).toBe(status)
    expect(Object.keys(snapshot(folder)).sort()).toStrictEqual(Object.keys(before.folder).sort())
    expect(Object.keys(snapshot(repo)).sort()).toStrictEqual(Object.keys(before.repo).sort())
  })
})

describe('the ADR status label the Profile names (docs.adr_status_label)', () => {
  /** A Full Project whose stub bin/profile answers with `docs`; bin/ticket names `.scratch` of the repository. */
  function profileWith(docs: object | null): void {
    const bin = join(scratch, 'claude-home', 'bin')
    mkdirSync(bin, { recursive: true })
    const json = { mode: 'full', ...(docs ? { docs } : {}), _resolved: { mode: 'full', workflow_folder: repo, workspace: null, repos: [{ name: 'repo', path: repo }] } }
    for (const [name, out] of [['profile', JSON.stringify(json)], ['ticket', `${join(repo, '.scratch')}\n`]] as const) {
      symlinkSync(CANNED, join(bin, name))
      writeFileSync(join(bin, `${name}.out`), out)
    }
  }

  it('docs.open reads the status after the Profile\'s label', async () => {
    writeFileSync(join(repo, 'docs', 'adr', '0003-fr.md'), '# Décision\n\nDate : 2026-10-20. Statut : acceptée.\nStatus: not this one\n')
    profileWith({ adr_dir: 'docs/adr', adr_status_label: 'Statut' })
    const state = await value<DocsState>('docs.open', { projectId: PROJECT_ID })
    expect(state.adrs.find((adr) => adr.number === '0003')).toMatchObject({ title: 'Décision', status: 'acceptée' })
    // The Russian ADRs of the repository: their label is read for one more release whatever the Profile names.
    expect(state.adrs.find((adr) => adr.number === '0001')).toMatchObject({ status: 'принят' })
  })

  it('keeps the Profile\'s label on every read after an edit', async () => {
    const adr = join(repo, 'docs', 'adr', '0003-fr.md')
    writeFileSync(adr, '# Décision\n\nStatut : acceptée.\n')
    profileWith({ adr_status_label: 'Statut' })
    await value<DocsState>('docs.open', { projectId: PROJECT_ID })
    await pastStartReads()
    writeFileSync(adr, '# Décision révisée\n\nStatut : remplacée.\n')
    await vi.waitFor(() => expect(sender.sent.at(-1)?.adrs.find((each) => each.number === '0003')).toMatchObject({ title: 'Décision révisée', status: 'remplacée' }), { timeout: ms(1000), interval: 20 })
  })

  it.each(['active', 'held'] as const)('the documents main keeps for a %s Project are read with the Profile\'s label, and docs.open gets that state', async (kind) => {
    writeFileSync(join(repo, 'docs', 'adr', '0003-fr.md'), '# Décision\n\nStatut : acceptée.\n')
    profileWith({ adr_status_label: 'Statut' })
    if (kind === 'active') for (const listener of electron.listeners.get('browser-window-created') ?? []) listener()
    else {
      const { projectHolds } = await import('../../src/main/projects/holds')
      projectHolds().set({ id: 'linked', once: () => undefined, isDestroyed: () => false } as never, 'projects', PROJECT_ID)
    }
    await vi.waitFor(() => expect(docsModule.docsHub.projects).toStrictEqual([PROJECT_ID]), { timeout: ms(1000), interval: 20 })
    await pastStartReads()
    const state = await value<DocsState>('docs.open', { projectId: PROJECT_ID })
    expect(state.adrs.find((adr) => adr.number === '0003')).toMatchObject({ status: 'acceptée' })
    // main's own open had the label already: docs.open read nothing again, so it sent nothing.
    expect(sender.sent).toStrictEqual([])
  })

  it('DocsHub.open with another label reads the documents again with it', async () => {
    writeFileSync(join(repo, 'docs', 'adr', '0003-fr.md'), '# Décision\n\nStatut : acceptée.\nEtat : ouverte.\n')
    const { DocsHub } = await import('../../src/main/docs/watch')
    const hub = new DocsHub()
    const states: DocsState[] = []
    const subscriber = { id: 'test', send: (state: DocsState) => states.push(state) }
    try {
      const first = await hub.open('p', repo, subscriber, 'Statut')
      expect(first.adrs.find((adr) => adr.number === '0003')?.status).toBe('acceptée')
      const second = await hub.open('p', repo, { id: 'other', send: () => undefined }, 'Etat')
      expect(second.adrs.find((adr) => adr.number === '0003')?.status).toBe('ouverte')
      // The subscribers already there get the state of the new label too.
      expect(states.at(-1)?.adrs.find((adr) => adr.number === '0003')?.status).toBe('ouverte')
    } finally {
      await hub.closeAll()
    }
  })

  it('docs.open reads `Status:` when the Profile names no label', async () => {
    writeFileSync(join(repo, 'docs', 'adr', '0003-en.md'), '# Decision\n\nDate: 2026-10-20. Status: accepted.\n')
    profileWith(null)
    const state = await value<DocsState>('docs.open', { projectId: PROJECT_ID })
    expect(state.adrs.find((adr) => adr.number === '0003')).toMatchObject({ status: 'accepted' })
  })
})

describe('read-only', () => {
  it('leaves the repository exactly as it was after watching, reading and following edits', async () => {
    // `git status` may refresh .git/index itself, so it runs before the snapshot, not after.
    const status = git(repo, 'status', '--porcelain')
    const before = snapshot(repo)
    const state = await value<DocsState>('docs.open', { projectId: PROJECT_ID })
    for (const adr of state.adrs) await value('docs.read', { projectId: PROJECT_ID, path: adr.path })
    await value('docs.read', { projectId: PROJECT_ID, path: 'HANDOFF.md' })
    await docsModule.docsHub.closeAll()
    expect(snapshot(repo)).toStrictEqual(before)
    expect(git(repo, 'status', '--porcelain')).toBe(status)
    expect(status).toBe('')
  })
})

describe('the layout used by the Node', () => {
  it('places a new HANDOFF Node top-left when that spot is free, otherwise under every Node', () => {
    const node = (x: number, y: number, w: number, h: number) => ({ id: `${x}`, kind: 'note', x, y, w, h, hidden: false, locked: false, pinned: false, tags: [], data: {} })
    expect(docsModule.handoffPlace([])).toStrictEqual({ x: 40, y: 40 })
    expect(docsModule.handoffPlace([node(1000, 0, 100, 100)])).toStrictEqual({ x: 40, y: 40 })
    // The Orchestrator in the top-left spot: the HANDOFF Node goes under it.
    expect(docsModule.handoffPlace([node(40, 40, 360, 200), node(500, -100, 100, 100)])).toStrictEqual({ x: 40, y: 280 })
    // An Epic frame's saved offset is not a place on the plane.
    expect(docsModule.handoffPlace([{ ...node(40, 40, 1, 1), kind: 'epic-frame' }])).toStrictEqual({ x: 40, y: 40 })
  })

  it('leaves a LayoutState untouched when HANDOFF.md exists and the Node is there', async () => {
    await value('docs.open', { projectId: PROJECT_ID })
    const before: LayoutState = layoutModule.layoutStore().get(PROJECT_ID)
    docsModule.syncHandoffNode(PROJECT_ID, true)
    expect(layoutModule.layoutStore().get(PROJECT_ID).revision).toBe(before.revision)
  })
})

describe('parseAdr', () => {
  it('takes the number from the file name, the first H1 as title and the status without its dot', async () => {
    const { parseAdr } = await import('../../src/main/docs/watch')
    expect(parseAdr('0007-x.md', '# Окружение запуска\n\nДата: 2026-10-05. Статус: принят.\n')).toStrictEqual({ number: '0007', title: 'Окружение запуска', status: 'принят' })
    expect(parseAdr('0010-y.md', 'Intro\n\n# Title ##\nStatus: superseded by 0011\n')).toStrictEqual({ number: '0010', title: 'Title', status: 'superseded by 0011' })
    // No heading and no status: the file name stands for the title.
    expect(parseAdr('0011-z.md', '## Only a subheading\n\ntext\n')).toStrictEqual({ number: '0011', title: '0011-z.md', status: null })
    expect(() => parseAdr('README.md', '# x')).toThrow(/not an ADR/)
  })

  it('takes the status after the label it is given, as written, and the English one by default', async () => {
    const { parseAdr } = await import('../../src/main/docs/watch')
    expect(parseAdr('0012-a.md', '# A\n\nStatut : acceptée.\nStatus: no\n', 'Statut')).toMatchObject({ status: 'acceptée' })
    expect(parseAdr('0012-a.md', '# A\n\nStatus: no\n', 'Statut')).toMatchObject({ status: null })
    // The label's characters are taken as they are, not as a pattern.
    expect(parseAdr('0012-a.md', '# A\n\nState (now): open.\n', 'State (now)')).toMatchObject({ status: 'open' })
    expect(parseAdr('0012-a.md', '# A\n\nState now: open.\n', 'State (now)')).toMatchObject({ status: null })
    expect(parseAdr('0013-b.md', '# B\n\nDate: 2026-10-20. Status: accepted.\n')).toMatchObject({ status: 'accepted' })
  })
})
