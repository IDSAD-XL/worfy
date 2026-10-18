// main answers the cursor-position requests of a shell (worfy-windows ticket 39).
//
// A program asks its terminal where the cursor is with `ESC[6n` (or `ESC[?6n`) and waits for the
// answer `ESC[<row>;<column>R`. The console of node-pty 1.2.0-beta.15 on Windows asks it about ten
// times after every resize, and PowerShell echoes nothing more until it is answered (PR #498).
// xterm.js in a view answers too, but a view is not always there: Canvas unmounts a Node out of
// sight while its window stays subscribed, and a view that redraws the kept output drops the
// answers to the old requests in it (TerminalNode.tsx). A request that came while no view was
// mounted would wait for ever.
//
// So main answers every such request itself, once, and drops the same answer when a view sends it
// (`TerminalRegistry.write` with `reply`): one answer however many views are open, none or two.
// This holds for every TerminalRegistry, the Terminal Nodes' and the "Sign in with gh" one
// (src/main/ipc/projects.ts): each view marks its answers (terminal-user-input.ts). The
// position is that of a screen of the pty's own size: main follows the output with xterm.js
// without a display (@xterm/headless, the same parser and buffer as the views'), and its answer is
// what xterm.js answers at that point of the output. Other requests (the device attributes, the
// colours, the modes) are still answered by the views; on Windows main also answers the console's
// device attributes request (console-request.ts).
//
// The screen keeps SCROLLBACK lines above the visible rows: when a resize makes the lines wider,
// xterm.js pulls lines back from the scrollback into view, at most as many as the rows freed, so
// the cursor row after a resize matches a view's (5000 lines of scrollback) while the scrollback
// is deeper than the screen is tall (300 rows at most, clampSize).
//
// The screens parse in one worker thread, not on main's event loop: parsing all output there took
// most of a core under a flood (`yes` ran 3.8 times slower on the Mac), and node-pty reads the
// output on that same loop. main posts each chunk and each resize to the worker in the order they
// came; the worker posts back what its xterm.js answers, and main writes the cursor-position
// answers to the pty. One worker for all shells, started with the first and ended with the last.
// It is code in a string (`eval`), the same in tests, a dev run and the package; it loads
// @xterm/headless by path, from app.asar.unpacked in the package (electron-builder.yml asarUnpack).
//
// The screen may refuse output: xterm.js throws "write data discarded" once more than 50 MB wait
// to be parsed; the worker may also fail to start or stop. Then main stops answering for that
// shell until it ends (`answering` is false, a warning is logged once) and the views' marked
// answers reach the shell again (TerminalRegistry.write): a position from a screen that skipped
// output would be wrong, and the shell's output itself never depends on this screen. A new screen
// would not know where the cursor is until the program moved it to a fixed place, so none is made.
import { createRequire } from 'node:module'
import { Worker } from 'node:worker_threads'
import { isCursorAnswer } from '../../shared/terminal/cursor-answer'

export { isCursorAnswer }

/** Lines kept above the visible rows; see the head of the file. */
export const SCROLLBACK = 1000

/** For tests: a module to load in place of @xterm/headless when the worker starts. */
export const screenWorker: { headless: string | undefined } = { headless: undefined }

/** Where @xterm/headless is, for the worker: in the package, out of app.asar (a worker may not read inside it). */
function headlessPath(): string {
  return createRequire(import.meta.url)
    .resolve('@xterm/headless')
    .replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2')
}

/** The worker: a headless xterm.js per shell, fed in the order main posts; what each answers goes back. */
const WORKER_CODE = `
const { parentPort, workerData } = require('node:worker_threads')
const { Terminal } = require(workerData.headless)
const screens = new Map()
function refuse(id, error) {
  const screen = screens.get(id)
  screens.delete(id)
  try { screen?.dispose() } catch {}
  parentPort.postMessage({ t: 'refused', id, message: String(error?.message ?? error) })
}
parentPort.on('message', (m) => {
  try {
    if (m.t === 'open') {
      const screen = new Terminal({ cols: m.cols, rows: m.rows, scrollback: m.scrollback, allowProposedApi: false })
      screen.onData((data) => parentPort.postMessage({ t: 'data', id: m.id, data }))
      screens.set(m.id, screen)
      return
    }
    const screen = screens.get(m.id)
    if (screen === undefined) return
    if (m.t === 'feed') screen.write(m.data)
    else if (m.t === 'resize') screen.write('', () => { if (screens.get(m.id) === screen) screen.resize(m.cols, m.rows) })
    else if (m.t === 'close') { screens.delete(m.id); screen.dispose() }
  } catch (error) {
    refuse(m.id, error)
  }
})
`

