// Live and Asleep Browsers as this window knows them (worfy-browser ticket 05, ADR-0078 items 6, 7
// and 15): main decides, for every window at once (src/main/browser/live.ts), which Browser is Live
// and which Asleep; this window reads the lives of the Project's Browsers (`browser.lives.list`) and
// follows every `browser.lives.changed`. The Browser layer draws a page only for a Live Browser and
// tells main what this window shows (`browser.screen`); an Asleep frame shows the picture of its page
// (`browser.picture`) and wakes the Browser on a click (`browser.wake`).
import { useEffect, useMemo, useState } from 'react'
import { create } from 'zustand'
import type { BrowserLife } from '../../shared/ipc/browser'
import { invoke, subscribe } from '../ipc'

/** The lives of each Project's Browsers, by Project id, then by Node id. */
const useLives = create<Record<string, Record<string, BrowserLife>>>(() => ({}))

function put(projectId: string, lives: readonly BrowserLife[]): void {
  useLives.setState((all) => ({ ...all, [projectId]: Object.fromEntries(lives.map((life) => [life.nodeId, life])) }))
}

/** Reads the lives of Project `projectId` and follows their changes while mounted. */
export function useFollowBrowserLives(projectId: string | undefined): void {
  useEffect(() => {
    if (projectId === undefined) return
    let stop: () => void
    try {
      stop = subscribe('browser.lives.changed', (change) => {
        if (change.projectId === projectId) put(projectId, change.lives)
      })
    } catch (error) {
      // Without the preload bridge (a unit test of the Canvas) there is nothing to subscribe to.
      console.error('browser.lives.changed: cannot subscribe', error)
      return undefined
    }
    void invoke('browser.lives.list', { projectId }).then(
      (result) => {
        if (!result.ok) return console.error('browser.lives.list failed:', result.error)
        put(projectId, result.value.lives)
      },
      (error: unknown) => console.error('browser.lives.list failed:', error),
    )
    return stop
  }, [projectId])
}

/** The life of Browser `nodeId`; undefined while main has none for it (before the first screen of the Project, or a Linked machine's window). */
export function useBrowserLife(projectId: string | undefined, nodeId: string): BrowserLife | undefined {
  return useLives((all) => (projectId === undefined ? undefined : all[projectId]?.[nodeId]))
}

/** The Node ids of the Live Browsers of Project `projectId`. */
export function useLiveBrowserIds(projectId: string | undefined): ReadonlySet<string> {
  // One string, so the hook gives a new set only when the Live Browsers change.
  const key = useLives((all) =>
    projectId === undefined
      ? ''
      : Object.values(all[projectId] ?? {})
          .filter((life) => life.live)
          .map((life) => life.nodeId)
          .sort()
          .join('\n'),
  )
  return useMemo(() => new Set(key === '' ? [] : key.split('\n')), [key])
}

/** The user clicked the frame of Asleep Browser `nodeId`: main wakes it, and its page is drawn on `browser.lives.changed`. */
export function wakeBrowser(projectId: string, nodeId: string): void {
  void invoke('browser.wake', { projectId, nodeId }).then(
    (result) => {
      if (!result.ok) console.error('browser.wake failed:', result.error)
    },
    (error: unknown) => console.error('browser.wake failed:', error),
  )
}

/** Tells main what this window shows: the Browser frames in it and the zoom of its Canvas. */
export function reportBrowserScreen(report: { projectId: string; visible: string[]; zoom: number }): void {
  void invoke('browser.screen', report).then(
    (result) => {
      if (!result.ok) console.warn('browser.screen failed:', result.error)
    },
    (error: unknown) => console.warn('browser.screen failed:', error),
  )
}

/** The picture of Asleep Browser `nodeId` as a JPEG's bytes; null while it has none or it is not read yet. */
export function useBrowserPicture(projectId: string | undefined, nodeId: string, version: number | null): Uint8Array | null {
  const [picture, setPicture] = useState<{ version: number; bytes: Uint8Array } | null>(null)
  useEffect(() => {
    if (projectId === undefined || version === null) return
    let current = true
    void invoke('browser.picture', { projectId, nodeId }).then(
      (result) => {
        if (!current) return
        if (!result.ok) return console.error('browser.picture failed:', result.error)
        const image = result.value.picture?.image
        if (image !== undefined) setPicture({ version, bytes: Uint8Array.from(atob(image), (char) => char.charCodeAt(0)) })
      },
      (error: unknown) => console.error('browser.picture failed:', error),
    )
    return () => {
      current = false
    }
  }, [projectId, nodeId, version])
  return version === null ? null : (picture?.bytes ?? null)
}
