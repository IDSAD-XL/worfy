import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { canvasReady, launchApp, openSecondWindow } from './helpers'

// The Canvas of a Project against the built app: Nodes are created, moved and resized in the
// window, main saves layout.json in the Project's data folder, and a restarted app shows the same
// Layout. The Projects are written into projects.json up front, so no folder picker is involved.

// Electron helper processes may still hold files in a directory for a moment after the app exits.
const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const ALPHA = 'alpha-0000000a'
const BETA = 'beta-0000000b'

interface StateNode {
  id: string
  kind: string
  x: number
  y: number
  w: number
  h: number
  data: Record<string, unknown>
}
type Camera = { x: number; y: number; zoom: number }
interface State {
  projectId: string
  layout: { nodes: StateNode[]; viewport: Camera }
  revision: number
}

let scratch: string
let dataDir: string

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-canvas-')))
  dataDir = join(scratch, 'data')
  const projects = [ALPHA, BETA].map((id) => {
    const name = id.split('-')[0] ?? id
    const path = join(scratch, name)
    mkdirSync(path)
    mkdirSync(join(dataDir, id), { recursive: true })
    return { id, name, path }
  })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects, activeId: ALPHA }))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

/** What main answers on `channel`; fails the test on {ok:false}. */
async function ask<T>(window: Page, channel: string, input: unknown): Promise<T> {
  const result = await window.evaluate(
    ({ channel, input }) =>
      (globalThis as unknown as { worfy: { invoke(c: string, i: unknown): Promise<{ ok: boolean; value: unknown; error?: string }> } }).worfy.invoke(channel, input),
    { channel, input },
  )
  expect(result, `${channel}: ${result.error ?? ''}`).toMatchObject({ ok: true })
  return result.value as T
}

/** The Layout as main has it. */
async function layoutOf(window: Page, projectId: string): Promise<State['layout']> {
  return (await ask<State>(window, 'layout.get', { projectId })).layout
}

/** The camera this machine saved for the Project's Canvas (worfy-link ticket 06). */
const cameraOf = (window: Page, projectId: string): Promise<Camera> => ask<Camera>(window, 'viewport.get', { projectId })

/** The notes of a Layout: every Project's Canvas also has its Orchestrator Node (ticket 08). */
const notesOf = (layout: Pick<State['layout'], 'nodes'>): StateNode[] => layout.nodes.filter((node) => node.kind === 'note')

const rounded = ({ x, y, w, h }: StateNode) => ({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) })

async function box(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const found = await locator.boundingBox()
  if (!found) throw new Error('the element has no box')
  return found
}

