// The Evidence store of the worfy-image:// protocol (worfy-evidence ticket 12): the handler of
// src/main/images/protocol.ts with the store of src/main/images/stores.ts, over a Project in a
// temporary folder. worfy-image://evidence-<project label>/<epic>%2Fevidence%2F<file> serves a
// screenshot or a clip of `<epic>/evidence/` under the Project's Tickets root, up to 8 MB, a clip in
// ranges (206 and Content-Range) so a <video> can seek; a file over 8 MB is a 413. Everything else is
// a 404: `..` in any spelling, a symlink on any step (the file, a folder on the way, the Tickets root),
// a file of the Tickets root outside `evidence/`, a .mov, another Project, a layout that could not be
// read, a Tickets root that holds the home folder, a Linked machine's address. The other stores keep
// their answers: no clip, no Range, a file over the limit a 404.
import { mkdirSync, mkdtempSync, realpathSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EVIDENCE_FILE_LIMIT_BYTES, EVIDENCE_FILE_PATTERN, evidenceFileUrl, evidenceImagesStore, IMAGE_SCHEME, parseImageHost } from '../../src/shared/images'
import { imagesFile } from '../../src/shared/ipc/images'
import type { ImageFileOptions, MediaFile } from '../../src/main/images/protocol'
import { removeTestTree } from '../remove'

// The app's own stores (appImageStore, appSharedImageStore, the images.file handler) over the Projects of this test.
const app = vi.hoisted(() => ({ scratch: '', ids: [] as string[] }))
vi.mock('../../src/main/projects/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/main/projects/store')>()),
  projectStore: () => ({
    list: () => app.ids.map((id) => ({ id })),
    get: (id: string) => ({ id, path: `${app.scratch}/${id}` }),
    dataDir: (id: string) => `${app.scratch}/data/${id}`,
  }),
}))
vi.mock('../../src/main/workflow/folder', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/main/workflow/folder')>()
  return { ...actual, projectLayouts: () => ({ get: async (root: string) => actual.fullLayout(root) }) }
})
vi.mock('../../src/main/storage/paths', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../src/main/storage/paths')>()), dataRoot: () => `${app.scratch}/data` }))

vi.mock('electron', () => ({
  protocol: { registerSchemesAsPrivileged: () => undefined, handle: () => undefined },
  app: { on: () => undefined, getPath: () => tmpdir() },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: {},
  shell: {},
  session: {},
}))

const { byteRange, createImageHandler, EVIDENCE_CONTENT_TYPES, findImageFile, imageStatus, resolveImageFile } = await import('../../src/main/images/protocol')
const { appImageStore, appSharedImageStore, evidenceImageStore } = await import('../../src/main/images/stores')
const { fullLayout } = await import('../../src/main/workflow/folder')
type ProjectLayout = ReturnType<typeof fullLayout>

const DEMO = 'demo-0a1b2c3d'
const OTHER = 'other-0b1c2d3e'
const MACHINE = '0123456789abcdef0123456789abcdef'
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 5)])
/** 300 bytes, each its own offset modulo 256: a range is checked by its bytes. */
const CLIP = Buffer.from(Array.from({ length: 300 }, (_, at) => at % 256))

let scratch: string
let root: string
let tickets: string
let layouts: Map<string, ProjectLayout | Error>
let handle: ReturnType<typeof createImageHandler>

const projects = (ids: readonly string[] = [DEMO, OTHER]) => ({
  ids: () => ids,
  rootOf: (id: string) => join(scratch, id),
  layoutOf: async (path: string) => {
    const layout = layouts.get(path) ?? fullLayout(path)
    if (layout instanceof Error) throw layout
    return layout
  },
  places: { home: join(scratch, 'home') },
})

const address = (relPath: string, projectId = DEMO) => evidenceFileUrl(projectId, relPath, null)!
const raw = (name: string) => `${IMAGE_SCHEME}://${evidenceImagesStore(DEMO)}/${name}`
const get = (url: string, range?: string) => handle({ url, method: 'GET', headers: new Headers(range === undefined ? {} : { Range: range }) })
const status = async (url: string) => (await get(url)).status

beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-evidence-image-protocol-')))
  app.scratch = scratch
  app.ids = [DEMO]
  root = join(scratch, DEMO)
  tickets = join(root, '.scratch')
  mkdirSync(join(tickets, 'demo', 'evidence', 'sub'), { recursive: true })
  mkdirSync(join(tickets, 'demo', 'issues'), { recursive: true })
  mkdirSync(join(scratch, 'home'))
  mkdirSync(join(scratch, 'outside'))
  writeFileSync(join(tickets, 'demo', 'evidence', '12-shot.png'), PNG)
  writeFileSync(join(tickets, 'demo', 'evidence', '12-clip.webm'), CLIP)
  writeFileSync(join(tickets, 'demo', 'evidence', 'sub', 'deep.mp4'), CLIP)
  writeFileSync(join(tickets, 'demo', 'evidence', '12-clip.mov'), CLIP)
  writeFileSync(join(tickets, 'demo', 'issues', '12-shot.png'), PNG)
  writeFileSync(join(tickets, 'demo', 'spec.png'), PNG)
  writeFileSync(join(scratch, 'outside', 'secret.png'), PNG)
  layouts = new Map()
  handle = createImageHandler((store) => evidenceImageStore(store, projects()))
})

afterEach(() => {
  removeTestTree(scratch)
})

