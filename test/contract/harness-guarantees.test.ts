// The contract set of the Harness guarantees (epic worfy-harness-guarantees, ticket 08): the Harness
// plugin on the real Claude Code of the pinned Agent SDK (its own native binary), against the local
// stand-in of the Messages API — no model, no key, no sign-in, nothing under the real ~/.claude. A PR
// that moves the SDK (package.json) goes red here when the Harness stops working on the new binary.
// The cases and the runner live in src/main/harness/contract/, so worfy runs the same set (Health,
// ticket 09); this file runs each case on its own and checks that the runner tells a broken
// Harness (a red case) from a run that never started.
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { CONTRACT_CASES, PLUGIN_LOADED } from '../../src/main/harness/contract/cases'
import { startScriptedStandIn } from '../../src/main/harness/contract/messages-api-stand-in'
import { runContractCase, runContractSet, type CaseOutcome, type ContractCase, type ContractSetOptions } from '../../src/main/harness/contract/runner'
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

  // Review round 1 of PR #2345: a hook that blocks every prompt left Claude Code with no turn to ask the
  // stand-in, and the runner called that "not run".
  it('a UserPromptSubmit hook that blocks every prompt: a red case naming the hook, not "not run"', async () => {
    const outcome = await runContractCase(PLUGIN_LOADED, options(harnessCopy('prompt-blocked', 'hooks/stage-lines.mjs', 'process.stderr.write("blocked by the contract test\\n")\nprocess.exitCode = 2\n')))
    expectStatus(outcome, 'failed')
    expect(outcome.status === 'failed' && outcome.reason).toMatch(/UserPromptSubmit/)
  })

  // Review round 1: a Stop hook that held the turns kept Claude Code going until the runner's limit, and the
  // runner called that "not run". A Stop that always exits 2 ends on its own after a while on 2.1.322, so the
  // copy here holds once and then hangs: the run reaches the limit for sure, with a blocking Stop in its output.
  // The hanging hook writes a space every 200 ms and exits when its stdout breaks — when the runner has killed
  // Claude Code — so it outlives the run by a moment at most, and 60 s at the very most.
  it('a Stop hook that holds the turn and then hangs: the run reaches the limit and the case is red, naming the hook', async () => {
    const pluginDir = harnessCopy(
      'stop-held-then-hangs',
      'hooks/stop.mjs',
      [
        'import { existsSync, writeFileSync } from "node:fs"',
        'import { join } from "node:path"',
        'const once = join(process.env.HARNESS_HOME, "stop-held-once")',
        'if (!existsSync(once)) {',
        '  writeFileSync(once, "")',
        '  process.stderr.write("held by the contract test\\n")',
        '  process.exit(2)',
        '}',
        'process.stdout.on("error", () => process.exit(0))',
        'setInterval(() => process.stdout.write(" "), 200)',
        'setTimeout(() => process.exit(0), 60_000)',
        '',
      ].join('\n'),
    )
    const outcome = await runContractCase(PLUGIN_LOADED, { ...options(pluginDir), runLimitMs: ms(5_000) })
    expectStatus(outcome, 'failed')
    expect(outcome.status === 'failed' && outcome.reason).toMatch(/did not finish .*hooks of the plugin blocked: Stop \(exit code 2\): held by the contract test/)
  })

  // Review round 2: at the limit the runner killed Claude Code alone, and a hook that hung outlived the run.
  // The Stop hook of this copy writes its pid and hangs, writing nothing, so no broken pipe ends it (its limit in
  // hooks.json is 900 s); it ends itself after 60 s at the very most. A hook that hangs while turns did reach the
  // stand-in is not counted as holding them: the run is "not run" at the limit (a known limit, written in the ticket's summary).
  it('a hook that hangs at the time limit ends with the run: the runner stops the whole process group or tree', async () => {
    const pidFile = join(scratch, 'hung-hook.pid')
    const pluginDir = harnessCopy(
      'stop-hook-hangs',
      'hooks/stop.mjs',
      [`import { writeFileSync } from "node:fs"`, `writeFileSync(${JSON.stringify(pidFile)}, String(process.pid))`, 'setInterval(() => undefined, 1000)', 'setTimeout(() => process.exit(0), 60_000)', ''].join('\n'),
    )
    const outcome = await runContractCase(PLUGIN_LOADED, { ...options(pluginDir), runLimitMs: ms(3_000) })
    expectStatus(outcome, 'not-run')
    expect(outcome.status === 'not-run' && outcome.reason).toMatch(/did not finish in/)
    const pid = Number(readFileSync(pidFile, 'utf8'))
    const alive = (): boolean => {
      try {
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    }
    await expect.poll(alive).toBe(false)
  })

  // Review round 1: a check that throws (a manifest that is not JSON) rejected the whole set.
  it('a check that throws: a red case with the error, and the set still answers for every case', async () => {
    const throwing: ContractCase = { ...PLUGIN_LOADED, id: 'check-throws', check: () => JSON.parse('not json') as null }
    const outcomes = await runContractSet([throwing, PLUGIN_LOADED], options(HARNESS))
    expect(outcomes.map((o) => [o.id, o.status])).toEqual([
      ['check-throws', 'failed'],
      ['plugin-loaded', 'passed'],
    ])
    expect(outcomes[0]!.status === 'failed' && outcomes[0]!.reason).toMatch(/the check threw/)
  })
})

describe('the scripted stand-in of the Messages API', () => {
  // Review round 1: each chunk of a request body was decoded on its own, so a character split between two
  // chunks came out as U+FFFD and a marker or a rules heading with it was not found.
  it('reads a character split between two chunks of the request body', async () => {
    const standIn = await startScriptedStandIn([])
    try {
      const body = Buffer.from(JSON.stringify({ stream: false, tools: [{ name: 'Bash' }], messages: [{ role: 'user', content: 'MARKER — split' }] }))
      const cut = body.indexOf(Buffer.from('—')) + 1
      await new Promise<void>((resolve, reject) => {
        const req = request(`${standIn.url}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
          res.resume()
          res.on('end', resolve)
        })
        req.on('error', reject)
        req.flushHeaders()
        req.write(body.subarray(0, cut))
        // A pause between the two writes, so the server reads them as two chunks.
        setTimeout(() => req.end(body.subarray(cut)), 50)
      })
      expect(standIn.requests().map((r) => r.first)).toEqual(['MARKER — split'])
    } finally {
      await standIn.close()
    }
  })
})

/** A copy of the Harness with one file replaced by `content`. */
function harnessCopy(name: string, file: string, content: string): string {
  const dir = join(scratch, name)
  cpSync(HARNESS, dir, { recursive: true })
  writeFileSync(join(dir, file), content)
  return dir
}
