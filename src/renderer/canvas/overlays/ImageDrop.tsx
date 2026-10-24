// Pasting and dropping images on the Canvas (worfy-canvas ticket 23): ⌘V / Ctrl+V with an image
// in the clipboard, or image files dropped on the empty plane, make `image` Nodes
// (canvas/image-drop.ts). Draws nothing.
//
// - A paste is the Canvas's only while the Canvas is the view on screen and the focus is on it or
//   nowhere, never in a place to type: a text field, a Terminal (xterm's own textarea), the input
//   of a Session. A Browser's or a Card's page is another document, whose paste never reaches
//   this window. The image lands under the pointer when the pointer is over the Canvas, else in
//   the middle of what the Canvas shows.
// - A drop is the Canvas's on the empty plane only: a file dropped on a Node is that Node's (a
//   Session Node takes it as an attachment). Each file lands where it was dropped, the next ones
//   cascading right and down.
// - On a read-only screen (worfy-link ticket 25) nothing is made; a toast says why.
import { useEffect } from 'react'
import { useReactFlow, useStoreApi } from '@xyflow/react'
import { activeProject, useProjects, useReadOnly } from '../../projects/useProjects'
import { invoke } from '../../ipc'
import { isTextTarget } from '../../shortcuts/match'
import { showToast } from '../../toast/toasts'
import { addImages } from '../image-drop'
import type { CanvasFlowNode } from '../nodes'
import { useLayoutOps } from '../useLayout'

export const order = 65

const carriesFiles = (event: DragEvent): boolean => event.dataTransfer?.types.includes('Files') === true
const onANode = (target: EventTarget | null): boolean => target instanceof Element && target.closest('.react-flow__node') !== null
const inside = (canvas: HTMLElement, target: EventTarget | null): boolean => target instanceof Node && canvas.contains(target)

export default function ImageDrop() {
  const projectId = activeProject(useProjects())?.id
  const readOnly = useReadOnly()
  const flow = useReactFlow<CanvasFlowNode>()
  const store = useStoreApi<CanvasFlowNode>()
  const ops = useLayoutOps()

  useEffect(() => {
    if (projectId === undefined) return
    // Asked at each event: React Flow sets its root after the overlays' effects ran.
    const canvasNow = (): HTMLElement | null => {
      const root = store.getState().domNode
      return root instanceof HTMLElement && root.offsetParent !== null ? root : null
    }
    let pointer: { x: number; y: number } | null = null

    const refuse = (text: string) => showToast({ kind: 'error', projectId, text, testId: 'image-refused' })
    const add = (files: readonly File[], screen: { x: number; y: number }) => {
      if (readOnly !== null) {
        showToast({ kind: 'info', key: `image-read-only:${projectId}`, projectId, text: readOnly, testId: 'image-refused' })
        return
      }
      void addImages(files, flow.screenToFlowPosition(screen), {
        projectId,
        ops,
        refuse,
        store: (input) => invoke('canvasImage.add', input),
      })
    }
    /** Where a pasted image lands: under the pointer while it is over the Canvas, else the middle of the Canvas. */
    const pastePoint = (canvas: HTMLElement): { x: number; y: number } => {
      const box = canvas.getBoundingClientRect()
      if (pointer !== null && pointer.x >= box.left && pointer.x < box.right && pointer.y >= box.top && pointer.y < box.bottom) return pointer
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
    }

    const onPointerMove = (event: PointerEvent) => {
      pointer = { x: event.clientX, y: event.clientY }
    }
    const onPaste = (event: ClipboardEvent) => {
      if (event.defaultPrevented || isTextTarget(event.target)) return
      // Only while this Canvas is on screen, with the focus on it or nowhere.
      const canvas = canvasNow()
      if (canvas === null || (event.target !== document.body && !inside(canvas, event.target))) return
      const files = [...(event.clipboardData?.files ?? [])]
      if (files.length === 0) return
      event.preventDefault()
      add(files, pastePoint(canvas))
    }
    /** A drag of files over the empty plane of this Canvas. */
    const onPlane = (event: DragEvent): boolean => {
      const canvas = canvasNow()
      return carriesFiles(event) && canvas !== null && inside(canvas, event.target) && !onANode(event.target)
    }
    const onDragOver = (event: DragEvent) => {
      if (!onPlane(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = readOnly === null ? 'copy' : 'none'
    }
    const onDrop = (event: DragEvent) => {
      if (!onPlane(event)) return
      // Never let the window open a dropped file in place of the app.
      event.preventDefault()
      add([...(event.dataTransfer?.files ?? [])], { x: event.clientX, y: event.clientY })
    }

    window.addEventListener('pointermove', onPointerMove, true)
    window.addEventListener('paste', onPaste)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('pointermove', onPointerMove, true)
      window.removeEventListener('paste', onPaste)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [projectId, readOnly, flow, store, ops])

  return null
}
