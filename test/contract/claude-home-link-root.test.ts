// The root a Linked machine names for the Claude home (worfy-link ticket 32). Claude Code names a
// Session's folder after the cwd with every character outside [A-Za-z0-9] turned into `-`, so a
// missing `<Project>/evil` and the folder `<Project>-evil` beside the Project share one name. Two
// checks keep that folder's Sessions from a Linked machine: the root of a remote call must exist
// and be a Project root or one of its worktrees (src/main/link/caller.ts, projectRootOf), and a
// transcript in the folder named exactly like a root is kept only when its cwd lies inside the
// roots (src/main/claude-home/registry.ts, dirMatch).
//
// Everything lives in a temporary folder: the Claude home, the Projects and the folder beside them.
// git is never run: the worktrees come from a stand-in lister.
import { appendFile, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClaudeHomeRegistry, projectDirName, type ClaudeHomeChange } from '../../src/main/claude-home/registry'
import type { Client } from '../../src/main/clients'
import { bindingsHandlers } from '../../src/main/ipc/bindings'
import { ClaudeHomeSubscriptions, claudeHomeHandlers } from '../../src/main/ipc/claude-home'
import { appUrlMatcher, registerIpc, type IpcMainLike } from '../../src/main/ipc/index'
import { NodeSessions } from '../../src/main/agent/node-sessions'
import { SessionSettingsStore } from '../../src/main/agent/session-settings'
import { sessionsHandlers } from '../../src/main/ipc/sessions'
import type { BindingStore } from '../../src/main/layout/bindings'
import { LayoutStore } from '../../src/main/layout/store'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { APP_URL, INDEX_HTML } from '../app-url'
import { removeTestTree } from '../remove'
import { ms } from '../time-scale'

const EVIL = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const OWN = '0aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ROOT = '1bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const SUB = '2ccccccc-cccc-4ccc-8ccc-cccccccccccc'
const WORKTREE = '3ddddddd-dddd-4ddd-8ddd-dddddddddddd'
const SECRET = 'a prompt of the folder beside the Project'

const temps: string[] = []
const closers: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const close of closers.splice(0)) await close()
  for (const dir of temps.splice(0)) removeTestTree(dir)
})

const userLine = (text: string, cwd: string, uuid: string): string =>
  JSON.stringify({ type: 'user', uuid, timestamp: '2026-06-01T00:00:00.000Z', cwd, gitBranch: 'main', isSidechain: false, message: { role: 'user', content: text } })

/**
 * Project `<dir>/p/A` with a subfolder `sub` and a worktree under .claude/worktrees/w; the folder
 * `<dir>/p/A-evil` beside it, outside every Project, with a Session. With `evilWorktree`,
 * `<dir>/p/A/evil` exists and is a worktree of A too: the name of its Claude home folder is that of
 * `<dir>/p/A-evil`.
 */
