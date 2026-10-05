// The renderer's copy of the Tickets that "Ship ticket" has a live Session for (ticket 23), by
// Project: asked once per Project (`actions.launches`), then taken from `actions.launches.changed`
// whenever main launches a Session or one of them closes. A snapshot replaces the one before it only
// when its revision is higher, so an answer that crosses a newer event does not roll the list back.
// Not a slot module: the slot (badges/index.ts) collects only the .tsx files of this folder.
import { useEffect } from 'react'
import { create } from 'zustand'
import type { LaunchesSnapshot } from '../../../shared/ipc/actions'
import { invoke, subscribe } from '../../ipc'

interface LaunchesStore {
  /** By projectId; undefined until main has answered. */
  byProject: Readonly<Record<string, LaunchesSnapshot>>
}

const useLaunchesStore = create<LaunchesStore>(() => ({ byProject: {} }))

const asked = new Set<string>()
let subscribed = false

function take(snapshot: LaunchesSnapshot): void {
  useLaunchesStore.setState(({ byProject }) => {
    const known = byProject[snapshot.projectId]
    if (known !== undefined && known.revision >= snapshot.revision) return {}
    return { byProject: { ...byProject, [snapshot.projectId]: snapshot } }
  })
}

function ensure(projectId: string): void {
  if (!subscribed) {
    subscribed = true
    try {
      subscribe('actions.launches.changed', take)
    } catch (error) {
      subscribed = false
      console.error('actions.launches.changed: cannot subscribe', error)
    }
  }
  if (asked.has(projectId)) return
  asked.add(projectId)
  void invoke('actions.launches', { projectId }).then((result) => {
    if (result.ok) take(result.value)
    else {
      asked.delete(projectId)
      console.error('actions.launches failed:', result.error)
    }
  })
}

/** Whether "Ship ticket" has a live Session for the Ticket; false until main has answered (main checks again). */
export function useLaunched(projectId: string, epic: string, num: number): boolean {
  useEffect(() => ensure(projectId), [projectId])
  return useLaunchesStore((state) => state.byProject[projectId]?.tickets.some((ticket) => ticket.epic === epic && ticket.num === num) ?? false)
}
