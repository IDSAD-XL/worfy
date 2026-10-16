/// <reference types="vite/client" />
// The context menu of the Canvas: a right click on an empty spot opens it, and each item creates a
// Node there. The items come from the Node types themselves: a file in ../nodes/ that exports
// `createLabel` (e.g. `export const createLabel = 'New terminal'`) gets an item, so a new
// creatable Node type adds no line here or in Canvas.tsx. Under them, past a separator, "Tidy up"
// lays out the Nodes of the Canvas (../tidy.ts, worfy-week/07).
//
// The menu is HTML, not a native Menu.popup: Playwright cannot click a native menu (ticket 04).
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useReactFlow, useStore } from '@xyflow/react'
import '../../theme/primitives.css'
import { writeAction } from '../../projects/read-only'
import { activeProject, useProjects, useReadOnly } from '../../projects/useProjects'
import { nodeTypes, type NodeType } from '../nodes'
import { useTidyUp } from '../tidy'
import { createItems } from './create-items'
import { useLayoutOps } from '../useLayout'

export const order = 100

const items = createItems(import.meta.glob('../nodes/*Node.tsx', { eager: true }), nodeTypes)

const menuStyle: CSSProperties = {
  position: 'fixed',
  zIndex: 90,
  minWidth: 180,
  padding: 'var(--space-1)',
  borderRadius: 'var(--radius-popover)',
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  boxShadow: 'var(--shadow-node)',
}

interface Opened {
  /** Where the menu is drawn, in window coordinates. */
  x: number
  y: number
}

const separatorStyle: CSSProperties = { height: 1, margin: 'var(--space-1) 0', background: 'var(--border)' }

export default function CanvasMenu() {
  const project = activeProject(useProjects())
  return project ? <ProjectCanvasMenu key={project.id} projectId={project.id} root={project.path} /> : null
}

function ProjectCanvasMenu({ projectId, root }: { projectId: string; root: string }) {
  const flow = useReactFlow()
  const ops = useLayoutOps()
  const tidyUp = useTidyUp(projectId, root)
  const container = useStore((state) => state.domNode)
  const [opened, setOpened] = useState<Opened>()
  const menu = useRef<HTMLDivElement>(null)
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

  const close = useCallback(() => setOpened(undefined), [])

  useEffect(() => {
    if (opened === undefined) return
    menu.current?.querySelector('button')?.focus()
    const outside = (event: MouseEvent) => {
      if (!menu.current?.contains(event.target as Node)) close()
    }
    document.addEventListener('mousedown', outside)
    window.addEventListener('blur', close)
    return () => {
      document.removeEventListener('mousedown', outside)
      window.removeEventListener('blur', close)
    }
  }, [opened, close])

  if (opened === undefined) return null

  const create = (type: NodeType) => {
    const { x, y } = flow.screenToFlowPosition({ x: opened.x, y: opened.y })
    close()
    void ops.apply({ op: 'create', node: { kind: type.kind, x, y, w: type.defaultWidth, h: type.defaultHeight, data: {} } })
  }

  return createPortal(
    <div
      ref={menu}
      role="menu"
      aria-label="Canvas"
      style={{ ...menuStyle, left: opened.x, top: opened.y }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          // The press that closes the menu does nothing else (the Esc of an active Node, of Focus mode).
          event.preventDefault()
          close()
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          const buttons = [...(menu.current?.querySelectorAll('button') ?? [])]
          const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
          const next = (current + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length
          buttons[next]?.focus()
        }
      }}
    >
      {items.map(({ label, type }) => (
        <button key={type.kind} type="button" role="menuitem" className="w-row" {...writeAction(readOnly, () => create(type))}>
          {label}
        </button>
      ))}
      <div role="separator" style={separatorStyle} />
      <button
        type="button"
        role="menuitem"
        className="w-row"
        {...writeAction(readOnly, () => {
          close()
          void tidyUp()
        })}
      >
        Tidy up
      </button>
    </div>,
    document.body,
  )
}
