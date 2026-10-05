import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BrowserWindow, screen } from 'electron'
import { MIN_SIZE, initialBounds, parseWindowState, serializeWindowState, type Rect } from '../shared/window/bounds'
import { dataRoot } from './storage/paths'

/** Path of the file that remembers the window's position and size (ADR 0005: worfy's own state). */
export function windowStatePath(root: string = dataRoot()): string {
  return join(root, 'window-state.json')
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
    writeFileSync(temporary, serializeWindowState(bounds))
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
