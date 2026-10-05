// The Card API bridge (ticket 26): the postMessage protocol of src/shared/cards/bridge.ts, the
// renderer's side that accepts a message only from its Card's own frame and origin
// (src/renderer/canvas/card-bridge.ts), the `cardApi` IPC channels (src/shared/ipc/card-api.ts), a
// Card's own data in the Project's data folder (src/main/cards/data.ts), `session.ask` behind the
// user's confirmation (src/main/cards/ask.ts) on Sessions of the fake agent, the read-only workflow
// snapshot, and the window.worfy script the worfy-card:// protocol puts into every Card
// (src/card-runtime/worfy-card.ts, src/main/cards/protocol.ts).
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installWorfyCard, type CardRuntimeHost, type WorfyCardApi } from '../../src/card-runtime/worfy-card'
import { fakeQueryFactory } from '../../src/main/agent/fake-query'
import { SessionRegistry, type QueryFactory } from '../../src/main/agent/session'
import { askMessage, CardAsk, lastEditorOf, type AskQuestion, type CardAskDeps } from '../../src/main/cards/ask'
import { CARD_DATA_DIR, CardDataStore } from '../../src/main/cards/data'
import { CARD_RUNTIME_SCRIPT, createCardHandler, injectCardRuntime } from '../../src/main/cards/protocol'
import { LayoutStore } from '../../src/main/layout/store'
import { canvasForSession, type CanvasDeps } from '../../src/main/mcp/canvas-server'
import { enrichSnapshot, parseEpicStatus } from '../../src/main/workflow/reader'
import { createCardBridge, type BridgeMessage, type CardBridgeBackend, type CardFrame } from '../../src/renderer/canvas/card-bridge'
import {
  ASK_TEXT_LIMIT,
  CARD_DATA_LIMIT_BYTES,
  CARD_OPS,
  CARD_TEXT_LIMIT,
  cardOriginOf,
  parseCardRequest,
  workflowSnapshot,
  workflowSnapshotSchema,
  type WorkflowSnapshot,
} from '../../src/shared/cards/bridge'
import * as cardApi from '../../src/shared/ipc/card-api'
import type { ChecksSnapshot } from '../../src/shared/ipc/checks'
import type { WorkflowModel } from '../../src/shared/workflow/types'

// protocol.ts registers the scheme with Electron; here only its pure parts and the handler run.
vi.mock('electron', () => ({ protocol: {} }))

const PROJECT = 'demo-0a1b2c3d'
const ORIGIN = 'worfy-card://c1.0a1b2c3d'
const OTHER_ORIGIN = 'worfy-card://c2.0a1b2c3d'

let scratch: string

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-card-bridge-')))
})

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

/** A frame's window that records what it is sent. */
function frameWindow() {
  const posted: { message: unknown; targetOrigin: string }[] = []
  return { posted, postMessage: (message: unknown, targetOrigin: string) => void posted.push({ message, targetOrigin }) }
}

/** A string of JSON whose compact form is exactly `bytes` long. */
const jsonOfBytes = (bytes: number): string => 'x'.repeat(bytes - 2)

const SNAPSHOT: WorkflowSnapshot = { epics: [{ epic: 'e', title: 'E' }], tickets: [], error: null }

/** A bridge over two Card frames and a backend that records its calls. */
function setup(backendOver: Partial<CardBridgeBackend> = {}) {
  const c1 = frameWindow()
  const c2 = frameWindow()
  const frames: CardFrame[] = [
    { cardId: 'c1', origin: ORIGIN, window: c1 },
    { cardId: 'c2', origin: OTHER_ORIGIN, window: c2 },
  ]
  const calls: unknown[][] = []
  const backend: CardBridgeBackend = {
    dataGet: (cardId) => {
      calls.push(['dataGet', cardId])
      return Promise.resolve({ saved: cardId })
    },
    dataSet: (cardId, value) => {
      calls.push(['dataSet', cardId, value])
      return Promise.resolve()
    },
    ask: (cardId, text) => {
      calls.push(['ask', cardId, text])
      return Promise.resolve({ sent: true })
    },
    workflow: () => {
      calls.push(['workflow'])
      return Promise.resolve(SNAPSHOT)
    },
    ...backendOver,
  }
  const bridge = createCardBridge({ frames: () => frames, backend, textTimeoutMs: 50 })
  const fromC1 = (data: unknown): BridgeMessage => ({ source: c1, origin: ORIGIN, data })
  /** What c1 was answered, by request id: an invalid request is answered at once, a valid one after the backend. */
  const answers = () =>
    c1.posted.map((each) => each.message as { requestId: string }).sort((a, b) => a.requestId.localeCompare(b.requestId))
  return { c1, c2, frames, calls, bridge, fromC1, answers }
}

const request = (op: string, args?: unknown, requestId = 'r1') => ({ type: 'worfy.request', requestId, op, ...(args === undefined ? {} : { args }) })

// ── the protocol ─────────────────────────────────────────────────────────────

