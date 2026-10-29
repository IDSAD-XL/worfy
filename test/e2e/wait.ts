import { expect, type Locator, type Page } from '@playwright/test'
import { editedLine } from './terminal-ai-helpers'
import { ms } from '../time-scale'

// Waits on the app's own state instead of on the clock. A fixed pause is either too short under
// load (the test turns red) or longer than needed (the test is slow); these helpers end when the
// thing they wait for has happened.

/** Resolves after the renderer has drawn `count` more frames, so what the last event changed is on screen. */
export function nextFrames(window: Page, count = 2): Promise<void> {
  return window.evaluate(
    (left) =>
      new Promise<void>((resolve) => {
        const page = globalThis as unknown as { requestAnimationFrame(callback: () => void): void }
        const step = (n: number): void => {
          if (n <= 0) resolve()
          else page.requestAnimationFrame(() => step(n - 1))
        }
        step(left)
      }),
    count,
  )
}

/**
 * Resolves once the renderer has caught up with main: the effects of the last input have run, every
 * request the renderer had sent to main before the call has been answered, every event main had
 * sent before that answer has been handled, and the result is drawn.
 *
 * Messages between one window and main keep their order in both directions, so the answer to a
 * request sent now comes after the answers to every request sent earlier and after every event
 * main emitted before it. A change that comes back from main later than that (a timer in main, a
 * file watcher, a second process) is not covered: wait for its own sign instead.
 */
export async function settled(window: Page): Promise<void> {
  await nextFrames(window)
  await window.evaluate(() => (globalThis as unknown as { worfy: { invoke(channel: string): Promise<unknown> } }).worfy.invoke('app.version'))
  await nextFrames(window)
}

/**
 * Resolves once the shell of a Terminal Node has read everything written to it so far. A key typed
 * now reaches the shell after every earlier write, so once the shell echoes it at the end of the
 * line, the earlier writes have been read, and a command among them would have run and printed.
 * The key is taken back with Backspace, and the line is `line` again, as before the call.
 */
export async function shellCaughtUp(window: Page, node: Locator, line: string): Promise<void> {
  await window.keyboard.type('x')
  await expect.poll(() => editedLine(node), { timeout: ms(10_000) }).toBe(`${line}x`)
  await window.keyboard.press('Backspace')
  await expect.poll(() => editedLine(node), { timeout: ms(10_000) }).toBe(line)
}
