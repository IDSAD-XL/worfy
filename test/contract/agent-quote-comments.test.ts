// A round of comments on quotes (worfy-polish ticket 102) through agent.send, on the fake agent: the
// message the window composes (quote-comments.ts, composeRound) reaches Claude Code as one message —
// the images of the comments as image blocks in the order of the comments, the field's own image after
// them, and the text with its `[image N]` marks naming them in that order — and the prompt the window
// gets back reads into the same quote blocks, its images in the same order. An image of a comment is
// kept by main when it is attached (agent.attach with `keep`): the comment names it by the sha256 of its
// bytes, and a round reads the bytes back by that ref (a `kept` source); one main no longer has, or
// whose bytes changed, is refused.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeQueryFactory, type FakeCall } from '../../src/main/agent/fake-query'
import { SessionRegistry } from '../../src/main/agent/session'
import { agentHandlers, type AttachDeps } from '../../src/main/ipc/agent'
import { registerIpc, type IpcMainLike } from '../../src/main/ipc/index'
import type { Attachment, AttachResult } from '../../src/shared/agent/attachments'
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

/** A small PNG whose bytes after the signature are `fill`, in base64: each image of the test is told apart by them. */
const pngData = (fill: number): string => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24, fill)]).toString('base64')
const png = (name: string, fill: number): Attachment => ({ kind: 'image', name, mediaType: 'image/png', size: 32, data: pngData(fill) })

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
  /** Attaches a pasted image as a comment does: main keeps it, and the comment names it by its ref. */
  const keep = async (sessionId: string, name: string, fill: number): Promise<CommentImage> => {
    const { results } = await ok<{ results: AttachResult[] }>('agent.attach', { sessionId, sources: [{ kind: 'pasted', name, data: pngData(fill) }], keep: true })
    const result = results[0]
    if (result?.ok !== true || result.attachment.kind !== 'image') throw new Error(`${name} was not kept`)
    const { mediaType, size, data } = result.attachment
    return { kind: 'image', name, mediaType, size, ref: createHash('sha256').update(Buffer.from(data, 'base64')).digest('hex') }
  }
  /** Reads kept images back by their refs, as a round after a restart does. */
  const readBack = (sessionId: string, images: readonly CommentImage[]) =>
    ok<{ results: AttachResult[] }>('agent.attach', { sessionId, sources: images.map((each) => ({ kind: 'kept', name: each.name, ref: each.ref, mediaType: each.mediaType })) }).then((value) => value.results)
  /** A round's images from main's copies. */
  const imagesOf = async (sessionId: string, images: readonly CommentImage[]) => {
    const results = await readBack(sessionId, images)
    const byRef = new Map(images.map((each, index) => [each.ref, results[index]]))
    return (image: CommentImage): Attachment | undefined => {
      const result = byRef.get(image.ref)
      return result?.ok === true ? result.attachment : undefined
    }
  }
  return { ok, events, start, messages, keep, readBack, imagesOf }
}

const comment = (id: string, fields: Partial<QuoteComment>): QuoteComment => ({ id, anchor: 'msg_1#0', start: 0, end: 4, quote: 'quote', text: '', images: [], messageAt: null, at: 1, ...fields })

describe('a round of comments through agent.send', () => {
  it('reaches Claude Code as one message: the comments’ images in order, then the field’s, and the text with its [image N] marks', async () => {
    const h = await harness()
    const id = await h.start()
    // Made in another order than they stand in the message: the round reads by place in the text.
    const later = comment('b', { start: 40, end: 50, quote: 'the test step', text: 'Why is it slow?', images: [await h.keep(id, 'b1.png', 3)] })
    const earlier = comment('a', { start: 4, end: 17, quote: 'the lint step', text: 'Keep it.', images: [await h.keep(id, 'a1.png', 1), await h.keep(id, 'a2.png', 2)] })
    const imageOf = await h.imagesOf(id, [...later.images, ...earlier.images])
    const composed = composeRound([later, earlier], { text: 'Thanks.', attachments: [png('own.png', 9)] }, imageOf)
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
    const composed = composeRound([comment('a', { quote: 'two steps', text: 'Why two?' })], { text: '', attachments: [] }, () => undefined)
    if ('error' in composed) throw new Error(composed.error)
    await h.ok('agent.send', { sessionId: id, ...composed.message })
    await vi.waitFor(() => expect(h.messages()).toHaveLength(1))
    expect(h.messages()[0]?.text).toBe('Comments on parts of your messages (1):\n\n1. > «two steps» (your message)\n   Why two?')
  })

  it('main keeps an image attached with `keep`, by the sha256 of its bytes, and reads it back; one attached without it is not kept', async () => {
    const h = await harness()
    const id = await h.start()
    const images = join(scratch, 'data', 'attachments', 'images')
    await h.ok('agent.attach', { sessionId: id, sources: [{ kind: 'pasted', name: 'plain.png', data: pngData(7) }] })
    expect(await readdir(images).catch(() => [])).toEqual([])
    const kept = await h.keep(id, 'shot.png', 5)
    expect(await readdir(images)).toEqual([`${kept.ref}.png`])
    const [back] = await h.readBack(id, [kept])
    expect(back).toEqual({ ok: true, attachment: { kind: 'image', name: 'shot.png', mediaType: 'image/png', size: 32, data: pngData(5) } })
  })

  it('refuses to read back an image main no longer has, or whose bytes are no longer those of its ref', async () => {
    const h = await harness()
    const id = await h.start()
    const kept = await h.keep(id, 'shot.png', 5)
    const file = join(scratch, 'data', 'attachments', 'images', `${kept.ref}.png`)
    await writeFile(file, Buffer.from(pngData(6), 'base64'))
    expect(await h.readBack(id, [kept])).toEqual([{ ok: false, name: 'shot.png', error: 'shot.png is no longer the image it was: attach it again' }])
    await rm(file)
    expect(await h.readBack(id, [kept])).toEqual([{ ok: false, name: 'shot.png', error: 'shot.png is no longer kept: attach it again' }])
    await expect(h.ok('agent.attach', { sessionId: id, sources: [{ kind: 'kept', name: 'x.png', ref: '../../etc/passwd', mediaType: 'image/png' }] })).rejects.toThrow()
  })
})
