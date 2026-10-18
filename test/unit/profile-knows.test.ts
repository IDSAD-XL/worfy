// Whether the Harness knows a folder (src/main/projects/connect.ts, profileKnows; worfy-windows
// ticket 30): an answer of bin/profile is told from a bin/profile that gave none or failed. On
// Windows worfy once started the script file itself, the start failed, and the failure read as "the
// Harness does not know this folder": a folder already connected went into the form as a new one.
// The runner is a stand-in here; no process starts. The gate folders are temporary.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ConnectFolder } from '../../src/shared/ipc/projects'
import { profileKnows, resolverReason } from '../../src/main/projects/connect'
import { HarnessScriptStartError, type ProfileRun, type ProfileRunner } from '../../src/main/workflow/profile'
import { removeTestTree } from '../remove'

let scratch: string
/** The registry files bin/profile reads (profileRegistryFiles), the new one there. */
let withRegistry: string[]
/** Only the old ~/.claude/gate/config.json is there: bin/profile reads it. */
let legacyOnly: string[]
/** A fresh Harness: neither file. */
let fresh: string[]

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'worfy-profile-knows-'))
  for (const dir of ['harness-gate', 'old-gate']) {
    mkdirSync(join(scratch, dir))
    writeFileSync(join(scratch, dir, 'config.json'), '{"repos":[]}\n')
  }
  withRegistry = [join(scratch, 'harness-gate', 'config.json'), join(scratch, 'missing-old', 'config.json')]
  legacyOnly = [join(scratch, 'missing-new', 'config.json'), join(scratch, 'old-gate', 'config.json')]
  fresh = [join(scratch, 'missing-new', 'config.json'), join(scratch, 'missing-old', 'config.json')]
})

afterAll(() => removeTestTree(scratch))

/**
 * What harness/bin/profile prints on a fresh Harness, exit 1: its resolver (hooks/gate-resolve.mjs)
 * exits 4 because it cannot read the registry. The text of both scripts, paths shortened.
 */
const FRESH_STDERR =
  "profile: resolver /h/plugin/hooks/gate-resolve.mjs failed (exit 4) — project not determined: gate-resolve: registry /h/gate/config.json cannot be read: ENOENT: no such file or directory, open '/h/gate/config.json'\n"

const gitFolder: ConnectFolder = { kind: 'git', root: '/work/shop', repos: [{ name: 'shop', path: '/work/shop' }], notice: null }
const multiRepo: ConnectFolder = {
  kind: 'multi-repo',
  root: '/work/ws',
  repos: [
    { name: 'api', path: '/work/ws/api' },
    { name: 'web', path: '/work/ws/web' },
  ],
  notice: null,
}

const answers =
  (run: ProfileRun): ProfileRunner =>
  () =>
    Promise.resolve(run)
const fails =
  (error: Error): ProfileRunner =>
  () =>
    Promise.reject(error)

