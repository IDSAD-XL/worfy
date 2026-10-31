// The window of the worfy Guide (src/renderer/guide/GuideHost.tsx and GuideWindow.tsx, worfy-guide
// ticket 03, ADR-0090): Help ▸ worfy Guide opens it and nothing else does by itself; the Topics a
// build shows; Esc that closes it and goes no further; the EN / RU switch, its default and the choice
// kept in the app settings; and the GitHub links at the build's commit, opened in the system's
// browser. Over a fake preload bridge; no main, no Project, no network.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import { defaultAppSettings, type AppSettings } from '../../src/shared/settings/app-settings'
import { TOPIC_FILES } from '../../src/renderer/guide/content'
import { GuideHost } from '../../src/renderer/guide/GuideHost'
import { GUIDE_REPO_URL } from '../../src/renderer/guide/links'
import { closeGuide, openGuide, useGuide } from '../../src/renderer/guide/store'

const globals = globalThis as { worfy?: WorfyBridge }

interface Main {
  calls: { channel: string; input: unknown }[]
  emit: (channel: string, payload: unknown) => void
  settings: AppSettings
}

/** A bridge with a main that keeps the app settings, answers the build and opens addresses. */
function fakeMain(build = { version: '0.3.0+e61cb1fe', packaged: false }): Main {
  const handlers = new Map<number, { channel: string; handler: (payload: unknown) => void }>()
  let next = 1
  const main: Main = {
    calls: [],
    settings: defaultAppSettings(),
    emit: (channel, payload) => {
      for (const each of [...handlers.values()]) if (each.channel === channel) each.handler(payload)
    },
  }
  globals.worfy = {
    invoke: (channel: string, input: unknown) => {
      main.calls.push({ channel, input })
      switch (channel) {
        case 'app.version':
          return Promise.resolve({ ok: true, value: build })
        case 'appSettings.get':
          return Promise.resolve({ ok: true, value: main.settings })
        case 'appSettings.set':
          main.settings = { ...main.settings, ...(input as Partial<AppSettings>), revision: main.settings.revision + 1 }
          return Promise.resolve({ ok: true, value: main.settings })
        case 'shell.openExternal':
          return Promise.resolve({ ok: true, value: { url: (input as { url: string }).url } })
        default:
          return Promise.resolve({ ok: true, value: undefined })
      }
    },
    on: (channel: string, handler: (payload: unknown) => void) => {
      handlers.set(next, { channel, handler })
      return next++
    },
    off: (id: number) => handlers.delete(id),
  } as unknown as WorfyBridge
  return main
}

let main: Main
const svgPrototype = SVGElement.prototype as unknown as Record<string, unknown>

beforeEach(() => {
  // jsdom has no SVG geometry; the dots of the diagram (scene/motion.ts) stand on their path through it.
  svgPrototype.getTotalLength = () => 100
  svgPrototype.getPointAtLength = (distance: number) => ({ x: distance, y: 0 })
  main = fakeMain()
  useGuide.setState({ open: false, topic: null, build: { version: '0.3.0+e61cb1fe', packaged: false } })
})

afterEach(() => {
  act(() => closeGuide())
  delete globals.worfy
  document.body.replaceChildren()
  vi.restoreAllMocks()
  delete svgPrototype.getTotalLength
  delete svgPrototype.getPointAtLength
})

const guide = () => screen.queryByRole('dialog', { name: 'worfy Guide' })
const ru = TOPIC_FILES.ru.get('skeleton')!
const en = TOPIC_FILES.en.get('skeleton')!

async function opened(): Promise<HTMLElement> {
  act(() => openGuide())
  return screen.findByRole('dialog', { name: 'worfy Guide' })
}

describe('opening and closing', () => {
  it('never opens by itself; Help ▸ worfy Guide opens it, and the build is asked once', async () => {
    useGuide.setState({ build: { version: null, packaged: null } })
    render(<GuideHost />)
    await waitFor(() => expect(main.calls.map((call) => call.channel)).toContain('menu.ready'))
    expect(main.calls.filter((call) => call.channel === 'menu.ready').map((call) => call.input)).toEqual(['guide'])
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)))
    expect(guide()).toBeNull()
    expect(useGuide.getState().build).toEqual({ version: '0.3.0+e61cb1fe', packaged: false })

    act(() => main.emit('menu.command', 'shortcuts'))
    expect(guide()).toBeNull()
    act(() => main.emit('menu.command', 'guide'))
    expect(await screen.findByRole('dialog', { name: 'worfy Guide' })).toBeTruthy()
    expect(main.calls.filter((call) => call.channel === 'app.version')).toHaveLength(1)
  })

  it('Esc closes it and reaches no shortcut of the app; the focus goes back', async () => {
    render(
      <>
        <button type="button">before</button>
        <GuideHost />
      </>,
    )
    const before = screen.getByRole('button', { name: 'before' })
    before.focus()
    const appKeys = vi.fn()
    window.addEventListener('keydown', appKeys)
    const dialog = await opened()
    expect(dialog.contains(document.activeElement)).toBe(true)
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(guide()).toBeNull()
    expect(useGuide.getState().open).toBe(false)
    expect(appKeys).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(before)
    window.removeEventListener('keydown', appKeys)
  })

  it('a key pressed in it reaches no shortcut of the app, and Tab goes round its controls', async () => {
    render(<GuideHost />)
    const appKeys = vi.fn()
    window.addEventListener('keydown', appKeys)
    const dialog = await opened()
    fireEvent.keyDown(document.activeElement!, { key: 'Delete' })
    fireEvent.keyDown(document.activeElement!, { key: 'k', metaKey: true })
    expect(appKeys).not.toHaveBeenCalled()
    const close = within(dialog).getByTestId('guide-close')
    close.focus()
    // Close is not the last control: Tab from the last one comes back to the first.
    const controls = [...dialog.querySelectorAll<HTMLElement>('button, [href], summary, [tabindex]:not([tabindex="-1"])')]
    controls.at(-1)!.focus()
    fireEvent.keyDown(controls.at(-1)!, { key: 'Tab' })
    expect(dialog.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).not.toBe(controls.at(-1))
    window.removeEventListener('keydown', appKeys)
  })

  it('Close and a press on the backdrop close it', async () => {
    render(<GuideHost />)
    const dialog = await opened()
    fireEvent.click(within(dialog).getByTestId('guide-close'))
    expect(guide()).toBeNull()
    await opened()
    fireEvent.mouseDown(screen.getByTestId('guide-backdrop'))
    expect(guide()).toBeNull()
  })
})