async function world(options: { evilWorktree?: boolean } = {}) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'worfy-link-root-')))
  temps.push(dir)
  const project = join(dir, 'p', 'A')
  const beside = join(dir, 'p', 'A-evil')
  const missing = join(project, 'evil')
  const sub = join(project, 'sub')
  const worktree = join(project, '.claude', 'worktrees', 'w')
  for (const folder of [project, beside, sub, worktree]) await mkdir(folder, { recursive: true })
  if (options.evilWorktree) await mkdir(missing)
  const home = join(dir, 'claude')
  const write = async (cwd: string, sessionId: string, text: string) => {
    const folder = join(home, 'projects', projectDirName(cwd))
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, `${sessionId}.jsonl`), `${userLine(text, cwd, `${sessionId}-u`)}\n`)
    return join(folder, `${sessionId}.jsonl`)
  }
  expect(projectDirName(missing)).toBe(projectDirName(beside))
  const evilTranscript = await write(beside, EVIL, SECRET)
  await write(project, ROOT, 'a prompt in the root')
  await write(sub, SUB, 'a prompt in a subfolder')
  await write(worktree, WORKTREE, 'a prompt in a worktree')
  const ownTranscript = options.evilWorktree ? await write(missing, OWN, 'a prompt in the worktree evil') : undefined
  await mkdir(join(home, 'sessions'), { recursive: true })
  const worktrees = options.evilWorktree ? [project, worktree, missing] : [project, worktree]
  const registry = new ClaudeHomeRegistry({ home, listWorktrees: async () => worktrees, isAlive: async () => false })
  const projects = () => [{ path: project }]
  const subscriptions = new ClaudeHomeSubscriptions(registry, new Set())
  closers.push(() => subscriptions.closeAll())
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
  const ipc: IpcMainLike = { handle: (channel, listener) => void handlers.set(channel, listener) }
  const noBindings = () => ({}) as BindingStore
  await registerIpc(ipc, {
    modules: {
      './claude-home.ts': async () => claudeHomeHandlers(registry, subscriptions, undefined, projects),
      './bindings.ts': async () => bindingsHandlers(noBindings, () => registry, undefined, projects),
    },
    isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }),
  })
  const sent: { to: string | number; channel: string; payload: unknown }[] = []
  const client = (id: string | number): Client =>
    ({ id, send: (channel: string, payload: unknown) => void sent.push({ to: id, channel, payload }), isDestroyed: () => false, once: () => undefined }) as unknown as Client
  /** A client of a link connection has a string id (src/main/link/caller.ts); a window a number. */
  const linked = client('link:machine-b/1')
  const window = client(7)
  const call = async (channel: string, input: unknown, sender: Client = linked): Promise<IpcResult<unknown>> => {
    const listener = handlers.get(IPC_CHANNEL_PREFIX + channel)
    if (!listener) throw new Error(`no handler for ${channel}`)
    const event = { senderFrame: { url: APP_URL }, sender } as unknown as IpcMainInvokeEvent
    return (await listener(event, input)) as IpcResult<unknown>
  }
  return { project, beside, missing, sub, worktree, home, registry, call, window, linked, sent, evilTranscript, ownTranscript }
}

/** Every channel that answers with Sessions or a transcript of `root`, asked about the Session EVIL. */
const asked = (root: string) =>
  [
    ['claudeHome.sessions', { projectRoot: root }],
    ['claudeHome.live', { projectRoot: root }],
    ['claudeHome.transcript', { projectRoot: root, sessionId: EVIL }],
    ['claudeHome.subagents', { projectRoot: root, sessionId: EVIL }],
    ['claudeHome.subagentTranscript', { projectRoot: root, sessionId: EVIL, agentId: 'a1' }],
    ['claudeHome.search', { projectRoot: root, query: 'beside the Project' }],
    ['claudeHome.transcriptFind', { projectRoot: root, sessionId: EVIL, query: 'beside the Project', before: 1_000_000 }],
    ['bindings.signals', { projectRoot: root, sessionId: EVIL }],
  ] as const

/** Whether an answer gives away the Session EVIL: its id, its prompt, or `found: true` for it. */
const leaks = (result: IpcResult<unknown>): boolean => {
  if (!result.ok) return false
  const text = JSON.stringify(result.value)
  return text.includes(EVIL) || text.includes(SECRET) || (result.value as { found?: unknown }).found === true
}

const notRootRefusal = /is neither the root of a Project of this Machine nor one of its worktrees/

