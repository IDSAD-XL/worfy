// The Recovery invariants I1–I8 (test/autopilot-invariants.ts) over the fixtures in
// test/fixtures/autopilot-faults/ (worfy-faults ticket 01).
//
// `api-500/` is a good Run: Wave 1 goes out, the Orchestrator's turn ends with API Error: 500, the
// Run stops with turn-error, a new start runs. Its files are what the fault scenarios read: the
// journals (`run-N.jsonl`), the fake agent's log (WORFY_AGENT_LOG lines), the gh stub's log
// (GH_STUB_LOG lines) and `scenario.json` with the rest of the input. Every other folder is a
// variant of it: its files replace the files of the same name, and `variant.json` replaces the keys
// of `scenario.json` (`expect` key by key; `projectAfterExtra` adds files to `projectAfter`).
// `rule` names the one rule the variant breaks, null when it breaks none.
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MAX_RETRIES, retryText } from '../../src/shared/agent/continue-plan'
import { checkRecovery, type RecoveryInput, type StatusWrite } from '../autopilot-invariants'

const root = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'fixtures', 'autopilot-faults')
const BASE = 'api-500'

interface Scenario {
  journals: string[]
  statusWrites: StatusWrite[]
  projectBefore: Record<string, string>
  projectAfter: Record<string, string>
  restart: { refusal: string | null } | null
  expect: { stop: string | null; errorText?: string | null; waves: number; resumed?: boolean; tornLastLine?: boolean }
}

interface Variant extends Partial<Omit<Scenario, 'expect'>> {
  rule: string | null
  expect?: Partial<Scenario['expect']>
  projectAfterExtra?: Record<string, string>
}

const base64 = (texts: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(texts).map(([path, text]) => [path, Buffer.from(text, 'utf8').toString('base64')]))

const lines = (text: string): string[] => text.split('\n').filter((line) => line.trim() !== '')

/** The fixture's file: the variant's own when it has one, the good Run's otherwise. */
function file(variant: string | null, name: string): string {
  const own = variant === null ? [] : readdirSync(join(root, variant))
  return readFileSync(join(root, own.includes(name) ? variant! : BASE, name), 'utf8')
}

function variantOf(name: string): Variant {
  return JSON.parse(readFileSync(join(root, name, 'variant.json'), 'utf8')) as Variant
}

/** The input of checkRecovery for the good Run, or for one of its variants. */
function load(variant: string | null = null): RecoveryInput {
  const scenario = JSON.parse(readFileSync(join(root, BASE, 'scenario.json'), 'utf8')) as Scenario
  const changes: Variant = variant === null ? { rule: null } : variantOf(variant)
  const { expect: expectChanges, projectAfterExtra, ...rest } = changes
  const merged: Scenario = { ...scenario, ...rest, expect: { ...scenario.expect, ...expectChanges } }
  const projectAfter = { ...merged.projectAfter, ...projectAfterExtra }
  const { errorText, ...ends } = merged.expect
  return {
    journals: merged.journals.map((name) => file(variant, name)),
    messages: lines(file(variant, 'agent.log'))
      .map((line) => JSON.parse(line) as { kind: string; text?: string })
      .filter((call) => call.kind === 'message')
      .map((call) => call.text ?? ''),
    gh: lines(file(variant, 'gh.log')).map((line) => JSON.parse(line) as string[]),
    statusWrites: merged.statusWrites,
    projectBefore: base64(merged.projectBefore),
    projectAfter: base64(projectAfter),
    restart: merged.restart,
    expect: { ...ends, ...(typeof errorText === 'string' ? { errorText: new RegExp(errorText, 'u') } : {}) },
  }
}

const variants = readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== BASE)
  .map((entry) => ({ name: entry.name, rule: variantOf(entry.name).rule }))
const broken = variants.filter((variant) => variant.rule !== null)
const harmless = variants.filter((variant) => variant.rule === null)

