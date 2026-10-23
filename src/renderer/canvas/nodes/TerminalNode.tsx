import { useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal, type ITheme } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import './TerminalNode.css'
import { invoke, subscribe } from '../../ipc'
import { dismissToast, showToast } from '../../toast/toasts'
import { activeProject, useProjects } from '../../projects/useProjects'
import { matches } from '../../shortcuts/match'
import type { CanvasNodeProps } from './index'
import { NodeResizeClamp } from '../NodeResizeClamp'
import { useLayoutOps } from '../useLayout'
import { keepAltBufferFitted } from './terminal-alt-buffer'
import { watchTypedLine, type TypedLineWatch } from './terminal-line'
import { writeReplay } from './terminal-replay'
import { unscaleMouse } from './terminal-mouse'
import { watchUserInput } from './terminal-user-input'
import { addView, isLastView, type ShellView } from './terminal-views'
import TerminalAiRequest from './TerminalAiRequest'
import { failureReason } from '../../../shared/ipc/channels'
import type { TerminalAiFixState } from '../../../shared/ipc/terminal-ai-fix'
import type { TerminalAiRequestState } from '../../../shared/ipc/terminal-ai-request'
import { SHORTCUTS } from '../../../shared/shortcuts'
import { NODE_HEADER } from '../node-header'

// A Terminal: the user's interactive shell in the root of the Project (CONTEXT.md, "Terminal").
// The agent does not use it. main runs the shell (src/main/terminal/pty.ts); this Node draws it
// with xterm.js. The shell outlives the Node's component: the Canvas hidden behind the Session
// view, the Node scrolled out of sight or the window reloaded only detach the view, and the next
// mount attaches again and redraws the output main kept, at the sizes of the pty it came at
// (terminal-replay.ts). A shell that exited stays exited across
// remounts (main keeps its exit and output); only Restart starts a new one. Closing the Node ends
// the shell. After a
// restart of worfy the Node starts a new shell in the same folder; the old output is gone.
//
// One shell can have two views at once: focus mode draws the Node in a tile while the Canvas keeps
// its own copy mounted under the layer (src/renderer/focus/FocusMode.tsx). Both show the output and
// send input, but the pty has one size: the view mounted last sets it, and when that view goes, the
// view mounted before it fits itself and sets the size again (terminal-views.ts). So leaving focus
// mode gives the shell back the size of the Canvas Node, whose box did not change meanwhile.
//
// One shell can be open on several screens (worfy-link ticket 05, ADR-0053): every window that
// opened it gets its output and may type into it. The pty's size belongs to the screen that typed
// or clicked in the terminal last: main resizes the pty on input, and a click in the terminal sends
// `terminal.takeSize` from the view that sets the size in its window. Restart on one screen starts
// a new shell for all: main announces it (`terminal.started`), and a view showing the old exit
// opens again.
//
// xterm.js also answers the program in the shell on its own: the device attributes, the cursor
// position, focus reports (worfy-windows ticket 39). Those answers go to the shell marked `reply`,
// and main leaves the size where it is (terminal-user-input.ts tells them from typing). A view
// that redraws the kept output sends none of the answers xterm.js gives to the requests in it:
// the program had its answers when those requests came — unless no view was mounted then: such a
// request stays unanswered (ticket 39, its result section), except a cursor-position request, which main
// answers itself in every case (src/main/terminal/cursor-answers.ts). The view attaches once xterm.js has parsed the
// kept output; output that comes meanwhile waits and is answered as live, and what the user types
// or clicks meanwhile is sent once the view attaches.
//
// The Canvas draws its Nodes inside a CSS transform: scale(zoom), which xterm.js does not account
// for when it maps the mouse to cells; terminal-mouse.ts corrects the mouse events it reads.
//
// ⌘I in a Terminal whose zsh is connected to Terminal AI opens the Command request panel over the
// screen (TerminalAiRequest.tsx); xterm.js does not get the key then. Ctrl+I, and ⌘I in any other
// Terminal, go to the shell as before. The panel sends the line typed in the shell with its words,
// read off this screen (terminal-line.ts), and hangs below the first row of the screen, so that row
// stays readable: in a fresh Terminal it is the prompt, and while a command runs, that command.
//
// After a command that failed, "Fix" in the header asks Claude for the corrected command
// (src/main/ipc/terminal-ai-fix.ts): main says when the button is there, the answer lands in the
// line of the shell and never runs, and the focus goes back to the terminal so Enter runs it. A
// refusal shows its reason in an `error` toast of the window until it is closed.

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

