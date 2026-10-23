// The app menu (src/main/menu.ts) and the `view` domain (src/main/ipc/view.ts) over a mocked
// `electron`: the menu gets View ▸ Show Minimap, switching it tells every window, and `view.get`
// answers with the state. "Settings…" (worfy-ui ticket 2) sits in the app menu on macOS and first in
// File elsewhere, and tells one window to open the Settings window. View ▸ Bigger / Smaller / Actual
// size (worfy-ui ticket 3) change the interface scale of the app settings, over a temporary
// WORFY_DATA_DIR; src/main/settings/interface-scale.ts gives that scale to every window as its zoom.
// View ▸ Toggle Sidebar (worfy-ui ticket 10) carries Cmd/Ctrl+B and tells one window to hide or show
// its sidebar; what is saved, the window decides. Help ▸ Keyboard Shortcuts (worfy-ui ticket 11)
// carries Cmd/Ctrl+/ and tells one window to open its Keyboard shortcuts window; every accelerator
// above is the one of the registry of shortcuts (src/shared/shortcuts.ts). A command for a window
// whose page does not follow it yet waits in main until the page says it does, with `menu.ready`
// (worfy-windows ticket 96; src/main/ipc/menu.ts).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNEL_PREFIX } from '../../src/shared/ipc/channels'
import { MENU_COMMANDS, menuCommand, menuReady, type MenuCommand } from '../../src/shared/ipc/menu'
import { accelerator, SHORTCUTS } from '../../src/shared/shortcuts'
import { viewChanged, viewGet } from '../../src/shared/ipc/view'
import { removeTestTree } from '../remove'

interface TemplateItem {
  id?: string
  label?: string
  role?: string
  type?: string
  accelerator?: string
  registerAccelerator?: boolean
  checked?: boolean
  enabled?: boolean
  click?: (item: { checked: boolean }, window?: unknown) => void
  submenu?: TemplateItem[]
}

const env = await vi.hoisted(async () => {
  // Before any module of main is imported: the menu reads the app settings, which sit over dataRoot().
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'worfy-view-menu-')))
  process.env.WORFY_DATA_DIR = path.join(scratch, 'data')
  return { scratch }
})

const electron = vi.hoisted(() => {
  const sent: { to: string; channel: string; payload: unknown }[] = []
  const zooms: { to: string; factor: number }[] = []
  const menus: unknown[] = []
  /** A window of the app: what main sends to it and the zoom it is given are recorded with its name. */
  class FakeBrowserWindow {
    static all: FakeBrowserWindow[] = []
    static focused: FakeBrowserWindow | null = null
    static getAllWindows = () => FakeBrowserWindow.all
    static getFocusedWindow = () => FakeBrowserWindow.focused
    /** The listeners of the web contents, by event. */
    readonly listeners = new Map<string, ((...args: unknown[]) => void)[]>()
    readonly webContents: {
      id: string
      send: (channel: string, payload: unknown) => void
      setZoomFactor: (factor: number) => void
      on: (event: string, listener: (...args: unknown[]) => void) => void
      isDestroyed: () => boolean
    }
    readonly name: string
    /** The options of a window main made itself (createMainWindow); a test names its windows instead. */
    readonly options: { webPreferences?: Record<string, unknown> } | undefined
    constructor(made: string | { webPreferences?: Record<string, unknown> }) {
      const name = typeof made === 'string' ? made : 'made by main'
      this.name = name
      this.options = typeof made === 'string' ? undefined : made
      this.webContents = {
        id: name,
        send: (channel, payload) => sent.push({ to: name, channel, payload }),
        setZoomFactor: (factor) => zooms.push({ to: name, factor }),
        on: (event, listener) => this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]),
        isDestroyed: () => this.destroyed,
      }
    }
    /** Fires an event of the web contents. */
    fire(event: string, ...args: unknown[]): void {
      for (const listener of this.listeners.get(event) ?? []) listener(...args)
    }
    destroyed = false
    isDestroyed = () => this.destroyed
    // What createMainWindow asks of a window besides its web contents.
    on(): void {}
    once(): void {}
    getBounds = (): { x: number; y: number; width: number; height: number } => ({ x: 0, y: 0, width: 1280, height: 800 })
    setBounds(): void {}
    loadFile = (): Promise<void> => Promise.resolve()
    loadURL = (): Promise<void> => Promise.resolve()
  }
  const window = new FakeBrowserWindow('main')
  FakeBrowserWindow.all = [window]
  /** The item `id` of a template, submenus included: what Menu.getMenuItemById answers. */
  const byId = (template: { id?: string; submenu?: unknown[] }[], id: string): unknown => {
    for (const item of template) {
      if (item.id === id) return item
      const inside = byId((item.submenu ?? []) as { id?: string; submenu?: unknown[] }[], id)
      if (inside !== null) return inside
    }
    return null
  }
  return { sent, zooms, menus, window, FakeBrowserWindow, byId }
})

vi.mock('electron', () => ({
  app: { name: 'worfy', isPackaged: true },
  BrowserWindow: electron.FakeBrowserWindow,
  // For createMainWindow (src/main/window.ts): the theme and the displays it asks about.
  nativeTheme: { shouldUseDarkColors: false },
  screen: { getAllDisplays: () => [] },
  session: {},
  protocol: {},
  Menu: {
    buildFromTemplate: (template: unknown) => ({ template }),
    setApplicationMenu: (menu: unknown) => electron.menus.push(menu),
    // The menu last set, as Electron answers it: an item is found by id and changed in place.
    getApplicationMenu: () => {
      const menu = electron.menus.at(-1) as { template: TemplateItem[] } | undefined
      return menu === undefined ? null : { getMenuItemById: (id: string) => electron.byId(menu.template, id) }
    },
  },
}))

const dataDir = join(env.scratch, 'data')
const settingsFile = join(dataDir, 'app-settings.json')

/** Puts app-settings.json with `scale` in the data folder; without a scale, no file. */
function storedScale(scale?: number): void {
  rmSync(settingsFile, { force: true })
  if (scale === undefined) return
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(settingsFile, JSON.stringify({ interfaceScale: scale }))
}

