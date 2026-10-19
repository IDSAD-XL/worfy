// Whether the Harness in worfy's main has gone ahead of the Harness this build carries (worfy-harness
// ticket 21, ADR-0047): src/main/autopilot/harness-drift.ts over real git repositories in temporary
// folders. The check only reads: refs, the working tree and .git stay as they were, and `git fetch`
// is never run (ADR-0005; the Orchestrator fetches in the preflight of every Wave).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkHarnessDrift, HARNESS_DRIFT_INTERVAL_MS, harnessDriftWatch, type HarnessDrift } from '../../src/main/autopilot/harness-drift'
import { removeTestTree } from '../remove'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) removeTestTree(dir)
})

function tempDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-harness-drift-')))
  dirs.push(dir)
  return dir
}

const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))

/**
 * The settings of every git the tests run themselves. Auto maintenance is off: otherwise each
 * `git commit` starts `git maintenance run --auto --detach`, which outlives the commit, holds
 * .git/objects/maintenance.lock and removes it on its own time, while afterEach may already be
 * removing the folder.
 */
const GIT_SETTINGS = ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', '-c', 'maintenance.auto=false', '-c', 'gc.auto=0']

/** git with GIT_SETTINGS, in `cwd`, with `env` added to the environment of the tests' git. */
function gitWith(env: Record<string, string>, cwd: string, ...args: string[]): string {
  return execFileSync('git', [...GIT_SETTINGS, ...args], { cwd, env: { ...gitEnv, ...env }, encoding: 'utf8' }).trim()
}

function git(cwd: string, ...args: string[]): string {
  return gitWith({}, cwd, ...args)
}

function commit(repo: string, path: string, text: string): string {
  mkdirSync(join(repo, path, '..'), { recursive: true })
  writeFileSync(join(repo, path), text)
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', `change ${path}`)
  return git(repo, 'rev-parse', 'HEAD')
}

/**
 * A repository shaped like worfy's: harness/.claude-plugin/plugin.json named `worfy` (or `name`),
 * one commit, the build's. Answers the folder and the build version `0.1.0+<short SHA>`.
 */
function worfyRepo(name = 'worfy'): { repo: string; version: string; sha: string } {
  const repo = tempDir()
  git(repo, 'init', '-q')
  writeFileSync(join(repo, 'package.json'), '{"name":"worfy","version":"0.1.0"}\n')
  const sha = commit(repo, 'harness/.claude-plugin/plugin.json', `${JSON.stringify({ name, version: '0.0.0' })}\n`)
  return { repo, version: `0.1.0+${sha.slice(0, 7)}`, sha }
}

/** What a read-only check must leave as it was: every ref, the working tree's state, no FETCH_HEAD. */
function snapshot(repo: string): { refs: string; status: string; fetchHead: boolean } {
  return { refs: git(repo, 'for-each-ref'), status: git(repo, 'status', '--porcelain'), fetchHead: existsSync(join(repo, '.git', 'FETCH_HEAD')) }
}

/**
 * A `git` that writes its arguments to a log, one call per line, and runs the real one from the
 * PATH. It is a Node script: worfy starts a `.mjs` override as a script of its own Node
 * (src/main/program.ts), so it runs on Windows too, which cannot start a `#!/bin/sh` file.
 */
function loggingGit(): { path: string; calls: () => string[] } {
  const dir = tempDir()
  const log = join(dir, 'calls.log')
  const path = join(dir, 'git.mjs')
  writeFileSync(
    path,
    [
      "import { appendFileSync } from 'node:fs'",
      "import { spawnSync } from 'node:child_process'",
      'const args = process.argv.slice(2)',
      `appendFileSync(${JSON.stringify(log)}, args.join(' ') + '\\n')`,
      "const run = spawnSync('git', args, { stdio: 'inherit' })",
      'process.exit(run.status ?? 1)',
      '',
    ].join('\n'),
  )
  return { path, calls: () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : []) }
}

describe('the git of these tests', () => {
  it('a commit starts no background maintenance that would outlive it', () => {
    const repo = tempDir()
    git(repo, 'init', '-q')
    writeFileSync(join(repo, 'a.md'), 'a\n')
    git(repo, 'add', '.')
    // GIT_TRACE lists every process git starts: the commit goes through the helper, with a trace.
    const trace = join(tempDir(), 'trace.log')
    gitWith({ GIT_TRACE: trace }, repo, 'commit', '-q', '-m', 'traced')
    const started = readFileSync(trace, 'utf8').split('\n').filter((line) => line.includes('run_command:'))
    expect(started.filter((line) => /maintenance|gc --auto/.test(line))).toEqual([])
  })
})

