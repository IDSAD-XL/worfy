// The pure part of the gate-log and local-verdict readers (src/shared/flight-recorder/from-gate.ts;
// worfy-flight-recorder ticket 16): a timings.json into a `gate` span with a `script` per step and
// the outcome, the `gate:` commit subjects into verdicts, the marks file and a branch's reflog into
// Ticket events, and the canonical form of a worktree path on Windows and elsewhere. The facts are
// literals, no file or git is read.
import { readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { branchEvents, comparablePath, gateRunFacts, gateVerdict, GREEN_CACHE_NOTE, markEvents, parseReflog, parseTimings, type GateTimings, type ReflogEntry } from '../../src/shared/flight-recorder/from-gate'

const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)

function timings(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    profile: 'full',
    key: 'worfy',
    worktree: '/Users/someone/repo/.claude/worktrees/03',
    head: SHA_A,
    outcome: 'green',
    exit: 0,
    at: '2026-10-17T12:00:00Z',
    total_ms: 400_000,
    steps: [
      { step: 'worfy/.:lint', package: '.', script: 'lint', ms: 20_000, exit: 0 },
      { step: 'worfy/.:typecheck', package: '.', script: 'typecheck', ms: 80_000, exit: 0 },
      { step: 'worfy/.:test', package: '.', script: 'test', ms: 200_000, exit: 0 },
    ],
    cached: [],
    ...over,
  })
}

const parsed = (over: Record<string, unknown> = {}): GateTimings => {
  const record = parseTimings(timings(over))
  if (record === null) throw new Error('not parsed')
  return record
}

describe('a timings.json as a gate span', () => {
  it('gives a `gate` span with three `script` steps under it, the steps back to back up to `at`', () => {
    const facts = gateRunFacts(parsed(), 'tag1/run1', '/w/03')
    expect(facts.map((fact) => [fact.kind, fact.name, fact.start, fact.end, fact.outcome])).toEqual([
      ['gate', 'gate full', '2026-10-17T11:53:20.000Z', '2026-10-17T12:00:00.000Z', 'ok'],
      ['script', 'lint', '2026-10-17T11:55:00.000Z', '2026-10-17T11:55:20.000Z', 'ok'],
      ['script', 'typecheck', '2026-10-17T11:55:20.000Z', '2026-10-17T11:56:40.000Z', 'ok'],
      ['script', 'test', '2026-10-17T11:56:40.000Z', '2026-10-17T12:00:00.000Z', 'ok'],
    ])
    const [gate, ...steps] = facts
    expect(gate).toMatchObject({ id: 'tag1/run1', sha: SHA_A, worktree: '/w/03', startSource: 'gate-log', endSource: 'gate-log', note: GREEN_CACHE_NOTE })
    expect(gate?.ticket).toBeUndefined()
    expect(steps.map((step) => [step.id, step.parentWork])).toEqual([
      ['tag1/run1/1', { kind: 'gate', id: 'tag1/run1' }],
      ['tag1/run1/2', { kind: 'gate', id: 'tag1/run1' }],
      ['tag1/run1/3', { kind: 'gate', id: 'tag1/run1' }],
    ])
  })

  it('takes the outcome from `outcome`: red fails with the failed steps, not verified fails with its reason', () => {
    const red = gateRunFacts(parsed({ outcome: 'red', exit: 2, steps: [{ step: 'worfy/.:lint', package: '.', script: 'lint', ms: 1000, exit: 0 }, { step: 'worfy/.:test', package: '.', script: 'test', ms: 2000, exit: 1 }, { step: 'worfy/app:build', package: 'app', script: 'build', ms: 3000, exit: 2 }] }), 'r', '/w')
    expect(red.map((fact) => [fact.name, fact.outcome, fact.reason])).toEqual([
      ['gate full', 'failed', 'red: test (exit 1), app:build (exit 2)'],
      ['lint', 'ok', undefined],
      ['test', 'failed', 'exit 1'],
      ['app:build', 'failed', 'exit 2'],
    ])
    expect(gateRunFacts(parsed({ outcome: 'unverified' }), 'u', '/w')[0]).toMatchObject({ outcome: 'failed', reason: 'not verified: environment unavailable' })
    expect(gateRunFacts(parsed({ outcome: 'green' }), 'g', '/w')[0]?.reason).toBeUndefined()
  })

  it('names the scripts the green cache answered for, and has no sha without a head', () => {
    const [gate] = gateRunFacts(parsed({ head: null, cached: [{ step: 'worfy/.:lint', ms: 9000, at: '2026-10-17T11:00:00Z' }] }), 'c', '/w')
    expect(gate?.note).toBe(`${GREEN_CACHE_NOTE}; from the green cache in this run: worfy/.:lint`)
    expect(gate && 'sha' in gate).toBe(false)
  })

  it('reads no broken file and no other version', () => {
    expect(parseTimings('{not json')).toBeNull()
    expect(parseTimings(timings({ version: 2 }))).toBeNull()
    expect(parseTimings(timings({ at: 'yesterday' }))).toBeNull()
    expect(parseTimings(timings({ outcome: 'purple' }))).toBeNull()
    expect(parseTimings(timings())?.head).toBe(SHA_A)
  })
})

