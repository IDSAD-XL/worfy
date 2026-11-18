// live-sessions.json (worfy-continuity ticket 03) over the real Session registry on the fake agent, the watcher
// made as the app makes it (liveSessionsOf, src/main/agent/app-registry.ts): a Session Node in a turn with two
// queued messages has a record, Interrupt makes it held, a turn that ends with an empty queue leaves no record; a
// resumed Session keeps its record by its Node through the rename at its first init; an Orchestrator under a Run
// names the Run; the file goes through a temporary file and a rename; a stop before the registry closes the
// Sessions (the app's quit) keeps the records.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { liveSessionsOf } from '../../src/main/agent/app-registry'
import { FakeReleases, fakeQueryFactory } from '../../src/main/agent/fake-query'
import { LiveSessions, type LiveSessionsFs } from '../../src/main/agent/live-sessions'
import { SessionRegistry } from '../../src/main/agent/session'
import type { Attachment } from '../../src/shared/agent/attachments'
import { LIVE_SESSIONS_FILE, parseLiveSessions, type LiveSession } from '../../src/shared/agent/live-sessions'
import type { OrchestratorView } from '../../src/shared/ipc/orchestrator'
import type { SessionNodeView } from '../../src/shared/ipc/sessions'
import { removeTestTree } from '../remove'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/nowhere', on: () => undefined },
  BrowserWindow: { getAllWindows: () => [] },
}))

const fixtures = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'fixtures', 'agent-scripts')
const PROJECT = 'demo-0000000d'
const RUN = '2026-11-18T01-02-03-004Z-abc123'
const RESUMED = 'f0000000-0000-4000-8000-0000000000c3'

let scratch: string
let scripts: string
let registries: SessionRegistry[] = []

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-live-sessions-')))
  mkdirSync(join(scratch, 'data', PROJECT), { recursive: true })
  mkdirSync(join(scratch, 'repo'))
  mkdirSync(join(scratch, 'claude-home'))
  vi.stubEnv('WORFY_CLAUDE_HOME', join(scratch, 'claude-home'))
  // `turn`, whose turn ends only when the test releases `end`.
  scripts = join(scratch, 'scripts')
  mkdirSync(scripts)
  const turn = readFileSync(join(fixtures, 'turn.jsonl'), 'utf8').trimEnd().split('\n')
  const result = turn.findIndex((line) => line.includes('"type": "result"'))
  writeFileSync(join(scripts, 'held-turn.jsonl'), [...turn.slice(0, result), '{"fake": "wait_release", "name": "end"}', ...turn.slice(result)].join('\n'))
  writeFileSync(join(scripts, 'interrupt.jsonl'), readFileSync(join(fixtures, 'interrupt.jsonl')))
})

afterEach(() => {
  for (const registry of registries) registry.closeAll()
  registries = []
  vi.unstubAllEnvs()
  removeTestTree(scratch)
})

const dataDir = (): string => join(scratch, 'data', PROJECT)
const fileOf = (): string => join(dataDir(), LIVE_SESSIONS_FILE)
const records = (): LiveSession[] => parseLiveSessions(readFileSync(fileOf(), 'utf8'), (line) => expect.fail(line))

/** A registry on the fake agent playing `script`, and its watcher as the app makes it. */
function harness(script: string, releases?: FakeReleases) {
  const registry = new SessionRegistry(fakeQueryFactory({ scriptsDir: scripts, script, ...(releases === undefined ? {} : { releases }) }))
  registries.push(registry)
  const live = liveSessionsOf(registry, () => dataDir())
  return { registry, live }
}

const nodeView = (sessionId: string): SessionNodeView => ({
  projectId: PROJECT,
  nodeId: 'node-1',
  vendor: 'claude',
  sessionId,
  sdkSessionId: null,
  state: 'starting',
  error: null,
  cwd: join(scratch, 'repo'),
  model: null,
  version: 1,
})

const orchestratorView = (sessionId: string): OrchestratorView => ({
  projectId: PROJECT,
  nodeId: 'orchestrator-1',
  sessionId,
  state: 'starting',
  error: null,
  vendor: 'claude',
  model: null,
  costUsd: 0,
  statusBlock: null,
  version: 1,
})

const notes: Attachment = { kind: 'file', name: 'notes.md', path: '/tmp/notes.md', size: 3, copied: false }

