// The width of the sidebar (worfy-polish ticket 158): the handle on its right edge drags it, the arrow
// keys step it, a double click puts it back to the default, Escape cancels a drag; the app settings
// keep it (`sidebar.width`, written once a gesture ends), and the shell writes it on <html> as
// `--sidebar-width` — never more than the window leaves the Canvas.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import { SIDEBAR_WIDTH_DEFAULT, SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_MIN, type AppSettings, type AppSettingsPatch } from '../../src/shared/settings/app-settings'

const settingsWith = (width: number | undefined, revision = 1): AppSettings => ({
  interfaceScale: 1,
  sidebar: { collapsed: {}, visible: { normal: true, focus: true }, ...(width === undefined ? {} : { width }) },
  autoCompactWindow: { orchestrator: 400_000, other: 500_000 },
  memoryIndicator: true,
  revision,
})

let settings: AppSettings
let writes: AppSettingsPatch[]
let listeners: Map<number, { channel: string; handler: (payload: unknown) => void }>

function setWindowWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
}

beforeEach(() => {
  // useAppSettings keeps its state in a module: every test starts with a fresh one.
  vi.resetModules()
  settings = settingsWith(undefined, 0)
  writes = []
  listeners = new Map()
  setWindowWidth(1400)
  const bridge = {
    invoke: (channel: string, input: unknown) => {
      if (channel === 'appSettings.get') return Promise.resolve({ ok: true, value: settings })
      if (channel === 'appSettings.set') {
        const patch = input as AppSettingsPatch
        writes.push(patch)
        // As the store merges a patch of `sidebar` (src/main/settings/store.ts): null takes the width away.
        const width = patch.sidebar?.width
        const { width: saved, ...rest } = settings.sidebar
        const visible = { ...rest.visible, ...patch.sidebar?.visible }
        const sidebar = width === null ? { ...rest, visible } : { ...rest, visible, ...(width === undefined ? (saved === undefined ? {} : { width: saved }) : { width }) }
        settings = { ...settings, sidebar, revision: settings.revision + 1 }
        return Promise.resolve({ ok: true, value: settings })
      }
      return Promise.resolve({ ok: false, error: `not in this test: ${channel}` })
    },
    on: (channel: string, handler: (payload: unknown) => void) => {
      const id = listeners.size + 1
      listeners.set(id, { channel, handler })
      return id
    },
    off: (id: number) => {
      listeners.delete(id)
    },
  } as unknown as WorfyBridge
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
  // What the rest of the shell says about the channels this test does not answer.
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
  delete (globalThis as { worfy?: WorfyBridge }).worfy
  document.documentElement.style.removeProperty('--sidebar-width')
  setWindowWidth(1024)
})

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function mount(width?: number): Promise<{ setFocusActive: (active: boolean) => void }> {
  settings = settingsWith(width)
  const { AppShell } = await import('../../src/renderer/shell/AppShell')
  const { setFocusActive } = await import('../../src/renderer/focus/focus-state')
  await act(async () => {
    render(<AppShell canvas={<div>canvas</div>} />)
  })
  await settle()
  return { setFocusActive: (active) => act(() => setFocusActive(active)) }
}

const handle = () => screen.getByRole('separator', { name: 'Resize the sidebar', hidden: true })
/** The width the shell wrote on <html>; '' — none, so the token of tokens.css (264 px) counts. */
const variable = () => document.documentElement.style.getPropertyValue('--sidebar-width')

const pointer = (type: string, x: number, pressed = type !== 'pointerup'): Event => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: pressed ? 1 : 0, clientX: x, clientY: 300 })
  Object.defineProperty(event, 'pointerId', { value: 1 })
  return event
}