describe('a Linked machine names the root of a Project or of a worktree for the Claude home', () => {
  it('a missing <Project>/evil gives no Session of the folder <Project>-evil beside it', async () => {
    const { missing, call } = await world()
    for (const [channel, input] of asked(missing)) expect(leaks(await call(channel, input)), channel).toBe(false)
  })

  it('a missing folder or a plain folder inside the Project is refused; the root and a worktree answer; outside is refused as before', async () => {
    const { project, beside, missing, sub, worktree, call } = await world()
    for (const root of [missing, sub, join(project, 'sub', '..', 'sub')]) {
      for (const channel of ['claudeHome.live', 'bindings.signals'] as const) {
        const result = await call(channel, { projectRoot: root, sessionId: ROOT })
        expect(result.ok, `${channel} ${root}`).toBe(false)
        expect(!result.ok && result.error, `${channel} ${root}`).toMatch(notRootRefusal)
      }
    }
    expect(await call('claudeHome.live', { projectRoot: beside })).toMatchObject({ ok: false, error: expect.stringMatching(/is outside the Projects of this Machine/) })

    const sessions = await call('claudeHome.sessions', { projectRoot: project })
    expect(sessions.ok && (sessions.value as { history: { sessionId: string }[] }).history.map((entry) => entry.sessionId).sort()).toEqual([ROOT, SUB, WORKTREE].sort())
    const fromWorktree = await call('claudeHome.sessions', { projectRoot: worktree })
    expect(fromWorktree.ok && (fromWorktree.value as { history: { sessionId: string }[] }).history.map((entry) => entry.sessionId).sort()).toEqual([ROOT, SUB, WORKTREE].sort())
    expect(await call('bindings.signals', { projectRoot: project, sessionId: SUB })).toMatchObject({ ok: true, value: { found: true } })
  })

  it('a window of this Machine is not checked: a Session started in a subfolder is listed and read, any root answers', async () => {
    const { project, missing, sub, call, window } = await world()
    const sessions = await call('claudeHome.sessions', { projectRoot: project }, window)
    expect(sessions.ok && (sessions.value as { history: { sessionId: string }[] }).history.map((entry) => entry.sessionId).sort()).toEqual([ROOT, SUB, WORKTREE].sort())
    expect(await call('claudeHome.transcript', { projectRoot: project, sessionId: SUB }, window)).toMatchObject({ ok: true, value: { found: true } })
    expect(await call('bindings.signals', { projectRoot: project, sessionId: SUB }, window)).toMatchObject({ ok: true, value: { found: true } })
    for (const root of [missing, sub]) expect(await call('claudeHome.live', { projectRoot: root }, window), root).toMatchObject({ ok: true })
  })
})

describe('the Claude home folder named exactly like a root is shared with a folder outside the roots', () => {
  it('a worktree <Project>/evil gets its own Sessions and none of <Project>-evil, from a Linked machine and from a window', async () => {
    const { missing, call, window } = await world({ evilWorktree: true })
    for (const sender of [undefined, window]) {
      for (const [channel, input] of asked(missing)) expect(leaks(await call(channel, input, sender)), `${channel} ${sender === undefined ? 'linked' : 'window'}`).toBe(false)
      const sessions = await call('claudeHome.sessions', { projectRoot: missing }, sender)
      expect(sessions.ok && (sessions.value as { history: { sessionId: string }[] }).history.map((entry) => entry.sessionId)).toContain(OWN)
      expect(await call('claudeHome.transcript', { projectRoot: missing, sessionId: OWN }, sender)).toMatchObject({ ok: true, value: { found: true } })
    }
  })

  it('the watcher of the worktree <Project>/evil reports its own transcripts, not those of <Project>-evil', async () => {
    const { missing, registry, evilTranscript, ownTranscript } = await world({ evilWorktree: true })
    const changes: ClaudeHomeChange[] = []
    const watch = await registry.watch(missing, (change) => changes.push(change), { debounceMs: 20 })
    closers.push(() => watch.close())
    await watch.ready
    await appendFile(evilTranscript, `${userLine('more', '/elsewhere', 'evil-2')}\n`)
    await appendFile(ownTranscript ?? '', `${userLine('more', missing, 'own-2')}\n`)
    await vi.waitFor(() => expect(changes.flatMap((change) => change.transcripts)).toContain(OWN), { timeout: ms(3000), interval: 20 })
    // The change of EVIL came first: had it been reported, it would be in by now.
    await new Promise((done) => setTimeout(done, 200))
    expect(changes.flatMap((change) => change.transcripts)).not.toContain(EVIL)
  })
})

