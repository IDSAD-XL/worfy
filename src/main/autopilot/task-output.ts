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
/** An absolute path on macOS and Linux, or on Windows: a drive letter, or a UNC path. */
const ABSOLUTE = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/

/**
 * The output files a tool result names, by task id: absolute paths that end in `tasks/<id>.output`. A path runs from
 * the last «: » before that end (so a Windows path with spaces in it stays whole), or else from the last space.
 */
export function taskOutputFiles(text: string): Map<string, string> {
  const found = new Map<string, string>()
  for (const match of text.matchAll(OUTPUT_FILE)) {
    const end = match.index + match[0].length
    const line = text.slice(text.lastIndexOf('\n', match.index) + 1, end)
    const colon = line.lastIndexOf(': ')
    const space = line.search(/\S+$/)
    const candidates = [colon >= 0 ? line.slice(colon + 2) : null, space >= 0 ? line.slice(space) : null]
    const path = candidates.find((candidate): candidate is string => candidate !== null && ABSOLUTE.test(candidate))
    if (path !== undefined) found.set(match[1]!, path)
  }
  return found
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
