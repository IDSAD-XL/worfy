// quietFor (src/shared/agent/quiet.ts, worfy-stuck-agents ticket 03): how long a turn of a Session has gone
// without a sign of life, and what is no quiet at all; and the reads of main that feed it from files.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { gateOutputAt, lockHeld, outsideSignsReader, taskOutputAt } from '../../src/main/agent/session/quiet-signs'
import { gateTag } from '../../src/main/gate/state'
import { QUIET_MARK_MS, quietFor, quietSince, type QuietFacts } from '../../src/shared/agent/quiet'

const MIN = 60_000
const NOW = 1_790_000_000_000
/** The threshold of these tests: shorter than the app's, as a test passes its own. */
const THRESHOLD = 5 * MIN

/** A busy Session whose last sign of life was `ago` ms before NOW, with nothing else going on. */
const busy = (ago: number, more: Partial<QuietFacts> = {}): QuietFacts => ({
  state: 'busy',
  lastSignAt: NOW - ago,
  openHooks: 0,
  taskOutputAt: null,
  gateOutputAt: null,
  e2eLockHeld: false,
  ...more,
})

describe('quietFor', () => {
  it('a busy turn without a sign of life for 11 minutes has been quiet 11 minutes', () => {
    expect(quietFor(NOW, busy(11 * MIN), THRESHOLD)).toBe(11 * MIN)
  })

  it('is zero for a Session that runs no turn', () => {
    for (const state of ['idle', 'starting', 'error', 'closed'] as const) expect(quietFor(NOW, busy(11 * MIN, { state }), THRESHOLD)).toBe(0)
  })

  it('is zero while a permission request is open: the turn waits for a person', () => {
    expect(quietFor(NOW, busy(11 * MIN, { state: 'needs_permission' }), THRESHOLD)).toBe(0)
  })

  it('is zero while a hook has started and not ended', () => {
    expect(quietFor(NOW, busy(11 * MIN, { openHooks: 1 }), THRESHOLD)).toBe(0)
  })

  it('is zero when the output file of a live background task grew within the threshold', () => {
    expect(quietFor(NOW, busy(11 * MIN, { taskOutputAt: NOW - 2 * MIN }), THRESHOLD)).toBe(0)
  })

  it('is zero when the output of the gate of the Session’s worktree grew within the threshold', () => {
    expect(quietFor(NOW, busy(11 * MIN, { gateOutputAt: NOW - 2 * MIN }), THRESHOLD)).toBe(0)
  })

  it('is zero while the e2e lock has a live holder, and counts while its holder is dead', () => {
    expect(quietFor(NOW, busy(11 * MIN, { e2eLockHeld: true }), THRESHOLD)).toBe(0)
    expect(quietFor(NOW, busy(11 * MIN, { e2eLockHeld: false }), THRESHOLD)).toBe(11 * MIN)
  })

  it('an output file that stopped growing before the threshold counts from its last change', () => {
    expect(quietFor(NOW, busy(30 * MIN, { taskOutputAt: NOW - 12 * MIN }), THRESHOLD)).toBe(12 * MIN)
    expect(quietFor(NOW, busy(30 * MIN, { gateOutputAt: NOW - 12 * MIN }), THRESHOLD)).toBe(12 * MIN)
  })

  it('takes QUIET_MARK_MS, 10 minutes, as its threshold when none is given', () => {
    expect(QUIET_MARK_MS).toBe(10 * MIN)
    expect(quietFor(NOW, busy(30 * MIN, { taskOutputAt: NOW - 9 * MIN }))).toBe(0)
    expect(quietFor(NOW, busy(30 * MIN, { taskOutputAt: NOW - 11 * MIN }))).toBe(11 * MIN)
  })
})

