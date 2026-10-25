// Attachments and the slash menu through the `agent.*` IPC channels, on the fake agent (ticket 20):
// agent.attach, agent.attachPick, agent.send with attachments and agent.commands. The boundary
// refuses a wrong shape and drops keys outside the contract; what reaches Claude Code is the
// message whole, image blocks included; nothing is written into the Project or the Claude home.
// worfy-ui ticket 28: the prompt event names the attachments without paths or bytes, and main keeps
// one copy of each sent image, `<data>/attachments/images/<sha256>.<ext>`.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeQueryFactory, type FakeCall } from '../../src/main/agent/fake-query'
import { Session, SessionRegistry } from '../../src/main/agent/session'
import { agentHandlers, type AttachDeps } from '../../src/main/ipc/agent'
import { registerIpc, type IpcMainLike } from '../../src/main/ipc/index'
import type { AgentEvent, AgentEventEnvelope } from '../../src/shared/agent/events'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { APP_URL } from '../app-url'

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '/nowhere', on: vi.fn() } }))

const testDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const scripts = join(testDir, 'fixtures', 'agent-scripts')
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24, 1)])

type Listener = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

let scratch: string
let project: string
let outside: string
let claudeHome: string
let attachmentsDir: string
let imagesDir: string
let registries: SessionRegistry[] = []

/** Every file under `dir` with its size and mtime: a write anywhere changes it. */
const snapshot = (dir: string): string[] =>
  existsSync(dir)
    ? (readdirSync(dir, { recursive: true }) as string[])
        .filter((path) => !path.startsWith(`.git${sep}`) && path !== '.git')
        .sort()
        .map((path) => {
          const info = statSync(join(dir, path))
          return `${path}:${info.isFile() ? info.size : 'dir'}:${info.mtimeMs}`
        })
    : []

