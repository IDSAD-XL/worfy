// The `harnessHooks` part of the Claude driver (worfy-harness-guarantees ticket 07): whether the hooks of the Harness
// run in Claude Code, by the answer of `get_hooks_listing` to a query that sends no message (no model is called), and
// Autopilot's refusal on Claude Code while they do not.
//
// The listings stand for what the spike of ticket 01 recorded on Claude Code 2.1.322 (item 2 of its result section): rows of
// the plugin carry `pluginName: "worfy@inline"`, `disableAllHooks` marks each row `disabled: true`, and a hooks.json
// that is not JSON drops every hook of the plugin from the listing. No Claude Code starts here: the query is the test's.
import { cpSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Orchestrators, type OrchestratorDeps } from '../../src/main/agent/orchestrator'
import {
  CLAUDE_HOOKS_REFUSAL,
  claudeHarnessHooksPart,
  fakeHooksListing,
  hooksListingAnswer,
  readClaudeHooks,
  type HooksListingQuery,
  type HooksListingStarter,
} from '../../src/main/vendors/claude/harness-hooks'
import { CLAUDE_CAPABILITIES } from '../../src/shared/vendors/capabilities'
import { removeTestTree } from '../remove'

const HARNESS = join(import.meta.dirname, '..', '..', 'harness')

/** A row of the listing as Claude Code 2.1.322 gives it for a hook of the inline Harness. */
const row = (event: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  event,
  matcher: event === 'PreToolUse' ? 'Bash|apply_patch' : '',
  source: 'pluginHook',
  sourceLabel: 'Plugin',
  pluginName: 'worfy@inline',
  type: 'command',
  commandText: `node "\${CLAUDE_PLUGIN_ROOT}/hooks/${event === 'PreToolUse' ? 'guard' : 'stop'}.mjs"`,
  ...extra,
})
const listing = (hooks: unknown[], allDisabled = false): unknown => ({ events: [], hooks, policy: { allDisabled } })

const scratches: string[] = []
afterEach(() => {
  for (const dir of scratches.splice(0)) removeTestTree(dir)
  vi.restoreAllMocks()
})

describe('hooksListingAnswer: the hooks of the plugin worfy in Claude Code`s listing', () => {
  it('approved with PreToolUse and Stop of the plugin listed and running', () => {
    expect(hooksListingAnswer(listing([row('SessionStart'), row('PreToolUse'), row('Stop'), row('Stop')]))).toEqual({ trust: 'approved', reason: null })
  })

  it('unknown, with the reason, when a hook is turned off, missing, of another plugin, or the answer has another shape', () => {
    expect(hooksListingAnswer(listing([row('PreToolUse', { disabled: true }), row('Stop', { disabled: true })], true))).toEqual({
      trust: 'unknown',
      reason: 'Claude Code keeps the PreToolUse hooks of the plugin worfy from running.',
    })
    // A hooks.json that is not JSON: no hook of the plugin is listed at all.
    expect(hooksListingAnswer(listing([]))).toEqual({ trust: 'unknown', reason: 'Claude Code lists no PreToolUse hook of the plugin worfy.' })
    expect(hooksListingAnswer(listing([row('PreToolUse')]))).toEqual({ trust: 'unknown', reason: 'Claude Code lists no Stop hook of the plugin worfy.' })
    expect(hooksListingAnswer(listing([row('PreToolUse', { pluginName: 'plugin-1@market' }), row('Stop', { pluginName: undefined, source: 'userSettings' })])).trust).toBe('unknown')
    expect(hooksListingAnswer({ hooks: 'none' })).toEqual({ trust: 'unknown', reason: 'Claude Code answered the hooks listing in a shape worfy does not know.' })
  })
})

/** A starter whose query answers with `answer`, recording each start and each close. */
function starter(answer: () => Promise<unknown>): { start: HooksListingStarter; starts: unknown[]; closed: () => number } {
  const starts: unknown[] = []
  let closed = 0
  const start: HooksListingStarter = (input) => {
    starts.push(input)
    const query: HooksListingQuery = { getHooksListing: answer, close: () => void ++closed }
    return Promise.resolve(query)
  }
  return { start, starts, closed: () => closed }
}

