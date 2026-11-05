// What an Autopilot run gives the approval policy (worfy-auto-approve ticket 04; the Epic spec, how it
// works, items 1, 3 and 7; security, items 5 and 9): the context of each request (policy.ts,
// PolicyContext) and the environment of the run's Session.
//
// When the run starts (openRunApproval) it reads git in the Project's root, in the environment of the
// Session's shell: a read of `core.hooksPath` that fails with another exit code than 1 (unset) throws,
// and the run then goes without a policy, since null would say "not set". It makes the run's folder
// for temporary files, `<WORFY_DATA_DIR>/autopilot-tmp/<run>/`. In Shadow and On the Session's agent
// gets that folder as TMPDIR, and git the run's environment (gitEnvironment): GIT_CONFIG_PARAMETERS
// with `safe.bareRepository=explicit` (git opens no bare repository it finds above the command's
// folder), `log.showSignature=false` and `format.pretty=medium` (a plain `git log` of the owner's
// config would run gpg.program), and GIT_NO_LAZY_FETCH=1 while hooksActive is not false (a partial
// clone would fetch a missing object through core.sshCommand). Only through GIT_CONFIG_PARAMETERS:
// under GIT_CONFIG_COUNT the parser of ticket 02 judges no git at all. In Off the agent gets none of it,
// as before the ticket.
//
// Each request is judged in the environment the Session's process started with: the whole one the
// driver tells (ApprovalAt.env), else the shell's with the run's variables over it (ApprovalAt.started),
// since CDPATH, BASH_ENV, IFS or a GIT_ variable change what a command does. The process keeps that
// environment when another run takes the Session over, or the mode changes. At each request git is read
// again — the worktree list (an implementer makes its worktree after the Wave started) and the git facts
// (in bypassPermissions the agent may set a hook or a program in the git config without asking), two
// git calls per checkout (readGitFacts). Only for a request that writes or runs git (gitNeeds): the
// Project's root, and, when a checkout may have config of its own (`git config --worktree`, an
// `includeIf`), the checkout of each git command (`git -C <checkout>`) and, for a write, each worktree
// of the Wave; each once per request. The config files git reads there, and the targets of its
// include.path and includeIf.*.path, are guarded as .git/config (policy.ts). A process that started without
// the run's git environment, or without GIT_NO_LAZY_FETCH while hooksActive is not false now, gets no
// git approved: the reads the policy keeps are safe only under them. The worktrees of the Wave are
// those on the branch `<epic>/<NN>` of a Ticket of the Wave (setWave); each is recorded the first time
// it is seen, and so is the scratchpad and the TMPDIR of the process. A list that cannot be read
// approves nothing: an empty one would turn off the hard denies of other worktrees. A command whose
// shell folder the Vendor did not tell is not judged in another folder.
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, readdir, readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { isRunId, makeRunId, RUN_ID_SUFFIX_LENGTH } from '../../../shared/autopilot/journal'
import type { AutoApprovalMode } from '../../../shared/settings/app-settings'
import { removeTreeAsync } from '../../storage/remove'
import type { SessionInfo } from '../session/types'
import { gitNeeds, HINTS, judge, type ApprovalRequest, type CheckoutGitFacts, type Decision, type PolicyContext } from './policy'
import { normalizePath, recordRoots } from './roots'

/** The git config of the run's Session, in the form of GIT_CONFIG_PARAMETERS. */
export const GIT_CONFIG_PARAMETERS = "'safe.bareRepository'='explicit' 'log.showSignature'='false' 'format.pretty'='medium'"

/** The git environment of the run's Session; GIT_NO_LAZY_FETCH unless the repository surely has no hooks or programs. */
export function gitEnvironment(hooksActive: boolean | null): Record<string, string> {
  return hooksActive === false ? { GIT_CONFIG_PARAMETERS } : { GIT_CONFIG_PARAMETERS, GIT_NO_LAZY_FETCH: '1' }
}

