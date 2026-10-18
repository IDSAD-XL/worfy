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
// The screen may refuse output: xterm.js throws "write data discarded" once more than 50 MB wait
// to be parsed. Then main stops answering for that shell (`answering` is false, a warning is
// logged once) and the views' marked answers reach the shell again (TerminalRegistry.write): a
// position from a screen that skipped output would be wrong, and the shell's output itself never
// depends on this screen.
import { createRequire } from 'node:module'
import { isCursorAnswer } from '../../shared/terminal/cursor-answer'

export { isCursorAnswer }

type Headless = typeof import('@xterm/headless')

/** Lines kept above the visible rows; see the head of the file. */
export const SCROLLBACK = 1000

let headless: Headless | undefined
/** The package is CommonJS that marks itself as a transpiled module: Node's import finds no named export in it. */
function loadHeadless(): Headless {
  headless ??= createRequire(import.meta.url)('@xterm/headless') as Headless
  return headless
}

/** Follows the output of one shell and answers its cursor-position requests through `answer`. */
export class CursorAnswers {
  private readonly screen: InstanceType<Headless['Terminal']>
  private disposed = false
  /** The screen refused output: its position is no longer the shell's. */
  private failed = false

  /** `name` is the shell's, for the warning when the screen refuses output. */
  constructor(
    size: { cols: number; rows: number },
    answer: (data: string) => void,
    private readonly name = 'terminal',
  ) {
    const { Terminal } = loadHeadless()
    this.screen = new Terminal({ cols: size.cols, rows: size.rows, scrollback: SCROLLBACK, allowProposedApi: false })
    this.screen.onData((data) => {
      if (this.answering && isCursorAnswer(data)) answer(data)
    })
  }

  /** Whether main answers this shell's cursor requests: not after the screen refused output, nor after dispose. */
  get answering(): boolean {
    return !this.disposed && !this.failed
  }

  /** Output of the shell, in the order it came. Never throws: a refused chunk ends the answers instead. */
  feed(data: string): void {
    this.guard(() => this.screen.write(data))
  }

  /** The pty took a new size: applied after the output that came before it, as on a view. */
  resize(cols: number, rows: number): void {
    this.guard(() =>
      this.screen.write('', () => {
        if (this.answering) this.screen.resize(cols, rows)
      }),
    )
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.screen.dispose()
  }

  private guard(step: () => void): void {
    if (!this.answering) return
    try {
      step()
    } catch (error) {
      this.failed = true
      console.warn(`[terminal] ${this.name}: main's screen refused output; the views answer the cursor-position requests from now on`, error)
    }
  }
}
