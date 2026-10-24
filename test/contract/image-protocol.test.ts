// The worfy-image:// protocol (src/main/images/protocol.ts, worfy-ui ticket 28) on a temporary data
// folder: the copy of a sent image is served with its type and the headers; nothing else is — no
// name outside the store's pattern, nothing up a `..`, nothing through a symlink (the file or the
// store's folder), no other store, no folder, nothing over the size limit. On Windows a link to a
// share is refused before realpath is asked about it (the file system is replaced, the path rules
// are path.win32: the cases run on any machine). The schemes get their privileges in one call.
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ATTACHMENT_IMAGE_NAME,
  createImageHandler,
  IMAGE_FILE_LIMIT_BYTES,
  IMAGE_HEADERS,
  parseImageUrl,
  resolveImageFile,
  type ImageStore,
  type ImageStoreLocator,
} from '../../src/main/images/protocol'
import { ATTACHMENT_IMAGES_HOST, attachmentImageUrl, IMAGE_SCHEME } from '../../src/shared/images'
import { removeTestTree } from '../remove'

const electron = vi.hoisted(() => ({ registered: [] as unknown[][], handled: [] as string[] }))

vi.mock('electron', () => ({
  protocol: {
    registerSchemesAsPrivileged: (schemes: unknown[]) => electron.registered.push(schemes),
    handle: (scheme: string) => electron.handled.push(scheme),
  },
  app: { on: () => undefined },
  BrowserWindow: { getAllWindows: () => [] },
  session: {},
}))

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 5)])
const REF = 'ab'.repeat(32)
const NAME = `${REF}.png`

let scratch: string
let dataRoot: string
let images: string
let outside: string
let store: ImageStore
let handle: ReturnType<typeof createImageHandler>

const locate: ImageStoreLocator = (host) => (host === ATTACHMENT_IMAGES_HOST ? store : null)
const get = (url: string) => handle({ url, method: 'GET' })
const url = (name: string) => `${IMAGE_SCHEME}://${ATTACHMENT_IMAGES_HOST}/${name}`

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-image-protocol-')))
  dataRoot = join(scratch, 'data')
  images = join(dataRoot, 'attachments', 'images')
  outside = join(scratch, 'outside')
  mkdirSync(images, { recursive: true })
  mkdirSync(outside)
  writeFileSync(join(images, NAME), PNG)
  writeFileSync(join(outside, 'secret.png'), 'not yours')
  store = { dir: images, names: ATTACHMENT_IMAGE_NAME }
  handle = createImageHandler(locate)
})

afterEach(async () => {
  await removeTestTree(scratch)
})