afterAll(() => removeTestTree(env.scratch))

async function load() {
  vi.resetModules()
  electron.sent.length = 0
  electron.menus.length = 0
  const module = await import('../../src/main/ipc/view')
  const menu = await import('../../src/main/menu')
  // Loading the modules sets no menu; src/main/index.ts installs it once the app is ready.
  expect(electron.menus).toHaveLength(0)
  menu.installAppMenu()
  expect(electron.menus).toHaveLength(1)
  const { template } = electron.menus[0] as { template: TemplateItem[] }
  const view = template.find((item) => item.label === 'View')
  const minimap = view?.submenu?.find((item) => item.id === menu.MINIMAP_MENU_ITEM_ID)
  if (!minimap) throw new Error('View ▸ Show Minimap is missing')
  return { module, template, view, minimap }
}

beforeEach(() => {
  electron.sent.length = 0
  electron.zooms.length = 0
  electron.FakeBrowserWindow.focused = null
  electron.FakeBrowserWindow.all = [electron.window]
  electron.window.listeners.clear()
  storedScale()
})

describe('View ▸ Show Minimap', () => {
  it('is a checked checkbox at first, next to the default View items', async () => {
    const { view, minimap, template } = await load()
    expect(minimap).toMatchObject({ label: 'Show Minimap', type: 'checkbox', checked: true })
    expect(view?.submenu?.map((item) => item.role).filter(Boolean)).toEqual([
      'reload',
      'forceReload',
      'toggleDevTools',
      'togglefullscreen',
    ])
    // The rest of the default menu stays: Edit keeps copy and paste working in text fields. File is
    // the fileMenu role on macOS and spelled out elsewhere, with Settings… in it.
    const file = process.platform === 'darwin' ? 'fileMenu' : 'File'
    expect(template.map((item) => item.role ?? item.label)).toEqual(expect.arrayContaining([file, 'editMenu', 'View', 'windowMenu']))
  })

  it('switching it tells every window and changes what view.get answers', async () => {
    const { module, minimap } = await load()
    const [handler] = module.default
    if (!handler) throw new Error('no handler')
    expect(handler.channel.name).toBe(viewGet.name)

    minimap.click?.({ checked: false })
    expect(electron.sent).toEqual([{ to: 'main', channel: `${IPC_CHANNEL_PREFIX}view.changed`, payload: { minimap: false } }])
    expect(await handler.handle(undefined, {} as never)).toEqual({ minimap: false })

    minimap.click?.({ checked: true })
    expect(electron.sent.at(-1)?.payload).toEqual({ minimap: true })
  })
})

describe('view contract', () => {
  it('refuses a wrong type and drops undeclared keys', () => {
    expect(viewGet.output.safeParse({ minimap: 'yes' }).success).toBe(false)
    expect(viewChanged.payload.safeParse({}).success).toBe(false)
    expect(viewGet.output.parse({ minimap: false, evil: 1 })).toEqual({ minimap: false })
    expect(viewChanged.payload.parse({ minimap: true, extra: 'x' })).toEqual({ minimap: true })
  })
})

/** Every item of the template, submenus included. */
function items(template: TemplateItem[]): TemplateItem[] {
  return template.flatMap((item) => [item, ...items(item.submenu ?? [])])
}

type FakeWindow = InstanceType<typeof electron.FakeBrowserWindow>

/**
 * The page of `window` calls `menu.ready` for `commands` (every one by default), as the app shell
 * does once React has mounted it (src/renderer/menu-command.ts): through the handler of the channel,
 * with the window's web contents as the sender. Imported after the test's vi.resetModules, so it
 * reaches the same module as the menu of that test.
 */
async function pageFollows(window: FakeWindow, commands: readonly MenuCommand[] = MENU_COMMANDS): Promise<void> {
  const handlers = (await import('../../src/main/ipc/menu')).default
  const ready = handlers.find((handler) => handler.channel.name === menuReady.name)
  if (ready === undefined) throw new Error('menu.ready has no handler')
  for (const command of commands) await ready.handle(command as never, { event: { sender: window.webContents } as never })
}

