import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp } from './helpers'

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
interface State {
  projectId: string
  layout: { nodes: StateNode[]; viewport: { x: number; y: number; zoom: number } }
}

let scratch: string
let dataDir: string

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-canvas-')))
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

/** The Layout as main has it. */
async function layoutOf(window: Page, projectId: string): Promise<State['layout']> {
  const result = await window.evaluate(
    (id) => (globalThis as unknown as { worfy: { invoke(c: string, i: unknown): Promise<{ ok: boolean; value: State }> } }).worfy.invoke('layout.get', { projectId: id }),
    projectId,
  )
  expect(result.ok).toBe(true)
  return result.value.layout
}

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

    // A double click on the empty plane creates a note where the pointer is.
    await window.locator('.react-flow__pane').dblclick({ position: { x: 300, y: 200 } })
    const note = window.getByTestId('note-node')
    await expect(note).toHaveCount(1)
    await expect.poll(async () => (await layoutOf(window, ALPHA)).nodes.length).toBe(1)
    const [initial] = (await layoutOf(window, ALPHA)).nodes
    if (!initial) throw new Error('no node')
    expect(initial).toMatchObject({ kind: 'note', w: 220, h: 120 })

    await note.getByRole('textbox', { name: 'Note text' }).fill('remember the milk')
    await window.locator('.react-flow__pane').click({ position: { x: 700, y: 500 } })
    await expect.poll(async () => (await layoutOf(window, ALPHA)).nodes[0]?.data).toEqual({ text: 'remember the milk' })

    // Moved by its header. The zoom is 1, so screen pixels are canvas units: main must save the
    // position the window shows. (React Flow starts a drag past a threshold, so the Node travels a
    // few pixels less than the pointer.)
    const unmoved = await box(note)
    await drag(window, note.locator('.w-note__header'), 150, 80)
    const moved = await box(note)
    expect(moved.x - unmoved.x).toBeGreaterThan(100)
    expect(moved.y - unmoved.y).toBeGreaterThan(50)
    const at = { x: Math.round(initial.x + moved.x - unmoved.x), y: Math.round(initial.y + moved.y - unmoved.y) }
    await expect.poll(async () => rounded((await layoutOf(window, ALPHA)).nodes[0] as StateNode)).toEqual({ ...at, w: 220, h: 120 })

    // Resized by the bottom-right handle of the selected Node.
    await note.locator('.w-note__header').click()
    await drag(window, window.locator('.react-flow__resize-control.handle.bottom.right'), 60, 40)
    const resized = await box(note)
    expect(resized.width - moved.width).toBeGreaterThan(40)
    expect(resized.height - moved.height).toBeGreaterThan(20)
    await expect.poll(async () => rounded((await layoutOf(window, ALPHA)).nodes[0] as StateNode)).toEqual({
      ...at,
      w: Math.round(resized.width),
      h: Math.round(resized.height),
    })
    created = (await layoutOf(window, ALPHA)).nodes[0] as StateNode
    shown = resized

    // The Canvas view is hidden while the Session view shows; back on it, the note is drawn as before.
    await window.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Session' }).click()
    await expect(canvas).toBeHidden()
    await window.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Canvas' }).click()
    await expect(note).toBeVisible()
    expect(await box(note)).toEqual(resized)

    // Another Project, another Canvas.
    await projectButton(window, 'beta').click()
    await expect(canvas).toHaveAttribute('data-project-id', BETA)
    await expect(window.getByTestId('note-node')).toHaveCount(0)
    await window.locator('.react-flow__pane').dblclick({ position: { x: 500, y: 400 } })
    await expect(window.getByTestId('note-node')).toHaveCount(1)
    await expect.poll(async () => (await layoutOf(window, BETA)).nodes.length).toBe(1)

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
    await expect.poll(async () => rounded((await layoutOf(window, ALPHA)).nodes[0] as StateNode)).not.toEqual(rounded(created))
    created = (await layoutOf(window, ALPHA)).nodes[0] as StateNode
    shown = await box(note2)
  } finally {
    await first.close()
  }

  // Saved in the Project's data folder, read back by the next start.
  const onDisk = JSON.parse(readFileSync(join(dataDir, ALPHA, 'layout.json'), 'utf8')) as State['layout']
  expect(onDisk.nodes.map(rounded)).toEqual([rounded(created)])
  const second = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
  try {
    const { window } = second
    await expect(window.getByTestId('canvas')).toHaveAttribute('data-project-id', ALPHA)
    const note = window.getByTestId('note-node')
    await expect(note).toHaveCount(1)
    await expect(note.getByRole('textbox', { name: 'Note text' })).toHaveValue('remember the milk')
    expect((await layoutOf(window, ALPHA)).nodes.map(rounded)).toEqual([rounded(created)])
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
    await expect.poll(async () => (await layoutOf(window, ALPHA)).nodes[0]?.data).toEqual({ text: 'first' })
    await expect(textbox).toBeFocused()
    await window.keyboard.type(' second')
    await expect(textbox).toHaveValue('first second')
    await expect.poll(async () => (await layoutOf(window, ALPHA)).nodes[0]?.data).toEqual({ text: 'first second' })

    // Another writer (later: the MCP tools) changes the text while the note is not being edited.
    await window.locator('.react-flow__pane').click({ position: { x: 700, y: 500 } })
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
  const zoom = async () => (await layoutOf(launched.window, ALPHA)).viewport.zoom
  try {
    const { window } = launched
    await expect(window.getByTestId('canvas')).toBeVisible()
    const pane = window.locator('.react-flow__pane')
    const middle = await center(pane)
    await window.mouse.move(middle.x, middle.y)

    await window.keyboard.press('Meta+Equal')
    await expect.poll(zoom).toBeGreaterThan(1)
    for (let n = 0; n < 20; n++) await window.keyboard.press('Meta+Equal')
    await expect.poll(zoom).toBeCloseTo(2.5)
    for (let n = 0; n < 40; n++) await window.keyboard.press('Meta+Minus')
    await expect.poll(zoom).toBeCloseTo(0.2)

    // The wheel alone pans and keeps the zoom.
    const before = (await layoutOf(window, ALPHA)).viewport
    await window.mouse.wheel(0, 200)
    await expect.poll(async () => (await layoutOf(window, ALPHA)).viewport.y).not.toBe(before.y)
    expect(await zoom()).toBeCloseTo(0.2)

    // ⌘ + wheel zooms.
    await window.keyboard.down('Meta')
    await window.mouse.wheel(0, -300)
    await window.keyboard.up('Meta')
    await expect.poll(zoom).toBeGreaterThan(0.21)
  } finally {
    await launched.close()
  }
})
