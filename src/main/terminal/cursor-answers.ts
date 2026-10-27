// main answers the requests of a program to its terminal (worfy-windows tickets 39 and 68).
//
// A program asks its terminal where the cursor is (`ESC[6n`, `ESC[?6n`), what it is (the device
// attributes, `ESC[c`, `ESC[>c`), how it is (`ESC[5n`), the state of a mode (DECRQM,
// `ESC[?2004$p`) or a setting (DECRQSS, `ESC P $q m ESC \`), and waits for the answer. The
// console of node-pty 1.2.0-beta.15 on Windows asks the cursor position about ten times after
// every resize, and PowerShell echoes nothing more until it is answered (PR #498); vim asks the
// position and the secondary device attributes when it starts. xterm.js in a view answers too, but
// a view is not always there: Canvas unmounts a Node out of sight while its window stays
// subscribed, and a view that redraws the kept output drops the answers to the old requests in it
// (TerminalNode.tsx). A request that came while no view was mounted would wait for ever; with two
// views mounted the program got two answers.
//
// So main answers each request whose answer is the same from its screen and from a view's (the
// shapes are in src/shared/terminal/cursor-answer.ts, isMainAnswer), once, and drops the same
// answer when a view sends it (`TerminalRegistry.write` with `reply`): one answer however many
// views are open, none or two. This holds for every TerminalRegistry, the Terminal Nodes' and the
// "Sign in with gh" one (src/main/ipc/projects.ts): each view marks its answers
// (terminal-user-input.ts). main follows the output with xterm.js without a display
// (@xterm/headless, the same parser and buffer as the views', on a screen of the pty's own size),
// and its answer is what xterm.js answers at that point of the output. On Windows the device
// attributes request never reaches this screen: main answers it in console-request.ts and takes it
// out of the output.
//
// The colour queries (OSC 10, 11, 12 and 4 with `?`) stay with the views: the answer is the
// colour of the view's theme, and main's screen has none. With no view mounted such a query gets
// no answer. With two views each answers; main passes the first answer of each kind (foreground,
// background, cursor, a palette entry) and drops another view's answer of that kind that comes
// within COLOUR_ANSWER_WINDOW_MS (ColourAnswers). The same view answering again passes: the
// program asked again. main does not track the queries for this.
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
// The worker may fall behind a program that floods its output (one thread parses for every shell).
// xterm.js keeps what it has not parsed yet, and past 50 MB it refuses more. So the worker says
// how much of each shell's output it has parsed, and main keeps at most HIGH_WATER characters of a
// shell on the way: above it main pauses that shell's pty, and resumes it once the worker is down
// to LOW_WATER. The screens of the views get the output at the pace the worker parses it then.
// Before a pty is closed, or when main stops answering a shell, its pty is resumed for good
// (`letOutputFlow`): on Windows node-pty reports the exit only when the output of the console has
// been read to its end.
//
// The screen may refuse output: xterm.js throws "write data discarded" once more than 50 MB wait
// to be parsed; the worker may also fail to start or stop. Then main stops answering for that
// shell until it ends (`answering` is false, a warning is logged once) and the views' marked
// answers reach the shell again (TerminalRegistry.write): a position from a screen that skipped
// output would be wrong, and the shell's output itself never depends on this screen. A new screen
// would not know where the cursor is until the program moved it to a fixed place, so none is made.
import { createRequire } from 'node:module'
import { Worker } from 'node:worker_threads'
import { colourAnswers, isMainAnswer } from '../../shared/terminal/cursor-answer'

export { isMainAnswer }

/**
 * How long after a view's colour answer passed another view's answer of the same kind is taken for
 * a second answer to the same query (ColourAnswers).
 */
export const COLOUR_ANSWER_WINDOW_MS = 1000

/**
 * The colour answers of the views of one shell: the first answer of a kind passes, and another
 * view's answer of the same kind within COLOUR_ANSWER_WINDOW_MS is dropped (see the head of the file).
 */
export class ColourAnswers {
  private readonly last = new Map<string, { client: unknown; at: number }>()

  /** What of `data`, marked as an answer by `client`, goes to the shell: all of it unless it is colour answers. */
  pass(data: string, client: unknown): string {
    const answers = colourAnswers(data)
    if (answers === null) return data
    const now = Date.now()
    return answers
      .filter(({ kind }) => {
        const last = this.last.get(kind)
        // shortcut: a time window in place of a count of the queries, redo by counting the colour queries in the output main follows once a program is seen getting two answers or none.
        // The window's limit: a second view that answers more than COLOUR_ANSWER_WINDOW_MS late
        // gives the program a second answer, and when the view that answered goes, a new query
        // within the window gets no answer.
        if (last !== undefined && last.client !== client && now - last.at < COLOUR_ANSWER_WINDOW_MS) return false
        this.last.set(kind, { client, at: now })
        return true
      })
      .map(({ text }) => text)
      .join('')
  }
}

