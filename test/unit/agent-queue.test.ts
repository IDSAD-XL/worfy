// The message queue of a Session (src/main/agent/queue.ts): what the user sends while a turn runs
// waits in main and goes to Claude Code one message per turn, after each `result`.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeQueryFactory, type FakeCall } from '../../src/main/agent/fake-query'
import { MessageQueue } from '../../src/main/agent/queue'
import { SessionRegistry, type QueryRequest, type Session } from '../../src/main/agent/session'
import type { AgentEvent } from '../../src/shared/agent/events'

const scriptsDir = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'fixtures', 'agent-scripts')

let cwd: string

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'worfy-queue-'))
})

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

/** One timeline of what the Session reported and what reached the fake Claude Code. */
type Entry = { at: 'event'; event: AgentEvent } | { at: 'agent'; call: FakeCall }

function harness(script: string | ((request: QueryRequest) => string), dir = scriptsDir) {
  const timeline: Entry[] = []
  const registry = new SessionRegistry(fakeQueryFactory({ scriptsDir: dir, script, record: (call) => timeline.push({ at: 'agent', call }) }))
  const session: Session = registry.start(cwd, undefined, (_id, event) => timeline.push({ at: 'event', event }))
  const events = () => timeline.flatMap((entry) => (entry.at === 'event' ? [entry.event] : []))
  const results = () => events().filter((event) => event.type === 'result')
  /** The texts Claude Code got, in order. */
  const received = () => timeline.flatMap((entry) => (entry.at === 'agent' && entry.call.kind === 'message' ? [entry.call.text] : []))
  const lastQueue = () => events().findLast((event) => event.type === 'queue')
  return { registry, session, timeline, events, results, received, lastQueue }
}

const idle = (session: Session) => vi.waitFor(() => expect(session.state).toBe('idle'))

describe('MessageQueue', () => {
  it('hands out messages in the order they were added, skips removed ones, and holds them while paused', () => {
    const changes: unknown[] = []
    const queue = new MessageQueue((snapshot) => changes.push(snapshot))
    const a = queue.add('a')
    const b = queue.add('b')
    queue.add('c')
    expect(queue.remove(b.id)).toBe(true)
    expect(queue.remove(b.id)).toBe(false)
    queue.pause()
    expect(queue.take()).toBeUndefined()
    expect(queue.snapshot()).toEqual({ items: [a, expect.objectContaining({ text: 'c' })], paused: true })
    queue.resume()
    expect(queue.take()?.text).toBe('a')
    expect(queue.take()?.text).toBe('c')
    expect(queue.take()).toBeUndefined()
    // Every change is reported, with a copy the queue does not change later.
    expect(changes.length).toBeGreaterThanOrEqual(7)
    expect(changes.at(-1)).toEqual({ items: [], paused: false })
  })

  it('a held queue that was emptied by removing its messages is no longer held', () => {
    const queue = new MessageQueue(() => {})
    const held = queue.add('held')
    queue.pause()
    expect(queue.remove(held.id)).toBe(true)
    expect(queue.snapshot()).toEqual({ items: [], paused: false })
    queue.add('later')
    expect(queue.take()?.text).toBe('later')
  })

  it('gives every message its own id, even for the same text', () => {
    const queue = new MessageQueue(() => {})
    expect(queue.add('same').id).not.toBe(queue.add('same').id)
  })
})

