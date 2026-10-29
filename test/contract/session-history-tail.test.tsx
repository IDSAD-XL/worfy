// How a Session's history opens (worfy-ui ticket 21), end to end: the window's transcript reader
// (src/renderer/claude-home/useClaudeHome.ts) calls the real handlers of src/main/ipc/claude-home.ts
// through a bridge, and they read a real file of tens of megabytes written into a temporary folder.
// The window opens on the last 4 MiB of the file in one call and one state update; «Load earlier»
// brings the windows before it; records Claude Code appends come once each, none lost. The bytes
// each read takes from the file are counted through src/main/claude-home/tail.ts. The registry is
// a stand-in that names the file: no ~/.claude and no real watcher.
//
// Main's modules and the generator of the file are imported by a path the type checker does not
// follow, as in claude-home-window-root.test.tsx: this file belongs to tsconfig.test.web.json.
/// <reference types="node" />
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../../src/shared/agent/events'
import { IPC_CHANNEL_PREFIX, type WorfyBridge } from '../../src/shared/ipc/channels'
import { mainThreadEvents, parseTranscriptLines } from '../../src/shared/transcript/parse'
import { ms } from '../time-scale'

const ROOT = '/Users/test/projects/big'
const S = 'b1900000-0000-4000-8000-000000000021'
const INDEX_HTML = '/Applications/worfy.app/Contents/Resources/app/out/renderer/index.html'
const WINDOW = 4 * 1024 * 1024
const MB = 1024 * 1024

// Every read of src/main/claude-home/tail.ts adds the bytes it took from the file here.
const counter = vi.hoisted(() => ({ bytes: 0 }))
vi.mock('../../src/main/claude-home/tail', async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>
  const wrapped: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(original)) {
    wrapped[name] =
      typeof value === 'function' && name !== 'splitLines'
        ? async (...args: unknown[]) => {
            const result = (await (value as (...a: unknown[]) => Promise<unknown>)(...args)) as { bytesRead?: number }
            counter.bytes += result.bytesRead ?? 0
            return result
          }
        : value
  }
  return wrapped
})

type Change = { sessions: boolean; transcripts: string[] }
type Listener = (event: unknown, ...args: unknown[]) => unknown
interface MainModules {
  ClaudeHomeSubscriptions: new (registry: unknown, listeners: ReadonlySet<unknown>) => { closeAll(): Promise<void> }
  claudeHomeHandlers: (registry: unknown, subscriptions: unknown) => unknown
  registerIpc: (ipc: { handle(channel: string, listener: Listener): void }, options: { modules: Record<string, () => Promise<unknown>>; isTrustedSender: unknown }) => Promise<void>
  appUrlMatcher: (options: { indexHtml: string }) => unknown
}

/**
 * test/big-transcript.ts, by a path the type checker does not follow (it needs Node's types). The
 * checker cannot see the module, so this signature is copied by hand: keep it in step with
 * writeBigTranscript there.
 */
type WriteBigTranscript = (file: string, options: { sessionId: string; cwd: string; bytes?: number }) => { size: number; turns: number }
let writeBigTranscript: WriteBigTranscript

async function mainModules(): Promise<MainModules> {
  const claudeHome: string = '../../src/main/ipc/claude-home'
  const ipcIndex: string = '../../src/main/ipc/index'
  const [home, ipc] = (await Promise.all([import(/* @vite-ignore */ claudeHome), import(/* @vite-ignore */ ipcIndex)])) as [MainModules, MainModules]
  return { ClaudeHomeSubscriptions: home.ClaudeHomeSubscriptions, claudeHomeHandlers: home.claudeHomeHandlers, registerIpc: ipc.registerIpc, appUrlMatcher: ipc.appUrlMatcher }
}

let dir: string
let file: string
const watchers: ((change: Change) => void)[] = []
const asked: { channel: string; input: unknown }[] = []
let closeAll: () => Promise<void> = async () => undefined

