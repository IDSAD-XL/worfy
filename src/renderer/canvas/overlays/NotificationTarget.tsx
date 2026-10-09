import { useEffect, useRef } from 'react'
import { invoke, subscribe, windowMachine } from '../../ipc'
import { activeProject, addressFor, navigation, openProject, useProjects } from '../../projects/useProjects'
import { openSession } from '../../session/navigation'
import { ensureProject, useSessionNodeViews } from '../../session/node-sessions'
import {
  carryNote,
  dropNote,
  holdNote,
  noteMachine,
  notificationTarget,
  projectOfNote,
  takeCarriedNote,
  usePendingNote,
  type PendingNote,
} from '../../session/notification-target'
import { useOrchestratorViews } from '../nodes/orchestrator-view'

// Opens the Session a click on a macOS notification is about (ticket 21, src/main/notify.ts);
// main has already raised the window and keeps the note. This overlay takes it with
// `notify.pending` when it mounts and again on each `notify.open` signal, so a signal sent before it
// mounted loses nothing. The note then waits until this window knows the Session's Node
// (session/notification-target.ts). Draws nothing.
//
// A note of a Linked machine's Session (worfy-link ticket 13) opens it among the Projects of that
// Machine, the way the sidebar opens a Linked machine's Project (worfy-link ticket 09): a window on
// another Machine loads again on the Project of the note's Machine its Session is in, and takes the
// note it carried across the load; on the note's Machine the Session is looked for in every Project
// of it, and its Project becomes the one the window shows. A note of this Machine in a window on a
// Linked machine brings the window back to this Machine the same way.
export const order = 1000

export default function NotificationTarget() {
  const projects = useProjects()
  const project = activeProject(projects)
  const pending = usePendingNote((store) => store.pending)
  // Read only so the lookup below runs again when views arrive.
  const sessionViews = useSessionNodeViews()
  const orchestratorViews = useOrchestratorViews()
  // The latest note this window took: a lookup on another Machine that ends after a newer click goes nowhere.
  const latest = useRef<PendingNote | null>(null)

  useEffect(() => {
    const carried = takeCarriedNote()
    if (carried !== null) holdNote(carried.note)
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
    latest.current = pending
    const machine = windowMachine()
    const wanted = noteMachine(pending.note)
    if (wanted !== machine) {
      dropNote(pending)
      void (wanted === null ? Promise.resolve(null) : projectOfNote(pending.note, wanted)).then((projectId) => {
        // A newer click came meanwhile: it decides where the window goes.
        if (latest.current !== pending) return
        // The note waits across the load of this window on its Machine.
        carryNote(pending)
        navigation.load(addressFor(wanted, projectId))
      })
      return
    }
    // On a Linked machine a Session from the registry is looked for in any of its Projects.
    const root = pending.note.projectRoot
    const where = machine === null || root === null ? project : (projects?.projects.find((each) => each.path === root) ?? project)
    const target = notificationTarget(pending.note, where, machine)
    if (target !== null) {
      dropNote(pending)
      if (machine !== null && target.projectId !== projects?.activeId) {
        void openProject(machine, target.projectId).then((problem) => {
          if (problem !== undefined) console.error('a notification could not open its Project:', problem)
        })
      }
      openSession(target)
      return
    }
    // The Session Nodes of the Project may not have asked for their views yet; on a Linked machine,
    // the Session may be in any of its Projects.
    if (machine === null) {
      if (project !== undefined) ensureProject(project.id)
    } else {
      for (const each of projects?.projects ?? []) ensureProject(each.id)
    }
    const timer = setTimeout(() => dropNote(pending), Math.max(0, pending.until - Date.now()))
    return () => clearTimeout(timer)
  }, [pending, projects, project, sessionViews, orchestratorViews])
  return null
}