describe('card bridge protocol: the operations', () => {
  it('has exactly these operations, and none of them writes the workflow', () => {
    expect([...CARD_OPS]).toEqual(['data.get', 'data.set', 'session.ask', 'workflow.get', 'workflow.subscribe'])
    expect(CARD_OPS.filter((op) => op.startsWith('workflow.'))).toEqual(['workflow.get', 'workflow.subscribe'])
    for (const op of ['workflow.set', 'ticket.claim', 'ticket.done', 'workflow.update', 'status.set']) {
      expect(parseCardRequest(request(op)).ok).toBe(false)
    }
  })

  it('main gets exactly three channels from the bridge: data get and set, and ask', () => {
    const channels = (Object.values(cardApi) as unknown[])
      .filter((value): value is { kind: string; name: string } => typeof value === 'object' && value !== null && 'kind' in value)
      .map((channel) => channel.name)
      .sort()
    expect(channels).toEqual(['cardApi.ask', 'cardApi.dataGet', 'cardApi.dataSet'])
  })

  const valid: Record<(typeof CARD_OPS)[number], unknown> = {
    'data.get': request('data.get'),
    'data.set': request('data.set', { value: { count: 3, items: ['a', null, true] } }),
    'session.ask': request('session.ask', { text: 'Ship ticket 07?' }),
    'workflow.get': request('workflow.get'),
    'workflow.subscribe': request('workflow.subscribe'),
  }

  it.each(CARD_OPS)('%s: a valid request is taken, and keys the protocol does not declare are dropped', (op) => {
    const message = valid[op] as Record<string, unknown>
    const withExtra = {
      ...message,
      extra: 'dropped',
      ...(message.args === undefined ? {} : { args: { ...(message.args as object), extra: 'dropped too' } }),
    }
    const parsed = parseCardRequest(withExtra)
    expect(parsed).toEqual({ ok: true, request: message })
    expect(JSON.stringify(parsed)).not.toContain('dropped')
  })

  it.each([
    ['data.get', request('data.get', 'not an object')],
    ['data.set', request('data.set', { value: undefined })],
    ['data.set', request('data.set', { value: new Date(0) })],
    ['data.set', request('data.set', {})],
    ['session.ask', request('session.ask', { text: 42 })],
    ['session.ask', request('session.ask', { text: '   ' })],
    ['session.ask', request('session.ask', { text: 'x'.repeat(ASK_TEXT_LIMIT + 1) })],
    ['workflow.get', { type: 'worfy.request', requestId: 7, op: 'workflow.get' }],
    ['workflow.subscribe', { type: 'worfy.request', requestId: '', op: 'workflow.subscribe' }],
  ])('%s: an invalid request is refused', (_op, message) => {
    expect(parseCardRequest(message).ok).toBe(false)
  })

  it('data.set: 1 MB of JSON is taken, one byte more is refused', () => {
    expect(parseCardRequest(request('data.set', { value: jsonOfBytes(CARD_DATA_LIMIT_BYTES) })).ok).toBe(true)
    const over = parseCardRequest(request('data.set', { value: jsonOfBytes(CARD_DATA_LIMIT_BYTES + 1) }))
    expect(over).toMatchObject({ ok: false, requestId: 'r1' })
    expect(!over.ok && over.error).toMatch(/1048576 bytes/)
    // Multi-byte characters count as bytes, not characters.
    expect(parseCardRequest(request('data.set', { value: 'ж'.repeat(CARD_DATA_LIMIT_BYTES / 2) })).ok).toBe(false)
  })

  it('a value nested too deep for the checker is refused, not thrown', () => {
    const deep: unknown[] = []
    let cursor = deep
    for (let index = 0; index < 50_000; index += 1) {
      const next: unknown[] = []
      cursor.push(next)
      cursor = next
    }
    expect(parseCardRequest(request('data.set', { value: deep })).ok).toBe(false)
  })

  it('finds the origin of a Card address, and nothing in other addresses', () => {
    expect(cardOriginOf('worfy-card://c1.0a1b2c3d/index.html')).toEqual({ origin: ORIGIN, cardId: 'c1' })
    expect(cardOriginOf('worfy-card://c1.0a1b2c3d')).toEqual({ origin: ORIGIN, cardId: 'c1' })
    for (const url of ['https://c1.0a1b2c3d/', 'worfy-card://c1.0a1b2c3d.evil/', 'worfy-card://C1.0a1b2c3d/', 'worfy-card://c1.xyz/', 'about:blank', '']) {
      expect(cardOriginOf(url)).toBeNull()
    }
  })
})

// ── the window's side: who may talk ─────────────────────────────────────────

