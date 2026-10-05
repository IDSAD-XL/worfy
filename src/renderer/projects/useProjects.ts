// The renderer's copy of the Project list. Main owns the list (src/main/projects/store.ts); this
// module keeps the latest state it sent, for every component that shows it: the Projects
// section of the sidebar and the toolbar (main.tsx). One subscription and one list call serve
// them all.
import { useEffect } from 'react'
import { create } from 'zustand'
import type { ProjectsState, ProjectView } from '../../shared/ipc/projects'
import { invoke, subscribe } from '../ipc'

interface ProjectsStore {
  state: ProjectsState | undefined
}

const useProjectsStore = create<ProjectsStore>(() => ({ state: undefined }))

/**
 * Takes a state from main unless a newer one is already here. Broadcasts and list answers can
 * arrive out of order; an equal revision is taken, since it may carry a fresher branch.
 */
export function acceptProjectsState(state: ProjectsState): void {
  const current = useProjectsStore.getState().state
  if (!current || state.revision >= current.revision) useProjectsStore.setState({ state })
}

/** Asks main for the list again (also refreshes the branches). */
export async function refreshProjects(): Promise<void> {
  const result = await invoke('projects.list')
  if (result.ok) acceptProjectsState(result.value)
  else console.error('projects.list failed:', result.error)
}

let started = false

function start(): void {
  if (started) return
  started = true
  try {
    subscribe('projects.changed', acceptProjectsState)
  } catch (error) {
    // No bridge (the preload did not run): show what the list call returns, as other views do,
    // instead of taking the whole window down.
    console.error('projects.changed: cannot subscribe', error)
  }
  // The branch changes outside worfy (a checkout in a terminal); coming back to the window is
  // the moment to look again.
  window.addEventListener('focus', () => void refreshProjects())
  void refreshProjects()
}

/** The Project list and the active Project; undefined until main has answered once. */
export function useProjects(): ProjectsState | undefined {
  useEffect(start, [])
  return useProjectsStore((store) => store.state)
}

export function activeProject(state: ProjectsState | undefined): ProjectView | undefined {
  return state?.projects.find((project) => project.id === state.activeId)
}
