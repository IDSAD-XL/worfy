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
import { appendFile, mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClaudeHomeRegistry, projectDirName, type ClaudeHomeChange } from '../../src/main/claude-home/registry'
import type { Client } from '../../src/main/clients'
import { bindingsHandlers } from '../../src/main/ipc/bindings'
import { ClaudeHomeSubscriptions, claudeHomeHandlers } from '../../src/main/ipc/claude-home'
import { appUrlMatcher, registerIpc, type IpcMainLike } from '../../src/main/ipc/index'
import type { BindingStore } from '../../src/main/layout/bindings'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { APP_URL, INDEX_HTML } from '../app-url'
import { removeTestTree } from '../remove'

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
  const client = (id: string | number): Client => ({ id, send: () => undefined, isDestroyed: () => false, once: () => undefined }) as unknown as Client
  /** A client of a link connection has a string id (src/main/link/caller.ts); a window a number. */
  const linked = client('link:machine-b/1')
  const window = client(7)
  const call = async (channel: string, input: unknown, sender: Client = linked): Promise<IpcResult<unknown>> => {
    const listener = handlers.get(IPC_CHANNEL_PREFIX + channel)
    if (!listener) throw new Error(`no handler for ${channel}`)
    const event = { senderFrame: { url: APP_URL }, sender } as unknown as IpcMainInvokeEvent
    return (await listener(event, input)) as IpcResult<unknown>
  }
  return { project, beside, missing, sub, worktree, home, registry, call, window, evilTranscript, ownTranscript }
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
    await vi.waitFor(() => expect(changes.flatMap((change) => change.transcripts)).toContain(OWN), { timeout: 3000, interval: 20 })
    // The change of EVIL came first: had it been reported, it would be in by now.
    await new Promise((done) => setTimeout(done, 200))
    expect(changes.flatMap((change) => change.transcripts)).not.toContain(EVIL)
  })
})
