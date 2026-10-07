import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp, type LaunchedApp } from './helpers'

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
