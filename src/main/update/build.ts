// The build of an Update in worfy's own clone (worfy-update ticket 03, ADR-0089 points 3 and 6):
// `<dataRoot>/update/repo`, made once with `git clone` and fetched into after that, then the same
// build as `pnpm install:stable`: `pnpm install --frozen-lockfile` and `pnpm package`
// (buildCommand of scripts/install-stable.mjs). The app it leaves is where builtApp of that script
// looks for it. The user's checkout and the folders of their Projects are never touched (ADR-0005),
// nor is the Stable copy: a build that fails leaves the copy that runs as it is.
//
// Trust: the clone's remote is the configured one (UPDATE_REPO or WORFY_UPDATE_REPO), set again
// before each fetch, never a value of GitHub's answer; and the SHA is built only when it is a commit
// of `main` of that remote (`git merge-base --is-ancestor`). So an API address that answers what it
// likes (WORFY_UPDATE_API is read in the packaged app too) can name only a commit of the real `main`.
//
// The steps get worfy's environment without GH_TOKEN and GITHUB_TOKEN: the build runs the scripts of
// the packages of `main`, and those need no token of the user. Their output goes to
// `<update>/build.log`, a new one for each build. One build at a time; an Update that comes during
// a build waits for its end (only the last one that waits is built).
import { spawn, type ChildProcess } from 'node:child_process'
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { AvailableUpdate, UpdateState } from '../../shared/ipc/update'
import { getVar, type CapturedEnv } from '../agent/env'
import { killTool, toolStart } from '../first-run/checks'
import { removeTree } from '../storage/remove'
import { changeUpdateState } from './state'

type Env = Readonly<Record<string, string | undefined>>
type UpdateBuild = UpdateState['build']

/** The repository Update clones: worfy on GitHub. */
export const UPDATE_REPO = 'https://github.com/IDSAD-XL/worfy.git'

/** The tools a build needs (spec, "Tools"; Settings → Health names the missing ones, ticket 08). */
export const BUILD_TOOLS = ['git', 'node', 'pnpm'] as const

/**
 * How long a git step may run: a clone of worfy over a slow line takes minutes, a fetch or a clone
 * that hangs (a network that stopped answering) would keep the build `building` for ever.
 */
export const GIT_STEP_TIMEOUT_MS = 30 * 60 * 1000

/**
 * The checkout settings of the clone: the bytes of `main`, whatever the machine's git asks for
 * (Git for Windows defaults to core.autocrlf=true). The repository's own .gitattributes still
 * applies; with core.eol=lf a `text=auto` file comes out as it is in the repository.
 */
const CHECKOUT_CONFIG = [
  ['core.autocrlf', 'false'],
  ['core.eol', 'lf'],
] as const

/** The variables no step of a build gets. */
const TOKEN_VARIABLES = new Set(['GH_TOKEN', 'GITHUB_TOKEN'])

/** The repository to clone: WORFY_UPDATE_REPO (tests: a bare repository in a temporary folder), else UPDATE_REPO. */
export function updateRepo(env: Env): string {
  return env.WORFY_UPDATE_REPO || UPDATE_REPO
}

/** The build in place of `pnpm package`: WORFY_UPDATE_BUILD, a `.mjs` that node runs in the clone (tests), else none. */
export function updateBuildOverride(env: Env): string | undefined {
  return env.WORFY_UPDATE_BUILD ? resolve(env.WORFY_UPDATE_BUILD) : undefined
}

export function buildLogFile(dir: string): string {
  return join(dir, 'build.log')
}

/** `env` without GH_TOKEN and GITHUB_TOKEN, in any case of the letters (Windows reads names so). */
export function withoutTokens(env: Env): Record<string, string> {
  const kept: Record<string, string> = {}
  for (const [name, value] of Object.entries(env)) if (value !== undefined && !TOKEN_VARIABLES.has(name.toUpperCase())) kept[name] = value
  return kept
}