describe('profileKnows: bin/profile gave no answer — an error, not "not known"', () => {
  it.each([
    ['node is not on the PATH of the scripts', new HarnessScriptStartError('NODE_NOT_FOUND', 'node not found in PATH: /h/bin/profile is not run'), /bin\/profile could not be run: node not found in PATH/],
    ['there is no script', new HarnessScriptStartError('ENOENT', 'no Harness script at /h/bin/profile'), /bin\/profile could not be run: no Harness script at/],
    ['an older Harness on Windows', new HarnessScriptStartError('NOT_NODE', "this Harness's profile is not a Node script — update the Harness (/h/bin/profile)"), /not a Node script/],
    ['the start itself failed (ENOENT)', Object.assign(new Error('spawn /h/bin/profile ENOENT'), { code: 'ENOENT' }), /bin\/profile could not be run: spawn \/h\/bin\/profile ENOENT/],
  ])('%s: rejects, with the registry or without it', async (_case, error, reason) => {
    await expect(profileKnows(gitFolder, fails(error), withRegistry)).rejects.toThrow(reason)
    await expect(profileKnows(gitFolder, fails(error), fresh)).rejects.toThrow(reason)
  })

  it('stopped at its time limit (code null, no signal): rejects', async () => {
    await expect(profileKnows(gitFolder, answers({ code: null, stdout: '', stderr: '' }), withRegistry)).rejects.toThrow('bin/profile did not answer in time and was stopped')
  })

  it('ended by a signal: rejects with the signal', async () => {
    await expect(profileKnows(gitFolder, answers({ code: null, signal: 'SIGSEGV', stdout: '', stderr: '' }), withRegistry)).rejects.toThrow('bin/profile was ended by SIGSEGV')
  })

  it.each([127, 126])('exit code %i (the system found no interpreter): rejects with what stderr said', async (code) => {
    await expect(profileKnows(gitFolder, answers({ code, stdout: '', stderr: 'env: node: No such file or directory\n' }), fresh)).rejects.toThrow(
      `bin/profile could not be run: exit code ${code}: env: node: No such file or directory`,
    )
  })

  it('a multi-repo folder: the same', async () => {
    await expect(profileKnows(multiRepo, answers({ code: null, stdout: '', stderr: '' }), withRegistry)).rejects.toThrow('did not answer in time')
  })
})

describe('profileKnows: bin/profile failed — an error with what it said', () => {
  it('exit 1 with the registry there (a broken profile.json of a registered project): rejects with the reason', async () => {
    const broken = 'profile: /h/projects/shop/profile.json is not valid JSON: Unexpected end of JSON input\n'
    await expect(profileKnows(gitFolder, answers({ code: 1, stdout: '', stderr: broken }), withRegistry)).rejects.toThrow(
      'bin/profile failed with exit code 1: profile: /h/projects/shop/profile.json is not valid JSON: Unexpected end of JSON input',
    )
  })

  it('exit 1 with the registry there, a crash of node: its Error line, not the "Node.js vNN" line', async () => {
    const crash = '/h/bin/profile:120\n    throw x\n    ^\n\nTypeError: boom\n    at Object.<anonymous> (/h/bin/profile:120:5)\n\nNode.js v24.21.0\n'
    await expect(profileKnows(gitFolder, answers({ code: 1, stdout: '', stderr: crash }), withRegistry)).rejects.toThrow('bin/profile failed with exit code 1: TypeError: boom')
  })

  it('exit 1 with only the old ~/.claude/gate/config.json there (a broken old registry): rejects, not a new folder', async () => {
    const broken = 'profile: resolver /h/plugin/hooks/gate-resolve.mjs failed (exit 4) — project not determined: gate-resolve: registry /home/.claude/gate/config.json is broken: the "repos" field must be an array\n'
    await expect(profileKnows(gitFolder, answers({ code: 1, stdout: '', stderr: broken }), legacyOnly)).rejects.toThrow(
      new Error('bin/profile failed with exit code 1: registry /home/.claude/gate/config.json is broken: the "repos" field must be an array'),
    )
  })

  it('exit 1 with long paths (a temporary folder on macOS): the registry reason is whole, not cut at the limit of a reason', async () => {
    const deep = `/private/var/folders/3c/${'v'.repeat(28)}/T/worfy-connect-AbCdEf`
    const registry = `${deep}/home/.claude/worfy-harness/gate/config.json`
    const broken = `profile: resolver /Users/someone/Stuff/CanvasForAI/.claude/worktrees/gate-full-${'x'.repeat(80)}/harness/hooks/gate-resolve.mjs failed (exit 4) — project not determined: gate-resolve: registry ${registry} is broken: the "repos" field must be an array\n`
    expect(broken.length).toBeGreaterThan(400)
    await expect(profileKnows(gitFolder, answers({ code: 1, stdout: '', stderr: broken }), withRegistry)).rejects.toThrow(
      new Error(`bin/profile failed with exit code 1: registry ${registry} is broken: the "repos" field must be an array`),
    )
  })

  it('exit 2 (usage): rejects', async () => {
    await expect(profileKnows(gitFolder, answers({ code: 2, stdout: '', stderr: 'profile: no such directory: /work/shop\n' }), withRegistry)).rejects.toThrow(
      'bin/profile failed with exit code 2: profile: no such directory: /work/shop',
    )
  })
})

