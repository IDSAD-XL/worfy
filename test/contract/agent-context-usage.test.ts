// How full a Session's context window is (worfy-polish ticket 23), on the fake agent: after each
// turn's `result` and after a compaction main asks Claude Code getContextUsage({ detail: 'summary' })
// and sends a `context` event with the percentage, the tokens, the window and the autocompact
// threshold. A failed ask is no failed turn: the event says "no data". Never the real Claude Code.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeReleases, fakeQueryFactory } from '../../src/main/agent/fake-query'
import { SessionRegistry, type QueryFactory, type QueryHandle } from '../../src/main/agent/session'
import type { AgentEvent } from '../../src/shared/agent/events'

const scriptsDir = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'fixtures', 'agent-scripts')

let cwd: string
let emptyHome: string
let registries: SessionRegistry[] = []

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'worfy-context-'))
  emptyHome = await mkdtemp(join(tmpdir(), 'worfy-context-home-'))
  vi.stubEnv('WORFY_CLAUDE_HOME', emptyHome)
})

afterEach(async () => {
  for (const registry of registries) registry.closeAll()
  registries = []
  vi.unstubAllEnvs()
  await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  await rm(emptyHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

/** A Session on the fake agent playing `script`; `wrap` may change the query the factory gives. */
function harness(script: string, wrap: (query: QueryHandle) => QueryHandle = (query) => query) {
  const releases = new FakeReleases()
  /** What each getContextUsage() call asked for. */
  const asks: unknown[] = []
  const fake = fakeQueryFactory({ scriptsDir, script, releases })
  const factory: QueryFactory = async (request) => {
    const query = await fake(request)
    const real = query.getContextUsage?.bind(query)
    if (real !== undefined) {
      query.getContextUsage = (opts) => {
        asks.push(opts)
        return real(opts)
      }
    }
    return wrap(query)
  }
  const registry = new SessionRegistry(factory, () => null, () => null)
  registries.push(registry)
  const events: AgentEvent[] = []
  const session = registry.start(cwd, undefined, (_id, event) => events.push(event))
  const ofType = <T extends AgentEvent['type']>(type: T) => events.filter((e): e is Extract<AgentEvent, { type: T }> => e.type === type)
  const turn = async (text: string) => {
    const before = ofType('result').length
    session.send(text)
    await vi.waitFor(() => expect(ofType('result')).toHaveLength(before + 1))
  }
  return { session, events, asks, releases, ofType, turn }
}

describe('the context usage of a Session', () => {
  it('is sent after every result: percentage, tokens, window and autocompact threshold', async () => {
    const { session, ofType, asks, turn } = harness('context')
    await vi.waitFor(() => expect(session.state).toBe('idle'))
    expect(ofType('context')).toEqual([])

    await turn('one')
    await vi.waitFor(() => expect(ofType('context')).toHaveLength(1))
    expect(ofType('context')[0]).toEqual({
      type: 'context',
      usage: { percentage: 10, totalTokens: 20000, windowTokens: 200000, autoCompactThreshold: 167000, autoCompactEnabled: true },
    })
    // The cheap form: from the last response's usage, no token-count requests.
    expect(asks).toEqual([{ detail: 'summary' }])

    await turn('two')
    await vi.waitFor(() => expect(ofType('context')).toHaveLength(2))
    expect(ofType('context')[1]?.usage?.percentage).toBe(75)
    expect(ofType('context')[1]?.usage?.totalTokens).toBe(150000)
  })

  it('is sent after a compaction, before the turn ends', async () => {
    const { session, ofType, releases, turn } = harness('context')
    await vi.waitFor(() => expect(session.state).toBe('idle'))
    await turn('one')
    await turn('two')
    await vi.waitFor(() => expect(ofType('context')).toHaveLength(2))

    // The third turn compacts, then stands until the test lets it go on.
    session.send('three')
    await vi.waitFor(() => expect(ofType('context')).toHaveLength(3))
    expect(session.state).toBe('busy')
    expect(ofType('result')).toHaveLength(2)
    expect(ofType('context')[2]?.usage).toMatchObject({ percentage: 4, totalTokens: 8000 })

    releases.release('compacted')
    await vi.waitFor(() => expect(ofType('result')).toHaveLength(3))
    // The same numbers after the result are not sent again.
    await new Promise((done) => setTimeout(done, 50))
    expect(ofType('context')).toHaveLength(3)
  })

  it('a failed ask is no failed turn: the event says "no data"', async () => {
    const { session, ofType, releases, turn } = harness('context')
    await vi.waitFor(() => expect(session.state).toBe('idle'))
    await turn('one')
    await turn('two')
    releases.release('compacted')
    await turn('three')
    await vi.waitFor(() => expect(ofType('context')).toHaveLength(3))

    await turn('four')
    await vi.waitFor(() => expect(ofType('context')).toHaveLength(4))
    expect(ofType('context')[3]).toEqual({ type: 'context', usage: null })
    const last = ofType('result').at(-1)
    expect(last?.isError).toBe(false)
    await vi.waitFor(() => expect(session.state).toBe('idle'))
  })

  it('a script that sets no usage reports nothing, and the turn goes on as before', async () => {
    const { session, ofType, turn } = harness('turn')
    await vi.waitFor(() => expect(session.state).toBe('idle'))
    await turn('hello')
    await new Promise((done) => setTimeout(done, 50))
    expect(ofType('context')).toEqual([])
    expect(session.state).toBe('idle')
  })

  it('a query without getContextUsage reports nothing', async () => {
    const { session, ofType, turn } = harness('context', (query) => {
      const handle = query as QueryHandle & { getContextUsage?: unknown }
      handle.getContextUsage = undefined
      return handle
    })
    await vi.waitFor(() => expect(session.state).toBe('idle'))
    await turn('one')
    await new Promise((done) => setTimeout(done, 50))
    expect(ofType('context')).toEqual([])
  })

  it('an answer to an older ask that arrives after a newer one is dropped', async () => {
    const pending: { answer: () => void }[] = []
    const { session, ofType, turn } = harness('context', (query) => {
      const handle = query as QueryHandle & { getContextUsage: (opts?: { detail?: 'summary' | 'full' }) => Promise<unknown> }
      const real = handle.getContextUsage.bind(handle)
      handle.getContextUsage = (opts) => {
        const answer = real(opts)
        return new Promise((done) => pending.push({ answer: () => done(answer) }))
      }
      return handle
    })
    await vi.waitFor(() => expect(session.state).toBe('idle'))
    await turn('one')
    await turn('two')
    expect(pending).toHaveLength(2)
    // The newer answer (75 %) first, then the older one (10 %): the meter stays at 75 %.
    pending[1]?.answer()
    await vi.waitFor(() => expect(ofType('context')).toHaveLength(1))
    pending[0]?.answer()
    await new Promise((done) => setTimeout(done, 50))
    expect(ofType('context').map((event) => event.usage?.percentage)).toEqual([75])
  })

  it('an answer that arrives after the Session closed is dropped', async () => {
    const pending: (() => void)[] = []
    const { session, ofType, turn } = harness('context', (query) => {
      const handle = query as QueryHandle & { getContextUsage: (opts?: { detail?: 'summary' | 'full' }) => Promise<unknown> }
      const real = handle.getContextUsage.bind(handle)
      handle.getContextUsage = (opts) => {
        const answer = real(opts)
        return new Promise((done) => pending.push(() => done(answer)))
      }
      return handle
    })
    await vi.waitFor(() => expect(session.state).toBe('idle'))
    await turn('one')
    expect(pending).toHaveLength(1)
    session.close()
    pending[0]?.()
    await new Promise((done) => setTimeout(done, 50))
    expect(ofType('context')).toEqual([])
  })
})
