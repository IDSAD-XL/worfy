/// <reference types="vite/client" />
// The context menu of the Canvas: a right click on an empty spot opens it, and each item creates a
// Node there. The items come from the Node types themselves: a file in ../nodes/ that exports
// `createLabel` (e.g. `export const createLabel = 'New terminal'`) gets an item, so a new
// creatable Node type adds no line here or in Canvas.tsx. Under them, past a separator, "Tidy up"
// lays out the Nodes of the Canvas (../tidy.ts, worfy-week/07), "Arrange by Epic" lines the Sessions
// up at their Epic frames (../arrange-by-epic.ts, worfy-canvas ticket 12), and "Re-pack" puts the
// Epic frames in the order "active first" and counts their columns again (../sources/epics.ts,
// ADR-0075). The menu also carries out the palette's "Tidy up", "Arrange by Epic" and "Re-pack": it
// is inside the Canvas's LayoutOps, so each write is one step of ⌘Z.
//
// The menu is HTML, not a native Menu.popup: Playwright cannot click a native menu (ticket 04). It is
// the kit's ContextMenu (theme/kit/ContextMenu.tsx, worfy-ui-kit ticket 12): the keys and the focus of
// every menu, its place at the point of the click moved inside the window at its edge.
import { useCallback, useEffect, useState } from 'react'
import { useReactFlow, useStore } from '@xyflow/react'
import '../../theme/primitives.css'
import { writeItem } from '../../projects/read-only'
import { ContextMenu, ContextMenuSeparator, type ContextMenuPoint } from '../../theme/kit/ContextMenu'
import { MenuItem } from '../../theme/kit/Menu'
import { useArrangeByEpic, useArrangeByEpicRequests } from '../arrange-by-epic-command'
import { activeProject, useProjects, useReadOnly } from '../../projects/useProjects'
import { nodeTypes, type NodeType } from '../nodes'
import { useRepack } from '../arrangement-record'
import { useRepackRequests } from '../sources/epics'
import { useTidyUp, useTidyUpRequests, useTreeBlocks } from '../tidy'
import { createItems, newNodeData } from './create-items'
import { useLayoutOps } from '../useLayout'

export const order = 100

const items = createItems(import.meta.glob('../nodes/*Node.tsx', { eager: true }), nodeTypes)

export default function CanvasMenu() {
  const project = activeProject(useProjects())
  return project ? <ProjectCanvasMenu key={project.id} projectId={project.id} root={project.path} /> : null
}

function ProjectCanvasMenu({ projectId, root }: { projectId: string; root: string }) {
  const flow = useReactFlow()
  const ops = useLayoutOps()
  // One subscription to the Subagent trees for both layout commands, from the menu and the palette.
  const trees = useTreeBlocks(projectId, root)
  const tidyUp = useTidyUp(projectId, trees)
  useTidyUpRequests(projectId, tidyUp)
  const arrangeByEpic = useArrangeByEpic(projectId, root, trees)
  useArrangeByEpicRequests(projectId, arrangeByEpic)
  const repack = useRepack(projectId)
  useRepackRequests(projectId, repack)
  const container = useStore((state) => state.domNode)
  const [opened, setOpened] = useState<ContextMenuPoint | null>(null)
  // On a read-only screen (worfy-link ticket 25) the menu opens with every item inactive, saying why.
  const readOnly = useReadOnly()

  useEffect(() => {
    if (container === null || items.length === 0) return
    const onContextMenu = (event: MouseEvent) => {
      // Only the empty plane: a Node may have its own menu.
      if (!(event.target instanceof Element) || !event.target.classList.contains('react-flow__pane')) return
      event.preventDefault()
      setOpened({ x: event.clientX, y: event.clientY })
    }
    container.addEventListener('contextmenu', onContextMenu)
    return () => container.removeEventListener('contextmenu', onContextMenu)
  }, [container])

  const close = useCallback(() => setOpened(null), [])

  const create = (type: NodeType) => {
    if (opened === null) return
    const { x, y } = flow.screenToFlowPosition({ x: opened.x, y: opened.y })
    close()
    void ops.apply({ op: 'create', node: { kind: type.kind, x, y, w: type.defaultWidth, h: type.defaultHeight, data: newNodeData(type.kind, projectId) } })
  }

  return (
    <ContextMenu at={opened} onClose={close} label="Canvas">
      {items.map(({ label, type }) => (
        <MenuItem key={type.kind} className="w-row" {...writeItem(readOnly, () => create(type))}>
          {label}
        </MenuItem>
      ))}
      <ContextMenuSeparator />
      <MenuItem
        className="w-row"
        {...writeItem(readOnly, () => {
          close()
          void tidyUp()
        })}
      >
        Tidy up
      </MenuItem>
      <MenuItem
        className="w-row"
        {...writeItem(readOnly, () => {
          close()
          void arrangeByEpic()
        })}
      >
        Arrange by Epic
      </MenuItem>
      <MenuItem
        className="w-row"
        {...writeItem(readOnly, () => {
          close()
          void repack()
        })}
      >
        Re-pack
      </MenuItem>
    </ContextMenu>
  )
}