describe('View ▸ Bigger / Smaller / Actual size', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  /** The installed menu over app-settings.json with `scale` (no file without one), its three items and the store behind them. */
  async function menuAt(scale?: number) {
    storedScale(scale)
    const loaded = await load()
    const menu = await import('../../src/main/menu')
    const { appSettingsStore } = await import('../../src/main/settings/store')
    const item = (id: string): TemplateItem => {
      const found = loaded.view?.submenu?.find((entry) => entry.id === id)
      if (!found) throw new Error(`View has no item ${id}`)
      return found
    }
    const store = appSettingsStore()
    return {
      ...loaded,
      menu,
      store,
      scale: () => store.get().interfaceScale,
      bigger: item(menu.SCALE_BIGGER_MENU_ITEM_ID),
      smaller: item(menu.SCALE_SMALLER_MENU_ITEM_ID),
      actual: item(menu.SCALE_ACTUAL_MENU_ITEM_ID),
    }
  }

  it('take the place of the zoom roles of Electron, with ids and Cmd/Ctrl+Alt accelerators', async () => {
    const { template, view, menu, bigger, smaller, actual } = await menuAt()
    for (const platform of ['darwin', 'win32'] as const) {
      const roles = items(menu.menuTemplate(() => undefined, platform) as TemplateItem[]).map((item) => item.role)
      for (const role of ['resetZoom', 'zoomIn', 'zoomOut']) expect(roles, `${role} on ${platform}`).not.toContain(role)
    }
    // test/e2e/interface-scale.spec.ts clicks the items by these ids.
    expect([menu.SCALE_BIGGER_MENU_ITEM_ID, menu.SCALE_SMALLER_MENU_ITEM_ID, menu.SCALE_ACTUAL_MENU_ITEM_ID]).toEqual(['view.scale.bigger', 'view.scale.smaller', 'view.scale.actual'])
    expect(bigger).toMatchObject({ label: 'Bigger', accelerator: 'CmdOrCtrl+Alt+=' })
    expect(smaller).toMatchObject({ label: 'Smaller', accelerator: 'CmdOrCtrl+Alt+-' })
    expect(actual).toMatchObject({ label: 'Actual size', accelerator: 'CmdOrCtrl+Alt+0' })
    // Where the zoom roles were: between the developer items and full screen.
    expect(view?.submenu?.map((item) => item.role ?? item.type ?? item.label)).toEqual([
      'reload',
      'forceReload',
      'toggleDevTools',
      'separator',
      'Actual size',
      'Bigger',
      'Smaller',
      'separator',
      'togglefullscreen',
      'separator',
      'Toggle Sidebar',
      'checkbox',
    ])
    // Cmd/Ctrl+= and Cmd/Ctrl+- stay the zoom of the Canvas, and Cmd/Ctrl+0 is nobody's: no item takes them.
    const accelerators = items(template).map((item) => item.accelerator)
    for (const taken of ['CmdOrCtrl+=', 'CmdOrCtrl+-', 'CmdOrCtrl+0', 'CmdOrCtrl+Plus']) expect(accelerators).not.toContain(taken)
  })

  it('a click changes the interface scale by a tenth and writes it to app-settings.json', async () => {
    const { bigger, smaller, scale, store } = await menuAt()
    expect(scale()).toBe(1)
    bigger.click?.({ checked: false })
    expect(scale()).toBe(1.1)
    smaller.click?.({ checked: false })
    smaller.click?.({ checked: false })
    expect(scale()).toBe(0.9)
    expect(store.get().revision).toBe(3)
    const { AppSettingsStore } = await import('../../src/main/settings/store')
    expect(new AppSettingsStore(settingsFile).get().interfaceScale).toBe(0.9)
  })

  it('every step lands on a whole tenth, from 0.8 up to 1.5 and back', async () => {
    const { bigger, smaller, scale } = await menuAt(0.8)
    const up: number[] = []
    for (let step = 0; step < 7; step++) {
      bigger.click?.({ checked: false })
      up.push(scale())
    }
    expect(up).toEqual([0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5])
    const down: number[] = []
    for (let step = 0; step < 7; step++) {
      smaller.click?.({ checked: false })
      down.push(scale())
    }
    expect(down).toEqual([1.4, 1.3, 1.2, 1.1, 1, 0.9, 0.8])
  })

  it('Bigger from 1.4 gives 1.5 and is disabled there; one more click changes nothing', async () => {
    const { bigger, smaller, scale, store } = await menuAt(1.4)
    expect(bigger.enabled).toBe(true)
    expect(smaller.enabled).toBe(true)
    bigger.click?.({ checked: false })
    expect(scale()).toBe(1.5)
    expect(bigger.enabled).toBe(false)
    expect(smaller.enabled).toBe(true)
    const { revision } = store.get()
    bigger.click?.({ checked: false })
    expect(store.get()).toMatchObject({ interfaceScale: 1.5, revision })
    // Back from the edge the item works again.
    smaller.click?.({ checked: false })
    expect(scale()).toBe(1.4)
    expect(bigger.enabled).toBe(true)
  })

  it('Smaller is disabled on 0.8 and Bigger on 1.5 from the start, and Smaller from 0.9 stops at 0.8', async () => {
    const low = await menuAt(0.8)
    expect(low.smaller.enabled).toBe(false)
    expect(low.bigger.enabled).toBe(true)
    low.smaller.click?.({ checked: false })
    expect(low.scale()).toBe(0.8)

    const high = await menuAt(1.5)
    expect(high.bigger.enabled).toBe(false)
    expect(high.smaller.enabled).toBe(true)

    const near = await menuAt(0.9)
    expect(near.smaller.enabled).toBe(true)
    near.smaller.click?.({ checked: false })
    expect(near.scale()).toBe(0.8)
    expect(near.smaller.enabled).toBe(false)
  })

  it('Actual size gives 1 from either side, stays enabled, and enables the item of the edge it left', async () => {
    const high = await menuAt(1.5)
    expect(high.actual.enabled).not.toBe(false)
    high.actual.click?.({ checked: false })
    expect(high.scale()).toBe(1)
    expect(high.bigger.enabled).toBe(true)
    expect(high.actual.enabled).not.toBe(false)

    const low = await menuAt(0.8)
    low.actual.click?.({ checked: false })
    expect(low.scale()).toBe(1)
    expect(low.smaller.enabled).toBe(true)
  })

  it('a scale set elsewhere (the slider of Settings) disables and enables the items of the installed menu', async () => {
    const { bigger, smaller, store } = await menuAt()
    store.set({ interfaceScale: 1.5 })
    expect([bigger.enabled, smaller.enabled]).toEqual([false, true])
    store.set({ interfaceScale: 0.8 })
    expect([bigger.enabled, smaller.enabled]).toEqual([true, false])
    store.set({ interfaceScale: 1.2 })
    expect([bigger.enabled, smaller.enabled]).toEqual([true, true])
  })

  it('a click whose settings cannot be written throws nothing and leaves the scale and the items as they were', async () => {
    // The data folder is a file: app-settings.json cannot be written under it.
    const blocked = join(env.scratch, 'not-a-folder')
    writeFileSync(blocked, '')
    vi.stubEnv('WORFY_DATA_DIR', blocked)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { bigger, smaller, actual, scale } = await menuAt()
    expect(() => bigger.click?.({ checked: false })).not.toThrow()
    expect(() => smaller.click?.({ checked: false })).not.toThrow()
    expect(() => actual.click?.({ checked: false })).not.toThrow()
    expect(scale()).toBe(1)
    expect([bigger.enabled, smaller.enabled]).toEqual([true, true])
    expect(warn.mock.calls.some(([message]) => String(message).includes('interface scale'))).toBe(true)
  })
})