/** Keys that run a program on fetch, pull, push or diff without one of the endings (spec, decided without the owner, item 7). */
const PROGRAM_KEYS = new Set(['diff.external', 'core.sshcommand'])
const REMOTE_PROGRAM = /^remote\..+\.(?:uploadpack|receivepack)$/
/** The endings of the keys that name a program; a new key of git with a program is usually named so. */
const PROGRAM_ENDINGS = ['.program', '.command', '.cmd', '.driver', '.textconv', '.clean', '.smudge', '.process', '.defaultkeycommand']

/**
 * Whether a key of `git config --list` (with its value; null: the key alone) names a program git may
 * run: `core.fsmonitor` with a value other than true or false, `diff.external`, `core.sshCommand`,
 * `remote.*.uploadpack`, `remote.*.receivepack`, or a key with one of PROGRAM_ENDINGS — without case:
 * git prints the section and the last part in lower case, the middle (`trailer.Sign.cmd`) as written.
 * `credential.helper`, `core.askPass` and `core.gitProxy` are left out (spec, decided without the
 * owner, item 9), and so are `core.pager` and `pager.*`: a Session has no tty, git starts no pager.
 */
export function configRunsProgram(key: string, value: string | null): boolean {
  const name = key.toLowerCase()
  if (name === 'core.fsmonitor') {
    const flag = value?.toLowerCase()
    return flag !== 'true' && flag !== 'false'
  }
  return PROGRAM_KEYS.has(name) || REMOTE_PROGRAM.test(name) || PROGRAM_ENDINGS.some((ending) => name.endsWith(ending))
}

/** What hooksActive is made of; null for a part that could not be read. */
export interface HookFacts {
  /** `core.hooksPath` as git prints it; null: not set. */
  hooksPath: string | null
  /** The names in `hooks/` of the common git folder. */
  hookFiles: readonly string[] | null
  /** Every entry of `git config --list`. */
  config: ReadonlyArray<{ key: string; value: string | null }> | null
}

/**
 * Whether the repository has client hooks or programs named in its config: true with a set
 * `core.hooksPath`, a file of `hooks/` not ending in `.sample`, or a key configRunsProgram takes; null
 * when a part could not be read and no other part says true; false otherwise.
 */
export function hooksActiveOf(facts: HookFacts): boolean | null {
  if (facts.hooksPath !== null) return true
  const hooks = facts.hookFiles === null ? null : facts.hookFiles.some((name) => !name.endsWith('.sample'))
  const programs = facts.config === null ? null : facts.config.some(({ key, value }) => configRunsProgram(key, value))
  if (hooks === true || programs === true) return true
  return hooks === null || programs === null ? null : false
}

/** What the run reads of a checkout: when it starts, in the root; at each request, in each folder it judges. */
export interface GitFacts extends CheckoutGitFacts {
  /** null: not read (no repository, or a value git does not read as a boolean). */
  rebaseUpdateRefs: boolean | null
  remotes: string[] | null
  /** The Project's default branch: origin/HEAD, else the checkout's branch, else main. */
  defaultBranch: string
  configFiles: string[]
  /**
   * Whether a checkout may see config of its own: `extensions.worktreeConfig` is true (config.worktree), or an
   * `includeIf` names a condition (gitdir, onbranch). Without it every checkout of the repository reads what this one does.
   */
  checkoutConfig: boolean
}

/** How long one git read may take. */
const GIT_TIMEOUT_MS = 10_000

interface GitResult {
  /** The exit code; null when git did not start or was stopped. */
  code: number | null
  stdout: string
}

function runGit(cwd: string, args: readonly string[], env: NodeJS.ProcessEnv): Promise<GitResult> {
  return new Promise((done) => {
    execFile('git', [...args], { cwd, env, encoding: 'utf8', timeout: GIT_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
      if (error === null) done({ code: 0, stdout })
      else done({ code: typeof error.code === 'number' && error.killed !== true ? error.code : null, stdout: typeof stdout === 'string' ? stdout : '' })
    })
  })
}

/** The names in the folder; [] when it is not there, null when it cannot be read. */
async function namesIn(folder: string): Promise<string[] | null> {
  try {
    return await readdir(folder)
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? [] : null
  }
}

/** One entry of `git config --list -z --show-origin`: where it comes from, its key, its value (null: a key without `=`). */
interface ConfigEntry {
  origin: string
  key: string
  value: string | null
}