/**
 * A Claude home and the IPC of claudeHome and bindings over it, for Projects laid out by the test.
 * `worktreesOf` stands for `git worktree list` of a root.
 */
async function bench(dir: string, projects: readonly string[], worktreesOf: (root: string) => readonly string[] = () => []) {
  const home = join(dir, 'claude')
  await mkdir(join(home, 'sessions'), { recursive: true })
  const write = async (cwd: string | undefined, sessionId: string, lines: readonly string[], folderOf = cwd) => {
    const folder = join(home, 'projects', projectDirName(folderOf ?? ''))
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, `${sessionId}.jsonl`), `${lines.join('\n')}\n`)
    return join(folder, `${sessionId}.jsonl`)
  }
  const registry = new ClaudeHomeRegistry({ home, listWorktrees: async (root) => [...worktreesOf(root)], isAlive: async () => true })
  const subscriptions = new ClaudeHomeSubscriptions(registry, new Set())
  closers.push(() => subscriptions.closeAll())
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
  const ipc: IpcMainLike = { handle: (channel, listener) => void handlers.set(channel, listener) }
  const list = () => projects.map((path) => ({ path }))
  await registerIpc(ipc, {
    modules: {
      './claude-home.ts': async () => claudeHomeHandlers(registry, subscriptions, undefined, list),
      './bindings.ts': async () => bindingsHandlers(() => ({}) as BindingStore, () => registry, undefined, list),
    },
    isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }),
  })
  const sent: { to: string | number; channel: string; payload: unknown }[] = []
  const client = (id: string | number): Client =>
    ({ id, send: (channel: string, payload: unknown) => void sent.push({ to: id, channel, payload }), isDestroyed: () => false, once: () => undefined }) as unknown as Client
  const linked = client('link:machine-b/1')
  const window = client(7)
  const call = async (channel: string, input: unknown, sender: Client): Promise<IpcResult<unknown>> => {
    const listener = handlers.get(IPC_CHANNEL_PREFIX + channel)
    if (!listener) throw new Error(`no handler for ${channel}`)
    const event = { senderFrame: { url: APP_URL }, sender } as unknown as IpcMainInvokeEvent
    return (await listener(event, input)) as IpcResult<unknown>
  }
  const history = async (root: string, sender: Client): Promise<string[]> => {
    const result = await call('claudeHome.sessions', { projectRoot: root }, sender)
    if (!result.ok) throw new Error(result.error)
    return (result.value as { history: { sessionId: string }[] }).history.map((entry) => entry.sessionId).sort()
  }
  const found = async (root: string, sessionId: string, sender: Client): Promise<boolean> => {
    const transcript = await call('claudeHome.transcript', { projectRoot: root, sessionId }, sender)
    return transcript.ok && (transcript.value as { found: boolean }).found
  }
  return { home, registry, write, call, history, found, linked, window, sent }
}

const enqueue = (sessionId: string, content: string): string =>
  JSON.stringify({ type: 'queue-operation', operation: 'enqueue', timestamp: '2026-01-10T09:00:07.000Z', sessionId, content })
const dequeue = (sessionId: string): string => JSON.stringify({ type: 'queue-operation', operation: 'dequeue', timestamp: '2026-01-10T09:00:14.000Z', sessionId })

