// The output file of a background task as a sign of life (worfy-polish ticket 61): which file a tool result names,
// the marks of the live tasks' files, and when two marks tell a change.
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { outputChanged, outputMarks, taskOutputFiles, type OutputMarks } from '../../src/main/autopilot/task-output'

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

  it('reads a UNC path and a forward-slash Windows path', () => {
    expect(taskOutputFiles('written to: \\\\host\\share\\tasks\\u1.output.')).toEqual(new Map([['u1', '\\\\host\\share\\tasks\\u1.output']]))
    expect(taskOutputFiles('written to: D:/tmp/tasks/d1.output')).toEqual(new Map([['d1', 'D:/tmp/tasks/d1.output']]))
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
