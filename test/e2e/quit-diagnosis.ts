// The pure parts of the diagnosis of an app that did not quit in time (close() of launchApp in
// test/e2e/helpers.ts): the main thread's stack picked out of macOS's `sample` report, the tail of
// the app's output and the text attached to the test. When a quit hangs, the app's main process
// has usually stopped answering, so nothing can be asked of it: what its main thread is doing
// (`sample`) and what it printed last are all there is. No Electron and no Playwright here, so
// test/unit/quit-diagnosis.test.ts checks them without starting an app.

import type { StepResult } from './start-diagnosis'
import { ms } from '../time-scale'

/** How many frames of the main thread the log shows: the innermost ones, where the thread waits. */
export const QUIT_STACK_LINES = 40
/** How many of the app's last output lines the attachment keeps. */
export const QUIT_OUTPUT_LINES = 80
/** How long `sample` watches the app, in seconds. */
export const SAMPLE_SECONDS = 3
/** How long running `sample` may take in all: it reads the symbols of the app's libraries after watching. */
export const SAMPLE_TIMEOUT_MS = ms(10_000)

/** A thread's first line in a `sample` report: four spaces, the sample count, then `Thread_<id>`. */
const THREAD_HEADER = /^ {4}\d+ Thread_/
/** The tree drawing before a frame's sample count: spaces and the + ! : | of the call graph. */
const TREE_PREFIX = /^[\s+!:|]*/
/** The load addresses at the end of a frame: [0x18e0ad13c] or [0x1,0x2]. */
const ADDRESSES = /\s+\[0x[0-9a-f]+(?:,0x[0-9a-f]+)*\]$/

/**
 * The innermost `max` frames of the main thread in a `sample` report, outermost first, without the
 * tree drawing and the load addresses. The outer frames of a main thread are always the same run
 * loop (start, ElectronMain, -[NSApplication run] …); the inner ones say where it waits — a modal
 * alert, a lock, a JavaScript call. Empty when the report has no main thread.
 */
export function mainThreadStack(sample: string, max: number = QUIT_STACK_LINES): string[] {
  const lines = sample.split('\n')
  const start = lines.findIndex((line) => THREAD_HEADER.test(line) && line.includes('com.apple.main-thread'))
  if (start < 0) return []
  const frames: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '' || THREAD_HEADER.test(line)) break
    frames.push(line.replace(TREE_PREFIX, '').replace(ADDRESSES, ''))
  }
  return max > 0 ? frames.slice(-max) : []
}

/** The last `count` lines of `text`, without the empty line a final newline leaves. */
export function lastLines(text: string, count: number = QUIT_OUTPUT_LINES): string[] {
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return count > 0 ? lines.slice(-count) : []
}

/** What the diagnosis of a quit that timed out found. `sample` is undefined where there is no `sample` (off macOS, or not installed). */
export interface QuitFindings {
  quitTimeoutMs: number
  pid: number | undefined
  sample: StepResult<string> | undefined
  output: string
}

/** The lines the test log shows: what happened, and the main thread's innermost frames when there are any. */
export function quitLogLines(findings: QuitFindings): string[] {
  const head = `[quit diagnosis] the app (PID ${findings.pid ?? 'unknown'}) did not quit within ${findings.quitTimeoutMs / 1000} s`
  if (findings.sample === undefined) return [`${head}; no \`sample\` on this system: the app's output is attached`]
  if ('problem' in findings.sample) return [`${head}; \`sample\` failed: ${findings.sample.problem}`]
  const stack = mainThreadStack(findings.sample.value)
  if (stack.length === 0) return [`${head}; the \`sample\` report has no main thread: it is attached`]
  return [`${head}; the innermost ${stack.length} frames of its main thread:`, ...stack.map((frame) => `  ${frame}`)]
}

/** The text attached to the test: the log lines, the tail of the app's output, then the whole `sample` report. */
export function quitDiagnosisText(findings: QuitFindings): string {
  const tail = lastLines(findings.output)
  const parts = [quitLogLines(findings).join('\n'), `--- the last ${tail.length} lines of the app's stdout and stderr ---`, tail.join('\n')]
  if (findings.sample !== undefined && 'value' in findings.sample) parts.push(`--- sample ${findings.pid ?? ''} ${SAMPLE_SECONDS} ---`, findings.sample.value)
  return `${parts.join('\n')}\n`
}