describe('checkRecovery over the fixtures', () => {
  it('finds nothing wrong in the good Run after API Error: 500', () => {
    expect(checkRecovery(load())).toEqual([])
  })

  it('has a broken fixture for every rule I1–I8', () => {
    expect([...new Set(broken.map((variant) => variant.rule))].sort()).toEqual(['I1', 'I2', 'I3', 'I4', 'I5', 'I6', 'I7', 'I8'])
  })

  it.each(broken)('$name breaks only $rule, once', ({ name, rule }) => {
    const violations = checkRecovery(load(name))
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatch(new RegExp(`^${rule}: `, 'u'))
  })

  it.each(harmless)('$name breaks nothing', ({ name }) => {
    expect(checkRecovery(load(name))).toEqual([])
  })
})

describe('checkRecovery, rule by rule', () => {
  const good = (): RecoveryInput => load()

  it('I1 names the Wave whose command went twice', () => {
    expect(checkRecovery(load('i1-second-wave-command'))).toEqual(['I1: /epic-wave for wave 1 sent 2 times'])
  })

  it('I1 lets a new Wave name a Ticket of a past one that went back to open', () => {
    const input = good()
    const run = '2026-11-03T10-00-00-000Z-a1b2c3'
    const wave2 = `{"at":"2026-11-03T10:00:08.000Z","run":"${run}","project":"demo-000000a4","epic":"demo","kind":"wave-started","wave":2,"tickets":["01"]}`
    const [first, ...rest] = input.journals
    const [started, ...events] = lines(first!)
    input.journals = [[started, ...events.slice(0, 3), wave2, ...events.slice(3)].join('\n') + '\n', ...rest]
    input.messages = [...input.messages, '/epic-wave Ticket-ы 01 эпика demo\n\nThis is a new session for the next Wave: before anything else, run `wave-brief demo`.']
    input.expect = { ...input.expect, waves: 2 }
    expect(checkRecovery(input)).toEqual([])
  })

  it('I1 counts the Waves the scenario expects', () => {
    expect(checkRecovery({ ...good(), expect: { ...good().expect, waves: 2 } })).toEqual(['I1: 1 wave-started, the scenario expects 2'])
  })

  it('I1 sees a Wave whose command never went', () => {
    expect(checkRecovery({ ...good(), messages: [] })).toEqual(['I1: wave 1 (01, 02) has no /epic-wave'])
  })

  it('I2 lets only the reads through', () => {
    const reads = [
      ['pr', 'list', '--state', 'open'],
      ['auth', 'status', '--json', 'hosts'],
      ['auth', 'token', '-u', 'demo-user'],
      ['api', 'repos/demo-owner/demo'],
    ]
    expect(checkRecovery({ ...good(), gh: reads })).toEqual([])
    const writes = [
      ['api', 'repos/demo-owner/demo', '-X', 'PATCH'],
      ['api', 'repos/demo-owner/demo', '--method=DELETE'],
      ['api', 'repos/demo-owner/demo', '-f', 'name=x'],
      ['api', 'repos/demo-owner/demo/pulls/1/merge'],
      ['pr', 'create', '--fill'],
      ['auth', 'switch'],
    ]
    expect(checkRecovery({ ...good(), gh: writes })).toHaveLength(writes.length)
  })

  it('I3 does not ask for the last read after a Force stop', () => {
    const input = load('i3-missing-ticket-status')
    input.journals = [input.journals[0]!.replace('"reason":"turn-error"', '"reason":"user-force-stop"'), ...input.journals.slice(1)]
    input.expect = { ...input.expect, stop: 'user-force-stop' }
    expect(checkRecovery(input)).toEqual([])
  })

  it('I4 holds the error text to the scenario', () => {
    expect(checkRecovery({ ...good(), expect: { ...good().expect, errorText: /overloaded_error/u } })).toEqual([
      'I4: session-error before run-stopped turn-error does not match /overloaded_error/u: API Error: 500 {"type":"error","error":{"type":"api_error","message":"Internal server error"}}',
    ])
  })

  it('I4 asks a Run that survived the fault for resumed', () => {
    expect(checkRecovery({ ...good(), expect: { ...good().expect, resumed: true } })).toEqual(['I4: the Run has no resumed'])
  })

  it('I4 sees run-stopped where the app was killed', () => {
    expect(checkRecovery({ ...good(), expect: { stop: null, waves: 1 } })).toEqual(['I4: run-stopped turn-error, the scenario expects none (killed app)'])
  })

  it('I4 holds a Run a quit suspended to run-suspended with its cause last, and never lets a quit stop one with app-quit (worfy-continuity ticket 04)', () => {
    const midWave = load('suspended-mid-wave')
    expect(checkRecovery({ ...midWave, expect: { ...midWave.expect, suspended: 'quit' } })).toEqual([])
    expect(checkRecovery({ ...midWave, expect: { ...midWave.expect, suspended: 'update' } })).toEqual(['I4: run-suspended quit, the scenario expects update'])
    // The Run that stopped: no run-suspended last, and its run-stopped is where the scenario expects none.
    expect(checkRecovery({ ...good(), expect: { ...good().expect, suspended: 'quit' } })).toEqual(['I4: the Run ends with run-stopped, the scenario expects run-suspended quit'])
    // A quit that stopped the Run with app-quit, as before the ticket.
    const quitStopped = good().journals[0]!.replace('"reason":"turn-error"', '"reason":"app-quit"')
    expect(checkRecovery({ ...good(), journals: [quitStopped, ...good().journals.slice(1)], expect: { ...good().expect, stop: 'app-quit', errorText: undefined } })).toContain(
      'I4: run 1 stopped with app-quit, a quit suspends a run',
    )
  })

  it('I4 asks a continued Run for run-continued with its after, right after its run-suspended, never after its run-stopped (worfy-continuity ticket 06)', () => {
    const continued = load('continued-after-crash')
    expect(checkRecovery(continued)).toEqual([])
    expect(checkRecovery({ ...continued, expect: { ...continued.expect, continued: 'quit' } })).toEqual(['I4: run-continued after crash, the scenario expects quit'])
    expect(checkRecovery({ ...continued, expect: { ...continued.expect, suspended: 'quit' } })).toEqual(['I4: run-continued follows ticket-status, the scenario expects run-suspended quit before it'])
    expect(checkRecovery({ ...good(), expect: { ...good().expect, continued: 'crash' } })).toEqual(['I4: the Run has no run-continued, the scenario expects one after crash'])
    // A quit suspended it: run-suspended quit right before run-continued quit.
    const journal = continued.journals[0]!
    const suspendedLine = journal.split('\n').find((line) => line.includes('"kind":"run-continued"'))!.replace('"kind":"run-continued","after":"crash"', '"kind":"run-suspended","cause":"quit","wave":1,"tickets":["01","02"],"wait":null')
    const quit = journal.replace('"after":"crash"', '"after":"quit"').replace(/^(?=.*"kind":"run-continued")/mu, `${suspendedLine}\n`)
    expect(checkRecovery({ ...continued, journals: [quit, ...continued.journals.slice(1)], expect: { ...continued.expect, continued: 'quit', suspended: 'quit' } })).toEqual([])
    // A stopped Run that goes on.
    const lines = journal.trimEnd().split('\n')
    const afterStop = [...lines.slice(0, 4), lines[6]!.replace('"reason":"user-stop"', '"reason":"turn-error"'), ...lines.slice(4, 6), ''].join('\n')
    expect(checkRecovery({ ...continued, journals: [afterStop, ...continued.journals.slice(1)], expect: { ...continued.expect, stop: 'turn-error' } })).toContain(
      'I4: run-continued after run-stopped: a stopped Run does not go on',
    )
  })

  it('I8 lets the line a killed app tore stand right before the run-continued of the Run that went on, nowhere else (worfy-continuity ticket 06)', () => {
    const continued = load('continued-after-crash')
    const lines = continued.journals[0]!.trimEnd().split('\n')
    const torn = (at: number): string => [...lines.slice(0, at), '{"at":"2026-11-03T10:00:07.000Z","run":"2026', ...lines.slice(at), ''].join('\n')
    const allowed = { ...continued, expect: { ...continued.expect, tornLastLine: true } }
    expect(checkRecovery({ ...allowed, journals: [torn(4), ...continued.journals.slice(1)] })).toEqual([])
    expect(checkRecovery({ ...allowed, journals: [torn(3), ...continued.journals.slice(1)] })).toEqual(['I8: journal of run 1: unreadable line 4'])
    expect(checkRecovery({ ...continued, journals: [torn(4), ...continued.journals.slice(1)] })).toEqual(['I8: journal of run 1: unreadable line 5'])
  })

  it('I6 lets a new journal begin only after the Run before it stopped, a Discard included (worfy-continuity ticket 06)', () => {
    expect(checkRecovery(load('i6-new-journal-over-cut-off'))).toEqual(['I6: run 1 has no run-stopped, yet run 2 began a new journal instead of continuing it'])
    expect(checkRecovery(load('discarded'))).toEqual([])
  })

  it('I6 asks for a new journal after the new start', () => {
    expect(checkRecovery({ ...good(), journals: good().journals.slice(0, 1) })).toEqual(['I6: no new journal with run-started after the new start'])
  })

  it('I7 takes a path of either separator', () => {
    const input = good()
    const windows = (files: Record<string, string>) => Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path.replaceAll('/', '\\'), bytes]))
    expect(checkRecovery({ ...input, projectBefore: windows(input.projectBefore), projectAfter: windows(input.projectAfter) })).toEqual([])
  })

  it('I7 sees a removed file and a changed file the test did not write', () => {
    const input = good()
    const after = { ...input.projectAfter }
    delete after['src/f1.ts']
    after['.scratch/demo/issues/03-ticket-3.md'] = Buffer.from('changed').toString('base64')
    expect(checkRecovery({ ...input, projectAfter: after })).toEqual([
      'I7: worfy changed .scratch/demo/issues/03-ticket-3.md in the Project',
      'I7: worfy removed src/f1.ts from the Project',
    ])
  })
})

