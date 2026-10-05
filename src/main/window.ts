import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BrowserWindow, screen } from 'electron'
import { z } from 'zod'
import { dataRoot } from './storage/paths'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export type InitialBounds = Rect | { width: number; height: number }

export const DEFAULT_SIZE = { width: 1280, height: 800 } as const
export const MIN_SIZE = { width: 800, height: 520 } as const

/** How much of a saved window must still be on some display for its position to be reused. */
const MIN_VISIBLE = { width: 120, height: 40 } as const

const windowStateSchema = z.object({
  bounds: z.object({
    x: z.number().int(),
    y: z.number().int(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
})

/** Path of the file that remembers the window's position and size (ADR 0005: worfy's own state). */
export function windowStatePath(root: string = dataRoot()): string {
  return join(root, 'window-state.json')
}

/** Parses the saved window state; anything unreadable counts as "nothing saved". */
export function parseWindowState(raw: string): Rect | undefined {
  try {
    const parsed = windowStateSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data.bounds : undefined
  } catch {
    return undefined
  }
}

function overlap(a: Rect, b: Rect): { width: number; height: number } {
  return {
    width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
  }
}

/**
 * Decides where the window opens. Saved bounds are reused while enough of the window is still on
 * one of the current displays (a monitor may have been unplugged since); otherwise the window opens
 * at the default size, centred by the system.
 */
export function initialBounds(saved: Rect | undefined, workAreas: readonly Rect[]): InitialBounds {
  if (saved) {
    const visible = workAreas.some((area) => {
      const shared = overlap(saved, area)
      return shared.width >= MIN_VISIBLE.width && shared.height >= MIN_VISIBLE.height
    })
    if (visible) {
      return {
        x: saved.x,
        y: saved.y,
        width: Math.max(saved.width, MIN_SIZE.width),
        height: Math.max(saved.height, MIN_SIZE.height),
      }
    }
  }
  return { ...DEFAULT_SIZE }
}

function readSavedBounds(file: string): Rect | undefined {
  try {
    return parseWindowState(readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

function saveBounds(file: string, bounds: Rect): void {
  try {
    mkdirSync(join(file, '..'), { recursive: true })
    const temporary = `${file}.tmp`
    writeFileSync(temporary, JSON.stringify({ bounds }, null, 2))
    renameSync(temporary, file)
  } catch (error) {
    // Losing the window position is not worth interrupting the user for.
    console.warn('worfy: could not save the window position', error)
  }
}

export function createMainWindow(): BrowserWindow {
  const stateFile = windowStatePath()
  const bounds = initialBounds(
    readSavedBounds(stateFile),
    screen.getAllDisplays().map((display) => display.workArea),
  )

  const window = new BrowserWindow({
    ...bounds,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    title: 'worfy',
    show: false,
    // Native macOS frame of design F: no title bar, traffic lights inset into the unified
    // toolbar, a translucent sidebar. The page keeps its own background transparent where the
    // sidebar is, so the vibrancy shows through.
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 20, y: 19 },
    vibrancy: 'sidebar',
    visualEffectState: 'followWindow',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })

  // getNormalBounds: a maximised or full-screen window remembers the size it returns to.
  const remember = (): void => saveBounds(stateFile, window.getNormalBounds())
  window.on('resized', remember)
  window.on('moved', remember)
  window.on('close', remember)

  window.once('ready-to-show', () => {
    window.show()
  })

  const devServerUrl = process.env.ELECTRON_RENDERER_URL
  if (devServerUrl) {
    void window.loadURL(devServerUrl)
  } else {
    void window.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
  return window
}
