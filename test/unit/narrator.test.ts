// The narrator of a Product Session's turn (src/main/agent/narrator.ts, worfy-product-session ticket 32): when it asks
// Haiku for a line, what it sends, and what the window gets. Every request goes to the fake agent
// (src/main/agent/fake-query.ts) through the Claude driver's narratorAskOver: never a real model.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeReleases, fakeQueryFactory, type FakeCall } from '../../src/main/agent/fake-query'
import {
  NARRATOR_DIGEST_MAX,
  NARRATOR_EVERY_MS,
  NARRATOR_FIRST_MS,
  NARRATOR_KEEP,
  NARRATOR_LINE_MAX,
  Narrator,
  narratorDigest,
  narratorLine,
  type NarratorClock,
} from '../../src/main/agent/narrator'
import { narratorAskOver } from '../../src/main/vendors/claude/narrator'
import type { AgentEvent } from '../../src/shared/agent/events'

const result = (text: string) =>
  JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: text,
    total_cost_usd: 0.0001,
    duration_ms: 300,
    duration_api_ms: 250,
    num_turns: 1,
    usage: { input_tokens: 900, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    session_id: '{{session}}',
  })

/** The scripts the fake agent plays for the narrator: one request each. */
const SCRIPTS: Record<string, string[]> = {
  'line-a': ['{"fake":"wait_message"}', result('Reads the roadmap draft to weigh it against the critic')],
  'line-b': ['{"fake":"wait_message"}', result('"Compares three sources on competitor prices to size the niche"')],
  'line-c': ['{"fake":"wait_message"}', result('Writes the summary of the niche for the owner')],
  'line-d': ['{"fake":"wait_message"}', result('Checks the open questions on the Mind map')],
  held: ['{"fake":"wait_message"}', '{"fake":"wait_release","name":"answer"}', result('A line that comes late')],
  limited: [
    '{"fake":"wait_message"}',
    JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['rate_limit_error'], total_cost_usd: 0, duration_ms: 10, duration_api_ms: 0, num_turns: 0, usage: {}, session_id: '{{session}}' }),
  ],
  crash: ['{"fake":"wait_message"}', '{"fake":"crash","error":"no access to claude-haiku"}'],
}

/** A clock the test moves by hand; its timers fire as it passes them. */
class ManualClock implements NarratorClock {
  time = 1_000_000
  private timers: { at: number; run: () => void }[] = []
  now(): number {
    return this.time
  }
  setTimeout(run: () => void, ms: number): unknown {
    const timer = { at: this.time + ms, run }
    this.timers.push(timer)
    return timer
  }
  clearTimeout(timer: unknown): void {
    this.timers = this.timers.filter((each) => each !== timer)
  }
  /** Moves the time on by `ms`, firing each timer due on the way. */
  advance(ms: number): void {
    const end = this.time + ms
    for (;;) {
      const due = this.timers.filter((timer) => timer.at <= end).sort((a, b) => a.at - b.at)[0]
      if (due === undefined) break
      this.timers = this.timers.filter((timer) => timer !== due)
      this.time = Math.max(this.time, due.at)
      due.run()
    }
    this.time = end
  }
}

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'worfy-narrator-'))
  for (const [name, lines] of Object.entries(SCRIPTS)) await writeFile(join(dir, `${name}.jsonl`), `${lines.join('\n')}\n`)
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

/** A narrator over the fake agent, playing `scripts` one per request (the last one again once they run out). */
function harness(scripts: string[], options: { enabled?: () => boolean; deaf?: boolean } = {}) {
  const calls: FakeCall[] = []
  const emitted: string[][] = []
  const firsts: number[] = []
  const logged: string[] = []
  const releases = new FakeReleases()
  let next = 0
  const fake = fakeQueryFactory({
    scriptsDir: dir,
    script: () => scripts[Math.min(next++, scripts.length - 1)]!,
    record: (call) => calls.push(call),
    releases,
  })
  const clock = new ManualClock()
  const ask = narratorAskOver(fake, join(dir, 'narrator'))
  const narrator = new Narrator({
    // `deaf`: a request that does not hear the stop, as Claude Code may answer just before it goes.
    ask: options.deaf === true ? (digest) => ask(digest, new AbortController().signal) : ask,
    enabled: options.enabled ?? (() => true),
    emit: (lines, first) => {
      emitted.push([...lines])
      firsts.push(first)
    },
    log: (message) => logged.push(message),
    clock,
  })
  const starts = () => calls.filter((call) => call.kind === 'start')
  const digests = () => calls.flatMap((call) => (call.kind === 'message' ? [call.text] : []))
  const send = (...events: AgentEvent[]) => {
    for (const event of events) narrator.event(event)
  }
  return { narrator, clock, calls, starts, digests, emitted, firsts, logged, releases, send }
}

