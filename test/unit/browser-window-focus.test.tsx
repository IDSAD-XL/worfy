// keepWindowFocus (src/renderer/browser/control.ts, worfy-browser ticket 04): a Session's click on the
// page of a Browser moves the window's keyboard focus onto its <webview>, as Chromium does at the
// press; at the end of the click (`browser.pressing`) the focus goes back where the user had it,
// unless that was nothing, a <webview> or a part of a Browser's frame. In jsdom, with main's events
// played by the test.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { keepWindowFocus } from '../../src/renderer/browser/control'

const PROJECT = 'one-0a0a0a0a'
const NODE = 'browser-1'

type Press = { projectId: string; nodeId: string; phase: 'start' | 'end' }
const main = vi.hoisted(() => ({ listeners: new Set<(press: Press) => void>() }))
vi.mock('../../src/renderer/ipc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/ipc')>()),
  subscribe: (channel: string, listener: (press: Press) => void) => {
    if (channel !== 'browser.pressing') throw new Error(`${channel} is not faked`)
    main.listeners.add(listener)
    return () => main.listeners.delete(listener)
  },
}))

/** main tells every window that a click of a Session on Browser `nodeId` starts or ends. */
function pressing(phase: Press['phase'], nodeId = NODE, projectId = PROJECT): void {
  for (const listener of [...main.listeners]) listener({ projectId, nodeId, phase })
}

/** A Session clicks the page: the focus is on the <webview> from the press to the release, as Chromium puts it. */
function sessionClick(webview: HTMLElement, nodeId = NODE, projectId = PROJECT): void {
  pressing('start', nodeId, projectId)
  webview.focus()
  pressing('end', nodeId, projectId)
}

describe('keepWindowFocus', () => {
  let field: HTMLInputElement
  let webview: HTMLElement
  let frameButton: HTMLButtonElement
  let stop: () => void

  beforeEach(() => {
    document.body.innerHTML = `
      <input id="chat">
      <div data-testid="browser-frame"><button id="reload">Reload</button></div>
      <webview id="page" tabindex="-1"></webview>`
    field = document.querySelector<HTMLInputElement>('#chat')!
    webview = document.querySelector<HTMLElement>('#page')!
    frameButton = document.querySelector<HTMLButtonElement>('#reload')!
    stop = keepWindowFocus(PROJECT, NODE)
  })

  afterEach(() => {
    stop()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('puts the focus back on the field the user typed in once the click of the Session ends', () => {
    field.focus()
    pressing('start')
    webview.focus()
    // Not before the release: the page gets its whole click with the focus Chromium gave it.
    expect(document.activeElement).toBe(webview)
    pressing('end')
    expect(document.activeElement).toBe(field)
  })

  it('leaves the focus alone for the click of another Browser or of the same Node id in another Project', () => {
    field.focus()
    sessionClick(webview, 'browser-2')
    expect(document.activeElement).toBe(webview)
    field.focus()
    sessionClick(webview, NODE, 'two-0b0b0b0b')
    expect(document.activeElement).toBe(webview)
  })

  it('leaves the focus where the click put it when the user had none, had a Browser, or had a field that is gone', () => {
    // Nothing: the body of the window. It is not even asked to take the focus.
    field.blur()
    expect(document.activeElement).toBe(document.body)
    const bodyFocus = vi.spyOn(document.body, 'focus')
    sessionClick(webview)
    expect(document.activeElement).toBe(webview)
    expect(bodyFocus).not.toHaveBeenCalled()
    // A part of a Browser's frame, and a <webview> itself: the focus never goes back into a Browser.
    frameButton.focus()
    sessionClick(webview)
    expect(document.activeElement).toBe(webview)
    sessionClick(webview)
    expect(document.activeElement).toBe(webview)
    // A field removed in the middle of the click is not asked either.
    field.focus()
    const fieldFocus = vi.spyOn(field, 'focus')
    pressing('start')
    webview.focus()
    field.remove()
    pressing('end')
    expect(document.activeElement).toBe(webview)
    expect(fieldFocus).not.toHaveBeenCalled()
  })

  it('does nothing after its unsubscribe', () => {
    stop()
    field.focus()
    sessionClick(webview)
    expect(document.activeElement).toBe(webview)
  })
})
