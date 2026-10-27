// Which data of xterm.js the user sent (TerminalNode.tsx, worfy-windows ticket 39).
//
// xterm.js sends on `onData` both what the user typed, pasted or clicked (mouse reports) and its
// own answers to the program in the shell: the device attributes on `ESC[c`, the cursor position on
// `ESC[6n`, a focus report once the program turned them on with `ESC[?1004h`, and the other reports
// of its parser. Its public API does not tell the two apart. Inside, its core service fires
// `onUserInput` right before `onData`, and for the user's data only (`triggerDataEvent` with
// `wasUserInput`, src/common/services/CoreService.ts of xterm.js 6.0.0). xterm.js is pinned to an
// exact version in package.json, and test/unit/terminal-replies.test.tsx runs the real one: when an
// update changes that inside, the test of the answers turns red.
//
// When that inside is missing, the data is told apart by its look (src/shared/terminal/cursor-answer.ts):
// the answers main gives itself (the cursor position, the device attributes, the device status,
// the state of a mode, a setting) and the colour answers count as answers. main answers the first
// kind itself and drops a marked answer (src/main/terminal/cursor-answers.ts); unmarked, the shell
// would get two answers to each. Of the colour answers main passes one per query only when they
// are marked. The price is that Shift+F3, the same bytes as a cursor position, is taken for an
// answer then. Every other answer (a focus report) counts as typed, as before ticket 39.
import type { IDisposable, Terminal } from '@xterm/xterm'
import { colourAnswers, isMainAnswer } from '../../../shared/terminal/cursor-answer'

/** The part of xterm.js's core service read here. */
interface CoreService {
  onUserInput?: unknown
}

export interface UserInputWatch {
  /**
   * Called once in each `onData` listener with its data: whether that data is the user's. When this
   * xterm.js does not say, everything but an answer of the shapes main knows is (see the head of the file).
   */
  take(data: string): boolean
  dispose(): void
}

/** Whether `data` looks like answers of xterm.js: those main gives itself, or colour answers. */
const looksLikeAnswer = (data: string): boolean => isMainAnswer(data) || colourAnswers(data) !== null

export function watchUserInput(terminal: Terminal): UserInputWatch {
  const service = (terminal as unknown as { _core?: { coreService?: CoreService } })._core?.coreService
  const event = service?.onUserInput
  if (typeof event !== 'function') return { take: (data) => !looksLikeAnswer(data), dispose: () => undefined }
  let user = false
  const subscription = (event as (listener: () => void) => IDisposable).call(service, () => {
    user = true
  })
  return {
    take: () => {
      const was = user
      user = false
      return was
    },
    dispose: () => subscription.dispose(),
  }
}
