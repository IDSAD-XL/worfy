// The live diagrams of the worfy Guide (src/renderer/guide/scene/, worfy-guide ticket 04, ADR-0090
// point 9) in the DOM: a block lights its Edges and neighbours under the pointer and under the
// keyboard focus, a block with a Topic opens it, the step player lights a step and plays the steps,
// and a screen reader reads every Edge. Then the motion of the dots, with a hand-driven frame clock,
// IntersectionObserver, page visibility and Reduce motion all faked: the dots move only while the
// diagram is in view, the page is visible and Reduce motion is off; under Reduce motion they stand
// still at (i + 0.5) / n; once the diagram leaves the page no frame is left asking.
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GUIDE_STRINGS } from '../../src/renderer/guide/content'
import { LivingScene } from '../../src/renderer/guide/scene/LivingScene'
import { STEP_SECONDS, type SceneSpec } from '../../src/renderer/guide/scene/model'
import { useGuide } from '../../src/renderer/guide/store'

const strings = GUIDE_STRINGS.en

const SPEC: SceneSpec = {
  width: 800,
  height: 300,
  blocks: [
    { id: 'menu', x: 0, y: 0, group: 'workflow' },
    { id: 'palette', x: 0, y: 200, group: 'agents' },
    { id: 'guide', x: 300, y: 100, group: 'harness', topic: 'skeleton' },
    { id: 'topics', x: 600, y: 100, group: 'tools' },
  ],
  edges: [
    { from: 'menu', to: 'guide', label: 'opens' },
    { from: 'palette', to: 'guide', label: 'opens' },
    { from: 'guide', to: 'topics', label: 'reads' },
  ],
  steps: [
    { caption: 'step1', blocks: ['menu', 'guide'] },
    { caption: 'step2', blocks: ['palette', 'guide'] },
    { caption: 'step3', blocks: ['guide', 'topics'] },
  ],
}

const LABELS = {
  menu: 'Help menu',
  menuNote: 'worfy Guide',
  palette: 'Command palette',
  paletteNote: 'a row per Topic',
  guide: 'Guide',
  guideNote: 'Topics in EN and RU',
  topics: 'Topic folder',
  topicsNote: 'texts and a diagram',
  opens: 'opens',
  reads: 'reads',
  step1: 'The menu opens the Guide.',
  step2: 'The palette opens it at a Topic.',
  step3: 'The Guide reads the Topic folder.',
}

// The frame clock, the observer of the view, page visibility and Reduce motion, all by hand.
let frames: Map<number, FrameRequestCallback>
let nextFrame: number
let observers: { callback: IntersectionObserverCallback; disconnected: boolean }[]
let reduced: { matches: boolean; listeners: Set<(event: { matches: boolean }) => void> }
let visibility: DocumentVisibilityState

function runFrame(time: number): void {
  const due = [...frames.values()]
  frames.clear()
  act(() => {
    for (const callback of due) callback(time)
  })
}

function intersect(isIntersecting: boolean): void {
  act(() => {
    for (const observer of observers.filter((each) => !each.disconnected)) {
      observer.callback([{ isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver)
    }
  })
}

function setVisibility(state: DocumentVisibilityState): void {
  visibility = state
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

function setReduced(matches: boolean): void {
  reduced.matches = matches
  act(() => {
    for (const listener of reduced.listeners) listener({ matches })
  })
}

const svgPrototype = SVGElement.prototype as unknown as Record<string, unknown>

beforeEach(() => {
  frames = new Map()
  nextFrame = 1
  observers = []
  reduced = { matches: false, listeners: new Set() }
  visibility = 'visible'
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextFrame++
    frames.set(id, callback)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      private readonly entry: { callback: IntersectionObserverCallback; disconnected: boolean }
      constructor(callback: IntersectionObserverCallback) {
        this.entry = { callback, disconnected: false }
        observers.push(this.entry)
      }
      observe(): void {}
      disconnect(): void {
        this.entry.disconnected = true
      }
    },
  )
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return query === '(prefers-reduced-motion: reduce)' && reduced.matches
    },
    addEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => reduced.listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => reduced.listeners.delete(listener),
  }))
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  // jsdom has no geometry: every Edge is 110 units long and runs along the x axis.
  svgPrototype.getTotalLength = () => 110
  svgPrototype.getPointAtLength = (distance: number) => ({ x: distance, y: 0 })
  useGuide.setState({ open: true, topic: null })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  delete (document as unknown as Record<string, unknown>).visibilityState
  delete svgPrototype.getTotalLength
  delete svgPrototype.getPointAtLength
  useGuide.setState({ open: false, topic: null })
})

