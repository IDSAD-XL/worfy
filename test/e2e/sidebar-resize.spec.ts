import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { canvasReady, launchApp, type LaunchedApp } from './helpers'

// The width of the sidebar against the built app (worfy-polish ticket 158): its right edge is dragged
// with the mouse and the width follows the pointer; Escape during a drag puts it back; the width lands
// in app-settings.json once the button is let go and outlives a restart; a narrower window shows it
// narrower — leaving the Canvas 480 px — without writing; a double click on the edge puts the default
// 264 px back and takes the field out of the file.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'
const DEFAULT_WIDTH = 264
const CANVAS_ROOM = 480

let scratch: string
let dataDir: string

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-sidebar-resize-')))
  dataDir = join(scratch, 'data')
  const path = join(scratch, 'alpha')
  mkdirSync(path)
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path }], activeId: PROJECT }))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

const launch = (): Promise<LaunchedApp> => launchApp({ env: { WORFY_DATA_DIR: dataDir } })

/** `sidebar` of app-settings.json; undefined while the file is not written. */
function savedSidebar(): { width?: number } | undefined {
  try {
    return (JSON.parse(readFileSync(join(dataDir, 'app-settings.json'), 'utf8')) as { sidebar?: { width?: number } }).sidebar
  } catch {
    return undefined
  }
}

const sidebarOf = (window: Page): Locator => window.getByRole('navigation', { name: 'Sidebar' })
const edgeOf = (window: Page): Locator => window.getByRole('separator', { name: 'Resize the sidebar' })

async function box(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const found = await locator.boundingBox()
  if (!found) throw new Error('the element has no box')
  return found
}

const sidebarWidth = async (window: Page): Promise<number> => Math.round((await box(sidebarOf(window))).width)
const innerWidth = (window: Page): Promise<number> => window.evaluate(() => (globalThis as unknown as { innerWidth: number }).innerWidth)

/**
 * Presses the edge on its half over the sidebar — the other half lies over the main area — moves the
 * pointer `by` px to the right in steps and, unless `release` is false, lets go.
 */
async function dragEdge(window: Page, by: number, release = true): Promise<void> {
  const edge = await box(edgeOf(window))
  const x = edge.x + 1.5
  const y = edge.y + edge.height / 2
  await window.mouse.move(x, y)
  await window.mouse.down()
  await window.mouse.move(x + by, y, { steps: 8 })
  if (release) await window.mouse.up()
}

test('the edge of the sidebar drags its width, Escape cancels a drag, the width outlives a restart, a narrow window narrows it without writing, and a double click resets it', async () => {
  const first = await launch()
  try {
    const { window } = first
    await canvasReady(first)
    // Room for a sidebar 120 px wider and the Canvas's 480 px.
    expect(await innerWidth(window)).toBeGreaterThanOrEqual(DEFAULT_WIDTH + 120 + CANVAS_ROOM)
    await expect(sidebarOf(window)).toBeVisible()
    expect(await sidebarWidth(window)).toBe(DEFAULT_WIDTH)
    const edge = edgeOf(window)
    await expect(edge).toHaveAttribute('aria-valuenow', String(DEFAULT_WIDTH))
    // The edge lies inside the sidebar and ends where the sidebar ends, on the outer side of its border:
    // nothing of it covers the Canvas, and a press right of the sidebar is the Canvas's (a box selection
    // that starts there, test/e2e/snapping.spec.ts).
    const side = await box(sidebarOf(window))
    const handle = await box(edge)
    expect(handle.width).toBe(6)
    expect(handle.x + handle.width).toBe(side.x + side.width)
    for (const right of [0, 10]) {
      const reached = await window.evaluate(
        ({ x, y }) => {
          const page = globalThis as unknown as { document: { elementFromPoint(x: number, y: number): { closest(selector: string): unknown } | null } }
          const hit = page.document.elementFromPoint(x, y)
          return { sidebar: hit?.closest('.w-sidebar') != null, canvas: hit?.closest('[data-testid="canvas"]') != null }
        },
        { x: side.x + side.width + right, y: side.y + side.height / 2 },
      )
      expect(reached, `a press ${right} px right of the sidebar`).toEqual({ sidebar: false, canvas: true })
    }

    await dragEdge(window, 120)
    await expect.poll(() => sidebarWidth(window)).toBe(DEFAULT_WIDTH + 120)
    await expect(edge).toHaveAttribute('aria-valuenow', String(DEFAULT_WIDTH + 120))
    await expect.poll(() => savedSidebar()?.width).toBe(DEFAULT_WIDTH + 120)

    // Escape while the button is still down: the width goes back, and letting go writes nothing.
    await dragEdge(window, 100, false)
    await expect.poll(() => sidebarWidth(window)).toBe(DEFAULT_WIDTH + 220)
    await window.keyboard.press('Escape')
    await expect.poll(() => sidebarWidth(window)).toBe(DEFAULT_WIDTH + 120)
    await window.mouse.up()
    expect(await sidebarWidth(window)).toBe(DEFAULT_WIDTH + 120)
    expect(savedSidebar()?.width).toBe(DEFAULT_WIDTH + 120)
  } finally {
    await first.close()
  }

  // A restart over the same data folder: the sidebar comes back at the width it was dragged to.
  const second = await launch()
  try {
    const { app, window } = second
    await canvasReady(second)
    await expect(sidebarOf(window)).toBeVisible()
    await expect.poll(() => sidebarWidth(window)).toBe(DEFAULT_WIDTH + 120)
    await expect(edgeOf(window)).toHaveAttribute('aria-valuenow', String(DEFAULT_WIDTH + 120))

    // A window too narrow for it leaves the Canvas 480 px; the file keeps the width.
    const before = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getSize() ?? [0, 0])
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(820, 700))
    await expect.poll(() => innerWidth(window)).toBeLessThan(DEFAULT_WIDTH + 120 + CANVAS_ROOM)
    const narrow = await innerWidth(window)
    await expect.poll(() => sidebarWidth(window)).toBe(Math.max(DEFAULT_WIDTH, narrow - CANVAS_ROOM))
    expect(savedSidebar()?.width).toBe(DEFAULT_WIDTH + 120)
    await app.evaluate(({ BrowserWindow }, [width, height]) => BrowserWindow.getAllWindows()[0]?.setSize(width ?? 1280, height ?? 800), before)
    await expect.poll(() => sidebarWidth(window)).toBe(DEFAULT_WIDTH + 120)

    // A double click on the edge: the default width, and no width in the file.
    await edgeOf(window).dblclick({ position: { x: 1.5, y: 200 } })
    await expect.poll(() => sidebarWidth(window)).toBe(DEFAULT_WIDTH)
    await expect.poll(() => savedSidebar() !== undefined && !('width' in (savedSidebar() ?? {}))).toBe(true)

    // The keys: → moves it by 16 px and writes it.
    await edgeOf(window).focus()
    await window.keyboard.press('ArrowRight')
    await expect.poll(() => sidebarWidth(window)).toBe(DEFAULT_WIDTH + 16)
    await expect.poll(() => savedSidebar()?.width).toBe(DEFAULT_WIDTH + 16)
  } finally {
    await second.close()
  }
})
