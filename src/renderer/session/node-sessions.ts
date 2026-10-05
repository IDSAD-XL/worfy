// main's view of each Session worfy runs on a Session Node (src/shared/ipc/sessions.ts,
// SessionNodeView) in the renderer, by Node: asked for once per Project with `sessions.views`, then
// followed on `sessions.changed`. One subscription serves every Node and the Session view.
import { useEffect } from 'react'
import { create } from 'zustand'
import type { SessionNodeView } from '../../shared/ipc/sessions'
import { invoke, subscribe } from '../ipc'

interface ViewsStore {
  byNode: Readonly<Record<string, SessionNodeView>>
}

const useViewsStore = create<ViewsStore>(() => ({ byNode: {} }))

/** Takes a view unless a newer one of the same Node is already here: answers and events race. */
export function acceptSessionNodeView(view: SessionNodeView): void {
  const current = useViewsStore.getState().byNode[view.nodeId]
  if (current && view.version <= current.version) return
  useViewsStore.setState(({ byNode }) => ({ byNode: { ...byNode, [view.nodeId]: view } }))
}

let subscribed = false
const asked = new Set<string>()

function ensureSubscribed(): void {
  if (subscribed) return
  subscribed = true
  try {
    subscribe('sessions.changed', acceptSessionNodeView)
  } catch (error) {
    subscribed = false
    console.error('sessions.changed: cannot subscribe', error)
  }
}

/**
 * Subscribes, then asks main once per Project for the views it already has (a reloaded window, or
 * one a notification opened: notification-target.ts).
 */
export function ensureProject(projectId: string): void {
  ensureSubscribed()
  if (asked.has(projectId)) return
  asked.add(projectId)
  void invoke('sessions.views', { projectId }).then((result) => {
    if (!result.ok) {
      asked.delete(projectId)
      console.error('sessions.views failed:', result.error)
    } else for (const view of result.value.views) acceptSessionNodeView(view)
  })
}

/** main's view of the Session behind a Node; undefined while main has none (it never ran in this run of the app). */
export function useSessionNodeView(projectId: string | undefined, nodeId: string): SessionNodeView | undefined {
  useEffect(() => {
    if (projectId !== undefined) ensureProject(projectId)
  }, [projectId])
  return useViewsStore((store) => store.byNode[nodeId])
}

/** Whether a view is of a Session that runs now. */
export const isRunning = (view: SessionNodeView | undefined): view is SessionNodeView => view !== undefined && view.state !== 'closed'

/** Whether a view runs `sessionId`: by the id `agent.*` takes, or by its SDK session. */
const runs = (view: SessionNodeView, sessionId: string): boolean => view.sessionId === sessionId || view.sdkSessionId === sessionId

/**
 * main's view of the Session Node of the Project that runs `sessionId`, by either id; undefined
 * when none does (ticket 21: the "Needs permission" badge, opening a Session from a notification).
 */
export function useSessionNodeViewOf(projectId: string | undefined, sessionId: string): SessionNodeView | undefined {
  useEffect(() => {
    if (projectId !== undefined) ensureProject(projectId)
  }, [projectId])
  return useViewsStore((store) => Object.values(store.byNode).find((view) => view.projectId === projectId && runs(view, sessionId)))
}

/** Every view this window has, by Node; a new object on each change (notification-target.ts waits on it). */
export function useSessionNodeViews(): Readonly<Record<string, SessionNodeView>> {
  return useViewsStore((store) => store.byNode)
}

/** The same lookup outside React, over the views this window has now; any Project. */
export function sessionNodeViewOf(sessionId: string): SessionNodeView | undefined {
  return Object.values(useViewsStore.getState().byNode).find((view) => view.state !== 'closed' && runs(view, sessionId))
}