/** An executable file `name` in a folder of the PATH of `env` (macOS, Linux). */
function onPosixPath(name: string, env: Env): boolean {
  return (getVar(env, 'PATH') ?? '').split(':').some((folder) => {
    if (folder === '') return false
    try {
      const stat = statSync(join(folder, name))
      return stat.isFile() && (stat.mode & 0o111) !== 0
    } catch {
      return false
    }
  })
}

/** The tools of BUILD_TOOLS the PATH of `env` lacks; on Windows found as First run finds them (toolStart). */
export function missingTools(env: Env, platform: NodeJS.Platform = process.platform): string[] {
  return BUILD_TOOLS.filter((tool) => (platform === 'win32' ? toolStart(tool, [], env, platform) === null : !onPosixPath(tool, env)))
}

/**
 * The app the build left in `dist`, as builtApp of scripts/install-stable.mjs finds it, or null.
 * Windows: dist\win-unpacked. Elsewhere: the one folder of dist whose name starts with `mac` and
 * that holds worfy.app.
 */
export function builtApp(dist: string, platform: NodeJS.Platform = process.platform): string | null {
  if (platform === 'win32') {
    const app = join(dist, 'win-unpacked')
    return existsSync(app) ? app : null
  }
  const names = existsSync(dist) ? readdirSync(dist) : []
  const found = names.filter((name) => name.startsWith('mac') && existsSync(join(dist, name, 'worfy.app')))
  return found.length === 1 ? join(dist, found[0] as string, 'worfy.app') : null
}

export interface UpdateBuilderOptions {
  /** `<dataRoot>/update`: the clone is `repo` in it, the log `build.log`. */
  dir: string
  /** The repository to clone and fetch from (updateRepo). */
  repo: string
  /** A `.mjs` that node runs in the clone in place of `pnpm package` (updateBuildOverride). */
  build?: string | undefined
  /**
   * worfy's environment for the steps, asked for anew before each build (the login shell's in the
   * app: a pnpm installed since the last build is found). The tokens are dropped from it. With
   * `from: 'fallback'`, `error` says why the login shell was not read and a minimal environment
   * came instead; it goes to build.log. Any other `from` is a full environment, whose `error` is
   * only a note (Windows: Git Bash not found) and is not written.
   */
  env: () => Promise<{ env: Env; error: string | null; from: CapturedEnv['from'] }>
  /** How long a git step may run (GIT_STEP_TIMEOUT_MS). */
  gitTimeoutMs?: number
  stateFile: () => string
  /** Hears each change of the build in the state file. */
  onChange?: () => void
  platform?: NodeJS.Platform
}

/** What the service of src/main/ipc/update.ts needs of a builder; tests pass a fake. */
export interface UpdateBuilds {
  install(update: AvailableUpdate): void
  readonly building: boolean
  /** A build the state file says runs, while none does (worfy quit during it), is idle again. */
  recover(): void
  /** Ends the step that runs; nothing is built after it. */
  stop(): void
  readonly logFile: string
}

export class UpdateBuilder implements UpdateBuilds {
  private current: { sha: string; done: Promise<void> } | null = null
  private waiting: AvailableUpdate | null = null
  private child: ChildProcess | null = null
  private stopped = false

  constructor(private readonly options: UpdateBuilderOptions) {}

  get building(): boolean {
    return this.current !== null
  }

  get logFile(): string {
    return buildLogFile(this.options.dir)
  }

  /** Builds `update`, or, while a build runs, after it; the SHA that builds now is not asked again. */
  install(update: AvailableUpdate): void {
    if (this.stopped) return
    if (this.current !== null) {
      if (this.current.sha !== update.sha) this.waiting = update
      return
    }
    this.begin(update)
  }

  /** Resolves when no build runs and none waits. */
  async settled(): Promise<void> {
    while (this.current !== null) await this.current.done
  }

