// The build of an Update in worfy's own clone (worfy-update ticket 03, ADR-0089 points 3, 5 and 6):
// a bare repository in a temporary folder stands in for GitHub, the stand-ins of
// test/fixtures/update/ for `pnpm install` and `pnpm package`. No network, no real build, no real
// Stable copy: the copy of a test is a folder in its temporary folder.
//
// And "Update automatically": the UpdateService over a fake GitHub client and a builder that only
// notes what it was asked to build.
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AvailableUpdate, UpdateSnapshot } from '../../src/shared/ipc/update'
import { UpdateService } from '../../src/main/ipc/update'
import { autoBuildFor, installTarget } from '../../src/main/update/auto'
import { UpdateBuilder, updateRepo, UPDATE_REPO } from '../../src/main/update/build'
import type { UpdateGitHub } from '../../src/main/update/check'
import { changeUpdateState, emptyUpdateState, readUpdateState } from '../../src/main/update/state'
import { removeTestTree } from '../remove'
import { findScriptNode } from '../script-node'
import { ms } from '../time-scale'

vi.mock('electron', () => ({ app: {}, shell: { openPath: () => Promise.resolve('') }, BrowserWindow: { getAllWindows: () => [] } }))

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'update')
const WINDOWS = process.platform === 'win32'
/** The tests' node, asked for on first use: never while the file loads (test/unit/e2e-no-spawn-on-load.test.ts). */
let scriptNode: string | undefined
const node = (): string => (scriptNode ??= findScriptNode(process.env))
const SECRET = 'gh-secret-not-for-the-build'

let root: string
let origin: string
let work: string
let dir: string
let bin: string
let trace: string
let pids: string

/** git with an identity of its own, in `cwd`. */
function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8' }).trim()
}

/** Commits `marker` as marker.txt in the work tree and pushes it to `branch` of the origin; answers the SHA. */
function commit(marker: string, branch = 'main'): string {
  writeFileSync(join(work, 'marker.txt'), `${marker}\n`)
  git(work, 'add', '-A')
  git(work, 'commit', '-qm', `commit ${marker}`)
  git(work, 'push', '-q', 'origin', `HEAD:refs/heads/${branch}`)
  return git(work, 'rev-parse', 'HEAD')
}

/** Puts a program named `name` into `folder` that runs `script` with the tests' node. */
function putProgram(folder: string, name: string, script: string): void {
  if (WINDOWS) {
    writeFileSync(join(folder, `${name}.cmd`), `@"${node()}" "${script}" %*\r\n`)
  } else {
    writeFileSync(join(folder, name), `#!/bin/sh\nexec "${node()}" "${script}" "$@"\n`)
    chmodSync(join(folder, name), 0o755)
  }
}

/** A program that only notes its call in `log`, for the case where none may run. */
function putRecorder(folder: string, name: string, log: string): void {
  if (WINDOWS) {
    writeFileSync(join(folder, `${name}.cmd`), `@echo ${name} %*>>"${log}"\r\n`)
  } else {
    writeFileSync(join(folder, name), `#!/bin/sh\necho "${name} $*" >>"${log}"\n`)
    chmodSync(join(folder, name), 0o755)
  }
}

const available = (sha: string, version = `0.9.0+${sha.slice(0, 7)}`): AvailableUpdate => ({ sha, version, quiet: false })

/**
 * The environment of worfy in a test: the pnpm stand-in first on the PATH, and both tokens set, in
 * capitals and in small letters (Windows reads a variable's name in any case).
 */
function processEnv(extra: Record<string, string> = {}): Record<string, string | undefined> {
  return {
    ...process.env,
    PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
    GH_TOKEN: SECRET,
    GITHUB_TOKEN: SECRET,
    gh_token: SECRET,
    github_token: SECRET,
    FAKE_UPDATE_TRACE: trace,
    FAKE_UPDATE_PIDS: pids,
    ...extra,
  }
}

const stateFile = (): string => join(dir, 'state.json')

