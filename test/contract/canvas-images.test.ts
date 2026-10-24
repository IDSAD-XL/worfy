// The images on the Canvas (worfy-canvas ticket 23) end to end in main: src/main/ipc/canvas-images.ts
// and src/main/ipc/trash.ts registered through registerIpc (the same wrapper the app uses) over a
// mocked `electron`, the shared Layout store and a temporary WORFY_DATA_DIR. An image is written to
// <Project data folder>/images/<id>.<ext> and nowhere else (ADR-0005); its size and type come from
// its bytes; a deleted image Node takes its file to the trash and back; the files no Node shows are
// deleted when the app starts.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CANVAS_IMAGE_LIMIT_BYTES, IMAGE_FILE_PATTERN, type CanvasImageResult, type ImageNodeData } from '../../src/shared/ipc/canvas-images'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { TRASH_KEEP_MS, type TrashEntry } from '../../src/shared/ipc/trash'
import type { LayoutNode, LayoutOpInput } from '../../src/shared/layout/types'
import type { LayoutStore } from '../../src/main/layout/store'
import { APP_URL, INDEX_HTML } from '../app-url'
import { removeTestTree, saveLayoutNow } from '../remove'

const PROJECT = 'demo-0a1b2c3d'
const DAY = 24 * 60 * 60 * 1000

vi.mock('electron', () => ({
  app: { on: () => undefined },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  dialog: { showOpenDialog: vi.fn() },
}))
vi.mock('../../src/main/agent/app-node-sessions', () => ({ sharedNodeSessions: () => ({ list: () => [] }) }))

type Listener = (event: IpcMainInvokeEvent, input: unknown) => unknown

let scratch: string
let dataDir: string
let repo: string
let handlers: Map<string, Listener>
let layout: LayoutStore

async function start(): Promise<void> {
  ;(layout as LayoutStore | undefined)?.flushAll()
  vi.resetModules()
  process.env.WORFY_DATA_DIR = dataDir
  process.env.WORFY_CLAUDE_HOME = join(scratch, 'claude')
  const { registerIpc, appUrlMatcher } = await import('../../src/main/ipc/index')
  handlers = new Map()
  await registerIpc(
    { handle: (channel, listener) => handlers.set(channel, listener as Listener) },
    {
      modules: {
        './canvas-images.ts': () => import('../../src/main/ipc/canvas-images').then((module) => module.default),
        './trash.ts': () => import('../../src/main/ipc/trash').then((module) => module.default),
      },
      isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }),
    },
  )
  layout = (await import('../../src/main/layout/store')).layoutStore()
}

async function call(channel: string, input?: unknown): Promise<IpcResult<unknown>> {
  const listener = handlers.get(IPC_CHANNEL_PREFIX + channel)
  if (!listener) throw new Error(`no handler for ${channel}`)
  const event = { senderFrame: { url: APP_URL }, sender: {} } as unknown as IpcMainInvokeEvent
  return (await listener(event, input)) as IpcResult<unknown>
}

async function value<T>(channel: string, input?: unknown): Promise<T> {
  const result = await call(channel, input)
  if (!result.ok) throw new Error(`${channel} failed: ${result.error}`)
  return result.value as T
}

const add = (bytes: Buffer, name = 'picture.png') => value<CanvasImageResult>('canvasImage.add', { projectId: PROJECT, name, data: bytes.toString('base64') })
const put = (nodeId: string) => value<TrashEntry>('trash.put', { projectId: PROJECT, nodeId })
const restore = (label: string) => value<TrashEntry>('trash.restore', { projectId: PROJECT, label })

const projectDir = () => join(dataDir, PROJECT)
const imagesDir = () => join(projectDir(), 'images')
const trashDir = () => join(projectDir(), 'trash')
const imagesOnDisk = () => (existsSync(imagesDir()) ? readdirSync(imagesDir()).sort() : [])
const nodeOf = (id: string): LayoutNode | undefined => layout.get(PROJECT).layout.nodes.find((node) => node.id === id)
const create = (node: Record<string, unknown>) => layout.apply(PROJECT, { op: 'create', node } as LayoutOpInput)

// The headers of each type, as far as main reads them; the rest of the file is filler.
const filler = (bytes: number) => Buffer.alloc(bytes, 7)

function png(width: number, height: number, extra = 64): Buffer {
  const head = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0)
  head.writeUInt32BE(13, 8)
  head.write('IHDR', 12, 'latin1')
  head.writeUInt32BE(width, 16)
  head.writeUInt32BE(height, 20)
  return Buffer.concat([head, filler(extra)])
}