/** Lines kept above the visible rows; see the head of the file. */
export const SCROLLBACK = 1000

/** Characters of a shell's output on the way to the worker above which main pauses its pty. */
export const HIGH_WATER = 4_000_000
/** ... and at or below which main resumes it. */
export const LOW_WATER = 1_000_000

/** For tests: a module to load in place of @xterm/headless when the worker starts. */
export const screenWorker: { headless: string | undefined } = { headless: undefined }

/** A module's path inside app.asar, as the same path out of it: electron-builder.yml unpacks @xterm/headless. */
export function unpackedPath(path: string): string {
  return path.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2')
}

/** Where @xterm/headless is, for the worker: in the package, out of app.asar (a worker may not read inside it). */
function headlessPath(): string {
  return unpackedPath(createRequire(import.meta.url).resolve('@xterm/headless'))
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
    if (m.t === 'feed') {
      const n = m.data.length
      screen.write(m.data, () => parentPort.postMessage({ t: 'parsed', id: m.id, n }))
    } else if (m.t === 'resize') screen.write('', () => { if (screens.get(m.id) === screen) screen.resize(m.cols, m.rows) })
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
type FromWorker = { t: 'data'; id: number; data: string } | { t: 'parsed'; id: number; n: number } | { t: 'refused'; id: number; message: string }

interface ScreenListener {
  data(data: string): void
  /** The worker has parsed `n` more characters of this shell's output. */
  parsed(n: number): void
  refused(reason: string): void
}

/** The pty of the shell, as far as main holds its output back. */
export interface OutputFlow {
  pause(): void
  resume(): void
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
      else if (message.t === 'parsed') listener.parsed(message.n)
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

/** Follows the output of one shell and answers its requests (isMainAnswer) through `answer`. */
export class CursorAnswers {
  private readonly id: number
  private disposed = false
  /** The screen refused output or the worker was lost: its position is no longer the shell's. */
  private failed = false
  /** Characters posted to the worker and not parsed yet. */
  private inFlight = 0
  /** main has paused the pty (HIGH_WATER). */
  private paused = false
  /** The pty is never paused again (letOutputFlow). */
  private flowing = false

  /** `name` is the shell's, for the warning when the screen refuses output; `flow` is its pty, paused while the worker lags. */
  constructor(
    size: { cols: number; rows: number },
    answer: (data: string) => void,
    private readonly name = 'terminal',
    private readonly flow?: OutputFlow,
  ) {
    this.id = screenWorkerOf().open(size, {
      data: (data) => {
        if (this.answering && isMainAnswer(data)) answer(data)
      },
      parsed: (n) => {
        this.inFlight -= n
        if (this.paused && this.inFlight <= LOW_WATER) this.resume()
      },
      refused: (reason) => this.refuse(reason),
    })
  }

  /** Whether main answers this shell's requests: not after the screen refused output, nor after dispose. */
  get answering(): boolean {
    return !this.disposed && !this.failed
  }

  /** Output of the shell, in the order it came. Pauses the pty while too much of it waits in the worker. */
  feed(data: string): void {
    if (!this.answering) return
    this.inFlight += data.length
    screenWorkerOf().post({ t: 'feed', id: this.id, data })
    if (!this.paused && !this.flowing && this.inFlight > HIGH_WATER) {
      this.paused = true
      this.flow?.pause()
    }
  }

  /** The pty is resumed if paused, and never paused again: before it is closed. */
  letOutputFlow(): void {
    this.flowing = true
    this.resume()
  }

  /** The pty took a new size: applied after the output that came before it, as on a view. */
  resize(cols: number, rows: number): void {
    if (this.answering) screenWorkerOf().post({ t: 'resize', id: this.id, cols, rows })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    screenWorkerOf().close(this.id)
    this.letOutputFlow()
  }

  private resume(): void {
    if (!this.paused) return
    this.paused = false
    this.flow?.resume()
  }

  private refuse(reason: string): void {
    if (!this.answering) return
    this.failed = true
    // Nothing goes to the worker any more: the pty must not wait for it.
    this.letOutputFlow()
    console.warn(`[terminal] ${this.name}: main's screen refused output (${reason}); the views answer its requests from now on`)
  }
}