describe('card bridge: who may talk to it', () => {
  it('ignores a message with a foreign origin, even from the Card frame itself', async () => {
    const { c1, calls, bridge } = setup()
    expect(bridge.receive({ source: c1, origin: OTHER_ORIGIN, data: request('data.get') })).toBe(false)
    expect(bridge.receive({ source: c1, origin: 'https://example.com', data: request('data.get') })).toBe(false)
    expect(bridge.receive({ source: c1, origin: 'null', data: request('data.get') })).toBe(false)
    await tick()
    expect(calls).toEqual([])
    expect(c1.posted).toEqual([])
  })

  it('ignores a message from a frame that is not a Card frame, even with a Card origin', async () => {
    const { calls, bridge, c1 } = setup()
    const stranger = frameWindow()
    expect(bridge.receive({ source: stranger, origin: ORIGIN, data: request('data.get') })).toBe(false)
    expect(bridge.receive({ source: null, origin: ORIGIN, data: request('data.get') })).toBe(false)
    await tick()
    expect(calls).toEqual([])
    expect(stranger.posted).toEqual([])
    expect(c1.posted).toEqual([])
  })

  it('a Card cannot speak for another Card: c2 with c1 origin is ignored, with its own origin it reads only its own data', async () => {
    const { c2, calls, bridge } = setup()
    expect(bridge.receive({ source: c2, origin: ORIGIN, data: request('data.get') })).toBe(false)
    await tick()
    expect(calls).toEqual([])
    expect(bridge.receive({ source: c2, origin: OTHER_ORIGIN, data: request('data.get') })).toBe(true)
    await tick()
    expect(calls).toEqual([['dataGet', 'c2']])
    expect(c2.posted).toEqual([{ message: { type: 'worfy.response', requestId: 'r1', ok: true, data: { saved: 'c2' } }, targetOrigin: OTHER_ORIGIN }])
  })

  it('answers an invalid request that names a request id with an error, and drops one that names none', async () => {
    const { bridge, fromC1, answers, calls } = setup()
    expect(bridge.receive(fromC1(request('data.set', { value: jsonOfBytes(CARD_DATA_LIMIT_BYTES + 1) })))).toBe(true)
    expect(bridge.receive(fromC1({ type: 'worfy.request', op: 'data.get' }))).toBe(false)
    expect(bridge.receive(fromC1('hello'))).toBe(false)
    expect(bridge.receive(fromC1({ type: 'something.else', requestId: 'r2' }))).toBe(false)
    await tick()
    expect(calls).toEqual([])
    expect(answers()).toHaveLength(1)
    expect(answers()[0]).toMatchObject({ type: 'worfy.response', requestId: 'r1', ok: false })
  })
})

// ── the window's side: each operation ────────────────────────────────────────

describe('card bridge: operations through the window', () => {
  it('data.get answers the Card its own data, to its own origin', async () => {
    const { bridge, fromC1, c1, calls } = setup()
    bridge.receive(fromC1(request('data.get')))
    await tick()
    expect(calls).toEqual([['dataGet', 'c1']])
    expect(c1.posted).toEqual([{ message: { type: 'worfy.response', requestId: 'r1', ok: true, data: { saved: 'c1' } }, targetOrigin: ORIGIN }])
  })

  it('data.set passes on the parsed value only, and a value over 1 MB never reaches the backend', async () => {
    const { bridge, fromC1, answers, calls } = setup()
    bridge.receive(fromC1({ ...request('data.set', { value: { n: 1 }, extra: 'no' }), more: 'no' }))
    bridge.receive(fromC1(request('data.set', { value: jsonOfBytes(CARD_DATA_LIMIT_BYTES + 1) }, 'r2')))
    bridge.receive(fromC1(request('data.set', { value: undefined }, 'r3')))
    await tick()
    expect(calls).toEqual([['dataSet', 'c1', { n: 1 }]])
    expect(answers()).toEqual([
      { type: 'worfy.response', requestId: 'r1', ok: true, data: null },
      expect.objectContaining({ requestId: 'r2', ok: false }),
      expect.objectContaining({ requestId: 'r3', ok: false }),
    ])
  })

  it('a backend failure becomes an error answer', async () => {
    const { bridge, fromC1, answers } = setup({ dataGet: () => Promise.reject(new Error('disk full')) })
    bridge.receive(fromC1(request('data.get')))
    await tick()
    expect(answers()).toEqual([{ type: 'worfy.response', requestId: 'r1', ok: false, error: 'disk full' }])
  })

  it('session.ask: sent → {sent: true}; the user said no → {ok: false, canceled: true}; an empty text never asks', async () => {
    let sent = true
    const { bridge, fromC1, answers, calls } = setup({
      ask: (cardId, text) => {
        calls.push(['ask', cardId, text])
        return Promise.resolve({ sent })
      },
    })
    bridge.receive(fromC1(request('session.ask', { text: 'first' }, 'r1')))
    await tick()
    sent = false
    bridge.receive(fromC1(request('session.ask', { text: 'second' }, 'r2')))
    bridge.receive(fromC1(request('session.ask', { text: '' }, 'r3')))
    await tick()
    expect(calls).toEqual([
      ['ask', 'c1', 'first'],
      ['ask', 'c1', 'second'],
    ])
    expect(answers()).toEqual([
      { type: 'worfy.response', requestId: 'r1', ok: true, data: { sent: true } },
      { type: 'worfy.response', requestId: 'r2', ok: false, canceled: true, error: 'The user did not send the message' },
      expect.objectContaining({ requestId: 'r3', ok: false }),
    ])
  })

  it('workflow.get answers the snapshot; workflow.subscribe also sends each new one, only to frames that subscribed and still exist', async () => {
    const { bridge, fromC1, c1, c2, frames } = setup()
    bridge.receive(fromC1(request('workflow.get', undefined, 'g')))
    await tick()
    bridge.publishWorkflow({ ...SNAPSHOT, error: 'not subscribed yet' })
    expect(c1.posted.map((each) => each.message)).toEqual([{ type: 'worfy.response', requestId: 'g', ok: true, data: SNAPSHOT }])

    bridge.receive(fromC1(request('workflow.subscribe', undefined, 's')))
    await tick()
    const next: WorkflowSnapshot = { epics: [], tickets: [], error: 'epic-status failed' }
    bridge.publishWorkflow(next)
    expect(c1.posted.slice(1)).toEqual([
      { message: { type: 'worfy.response', requestId: 's', ok: true, data: SNAPSHOT }, targetOrigin: ORIGIN },
      { message: { type: 'worfy.event', event: 'workflow', data: next }, targetOrigin: ORIGIN },
    ])
    expect(c2.posted).toEqual([])

    // The Card's frame is gone (zoomed out, removed): nothing more is sent to it.
    frames.splice(0, 1)
    bridge.publishWorkflow(SNAPSHOT)
    expect(c1.posted).toHaveLength(3)
  })
})