describe('the width of the sidebar', () => {
  it('a fresh user: the default width, from the token, and a focusable separator inside the sidebar', async () => {
    await mount()
    expect(SIDEBAR_WIDTH_DEFAULT).toBe(264)
    expect(variable()).toBe('')
    const edge = handle()
    expect(edge.closest('.w-sidebar')).not.toBeNull()
    expect(edge.tabIndex).toBe(0)
    expect(edge.getAttribute('aria-orientation')).toBe('vertical')
    expect(edge.getAttribute('aria-valuenow')).toBe('264')
    expect(edge.getAttribute('aria-valuemin')).toBe(String(SIDEBAR_WIDTH_MIN))
    expect(edge.getAttribute('aria-valuemax')).toBe(String(SIDEBAR_WIDTH_MAX))
    expect(writes).toEqual([])
  })

  it('a saved width is the width of the sidebar', async () => {
    await mount(400)
    expect(variable()).toBe('400px')
    expect(handle().getAttribute('aria-valuenow')).toBe('400')
  })

  it('a drag follows the pointer off the handle and writes the width once, when the button is let go', async () => {
    await mount()
    act(() => {
      handle().dispatchEvent(pointer('pointerdown', 264))
    })
    act(() => {
      document.body.dispatchEvent(pointer('pointermove', 364))
    })
    expect(variable()).toBe('364px')
    act(() => {
      document.body.dispatchEvent(pointer('pointermove', 404))
    })
    expect(variable()).toBe('404px')
    expect(handle().getAttribute('aria-valuenow')).toBe('404')
    // Nothing is written while the drag goes on.
    expect(writes).toEqual([])
    act(() => {
      document.body.dispatchEvent(pointer('pointerup', 404))
    })
    await settle()
    expect(writes).toEqual([{ sidebar: { width: 404 } }])
    expect(variable()).toBe('404px')
    // After the drag the pointer moves nothing.
    act(() => {
      document.body.dispatchEvent(pointer('pointermove', 500))
    })
    expect(variable()).toBe('404px')
  })

  it('keeps the bounds however far the pointer goes: 220 at the least, 640 at the most', async () => {
    await mount()
    act(() => {
      handle().dispatchEvent(pointer('pointerdown', 264))
      document.body.dispatchEvent(pointer('pointermove', 2000))
    })
    expect(variable()).toBe('640px')
    act(() => {
      document.body.dispatchEvent(pointer('pointermove', -500))
      document.body.dispatchEvent(pointer('pointerup', -500))
    })
    await settle()
    expect(variable()).toBe('220px')
    expect(writes).toEqual([{ sidebar: { width: 220 } }])
  })

  it('Escape during a drag puts the width back where the drag started and writes nothing, not even when the button is let go', async () => {
    await mount(300)
    act(() => {
      handle().dispatchEvent(pointer('pointerdown', 300))
      document.body.dispatchEvent(pointer('pointermove', 450))
    })
    expect(variable()).toBe('450px')
    act(() => {
      fireEvent.keyDown(document.body, { key: 'Escape' })
    })
    expect(variable()).toBe('300px')
    act(() => {
      document.body.dispatchEvent(pointer('pointermove', 500))
      document.body.dispatchEvent(pointer('pointerup', 500))
    })
    await settle()
    expect(variable()).toBe('300px')
    expect(writes).toEqual([])
  })

  it('a cancelled pointer goes back to where the drag started and writes nothing', async () => {
    await mount()
    act(() => {
      handle().dispatchEvent(pointer('pointerdown', 264))
      document.body.dispatchEvent(pointer('pointermove', 400))
      document.body.dispatchEvent(pointer('pointercancel', 400))
    })
    await settle()
    expect(variable()).toBe('')
    expect(writes).toEqual([])
  })

  it('←/→ move it by 16 px, Home and End to the bounds; each key writes', async () => {
    await mount()
    handle().focus()
    fireEvent.keyDown(handle(), { key: 'ArrowRight' })
    await settle()
    expect(variable()).toBe('280px')
    fireEvent.keyDown(handle(), { key: 'ArrowLeft' })
    await settle()
    fireEvent.keyDown(handle(), { key: 'ArrowLeft' })
    await settle()
    expect(variable()).toBe('248px')
    fireEvent.keyDown(handle(), { key: 'Home' })
    await settle()
    expect(variable()).toBe('220px')
    fireEvent.keyDown(handle(), { key: 'End' })
    await settle()
    expect(variable()).toBe('640px')
    // Another key does nothing.
    fireEvent.keyDown(handle(), { key: 'ArrowUp' })
    await settle()
    // Back at the default the field goes, as after a double click.
    expect(writes).toEqual([{ sidebar: { width: 280 } }, { sidebar: { width: null } }, { sidebar: { width: 248 } }, { sidebar: { width: 220 } }, { sidebar: { width: 640 } }])
  })

  it('a double click puts the default width back: the field goes from the settings', async () => {
    await mount(500)
    expect(variable()).toBe('500px')
    fireEvent.doubleClick(handle())
    await settle()
    expect(writes).toEqual([{ sidebar: { width: null } }])
    expect(settings.sidebar).not.toHaveProperty('width')
    expect(variable()).toBe('')
    expect(handle().getAttribute('aria-valuenow')).toBe('264')
  })

  it('a narrower window leaves the Canvas 480 px: the width shown shrinks, the saved one stays and nothing is written', async () => {
    await mount(600)
    expect(variable()).toBe('600px')
    act(() => {
      setWindowWidth(900)
      window.dispatchEvent(new Event('resize'))
    })
    expect(variable()).toBe('420px')
    expect(handle().getAttribute('aria-valuemax')).toBe('420')
    // Never below the default, however narrow the window: before this ticket the sidebar was 264 px at any size.
    act(() => {
      setWindowWidth(600)
      window.dispatchEvent(new Event('resize'))
    })
    expect(variable()).toBe('')
    act(() => {
      setWindowWidth(1400)
      window.dispatchEvent(new Event('resize'))
    })
    expect(variable()).toBe('600px')
    expect(writes).toEqual([])
  })

  it('hidden and shown again — by the button and in focus mode — the sidebar keeps the saved width', async () => {
    const { setFocusActive } = await mount(420)
    fireEvent.click(screen.getByRole('button', { name: 'Hide sidebar' }))
    await settle()
    expect(screen.queryByRole('navigation', { name: 'Sidebar' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show sidebar' }))
    await settle()
    expect(screen.getByRole('navigation', { name: 'Sidebar' })).not.toBeNull()
    expect(variable()).toBe('420px')
    expect(handle().getAttribute('aria-valuenow')).toBe('420')
    // One width for the normal view and focus mode.
    setFocusActive(true)
    expect(variable()).toBe('420px')
    expect(handle().getAttribute('aria-valuenow')).toBe('420')
    setFocusActive(false)
    expect(writes.filter((patch) => patch.sidebar?.width !== undefined)).toEqual([])
  })
})

describe('the bounds of the width against the window', () => {
  it('sidebarWidthMax: 640 at the most, the window less 480 px, never below the default', async () => {
    const { sidebarWidthMax, sidebarWidthIn } = await import('../../src/renderer/shell/sidebar-width')
    expect(sidebarWidthMax(2000)).toBe(640)
    expect(sidebarWidthMax(1000)).toBe(520)
    expect(sidebarWidthMax(1000.7)).toBe(520)
    expect(sidebarWidthMax(700)).toBe(264)
    expect(sidebarWidthIn(600, 1000)).toBe(520)
    expect(sidebarWidthIn(230, 600)).toBe(230)
    expect(sidebarWidthIn(100, 2000)).toBe(220)
    expect(sidebarWidthIn(9000, 2000)).toBe(640)
  })
})
