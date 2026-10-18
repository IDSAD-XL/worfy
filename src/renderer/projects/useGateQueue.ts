// The cross-machine gate queue of a Project (worfy-windows ticket 17, src/shared/ipc/gate-queue.ts),
// for the palette and the Project menu: read once each time one of them opens, on the Machine of
// the Project. main reads gh at most once per 5 minutes, so an opening costs no gh call of its own.
import { useEffect, useState } from 'react'
import type { GateQueueView } from '../../shared/ipc/gate-queue'
import { invokeOn } from '../ipc'

/**
 * The queue of `projectId` on `machine` (null — this Machine; the palette passes the window's); undefined while it is read,
 * when the read failed, and without a Project.
 */
export function useGateQueue(machine: string | null, projectId: string | undefined): GateQueueView | undefined {
  const [read, setRead] = useState<{ key: string; view: GateQueueView }>()
  const key = projectId === undefined ? undefined : `${machine ?? ''}\n${projectId}`
  useEffect(() => {
    if (projectId === undefined) return
    let live = true
    void invokeOn(machine, 'gateQueue.get', { projectId }).then((result) => {
      if (live && result.ok) setRead({ key: `${machine ?? ''}\n${projectId}`, view: result.value })
    })
    return () => {
      live = false
    }
  }, [machine, projectId])
  return read !== undefined && read.key === key ? read.view : undefined
}