interface BuilderOptions {
  build?: string
  /** The environment each build gets; asked for anew before each one. */
  env?: () => Record<string, string | undefined>
  /** Why the login shell was not read, as captureLoginShellEnv says it. */
  envError?: string
  /** Where the environment came from, as CapturedEnv says it; `fallback` when `envError` is given, else `login-shell`. */
  envFrom?: 'login-shell' | 'registry' | 'fallback'
  gitTimeoutMs?: number
  onChange?: () => void
}

function builder(options: BuilderOptions = {}): UpdateBuilder {
  return new UpdateBuilder({
    dir,
    repo: origin,
    build: options.build ?? join(FIXTURES, 'build-ok.mjs'),
    env: () =>
      Promise.resolve({
        env: options.env?.() ?? processEnv(),
        error: options.envError ?? null,
        from: options.envFrom ?? (options.envError === undefined ? 'login-shell' : 'fallback'),
      }),
    stateFile,
    ...(options.gitTimeoutMs === undefined ? {} : { gitTimeoutMs: options.gitTimeoutMs }),
    ...(options.onChange === undefined ? {} : { onChange: options.onChange }),
  })
}

/** The pids hang.mjs wrote. */
const hangPids = (): number[] => (existsSync(pids) ? readFileSync(pids, 'utf8').trim().split('\n').map(Number) : [])

