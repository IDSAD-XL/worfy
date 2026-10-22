// Who drives each Browser, as this window knows it (worfy-browser ticket 04, ADR-0078 item 8): read
// from main (`browser.control.list`, src/main/browser/live.ts) when a frame is drawn, and followed
// on every `browser.control.changed`. The frame shows «Claude is driving» while a Session drives it,
// tells main when the user takes it over by a click or a key on the frame, and offers «Return
// control to Claude» after that.
import { useEffect } from 'react'
import { create } from 'zustand'
import type { BrowserControlMode } from '../../shared/browser/tools'
import { invoke, subscribe } from '../ipc'

/** The mode of each Browser somebody drives, by `<Project id>\n<Node id>`. */
const useControls = create<Record<string, BrowserControlMode>>(() => ({}))

const keyOf = (projectId: string, nodeId: string): string => `${projectId}\n${nodeId}`

function put(projectId: string, nodeId: string, mode: BrowserControlMode | null): void {
  // Replaced, not merged: zustand merges a partial state into the old one, which would keep the key
  // a release (mode null) deletes, and the banner with it.
  useControls.setState((controls) => {
    const next = { ...controls }
    if (mode === null) delete next[keyOf(projectId, nodeId)]
    else next[keyOf(projectId, nodeId)] = mode
    return next
  }, true)
}

/** Who drives Browser `nodeId` of Project `projectId`: `claude`, `user` after a takeover, null for nobody. */
export function useBrowserControl(projectId: string | undefined, nodeId: string): BrowserControlMode | null {
  useEffect(() => {
    if (projectId === undefined) return
    let stop: () => void
    try {
      stop = subscribe('browser.control.changed', (change) => {
        if (change.projectId === projectId) put(projectId, change.nodeId, change.mode)
      })
    } catch (error) {
      // Without the preload bridge (a unit test of the Canvas) there is nothing to subscribe to.
      console.error('browser.control.changed: cannot subscribe', error)
      return undefined
    }
    void invoke('browser.control.list', { projectId }).then(
      (result) => {
        if (!result.ok) return console.error('browser.control.list failed:', result.error)
        const listed = result.value.controls.find((control) => control.nodeId === nodeId)
        put(projectId, nodeId, listed?.mode ?? null)
      },
      (error: unknown) => console.error('browser.control.list failed:', error),
    )
    return stop
  }, [projectId, nodeId])
  return useControls((controls) => (projectId === undefined ? null : (controls[keyOf(projectId, nodeId)] ?? null)))
}

/** The user clicked or typed on the frame of Browser `nodeId` while a Session drove it. */
export function takeOverBrowser(projectId: string, nodeId: string): void {
  // The frame changes on main's `browser.control.changed`, which every window of the Project gets.
  void invoke('browser.control.take', { projectId, nodeId }).then(
    (result) => {
      if (!result.ok) console.error('browser.control.take failed:', result.error)
    },
    (error: unknown) => console.error('browser.control.take failed:', error),
  )
}

/** «Return control to Claude» on Browser `nodeId`. */
export function returnBrowserControl(projectId: string, nodeId: string): void {
  void invoke('browser.control.return', { projectId, nodeId }).then(
    (result) => {
      if (!result.ok) console.error('browser.control.return failed:', result.error)
    },
    (error: unknown) => console.error('browser.control.return failed:', error),
  )
}

/**
 * Keeps the keyboard focus of this window where the user has it while a Session clicks the page of
 * Browser `nodeId`, drawn by `webview` (`browser.pressing`). Chromium moves the focus onto the
 * <webview> at the press; at the end of the click it goes back to the element that had it at the
 * start — unless that was nothing (the page's body), a <webview> or a part of a Browser's frame:
 * then the focus stays where the click put it. Answers the unsubscribe.
 */
export function keepWindowFocus(projectId: string, nodeId: string): () => void {
  let before: Element | null = null
  // Any Browser: with two Sessions clicking two Browsers, the focus never goes back into one of them.
  const inBrowser = (element: Element): boolean => element.localName === 'webview' || element.closest('[data-testid="browser-frame"]') !== null
  return subscribe('browser.pressing', (press) => {
    if (press.projectId !== projectId || press.nodeId !== nodeId) return
    if (press.phase === 'start') {
      before = document.activeElement
      return
    }
    const back = before
    before = null
    if (!(back instanceof HTMLElement) || back === document.body || !back.isConnected || inBrowser(back)) return
    if (document.activeElement !== back) back.focus({ preventScroll: true })
  })
}

/** Tells main that Browser `nodeId` is drawn by the guest `webContentsId` of this window's <webview>. */
export function announceBrowserPage(projectId: string, nodeId: string, webContentsId: number): void {
  void invoke('browser.page.live', { projectId, nodeId, webContentsId }).then(
    (result) => {
      // A Linked machine's window has no Live page of its own: main does not take one from it.
      if (!result.ok) console.warn('browser.page.live failed:', result.error)
    },
    (error: unknown) => console.warn('browser.page.live failed:', error),
  )
}
