// The interface scale in the renderer (worfy-ui ticket 3):
// - focus mode swallows the zoom keys of the Canvas, but not with Alt: those are the scale items of
//   the View menu (src/renderer/focus/FocusMode.tsx);
// - the slider of Settings → General changes only its value while it is dragged and calls
//   `appSettings.set` when the browser reports `change` (src/renderer/settings/GeneralSection.tsx);
// - the shell writes `--interface-scale` and `--toolbar-height` on <html>
//   (src/renderer/settings/interface-scale.ts, src/renderer/shell/AppShell.tsx).
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasFlowNode } from '../../src/renderer/canvas/nodes/index'
import { FocusMode } from '../../src/renderer/focus/FocusMode'
import { buildPreset } from '../../src/renderer/focus/split-tree'
import { applyInterfaceScale, clearInterfaceScale, formatScale, scaleToPercent, useInterfaceScale } from '../../src/renderer/settings/interface-scale'
import { acceptAppSettings } from '../../src/renderer/settings/useAppSettings'
import { AppShell } from '../../src/renderer/shell/AppShell'
import type { IpcResult, WorfyBridge } from '../../src/shared/ipc/channels'
import type { AppSettings } from '../../src/shared/settings/app-settings'

const settings = (revision: number, interfaceScale: number): AppSettings => ({
  interfaceScale,
  sidebar: { collapsed: {}, visible: { normal: true, focus: true } },
  autoCompactWindow: { orchestrator: 400_000, other: 500_000 },
  revision,
})

describe('focus mode and the zoom keys', () => {
  const flowNode = (id: string): CanvasFlowNode => ({
    id,
    position: { x: 0, y: 0 },
    // A kind no file declares: the tile draws the placeholder, which needs no Layout operations.
    data: { node: { id, kind: 'zz-focus-test', x: 0, y: 0, w: 100, h: 100, hidden: false, locked: false, pinned: false, tags: [], data: { title: id.toUpperCase() } } },
  })

  function open(): void {
    const tree = buildPreset('columns', ['a'])
    if (tree === null) throw new Error('no tree')
    render(
      <ReactFlowProvider initialNodes={[flowNode('a')]}>
        <FocusMode tree={tree} onChange={() => undefined} onExit={() => undefined} />
      </ReactFlowProvider>,
    )
  }

  /**
   * Presses a key inside the focus layer. `reached` — a listener on window after the layer's own,
   * where the Canvas listens, heard it; `prevented` — the page gave up the key's default action.
   */
  function press(init: KeyboardEventInit): { reached: boolean; prevented: boolean } {
    let reached = false
    const canvas = (): void => {
      reached = true
    }
    window.addEventListener('keydown', canvas)
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    screen.getByTestId('focus-mode').dispatchEvent(event)
    window.removeEventListener('keydown', canvas)
    return { reached, prevented: event.defaultPrevented }
  }

  const swallowed = { reached: false, prevented: true }
  const passed = { reached: true, prevented: false }

  it.each(['=', '+', '-', '_', '0'])('on macOS swallows ⌘%s, and lets it through with ⌥', (key) => {
    open()
    expect(press({ key, metaKey: true })).toEqual(swallowed)
    expect(press({ key, metaKey: true, altKey: true })).toEqual(passed)
  })

  it.each(['=', '+', '-', '_', '0'])('on Windows swallows Ctrl+%s, and lets Ctrl+Alt+%s through to the menu', (key) => {
    document.documentElement.dataset.platform = 'windows'
    open()
    expect(press({ key, ctrlKey: true })).toEqual(swallowed)
    expect(press({ key, ctrlKey: true, altKey: true })).toEqual(passed)
  })

  it('lets a key through that is no zoom key, with or without Alt', () => {
    open()
    expect(press({ key: 'k', metaKey: true })).toEqual(passed)
    expect(press({ key: '=', altKey: true })).toEqual(passed)
    expect(press({ key: '=' })).toEqual(passed)
  })
})

