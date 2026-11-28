// The refusals of the Harness's guard hook in the run's Journal (worfy-harness-guarantees ticket 10): the lines the
// guard appends to WORFY_GUARD_LOG (the format is the header of harness/hooks/guard.mjs; the fixture
// test/fixtures/guard-log/refusals.jsonl follows it, and the last case checks it against the guard itself) become
// `guard-deny` lines (src/shared/autopilot/guard-deny.ts), which Run history reads into its block «Guard»
// (src/shared/flight-recorder/from-journal.ts). The file of a Session is read from where the last read stopped
// (src/main/agent/guard-log.ts).
import { spawnSync } from 'node:child_process'
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeQueryFactory } from '../../src/main/agent/fake-query'
import { GuardLogTail } from '../../src/main/agent/guard-log'
import { SessionRegistry, type QueryRequest } from '../../src/main/agent/session'
import { guardDenyFields, guardRuleText, parseGuardLine, parseGuardLines } from '../../src/shared/autopilot/guard-deny'
import { formatJournalLine, parseJournal, type JournalEvent } from '../../src/shared/autopilot/journal'
import { journalFacts } from '../../src/shared/flight-recorder/from-journal'
import { NODE } from '../harness-node'
import { removeTestTree } from '../remove'

const FIXTURE = readFileSync(join(import.meta.dirname, '../fixtures/guard-log/refusals.jsonl'), 'utf8')
const GUARD = join(import.meta.dirname, '../../harness/hooks/guard.mjs')
const RUN = '2026-11-28T10-00-00-000Z-a1b2c3'
const base = { run: RUN, project: 'demo-1a2b3c4d', epic: 'worfy-x' }
const HOME = '/home/someone'

const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) removeTestTree(folder)
})
const folder = (): string => {
  const made = mkdtempSync(join(tmpdir(), 'worfy-guard-deny-'))
  folders.push(made)
  return made
}

describe('the lines of WORFY_GUARD_LOG', () => {
  it('the fixture gives its three refusals in file order; a line that is not JSON or has no rule is left out', () => {
    const refusals = parseGuardLines(FIXTURE)
    expect(refusals.map((refusal) => refusal.rule)).toEqual(['verification-path', 'uncommitted-work', 'pipe-exit-code'])
    expect(refusals[0]).toEqual({ time: '2026-11-28T10:14:03.120Z', rule: 'verification-path', agent: 'worfy:implementer', ticket: 'worfy-x/07', tool: 'Write', command: 'Write /repo/.claude/worktrees/07/.github/workflows/ci.yml' })
  })

  it('agent_id null is the Session\'s own call, whatever agent_type says; a Subagent without a type goes by its id', () => {
    const [, own, untyped] = parseGuardLines(FIXTURE)
    expect(own?.agent).toBeNull()
    expect(untyped?.agent).toBe('b81d04')
    expect(parseGuardLine('')).toBeNull()
    expect(parseGuardLine('{"time":"soon","rule":"x","tool":"Bash","command":"x"}')).toBeNull()
  })

  it('a guard-deny line keeps the command as the Journal keeps commands: the secret hidden, the home as ~', () => {
    const [first, own, piped] = parseGuardLines(FIXTURE)
    expect(guardDenyFields(piped!, 'ses-1', HOME)).toEqual({ kind: 'guard-deny', session: 'ses-1', rule: 'pipe-exit-code', tool: 'Bash', command: 'GH_TOKEN=*** pnpm lint | grep error', refusedAt: '2026-11-28T10:45:12.300Z', agent: 'b81d04' })
    expect(guardDenyFields(own!, null, HOME)).toEqual({ kind: 'guard-deny', session: null, rule: 'uncommitted-work', tool: 'Bash', command: 'git reset --hard', refusedAt: '2026-11-28T10:31:47.005Z' })
    expect(guardDenyFields({ ...first!, command: `Write ${HOME}/repo/ci.yml` }, 'ses-1', HOME).command).toBe('Write ~/repo/ci.yml')
  })

  it('the guard itself writes a line this reader takes (the header of guard.mjs and the fixture agree)', () => {
    const dir = folder()
    const repo = join(dir, 'repo')
    expect(spawnSync('git', ['init', '-q', repo]).status).toBe(0)
    const log = join(dir, 'guard.jsonl')
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: dir, USERPROFILE: dir, WORFY_GUARD_LOG: log }
    for (const name of ['CLAUDE_GATE_CONFIG', 'CLAUDE_PROFILES_DIR', 'CLAUDE_PROFILE_BIN', 'CLAUDE_TICKET_BIN', 'CLAUDE_SILENT_CHECK_BIN', 'ELECTRON_RUN_AS_NODE']) delete env[name]
    const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git reset --hard' }, cwd: repo, session_id: 'sdk-1', agent_id: 'a1', agent_type: 'worfy:implementer' })
    const ran = spawnSync(NODE, [GUARD], { input, env, encoding: 'utf8' })
    expect(ran.status).toBe(0)
    expect(ran.stdout).toContain('"permissionDecision":"deny"')
    const refusals = parseGuardLines(readFileSync(log, 'utf8'))
    expect(refusals).toEqual([{ time: expect.any(String), rule: 'uncommitted-work', agent: 'worfy:implementer', ticket: null, tool: 'Bash', command: 'git reset --hard' }])
  })
})

