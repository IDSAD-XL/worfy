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
import type { IDisposable, Terminal } from '@xterm/xterm'

/** The part of xterm.js's core service read here. */
interface CoreService {
  onUserInput?: unknown
}

export interface UserInputWatch {
  /**
   * Called once in each `onData` listener: whether the data that came is the user's. True for every
   * piece of data when this xterm.js does not say, as before the watch was there.
   */
  take(): boolean
  dispose(): void
}

export function watchUserInput(terminal: Terminal): UserInputWatch {
  const service = (terminal as unknown as { _core?: { coreService?: CoreService } })._core?.coreService
  const event = service?.onUserInput
  if (typeof event !== 'function') return { take: () => true, dispose: () => undefined }
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
