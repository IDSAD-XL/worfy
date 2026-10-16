// The gh stand-in named by the path of its Node script, test/fixtures/gh/gh-stub.mjs: the way the
// tests point worfy at it on Windows, where the `#!/bin/sh` wrapper next to it cannot be started
// (src/main/program.ts). Here the script path is used on every system, so its start under worfy's
// own Node is covered wherever the tests run. Nothing reaches GitHub.
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ghRunner } from '../../src/main/github/prs'
import { removeTestTree } from '../remove'

const SCRIPT = join(import.meta.dirname, '..', 'fixtures', 'gh', 'gh-stub.mjs')

let scratch: string

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-gh-script-')))
})

afterEach(() => {
  removeTestTree(scratch)
})

/**
 * The environment the app gives gh, with the stand-in's folder. The tests themselves run with
 * ELECTRON_RUN_AS_NODE (scripts/vitest-electron.mjs) and the app does not, so it is taken out: the
 * script runs as a Node script only when worfy sets the variable for it.
 */
function appEnv(extra: Record<string, string> = {}): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env, GH_STUB_DIR: scratch, GH_STUB_LOG: join(scratch, 'calls.jsonl'), ...extra }
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

const calls = (): string[][] =>
  readFileSync(join(scratch, 'calls.jsonl'), 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as string[])

describe('ghRunner over a program that is a .mjs script', () => {
  it('starts it under worfy\'s own Node: the script gets the arguments and its answer comes back', async () => {
    const pulls = [{ number: 7, headRefName: 'demo/07', state: 'OPEN', url: 'https://github.com/o/r/pull/7', statusCheckRollup: [], comments: [] }]
    writeFileSync(join(scratch, 'prs.json'), JSON.stringify(pulls))
    const run = ghRunner({ command: SCRIPT, env: () => Promise.resolve(appEnv()), timeoutMs: 10_000 })
    expect(JSON.parse(await run(['pr', 'list', '--limit', '5'], scratch))).toEqual(pulls)
    expect(calls()).toEqual([['pr', 'list', '--limit', '5']])
  })

  it('the variables of one call reach the script', async () => {
    writeFileSync(join(scratch, 'tokens.json'), JSON.stringify({ alice: 'gho_alice' }))
    writeFileSync(join(scratch, 'repos.json'), JSON.stringify({ 'acme/shop': { alice: true } }))
    const run = ghRunner({ command: SCRIPT, env: () => Promise.resolve(appEnv()), timeoutMs: 10_000 })
    expect(await run(['api', 'repos/acme/shop', '--jq', '.permissions.push'], scratch, { GH_TOKEN: 'gho_alice' })).toBe('true\n')
  })

  it('a failure of the script is its first line of stderr, as with gh', async () => {
    const run = ghRunner({ command: SCRIPT, env: () => Promise.resolve(appEnv({ GH_STUB_FAIL: 'error connecting to api.github.com' })), timeoutMs: 10_000 })
    await expect(run(['pr', 'list'], scratch)).rejects.toThrow(/^error connecting to api\.github\.com$/)
  })

  it('when nothing could be started, the reason names the program worfy was told to run, not the Node that runs it', async () => {
    const run = ghRunner({ command: SCRIPT, env: () => Promise.resolve(appEnv()), timeoutMs: 10_000 })
    await expect(run(['pr', 'list'], join(scratch, 'no-such-folder'))).rejects.toThrow(`gh not found (${SCRIPT})`)
  })

  it('a script that is not there is "gh not found" with its path, not the error of the Node that would run it', async () => {
    const missing = join(scratch, 'no-such-gh.mjs')
    const run = ghRunner({ command: missing, env: () => Promise.resolve(appEnv()), timeoutMs: 10_000 })
    await expect(run(['pr', 'list'], scratch)).rejects.toThrow(`gh not found (${missing})`)
  })
})
