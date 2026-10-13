// The app menu (src/main/menu.ts) and the `view` domain (src/main/ipc/view.ts) over a mocked
// `electron`: the menu gets View ▸ Show Minimap, switching it tells every window, and `view.get`
// answers with the state. "Settings…" (worfy-ui ticket 2) sits in the app menu on macOS and first in
// File elsewhere, and tells one window to open the Settings window. View ▸ Bigger / Smaller / Actual
// size (worfy-ui ticket 3) change the interface scale of the app settings, over a temporary
// WORFY_DATA_DIR; src/main/settings/interface-scale.ts gives that scale to every window as its zoom.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNEL_PREFIX } from '../../src/shared/ipc/channels'
import { menuCommand } from '../../src/shared/ipc/menu'
import { viewChanged, viewGet } from '../../src/shared/ipc/view'
import { removeTestTree } from '../remove'

interface TemplateItem {
  id?: string
  label?: string
  role?: string
  type?: string
  accelerator?: string
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
    readonly listeners = new Map<string, (() => void)[]>()
    readonly webContents: {
      send: (channel: string, payload: unknown) => void
      setZoomFactor: (factor: number) => void
      on: (event: string, listener: () => void) => void
    }
    readonly name: string
    /** The options of a window main made itself (createMainWindow); a test names its windows instead. */
    readonly options: { webPreferences?: Record<string, unknown> } | undefined
    constructor(made: string | { webPreferences?: Record<string, unknown> }) {
      const name = typeof made === 'string' ? made : 'made by main'
      this.name = name
      this.options = typeof made === 'string' ? undefined : made
      this.webContents = {
        send: (channel, payload) => sent.push({ to: name, channel, payload }),
        setZoomFactor: (factor) => zooms.push({ to: name, factor }),
        on: (event, listener) => this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]),
      }
    }
    /** Fires an event of the web contents. */
    fire(event: string): void {
      for (const listener of this.listeners.get(event) ?? []) listener()
    }
    destroyed = false
    isDestroyed = () => this.destroyed
    // What createMainWindow asks of a window besides its web contents.
    on(): void {}
    once(): void {}
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
    expect(template.map((item) => item.role ?? item.label)).toEqual(['worfy', 'fileMenu', 'editMenu', 'View', 'windowMenu'])
  })

  it('on Windows is the first item of File, and File still quits the app', async () => {
    const { template, settings } = await templateFor('win32')
    expect(settings).toMatchObject({ label: 'Settings…', accelerator: 'CmdOrCtrl+,' })
    const file = template[0]
    expect(file?.label).toBe('File')
    expect(file?.submenu?.[0]).toBe(settings)
    expect(file?.submenu?.map((item) => item.role ?? item.type ?? item.label)).toEqual(['Settings…', 'separator', 'quit'])
    expect(template.map((item) => item.role ?? item.label)).toEqual(['File', 'editMenu', 'View', 'windowMenu'])
    expect(items(template).some((item) => item.role === 'about' || item.role === 'services')).toBe(false)
  })

  it('a click with a window tells that window, not the focused one', async () => {
    const { settings } = await templateFor('darwin')
    const other = new electron.FakeBrowserWindow('other')
    electron.FakeBrowserWindow.focused = electron.window
    settings.click?.({ checked: false }, other)
    expect(electron.sent).toEqual([{ to: 'other', channel: `${IPC_CHANNEL_PREFIX}menu.command`, payload: 'settings' }])
  })

  it('a click without a window tells the focused one; with no window in focus, nobody', async () => {
    const { settings } = await templateFor('win32')
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

describe('menu contract', () => {
  it('menu.command carries one of the known commands, nothing else', () => {
    expect(menuCommand.access).toBe('local')
    expect(menuCommand.payload.parse('settings')).toBe('settings')
    expect(menuCommand.payload.safeParse('quit').success).toBe(false)
    expect(menuCommand.payload.safeParse({ command: 'settings' }).success).toBe(false)
  })
})