const prompt = (text = 'How big is the niche of small teams?'): AgentEvent => ({ type: 'prompt', text })
const busy: AgentEvent = { type: 'state', state: 'busy', error: null }
const read = (id: string, file = '/repo/docs/product/roadmap/map.md'): AgentEvent => ({ type: 'tool_use', id, name: 'Read', input: { file_path: file }, parentToolUseId: null })
const answered = (id: string): AgentEvent => ({ type: 'tool_result', toolUseId: id, content: 'ok', isError: false, parentToolUseId: null })
const thinking = (text: string): AgentEvent => ({ type: 'thinking', text, messageId: 'm1', parentToolUseId: null })
const turnResult = (interrupted = false): AgentEvent => ({
  type: 'result',
  subtype: interrupted ? 'error_during_execution' : 'success',
  isError: interrupted,
  error: null,
  text: interrupted ? null : 'The answer.',
  costUsd: 0,
  durationMs: 1,
  numTurns: 1,
  usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
  terminalReason: null,
  interrupted,
})

describe('the narrator’s cadence', () => {
  it('asks nothing before the turn has run 20 s, then once with what the turn did', async () => {
    const h = harness(['line-a'])
    h.send(prompt(), busy, read('t1'))
    h.clock.advance(NARRATOR_FIRST_MS - 1)
    await Promise.resolve()
    expect(h.starts()).toHaveLength(0)
    h.clock.advance(1)
    await vi.waitFor(() => expect(h.emitted).toEqual([['Reads the roadmap draft to weigh it against the critic']]))
    expect(h.starts()).toHaveLength(1)
    // Haiku, through the same fake Claude Code a Session would start.
    expect(h.starts()[0]).toMatchObject({ kind: 'start', resume: null, settings: { model: 'haiku' } })
    const [digest] = h.digests()
    expect(digest).toContain('How big is the niche of small teams?')
    expect(digest).toContain('Read: {"file_path":"/repo/docs/product/roadmap/map.md"}')
  })

  it('asks at most once per 30 s, only when new events came, and keeps the last three lines', async () => {
    const h = harness(['line-a', 'line-b', 'line-c', 'line-d'])
    h.send(prompt(), busy, read('t1'))
    h.clock.advance(NARRATOR_FIRST_MS)
    await vi.waitFor(() => expect(h.emitted).toHaveLength(1))

    // New events at once: still no second request before 30 s from the first.
    h.send(answered('t1'), thinking('The niche looks small; I should compare the prices of three competitors.'))
    h.clock.advance(NARRATOR_EVERY_MS - 1)
    await Promise.resolve()
    expect(h.starts()).toHaveLength(1)
    h.clock.advance(1)
    await vi.waitFor(() => expect(h.emitted).toHaveLength(2))
    // The model's quotes go; the previous line goes into the digest so it is not said again.
    expect(h.emitted[1]).toEqual(['Reads the roadmap draft to weigh it against the critic', 'Compares three sources on competitor prices to size the niche'])
    expect(h.digests()[1]).toContain('Your previous lines, oldest first:\n- Reads the roadmap draft to weigh it against the critic')
    expect(h.digests()[1]).toContain('thinking: The niche looks small')

    // Nothing new: no request, however long the turn goes on.
    h.clock.advance(5 * NARRATOR_EVERY_MS)
    await Promise.resolve()
    expect(h.starts()).toHaveLength(2)

    // An event after the 30 s asks at once.
    h.send(read('t2', '/repo/docs/product/pricing.md'))
    await vi.waitFor(() => expect(h.emitted).toHaveLength(3))
    h.send(read('t3', '/repo/docs/product/questions.md'))
    h.clock.advance(NARRATOR_EVERY_MS)
    await vi.waitFor(() => expect(h.emitted).toHaveLength(4))
    expect(h.emitted[3]).toHaveLength(NARRATOR_KEEP)
    expect(h.emitted[3]).toEqual(['Compares three sources on competitor prices to size the niche', 'Writes the summary of the niche for the owner', 'Checks the open questions on the Mind map'])
    // Each line keeps its number in the turn as the oldest goes: the window keeps its element (Narration.tsx).
    expect(h.firsts).toEqual([0, 0, 0, 1])
  })

  it('never has two requests out at once', async () => {
    const h = harness(['held', 'line-b'])
    h.send(prompt(), busy, read('t1'))
    h.clock.advance(NARRATOR_FIRST_MS)
    await vi.waitFor(() => expect(h.digests()).toHaveLength(1))
    // The first request hangs; new events and a long wait make no second one.
    h.send(answered('t1'), read('t2'))
    h.clock.advance(3 * NARRATOR_EVERY_MS)
    h.send(answered('t2'))
    await Promise.resolve()
    expect(h.starts()).toHaveLength(1)
    // Its answer comes: the next request goes at once, as 30 s have passed and events came.
    h.releases.release('answer')
    await vi.waitFor(() => expect(h.emitted).toEqual([['A line that comes late'], ['A line that comes late', 'Compares three sources on competitor prices to size the niche']]))
    expect(h.starts()).toHaveLength(2)
  })

  it.each([
    ['the result', [turnResult()]],
    ['Interrupt', [turnResult(true)]],
    ['an error', [{ type: 'state', state: 'error', error: 'Claude Code crashed' } satisfies AgentEvent]],
  ])('stops at %s: the lines go, the request out is dropped and nothing more is asked', async (_name, end) => {
    const h = harness(['line-a', 'held', 'line-c'])
    h.send(prompt(), busy, read('t1'))
    h.clock.advance(NARRATOR_FIRST_MS)
    await vi.waitFor(() => expect(h.emitted).toHaveLength(1))
    h.send(answered('t1'))
    h.clock.advance(NARRATOR_EVERY_MS)
    await vi.waitFor(() => expect(h.digests()).toHaveLength(2))

    h.send(...(end as AgentEvent[]))
    expect(h.emitted.at(-1)).toEqual([])
    // A late answer is dropped: it would have been a third emit.
    h.releases.release('answer')
    h.send(read('t9'))
    h.clock.advance(5 * NARRATOR_EVERY_MS)
    await new Promise((resolve) => setImmediate(resolve))
    expect(h.emitted).toEqual([['Reads the roadmap draft to weigh it against the critic'], []])
    expect(h.starts()).toHaveLength(2)
    expect(h.logged).toEqual([])
  })

  it('drops an answer that comes after the turn ended, even from a request that did not stop', async () => {
    const h = harness(['held', 'line-b'], { deaf: true })
    h.send(prompt(), busy, read('t1'))
    h.clock.advance(NARRATOR_FIRST_MS)
    await vi.waitFor(() => expect(h.digests()).toHaveLength(1))
    h.send(turnResult())
    h.releases.release('answer')
    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setImmediate(resolve))
    expect(h.emitted).toEqual([])
    // The next turn still gets its own lines.
    h.send(prompt('And the price?'), busy, read('t2'))
    h.clock.advance(NARRATOR_FIRST_MS)
    await vi.waitFor(() => expect(h.emitted).toEqual([['Compares three sources on competitor prices to size the niche']]))
  })

  it('a new turn that waited for the last turn’s request asks as soon as that request is done', async () => {
    const h = harness(['held', 'line-b'], { deaf: true })
    h.send(prompt(), busy, read('t1'))
    h.clock.advance(NARRATOR_FIRST_MS)
    await vi.waitFor(() => expect(h.digests()).toHaveLength(1))
    h.send(turnResult(), prompt('And the price?'), busy, read('t2'))
    // The new turn's first request is due, but the old one is still out.
    h.clock.advance(NARRATOR_FIRST_MS)
    await Promise.resolve()
    expect(h.starts()).toHaveLength(1)
    // It ends, and nothing new happens in the turn: the new turn asks all the same.
    h.releases.release('answer')
    await vi.waitFor(() => expect(h.emitted).toEqual([['Compares three sources on competitor prices to size the niche']]))
    expect(h.digests()[1]).toContain('And the price?')
  })

  it('does not show an answer that comes after the live summary was turned off', async () => {
    let on = true
    const h = harness(['held'], { enabled: () => on })
    h.send(prompt(), busy, read('t1'))
    h.clock.advance(NARRATOR_FIRST_MS)
    await vi.waitFor(() => expect(h.digests()).toHaveLength(1))
    on = false
    h.releases.release('answer')
    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setImmediate(resolve))
    expect(h.emitted).toEqual([])
    expect(h.logged).toEqual([])
  })

  it('asks nothing while the live summary is off, and asks again once it is on', async () => {
    let on = false
    const h = harness(['line-a'], { enabled: () => on })
    h.send(prompt(), busy, read('t1'))
    h.clock.advance(NARRATOR_FIRST_MS)
    for (let step = 0; step < 6; step += 1) {
      h.send(answered(`t${step}`), read(`t${step + 1}`))
      h.clock.advance(NARRATOR_EVERY_MS)
    }
    await Promise.resolve()
    expect(h.starts()).toHaveLength(0)
    expect(h.emitted).toEqual([])
    on = true
    h.clock.advance(NARRATOR_EVERY_MS)
    h.send(read('t9'))
    await vi.waitFor(() => expect(h.emitted).toEqual([['Reads the roadmap draft to weigh it against the critic']]))
  })

  it.each([
    ['an error result (a Limit)', 'limited', /error_during_execution: rate_limit_error/u],
    ['a crash (no Haiku for this login)', 'crash', /no access to claude-haiku/u],
  ])('stays silent for the rest of the turn after %s, saying so only in the log', async (_name, script, reason) => {
    const h = harness([script, 'line-a'])
    h.send(prompt(), busy, read('t1'))
    h.clock.advance(NARRATOR_FIRST_MS)
    await vi.waitFor(() => expect(h.logged).toHaveLength(1))
    expect(h.logged[0]).toMatch(reason)
    h.send(answered('t1'), read('t2'))
    h.clock.advance(3 * NARRATOR_EVERY_MS)
    h.send(answered('t2'))
    await Promise.resolve()
    expect(h.starts()).toHaveLength(1)
    expect(h.emitted).toEqual([])

    // The next turn asks again.
    h.send(turnResult(), prompt('And the price?'), busy, read('t3'))
    h.clock.advance(NARRATOR_FIRST_MS)
    await vi.waitFor(() => expect(h.emitted).toEqual([['Reads the roadmap draft to weigh it against the critic']]))
  })

  it('asks nothing once the Session is closed', async () => {
    const h = harness(['line-a'])
    h.send(prompt(), busy, read('t1'), { type: 'state', state: 'closed', error: null })
    h.clock.advance(NARRATOR_FIRST_MS)
    h.send(prompt(), read('t2'))
    h.clock.advance(NARRATOR_FIRST_MS)
    await Promise.resolve()
    expect(h.starts()).toHaveLength(0)
  })
})