describe('no folder is the Project\'s by its name alone (worfy-link ticket 32, round 2)', () => {
  it('a link to the root, a worktree as root and a non-ASCII root get no Session of the look-alike worktree folders outside, from a Linked machine or a window', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'worfy-link-root-')))
    temps.push(dir)
    const project = join(dir, 'p', 'A')
    const wt = join(project, 'wt')
    const link = join(project, 'link')
    const umlaut = join(dir, 'p', 'Ä')
    await mkdir(wt, { recursive: true })
    await mkdir(umlaut, { recursive: true })
    await symlink(project, link, process.platform === 'win32' ? 'junction' : 'dir')
    const { write, history, found, call, linked, window } = await bench(dir, [project, umlaut], (root) => (root === project || root === wt ? [project, wt] : []))
    // Each root's `<name>--claude-worktrees-` prefix is also that of worktrees of a folder outside.
    const outside = [
      { root: link, cwd: join(dir, 'p', 'A-link', '.claude', 'worktrees', 'x'), id: 'a1111111-1111-4111-8111-111111111111' },
      { root: wt, cwd: join(dir, 'p', 'A-wt', '.claude', 'worktrees', 'x'), id: 'a2222222-2222-4222-8222-222222222222' },
      { root: umlaut, cwd: join(dir, 'p', 'Ö', '.claude', 'worktrees', 'x'), id: 'a3333333-3333-4333-8333-333333333333' },
    ]
    for (const { root, cwd, id } of outside) {
      expect(projectDirName(cwd).startsWith(`${projectDirName(root)}--claude-worktrees-`)).toBe(true)
      await write(cwd, id, [userLine(SECRET, cwd, `${id}-u`)])
    }
    // A removed worktree of the Project keeps its history: its cwd lies inside the root.
    const removed = join(project, '.claude', 'worktrees', 'gone')
    const REMOVED = 'a4444444-4444-4444-8444-444444444444'
    await write(removed, REMOVED, [userLine('a prompt in a removed worktree', removed, `${REMOVED}-u`)])

    for (const sender of [linked, window]) {
      for (const { root, id } of outside) {
        const label = `${root} ${sender === linked ? 'linked' : 'window'}`
        expect(await history(root, sender), label).not.toContain(id)
        expect(await found(root, id, sender), label).toBe(false)
        expect(leaks(await call('bindings.signals', { projectRoot: root, sessionId: id }, sender)), label).toBe(false)
      }
      expect(await history(project, sender)).toEqual([REMOVED])
      expect(await found(project, REMOVED, sender)).toBe(true)
    }
  })

  it('a cwd in NFD under a root in NFC is inside the root', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'worfy-link-root-')))
    temps.push(dir)
    const project = join(dir, 'p', 'Café'.normalize('NFC'))
    await mkdir(project, { recursive: true })
    const { write, history, linked, window } = await bench(dir, [project])
    const id = 'c1111111-1111-4111-8111-111111111111'
    const cwd = project.normalize('NFD')
    expect(cwd).not.toBe(project)
    await write(cwd, id, [userLine('a prompt in the café', cwd, `${id}-u`)])
    for (const sender of [linked, window]) expect(await history(project, sender)).toEqual([id])
  })
})

