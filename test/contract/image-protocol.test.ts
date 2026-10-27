// The worfy-image:// protocol (src/main/images/protocol.ts, worfy-ui ticket 28) on a temporary data
// folder: the copy of a sent image is served with its type and the headers; nothing else is — no
// name outside the store's pattern, nothing up a `..`, nothing through a symlink (the file or the
// store's folder), no other store, no image of a Linked machine, no folder, nothing over the
// store's size limit. On Windows a link to a
// share is refused before realpath is asked about it (the file system is replaced, the path rules
// are path.win32: the cases run on any machine). The schemes get their privileges in one call.
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IMAGE_FILE_NAME_PATTERN } from '../../src/shared/agent/attachments'
import {
  ATTACHMENT_IMAGE_LIMIT_BYTES,
  attachmentImageStore,
  createImageHandler,
  IMAGE_CONTENT_TYPES,
  IMAGE_HEADERS,
  parseImageUrl,
  resolveImageFile,
  type ImageStore,
  type ImageStoreLocator,
} from '../../src/main/images/protocol'
import { ATTACHMENT_IMAGES_STORE, attachmentImageUrl, IMAGE_SCHEME, imageHost, parseImageHost } from '../../src/shared/images'
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
const MACHINE = '0123456789abcdef0123456789abcdef'
const NAME = `${REF}.png`

let scratch: string
let dataRoot: string
let images: string
let outside: string
let store: ImageStore
let handle: ReturnType<typeof createImageHandler>

const locate: ImageStoreLocator = (name) => (name === ATTACHMENT_IMAGES_STORE ? store : null)
const get = (url: string) => handle({ url, method: 'GET' })
const url = (name: string) => `${IMAGE_SCHEME}://${ATTACHMENT_IMAGES_STORE}/${name}`

beforeEach(() => {
  // The long spelling resolveImageFile answers with: realpath of node:fs/promises turns an 8.3
  // short name of TEMP (C:\Users\RUNNER~1 on the Windows runner) into the long one, realpathSync keeps it.
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-image-protocol-')))
  dataRoot = join(scratch, 'data')
  images = join(dataRoot, 'attachments', 'images')
  outside = join(scratch, 'outside')
  mkdirSync(images, { recursive: true })
  mkdirSync(outside)
  writeFileSync(join(images, NAME), PNG)
  writeFileSync(join(outside, 'secret.png'), 'not yours')
  store = attachmentImageStore(images)
  handle = createImageHandler(locate)
})

afterEach(async () => {
  await removeTestTree(scratch)
})

describe('worfy-image:// serves the copy of a sent image', () => {
  it('at the address the renderer builds, with its type and the headers', async () => {
    expect(attachmentImageUrl(REF, 'image/png', null)).toBe(url(NAME))
    const response = await get(attachmentImageUrl(REF, 'image/png', null))
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
    const response = await get(attachmentImageUrl(REF, mediaType, null))
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
    expect(post.headers.get('content-security-policy')).toBe("default-src 'none'")
    expect(post.headers.get('cache-control')).toBe('no-store')
  })

  it('takes the content types from the extensions images are stored under', () => {
    expect(IMAGE_CONTENT_TYPES).toEqual({ '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' })
    expect(attachmentImageStore(images).names).toBe(IMAGE_FILE_NAME_PATTERN)
  })
})

