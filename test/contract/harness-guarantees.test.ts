// The contract set of the Harness guarantees (epic worfy-harness-guarantees, ticket 08): the Harness
// plugin on the real Claude Code of the pinned Agent SDK (its own native binary), against the local
// stand-in of the Messages API — no model, no key, no sign-in, nothing under the real ~/.claude. A PR
// that moves the SDK (package.json) goes red here when the Harness stops working on the new binary.
// The cases and the runner live in src/main/harness/contract/, so worfy runs the same set (Health,
// ticket 09); this file runs each case on its own and checks that the runner tells a broken
// Harness (a red case) from a run that never started.
import { cpSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { CONTRACT_CASES, PLUGIN_LOADED } from '../../src/main/harness/contract/cases'
import { runContractCase, type CaseOutcome, type ContractSetOptions } from '../../src/main/harness/contract/runner'
import { bundledClaudeBinary } from '../../src/main/vendors/claude/options'
import { removeTestTree } from '../remove'
import { ms } from '../time-scale'

const REPO = join(__dirname, '..', '..')
const HARNESS = join(REPO, 'harness')
const binary = bundledClaudeBinary({ packaged: false, resourcesPath: '', platform: process.platform, arch: process.arch })

const scratch = mkdtempSync(join(tmpdir(), 'worfy-harness-guarantees-'))
afterAll(() => removeTestTree(scratch))

// The runner's own limit for one run of Claude Code, below the contract project's limit for a test:
// a run that hangs comes back as "not run" with what it printed, not as a test timeout.
const options = (pluginDir: string): ContractSetOptions => ({ binary: binary ?? 'claude-binary-not-installed', pluginDir, runLimitMs: ms(12_000), scratch })

/** The outcome with the run's details in the message when it is not the one expected. */
const expectStatus = (outcome: CaseOutcome, status: CaseOutcome['status']): void => {
  expect(outcome.status, `${outcome.id}: ${outcome.status === 'passed' ? 'passed' : outcome.reason}`).toBe(status)
}

describe('the Harness on the Claude Code binary of the pinned SDK', () => {
  it('the binary of the SDK is installed for this platform', () => {
    expect(binary).toBeDefined()
  })

  it.each(CONTRACT_CASES.map((c) => [c.id, c] as const))('case %s passes', async (_id, contractCase) => {
    expectStatus(await runContractCase(contractCase, options(HARNESS)), 'passed')
  })
})

describe('the runner tells a broken Harness from a run that never started', () => {
  it('a copy of the Harness whose hooks.json does not parse (test/fixtures/harness-broken-hooks) gives a red case', async () => {
    const broken = join(scratch, 'harness-broken-hooks')
    cpSync(HARNESS, broken, { recursive: true })
    cpSync(join(REPO, 'test', 'fixtures', 'harness-broken-hooks'), broken, { recursive: true })
    const outcome = await runContractCase(PLUGIN_LOADED, options(broken))
    expectStatus(outcome, 'failed')
    expect(outcome.status === 'failed' && outcome.reason).toContain('hook-load-failed')
  })

  it('a binary that is not there: not run, with the reason, not a red case', async () => {
    const outcome = await runContractCase(PLUGIN_LOADED, { ...options(HARNESS), binary: join(scratch, 'no-such-claude') })
    expectStatus(outcome, 'not-run')
    expect(outcome.status === 'not-run' && outcome.reason).toMatch(/could not start/)
  })
})
