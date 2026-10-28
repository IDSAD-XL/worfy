import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { decodePng } from './browser-pixels'
import { canvasReady, launchApp } from './helpers'

// Images on the Canvas (worfy-canvas ticket 23) against the built app: an image pasted with the
// focus on the Canvas becomes an `image` Node at its natural size; its card is stretched very wide
// and very tall, and the pixels show the image whole and undistorted each time; the image is there
// after a restart; Delete takes it to the trash with its file and ⌘Z brings both back; dropped
// files become Nodes side by side, and an svg or a file over 20 MB is refused with a toast. A paste
// into a note's text field is the field's, not the Canvas's.
//
// The paste and the drop are dispatched in the page with the files in their DataTransfer: a real
// ⌘V would read and overwrite the system clipboard of the machine the test runs on.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const ALPHA = 'alpha-0000000a'
/** The test image: a red rectangle twice as wide as it is high. */
const NATURAL = { width: 400, height: 200 }

interface StateNode {
  id: string
  kind: string
  x: number
  y: number
  w: number
  h: number
  data: Record<string, unknown>
}

let scratch: string
let dataDir: string
let repo: string

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-image-')))
  dataDir = join(scratch, 'data')
  repo = join(scratch, 'alpha')
  mkdirSync(repo)
  mkdirSync(join(dataDir, ALPHA), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: ALPHA, name: 'alpha', path: repo }], activeId: ALPHA }))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

async function imagesOf(window: Page): Promise<StateNode[]> {
  const result = await window.evaluate(
    (projectId) =>
      (globalThis as unknown as { worfy: { invoke(c: string, i: unknown): Promise<{ ok: boolean; value: { layout: { nodes: StateNode[] } } }> } }).worfy.invoke('layout.get', { projectId }),
    ALPHA,
  )
  return result.value.layout.nodes.filter((node) => node.kind === 'image')
}

const imageFiles = (): string[] => {
  const dir = join(dataDir, ALPHA, 'images')
  return existsSync(dir) ? readdirSync(dir).sort() : []
}

interface MadeFile {
  name: string
  type: string
  /** Draw a red `width` × `height` PNG; otherwise `text` or `bytes` zero bytes. */
  png?: { width: number; height: number }
  text?: string
  bytes?: number
}

/**
 * What runs in the page for carry(): it makes the files and dispatches a paste (on `selector`, or
 * on the focused element) or a dragover and a drop (on the element at `at`). A string, since the
 * specs are type-checked without the DOM's types.
 */
const CARRY_IN_PAGE = `async ({ kind, files, target }) => {
  const transfer = new DataTransfer()
  for (const made of files) {
    let body
    if (made.png) {
      const canvas = new OffscreenCanvas(made.png.width, made.png.height)
      const context = canvas.getContext('2d')
      context.fillStyle = '#ff0000'
      context.fillRect(0, 0, made.png.width, made.png.height)
      body = await canvas.convertToBlob({ type: 'image/png' })
    } else body = made.text ?? new Uint8Array(made.bytes ?? 0)
    transfer.items.add(new File([body], made.name, { type: made.type }))
  }
  if (kind === 'paste') {
    const element = (target.selector ? document.querySelector(target.selector) : document.activeElement) ?? document.body
    return element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }))
  }
  const at = target.at ?? { x: 0, y: 0 }
  const element = document.elementFromPoint(at.x, at.y)
  const init = { dataTransfer: transfer, clientX: at.x, clientY: at.y, bubbles: true, cancelable: true }
  element.dispatchEvent(new DragEvent('dragover', init))
  return element.dispatchEvent(new DragEvent('drop', init))
}`

/** Pastes or drops the files in the page; resolves with whether the page let the event through (not prevented). */
async function carry(window: Page, kind: 'paste' | 'drop', files: MadeFile[], target: { selector?: string; at?: { x: number; y: number } } = {}): Promise<boolean> {
  return (await window.evaluate(`(${CARRY_IN_PAGE})(${JSON.stringify({ kind, files, target })})`)) as boolean
}

async function box(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const found = await locator.boundingBox()
  if (!found) throw new Error('the element has no box')
  return found
}