/** Whether a process with this pid runs. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const traceLines = (): string[] => (existsSync(trace) ? readFileSync(trace, 'utf8').trim().split('\n') : [])
const buildLog = (): string => readFileSync(join(dir, 'build.log'), 'utf8')
const expectedApp = (): string => join(dir, 'repo', 'dist', ...(WINDOWS ? ['win-unpacked'] : ['mac-arm64', 'worfy.app']))

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-update-build-')))
  origin = join(root, 'origin.git')
  work = join(root, 'work')
  dir = join(root, 'data', 'update')
  bin = join(root, 'bin')
  trace = join(root, 'trace.log')
  pids = join(root, 'pids.log')
  for (const folder of [work, bin]) mkdirSync(folder, { recursive: true })
  git(root, 'init', '-q', '--bare', origin)
  git(work, 'init', '-q')
  git(work, 'remote', 'add', 'origin', origin)
  writeFileSync(join(work, 'package.json'), '{ "name": "fixture", "version": "0.9.0" }\n')
  putProgram(bin, 'pnpm', join(FIXTURES, 'pnpm.mjs'))
})

afterEach(() => {
  // A process a failed test left running: it is not left for the next run.
  for (const pid of hangPids()) if (alive(pid)) process.kill(pid, 'SIGKILL')
  removeTestTree(root)
})

describe('the clone of Update', () => {
  it('is GitHub\'s worfy unless WORFY_UPDATE_REPO names another', () => {
    // The host is put together, so test/unit/no-github-git.test.ts does not take this file's local
    // clones for git against GitHub.
    expect(UPDATE_REPO).toBe(`https://${['github', 'com'].join('.')}/IDSAD-XL/worfy.git`)
    expect(updateRepo({})).toBe(UPDATE_REPO)
    expect(updateRepo({ WORFY_UPDATE_REPO: '' })).toBe(UPDATE_REPO)
    expect(updateRepo({ WORFY_UPDATE_REPO: origin })).toBe(origin)
  })
})

describe('UpdateBuilder', () => {
  it('clones on the first build and only fetches on the next, then is ready with the app it built', async () => {
    const first = commit('A')
    const builds = builder()
    builds.install(available(first))
    expect(readUpdateState(stateFile()).build).toMatchObject({ phase: 'building', sha: first })
    await builds.settled()
    expect(readUpdateState(stateFile()).build).toEqual({ phase: 'ready', sha: first, version: `0.9.0+${first.slice(0, 7)}`, appPath: expectedApp(), log: join(dir, 'build.log') })
    expect(readFileSync(join(expectedApp(), 'marker.txt'), 'utf8')).toBe('A\n')
    expect(buildLog()).toContain(`$ git clone -c core.autocrlf=false -c core.eol=lf -- ${origin}`)

    const second = commit('B')
    builds.install(available(second))
    await builds.settled()
    expect(readUpdateState(stateFile()).build).toMatchObject({ phase: 'ready', sha: second, appPath: expectedApp() })
    expect(readFileSync(join(expectedApp(), 'marker.txt'), 'utf8')).toBe('B\n')
    // A new log for each build; the second one fetched into the clone it kept.
    expect(buildLog()).not.toContain('git clone')
    expect(buildLog()).toContain('$ git fetch origin')
    expect(git(join(dir, 'repo'), 'rev-parse', 'HEAD')).toBe(second)
    // node_modules outlived the clean: the clone was not made again.
    expect(readFileSync(join(dir, 'repo', 'node_modules', '.installs'), 'utf8')).toBe('install\ninstall\n')
    expect(traceLines()).toEqual(['install A', 'build A', 'install B', 'build B'])
  })

  it('a failing build is `failed` with its output in build.log; the Stable copy of the test is left as it was', async () => {
    const stable = join(root, 'Applications', 'worfy-stable.app')
    mkdirSync(join(stable, 'Contents'), { recursive: true })
    writeFileSync(join(stable, 'Contents', 'Info.plist'), 'the copy that runs\n')
    const sha = commit('A')
    const builds = builder({ build: join(FIXTURES, 'build-fail.mjs'), env: () => processEnv({ WORFY_UPDATE_STABLE: stable }) })
    builds.install(available(sha))
    await builds.settled()
    expect(readUpdateState(stateFile()).build).toEqual({ phase: 'failed', sha, version: `0.9.0+${sha.slice(0, 7)}`, log: join(dir, 'build.log') })
    expect(buildLog()).toContain('fake build failed: electron-builder said no')
    expect(readdirSync(stable, { recursive: true }).sort()).toEqual(['Contents', join('Contents', 'Info.plist')])
    expect(readFileSync(join(stable, 'Contents', 'Info.plist'), 'utf8')).toBe('the copy that runs\n')
  })

  it('without pnpm on the PATH it is `failed` with `missing: [pnpm]`, and starts nothing', async () => {
    const only = join(root, 'only-git-and-node')
    const calls = join(root, 'calls.log')
    mkdirSync(only)
    putRecorder(only, 'git', calls)
    putRecorder(only, 'node', calls)
    const sha = commit('A')
    const env = { ...(WINDOWS && process.env.SystemRoot !== undefined ? { SystemRoot: process.env.SystemRoot } : {}), PATH: only, FAKE_UPDATE_TRACE: trace }
    const builds = builder({ env: () => env })
    builds.install(available(sha))
    await builds.settled()
    expect(readUpdateState(stateFile()).build).toMatchObject({ phase: 'failed', sha, missing: ['pnpm'] })
    expect(buildLog()).toContain('pnpm')
    expect(existsSync(calls)).toBe(false)
    expect(existsSync(join(dir, 'repo'))).toBe(false)
    expect(traceLines()).toEqual([])
  })

  it('refuses a SHA that is not a commit of main of its own origin: nothing is installed or built', async () => {
    commit('A')
    const side = commit('S', 'side')
    const builds = builder()
    builds.install(available(side))
    await builds.settled()
    expect(readUpdateState(stateFile()).build).toMatchObject({ phase: 'failed', sha: side })
    expect(buildLog()).toContain(`${side} is not a commit of main of ${origin}`)
    expect(traceLines()).toEqual([])
    expect(existsSync(join(dir, 'repo', 'dist'))).toBe(false)

    // A SHA the origin does not have at all, after a fetch into the clone that is there now.
    const unknown = 'f'.repeat(40)
    builds.install(available(unknown))
    await builds.settled()
    expect(readUpdateState(stateFile()).build).toMatchObject({ phase: 'failed', sha: unknown })
    expect(buildLog()).toContain('$ git fetch origin')
    expect(buildLog()).toContain(`${unknown} is not a commit of main of ${origin}`)
    expect(traceLines()).toEqual([])
  })

  it('builds the bytes of main: no line-ending conversion, though the global git config (Git for Windows: core.autocrlf=true) or the clone asks for one', async () => {
    const globalConfig = join(root, 'gitconfig-crlf')
    writeFileSync(globalConfig, '[core]\n\tautocrlf = true\n\teol = crlf\n')
    const env = (): Record<string, string | undefined> => processEnv({ GIT_CONFIG_GLOBAL: globalConfig })
    const first = commit('A')
    const builds = builder({ env })
    builds.install(available(first))
    await builds.settled()
    expect(readUpdateState(stateFile()).build).toMatchObject({ phase: 'ready', sha: first })
    expect(readFileSync(join(dir, 'repo', 'marker.txt'), 'utf8')).toBe('A\n')
    expect(readFileSync(join(expectedApp(), 'marker.txt'), 'utf8')).toBe('A\n')

    // A clone whose own config asks for the conversion: the next build sets it back before checkout.
    git(join(dir, 'repo'), 'config', 'core.autocrlf', 'true')
    const second = commit('B')
    builds.install(available(second))
    await builds.settled()
    expect(readUpdateState(stateFile()).build).toMatchObject({ phase: 'ready', sha: second })
    expect(readFileSync(join(dir, 'repo', 'marker.txt'), 'utf8')).toBe('B\n')
    expect(readFileSync(join(expectedApp(), 'marker.txt'), 'utf8')).toBe('B\n')
  })

  it('fetches from the origin it was given, whatever the clone had: the remote comes from the configuration only', async () => {
    const first = commit('A')
    const builds = builder()
    builds.install(available(first))
    await builds.settled()
    // Someone pointed the clone elsewhere; the next build points it back before it fetches.
    const other = join(root, 'other.git')
    git(root, 'init', '-q', '--bare', other)
    git(join(dir, 'repo'), 'remote', 'set-url', 'origin', other)
    const second = commit('B')
    builds.install(available(second))
    await builds.settled()
    expect(readUpdateState(stateFile()).build).toMatchObject({ phase: 'ready', sha: second })
    expect(git(join(dir, 'repo'), 'remote', 'get-url', 'origin')).toBe(origin)
  })

  it('no step gets GH_TOKEN or GITHUB_TOKEN, in capitals or small letters, though worfy has all four; build.log names no value', async () => {
    const sha = commit('A')
    const builds = builder()
    builds.install(available(sha))
    await builds.settled()
    expect(readUpdateState(stateFile()).build.phase).toBe('ready')
    const log = buildLog()
    expect(log).toContain('install: tokens=none')
    expect(log).toContain('build: tokens=none')
    expect(log).not.toContain(SECRET)
  })

  it('builds one at a time: an Update that comes during a build waits for its end, and only the last one waiting is built', async () => {
    const a = commit('A')
    const b = commit('B')
    const c = commit('C')
    const changes: string[] = []
    const builds = builder({ onChange: () => changes.push(readUpdateState(stateFile()).build.phase) })
    builds.install(available(a))
    builds.install(available(a))
    builds.install(available(b))
    builds.install(available(c))
    expect(builds.building).toBe(true)
    await builds.settled()
    expect(builds.building).toBe(false)
    expect(traceLines()).toEqual(['install A', 'build A', 'install C', 'build C'])
    expect(readUpdateState(stateFile()).build).toMatchObject({ phase: 'ready', sha: c })
    expect(changes).toEqual(['building', 'ready', 'building', 'ready'])
    expect(b).not.toBe(c)
  })

  it('an environment that does not come fails the build; it never stays `building`', async () => {
    const sha = commit('A')
    const builds = new UpdateBuilder({ dir, repo: origin, env: () => Promise.reject(new Error('the env capture threw')), stateFile })
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    builds.install(available(sha))
    await builds.settled()
    quiet.mockRestore()
    expect(readUpdateState(stateFile()).build).toEqual({ phase: 'failed', sha, version: `0.9.0+${sha.slice(0, 7)}`, log: join(dir, 'build.log') })
  })

  it('stop() at quit ends the step that runs and builds nothing after it; the state is left `building` for recover()', async () => {
    const a = commit('A')
    const b = commit('B')
    const builds = builder({ build: join(FIXTURES, 'build-hang.mjs') })
    builds.install(available(a))
    builds.install(available(b))
    await vi.waitFor(() => expect(traceLines()).toContain('build A'), { timeout: ms(10_000), interval: 50 })
    builds.stop()
    // settled() waits for the step to close: the stand-in, which never ends by itself, was ended.
    await builds.settled()
    expect(builds.building).toBe(false)
    expect(traceLines()).toEqual(['install A', 'build A'])
    expect(readUpdateState(stateFile()).build).toMatchObject({ phase: 'building', sha: a })
    builds.install(available(b))
    expect(builds.building).toBe(false)
    builder().recover()
    expect(readUpdateState(stateFile()).build).toEqual({ phase: 'idle' })
  })

  it('stop() ends the processes a step started too: nothing the build started outlives it (electron-builder under pnpm package)', async () => {
    const sha = commit('A')
    const builds = builder({ build: join(FIXTURES, 'build-grandchild.mjs') })
    builds.install(available(sha))
    await vi.waitFor(() => expect(hangPids()).toHaveLength(1), { timeout: ms(10_000), interval: 50 })
    const [grandchild] = hangPids() as [number]
    expect(alive(grandchild)).toBe(true)
    builds.stop()
    await builds.settled()
    await vi.waitFor(() => expect(alive(grandchild)).toBe(false), { timeout: ms(5_000), interval: 50 })
  })

  it('stop() while the environment is being read: no step starts after it', async () => {
    const sha = commit('A')
    let give: (() => void) | undefined
    const builds = new UpdateBuilder({
      dir,
      repo: origin,
      build: join(FIXTURES, 'build-ok.mjs'),
      env: () => new Promise((resolve) => (give = () => resolve({ env: processEnv(), error: null, from: 'login-shell' }))),
      stateFile,
    })
    builds.install(available(sha))
    await vi.waitFor(() => expect(give).toBeDefined())
    builds.stop()
    give?.()
    await builds.settled()
    expect(existsSync(join(dir, 'repo'))).toBe(false)
    expect(buildLog()).not.toContain('$ git')
    expect(traceLines()).toEqual([])
  })

  it('writes why the login shell was not read into build.log, and asks for the environment anew before each build: a pnpm installed after a failure is found', async () => {
    const sha = commit('A')
    let withPnpm = false
    // git and node are there (they only note a call, and none may come), pnpm is not.
    const bare = join(root, 'no-pnpm')
    const calls = join(root, 'calls.log')
    mkdirSync(bare)
    putRecorder(bare, 'git', calls)
    putRecorder(bare, 'node', calls)
    const builds = builder({
      envError: '/bin/zsh -ilc failed: did not answer within 10 s',
      env: () => processEnv({ PATH: withPnpm ? `${bin}${delimiter}${process.env.PATH ?? ''}` : bare }),
    })
    builds.install(available(sha))
    await builds.settled()
    expect(readUpdateState(stateFile()).build).toMatchObject({ phase: 'failed', sha, missing: ['pnpm'] })
    expect(buildLog()).toContain('The environment of the login shell was not read; the build runs with a minimal one: /bin/zsh -ilc failed: did not answer within 10 s')
    expect(existsSync(calls)).toBe(false)

    // The user installed pnpm, then "Check now" and "Update worfy": the same SHA again.
    withPnpm = true
    builds.install(available(sha))
    await builds.settled()
    expect(readUpdateState(stateFile()).build).toMatchObject({ phase: 'ready', sha })
  })

  it('a note of a full environment (Windows: from the registry, Git Bash not found) is no fallback: build.log does not say the minimal one was used', async () => {
    const sha = commit('A')
    const builds = builder({ envError: 'Git Bash not found', envFrom: 'registry' })
    builds.install(available(sha))
    await builds.settled()
    expect(readUpdateState(stateFile()).build).toMatchObject({ phase: 'ready', sha })
    expect(buildLog()).not.toContain('The environment of the login shell was not read')
    expect(buildLog()).not.toContain('Git Bash not found')
  })

  it('a git step that does not end within its limit is ended, and the build is `failed` with the reason', async () => {
    const hanging = join(root, 'hanging-git')
    mkdirSync(hanging)
    putProgram(hanging, 'git', join(FIXTURES, 'hang.mjs'))
    const sha = commit('A')
    const builds = builder({ gitTimeoutMs: 300, env: () => processEnv({ PATH: `${hanging}${delimiter}${bin}${delimiter}${process.env.PATH ?? ''}` }) })
    builds.install(available(sha))
    await builds.settled()
    expect(readUpdateState(stateFile()).build).toMatchObject({ phase: 'failed', sha })
    expect(buildLog()).toContain('git did not end within 0.3 s and was stopped')
    expect(traceLines()).toEqual([])
    // The hanging git was ended with its step, whether or not it had started by then.
    await vi.waitFor(() => expect(hangPids().filter(alive)).toEqual([]), { timeout: ms(5_000), interval: 50 })
  })

  it('a build left `building` by a worfy that quit is idle again at the next start', () => {
    changeUpdateState((state) => ({ ...state, build: { phase: 'building', sha: 'a'.repeat(40), version: '0.9.0+aaaaaaa' } }), stateFile())
    builder().recover()
    expect(readUpdateState(stateFile()).build).toEqual({ phase: 'idle' })
    changeUpdateState((state) => ({ ...state, build: { phase: 'failed', sha: 'a'.repeat(40) } }), stateFile())
    builder().recover()
    expect(readUpdateState(stateFile()).build).toEqual({ phase: 'failed', sha: 'a'.repeat(40) })
  })
})

const A = 'a1'.padEnd(40, '0')
const B = 'b2'.padEnd(40, '0')
const RUNNING = 'c3'.padEnd(40, '0')

describe('which Update is built', () => {
  const state = (build: ReturnType<typeof emptyUpdateState>['build'], update: AvailableUpdate | null = available(A)) => ({ ...emptyUpdateState(), available: update, build })

  it('automatically: a new Available update that is not quiet, with "Update automatically" on', () => {
    expect(autoBuildFor(state({ phase: 'idle' }), true)).toEqual(available(A))
    expect(autoBuildFor(state({ phase: 'idle' }), false)).toBeNull()
    expect(autoBuildFor(state({ phase: 'idle' }, { ...available(A), quiet: true }), true)).toBeNull()
    expect(autoBuildFor(state({ phase: 'idle' }, null), true)).toBeNull()
    // Built, building or failed on this SHA: not again by itself.
    for (const phase of ['ready', 'building', 'failed'] as const) expect(autoBuildFor(state({ phase, sha: A }), true), phase).toBeNull()
    // The next SHA after any of them.
    for (const phase of ['ready', 'building', 'failed'] as const) expect(autoBuildFor(state({ phase, sha: B }), true), phase).toEqual(available(A))
  })

  it('when asked (`update.install`): the Available update, again after a failure, but not one already built or building', () => {
    expect(installTarget(state({ phase: 'idle' }))).toEqual(available(A))
    expect(installTarget(state({ phase: 'failed', sha: A }))).toEqual(available(A))
    expect(installTarget(state({ phase: 'idle' }, { ...available(A), quiet: true }))).toEqual({ ...available(A), quiet: true })
    expect(installTarget(state({ phase: 'ready', sha: A }))).toBeNull()
    expect(installTarget(state({ phase: 'building', sha: A }))).toBeNull()
    expect(installTarget(state({ phase: 'ready', sha: B }))).toEqual(available(A))
    expect(installTarget(state({ phase: 'idle' }, null))).toBeNull()
  })
})

/** A GitHub whose `main` is at `head`, green and ahead of RUNNING with a change of the app. */
function github(head: () => string): UpdateGitHub {
  return {
    headOfMain: () => Promise.resolve({ ok: true, value: head() }),
    ciOk: () => Promise.resolve({ ok: true, value: 'success' }),
    compare: () => Promise.resolve({ ok: true, value: { status: 'ahead', files: ['src/main/index.ts'], commits: [] } }),
    packageVersion: () => Promise.resolve({ ok: true, value: '0.9.0' }),
  }
}