// ── Auto-continue (worfy-retry ticket 09) ────────────────────────────────────
//
// The good Run's first journal, rewritten as Auto-continue would leave it: after the claims the
// Orchestrator's turn ends with the 500, and the journal goes on with `tail` instead of its
// session-error and run-stopped. The continuations Auto-continue sent join the messages.

const RUN_1 = '2026-11-03T10-00-00-000Z-a1b2c3'
const ERROR_500 = 'API Error: 500 {"type":"error","error":{"type":"api_error","message":"Internal server error"}}'
const continuation = (attempt: number): string => retryText({ attempt, of: MAX_RETRIES, error: 'api-500', actions: [] })

/** A journal line of run 1, `second` seconds after 10:00:10. */
const at = (second: number, fields: Record<string, unknown>): string =>
  JSON.stringify({ at: new Date(Date.parse('2026-11-03T10:00:10.000Z') + second * 1000).toISOString(), run: RUN_1, project: 'demo-000000a4', epic: 'demo', ...fields })

/** `turn-retry` `attempt` of the 500, then (unless `resumed` is false) its `resumed`. */
const retried = (attempt: number, second: number, resumed = true): string[] => [
  at(second, { kind: 'turn-retry', attempt, of: MAX_RETRIES, error: 'api-500', message: ERROR_500, until: '2026-11-03T10:30:00.000Z' }),
  ...(resumed ? [at(second + 1, { kind: 'resumed' })] : []),
]