describe('live-sessions.json on the fake agent', () => {
  it('a Session Node in a turn with two queued messages has a record; Interrupt makes it held; idle and empty, it goes', async () => {
    const { registry, live } = harness('interrupt')
    const session = registry.start(join(scratch, 'repo'), undefined, () => undefined)
    live.node(nodeView(session.id))
    await vi.waitFor(() => expect(session.state).toBe('idle'))
    session.send('count')
    expect(session.send('then this')).toBe('queued')
    expect(session.send('and this', [notes])).toBe('queued')
    await vi.waitFor(async () => {
      await live.settled()
      expect(records()).toEqual([
        expect.objectContaining({
          nodeId: 'node-1',
          kind: 'session-node',
          vendor: 'claude',
          vendorSessionId: session.sdkId,
          state: 'busy',
          queue: {
            items: [
              { text: 'then this', files: [], images: [] },
              { text: 'and this', files: ['/tmp/notes.md'], images: [] },
            ],
            held: false,
          },
          runId: null,
        }),
      ])
    })
    expect(session.sdkId).not.toBeNull()

    await session.interrupt()
    await vi.waitFor(async () => {
      await live.settled()
      expect(records()).toMatchObject([{ nodeId: 'node-1', state: 'idle', queue: { held: true, items: [{ text: 'then this' }, { text: 'and this' }] } }])
    })

    for (const item of session.queued().items) session.removeQueued(item.id)
    await vi.waitFor(async () => {
      await live.settled()
      expect(records()).toEqual([])
    })
  })

  it('a resumed Session keeps its record by its Node through its rename; a turn that ends with an empty queue leaves none', async () => {
    const releases = new FakeReleases()
    const { registry, live } = harness('held-turn', releases)
    const session = registry.start(join(scratch, 'repo'), RESUMED, () => undefined)
    expect(session.id).toMatch(/^pending-/u)
    live.node(nodeView(session.id))
    session.send('first')
    expect(session.send('second')).toBe('queued')
    await vi.waitFor(async () => {
      await live.settled()
      expect(session.id).toBe(RESUMED)
      expect(records()).toMatchObject([{ nodeId: 'node-1', vendorSessionId: RESUMED, state: 'busy', queue: { items: [{ text: 'second' }] } }])
    })

    // The first turn ends and the queued message starts the next one.
    releases.release('end')
    await vi.waitFor(async () => {
      await live.settled()
      expect(records()).toMatchObject([{ nodeId: 'node-1', state: 'busy', queue: { items: [] } }])
    })

    releases.release('end')
    await vi.waitFor(async () => {
      await live.settled()
      expect(session.state).toBe('idle')
      expect(records()).toEqual([])
    })
  })

  it('an Orchestrator under a Run names the Run in its record', async () => {
    const { registry, live } = harness('interrupt')
    const session = registry.start(join(scratch, 'repo'), undefined, () => undefined, undefined, { unattended: true, orchestrator: true })
    live.orchestrator(orchestratorView(session.id))
    live.autopilot({ projectId: PROJECT, status: 'running', run: RUN })
    await vi.waitFor(() => expect(session.state).toBe('idle'))
    session.send('run Wave 1')
    await vi.waitFor(async () => {
      await live.settled()
      expect(records()).toEqual([expect.objectContaining({ nodeId: 'orchestrator-1', kind: 'orchestrator', state: 'busy', runId: RUN })])
    })
  })

  it('writes through a temporary file renamed over the target: no temporary file stays', async () => {
    const registry = new SessionRegistry(fakeQueryFactory({ scriptsDir: scripts, script: 'interrupt' }))
    registries.push(registry)
    const calls: string[] = []
    const fs: LiveSessionsFs = {
      mkdir: (path) => mkdir(path, { recursive: true }),
      writeFile: async (file, text) => {
        calls.push(`write ${file}`)
        await writeFile(file, text)
      },
      rename: async (from, to) => {
        calls.push(`rename ${from} -> ${to}`)
        await rename(from, to)
      },
      rm: (file) => rm(file, { force: true }),
    }
    const live = new LiveSessions({
      observe: (sink) => registry.observe(sink),
      observeInput: (listener) => registry.observeInput(listener),
      session: (sessionId) => registry.get(sessionId),
      dirOf: () => dataDir(),
      fs,
    })
    const session = registry.start(join(scratch, 'repo'), undefined, () => undefined)
    live.node(nodeView(session.id))
    await vi.waitFor(() => expect(session.state).toBe('idle'))
    session.send('count')
    await vi.waitFor(async () => {
      await live.settled()
      expect(records()).toHaveLength(1)
    })
    expect(calls.length).toBeGreaterThan(0)
    for (let index = 0; index < calls.length; index += 2) {
      const temporary = calls[index]?.replace(/^write /u, '') ?? ''
      expect(dirname(temporary)).toBe(dataDir())
      expect(temporary).not.toBe(fileOf())
      expect(calls[index + 1]).toBe(`rename ${temporary} -> ${fileOf()}`)
    }
    expect(readdirSync(dataDir())).toEqual([LIVE_SESSIONS_FILE])
  })

  it('a stop before the registry closes its Sessions (the quit) keeps their records', async () => {
    const { registry, live } = harness('interrupt')
    const session = registry.start(join(scratch, 'repo'), undefined, () => undefined)
    live.node(nodeView(session.id))
    await vi.waitFor(() => expect(session.state).toBe('idle'))
    session.send('count')
    await vi.waitFor(async () => {
      await live.settled()
      expect(records()).toMatchObject([{ state: 'busy' }])
    })
    live.stop()
    registry.closeAll()
    await vi.waitFor(() => expect(session.state).toBe('closed'))
    await live.settled()
    expect(records()).toMatchObject([{ nodeId: 'node-1', state: 'busy' }])
  })
})
