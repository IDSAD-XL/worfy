import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp, openSecondWindow, type LaunchedApp } from './helpers'

// Ticket 30 against the built app: ⌘Z and ⇧⌘Z undo and redo a move; a Card deleted from the
// selection toolbar comes back from the Trash popover with its files and data; one deleted with the
// Delete key comes back with ⌘Z; the Orchestrator Node cannot be deleted.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'
const CARD_HTML = '<!doctype html><html><head><title>Counter card</title></head><body><p>Counter</p></body></html>'

interface StateNode {
  id: string
  kind: string
  x: number
  y: number
}

let scratch: string
let dataDir: string

const projectDir = () => join(dataDir, PROJECT)
const cardDir = (id: string) => join(projectDir(), 'cards', id)
const dataFile = (id: string) => join(projectDir(), 'card-data', `${id}.json`)
const trashEntries = () => (existsSync(join(projectDir(), 'trash')) ? readdirSync(join(projectDir(), 'trash')) : [])

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-trash-')))
  dataDir = join(scratch, 'data')
  const path = join(scratch, 'alpha')
  mkdirSync(path)
  mkdirSync(projectDir(), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path }], activeId: PROJECT }))
  const layout = {
    nodes: [
      { id: 'n1', kind: 'note', x: 120, y: 100, w: 220, h: 120, data: { text: 'move me' } },
      // Far enough right that the note dragged below lands on free plane: main would put it off
      // the Card otherwise (ADR-0038). Still inside the default 1280-px window.
      { id: 'c1', kind: 'card', x: 620, y: 100, w: 360, h: 280, tags: ['kept'] },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  }
  writeFileSync(join(projectDir(), 'layout.json'), JSON.stringify(layout))
  mkdirSync(cardDir('c1'), { recursive: true })
  writeFileSync(join(cardDir('c1'), 'index.html'), CARD_HTML)
  mkdirSync(join(projectDir(), 'card-data'), { recursive: true })
  writeFileSync(dataFile('c1'), JSON.stringify({ count: 3 }))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

async function layoutNodes(window: Page): Promise<StateNode[]> {
  const result = await window.evaluate(
    (id) =>
      (globalThis as unknown as { worfy: { invoke(c: string, i: unknown): Promise<{ ok: boolean; value: { layout: { nodes: StateNode[] } } }> } }).worfy.invoke('layout.get', {
        projectId: id,
      }),
    PROJECT,
  )
  expect(result.ok).toBe(true)
  return result.value.layout.nodes
}

const nodeIn = async (window: Page, id: string) => (await layoutNodes(window)).find((node) => node.id === id)

async function box(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const found = await locator.boundingBox()
  if (!found) throw new Error('the element has no box')
  return found
}

async function launch(): Promise<LaunchedApp> {
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
  await expect(launched.window.getByTestId('canvas')).toHaveAttribute('data-project-id', PROJECT)
  return launched
}

test('a move is undone with ⌘Z and done again with ⇧⌘Z', async () => {
  const launched = await launch()
  try {
    const { window } = launched
    const header = window.locator('[data-testid="note-node"][data-node-id="n1"] .w-note__header')
    await expect(header).toBeVisible()
    const start = await box(header)
    await window.mouse.move(start.x + 20, start.y + 8)
    await window.mouse.down()
    await window.mouse.move(start.x + 120, start.y + 60, { steps: 8 })
    await window.mouse.move(start.x + 220, start.y + 108, { steps: 8 })
    await window.mouse.up()
    // Moved by about the drag (React Flow's drag threshold eats a few pixels).
    await expect.poll(async () => (await nodeIn(window, 'n1'))?.x ?? 0).toBeGreaterThan(250)
    const moved = await nodeIn(window, 'n1')
    expect(moved?.y).toBeGreaterThan(150)

    await window.keyboard.press('Meta+z')
    await expect.poll(async () => (await nodeIn(window, 'n1'))?.x).toBe(120)
    expect((await nodeIn(window, 'n1'))?.y).toBe(100)
    await expect.poll(async () => (await box(header)).x).toBeCloseTo(start.x, 0)

    await window.keyboard.press('Meta+Shift+z')
    await expect.poll(async () => (await nodeIn(window, 'n1'))?.x).toBe(moved?.x)
    expect((await nodeIn(window, 'n1'))?.y).toBe(moved?.y)
  } finally {
    await launched.close()
  }
})

test('a deleted Card comes back from the Trash with its files and data; a Card deleted with the Delete key comes back with ⌘Z', async () => {
  const launched = await launch()
  try {
    const { window } = launched
    const card = window.locator('[data-testid="card-node"][data-node-id="c1"]')
    await expect(card.getByTestId('card-title')).toHaveText('Counter card')

    // Delete from the selection toolbar: the Node leaves the Canvas, the files leave the Card folders.
    await card.getByTestId('card-title').click()
    const toolbar = window.getByTestId('selection-toolbar')
    await toolbar.getByRole('button', { name: 'Delete' }).click()
    await expect(card).toHaveCount(0)
    await expect.poll(async () => (await nodeIn(window, 'c1')) === undefined).toBe(true)
    expect(existsSync(cardDir('c1'))).toBe(false)
    expect(existsSync(dataFile('c1'))).toBe(false)
    expect(trashEntries()).toHaveLength(1)

    // The Trash popover lists it and Restore brings it back.
    await window.getByRole('button', { name: /^Trash/ }).click()
    const popover = window.getByTestId('trash-popover')
    const entry = popover.getByTestId('trash-entry')
    await expect(entry).toHaveCount(1)
    await expect(entry).toContainText('Counter card')
    await window.screenshot({ path: test.info().outputPath('trash-popover.png') })
    await entry.getByRole('button', { name: 'Restore' }).click()
    await expect(card.getByTestId('card-title')).toHaveText('Counter card')
    await expect(popover.getByTestId('trash-entry')).toHaveCount(0)
    expect(readFileSync(join(cardDir('c1'), 'index.html'), 'utf8')).toBe(CARD_HTML)
    expect(JSON.parse(readFileSync(dataFile('c1'), 'utf8'))).toEqual({ count: 3 })
    expect(await nodeIn(window, 'c1')).toMatchObject({ x: 620, y: 100, tags: ['kept'] })
    expect(trashEntries()).toHaveLength(0)
    await window.keyboard.press('Escape')
    await expect(popover).toHaveCount(0)

    // The Delete key, then ⌘Z.
    await card.getByTestId('card-title').click()
    await window.keyboard.press('Delete')
    await expect(card).toHaveCount(0)
    expect(existsSync(cardDir('c1'))).toBe(false)
    await window.keyboard.press('Meta+z')
    await expect(card.getByTestId('card-title')).toHaveText('Counter card')
    expect(readFileSync(join(cardDir('c1'), 'index.html'), 'utf8')).toBe(CARD_HTML)
    expect(JSON.parse(readFileSync(dataFile('c1'), 'utf8'))).toEqual({ count: 3 })
    expect(trashEntries()).toHaveLength(0)
  } finally {
    await launched.close()
  }
})

test('the Orchestrator Node cannot be deleted: Delete is unavailable and the Delete key leaves it', async () => {
  const launched = await launch()
  try {
    const { window } = launched
    const orchestrator = window.getByTestId('orchestrator-node')
    await expect(orchestrator).toBeVisible()
    const orchestratorBox = await box(orchestrator)
    await window.mouse.click(orchestratorBox.x + orchestratorBox.width / 2, orchestratorBox.y + 10)
    const toolbar = window.getByTestId('selection-toolbar')
    await expect(toolbar.getByRole('button', { name: 'Delete' })).toBeDisabled()
    await window.keyboard.press('Delete')
    await window.keyboard.press('Backspace')
    await expect(orchestrator).toBeVisible()
    expect((await layoutNodes(window)).some((node) => node.kind === 'orchestrator')).toBe(true)
    expect(trashEntries()).toHaveLength(0)
  } finally {
    await launched.close()
  }
})

test('in a text field Backspace and ⌘Z edit the text: the selection is not deleted and the Layout is not undone', async () => {
  const launched = await launch()
  try {
    const { window } = launched
    const note = window.locator('[data-testid="note-node"][data-node-id="n1"]')
    const header = note.locator('.w-note__header')
    const card = window.locator('[data-testid="card-node"][data-node-id="c1"]')
    await expect(card.getByTestId('card-title')).toHaveText('Counter card')

    // A step in the history that a ⌘Z reaching the Canvas would undo.
    const start = await box(header)
    await window.mouse.move(start.x + 20, start.y + 8)
    await window.mouse.down()
    await window.mouse.move(start.x + 120, start.y + 60, { steps: 8 })
    await window.mouse.move(start.x + 220, start.y + 108, { steps: 8 })
    await window.mouse.up()
    await expect.poll(async () => (await nodeIn(window, 'n1'))?.x ?? 0).toBeGreaterThan(250)
    const moved = await nodeIn(window, 'n1')

    // The tag field of the selection toolbar, with the Card selected. main answers in the order it
    // was asked, so a delete or an undo sent by the key is visible to the layout.get that follows.
    await card.getByTestId('card-title').click()
    const toolbar = window.getByTestId('selection-toolbar')
    await toolbar.getByRole('button', { name: 'Add tag' }).click()
    const tag = toolbar.getByRole('textbox', { name: 'New tag' })
    await expect(tag).toBeFocused()
    await window.keyboard.type('ab')
    await window.keyboard.press('Backspace')
    await expect(tag).toHaveValue('a')
    await window.keyboard.press('Meta+z')
    expect(await nodeIn(window, 'c1')).toBeDefined()
    expect(await nodeIn(window, 'n1')).toMatchObject({ x: moved?.x, y: moved?.y })
    expect(trashEntries()).toEqual([])
    await window.keyboard.press('Escape')

    // The text of the note, with the note selected.
    await header.click()
    const text = note.getByRole('textbox', { name: 'Note text' })
    await text.click()
    await expect(text).toBeFocused()
    await window.keyboard.press('End')
    await window.keyboard.type('!')
    await window.keyboard.press('Backspace')
    await expect(text).toHaveValue('move me')
    // Checked after each key: a ⌘Z that reached the Canvas would bring a deleted note back.
    expect(await nodeIn(window, 'n1')).toBeDefined()
    expect(trashEntries()).toEqual([])
    await window.keyboard.press('Home')
    await window.keyboard.press('Delete')
    await expect(text).toHaveValue('ove me')
    expect(await nodeIn(window, 'n1')).toBeDefined()
    expect(trashEntries()).toEqual([])
    await window.keyboard.press('Meta+z')
    expect(await nodeIn(window, 'n1')).toMatchObject({ x: moved?.x, y: moved?.y })
    expect(await nodeIn(window, 'c1')).toBeDefined()
    await expect(note).toBeVisible()
    expect(trashEntries()).toEqual([])
  } finally {
    await launched.close()
  }
})

// worfy-link ticket 07 (ADR-0053): two windows of one worfy are two screens, each with its own ⌘Z.
// ⌘Z undoes only the window's own step; a step whose Note the other window moved since is skipped
// with a notice. The Notes are dragged with the mouse: only the Canvas's gestures are steps.
test.describe('⌘Z with two windows', () => {
  test.beforeEach(() => {
    const layout = {
      nodes: [
        { id: 'n1', kind: 'note', x: 120, y: 100, w: 220, h: 120, data: { text: 'one' } },
        { id: 'n2', kind: 'note', x: 120, y: 420, w: 220, h: 120, data: { text: 'two' } },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    }
    writeFileSync(join(projectDir(), 'layout.json'), JSON.stringify(layout))
  })

  const header = (window: Page, id: string) => window.locator(`[data-testid="note-node"][data-node-id="${id}"] .w-note__header`)

  /** Drags the Note by its header by about (dx, dy) and waits until main has it elsewhere. */
  async function drag(window: Page, id: string, dx: number, dy: number): Promise<StateNode> {
    const before = await nodeIn(window, id)
    const start = await box(header(window, id))
    await window.mouse.move(start.x + 20, start.y + 8)
    await window.mouse.down()
    await window.mouse.move(start.x + 20 + dx / 2, start.y + 8 + dy / 2, { steps: 8 })
    await window.mouse.move(start.x + 20 + dx, start.y + 8 + dy, { steps: 8 })
    await window.mouse.up()
    await expect
      .poll(async () => {
        const now = await nodeIn(window, id)
        return now !== undefined && (now.x !== before?.x || now.y !== before?.y)
      })
      .toBe(true)
    const after = await nodeIn(window, id)
    if (after === undefined) throw new Error(`${id} is gone`)
    return after
  }

  /** Waits until the window draws the Note at `place` (it has heard of the change), relative to a known drawing. */
  async function drawnAt(window: Page, id: string, seen: { box: { x: number; y: number }; at: StateNode }, place: StateNode): Promise<void> {
    await expect.poll(async () => (await box(header(window, id))).x).toBeCloseTo(seen.box.x + place.x - seen.at.x, 0)
    await expect.poll(async () => (await box(header(window, id))).y).toBeCloseTo(seen.box.y + place.y - seen.at.y, 0)
  }

  async function launchTwo(): Promise<{ launched: LaunchedApp; a: Page; b: Page }> {
    const launched = await launch()
    const b = await openSecondWindow(launched)
    await expect(b.getByTestId('canvas')).toHaveAttribute('data-project-id', PROJECT)
    await expect(header(b, 'n1')).toBeVisible()
    await expect(header(launched.window, 'n1')).toBeVisible()
    return { launched, a: launched.window, b }
  }

  test("⌘Z in A skips A's move of n1 that B moved since, with a notice; ⌘Z in B puts n1 back where A had it", async () => {
    const { launched, a, b } = await launchTwo()
    try {
      const seenInB = { box: await box(header(b, 'n1')), at: (await nodeIn(b, 'n1'))! }
      const byA = await drag(a, 'n1', 260, 0)
      const seenInA = { box: await box(header(a, 'n1')), at: byA }
      // B draws n1 where A put it before it drags it: B's step then remembers A's place.
      await drawnAt(b, 'n1', seenInB, byA)
      const byB = await drag(b, 'n1', 0, 160)
      await drawnAt(a, 'n1', seenInA, byB)

      await a.keyboard.press('Meta+z')
      const notice = a.getByTestId('undo-skipped')
      await expect(notice).toBeVisible()
      await expect(notice).toHaveAttribute('role', 'status')
      await expect(notice).toHaveText('Not undone: this Node was changed on another screen')
      // The skip is decided before the notice shows: nothing was sent, n1 stays where B put it.
      expect(await nodeIn(a, 'n1')).toMatchObject({ x: byB.x, y: byB.y })
      for (const scheme of ['light', 'dark'] as const) {
        await a.emulateMedia({ colorScheme: scheme })
        await a.screenshot({ path: test.info().outputPath(`07-undo-skipped-${scheme}.png`) })
      }
      await a.emulateMedia({ colorScheme: null })
      await expect(b.getByTestId('undo-skipped')).toHaveCount(0)

      // B's own step is not out of date: A changed n1 before it.
      await b.keyboard.press('Meta+z')
      await expect.poll(async () => await nodeIn(b, 'n1')).toMatchObject({ x: byA.x, y: byA.y })
      await expect(b.getByTestId('undo-skipped')).toHaveCount(0)
      // The notice goes away by itself.
      await expect(notice).toHaveCount(0, { timeout: 8000 })
    } finally {
      await launched.close()
    }
  })

  test('⌘Z in A undoes its move of n2 without a notice while B moved only n1', async () => {
    const { launched, a, b } = await launchTwo()
    try {
      const start = await nodeIn(a, 'n2')
      await drag(a, 'n2', 260, 0)
      const seenInA = { box: await box(header(a, 'n1')), at: (await nodeIn(a, 'n1'))! }
      const byB = await drag(b, 'n1', 0, 160)
      await drawnAt(a, 'n1', seenInA, byB)

      await a.keyboard.press('Meta+z')
      await expect.poll(async () => await nodeIn(a, 'n2')).toMatchObject({ x: start?.x, y: start?.y })
      expect(await nodeIn(a, 'n1')).toMatchObject({ x: byB.x, y: byB.y })
      await expect(a.getByTestId('undo-skipped')).toHaveCount(0)
    } finally {
      await launched.close()
    }
  })
})