  recover(): void {
    if (this.current !== null) return
    try {
      changeUpdateState((state) => (state.build.phase === 'building' ? { ...state, build: { phase: 'idle' } } : state), this.options.stateFile())
    } catch (error) {
      console.error('[update] the build state could not be reset', error)
    }
  }

  stop(): void {
    this.stopped = true
    this.waiting = null
    const child = this.child
    if (child !== null) this.kill(child)
  }

  /**
   * Ends a step with everything it started: `pnpm package` runs electron-builder under it, which
   * would go on writing the clone after worfy quit, under the next build. Off Windows the step leads
   * a process group of its own (spawned `detached`), and the whole group gets SIGKILL; on Windows
   * taskkill /T ends the tree (killTool).
   */
  private kill(child: ChildProcess): void {
    if (this.platform === 'win32') return killTool(child, this.platform, process.env)
    try {
      if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL')
    } catch {
      // The group is gone already, or the step never started.
      child.kill('SIGKILL')
    }
  }

  private get platform(): NodeJS.Platform {
    return this.options.platform ?? process.platform
  }

  private begin(update: AvailableUpdate): void {
    const { dir } = this.options
    const log = this.logFile
    const start = (): void => {
      mkdirSync(dir, { recursive: true })
      writeFileSync(log, `worfy Update ${update.version} (${update.sha}), ${new Date().toISOString()}\n`)
      this.write({ phase: 'building', sha: update.sha, version: update.version })
    }
    let done: Promise<void>
    try {
      start()
      done = this.build(update)
        .catch((error: unknown): UpdateBuild => {
          // A step that threw (the login shell's environment did not come, the log could not be
          // written) fails the build all the same: the state never stays `building`.
          console.error(`[update] the build of ${update.sha} failed`, error)
          return { phase: 'failed', sha: update.sha, version: update.version, log }
        })
        .then((build) => {
          // Stopped at quit: left `building`, and recover() makes it idle at the next start, so the
          // SHA is built again by itself rather than counted as failed.
          if (!this.stopped) this.write(build)
        })
    } catch (error) {
      done = Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }
    this.current = {
      sha: update.sha,
      done: done
        .catch((error: unknown) => console.error(`[update] the build of ${update.sha} failed`, error))
        .finally(() => {
          this.current = null
          const next = this.waiting
          this.waiting = null
          if (next !== null && !this.stopped) this.begin(next)
        }),
    }
  }

  private write(build: UpdateBuild): void {
    changeUpdateState((state) => ({ ...state, build }), this.options.stateFile())
    try {
      this.options.onChange?.()
    } catch (error) {
      console.error('[update] the change of the build could not be sent', error)
    }
  }

