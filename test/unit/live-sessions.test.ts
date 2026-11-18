// live-sessions.json (worfy-continuity ticket 03): the reader of src/shared/agent/live-sessions.ts — a good file,
// an unknown version, broken JSON, an empty file — and the watcher of src/main/agent/live-sessions.ts over a fake
// registry: a write that crashes halfway leaves the file as it was and no temporary file; changes made while a
// write runs wait for it and end in the latest state; a resumed Session keeps its record through its rename.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LiveSessions, TOUCH_MS, type LiveSessionsFs } from '../../src/main/agent/live-sessions'
import type { EventSink, InputListener, Session } from '../../src/main/agent/session'
import type { AgentEvent } from '../../src/shared/agent/events'
import { LIVE_SESSIONS_FILE, LIVE_SESSIONS_VERSION, parseLiveSessions, type LiveSession } from '../../src/shared/agent/live-sessions'
import type { SessionNodeView } from '../../src/shared/ipc/sessions'
import { removeTestTree } from '../remove'

const RUN = '2026-11-18T01-02-03-004Z-abc123'

const record: LiveSession = {
  nodeId: 'node-1',
  kind: 'session-node',
  vendor: 'claude',
  vendorSessionId: 'f0000000-0000-4000-8000-0000000000a1',
  state: 'busy',
  queue: { items: [{ text: 'next', files: ['/tmp/notes.md'], images: [] }], held: false },
  runId: null,
  lastEventAt: 1_000,
  continuedAt: [],
}

describe('parseLiveSessions', () => {
  it('reads the records of a file of its version, and logs nothing', () => {
    const log = vi.fn()
    const text = JSON.stringify({ version: LIVE_SESSIONS_VERSION, sessions: [record, { ...record, nodeId: 'orchestrator', kind: 'orchestrator', runId: RUN }] })
    expect(parseLiveSessions(text, log)).toEqual([record, { ...record, nodeId: 'orchestrator', kind: 'orchestrator', runId: RUN }])
    expect(log).not.toHaveBeenCalled()
  })

  it('no file: no records, nothing logged', () => {
    const log = vi.fn()
    expect(parseLiveSessions(null, log)).toEqual([])
    expect(log).not.toHaveBeenCalled()
  })

  it('a version it does not know: no records, one line in the log', () => {
    const log = vi.fn()
    expect(parseLiveSessions(JSON.stringify({ version: LIVE_SESSIONS_VERSION + 1, sessions: [record] }), log)).toEqual([])
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0]?.[0]).toContain(`version ${LIVE_SESSIONS_VERSION + 1}`)
  })

  it('broken JSON: no records, one line in the log', () => {
    const log = vi.fn()
    const text = JSON.stringify({ version: LIVE_SESSIONS_VERSION, sessions: [record] })
    expect(parseLiveSessions(text.slice(0, text.length / 2), log)).toEqual([])
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0]?.[0]).toContain('not JSON')
  })

  it('an empty file: no records, one line in the log', () => {
    const log = vi.fn()
    expect(parseLiveSessions('', log)).toEqual([])
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0]?.[0]).toContain('empty')
  })

  it('a record out of the format: no records, one line in the log', () => {
    const log = vi.fn()
    expect(parseLiveSessions(JSON.stringify({ version: LIVE_SESSIONS_VERSION, sessions: [{ ...record, state: 'closed' }] }), log)).toEqual([])
    expect(log).toHaveBeenCalledTimes(1)
  })
})

/** The registry as the watcher sees it: events and inputs a test sends, Sessions a test names. */
class FakeRegistry {
  readonly sinks = new Set<EventSink>()
  readonly inputs = new Set<InputListener>()
  readonly sessions = new Map<string, { sdkId: string | null; unattended: boolean }>()

  emit(sessionId: string, event: AgentEvent): void {
    for (const sink of this.sinks) sink(sessionId, event)
  }

  state(sessionId: string, state: Extract<AgentEvent, { type: 'state' }>['state']): void {
    this.emit(sessionId, { type: 'state', state, error: null })
  }

  queue(sessionId: string, texts: readonly string[], paused = false): void {
    this.emit(sessionId, { type: 'queue', items: texts.map((text, index) => ({ id: `q${index}`, text })), paused })
  }
}

let dir: string
let now: number

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'worfy-live-sessions-'))
  mkdirSync(join(dir, 'p1'))
  now = 1_000
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
  removeTestTree(dir)
})

const realFs: LiveSessionsFs = {
  mkdir: (path) => mkdir(path, { recursive: true }),
  writeFile: (file, text) => writeFile(file, text),
  rename: (from, to) => rename(from, to),
  rm: (file) => rm(file, { force: true }),
}