async function center(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox()
  if (!box) throw new Error('the element has no box')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

async function drag(window: Page, from: Locator, dx: number, dy: number): Promise<void> {
  // The press lands only once nothing on the Canvas moves or is redrawn: a drag that starts while
  // React Flow still lays the Node out follows the pointer only part of the way.
  await canvasReady({ window }, { visible: [from] })
  const start = await center(from)
  await window.mouse.move(start.x, start.y)
  await window.mouse.down()
  await window.mouse.move(start.x + dx, start.y + dy, { steps: 12 })
  await window.mouse.up()
}

const projectButton = (window: Page, name: string) => window.getByTestId('project-row').filter({ hasText: name }).getByRole('button')

test('a note is created, moved, resized and edited, survives a restart, and each Project has its own Canvas', async () => {
  const first = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
  let created: StateNode
  let shown: Awaited<ReturnType<typeof box>>
  try {
    const { window } = first
    const canvas = window.getByTestId('canvas')
    await expect(canvas).toHaveAttribute('data-project-id', ALPHA)

    // A double click on the empty plane creates a note where the pointer is (below the
    // Orchestrator Node, which takes the top-left corner of a new Canvas).
    await window.locator('.react-flow__pane').dblclick({ position: { x: 300, y: 340 } })
    const note = window.getByTestId('note-node')
    await expect(note).toHaveCount(1)
    await expect.poll(async () => notesOf(await layoutOf(window, ALPHA)).length).toBe(1)
    const [initial] = notesOf(await layoutOf(window, ALPHA))
    if (!initial) throw new Error('no node')
    expect(initial).toMatchObject({ kind: 'note', w: 220, h: 120 })

    await note.getByRole('textbox', { name: 'Note text' }).fill('remember the milk')
    // On the empty plane: right of the Orchestrator Node, far from the minimap at the bottom right.
    await window.locator('.react-flow__pane').click({ position: { x: 500, y: 40 } })
    await expect.poll(async () => notesOf(await layoutOf(window, ALPHA))[0]?.data).toEqual({ text: 'remember the milk' })

    // Moved by its header. The zoom is 1, so screen pixels are canvas units: main must save the
    // position the window shows. (React Flow starts a drag past a threshold, so the Node travels a
    // few pixels less than the pointer.) Up and to the right, past the Orchestrator Node: lower
    // down, the resize handle of the next step would sit under the minimap on a small screen.
    const unmoved = await box(note)
    await drag(window, note.locator('.w-note__header'), 150, -80)
    const moved = await box(note)
    expect(moved.x - unmoved.x).toBeGreaterThan(100)
    expect(moved.y - unmoved.y).toBeLessThan(-50)
    const at = { x: Math.round(initial.x + moved.x - unmoved.x), y: Math.round(initial.y + moved.y - unmoved.y) }
    await expect.poll(async () => rounded(notesOf(await layoutOf(window, ALPHA))[0] as StateNode)).toEqual({ ...at, w: 220, h: 120 })

    // Resized by the bottom-right handle of the selected Node.
    await note.locator('.w-note__header').click()
    await drag(window, window.locator('.react-flow__resize-control.handle.bottom.right'), 60, 40)
    const resized = await box(note)
    expect(resized.width - moved.width).toBeGreaterThan(40)
    expect(resized.height - moved.height).toBeGreaterThan(20)
    await expect.poll(async () => rounded(notesOf(await layoutOf(window, ALPHA))[0] as StateNode)).toEqual({
      ...at,
      w: Math.round(resized.width),
      h: Math.round(resized.height),
    })
    created = notesOf(await layoutOf(window, ALPHA))[0] as StateNode
    shown = resized

    // The Canvas view is hidden while the Session view shows; back on it, the note is drawn as before.
    await window.getByRole('group', { name: 'View', exact: true }).getByRole('button', { name: 'Session' }).click()
    await expect(canvas).toBeHidden()
    await window.getByRole('group', { name: 'View', exact: true }).getByRole('button', { name: 'Canvas' }).click()
    await expect(note).toBeVisible()
    expect(await box(note)).toEqual(resized)

    // Another Project, another Canvas.
    await projectButton(window, 'beta').click()
    await expect(canvas).toHaveAttribute('data-project-id', BETA)
    await expect(window.getByTestId('note-node')).toHaveCount(0)
    await window.locator('.react-flow__pane').dblclick({ position: { x: 500, y: 400 } })
    await expect(window.getByTestId('note-node')).toHaveCount(1)
    await expect.poll(async () => notesOf(await layoutOf(window, BETA)).length).toBe(1)

    await projectButton(window, 'alpha').click()
    await expect(canvas).toHaveAttribute('data-project-id', ALPHA)
    await expect(window.getByTestId('note-node')).toHaveCount(1)
    await expect(window.getByRole('textbox', { name: 'Note text' })).toHaveValue('remember the milk')
    expect(await box(window.getByTestId('note-node'))).toEqual(resized)

    for (const scheme of ['light', 'dark'] as const) {
      await window.emulateMedia({ colorScheme: scheme })
      await window.screenshot({ path: test.info().outputPath(`canvas-${scheme}.png`), omitBackground: true })
    }

    // One more move, and the app is closed as soon as main has it: the write still waiting for
    // the save delay must happen on quit.
    const note2 = window.getByTestId('note-node')
    await drag(window, note2.locator('.w-note__header'), -40, 60)
    await expect.poll(async () => rounded(notesOf(await layoutOf(window, ALPHA))[0] as StateNode)).not.toEqual(rounded(created))
    created = notesOf(await layoutOf(window, ALPHA))[0] as StateNode
    shown = await box(note2)
  } finally {
    await first.close()
  }

  // Saved in the Project's data folder, read back by the next start.
  const onDisk = JSON.parse(readFileSync(join(dataDir, ALPHA, 'layout.json'), 'utf8')) as State['layout']
  expect(notesOf(onDisk).map(rounded)).toEqual([rounded(created)])
  const second = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
  try {
    const { window } = second
    await expect(window.getByTestId('canvas')).toHaveAttribute('data-project-id', ALPHA)
    const note = window.getByTestId('note-node')
    await expect(note).toHaveCount(1)
    await expect(note.getByRole('textbox', { name: 'Note text' })).toHaveValue('remember the milk')
    expect(notesOf(await layoutOf(window, ALPHA)).map(rounded)).toEqual([rounded(created)])
    expect(await box(note)).toEqual(shown)
  } finally {
    await second.close()
  }
})

test('text typed into a note is saved when the app quits while the note still has the focus', async () => {
  writeFileSync(
    join(dataDir, ALPHA, 'layout.json'),
    JSON.stringify({ nodes: [{ id: 'n1', kind: 'note', x: 120, y: 80, w: 220, h: 120, data: { text: '' } }], viewport: { x: 0, y: 0, zoom: 1 } }),
  )
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
  try {
    const textbox = launched.window.getByTestId('note-node').getByRole('textbox', { name: 'Note text' })
    await textbox.click()
    await launched.window.keyboard.type('typed before quit')
    await expect(textbox).toBeFocused()
    await expect(textbox).toHaveValue('typed before quit')
  } finally {
    // No blur and no wait for the save delay: the app quits right after the last key.
    await launched.close()
  }
  const onDisk = JSON.parse(readFileSync(join(dataDir, ALPHA, 'layout.json'), 'utf8')) as State['layout']
  expect(onDisk.nodes.find((node) => node.id === 'n1')?.data).toEqual({ text: 'typed before quit' })
})

test('a note keeps its focus and caret while what is typed reaches main, and a change from main replaces its text', async () => {
  writeFileSync(
    join(dataDir, ALPHA, 'layout.json'),
    JSON.stringify({ nodes: [{ id: 'n1', kind: 'note', x: 120, y: 80, w: 220, h: 120, data: { text: '' } }], viewport: { x: 0, y: 0, zoom: 1 } }),
  )
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
  try {
    const { window } = launched
    const textbox = window.getByTestId('note-node').getByRole('textbox', { name: 'Note text' })
    await textbox.click()
    await window.keyboard.type('first')
    // Sent while the note still has the focus.
    await expect.poll(async () => notesOf(await layoutOf(window, ALPHA))[0]?.data).toEqual({ text: 'first' })
    await expect(textbox).toBeFocused()
    await window.keyboard.type(' second')
    await expect(textbox).toHaveValue('first second')
    await expect.poll(async () => notesOf(await layoutOf(window, ALPHA))[0]?.data).toEqual({ text: 'first second' })

    // Another writer (later: the MCP tools) changes the text while the note is not being edited.
    await window.locator('.react-flow__pane').click({ position: { x: 40, y: 40 } }) // top left: the minimap sits bottom right
    await window.evaluate(() =>
      (globalThis as unknown as { worfy: { invoke(c: string, i: unknown): Promise<unknown> } }).worfy.invoke('layout.apply', {
        projectId: 'alpha-0000000a',
        op: { op: 'patchData', id: 'n1', data: { text: 'from main' } },
      }),
    )
    await expect(textbox).toHaveValue('from main')
  } finally {
    await launched.close()
  }
})

test('a Node of an unknown kind is drawn as a placeholder and the rest of the Canvas works', async () => {
  writeFileSync(
    join(dataDir, ALPHA, 'layout.json'),
    JSON.stringify({
      nodes: [
        { id: 'future', kind: 'from-the-future', x: 40, y: 40, w: 200, h: 80, data: { whatever: true } },
        { id: 'n1', kind: 'note', x: 320, y: 40, w: 220, h: 120, data: { text: 'still here' } },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    }),
  )
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
  try {
    const { window } = launched
    await expect(window.getByTestId('unknown-node')).toHaveText('Unknown node: from-the-future')
    const note = window.getByTestId('note-node')
    await expect(note.getByRole('textbox', { name: 'Note text' })).toHaveValue('still here')

    const before = await box(note)
    await drag(window, note.locator('.w-note__header'), 40, 120)
    const after = await box(note)
    expect(after.y - before.y).toBeGreaterThan(80)
    await expect
      .poll(async () => rounded((await layoutOf(window, ALPHA)).nodes.find((node) => node.id === 'n1') as StateNode))
      .toEqual({ x: Math.round(320 + after.x - before.x), y: Math.round(40 + after.y - before.y), w: 220, h: 120 })
    // The unknown Node is kept as it was, data included.
    expect((await layoutOf(window, ALPHA)).nodes.find((node) => node.id === 'future')).toMatchObject({ kind: 'from-the-future', x: 40, y: 40, data: { whatever: true } })
  } finally {
    await launched.close()
  }
})

test('zoom: ⌘= and ⌘− step within 0.2–2.5, ⌘ + wheel zooms, the wheel pans, and the viewport is saved', async () => {
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
  const zoom = async () => (await cameraOf(launched.window, ALPHA)).zoom
  try {
    const { window } = launched
    await expect(window.getByTestId('canvas')).toBeVisible()
    const pane = window.locator('.react-flow__pane')
    const middle = await center(pane)
    await window.mouse.move(middle.x, middle.y)

    await window.keyboard.press('ControlOrMeta+Equal')
    await expect.poll(zoom).toBeGreaterThan(1)
    for (let n = 0; n < 20; n++) await window.keyboard.press('ControlOrMeta+Equal')
    await expect.poll(zoom).toBeCloseTo(2.5)
    for (let n = 0; n < 40; n++) await window.keyboard.press('ControlOrMeta+Minus')
    await expect.poll(zoom).toBeCloseTo(0.2)

    // The wheel alone pans and keeps the zoom.
    const before = await cameraOf(window, ALPHA)
    await window.mouse.wheel(0, 200)
    await expect.poll(async () => (await cameraOf(window, ALPHA)).y).not.toBe(before.y)
    expect(await zoom()).toBeCloseTo(0.2)

    // ⌘ + wheel zooms.
    await window.keyboard.down('ControlOrMeta')
    await window.mouse.wheel(0, -300)
    await window.keyboard.up('ControlOrMeta')
    await expect.poll(zoom).toBeGreaterThan(0.21)
  } finally {
    await launched.close()
  }
})

// ── The camera of each screen (worfy-link ticket 06) ─────────────────────────

/** React Flow's camera transform in a window. */
const transformOf = (window: Page): Promise<string> =>
  window.locator('.react-flow__viewport').evaluate((element) => (element as unknown as { style: { transform: string } }).style.transform)

/** The camera a window shows, read off React Flow's transform. */
async function shownCamera(window: Page): Promise<Camera> {
  const transform = await transformOf(window)
  const match = /translate\((-?[\d.e+-]+)px,\s*(-?[\d.e+-]+)px\)\s*scale\(([\d.e+-]+)\)/.exec(transform)
  if (!match) throw new Error(`not a React Flow transform: ${transform}`)
  return { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) }
}

const viewportsFile = () => join(dataDir, 'viewports.json')
const savedCameras = (): Record<string, Camera> => JSON.parse(readFileSync(viewportsFile(), 'utf8')) as Record<string, Camera>
const layoutCamera = (): Camera => (JSON.parse(readFileSync(join(dataDir, ALPHA, 'layout.json'), 'utf8')) as State['layout']).viewport

test('two windows have their own cameras: a pan in one moves nothing in the other and leaves the Layout alone; a reload opens at the camera saved last', async () => {
  // Saved by a worfy that kept the camera in the Layout: it is the camera of the first opening.
  const saved: Camera = { x: -40, y: 20, zoom: 1 }
  writeFileSync(
    join(dataDir, ALPHA, 'layout.json'),
    JSON.stringify({ nodes: [{ id: 'n1', kind: 'note', x: 120, y: 80, w: 220, h: 120, data: { text: 'plane' } }], viewport: saved }),
  )
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
  try {
    const { window } = launched
    const plane = (page: Page) => page.getByTestId('rf__node-n1')
    const pinned = (page: Page) => page.getByTestId('rf__node-p1')
    await canvasReady(launched, { size: { width: 1600, height: 1000 }, visible: [plane(window)] })
    expect(await shownCamera(window)).toEqual(saved)

    // A Node pinned at the right edge of window 1's Canvas: in the narrower window 2 it is moved inside.
    const canvas1 = await box(window.getByTestId('canvas'))
    await ask(window, 'layout.apply', { projectId: ALPHA, op: { op: 'create', node: { id: 'p1', kind: 'note', x: 0, y: 600, w: 220, h: 120, data: { text: 'pinned' } } } })
    await ask(window, 'layout.apply', { projectId: ALPHA, op: { op: 'pin', id: 'p1', pinned: true, x: canvas1.width - 230, y: 100, w: 220, h: 120 } })
    await expect(pinned(window)).toBeVisible()

    const second = await openSecondWindow(launched, { size: { width: 1000, height: 700 } })
    await canvasReady({ window: second }, { visible: [plane(second), pinned(second)] })
    const canvas2 = await box(second.getByTestId('canvas'))
    expect(canvas2.width).toBeLessThan(canvas1.width - 230)
    await canvasReady({ window }, { visible: [pinned(window)] })

    const pinnedBefore = { one: await box(pinned(window)), two: await box(pinned(second)) }
    expect(Math.round(pinnedBefore.one.x - canvas1.x)).toBe(Math.round(canvas1.width - 230))
    // Whole inside window 2's Canvas, against its right edge.
    expect(pinnedBefore.two.x).toBeGreaterThanOrEqual(canvas2.x)
    expect(pinnedBefore.two.x + pinnedBefore.two.width).toBeLessThanOrEqual(canvas2.x + canvas2.width + 0.5)
    expect(pinnedBefore.two.y).toBeGreaterThanOrEqual(canvas2.y)
    expect(pinnedBefore.two.y + pinnedBefore.two.height).toBeLessThanOrEqual(canvas2.y + canvas2.height + 0.5)

    const revisionBefore = (await ask<State>(window, 'layout.get', { projectId: ALPHA })).revision
    const secondBefore = await transformOf(second)

    // Pan window 1 with the wheel, over the empty plane.
    await window.mouse.move(canvas1.x + 600, canvas1.y + 500)
    await window.mouse.wheel(120, 200)
    await expect.poll(async () => (await shownCamera(window)).y).not.toBe(saved.y)
    await canvasReady({ window })
    const camera1 = await shownCamera(window)
    // main has the end of the pan once it saved it somewhere: in viewports.json, or (before ticket 06) in the Layout.
    const revision = async () => (await ask<State>(second, 'layout.get', { projectId: ALPHA })).revision
    await expect.poll(async () => existsSync(viewportsFile()) || (await revision()) !== revisionBefore).toBe(true)

    // The Layout's revision did not move, and layout.json keeps its camera; window 2 kept its own.
    expect(await revision()).toBe(revisionBefore)
    await canvasReady({ window: second })
    expect(await transformOf(second)).toBe(secondBefore)
    await expect.poll(() => (existsSync(viewportsFile()) ? savedCameras()[ALPHA] : undefined)).toEqual(camera1)
    expect(await cameraOf(window, ALPHA)).toEqual(camera1)
    expect(layoutCamera()).toEqual(saved)

    // The pinned Node stayed where it was in both windows.
    expect(await box(pinned(window))).toEqual(pinnedBefore.one)
    expect(await box(pinned(second))).toEqual(pinnedBefore.two)

    // One saved camera per machine and Project: window 2 reloaded opens where window 1 left the Canvas.
    await second.reload()
    await canvasReady({ window: second }, { visible: [pinned(second)] })
    expect(await shownCamera(second)).toEqual(camera1)
    expect(await box(pinned(second))).toEqual(pinnedBefore.two)

    for (const scheme of ['light', 'dark'] as const) {
      for (const [name, page] of [['window-1', window], ['window-2', second]] as const) {
        await page.emulateMedia({ colorScheme: scheme })
        await page.screenshot({ path: test.info().outputPath(`camera-${name}-${scheme}.png`) })
      }
    }
  } finally {
    await launched.close()
  }
})

// ── canvasReady itself ──────────────────────────────────────────────────────

/** The page, typed for the movement below: the e2e typecheck has no DOM library. */
interface MoverPage {
  document: {
    querySelector(selector: string): MoverElement | null
    querySelectorAll(selector: string): ArrayLike<MoverElement>
  }
  performance: { now(): number }
  requestAnimationFrame(callback: (now: number) => void): number
  __movementEnd?: number
}
interface MoverElement {
  style: { transform: string }
  classList: { add(name: string): void; remove(name: string): void }
}

/**
 * Takes the `from` class off every element that has it and puts `to` on instead, so that
 * canvasReady finds no Node (or no viewport) while a case runs; called again the other way round
 * to put the classes back.
 */
async function swapClass(window: Page, from: string, to: string): Promise<void> {
  await window.evaluate(
    ({ from: off, to: on }) => {
      for (const element of Array.from((globalThis as unknown as MoverPage).document.querySelectorAll(`.${off}`))) {
        element.classList.add(on)
        element.classList.remove(off)
      }
    },
    { from, to },
  )
}

/**
 * Moves the element `selector` names by one more pixel every animation frame for `ms`, then puts
 * its transform back and records, in page time, when the movement ended. Resolves at once.
 */
async function startMoving(window: Page, selector: string, ms: number): Promise<void> {
  await window.evaluate(
    ({ selector: wanted, ms: length }) => {
      const page = globalThis as unknown as MoverPage
      const element = page.document.querySelector(wanted)
      if (!element) throw new Error(`no ${wanted} in the page`)
      const original = element.style.transform
      const start = page.performance.now()
      let step = 0
      delete page.__movementEnd
      const tick = (now: number): void => {
        if (now - start >= length) {
          element.style.transform = original
          page.__movementEnd = page.performance.now()
          return
        }
        step += 1
        element.style.transform = `${original} translate(${step}px, 0px)`
        page.requestAnimationFrame(tick)
      }
      page.requestAnimationFrame(tick)
    },
    { selector, ms },
  )
}

const pageNow = (window: Page): Promise<number> => window.evaluate(() => (globalThis as unknown as MoverPage).performance.now())
const movementEnd = (window: Page): Promise<number | undefined> => window.evaluate(() => (globalThis as unknown as MoverPage).__movementEnd)

test('canvasReady waits for the viewport and the Nodes to stop moving, and fails without a viewport', async () => {
  writeFileSync(
    join(dataDir, ALPHA, 'layout.json'),
    JSON.stringify({ nodes: [{ id: 'n1', kind: 'note', x: 120, y: 80, w: 220, h: 120, data: { text: '' } }], viewport: { x: 0, y: 0, zoom: 1 } }),
  )
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
  try {
    const { window } = launched
    await canvasReady(launched, { visible: [window.getByTestId('note-node')] })

    // The movement lasts far longer than the 10 still frames canvasReady counts (about 170 ms), so a
    // canvasReady that does not see it returns while it is still going.
    const cases = [
      // A pan over a part of the Canvas with no Node on screen: only the viewport transform changes,
      // so the Node elements are hidden from canvasReady for this case.
      { moving: '.react-flow__viewport', hideNodes: true },
      { moving: '.react-flow__node[data-id="n1"]', hideNodes: false },
    ]
    for (const { moving, hideNodes } of cases) {
      await startMoving(window, moving, 1_500)
      if (hideNodes) await swapClass(window, 'react-flow__node', 'canvas-ready-test-node')
      try {
        const called = await pageNow(window)
        await canvasReady({ window })
        const ended = await movementEnd(window)
        expect(ended, `${moving}: canvasReady returned while it was still moving`).toBeDefined()
        // Otherwise the movement was over before canvasReady looked, and this case proved nothing.
        expect(ended!, `${moving}: the movement was still going when canvasReady was called`).toBeGreaterThan(called)
      } finally {
        if (hideNodes) await swapClass(window, 'canvas-ready-test-node', 'react-flow__node')
      }
    }

    // A page without a React Flow viewport is never at rest: canvasReady fails instead of turning
    // into a plain pause (as it would if React Flow renamed the class).
    await swapClass(window, 'react-flow__viewport', 'canvas-ready-test-viewport')
    try {
      await expect(canvasReady({ window }, { timeout: 1_000 })).rejects.toThrow(/did not come to rest within 1000 ms; last state: no \.react-flow__viewport/)
    } finally {
      await swapClass(window, 'canvas-ready-test-viewport', 'react-flow__viewport')
    }
    await canvasReady({ window })
    await expect(window.getByTestId('note-node')).toBeVisible()
  } finally {
    await launched.close()
  }
})