type ToWorker =
  | { t: 'open'; id: number; cols: number; rows: number; scrollback: number }
  | { t: 'feed'; id: number; data: string }
  | { t: 'resize'; id: number; cols: number; rows: number }
  | { t: 'close'; id: number }
type FromWorker = { t: 'data'; id: number; data: string } | { t: 'refused'; id: number; message: string }

interface ScreenListener {
  data(data: string): void
  refused(reason: string): void
}

/** The one worker and the screens in it. */
class ScreenWorker {
  private worker: Worker | null = null
  private readonly screens = new Map<number, ScreenListener>()
  private next = 0

  open(size: { cols: number; rows: number }, listener: ScreenListener): number {
    const id = ++this.next
    this.screens.set(id, listener)
    this.post({ t: 'open', id, cols: size.cols, rows: size.rows, scrollback: SCROLLBACK })
    return id
  }

  post(message: ToWorker): void {
    if (this.worker === null) this.worker = this.start()
    this.worker.postMessage(message)
  }

  /** The screen is not wanted any more: taken apart in the worker, which ends with the last screen. */
  close(id: number): void {
    if (this.screens.delete(id)) this.post({ t: 'close', id })
    this.stopIfIdle()
  }

  /** No screen left, however the last one went (closed or refused): the worker ends. */
  private stopIfIdle(): void {
    if (this.screens.size > 0 || this.worker === null) return
    void this.worker.terminate()
    this.worker = null
  }

  private start(): Worker {
    const worker = new Worker(WORKER_CODE, { eval: true, workerData: { headless: screenWorker.headless ?? headlessPath() }, name: 'worfy-cursor-answers' })
    // Never what keeps the app or a test run from ending.
    worker.unref()
    worker.on('message', (message: FromWorker) => {
      const listener = this.screens.get(message.id)
      if (listener === undefined) return
      if (message.t === 'data') listener.data(message.data)
      else {
        this.screens.delete(message.id)
        listener.refused(message.message)
        this.stopIfIdle()
      }
    })
    const lost = (reason: string): void => {
      if (this.worker !== worker) return
      this.worker = null
      const listeners = [...this.screens.values()]
      this.screens.clear()
      for (const listener of listeners) listener.refused(reason)
    }
    worker.on('error', (error) => lost(String(error)))
    worker.on('exit', (code) => lost(`the worker stopped (exit code ${String(code)})`))
    return worker
  }
}

let shared: ScreenWorker | undefined
const screenWorkerOf = (): ScreenWorker => (shared ??= new ScreenWorker())

/** Follows the output of one shell and answers its cursor-position requests through `answer`. */
export class CursorAnswers {
  private readonly id: number
  private disposed = false
  /** The screen refused output or the worker was lost: its position is no longer the shell's. */
  private failed = false

  /** `name` is the shell's, for the warning when the screen refuses output. */
  constructor(
    size: { cols: number; rows: number },
    answer: (data: string) => void,
    private readonly name = 'terminal',
  ) {
    this.id = screenWorkerOf().open(size, {
      data: (data) => {
        if (this.answering && isCursorAnswer(data)) answer(data)
      },
      refused: (reason) => this.refuse(reason),
    })
  }

  /** Whether main answers this shell's cursor requests: not after the screen refused output, nor after dispose. */
  get answering(): boolean {
    return !this.disposed && !this.failed
  }

  /** Output of the shell, in the order it came. */
  feed(data: string): void {
    if (this.answering) screenWorkerOf().post({ t: 'feed', id: this.id, data })
  }

  /** The pty took a new size: applied after the output that came before it, as on a view. */
  resize(cols: number, rows: number): void {
    if (this.answering) screenWorkerOf().post({ t: 'resize', id: this.id, cols, rows })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    screenWorkerOf().close(this.id)
  }

  private refuse(reason: string): void {
    if (!this.answering) return
    this.failed = true
    console.warn(`[terminal] ${this.name}: main's screen refused output (${reason}); the views answer the cursor-position requests from now on`)
  }
}