describe('quietSince', () => {
  it('is when the quiet began once it lasts the threshold, and null before', () => {
    expect(quietSince(NOW, busy(11 * MIN), THRESHOLD)).toBe(NOW - 11 * MIN)
    expect(quietSince(NOW, busy(4 * MIN), THRESHOLD)).toBeNull()
    expect(quietSince(NOW, busy(11 * MIN, { state: 'idle' }), THRESHOLD)).toBeNull()
  })
})

describe('the signs of life outside the agent’s events (src/main/agent/session/quiet-signs.ts)', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(realpathSync(tmpdir()), 'worfy-quiet-'))
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('the latest change of the output files of the live background tasks; null when none can be read', () => {
    const one = join(root, 'a.output')
    const two = join(root, 'b.output')
    writeFileSync(one, 'x')
    writeFileSync(two, 'y')
    utimesSync(one, new Date(NOW - 5 * MIN), new Date(NOW - 5 * MIN))
    utimesSync(two, new Date(NOW - 2 * MIN), new Date(NOW - 2 * MIN))
    expect(taskOutputAt(new Map([['a', one], ['b', two]]))).toBe(NOW - 2 * MIN)
    expect(taskOutputAt(new Map([['gone', join(root, 'gone.output')]]))).toBeNull()
  })

  it('the latest change of the gate output of the worktree, not of another one', async () => {
    const worktree = join(root, 'worktree')
    const state = join(root, 'gate', 'state')
    mkdirSync(worktree)
    mkdirSync(state, { recursive: true })
    const gateDir = () => join(root, 'gate')
    expect(await gateOutputAt(worktree, gateDir)).toBeNull()
    const ours = join(state, `.run-${gateTag(worktree)}-123.out`)
    const theirs = join(state, `.run-${gateTag(root)}-456.out`)
    writeFileSync(ours, 'lint')
    writeFileSync(theirs, 'lint')
    utimesSync(ours, new Date(NOW - 3 * MIN), new Date(NOW - 3 * MIN))
    utimesSync(theirs, new Date(NOW - MIN), new Date(NOW - MIN))
    expect(await gateOutputAt(worktree, gateDir)).toBe(NOW - 3 * MIN)
    expect(await gateOutputAt(join(root, 'nowhere'), gateDir)).toBeNull()
  })

  it('an e2e lock is held while its holder on this machine runs; a dead holder, another machine or no holder.json is not', async () => {
    const holder = (record: Record<string, unknown>) => writeFileSync(join(root, 'holder.json'), JSON.stringify(record))
    expect(await lockHeld(root)).toBe(false)
    holder({ prs: [1], pid: process.pid, host: hostname() })
    expect(await lockHeld(root)).toBe(true)
    holder({ prs: [1], pid: process.pid })
    expect(await lockHeld(root)).toBe(true)
    holder({ prs: [1], pid: 2 ** 30, host: hostname() })
    expect(await lockHeld(root)).toBe(false)
    holder({ prs: [1], pid: 2 ** 30, host: hostname(), child: process.pid })
    expect(await lockHeld(root)).toBe(true)
    holder({ prs: [1], pid: process.pid, host: `not-${hostname()}` })
    expect(await lockHeld(root)).toBe(false)
  })

  it('reads the Profile’s e2e lock once per reader, and a held lock is a sign of life', async () => {
    writeFileSync(join(root, 'holder.json'), JSON.stringify({ prs: [1], pid: process.pid, host: hostname() }))
    let asked = 0
    const lockFolderOf = () => {
      asked += 1
      return Promise.resolve(root)
    }
    const read = outsideSignsReader(lockFolderOf, () => join(root, 'gate'))
    const place = { cwd: root, taskOutputs: new Map<string, string>() }
    expect(await read(place)).toEqual({ taskOutputAt: null, gateOutputAt: null, e2eLockHeld: true })
    rmSync(join(root, 'holder.json'))
    expect(await read(place)).toEqual({ taskOutputAt: null, gateOutputAt: null, e2eLockHeld: false })
    expect(asked).toBe(1)
  })
})
