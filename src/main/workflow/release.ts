// Whether the release a Ticket over several repositories waits for has come (ADR-0104, items 5, 6). worfy makes no
// release; it only notices one, for each `Release:` line of the Ticket:
// - `tag` — the tag is in the remote `origin` of the library's checkout: `git ls-remote --tags origin refs/tags/<tag>`;
// - `package` — the version is published: `npm view <name>@<version> version` in the consumer's checkout, so its
//   `.npmrc` and registry settings apply.
// A remote or a registry that does not answer, and a line that cannot be asked about, is `not checked`, never
// `released`. Only reads: neither command writes to the checkouts (ADR-0005).
//
// Both programs start through runTool, with the login shell's environment: on Windows npm is a `.cmd` that only
// cmd.exe runs, and cmd.exe reads its command line, so a ref goes there only after it matches a strict pattern.
// An answer other than `released` is kept for `intervalMs` (the remote and the registry are on the network, and the
// Stages are computed every minute); `released` is kept for good.
import type { ReleaseFact } from '../../shared/workflow/pipeline'
import type { TicketRelease } from '../../shared/workflow/types'
import { runTool, type Env, type ToolRun } from '../first-run/tools'
import { isTopLevel } from './reader'

export type ReleaseState = ReleaseFact['state']

/** What one check saw: the state, and why it is `not checked` (null otherwise). */
export interface ReleaseCheck {
  state: ReleaseState
  reason: string | null
}

/** Where a line is asked about: the checkout of the library's repository (for a tag) and of a consumer (for a package). */
export interface ReleasePlaces {
  library: string | null
  consumer: string | null
}

/** Runs `git` or `npm` with `args` in `cwd`; never rejects (runTool). */
export type ReleaseToolRunner = (name: 'git' | 'npm', args: readonly string[], cwd: string, env: Env, timeoutMs: number) => Promise<ToolRun>

export interface ReleaseReaderOptions {
  /** The environment the programs start with: the login shell's (harnessScriptEnv), as for the Harness scripts. */
  env: () => Promise<Env>
  run?: ReleaseToolRunner
  /** How long an answer other than `released` is kept before the line is asked about again; 5 min by default. */
  intervalMs?: number
  now?: () => number
}

export const RELEASE_INTERVAL_MS = 5 * 60_000
const GIT_TIMEOUT_MS = 20_000
const NPM_TIMEOUT_MS = 30_000

/** Variables that would point git at another repository than the one `-C` names. */
const GIT_LOCATION_VARS = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE']