describe('the cwd of a transcript is the first record that names one', () => {
  /** Project /p/A with transcripts whose first records name no cwd. */
  async function prompts() {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'worfy-link-root-')))
    temps.push(dir)
    const project = join(dir, 'p', 'A')
    await mkdir(project, { recursive: true })
    const it = await bench(dir, [project])
    const LONG = 'd1111111-1111-4111-8111-111111111111'
    const HUGE = 'd2222222-2222-4222-8222-222222222222'
    const NONE = 'd3333333-3333-4333-8333-333333333333'
    // As Claude desktop writes it: the enqueue record carries the whole prompt and no cwd.
    const long = 'x'.repeat(40 * 1024)
    await it.write(project, LONG, [enqueue(LONG, long), dequeue(LONG), userLine(long, project, `${LONG}-u`)])
    const huge = 'data:image/png;base64,' + 'A'.repeat(1200 * 1024)
    await it.write(project, HUGE, [enqueue(HUGE, huge), dequeue(HUGE), userLine(huge, project, `${HUGE}-u`)])
    // No record names a cwd yet: a Session whose first prompt is still queued.
    const none = await it.write(undefined, NONE, [enqueue(NONE, long), dequeue(NONE)], project)
    return { ...it, project, LONG, HUGE, NONE, none }
  }

  it('a 40 KB queued prompt or a screenshot over 1 MB before the first cwd: the Session is the Project\'s, for a window and a Linked machine', async () => {
    const { project, history, found, linked, window, LONG, HUGE, NONE } = await prompts()
    expect(await history(project, window)).toEqual([LONG, HUGE, NONE].sort())
    expect(await history(project, linked)).toEqual([LONG, HUGE].sort())
    for (const sender of [linked, window]) for (const id of [LONG, HUGE]) expect(await found(project, id, sender), id).toBe(true)
  })

  it('no cwd known: a window lists, reads and watches the Session and the Orchestrator finds its transcript; a Linked machine gets none of it', async () => {
    const { home, project, registry, history, found, call, linked, window, NONE, none } = await prompts()
    await writeFile(join(home, 'sessions', '41001.json'), JSON.stringify({ pid: 41001, sessionId: NONE, cwd: project, status: 'busy' }))
    expect(await history(project, window)).toContain(NONE)
    expect(await found(project, NONE, window)).toBe(true)
    // The Orchestrator resumes its saved Session by this lookup, as a caller of this Machine (src/main/agent/app-orchestrators.ts).
    expect(await registry.transcriptPath({ path: project, local: true }, NONE)).toBe(none)
    // A root without `local` is judged strictly: a caller that forgets to say gets nothing unknown.
    expect(await registry.transcriptPath(project, NONE)).toBeNull()
    expect(await call('claudeHome.live', { projectRoot: project }, window)).toMatchObject({ ok: true, value: { live: [{ sessionId: NONE }] } })
    expect(await history(project, linked)).not.toContain(NONE)
    expect(await found(project, NONE, linked)).toBe(false)
    // bindings.signals goes by the same rule: it hands the registry the checked root of a Linked machine.
    expect(await call('bindings.signals', { projectRoot: project, sessionId: NONE }, window)).toMatchObject({ ok: true, value: { found: true } })
    expect(await call('bindings.signals', { projectRoot: project, sessionId: NONE }, linked)).toMatchObject({ ok: true, value: { found: false } })

    const local: ClaudeHomeChange[] = []
    const remote: ClaudeHomeChange[] = []
    const watches = [await registry.watch({ path: project, local: true }, (change) => local.push(change), { debounceMs: 20 }), await registry.watch({ path: project, gitAt: project }, (change) => remote.push(change), { debounceMs: 20 })]
    for (const watch of watches) closers.push(() => watch.close())
    await Promise.all(watches.map((watch) => watch.ready))
    await appendFile(none, `${dequeue(NONE)}\n`)
    await vi.waitFor(() => expect(local.flatMap((change) => change.transcripts)).toContain(NONE), { timeout: ms(3000), interval: 20 })
    await new Promise((done) => setTimeout(done, 200))
    expect(remote.flatMap((change) => change.transcripts)).not.toContain(NONE)
  })
})

describe('a transcript removed before it ever changed', () => {
  it('is judged by the cwd the list read: <Project>-evil reaches no subscriber, the worktree\'s own does', async () => {
    const { missing, call, linked, window, sent, evilTranscript, ownTranscript } = await world({ evilWorktree: true })
    for (const sender of [linked, window]) expect(await call('claudeHome.sessions', { projectRoot: missing }, sender)).toMatchObject({ ok: true })
    await rm(evilTranscript)
    await rm(ownTranscript ?? '')
    const reported = (to: string | number) =>
      sent.filter((entry) => entry.to === to && entry.channel === 'worfy:claudeHome.changed').flatMap((entry) => (entry.payload as { transcripts: string[] }).transcripts)
    await vi.waitFor(() => {
      for (const sender of [linked, window]) expect(reported(sender.id)).toContain(OWN)
    }, { timeout: ms(3000), interval: 20 })
    await new Promise((done) => setTimeout(done, 200))
    for (const sender of [linked, window]) expect(reported(sender.id)).not.toContain(EVIL)
  })
})

