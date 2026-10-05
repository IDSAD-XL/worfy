// The renderer's copy of each Project's action templates (ticket 23), shared by the action buttons
// of every Ticket and Epic frame: asked once per Project (`projects.settings.get`), then taken from
// `projects.settings.changed` whenever "Project settings" saves, so a button follows at once.
// Not a slot module: the slot (badges/index.ts) collects only the .tsx files of this folder.
import { useEffect } from 'react'
import { create } from 'zustand'
import type { ActionTemplates } from '../../../shared/projects/action-templates'
import { invoke, subscribe } from '../../ipc'

interface TemplatesStore {
  /** By projectId; undefined until main has answered. */
  byProject: Readonly<Record<string, ActionTemplates>>
}

const useTemplatesStore = create<TemplatesStore>(() => ({ byProject: {} }))

const asked = new Set<string>()
let subscribed = false

function set(projectId: string, templates: ActionTemplates): void {
  useTemplatesStore.setState(({ byProject }) => ({ byProject: { ...byProject, [projectId]: templates } }))
}

function ensure(projectId: string): void {
  if (!subscribed) {
    subscribed = true
    try {
      subscribe('projects.settings.changed', ({ id, settings }) => set(id, settings.actionTemplates))
    } catch (error) {
      subscribed = false
      console.error('projects.settings.changed: cannot subscribe', error)
    }
  }
  if (asked.has(projectId)) return
  asked.add(projectId)
  void invoke('projects.settings.get', { id: projectId }).then((result) => {
    if (result.ok) {
      // A change that arrived meanwhile is newer than this answer.
      if (useTemplatesStore.getState().byProject[projectId] === undefined) set(projectId, result.value.actionTemplates)
    } else {
      asked.delete(projectId)
      console.error('projects.settings.get failed:', result.error)
    }
  })
}

/** The Project's action templates; undefined until main has answered. */
export function useActionTemplates(projectId: string): ActionTemplates | undefined {
  useEffect(() => ensure(projectId), [projectId])
  return useTemplatesStore((state) => state.byProject[projectId])
}
