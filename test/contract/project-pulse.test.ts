// The `projectPulse` channels in main (worfy-polish ticket 99): src/main/ipc/project-pulse.ts registered through
// registerIpc (the wrapper the app uses) over a mocked `electron`, with the app's hub (src/main/claude-home/pulse.ts)
// over a real registry of live Sessions in a temporary Claude home. The answer holds every Project of the Machine
// with its live and busy Sessions — each Session in the Project whose root or worktree holds its cwd, the deepest
// one — the pull requests that need the user and the Tickets that wait; `projectPulse.changed` reaches every
// subscribed window after a change of the registry, of a PR inbox, of the Stages or of the Project list. One hub
// serves every window and every Project: one read of the registry per change, whatever the number of windows, and
// no watcher at all — the registry folder is polled. Nothing is written into the Claude home.
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import type { ProjectPulseState } from '../../src/shared/ipc/project-pulse'
import { APP_URL, INDEX_HTML } from '../app-url'
import { removeTestTree } from '../remove'
import { ms } from '../time-scale'

vi.mock('electron', () => ({
  app: { on: () => undefined, getPath: () => tmpdir() },
  BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null },
}))
vi.mock('../../src/main/harness/script-env', () => ({ harnessScriptEnv: () => Promise.resolve(process.env) }))

type Listener = (event: IpcMainInvokeEvent, input: unknown) => unknown

interface FakeWindow {
  id: number
  sent: ProjectPulseState[]
  send: (channel: string, payload: unknown) => void
  once: (event: string, listener: () => void) => void
  isDestroyed: () => boolean
  destroy: () => void
}

function makeWindow(id: number): FakeWindow {
  const sent: ProjectPulseState[] = []
  const destroyed: (() => void)[] = []
  let gone = false
  return {
    id,
    sent,
    send: (channel, payload) => {
      if (channel === `${IPC_CHANNEL_PREFIX}projectPulse.changed`) sent.push(payload as ProjectPulseState)
    },
    once: (event, listener) => {
      if (event === 'destroyed') destroyed.push(listener)
    },
    isDestroyed: () => gone,
    destroy: () => {
      gone = true
      for (const listener of destroyed) listener()
    },
  }
}

/** A pid no process has: its registry file is left behind by a Session that died. */
const DEAD_PID = 999_999

let scratch: string
let home: string
let handlers: Map<string, Listener>
let hub: import('../../src/main/claude-home/pulse').ProjectPulseHub
let registry: import('../../src/main/claude-home/registry').ClaudeHomeRegistry
let projects: { id: string; path: string }[]
let prNeedYou: Map<string, number | null>
let waits: Map<string, number | null>
const prListeners = new Set<() => void>()
const waitsListeners = new Set<() => void>()
const projectListeners = new Set<() => void>()

const ALPHA = 'alpha-0000000a'
const BETA = 'beta-0000000b'
const INNER = 'inner-0000000c'

function writeLive(pid: number, sessionId: string, cwd: string, status: 'busy' | 'idle'): void {
  writeFileSync(join(home, 'sessions', `${pid}.json`), JSON.stringify({ pid, sessionId, cwd, status, entrypoint: 'cli' }))
}

async function call(channel: string, from: FakeWindow, input?: unknown): Promise<IpcResult<unknown>> {
  const listener = handlers.get(IPC_CHANNEL_PREFIX + channel)
  if (!listener) throw new Error(`no handler for ${channel}`)
  const event = { senderFrame: { url: APP_URL }, sender: from } as unknown as IpcMainInvokeEvent
  return (await listener(event, input)) as IpcResult<unknown>
}

async function pulse(from: FakeWindow): Promise<ProjectPulseState> {
  const result = await call('projectPulse.get', from)
  if (!result.ok) throw new Error(result.error)
  return result.value as ProjectPulseState
}

const byProject = (state: ProjectPulseState | undefined, id: string) => state?.projects.find((project) => project.projectId === id)
const sessionsOf = (state: ProjectPulseState | undefined, id: string) => byProject(state, id)?.live.map((session) => session.sessionId)

/** Every file under `dir` with its size and modification time. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (current: string) => {
    for (const name of readdirSync(current)) {
      const path = join(current, name)
      const stat = statSync(path)
      out[relative(dir, path)] = `${stat.size}:${stat.mtimeMs}`
      if (stat.isDirectory()) walk(path)
    }
  }
  walk(dir)
  return out
}

/** A hub over the test's registry and stand-ins; `recheckMs` long unless a test needs the recheck itself. */
function makeHub(Hub: typeof import('../../src/main/claude-home/pulse').ProjectPulseHub, recheckMs: number) {
  return new Hub(
    {
      projects: () => projects,
      live: () => registry.liveAll(),
      stamp: () => registry.registryStamp(),
      roots: (path) => registry.roots({ path, local: true }),
      prNeedYou: (id) => prNeedYou.get(id) ?? null,
      onPrChange: (listener) => (prListeners.add(listener), () => void prListeners.delete(listener)),
      waits: (path) => waits.get(projects.find((project) => project.path === path)?.id ?? '') ?? null,
      onWaitsChange: (listener) => (waitsListeners.add(listener), () => void waitsListeners.delete(listener)),
      onProjectsChange: (listener) => (projectListeners.add(listener), () => void projectListeners.delete(listener)),
    },
    { pollMs: 50, recheckMs, rootsMs: 30_000, now: () => Date.now() },
  )
}

