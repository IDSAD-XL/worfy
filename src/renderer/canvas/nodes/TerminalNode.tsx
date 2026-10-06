import { useEffect, useRef, useState } from 'react'
import { NodeResizer } from '@xyflow/react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal, type ITheme } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import './TerminalNode.css'
import { invoke, subscribe } from '../../ipc'
import { activeProject, useProjects } from '../../projects/useProjects'
import type { CanvasNodeProps } from './index'
import { useLayoutOps } from '../useLayout'

// A Terminal: the user's interactive shell in the root of the Project (CONTEXT.md, «Терминал»).
// The agent does not use it. main runs the shell (src/main/terminal/pty.ts); this Node draws it
// with xterm.js. The shell outlives the Node's component: the Canvas hidden behind the Session
// view, the Node scrolled out of sight or the window reloaded only detach the view, and the next
// mount attaches again and redraws the output main kept. A shell that exited stays exited across
// remounts (main keeps its exit and output); only Restart starts a new one. Closing the Node ends
// the shell. After a
// restart of worfy the Node starts a new shell in the same folder; the old output is gone.
//
// One shell can have two views at once: focus mode draws the Node in a tile while the Canvas keeps
// its own copy mounted under the layer (src/renderer/focus/FocusMode.tsx). Both show the output and
// send input, but the pty has one size: the view mounted last sets it, and when that view goes, the
// view mounted before it fits itself and sets the size again (`views` below). So leaving focus mode
// gives the shell back the size of the Canvas Node, whose box did not change meanwhile.
//
// The Canvas draws its Nodes inside a CSS transform: scale(zoom). xterm.js takes the mouse position
// against the scaled box of its screen but divides by the unscaled cell size, so at a zoom other
// than 100% a click or a drag lands on other cells than the ones under the pointer.
// `unscaleMouse` rewrites the position of the mouse events xterm.js reads before it reads them.
// The same value as TERMINAL_NODE_KIND, by which main recognises a Terminal Node; written out
// here because the Node registry needs a literal export.
export const kind = 'terminal'
export const defaultWidth = 560
export const defaultHeight = 340
/** The Canvas context menu item that creates this Node (overlays/CanvasMenu.tsx). */
export const createLabel = 'New terminal'

const SIZE_BEFORE_LAYOUT = { cols: 80, rows: 24 }

type Status =
  | { state: 'starting' }
  | { state: 'running'; shell: string; pid: number }
  | { state: 'exited'; shell: string; exitCode: number }
  | { state: 'failed'; message: string }

/** The terminal colors of the current appearance, from the tokens of design F. */
function themeOf(element: Element): ITheme {
  const style = getComputedStyle(element)
  const token = (name: string) => style.getPropertyValue(name).trim()
  const background = token('--terminal-bg')
  const foreground = token('--terminal-text')
  return { background, foreground, cursor: foreground, cursorAccent: background, selectionBackground: 'rgba(152, 152, 157, 0.4)' }
}

/** The size that fills the Node, or undefined while the Node has no layout (hidden with display:none). */
function fittedSize(element: HTMLElement, fit: FitAddon): { cols: number; rows: number } | undefined {
  if (element.clientWidth === 0 || element.clientHeight === 0) return undefined
  const size = fit.proposeDimensions()
  if (size === undefined || !Number.isFinite(size.cols) || !Number.isFinite(size.rows) || size.cols <= 0 || size.rows <= 0) return undefined
  return size
}

/** A mounted view of a shell, as the other views of the same shell see it. */
interface View {
  /** Fits the view to its Node and sends its size to the pty. */
  takeSize(): void
}

/**
 * The mounted views of each shell, by `projectId nodeId`, in the order they were mounted. The last
 * one sets the size of the pty.
 */
const views = new Map<string, View[]>()

function addView(key: string, view: View): () => void {
  views.set(key, [...(views.get(key) ?? []), view])
  return () => {
    const list = views.get(key) ?? []
    const wasLast = list.at(-1) === view
    const rest = list.filter((other) => other !== view)
    if (rest.length === 0) views.delete(key)
    else views.set(key, rest)
    if (wasLast) rest.at(-1)?.takeSize()
  }
}

const isLastView = (key: string, view: View): boolean => views.get(key)?.at(-1) === view

/** The mouse events whose position xterm.js reads: selection, mouse reporting, links, the wheel. */
const MOUSE_EVENTS = ['mousedown', 'mousemove', 'mouseup', 'click', 'dblclick', 'contextmenu', 'auxclick', 'wheel'] as const