/**
 * The terminal colors of the current appearance, from the tokens of design F. Colour 8 (bright
 * black) is the grey of dimmed output and of the Terminal AI Suggestion, which zsh draws as `fg=8`;
 * xterm.js's own is too dark to read on these backgrounds.
 */
function themeOf(element: Element): ITheme {
  const style = getComputedStyle(element)
  const token = (name: string) => style.getPropertyValue(name).trim()
  const background = token('--terminal-bg')
  const foreground = token('--terminal-text')
  return {
    background,
    foreground,
    brightBlack: token('--terminal-dim'),
    cursor: foreground,
    cursorAccent: background,
    selectionBackground: 'rgba(152, 152, 157, 0.4)',
  }
}

/** The Command request panel of a Terminal main has not answered about yet: not there. */
const REQUEST_UNAVAILABLE: TerminalAiRequestState = { available: false, busy: false }

/**
 * True for the key that opens the Command request panel, in a Terminal where the panel is
 * available: ⌘I of the registry, without Ctrl, Alt and Shift, an entry of macOS alone. Ctrl+I is
 * never it: in a terminal that is Tab. A layout that is not Latin opens it by the place of the key I.
 */
function opensRequestPanel(event: KeyboardEvent, available: boolean): boolean {
  return available && matches(event, SHORTCUTS.terminalRequest)
}

/**
 * The state of the Command request panel of a Terminal, kept up to date from main. When the panel
 * stops being available (the zsh left, Command request turned off), `setOpen(false)` closes it.
 */
function useRequestState(projectId: string | undefined, nodeId: string, setOpen: (open: boolean) => void): TerminalAiRequestState {
  const [answered, setAnswered] = useState<{ key: string; state: TerminalAiRequestState } | null>(null)
  const key = `${projectId ?? ''} ${nodeId}`
  useEffect(() => {
    if (projectId === undefined) return
    let active = true
    const keyed = `${projectId} ${nodeId}`
    const off = subscribe('terminalAi.request.changed', (payload) => {
      if (!active || payload.projectId !== projectId || payload.nodeId !== nodeId) return
      setAnswered({ key: keyed, state: { available: payload.available, busy: payload.busy } })
      if (!payload.available) setOpen(false)
    })
    void invoke('terminalAi.request.state', { projectId, nodeId }).then((result) => {
      if (active && result.ok) setAnswered({ key: keyed, state: result.value })
    })
    return () => {
      active = false
      off()
    }
  }, [projectId, nodeId, setOpen])
  // An answer about the Terminal this Node showed before is not about this one.
  return answered?.key === key ? answered.state : REQUEST_UNAVAILABLE
}

/** Between the first row of the screen and the Command request panel under it, in CSS pixels. */
const REQUEST_GAP = 4

/**
 * Where the Command request panel goes, from the top of the screen: under the first row of xterm.js,
 * in CSS pixels of the Node (the Canvas scales it). Undefined while the screen has no rows to measure:
 * then the panel keeps its place from TerminalNode.css.
 */
function belowFirstRow(screen: HTMLElement): number | undefined {
  const row = screen.querySelector('.xterm-rows > div')
  const box = screen.getBoundingClientRect()
  if (row === null || screen.offsetHeight === 0 || box.height === 0) return undefined
  const scale = box.height / screen.offsetHeight
  return Math.ceil((row.getBoundingClientRect().bottom - box.top) / scale) + REQUEST_GAP
}

/**
 * The "Fix" button of a Terminal: whether main says it is there and the Fix in flight. `fixed` runs
 * when the answer is in the line. The reason of a refusal is an `error` toast of the window
 * (toast/toasts.ts, worfy-ui ticket 16) that names the Terminal by its shell, one per Terminal: the
 * next press takes it down.
 */
