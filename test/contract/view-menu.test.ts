// The app menu (src/main/menu.ts) and the `view` domain (src/main/ipc/view.ts) over a mocked
// `electron`: the menu gets View ▸ Show Minimap, switching it tells every window, and `view.get`
// answers with the state. "Settings…" (worfy-ui ticket 2) sits in the app menu on macOS and first in
// File elsewhere, and tells one window to open the Settings window.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNEL_PREFIX } from '../../src/shared/ipc/channels'
import { menuCommand } from '../../src/shared/ipc/menu'
import { viewChanged, viewGet } from '../../src/shared/ipc/view'

interface TemplateItem {
  id?: string
  label?: string
  role?: string
  type?: string
  accelerator?: string
  checked?: boolean
  click?: (item: { checked: boolean }, window?: unknown) => void
  submenu?: TemplateItem[]
}

const electron = vi.hoisted(() => {
  const sent: { to: string; channel: string; payload: unknown }[] = []
  const menus: unknown[] = []
  /** A window of the app: what main sends to it is recorded with its name. */
  class FakeBrowserWindow {
    static all: FakeBrowserWindow[] = []
    static focused: FakeBrowserWindow | null = null
    static getAllWindows = () => FakeBrowserWindow.all
    static getFocusedWindow = () => FakeBrowserWindow.focused
    readonly webContents: { send: (channel: string, payload: unknown) => void }
    constructor(readonly name: string) {
      this.webContents = { send: (channel, payload) => sent.push({ to: name, channel, payload }) }
    }
    destroyed = false
    isDestroyed = () => this.destroyed
  }
  const window = new FakeBrowserWindow('main')
  FakeBrowserWindow.all = [window]
  return { sent, menus, window, FakeBrowserWindow }
})

vi.mock('electron', () => ({
  app: { name: 'worfy' },
  BrowserWindow: electron.FakeBrowserWindow,
  Menu: {
    buildFromTemplate: (template: unknown) => ({ template }),
    setApplicationMenu: (menu: unknown) => electron.menus.push(menu),
  },
}))

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
  electron.FakeBrowserWindow.focused = null
})

describe('View ▸ Show Minimap', () => {
  it('is a checked checkbox at first, next to the default View items', async () => {
    const { view, minimap, template } = await load()
    expect(minimap).toMatchObject({ label: 'Show Minimap', type: 'checkbox', checked: true })
    expect(view?.submenu?.map((item) => item.role).filter(Boolean)).toEqual([
      'reload',
      'forceReload',
      'toggleDevTools',
      'resetZoom',
      'zoomIn',
      'zoomOut',
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