describe('narratorDigest', () => {
  it('cuts each part short, leaves the oldest out and stays under the cap', () => {
    const digest = narratorDigest({
      prompt: `Find the niche ${'x'.repeat(5_000)}`,
      elapsedMs: 42_400,
      calls: Array.from({ length: 30 }, (_, index) => ({ name: `Tool${index}`, input: `{"query":"${'q'.repeat(1_000)}"}`, subagent: index === 29 })),
      snippets: Array.from({ length: 10 }, (_, index) => ({ kind: index % 2 === 0 ? ('thinking' as const) : ('text' as const), text: `snippet ${index} ${'s'.repeat(2_000)}` })),
      lines: ['Reads the roadmap', 'Compares prices'],
    })
    expect(digest.length).toBeLessThanOrEqual(NARRATOR_DIGEST_MAX)
    expect(digest).toContain('Seconds since the turn began: 42')
    expect(digest).toMatch(/The user message:\nFind the niche x+…/u)
    // The latest call and the previous lines stay; the oldest calls go first after the snippets.
    expect(digest).toContain('Tool29 (in a Subagent): {"query":"')
    expect(digest).not.toContain('Tool0:')
    expect(digest).toContain('- Reads the roadmap\n- Compares prices')
    for (const line of digest.split('\n')) expect(line.length).toBeLessThanOrEqual(820)
  })

  it('is cut to the cap even when what it may not leave out is longer', () => {
    const lines = Array.from({ length: 80 }, (_, index) => `Line ${index} ${'l'.repeat(200)}`)
    const digest = narratorDigest({ prompt: 'Hi', elapsedMs: 0, calls: [], snippets: [], lines })
    expect(digest).toHaveLength(NARRATOR_DIGEST_MAX)
  })

  it('says nothing of a part the turn has not got yet', () => {
    const digest = narratorDigest({ prompt: 'Hi', elapsedMs: 0, calls: [], snippets: [], lines: [] })
    expect(digest).toBe('The user message:\nHi\n\nSeconds since the turn began: 0')
  })
})

describe('narratorLine', () => {
  it('keeps the first line without quotes or a list mark, 120 characters at most', () => {
    // A line in the user's language (Russian here), as the model answers a Russian message.
    expect(narratorLine('\n  - «Сравнивает три источника о ценах конкурентов»\nmore')).toBe('Сравнивает три источника о ценах конкурентов')
    const long = narratorLine('a'.repeat(300))
    expect(long).toHaveLength(NARRATOR_LINE_MAX)
    expect(long.endsWith('…')).toBe(true)
    expect(narratorLine('   \n ')).toBe('')
  })
})
