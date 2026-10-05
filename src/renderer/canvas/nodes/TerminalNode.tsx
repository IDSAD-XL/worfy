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
// mount attaches again and redraws the output main kept. Closing the Node ends the shell. After a
// restart of worfy the Node starts a new shell in the same folder; the old output is gone.
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
    const resized = terminal.onResize(({ cols, rows }) => {
      if (attached) void invoke('terminal.resize', { ...ref, cols, rows })
    })

    // Fits the terminal to the Node whenever the Node's box changes: a resize of the Node, and the
    // Canvas coming back from display:none (Session view), where xterm.js cannot measure itself.
    const observer = new ResizeObserver(() => {
      const size = fittedSize(element, fit)
      if (size !== undefined && (size.cols !== terminal.cols || size.rows !== terminal.rows)) terminal.resize(size.cols, size.rows)
    })
    observer.observe(element)

    // The appearance follows the system; the terminal colors follow the tokens.
    const scheme = window.matchMedia('(prefers-color-scheme: dark)')
    const onScheme = () => {
      terminal.options.theme = themeOf(element)
    }
    scheme.addEventListener('change', onScheme)

    const size = fittedSize(element, fit) ?? SIZE_BEFORE_LAYOUT
    void invoke('terminal.open', { ...ref, ...size }).then((result) => {
      if (!active) return
      if (!result.ok) {
        setStatus({ state: 'failed', message: result.error })
        return
      }
      const { replay, end, shell, pid } = result.value
      if (replay !== '') terminal.write(replay)
      written = end
      attached = true
      for (const chunk of queued.splice(0)) write(chunk.data, chunk.end)
      setStatus({ state: 'running', shell, pid })
      // The size may have changed while the shell was starting.
      if (terminal.cols !== size.cols || terminal.rows !== size.rows) void invoke('terminal.resize', { ...ref, cols: terminal.cols, rows: terminal.rows })
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
