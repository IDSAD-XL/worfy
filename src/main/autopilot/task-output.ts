// A sign of life of a background task that sends no events (worfy-polish ticket 61, ADR-0029 amendment).
//
// A Bash started with run_in_background sends no task_progress: a gate full that runs for an hour looks, by the
// Session's events alone, the same as a hung one. What it does have is its output file: Claude Code writes the command's
// output there as it comes, and the tool result that started the task names the file —
//   «Command running in background with ID: b4k4f6mfi. Output is being written to: /…/tasks/b4k4f6mfi.output. …»
// (the Agent tool's names its own the same way). The run remembers these files by task id, takes their size and
// modification time when it sets the limit of the wait, and looks again when the limit runs out: a file that changed in
// between is a task at work.
//
// Only the file system, never the processes of the OS: the same code on macOS, Linux and Windows. A path that cannot
// be read (the text changed shape, the file is gone) gives no sign of life, so the run stops as it did before. The
// marks are taken at once (statSync of a few local temporary files): the mark of the limit's start is of that moment,
// not of a later one when an asynchronous stat would have come back, so a line written right after it counts.
import { statSync } from 'node:fs'

/** The size and modification time of one output file; null when it cannot be read. */
export interface OutputMark {
  size: number
  mtimeMs: number
}

/** The marks of the live tasks' output files, by task id; a task whose file is not known has no entry. */
export type OutputMarks = ReadonlyMap<string, OutputMark | null>

const OUTPUT_FILE = /[\\/]tasks[\\/]([\w-]+)\.output(?![\w-])/g
/**
 * A local absolute path: from the root on macOS and Linux, or from a drive letter on Windows. Never a UNC path
 * (`\\host\share`, `//host/share`): its stat on the main thread could wait on another host.
 */
const LOCAL_ABSOLUTE = /^(?:\/(?!\/)|[A-Za-z]:[\\/])/
/**
 * How far before the end of `tasks/<id>.output` its path may start (PATH_MAX of macOS; Windows paths are shorter). The
 * bound keeps the cost linear in the text: the scan runs on the main thread for every tool result.
 */
export const LOOK_BACK = 1024

/** Where the last white space of `line` is; -1 when it has none. */
function lastSpace(line: string): number {
  for (let index = line.length - 1; index >= 0; index -= 1) if (/\s/.test(line[index]!)) return index
  return -1
}

/**
 * The output files a tool result names, by task id: local absolute paths that end in `tasks/<id>.output`. A path runs
 * from the last «: » before that end (so a Windows path with spaces in it stays whole), or else from the last space;
 * neither is looked for further back than LOOK_BACK. The first path named for a task id wins.
 */
export function taskOutputFiles(text: string): Map<string, string> {
  const found = new Map<string, string>()
  for (const match of text.matchAll(OUTPUT_FILE)) {
    const taskId = match[1]!
    if (found.has(taskId)) continue
    const from = Math.max(0, match.index - LOOK_BACK)
    const before = text.slice(from, match.index + match[0].length)
    const newline = before.lastIndexOf('\n')
    const line = before.slice(newline + 1)
    // The line starts within the look-back (or with the text): its first word is whole, and may be the path.
    const whole = newline >= 0 || from === 0
    const colon = line.lastIndexOf(': ')
    const space = lastSpace(line)
    const candidates = [colon >= 0 ? line.slice(colon + 2) : null, space >= 0 ? line.slice(space + 1) : whole ? line : null]
    const path = candidates.find((candidate): candidate is string => candidate !== null && LOCAL_ABSOLUTE.test(candidate))
    if (path !== undefined) found.set(taskId, path)
  }
  return found
}

/** Adds the output files `text` names to `files`; a task id that already has one keeps it. */
export function rememberTaskOutputs(files: Map<string, string>, text: string): void {
  for (const [taskId, path] of taskOutputFiles(text)) if (!files.has(taskId)) files.set(taskId, path)
}

function markOf(path: string): OutputMark | null {
  try {
    const info = statSync(path)
    return { size: info.size, mtimeMs: info.mtimeMs }
  } catch {
    return null
  }
}

/** The marks of the output files of `tasks` that `files` knows. */
export function outputMarks(files: ReadonlyMap<string, string>, tasks: readonly { taskId: string }[]): OutputMarks {
  return new Map(
    tasks.flatMap((task) => {
      const path = files.get(task.taskId)
      return path === undefined ? [] : [[task.taskId, markOf(path)] as const]
    }),
  )
}

/** Whether a task's output file changed from `before` to `after`: it appeared, grew, shrank or was written again. */
export function outputChanged(before: OutputMarks, after: OutputMarks): boolean {
  for (const [taskId, mark] of after) {
    if (mark === null) continue
    const was = before.get(taskId) ?? null
    if (was === null || was.size !== mark.size || was.mtimeMs !== mark.mtimeMs) return true
  }
  return false
}