/** The red part of a capture of the Node: where the image's own pixels are, in the capture's pixels. */
async function redBox(node: Locator): Promise<{ left: number; top: number; width: number; height: number; card: { width: number; height: number } }> {
  const image = decodePng(await node.screenshot())
  let [left, top, right, bottom] = [image.width, image.height, -1, -1]
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const at = (y * image.width + x) * 4
      const [r, g, b] = [image.data[at]!, image.data[at + 1]!, image.data[at + 2]!]
      if (r > 200 && g < 70 && b < 70) {
        left = Math.min(left, x)
        right = Math.max(right, x)
        top = Math.min(top, y)
        bottom = Math.max(bottom, y)
      }
    }
  }
  if (right < 0) throw new Error('no red pixel in the Node')
  return { left, top, width: right - left + 1, height: bottom - top + 1, card: { width: image.width, height: image.height } }
}

/** The image shows whole and undistorted: its visible part has the natural proportions, fills one side of the card and sits in the middle. */
async function expectUndistorted(node: Locator, label: string): Promise<void> {
  await expect(node.getByRole('img', { name: 'Image' })).toHaveJSProperty('complete', true)
  const red = await redBox(node)
  const ratio = red.width / red.height
  expect(Math.abs(ratio - NATURAL.width / NATURAL.height), `${label}: the image is ${red.width} × ${red.height} on screen`).toBeLessThan(0.08)
  // Contained: it reaches the card's edges on the tight side (less the border), and is centred on the other.
  const tight = red.width / red.card.width > red.height / red.card.height ? 'width' : 'height'
  if (tight === 'width') expect(red.card.width - red.width, `${label}: fills the width`).toBeLessThan(8)
  else expect(red.card.height - red.height, `${label}: fills the height`).toBeLessThan(8)
  const middle = { x: red.left + red.width / 2, y: red.top + red.height / 2 }
  expect(Math.abs(middle.x - red.card.width / 2), `${label}: centred across`).toBeLessThan(4)
  expect(Math.abs(middle.y - red.card.height / 2), `${label}: centred down`).toBeLessThan(4)
}

/** Drags the selected Node's bottom-right handle so the Node becomes `w` × `h` on screen (zoom 1). */
async function resizeTo(window: Page, node: Locator, w: number, h: number): Promise<void> {
  const now = await box(node)
  await resizeBy(window, w - now.width, h - now.height)
}

/** Drags the selected Node's bottom-right handle by (dx, dy). */
async function resizeBy(window: Page, dx: number, dy: number): Promise<void> {
  const handle = window.locator('.react-flow__resize-control.handle.bottom.right')
  await canvasReady({ window }, { visible: [handle] })
  const start = await box(handle)
  const from = { x: start.x + start.width / 2, y: start.y + start.height / 2 }
  await window.mouse.move(from.x, from.y)
  await window.mouse.down()
  await window.mouse.move(from.x + dx, from.y + dy, { steps: 12 })
  await window.mouse.up()
}

