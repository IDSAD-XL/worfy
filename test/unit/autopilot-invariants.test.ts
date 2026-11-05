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
