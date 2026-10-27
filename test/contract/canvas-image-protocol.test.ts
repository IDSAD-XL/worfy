// The Canvas images store of the worfy-image:// protocol (worfy-canvas ticket 23): the handler of
// src/main/images/protocol.ts with the store of src/main/layout/images.ts, over two Projects'
// data folders in a temporary folder. worfy-image://canvas.<project label>/<file> serves a file of
// that Project's images folder whose name main could have chosen, up to 20 MB; everything else is
// a 404 — another folder, another Project's file, a name outside the pattern, an svg, a Linked
// machine's address.
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CANVAS_IMAGE_LIMIT_BYTES } from '../../src/shared/ipc/canvas-images'
import { ATTACHMENT_IMAGES_STORE, canvasImagesStore, canvasImageUrl, IMAGE_SCHEME, parseImageHost, projectLabelOf } from '../../src/shared/images'
import { removeTestTree } from '../remove'

vi.mock('electron', () => ({
  protocol: { registerSchemesAsPrivileged: () => undefined, handle: () => undefined },
  app: { on: () => undefined },
  BrowserWindow: { getAllWindows: () => [] },
  session: {},
}))

const { createImageHandler } = await import('../../src/main/images/protocol')
const { canvasImageStore, imagesDirOf } = await import('../../src/main/layout/images')
const { projectIdHash } = await import('../../src/main/projects/store')

const ALPHA = 'alpha-0a1b2c3d'
const BETA = 'Beta Project-0b1c2d3e'
const MACHINE = '0123456789abcdef0123456789abcdef'
const FILE = `${'a'.repeat(32)}.png`
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 5)])

let scratch: string
let handle: ReturnType<typeof createImageHandler>
const dataDirOf = (id: string) => join(scratch, 'data', id)
const status = async (url: string) => (await handle({ url, method: 'GET' })).status
const address = (store: string, name: string) => `${IMAGE_SCHEME}://${store}/${name}`

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-canvas-image-protocol-')))
  for (const id of [ALPHA, BETA]) mkdirSync(imagesDirOf(dataDirOf(id)), { recursive: true })
  writeFileSync(join(imagesDirOf(dataDirOf(ALPHA)), FILE), PNG)
  handle = createImageHandler((store) => canvasImageStore(store, { ids: () => [ALPHA, BETA], dataDirOf }))
})

afterEach(() => {
  removeTestTree(scratch)
})

describe('worfy-image://canvas.<project label>/', () => {
  it('serves a Project image by the address canvasImageUrl builds, as a png', async () => {
    const url = canvasImageUrl(ALPHA, FILE, null)
    expect(url).toBe(`worfy-image://canvas.0a1b2c3d/${FILE}`)
    const response = await handle({ url: url!, method: 'GET' })
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/png')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG)
  })

  it('names the project label the way main does, also for an id with capitals and spaces', () => {
    for (const id of [ALPHA, BETA, 'a-0a1b2c3d-b', 'a-0a1b2c3']) expect(projectLabelOf(id), id).toBe(projectIdHash(id))
    expect(canvasImagesStore(BETA)).toBe('canvas.0b1c2d3e')
    expect(canvasImagesStore('no-label')).toBeNull()
    expect(canvasImageUrl('no-label', FILE, null)).toBeNull()
  })

  it('a Linked machine address carries its label, and this Machine answers it with a 404', async () => {
    const url = canvasImageUrl(ALPHA, FILE, MACHINE)!
    expect(parseImageHost(new URL(url).hostname)).toEqual({ store: 'canvas.0a1b2c3d', machineLabel: MACHINE })
    expect(await status(url)).toBe(404)
  })

  it('refuses a path out of the folder, another Project, a foreign id and a name outside the pattern', async () => {
    writeFileSync(join(dataDirOf(ALPHA), 'layout.json'), '{}')
    writeFileSync(join(imagesDirOf(dataDirOf(ALPHA)), 'notes.png'), PNG)
    writeFileSync(join(imagesDirOf(dataDirOf(ALPHA)), `${'a'.repeat(31)}.png`), PNG)
    const cases = [
      address('canvas.0a1b2c3d', '..%2Flayout.json'),
      address('canvas.0a1b2c3d', '../layout.json'),
      address('canvas.0a1b2c3d', '%2E%2E%2Flayout.json'),
      // ALPHA's file under BETA's label, and under a label no Project in the list has.
      address('canvas.0b1c2d3e', FILE),
      address('canvas.ffffffff', FILE),
      address('canvas', FILE),
      address(ATTACHMENT_IMAGES_STORE, FILE),
      // An id of the right form that is not there.
      address('canvas.0a1b2c3d', `${'b'.repeat(32)}.png`),
      // Names outside the pattern, though the file is there.
      address('canvas.0a1b2c3d', 'notes.png'),
      address('canvas.0a1b2c3d', `${'a'.repeat(32)}.PNG`),
      address('canvas.0a1b2c3d', `${'a'.repeat(31)}.png`),
    ]
    for (const url of cases) expect(await status(url), url).toBe(404)
  })

  it('two Projects with one label: neither is served', async () => {
    const twin = 'other-0a1b2c3d'
    mkdirSync(imagesDirOf(dataDirOf(twin)), { recursive: true })
    handle = createImageHandler((store) => canvasImageStore(store, { ids: () => [ALPHA, twin], dataDirOf }))
    expect(await status(canvasImageUrl(ALPHA, FILE, null)!)).toBe(404)
  })

  it('refuses an svg and a file over 20 MB', async () => {
    writeFileSync(join(imagesDirOf(dataDirOf(ALPHA)), `${'c'.repeat(32)}.svg`), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    expect(await status(address('canvas.0a1b2c3d', `${'c'.repeat(32)}.svg`))).toBe(404)
    const huge = `${'d'.repeat(32)}.png`
    writeFileSync(join(imagesDirOf(dataDirOf(ALPHA)), huge), Buffer.alloc(CANVAS_IMAGE_LIMIT_BYTES + 1, 1))
    expect(await status(address('canvas.0a1b2c3d', huge))).toBe(404)
    const atLimit = `${'e'.repeat(32)}.png`
    writeFileSync(join(imagesDirOf(dataDirOf(ALPHA)), atLimit), Buffer.alloc(CANVAS_IMAGE_LIMIT_BYTES, 1))
    expect(await status(address('canvas.0a1b2c3d', atLimit))).toBe(200)
  })
})
