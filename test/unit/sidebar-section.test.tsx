// The frame of a sidebar section (src/renderer/shell/SidebarSection.tsx): its heading is a button
// that collapses and expands the section, and the choice is kept in the app settings
// (`sidebar.collapsed.<section id>`), so it outlives the window. jsdom lays nothing out: the
// heights of the lists are checked against the built app (test/e2e/sidebar-sections.spec.ts), and
// so are Enter and Space on the heading — a browser, not jsdom, turns them into a click of a button.
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcResult, WorfyBridge } from '../../src/shared/ipc/channels'
import type { AppSettings } from '../../src/shared/settings/app-settings'
import type { SidebarSectionProps } from '../../src/renderer/shell/SidebarSection'

const settings = (revision: number, collapsed: Record<string, boolean> = {}): AppSettings => ({
  interfaceScale: 1,
  sidebar: { collapsed, visible: { normal: true, focus: true } },
  revision,
})

interface FakeMain {
  /** Every `appSettings.set` the window made, oldest first, with the way to answer it. */
  sets: { input: unknown; answer: (result: IpcResult<AppSettings>) => void }[]
  /** Answers the pending `appSettings.get`. */
  answerGet: (state: AppSettings) => void
  /** Fires `appSettings.changed`, as a change made in another window does. */
  changed: (state: AppSettings) => void
}

let main: FakeMain

beforeEach(() => {
  // useAppSettings keeps the settings in a module: every test starts with a fresh one.
  vi.resetModules()
  const handlers = new Map<string, (payload: unknown) => void>()
  let answerGet: (state: AppSettings) => void = () => undefined
  const fake: FakeMain = { sets: [], answerGet: (state) => answerGet(state), changed: (state) => handlers.get('appSettings.changed')?.(state) }
  const bridge: WorfyBridge = {
    invoke: (channel, input) => {
      if (channel === 'appSettings.get') return new Promise((resolve) => (answerGet = (value) => resolve({ ok: true, value })))
      if (channel === 'appSettings.set') return new Promise((resolve) => fake.sets.push({ input, answer: resolve }))
      return Promise.resolve({ ok: false, error: `unexpected channel ${channel}` })
    },
    on: (channel, handler) => {
      handlers.set(channel, handler)
      return handlers.size
    },
    off: () => undefined,
  }
  main = fake
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
})

afterEach(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
  vi.restoreAllMocks()
})

async function mount(props: Partial<SidebarSectionProps> = {}, children: ReactNode = <button type="button">a row</button>) {
  const { SidebarSection } = await import('../../src/renderer/shell/SidebarSection')
  return render(
    <SidebarSection id="DemoSection" title="Demo" {...props}>
      {children}
    </SidebarSection>,
  )
}

const region = () => screen.getByRole('region', { name: 'Demo' })
// `hidden: true`: the heading button of a collapsed section stays; so does everything the test asks about a hidden body.
const heading = () => within(region()).getByRole('button', { name: 'Demo', hidden: true })
const body = () => {
  const element = document.getElementById(heading().getAttribute('aria-controls') ?? '')
  if (element === null) throw new Error('aria-controls of the heading names no element')
  return element
}
const collapsed = () => heading().getAttribute('aria-expanded') === 'false'

/** Answers the oldest unanswered `appSettings.set` the way main does: the settings after the change. */
async function answerSet(index: number, revision: number, state: Record<string, boolean>): Promise<void> {
  await act(async () => main.sets[index]!.answer({ ok: true, value: settings(revision, state) }))
}