describe('Session queue', () => {
  it('sends three messages written during a turn one by one, each after the previous result, in order', async () => {
    const h = harness('turn')
    await idle(h.session)
    expect(h.session.send('first')).toBe('sent')
    expect(h.session.send('one')).toBe('queued')
    expect(h.session.send('two')).toBe('queued')
    expect(h.session.send('three')).toBe('queued')
    expect(h.lastQueue()).toMatchObject({ items: [{ text: 'one' }, { text: 'two' }, { text: 'three' }], paused: false })

    await vi.waitFor(() => expect(h.results()).toHaveLength(4))
    await idle(h.session)
    expect(h.received()).toEqual(['first', 'one', 'two', 'three'])
    // Each message reached Claude Code only after the turn before it ended.
    const order = h.timeline.flatMap((entry) =>
      entry.at === 'agent' && entry.call.kind === 'message' ? [`sent ${entry.call.text}`] : entry.at === 'event' && entry.event.type === 'result' ? ['result'] : [],
    )
    expect(order).toEqual(['sent first', 'result', 'sent one', 'result', 'sent two', 'result', 'sent three', 'result'])
    // The transcript gets each prompt when it goes, not when it was queued.
    expect(h.events().flatMap((event) => (event.type === 'prompt' ? [event.text] : []))).toEqual(['first', 'one', 'two', 'three'])
    expect(h.lastQueue()).toEqual({ type: 'queue', items: [], paused: false })
    h.registry.closeAll()
  })

  it('never sends a message removed from the queue', async () => {
    const h = harness('turn')
    await idle(h.session)
    h.session.send('first')
    h.session.send('keep')
    h.session.send('drop')
    const drop = h.session.queued().items.find((item) => item.text === 'drop')
    expect(h.session.removeQueued(drop?.id ?? '')).toBe(true)
    expect(h.session.removeQueued('no-such-id')).toBe(false)
    await vi.waitFor(() => expect(h.results()).toHaveLength(2))
    await idle(h.session)
    expect(h.received()).toEqual(['first', 'keep'])
    expect(h.events().some((event) => event.type === 'prompt' && event.text === 'drop')).toBe(false)
    h.registry.closeAll()
  })

  it('Interrupt stops the turn and the queue: nothing goes by itself until Send queued', async () => {
    const h = harness('interrupt')
    await idle(h.session)
    h.session.send('count to ten')
    h.session.send('later one')
    h.session.send('later two')
    await vi.waitFor(() => expect(h.events().some((event) => event.type === 'delta')).toBe(true))
    expect(await h.session.interrupt()).toBe(true)
    await vi.waitFor(() => expect(h.results()).toHaveLength(1))
    await idle(h.session)
    // Give a queue that would wrongly go on its own the time to do it.
    await new Promise((settle) => setTimeout(settle, 30))
    expect(h.received()).toEqual(['count to ten'])
    expect(h.lastQueue()).toMatchObject({ items: [{ text: 'later one' }, { text: 'later two' }], paused: true })

    h.session.sendQueued()
    await vi.waitFor(() => expect(h.received()).toEqual(['count to ten', 'later one']))
    expect(h.session.state).toBe('busy')
    // The queue runs again: the rest goes after this turn's result.
    expect(h.session.queued()).toMatchObject({ items: [{ text: 'later two' }], paused: false })
    expect(await h.session.interrupt()).toBe(true)
    await vi.waitFor(() => expect(h.results()).toHaveLength(2))
    await new Promise((settle) => setTimeout(settle, 30))
    expect(h.received()).toEqual(['count to ten', 'later one'])
    h.registry.closeAll()
  })

  it('a message sent while the queue is held after Interrupt goes straight to an idle Session', async () => {
    const h = harness('interrupt')
    await idle(h.session)
    h.session.send('count to ten')
    h.session.send('queued')
    await vi.waitFor(() => expect(h.events().some((event) => event.type === 'delta')).toBe(true))
    await h.session.interrupt()
    await idle(h.session)
    expect(h.session.send('direct')).toBe('sent')
    await vi.waitFor(() => expect(h.received()).toEqual(['count to ten', 'direct']))
    expect(h.session.queued()).toMatchObject({ items: [{ text: 'queued' }], paused: true })
    h.registry.closeAll()
  })

  it('removing the last held message lets the queue go again: what is queued during the next turn goes after its result', async () => {
    // One turn that waits for Interrupt, then a turn that ends by itself.
    const dir = await mkdtemp(join(tmpdir(), 'worfy-queue-scripts-'))
    try {
      const turns = await Promise.all(['interrupt', 'turn'].map((name) => readFile(join(scriptsDir, `${name}.jsonl`), 'utf8')))
      await writeFile(join(dir, 'interrupt-then-turn.jsonl'), turns.map((text) => text.trimEnd()).join('\n'))
      const h = harness('interrupt-then-turn', dir)
      await idle(h.session)
      h.session.send('count')
      h.session.send('held')
      await vi.waitFor(() => expect(h.events().some((event) => event.type === 'delta')).toBe(true))
      await h.session.interrupt()
      await idle(h.session)
      const held = h.session.queued().items[0]
      expect(held?.text).toBe('held')
      expect(h.session.removeQueued(held?.id ?? '')).toBe(true)
      expect(h.session.queued()).toEqual({ items: [], paused: false })

      expect(h.session.send('next')).toBe('sent')
      expect(h.session.send('later')).toBe('queued')
      await vi.waitFor(() => expect(h.received()).toEqual(['count', 'next', 'later']))
      expect(h.session.queued()).toEqual({ items: [], paused: false })
      h.registry.closeAll()
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })

  it('a crash holds the queue: a message sent to the Session in error goes, the queued ones wait for Send queued', async () => {
    const h = harness((request) => (request.resume === undefined ? 'crash' : 'turn'))
    await idle(h.session)
    expect(h.session.send('go')).toBe('sent')
    expect(h.session.send('waiting')).toBe('queued')
    await vi.waitFor(() => expect(h.session.state).toBe('error'))
    expect(h.session.queued()).toMatchObject({ items: [{ text: 'waiting' }], paused: true })

    expect(h.session.send('new')).toBe('sent')
    await vi.waitFor(() => expect(h.results()).toHaveLength(1))
    await idle(h.session)
    // Give a queue that would wrongly go on its own the time to do it.
    await new Promise((settle) => setTimeout(settle, 30))
    expect(h.received()).toEqual(['go', 'new'])
    expect(h.lastQueue()).toMatchObject({ items: [{ text: 'waiting' }], paused: true })

    h.session.sendQueued()
    await vi.waitFor(() => expect(h.received()).toEqual(['go', 'new', 'waiting']))
    h.registry.closeAll()
  })

  it('Send queued on a Session with nothing queued sends nothing', async () => {
    const h = harness('turn')
    await idle(h.session)
    h.session.sendQueued()
    await new Promise((settle) => setTimeout(settle, 20))
    expect(h.received()).toEqual([])
    expect(h.session.state).toBe('idle')
    h.registry.closeAll()
  })
})