describe('card bridge: card.text, worfy asking a Card', () => {
  it('gets the visible text from that Card only, cut to the limit; another frame cannot answer for it', async () => {
    const { bridge, c1, c2 } = setup()
    const text = bridge.cardText('c1')
    expect(c1.posted).toEqual([{ message: { type: 'worfy.request', requestId: 'w1', op: 'card.text' }, targetOrigin: ORIGIN }])
    const answer = (data: unknown) => ({ type: 'worfy.response', requestId: 'w1', ok: true, data })
    expect(bridge.receive({ source: c2, origin: OTHER_ORIGIN, data: answer({ text: 'forged' }) })).toBe(true)
    bridge.receive({ source: c1, origin: ORIGIN, data: answer({ text: 'y'.repeat(CARD_TEXT_LIMIT + 10), extra: 1 }) })
    expect(await text).toBe('y'.repeat(CARD_TEXT_LIMIT))
  })

  it('answers null for a Card without a frame, or one that does not answer in time', async () => {
    const { bridge } = setup()
    expect(await bridge.cardText('nope')).toBeNull()
    expect(await bridge.cardText('c1')).toBeNull()
  })
})

// ── the IPC channels ─────────────────────────────────────────────────────────

describe('cardApi channels', () => {
  const card = { projectId: PROJECT, cardId: 'c1' }

  it('dataGet / dataSet / ask take a valid call and drop keys they do not declare', () => {
    expect(cardApi.cardApiDataGet.input.parse({ ...card, extra: 1 })).toEqual(card)
    expect(cardApi.cardApiDataSet.input.parse({ ...card, value: { a: 1 }, extra: 1 })).toEqual({ ...card, value: { a: 1 } })
    expect(cardApi.cardApiAsk.input.parse({ ...card, text: 'hi', extra: 1 })).toEqual({ ...card, text: 'hi' })
    expect(cardApi.cardApiAsk.output.parse({ sent: true, recipient: 'session', extra: 1 })).toEqual({ sent: true, recipient: 'session' })
  })

  it('refuses a wrong Card id, data over 1 MB, data that is not JSON, and an empty or long text', () => {
    expect(cardApi.cardApiDataGet.input.safeParse({ ...card, cardId: '../c1' }).success).toBe(false)
    expect(cardApi.cardApiDataSet.input.safeParse({ ...card, value: jsonOfBytes(CARD_DATA_LIMIT_BYTES + 1) }).success).toBe(false)
    expect(cardApi.cardApiDataSet.input.safeParse({ ...card, value: jsonOfBytes(CARD_DATA_LIMIT_BYTES) }).success).toBe(true)
    expect(cardApi.cardApiDataSet.input.safeParse({ ...card, value: new Map() }).success).toBe(false)
    expect(cardApi.cardApiAsk.input.safeParse({ ...card, text: '' }).success).toBe(false)
    expect(cardApi.cardApiAsk.input.safeParse({ ...card, text: 'x'.repeat(ASK_TEXT_LIMIT + 1) }).success).toBe(false)
  })
})

// ── main: a Card's own data ──────────────────────────────────────────────────