describe('guard-deny in the Journal and in Run history', () => {
  const started: JournalEvent = { ...base, at: '2026-11-28T10:00:00.000Z', kind: 'run-started' }
  const stopped: JournalEvent = { ...base, at: '2026-11-28T11:00:00.000Z', kind: 'run-stopped', reason: 'epic-done' }
  const lines = (): string[] => {
    const [first, own, piped] = parseGuardLines(FIXTURE)
    // the run carries the refusals at the end of a turn: the later line may hold the earlier refusal
    const written = [
      { at: '2026-11-28T10:50:00.000Z', fields: guardDenyFields(own!, 'ses-1', HOME) },
      { at: '2026-11-28T10:50:00.000Z', fields: guardDenyFields(piped!, 'ses-1', HOME) },
      { at: '2026-11-28T10:51:00.000Z', fields: guardDenyFields(first!, 'ses-1', HOME) },
    ]
    return [formatJournalLine(started), ...written.map(({ at, fields }) => formatJournalLine({ ...base, at, ...fields } as JournalEvent)), formatJournalLine(stopped)]
  }

  it('each line goes through the Journal format and back as written', () => {
    const parsed = parseJournal(lines().map((line) => `${line}\n`).join(''))
    expect(parsed.skipped).toBe(0)
    expect(parsed.events.filter((event) => event.kind === 'guard-deny')).toHaveLength(3)
  })

  it('Run history lists them by the time of the refusal, with who, the rule, the tool, the command and the Ticket', () => {
    const facts = journalFacts({ run: RUN, lines: lines() })
    expect(facts?.guard).toEqual([
      { at: '2026-11-28T10:14:03.120Z', rule: 'verification-path', tool: 'Write', command: 'Write /repo/.claude/worktrees/07/.github/workflows/ci.yml', agent: 'worfy:implementer', ticket: 'worfy-x/07' },
      { at: '2026-11-28T10:31:47.005Z', rule: 'uncommitted-work', tool: 'Bash', command: 'git reset --hard' },
      { at: '2026-11-28T10:45:12.300Z', rule: 'pipe-exit-code', tool: 'Bash', command: 'GH_TOKEN=*** pnpm lint | grep error', agent: 'b81d04' },
    ])
    expect(facts?.skipped).toBe(0)
  })

  it('a guard-deny line of another shape is left out of the block and counted as skipped', () => {
    const bad = formatJournalLine({ ...base, at: '2026-11-28T10:52:00.000Z', kind: 'guard-deny', session: 'ses-1', rule: 'x', tool: 'Bash', command: 'x', refusedAt: '2026-11-28T10:52:00.000Z' }).replace('"refusedAt":"2026-11-28T10:52:00.000Z"', '"refusedAt":"later"')
    const facts = journalFacts({ run: RUN, lines: [...lines(), bad] })
    expect(facts?.guard).toHaveLength(3)
    expect(facts?.skipped).toBe(1)
  })

  it('the rule in words, and a rule this build does not know as its id', () => {
    expect(guardRuleText('verification-path')).toBe('verification path outside the trail')
    expect(guardRuleText('merge-outside-land')).toBe('merge-outside-land')
    expect(guardRuleText('constructor')).toBe('constructor')
  })
})