beforeEach(async () => {
  vi.resetModules()
  counter.bytes = 0
  watchers.length = 0
  asked.length = 0
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-history-tail-')))
  file = join(dir, `${S}.jsonl`)
  const generator: string = '../big-transcript'
  writeBigTranscript = ((await import(/* @vite-ignore */ generator)) as { writeBigTranscript: WriteBigTranscript }).writeBigTranscript
  const { ClaudeHomeSubscriptions, claudeHomeHandlers, registerIpc, appUrlMatcher } = await mainModules()
  const registry = {
    watch: async (_root: unknown, onChange: (change: Change) => void) => {
      watchers.push(onChange)
      return { ready: Promise.resolve(), close: async () => undefined }
    },
    sessions: async () => ({ live: [], history: [] }),
    live: async () => [],
    transcriptPath: async (_root: unknown, sessionId: string) => (sessionId === S ? file : null),
  }
  const subscriptions = new ClaudeHomeSubscriptions(registry, new Set())
  closeAll = () => subscriptions.closeAll()
  const handlers = new Map<string, Listener>()
  await registerIpc(
    { handle: (channel, listener) => void handlers.set(channel, listener) },
    { modules: { './claude-home.ts': async () => claudeHomeHandlers(registry, subscriptions) }, isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }) },
  )
  // The window: what main sends goes to the bridge's listeners, as the preload passes it on.
  const listeners = new Map<string, ((payload: unknown) => void)[]>()
  const sender = {
    id: 1,
    send: (channel: string, payload: unknown) => {
      for (const listener of listeners.get(channel.slice(IPC_CHANNEL_PREFIX.length)) ?? []) listener(payload)
    },
    isDestroyed: () => false,
    once: () => undefined,
  }
  const event = { senderFrame: { url: pathToFileURL(INDEX_HTML).href }, sender }
  const bridge = {
    invoke: async (channel: string, input: unknown) => {
      asked.push({ channel, input })
      const listener = handlers.get(IPC_CHANNEL_PREFIX + channel)
      if (!listener) throw new Error(`no handler for ${channel}`)
      return listener(event, input)
    },
    on: (channel: string, listener: (payload: unknown) => void) => {
      listeners.set(channel, [...(listeners.get(channel) ?? []), listener])
      return listeners.size
    },
    off: () => undefined,
  } as unknown as WorfyBridge
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
})