/** Events already rewritten, so a second terminal on the page cannot rewrite one again. */
const unscaled = new WeakSet<Event>()

/**
 * Makes xterm.js see the mouse as if its screen were not scaled: each mouse event for this
 * terminal gets its clientX/clientY moved so that the distance from the screen's top left corner
 * is in unscaled CSS pixels. Listens on window in the capture phase, ahead of every listener of
 * xterm.js (on its element, and on the document while a selection is dragged). Events over the
 * terminal are rewritten, and so are the moves and the release of a press that began over it,
 * wherever the pointer goes. Answers the function that stops it.
 */
function unscaleMouse(element: HTMLElement, screen: HTMLElement): () => void {
  // A press began over the terminal and is not released yet.
  let pressed = false
  const onMouse = (event: MouseEvent) => {
    const over = event.target instanceof Node && element.contains(event.target)
    if (event.type === 'mousedown') pressed = over
    else if (event.type === 'mousemove' && (event.buttons & 1) === 0) pressed = false
    const ours = over || pressed
    if (event.type === 'mouseup') pressed = false
    if (!ours || unscaled.has(event)) return
    const box = screen.getBoundingClientRect()
    const scaleX = screen.offsetWidth > 0 ? box.width / screen.offsetWidth : 1
    const scaleY = screen.offsetHeight > 0 ? box.height / screen.offsetHeight : 1
    if (Math.abs(scaleX - 1) < 0.001 && Math.abs(scaleY - 1) < 0.001) return
    unscaled.add(event)
    // clientX and clientY are getters on MouseEvent.prototype; an own property shadows them for
    // every listener after this one.
    Object.defineProperty(event, 'clientX', { value: box.left + (event.clientX - box.left) / scaleX, configurable: true })
    Object.defineProperty(event, 'clientY', { value: box.top + (event.clientY - box.top) / scaleY, configurable: true })
  }
  for (const type of MOUSE_EVENTS) window.addEventListener(type, onMouse, { capture: true, passive: true })
  return () => {
    for (const type of MOUSE_EVENTS) window.removeEventListener(type, onMouse, { capture: true })
  }
}