describe('the Interface scale slider of Settings → General', () => {
  interface FakeBridge {
    /** The inputs of every `appSettings.set` call. */
    sets: unknown[]
    /** What `appSettings.set` answers; by default the settings with the scale asked for. */
    onSet: (input: { interfaceScale?: number }) => Promise<IpcResult<unknown>>
    /** Answers the pending `appSettings.get`. */
    answerGet: (state: AppSettings) => void
    /** Fires `appSettings.changed`. */
    changed: (state: AppSettings) => void
  }

  let fake: FakeBridge

  beforeEach(() => {
    // A fresh useAppSettings: it subscribes to the bridge once per module.
    vi.resetModules()
    const handlers = new Map<string, (payload: unknown) => void>()
    let answerGet: (state: AppSettings) => void = () => undefined
    let revision = 1
    const current: FakeBridge = {
      sets: [],
      onSet: (input) => Promise.resolve({ ok: true, value: settings(++revision, input.interfaceScale ?? 1) }),
      answerGet: (state) => answerGet(state),
      changed: (state) => handlers.get('appSettings.changed')?.(state),
    }
    const bridge: WorfyBridge = {
      invoke: (channel, input) => {
        if (channel === 'appSettings.get') return new Promise((resolve) => (answerGet = (value) => resolve({ ok: true, value })))
        if (channel === 'appSettings.set') {
          current.sets.push(input)
          return current.onSet(input as { interfaceScale?: number })
        }
        return Promise.resolve({ ok: true, value: { version: '9.9.9' } })
      },
      on: (channel, handler) => {
        handlers.set(channel, handler)
        return handlers.size
      },
      off: () => undefined,
    }
    fake = current
    ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
  })

  afterEach(() => {
    delete (globalThis as { worfy?: WorfyBridge }).worfy
  })

  /** Settings → General over settings with `scale`. */
  async function mount(scale = 1): Promise<{ slider: HTMLInputElement; value: HTMLElement }> {
    const { default: GeneralSection } = await import('../../src/renderer/settings/GeneralSection')
    render(<GeneralSection />)
    await act(async () => fake.answerGet(settings(1, scale)))
    return { slider: screen.getByTestId<HTMLInputElement>('settings-interface-scale'), value: screen.getByTestId('settings-interface-scale-value') }
  }

  /** The thumb moves to `percent`: the browser's `input` event. */
  const drag = (slider: HTMLInputElement, percent: number): boolean => fireEvent.input(slider, { target: { value: String(percent) } })
  /** The thumb is let go on `percent`, or a key made the step: the browser's `change` event. */
  const release = (slider: HTMLInputElement, percent: number): boolean => fireEvent.change(slider, { target: { value: String(percent) } })

  it('is a range of 80–150 by 10 that shows the scale of the settings, with its value in percent', async () => {
    const { slider, value } = await mount(1.2)
    expect(slider.type).toBe('range')
    expect([slider.min, slider.max, slider.step]).toEqual(['80', '150', '10'])
    expect(slider.value).toBe('120')
    expect(value.textContent).toBe('120 %')
    expect(slider.getAttribute('aria-valuetext')).toBe('120 %')
    expect(screen.getByRole('slider', { name: 'Interface scale' })).toBe(slider)
  })

  it('an input event changes only the value shown; the change event calls appSettings.set once', async () => {
    const { slider, value } = await mount()
    drag(slider, 130)
    expect(value.textContent).toBe('130 %')
    drag(slider, 140)
    expect(value.textContent).toBe('140 %')
    expect(slider.value).toBe('140')
    // Dragging asked main for nothing.
    expect(fake.sets).toEqual([])

    await act(async () => void release(slider, 140))
    expect(fake.sets).toEqual([{ interfaceScale: 1.4 }])
    expect(value.textContent).toBe('140 %')
    expect(slider.value).toBe('140')
  })

  it('a step made with a key, an input and a change at once, sets the scale once', async () => {
    const { slider } = await mount()
    await act(async () => {
      drag(slider, 110)
      release(slider, 110)
    })
    expect(fake.sets).toEqual([{ interfaceScale: 1.1 }])
  })

  it('a scale changed elsewhere (the View menu) moves the thumb', async () => {
    const { slider, value } = await mount()
    await act(async () => fake.changed(settings(7, 0.8)))
    expect(slider.value).toBe('80')
    expect(value.textContent).toBe('80 %')
  })

  it('a thumb taken further while main answers stays where it is', async () => {
    const { slider, value } = await mount()
    let answer: (result: IpcResult<unknown>) => void = () => undefined
    fake.onSet = () => new Promise((resolve) => (answer = resolve))
    drag(slider, 120)
    release(slider, 120)
    drag(slider, 140)
    await act(async () => answer({ ok: true, value: settings(2, 1.2) }))
    // The answer of the first release does not pull the thumb back to 120.
    expect(value.textContent).toBe('140 %')
    expect(slider.value).toBe('140')

    release(slider, 140)
    await act(async () => answer({ ok: true, value: settings(3, 1.4) }))
    expect(fake.sets).toEqual([{ interfaceScale: 1.2 }, { interfaceScale: 1.4 }])
    expect(value.textContent).toBe('140 %')
  })

  it('a change main refuses goes back to the scale in force and says why, until a change is saved', async () => {
    const { slider, value } = await mount()
    fake.onSet = () => Promise.resolve({ ok: false, error: 'EACCES: permission denied' })
    drag(slider, 130)
    await act(async () => void release(slider, 130))
    expect(value.textContent).toBe('100 %')
    expect(slider.value).toBe('100')
    expect(screen.getByRole('alert').textContent).toContain('EACCES: permission denied')

    fake.onSet = (input) => Promise.resolve({ ok: true, value: settings(5, input.interfaceScale ?? 1) })
    drag(slider, 90)
    await act(async () => void release(slider, 90))
    expect(value.textContent).toBe('90 %')
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('the scale on <html>', () => {
  const root = document.documentElement
  const variables = (): { scale: string; toolbar: string } => ({
    scale: root.style.getPropertyValue('--interface-scale'),
    toolbar: root.style.getPropertyValue('--toolbar-height'),
  })
  // The settings of the statically imported useAppSettings outlive a test: each one starts at 100 %.
  let revision = 100
  const scaleIs = (interfaceScale: number): void => act(() => acceptAppSettings(settings(++revision, interfaceScale)))

  beforeEach(() => scaleIs(1))
  afterEach(() => clearInterfaceScale())

  it('counts in whole percent', () => {
    expect([0.8, 1, 1.1, 1.5].map(scaleToPercent)).toEqual([80, 100, 110, 150])
    // 1.1 * 100 is 110.00000000000001 and 0.7 * 100 is 70.00000000000001 in binary.
    expect(scaleToPercent(0.7)).toBe(70)
    expect([0.8, 1.2].map(formatScale)).toEqual(['80 %', '120 %'])
  })

  it('applyInterfaceScale writes --interface-scale and a toolbar of 52 px of the window; clearInterfaceScale takes both off', () => {
    applyInterfaceScale(1.5)
    expect(variables()).toEqual({ scale: '1.5', toolbar: 'calc(52px / 1.5)' })
    applyInterfaceScale(0.8)
    expect(variables()).toEqual({ scale: '0.8', toolbar: 'calc(52px / 0.8)' })
    clearInterfaceScale()
    expect(variables()).toEqual({ scale: '', toolbar: '' })
  })

  it('useInterfaceScale follows the app settings and cleans up when its component goes', () => {
    const hook = renderHook(() => useInterfaceScale())
    expect(variables()).toEqual({ scale: '1', toolbar: 'calc(52px / 1)' })
    scaleIs(1.5)
    expect(variables()).toEqual({ scale: '1.5', toolbar: 'calc(52px / 1.5)' })
    scaleIs(0.8)
    expect(variables()).toEqual({ scale: '0.8', toolbar: 'calc(52px / 0.8)' })
    hook.unmount()
    expect(variables()).toEqual({ scale: '', toolbar: '' })
  })

  it('the window shell keeps both variables on <html>', () => {
    scaleIs(1.3)
    render(<AppShell />)
    expect(variables()).toEqual({ scale: '1.3', toolbar: 'calc(52px / 1.3)' })
    scaleIs(0.9)
    expect(variables()).toEqual({ scale: '0.9', toolbar: 'calc(52px / 0.9)' })
  })
})