const summary = (text: string): string => JSON.stringify({ type: 'summary', summary: text, leafUuid: 'x' })

describe('a folder that is only named like a folder inside the Project (round 3)', () => {
  it('a window of /p/A gets no Session of the Project /p/A-evil whose cwd is unknown', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'worfy-link-root-')))
    temps.push(dir)
    const project = join(dir, 'p', 'A')
    const other = join(dir, 'p', 'A-evil')
    for (const folder of [project, other]) await mkdir(folder, { recursive: true })
    const { write, history, found, window, registry } = await bench(dir, [project, other])
    const E = 'e1111111-1111-4111-8111-111111111111'
    await write(undefined, E, [summary('a summary of the other Project')], other)
    expect(await history(project, window)).not.toContain(E)
    expect(await found(project, E, window)).toBe(false)
    expect(await registry.transcriptPath({ path: project, local: true }, E)).toBeNull()
    // The other Project's own window still has it: its folder is named exactly like its root.
    expect(await history(other, window)).toContain(E)
  })
  it('the watcher of /p/A reports its own transcript whose cwd is unknown to a window, and none of /p/A-evil', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'worfy-link-root-')))
    temps.push(dir)
    const project = join(dir, 'p', 'A')
    const other = join(dir, 'p', 'A-evil')
    for (const folder of [project, other]) await mkdir(folder, { recursive: true })
    const { write, registry } = await bench(dir, [project, other])
    const N = 'e2222222-2222-4222-8222-222222222222'
    const E = 'e1111111-1111-4111-8111-111111111111'
    const own = await write(undefined, N, [summary('a summary of A')], project)
    const foreign = await write(undefined, E, [summary('a summary of the other Project')], other)
    const local: ClaudeHomeChange[] = []
    const remote: ClaudeHomeChange[] = []
    const watches = [await registry.watch({ path: project, local: true }, (change) => local.push(change), { debounceMs: 20 }), await registry.watch({ path: project, gitAt: project }, (change) => remote.push(change), { debounceMs: 20 })]
    for (const watch of watches) closers.push(() => watch.close())
    await Promise.all(watches.map((watch) => watch.ready))
    await appendFile(own, `${summary('more')}\n`)
    await appendFile(foreign, `${summary('more')}\n`)
    // The folder of /p/A is named exactly like its root, that of /p/A-evil only like a folder inside it.
    await vi.waitFor(() => expect(local.flatMap((change) => change.transcripts)).toContain(N), { timeout: ms(3000), interval: 20 })
    await new Promise((done) => setTimeout(done, 300))
    expect(local.flatMap((change) => change.transcripts)).not.toContain(E)
    expect(remote.flatMap((change) => change.transcripts)).not.toContain(N)
    expect(remote.flatMap((change) => change.transcripts)).not.toContain(E)
  })
})

