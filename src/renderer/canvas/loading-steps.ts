// What the loading line of a Project's Canvas (LoadingProgress.tsx, worfy-link ticket 33) counts:
// the parts of the opening of a Project and whether each is done.
//
// - the workflow: the answer to `workflow.open` (useWorkflow), or its error;
// - the Epics: every Epic whose latest ELK request has its answer (elk/client.ts, useElkRequests
//   and useElkAnswers), N of the M requested;
// - the Sessions history: the answer to `claudeHome.sessions` (useClaudeHome), or its error.
import { useMemo } from 'react'
import { useClaudeHome } from '../claude-home/useClaudeHome'
import { useProjects } from '../projects/useProjects'
import { onWorkflowStoreUpdate, useWorkflow } from '../workflow/useWorkflow'
import { useElkAnswers, useElkRequests } from './elk/client'

/** How long the opening of a Project on this Machine may take before the line shows. */
export const SHOW_AFTER_MS = 300
/** How long every part must stay done before the line goes. */
export const SETTLE_MS = 150

export interface LoadingSteps {
  /** `workflow.open` answered. */
  workflow: boolean
  /** Epics whose latest ELK request has been answered, and Epics requested. */
  epics: { done: number; total: number }
  /** `claudeHome.sessions` answered. */
  sessions: boolean
  /** Every part is done. */
  done: boolean
}

const EMPTY: Readonly<Record<string, never>> = {}

/**
 * How far the opening of `projectId` is. `canvas` is false while React Flow is not there yet: no
 * ELK request has gone out then, so the Epics are not done.
 */
export function useLoadingSteps(projectId: string, canvas: boolean): LoadingSteps {
  const projects = useProjects()
  const root = projects?.projects.find((project) => project.id === projectId)?.path
  const workflow = useWorkflow(root)
  const sessions = useClaudeHome(root)
  const requests = useElkRequests((state) => state[projectId] ?? EMPTY)
  const answers = useElkAnswers((state) => state[projectId] ?? EMPTY)
  const workflowDone = root !== undefined && (workflow.model !== undefined || workflow.error !== undefined)
  const sessionsDone = root !== undefined && (sessions.live !== undefined || sessions.error !== undefined)
  const epics = useMemo(() => {
    const requested = Object.entries(requests)
    return { done: requested.filter(([epic, key]) => answers[epic]?.key === key).length, total: requested.length }
  }, [requests, answers])
  const epicsDone = canvas && workflowDone && epics.done === epics.total
  return { workflow: workflowDone, epics, sessions: sessionsDone, done: workflowDone && epicsDone && sessionsDone }
}

/** The parts of the line, each with whether it is done. */
export function loadingParts(steps: LoadingSteps): { id: string; text: string; done: boolean }[] {
  const { workflow, epics, sessions, done } = steps
  const epicsDone = done || (workflow && epics.total > 0 && epics.done === epics.total)
  return [
    { id: 'workflow', text: workflow ? 'Workflow loaded' : 'Loading workflow…', done: workflow },
    { id: 'epics', text: epics.total > 0 ? `Laying out Epics ${epics.done}/${epics.total}` : done ? 'Epics laid out' : 'Laying out Epics…', done: epicsDone },
    { id: 'sessions', text: sessions ? 'Sessions history read' : 'Reading Sessions history…', done: sessions },
  ]
}

/** Per store, the time (performance.now()) of each of its updates. */
export type StoreUpdates = Record<string, number[]>

/**
 * Counts every update of the stores the opening of a Canvas goes through into `into`: the workflow's
 * shared copy (`useWorkflowStore`) and ELK's answers (`useElkAnswers`). A measure of the first
 * opening (test/e2e/linked-opening.spec.ts); returns the unsubscribe.
 */
export function countStoreUpdates(into: StoreUpdates): () => void {
  const count = (store: string) => () => void (into[store] ??= []).push(performance.now())
  const stops = [onWorkflowStoreUpdate(count('useWorkflowStore')), useElkAnswers.subscribe(count('useElkAnswers'))]
  return () => {
    for (const stop of stops) stop()
  }
}

// The measure is on only when the page defined `__worfyStoreUpdates` before the app's scripts ran,
// as the e2e does; the app never defines it, so nothing is counted there.
const measured = (globalThis as { __worfyStoreUpdates?: StoreUpdates }).__worfyStoreUpdates
if (measured !== undefined) countStoreUpdates(measured)
