// The e2e test of the Run history screen (test/e2e/flight-recorder.spec.ts) moves the night Run's fixture
// to a folder of the test (test/e2e/relocate-fixture.ts). On Windows that folder's path holds backslashes;
// written into the JSON strings of the transcripts as it was, every line naming the root stopped parsing,
// the agents' transcripts were skipped, and the retry #2 of impl-07 was missing on the windows-e2e job.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, win32 } from 'node:path'
import { describe, expect, it } from 'vitest'
import { comparablePath } from '../../src/shared/flight-recorder/from-gate'
import { relocatedJsonText } from '../e2e/relocate-fixture'

const NIGHT = join(import.meta.dirname, '..', 'fixtures', 'flight-recorder', 'night-run')
const NIGHT_ROOT = '/Users/someone/Stuff/CanvasForAI'
/** A test folder on the windows-e2e runner, 8.3 short name and all. */
const WIN_ROOT = win32.join('C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\worfy-e2e-flight-recorder-AbC123', 'CanvasForAI')

/** Every JSON and JSON Lines file of the fixture's folders the e2e test copies. */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}
const copied = ['data', 'claude', 'harness'].flatMap((folder) => files(join(NIGHT, folder)))

/** The JSON values of a file: one per line for JSON Lines. */
const values = (path: string, text: string): unknown[] => (path.endsWith('.jsonl') ? text.split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as unknown) : [JSON.parse(text) as unknown])

describe('relocatedJsonText', () => {
  it('moves the night Run to a Windows folder with every line still JSON, and the root in place in each value', () => {
    let moved = 0
    for (const path of copied) {
      const text = readFileSync(path, 'utf8')
      const relocated = relocatedJsonText(text, NIGHT_ROOT, WIN_ROOT)
      expect(() => values(path, relocated), path).not.toThrow()
      // Each value holds the Windows root where the recorded one was: the same values, the root swapped.
      expect(JSON.stringify(values(path, relocated)), path).toBe(JSON.stringify(values(path, text)).replaceAll(JSON.stringify(NIGHT_ROOT).slice(1, -1), JSON.stringify(WIN_ROOT).slice(1, -1)))
      moved += text.split(NIGHT_ROOT).length - 1
    }
    // The fixture names its root in hundreds of places (cwd of every transcript line, the worktrees).
    expect(moved).toBeGreaterThan(300)
  })

  it('a worktree of the moved transcripts compares as the Windows path it is', () => {
    const line = JSON.stringify({ cwd: `${NIGHT_ROOT}/.claude/worktrees/07` })
    const { cwd } = JSON.parse(relocatedJsonText(line, NIGHT_ROOT, WIN_ROOT)) as { cwd: string }
    expect(cwd).toBe(`${WIN_ROOT}/.claude/worktrees/07`)
    expect(comparablePath(cwd, 'win32')).toBe('c:/users/runner~1/appdata/local/temp/worfy-e2e-flight-recorder-abc123/canvasforai/.claude/worktrees/07')
  })

  it('the root written into the JSON as it is, the way the e2e test did before, breaks the lines', () => {
    const line = JSON.stringify({ cwd: NIGHT_ROOT })
    expect(() => JSON.parse(line.replaceAll(NIGHT_ROOT, WIN_ROOT)) as unknown).toThrow()
    expect(relocatedJsonText(line, NIGHT_ROOT, '/tmp/x/CanvasForAI')).toBe(line.replaceAll(NIGHT_ROOT, '/tmp/x/CanvasForAI'))
  })
})
