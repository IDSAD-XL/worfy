// The `view` domain (src/main/ipc/view.ts) over a mocked `electron`: the app menu gets
// View ▸ Show Minimap, switching it tells every window, and `view.get` answers with the state.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNEL_PREFIX } from '../../src/shared/ipc/channels'
import { viewChanged, viewGet } from '../../src/shared/ipc/view'

interface TemplateItem {
  id?: string
  label?: string
  role?: string
  type?: string
  checked?: boolean
  click?: (item: { checked: boolean }) => void
  submenu?: TemplateItem[]
}

const electron = vi.hoisted(() => {
  const sent: { channel: string; payload: unknown }[] = []
  const menus: unknown[] = []
  const window = { isDestroyed: () => false, webContents: { send: (channel: string, payload: unknown) => sent.push({ channel, payload }) } }
  return { sent, menus, window }
})

vi.mock('electron', () => ({
  app: { whenReady: () => Promise.resolve() },
  BrowserWindow: { getAllWindows: () => [electron.window] },
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
  await vi.waitFor(() => expect(electron.menus).toHaveLength(1))
  const { template } = electron.menus[0] as { template: TemplateItem[] }
  const view = template.find((item) => item.label === 'View')
  const minimap = view?.submenu?.find((item) => item.id === module.MINIMAP_MENU_ITEM_ID)
  if (!minimap) throw new Error('View ▸ Show Minimap is missing')
  return { module, template, view, minimap }
}

beforeEach(() => {
  electron.sent.length = 0
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
    // The rest of the default menu stays: Edit keeps copy and paste working in text fields.
    expect(template.map((item) => item.role ?? item.label)).toEqual(expect.arrayContaining(['fileMenu', 'editMenu', 'View', 'windowMenu']))
  })

  it('switching it tells every window and changes what view.get answers', async () => {
    const { module, minimap } = await load()
    const [handler] = module.default
    if (!handler) throw new Error('no handler')
    expect(handler.channel.name).toBe(viewGet.name)

    minimap.click?.({ checked: false })
    expect(electron.sent).toEqual([{ channel: `${IPC_CHANNEL_PREFIX}view.changed`, payload: { minimap: false } }])
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