beforeEach(async () => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-pulse-')))
  home = join(scratch, 'claude-home')
  mkdirSync(join(home, 'sessions'), { recursive: true })
  const alpha = join(scratch, 'alpha')
  const beta = join(scratch, 'beta')
  // A Project inside another one: its Sessions are its own, not the outer one's.
  const inner = join(alpha, 'inner')
  projects = [
    { id: ALPHA, path: alpha },
    { id: BETA, path: beta },
    { id: INNER, path: inner },
  ]
  prNeedYou = new Map([
    [ALPHA, 2],
    [BETA, null],
    [INNER, 0],
  ])
  waits = new Map([
    [ALPHA, 1],
    [BETA, null],
    [INNER, null],
  ])
  prListeners.clear()
  waitsListeners.clear()
  projectListeners.clear()
  writeLive(101, 'alpha-root', alpha, 'busy')
  // A worktree of alpha outside its folder, as git lists it.
  writeLive(102, 'alpha-worktree', join(scratch, 'alpha-wt', '07'), 'idle')
  writeLive(103, 'alpha-sub', join(alpha, 'src'), 'busy')
  writeLive(201, 'beta-root', beta, 'idle')
  writeLive(301, 'inner-root', join(inner, 'lib'), 'busy')
  writeLive(401, 'elsewhere', join(scratch, 'elsewhere'), 'busy')
  writeLive(DEAD_PID, 'dead', alpha, 'busy')

  process.env.WORFY_DATA_DIR = join(scratch, 'data')
  process.env.WORFY_CLAUDE_HOME = home
  vi.resetModules()
  const { ClaudeHomeRegistry } = await import('../../src/main/claude-home/registry')
  const { ProjectPulseHub } = await import('../../src/main/claude-home/pulse')
  registry = new ClaudeHomeRegistry({
    home,
    listWorktrees: (root) => Promise.resolve(root === alpha ? [join(scratch, 'alpha-wt', '07')] : []),
    isAlive: (pid) => Promise.resolve(pid !== DEAD_PID),
  })
  hub = makeHub(ProjectPulseHub, 60_000)
  const { registerIpc, appUrlMatcher } = await import('../../src/main/ipc/index')
  const module = await import('../../src/main/ipc/project-pulse')
  handlers = new Map()
  await registerIpc(
    { handle: (channel, listener) => handlers.set(channel, listener as Listener) },
    { modules: { './project-pulse.ts': () => Promise.resolve(module.projectPulseHandlers(() => hub)) }, isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }) },
  )
})

afterEach(() => {
  hub.close()
  delete process.env.WORFY_DATA_DIR
  delete process.env.WORFY_CLAUDE_HOME
  removeTestTree(scratch)
})

describe('projectPulse.get', () => {
  it('answers every Project in the order of the list, each with its live Sessions, how many are busy, its PRs that need you and its waits', async () => {
    const state = await pulse(makeWindow(1))
    expect(state.projects.map((project) => project.projectId)).toEqual([ALPHA, BETA, INNER])
    // The root, a folder inside it and a worktree listed by git; not the dead process, not the inner Project's.
    expect(sessionsOf(state, ALPHA)).toEqual(['alpha-root', 'alpha-worktree', 'alpha-sub'])
    expect(sessionsOf(state, BETA)).toEqual(['beta-root'])
    expect(sessionsOf(state, INNER)).toEqual(['inner-root'])
    expect(state.projects.flatMap((project) => project.live.map((session) => session.sessionId))).not.toContain('elsewhere')
    expect(state.projects.map(({ projectId, busy, prNeedYou: pr, waits: wait }) => ({ projectId, busy, pr, wait }))).toEqual([
      { projectId: ALPHA, busy: 2, pr: 2, wait: 1 },
      { projectId: BETA, busy: 0, pr: null, wait: null },
      { projectId: INNER, busy: 1, pr: 0, wait: null },
    ])
    expect(byProject(state, BETA)?.live[0]).toEqual({ pid: 201, sessionId: 'beta-root', cwd: join(scratch, 'beta'), status: 'idle', entrypoint: 'cli' })
  })

  it('refuses a call that comes from no window', async () => {
    const listener = handlers.get(`${IPC_CHANNEL_PREFIX}projectPulse.get`)
    const result = (await listener?.({ senderFrame: { url: APP_URL } } as unknown as IpcMainInvokeEvent, undefined)) as IpcResult<unknown>
    expect(result.ok).toBe(false)
  })
})