  /** The steps of one build; answers the build state to write. */
  private async build(update: AvailableUpdate): Promise<UpdateBuild> {
    const { dir, repo, build } = this.options
    const log = this.logFile
    const note = (text: string): void => appendFileSync(log, `${text}\n`)
    const failed = (extra: Partial<UpdateBuild> = {}): UpdateBuild => ({ phase: 'failed', sha: update.sha, version: update.version, log, ...extra })
    const captured = await this.options.env()
    if (captured.from === 'fallback' && captured.error !== null) note(`The environment of the login shell was not read; the build runs with a minimal one: ${captured.error}`)
    const env = withoutTokens(captured.env)

    const missing = missingTools(env, this.platform)
    if (missing.length > 0) {
      note(`Updates need git, node and pnpm: ${missing.join(', ')} not found on the PATH. Nothing was run.`)
      return failed({ missing })
    }

    const clone = join(dir, 'repo')
    const step = (tool: string, args: readonly string[], cwd = clone): Promise<boolean> => this.step(tool, args, cwd, env, log)
    if (existsSync(join(clone, '.git'))) {
      // The remote and the checkout settings are the configured ones, whatever the clone had.
      if (!(await step('git', ['remote', 'set-url', 'origin', repo]))) return failed()
      for (const [key, value] of CHECKOUT_CONFIG) if (!(await step('git', ['config', key, value]))) return failed()
      if (!(await step('git', ['fetch', 'origin', '+refs/heads/main:refs/remotes/origin/main']))) return failed()
    } else {
      // A clone that did not finish leaves a folder without .git, and git clone refuses a folder with files.
      if (existsSync(clone)) removeTree(clone)
      // `-c` of git clone is written into the new clone's config and applies to its first checkout too.
      const config = CHECKOUT_CONFIG.flatMap(([key, value]) => ['-c', `${key}=${value}`])
      if (!(await step('git', ['clone', ...config, '--', repo, clone], dir))) return failed()
    }
    if (this.stopped) return failed()
    if (!(await step('git', ['merge-base', '--is-ancestor', update.sha, 'refs/remotes/origin/main']))) {
      note(`Refused: ${update.sha} is not a commit of main of ${repo}. Nothing was built.`)
      return failed()
    }
    const steps: [string, string[]][] = [
      ['git', ['checkout', '--force', '--detach', update.sha]],
      ['git', ['clean', '-fdx', '-e', 'node_modules']],
      ['pnpm', ['install', '--frozen-lockfile']],
      build === undefined ? ['pnpm', ['package']] : ['node', [build]],
    ]
    for (const [tool, args] of steps) {
      if (this.stopped || !(await step(tool, args))) return failed()
    }
    const appPath = builtApp(join(clone, 'dist'), this.platform)
    if (appPath === null) {
      note(this.platform === 'win32' ? 'Expected dist\\win-unpacked after the build, and it is not there.' : 'Expected exactly one dist/mac*/worfy.app after the build.')
      return failed()
    }
    note('Ready.')
    return { phase: 'ready', sha: update.sha, version: update.version, appPath, log }
  }

  /**
   * Runs one step with its output into the log; answers whether it exited 0. None starts after
   * stop(). A git step that runs past its limit is ended and fails.
   */
  private step(tool: string, args: readonly string[], cwd: string, env: Env, log: string): Promise<boolean> {
    if (this.stopped) return Promise.resolve(false)
    const start = toolStart(tool, args, env, this.platform)
    appendFileSync(log, `\n$ ${[tool, ...args].join(' ')}\n`)
    if (start === null) {
      appendFileSync(log, `${tool} not found\n`)
      return Promise.resolve(false)
    }
    const fd = openSync(log, 'a')
    return new Promise((resolveStep) => {
      let child: ChildProcess
      try {
        // detached off Windows: a process group of its own, for kill(). The step is awaited to its
        // end, so it is not unref'd; at quit stop() ends it.
        child = spawn(start.file, start.args, { cwd, env: env as NodeJS.ProcessEnv, stdio: ['ignore', fd, fd], windowsHide: true, shell: start.shell, detached: this.platform !== 'win32' })
      } catch (error) {
        closeSync(fd)
        appendFileSync(log, `could not start ${tool}: ${error instanceof Error ? error.message : String(error)}\n`)
        resolveStep(false)
        return
      }
      this.child = child
      let failure: Error | null = null
      let timedOut = false
      const limit = this.options.gitTimeoutMs ?? GIT_STEP_TIMEOUT_MS
      const timer =
        tool === 'git'
          ? setTimeout(() => {
              timedOut = true
              this.kill(child)
            }, limit)
          : undefined
      child.once('error', (error) => {
        failure = error
      })
      // 'close' comes after 'error' too, when the process did not start.
      child.once('close', (code, signal) => {
        clearTimeout(timer)
        this.child = null
        closeSync(fd)
        if (timedOut) appendFileSync(log, `${tool} did not end within ${limit % 60_000 === 0 ? `${limit / 60_000} min` : `${limit / 1000} s`} and was stopped\n`)
        else if (failure !== null) appendFileSync(log, `could not start ${tool}: ${failure.message}\n`)
        else if (code !== 0) appendFileSync(log, `${tool} exited with ${code ?? signal ?? 'nothing'}\n`)
        resolveStep(!timedOut && failure === null && code === 0)
      })
    })
  }
}