describe('readClaudeHooks: one query without a message, closed after its answer', () => {
  it('carries the Harness worfy gives a Session and the Project`s folder, and closes the query', async () => {
    const s = starter(() => Promise.resolve(listing([row('PreToolUse'), row('Stop')])))
    await expect(readClaudeHooks('/repo', { start: s.start, harnessPlugin: () => '/app/Resources/harness' })).resolves.toEqual({ trust: 'approved', reason: null })
    expect(s.starts).toEqual([{ cwd: '/repo', harnessPlugin: '/app/Resources/harness' }])
    expect(s.closed()).toBe(1)
  })

  it('a start or an answer that fails, or no answer in time, is unknown with the reason, and the query is closed', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const failing = starter(() => Promise.reject(new Error('Claude Code exited')))
    await expect(readClaudeHooks(undefined, { start: failing.start, harnessPlugin: () => '/h' })).resolves.toEqual({
      trust: 'unknown',
      reason: 'worfy could not read the hooks listing of Claude Code: Claude Code exited',
    })
    expect(failing.closed()).toBe(1)
    const refused: HooksListingStarter = () => Promise.reject(new Error('no Claude Code binary'))
    await expect(readClaudeHooks(undefined, { start: refused, harnessPlugin: () => '/h' })).resolves.toMatchObject({ trust: 'unknown', reason: expect.stringContaining('no Claude Code binary') })
    const silent = starter(() => new Promise(() => undefined))
    await expect(readClaudeHooks(undefined, { start: silent.start, harnessPlugin: () => '/h', timeoutMs: 20 })).resolves.toEqual({
      trust: 'unknown',
      reason: 'worfy could not read the hooks listing of Claude Code: Claude Code did not answer in time',
    })
    await vi.waitFor(() => expect(silent.closed()).toBeGreaterThan(0))
  })

  it('the old Harness gives no plugin and is not checked; a Harness that cannot be looked for is unknown', async () => {
    const s = starter(() => Promise.resolve(listing([])))
    await expect(readClaudeHooks('/repo', { start: s.start, harnessPlugin: () => null })).resolves.toEqual({ trust: 'approved', reason: null })
    expect(s.starts).toEqual([])
    await expect(
      readClaudeHooks('/repo', {
        start: s.start,
        harnessPlugin: () => {
          throw new Error('no resources folder')
        },
      }),
    ).resolves.toEqual({ trust: 'unknown', reason: 'worfy could not find the Harness: no resources folder' })
  })
})

describe('the fake agent`s listing (WORFY_AGENT=fake) reads the Harness`s hooks.json', () => {
  it('approved on harness/ itself, unknown on a copy whose hooks.json is not JSON', () => {
    expect(hooksListingAnswer(fakeHooksListing(HARNESS))).toEqual({ trust: 'approved', reason: null })
    const scratch = mkdtempSync(join(tmpdir(), 'worfy-claude-hooks-'))
    scratches.push(scratch)
    const copy = join(scratch, 'harness')
    cpSync(join(HARNESS, 'hooks', 'hooks.json'), join(copy, 'hooks', 'hooks.json'), { recursive: true })
    writeFileSync(join(copy, 'hooks', 'hooks.json'), '{ "hooks": { "PreToolUse": [ ')
    expect(hooksListingAnswer(fakeHooksListing(copy))).toEqual({ trust: 'unknown', reason: 'Claude Code lists no PreToolUse hook of the plugin worfy.' })
  })
})

describe('Autopilot on Claude Code (Orchestrators.unattendedRefusal)', () => {
  /** The Orchestrators of one Project on Claude Code with the driver`s part over `start`; nothing else is asked. */
  const orchestrators = (start: HooksListingStarter): Orchestrators =>
    new Orchestrators({
      projectPath: () => '/repo',
      vendor: () => 'claude',
      capabilities: () => Promise.resolve(CLAUDE_CAPABILITIES),
      harnessHooks: (vendor: string) => (vendor === 'claude' ? claudeHarnessHooksPart({ start, harnessPlugin: () => '/app/Resources/harness' }) : undefined),
    } as unknown as OrchestratorDeps)

  it('starts with the Harness`s hooks running, and refuses with the reason while they do not', async () => {
    await expect(orchestrators(starter(() => Promise.resolve(listing([row('PreToolUse'), row('Stop')]))).start).unattendedRefusal('p')).resolves.toBeNull()
    await expect(orchestrators(starter(() => Promise.resolve(listing([]))).start).unattendedRefusal('p')).resolves.toBe(
      `${CLAUDE_HOOKS_REFUSAL} Claude Code lists no PreToolUse hook of the plugin worfy.`,
    )
    expect(CLAUDE_HOOKS_REFUSAL).toBe('Autopilot did not start: the Harness hooks do not run in Claude Code.')
  })
})