export default function TerminalNode({ id, data, selected }: CanvasNodeProps) {
  const ops = useLayoutOps()
  // The Canvas on screen is always the active Project's, so its Nodes belong to that Project.
  const projectId = activeProject(useProjects())?.id
  const host = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<Status>({ state: 'starting' })
  // Bumped by Restart: a new run of the effect opens a new shell.
  const [run, setRun] = useState(0)

  useEffect(() => {
    const element = host.current
    if (projectId === undefined || element === null) return
    const ref = { projectId, nodeId: id }
    const terminal = new Terminal({
      fontFamily: getComputedStyle(element).getPropertyValue('--font-mono').trim() || 'monospace',
      fontSize: 12,
      cursorBlink: true,
      scrollback: 5000,
      theme: themeOf(element),
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(element)
    const initial = fittedSize(element, fit)
    if (initial !== undefined) terminal.resize(initial.cols, initial.rows)

    let active = true
    let attached = false
    // How much of the shell's output this view has written: main numbers every chunk by the
    // length of all output up to its end, so a chunk that the replay already holds is skipped.
    let written = 0
    const queued: { data: string; end: number }[] = []
    const write = (chunk: string, end: number) => {
      if (end <= written) return
      const start = end - chunk.length
      terminal.write(start < written ? chunk.slice(written - start) : chunk)
      written = end
    }

    const offOutput = subscribe('terminal.output', (payload) => {
      if (payload.projectId !== projectId || payload.nodeId !== id) return
      if (attached) write(payload.data, payload.end)
      else queued.push(payload)
    })
    const offExit = subscribe('terminal.exit', (payload) => {
      if (payload.projectId !== projectId || payload.nodeId !== id) return
      attached = false
      setStatus((current) => ({ state: 'exited', shell: current.state === 'running' ? current.shell : '', exitCode: payload.exitCode }))
    })

    const typed = terminal.onData((keys) => {
      if (attached) void invoke('terminal.input', { ...ref, data: keys })
    })
    // Fits the terminal to the Node: xterm.js resizes only when the size differs.
    const refit = () => {
      const size = fittedSize(element, fit)
      if (size !== undefined && (size.cols !== terminal.cols || size.rows !== terminal.rows)) terminal.resize(size.cols, size.rows)
    }
    const view: View = {
      takeSize: () => {
        refit()
        if (attached) void invoke('terminal.resize', { ...ref, cols: terminal.cols, rows: terminal.rows })
      },
    }
    const key = `${projectId} ${id}`
    const removeView = addView(key, view)
    const resized = terminal.onResize(({ cols, rows }) => {
      // Only the view mounted last sets the size of the pty; another view keeps its own size.
      if (attached && isLastView(key, view)) void invoke('terminal.resize', { ...ref, cols, rows })
    })

    // Fits the terminal to the Node whenever the Node's box changes: a resize of the Node, and the
    // Canvas coming back from display:none (Session view), where xterm.js cannot measure itself.
    const observer = new ResizeObserver(refit)
    observer.observe(element)

    const screen = element.querySelector<HTMLElement>('.xterm-screen')
    const stopUnscaling = screen === null ? () => undefined : unscaleMouse(element, screen)

    // The appearance follows the system; the terminal colors follow the tokens.
    const scheme = window.matchMedia('(prefers-color-scheme: dark)')
    const onScheme = () => {
      terminal.options.theme = themeOf(element)
    }
    scheme.addEventListener('change', onScheme)

    const size = fittedSize(element, fit) ?? SIZE_BEFORE_LAYOUT
    // The first run of the effect attaches, or shows a shell that already exited; a run started by
    // Restart asks main for a new shell.
    void invoke('terminal.open', { ...ref, ...size, restart: run > 0 }).then((result) => {
      if (!active) return
      if (!result.ok) {
        setStatus({ state: 'failed', message: result.error })
        return
      }
      const { replay, end, shell, pid, exited } = result.value
      if (replay !== '') terminal.write(replay)
      written = end
      if (exited !== null) {
        setStatus({ state: 'exited', shell, exitCode: exited.exitCode })
        return
      }
      attached = true
      for (const chunk of queued.splice(0)) write(chunk.data, chunk.end)
      setStatus({ state: 'running', shell, pid })
      // The size may have changed while the shell was starting.
      if (isLastView(key, view) && (terminal.cols !== size.cols || terminal.rows !== size.rows)) void invoke('terminal.resize', { ...ref, cols: terminal.cols, rows: terminal.rows })
    })

    return () => {
      // Only the view goes: the shell keeps running until the Node is closed.
      active = false
      attached = false
      offOutput()
      offExit()
      typed.dispose()
      resized.dispose()
      observer.disconnect()
      stopUnscaling()
      // After `attached = false`: this view sends nothing more; the view before it takes the size.
      removeView()
      scheme.removeEventListener('change', onScheme)
      terminal.dispose()
    }
  }, [projectId, id, run])

  const close = async () => {
    await ops.apply({ op: 'remove', id })
    // main also ends the shell when the Node leaves the Layout; this covers a Layout change that
    // did not go through.
    if (projectId !== undefined) void invoke('terminal.close', { projectId, nodeId: id })
  }

  const shell = status.state === 'running' || status.state === 'exited' ? status.shell : ''
  return (
    <div
      className="w-node-surface w-terminal"
      data-testid="terminal-node"
      data-node-id={id}
      data-state={status.state}
      data-pid={status.state === 'running' ? status.pid : undefined}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={240}
        minHeight={120}
        onResizeEnd={(_event, { x, y, width, height }) => ops.apply({ op: 'resize', id, x, y, w: width, h: height })}
      />
      <div className="w-terminal__header">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" />
          <path d="M4.5 6l2 2-2 2M8.5 10.5h3" />
        </svg>
        <span className="w-terminal__title">Terminal</span>
        {shell !== '' ? <span className="w-terminal__shell">{shell}</span> : null}
        <span className="w-terminal__spacer" />
        {status.state === 'exited' ? (
          <>
            <span className={`w-terminal__exit${status.exitCode === 0 ? ' w-terminal__exit--ok' : ''}`}>exit {status.exitCode}</span>
            <button type="button" className="w-terminal__button nodrag" onClick={() => setRun((count) => count + 1)}>
              Restart
            </button>
          </>
        ) : null}
        {data.node.locked ? null : (
          <button type="button" className="w-terminal__button w-terminal__close nodrag" aria-label="Close terminal" title="Close terminal" onClick={() => void close()}>
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
            </svg>
          </button>
        )}
      </div>
      {status.state === 'failed' ? (
        <div className="w-terminal__error" role="alert">
          The terminal could not start: {status.message}
        </div>
      ) : null}
      <div ref={host} className="w-terminal__screen nodrag nowheel nopan nokey" data-testid="terminal-screen" />
    </div>
  )
}