function useFix(projectId: string | undefined, nodeId: string, shell: string, fixed: () => void) {
  const [answered, setAnswered] = useState<{ key: string; state: TerminalAiFixState } | null>(null)
  const [running, setRunning] = useState(false)
  const key = `${projectId ?? ''} ${nodeId}`
  const toastKey = `terminal-fix:${key}`
  useEffect(() => {
    if (projectId === undefined) return
    let active = true
    const keyed = `${projectId} ${nodeId}`
    const off = subscribe('terminalAi.fix.changed', (payload) => {
      if (!active || payload.projectId !== projectId || payload.nodeId !== nodeId) return
      setAnswered({ key: keyed, state: { available: payload.available } })
    })
    void invoke('terminalAi.fix.state', { projectId, nodeId }).then((result) => {
      if (active && result.ok) setAnswered({ key: keyed, state: result.value })
    })
    return () => {
      active = false
      off()
    }
  }, [projectId, nodeId])
  // Read by run(), which outlives the render that made it.
  const fixedRef = useRef(fixed)
  useEffect(() => {
    fixedRef.current = fixed
  }, [fixed])

  const run = async () => {
    if (projectId === undefined || running) return
    setRunning(true)
    dismissToast(toastKey)
    const result = await invoke('terminalAi.fix.run', { projectId, nodeId })
    setRunning(false)
    if (result.ok && result.value.ok) {
      // main takes the button away too; until its event comes this screen does not offer it again.
      setAnswered({ key, state: { available: false } })
      fixedRef.current()
    } else {
      const reason = result.ok ? (result.value.ok ? null : result.value.message) : failureReason('terminalAi.fix.run', result.error)
      if (reason !== null) showToast({ kind: 'error', key: toastKey, projectId, text: `Fix in Terminal${shell === '' ? '' : ` ${shell}`}: ${reason}`, testId: 'terminal-fix-refused' })
    }
  }
  // An answer about the Terminal this Node showed before is not about this one.
  const available = answered?.key === key && answered.state.available
  return { available, running, run }
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
  // Bumped by Restart (a new run of the effect opens a new shell) and by a shell started on another
  // screen or in another view (a new run attaches to it).
  const [run, setRun] = useState({ count: 0, restart: false })
  const [requestOpen, setRequestOpen] = useState(false)
  const [requestTop, setRequestTop] = useState<number | undefined>(undefined)
  const request = useRequestState(projectId, id, setRequestOpen)
  // Read by the key handler of xterm.js, which is set up once per shell view.
  const requestAvailable = useRef(request.available)
  useEffect(() => {
    requestAvailable.current = request.available
  }, [request.available])
  const xterm = useRef<Terminal | null>(null)
  const typedLine = useRef<TypedLineWatch | null>(null)
  // The corrected command is in the line: the focus goes to the terminal, where Enter runs it.
  const shell = status.state === 'running' || status.state === 'exited' ? status.shell : ''
  const fix = useFix(projectId, id, shell, () => xterm.current?.focus())

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
    // Before any output: the replay holds the mark of the prompt that waits now.
    const line = watchTypedLine(terminal)
    typedLine.current = line
    // The alternate screen gets no scrollback when the rows shrink (terminal-alt-buffer.ts).
    const altBuffer = keepAltBufferFitted(terminal)
    // ⌘I opens the Command request panel instead of reaching the shell: keydown, keypress and keyup alike.
    terminal.attachCustomKeyEventHandler((event) => {
      if (!opensRequestPanel(event, requestAvailable.current)) return true
      event.preventDefault()
      if (event.type === 'keydown') {
        setRequestTop(belowFirstRow(element))
        setRequestOpen(true)
      }
      return false
    })
    terminal.open(element)
    xterm.current = terminal
    const initial = fittedSize(element, fit)
    if (initial !== undefined) terminal.resize(initial.cols, initial.rows)

    let active = true
    let attached = false
    // Until terminal.open answers; output that comes meanwhile waits in `queued`.
    let opening = true
    // While xterm.js parses the kept output: output waits in `queued` too, what the user types or
    // clicks waits in `pending`, and the answers xterm.js gives meanwhile go nowhere.
    let replaying = false
    // While the kept output is written at the sizes of the pty it came at (terminal-replay.ts): the
    // terminal is not fitted to the Node meanwhile, and is fitted once it is all written. Output
    // waits in `queued` meanwhile, also after an exit: it is written once, after the kept output.
    let sizing = false
    // The shell this view shows has exited, and no new one has started on the Node: off Windows
    // main still sends what reaches its pty after the exit (pty.ts, deliver) and keeps it for the
    // next open, so this view writes it too, counted in `written` as before the exit.
    let afterExit = false
    const pending: (() => void)[] = []
    // The shell of the open answer: an exit during the parse shows it in the header.
    let shellName = ''
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
      else if (opening || replaying || sizing) queued.push(payload)
      else if (afterExit) write(payload.data, payload.end)
    })
    const offExit = subscribe('terminal.exit', (payload) => {
      if (payload.projectId !== projectId || payload.nodeId !== id) return
      attached = false
      afterExit = true
      // The shell exited while the kept output was parsed: what it printed last is shown once the
      // kept output is written (attach), and the view does not attach.
      if (replaying) {
        replaying = false
        // Typed for a shell that is gone.
        pending.length = 0
      }
      setStatus((current) => ({ state: 'exited', shell: current.state === 'running' ? current.shell : shellName, exitCode: payload.exitCode }))
    })
    // A new shell started elsewhere (Restart on another screen, or in the other view of focus mode):
    // a view that shows the exit opens again, with a new terminal whose count of written output
    // starts from zero. A view still opening gets the new shell from its own open.
    const offStarted = subscribe('terminal.started', (payload) => {
      if (payload.projectId !== projectId || payload.nodeId !== id) return
      // What comes from now on is the new shell's: the next run of the effect shows it.
      afterExit = false
      if (active && !opening && !attached) setRun((current) => ({ count: current.count + 1, restart: false }))
    })

    // Typed, pasted or clicked data takes the size of the pty for this screen; an answer of xterm.js
    // to the program goes as `reply` and does not (ADR-0053, decision 5).
    const userInput = watchUserInput(terminal)
    const typed = terminal.onData((keys) => {
      const user = userInput.take(keys)
      if (attached) void invoke('terminal.input', { ...ref, data: keys, ...(user ? {} : { reply: true }) })
      // Typed while the kept output is parsed: sent once the view attaches.
      else if (replaying && user) pending.push(() => void invoke('terminal.input', { ...ref, data: keys }))
    })
    // Fits the terminal to the Node: xterm.js resizes only when the size differs.
    const refit = () => {
      if (sizing) return
      const size = fittedSize(element, fit)
      if (size !== undefined && (size.cols !== terminal.cols || size.rows !== terminal.rows)) terminal.resize(size.cols, size.rows)
    }
    const view: ShellView = {
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

    // A click in the terminal gives the pty this screen's size (Q14). Captured before xterm.js
    // handles the press; only the view that sets the size in this window sends it.
    const onPress = () => {
      if (!isLastView(key, view)) return
      const take = () => void invoke('terminal.takeSize', { ...ref, cols: terminal.cols, rows: terminal.rows })
      if (attached) take()
      // A click while the kept output is parsed: sent once the view attaches.
      else if (replaying) pending.push(take)
    }
    element.addEventListener('mousedown', onPress, true)

    // The appearance follows the system; the terminal colors follow the tokens.
    const scheme = window.matchMedia('(prefers-color-scheme: dark)')
    const onScheme = () => {
      terminal.options.theme = themeOf(element)
    }
    scheme.addEventListener('change', onScheme)

    const size = fittedSize(element, fit) ?? SIZE_BEFORE_LAYOUT
    // The first run of the effect attaches, or shows a shell that already exited; a run started by
    // Restart asks main for a new shell.
    void invoke('terminal.open', { ...ref, ...size, restart: run.restart }).then((result) => {
      if (!active) return
      opening = false
      if (!result.ok) {
        setStatus({ state: 'failed', message: result.error })
        return
      }
      const { replay, end, sizes, shell, pid, exited } = result.value
      written = end
      // The kept output at the sizes it came at, ending at the size the pty has now; then the
      // terminal takes its own size again, as before: the Node's, or while the Node has no layout
      // the size it had before the replay. For the view that sets the size of the pty, that is
      // the size the pty has now (open gave the pty that size before main read the sizes).
      const replayed = (then: () => void) => {
        const own = { cols: terminal.cols, rows: terminal.rows }
        // However the replay ends, the terminal is fitted again and `then` runs.
        const finish = () => {
          sizing = false
          try {
            const size = fittedSize(element, fit) ?? own
            if (size.cols !== terminal.cols || size.rows !== terminal.rows) terminal.resize(size.cols, size.rows)
          } finally {
            then()
          }
        }
        sizing = true
        try {
          writeReplay(terminal, { replay, end, sizes }, finish, () => active)
        } catch (error) {
          // A throw before the replay ended (writeReplay catches what xterm.js throws in it); one from
          // `finish` itself has already turned `sizing` off.
          if (sizing) finish()
          throw error
        }
      }
      if (exited !== null) {
        afterExit = true
        // What came after the kept output while it was written: once, after it.
        replayed(() => {
          for (const chunk of queued.splice(0)) write(chunk.data, chunk.end)
        })
        setStatus({ state: 'exited', shell, exitCode: exited.exitCode })
        return
      }
      const attach = () => {
        if (!active) return
        // The shell exited while the kept output was parsed: what came before the exit and after it is shown, once.
        if (!replaying) {
          for (const chunk of queued.splice(0)) write(chunk.data, chunk.end)
          return
        }
        replaying = false
        attached = true
        for (const chunk of queued.splice(0)) write(chunk.data, chunk.end)
        for (const send of pending.splice(0)) send()
        setStatus({ state: 'running', shell, pid })
        // The size may have changed while the shell was starting.
        if (isLastView(key, view) && (terminal.cols !== size.cols || terminal.rows !== size.rows)) void invoke('terminal.resize', { ...ref, cols: terminal.cols, rows: terminal.rows })
      }
      replaying = true
      shellName = shell
      // Attached in the callback, once xterm.js has parsed the kept output, not before: what it
      // answers to the requests in it goes nowhere. The end of the parse, not a timer, is the line.
      replayed(attach)
    })

    return () => {
      // Only the view goes: the shell keeps running until the Node is closed.
      active = false
      attached = false
      offOutput()
      offExit()
      offStarted()
      element.removeEventListener('mousedown', onPress, true)
      typed.dispose()
      userInput.dispose()
      resized.dispose()
      observer.disconnect()
      stopUnscaling()
      // After `attached = false`: this view sends nothing more; the view before it takes the size.
      removeView()
      scheme.removeEventListener('change', onScheme)
      if (xterm.current === terminal) xterm.current = null
      if (typedLine.current === line) typedLine.current = null
      line.dispose()
      altBuffer.dispose()
      terminal.dispose()
    }
  }, [projectId, id, run])

  const closeRequest = () => {
    setRequestOpen(false)
    xterm.current?.focus()
  }

  const close = async () => {
    await ops.apply({ op: 'remove', id })
    // main also ends the shell when the Node leaves the Layout; this covers a Layout change that
    // did not go through.
    if (projectId !== undefined) void invoke('terminal.close', { projectId, nodeId: id })
  }

  return (
    <div
      className="w-node-surface w-terminal"
      data-testid="terminal-node"
      data-node-id={id}
      data-state={status.state}
      data-pid={status.state === 'running' ? status.pid : undefined}
    >
      <NodeResizeClamp
        isVisible={selected}
        minWidth={240}
        minHeight={120}
        onResizeEnd={(_event, { x, y, width, height }) => ops.apply({ op: 'resize', id, x, y, w: width, h: height })}
      />
      <div className="w-terminal__header" {...NODE_HEADER}>
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" />
          <path d="M4.5 6l2 2-2 2M8.5 10.5h3" />
        </svg>
        <span className="w-terminal__title">
          Terminal
        </span>
        {shell !== '' ? <span className="w-terminal__shell">{shell}</span> : null}
        {fix.available || fix.running ? (
          <button
            type="button"
            className="w-terminal__button w-terminal__fix nodrag"
            title="Ask Claude to correct the failed command; it goes into the line and does not run"
            disabled={fix.running}
            // The focus stays in the terminal: Enter there runs the corrected command.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void fix.run()}
          >
            {fix.running ? 'Fixing…' : 'Fix'}
          </button>
        ) : null}
        <span className="w-terminal__spacer" />
        {status.state === 'exited' ? (
          <>
            <span className={`w-terminal__exit${status.exitCode === 0 ? ' w-terminal__exit--ok' : ''}`}>exit {status.exitCode}</span>
            <button type="button" className="w-terminal__button nodrag" onClick={() => setRun((current) => ({ count: current.count + 1, restart: true }))}>
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
      {requestOpen && request.available && projectId !== undefined ? (
        <TerminalAiRequest projectId={projectId} nodeId={id} busy={request.busy} top={requestTop} line={() => typedLine.current?.line() ?? ''} onClose={closeRequest} />
      ) : null}
      <div ref={host} className="w-terminal__screen nodrag nowheel nopan nokey" data-testid="terminal-screen" />
    </div>
  )
}