const scene = () => screen.getByTestId('guide-scene')
const blockOf = (name: string) => screen.getByLabelText(new RegExp(`^${name}:`))
const edge = (id: string) => scene().querySelector(`[data-edge="${id}"]`)!
const label = (id: string) => scene().querySelector(`[data-edge-label="${id}"]`)!
const dotsOf = (id: string) => [...scene().querySelectorAll(`[data-dot-edge="${id}"]`)]
const xOf = (dot: Element) => Number(/translate\(([-\d.]+)/.exec(dot.getAttribute('transform') ?? '')?.[1])
const hot = (element: Element) => element.classList.contains('is-hot')
const near = (element: Element) => element.classList.contains('is-near')

function renderScene(spec: SceneSpec = SPEC) {
  return render(<LivingScene spec={spec} labels={LABELS} strings={strings} />)
}

describe('the diagram', () => {
  it('draws every block with its title and note, every Edge with its arrowhead and two dots', () => {
    renderScene()
    expect(blockOf('Help menu').getAttribute('aria-label')).toBe('Help menu: worfy Guide')
    expect(within(blockOf('Guide')).getByText('Guide')).toBeTruthy()
    for (const id of ['menu->guide', 'palette->guide', 'guide->topics']) {
      expect(edge(id).getAttribute('d')).toMatch(/^M [\d.]+ [\d.]+ C /)
      expect(scene().querySelector(`[data-arrow-edge="${id}"]`)).not.toBeNull()
      expect(dotsOf(id)).toHaveLength(2)
    }
  })

  it('a screen reader reads every Edge as "A → B: label"', () => {
    renderScene()
    const list = document.getElementById(scene().getAttribute('aria-describedby')!)!
    expect([...list.querySelectorAll('li')].map((item) => item.textContent)).toEqual([
      'Help menu → Guide: opens',
      'Command palette → Guide: opens',
      'Guide → Topic folder: reads',
    ])
    expect(scene().getAttribute('role')).toBe('group')
  })

  it('nothing is lit at first, and no Edge shows its label', () => {
    renderScene()
    expect(scene().classList.contains('is-focusing')).toBe(false)
    expect(scene().querySelectorAll('.is-hot, .is-near')).toHaveLength(0)
  })

  it('the pointer on a block lights it, its neighbours, its Edges, their dots and labels; leaving it lights nothing', () => {
    renderScene()
    fireEvent.mouseEnter(blockOf('Topic folder'))
    expect(scene().classList.contains('is-focusing')).toBe(true)
    expect(hot(blockOf('Topic folder'))).toBe(true)
    expect(near(blockOf('Guide'))).toBe(true)
    expect(near(blockOf('Help menu')) || hot(blockOf('Help menu'))).toBe(false)
    expect(hot(edge('guide->topics'))).toBe(true)
    expect(hot(label('guide->topics'))).toBe(true)
    expect(dotsOf('guide->topics').every(hot)).toBe(true)
    expect(hot(scene().querySelector('[data-arrow-edge="guide->topics"]')!)).toBe(true)
    expect(hot(edge('menu->guide'))).toBe(false)
    expect(hot(label('menu->guide'))).toBe(false)
    fireEvent.mouseLeave(blockOf('Topic folder'))
    expect(scene().classList.contains('is-focusing')).toBe(false)
    expect(scene().querySelectorAll('.is-hot, .is-near')).toHaveLength(0)
  })

  it('the keyboard focus on a block lights the same as the pointer', () => {
    renderScene()
    act(() => blockOf('Help menu').focus())
    expect(hot(blockOf('Help menu'))).toBe(true)
    expect(near(blockOf('Guide'))).toBe(true)
    expect(hot(edge('menu->guide'))).toBe(true)
    act(() => blockOf('Help menu').blur())
    expect(scene().classList.contains('is-focusing')).toBe(false)
  })

  it('a block with a Topic is a link that opens it, by click and by Enter; a block without one is not', () => {
    renderScene()
    const guideBlock = blockOf('Guide')
    expect(guideBlock.getAttribute('role')).toBe('link')
    fireEvent.click(guideBlock)
    expect(useGuide.getState().topic).toBe('skeleton')
    useGuide.setState({ topic: null })
    fireEvent.keyDown(guideBlock, { key: 'Enter' })
    expect(useGuide.getState().topic).toBe('skeleton')

    useGuide.setState({ topic: null })
    const menuBlock = blockOf('Help menu')
    expect(menuBlock.getAttribute('role')).toBe('img')
    expect(menuBlock.getAttribute('tabindex')).toBe('0')
    fireEvent.click(menuBlock)
    fireEvent.keyDown(menuBlock, { key: 'Enter' })
    expect(useGuide.getState().topic).toBeNull()
  })
})

describe('frames, tabs, chips and areas (worfy-guide ticket 05)', () => {
  const FRAMED: SceneSpec = {
    width: 800,
    height: 400,
    regions: [{ label: 'outside', x: 10, y: 20 }],
    frames: [{ block: 'board', kind: 'canvas', x: 200, y: 40, width: 560, height: 340 }],
    blocks: [
      { id: 'menu', x: 10, y: 40, group: 'workflow' },
      { id: 'board', x: 216, y: 24, group: 'project', shape: 'tab', width: 90 },
      { id: 'guide', x: 240, y: 120, group: 'harness' },
      { id: 'topics', x: 500, y: 120, group: 'tools', shape: 'chip', width: 120 },
    ],
    edges: [
      { from: 'menu', to: 'board', label: 'opens' },
      { from: 'guide', to: 'topics', label: 'reads' },
    ],
  }
  const FRAMED_LABELS = { ...LABELS, outside: 'OUTSIDE', board: 'Board', boardNote: 'a plane' }
  const renderFramed = () => render(<LivingScene spec={FRAMED} labels={FRAMED_LABELS} strings={strings} />)
  const frameOf = (id: string) => scene().querySelector(`[data-frame="${id}"]`)!

  it('a diagram with a Canvas frame draws no Canvas field behind the whole of it, and names its areas', () => {
    renderFramed()
    expect(scene().querySelector('.w-guide-scene__canvas')).toBeNull()
    expect(frameOf('board').classList.contains('is-canvas')).toBe(true)
    expect(scene().querySelector('[data-region="outside"]')?.textContent).toBe('OUTSIDE')
    renderScene()
    expect(document.querySelectorAll('.w-guide-scene__canvas')).toHaveLength(1)
  })

  it('a tab is the block of its frame: the frame lights with it, and fades when another block is lit', () => {
    renderFramed()
    expect(blockOf('Board').getAttribute('aria-label')).toBe('Board: a plane')
    expect(blockOf('Board').classList.contains('is-tab')).toBe(true)
    fireEvent.mouseEnter(blockOf('Board'))
    expect(hot(frameOf('board'))).toBe(true)
    expect(hot(edge('menu->board'))).toBe(true)
    fireEvent.mouseLeave(blockOf('Board'))
    fireEvent.mouseEnter(blockOf('Help menu'))
    expect(near(frameOf('board'))).toBe(true)
    fireEvent.mouseLeave(blockOf('Help menu'))
    fireEvent.mouseEnter(blockOf('Guide'))
    expect(hot(frameOf('board')) || near(frameOf('board'))).toBe(false)
  })

  it('a chip is a dashed pill with its title; its note is read by a screen reader', () => {
    renderFramed()
    const chip = blockOf('Topic folder')
    expect(chip.classList.contains('is-chip')).toBe(true)
    expect(chip.querySelector('.w-guide-scene__chip')?.getAttribute('width')).toBe('120')
    expect(within(chip).getByText('Topic folder')).toBeTruthy()
    expect(within(chip).queryByText('texts and a diagram')).toBeNull()
  })
})

describe('the step player', () => {
  const steps = () => screen.getByRole('group', { name: strings.steps })
  const stepButton = (n: number) => within(steps()).getByRole('button', { name: `${strings.step} ${n}` })
  const caption = () => screen.getByTestId('guide-scene-caption')

  it('a step lights its blocks and Edges and says what happens; choosing it again shows the whole diagram', () => {
    renderScene()
    fireEvent.click(stepButton(2))
    expect(stepButton(2).getAttribute('aria-pressed')).toBe('true')
    expect(stepButton(1).getAttribute('aria-pressed')).toBe('false')
    expect(hot(blockOf('Command palette'))).toBe(true)
    expect(hot(blockOf('Guide'))).toBe(true)
    expect(hot(blockOf('Help menu'))).toBe(false)
    expect(hot(edge('palette->guide'))).toBe(true)
    expect(hot(edge('menu->guide'))).toBe(false)
    expect(caption().textContent).toBe(LABELS.step2)
    expect(caption().getAttribute('aria-live')).toBe('polite')
    fireEvent.click(stepButton(2))
    expect(scene().classList.contains('is-focusing')).toBe(false)
    expect(caption().textContent).toBe('')
  })

  it('Play goes through the steps, one every STEP_SECONDS, and stops on the last; Pause holds the step', () => {
    vi.useFakeTimers()
    renderScene()
    const play = within(steps()).getByRole('button', { name: strings.play })
    fireEvent.click(play)
    expect(caption().textContent).toBe(LABELS.step1)
    expect(within(steps()).getByRole('button', { name: strings.pause })).toBe(play)
    act(() => vi.advanceTimersByTime(STEP_SECONDS * 1000 - 1))
    expect(caption().textContent).toBe(LABELS.step1)
    act(() => vi.advanceTimersByTime(1))
    expect(caption().textContent).toBe(LABELS.step2)
    fireEvent.click(play)
    act(() => vi.advanceTimersByTime(STEP_SECONDS * 3000))
    expect(caption().textContent).toBe(LABELS.step2)
    fireEvent.click(play)
    act(() => vi.advanceTimersByTime(STEP_SECONDS * 1000))
    expect(caption().textContent).toBe(LABELS.step3)
    act(() => vi.advanceTimersByTime(STEP_SECONDS * 1000))
    expect(caption().textContent).toBe(LABELS.step3)
    expect(play.textContent).toBe(strings.play)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a diagram without steps has no player', () => {
    renderScene({ ...SPEC, steps: undefined })
    expect(screen.queryByRole('group', { name: strings.steps })).toBeNull()
  })
})

describe('the motion of the dots', () => {
  it('moves the dots along the path, at 55 units a second, while in view on a visible page', () => {
    renderScene()
    intersect(true)
    expect(scene().dataset.motion).toBe('running')
    runFrame(1000)
    expect(dotsOf('menu->guide').map(xOf)).toEqual([0, 55])
    runFrame(2000)
    expect(dotsOf('menu->guide').map(xOf)).toEqual([55, 0])
    runFrame(2500)
    expect(dotsOf('menu->guide').map(xOf)).toEqual([82.5, 27.5])
    expect(frames.size).toBe(1)
  })

  it('stops while the diagram is scrolled out of view, and goes on where it stopped', () => {
    renderScene()
    intersect(true)
    runFrame(1000)
    runFrame(2000)
    intersect(false)
    expect(scene().dataset.motion).toBe('paused')
    expect(frames.size).toBe(0)
    intersect(true)
    runFrame(9000)
    expect(dotsOf('menu->guide').map(xOf)).toEqual([55, 0])
    runFrame(9500)
    expect(dotsOf('menu->guide').map(xOf)).toEqual([82.5, 27.5])
  })

  it('does not start before the observer has seen the diagram in view', () => {
    renderScene()
    expect(scene().dataset.motion).toBe('paused')
    expect(frames.size).toBe(0)
  })

  it('stops while the page is hidden', () => {
    renderScene()
    intersect(true)
    setVisibility('hidden')
    expect(scene().dataset.motion).toBe('paused')
    expect(frames.size).toBe(0)
    setVisibility('visible')
    expect(scene().dataset.motion).toBe('running')
    expect(frames.size).toBe(1)
  })

  it('under Reduce motion asks for no frame and stands the dots at (i + 0.5) / n', () => {
    reduced.matches = true
    renderScene()
    intersect(true)
    expect(scene().dataset.motion).toBe('still')
    expect(frames.size).toBe(0)
    expect(dotsOf('menu->guide').map(xOf)).toEqual([27.5, 82.5])
    setReduced(false)
    expect(scene().dataset.motion).toBe('running')
    setReduced(true)
    expect(frames.size).toBe(0)
    expect(dotsOf('menu->guide').map(xOf)).toEqual([27.5, 82.5])
  })

  it('leaves no frame, observer or listener behind once the diagram is gone', () => {
    const { unmount } = renderScene()
    intersect(true)
    expect(frames.size).toBe(1)
    unmount()
    expect(frames.size).toBe(0)
    expect(observers.every((observer) => observer.disconnected)).toBe(true)
    expect(reduced.listeners.size).toBe(0)
    setVisibility('hidden')
    setVisibility('visible')
    expect(frames.size).toBe(0)
  })

  it('without IntersectionObserver takes the diagram to be in view', () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    renderScene()
    expect(scene().dataset.motion).toBe('running')
  })
})