afterEach(async () => {
  await closeAll()
  delete (globalThis as { worfy?: WorfyBridge }).worfy
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

/** Measurements go to the file HISTORY_TAIL_REPORT names, when set: a passing test prints nothing. */
const report = (line: string): void => {
  const target = process.env.HISTORY_TAIL_REPORT
  if (target) appendFileSync(target, `${line}\n`)
}
/** The answers and the user's prompts (a prompt read from a transcript is a `notice` of kind `user`). */
const texts = (events: readonly AgentEvent[]): string[] =>
  events.flatMap((event) => (event.type === 'text' || (event.type === 'notice' && event.kind === 'user') ? [event.text] : []))
const transcriptCalls = () => asked.filter((call) => call.channel === 'claudeHome.transcript')
/** Every event of the file, parsed whole: what the window must show once all of it is loaded. */
const wholeFile = (): AgentEvent[] => mainThreadEvents(parseTranscriptLines(readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => line !== '')))

interface Shown {
  events: readonly AgentEvent[]
  loaded: boolean
  earlier?: number | null
}

/** Mounts the reader and records every distinct state the window drew. */
async function open(agentId?: string) {
  const module = await import('../../src/renderer/claude-home/useClaudeHome')
  const states: Shown[] = []
  const hook = renderHook(() => {
    const state = module.useSessionTranscript(ROOT, S, agentId) as Shown
    if (states.at(-1) !== state) states.push(state)
    return state
  })
  await vi.waitFor(() => expect(watchers).toHaveLength(1))
  return { module, hook, states, drawn: () => states.filter((state) => state.loaded && state.events.length > 0) }
}

const changed = () =>
  act(async () => {
    for (const watcher of watchers) watcher({ sessions: false, transcripts: [S] })
  })

describe('opening a large transcript', () => {
  it('reads only its last 4 MiB, in one call and one state update', { timeout: ms(120_000) }, async () => {
    const { turns, size } = writeBigTranscript(file, { sessionId: S, cwd: ROOT })
    expect(size).toBeGreaterThan(40 * MB)
    const started = performance.now()
    const { hook, drawn } = await open()
    await vi.waitFor(() => expect(texts(hook.result.current.events)).toContain(`Answer number ${turns - 1}`), { timeout: ms(10_000), interval: 5 })
    const newest = performance.now() - started
    const first = drawn()[0]
    report(
      `[history-tail] ${(size / MB).toFixed(1)} MB: newest answer after ${newest.toFixed(0)} ms; ${counter.bytes} bytes read; ` +
        `${transcriptCalls().length} claudeHome.transcript calls; ${drawn().length} state updates with events; ${hook.result.current.events.length} events kept`,
    )
    expect(first, 'the first state the window draws already holds the newest answer').toBeDefined()
    expect(texts(first?.events ?? [])).toContain(`Answer number ${turns - 1}`)
    expect(counter.bytes, 'bytes read from the file to open it').toBeLessThanOrEqual(WINDOW + 1)
    expect(transcriptCalls()).toHaveLength(1)
    expect(drawn()).toHaveLength(1)
    // The oldest turns are not read: they wait for «Load earlier».
    expect(texts(hook.result.current.events)).not.toContain('Prompt number 0')
    expect(hook.result.current.earlier).toBeGreaterThan(size - WINDOW - 1)
  })
})

describe('after the tail', () => {
  it('records Claude Code appends come once each, right after the tail, none lost', async () => {
    const { turns } = writeBigTranscript(file, { sessionId: S, cwd: ROOT, bytes: 6 * MB })
    const { hook } = await open()
    await vi.waitFor(() => expect(hook.result.current.loaded).toBe(true))
    const tail = hook.result.current.events
    // A half-written record at the end of the file: not shown until its line ends.
    const record = (n: number, text: string) =>
      JSON.stringify({ type: 'assistant', isSidechain: false, cwd: ROOT, uuid: `live${n}`, message: { id: `msg_live${n}`, role: 'assistant', content: [{ type: 'text', text }] } })
    appendFileSync(file, `${record(1, 'Live one')}\n${record(2, 'Live two').slice(0, 30)}`)
    await changed()
    await vi.waitFor(() => expect(texts(hook.result.current.events).at(-1)).toBe('Live one'))
    appendFileSync(file, `${record(2, 'Live two').slice(30)}\n`)
    await changed()
    await vi.waitFor(() => expect(texts(hook.result.current.events).at(-1)).toBe('Live two'))
    const events = hook.result.current.events
    expect(events.slice(0, tail.length)).toStrictEqual(tail)
    expect(texts(events.slice(tail.length))).toEqual(['Live one', 'Live two'])
    expect(texts(tail).at(-1)).toBe(`Answer number ${turns - 1}`)
  })

  it('a read that finds only half a line draws nothing', async () => {
    writeBigTranscript(file, { sessionId: S, cwd: ROOT, bytes: 2 * MB })
    const { hook, states } = await open()
    await vi.waitFor(() => expect(hook.result.current.loaded).toBe(true))
    const shown = hook.result.current
    const count = states.length
    const calls = transcriptCalls().length
    appendFileSync(file, '{"type":"assistant","isSidechain":false,"uuid":"half"')
    await changed()
    await vi.waitFor(() => expect(transcriptCalls().length).toBe(calls + 1))
    await act(async () => {
      await new Promise((done) => setTimeout(done, 50))
    })
    expect(states).toHaveLength(count)
    expect(hook.result.current).toBe(shown)
  })

  it('a growth of several windows is read forward and drawn in one state update', { timeout: ms(30_000) }, async () => {
    writeBigTranscript(file, { sessionId: S, cwd: ROOT, bytes: 5 * MB })
    const { hook, drawn } = await open()
    await vi.waitFor(() => expect(hook.result.current.loaded).toBe(true))
    expect(drawn()).toHaveLength(1)
    const before = hook.result.current.events.length
    // 10 MB more while the view is open: three reads forward at most, one update.
    const extra = join(dir, 'extra.jsonl')
    const { turns } = writeBigTranscript(extra, { sessionId: S, cwd: ROOT, bytes: 10 * MB })
    appendFileSync(file, readFileSync(extra))
    const calls = transcriptCalls().length
    await changed()
    await vi.waitFor(() => expect(texts(hook.result.current.events)).toContain(`Answer number ${turns - 1}`), { timeout: ms(20_000) })
    expect(drawn()).toHaveLength(2)
    expect(transcriptCalls().length - calls).toBeLessThanOrEqual(3)
    expect(hook.result.current.events.length).toBeGreaterThan(before)
  })
})

describe('Load earlier', () => {
  it('prepends the window before the shown events, again and again, until the start of the file', { timeout: ms(60_000) }, async () => {
    writeBigTranscript(file, { sessionId: S, cwd: ROOT, bytes: 10 * MB })
    const { module, hook } = await open()
    await vi.waitFor(() => expect(hook.result.current.loaded).toBe(true))
    const whole = wholeFile()
    let previous = hook.result.current.events
    let loads = 0
    while (hook.result.current.earlier !== 0) {
      counter.bytes = 0
      await act(async () => {
        await module.loadEarlierTranscript(ROOT, S)
      })
      loads += 1
      const now = hook.result.current.events
      // What was shown stays, at the end; the older events come before it.
      expect(now.slice(now.length - previous.length)).toStrictEqual(previous)
      expect(now.length).toBeGreaterThan(previous.length)
      // One window per press (and the byte before it, and the check that the window ends a line);
      // the 1.2 MB result in the middle of the file fits in it.
      expect(counter.bytes).toBeLessThanOrEqual(WINDOW + 2)
      previous = now
      expect(loads).toBeLessThan(10)
    }
    // Every event of the file, once each and in order: no gap and no repeat at a window's edge.
    expect(hook.result.current.events).toStrictEqual(whole)
    expect(texts(hook.result.current.events)[0]).toBe('Prompt number 0')
    // 10 MB: the window at the end, then two more.
    expect(loads).toBe(2)
  })
})

/** A transcript of `count` short answers, one line each: `Line N`. Returns each line's byte offset. */
function writeShortLines(count: number): number[] {
  const offsets: number[] = []
  let at = 0
  const text = Array.from({ length: count }, (_, n) => {
    const line = `${JSON.stringify({ type: 'assistant', isSidechain: false, cwd: ROOT, uuid: `s${n}`, message: { id: `msg_s${n}`, role: 'assistant', content: [{ type: 'text', text: `Line ${n}` }] } })}\n`
    offsets.push(at)
    at += Buffer.byteLength(line)
    return line
  }).join('')
  writeFileSync(file, text)
  return offsets
}

describe('a window of more than KEEP_EVENTS short lines', () => {
  it('keeps the newest KEEP_EVENTS, Load earlier starts at the first line kept, and brings the rest back', { timeout: ms(60_000) }, async () => {
    const count = 40_000
    const offsets = writeShortLines(count)
    const { module, hook } = await open()
    await vi.waitFor(() => expect(hook.result.current.loaded).toBe(true))
    const keep = module.KEEP_EVENTS
    // The window at the end holds far more lines than the view keeps.
    expect(count - offsets.findIndex((offset) => offset >= (offsets.at(-1) ?? 0) - WINDOW)).toBeGreaterThan(keep)
    expect(hook.result.current.events).toHaveLength(keep)
    expect(texts(hook.result.current.events)[0]).toBe(`Line ${count - keep}`)
    expect(hook.result.current.earlier).toBe(offsets[count - keep])
    let loads = 0
    while (hook.result.current.earlier !== 0 && loads < 10) {
      await act(async () => {
        await module.loadEarlierTranscript(ROOT, S)
      })
      loads += 1
    }
    const whole = wholeFile()
    expect(whole).toHaveLength(count)
    expect(hook.result.current.events).toStrictEqual(whole)
  })
})

describe('a Subagent\'s transcript', () => {
  it('opens on the window at the end of its file and loads the rest with Load earlier', { timeout: ms(60_000) }, async () => {
    const agentId = 'a21tail'
    writeFileSync(file, '')
    const folder = join(dir, S, 'subagents')
    mkdirSync(folder, { recursive: true })
    const agentFile = join(folder, `agent-${agentId}.jsonl`)
    const { turns, size } = writeBigTranscript(agentFile, { sessionId: S, cwd: ROOT, bytes: 6 * MB })
    const { module, hook } = await open(agentId)
    await vi.waitFor(() => expect(hook.result.current.loaded).toBe(true), { timeout: ms(10_000) })
    const calls = asked.filter((call) => call.channel === 'claudeHome.subagentTranscript')
    expect(calls[0]?.input).toMatchObject({ projectRoot: ROOT, sessionId: S, agentId, back: { bytes: WINDOW } })
    expect(texts(hook.result.current.events)).toContain(`Answer number ${turns - 1}`)
    expect(texts(hook.result.current.events)).not.toContain('Prompt number 0')
    expect(hook.result.current.earlier).toBeGreaterThan(0)
    expect(hook.result.current.earlier).toBeGreaterThan(size - WINDOW - 1)
    while (hook.result.current.earlier !== 0) {
      await act(async () => {
        await module.loadEarlierTranscript(ROOT, S, agentId)
      })
    }
    expect(texts(hook.result.current.events)[0]).toBe('Prompt number 0')
  })
})

describe('a main that does not know `back` (an older build on a Linked machine)', () => {
  it('is read forward to the end the old way: the newest answer shows, no Load earlier, live records still come', { timeout: ms(60_000) }, async () => {
    const { turns } = writeBigTranscript(file, { sessionId: S, cwd: ROOT, bytes: 12 * MB })
    // The old main's schema drops `back`, and its answer has no `earlier` and no `offsets`.
    const bridge = (globalThis as { worfy?: WorfyBridge }).worfy as unknown as { invoke: (channel: string, input: unknown) => Promise<unknown> }
    const current = bridge.invoke
    bridge.invoke = async (channel, input) => {
      const old = { ...(input as Record<string, unknown>) }
      delete old.back
      const result = (await current(channel, old)) as { ok: boolean; value?: Record<string, unknown> }
      if (!result.ok || result.value === undefined) return result
      const value = { ...result.value }
      delete value.earlier
      delete value.offsets
      return { ...result, value }
    }
    const { module, hook } = await open()
    await vi.waitFor(() => expect(hook.result.current.loaded).toBe(true), { timeout: ms(30_000) })
    const keep = module.KEEP_EVENTS
    const whole = wholeFile()
    expect(whole.length).toBeGreaterThan(keep)
    expect(hook.result.current.events).toStrictEqual(whole.slice(whole.length - keep))
    expect(texts(hook.result.current.events)).toContain(`Answer number ${turns - 1}`)
    expect(hook.result.current.earlier).toBeNull()
    expect(module.earlierControl(hook.result.current as never, ROOT, S)).toBeUndefined()
    const record = JSON.stringify({ type: 'assistant', isSidechain: false, cwd: ROOT, uuid: 'live1', message: { id: 'msg_live1', role: 'assistant', content: [{ type: 'text', text: 'Live one' }] } })
    appendFileSync(file, `${record}\n`)
    await changed()
    await vi.waitFor(() => expect(texts(hook.result.current.events).at(-1)).toBe('Live one'))
    expect(hook.result.current.events).toHaveLength(keep)
  })
})