/** The entries of `git config --list -z --show-origin`: `origin\0key\nvalue\0`, or the key alone for a key without `=`. */
function configEntries(stdout: string): ConfigEntry[] {
  const parts = stdout.split('\0')
  const entries: ConfigEntry[] = []
  for (let n = 0; n + 1 < parts.length; n += 2) {
    const origin = parts[n] ?? ''
    const entry = parts[n + 1] ?? ''
    const cut = entry.indexOf('\n')
    entries.push(cut === -1 ? { origin, key: entry, value: null } : { origin, key: entry.slice(0, cut), value: entry.slice(cut + 1) })
  }
  return entries
}

/** A config value as git's --bool reads it; null when git would refuse it. A key without `=` is true. */
function gitBool(value: string | null): boolean | null {
  if (value === null) return true
  const word = value.trim().toLowerCase()
  if (['true', 'yes', 'on'].includes(word)) return true
  if (['false', 'no', 'off', ''].includes(word)) return false
  return /^-?\d+$/.test(word) ? Number(word) !== 0 : null
}

/** The first line of a file, or null when it cannot be read. */
async function firstLine(path: string): Promise<string | null> {
  try {
    return (await readFile(path, 'utf8')).split(/\r?\n/)[0] ?? ''
  } catch {
    return null
  }
}

/**
 * The config files git reads, or would read, at `folder`: each file an entry comes from, and the target of each
 * `include.path` and `includeIf.<condition>.path` — also one that is not there yet (git skips a missing file, so
 * writing it would add config) — read as git reads it: `~/` from HOME, a relative path from the folder of the file
 * that names it.
 */
function configFilesOf(entries: readonly ConfigEntry[], folder: string, home: string | undefined): string[] {
  const files = new Set<string>()
  const fileOf = (origin: string): string | null => (origin.startsWith('file:') ? resolve(folder, origin.slice('file:'.length)) : null)
  for (const entry of entries) {
    const from = fileOf(entry.origin)
    if (from !== null) files.add(from)
    const include = entry.key === 'include.path' || (entry.key.startsWith('includeif.') && entry.key.endsWith('.path'))
    if (!include || entry.value === null || entry.value === '') continue
    const target = entry.value
    if (target.startsWith('~/')) {
      if (home !== undefined) files.add(resolve(home, target.slice(2)))
    } else if (isAbsolute(target)) files.add(resolve(target))
    else if (from !== null) files.add(resolve(dirname(from), target))
  }
  return [...files]
}

/**
 * The git facts of the checkout at `folder` (GitFacts), read in the environment `env` with two git calls — the
 * config with the origin of each entry, and the git folders — and the rest from the files: the hooks folder, HEAD,
 * origin/HEAD, the remotes of the old `remotes/` and `branches/` folders. Throws when the config cannot be read: the
 * policy needs core.hooksPath.
 */