describe('worfy-image://evidence-<project label>/', () => {
  it('serves a screenshot of <epic>/evidence/ by the address evidenceFileUrl builds, as a png', async () => {
    const url = address('demo/evidence/12-shot.png')
    expect(url).toBe('worfy-image://evidence-0a1b2c3d/demo%2Fevidence%2F12-shot.png')
    expect(parseImageHost(new URL(url).hostname)).toEqual({ store: 'evidence-0a1b2c3d', machineLabel: null })
    const response = await get(url)
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/png')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('Content-Security-Policy')).toBe("default-src 'none'")
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG)
  })

  it('serves a webm and an mp4, in a folder below evidence/ too, whole with Accept-Ranges', async () => {
    const webm = await get(address('demo/evidence/12-clip.webm'))
    expect([webm.status, webm.headers.get('Content-Type'), webm.headers.get('Accept-Ranges'), webm.headers.get('Content-Length')]).toEqual([200, 'video/webm', 'bytes', '300'])
    expect(Buffer.from(await webm.arrayBuffer())).toEqual(CLIP)
    const mp4 = await get(address('demo/evidence/sub/deep.mp4'))
    expect([mp4.status, mp4.headers.get('Content-Type')]).toEqual([200, 'video/mp4'])
    expect(EVIDENCE_CONTENT_TYPES['.mov']).toBeUndefined()
  })

  it('answers Range: bytes=0-99 with 206, Content-Range and those bytes; the other forms of one range too', async () => {
    const first = await get(address('demo/evidence/12-clip.webm'), 'bytes=0-99')
    expect([first.status, first.headers.get('Content-Range'), first.headers.get('Content-Length'), first.headers.get('Content-Type')]).toEqual([206, 'bytes 0-99/300', '100', 'video/webm'])
    expect(Buffer.from(await first.arrayBuffer())).toEqual(CLIP.subarray(0, 100))
    const tail = await get(address('demo/evidence/12-clip.webm'), 'bytes=250-')
    expect([tail.status, tail.headers.get('Content-Range')]).toEqual([206, 'bytes 250-299/300'])
    expect(Buffer.from(await tail.arrayBuffer())).toEqual(CLIP.subarray(250))
    const last = await get(address('demo/evidence/12-clip.webm'), 'bytes=-10')
    expect([last.status, last.headers.get('Content-Range')]).toEqual([206, 'bytes 290-299/300'])
    expect(Buffer.from(await last.arrayBuffer())).toEqual(CLIP.subarray(290))
    // A range past the end is a 416 that names the size; one this handler does not read gets the whole file.
    const past = await get(address('demo/evidence/12-clip.webm'), 'bytes=300-')
    expect([past.status, past.headers.get('Content-Range')]).toEqual([416, 'bytes */300'])
    const several = await get(address('demo/evidence/12-clip.webm'), 'bytes=0-1,5-6')
    expect([several.status, several.headers.get('Content-Range'), (await several.arrayBuffer()).byteLength]).toEqual([200, null, 300])
    // HEAD tells the range without the bytes.
    const head = await handle({ url: address('demo/evidence/12-clip.webm'), method: 'HEAD', headers: new Headers({ Range: 'bytes=0-99' }) })
    expect([head.status, head.headers.get('Content-Range'), (await head.arrayBuffer()).byteLength]).toEqual([206, 'bytes 0-99/300', 0])
  })

  it('reads one range of bytes the way RFC 9110 writes it', () => {
    expect(byteRange(null, 300)).toBeNull()
    expect(byteRange('bytes=0-99', 300)).toEqual({ start: 0, end: 99 })
    expect(byteRange('bytes=0-', 300)).toEqual({ start: 0, end: 299 })
    expect(byteRange('bytes=200-999', 300)).toEqual({ start: 200, end: 299 })
    expect(byteRange('bytes=-500', 300)).toEqual({ start: 0, end: 299 })
    expect(byteRange('bytes=-0', 300)).toBe('unsatisfiable')
    expect(byteRange('bytes=-5', 0)).toBe('unsatisfiable')
    expect(byteRange('bytes=300-400', 300)).toBe('unsatisfiable')
    expect(byteRange('bytes=300-', 300)).toBe('unsatisfiable')
    for (const unread of ['bytes=-', 'bytes=5-3', 'items=0-5', 'bytes=0-1,5-6', 'bytes=a-b']) expect(byteRange(unread, 300), unread).toBeNull()
  })

  it('a file over 8 MB is a 413, one of exactly 8 MB is served; images.status tells the window which', async () => {
    writeFileSync(join(tickets, 'demo', 'evidence', 'big.webm'), Buffer.alloc(EVIDENCE_FILE_LIMIT_BYTES + 1))
    writeFileSync(join(tickets, 'demo', 'evidence', 'edge.webm'), Buffer.alloc(EVIDENCE_FILE_LIMIT_BYTES))
    expect(EVIDENCE_FILE_LIMIT_BYTES).toBe(8 * 1024 * 1024)
    expect(await status(address('demo/evidence/big.webm'))).toBe(413)
    expect(await status(address('demo/evidence/edge.webm'))).toBe(200)
    expect(await imageStatus(handle, address('demo/evidence/big.webm'))).toBe('too-large')
    expect(await imageStatus(handle, address('demo/evidence/nothing.webm'))).toBe('missing')
    expect(await imageStatus(handle, address('demo/evidence/12-clip.webm'))).toBe('ok')
  })

  it('refuses .., in every spelling, a file outside evidence/, a .mov, a folder and a name the pattern refuses', async () => {
    mkdirSync(join(tickets, 'demo', 'evidence', 'folder.png'))
    const cases = [
      address('demo/evidence/../issues/12-shot.png'),
      address('../outside/secret.png'),
      raw('demo%2Fevidence%2F..%2F..%2F..%2Foutside%2Fsecret.png'),
      raw('demo%2Fevidence%2F%2E%2E%2Fspec.png'),
      raw('demo/evidence/12-shot.png'),
      raw('..%2F.scratch%2Fdemo%2Fevidence%2F12-shot.png'),
      address('demo/issues/12-shot.png'),
      address('demo/spec.png'),
      address('evidence/12-shot.png'),
      address('demo/evidence/./12-shot.png'),
      address('demo//evidence/12-shot.png'),
      address('demo\\evidence\\12-shot.png'),
      address('demo/evidence/12-clip.mov'),
      address('demo/evidence/folder.png'),
      address('demo/evidence/missing.png'),
      raw('%E0%A4%A'),
    ]
    for (const url of cases) expect(await status(url), url).toBe(404)
    for (const name of ['demo/evidence/x.png', 'demo/evidence/a/b/x.webm']) expect(EVIDENCE_FILE_PATTERN.test(name), name).toBe(true)
    for (const name of ['demo/evidence/../x.png', '../evidence/x.png', 'demo/evidence/', 'demo/evidence/c:x.png', 'demo/evidence/x\0.png']) expect(EVIDENCE_FILE_PATTERN.test(name), name).toBe(false)
  })

  it('refuses a symlink on any step: the file, a folder on the way, the epic, the Tickets root', async () => {
    const evidence = join(tickets, 'demo', 'evidence')
    symlinkSync(join(scratch, 'outside', 'secret.png'), join(evidence, 'link.png'))
    symlinkSync(join(evidence, '12-shot.png'), join(evidence, 'inside-link.png'))
    symlinkSync(join(scratch, 'outside'), join(evidence, 'linked-folder'), 'junction')
    mkdirSync(join(scratch, 'outside', 'evidence'))
    writeFileSync(join(scratch, 'outside', 'evidence', 'x.png'), PNG)
    symlinkSync(join(scratch, 'outside'), join(tickets, 'linked-epic'), 'junction')
    for (const name of ['demo/evidence/link.png', 'demo/evidence/inside-link.png', 'demo/evidence/linked-folder/secret.png', 'linked-epic/evidence/x.png']) expect(await status(address(name)), name).toBe(404)

    // The Tickets root itself a link: nothing of it is served.
    const other = join(scratch, OTHER)
    mkdirSync(other)
    symlinkSync(tickets, join(other, '.scratch'), 'junction')
    expect(await status(address('demo/evidence/12-shot.png', OTHER))).toBe(404)
    expect(await status(address('demo/evidence/12-shot.png', DEMO))).toBe(200)
  })

  it('serves the Tickets root of the layout: the Workflow folder’s in Silent mode', async () => {
    const workflow = join(scratch, 'workflow')
    mkdirSync(join(workflow, 'tickets', 'demo', 'evidence'), { recursive: true })
    writeFileSync(join(workflow, 'tickets', 'demo', 'evidence', 'silent.png'), PNG)
    layouts.set(root, { ...fullLayout(root), mode: 'silent', workflowFolder: workflow, ticketsRoot: join(workflow, 'tickets') })
    expect(await status(address('demo/evidence/silent.png'))).toBe(200)
    expect(await status(address('demo/evidence/12-shot.png'))).toBe(404)
  })

  it('serves nothing for a layout that failed or could not be read, nor for a Tickets root that holds the home folder', async () => {
    layouts.set(root, { ...fullLayout(root), failed: true })
    expect(await status(address('demo/evidence/12-shot.png'))).toBe(404)
    layouts.set(root, new Error('profile failed'))
    expect(await status(address('demo/evidence/12-shot.png'))).toBe(404)
    // A Profile that names a folder above the home folder as the Tickets root: workflowPlaces leaves it out.
    mkdirSync(join(scratch, 'demo', 'evidence'), { recursive: true })
    writeFileSync(join(scratch, 'demo', 'evidence', 'home.png'), PNG)
    layouts.set(root, { ...fullLayout(root), ticketsRoot: scratch })
    expect(await status(address('demo/evidence/home.png'))).toBe(404)
  })

  it('builds an address the window can load for a label of digits only: the label is never the last part of the host', () => {
    const url = evidenceFileUrl('demo-00000006', 'demo/evidence/12-shot.png', null)!
    expect(url).toBe('worfy-image://evidence-00000006/demo%2Fevidence%2F12-shot.png')
    // The window treats worfy-image: as a standard scheme, whose host is read as http's: an all-digit last part is an IPv4 address.
    expect(URL.canParse(url.replace(/^worfy-image:/, 'http:'))).toBe(true)
    expect(URL.canParse('http://evidence.00000006/x')).toBe(false)
  })

  it('names exactly one Project: another label, two Projects of one label and an id without a label serve nothing', async () => {
    mkdirSync(join(scratch, OTHER, '.scratch'), { recursive: true })
    expect(await evidenceImageStore('evidence-0b1c2d3e', projects())).toMatchObject({ dir: join(scratch, OTHER, '.scratch'), nested: true, media: true })
    expect(await evidenceImageStore('evidence-ffffffff', projects())).toBeNull()
    expect(await evidenceImageStore('evidence-0a1b2c3d', projects([DEMO, 'twin-0a1b2c3d']))).toBeNull()
    expect(await evidenceImageStore('canvas.0a1b2c3d', projects())).toBeNull()
    expect(evidenceImagesStore('no-label')).toBeNull()
    expect(evidenceFileUrl('no-label', 'demo/evidence/x.png', null)).toBeNull()
  })

  it('a locator that rejects is a 404', async () => {
    const failing = createImageHandler(() => Promise.reject(new Error('no layout')))
    expect((await failing({ url: address('demo/evidence/12-shot.png'), method: 'GET' })).status).toBe(404)
  })

  it('a file that cannot be opened is a 404', async () => {
    const unreadable = createImageHandler((store) => evidenceImageStore(store, projects()), { open: () => Promise.reject(new Error('EIO')) })
    expect((await unreadable({ url: address('demo/evidence/12-clip.webm'), method: 'GET' })).status).toBe(404)
  })

  it('reads from one descriptor only the bytes of the range, and closes it', async () => {
    const reads: [number, number][] = []
    let closed = 0
    const counting = createImageHandler((store) => evidenceImageStore(store, projects()), {
      open: async (path) => {
        const handle = await open(path, 'r')
        return {
          stat: (options) => handle.stat(options),
          read: (buffer, offset, length, position) => {
            reads.push([position, length])
            return handle.read(buffer, offset, length, position)
          },
          close: async () => {
            closed += 1
            await handle.close()
          },
        }
      },
    })
    const response = await counting({ url: address('demo/evidence/12-clip.webm'), method: 'GET', headers: new Headers({ Range: 'bytes=100-149' }) })
    expect([response.status, response.headers.get('Content-Range')]).toEqual([206, 'bytes 100-149/300'])
    expect(Buffer.from(await response.arrayBuffer())).toEqual(CLIP.subarray(100, 150))
    expect(reads).toEqual([[100, 50]])
    expect(closed).toBe(1)
  })

  it('serves the descriptor it checked: another file at the path since the check, one grown over 8 MB, one cut short — none is served', async () => {
    const clip = join(tickets, 'demo', 'evidence', '12-clip.webm')
    const other = statSync(join(tickets, 'demo', 'evidence', '12-shot.png'), { bigint: true })
    const swapped = createImageHandler((store) => evidenceImageStore(store, projects()), { lstat: async () => ({ dev: other.dev, ino: other.ino }) })
    expect((await swapped({ url: address('demo/evidence/12-clip.webm'), method: 'GET' })).status).toBe(404)
    // The same path and file pass the same check.
    const same = statSync(clip, { bigint: true })
    const kept = createImageHandler((store) => evidenceImageStore(store, projects()), { lstat: async () => ({ dev: same.dev, ino: same.ino }) })
    expect((await kept({ url: address('demo/evidence/12-clip.webm'), method: 'GET' })).status).toBe(200)

    const real = (path: string) => open(path, 'r')
    const grown = createImageHandler((store) => evidenceImageStore(store, projects()), {
      open: async (path) => {
        const handle = await real(path)
        return { stat: async (options) => ({ ...(await handle.stat(options)), size: BigInt(EVIDENCE_FILE_LIMIT_BYTES + 1) }), read: (...args) => handle.read(...args), close: () => handle.close() }
      },
    })
    expect((await grown({ url: address('demo/evidence/12-clip.webm'), method: 'GET' })).status).toBe(413)
    const cut = createImageHandler((store) => evidenceImageStore(store, projects()), {
      open: async (path) => {
        const handle = await real(path)
        return { stat: (options) => handle.stat(options), read: async () => ({ bytesRead: 0 }), close: () => handle.close() }
      },
    })
    expect((await cut({ url: address('demo/evidence/12-clip.webm'), method: 'GET' })).status).toBe(404)
  })

  it('tells apart two files whose 64-bit file ids differ past the 53 bits of a number, as on NTFS: another file at the path is a 404 (worfy-polish 47)', async () => {
    // An NTFS file id holds the MFT record in its low 48 bits and the record's sequence number above them: from
    // sequence 32 on it is past 2^53, where a number rounds, and two files made one after the other can read as
    // one inode. The red on the Windows CI job (runs 42145908675, 42354007348, 42483722519) was this: `swapped`
    // above served the clip with the other file's identity. Here the system answers as Node does on Windows:
    // the exact ids when asked for bigints, the rounded numbers otherwise.
    const openedId = (40n << 48n) + 1000n
    const namedId = openedId + 1n
    expect(Number(openedId)).toBe(Number(namedId))
    const system = (ino: bigint, size: number) => async (_path?: unknown, options?: { bigint?: boolean }) =>
      options?.bigint === true ? { dev: 7n, ino, size: BigInt(size) } : { dev: 7, ino: Number(ino), size }
    const ntfs = createImageHandler((store) => evidenceImageStore(store, projects()), {
      open: async (path) => {
        const handle = await open(path, 'r')
        const answer = system(openedId, (await handle.stat()).size)
        return { stat: ((options) => answer(path, options)) as MediaFile['stat'], read: (...args) => handle.read(...args), close: () => handle.close() }
      },
      lstat: system(namedId, 0) as NonNullable<ImageFileOptions['lstat']>,
    })
    expect((await ntfs({ url: address('demo/evidence/12-clip.webm'), method: 'GET' })).status).toBe(404)
  })

  it('serves a .jpeg and a .jpg as image/jpeg', async () => {
    writeFileSync(join(tickets, 'demo', 'evidence', 'shot.jpeg'), PNG)
    writeFileSync(join(tickets, 'demo', 'evidence', 'shot.jpg'), PNG)
    for (const name of ['demo/evidence/shot.jpeg', 'demo/evidence/shot.jpg']) {
      const response = await get(address(name))
      expect([response.status, response.headers.get('Content-Type')], name).toEqual([200, 'image/jpeg'])
    }
  })

  it('never leaves this Machine: a Linked machine’s address is a 404, and images.file does not take the store', async () => {
    const url = evidenceFileUrl(DEMO, 'demo/evidence/12-shot.png', MACHINE)!
    expect(parseImageHost(new URL(url).hostname)).toEqual({ store: 'evidence-0a1b2c3d', machineLabel: MACHINE })
    const asked: unknown[] = []
    const linked = createImageHandler(
      (store) => evidenceImageStore(store, projects()),
      {},
      async (request) => {
        asked.push(request)
        return { status: 'file', extension: '.png', bytes: PNG }
      },
    )
    expect((await linked({ url, method: 'GET' })).status).toBe(404)
    expect(asked).toEqual([])
    expect(imagesFile.input.safeParse({ store: 'evidence-0a1b2c3d', name: 'demo/evidence/12-shot.png' }).success).toBe(false)
  })
})

