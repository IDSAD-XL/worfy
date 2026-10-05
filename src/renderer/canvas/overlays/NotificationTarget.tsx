import { useEffect } from 'react'
import { subscribe } from '../../ipc'
import { activeProject, useProjects } from '../../projects/useProjects'
import { openSession } from '../../session/navigation'
import { notificationTarget } from '../../session/notification-target'

// Opens the Session a click on a macOS notification is about (ticket 21, src/main/notify.ts);
// main has already raised the window. Draws nothing.
export const order = 1000

export default function NotificationTarget() {
  const project = activeProject(useProjects())
  useEffect(
    () =>
      subscribe('notify.open', (note) => {
        const target = notificationTarget(note, project)
        if (target !== null) openSession(target)
      }),
    [project],
  )
  return null
}