describe('verdicts without a PR', () => {
  it('reads the gate: commit subjects of local-green, MAX-REVIEW aside', () => {
    expect(gateVerdict('gate: VERIFIED')).toEqual({ verdict: 'success' })
    expect(gateVerdict('gate: NARROW: VERIFIED')).toEqual({ verdict: 'success' })
    expect(gateVerdict('gate: REJECTED: [high] x is wrong')).toEqual({ verdict: 'failure', reason: 'REJECTED: [high] x is wrong' })
    expect(gateVerdict('gate: NARROW: REJECTED: y')).toEqual({ verdict: 'failure', reason: 'NARROW: REJECTED: y' })
    expect(gateVerdict('gate: MAX-REVIEW: REJECTED: z')).toBeNull()
    expect(gateVerdict('feat: gate: VERIFIED')).toBeNull()
    expect(gateVerdict('gate: VERIFIEDX')).toBeNull()
  })

  it('turns the marks of the marks file into mark events, a mark with no time left out', () => {
    expect(
      markEvents('e/04', [
        { kind: 'review', verdict: 'success', sha: SHA_A, at: '2026-10-17T10:30:00Z' },
        { kind: 'check/windows', verdict: 'skipped', sha: SHA_A, at: null },
      ]),
    ).toEqual([{ ticket: 'e/04', at: '2026-10-17T10:30:00.000Z', source: 'marks-file', event: 'mark', mark: 'review', verdict: 'success', sha: SHA_A }])
  })

  it('reads a reflog and turns it into pushes and verdict marks on the commit under the verdict', () => {
    const line = (sha: string, parents: string, date: string, action: string, subject: string) => [sha, parents, `e/02@{${date}}`, action, subject].join('\u0000')
    const entries = parseReflog(
      [
        line('3'.repeat(40), SHA_B, '2026-10-17T13:20:00+02:00', 'commit: gate: VERIFIED', 'gate: VERIFIED'),
        line(SHA_B, '2'.repeat(40), '2026-10-17T11:00:00Z', 'commit: fix', 'fix'),
        line('2'.repeat(40), SHA_A, '2026-10-17T10:40:00Z', 'commit: gate: REJECTED: bad', 'gate: REJECTED: bad'),
        line(SHA_A, '0'.repeat(40), '2026-10-17T10:20:00Z', 'commit: feat', 'feat'),
        line('0'.repeat(40), '', '2026-10-17T10:05:00Z', 'branch: Created from main', 'base'),
        'not a reflog line',
      ].join('\n'),
    )
    expect(entries).toHaveLength(5)
    expect(entries[0]?.at).toBe('2026-10-17T11:20:00.000Z')
    expect(entries[4]?.parents).toEqual([])
    const events = branchEvents('e/02', entries, { at: '2026-10-17T12:00:00.000Z', sha: '3'.repeat(40) })
    expect(events.map((event) => [event.at.slice(11, 16), event.event, 'sha' in event ? event.sha?.slice(0, 1) : null, event.event === 'mark' ? event.verdict : null])).toEqual([
      ['10:20', 'push', 'a', null],
      ['10:40', 'mark', 'a', 'failure'],
      ['11:00', 'push', 'b', null],
      ['11:20', 'mark', 'b', 'success'],
      ['12:00', 'merge', '3', null],
    ])
    expect(events.every((event) => event.source === 'git' && event.ticket === 'e/02')).toBe(true)
    // A rebase or reset that lands on a gate: commit is a new head, not a verdict.
    const moved: ReflogEntry = { sha: '4'.repeat(40), parents: [SHA_B], at: '2026-10-17T12:30:00.000Z', action: 'rebase (finish): refs/heads/e/02 onto 5555', subject: 'gate: VERIFIED' }
    expect(branchEvents('e/02', [moved], null)).toEqual([{ ticket: 'e/02', at: '2026-10-17T12:30:00.000Z', source: 'git', event: 'push', sha: '4'.repeat(40) }])
  })
})

describe('the canonical form of a worktree path', () => {
  it('on Windows: one separator, no letter case, no long-path prefix, no trailing separator', () => {
    expect(comparablePath('C:\\Users\\Ann\\Repo\\.claude\\worktrees\\05', 'win32')).toBe('c:/users/ann/repo/.claude/worktrees/05')
    expect(comparablePath('c:/users/ann/repo/.claude/worktrees/05/', 'win32')).toBe('c:/users/ann/repo/.claude/worktrees/05')
    expect(comparablePath('\\\\?\\C:\\Repo', 'win32')).toBe('c:/repo')
    expect(comparablePath('\\\\?\\UNC\\host\\share\\repo', 'win32')).toBe('//host/share/repo')
    expect(comparablePath('C:\\', 'win32')).toBe('c:/')
  })

  it('elsewhere: the path itself, a trailing separator aside', () => {
    expect(comparablePath('/Users/Ann/Repo', 'darwin')).toBe('/Users/Ann/Repo')
    expect(comparablePath('/Users/Ann/Repo/', 'linux')).toBe('/Users/Ann/Repo')
    expect(comparablePath('/a\\b', 'linux')).toBe('/a\\b')
    expect(comparablePath('/', 'linux')).toBe('/')
  })

  it('is pure: the module imports neither Node nor the DOM', () => {
    const source = readFileSync(join(__dirname, '..', '..', 'src', 'shared', 'flight-recorder', 'from-gate.ts'), 'utf8')
    const imports = [...source.matchAll(/^import .* from '([^']+)'/gmu)].map((match) => match[1] ?? '')
    expect(imports.filter((name) => name.startsWith('node:') || builtinModules.includes(name))).toEqual([])
    expect(source).not.toMatch(/\b(window|document)\./u)
  })
})