describe('worfy-image:// serves the copy of a sent image', () => {
  it('at the address the renderer builds, with its type and the headers', async () => {
    expect(attachmentImageUrl(REF, 'image/png')).toBe(url(NAME))
    const response = await get(attachmentImageUrl(REF, 'image/png'))
    expect(response.status).toBe(200)
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'")
  })

  it.each([
    ['image/jpeg', 'jpg', 'image/jpeg'],
    ['image/gif', 'gif', 'image/gif'],
    ['image/webp', 'webp', 'image/webp'],
  ] as const)('serves %s as .%s', async (mediaType, ext, type) => {
    writeFileSync(join(images, `${REF}.${ext}`), PNG)
    const response = await get(attachmentImageUrl(REF, mediaType))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(type)
  })

  it('answers HEAD with the headers and no body, and refuses other methods', async () => {
    const head = await handle({ url: url(NAME), method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(head.headers.get('content-type')).toBe('image/png')
    expect(await head.text()).toBe('')
    const post = await handle({ url: url(NAME), method: 'POST' })
    expect(post.status).toBe(405)
    expect(post.headers.get('allow')).toBe('GET, HEAD')
    expect(post.headers.get('x-content-type-options')).toBe('nosniff')
  })
})

describe('worfy-image:// serves nothing else', () => {
  it.each([
    ['another store', `${IMAGE_SCHEME}://canvas.0a1b2c3d/${NAME}`],
    ['no host', `${IMAGE_SCHEME}:///${NAME}`],
    ['another scheme', `worfy-card://${ATTACHMENT_IMAGES_HOST}/${NAME}`],
    ['a port', `${IMAGE_SCHEME}://${ATTACHMENT_IMAGES_HOST}:81/${NAME}`],
    ['a user', `${IMAGE_SCHEME}://me@${ATTACHMENT_IMAGES_HOST}/${NAME}`],
    ['a name outside the pattern', url('notes.txt')],
    ['a hash in capitals', url(`${REF.toUpperCase()}.png`)],
    ['a hash too short', url(`${REF.slice(2)}.png`)],
    ['an extension not served', url(`${REF}.svg`)],
    ['the temporary file of a copy being written', url(`${NAME}.1234.tmp`)],
    ['two segments', url(`x/${NAME}`)],
    ['the folder itself', url('')],
    ['.. up the tree', `${IMAGE_SCHEME}://${ATTACHMENT_IMAGES_HOST}/../../outside/secret.png`],
    ['an encoded ..', url('..%2F..%2Foutside%2Fsecret.png')],
    ['an encoded backslash', url(`..%5C${NAME}`)],
    ['broken percent-encoding', url('%E0%A4%A')],
    ['a missing file', url(`${'cd'.repeat(32)}.png`)],
  ])('answers 404 for %s', async (_case, address) => {
    const response = await get(address)
    expect(response.status).toBe(404)
    expect(response.headers.get('x-content-type-options')).toBe(IMAGE_HEADERS['X-Content-Type-Options'])
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'")
  })

  it('answers 404 for a file in the store whose name is outside the pattern', async () => {
    for (const name of ['secret.png', `${REF.toUpperCase()}.png`, `${NAME.slice(0, -4)}x.png`]) {
      writeFileSync(join(images, name), PNG)
      expect((await get(url(name))).status, name).toBe(404)
    }
  })

  it('answers 404 for a folder of a name the pattern takes', async () => {
    const folder = `${'ef'.repeat(32)}.png`
    mkdirSync(join(images, folder))
    expect((await get(url(folder))).status).toBe(404)
  })

  it('answers 404 for a symlink in the store, to a file outside it or to a copy inside it', async () => {
    const out = `${'01'.repeat(32)}.png`
    symlinkSync(join(outside, 'secret.png'), join(images, out))
    expect((await get(url(out))).status).toBe(404)
    const alias = `${'02'.repeat(32)}.png`
    symlinkSync(join(images, NAME), join(images, alias))
    expect((await get(url(alias))).status).toBe(404)
    // The copy itself is still served.
    expect((await get(url(NAME))).status).toBe(200)
  })

  it('answers 404 when the store folder is a symlink to another folder', async () => {
    const elsewhere = join(scratch, 'elsewhere')
    mkdirSync(elsewhere)
    writeFileSync(join(elsewhere, NAME), PNG)
    const linked = join(dataRoot, 'attachments', 'linked')
    symlinkSync(elsewhere, linked, 'dir')
    store = { dir: linked, names: ATTACHMENT_IMAGE_NAME }
    expect((await get(url(NAME))).status).toBe(404)
  })

  it('answers 404 when there is no store folder yet', async () => {
    store = { dir: join(dataRoot, 'nothing', 'images'), names: ATTACHMENT_IMAGE_NAME }
    expect((await get(url(NAME))).status).toBe(404)
  })

  it('serves nothing over the size limit', async () => {
    const sized = (size: number) => resolveImageFile(store, NAME, { fileSize: async () => size })
    expect(await sized(IMAGE_FILE_LIMIT_BYTES)).toBe(join(images, NAME))
    expect(await sized(IMAGE_FILE_LIMIT_BYTES + 1)).toBeNull()
  })

  it('parses only an address of one file name', () => {
    expect(parseImageUrl(url(NAME))).toEqual({ host: ATTACHMENT_IMAGES_HOST, name: NAME })
    expect(parseImageUrl(url('a%20b.png'))).toEqual({ host: ATTACHMENT_IMAGES_HOST, name: 'a b.png' })
    expect(parseImageUrl('not a url')).toBeNull()
    expect(parseImageUrl(url(`a/${NAME}`))).toBeNull()
  })
})

describe('resolveImageFile and a link that leads to a share (Windows rules)', () => {
  const STORE = 'C:\\data\\attachments\\images'
  const FILE = `${STORE}\\${NAME}`

  /** `links` maps a link to its target as written; realpath answers with the path it was asked. */
  function fakeSystem(links: Record<string, string>) {
    const asked: string[] = []
    const table = new Map(Object.entries(links).map(([path, target]) => [path.toLowerCase(), target]))
    return {
      asked,
      options: {
        paths: win32,
        links: {
          isLink: async (path: string): Promise<boolean | null> => table.has(path.toLowerCase()),
          readlink: async (path: string): Promise<string> => table.get(path.toLowerCase())!,
        },
        real: async (path: string): Promise<string> => {
          asked.push(path)
          return path
        },
        fileSize: async (): Promise<number> => PNG.length,
      },
    }
  }

  it('serves a plain copy', async () => {
    const system = fakeSystem({})
    expect(await resolveImageFile({ dir: STORE, names: ATTACHMENT_IMAGE_NAME }, NAME, system.options)).toBe(FILE)
  })

  it.each([
    ['the copy', { [FILE]: '\\\\evil\\share\\x.png' }],
    ['the store folder', { [STORE]: '\\\\evil\\share\\images' }],
  ])('answers null when %s is a link to a share, and realpath is asked nothing', async (_case, links) => {
    const system = fakeSystem(links)
    expect(await resolveImageFile({ dir: STORE, names: ATTACHMENT_IMAGE_NAME }, NAME, system.options)).toBeNull()
    expect(system.asked).toEqual([])
  })
})

describe('the schemes of the app', () => {
  it('get their privileges in one call: worfy-card and worfy-image, standard and secure', async () => {
    const { registerAppSchemes } = await import('../../src/main/schemes')
    registerAppSchemes()
    expect(electron.registered).toEqual([
      [
        { scheme: 'worfy-card', privileges: { standard: true, secure: true } },
        { scheme: 'worfy-image', privileges: { standard: true, secure: true } },
      ],
    ])
  })

  it('the window loads images from worfy-image: and itself only', async () => {
    const { readFileSync } = await import('node:fs')
    const html = readFileSync(join(import.meta.dirname, '..', '..', 'src', 'renderer', 'index.html'), 'utf8')
    const csp = /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1] ?? ''
    expect(csp.split('; ')).toContain("img-src 'self' worfy-image:")
    expect(csp).not.toMatch(/img-src[^;]*(data:|blob:|https?:)/)
  })
})