beforeEach(async () => {
  scratch = await realpath(await mkdtemp(join(tmpdir(), 'worfy-agent-attachments-')))
  project = join(scratch, 'project')
  outside = join(scratch, 'outside')
  claudeHome = join(scratch, 'claude-home')
  attachmentsDir = join(scratch, 'data', 'alpha', 'attachments')
  imagesDir = join(scratch, 'data', 'attachments', 'images')
  await mkdir(project)
  await mkdir(outside)
  cpSync(join(testDir, 'fixtures', 'claude-home'), claudeHome, { recursive: true })
  execFileSync('git', ['-C', project, 'init', '-q'])
  await writeFile(join(project, 'README.md'), 'hi\n')
  execFileSync('git', ['-C', project, 'add', '.'])
  execFileSync('git', ['-C', project, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'])
})

afterEach(async () => {
  for (const registry of registries) registry.closeAll()
  registries = []
  vi.restoreAllMocks()
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

async function harness(script = 'message-input', picked: string[] = []) {
  const calls: FakeCall[] = []
  const registry = new SessionRegistry(fakeQueryFactory({ scriptsDir: scripts, script, record: (call) => calls.push(call) }))
  registries.push(registry)
  const deps: AttachDeps = {
    target: (cwd) => ({ projectRoot: project, cwd, attachmentsDir }),
    pickFiles: vi.fn(() => Promise.resolve(picked)),
    imagesDir: () => imagesDir,
  }
  const handlers = new Map<string, Listener>()
  const ipc: IpcMainLike = { handle: (channel, listener) => handlers.set(channel, listener) }
  await registerIpc(ipc, { modules: { './agent.ts': () => Promise.resolve(agentHandlers(() => registry, deps, (send) => send(sender))) }, isTrustedSender: (url) => url === APP_URL })
  const received: AgentEventEnvelope[] = []
  // What the store of image copies held when each prompt reached the window.
  const copiesAtPrompt: string[][] = []
  const sender = {
    isDestroyed: () => false,
    send: (_channel: string, payload: unknown) => {
      if ((payload as AgentEventEnvelope).event.type === 'prompt') copiesAtPrompt.push(existsSync(imagesDir) && statSync(imagesDir).isDirectory() ? readdirSync(imagesDir) : [])
      received.push(payload as AgentEventEnvelope)
    },
    once: () => undefined,
  }
  const call = async (channel: string, input?: unknown): Promise<IpcResult<unknown>> => {
    const listener = handlers.get(IPC_CHANNEL_PREFIX + channel)
    if (!listener) throw new Error(`no handler for ${channel}`)
    return (await listener({ senderFrame: { url: APP_URL }, sender } as unknown as IpcMainInvokeEvent, input)) as IpcResult<unknown>
  }
  const ok = async <T>(channel: string, input?: unknown): Promise<T> => {
    const result = await call(channel, input)
    if (!result.ok) throw new Error(result.error)
    return result.value as T
  }
  const events = (): AgentEvent[] => received.map((each) => each.event)
  const start = async () => {
    const { sessionId } = await ok<{ sessionId: string }>('agent.start', { cwd: project })
    await vi.waitFor(() => expect(registry.get(sessionId).state).toBe('idle'))
    return sessionId
  }
  const messages = () => calls.flatMap((each) => (each.kind === 'message' ? [each] : []))
  const results = () => events().filter((event) => event.type === 'result').length
  return { call, ok, calls, registry, deps, events, start, messages, results, copiesAtPrompt }
}

const image = { kind: 'image', name: 'shot.png', mediaType: 'image/png', size: PNG.length, data: PNG.toString('base64') } as const
/** The name of main's copy of PNG: the sha256 of its bytes. */
const PNG_REF = createHash('sha256').update(PNG).digest('hex')

describe('agent.commands', () => {
  it('lists the commands Claude Code reports, with descriptions; after a turn, the names of system/init too, skills marked', async () => {
    const h = await harness()
    const id = await h.start()
    const before = await h.ok<{ commands: { name: string; kind: string }[] }>('agent.commands', { sessionId: id })
    expect(before.commands.map((each) => each.name)).toEqual(['ship-ticket', 'epic-wave', 'retro', 'compact'])
    expect(before.commands[0]).toEqual({
      name: 'ship-ticket',
      description: 'Carry one ticket of any registered project from claim to the finish its profile declares',
      argumentHint: '<epic> <NN>',
      kind: 'command',
    })

    await h.ok('agent.send', { sessionId: id, text: 'hi' })
    await vi.waitFor(() => expect(h.results()).toBe(1))
    const after = await h.ok<{ commands: { name: string; kind: string }[] }>('agent.commands', { sessionId: id })
    expect(after.commands.map((each) => `${each.name}:${each.kind}`)).toEqual(['ship-ticket:skill', 'epic-wave:skill', 'retro:skill', 'compact:command', 'qmd:skill'])
  })

  it('without a commands line, the fake agent answers the slash_commands of the script', async () => {
    const h = await harness('turn')
    const id = await h.start()
    const { commands } = await h.ok<{ commands: { name: string }[] }>('agent.commands', { sessionId: id })
    expect(commands.map((each) => each.name)).toEqual(['ship-ticket', 'epic-wave', 'compact'])
  })

  it('refuses a call without a Session id', async () => {
    const h = await harness()
    expect(await h.call('agent.commands', {})).toMatchObject({ ok: false })
    expect(await h.call('agent.commands', { sessionId: 42 })).toMatchObject({ ok: false })
  })
})

describe('agent.send with attachments', () => {
  it('gives Claude Code the image as an image block, the files as paths and the image names; the prompt shows them without paths or bytes', async () => {
    const h = await harness()
    const id = await h.start()
    await writeFile(join(project, 'a.ts'), 'a')
    await h.ok('agent.send', {
      sessionId: id,
      text: 'what is this?',
      attachments: [image, { kind: 'file', name: 'a.ts', path: join(project, 'a.ts'), size: 1, copied: false }],
    })
    await vi.waitFor(() => expect(h.results()).toBe(1))
    const text = `what is this?\n\nAttached files: ${join(project, 'a.ts')}\n\nAttached images: shot.png`
    expect(h.messages()).toEqual([
      {
        kind: 'message',
        text,
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG.toString('base64') } },
          { type: 'text', text },
        ],
      },
    ])
    const prompts = h.events().filter((event) => event.type === 'prompt')
    expect(prompts).toEqual([
      {
        type: 'prompt',
        text: 'what is this?',
        attachments: [
          { kind: 'image', name: 'shot.png', mediaType: 'image/png', ref: PNG_REF },
          { kind: 'file', name: 'a.ts', ext: 'ts', size: 1 },
        ],
      },
    ])
    expect(JSON.stringify(prompts)).not.toContain(project)
    expect(JSON.stringify(prompts)).not.toContain(PNG.toString('base64'))
  })

  it('keeps one copy of a sent image, named by the sha256 of its bytes, however often it is sent', async () => {
    const h = await harness()
    const id = await h.start()
    await h.ok('agent.send', { sessionId: id, text: 'one', attachments: [image, { ...image, name: 'again.png' }] })
    await vi.waitFor(() => expect(h.results()).toBe(1))
    const copy = join(imagesDir, `${PNG_REF}.png`)
    expect(readdirSync(imagesDir)).toEqual([`${PNG_REF}.png`])
    expect(readFileSync(copy)).toEqual(PNG)
    const written = statSync(copy).mtimeMs
    await new Promise((settle) => setTimeout(settle, 20))
    await h.ok('agent.send', { sessionId: id, text: 'two', attachments: [image] })
    await vi.waitFor(() => expect(h.results()).toBe(2))
    expect(readdirSync(imagesDir)).toEqual([`${PNG_REF}.png`])
    // Left as it was: the same name holds the same bytes.
    expect(statSync(copy).mtimeMs).toBe(written)
  })

  it('the copy is in place before the prompt reaches the window, so its thumbnail loads at once', async () => {
    const h = await harness()
    const id = await h.start()
    await h.ok('agent.send', { sessionId: id, text: 'look', attachments: [image] })
    await vi.waitFor(() => expect(h.results()).toBe(1))
    expect(h.copiesAtPrompt).toEqual([[`${PNG_REF}.png`]])
  })

  it('a message of an image and blank text shows no text: the prompt has none, Claude Code gets the images line only', async () => {
    const h = await harness()
    const id = await h.start()
    await h.ok('agent.send', { sessionId: id, text: '  ', attachments: [image] })
    await vi.waitFor(() => expect(h.results()).toBe(1))
    expect(h.events().filter((event) => event.type === 'prompt')).toEqual([
      { type: 'prompt', text: '', attachments: [{ kind: 'image', name: 'shot.png', mediaType: 'image/png', ref: PNG_REF }] },
    ])
    expect(h.messages()[0]?.text).toBe('Attached images: shot.png')
  })

  it('a copy that cannot be written is reported, and the message goes all the same', async () => {
    const h = await harness()
    const id = await h.start()
    await mkdir(dirname(imagesDir), { recursive: true })
    // A file where the folder should be: nothing can be written under it.
    writeFileSync(imagesDir, 'not a folder')
    const reported = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await h.ok('agent.send', { sessionId: id, text: 'look', attachments: [image] })
    await vi.waitFor(() => expect(h.results()).toBe(1))
    expect(h.messages().map((each) => each.text)).toEqual(['look\n\nAttached images: shot.png'])
    expect(reported).toHaveBeenCalledTimes(1)
    expect(readFileSync(imagesDir, 'utf8')).toBe('not a folder')
  })

  it('a message without images writes no copy', async () => {
    const h = await harness()
    const id = await h.start()
    await h.ok('agent.send', { sessionId: id, text: 'hello' })
    await vi.waitFor(() => expect(h.results()).toBe(1))
    expect(existsSync(imagesDir)).toBe(false)
  })

  it('a plain message stays a string, as before', async () => {
    const h = await harness()
    const id = await h.start()
    await h.ok('agent.send', { sessionId: id, text: 'hello' })
    await vi.waitFor(() => expect(h.messages()).toEqual([{ kind: 'message', text: 'hello', content: 'hello' }]))
  })

  it('a message queued during a turn keeps its image, and the queue shows its name only', async () => {
    const h = await harness('session-view')
    const id = await h.start()
    await h.ok('agent.send', { sessionId: id, text: 'first' })
    await vi.waitFor(() => expect(h.results()).toBe(1))
    await h.ok('agent.send', { sessionId: id, text: 'hold' })
    await vi.waitFor(() => expect(h.registry.get(id).state).toBe('busy'))
    await h.ok('agent.send', { sessionId: id, text: 'later', attachments: [image] })
    const queue = h.events().findLast((event) => event.type === 'queue')
    expect(queue).toMatchObject({ items: [{ text: 'later\n\nAttached images: shot.png' }] })
    expect(JSON.stringify(queue)).not.toContain(PNG.toString('base64'))
    await h.ok('agent.interrupt', { sessionId: id })
    await vi.waitFor(() => expect(h.registry.get(id).state).toBe('idle'))
    await h.ok('agent.queueSend', { sessionId: id })
    await vi.waitFor(() => expect(h.messages().map((each) => each.text)).toEqual(['first', 'hold', 'later\n\nAttached images: shot.png']))
    expect(h.messages()[2]?.content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG.toString('base64') } },
      { type: 'text', text: 'later\n\nAttached images: shot.png' },
    ])
  })

  it.each([
    ['an empty message', { text: '  ', attachments: [] }],
    ['an image of a type the API refuses', { text: 'x', attachments: [{ ...image, mediaType: 'image/bmp' }] }],
    ['an image said to be larger than 3.75 MB', { text: 'x', attachments: [{ ...image, size: 3.75 * 1024 * 1024 + 1 }] }],
    ['image bytes that are no image', { text: 'x', attachments: [{ ...image, data: Buffer.from('hello world').toString('base64') }] }],
    ['image bytes of another type than the one named', { text: 'x', attachments: [{ ...image, mediaType: 'image/jpeg' }] }],
    ['an image over 3.75 MB, whatever size it names', { text: 'x', attachments: [{ ...image, data: Buffer.concat([PNG, Buffer.alloc(3.75 * 1024 * 1024)]).toString('base64') }] }],
    ['a file attach() did not give: outside the Project, said to be inside', { text: 'x', attachments: [{ kind: 'file', name: 'passwd', path: '/etc/passwd', size: 1, copied: false }] }],
    ['a file attach() did not give: outside the attachments folder, said to be a copy', { text: 'x', attachments: [{ kind: 'file', name: 'passwd', path: '/etc/passwd', size: 1, copied: true }] }],
    ['a file that does not exist', { text: 'x', attachments: [{ kind: 'file', name: 'gone.ts', path: '/nowhere/gone.ts', size: 1, copied: false }] }],
    ['image data that is not base64', { text: 'x', attachments: [{ ...image, data: 'not base64!' }] }],
    ['a file with a relative path', { text: 'x', attachments: [{ kind: 'file', name: 'a', path: 'a', size: 1, copied: false }] }],
    ['an attachment of an unknown kind', { text: 'x', attachments: [{ kind: 'video', name: 'a' }] }],
    ['attachments that are not a list', { text: 'x', attachments: 'shot.png' }],
  ])('refuses %s; nothing reaches Claude Code', async (_label, message) => {
    const h = await harness()
    const id = await h.start()
    expect(await h.call('agent.send', { sessionId: id, ...message })).toMatchObject({ ok: false })
    await new Promise((settle) => setTimeout(settle, 20))
    expect(h.messages()).toEqual([])
  })

  it('drops keys outside the contract before the Session gets the attachments', async () => {
    const h = await harness()
    const id = await h.start()
    const send = vi.spyOn(Session.prototype, 'send')
    await h.ok('agent.send', { sessionId: id, text: 'x', extra: true, attachments: [{ ...image, path: '/etc/passwd', evil: 1 }] })
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]?.[1]).toStrictEqual([image])
  })

  it('the Session gets what main sees, not what the renderer says: the size and name of an image and of a file', async () => {
    const h = await harness()
    const id = await h.start()
    await writeFile(join(project, 'a.ts'), 'abc')
    const send = vi.spyOn(Session.prototype, 'send')
    await h.ok('agent.send', {
      sessionId: id,
      text: 'x',
      attachments: [
        { ...image, name: '../shot.png', size: 1 },
        { kind: 'file', name: 'a.ts', path: join(project, 'a.ts'), size: 999, copied: false },
      ],
    })
    expect(send.mock.calls[0]?.[1]).toStrictEqual([image, { kind: 'file', name: 'a.ts', path: join(project, 'a.ts'), size: 3, copied: false }])
  })

  it('messages reach Claude Code in the order they were sent, though one waits for its attachments to be checked', async () => {
    const h = await harness()
    const id = await h.start()
    await writeFile(join(project, 'a.ts'), 'a')
    const file = { kind: 'file', name: 'a.ts', path: join(project, 'a.ts'), size: 1, copied: false }
    const sent = await Promise.all([
      h.call('agent.send', { sessionId: id, text: 'first', attachments: [file] }),
      h.call('agent.send', { sessionId: id, text: 'second' }),
      h.call('agent.send', { sessionId: id, text: 'refused', attachments: [{ ...file, path: '/nowhere/gone.ts' }] }),
      h.call('agent.send', { sessionId: id, text: 'third' }),
    ])
    expect(sent.map((each) => each.ok)).toEqual([true, true, false, true])
    await vi.waitFor(() => expect(h.messages().map((each) => each.text.split('\n')[0])).toEqual(['first', 'second', 'third']))
  })
})