function jpeg(width: number, height: number): Buffer {
  // SOI, an APP0 segment of 16 bytes, a DHT marker that is not a frame, two fill bytes, then SOF2 (progressive).
  const app0 = Buffer.concat([Buffer.from([0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF\0', 'latin1'), filler(9)])
  const dht = Buffer.from([0xff, 0xc4, 0x00, 0x04, 0x00, 0x00])
  const sof = Buffer.alloc(19)
  sof.writeUInt16BE(0xffc2, 0)
  sof.writeUInt16BE(17, 2)
  sof[4] = 8
  sof.writeUInt16BE(height, 5)
  sof.writeUInt16BE(width, 7)
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, dht, Buffer.from([0xff]), sof, filler(32)])
}

function gif(width: number, height: number): Buffer {
  const head = Buffer.alloc(10)
  head.write('GIF89a', 0, 'latin1')
  head.writeUInt16LE(width, 6)
  head.writeUInt16LE(height, 8)
  return Buffer.concat([head, filler(32)])
}

function webp(chunk: 'VP8 ' | 'VP8L' | 'VP8X', width: number, height: number): Buffer {
  const bytes = Buffer.alloc(40)
  bytes.write('RIFF', 0, 'latin1')
  bytes.writeUInt32LE(32, 4)
  bytes.write('WEBP', 8, 'latin1')
  bytes.write(chunk, 12, 'latin1')
  bytes.writeUInt32LE(20, 16)
  if (chunk === 'VP8 ') {
    Buffer.from([0x9d, 0x01, 0x2a]).copy(bytes, 23)
    bytes.writeUInt16LE(width, 26)
    bytes.writeUInt16LE(height, 28)
  } else if (chunk === 'VP8L') {
    bytes[20] = 0x2f
    bytes.writeUInt32LE(((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14), 21)
  } else {
    bytes.writeUIntLE(width - 1, 24, 3)
    bytes.writeUIntLE(height - 1, 27, 3)
  }
  return bytes
}

/** Every file under `dir` with its content, to prove a call left a folder as it was. */
function snapshot(dir: string): Record<string, string> {
  const result: Record<string, string> = {}
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) walk(path)
      else result[relative(dir, path)] = `${statSync(path).mtimeMs} ${readFileSync(path, 'latin1')}`
    }
  }
  walk(dir)
  return result
}

/** A stored image and its Node, as the Canvas makes them. */
async function imageNode(id: string, bytes = png(400, 200)): Promise<ImageNodeData> {
  const result = await add(bytes)
  if (!result.ok) throw new Error(result.error)
  create({ id, kind: 'image', x: 0, y: 0, w: 400, h: 200, data: result.image })
  return result.image
}

/** Sets a file's times into the past, as if written `ms` ago. */
const age = (path: string, ms: number) => {
  const then = new Date(Date.now() - ms)
  utimesSync(path, then, then)
}

beforeEach(async () => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-canvas-images-')))
  dataDir = join(scratch, 'data')
  repo = join(scratch, 'repo')
  mkdirSync(join(repo, 'images'), { recursive: true })
  writeFileSync(join(repo, 'README.md'), 'repo')
  mkdirSync(projectDir(), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'demo', path: repo }], activeId: PROJECT }))
  await start()
})

afterEach(async () => {
  vi.useRealTimers()
  await saveLayoutNow()
  delete process.env.WORFY_DATA_DIR
  delete process.env.WORFY_CLAUDE_HOME
  removeTestTree(scratch)
})