export async function readGitFacts(folder: string, env: NodeJS.ProcessEnv): Promise<GitFacts> {
  const [config, dirs] = await Promise.all([runGit(folder, ['config', '--list', '-z', '--show-origin'], env), runGit(folder, ['rev-parse', '--git-dir', '--git-common-dir'], env)])
  if (config.code !== 0) throw new Error(`could not read git's config (core.hooksPath and the rest) in ${folder} (exit code ${String(config.code)})`)
  const entries = configEntries(config.stdout)
  const last = (key: string): ConfigEntry | undefined => entries.findLast((entry) => entry.key === key)
  const lines = dirs.code === 0 ? dirs.stdout.split(/\r?\n/).filter((line) => line !== '') : []
  const repository = lines.length === 2
  const gitDir = resolve(folder, lines[0] ?? '.')
  const common = resolve(folder, lines[1] ?? '.')
  const [hookFiles, head, originHead, legacyRemotes, legacyBranches] = repository
    ? await Promise.all([namesIn(join(common, 'hooks')), firstLine(join(gitDir, 'HEAD')), firstLine(join(common, 'refs', 'remotes', 'origin', 'HEAD')), namesIn(join(common, 'remotes')), namesIn(join(common, 'branches'))])
    : [null, null, null, null, null]
  const hooksEntry = last('core.hookspath')
  const hooksPath = hooksEntry === undefined ? null : (hooksEntry.value ?? '')
  const updateRefs = last('rebase.updaterefs')
  const remotes = new Set<string>()
  for (const { key } of entries) {
    const name = /^remote\.(.+)\.[^.]+$/s.exec(key)?.[1]
    if (name !== undefined) remotes.add(name)
  }
  for (const name of [...(legacyRemotes ?? []), ...(legacyBranches ?? [])]) remotes.add(name)
  const origin = /^ref: refs\/remotes\/origin\/(.+)$/.exec(originHead ?? '')?.[1] ?? ''
  const current = /^ref: refs\/heads\/(.+)$/.exec(head ?? '')?.[1] ?? ''
  return {
    hooksPath,
    hooksActive: hooksActiveOf({ hooksPath, hookFiles, config: entries }),
    rebaseUpdateRefs: !repository ? null : updateRefs === undefined ? false : gitBool(updateRefs.value),
    remotes: repository ? [...remotes] : null,
    // A ref store that is no files (reftable) names `.invalid` in HEAD: the default branch is then main.
    defaultBranch: origin !== '' ? origin : current !== '' && current !== '.invalid' ? current : 'main',
    configFiles: configFilesOf(entries, folder, env['HOME']),
    checkoutConfig: entries.some((entry) => (entry.key === 'extensions.worktreeconfig' && gitBool(entry.value) === true) || entry.key.startsWith('includeif.')),
  }
}

/** One worktree of `git worktree list`; a null branch: detached. */
export interface Checkout {
  path: string
  branch: string | null
}