describe('agent.attach and agent.attachPick', () => {
  it('checks each source: an image, a file inside the Project, a copied one, a refused one; the Project and the Claude home stay untouched', async () => {
    const h = await harness()
    const id = await h.start()
    await writeFile(join(outside, 'shot.png'), PNG)
    await writeFile(join(project, 'inside.txt'), 'in')
    execFileSync('git', ['-C', project, 'add', '.'])
    execFileSync('git', ['-C', project, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'inside'])
    await writeFile(join(outside, 'notes.txt'), 'notes')
    const projectBefore = snapshot(project)
    const homeBefore = snapshot(claudeHome)

    const { results } = await h.ok<{ results: unknown[] }>('agent.attach', {
      sessionId: id,
      sources: [
        { kind: 'path', path: join(outside, 'shot.png') },
        { kind: 'path', path: join(project, 'inside.txt') },
        { kind: 'path', path: join(outside, 'notes.txt') },
        { kind: 'pasted', name: 'clip.txt', data: Buffer.from('text').toString('base64') },
      ],
    })
    expect(results).toHaveLength(4)
    expect(results[0]).toEqual({ ok: true, attachment: { kind: 'image', name: 'shot.png', mediaType: 'image/png', size: PNG.length, data: PNG.toString('base64') } })
    expect(results[1]).toEqual({ ok: true, attachment: { kind: 'file', name: 'inside.txt', path: join(project, 'inside.txt'), size: 2, copied: false } })
    expect(results[2]).toMatchObject({ ok: true, attachment: { kind: 'file', name: 'notes.txt', size: 5, copied: true } })
    const copy = (results[2] as { attachment: { path: string } }).attachment.path
    expect(copy.startsWith(`${attachmentsDir}${sep}`)).toBe(true)
    expect(readFileSync(copy, 'utf8')).toBe('notes')
    expect(results[3]).toEqual({ ok: false, name: 'clip.txt', error: 'clip.txt is not a supported image: paste a PNG, JPEG, GIF or WebP' })

    // The commands are read too: listing them writes nothing either.
    await h.ok('agent.commands', { sessionId: id })
    await h.ok('agent.send', { sessionId: id, text: 'go', attachments: [(results[2] as { attachment: unknown }).attachment] })
    await vi.waitFor(() => expect(h.results()).toBe(1))
    expect(snapshot(project)).toEqual(projectBefore)
    expect(execFileSync('git', ['-C', project, 'status', '--porcelain'], { encoding: 'utf8' })).toBe('')
    expect(snapshot(claudeHome)).toEqual(homeBefore)
  })

  it('refuses a source of the wrong shape, and an empty or too long list', async () => {
    const h = await harness()
    const id = await h.start()
    expect(await h.call('agent.attach', { sessionId: id, sources: [{ kind: 'path', path: 'relative.txt' }] })).toMatchObject({ ok: false })
    expect(await h.call('agent.attach', { sessionId: id, sources: [{ kind: 'url', url: 'https://example.com' }] })).toMatchObject({ ok: false })
    expect(await h.call('agent.attach', { sessionId: id, sources: [{ kind: 'pasted', name: 'a.png', data: '***' }] })).toMatchObject({ ok: false })
    expect(await h.call('agent.attach', { sessionId: id, sources: [] })).toMatchObject({ ok: false })
    const many = Array.from({ length: 21 }, () => ({ kind: 'path', path: join(outside, 'x') }))
    expect(await h.call('agent.attach', { sessionId: id, sources: many })).toMatchObject({ ok: false })
    expect(existsSync(attachmentsDir)).toBe(false)
  })

  it('drops keys outside the contract from the answer', async () => {
    const h = await harness()
    const id = await h.start()
    await writeFile(join(project, 'a.txt'), 'a')
    const { results } = await h.ok<{ results: unknown[] }>('agent.attach', { sessionId: id, sources: [{ kind: 'path', path: join(project, 'a.txt'), extra: 1 }], extra: 2 })
    expect(results).toStrictEqual([{ ok: true, attachment: { kind: 'file', name: 'a.txt', path: join(project, 'a.txt'), size: 1, copied: false } }])
  })

  it('"+" checks the files the dialog gives; a cancelled dialog gives none', async () => {
    await writeFile(join(outside, 'big.png'), Buffer.concat([PNG, Buffer.alloc(4 * 1024 * 1024, 1)]))
    const h = await harness('message-input', [join(outside, 'big.png')])
    const id = await h.start()
    expect(await h.ok('agent.attachPick', { sessionId: id })).toEqual({ results: [{ ok: false, name: 'big.png', error: 'big.png is too large: images go up to 3.75 MB' }] })
    expect(h.deps.pickFiles).toHaveBeenCalledTimes(1)

    const cancelled = await harness('message-input', [])
    const other = await cancelled.start()
    expect(await cancelled.ok('agent.attachPick', { sessionId: other })).toEqual({ results: [] })
  })

  it('"+" takes 20 files at most: the ones past that are refused by name and not copied', async () => {
    const paths = Array.from({ length: 22 }, (_, index) => join(outside, `f${index}.txt`))
    for (const path of paths) await writeFile(path, 'x')
    const h = await harness('message-input', paths)
    const id = await h.start()
    const { results } = await h.ok<{ results: { ok: boolean; name?: string; error?: string }[] }>('agent.attachPick', { sessionId: id })
    expect(results).toHaveLength(21)
    expect(results.slice(0, 20).every((each) => each.ok)).toBe(true)
    expect(results[20]).toEqual({ ok: false, name: 'f20.txt, f21.txt', error: 'A message takes up to 20 attachments: f20.txt, f21.txt left out' })
    expect(readdirSync(attachmentsDir)).toHaveLength(20)
  })

  it('refuses attachPick for a Session that does not exist, without opening the dialog', async () => {
    const h = await harness()
    expect(await h.call('agent.attachPick', { sessionId: 'nope' })).toMatchObject({ ok: false })
    expect(h.deps.pickFiles).not.toHaveBeenCalled()
  })
})