describe('checkHarnessDrift', () => {
  it('a commit in harness/ after the build commit: the Harness in main is newer, by 1 commit', async () => {
    const { repo, version } = worfyRepo()
    commit(repo, 'harness/skills/lesson.md', 'a lesson\n')
    expect(await checkHarnessDrift({ root: repo, harnessVersion: version })).toEqual<HarnessDrift>({ kind: 'newer', harness: version, main: 'main', commits: 1 })
  })

  it('compares with origin/main when there is one, not with the local main', async () => {
    const { repo, version, sha } = worfyRepo()
    const lesson = commit(repo, 'harness/skills/lesson.md', 'a lesson\n')
    // The local main went back to the build commit; origin/main has the lesson.
    git(repo, 'update-ref', 'refs/remotes/origin/main', lesson)
    git(repo, 'reset', '-q', '--hard', sha)
    expect(await checkHarnessDrift({ root: repo, harnessVersion: version })).toEqual<HarnessDrift>({ kind: 'newer', harness: version, main: 'origin/main', commits: 1 })
    // And origin/main at the build commit: not newer, whatever the local main has.
    git(repo, 'update-ref', 'refs/remotes/origin/main', sha)
    commit(repo, 'harness/skills/other.md', 'local only\n')
    expect(await checkHarnessDrift({ root: repo, harnessVersion: version })).toEqual<HarnessDrift>({ kind: 'same', harness: version, main: 'origin/main' })
  })

  it('counts only the commits that change harness/', async () => {
    const { repo, version } = worfyRepo()
    commit(repo, 'harness/a.md', '1\n')
    commit(repo, 'src/a.ts', 'export {}\n')
    commit(repo, 'harness/b.md', '2\n')
    expect(await checkHarnessDrift({ root: repo, harnessVersion: version })).toMatchObject({ kind: 'newer', commits: 2 })
  })

  it('a commit only outside harness/: not newer', async () => {
    const { repo, version } = worfyRepo()
    commit(repo, 'src/main/index.ts', 'export {}\n')
    expect(await checkHarnessDrift({ root: repo, harnessVersion: version })).toEqual<HarnessDrift>({ kind: 'same', harness: version, main: 'main' })
  })

  it('a dirty build is compared from its commit', async () => {
    const { repo, version } = worfyRepo()
    commit(repo, 'harness/a.md', '1\n')
    expect(await checkHarnessDrift({ root: repo, harnessVersion: `${version}.dirty` })).toMatchObject({ kind: 'newer', harness: `${version}.dirty`, commits: 1 })
  })

  it('a build SHA the repository does not have: unknown, with the reason', async () => {
    const { repo } = worfyRepo()
    const drift = await checkHarnessDrift({ root: repo, harnessVersion: '0.1.0+deadbee' })
    expect(drift).toEqual({ kind: 'unknown', reason: expect.stringContaining('deadbee') as unknown as string })
  })

  it('a version without +<SHA>: unknown, and git is not asked', async () => {
    const { repo } = worfyRepo()
    const fake = loggingGit()
    for (const harnessVersion of ['0.1.0', undefined, '0.1.0+not-a-sha']) {
      const drift = await checkHarnessDrift({ root: repo, harnessVersion, git: fake.path })
      expect(drift.kind).toBe('unknown')
      expect(drift.kind === 'unknown' && drift.reason.split('\n')).toHaveLength(1)
    }
    expect(fake.calls()).toEqual([])
  })

  it('a repository without harness/.claude-plugin/plugin.json, or whose plugin is not worfy: no mark', async () => {
    const plain = tempDir()
    git(plain, 'init', '-q')
    const sha = commit(plain, 'README.md', 'hi\n')
    commit(plain, 'harness/a.md', '1\n')
    expect(await checkHarnessDrift({ root: plain, harnessVersion: `0.1.0+${sha.slice(0, 7)}` })).toMatchObject({ kind: 'unknown' })
    const other = worfyRepo('not-worfy')
    commit(other.repo, 'harness/a.md', '1\n')
    expect(await checkHarnessDrift({ root: other.repo, harnessVersion: other.version })).toMatchObject({ kind: 'unknown' })
  })

  it('a folder outside git: unknown', async () => {
    const dir = tempDir()
    mkdirSync(join(dir, 'harness', '.claude-plugin'), { recursive: true })
    writeFileSync(join(dir, 'harness', '.claude-plugin', 'plugin.json'), '{"name":"worfy"}')
    expect(await checkHarnessDrift({ root: dir, harnessVersion: '0.1.0+abcdef1' })).toMatchObject({ kind: 'unknown' })
  })

  it('writes nothing into the repository: the same refs, the same status, no FETCH_HEAD, and git never gets fetch', async () => {
    const { repo, version, sha } = worfyRepo()
    const lesson = commit(repo, 'harness/skills/lesson.md', 'a lesson\n')
    git(repo, 'update-ref', 'refs/remotes/origin/main', lesson)
    git(repo, 'remote', 'add', 'origin', join(repo, 'nowhere'))
    git(repo, 'reset', '-q', '--hard', sha)
    writeFileSync(join(repo, 'untracked.txt'), 'left as it is\n')
    const before = snapshot(repo)
    const fake = loggingGit()
    expect(await checkHarnessDrift({ root: repo, harnessVersion: version, git: fake.path })).toMatchObject({ kind: 'newer', main: 'origin/main', commits: 1 })
    expect(await checkHarnessDrift({ root: repo, harnessVersion: '0.1.0+deadbee', git: fake.path })).toMatchObject({ kind: 'unknown' })
    expect(snapshot(repo)).toEqual(before)
    expect(before.fetchHead).toBe(false)
    const calls = fake.calls()
    expect(calls.length).toBeGreaterThan(0)
    // Only the reading commands, and nothing fetches.
    expect([...new Set(calls.map((call) => call.split(' ')[0]))].sort()).toEqual(['cat-file', 'rev-list', 'rev-parse'])
    expect(calls.filter((call) => call.includes('fetch'))).toEqual([])
  })
})