/** The good Run with run 1's journal ending in `tail`, `continuations` more messages after the Wave's command. */
function withRetry(tail: string[], continuations: number, expectChanges: Partial<RecoveryInput['expect']>): RecoveryInput {
  const input = load()
  const head = lines(input.journals[0]!).slice(0, 4)
  return {
    ...input,
    journals: [[...head, ...tail].join('\n') + '\n', ...input.journals.slice(1)],
    messages: [...input.messages, ...Array.from({ length: continuations }, (_, index) => continuation(index + 1))],
    expect: { ...input.expect, ...expectChanges },
  }
}

/** The 500 survived: one turn-retry, one continuation, resumed; a person then stops the Run. */
const survived = (): RecoveryInput => withRetry([...retried(1, 0), at(5, { kind: 'run-stopped', reason: 'user-stop' })], 1, { stop: 'user-stop', resumed: true })

/** Five retries, then the give-up: retry-refused cap, session-error, run-stopped turn-error. */
const capTail = (): string[] => [
  ...[1, 2, 3, 4, 5].flatMap((attempt) => retried(attempt, attempt * 2)),
  at(20, { kind: 'retry-refused', reason: 'cap' }),
  at(21, { kind: 'session-error', session: 'demo-session-000001', message: `${ERROR_500} — gave up after ${MAX_RETRIES} retries` }),
  at(22, { kind: 'run-stopped', reason: 'turn-error' }),
]
const gaveUp = (): RecoveryInput => withRetry(capTail(), MAX_RETRIES, { refused: 'cap' })

