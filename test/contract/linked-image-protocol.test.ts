// The images of a Linked machine (worfy-canvas ticket 24): this Machine's worfy-image:// handler
// (src/main/images/protocol.ts) with its second source (src/main/images/remote.ts), and Machine M
// that keeps the images answering `images.file` (src/shared/ipc/images.ts) as its main does
// (readImageFileChunk, through the channel's schemas), over temporary data folders.
//
// A Canvas image of M and the copy of an image sent in a Session of M come over in pieces of at most
// 4 MB, up to 20 MB. Only a store name and a file name go to M, never a path; M serves only a name
// of the store's own pattern from the store's own folder: no `..`, no absolute path, no separator,
// encoded or not, no symlink (the file or the folder), no file of another Project. M answers
// `missing` and `too-large`; this side answers 404, 413 and 502, and images.status tells the window which.
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { machineLabel } from '../../src/shared/cards/bridge'
import { cardsFile } from '../../src/shared/ipc/cards'
import { ATTACHMENT_IMAGES_STORE, attachmentImageUrl, canvasImageUrl, IMAGE_SCHEME } from '../../src/shared/images'
import { IMAGE_FILE_CHUNK_BYTES, IMAGE_FILE_LIMIT_BYTES, imagesFile, imageStatusSchema } from '../../src/shared/ipc/images'
import { removeTestTree } from '../remove'

vi.mock('electron', () => ({
  protocol: { registerSchemesAsPrivileged: () => undefined, handle: () => undefined },
  app: { on: () => undefined },
  BrowserWindow: { getAllWindows: () => [] },
  session: {},
}))

const { attachmentImageStore, createImageHandler, IMAGE_HEADERS, imageStatus, readImageFileChunk } = await import('../../src/main/images/protocol')
const { createLinkedImageSource } = await import('../../src/main/images/remote')
const { canvasImageStore, imagesDirOf } = await import('../../src/main/layout/images')
type ImageStore = import('../../src/main/images/protocol').ImageStore
type LinkedImageSource = import('../../src/main/images/protocol').LinkedImageSource

const MACHINE_M = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b'
const M_LABEL = machineLabel(MACHINE_M)!
const ALPHA = 'alpha-0a1b2c3d'
const BETA = 'beta-0b1c2d3e'
const FILE = `${'a'.repeat(32)}.png`
const OTHER = `${'b'.repeat(32)}.png`
const REF = 'ab'.repeat(32)
const SENT = `${REF}.png`
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 5)])

let scratch: string
let dataOfM: string
let outside: string
let calls: { machine: string; channel: string; input: { store: string; name: string; offset: number; length: number } }[]
let reachable: boolean
let handle: ReturnType<typeof createImageHandler>

const dataDirOf = (id: string) => join(dataOfM, id)
const attachmentsOfM = () => join(dataOfM, 'attachments', 'images')
/** The stores of M, as its main finds them (src/main/images/stores.ts). */
const storeOfM = (store: string): ImageStore | null =>
  store === ATTACHMENT_IMAGES_STORE ? attachmentImageStore(attachmentsOfM()) : canvasImageStore(store, { ids: () => [ALPHA, BETA], dataDirOf })
const canvasOfM = (file: string, project = ALPHA) => canvasImageUrl(project, file, M_LABEL)!
const get = (url: string) => handle({ url, method: 'GET' })

/** M's answer to images.file, as its main gives it (src/main/ipc/images.ts), through the channel's schemas. */
async function answerOfM(input: unknown) {
  const parsed = imagesFile.input.parse(input)
  return imagesFile.output.parse(await readImageFileChunk(storeOfM(parsed.store), parsed.name, parsed.offset, parsed.length))
}

beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-linked-image-')))
  dataOfM = join(scratch, 'data-of-m')
  outside = join(scratch, 'outside')
  for (const id of [ALPHA, BETA]) mkdirSync(imagesDirOf(dataDirOf(id)), { recursive: true })
  mkdirSync(attachmentsOfM(), { recursive: true })
  mkdirSync(outside)
  writeFileSync(join(imagesDirOf(dataDirOf(ALPHA)), FILE), PNG)
  writeFileSync(join(imagesDirOf(dataDirOf(BETA)), OTHER), PNG)
  writeFileSync(join(attachmentsOfM(), SENT), PNG)
  writeFileSync(join(outside, FILE), 'not yours')
  calls = []
  reachable = true
  const source = createLinkedImageSource({
    machines: () => Promise.resolve([{ id: MACHINE_M }, { id: 'another-machine' }]),
    call: async (machine, channel, input) => {
      const parsed = imagesFile.input.parse(input)
      calls.push({ machine, channel, input: parsed })
      if (!reachable) return { ok: false, error: `${channel}: Mini is unreachable` }
      if (machine !== MACHINE_M || channel !== 'images.file') return { ok: false, error: 'wrong call' }
      return { ok: true, value: await answerOfM(parsed) }
    },
  })
  // This Machine has no image of its own: whatever is served comes from M.
  handle = createImageHandler(() => null, {}, source)
})

afterEach(() => {
  removeTestTree(scratch)
})

const expectImageHeaders = (response: Response, what: string) => {
  for (const [name, value] of Object.entries(IMAGE_HEADERS)) expect(response.headers.get(name), `${what}: ${name}`).toBe(value)
}

describe('an image of a Linked machine comes over the link', () => {
  it('a Canvas image of M, at the address the window builds, with its type and the headers', async () => {
    expect(canvasOfM(FILE)).toBe(`${IMAGE_SCHEME}://canvas.0a1b2c3d.${M_LABEL}/${FILE}`)
    const response = await get(canvasOfM(FILE))
    expect(response.status).toBe(200)
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG)
    expect(response.headers.get('content-type')).toBe('image/png')
    expectImageHeaders(response, 'canvas image')
    // Only the store name and the file name went to M: no path.
    expect(calls).toEqual([{ machine: MACHINE_M, channel: 'images.file', input: { store: 'canvas.0a1b2c3d', name: FILE, offset: 0, length: IMAGE_FILE_CHUNK_BYTES } }])
  })

  it('the copy of an image sent in a Session of M, at worfy-image://attachments.<machine label>/', async () => {
    const url = attachmentImageUrl(REF, 'image/png', M_LABEL)
    expect(url).toBe(`${IMAGE_SCHEME}://${ATTACHMENT_IMAGES_STORE}.${M_LABEL}/${SENT}`)
    const response = await get(url)
    expect(response.status).toBe(200)
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG)
    expect(calls[0]?.input).toMatchObject({ store: ATTACHMENT_IMAGES_STORE, name: SENT })
  })

  it('an image larger than one piece comes in pieces of at most 4 MB, glued in order', async () => {
    expect(IMAGE_FILE_CHUNK_BYTES).toBe(4 * 1024 * 1024)
    const size = IMAGE_FILE_CHUNK_BYTES * 2 + 5
    const bytes = Buffer.alloc(size)
    for (let index = 0; index < size; index += 4096) bytes[index] = (index / 4096) % 251
    writeFileSync(join(imagesDirOf(dataDirOf(ALPHA)), FILE), bytes)
    const response = await get(canvasOfM(FILE))
    expect(response.status).toBe(200)
    expect(Buffer.from(await response.arrayBuffer()).equals(bytes)).toBe(true)
    expect(calls.map((each) => each.input.offset)).toEqual([0, IMAGE_FILE_CHUNK_BYTES, IMAGE_FILE_CHUNK_BYTES * 2])
    expect(calls.every((each) => each.input.length <= IMAGE_FILE_CHUNK_BYTES)).toBe(true)
  })

  it('HEAD asks M for no bytes', async () => {
    const head = await handle({ url: canvasOfM(FILE), method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(head.headers.get('content-type')).toBe('image/png')
    expect(await head.text()).toBe('')
    expect(calls.map((each) => each.input.length)).toEqual([0])
  })

  it('an image over 20 MB is a 413, and M reads none of it; a Linked machine that sends more anyway is not believed', async () => {
    expect(IMAGE_FILE_LIMIT_BYTES).toBe(20 * 1024 * 1024)
    writeFileSync(join(imagesDirOf(dataDirOf(ALPHA)), FILE), Buffer.alloc(IMAGE_FILE_LIMIT_BYTES + 1))
    const response = await get(canvasOfM(FILE))
    expect(response.status).toBe(413)
    expectImageHeaders(response, '413')
    expect(calls).toHaveLength(1)

    const lying: LinkedImageSource = () => Promise.resolve({ status: 'file', extension: '.png', bytes: new Uint8Array(IMAGE_FILE_LIMIT_BYTES + 1) })
    expect((await createImageHandler(() => null, {}, lying)({ url: canvasOfM(FILE), method: 'GET' })).status).toBe(413)
  })

  it('the receiving side holds the limit while it glues the pieces: a size over 20 MB stops it at the first piece', async () => {
    const asked: number[] = []
    const source = createLinkedImageSource({
      machines: () => Promise.resolve([{ id: MACHINE_M }]),
      call: (_machine, _channel, input) => {
        asked.push(imagesFile.input.parse(input).offset)
        return Promise.resolve({ ok: true, value: { status: 'file', extension: '.png', size: IMAGE_FILE_LIMIT_BYTES + 1, mtimeMs: 1, base64: PNG.toString('base64') } })
      },
    })
    expect(await source({ machineLabel: M_LABEL, store: 'canvas.0a1b2c3d', name: FILE, head: false })).toEqual({ status: 'too-large' })
    expect(asked).toEqual([0])
  })

  it('M unreachable is a 502 with the reason; an unknown machine label is a 404 and nothing is asked', async () => {
    reachable = false
    const response = await get(canvasOfM(FILE))
    expect(response.status).toBe(502)
    expectImageHeaders(response, '502')
    expect(await response.text()).toBe('images.file: Mini is unreachable')
    calls = []
    expect((await get(`${IMAGE_SCHEME}://canvas.0a1b2c3d.${'0'.repeat(32)}/${FILE}`)).status).toBe(404)
    expect(calls).toEqual([])
  })

  it('an extension other than the one the name asked for, or one not served, is a 404', async () => {
    for (const extension of ['.gif', '.svg', '.html']) {
      const odd: LinkedImageSource = () => Promise.resolve({ status: 'file', extension, bytes: new Uint8Array(PNG) })
      expect((await createImageHandler(() => null, {}, odd)({ url: canvasOfM(FILE), method: 'GET' })).status, extension).toBe(404)
    }
  })

  it('images.status tells the window why: ok, missing, too-large, unreachable', async () => {
    expect(imageStatusSchema.options).toEqual(['ok', 'missing', 'too-large', 'unreachable'])
    expect(await imageStatus(handle, canvasOfM(FILE))).toBe('ok')
    expect(await imageStatus(handle, canvasOfM(`${'c'.repeat(32)}.png`))).toBe('missing')
    writeFileSync(join(imagesDirOf(dataDirOf(ALPHA)), FILE), Buffer.alloc(IMAGE_FILE_LIMIT_BYTES + 1))
    expect(await imageStatus(handle, canvasOfM(FILE))).toBe('too-large')
    reachable = false
    expect(await imageStatus(handle, canvasOfM(FILE))).toBe('unreachable')
    // A HEAD each time: M is never asked for bytes to tell the status.
    expect(calls.every((each) => each.input.length === 0)).toBe(true)
  })
})