describe('canvasImage.add: the write path', () => {
  it('writes the bytes to <Project data folder>/images/<id>.png and answers with the natural size and type', async () => {
    const before = snapshot(repo)
    const bytes = png(1200, 300)
    const result = await add(bytes)
    expect(result).toEqual({ ok: true, image: { file: expect.stringMatching(IMAGE_FILE_PATTERN), width: 1200, height: 300, mime: 'image/png' } })
    if (!result.ok) return
    expect(result.image.file).toMatch(/^[0-9a-f]{32}\.png$/)
    expect(imagesOnDisk()).toEqual([result.image.file])
    expect(readFileSync(join(imagesDir(), result.image.file))).toEqual(bytes)
    // The Project's repository is left as it was (ADR-0005).
    expect(snapshot(repo)).toEqual(before)
  })

  it('tells each type and its size by the bytes, whatever the name says', async () => {
    const cases: [Buffer, string, string, number, number][] = [
      [jpeg(640, 480), 'image/jpeg', 'jpg', 640, 480],
      [gif(32, 16), 'image/gif', 'gif', 32, 16],
      [webp('VP8 ', 300, 150), 'image/webp', 'webp', 300, 150],
      [webp('VP8L', 5000, 3), 'image/webp', 'webp', 5000, 3],
      [webp('VP8X', 70000, 20), 'image/webp', 'webp', 70000, 20],
    ]
    for (const [bytes, mime, ext, width, height] of cases) {
      const result = await add(bytes, 'misleading.png')
      expect(result).toEqual({ ok: true, image: { file: expect.stringMatching(new RegExp(`^[0-9a-f]{32}\\.${ext}$`)), width, height, mime } })
    }
    expect(imagesOnDisk()).toHaveLength(cases.length)
  })

  it('gives every image a file of its own: the same bytes twice are two files', async () => {
    const first = await add(png(10, 10))
    const second = await add(png(10, 10))
    expect(first.ok && second.ok && first.image.file !== second.image.file).toBe(true)
    expect(imagesOnDisk()).toHaveLength(2)
  })

  it('takes an image of exactly 20 MB and refuses one byte more, writing nothing', async () => {
    const atLimit = png(100, 100, CANVAS_IMAGE_LIMIT_BYTES - 24)
    expect(atLimit.length).toBe(CANVAS_IMAGE_LIMIT_BYTES)
    expect((await add(atLimit)).ok).toBe(true)
    const over = png(100, 100, CANVAS_IMAGE_LIMIT_BYTES - 23)
    expect(await add(over, 'huge.png')).toEqual({ ok: false, error: 'huge.png is too large: images on the canvas go up to 20 MB' })
    expect(imagesOnDisk()).toHaveLength(1)
  })

  it('refuses an svg with its own message, and a file that is no image, writing nothing', async () => {
    const svg = Buffer.from('<?xml version="1.0"?>\n<!-- drawn -->\n<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    expect(await add(svg, 'logo.png')).toEqual({ ok: false, error: 'logo.png is an SVG image, which the canvas does not take: use a PNG, JPEG, GIF or WebP' })
    expect(await add(Buffer.from('<svg viewBox="0 0 1 1"></svg>'), 'bare.svg')).toMatchObject({ ok: false, error: expect.stringContaining('is an SVG image') })
    expect(await add(Buffer.from('%PDF-1.7 not an image'), 'notes.pdf')).toEqual({ ok: false, error: 'notes.pdf is not a supported image: use a PNG, JPEG, GIF or WebP' })
    expect(await add(Buffer.from('<html><body>svg</body></html>'), 'page.png')).toMatchObject({ ok: false, error: expect.stringContaining('is not a supported image') })
    expect(imagesOnDisk()).toEqual([])
    expect(existsSync(imagesDir())).toBe(false)
  })

  it('refuses an image whose header tells no size', async () => {
    const cut = png(10, 10).subarray(0, 20)
    expect(await add(cut, 'cut.png')).toEqual({ ok: false, error: 'cut.png could not be read as an image' })
    expect(await add(png(0, 10), 'empty.png')).toMatchObject({ ok: false })
    expect(await add(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xd9, 0, 0]), 'noframe.jpg')).toMatchObject({ ok: false })
    expect(imagesOnDisk()).toEqual([])
  })

  it('never overwrites a file: a name already taken throws, and the file there stays', async () => {
    const { storeImage } = await import('../../src/main/layout/images')
    const newId = () => 'a'.repeat(32)
    const first = storeImage(projectDir(), 'one.png', png(1, 1).toString('base64'), { newId })
    expect(first).toMatchObject({ ok: true, image: { file: `${'a'.repeat(32)}.png` } })
    expect(() => storeImage(projectDir(), 'two.png', png(2, 2).toString('base64'), { newId })).toThrow(/EEXIST/)
    expect(readFileSync(join(imagesDir(), `${'a'.repeat(32)}.png`))).toEqual(png(1, 1))
  })

  it('refuses a Project that is not in the list', async () => {
    const result = await call('canvasImage.add', { projectId: 'other-0b1c2d3e', name: 'x.png', data: png(1, 1).toString('base64') })
    expect(result.ok).toBe(false)
    expect(existsSync(join(dataDir, 'other-0b1c2d3e'))).toBe(false)
  })
})