describe('GuardLogTail: the file of a Session, from where the last read stopped', () => {
  const line = (time: string, rule: string): string => `${JSON.stringify({ time, rule, agent: null, agent_id: null, ticket: null, tool: 'Bash', command: 'x', session: null, cwd: '/repo' })}\n`

  it('answers the whole lines appended since the last read, those at or after `since`; a file not there yet is none', async () => {
    const file = join(folder(), 'session.jsonl')
    const tail = new GuardLogTail(file, Date.parse('2026-11-28T10:00:00.000Z'))
    expect(await tail.read()).toEqual([])
    writeFileSync(file, line('2026-11-28T09:59:59.000Z', 'before') + line('2026-11-28T10:00:00.000Z', 'at-start'))
    expect((await tail.read()).map((refusal) => refusal.rule)).toEqual(['at-start'])
    expect(await tail.read()).toEqual([])
    const next = line('2026-11-28T10:05:00.000Z', 'cut')
    appendFileSync(file, next.slice(0, 20))
    expect(await tail.read()).toEqual([])
    appendFileSync(file, next.slice(20))
    expect((await tail.read()).map((refusal) => refusal.rule)).toEqual(['cut'])
  })

  it('a file that got shorter is read again from its start', async () => {
    const file = join(folder(), 'session.jsonl')
    const tail = new GuardLogTail(file, 0)
    writeFileSync(file, line('2026-11-28T10:00:00.000Z', 'a') + line('2026-11-28T10:01:00.000Z', 'b'))
    expect(await tail.read()).toHaveLength(2)
    writeFileSync(file, line('2026-11-28T10:02:00.000Z', 'c'))
    expect((await tail.read()).map((refusal) => refusal.rule)).toEqual(['c'])
  })
})

describe('WORFY_GUARD_LOG of the Sessions worfy starts', () => {
  const scriptsDir = join(import.meta.dirname, '../fixtures/agent-scripts')
  const started = (guardLogFolder: string | null) => {
    const requests: QueryRequest[] = []
    const registry = new SessionRegistry(
      fakeQueryFactory({
        scriptsDir,
        script: (request) => {
          requests.push(request)
          return 'turn'
        },
      }),
      undefined,
      undefined,
      {},
      guardLogFolder,
    )
    const session = registry.start('/repo', undefined, () => undefined)
    return { registry, session, requests }
  }

  it('each Session has its own file in the folder, and its agent is started with it', async () => {
    const dir = folder()
    const one = started(dir)
    const two = started(dir)
    try {
      await vi.waitFor(() => expect(one.requests.length + two.requests.length).toBe(2))
      expect(dirname(one.session.guardLog ?? '')).toBe(dir)
      expect(basename(one.session.guardLog ?? '')).toMatch(/^[0-9a-f-]{36}\.jsonl$/)
      expect(two.session.guardLog).not.toBe(one.session.guardLog)
      expect(one.requests[0]?.guardLog).toBe(one.session.guardLog)
    } finally {
      one.registry.closeAll()
      two.registry.closeAll()
    }
  })

  it('without a folder a Session has none, and its agent gets no file', async () => {
    const plain = started(null)
    try {
      await vi.waitFor(() => expect(plain.requests).toHaveLength(1))
      expect(plain.session.guardLog).toBeNull()
      expect(plain.requests[0]?.guardLog).toBeUndefined()
    } finally {
      plain.registry.closeAll()
    }
  })
})