describe('SidebarSection', () => {
  it('a click on the heading collapses the section, another expands it; aria-expanded follows and the body stays in the DOM, hidden', async () => {
    await mount()
    expect(heading().tagName).toBe('BUTTON')
    expect(heading().getAttribute('type')).toBe('button')
    expect(heading().getAttribute('aria-expanded')).toBe('true')
    expect(body().hidden).toBe(false)
    expect(region().getAttribute('data-collapsed')).toBeNull()

    fireEvent.click(heading())
    expect(heading().getAttribute('aria-expanded')).toBe('false')
    expect(body().hidden).toBe(true)
    expect(region().getAttribute('data-collapsed')).toBe('true')
    // Still in the DOM: tests and the palette read the rows of a collapsed section.
    expect(within(body()).getByText('a row')).toBeTruthy()

    fireEvent.click(heading())
    expect(heading().getAttribute('aria-expanded')).toBe('true')
    expect(body().hidden).toBe(false)
  })

  it('the chevron of the heading points down while the section is expanded and right while it is collapsed', async () => {
    await mount()
    const path = () => heading().querySelector('svg[aria-hidden="true"] path')?.getAttribute('d')
    // In a 16×16 box: from (4,6) down to (8,10) and up to (12,6) — a "v".
    expect(path()).toBe('M4 6l4 4 4-4')
    fireEvent.click(heading())
    // From (6,4) right to (10,8) and back to (6,12) — a ">".
    expect(path()).toBe('M6 4l4 4-4 4')
    // The chevron is not part of the name.
    expect(heading().textContent).toBe('Demo')
  })

  it('the heading is a heading of level 2 and names the region; the body is what the button controls', async () => {
    await mount()
    expect(within(region()).getByRole('heading', { level: 2, name: 'Demo' })).toBeTruthy()
    expect(region().tagName).toBe('SECTION')
    expect(body().contains(screen.getByText('a row'))).toBe(true)
    expect(region().contains(body())).toBe(true)
  })

  it('a click writes sidebar.collapsed.<id> through appSettings.set, true then false', async () => {
    await mount()
    fireEvent.click(heading())
    expect(main.sets.map((set) => set.input)).toStrictEqual([{ sidebar: { collapsed: { DemoSection: true } } }])
    await answerSet(0, 1, { DemoSection: true })
    expect(collapsed()).toBe(true)

    fireEvent.click(heading())
    expect(main.sets[1]!.input).toStrictEqual({ sidebar: { collapsed: { DemoSection: false } } })
    await answerSet(1, 2, { DemoSection: false })
    expect(collapsed()).toBe(false)
  })

  it("a button of the section's own, beside the heading or at the right edge, does not collapse it", async () => {
    const onAdd = vi.fn()
    await mount({ meta: <button type="button">3 live</button>, trailing: <button type="button" onClick={onAdd}>Add</button> })
    fireEvent.click(within(region()).getByRole('button', { name: 'Add' }))
    fireEvent.click(within(region()).getByRole('button', { name: '3 live' }))
    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(collapsed()).toBe(false)
    expect(main.sets).toHaveLength(0)
  })

  it('with no key in the settings the section is as defaultCollapsed says: expanded unless told otherwise', async () => {
    await mount()
    expect(collapsed()).toBe(false)
    await act(async () => main.answerGet(settings(1, { OtherSection: true })))
    expect(collapsed()).toBe(false)
  })

  it('defaultCollapsed collapses a section that has no key, and a key of the settings wins over it', async () => {
    await mount({ defaultCollapsed: true })
    expect(collapsed()).toBe(true)
    expect(body().hidden).toBe(true)
    await act(async () => main.answerGet(settings(1, { DemoSection: false })))
    expect(collapsed()).toBe(false)
    // The first click of a section collapsed by default expands it.
    await act(async () => main.changed(settings(2, {})))
    expect(collapsed()).toBe(true)
    fireEvent.click(heading())
    expect(main.sets[0]!.input).toStrictEqual({ sidebar: { collapsed: { DemoSection: false } } })
  })

  it('follows the settings: collapsed at launch from the saved key, and when another window collapses or expands it', async () => {
    await mount()
    await act(async () => main.answerGet(settings(3, { DemoSection: true })))
    expect(collapsed()).toBe(true)
    await act(async () => main.changed(settings(4, { DemoSection: false })))
    expect(collapsed()).toBe(false)
    await act(async () => main.changed(settings(5, { DemoSection: true })))
    expect(collapsed()).toBe(true)
    expect(main.sets).toHaveLength(0)
  })

  it('stays as clicked in this window when main refuses to save, and says so in the console', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await mount()
    fireEvent.click(heading())
    await act(async () => main.sets[0]!.answer({ ok: false, error: 'EACCES: app-settings.json' }))
    expect(collapsed()).toBe(true)
    expect(logged).toHaveBeenCalledTimes(1)
    expect(String(logged.mock.calls[0]?.[0])).toContain('Demo')
    expect(logged.mock.calls[0]?.[1]).toBe('EACCES: app-settings.json')
    // The next click still works, from what the window shows.
    fireEvent.click(heading())
    expect(collapsed()).toBe(false)
    expect(main.sets[1]!.input).toStrictEqual({ sidebar: { collapsed: { DemoSection: false } } })
  })

  it('two quick clicks end expanded: the answer to the first one does not collapse the section for a moment', async () => {
    await mount()
    fireEvent.click(heading())
    fireEvent.click(heading())
    expect(main.sets.map((set) => set.input)).toStrictEqual([{ sidebar: { collapsed: { DemoSection: true } } }, { sidebar: { collapsed: { DemoSection: false } } }])
    expect(collapsed()).toBe(false)
    await answerSet(0, 1, { DemoSection: true })
    expect(collapsed()).toBe(false)
    await answerSet(1, 2, { DemoSection: false })
    expect(collapsed()).toBe(false)
    // Saved, so the window follows the settings again.
    await act(async () => main.changed(settings(3, { DemoSection: true })))
    expect(collapsed()).toBe(true)
  })

  it('a notice and an overlay are outside the body: a collapsed section still shows them', async () => {
    await mount({ defaultCollapsed: true, notice: <p role="alert">could not add</p>, overlay: <div role="dialog" aria-label="History" /> })
    expect(body().hidden).toBe(true)
    const alert = within(region()).getByRole('alert')
    const dialog = within(region()).getByRole('dialog', { name: 'History' })
    expect(body().contains(alert)).toBe(false)
    expect(body().contains(dialog)).toBe(false)
    expect(alert.closest('[hidden]')).toBeNull()
    expect(dialog.closest('[hidden]')).toBeNull()
  })

  it('rowHeight sets the row of the section for the height rules; without it the section keeps the common row', async () => {
    const first = await mount({ rowHeight: 48 })
    expect(region().style.getPropertyValue('--w-section-row')).toBe('48px')
    first.unmount()
    await mount()
    expect(region().style.getPropertyValue('--w-section-row')).toBe('')
  })

  it('carries its id and a test id for the tests of the built app', async () => {
    await mount({ testId: 'demo-section' })
    expect(region().getAttribute('data-section-id')).toBe('DemoSection')
    expect(screen.getByTestId('demo-section')).toBe(region())
  })
})