describe('harnessDriftWatch', () => {
  const behind: HarnessDrift = { kind: 'newer', harness: '0.1.0+abcdef1', main: 'origin/main', commits: 2 }

  it('answers the mark of a newer Harness, and null for same and unknown', async () => {
    const answers: HarnessDrift[] = [behind, { kind: 'same', harness: '0.1.0+abcdef1', main: 'main' }, { kind: 'unknown', reason: 'no build SHA' }]
    for (const answer of answers) {
      const watch = harnessDriftWatch({ packaged: true, harnessVersion: () => '0.1.0+abcdef1', check: () => Promise.resolve(answer), log: () => undefined })
      expect(await watch('p', '/repo')).toEqual(answer.kind === 'newer' ? { harness: answer.harness, main: answer.main, commits: answer.commits } : null)
    }
  })

  it('a development build has no mark and runs no check', async () => {
    const check = vi.fn(() => Promise.resolve(behind))
    const watch = harnessDriftWatch({ packaged: false, harnessVersion: () => '0.1.0+abcdef1', check })
    expect(await watch('p', '/repo')).toBeNull()
    expect(check).not.toHaveBeenCalled()
  })

  it('checks a Project at most once in 60 s; another Project is checked on its own', async () => {
    let now = 1_000_000
    const check = vi.fn((input: { root: string; harnessVersion: string | undefined }) => Promise.resolve<HarnessDrift>({ ...behind, harness: input.harnessVersion ?? '' }))
    const watch = harnessDriftWatch({ packaged: true, harnessVersion: () => '0.1.0+abcdef1', check, now: () => now })
    await Promise.all([watch('p', '/repo'), watch('p', '/repo')])
    expect(check).toHaveBeenCalledTimes(1)
    now += HARNESS_DRIFT_INTERVAL_MS - 1
    await watch('p', '/repo')
    expect(check).toHaveBeenCalledTimes(1)
    await watch('q', '/other')
    expect(check).toHaveBeenCalledTimes(2)
    now += 1
    await watch('p', '/repo')
    expect(check).toHaveBeenCalledTimes(3)
    expect(check).toHaveBeenLastCalledWith(expect.objectContaining({ root: '/repo', harnessVersion: '0.1.0+abcdef1' }))
  })

  it('logs why there is no mark once per Project, and a check that throws is no mark', async () => {
    let now = 0
    const log = vi.fn()
    const check = vi.fn(() => Promise.resolve<HarnessDrift>({ kind: 'unknown', reason: 'not worfy' }))
    const watch = harnessDriftWatch({ packaged: true, harnessVersion: () => undefined, check, now: () => now, log })
    await watch('p', '/repo')
    now += HARNESS_DRIFT_INTERVAL_MS
    await watch('p', '/repo')
    await watch('q', '/other')
    expect(check).toHaveBeenCalledTimes(3)
    expect(log.mock.calls.map(([line]) => line as string)).toEqual([expect.stringMatching(/p.*not worfy/), expect.stringMatching(/q.*not worfy/)])
    const failing = harnessDriftWatch({ packaged: true, harnessVersion: () => '0.1.0+abcdef1', check: () => Promise.reject(new Error('boom')), log })
    expect(await failing('r', '/x')).toBeNull()
  })
})
