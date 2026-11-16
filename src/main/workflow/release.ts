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
//
// The Stages never wait for the network (`peek`): a remote that drops packets holds `git ls-remote` for 20 s and
// `npm view` for 30 s. `peek` gives the last answer at once, or null before the first one, and asks in the
// background, every line at the same time; an answer that changes what was known calls back, and the caller
// computes the Stages again.
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

/**
 * A tag worfy passes to git: letters, digits and `._/+-@`, not starting with a sign other than `@`. `@` is for the tags
 * changesets makes, `<name>@<version>` and `@scope/name@<version>`; cmd.exe gives it no meaning inside a command line.
 * Not all `git check-ref-format` takes: `&`, `|`, `%` and the like would reach cmd.exe.
 */
const TAG = /^[A-Za-z0-9@][A-Za-z0-9._/+@-]*$/u
/** `<name>@<version>` of npm: a name of lower case letters, with a scope or without. */
const PACKAGE = /^((?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*)@(.+)$/u
/**
 * A plain semver version, a pre-release allowed: what `npm view <name>@<version> version` prints back as it is. A
 * `v`, build metadata (`+b1`) or a tag (`latest`) come back normalised or as another version, so such a line would
 * wait for good.
 */
const PLAIN_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u

/** The name and the version of a `package` line's ref, or why worfy does not pass it to npm. */
export function packageOf(ref: string): { name: string; version: string } | { reason: string } {
  const found = PACKAGE.exec(ref)
  if (!found) return { reason: `${ref} is not <name>@<version> worfy passes to npm` }
  const version = found[2]!
  if (!PLAIN_VERSION.test(version)) return { reason: `${version} is not a plain version such as 1.4.0 or 1.4.0-rc.1, so npm view would never print it back` }
  return { name: found[1]!, version }
}

const defaultRun: ReleaseToolRunner = (name, args, cwd, env, timeoutMs) => runTool(name, args, env, timeoutMs, { cwd })

const linesOf = (text: string): string[] =>
  text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== '')

const lastLine = (text: string): string => linesOf(text).at(-1) ?? ''

const keyOf = (release: TicketRelease, places: ReleasePlaces): string => [release.kind, release.ref, places.library ?? '', places.consumer ?? ''].join('\n')

const notChecked = (reason: string): ReleaseCheck => ({ state: 'not checked', reason })

/**
 * npm 11 answers a version the package does not have with E404, exit 1 and this summary (its lib/commands/view.js);
 * npm before 11 printed nothing and exited 0. A package that is not there or not readable with the consumer's .npmrc
 * is an E404 too, but with `404 Not Found - GET …`: that is not checked, as a private registry without access looks
 * the same.
 */
const NO_SUCH_VERSION = /^npm error 404 No match found for version /mu

/** npm's last line on a failure names its debug log, a new file on every run. */
const NPM_LOG = /A complete log of this run can be found in:/u

/**
 * What failed, by npm's stderr: the line after `npm error code <code>` that is not its syscall or errno, where npm puts
 * the summary before its help text; without a code, the last line. Never the debug log line.
 */
const npmReason = (stderr: string): string => {
  const lines = linesOf(stderr).filter((line) => !NPM_LOG.test(line))
  const code = lines.findIndex((line) => /^npm \S+ code \S+$/u.test(line))
  const summary = code === -1 ? undefined : lines.slice(code + 1).find((line) => !/^npm \S+ (?:syscall|errno) /u.test(line))
  return summary ?? lines.at(-1) ?? ''
}

/** Why a run that did not exit 0 tells nothing: its exit code and the line of its stderr `reasonOf` picks (the last). */
const failure = (command: string, run: ToolRun, reasonOf: (stderr: string) => string = lastLine): string => {
  if (run.missing) return `${command.split(' ')[0] ?? command} is not on the PATH`
  const reason = reasonOf(run.stderr)
  return `${command} exited ${run.code === null ? 'without a code' : String(run.code)}${reason === '' ? '' : `: ${reason}`}`
}

export class ReleaseReader {
  private readonly run: ReleaseToolRunner
  private readonly intervalMs: number
  private readonly now: () => number
  private readonly known = new Map<string, { check: ReleaseCheck; at: number }>()
  /** The questions on their way, by key, with whom to call back when the answer changes what was known. */
  private readonly asking = new Map<string, { answer: Promise<void>; callbacks: Set<() => void> }>()

  constructor(private readonly options: ReleaseReaderOptions) {
    this.run = options.run ?? defaultRun
    this.intervalMs = options.intervalMs ?? RELEASE_INTERVAL_MS
    this.now = options.now ?? Date.now
  }

  /**
   * The last answer about `release` at once, null before the first one. When there is none, or it is older than the
   * interval and not `released`, the line is asked about in the background (once, however many ask); `onAnswer` is
   * called when that answer differs from the last one.
   */
  peek(release: TicketRelease, places: ReleasePlaces, onAnswer?: () => void): ReleaseCheck | null {
    const key = keyOf(release, places)
    const kept = this.known.get(key)
    if (kept !== undefined && (kept.check.state === 'released' || this.now() - kept.at < this.intervalMs)) return kept.check
    let asking = this.asking.get(key)
    if (asking === undefined) {
      const callbacks = new Set<() => void>()
      const answer = this.ask(release, places)
        .catch((error: unknown) => notChecked(error instanceof Error ? error.message : String(error)))
        .then((check) => {
          const before = this.known.get(key)?.check
          this.known.set(key, { check, at: this.now() })
          this.asking.delete(key)
          if (before?.state !== check.state || before.reason !== check.reason) for (const callback of callbacks) callback()
        })
      asking = { answer, callbacks }
      this.asking.set(key, asking)
    }
    if (onAnswer !== undefined) asking.callbacks.add(onAnswer)
    return kept?.check ?? null
  }

  /** What is known of `release`, waiting for the answer when it has to be asked (peek). */
  async check(release: TicketRelease, places: ReleasePlaces): Promise<ReleaseCheck> {
    this.peek(release, places)
    await this.idle()
    // The answer just kept, without asking again: with an interval of 0 a second peek would ask once more.
    return this.known.get(keyOf(release, places))?.check ?? notChecked('no answer')
  }

  /** Resolves once no question is on its way. */
  async idle(): Promise<void> {
    while (this.asking.size > 0) await Promise.all([...this.asking.values()].map((asking) => asking.answer))
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
    if ('reason' in found) return notChecked(found.reason)
    if (consumer === null) return notChecked('no checkout of a consumer to run npm view in')
    const run = await this.run('npm', ['view', `${found.name}@${found.version}`, 'version'], consumer, await this.options.env(), NPM_TIMEOUT_MS)
    // Not published yet: npm 11 fails with E404 and `No match found for version`. Any other failure is not checked.
    if (run.code !== 0) return NO_SUCH_VERSION.test(run.stderr) ? { state: 'waiting', reason: null } : notChecked(failure('npm view', run, npmReason))
    // A published version is printed alone; a version that is not there prints nothing, with exit 0 (npm before 11).
    const printed = run.stdout.split(/\r?\n/u).map((line) => line.replace(/'/gu, '').trim().split(/\s+/u).at(-1))
    return { state: printed.includes(found.version) ? 'released' : 'waiting', reason: null }
  }
}

/** The environment for git: no variable that points it at another repository, and no prompt for a password. */
function gitEnv(env: Env): Env {
  return { ...Object.fromEntries(Object.entries(env).filter(([name]) => !GIT_LOCATION_VARS.includes(name))), GIT_TERMINAL_PROMPT: '0' }
}
