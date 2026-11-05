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
// (in bypassPermissions the agent may set a hook or a program in the git config without asking): in the
// Project's root, in each worktree of the Wave and in each folder a git command of the request runs in,
// with `git -C <folder>`, so a config of one worktree alone (`git config --worktree`, an `includeIf
// "gitdir:…"`) counts there; each folder is read once per request. A process that started without
// the run's git environment, or without GIT_NO_LAZY_FETCH while hooksActive is not false now, gets no
// git approved: the reads the policy keeps are safe only under them. The worktrees of the Wave are
// those on the branch `<epic>/<NN>` of a Ticket of the Wave (setWave); each is recorded the first time
// it is seen, and so is the scratchpad and the TMPDIR of the process. A list that cannot be read
// approves nothing: an empty one would turn off the hard denies of other worktrees. A command whose
// shell folder the Vendor did not tell is not judged in another folder.
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { isRunId, makeRunId, RUN_ID_SUFFIX_LENGTH } from '../../../shared/autopilot/journal'
import type { AutoApprovalMode } from '../../../shared/settings/app-settings'
import { removeTreeAsync } from '../../storage/remove'
import type { SessionInfo } from '../session/types'
import { gitFolders, HINTS, judge, type ApprovalRequest, type CheckoutGitFacts, type Decision, type PolicyContext } from './policy'
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

/** git's output without the one newline it ends a value with. */
const value = (stdout: string): string => stdout.replace(/\r?\n$/, '')

/** The names in the folder; [] when it is not there, null when it cannot be read. */
async function namesIn(folder: string): Promise<string[] | null> {
  try {
    return await readdir(folder)
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? [] : null
  }
}

/** The entries of `git config --list -z`: `key\nvalue`, or the key alone for a key without `=`. */
function configEntries(stdout: string): { key: string; value: string | null }[] {
  return stdout
    .split('\0')
    .filter((entry) => entry !== '')
    .map((entry) => {
      const cut = entry.indexOf('\n')
      return cut === -1 ? { key: entry, value: null } : { key: entry.slice(0, cut), value: entry.slice(cut + 1) }
    })
}

/**
 * The git facts of the repository at `root` (GitFacts), read in the environment `env`. Throws when
 * `core.hooksPath` cannot be read (an exit code other than 0 and 1): the policy needs it.
 */
export async function readGitFacts(root: string, env: NodeJS.ProcessEnv): Promise<GitFacts> {
  const [hooksPath, common, config, updateRefs, remotes, originHead, head] = await Promise.all([
    runGit(root, ['config', '--get', 'core.hooksPath'], env),
    runGit(root, ['rev-parse', '--git-common-dir'], env),
    runGit(root, ['config', '--list', '-z'], env),
    runGit(root, ['config', '--bool', 'rebase.updateRefs'], env),
    runGit(root, ['remote'], env),
    runGit(root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], env),
    runGit(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], env),
  ])
  if (hooksPath.code !== 0 && hooksPath.code !== 1) throw new Error(`could not read git's core.hooksPath in ${root} (exit code ${String(hooksPath.code)})`)
  const repository = common.code === 0 && common.stdout.trim() !== ''
  const hookFiles = repository ? await namesIn(join(resolve(root, value(common.stdout)), 'hooks')) : null
  const hooksActive = hooksActiveOf({ hooksPath: hooksPath.code === 0 ? value(hooksPath.stdout) : null, hookFiles, config: config.code === 0 ? configEntries(config.stdout) : null })
  const origin = originHead.code === 0 ? value(originHead.stdout).replace(/^origin\//, '') : ''
  const current = head.code === 0 ? value(head.stdout) : ''
  return {
    hooksPath: hooksPath.code === 0 ? value(hooksPath.stdout) : null,
    hooksActive,
    rebaseUpdateRefs: !repository ? null : updateRefs.code === 0 ? value(updateRefs.stdout) === 'true' : updateRefs.code === 1 ? false : null,
    remotes: repository && remotes.code === 0 ? remotes.stdout.split(/\r?\n/).filter((name) => name !== '') : null,
    defaultBranch: origin !== '' ? origin : current !== '' ? current : 'main',
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
      const [checkouts, now] = await Promise.all([readCheckouts(options.root, gitEnv), readGitFacts(options.root, gitEnv).catch(() => null)])
      if (checkouts === null) return refusal('no-checkouts')
      if (now === null) return refusal('no-git-facts')
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
        defaultBranch: now.defaultBranch,
        rebaseUpdateRefs: now.rebaseUpdateRefs,
        remotes: now.remotes,
        hooksPath: now.hooksPath,
        hooksActive: now.hooksActive,
        recordedRoots: { ...recorded },
      }
      // git in each checkout this request touches, each folder read once.
      const commands = gitFolders(request, context)
      const folders = [...new Set([...worktrees, ...commands])]
      const read = await Promise.all(folders.map((folder) => readGitFacts(folder, gitEnv).catch(() => null)))
      const facts = new Map(folders.map((folder, n) => [folder, read[n] ?? null]))
      const decision = judge(request, { ...context, gitFacts: facts })
      const hooksOff = [now, ...commands.map((folder) => facts.get(folder) ?? null)].every((each) => each?.hooksActive === false)
      const gitSafe = at.started['GIT_CONFIG_PARAMETERS'] === GIT_CONFIG_PARAMETERS && (hooksOff || at.started['GIT_NO_LAZY_FETCH'] === '1')
      if (decision.outcome === 'allow' && !gitSafe && decision.rule.split('+').includes(GIT_RULE)) return { outcome: 'park', rule: 'git-without-run-environment', hint: null, targets: decision.targets }
      return decision
    },
    close: () => removeTreeAsync(runTemp),
  }
}