describe('sessions.resumable from a Linked machine (round 3)', () => {
  it('a Session whose cwd is unknown is resumable for a window, not for a Linked machine', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'worfy-link-root-')))
    temps.push(dir)
    const project = join(dir, 'p', 'A')
    await mkdir(project, { recursive: true })
    const { write, registry, linked, window } = await bench(dir, [project])
    const NONE = 'd3333333-3333-4333-8333-333333333333'
    await write(undefined, NONE, [enqueue(NONE, 'a queued prompt'), dequeue(NONE)], project)
    const nodeSessions = new NodeSessions({
      layout: new LayoutStore((projectId) => join(dir, 'data', projectId), { delayMs: 0 }),
      projectPath: () => project,
      registry: {
        start: () => {
          throw new Error('no Session starts here')
        },
        list: () => [],
      },
      settings: new SessionSettingsStore((projectId) => join(dir, 'data', projectId)),
      claude: (root) => registry.sessions(root),
      isDirectory: async () => true,
      broadcast: () => undefined,
      publish: () => undefined,
    })
    const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
    await registerIpc({ handle: (channel, listener) => void handlers.set(channel, listener) }, { modules: { './sessions.ts': async () => sessionsHandlers(() => nodeSessions) }, isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }) })
    const ask = async (sender: Client) =>
      (await handlers.get(`${IPC_CHANNEL_PREFIX}sessions.resumable`)?.({ senderFrame: { url: APP_URL }, sender } as unknown as IpcMainInvokeEvent, { projectId: 'p-0a1b2c3d', sessionIds: [NONE] })) as IpcResult<{ verdicts: Record<string, { resumable: boolean }> }>
    expect(await ask(window)).toMatchObject({ ok: true, value: { verdicts: { [NONE]: { resumable: true } } } })
    expect(await ask(linked)).toMatchObject({ ok: true, value: { verdicts: { [NONE]: { resumable: false, reason: 'unknown' } } } })
  })
})

describe('the watcher scans on from where it stopped (round 3)', () => {
  async function single() {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'worfy-link-root-')))
    temps.push(dir)
    const project = join(dir, 'p', 'A')
    await mkdir(project, { recursive: true })
    const it = await bench(dir, [project])
    const id = 'f1111111-1111-4111-8111-111111111111'
    const changes: ClaudeHomeChange[] = []
    const watchOf = async (path: string) => {
      const watch = await it.registry.watch({ path: project, gitAt: project }, (change) => changes.push(change), { debounceMs: 20 })
      closers.push(() => watch.close())
      await watch.ready
      return path
    }
    const reported = () => changes.flatMap((change) => change.transcripts)
    const settle = () => new Promise((done) => setTimeout(done, 400))
    return { ...it, project, id, watchOf, reported, settle }
  }

  it('a line with the cwd written in two parts across the 256 KB chunk boundary is read whole', async () => {
    const { write, project, id, watchOf, reported, settle } = await single()
    const path = await watchOf(await write(undefined, id, [enqueue(id, 'x'.repeat(256 * 1024 - 200))], project))
    await appendFile(path, `${enqueue(id, 'y')}\n`)
    await settle()
    expect(reported()).not.toContain(id)
    const line = userLine('hello '.repeat(100), project, 'u')
    await appendFile(path, line.slice(0, 300))
    await settle()
    expect(reported()).not.toContain(id)
    await appendFile(path, `${line.slice(300)}\n`)
    await vi.waitFor(() => expect(reported()).toContain(id), { timeout: ms(3000), interval: 20 })
  })

  it('a file rewritten shorter than where the last scan stopped is scanned from its start again', async () => {
    const { write, project, id, watchOf, reported, settle } = await single()
    const path = await watchOf(await write(undefined, id, [enqueue(id, 'x'.repeat(300 * 1024))], project))
    await appendFile(path, `${enqueue(id, 'y')}\n`)
    await settle()
    expect(reported()).not.toContain(id)
    await writeFile(path, `${userLine('a prompt', project, 'u')}\n`)
    await vi.waitFor(() => expect(reported()).toContain(id), { timeout: ms(3000), interval: 20 })
  })

  it('a file emptied and written again 15 ms later is reported, though chokidar reports only the emptying', async () => {
    const { write, project, id, watchOf, reported, settle } = await single()
    const path = await watchOf(await write(undefined, id, [enqueue(id, 'x')], project))
    await appendFile(path, `${enqueue(id, 'y')}\n`)
    await settle()
    expect(reported()).not.toContain(id)
    // On Linux chokidar 5 drops a change of a path within 50 ms of the one it reported.
    await writeFile(path, '')
    await new Promise((done) => setTimeout(done, 15))
    await appendFile(path, `${userLine('a prompt', project, 'u')}\n`)
    await vi.waitFor(() => expect(reported()).toContain(id), { timeout: ms(3000), interval: 20 })
  })
})
