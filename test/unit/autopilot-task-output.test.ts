// The output file of a background task as a sign of life (worfy-polish ticket 61): which file a tool result names,
// the marks of the live tasks' files, and when two marks tell a change.
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { outputChanged, outputMarks, rememberTaskOutputs, taskOutputFiles, type OutputMarks } from '../../src/main/autopilot/task-output'

describe('taskOutputFiles', () => {
  it('reads the file of a Bash started in the background, as Claude Code words it', () => {
    const text =
      'Command running in background with ID: b4k4f6mfi. Output is being written to: /private/tmp/claude-501/-Users-a-repo/6e11ae60/tasks/b4k4f6mfi.output. You will be notified when it completes. To check interim output, use Read on that file path.'
    expect(taskOutputFiles(text)).toEqual(new Map([['b4k4f6mfi', '/private/tmp/claude-501/-Users-a-repo/6e11ae60/tasks/b4k4f6mfi.output']]))
  })

  it('keeps a Windows path whole, spaces and all', () => {
    const text = 'Command running in background with ID: b9x. Output is being written to: C:\\Users\\John Doe\\AppData\\Local\\Temp\\claude\\F--SWE-worfy\\s1\\tasks\\b9x.output. You will be notified when it completes.'
    expect(taskOutputFiles(text)).toEqual(new Map([['b9x', 'C:\\Users\\John Doe\\AppData\\Local\\Temp\\claude\\F--SWE-worfy\\s1\\tasks\\b9x.output']]))
  })

  it('reads a forward-slash Windows path', () => {
    expect(taskOutputFiles('written to: D:/tmp/tasks/d1.output')).toEqual(new Map([['d1', 'D:/tmp/tasks/d1.output']]))
  })

  it('names no UNC path, in either slash: a stat of it on the main thread could wait on another host', () => {
    expect(taskOutputFiles('written to: \\\\host\\share\\tasks\\u1.output.')).toEqual(new Map())
    expect(taskOutputFiles('written to: //host/share/tasks/u2.output')).toEqual(new Map())
    expect(taskOutputFiles('see \\\\host\\share\\tasks\\u3.output')).toEqual(new Map())
  })

  it('the first path named for a task id wins, in one text too', () => {
    expect(taskOutputFiles('written to: /a/tasks/t1.output\nwritten to: /b/tasks/t1.output')).toEqual(new Map([['t1', '/a/tasks/t1.output']]))
  })

  it('a path longer than the look-back is cut and so not named; a word cut by the look-back is not taken for a path', () => {
    const deep = `/${'d/'.repeat(1000)}tasks/deep.output`
    expect(taskOutputFiles(`written to: ${deep}`)).toEqual(new Map())
    // A relative word longer than the look-back: wherever the look-back starts in it, a slash or not, it is no path.
    expect(taskOutputFiles(`x${'/a'.repeat(3000)}/tasks/cut.output`)).toEqual(new Map())
    expect(taskOutputFiles(`xy${'/a'.repeat(3000)}/tasks/cut.output`)).toEqual(new Map())
  })

  it('without «: » before it, the path is the last word; several files on several lines each count', () => {
    const text = 'agentId: a1 output_file: /tmp/s/tasks/a1.output\nsee /tmp/s/tasks/a2.output for more'
    expect(taskOutputFiles(text)).toEqual(
      new Map([
        ['a1', '/tmp/s/tasks/a1.output'],
        ['a2', '/tmp/s/tasks/a2.output'],
      ]),
    )
  })

  it('takes the last word when the text after «: » is not a path', () => {
    expect(taskOutputFiles('Note: the log is /tmp/s/tasks/n1.output')).toEqual(new Map([['n1', '/tmp/s/tasks/n1.output']]))
  })

  it('names nothing for a relative path, a file not under tasks, a longer extension, or no path at all', () => {
    expect(taskOutputFiles('written to: tmp/tasks/r1.output')).toEqual(new Map())
    expect(taskOutputFiles('written to: /tmp/s/logs/l1.output')).toEqual(new Map())
    expect(taskOutputFiles('written to: /tmp/s/tasks/x1.outputs')).toEqual(new Map())
    expect(taskOutputFiles('0 problems')).toEqual(new Map())
  })
})