describe('card data in the Project data folder', () => {
  const dataDir = () => join(scratch, 'data')
  const store = () => new CardDataStore((projectId) => {
    if (projectId !== PROJECT) throw new Error(`unknown Project ${projectId}`)
    return join(dataDir(), projectId)
  })

  it('keeps each Card its own JSON in <Project data folder>/card-data/<id>.json, and a new store reads it back', () => {
    expect(store().get(PROJECT, 'c1')).toBeNull()
    expect(store().set(PROJECT, 'c1', { count: 2, list: ['ж'] })).toBe(Buffer.byteLength(JSON.stringify({ count: 2, list: ['ж'] })))
    store().set(PROJECT, 'c2', 'other')
    expect(readdirSync(join(dataDir(), PROJECT, CARD_DATA_DIR)).sort()).toEqual(['c1.json', 'c2.json'])
    expect(store().get(PROJECT, 'c1')).toEqual({ count: 2, list: ['ж'] })
    expect(store().get(PROJECT, 'c2')).toBe('other')
    store().set(PROJECT, 'c1', null)
    expect(store().get(PROJECT, 'c1')).toBeNull()
  })

  it('refuses data over 1 MB without writing anything, and refuses a bad Card id or an unknown Project', () => {
    expect(() => store().set(PROJECT, 'c1', jsonOfBytes(CARD_DATA_LIMIT_BYTES + 1))).toThrow(/refusing to write/)
    expect(existsSync(join(dataDir(), PROJECT, CARD_DATA_DIR, 'c1.json'))).toBe(false)
    expect(() => store().set(PROJECT, '../c1', 1)).toThrow(/not a valid Card id/)
    expect(() => store().get('other-0000000f', 'c1')).toThrow(/unknown Project/)
  })
})

// ── main: session.ask ────────────────────────────────────────────────────────

describe('session.ask', () => {
  function deps(over: Partial<CardAskDeps> & { confirmAnswer?: boolean } = {}) {
    const questions: AskQuestion[] = []
    const sent: { sessionId: string; text: string }[] = []
    const result: CardAskDeps = {
      nodes: () => [{ id: 'c1', kind: 'card', x: 0, y: 0, w: 1, h: 1, hidden: false, locked: false, pinned: false, tags: [], data: { lastEditor: 'sdk-b' } }],
      sessions: () => [
        { sessionId: 'sdk-a', sdkSessionId: 'sdk-a', cwd: '/', state: 'idle' },
        { sessionId: 'sdk-b', sdkSessionId: 'sdk-b', cwd: '/', state: 'idle' },
      ],
      orchestrator: () => Promise.resolve('orch'),
      cardTitle: () => Promise.resolve('Clock'),
      confirm: (question) => {
        questions.push(question)
        return Promise.resolve(over.confirmAnswer ?? true)
      },
      send: (sessionId, text) => void sent.push({ sessionId, text }),
      ...over,
    }
    return { deps: result, questions, sent }
  }

  it('without "Send" nothing reaches any Session; the dialog named the Card, the recipient and the text', async () => {
    const { deps: d, questions, sent } = deps({ confirmAnswer: false })
    expect(await new CardAsk(d).ask(PROJECT, 'c1', 'Ship 07?')).toEqual({ sent: false, recipient: null })
    expect(sent).toEqual([])
    expect(questions).toEqual([
      {
        cardId: 'c1',
        cardTitle: 'Clock',
        recipient: { kind: 'session', sessionId: 'sdk-b', sdkSessionId: 'sdk-b' },
        recipientLabel: 'Session sdk-b, which last edited this Card',
        message: askMessage('Clock', 'c1', 'Ship 07?'),
      },
    ])
  })

  it('goes to the Orchestrator when the last editor is not live, or the Card has none', async () => {
    const closed = deps({ sessions: () => [{ sessionId: 'sdk-b', sdkSessionId: 'sdk-b', cwd: '/', state: 'closed' }] })
    expect(await new CardAsk(closed.deps).ask(PROJECT, 'c1', 'hi')).toEqual({ sent: true, recipient: 'orchestrator' })
    expect(closed.sent).toEqual([{ sessionId: 'orch', text: askMessage('Clock', 'c1', 'hi') }])
    expect(closed.questions[0]?.recipientLabel).toBe('the Orchestrator')

    const none = deps({ nodes: () => [] })
    expect(await new CardAsk(none.deps).ask(PROJECT, 'c1', 'hi')).toEqual({ sent: true, recipient: 'orchestrator' })
    expect(none.sent.map((each) => each.sessionId)).toEqual(['orch'])
  })

  it('shows one question per Card at a time', async () => {
    let release: (answer: boolean) => void = () => undefined
    const { deps: d, sent } = deps({ confirm: () => new Promise((resolve) => (release = resolve)) })
    const ask = new CardAsk(d)
    const first = ask.ask(PROJECT, 'c1', 'one')
    await tick()
    await expect(ask.ask(PROJECT, 'c1', 'two')).rejects.toThrow(/already has a question/)
    release(true)
    expect(await first).toEqual({ sent: true, recipient: 'session' })
    expect(sent.map((each) => each.text)).toEqual([askMessage('Clock', 'c1', 'one')])
  })

  it('reads the last editor from the Card Node only', () => {
    const node = (id: string, kind: string, data: Record<string, unknown>) => ({ id, kind, x: 0, y: 0, w: 1, h: 1, hidden: false, locked: false, pinned: false, tags: [], data })
    expect(lastEditorOf([node('c1', 'note', { lastEditor: 'x' })], 'c1')).toBeNull()
    expect(lastEditorOf([node('c1', 'card', { lastEditor: 7 })], 'c1')).toBeNull()
    expect(lastEditorOf([node('c1', 'card', { lastEditor: 'x' })], 'c1')).toBe('x')
  })

  it('with "Send", reaches exactly the Session that last edited the Card, on the fake agent', async () => {
    const repo = join(scratch, 'repo')
    const dataDir = join(scratch, 'data')
    const cardsDir = join(dataDir, PROJECT, 'cards')
    const scriptsDir = join(scratch, 'scripts')
    mkdirSync(repo)
    mkdirSync(cardsDir, { recursive: true })
    mkdirSync(scriptsDir)
    // Session A writes the Card first, then B: B is the last editor. Each turn ends; the Session waits for the next message.
    writeFileSync(join(scriptsDir, 'session-a.jsonl'), turnScript('a', `${cardsDir}/c1/index.html`))
    writeFileSync(join(scriptsDir, 'session-b.jsonl'), turnScript('b', `${cardsDir}/c1/app.js`))

    const layout = new LayoutStore((projectId) => join(dataDir, projectId), { write: () => undefined })
    layout.apply(PROJECT, { op: 'create', node: { id: 'c1', kind: 'card', x: 0, y: 0, w: 360, h: 280, data: {} } })
    const canvasDeps: CanvasDeps = {
      projects: () => [{ id: PROJECT, name: 'demo', path: repo }],
      dataDir: (projectId) => join(dataDir, projectId),
      layout,
      workflow: () => Promise.resolve({ epics: [], tickets: [], error: null }),
    }
    // The fake agent in place of Claude Code; it records every user message it is given.
    const received = new Map<string, string[]>()
    const fake = fakeQueryFactory({ scriptsDir, script: (request) => request.resume ?? 'none' })
    const factory: QueryFactory = async (request) => {
      const id = request.resume ?? 'none'
      const prompt: QueryRequest['prompt'] = {
        async *[Symbol.asyncIterator]() {
          for await (const message of request.prompt) {
            const content = message.message.content
            received.set(id, [...(received.get(id) ?? []), typeof content === 'string' ? content : JSON.stringify(content)])
            yield message
          }
        },
      }
      const query = await fake({ ...request, prompt })
      const canvas = await canvasForSession({ cwd: request.cwd, resume: request.resume }, canvasDeps)
      return canvas ? canvas.observe(query) : query
    }
    const registry = new SessionRegistry(factory)
    const turn = (sdkId: string) =>
      new Promise<void>((resolve) => {
        const session = registry.start(repo, sdkId, (_id, event) => {
          if (event.type === 'result') resolve()
        })
        session.send('write the card')
      })
    await turn('session-a')
    await turn('session-b')
    expect(lastEditorOf(layout.get(PROJECT).layout.nodes, 'c1')).toBe('session-b')

    let answer = false
    const ask = new CardAsk({
      nodes: (projectId) => layout.get(projectId).layout.nodes,
      sessions: () => registry.list(),
      orchestrator: () => Promise.reject(new Error('no Orchestrator in this test')),
      cardTitle: () => Promise.resolve('Clock'),
      confirm: () => Promise.resolve(answer),
      send: (sessionId, text) => registry.get(sessionId).send(text),
    })
    expect(await ask.ask(PROJECT, 'c1', 'Is 07 done?')).toEqual({ sent: false, recipient: null })
    await tick()
    expect(received.get('session-a')).toEqual(['write the card'])
    expect(received.get('session-b')).toEqual(['write the card'])

    answer = true
    expect(await ask.ask(PROJECT, 'c1', 'Is 07 done?')).toEqual({ sent: true, recipient: 'session' })
    await vi.waitFor(() => expect(received.get('session-b')).toEqual(['write the card', askMessage('Clock', 'c1', 'Is 07 done?')]))
    expect(received.get('session-a')).toEqual(['write the card'])
    registry.closeAll()
  })
})

