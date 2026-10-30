// The captions "Model" and "Permissions" of the composer's pickers
// (src/renderer/session/composer/Pickers.tsx): a caption goes when a value of the pickers would be
// cut with it, the model's first. jsdom lays nothing out, so the layout is a stand-in: the bar
// gives the pickers ROOM px, and a value is cut when ROOM is less than the pickers need with the
// captions shown in that layout (NEED). The captions shown are read the way session.css hides
// them: from `data-probe` while the pickers measure, otherwise from the buttons' classes.
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionSettings } from '../../src/shared/agent/settings'
import type { WorfyBridge } from '../../src/shared/ipc/channels'

const DEFAULTS: SessionSettings = { model: null, effort: null, permissionMode: 'bypassPermissions' }
const MODELS = [{ value: null, displayName: 'Default (recommended)', efforts: ['low', 'high'] }]

/** The pickers' full width with both captions, as the "natural" layout gives it. */
const FULL = 568
/** What the pickers need for every value to be whole, by the captions hidden. */
const NEED = { none: FULL, model: 530, both: 460 } as const

let room = FULL
let observed: (() => void)[] = []
/** The frames asked for: the observer's callback measures in the next frame (Pickers.tsx). */
let frames: FrameRequestCallback[] = []
const restore: (() => void)[] = []

/** Replaces a getter of an element prototype for the test. */
function stub<K extends 'clientWidth' | 'scrollWidth'>(name: K, get: (element: HTMLElement) => number): void {
  const before = Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)
  Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get(this: HTMLElement) { return get(this) } })
  restore.push(() => (before === undefined ? delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name] : Object.defineProperty(HTMLElement.prototype, name, before)))
}

/** Which captions the stand-in layout hides now. */
function hidden(pickers: HTMLElement): { model: boolean; permissions: boolean } {
  const probe = pickers.dataset['probe']
  if (probe !== undefined) return { model: probe.split(' ').includes('model'), permissions: probe.split(' ').includes('permissions') }
  const bare = (name: string) => pickers.querySelector(`.w-pickers__select--${name}`)?.classList.contains('w-pickers__select--bare') === true
  return { model: bare('model'), permissions: bare('permissions') }
}

const need = (pickers: HTMLElement): number => {
  const off = hidden(pickers)
  return off.model && off.permissions ? NEED.both : off.model ? NEED.model : off.permissions ? NEED.model : NEED.none
}

beforeEach(() => {
  vi.resetModules()
  room = FULL
  observed = []
  const bridge = {
    invoke: (channel: string, input: unknown) => {
      if (channel === 'agent.controls') return Promise.resolve({ ok: true, value: { settings: DEFAULTS, queue: { items: [], paused: false } } })
      if (channel === 'agent.models') return Promise.resolve({ ok: true, value: { models: MODELS } })
      return Promise.resolve({ ok: true, value: { ...DEFAULTS, ...(input as { change: object }).change } })
    },
    on: () => 1,
    off: () => undefined,
  } as unknown as WorfyBridge
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
  stub('clientWidth', () => 100)
  stub('scrollWidth', (element) => {
    const pickers = element.closest<HTMLElement>('.w-pickers')
    return pickers !== null && element.classList.contains('w-select__value') && room < need(pickers) ? 101 : 100
  })
  const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
  rect.mockImplementation(function (this: HTMLElement) {
    const width = this.classList.contains('w-pickers') && this.dataset['probe'] === 'natural' ? FULL : 0
    return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: 24, width, height: 24, toJSON: () => ({}) } as DOMRect
  })
  const globals = globalThis as { ResizeObserver?: unknown }
  const had = globals.ResizeObserver
  globals.ResizeObserver = class {
    private readonly callback: () => void
    constructor(callback: () => void) {
      this.callback = callback
    }
    observe() {
      observed.push(this.callback)
    }
    disconnect() {
      observed = observed.filter((callback) => callback !== this.callback)
    }
  }
  restore.push(() => {
    globals.ResizeObserver = had
  })
  frames = []
  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => frames.push(callback))
  vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => undefined)
})

afterEach(() => {
  for (const undo of restore.splice(0).reverse()) undo()
  vi.restoreAllMocks()
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

async function mount(): Promise<void> {
  const { default: Pickers } = await import('../../src/renderer/session/composer/Pickers')
  render(<Pickers sessionId="s" busy={false} text="" setText={() => undefined} />)
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** The bar gives the pickers `width` px: what a ResizeObserver reports when the window is resized, then the next frame. */
const resize = (width: number): void => {
  room = width
  act(() => {
    for (const callback of [...new Set(observed)]) callback()
    for (const frame of frames.splice(0)) frame(0)
  })
}

const model = (): HTMLElement => screen.getByTestId('picker-model')
const mode = (): HTMLElement => screen.getByTestId('picker-permissions')
const captions = (): { model: boolean; permissions: boolean } => ({
  model: !model().classList.contains('w-pickers__select--bare'),
  permissions: !mode().classList.contains('w-pickers__select--bare'),
})

describe('the captions of the model and permission pickers', () => {
  it('both show while every value fits with them', async () => {
    await mount()
    expect(captions()).toEqual({ model: true, permissions: true })
    expect(screen.getByTestId('pickers').style.getPropertyValue('--w-pickers-width')).toBe(`${FULL}px`)
  })

  it("the model's goes first; the permission mode's goes too when a value is still cut", async () => {
    await mount()
    resize(NEED.none - 1)
    expect(captions()).toEqual({ model: false, permissions: true })
    resize(NEED.model)
    expect(captions()).toEqual({ model: false, permissions: true })
    resize(NEED.model - 1)
    expect(captions()).toEqual({ model: false, permissions: false })
    // Too narrow for the values even without captions: none comes back.
    resize(100)
    expect(captions()).toEqual({ model: false, permissions: false })
    resize(NEED.none)
    expect(captions()).toEqual({ model: true, permissions: true })
  })

  it('are decided by the room the pickers are given, not by the room a hidden caption frees: a second look changes nothing', async () => {
    await mount()
    for (const width of [NEED.none - 1, NEED.model - 1]) {
      resize(width)
      const first = captions()
      for (let look = 0; look < 3; look += 1) {
        resize(width)
        expect(captions(), `${width} px, look ${look + 2}`).toEqual(first)
      }
    }
  })

  it('keep the accessible names and the titles of the buttons', async () => {
    await mount()
    for (const width of [FULL, NEED.none - 1, NEED.model - 1]) {
      resize(width)
      expect(model().getAttribute('aria-label')).toBe('Model')
      expect(model().title).toBe('Default (recommended)')
      expect(mode().getAttribute('aria-label')).toBe('Permission mode')
      expect(mode().title).toBe('Bypass permissions')
      expect(model().textContent).toBe('ModelDefault (recommended)')
    }
  })
})