describe('the Topics', () => {
  it('lists the test Topic in a build that is not packaged and shows it, Under the hood folded', async () => {
    render(<GuideHost />)
    const dialog = await opened()
    expect(within(dialog).getAllByTestId('guide-topic-item').map((item) => item.textContent)).toEqual([en.title])
    const topic = within(dialog).getByTestId('guide-topic')
    expect(topic.dataset.topic).toBe('skeleton')
    expect(within(topic).getByRole('heading', { name: en.title })).toBeTruthy()
    expect(within(topic).getByText(en.summary[0]!)).toBeTruthy()
    expect((within(topic).getByTestId('guide-under-the-hood') as HTMLDetailsElement).open).toBe(false)
    // The diagram has its text for a screen reader: a group named by the Topic, described by the
    // Topic's description; inside it, the diagram described by the list of its Edges (ticket 04).
    expect(within(topic).getByRole('group', { name: en.title }).getAttribute('aria-describedby')).toBeTruthy()
    expect(within(topic).getByText(en.scene.description)).toBeTruthy()
  })

  it('leaves the test Topic out of a packaged build', async () => {
    useGuide.setState({ build: { version: '0.3.0+e61cb1fe', packaged: true } })
    render(<GuideHost />)
    const dialog = await opened()
    expect(within(dialog).queryAllByTestId('guide-topic-item')).toEqual([])
    expect(within(dialog).getByTestId('guide-empty').textContent).toBe('No Topics yet.')
  })

  it('opens at the Topic it is asked for', async () => {
    render(<GuideHost />)
    act(() => openGuide('skeleton'))
    const dialog = await screen.findByRole('dialog', { name: 'worfy Guide' })
    expect(within(dialog).getByTestId('guide-topic').dataset.topic).toBe('skeleton')
  })
})

describe('the language', () => {
  it('follows the system language until the person chooses', async () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['ru-RU', 'en-US'])
    render(<GuideHost />)
    const dialog = await opened()
    expect(dialog.dataset.language).toBe('ru')
    expect(within(dialog).getByTestId('guide-topic-item').textContent).toBe(ru.title)
    expect(within(dialog).getByTestId('guide-language-ru').getAttribute('aria-pressed')).toBe('true')
  })

  it('the switch shows the other language at once and keeps the choice in the app settings', async () => {
    render(<GuideHost />)
    const dialog = await opened()
    expect(dialog.dataset.language).toBe('en')
    fireEvent.click(within(dialog).getByTestId('guide-language-ru'))
    await waitFor(() => expect(dialog.dataset.language).toBe('ru'))
    expect(main.calls.filter((call) => call.channel === 'appSettings.set').map((call) => call.input)).toEqual([{ guideLanguage: 'ru' }])
    expect(within(dialog).getByTestId('guide-topic').getAttribute('lang')).toBe('ru')
    expect(within(dialog).getByRole('heading', { name: ru.title })).toBeTruthy()
    expect(main.settings.guideLanguage).toBe('ru')

    // Closed and opened again: still Russian.
    act(() => closeGuide())
    const again = await opened()
    expect(again.dataset.language).toBe('ru')
    fireEvent.click(within(again).getByTestId('guide-language-en'))
    await waitFor(() => expect(again.dataset.language).toBe('en'))
  })
})

describe('the GitHub links', () => {
  it('lead to the commit of the build and open in the system browser', async () => {
    render(<GuideHost />)
    const dialog = await opened()
    const fullPage = within(dialog).getByRole('link', { name: /Full page/ })
    const url = `${GUIDE_REPO_URL}/blob/e61cb1fe/docs/features/app-shell.md`
    expect(fullPage.getAttribute('href')).toBe(url)
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    fullPage.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(true)
    await waitFor(() => expect(main.calls.filter((call) => call.channel === 'shell.openExternal').map((call) => call.input)).toEqual([{ url }]))
    const file = within(dialog).getByRole('link', { name: 'src/main/menu.ts' })
    expect(file.getAttribute('href')).toBe(`${GUIDE_REPO_URL}/blob/e61cb1fe/src/main/menu.ts`)
  })

  it('lead to main when the build does not know its commit', async () => {
    useGuide.setState({ build: { version: '0.3.0', packaged: false } })
    render(<GuideHost />)
    const dialog = await opened()
    expect(within(dialog).getByRole('link', { name: /Full page/ }).getAttribute('href')).toBe(`${GUIDE_REPO_URL}/blob/main/docs/features/app-shell.md`)
  })
})