describe('the other stores keep their answers', () => {
  const store = () => ({ dir: join(tickets, 'demo', 'evidence'), names: /^[^/]+$/, limit: 200 })

  it('serve no clip, read no Range and do not tell a file over their limit', async () => {
    const plain = createImageHandler((name) => (name === 'plain' ? store() : null))
    expect((await plain({ url: `${IMAGE_SCHEME}://plain/12-clip.webm`, method: 'GET' })).status).toBe(404)
    expect(await resolveImageFile({ ...store(), limit: 1000 }, '12-clip.webm')).toBeNull()
    expect(await resolveImageFile({ ...store(), limit: 1000, media: true }, '12-clip.webm')).toBe(join(tickets, 'demo', 'evidence', '12-clip.webm'))
    const png = await plain({ url: `${IMAGE_SCHEME}://plain/12-shot.png`, method: 'GET', headers: new Headers({ Range: 'bytes=0-9' }) })
    expect([png.status, png.headers.get('Content-Range'), png.headers.get('Accept-Ranges'), (await png.arrayBuffer()).byteLength]).toEqual([200, null, null, PNG.length])
    // Over the limit: a 404, as before; the Evidence store alone says 413.
    expect(await findImageFile({ ...store(), limit: 10 }, '12-shot.png')).toBe('too-large')
    expect((await createImageHandler(() => ({ ...store(), limit: 10 }))({ url: `${IMAGE_SCHEME}://plain/12-shot.png`, method: 'GET' })).status).toBe(404)
  })

  it('take one file name only; a nested store refuses an empty, . or .. part whatever its pattern lets through', async () => {
    const any = { dir: tickets, names: /.*/, limit: 1000 }
    expect(await resolveImageFile(any, 'demo/evidence/12-shot.png')).toBeNull()
    expect(await resolveImageFile({ ...any, nested: true }, 'demo/evidence/12-shot.png')).toBe(join(tickets, 'demo', 'evidence', '12-shot.png'))
    for (const name of ['demo/evidence/../issues/12-shot.png', 'demo/./evidence/12-shot.png', 'demo//evidence/12-shot.png', 'demo\\evidence\\12-shot.png']) {
      expect(await resolveImageFile({ ...any, nested: true }, name), name).toBeNull()
    }
    // A `\` is a separator on Windows; elsewhere a file may carry it in its name, and it is still not served.
    if (process.platform !== 'win32') {
      writeFileSync(join(tickets, 'demo', 'evidence', 'back\\slash.png'), PNG)
      expect(await resolveImageFile({ ...any, nested: true }, 'demo/evidence/back\\slash.png')).toBeNull()
      expect(await resolveImageFile({ dir: join(tickets, 'demo', 'evidence'), names: /.*/, limit: 1000 }, 'back\\slash.png')).toBeNull()
    }
  })
})