describe('worfy-image:// serves nothing else', () => {
  it.each([
    ['another store', `${IMAGE_SCHEME}://canvas.0a1b2c3d/${NAME}`],
    ['the store of a Linked machine', attachmentImageUrl(REF, 'image/png', MACHINE)],
    ['another store of a Linked machine', `${IMAGE_SCHEME}://canvas.0a1b2c3d.${MACHINE}/${NAME}`],
    ['no host', `${IMAGE_SCHEME}:///${NAME}`],
    ['another scheme', `worfy-card://${ATTACHMENT_IMAGES_STORE}/${NAME}`],
    ['a port', `${IMAGE_SCHEME}://${ATTACHMENT_IMAGES_STORE}:81/${NAME}`],
    ['a user', `${IMAGE_SCHEME}://me@${ATTACHMENT_IMAGES_STORE}/${NAME}`],
    ['a password', `${IMAGE_SCHEME}://:pw@${ATTACHMENT_IMAGES_STORE}/${NAME}`],
    ['a name outside the pattern', url('notes.txt')],
    ['a hash in capitals', url(`${REF.toUpperCase()}.png`)],
    ['a hash too short', url(`${REF.slice(2)}.png`)],
    ['an extension not served', url(`${REF}.svg`)],
    ['the temporary file of a copy being written', url(`${NAME}.1234.tmp`)],
    ['two segments', url(`x/${NAME}`)],
    ['the folder itself', url('')],
    ['.. up the tree', `${IMAGE_SCHEME}://${ATTACHMENT_IMAGES_STORE}/../../outside/secret.png`],
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

  it('answers 404 for a folder of a name the pattern takes, to GET and to HEAD', async () => {
    const folder = `${'ef'.repeat(32)}.png`
    mkdirSync(join(images, folder))
    expect((await get(url(folder))).status).toBe(404)
    expect((await handle({ url: url(folder), method: 'HEAD' })).status).toBe(404)
  })

  it('answers 404 for an image of a Linked machine, though this Machine has a copy of that name', async () => {
    expect(attachmentImageUrl(REF, 'image/png', MACHINE)).toBe(`${IMAGE_SCHEME}://${ATTACHMENT_IMAGES_STORE}.${MACHINE}/${NAME}`)
    const asked: string[] = []
    const response = await createImageHandler((name) => (asked.push(name), store))({ url: attachmentImageUrl(REF, 'image/png', MACHINE), method: 'GET' })
    expect(response.status).toBe(404)
    expect(asked).toEqual([])
  })

  it('answers 404 for an extension not served, whatever names the store takes', async () => {
    writeFileSync(join(images, 'x.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    writeFileSync(join(images, 'x.png'), PNG)
    store = { dir: images, names: /.*/, limit: ATTACHMENT_IMAGE_LIMIT_BYTES }
    expect((await get(url('x.svg'))).status).toBe(404)
    expect((await get(url('x.png'))).status).toBe(200)
  })

  it('answers 404 to an address without a host or with a password, and to a name with a path, even from a store that takes any name', async () => {
    store = { dir: images, names: /.*/, limit: ATTACHMENT_IMAGE_LIMIT_BYTES }
    const anyStore = createImageHandler(() => store)
    writeFileSync(join(images, 'x.png'), PNG)
    for (const address of [
      `${IMAGE_SCHEME}:///x.png`,
      `${IMAGE_SCHEME}://:pw@${ATTACHMENT_IMAGES_STORE}/x.png`,
      // From the store's folder up to the file outside it: data/attachments/images → ../../../outside.
      url('..%2F..%2F..%2Foutside%2Fsecret.png'),
      url('..%5C..%5C..%5Coutside%5Csecret.png'),
      url('sub%2Fx.png'),
    ]) {
      expect((await anyStore({ url: address, method: 'GET' })).status, address).toBe(404)
    }
    expect((await anyStore({ url: url('x.png'), method: 'GET' })).status).toBe(200)
  })

  it('answers 404 when the file cannot be read', async () => {
    const failing = createImageHandler(locate, { read: () => Promise.reject(new Error('EACCES')) })
    const response = await failing({ url: url(NAME), method: 'GET' })
    expect(response.status).toBe(404)
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'")
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
    store = attachmentImageStore(linked)
    expect((await get(url(NAME))).status).toBe(404)
  })

  it('answers 404 when there is no store folder yet', async () => {
    store = attachmentImageStore(join(dataRoot, 'nothing', 'images'))
    expect((await get(url(NAME))).status).toBe(404)
  })

  it("serves nothing over the store's size limit", async () => {
    const sized = (size: number) => resolveImageFile(store, NAME, { fileSize: async () => size })
    expect(await sized(ATTACHMENT_IMAGE_LIMIT_BYTES)).toBe(join(images, NAME))
    expect(await sized(ATTACHMENT_IMAGE_LIMIT_BYTES + 1)).toBeNull()
    // Each store has its own limit.
    store = { ...attachmentImageStore(images), limit: PNG.length - 1 }
    expect((await get(url(NAME))).status).toBe(404)
    store = { ...attachmentImageStore(images), limit: PNG.length }
    expect((await get(url(NAME))).status).toBe(200)
  })

  it('parses only an address of one file name', () => {
    expect(parseImageUrl(url(NAME))).toEqual({ host: ATTACHMENT_IMAGES_STORE, name: NAME })
    expect(parseImageUrl(url('a%20b.png'))).toEqual({ host: ATTACHMENT_IMAGES_STORE, name: 'a b.png' })
    expect(parseImageUrl('not a url')).toBeNull()
    expect(parseImageUrl(url(`a/${NAME}`))).toBeNull()
  })

  it('reads the store and the Linked machine from a host, and builds the host back', () => {
    expect(parseImageHost('attachments')).toEqual({ store: 'attachments', machineLabel: null })
    expect(parseImageHost(`attachments.${MACHINE}`)).toEqual({ store: 'attachments', machineLabel: MACHINE })
    expect(parseImageHost(`canvas.0a1b2c3d.${MACHINE}`)).toEqual({ store: 'canvas.0a1b2c3d', machineLabel: MACHINE })
    // A last part that is no machine label is part of the store's name.
    expect(parseImageHost('canvas.0a1b2c3d')).toEqual({ store: 'canvas.0a1b2c3d', machineLabel: null })
    expect(parseImageHost(MACHINE)).toEqual({ store: MACHINE, machineLabel: null })
    for (const host of ['attachments', `attachments.${MACHINE}`, `canvas.0a1b2c3d.${MACHINE}`]) expect(imageHost(parseImageHost(host))).toBe(host)
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
    expect(await resolveImageFile(attachmentImageStore(STORE), NAME, system.options)).toBe(FILE)
  })

  it('serves a store under an 8.3 short name at the long name realpath answers with', async () => {
    const short = 'C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\data\\attachments\\images'
    const long = 'C:\\Users\\runneradmin\\AppData\\Local\\Temp\\data\\attachments\\images'
    const system = fakeSystem({})
    const real = async (path: string): Promise<string> => {
      system.asked.push(path)
      return path.replace('C:\\Users\\RUNNER~1', 'C:\\Users\\runneradmin')
    }
    expect(await resolveImageFile(attachmentImageStore(short), NAME, { ...system.options, real })).toBe(`${long}\\${NAME}`)
  })

  it.each([
    ['the copy', { [FILE]: '\\\\evil\\share\\x.png' }],
    ['the store folder', { [STORE]: '\\\\evil\\share\\images' }],
  ])('answers null when %s is a link to a share, and realpath is asked nothing', async (_case, links) => {
    const system = fakeSystem(links)
    expect(await resolveImageFile(attachmentImageStore(STORE), NAME, system.options)).toBeNull()
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