describe('checkRecovery with Auto-continue (worfy-retry ticket 09)', () => {
  it('finds nothing wrong in a Run that survived the 500: the error is named by its turn-retry', () => {
    expect(checkRecovery(survived())).toEqual([])
  })

  it('finds nothing wrong in a Run that gave up after five retries', () => {
    expect(checkRecovery(gaveUp())).toEqual([])
  })

  it('I1 does not count the continuation as a Wave command, and sees the Wave command sent again in its place', () => {
    expect(continuation(1)).not.toMatch(/epic-wave/u)
    const input = survived()
    expect(checkRecovery({ ...input, messages: [input.messages[0]!, input.messages[0]!] })).toEqual(['I1: /epic-wave for wave 1 sent 2 times'])
  })

  it('I4 holds the error text of a survived Run to its turn-retry', () => {
    expect(checkRecovery({ ...survived(), expect: { ...survived().expect, errorText: /overloaded_error/u } })).toEqual([
      'I4: no session-error or turn-retry matches /overloaded_error/u',
    ])
  })

  it('I4 sees a turn-retry without its resumed before the next step', () => {
    const tail = capTail()
    // The resumed of retry 3 is gone: retry 4 follows retry 3 at once.
    tail.splice(5, 1)
    expect(checkRecovery(withRetry(tail, MAX_RETRIES, { refused: 'cap' }))).toEqual(['I4: turn-retry 3 has no resumed before turn-retry'])
    const finished = [...retried(1, 0, false), at(5, { kind: 'wave-finished', wave: 1, tickets: ['01', '02'] }), at(6, { kind: 'run-stopped', reason: 'user-stop' })]
    expect(checkRecovery(withRetry(finished, 1, { stop: 'user-stop' }))).toEqual(['I4: turn-retry 1 has no resumed before wave-finished'])
  })

  it('I4 sees a retry-refused that is not the give-up right before run-stopped turn-error', () => {
    const tail = capTail()
    // A continuation went after the give-up.
    tail.splice(11, 0, at(20.5, { kind: 'resumed' }))
    expect(checkRecovery(withRetry(tail, MAX_RETRIES, { refused: 'cap' }))).toEqual(['I4: retry-refused cap is followed by resumed, not run-stopped turn-error'])
  })

  it('I4 holds the reason of the give-up to the scenario', () => {
    expect(checkRecovery({ ...gaveUp(), expect: { ...gaveUp().expect, refused: 'in-flight' } })).toEqual(['I4: no retry-refused in-flight before run-stopped'])
    expect(checkRecovery({ ...load(), expect: { ...load().expect, refused: 'cap' } })).toEqual(['I4: no retry-refused cap before run-stopped'])
  })

  it('I4 lets a wait to retry end with a Force stop, with the Limits taking it over, or with a killed app', () => {
    const forceStop = withRetry([...retried(1, 0, false), at(5, { kind: 'run-stopped', reason: 'user-force-stop' })], 0, { stop: 'user-force-stop' })
    expect(checkRecovery(forceStop)).toEqual([])
    const limits = [
      ...retried(1, 0, false),
      at(2, { kind: 'limits-hit', window: 'seven_day', resetsAt: '2026-11-03T11:00:00.000Z' }),
      at(3, { kind: 'waiting-until', until: '2026-11-03T11:02:00.000Z' }),
      at(4, { kind: 'resumed' }),
      at(5, { kind: 'run-stopped', reason: 'user-stop' }),
    ]
    expect(checkRecovery(withRetry(limits, 0, { stop: 'user-stop', resumed: true }))).toEqual([])
    // Killed: the journal as the app left it, before the start that continues the Run in it (worfy-continuity ticket 06).
    const killed = withRetry(retried(1, 0, false), 0, { stop: null })
    expect(checkRecovery({ ...killed, journals: killed.journals.slice(0, 1), restart: null })).toEqual([])
  })
})