describe('the interface scale as the zoom of the windows', () => {
  async function loadScale(scale?: number) {
    storedScale(scale)
    vi.resetModules()
    const module = await import('../../src/main/settings/interface-scale')
    const { appSettingsStore } = await import('../../src/main/settings/store')
    return { ...module, store: appSettingsStore() }
  }

  it('interfaceScale answers the scale of app-settings.json, 1 without the file', async () => {
    expect((await loadScale()).interfaceScale()).toBe(1)
    expect((await loadScale(1.3)).interfaceScale()).toBe(1.3)
  })

  it('a followed window gets the scale after every load of its page, the scale of that moment', async () => {
    const { followInterfaceScale, store } = await loadScale(1.3)
    followInterfaceScale(electron.window as never)
    // Nothing yet: the window starts with the scale in its webPreferences (src/main/window.ts).
    expect(electron.zooms).toEqual([])
    electron.window.fire('did-finish-load')
    expect(electron.zooms).toEqual([{ to: 'main', factor: 1.3 }])

    store.set({ interfaceScale: 0.9 })
    electron.zooms.length = 0
    // A reload: the page comes back with the scale of now, not the one the window was made with.
    electron.window.fire('did-finish-load')
    expect(electron.zooms).toEqual([{ to: 'main', factor: 0.9 }])
  })

  it('a change of the scale reaches every window once, however many windows are followed', async () => {
    const { followInterfaceScale, store } = await loadScale()
    const second = new electron.FakeBrowserWindow('second')
    electron.FakeBrowserWindow.all = [electron.window, second]
    followInterfaceScale(electron.window as never)
    followInterfaceScale(second as never)
    // One listener for the app: a window that is opened and closed leaves none behind in the store.
    expect(store.listenerCount('changed')).toBe(1)
    store.set({ interfaceScale: 1.5 })
    expect(electron.zooms).toEqual([
      { to: 'main', factor: 1.5 },
      { to: 'second', factor: 1.5 },
    ])
    // A change of another setting changes no zoom.
    electron.zooms.length = 0
    store.set({ sidebar: { visible: { normal: false } } })
    expect(electron.zooms).toEqual([])
  })

  it('createMainWindow makes the window at the scale of the settings, and follows it from then on', async () => {
    const { store } = await loadScale(1.3)
    vi.stubEnv('ELECTRON_RENDERER_URL', '')
    try {
      const { createMainWindow } = await import('../../src/main/window')
      const made = createMainWindow() as unknown as InstanceType<typeof electron.FakeBrowserWindow>
      // The first paint is at the scale: no load at 100 % that jumps afterwards.
      expect(made.options?.webPreferences).toMatchObject({ zoomFactor: 1.3, sandbox: true, contextIsolation: true })
      expect(electron.zooms).toEqual([])
      made.fire('did-finish-load')
      expect(electron.zooms).toEqual([{ to: 'made by main', factor: 1.3 }])
      electron.FakeBrowserWindow.all = [made]
      store.set({ interfaceScale: 0.9 })
      expect(electron.zooms.at(-1)).toEqual({ to: 'made by main', factor: 0.9 })
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('a destroyed window gets no zoom, on a change or on a late load event', async () => {
    const { followInterfaceScale, store } = await loadScale()
    const gone = new electron.FakeBrowserWindow('gone')
    electron.FakeBrowserWindow.all = [gone, electron.window]
    followInterfaceScale(gone as never)
    followInterfaceScale(electron.window as never)
    gone.destroyed = true
    store.set({ interfaceScale: 1.2 })
    expect(electron.zooms).toEqual([{ to: 'main', factor: 1.2 }])
    gone.fire('did-finish-load')
    expect(electron.zooms).toEqual([{ to: 'main', factor: 1.2 }])
  })
})

describe('Settings…', () => {
  async function templateFor(platform: NodeJS.Platform) {
    vi.resetModules()
    const menu = await import('../../src/main/menu')
    const template = menu.menuTemplate(() => undefined, platform) as TemplateItem[]
    const settings = items(template).find((item) => item.id === menu.SETTINGS_MENU_ITEM_ID)
    if (!settings) throw new Error('Settings… is missing')
    return { menu, template, settings }
  }

  it('on macOS sits in the app menu after About worfy, with CmdOrCtrl+, and every item of the appMenu role', async () => {
    const { menu, template, settings } = await templateFor('darwin')
    // test/e2e/settings.spec.ts clicks the item by this id.
    expect(menu.SETTINGS_MENU_ITEM_ID).toBe('app.settings')
    expect(settings).toMatchObject({ label: 'Settings…', accelerator: 'CmdOrCtrl+,' })
    const appMenu = template[0]
    expect(appMenu?.label).toBe('worfy')
    // The appMenu role spelled out (Electron's own list), with Settings… after About.
    expect(appMenu?.submenu?.map((item) => item.role ?? item.type ?? item.label)).toEqual([
      'about',
      'separator',
      'Settings…',
      'separator',
      'services',
      'separator',
      'hide',
      'hideOthers',
      'unhide',
      'separator',
      'quit',
    ])
    expect(template.map((item) => item.role ?? item.label)).toEqual(['worfy', 'fileMenu', 'editMenu', 'View', 'windowMenu', 'help'])
  })

  it('on Windows is the first item of File, and File still quits the app', async () => {
    const { template, settings } = await templateFor('win32')
    expect(settings).toMatchObject({ label: 'Settings…', accelerator: 'CmdOrCtrl+,' })
    const file = template[0]
    expect(file?.label).toBe('File')
    expect(file?.submenu?.[0]).toBe(settings)
    expect(file?.submenu?.map((item) => item.role ?? item.type ?? item.label)).toEqual(['Settings…', 'separator', 'quit'])
    expect(template.map((item) => item.role ?? item.label)).toEqual(['File', 'editMenu', 'View', 'windowMenu', 'help'])
    expect(items(template).some((item) => item.role === 'about' || item.role === 'services')).toBe(false)
  })

  it('a click with a window tells that window, not the focused one', async () => {
    const { settings } = await templateFor('darwin')
    const other = new electron.FakeBrowserWindow('other')
    await pageFollows(other)
    await pageFollows(electron.window)
    electron.FakeBrowserWindow.focused = electron.window
    settings.click?.({ checked: false }, other)
    expect(electron.sent).toEqual([{ to: 'other', channel: `${IPC_CHANNEL_PREFIX}menu.command`, payload: 'settings' }])
  })

  it('a click without a window tells the focused one; with no window in focus, nobody', async () => {
    const { settings } = await templateFor('win32')
    await pageFollows(electron.window)
    electron.FakeBrowserWindow.focused = electron.window
    settings.click?.({ checked: false }, undefined)
    expect(electron.sent).toEqual([{ to: 'main', channel: `${IPC_CHANNEL_PREFIX}menu.command`, payload: 'settings' }])
    electron.sent.length = 0
    electron.FakeBrowserWindow.focused = null
    settings.click?.({ checked: false }, undefined)
    expect(electron.sent).toEqual([])
  })

  it('a destroyed window gets no command, whether it came with the click or has the focus', async () => {
    const { settings } = await templateFor('darwin')
    const gone = new electron.FakeBrowserWindow('gone')
    await pageFollows(gone)
    await pageFollows(electron.window)
    gone.destroyed = true
    electron.FakeBrowserWindow.focused = electron.window
    // The window of the click was closed meanwhile: the command is not passed on to another one.
    settings.click?.({ checked: false }, gone)
    expect(electron.sent).toEqual([])
    electron.FakeBrowserWindow.focused = gone
    settings.click?.({ checked: false }, undefined)
    expect(electron.sent).toEqual([])
  })

  it('the installed menu carries it too', async () => {
    const { template } = await load()
    expect(items(template).filter((item) => item.label === 'Settings…')).toHaveLength(1)
  })
})

describe('View ▸ Toggle Sidebar', () => {
  async function templateFor(platform: NodeJS.Platform) {
    vi.resetModules()
    const menu = await import('../../src/main/menu')
    const template = menu.menuTemplate(() => undefined, platform) as TemplateItem[]
    const view = template.find((item) => item.label === 'View')
    const sidebar = view?.submenu?.find((item) => item.id === menu.SIDEBAR_MENU_ITEM_ID)
    if (!sidebar) throw new Error('View ▸ Toggle Sidebar is missing')
    return { menu, template, view, sidebar }
  }

  it.each(['darwin', 'win32', 'linux'] as const)('on %s sits in View with CmdOrCtrl+B, next to Show Minimap, and no other item has that key', async (platform) => {
    const { menu, template, view, sidebar } = await templateFor(platform)
    // test/e2e/focus-sidebar.spec.ts clicks the item by this id.
    expect(menu.SIDEBAR_MENU_ITEM_ID).toBe('view.sidebar')
    expect(sidebar).toMatchObject({ label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+B' })
    // A plain item: what it switches is kept by the window, apart for the normal view and focus mode.
    expect(sidebar.type).toBeUndefined()
    expect(sidebar.role).toBeUndefined()
    expect(view?.submenu?.slice(-3).map((item) => item.type ?? item.label)).toEqual(['separator', 'Toggle Sidebar', 'checkbox'])
    expect(items(template).filter((item) => item.accelerator === 'CmdOrCtrl+B')).toEqual([sidebar])
    expect(items(template).filter((item) => item.label === 'Toggle Sidebar')).toHaveLength(1)
  })

  it('a click with a window tells that window `toggleSidebar`, not the focused one and not every window', async () => {
    const { sidebar } = await templateFor('darwin')
    const other = new electron.FakeBrowserWindow('other')
    await pageFollows(other)
    await pageFollows(electron.window)
    electron.FakeBrowserWindow.all = [electron.window, other]
    electron.FakeBrowserWindow.focused = electron.window
    sidebar.click?.({ checked: false }, other)
    expect(electron.sent).toEqual([{ to: 'other', channel: `${IPC_CHANNEL_PREFIX}menu.command`, payload: 'toggleSidebar' }])
  })

  it('a click without a window tells the focused one; with no window in focus, nobody', async () => {
    const { sidebar } = await templateFor('win32')
    await pageFollows(electron.window)
    electron.FakeBrowserWindow.focused = electron.window
    sidebar.click?.({ checked: false }, undefined)
    expect(electron.sent).toEqual([{ to: 'main', channel: `${IPC_CHANNEL_PREFIX}menu.command`, payload: 'toggleSidebar' }])
    electron.sent.length = 0
    electron.FakeBrowserWindow.focused = null
    sidebar.click?.({ checked: false }, undefined)
    expect(electron.sent).toEqual([])
  })

  it('a destroyed window gets no command', async () => {
    const { sidebar } = await templateFor('darwin')
    const gone = new electron.FakeBrowserWindow('gone')
    await pageFollows(gone)
    gone.destroyed = true
    electron.FakeBrowserWindow.focused = electron.window
    sidebar.click?.({ checked: false }, gone)
    expect(electron.sent).toEqual([])
  })

  it('a click writes nothing to the app settings: the window does, for the view it shows', async () => {
    const { sidebar } = await templateFor('darwin')
    const { appSettingsStore } = await import('../../src/main/settings/store')
    const before = appSettingsStore().get()
    sidebar.click?.({ checked: false }, electron.window)
    expect(appSettingsStore().get()).toEqual(before)
  })

  it('the installed menu carries it too', async () => {
    const { template } = await load()
    expect(items(template).filter((item) => item.label === 'Toggle Sidebar')).toHaveLength(1)
  })
})

describe('Help ▸ Keyboard Shortcuts', () => {
  async function templateFor(platform: NodeJS.Platform) {
    vi.resetModules()
    const menu = await import('../../src/main/menu')
    const template = menu.menuTemplate(() => undefined, platform) as TemplateItem[]
    const help = template.at(-1)
    const shortcuts = help?.submenu?.find((item) => item.id === menu.SHORTCUTS_MENU_ITEM_ID)
    if (!shortcuts) throw new Error('Help ▸ Keyboard Shortcuts is missing')
    return { menu, template, help, shortcuts }
  }

  it.each(['darwin', 'win32', 'linux'] as const)('on %s Help is the last menu, with the help role, and carries Keyboard Shortcuts with CmdOrCtrl+/', async (platform) => {
    const { menu, template, help, shortcuts } = await templateFor(platform)
    // test/e2e/shortcuts.spec.ts clicks the item by this id.
    expect(menu.SHORTCUTS_MENU_ITEM_ID).toBe('help.shortcuts')
    // The help role gives the menu the search field of macOS.
    expect(help).toMatchObject({ role: 'help', label: 'Help' })
    expect(help?.submenu).toEqual([shortcuts])
    expect(shortcuts).toMatchObject({ label: 'Keyboard Shortcuts', accelerator: 'CmdOrCtrl+/' })
    expect(shortcuts.role).toBeUndefined()
    expect(items(template).filter((item) => item.accelerator === 'CmdOrCtrl+/')).toEqual([shortcuts])
  })

  it('takes Cmd+/ on macOS; on Windows and Linux it shows Ctrl+/ and leaves the key to the renderer, which keeps it from a Terminal', async () => {
    expect((await templateFor('darwin')).shortcuts).not.toHaveProperty('registerAccelerator')
    expect((await templateFor('win32')).shortcuts).toMatchObject({ registerAccelerator: false })
    expect((await templateFor('linux')).shortcuts).toMatchObject({ registerAccelerator: false })
    // Ctrl+B stays the menu's everywhere: xterm.js cancels it in a terminal, so the menu never sees it there.
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      vi.resetModules()
      const menu = await import('../../src/main/menu')
      const template = menu.menuTemplate(() => undefined, platform) as TemplateItem[]
      const taken = items(template).filter((item) => item.accelerator !== undefined && item.registerAccelerator === false)
      expect(taken.map((item) => item.id)).toEqual(platform === 'darwin' ? [] : [menu.SHORTCUTS_MENU_ITEM_ID])
    }
  })

  it('a click with a window tells that window `shortcuts`, not the focused one and not every window', async () => {
    const { shortcuts } = await templateFor('darwin')
    const other = new electron.FakeBrowserWindow('other')
    await pageFollows(other)
    await pageFollows(electron.window)
    electron.FakeBrowserWindow.all = [electron.window, other]
    electron.FakeBrowserWindow.focused = electron.window
    shortcuts.click?.({ checked: false }, other)
    expect(electron.sent).toEqual([{ to: 'other', channel: `${IPC_CHANNEL_PREFIX}menu.command`, payload: 'shortcuts' }])
  })

  it('a click without a window tells the focused one; with no window in focus, nobody', async () => {
    const { shortcuts } = await templateFor('win32')
    await pageFollows(electron.window)
    electron.FakeBrowserWindow.focused = electron.window
    shortcuts.click?.({ checked: false }, undefined)
    expect(electron.sent).toEqual([{ to: 'main', channel: `${IPC_CHANNEL_PREFIX}menu.command`, payload: 'shortcuts' }])
    electron.sent.length = 0
    electron.FakeBrowserWindow.focused = null
    shortcuts.click?.({ checked: false }, undefined)
    expect(electron.sent).toEqual([])
  })

  it('the installed menu carries it too', async () => {
    const { template } = await load()
    expect(items(template).filter((item) => item.label === 'Keyboard Shortcuts')).toHaveLength(1)
  })
})

describe('the accelerators of the menu', () => {
  it.each(['darwin', 'win32', 'linux'] as const)('on %s are the keys of the registry of shortcuts', async (platform) => {
    vi.resetModules()
    const menu = await import('../../src/main/menu')
    const template = menu.menuTemplate(() => undefined, platform) as TemplateItem[]
    const byId = (id: string) => items(template).find((item) => item.id === id)
    expect(byId(menu.SETTINGS_MENU_ITEM_ID)?.accelerator).toBe(accelerator(SHORTCUTS.settings))
    expect(byId(menu.SCALE_BIGGER_MENU_ITEM_ID)?.accelerator).toBe(accelerator(SHORTCUTS.scaleBigger))
    expect(byId(menu.SCALE_SMALLER_MENU_ITEM_ID)?.accelerator).toBe(accelerator(SHORTCUTS.scaleSmaller))
    expect(byId(menu.SCALE_ACTUAL_MENU_ITEM_ID)?.accelerator).toBe(accelerator(SHORTCUTS.scaleActual))
    expect(byId(menu.SIDEBAR_MENU_ITEM_ID)?.accelerator).toBe(accelerator(SHORTCUTS.toggleSidebar))
    expect(byId(menu.SHORTCUTS_MENU_ITEM_ID)?.accelerator).toBe(accelerator(SHORTCUTS.shortcuts))
    // And the registry says what the menu has always carried.
    expect([SHORTCUTS.settings, SHORTCUTS.scaleBigger, SHORTCUTS.scaleSmaller, SHORTCUTS.scaleActual, SHORTCUTS.toggleSidebar, SHORTCUTS.shortcuts].map(accelerator)).toEqual([
      'CmdOrCtrl+,',
      'CmdOrCtrl+Alt+=',
      'CmdOrCtrl+Alt+-',
      'CmdOrCtrl+Alt+0',
      'CmdOrCtrl+B',
      'CmdOrCtrl+/',
    ])
  })
})

describe('a menu command chosen before the page follows it (worfy-windows ticket 96)', () => {
  const PREFIXED = `${IPC_CHANNEL_PREFIX}menu.command`

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  /** The menu of a fresh main and a click on each command's item with a window, as Electron makes it. */
  async function menuItems() {
    vi.resetModules()
    const menu = await import('../../src/main/menu')
    const template = menu.menuTemplate(() => undefined, 'win32') as TemplateItem[]
    const clickOf = (id: string) => {
      const click = items(template).find((candidate) => candidate.id === id)?.click
      if (click === undefined) throw new Error(`${id} is missing`)
      return (window: FakeWindow) => click({ checked: false }, window)
    }
    const held = await import('../../src/main/ipc/menu')
    const choose: Record<MenuCommand, (window: FakeWindow) => void> = {
      settings: clickOf(menu.SETTINGS_MENU_ITEM_ID),
      toggleSidebar: clickOf(menu.SIDEBAR_MENU_ITEM_ID),
      shortcuts: clickOf(menu.SHORTCUTS_MENU_ITEM_ID),
    }
    return { held, choose }
  }

  it.each(MENU_COMMANDS)('`%s` sent before the page subscribed is held, and arrives once the page says it follows it', async (command) => {
    const { choose } = await menuItems()
    choose[command](electron.window)
    expect(electron.sent).toEqual([])
    await pageFollows(electron.window, [command])
    expect(electron.sent).toEqual([{ to: 'main', channel: PREFIXED, payload: command }])
    // Once only: a second menu.ready of the page sends nothing again.
    await pageFollows(electron.window, [command])
    expect(electron.sent).toHaveLength(1)
    // And from then on a command goes at once.
    choose[command](electron.window)
    expect(electron.sent).toEqual([
      { to: 'main', channel: PREFIXED, payload: command },
      { to: 'main', channel: PREFIXED, payload: command },
    ])
  })

  it('the page that follows one command gets only that one; the others wait for their own menu.ready', async () => {
    const { choose } = await menuItems()
    choose.settings(electron.window)
    choose.toggleSidebar(electron.window)
    choose.settings(electron.window)
    await pageFollows(electron.window, ['settings'])
    expect(electron.sent.map((each) => each.payload)).toEqual(['settings', 'settings'])
    await pageFollows(electron.window, ['toggleSidebar'])
    expect(electron.sent.map((each) => each.payload)).toEqual(['settings', 'settings', 'toggleSidebar'])
  })

  it('each window holds its own: the page of another window being ready sends nothing of this one', async () => {
    const { choose } = await menuItems()
    const other = new electron.FakeBrowserWindow('other')
    choose.settings(electron.window)
    await pageFollows(other)
    expect(electron.sent).toEqual([])
    choose.settings(other)
    expect(electron.sent).toEqual([{ to: 'other', channel: PREFIXED, payload: 'settings' }])
  })

  it('pins the bounds: a held command waits 10 s at most, and a window holds 8 at most', async () => {
    const { held } = await menuItems()
    expect(held.HELD_FOR_MS).toBe(10_000)
    expect(held.HELD_AT_MOST).toBe(8)
  })

  it('a command sent at once to a ready page is not held as well: a second menu.ready sends nothing more', async () => {
    const { choose } = await menuItems()
    await pageFollows(electron.window, ['settings'])
    choose.settings(electron.window)
    await pageFollows(electron.window, ['settings'])
    expect(electron.sent).toEqual([{ to: 'main', channel: PREFIXED, payload: 'settings' }])
  })

  it('a command held longer than HELD_FOR_MS is dropped with a warning that names it and the window, not sent late', async () => {
    vi.useFakeTimers({ toFake: ['performance'] })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { choose, held } = await menuItems()
    choose.settings(electron.window)
    vi.advanceTimersByTime(held.HELD_FOR_MS)
    choose.toggleSidebar(electron.window)
    vi.advanceTimersByTime(1)
    await pageFollows(electron.window)
    // The settings command is HELD_FOR_MS + 1 ms old by now; the sidebar one, 1 ms.
    expect(electron.sent).toEqual([{ to: 'main', channel: PREFIXED, payload: 'toggleSidebar' }])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toMatch(/'settings' for window main dropped/)
  })

  it('a command at exactly HELD_FOR_MS still arrives, without a warning', async () => {
    vi.useFakeTimers({ toFake: ['performance'] })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { choose, held } = await menuItems()
    choose.shortcuts(electron.window)
    vi.advanceTimersByTime(held.HELD_FOR_MS)
    await pageFollows(electron.window)
    expect(electron.sent).toEqual([{ to: 'main', channel: PREFIXED, payload: 'shortcuts' }])
    expect(warn).not.toHaveBeenCalled()
  })

  it('the wait is measured on the monotonic clock: a jump of the system clock drops nothing', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const { choose, held } = await menuItems()
    choose.settings(electron.window)
    vi.setSystemTime(Date.now() + 10 * held.HELD_FOR_MS)
    await pageFollows(electron.window)
    expect(electron.sent).toEqual([{ to: 'main', channel: PREFIXED, payload: 'settings' }])
  })

  it('a window holds at most HELD_AT_MOST commands, the latest ones', async () => {
    const { choose, held } = await menuItems()
    for (let index = 0; index < held.HELD_AT_MOST + 3; index += 1) choose.settings(electron.window)
    choose.toggleSidebar(electron.window)
    await pageFollows(electron.window)
    const payloads = electron.sent.map((each) => each.payload)
    expect(payloads).toHaveLength(held.HELD_AT_MOST)
    expect(payloads.at(-1)).toBe('toggleSidebar')
  })

  it('a new document that commits in the main frame drops what is held and what the old page followed', async () => {
    const { choose } = await menuItems()
    await pageFollows(electron.window, ['shortcuts'])
    choose.settings(electron.window)
    // View ▸ Reload: the new document commits.
    electron.window.fire('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    electron.window.fire('did-navigate', {}, 'file:///index.html', -1, '')
    choose.shortcuts(electron.window)
    expect(electron.sent).toEqual([])
    // The new page follows settings: the command chosen for the old page is gone.
    await pageFollows(electron.window, ['settings'])
    expect(electron.sent).toEqual([])
    // The shortcuts one, chosen after the reload, waited for the new page and arrives now.
    await pageFollows(electron.window, ['shortcuts'])
    expect(electron.sent).toEqual([{ to: 'main', channel: PREFIXED, payload: 'shortcuts' }])
  })

  it('a command chosen before the page was ever ready, then a reload, then menu.ready: nothing is sent', async () => {
    const { choose } = await menuItems()
    choose.settings(electron.window)
    electron.window.fire('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    electron.window.fire('did-navigate', {}, 'file:///index.html', -1, '')
    await pageFollows(electron.window)
    expect(electron.sent).toEqual([])
  })

  it('a navigation that starts but never commits leaves the old page ready and what it holds in place', async () => {
    const { choose } = await menuItems()
    await pageFollows(electron.window, ['settings'])
    choose.toggleSidebar(electron.window)
    // A link that turns into a download, a 204, a refused URL: the start comes, then the stop, and
    // no fail event (Electron 44.5.1).
    electron.window.fire('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    electron.window.fire('did-stop-loading')
    choose.settings(electron.window)
    expect(electron.sent).toEqual([{ to: 'main', channel: PREFIXED, payload: 'settings' }])
    await pageFollows(electron.window, ['toggleSidebar'])
    expect(electron.sent.map((each) => each.payload)).toEqual(['settings', 'toggleSidebar'])
  })

  it('an error page in the main frame drops what the old page followed; a failure inside a frame does not', async () => {
    const { choose } = await menuItems()
    await pageFollows(electron.window, ['settings'])
    electron.window.fire('did-fail-provisional-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://nowhere.invalid/', false, 1, 2)
    electron.window.fire('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://nowhere.invalid/', false, 1, 2)
    choose.settings(electron.window)
    expect(electron.sent).toEqual([{ to: 'main', channel: PREFIXED, payload: 'settings' }])
    // View > Reload with the dev server down: an error page commits, with did-fail-provisional-load,
    // then did-fail-load, and no did-navigate.
    electron.window.fire('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    electron.window.fire('did-fail-provisional-load', {}, -102, 'ERR_CONNECTION_REFUSED', 'http://localhost:5173/', true, 1, 1)
    electron.window.fire('did-fail-load', {}, -102, 'ERR_CONNECTION_REFUSED', 'http://localhost:5173/', true, 1, 1)
    choose.settings(electron.window)
    expect(electron.sent).toHaveLength(1)
  })

  it('a main-frame load that fails after the commit keeps what the new page follows', async () => {
    const { choose } = await menuItems()
    await pageFollows(electron.window, ['settings'])
    electron.window.fire('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    electron.window.fire('did-navigate', {}, 'file:///index.html', -1, '')
    // The new page follows settings, then the rest of its body never arrives: Electron 44 emits
    // did-fail-load -354 for the main frame after did-navigate and shows no error page.
    await pageFollows(electron.window, ['settings'])
    electron.window.fire('did-fail-load', {}, -354, 'ERR_CONTENT_LENGTH_MISMATCH', 'file:///index.html', true, 1, 1)
    choose.settings(electron.window)
    expect(electron.sent).toEqual([{ to: 'main', channel: PREFIXED, payload: 'settings' }])
  })

  it("an old page's menu.ready that arrives during a reload, before the commit, does not make the new page ready", async () => {
    const { choose } = await menuItems()
    electron.window.fire('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    // Sent by the old page before it unloaded.
    await pageFollows(electron.window, ['settings'])
    electron.window.fire('did-navigate', {}, 'file:///index.html', -1, '')
    choose.settings(electron.window)
    expect(electron.sent).toEqual([])
    await pageFollows(electron.window, ['settings'])
    expect(electron.sent).toEqual([{ to: 'main', channel: PREFIXED, payload: 'settings' }])
  })

  it('a navigation inside the document keeps what is held and what the page follows', async () => {
    const { choose } = await menuItems()
    await pageFollows(electron.window, ['shortcuts'])
    choose.settings(electron.window)
    electron.window.fire('did-start-navigation', { isMainFrame: true, isSameDocument: true })
    electron.window.fire('did-navigate-in-page', {}, 'file:///index.html#x', true)
    choose.shortcuts(electron.window)
    expect(electron.sent).toEqual([{ to: 'main', channel: PREFIXED, payload: 'shortcuts' }])
    await pageFollows(electron.window, ['settings'])
    expect(electron.sent.map((each) => each.payload)).toEqual(['shortcuts', 'settings'])
  })

  it('a window destroyed while its command is held gets nothing', async () => {
    const { choose } = await menuItems()
    const gone = new electron.FakeBrowserWindow('gone')
    choose.settings(gone)
    gone.destroyed = true
    await pageFollows(gone)
    expect(electron.sent).toEqual([])
  })

  it('deliverMenuCommand sends nothing to a destroyed window, even one whose page was ready', async () => {
    const { held } = await menuItems()
    const gone = new electron.FakeBrowserWindow('gone')
    await pageFollows(gone)
    gone.destroyed = true
    held.deliverMenuCommand(gone.webContents as never, 'settings')
    expect(electron.sent).toEqual([])
  })

  it('menu.ready is local, takes one of the menu commands and nothing else', () => {
    expect(menuReady.access).toBe('local')
    expect(menuReady.use).toBeNull()
    for (const command of MENU_COMMANDS) expect(menuReady.input.parse(command)).toBe(command)
    expect(menuReady.input.safeParse('quit').success).toBe(false)
    expect(menuReady.input.safeParse(undefined).success).toBe(false)
    expect(menuReady.input.safeParse({ command: 'settings' }).success).toBe(false)
    expect(menuReady.output.safeParse(undefined).success).toBe(true)
  })
})

describe('menu contract', () => {
  it('menu.command carries one of the known commands, nothing else', () => {
    expect(menuCommand.access).toBe('local')
    expect(menuCommand.payload.parse('settings')).toBe('settings')
    expect(menuCommand.payload.parse('toggleSidebar')).toBe('toggleSidebar')
    expect(menuCommand.payload.parse('shortcuts')).toBe('shortcuts')
    expect(menuCommand.payload.options).toEqual(['settings', 'toggleSidebar', 'shortcuts'])
    expect(menuCommand.payload.safeParse('togglesidebar').success).toBe(false)
    expect(menuCommand.payload.safeParse('quit').success).toBe(false)
    expect(menuCommand.payload.safeParse({ command: 'settings' }).success).toBe(false)
  })
})