/** A tag worfy passes to git: letters, digits and `._/+-`, not starting with a sign. */
const TAG = /^[A-Za-z0-9][A-Za-z0-9._/+-]*$/u
/** `<name>@<version>` of npm: a name of lower case letters (with a scope or without), a version of letters, digits and `.+-`. */
const PACKAGE = /^((?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*)@([0-9A-Za-z][0-9A-Za-z.+-]*)$/u

/** The name and the version of a `package` line's ref; null when it is not `<name>@<version>` worfy passes to npm. */
export function packageOf(ref: string): { name: string; version: string } | null {
  const found = PACKAGE.exec(ref)
  return found ? { name: found[1]!, version: found[2]! } : null
}

const defaultRun: ReleaseToolRunner = (name, args, cwd, env, timeoutMs) => runTool(name, args, env, timeoutMs, { cwd })

const lastLine = (text: string): string =>
  text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .at(-1) ?? ''

const notChecked = (reason: string): ReleaseCheck => ({ state: 'not checked', reason })

/** Why a run that did not exit 0 tells nothing: its exit code and the last line of its stderr. */
const failure = (command: string, run: ToolRun): string =>
  run.missing ? `${command.split(' ')[0] ?? command} is not on the PATH` : `${command} exited ${run.code === null ? 'without a code' : String(run.code)}${lastLine(run.stderr) === '' ? '' : `: ${lastLine(run.stderr)}`}`

export class ReleaseReader {
  private readonly run: ReleaseToolRunner
  private readonly intervalMs: number
  private readonly now: () => number
  private readonly known = new Map<string, { check: ReleaseCheck; at: number }>()

  constructor(private readonly options: ReleaseReaderOptions) {
    this.run = options.run ?? defaultRun
    this.intervalMs = options.intervalMs ?? RELEASE_INTERVAL_MS
    this.now = options.now ?? Date.now
  }

  /** What is known of `release`: asked again when the last answer is older than the interval, unless it was `released`. */
  async check(release: TicketRelease, places: ReleasePlaces): Promise<ReleaseCheck> {
    const key = [release.kind, release.ref, places.library ?? '', places.consumer ?? ''].join('\n')
    const kept = this.known.get(key)
    if (kept !== undefined && (kept.check.state === 'released' || this.now() - kept.at < this.intervalMs)) return kept.check
    const check = await this.ask(release, places)
    this.known.set(key, { check, at: this.now() })
    return check
  }

  private async ask(release: TicketRelease, places: ReleasePlaces): Promise<ReleaseCheck> {
    if (release.kind === 'tag') return this.tag(release, places.library)
    if (release.kind === 'package') return this.published(release.ref, places.consumer)
    return notChecked(`worfy knows the kinds tag and package, not ${release.kind}`)
  }

  private async tag(release: TicketRelease, library: string | null): Promise<ReleaseCheck> {
    if (library === null) return notChecked(`the repository ${release.repo} is not among the repositories of the Profile`)
    if (!TAG.test(release.ref)) return notChecked(`${release.ref} is not a tag name worfy passes to git`)
    const env = gitEnv(await this.options.env())
    const git = async (cwd: string, args: string[]): Promise<string> => {
      const run = await this.run('git', ['-C', cwd, ...args], cwd, env, GIT_TIMEOUT_MS)
      if (run.code !== 0) throw new Error(failure(`git ${args[0] ?? ''}`, run))
      return run.stdout
    }
    // A folder inside another repository would give that repository's remote.
    if (!(await isTopLevel(library, git))) return notChecked(`${library} is not the top level of its repository`)
    const ref = `refs/tags/${release.ref}`
    const run = await this.run('git', ['-C', library, 'ls-remote', '--tags', 'origin', ref], library, env, GIT_TIMEOUT_MS)
    if (run.code !== 0) return notChecked(failure('git ls-remote', run))
    // The pattern matches the tail of a ref, so `refs/tags/x/refs/tags/<tag>` would be listed too: only the ref itself counts.
    const listed = run.stdout.split(/\r?\n/u).map((line) => line.split('\t')[1]?.trim())
    return { state: listed.some((name) => name === ref || name === `${ref}^{}`) ? 'released' : 'waiting', reason: null }
  }

  private async published(ref: string, consumer: string | null): Promise<ReleaseCheck> {
    const found = packageOf(ref)
    if (found === null) return notChecked(`${ref} is not <name>@<version> worfy passes to npm`)
    if (consumer === null) return notChecked('no checkout of a consumer to run npm view in')
    const run = await this.run('npm', ['view', `${found.name}@${found.version}`, 'version'], consumer, await this.options.env(), NPM_TIMEOUT_MS)
    if (run.code !== 0) return notChecked(failure('npm view', run))
    // A published version is printed alone; a version that is not there prints nothing, with exit 0.
    const printed = run.stdout.split(/\r?\n/u).map((line) => line.replace(/'/gu, '').trim().split(/\s+/u).at(-1))
    return { state: printed.includes(found.version) ? 'released' : 'waiting', reason: null }
  }
}

/** The environment for git: no variable that points it at another repository, and no prompt for a password. */
function gitEnv(env: Env): Env {
  return { ...Object.fromEntries(Object.entries(env).filter(([name]) => !GIT_LOCATION_VARS.includes(name))), GIT_TERMINAL_PROMPT: '0' }
}