// ── The continuation ladder (worfy-stuck-agents ticket 05) ───────────────────
//
// I9 over run 1 rewritten with the ladder's lines: `continued` ticket-continued lines of 01, then (with `aside`) its
// ticket-set-aside, an optional ticket-status `blocked`, and run-stopped `stop`. I1 is not the rule here: the
// messages and the expected Waves stay the good Run's.
describe('checkRecovery: the continuation ladder, I9', () => {
  function ladder(continued: number, aside: { blocked: boolean } | null, stop: string): RecoveryInput {
    const input = load()
    const head = lines(input.journals[0]!).slice(0, 4)
    const tail = [
      ...Array.from({ length: continued }, (_, index) => at(index, { kind: 'ticket-continued', ticket: '01', attempt: Math.min(index + 1, 2), of: 2, cause: 'wave-unfinished' })),
      ...(aside === null ? [] : [at(10, { kind: 'ticket-set-aside', ticket: '01', cause: 'wave-unfinished', attempts: 2 })]),
      ...(aside?.blocked === true ? [at(11, { kind: 'ticket-status', ticket: '01', state: 'blocked', reason: 'stuck: claimed after 2 continuations', waits: 'owner' })] : []),
      at(20, { kind: 'run-stopped', reason: stop }),
    ]
    return { ...input, journals: [[...head, ...tail].join('\n') + '\n', ...input.journals.slice(1)], statusWrites: [], expect: { ...input.expect, stop } }
  }
  const i9 = (input: RecoveryInput): string[] => checkRecovery(input).filter((line) => line.startsWith('I9'))

  it('lets two continuations, then a set-aside the Orchestrator carried out (blocked), through', () => {
    expect(i9(ladder(2, { blocked: true }, 'blocked-tickets'))).toEqual([])
  })

  it('lets a set-aside the Orchestrator did not carry out through when the run stopped with its cause, the old stop', () => {
    expect(i9(ladder(2, { blocked: false }, 'wave-unfinished'))).toEqual([])
  })

  it('sees a third continuation of the same Ticket', () => {
    expect(i9(ladder(3, null, 'wave-unfinished'))).toEqual(['I9: ticket demo/01 in run 1: 3 ticket-continued, at most 2'])
  })

  it('sees a set-aside Ticket left in work while the run stopped for another reason', () => {
    expect(i9(ladder(2, { blocked: false }, 'blocked-tickets'))).toEqual(['I9: ticket demo/01 in run 1: set aside, not blocked after it, and the run stopped with blocked-tickets, not wave-unfinished'])
  })
})