function watcher(fs: LiveSessionsFs = realFs) {
  const registry = new FakeRegistry()
  const live = new LiveSessions({
    observe: (sink) => {
      registry.sinks.add(sink)
      return () => registry.sinks.delete(sink)
    },
    observeInput: (listener) => {
      registry.inputs.add(listener)
      return () => registry.inputs.delete(listener)
    },
    session: (sessionId) => registry.sessions.get(sessionId) ?? null,
    dirOf: (projectId) => join(dir, projectId),
    now: () => now,
    fs,
  })
  return { registry, live }
}

const nodeView = (sessionId: string, nodeId = 'node-1'): SessionNodeView => ({
  projectId: 'p1',
  nodeId,
  vendor: 'claude',
  sessionId,
  sdkSessionId: null,
  state: 'idle',
  error: null,
  cwd: '/repo',
  model: null,
  version: 1,
})

const fileOf = (projectId = 'p1'): string => join(dir, projectId, LIVE_SESSIONS_FILE)
const recordsOf = (projectId = 'p1'): LiveSession[] => parseLiveSessions(readFileSync(fileOf(projectId), 'utf8'), (line) => expect.fail(line))

describe('LiveSessions', () => {
  it('a Session Node in a turn with a queue gets a record; idle with an empty queue, it goes', async () => {
    const { registry, live } = watcher()
    registry.sessions.set('s1', { sdkId: 'sdk-1', unattended: false })
    live.node(nodeView('s1'))
    registry.state('s1', 'busy')
    registry.queue('s1', ['a', 'b\n\nAttached files: /tmp/notes.md'])
    await live.settled()
    expect(recordsOf()).toEqual([
      {
        nodeId: 'node-1',
        kind: 'session-node',
        vendor: 'claude',
        vendorSessionId: 'sdk-1',
        state: 'busy',
        queue: { items: [{ text: 'a', files: [], images: [] }, { text: 'b', files: ['/tmp/notes.md'], images: [] }], held: false },
        runId: null,
        lastEventAt: 1_000,
        continuedAt: [],
      },
    ])
    registry.queue('s1', ['a', 'b'], true)
    registry.state('s1', 'idle')
    await live.settled()
    expect(recordsOf()).toMatchObject([{ state: 'idle', queue: { held: true } }])
    registry.queue('s1', [])
    await live.settled()
    expect(recordsOf()).toEqual([])
  })

  it('leaves the file of the run before alone until a Session of this run has a record', async () => {
    const { registry, live } = watcher()
    writeFileSync(fileOf(), JSON.stringify({ version: LIVE_SESSIONS_VERSION, sessions: [record] }))
    live.node(nodeView('s1'))
    registry.state('s1', 'idle')
    registry.queue('s1', [])
    await live.settled()
    expect(recordsOf()).toEqual([record])
  })

  it('a write that crashes halfway leaves the file as it was, and no temporary file', async () => {
    let crash = false
    const fs: LiveSessionsFs = {
      ...realFs,
      writeFile: async (file, text) => {
        if (!crash) return realFs.writeFile(file, text)
        // Half of the text reaches the disk, then the process "dies" in the middle of the write.
        await realFs.writeFile(file, text.slice(0, text.length / 2))
        throw new Error('crashed mid-write')
      },
    }
    const { registry, live } = watcher(fs)
    registry.sessions.set('s1', { sdkId: 'sdk-1', unattended: false })
    live.node(nodeView('s1'))
    registry.state('s1', 'busy')
    await live.settled()
    const before = readFileSync(fileOf(), 'utf8')
    crash = true
    registry.queue('s1', ['queued while the write crashed'])
    await live.settled()
    expect(readFileSync(fileOf(), 'utf8')).toBe(before)
    expect(recordsOf()).toMatchObject([{ nodeId: 'node-1', queue: { items: [] } }])
    expect(readdirSync(join(dir, 'p1'))).toEqual([LIVE_SESSIONS_FILE])
    // The next change writes again.
    crash = false
    registry.queue('s1', ['queued while the write crashed', 'and one more'])
    await live.settled()
    expect(recordsOf()[0]?.queue.items.map((item) => item.text)).toEqual(['queued while the write crashed', 'and one more'])
  })

  it('changes made while a write runs wait for it: one write at a time, the latest state last', async () => {
    let running = 0
    let most = 0
    let writes = 0
    const gates: (() => void)[] = []
    const fs: LiveSessionsFs = {
      ...realFs,
      writeFile: async (file, text) => {
        running += 1
        writes += 1
        most = Math.max(most, running)
        // Every write but the last waits for the test; the first is held while the changes come.
        await new Promise<void>((done) => gates.push(done))
        await realFs.writeFile(file, text)
        running -= 1
      },
    }
    const { registry, live } = watcher(fs)
    live.node(nodeView('s1'))
    registry.state('s1', 'busy')
    await vi.waitFor(() => expect(gates).toHaveLength(1))
    const texts: string[] = []
    for (let n = 1; n <= 10; n += 1) {
      texts.push(`message ${n}`)
      registry.queue('s1', texts)
    }
    // Let every write that starts go, in the order they started.
    const releasing = setInterval(() => gates.shift()?.(), 1)
    try {
      await live.settled()
    } finally {
      clearInterval(releasing)
    }
    expect(most).toBe(1)
    // The ten changes made during the first write go out together in one more write.
    expect(writes).toBe(2)
    expect(recordsOf()[0]?.queue.items.map((item) => item.text)).toEqual(texts)
  })

  it('a resumed Session keeps its record through its rename, and a late view with its old id', async () => {
    const { registry, live } = watcher()
    live.node(nodeView('pending-1'))
    registry.state('pending-1', 'busy')
    registry.sessions.set('sdk-1', { sdkId: 'sdk-1', unattended: false })
    registry.emit('sdk-1', { type: 'renamed', from: 'pending-1' })
    // The view the Node published before the rename arrives after it.
    live.node(nodeView('pending-1'))
    await live.settled()
    expect(recordsOf()).toMatchObject([{ nodeId: 'node-1', vendorSessionId: 'sdk-1', state: 'busy' }])
    registry.state('sdk-1', 'idle')
    await live.settled()
    expect(recordsOf()).toEqual([])
  })

  it('an Orchestrator owned by a running Run names it; one a person runs does not', async () => {
    const { registry, live } = watcher()
    registry.sessions.set('o1', { sdkId: 'sdk-o', unattended: true })
    live.orchestrator({ projectId: 'p1', nodeId: 'orch', sessionId: 'o1', state: 'idle', error: null, vendor: 'codex', model: null, costUsd: 0, statusBlock: null, version: 1 })
    live.autopilot({ projectId: 'p1', status: 'running', run: RUN })
    registry.state('o1', 'busy')
    await live.settled()
    expect(recordsOf()).toMatchObject([{ nodeId: 'orch', kind: 'orchestrator', vendor: 'codex', runId: RUN }])
    live.autopilot({ projectId: 'p1', status: 'stopped', run: RUN })
    await live.settled()
    expect(recordsOf()).toMatchObject([{ nodeId: 'orch', runId: null }])
    // A run accepted while a person's turn runs does not own that turn.
    registry.sessions.set('o1', { sdkId: 'sdk-o', unattended: false })
    live.autopilot({ projectId: 'p1', status: 'waiting', run: RUN })
    await live.settled()
    expect(recordsOf()).toMatchObject([{ nodeId: 'orch', runId: null }])
  })

  it('the time of the last event alone rewrites a record once in TOUCH_MS', async () => {
    const { registry, live } = watcher()
    live.node(nodeView('s1'))
    registry.state('s1', 'busy')
    await live.settled()
    now += TOUCH_MS - 1
    registry.emit('s1', { type: 'text', text: 'streaming' } as AgentEvent)
    await live.settled()
    expect(recordsOf()[0]?.lastEventAt).toBe(1_000)
    now += 1
    registry.emit('s1', { type: 'text', text: 'streaming' } as AgentEvent)
    await live.settled()
    expect(recordsOf()[0]?.lastEventAt).toBe(1_000 + TOUCH_MS)
  })

  it('an action of a person counts as the last event', async () => {
    const { registry, live } = watcher()
    live.node(nodeView('s1'))
    registry.state('s1', 'busy')
    await live.settled()
    now += 5
    for (const listener of registry.inputs) listener({ id: 's1' } as Session, 'interrupt')
    await live.settled()
    expect(recordsOf()[0]?.lastEventAt).toBe(1_005)
  })

  it('counts the automatic continuations of the last hour', async () => {
    const { registry, live } = watcher()
    live.node(nodeView('s1'))
    registry.state('s1', 'busy')
    live.noteContinued('node-1', 0)
    now = 2 * 60 * 60_000
    live.noteContinued('node-1')
    await live.settled()
    expect(recordsOf()[0]?.continuedAt).toEqual([2 * 60 * 60_000])
  })

  it('after stop, the closing of the Sessions leaves the file as it was', async () => {
    const { registry, live } = watcher()
    live.node(nodeView('s1'))
    registry.state('s1', 'busy')
    await live.settled()
    live.stop()
    registry.state('s1', 'closed')
    await live.settled()
    expect(recordsOf()).toMatchObject([{ nodeId: 'node-1', state: 'busy' }])
  })

  it('a Session that closes loses its record, its queue with it', async () => {
    const { registry, live } = watcher()
    live.node(nodeView('s1'))
    registry.state('s1', 'busy')
    registry.queue('s1', ['never sent'], true)
    await live.settled()
    expect(recordsOf()).toHaveLength(1)
    registry.state('s1', 'closed')
    await live.settled()
    expect(recordsOf()).toEqual([])
  })
})