type QueryRequest = Parameters<QueryFactory>[0]

/** One fake-agent turn that writes `file`: init, the Write tool call, the result. */
function turnScript(name: string, file: string): string {
  const lines = [
    { fake: 'wait_message' },
    { type: 'system', subtype: 'init', cwd: '{{cwd}}', session_id: '{{session}}', tools: [], mcp_servers: [], model: 'fake', permissionMode: 'bypassPermissions', apiKeySource: 'none', slash_commands: [], uuid: `${name}-1` },
    {
      type: 'assistant',
      message: { id: `msg-${name}`, type: 'message', role: 'assistant', content: [{ type: 'tool_use', id: `${name}-tool`, name: 'Write', input: { file_path: file, content: 'x' } }] },
      parent_tool_use_id: null,
      session_id: '{{session}}',
      uuid: `${name}-2`,
    },
    { type: 'result', subtype: 'success', is_error: false, result: 'done', total_cost_usd: 0, duration_ms: 1, num_turns: 1, session_id: '{{session}}', uuid: `${name}-3` },
  ]
  return lines.map((line) => JSON.stringify(line)).join('\n') + '\n'
}

// ── the workflow snapshot ────────────────────────────────────────────────────

describe('workflow snapshot', () => {
  async function fixtureModel(): Promise<WorkflowModel> {
    const root = join(scratch, 'repo')
    cpSync(join(import.meta.dirname, '../fixtures/worfy-mvp-epic'), join(root, '.scratch', 'worfy-mvp'), { recursive: true })
    const stdout = readFileSync(join(root, '.scratch', 'worfy-mvp', 'epic-status.json'), 'utf8')
    return { ...(await enrichSnapshot(root, parseEpicStatus(stdout))), branchErrors: [] }
  }

  it('gives the Tickets of the worfy-mvp Epic with blockers and Waves, read-only data and nothing else', async () => {
    const model = await fixtureModel()
    const snapshot = workflowSnapshot(model, undefined)
    expect(workflowSnapshotSchema.parse(snapshot)).toEqual(snapshot)
    expect(snapshot.epics).toEqual([{ epic: 'worfy-mvp', title: model.epics[0]?.title ?? null }])
    expect(snapshot.tickets).toHaveLength(33)
    expect(snapshot.tickets.every((ticket) => ticket.epic === 'worfy-mvp')).toBe(true)
    const t26 = snapshot.tickets.find((ticket) => ticket.num === 26)
    expect(t26).toMatchObject({ num: 26, state: 'open', blockedBy: [10, 17, 24, 25], wave: 9, gate: null, pr: null, ci: null })
    expect(t26?.title).toMatch(/^26 — API Карточки/)
    expect(snapshot.tickets.find((ticket) => ticket.num === 1)?.wave).toBe(1)
    // Only what the snapshot declares: no file lists, raw statuses or paths of the checkout.
    expect(Object.keys(t26 ?? {}).sort()).toEqual(['blockedBy', 'ci', 'epic', 'gate', 'num', 'pr', 'state', 'title', 'wave'])
    expect(JSON.stringify(snapshot)).not.toContain(model.root)
  })

  it('carries the gate of a Ticket worktree and the PR and CI of its branch', async () => {
    const model = await fixtureModel()
    const checks: ChecksSnapshot = {
      root: model.root,
      worktrees: [{ path: `${model.root}/.claude/worktrees/26`, branch: 'worfy-mvp/26', gate: { outcome: 'green', source: 'marker', at: null } }],
      pulls: [{ number: 30, url: 'https://github.com/x/y/pull/30', state: 'OPEN', branch: 'worfy-mvp/26', ci: 'running', verdict: null }],
      gh: { available: true, error: null, intervalMs: 60_000 },
    }
    const t26 = workflowSnapshot(model, checks).tickets.find((ticket) => ticket.num === 26)
    expect(t26).toMatchObject({ gate: 'green', pr: { number: 30, state: 'OPEN', url: 'https://github.com/x/y/pull/30' }, ci: 'running' })
    const offline = workflowSnapshot(model, { ...checks, gh: { available: false, error: 'offline', intervalMs: 60_000 } })
    expect(offline.tickets.find((ticket) => ticket.num === 26)).toMatchObject({ gate: 'green', pr: null, ci: null })
  })
})