describe('trash: an image Node takes its file along', () => {
  it('a deleted image moves its file to the trash; restoring brings back the Node and the file', async () => {
    const image = await imageNode('pic')
    const bytes = readFileSync(join(imagesDir(), image.file))
    const before = nodeOf('pic')

    const entry = await put('pic')
    expect(entry).toMatchObject({ nodeId: 'pic', kind: 'image', hasFiles: true })
    expect(nodeOf('pic')).toBeUndefined()
    expect(imagesOnDisk()).toEqual([])
    expect(readFileSync(join(trashDir(), entry.label, image.file))).toEqual(bytes)

    await restore(entry.label)
    expect(nodeOf('pic')).toEqual(before)
    expect(readFileSync(join(imagesDir(), image.file))).toEqual(bytes)
    expect(readdirSync(trashDir())).toEqual([])
  })

  it('a file another Node still shows stays; only the deleted Node goes to the trash', async () => {
    const image = await imageNode('first')
    create({ id: 'second', kind: 'image', x: 600, y: 0, w: 100, h: 50, data: image })
    const entry = await put('second')
    expect(entry.hasFiles).toBe(false)
    expect(imagesOnDisk()).toEqual([image.file])
    expect(readdirSync(join(trashDir(), entry.label))).toEqual(['entry.json'])
    await restore(entry.label)
    expect(nodeOf('second')?.data).toEqual(image)
    expect(imagesOnDisk()).toEqual([image.file])
  })

  it('an image whose file is gone goes to the trash as a Node alone', async () => {
    const image = await imageNode('lost')
    removeTestTree(join(imagesDir(), image.file))
    const entry = await put('lost')
    expect(entry.hasFiles).toBe(false)
    await restore(entry.label)
    expect(nodeOf('lost')).toBeDefined()
  })

  it('restore refuses, changing nothing, when a file of the same name is back in the images folder', async () => {
    const image = await imageNode('pic')
    const entry = await put('pic')
    writeFileSync(join(imagesDir(), image.file), 'another')
    const result = await call('trash.restore', { projectId: PROJECT, label: entry.label })
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining(`An image file ${image.file} exists again`) })
    expect(nodeOf('pic')).toBeUndefined()
    expect(readFileSync(join(imagesDir(), image.file), 'utf8')).toBe('another')
    expect(existsSync(join(trashDir(), entry.label, image.file))).toBe(true)
  })

  it('an entry older than three days is deleted with its file when the app starts', async () => {
    const image = await imageNode('old')
    const entry = await put('old')
    // Labels carry the time they were made at: an entry of four days ago.
    const { renameSync } = await import('node:fs')
    const oldLabel = `${Date.now() - TRASH_KEEP_MS - DAY}-${entry.label.split('-')[1]}`
    renameSync(join(trashDir(), entry.label), join(trashDir(), oldLabel))
    await start()
    await vi.waitFor(() => expect(readdirSync(trashDir())).toEqual([]))
    expect(imagesOnDisk()).toEqual([])
    expect(existsSync(join(trashDir(), oldLabel, image.file))).toBe(false)
  })
})

describe('the start-up sweep of image files', () => {
  it('deletes an old file no Node shows, and keeps the files Nodes show and the ones just written', async () => {
    const shown = await imageNode('shown')
    const orphan = await add(png(5, 5))
    const fresh = await add(png(6, 6))
    if (!orphan.ok || !fresh.ok) throw new Error('not stored')
    const stranger = join(imagesDir(), 'notes.txt')
    writeFileSync(stranger, 'not ours')
    for (const file of [shown.file, orphan.image.file]) age(join(imagesDir(), file), 60 * 60 * 1000)
    age(stranger, 60 * 60 * 1000)
    await saveLayoutNow()

    await start()
    await vi.waitFor(() => expect(imagesOnDisk()).toEqual([shown.file, fresh.image.file, 'notes.txt'].sort()))
  })

  it('deletes nothing when layout.json does not parse, was set aside as unreadable, or is not there', async () => {
    const orphan = await add(png(5, 5))
    if (!orphan.ok) throw new Error('not stored')
    const file = join(imagesDir(), orphan.image.file)
    age(file, 60 * 60 * 1000)
    await saveLayoutNow()
    const layoutFile = join(projectDir(), 'layout.json')
    const settled = () => new Promise((resolve) => setTimeout(resolve, 50))

    writeFileSync(layoutFile, '{ not json')
    await start()
    await settled()
    expect(imagesOnDisk()).toEqual([orphan.image.file])

    // JSON, but not a Layout.
    writeFileSync(layoutFile, JSON.stringify({ nodes: 'none' }))
    await start()
    await settled()
    expect(imagesOnDisk()).toEqual([orphan.image.file])

    removeTestTree(layoutFile)
    await start()
    await settled()
    expect(imagesOnDisk()).toEqual([orphan.image.file])

    writeFileSync(layoutFile, JSON.stringify({ nodes: [], viewport: { x: 0, y: 0, zoom: 1 } }))
    writeFileSync(join(projectDir(), 'layout.json.unreadable-2026-10-01T00-00-00-000Z'), '{ old')
    await start()
    await settled()
    expect(imagesOnDisk()).toEqual([orphan.image.file])

    // The same sound Layout without the set-aside file: now the sweep runs.
    removeTestTree(join(projectDir(), 'layout.json.unreadable-2026-10-01T00-00-00-000Z'))
    await start()
    await vi.waitFor(() => expect(imagesOnDisk()).toEqual([]))
  })
})
