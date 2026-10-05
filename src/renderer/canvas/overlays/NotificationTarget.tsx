import { useEffect } from 'react'
import { invoke, subscribe } from '../../ipc'
import { activeProject, useProjects } from '../../projects/useProjects'
import { openSession } from '../../session/navigation'
import { ensureProject, useSessionNodeViews } from '../../session/node-sessions'
import { dropNote, holdNote, notificationTarget, usePendingNote } from '../../session/notification-target'
import { useOrchestratorViews } from '../nodes/orchestrator-view'

// Opens the Session a click on a macOS notification is about (ticket 21, src/main/notify.ts);
// main has already raised the window and keeps the note. This overlay takes it with
// `notify.pending` when it mounts and again on each `notify.open` signal, so a signal sent before it
// mounted loses nothing. The note then waits until this window knows the Session's Node
// (session/notification-target.ts). Draws nothing.
export const order = 1000

export default function NotificationTarget() {
  const project = activeProject(useProjects())
  const pending = usePendingNote((store) => store.pending)
  // Read only so the lookup below runs again when views arrive.
  const sessionViews = useSessionNodeViews()
  const orchestratorViews = useOrchestratorViews()

  useEffect(() => {
    const take = () =>
      void invoke('notify.pending').then((result) => {
        if (!result.ok) console.error('notify.pending failed:', result.error)
        else if (result.value.note !== null) holdNote(result.value.note)
      })
    // Subscribed before the first take, in the same task: no signal falls between the two.
    const stop = subscribe('notify.open', take)
    take()
    return stop
  }, [])

  useEffect(() => {
    if (pending === null) return
    const target = notificationTarget(pending.note, project)
    if (target !== null) {
      dropNote(pending)
      openSession(target)
      return
    }
    // The Session Nodes of the active Project may not have asked for their views yet.
    if (project !== undefined) ensureProject(project.id)
    const timer = setTimeout(() => dropNote(pending), Math.max(0, pending.until - Date.now()))
    return () => clearTimeout(timer)
  }, [pending, project, sessionViews, orchestratorViews])
  return null
}