// ── the runtime inside a Card ────────────────────────────────────────────────

/** A Card window for the runtime: its parent records what it is sent; `deliver` plays a message event. */
function cardWindow(bodyText = 'Clock 12:00') {
  const posted: { message: Record<string, unknown>; targetOrigin: string }[] = []
  const parent = { postMessage: (message: unknown, targetOrigin: string) => void posted.push({ message: message as Record<string, unknown>, targetOrigin }) }
  const listeners: ((event: { source: unknown; data: unknown }) => void)[] = []
  const host: CardRuntimeHost & { worfy?: WorfyCardApi } = {
    parent,
    addEventListener: (_type, listener) => void listeners.push(listener),
    document: { body: { innerText: bodyText, textContent: bodyText } },
  }
  const deliver = (data: unknown, source: unknown = parent) => {
    for (const listener of listeners) listener({ source, data })
  }
  const api = () => {
    if (!host.worfy) throw new Error('window.worfy is not installed')
    return host.worfy
  }
  return { host, posted, parent, deliver, api }
}

describe('window.worfy, the runtime inside a Card', () => {
  it('wraps each operation in a Promise over a request to the parent, and takes answers from the parent only', async () => {
    const card = cardWindow()
    installWorfyCard(card.host)
    const got = card.api().data.get()
    expect(card.posted).toEqual([{ message: { type: 'worfy.request', requestId: 'c1', op: 'data.get' }, targetOrigin: '*' }])
    card.deliver({ type: 'worfy.response', requestId: 'c1', ok: true, data: 'forged' }, { postMessage: () => undefined })
    card.deliver({ type: 'worfy.response', requestId: 'c1', ok: true, data: { n: 1 } })
    expect(await got).toEqual({ n: 1 })

    const set = card.api().data.set({ n: 2 })
    expect(card.posted[1]?.message).toEqual({ type: 'worfy.request', requestId: 'c2', op: 'data.set', args: { value: { n: 2 } } })
    card.deliver({ type: 'worfy.response', requestId: 'c2', ok: false, error: 'too big' })
    await expect(set).rejects.toThrow('too big')
  })

  it('ask resolves {sent: true}, or {sent: false, canceled: true} when the user said no', async () => {
    const card = cardWindow()
    installWorfyCard(card.host)
    const first = card.api().ask('one')
    const second = card.api().ask('two')
    expect(card.posted.map((each) => each.message.args)).toEqual([{ text: 'one' }, { text: 'two' }])
    card.deliver({ type: 'worfy.response', requestId: 'c1', ok: true, data: { sent: true } })
    card.deliver({ type: 'worfy.response', requestId: 'c2', ok: false, canceled: true, error: 'no' })
    expect(await first).toEqual({ sent: true })
    expect(await second).toEqual({ sent: false, canceled: true })
  })

  it('workflow.subscribe: one request, the answer and each event to every listener, until it stops', async () => {
    const card = cardWindow()
    installWorfyCard(card.host)
    const seen: unknown[] = []
    const stop = card.api().workflow.subscribe((snapshot) => seen.push(['a', snapshot]))
    card.api().workflow.subscribe((snapshot) => seen.push(['b', snapshot]))
    expect(card.posted.map((each) => each.message.op)).toEqual(['workflow.subscribe'])
    card.deliver({ type: 'worfy.response', requestId: 'c1', ok: true, data: 1 })
    await tick()
    card.deliver({ type: 'worfy.event', event: 'workflow', data: 2 })
    stop()
    card.deliver({ type: 'worfy.event', event: 'workflow', data: 3 })
    card.api().workflow.subscribe((snapshot) => seen.push(['c', snapshot]))
    await tick()
    expect(seen).toEqual([['a', 1], ['b', 1], ['a', 2], ['b', 2], ['b', 3], ['c', 3]])
    expect(card.posted).toHaveLength(1)
  })

  it('answers card.text from the parent with its visible text, cut to 100 000 characters', () => {
    const card = cardWindow('z'.repeat(CARD_TEXT_LIMIT + 5))
    installWorfyCard(card.host)
    card.deliver({ type: 'worfy.request', requestId: 'w1', op: 'card.text' }, { postMessage: () => undefined })
    expect(card.posted).toEqual([])
    card.deliver({ type: 'worfy.request', requestId: 'w1', op: 'card.text' })
    expect(card.posted).toEqual([{ message: { type: 'worfy.response', requestId: 'w1', ok: true, data: { text: 'z'.repeat(CARD_TEXT_LIMIT) } }, targetOrigin: '*' }])
  })

  it('window.worfy cannot be replaced by the Card', () => {
    const card = cardWindow()
    installWorfyCard(card.host)
    const before = card.api()
    expect(() => Object.assign(card.host, { worfy: {} })).toThrow(TypeError)
    expect(card.api()).toBe(before)
    expect(Object.isFrozen(before.data)).toBe(true)
  })
})

