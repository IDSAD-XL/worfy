// Runs the Card API bridge (../card-bridge.ts, ticket 26) for the Cards of the active Project: it
// listens to the window's `message` events, finds the Card frames on the Canvas, and answers them
// through main (`cardApi.*`) or, for the workflow, from what the window already reads
// (useWorkflow, useChecks). The workflow is read only after a Card first asks for it. Draws nothing.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cardOriginOf, failedSnapshot, workflowSnapshot, type WorkflowSnapshot } from '../../../shared/cards/bridge'
import type { IpcResult } from '../../../shared/ipc/channels'
import { invoke } from '../../ipc'
import { activeProject, useProjects } from '../../projects/useProjects'
import { useWorkflow } from '../../workflow/useWorkflow'
import { useChecks } from '../badges/use-checks'
import { createCardBridge, setCurrentCardBridge, type CardBridge, type CardFrame } from '../card-bridge'

export const order = 90

/** How long `workflow.get` waits for the first read of the workflow. */
export const WORKFLOW_WAIT_MS = 15_000

/**
 * The Card frames on the Canvas now: each iframe inside a Card Node (CardNode.tsx marks the Node
 * with data-card-id), with the origin of the address it loads. A frame whose address names
 * another Card than its Node is left out.
 */
function cardFrames(): CardFrame[] {
  const frames: CardFrame[] = []
  for (const element of document.querySelectorAll<HTMLIFrameElement>('[data-card-id] iframe')) {
    const address = cardOriginOf(element.src)
    const holder = element.closest<HTMLElement>('[data-card-id]')
    const target = element.contentWindow
    if (address === null || target === null || holder?.dataset.cardId !== address.cardId) continue
    frames.push({ cardId: address.cardId, origin: address.origin, window: target })
  }
  return frames
}

function unwrap<T>(result: IpcResult<T>): T {
  if (!result.ok) throw new Error(result.error)
  return result.value
}

/** Reads the workflow and checks of a Project and reports each new snapshot. */
function WorkflowFeed({ root, onSnapshot }: { root: string; onSnapshot: (snapshot: WorkflowSnapshot) => void }) {
  const { model, error } = useWorkflow(root)
  const checks = useChecks(root)
  const snapshot = useMemo(() => {
    if (model) return workflowSnapshot(model, checks)
    return error === undefined ? null : failedSnapshot(error)
  }, [model, checks, error])
  const last = useRef<string | null>(null)
  useEffect(() => {
    if (snapshot === null) return
    // The checks are asked again every few seconds; a Card hears only of a real change.
    const text = JSON.stringify(snapshot)
    if (text === last.current) return
    last.current = text
    onSnapshot(snapshot)
  }, [snapshot, onSnapshot])
  return null
}

type Waiter = (snapshot: WorkflowSnapshot) => void

export default function CardBridgeOverlay() {
  const project = activeProject(useProjects())
  const projectId = project?.id
  const root = project?.path
  /** The root whose workflow a Card asked for. */
  const [wantedRoot, setWantedRoot] = useState<string | null>(null)
  const snapshot = useRef<{ root: string; value: WorkflowSnapshot } | null>(null)
  const waiters = useRef(new Set<Waiter>())
  const bridge = useRef<CardBridge | null>(null)

  useEffect(() => {
    if (projectId === undefined || root === undefined) return
    const pending = waiters.current
    const current = createCardBridge({
      frames: cardFrames,
      backend: {
        dataGet: async (cardId) => unwrap(await invoke('cardApi.dataGet', { projectId, cardId })).value,
        dataSet: async (cardId, value) => {
          unwrap(await invoke('cardApi.dataSet', { projectId, cardId, value }))
        },
        ask: async (cardId, text) => ({ sent: unwrap(await invoke('cardApi.ask', { projectId, cardId, text })).sent }),
        workflow: () => {
          if (snapshot.current?.root === root) return Promise.resolve(snapshot.current.value)
          setWantedRoot(root)
          return new Promise<WorkflowSnapshot>((resolve, reject) => {
            const timer = setTimeout(() => {
              pending.delete(waiter)
              reject(new Error('The workflow of this Project could not be read in time'))
            }, WORKFLOW_WAIT_MS)
            const waiter: Waiter = (value) => {
              clearTimeout(timer)
              resolve(value)
            }
            pending.add(waiter)
          })
        },
      },
    })
    bridge.current = current
    setCurrentCardBridge(current)
    const onMessage = (event: MessageEvent) => void current.receive(event)
    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
      current.dispose()
      setCurrentCardBridge(null)
      bridge.current = null
    }
  }, [projectId, root])

  const onSnapshot = useCallback(
    (value: WorkflowSnapshot) => {
      if (root === undefined) return
      snapshot.current = { root, value }
      for (const waiter of [...waiters.current]) waiter(value)
      waiters.current.clear()
      bridge.current?.publishWorkflow(value)
    },
    [root],
  )

  return root !== undefined && wantedRoot === root ? <WorkflowFeed key={root} root={root} onSnapshot={onSnapshot} /> : null
}
