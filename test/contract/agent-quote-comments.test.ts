// A round of comments on quotes (worfy-polish ticket 102) through agent.send, on the fake agent: the
// message the window composes (quote-comments.ts, composeRound) reaches Claude Code as one message —
// the images of the comments as image blocks in the order of the comments, the field's own image after
// them, and the text with its `[image N]` marks naming them in that order — and the prompt the window
// gets back reads into the same quote blocks, its images in the same order.
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeQueryFactory, type FakeCall } from '../../src/main/agent/fake-query'
import { SessionRegistry } from '../../src/main/agent/session'
import { agentHandlers, type AttachDeps } from '../../src/main/ipc/agent'
import { registerIpc, type IpcMainLike } from '../../src/main/ipc/index'
import type { AgentEvent, AgentEventEnvelope } from '../../src/shared/agent/events'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { composeRound, parseQuoted, type CommentImage, type QuoteComment } from '../../src/renderer/session/quote-comments'
import { APP_URL } from '../app-url'

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '/nowhere', on: vi.fn() } }))

const scripts = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'fixtures', 'agent-scripts')

type Listener = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

let scratch: string
let project: string
let registries: SessionRegistry[] = []

/** A small PNG whose bytes after the signature are `fill`: each image of the test is told apart by them. */
const png = (name: string, fill: number): CommentImage => {
  const bytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24, fill)])
  return { kind: 'image', name, mediaType: 'image/png', size: bytes.length, data: bytes.toString('base64') }
}

beforeEach(async () => {
  scratch = await realpath(await mkdtemp(join(tmpdir(), 'worfy-quote-comments-')))
  project = join(scratch, 'project')
  await mkdir(project)
  execFileSync('git', ['-C', project, 'init', '-q'])
  await writeFile(join(project, 'README.md'), 'hi\n')
})

afterEach(async () => {
  for (const registry of registries) registry.closeAll()
  registries = []
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

async function harness() {
  const calls: FakeCall[] = []
  const registry = new SessionRegistry(fakeQueryFactory({ scriptsDir: scripts, script: 'message-input', record: (call) => calls.push(call) }))
  registries.push(registry)
  const deps: AttachDeps = {
    target: (cwd) => ({ projectRoot: project, cwd, attachmentsDir: join(scratch, 'data', 'attachments-of-project') }),
    pickFiles: vi.fn(() => Promise.resolve([])),
    imagesDir: () => join(scratch, 'data', 'attachments', 'images'),
  }
  const handlers = new Map<string, Listener>()
  const ipc: IpcMainLike = { handle: (channel, listener) => handlers.set(channel, listener) }
  const received: AgentEventEnvelope[] = []
  const sender = { isDestroyed: () => false, send: (_channel: string, payload: unknown) => received.push(payload as AgentEventEnvelope), once: () => undefined }
  await registerIpc(ipc, { modules: { './agent.ts': () => Promise.resolve(agentHandlers(() => registry, deps, (send) => send(sender))) }, isTrustedSender: (url) => url === APP_URL })
  const ok = async <T,>(channel: string, input?: unknown): Promise<T> => {
    const listener = handlers.get(IPC_CHANNEL_PREFIX + channel)
    if (!listener) throw new Error(`no handler for ${channel}`)
    const result = (await listener({ senderFrame: { url: APP_URL }, sender } as unknown as IpcMainInvokeEvent, input)) as IpcResult<T>
    if (!result.ok) throw new Error(result.error)
    return result.value
  }
  const events = (): AgentEvent[] => received.map((each) => each.event)
  const start = async () => {
    const { sessionId } = await ok<{ sessionId: string }>('agent.start', { cwd: project })
    await vi.waitFor(() => expect(registry.get(sessionId).state).toBe('idle'))
    return sessionId
  }
  const messages = () => calls.flatMap((each) => (each.kind === 'message' ? [each] : []))
  return { ok, events, start, messages }
}

const comment = (id: string, fields: Partial<QuoteComment>): QuoteComment => ({ id, anchor: 'msg_1#0', start: 0, end: 4, quote: 'quote', text: '', images: [], messageAt: null, at: 1, ...fields })

describe('a round of comments through agent.send', () => {
  it('reaches Claude Code as one message: the comments’ images in order, then the field’s, and the text with its [image N] marks', async () => {
    const h = await harness()
    const id = await h.start()
    // Made in another order than they stand in the message: the round reads by place in the text.
    const later = comment('b', { start: 40, end: 50, quote: 'the test step', text: 'Why is it slow?', images: [png('b1.png', 3)] })
    const earlier = comment('a', { start: 4, end: 17, quote: 'the lint step', text: 'Keep it.', images: [png('a1.png', 1), png('a2.png', 2)] })
    const composed = composeRound([later, earlier], { text: 'Thanks.', attachments: [png('own.png', 9)] })
    if ('error' in composed) throw new Error(composed.error)
    await h.ok('agent.send', { sessionId: id, ...composed.message })
    await vi.waitFor(() => expect(h.events().some((event) => event.type === 'result')).toBe(true))

    const [message] = h.messages()
    const blocks = (message?.content ?? []) as { type: string; text?: string; source?: { data: string } }[]
    expect(blocks.filter((block) => block.type === 'image').map((block) => Buffer.from(block.source?.data ?? '', 'base64').at(-1))).toEqual([1, 2, 3, 9])
    expect(blocks.find((block) => block.type === 'text')?.text).toContain(
      ['Comments on parts of your messages (2):', '', '1. > «the lint step» (your message)', '   Keep it.', '   [image 1]', '   [image 2]', '', '2. > «the test step» (your message)', '   Why is it slow?', '   [image 3]', '', 'General:', 'Thanks.'].join('\n'),
    )

    // The prompt the window gets back draws the same quote blocks, the images named by their marks.
    const prompt = h.events().find((event) => event.type === 'prompt')
    expect(prompt?.type === 'prompt' ? prompt.attachments?.map((each) => each.name) : null).toEqual(['a1.png', 'a2.png', 'b1.png', 'own.png'])
    const parsed = parseQuoted(prompt?.type === 'prompt' ? prompt.text : '')
    expect(parsed?.quotes.map((quote) => [quote.quote, quote.text, quote.images])).toEqual([
      ['the lint step', 'Keep it.', [1, 2]],
      ['the test step', 'Why is it slow?', [3]],
    ])
    expect(parsed?.general).toBe('Thanks.')
  })

  it('a round of comments alone, with an empty field, goes too', async () => {
    const h = await harness()
    const id = await h.start()
    const composed = composeRound([comment('a', { quote: 'two steps', text: 'Why two?' })], { text: '', attachments: [] })
    if ('error' in composed) throw new Error(composed.error)
    await h.ok('agent.send', { sessionId: id, ...composed.message })
    await vi.waitFor(() => expect(h.messages()).toHaveLength(1))
    expect(h.messages()[0]?.text).toBe('Comments on parts of your messages (1):\n\n1. > «two steps» (your message)\n   Why two?')
  })
})