describe('profileKnows: what bin/profile answered', () => {
  it('exit 3, not in a registered project: false', async () => {
    expect(await profileKnows(gitFolder, answers({ code: 3, stdout: '', stderr: 'profile: /work/shop is not in a registered project\n' }), withRegistry)).toBe(false)
  })

  it('exit 1 of a fresh Harness, with neither registry file: false (bin/project-connect writes the registry)', async () => {
    expect(await profileKnows(gitFolder, answers({ code: 1, stdout: '', stderr: FRESH_STDERR }), fresh)).toBe(false)
  })

  it('exit 0: true for a git repository', async () => {
    expect(await profileKnows(gitFolder, answers({ code: 0, stdout: '{"name":"shop"}', stderr: '' }), withRegistry)).toBe(true)
  })

  it('exit 0 for a multi-repo folder: true only with _resolved.workspace', async () => {
    expect(await profileKnows(multiRepo, answers({ code: 0, stdout: '{"_resolved":{"workspace":null}}', stderr: '' }), withRegistry)).toBe(false)
    expect(await profileKnows(multiRepo, answers({ code: 0, stdout: '{"_resolved":{"workspace":"/work/ws"}}', stderr: '' }), withRegistry)).toBe(true)
  })

  it('asks bin/profile -C <root> --json in the folder', async () => {
    const asked: { cwd: string; args: readonly string[] }[] = []
    await profileKnows(
      gitFolder,
      (cwd, args) => {
        asked.push({ cwd, args })
        return Promise.resolve({ code: 3, stdout: '', stderr: '' })
      },
      withRegistry,
    )
    expect(asked).toEqual([{ cwd: '/work/shop', args: ['-C', '/work/shop', '--json'] }])
  })
})

describe('resolverReason: the gate resolver reason inside the stderr of bin/profile', () => {
  const reason = 'registry /h/gate/config.json is broken: the "repos" field must be an array'

  it('the line bin/profile wraps the resolver in: the reason only', () => {
    expect(resolverReason(`profile: resolver /h/plugin/hooks/gate-resolve.mjs failed (exit 4) — project not determined: gate-resolve: ${reason}\n`)).toBe(`${reason}\n`)
    expect(resolverReason(FRESH_STDERR)).toBe("registry /h/gate/config.json cannot be read: ENOENT: no such file or directory, open '/h/gate/config.json'\n")
  })

  it('the resolver line without the wrapping (the line bin/profile passes on as it is): the reason only', () => {
    expect(resolverReason(`gate-resolve: ${reason}\n`)).toBe(`${reason}\n`)
  })

  it('a message without the wrapping stays as it is', () => {
    const notJson = 'profile: /h/projects/shop/profile.json is not valid JSON: Unexpected end of JSON input\n'
    expect(resolverReason(notJson)).toBe(notJson)
    expect(resolverReason('')).toBe('')
  })

  it('a crash of the resolver keeps its wrapping: it says that the resolver crashed', () => {
    const crash = 'profile: resolver /h/plugin/hooks/gate-resolve.mjs failed (exit 1) — project not determined: TypeError: boom\n'
    expect(resolverReason(crash)).toBe(crash)
  })

  it('only the resolver line of several is unwrapped; gate-resolve: in the middle of a line stays', () => {
    const stderr = `warning: something else\r\nprofile: resolver /h/r.mjs failed (exit 4) — project not determined: gate-resolve: ${reason}\r\nnote: see gate-resolve: docs\n`
    expect(resolverReason(stderr)).toBe(`warning: something else\r\n${reason}\r\nnote: see gate-resolve: docs\n`)
  })
})