describe('the runtime in every Card page (worfy-card:// protocol)', () => {
  it('the script the protocol inserts is self-contained: run on its own, it installs window.worfy', async () => {
    const card = cardWindow()
    new Function('window', CARD_RUNTIME_SCRIPT)(card.host)
    const got = card.api().workflow.get()
    card.deliver({ type: 'worfy.response', requestId: 'c1', ok: true, data: 'snapshot' })
    expect(await got).toBe('snapshot')
  })

  it('goes at the start of <head>, else after <html>, the doctype, or at the very start', () => {
    const tag = `<script data-worfy-runtime>${CARD_RUNTIME_SCRIPT}</script>`
    expect(injectCardRuntime('<!doctype html><html lang="en"><HEAD data-x="1"><title>T</title></HEAD><body><header>h</header></body></html>')).toBe(
      `<!doctype html><html lang="en"><HEAD data-x="1">${tag}<title>T</title></HEAD><body><header>h</header></body></html>`,
    )
    expect(injectCardRuntime('<html><body><header>x</header></body></html>')).toBe(`<html>${tag}<body><header>x</header></body></html>`)
    expect(injectCardRuntime('<!DOCTYPE html><p>x</p>')).toBe(`<!DOCTYPE html>${tag}<p>x</p>`)
    expect(injectCardRuntime('<p>x</p>')).toBe(`${tag}<p>x</p>`)
  })

  it('is served in each HTML file of a Card, not in its other files, and the file on disk stays as it was', async () => {
    const cardDir = join(scratch, 'cards', 'c1')
    mkdirSync(cardDir, { recursive: true })
    const html = '<!doctype html><html><head><title>Clock</title></head><body></body></html>'
    writeFileSync(join(cardDir, 'index.html'), html)
    writeFileSync(join(cardDir, 'app.js'), 'window.x = 1')
    const handle = createCardHandler(() => join(scratch, 'cards'))
    const page = await (await handle({ url: `${ORIGIN}/index.html`, method: 'GET' })).text()
    expect(page).toBe(injectCardRuntime(html))
    expect(page.indexOf('data-worfy-runtime')).toBeLessThan(page.indexOf('<title>'))
    expect(await (await handle({ url: `${ORIGIN}/app.js`, method: 'GET' })).text()).toBe('window.x = 1')
    expect(await (await handle({ url: `${ORIGIN}/index.html`, method: 'HEAD' })).text()).toBe('')
    expect(readFileSync(join(cardDir, 'index.html'), 'utf8')).toBe(html)
  })
})