describe('UpdateService and "Update automatically"', () => {
  let head = A
  let auto = true
  let asked: string[] = []
  let snapshots: UpdateSnapshot[] = []
  let opened: string[] = []

  beforeEach(() => {
    head = A
    auto = true
    asked = []
    snapshots = []
    opened = []
  })

  function service(options: { enabled?: boolean } = {}): UpdateService {
    return new UpdateService({
      enabled: options.enabled ?? true,
      running: () => ({ commit: RUNNING, version: `0.8.0+${RUNNING.slice(0, 7)}` }),
      client: github(() => head),
      stateFile,
      broadcast: (snapshot) => snapshots.push(snapshot),
      builder: { install: (update) => asked.push(update.sha), building: false, recover: () => undefined, stop: () => undefined, logFile: join(dir, 'build.log') },
      autoUpdate: () => auto,
      openPath: (path) => {
        opened.push(path)
        return Promise.resolve('')
      },
    })
  }

  it('with "Update automatically" on, the check that finds an Available update starts its build', async () => {
    await service().check()
    expect(asked).toEqual([A])
  })

  it('off, the check starts nothing', async () => {
    auto = false
    await service().check()
    expect(asked).toEqual([])
  })

  it('a quiet Update (the commit rolled back from) is not built by itself', async () => {
    changeUpdateState((state) => ({ ...state, rolledBackFrom: A }), stateFile())
    await service().checks.now(false)
    expect(readUpdateState(stateFile()).available).toMatchObject({ sha: A, quiet: true })
    expect(asked).toEqual([])
  })

  it('a build failed on A is not started again by itself; B is, and "Check now" then `update.install` retries A', async () => {
    changeUpdateState((state) => ({ ...state, build: { phase: 'failed', sha: A } }), stateFile())
    const updates = service()
    await updates.check()
    expect(asked).toEqual([])
    expect((await updates.install()).available?.sha).toBe(A)
    expect(asked).toEqual([A])
    head = B
    await updates.check()
    expect(asked).toEqual([A, B])
  })

  it('`update.install` with the Update built already does nothing and answers the snapshot', async () => {
    const updates = service()
    auto = false
    await updates.check()
    changeUpdateState((state) => ({ ...state, build: { phase: 'ready', sha: A, appPath: '/x' } }), stateFile())
    const snapshot = await updates.install()
    expect(asked).toEqual([])
    expect(snapshot).toMatchObject({ enabled: true, build: { phase: 'ready', sha: A } })
  })

  it('Update off (a dev build): `update.install` builds nothing and the check starts nothing', async () => {
    const updates = service({ enabled: false })
    await updates.check()
    expect((await updates.install()).enabled).toBe(false)
    expect(asked).toEqual([])
    expect(existsSync(stateFile())).toBe(false)
  })

  it('`update.showLog` opens build.log with the program of the system; without one it says so', async () => {
    const updates = service()
    await expect(updates.showLog()).rejects.toThrow('no build log')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'build.log'), 'log\n')
    await updates.showLog()
    expect(opened).toEqual([join(dir, 'build.log')])
  })
})