describe('M serves only a name of the store, from the store: what goes over the link is refused', () => {
  const read = (store: string, name: string, offset = 0, length = IMAGE_FILE_CHUNK_BYTES) => readImageFileChunk(storeOfM(store), name, offset, length)

  it('sends a piece of the file with its extension, size and mtime', async () => {
    const whole = await read('canvas.0a1b2c3d', FILE)
    expect(whole).toMatchObject({ status: 'file', extension: '.png', size: PNG.length, base64: PNG.toString('base64') })
    const piece = await read('canvas.0a1b2c3d', FILE, 8, 4)
    expect(piece.status === 'file' && Buffer.from(piece.base64, 'base64')).toEqual(PNG.subarray(8, 12))
    expect((await read(ATTACHMENT_IMAGES_STORE, SENT)).status).toBe('file')
  })

  it.each([
    ['.. up the tree', `../../../outside/${FILE}`],
    ['.. into another Project', `../../${BETA}/images/${OTHER}`],
    ['an absolute path', join(tmpdir(), 'outside', FILE)],
    ['a Windows absolute path', `C:\\outside\\${FILE}`],
    ['a backslash', `..\\${FILE}`],
    ['an encoded slash', `..%2F..%2Foutside%2F${FILE}`],
    ['an encoded backslash', `..%5C${FILE}`],
    ['a NUL byte', `${FILE}\0.png`],
    ['a name outside the pattern', 'secret.png'],
    ['a name in capitals', FILE.toUpperCase()],
    ['the folder itself', '.'],
    ['an extension not served', `${'a'.repeat(32)}.svg`],
  ])('answers missing for %s', async (_case, name) => {
    expect(await read('canvas.0a1b2c3d', name)).toEqual({ status: 'missing' })
    expect(await read(ATTACHMENT_IMAGES_STORE, name)).toEqual({ status: 'missing' })
  })

  it("answers missing for a name of another Project's image, and for a store no single Project has", async () => {
    expect(await read('canvas.0a1b2c3d', OTHER)).toEqual({ status: 'missing' })
    expect((await read('canvas.0b1c2d3e', OTHER)).status).toBe('file')
    expect(await read('canvas.ffffffff', FILE)).toEqual({ status: 'missing' })
    // A Canvas name is no copy of a sent image, and the other way round.
    expect(await read(ATTACHMENT_IMAGES_STORE, FILE)).toEqual({ status: 'missing' })
    expect(await read('canvas.0a1b2c3d', SENT)).toEqual({ status: 'missing' })
  })

  it('answers missing for a symlink in the store, to a file outside it or to an image inside it', async () => {
    const images = imagesDirOf(dataDirOf(ALPHA))
    const out = `${'1'.repeat(32)}.png`
    symlinkSync(join(outside, FILE), join(images, out))
    expect(await read('canvas.0a1b2c3d', out)).toEqual({ status: 'missing' })
    const alias = `${'2'.repeat(32)}.png`
    symlinkSync(join(images, FILE), join(images, alias))
    expect(await read('canvas.0a1b2c3d', alias)).toEqual({ status: 'missing' })
    const sentOut = `${'cd'.repeat(32)}.png`
    symlinkSync(join(outside, FILE), join(attachmentsOfM(), sentOut))
    expect(await read(ATTACHMENT_IMAGES_STORE, sentOut)).toEqual({ status: 'missing' })
  })

  it("answers missing when the store's folder is a symlink to another folder", async () => {
    const images = imagesDirOf(dataDirOf(ALPHA))
    removeTestTree(images)
    mkdirSync(join(outside, 'images'))
    writeFileSync(join(outside, 'images', FILE), PNG)
    symlinkSync(join(outside, 'images'), images, 'dir')
    expect(await read('canvas.0a1b2c3d', FILE)).toEqual({ status: 'missing' })
  })

  it('answers missing for a missing file, a folder and no store; too-large over the limit, reading none of it', async () => {
    expect(await read('canvas.0a1b2c3d', `${'c'.repeat(32)}.png`)).toEqual({ status: 'missing' })
    mkdirSync(join(imagesDirOf(dataDirOf(ALPHA)), `${'d'.repeat(32)}.png`))
    expect(await read('canvas.0a1b2c3d', `${'d'.repeat(32)}.png`)).toEqual({ status: 'missing' })
    expect(await readImageFileChunk(null, FILE, 0, 10)).toEqual({ status: 'missing' })
    const small = { ...storeOfM('canvas.0a1b2c3d')!, limit: PNG.length - 1 }
    expect(await readImageFileChunk(small, FILE, 0, 10)).toEqual({ status: 'too-large', size: PNG.length })
    expect((await readImageFileChunk({ ...small, limit: PNG.length }, FILE, 0, 10)).status).toBe('file')
  })

  it('the channel takes only a store name of the pattern and at most one piece', () => {
    const input = (store: string, length = IMAGE_FILE_CHUNK_BYTES) => imagesFile.input.safeParse({ store, name: FILE, offset: 0, length }).success
    expect(input('canvas.0a1b2c3d')).toBe(true)
    expect(input(ATTACHMENT_IMAGES_STORE)).toBe(true)
    for (const store of ['canvas', 'canvas.0A1B2C3D', 'canvas.0a1b2c3d/..', '../canvas.0a1b2c3d', `attachments.${M_LABEL}`, 'cards', '/tmp', '']) expect(input(store), store).toBe(false)
    expect(input('canvas.0a1b2c3d', IMAGE_FILE_CHUNK_BYTES + 1)).toBe(false)
    // The answer is the same as for a Card file.
    expect(imagesFile.output).toBe(cardsFile.output)
  })
})
