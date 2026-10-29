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
/** How long reading the app's processes on Windows may take: one PowerShell listing of every process. */
export const PROCESSES_TIMEOUT_MS = ms(10_000)
/** How many characters of a process's command line the list keeps. */
export const COMMAND_LINE_CHARS = 160

/**
 * The PowerShell that prints process `pid` and its descendants, one line each: pid, parent, threads,
 * name, command line (cut to COMMAND_LINE_CHARS). A process that names itself as its parent is skipped
 * as a child, so the walk ends. A process older than its recorded parent is not a child: Windows hands
 * a freed pid out again, and a leftover whose parent died would otherwise look like the app's.
 */
export function processTreeScript(pid: number): string {
  return [
    '$all = @(Get-CimInstance Win32_Process)',
    `$ids = @{ ${pid} = $true }`,
    '$born = @{}; foreach ($p in $all) { $born[[int]$p.ProcessId] = $p.CreationDate }',
    'do { $before = $ids.Count; foreach ($p in $all) { if ($ids.ContainsKey([int]$p.ParentProcessId) -and $p.ProcessId -ne $p.ParentProcessId -and $p.CreationDate -ge $born[[int]$p.ParentProcessId]) { $ids[[int]$p.ProcessId] = $true } } } while ($ids.Count -gt $before)',
    `foreach ($p in $all) { if ($ids.ContainsKey([int]$p.ProcessId)) { $c = "$($p.CommandLine)"; if ($c.Length -gt ${COMMAND_LINE_CHARS}) { $c = $c.Substring(0, ${COMMAND_LINE_CHARS}) }; "$($p.ProcessId) parent=$($p.ParentProcessId) threads=$($p.ThreadCount) $($p.Name) $c".TrimEnd() } }`,
  ].join('; ')
}

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

/**
 * What the diagnosis of a quit that timed out found. `sample` is undefined where there is no `sample`
 * (off macOS, or not installed). `processes` is the app's process and its descendants, one per line
 * (pid, parent, threads, name, command line), read on Windows only, where there is no `sample`.
 */
export interface QuitFindings {
  quitTimeoutMs: number
  pid: number | undefined
  sample: StepResult<string> | undefined
  processes?: StepResult<string> | undefined
  output: string
}

/** The log lines of the app's processes: which of them were still there when the quit timed out. */
function processLines(processes: StepResult<string> | undefined): string[] {
  if (processes === undefined) return []
  if ('problem' in processes) return [`  its processes could not be read: ${processes.problem}`]
  const lines = lastLines(processes.value, Number.POSITIVE_INFINITY)
  if (lines.length === 0) return ['  its processes: none found']
  return ['  its processes (pid, parent, threads, name, command line):', ...lines.map((line) => `    ${line}`)]
}

/** The lines the test log shows: what happened, and the main thread's innermost frames when there are any. */
export function quitLogLines(findings: QuitFindings): string[] {
  const head = `[quit diagnosis] the app (PID ${findings.pid ?? 'unknown'}) did not quit within ${findings.quitTimeoutMs / 1000} s`
  if (findings.sample === undefined) return [`${head}; no \`sample\` on this system: the app's output is attached`, ...processLines(findings.processes)]
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