describe('the stores of the app', () => {
  it('give this Machine’s window the Evidence store of a Project, and the shared stores as before', async () => {
    expect(await appImageStore('evidence-0a1b2c3d')).toMatchObject({ dir: join(scratch, DEMO, '.scratch'), nested: true, media: true, limit: EVIDENCE_FILE_LIMIT_BYTES })
    expect(await appImageStore('evidence-0b1c2d3e')).toBeNull()
    expect(await appImageStore('canvas.0a1b2c3d')).toMatchObject({ dir: join(scratch, 'data', DEMO, 'images') })
    expect(await appImageStore('attachments')).toMatchObject({ dir: join(scratch, 'data', 'attachments', 'images') })
    expect(appSharedImageStore('evidence-0a1b2c3d')).toBeNull()
    expect(appSharedImageStore('canvas.0a1b2c3d')).toMatchObject({ dir: join(scratch, 'data', DEMO, 'images') })
  })

  it('images.file, the link to another Machine, finds no Evidence store even past its input check', async () => {
    const { default: handlers } = await import('../../src/main/ipc/images')
    const handler = handlers.find(({ channel }) => channel.name === 'images.file')!
    const ask = (store: string, name: string) => (handler.handle as (input: unknown, context: unknown) => Promise<unknown>)({ store, name, offset: 0, length: 100 }, {})
    expect(await ask('evidence-0a1b2c3d', 'demo/evidence/12-shot.png')).toEqual({ status: 'missing' })
    // A Canvas image of the same Project still goes.
    mkdirSync(join(scratch, 'data', DEMO, 'images'), { recursive: true })
    writeFileSync(join(scratch, 'data', DEMO, 'images', `${'a'.repeat(32)}.png`), PNG)
    expect(await ask('canvas.0a1b2c3d', `${'a'.repeat(32)}.png`)).toMatchObject({ status: 'file' })
  })
})