describe('the cost grows with the text, not with its square (it runs on the main thread for every tool result)', () => {
  // A generous bound, far above the linear cost (a few ms) and far below the quadratic one (seconds): not a tuned timeout.
  const BOUND_MS = 100

  it('a 200 000-character word before a path', () => {
    const text = `Output is being written to: ${'x'.repeat(200_000)} /tmp/s/tasks/long.output.`
    const started = performance.now()
    const found = taskOutputFiles(text)
    const took = performance.now() - started
    expect(found).toEqual(new Map([['long', '/tmp/s/tasks/long.output']]))
    expect(took).toBeLessThan(BOUND_MS)
  })

  it('5000 paths on one line', () => {
    const text = Array.from({ length: 5000 }, (_, index) => `/tmp/s/tasks/t${index}.output`).join(' ')
    const started = performance.now()
    const found = taskOutputFiles(text)
    const took = performance.now() - started
    expect(found.size).toBe(5000)
    expect(found.get('t4999')).toBe('/tmp/s/tasks/t4999.output')
    expect(took).toBeLessThan(BOUND_MS)
  })
})

describe('rememberTaskOutputs', () => {
  it('adds the files a tool result names and keeps a path already known for a task id', () => {
    const files = new Map([['t1', '/first/tasks/t1.output']])
    rememberTaskOutputs(files, 'written to: /later/tasks/t1.output\nwritten to: /tmp/tasks/t2.output')
    expect(files).toEqual(
      new Map([
        ['t1', '/first/tasks/t1.output'],
        ['t2', '/tmp/tasks/t2.output'],
      ]),
    )
  })
})

describe('outputMarks', () => {
  let dir: string
  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-task-output-')))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('marks the known files of the given tasks: size and modification time; null for a file that cannot be read', async () => {
    const live = join(dir, 'live.output')
    writeFileSync(live, 'abc')
    await utimes(live, 1_000, 2_000)
    const files = new Map([
      ['live', live],
      ['gone', join(dir, 'gone.output')],
      ['ended', join(dir, 'ended.output')],
    ])
    const marks = outputMarks(files, [{ taskId: 'live' }, { taskId: 'gone' }, { taskId: 'unknown' }])
    expect(marks).toEqual(
      new Map([
        ['live', { size: 3, mtimeMs: 2_000_000 }],
        ['gone', null],
      ]),
    )
  })
})

describe('outputChanged', () => {
  const mark = (size: number, mtimeMs: number) => ({ size, mtimeMs })
  const marks = (entries: [string, ReturnType<typeof mark> | null][]): OutputMarks => new Map(entries)

  it('the same size and time: no change', () => {
    expect(outputChanged(marks([['t', mark(3, 10)]]), marks([['t', mark(3, 10)]]))).toBe(false)
  })

  it('a file that grew, shrank or was written again is a change', () => {
    expect(outputChanged(marks([['t', mark(3, 10)]]), marks([['t', mark(4, 10)]]))).toBe(true)
    expect(outputChanged(marks([['t', mark(3, 10)]]), marks([['t', mark(0, 10)]]))).toBe(true)
    expect(outputChanged(marks([['t', mark(3, 10)]]), marks([['t', mark(3, 11)]]))).toBe(true)
  })

  it('a file that appeared since — unreadable or unknown before — is a change', () => {
    expect(outputChanged(marks([['t', null]]), marks([['t', mark(0, 10)]]))).toBe(true)
    expect(outputChanged(marks([]), marks([['t', mark(0, 10)]]))).toBe(true)
  })

  it('a file that cannot be read now, or no file at all, is no change', () => {
    expect(outputChanged(marks([['t', mark(3, 10)]]), marks([['t', null]]))).toBe(false)
    expect(outputChanged(marks([['t', mark(3, 10)]]), marks([]))).toBe(false)
  })

  it('one changed file among unchanged ones is a change', () => {
    expect(
      outputChanged(
        marks([
          ['a', mark(1, 1)],
          ['b', mark(2, 2)],
        ]),
        marks([
          ['a', mark(1, 1)],
          ['b', mark(5, 2)],
        ]),
      ),
    ).toBe(true)
  })
})