test('a pasted image becomes a Node, stays undistorted at any card size, survives a restart, and Delete and ⌘Z move its file', async () => {
  const first = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
  let file: string
  try {
    const { window } = first
    await canvasReady(first)
    const pane = window.locator('.react-flow__pane')
    const room = await box(pane)

    // The pointer over the empty plane, the focus on the Canvas: the image lands under the pointer —
    // left of the middle and below the Orchestrator Node, which takes the top-left corner.
    await pane.click({ position: { x: 300, y: Math.round(room.height * 0.55) } })
    expect(await carry(window, 'paste', [{ name: 'image.png', type: 'image/png', png: NATURAL }])).toBe(false)
    const node = window.getByTestId('image-node')
    await expect(node).toHaveCount(1)
    await expect.poll(async () => (await imagesOf(window)).length).toBe(1)
    const [made] = await imagesOf(window)
    if (!made) throw new Error('no image Node')
    file = String(made.data.file)
    expect(made).toMatchObject({ w: NATURAL.width, h: NATURAL.height, data: { file: expect.stringMatching(/^[0-9a-f]{32}\.png$/), width: NATURAL.width, height: NATURAL.height, mime: 'image/png' } })
    expect(Object.keys(made.data).sort()).toEqual(['file', 'height', 'mime', 'width'])
    // Its bytes are in the Project's data folder, and nothing is in the Project's repository.
    expect(imageFiles()).toEqual([file])
    expect(readdirSync(repo)).toEqual([])
    await expectUndistorted(node, 'at its natural size')

    // A paste into a note's text field is the field's: no image Node.
    await pane.dblclick({ position: { x: Math.round(room.width * 0.6), y: Math.round(room.height - 150) } })
    const text = window.getByRole('textbox', { name: 'Note text' })
    await text.focus()
    expect(await carry(window, 'paste', [{ name: 'image.png', type: 'image/png', png: { width: 10, height: 10 } }], { selector: 'textarea' })).toBe(true)
    await window.waitForTimeout(500)
    expect(await imagesOf(window)).toHaveLength(1)

    // Very wide, then very tall: the image keeps its proportions, fitted and centred.
    // To 60 px short of the Canvas's right edge, 60 px high.
    await node.click()
    const placed = await box(node)
    await resizeTo(window, node, room.x + room.width - 60 - placed.x, 60)
    await expect.poll(async () => (await imagesOf(window))[0]?.h).toBe(60)
    const wide = await box(node)
    expect(wide.width / wide.height).toBeGreaterThan(10)
    await expectUndistorted(node, 'very wide')

    // 60 px wide, down to 60 px short of the Canvas's bottom edge.
    await resizeTo(window, node, 60, room.y + room.height - 60 - placed.y)
    await expect.poll(async () => (await imagesOf(window))[0]?.w).toBe(60)
    const tall = await box(node)
    expect(tall.height / tall.width).toBeGreaterThan(5)
    await expectUndistorted(node, 'very tall')
  } finally {
    await first.close()
  }

  const second = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
  try {
    const { window } = second
    await canvasReady(second)
    const node = window.getByTestId('image-node')
    await expect(node).toHaveCount(1)
    await expectUndistorted(node, 'after a restart')
    expect(imageFiles()).toEqual([file])

    // Delete takes the Node to the trash with its file; ⌘Z brings both back.
    await node.click()
    await window.keyboard.press('Delete')
    await expect(node).toHaveCount(0)
    await expect.poll(imageFiles).toEqual([])
    const trash = join(dataDir, ALPHA, 'trash')
    expect(readdirSync(trash).flatMap((label) => readdirSync(join(trash, label)))).toContain(file)
    await window.keyboard.press('ControlOrMeta+Z')
    await expect(node).toHaveCount(1)
    await expect.poll(imageFiles).toEqual([file])
    await expectUndistorted(node, 'after undo')
  } finally {
    await second.close()
  }
})

test('dropped images become Nodes side by side; an svg and a file over 20 MB are refused with a toast', async () => {
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
  try {
    const { window } = launched
    await canvasReady(launched)
    const pane = await box(window.locator('.react-flow__pane'))
    const at = { x: pane.x + 420, y: pane.y + 320 }

    expect(
      await carry(
        window,
        'drop',
        [
          { name: 'one.png', type: 'image/png', png: { width: 120, height: 60 } },
          { name: 'two.png', type: 'image/png', png: { width: 60, height: 120 } },
        ],
        { at },
      ),
    ).toBe(false)
    await expect(window.getByTestId('image-node')).toHaveCount(2)
    await expect.poll(async () => (await imagesOf(window)).length).toBe(2)
    const [one, two] = (await imagesOf(window)).sort((a, b) => a.x - b.x)
    expect(one).toMatchObject({ w: 120, h: 60, data: { width: 120, height: 60 } })
    expect(two).toMatchObject({ w: 60, h: 120, data: { width: 60, height: 120 } })
    // Cascaded: the second lands right of and below the first.
    expect(two!.x + two!.w / 2).toBeGreaterThan(one!.x + one!.w / 2)
    expect(two!.y + two!.h / 2).toBeGreaterThan(one!.y + one!.h / 2)
    expect(imageFiles()).toHaveLength(2)

    // Refused files are dropped on another empty spot: the first two Nodes lie at `at` now.
    const empty = { x: pane.x + 120, y: pane.y + pane.height - 120 }
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'
    await carry(window, 'drop', [{ name: 'logo.svg', type: 'image/svg+xml', text: svg }], { at: empty })
    await expect(window.getByTestId('image-refused').filter({ hasText: 'logo.svg is an SVG image' })).toBeVisible()

    await carry(window, 'drop', [{ name: 'huge.png', type: 'image/png', bytes: 20 * 1024 * 1024 + 1 }], { at: empty })
    await expect(window.getByTestId('image-refused').filter({ hasText: 'huge.png is too large: images on the canvas go up to 20 MB' })).toBeVisible()

    await window.waitForTimeout(300)
    expect(await imagesOf(window)).toHaveLength(2)
    expect(imageFiles()).toHaveLength(2)
    expect(readdirSync(repo)).toEqual([])
  } finally {
    await launched.close()
  }
})