/** The worktrees of the repository at `root`, the main checkout first; null when git could not list them. */
export async function readCheckouts(root: string, env: NodeJS.ProcessEnv): Promise<Checkout[] | null> {
  const listed = await runGit(root, ['worktree', 'list', '--porcelain', '-z'], env)
  if (listed.code !== 0) return null
  const checkouts: Checkout[] = []
  for (const field of listed.stdout.split('\0')) {
    if (field.startsWith('worktree ')) checkouts.push({ path: resolve(field.slice('worktree '.length)), branch: null })
    const last = checkouts.at(-1)
    if (last !== undefined && field.startsWith('branch ')) last.branch = field.slice('branch '.length).replace(/^refs\/heads\//, '')
  }
  return checkouts
}

/** Whether `a` and `b` name one folder; without case on macOS and Windows. */
function samePath(a: string, b: string, platform: NodeJS.Platform): boolean {
  const key = (path: string): string => (platform === 'darwin' || platform === 'win32' ? resolve(path).toLowerCase() : resolve(path))
  return key(a) === key(b)
}

/** The checkout `folder` lies in (the deepest one), or null when it lies in none. */
function checkoutOf(folder: string, checkouts: readonly Checkout[], platform: NodeJS.Platform): string | null {
  const caseless = platform === 'darwin' || platform === 'win32'
  const key = (path: string): string => (caseless ? resolve(path).toLowerCase() : resolve(path))
  const at = key(folder)
  const holding = checkouts.map((checkout) => checkout.path).filter((path) => at === key(path) || at.startsWith(key(path).endsWith(sep) ? key(path) : `${key(path)}${sep}`))
  return holding.sort((a, b) => b.length - a.length)[0] ?? null
}

/** Where a request was made: the Session that asked and where its shell stands (null: not told). */
export interface ApprovalAt {
  cwd: string | null
  scratchpad: string | null
  sessionId: string
  /** The run's variables the Session's process started with (LaunchApproval.environment); {}: none. */
  started: Readonly<Record<string, string>>
  /** The whole environment the process started with, when the driver tells it (ApprovalWhere.env). */
  env?: Readonly<Record<string, string | undefined>> | undefined
}

/** What a Session launched by a run reads of the run's policy (SessionLaunch.approval). */
export interface LaunchApproval {
  /** The Auto-approval mode now: read at each request. */
  mode(): AutoApprovalMode
  /** The variables the agent's process starts with over its own environment; {} in Off. */
  environment(): Readonly<Record<string, string>>
  judge(request: ApprovalRequest, at: ApprovalAt): Promise<Decision>
}

/** One run's side of the policy (openRunApproval). */
export interface RunApproval {
  /** The run id this run's folder is named by; the Journal of the run takes it. */
  readonly run: string
  /** `<dataDir>/autopilot-tmp/<run>`, the Session's TMPDIR. */
  readonly runTemp: string
  /** TMPDIR and the git environment (gitEnvironment). */
  readonly environment: Readonly<Record<string, string>>
  /** What the run read of git when it started. */
  readonly facts: GitFacts
  /** The Tickets of the Wave now (`01`): their worktrees are roots. */
  setWave(tickets: readonly string[]): void
  judge(request: ApprovalRequest, at: ApprovalAt): Promise<Decision>
  /** Removes the run's folder, by its literal path. */
  close(): Promise<void>
}

export interface RunApprovalOptions {
  /** The Project's root: the repository the run reads, its `.scratch`. */
  root: string
  epic: string
  /** worfy's data folder (WORFY_DATA_DIR). */
  dataDir: string
  harnessHome: string | null
  /** The environment the Session's agent gets before the run's variables (the login shell's, src/main/agent/env.ts). */
  shellEnv: Readonly<Record<string, string | undefined>>
  /** The environment git runs in for the run's reads; the shell's with the run's GIT_CONFIG_PARAMETERS when absent. */
  gitEnv?: NodeJS.ProcessEnv
  /** The live Sessions (the app's SessionRegistry). */
  sessions: { list(): ReadonlyArray<Pick<SessionInfo, 'sessionId' | 'cwd'>> }
  platform?: NodeJS.Platform
  now?: () => Date
}

const COMMAND_TOOLS = new Set(['Bash', 'commandExecution'])

const refusal = (rule: string): Decision => ({ outcome: 'deny', rule, hint: HINTS.notJudged, targets: [] })

/** The rule of the policy that approves git (policy.ts); a compound allow joins its rules with `+`. */
const GIT_RULE = 'git-in-wave-worktree'

/** The folder all runs keep their folders for temporary files in. */
export const runTempsDir = (dataDir: string): string => join(dataDir, 'autopilot-tmp')

/**
 * Removes the folders for temporary files that runs started before `before` left behind (a crash, a
 * quit, a Session another run took over), each by its literal path; called when the app's Autopilot is
 * made, before any run of this app's life. A run id begins with its start time, so a run that starts
 * meanwhile keeps its folder. Only folders named by a run id; one that cannot be removed stays for the
 * next time.
 */
export async function sweepRunTemps(dataDir: string, before: Date = new Date()): Promise<void> {
  const limit = makeRunId(before, '0'.repeat(RUN_ID_SUFFIX_LENGTH))
  const names = await namesIn(runTempsDir(dataDir))
  for (const name of names ?? []) {
    if (!isRunId(name) || name >= limit) continue
    try {
      await removeTreeAsync(join(runTempsDir(dataDir), name))
    } catch (error) {
      console.warn(`[autopilot] could not remove the folder of an old run ${name}`, error)
    }
  }
}

/** Starts the policy's side of one run; throws when it cannot (the run then goes without a policy). */
export async function openRunApproval(options: RunApprovalOptions): Promise<RunApproval> {
  const platform = options.platform ?? process.platform
  const win = platform === 'win32'
  const gitEnv: NodeJS.ProcessEnv = options.gitEnv ?? { ...options.shellEnv, GIT_CONFIG_PARAMETERS }
  const facts = await readGitFacts(options.root, gitEnv)
  const run = makeRunId((options.now ?? (() => new Date()))(), randomBytes(RUN_ID_SUFFIX_LENGTH / 2).toString('hex'))
  const runTemp = join(runTempsDir(options.dataDir), run)
  await mkdir(runTemp, { recursive: true })
  const environment: Readonly<Record<string, string>> = { TMPDIR: runTemp, ...gitEnvironment(facts.hooksActive) }
  const scratch = join(options.root, '.scratch')
  const recorded: Record<string, string> = recordRoots([scratch, runTemp], platform)
  /** Records a root the first time it is seen: its real path now is the one later requests are held to. */
  const record = (path: string | null | undefined): void => {
    const normal = path === null || path === undefined ? null : normalizePath(path, win)
    if (normal !== null && !(normal in recorded)) Object.assign(recorded, recordRoots([normal], platform))
  }
  let wave: string[] = []
  return {
    run,
    runTemp,
    environment,
    facts,
    setWave: (tickets) => {
      wave = [...tickets]
    },
    judge: async (request, at) => {
      if (at.cwd === null && COMMAND_TOOLS.has(request.tool)) return refusal('no-cwd')
      const checkouts = await readCheckouts(options.root, gitEnv)
      if (checkouts === null) return refusal('no-checkouts')
      // shortcut: the Wave's worktrees are found by the branch `<epic>/<NN>`, the default of the Profile's
      // tickets.branch; redo when a Project with another template runs Autopilot with Auto-approval.
      const branches = new Set(wave.map((ticket) => `${options.epic}/${ticket}`))
      const worktrees = checkouts.filter((checkout) => checkout.branch !== null && branches.has(checkout.branch)).map((checkout) => checkout.path)
      // The folder for temporary files of this process: the one it started with, also another run's.
      const temp = at.started['TMPDIR'] ?? runTemp
      for (const path of [...worktrees, at.scratchpad, temp]) record(path)
      const env: Readonly<Record<string, string | undefined>> = at.env ?? { ...options.shellEnv, ...at.started }
      const context: PolicyContext = {
        platform,
        cwd: at.cwd ?? options.root,
        env,
        worktrees,
        scratch,
        runTemp: temp,
        scratchpad: at.scratchpad,
        dataDir: options.dataDir,
        harnessHome: options.harnessHome,
        sessionId: at.sessionId,
        sessions: options.sessions,
        checkouts,
        // Not read: a request that neither writes nor runs git is decided without them.
        defaultBranch: 'main',
        rebaseUpdateRefs: null,
        remotes: null,
        hooksPath: null,
        hooksActive: null,
        recordedRoots: { ...recorded },
      }
      const needs = gitNeeds(request, context)
      if (!needs.writes && needs.git.length === 0) return judge(request, context)
      const now = await readGitFacts(options.root, gitEnv).catch(() => null)
      if (now === null) return refusal('no-git-facts')
      // Each checkout is read once per request, and only when it may see config of its own.
      const reads = new Map<string, Promise<GitFacts | null>>()
      const read = (folder: string): Promise<GitFacts | null> => {
        const known = reads.get(folder) ?? readGitFacts(folder, gitEnv).catch(() => null)
        reads.set(folder, known)
        return known
      }
      const factsOf = (folder: string): Promise<GitFacts | null> => {
        const checkout = checkoutOf(folder, checkouts, platform)
        if (checkout === null) return read(folder)
        if (samePath(checkout, options.root, platform) || !now.checkoutConfig) return Promise.resolve(now)
        return read(checkout)
      }
      const folders = [...new Set([...(needs.writes && now.checkoutConfig ? worktrees : []), ...needs.git])]
      const found = await Promise.all(folders.map(factsOf))
      const facts = new Map(folders.map((folder, n) => [folder, found[n] ?? null]))
      const decision = judge(request, {
        ...context,
        defaultBranch: now.defaultBranch,
        rebaseUpdateRefs: now.rebaseUpdateRefs,
        remotes: now.remotes,
        hooksPath: now.hooksPath,
        hooksActive: now.hooksActive,
        configFiles: now.configFiles,
        gitFacts: facts,
      })
      const hooksOff = [now, ...needs.git.map((folder) => facts.get(folder) ?? null)].every((each) => each?.hooksActive === false)
      const gitSafe = at.started['GIT_CONFIG_PARAMETERS'] === GIT_CONFIG_PARAMETERS && (hooksOff || at.started['GIT_NO_LAZY_FETCH'] === '1')
      if (decision.outcome === 'allow' && !gitSafe && decision.rule.split('+').includes(GIT_RULE)) return { outcome: 'park', rule: 'git-without-run-environment', hint: null, targets: decision.targets }
      return decision
    },
    close: () => removeTreeAsync(runTemp),
  }
}