describe('projectPulse.changed', () => {
  it('reaches every subscribed window once a Session starts, turns busy or ends, from one read of the registry per change', async () => {
    const first = makeWindow(1)
    const second = makeWindow(2)
    await pulse(first)
    await pulse(second)
    const reads = hub.reads
    writeLive(202, 'beta-new', join(scratch, 'beta'), 'busy')
    await vi.waitFor(() => expect(sessionsOf(first.sent.at(-1), BETA)).toEqual(['beta-root', 'beta-new']), { timeout: ms(2000), interval: 20 })
    await vi.waitFor(() => expect(sessionsOf(second.sent.at(-1), BETA)).toEqual(['beta-root', 'beta-new']), { timeout: ms(2000), interval: 20 })
    expect(byProject(first.sent.at(-1), BETA)?.busy).toBe(1)
    // One read for both windows and every Project.
    expect(hub.reads - reads).toBe(1)

    rmSync(join(home, 'sessions', '202.json'))
    await vi.waitFor(() => expect(sessionsOf(first.sent.at(-1), BETA)).toEqual(['beta-root']), { timeout: ms(2000), interval: 20 })
    expect(second.sent.length).toBe(first.sent.length)
  })

  it('reaches the windows after a change of a PR inbox, of the Stages and of the Project list; nothing while nothing changed', async () => {
    const window = makeWindow(1)
    await pulse(window)
    await new Promise((resolve) => setTimeout(resolve, ms(200)))
    expect(window.sent).toEqual([])

    prNeedYou.set(BETA, 4)
    for (const listener of prListeners) listener()
    await vi.waitFor(() => expect(byProject(window.sent.at(-1), BETA)?.prNeedYou).toBe(4), { timeout: ms(2000), interval: 20 })

    waits.set(BETA, 3)
    for (const listener of waitsListeners) listener()
    await vi.waitFor(() => expect(byProject(window.sent.at(-1), BETA)?.waits).toBe(3), { timeout: ms(2000), interval: 20 })

    projects = projects.filter((project) => project.id !== INNER)
    for (const listener of projectListeners) listener()
    await vi.waitFor(() => expect(window.sent.at(-1)?.projects.map((project) => project.projectId)).toEqual([ALPHA, BETA]), { timeout: ms(2000), interval: 20 })
    // The inner Project gone, its Session belongs to the Project that holds its folder.
    expect(sessionsOf(window.sent.at(-1), ALPHA)).toContain('inner-root')
  })

  it('drops a Session whose process died without removing its file, at the next recheck', async () => {
    let alive = true
    const { ClaudeHomeRegistry } = await import('../../src/main/claude-home/registry')
    const { ProjectPulseHub } = await import('../../src/main/claude-home/pulse')
    const checking = new ClaudeHomeRegistry({ home, listWorktrees: () => Promise.resolve([]), isAlive: (pid) => Promise.resolve(pid !== DEAD_PID && (pid !== 201 || alive)) })
    registry.liveAll = () => checking.liveAll()
    hub.close()
    hub = makeHub(ProjectPulseHub, 300)
    const window = makeWindow(1)
    expect(sessionsOf(await pulse(window), BETA)).toEqual(['beta-root'])
    alive = false
    await vi.waitFor(() => expect(sessionsOf(window.sent.at(-1), BETA)).toEqual([]), { timeout: ms(2000), interval: 20 })
  })
})

describe('one hub for every window and every Project', () => {
  it('opens no watcher: the registry folder is polled while a window is subscribed, and no longer once the last window is gone', async () => {
    const watch = vi.spyOn(registry, 'watch')
    const windows = [makeWindow(1), makeWindow(2), makeWindow(3)]
    for (const window of windows) await pulse(window)
    // A second call of one window does not subscribe it twice.
    await pulse(windows[0]!)
    expect(hub.subscriberCount).toBe(3)
    expect(hub.polling).toBe(true)
    windows[0]!.destroy()
    windows[1]!.destroy()
    expect(hub.subscriberCount).toBe(1)
    expect(hub.polling).toBe(true)
    windows[2]!.destroy()
    expect(hub.subscriberCount).toBe(0)
    expect(hub.polling).toBe(false)
    expect(watch).not.toHaveBeenCalled()
  })

  it('writes nothing into the Claude home', async () => {
    const before = snapshot(home)
    const window = makeWindow(1)
    await pulse(window)
    await new Promise((resolve) => setTimeout(resolve, ms(400)))
    window.destroy()
    expect(snapshot(home)).toStrictEqual(before)
  })
})

describe('what counts in `waits`', () => {
  it('a Ticket in work that is blocked or waits for a person; not one that waits for an agent, nor a queued or a done one', async () => {
    const { waitsForPerson } = await import('../../src/shared/ipc/project-pulse')
    expect(waitsForPerson({ kind: 'agent-review', blocked: null, waits: 'owner' })).toBe(true)
    expect(waitsForPerson({ kind: 'gate-merge', blocked: null, waits: 'team' })).toBe(true)
    expect(waitsForPerson({ kind: 'implementing', blocked: { reason: 'needs a decision' }, waits: 'agent' })).toBe(true)
    expect(waitsForPerson({ kind: 'implementing', blocked: null, waits: 'agent' })).toBe(false)
    expect(waitsForPerson({ kind: 'queued', blocked: { reason: null }, waits: 'owner' })).toBe(false)
    expect(waitsForPerson({ kind: 'done', blocked: null, waits: null })).toBe(false)
  })
})
