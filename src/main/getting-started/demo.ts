// Creating the Demo project of Getting started with one call (worfy-onboarding ticket 05; spec,
// decisions 5, 6 and 13). No draft Session: the template of demo-template.ts gives both the files
// and the Profile draft, so nothing here spends tokens.
//
// 1. The folder: <home>/worfy-demo, or worfy-demo-2, -3… when it is taken. A folder inside the
//    temporary folder of the system (%TEMP% on Windows) is refused always: the system cleans it.
// 2. A demo of ours already there (its record and its folder) is the answer; nothing is created.
//    A record whose folder is gone is dropped, and its Profile removed only while the gate registry
//    still ties it to that folder (forget).
// 3. The template's files, `git init -b main`, `git add -A`, one commit "Demo project" by the author
//    git knows. Without an author the call is refused before anything is written, with the commands
//    the first-run check `git-identity` gives.
// 4. `bin/project-connect --no-qmd` with the template's draft. Exit 2 means the Harness is older than
//    `--no-qmd`: the user is asked to update it (spec, risk 2). A Profile `worfy-demo` the demo did
//    not create is refused by project-connect itself and stays as it is.
// 5. The Project is added to the list as local to this Machine (`localOnly`).
// 6. Its Orchestrator is opened as `orchestrator.open` opens it, with the cheaper settings
//    (Sonnet, effort medium) saved for its Node; no message is sent. Only then does the Project
//    become active: the app opens the active Project's Orchestrator by itself, and it would start
//    on the default settings if it went first.
// 7. The record `demo` in getting-started.json (state.ts).
// A failure from step 3 on undoes what this call did — `project-connect --remove`, the Project out
// of the list, the folder — and the reason is the answer. A second call while one runs waits for it
// and gets the same answer (DemoCreator).
//
// Everything that reaches outside — the home and temporary folders, git, the Harness script, the
// Project list, the Orchestrators, the state file — comes in through DemoDeps, so the contract test
// runs it in a temporary folder.
//
// The cost switch (ticket 09, DemoCostSwitch): the settings of the demo's Orchestrator Node are
// saved first, so a Session that starts meanwhile starts with them; then a live Session of that
// Orchestrator gets the change as `agent.configure` gives it, in force from its next turn; then the
// demo record keeps the cost. A live Session that refuses the change makes the call reject after
// that, with the reason for the switch's line. Calls run one after another, so the last one wins
// everywhere, and one that rejected does not stop the next.
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { DEFAULT_SETTINGS, type SessionSettings, type SettingsChange } from '../../shared/agent/settings'
import type { CreateDemoResult, DemoCost, GettingStartedSnapshot } from '../../shared/ipc/getting-started'
import { isInsidePath } from '../claude-home/registry'
import { GIT_IDENTITY_COMMANDS } from '../first-run/checks'
import { readGateConfig } from '../gate/state'
import type { ConnectScript, ScriptRun } from '../projects/connect'
import { realpathOrSelf } from '../projects/real-path'
import type { ProjectStore } from '../projects/store'
import { removeTree } from '../storage/remove'
import { demoTemplate } from './demo-template'
import type { DemoRecord, GettingStartedState } from './state'

/** The name of the demo's Profile and of its folder (spec, decision 14). */
export const DEMO_PROFILE = 'worfy-demo'

/** "Cheaper" of decision 5: the settings the demo's Orchestrator starts with. */
export const CHEAPER_SETTINGS: SessionSettings = { model: 'sonnet', effort: 'medium', permissionMode: 'bypassPermissions' }

/**
 * The model and effort of each cost of the demo's Orchestrator (decision 5): "cheaper" as it
 * starts, "more expensive" Opus with the model's default effort. The permission mode stays as it is.
 */
export const COST_SETTINGS: Readonly<Record<DemoCost, Pick<SessionSettings, 'model' | 'effort'>>> = {
  cheaper: { model: CHEAPER_SETTINGS.model, effort: CHEAPER_SETTINGS.effort },
  'more-expensive': { model: 'opus', effort: null },
}

/** How many folder names are tried: worfy-demo, worfy-demo-2 … worfy-demo-<this>. */
const FOLDER_TRIES = 100

/** How long one git call of the creation may take. */
const GIT_TIMEOUT_MS = 60_000

/** Runs git with `args` in `cwd`; rejects only when git cannot be started. */
export type DemoGit = (args: readonly string[], cwd: string) => Promise<ScriptRun>

export interface DemoDeps {
  /** The user's home folder (os.homedir()). */
  home: string
  /** The temporary folder of the system (os.tmpdir()). */
  tmpdir: string
  git: DemoGit
  /** `bin/project-connect` of the Harness on the machine. */
  connect: ConnectScript
  projects: Pick<ProjectStore, 'add' | 'remove' | 'select' | 'find' | 'list' | 'active'>
  /** Opens the Project's Orchestrator as `orchestrator.open` does; a Node with no saved picks gets `firstSettings`. */
  openOrchestrator: (projectId: string, firstSettings: SessionSettings) => Promise<unknown>
  state: Pick<GettingStartedState, 'demo' | 'setDemo'>
  /** The `match` of every gate registry entry of the Profile `profile`; none when it has none or the registry cannot be read. */
  registeredRepos: (profile: string) => Promise<readonly string[]>
  /** Gets each step as it starts, one line. */
  progress?: (step: string) => void
}

/** A refusal whose message is the whole reason. */
class Refusal extends Error {}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))
const lastLine = (text: string): string => text.trim().split(/\r?\n/u).pop()?.trim() ?? ''

/** git started with `env` (the login shell's, without the caller's GIT_* variables). */
export function demoGit(env: Readonly<Record<string, string | undefined>>): DemoGit {
  return (args, cwd) =>
    new Promise((resolve, reject) => {
      execFile('git', [...args], { cwd, env: env as NodeJS.ProcessEnv, timeout: GIT_TIMEOUT_MS, encoding: 'utf8', windowsHide: true }, (error, stdout, stderr) => {
        if (error === null) return resolve({ code: 0, stdout, stderr })
        if (typeof error.code === 'number') return resolve({ code: error.code, stdout, stderr })
        if (error.killed) return resolve({ code: null, stdout, stderr: stderr || `git ${args[0] ?? ''} took longer than ${String(GIT_TIMEOUT_MS / 1000)} s` })
        reject(error)
      })
    })
}

/** DemoDeps.registeredRepos over the gate registry in `gateDir` (the Harness's `gate/` folder). */
export function gateRegistryRepos(gateDir: () => string): DemoDeps['registeredRepos'] {
  return async (profile) => (await readGateConfig(gateDir()))?.repos.filter((entry) => entry.profile === profile).map((entry) => entry.match) ?? []
}

const UPDATE_HARNESS =
  "Update the Harness first: this Harness's project-connect does not know --no-qmd. Open the first-run checks (Command palette: First-run checks) and update the Harness plugin there."

/** Runs bin/project-connect; exit 2 is a Harness older than `--no-qmd` and `--remove`. */
async function harness(deps: Pick<DemoDeps, 'connect'>, args: readonly string[], stdin: string): Promise<ScriptRun> {
  let run: ScriptRun
  try {
    run = await deps.connect(args, stdin)
  } catch (error) {
    throw new Refusal(`The Harness could not be run: ${messageOf(error)}. Check the Harness in the first-run checks (Command palette: First-run checks).`)
  }
  if (run.code === 2) throw new Refusal(UPDATE_HARNESS)
  return run
}

/** The messages of a refusal of bin/project-connect ({ ok: false, errors }), else the last line of its stderr. */
function connectErrors(run: ScriptRun): { path: string; kind: string; message: string }[] {
  try {
    const parsed = JSON.parse(run.stdout) as { errors?: unknown }
    if (Array.isArray(parsed.errors)) {
      return parsed.errors.map((each: { path?: unknown; kind?: unknown; message?: unknown }) => ({ path: String(each.path ?? ''), kind: String(each.kind ?? ''), message: String(each.message ?? '') }))
    }
  } catch {
    // not JSON: the stderr says it
  }
  return [{ path: '', kind: '', message: lastLine(run.stderr) || `exit code ${String(run.code)}` }]
}

/** Refuses a home folder inside the temporary folder of the system, where the demo would be cleaned away. */
function refuseTemporary(deps: DemoDeps): void {
  const home = realpathOrSelf(deps.home)
  const temp = realpathOrSelf(deps.tmpdir)
  if (isInsidePath(home, temp)) {
    throw new Refusal(`The home folder ${deps.home} is inside the temporary folder ${deps.tmpdir}, which the system cleans: worfy does not put the demo project there.`)
  }
}

/** Refuses when git knows no commit author outside a repository, as the first-run check asks it. */
async function requireAuthor(deps: DemoDeps): Promise<void> {
  const ask = async (key: string): Promise<string | null> => {
    const run = await deps.git(['config', '--get', key], deps.tmpdir)
    if (run.code === 0 && run.stdout.trim() !== '') return run.stdout.trim()
    if (run.code === 0 || run.code === 1) return null
    throw new Refusal(`git config failed: ${lastLine(run.stderr) || `exit code ${String(run.code)}`}`)
  }
  let missing: string[]
  try {
    const [name, email] = await Promise.all([ask('user.name'), ask('user.email')])
    missing = [name === null ? 'user.name' : null, email === null ? 'user.email' : null].filter((key): key is string => key !== null)
  } catch (error) {
    if (error instanceof Refusal) throw error
    throw new Refusal(`git could not be run: ${messageOf(error)}. Install git, then try again.`)
  }
  if (missing.length > 0) {
    throw new Refusal(`git does not know the commit author (${missing.join(' and ')} not set). Set your name and email once: ${GIT_IDENTITY_COMMANDS}`)
  }
}

/**
 * Creates the first of worfy-demo, worfy-demo-2, … that nothing occupies, and returns it. The
 * creation is the check: a name that something takes (a folder, a file, a link), also one that
 * appeared a moment ago, fails with EEXIST and the next name is tried, so the folder returned is
 * always one this call made and the rollback may delete it.
 */
function claimFolder(home: string): string {
  for (let n = 1; n <= FOLDER_TRIES; n++) {
    const folder = join(home, n === 1 ? DEMO_PROFILE : `${DEMO_PROFILE}-${String(n)}`)
    try {
      mkdirSync(folder)
      return folder
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code !== 'EEXIST') throw error
    }
  }
  throw new Refusal(`${join(home, DEMO_PROFILE)} and ${String(FOLDER_TRIES - 1)} folders after it are taken.`)
}

/** The demo of the record again: back in the list when it left it, and active. */
async function reopen(deps: DemoDeps, record: DemoRecord): Promise<CreateDemoResult> {
  if (deps.projects.find(record.projectId) !== undefined) {
    deps.projects.select(record.projectId)
    return { ok: true, projectId: record.projectId, path: record.path }
  }
  const added = await deps.projects.add(record.path, { localOnly: true })
  if (added.status === 'rejected') return { ok: false, reason: added.reason }
  if (added.project.id !== record.projectId) deps.state.setDemo({ ...record, projectId: added.project.id })
  return { ok: true, projectId: added.project.id, path: record.path }
}

/** Whether a `match` of the gate registry names the demo's folder, as given or with its parent's on-disk spelling. */
function namesFolder(match: string, folder: string): boolean {
  const same = (a: string, b: string): boolean => isInsidePath(a, b) && isInsidePath(b, a)
  return same(match, folder) || same(match, join(realpathOrSelf(dirname(folder)), basename(folder)))
}

/**
 * A record whose folder is gone (deleted by hand): its Project leaves the list and the record is
 * dropped. The Profile of that name is removed only when it is still the demo's: every gate
 * registry entry of it names the demo's folder. A Profile of that name over another repository
 * (the user removed the demo's and connected their own) stays, and step 4 refuses on the name.
 */
async function forget(deps: DemoDeps, record: DemoRecord): Promise<void> {
  if (deps.projects.find(record.projectId) !== undefined) deps.projects.remove(record.projectId)
  if (!(await profileIsOurs(deps, record))) {
    deps.state.setDemo(null)
    return
  }
  const failed = await removeDemoProfile(deps, record.profile)
  if (failed !== null) {
    throw new Refusal(`The Profile ${record.profile} of the earlier demo, whose folder ${record.path} is gone, could not be removed: ${failed}`)
  }
  deps.state.setDemo(null)
}

/**
 * Whether the Profile `record.profile` is still the demo's: it has gate registry entries, and every
 * one of them names the demo's folder. The check before the demo's Profile is removed here, and
 * before the demo's folder is deleted (ticket 10, remove.ts).
 */
export async function profileIsOurs(deps: Pick<DemoDeps, 'registeredRepos'>, record: Pick<DemoRecord, 'profile' | 'path'>): Promise<boolean> {
  const repos = await deps.registeredRepos(record.profile)
  return repos.length > 0 && repos.every((match) => namesFolder(match, record.path))
}

/**
 * `project-connect --remove <profile> --no-qmd`; a Profile already gone is not a failure. Null when
 * it went, else the script's messages. A Harness that cannot be run, or is older than `--remove`,
 * throws with the reason.
 */
export async function removeDemoProfile(deps: Pick<DemoDeps, 'connect'>, profile: string): Promise<string | null> {
  const removed = await harness(deps, ['--remove', profile, '--no-qmd'], '')
  const errors = connectErrors(removed)
  if (removed.code === 0 || errors.every((each) => each.message.startsWith(`no profile ${profile}`))) return null
  return errors.map((each) => each.message).join('; ')
}

/** What this call made, for the rollback. */
interface Made {
  folder: string | null
  profile: string | null
  projectId: string | null
  previousActiveId: string | null
}

/** Undoes what this call made, the last first; returns what could not be undone. */
async function undo(deps: DemoDeps, made: Made): Promise<string[]> {
  const left: string[] = []
  if (made.projectId !== null) {
    try {
      if (deps.projects.find(made.projectId) !== undefined) deps.projects.remove(made.projectId)
      const previous = made.previousActiveId
      if (previous !== null && deps.projects.find(previous) !== undefined && deps.projects.active()?.id !== previous) deps.projects.select(previous)
    } catch (error) {
      left.push(`the Project stays in the list (${messageOf(error)})`)
    }
  }
  if (made.profile !== null) {
    try {
      const removed = await deps.connect(['--remove', made.profile, '--no-qmd'], '')
      if (removed.code !== 0) left.push(`the Profile ${made.profile} stays (${connectErrors(removed).map((each) => each.message).join('; ')})`)
    } catch (error) {
      left.push(`the Profile ${made.profile} stays (${messageOf(error)})`)
    }
  }
  if (made.folder !== null) {
    try {
      removeTree(made.folder)
    } catch (error) {
      left.push(`the folder ${made.folder} stays (${messageOf(error)})`)
    }
  }
  return left
}

/** Runs git in the demo's folder; a failure is the reason. */
async function git(deps: DemoDeps, folder: string, args: readonly string[]): Promise<void> {
  const run = await deps.git(args, folder)
  if (run.code !== 0) throw new Error(`git ${args.filter((arg) => !arg.startsWith('-')).join(' ')} failed: ${lastLine(run.stderr) || lastLine(run.stdout) || `exit code ${String(run.code)}`}`)
}

/** Steps 3–7, recording in `made` what they make. */
async function build(deps: DemoDeps, made: Made): Promise<CreateDemoResult> {
  const step = (text: string): void => deps.progress?.(text)

  step('Creating the folder')
  const folder = claimFolder(deps.home)
  made.folder = folder

  step('Writing the files')
  const template = demoTemplate({ root: folder, profileName: DEMO_PROFILE })
  for (const [file, text] of Object.entries(template.files)) {
    const target = join(folder, ...file.split('/'))
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, text)
  }

  step('Making the first commit')
  await git(deps, folder, ['init', '-b', 'main'])
  await git(deps, folder, ['add', '-A'])
  // The author is the user's; a signing setup or a hook of the user's git template is not asked for
  // this one commit: a passphrase prompt would hold the creation with no one to answer it.
  await git(deps, folder, ['-c', 'commit.gpgsign=false', 'commit', '--no-verify', '-q', '-m', 'Demo project'])

  step('Connecting the project to the Harness')
  const written = await harness(deps, ['--no-qmd'], JSON.stringify(template.draft))
  if (written.code !== 0) {
    const errors = connectErrors(written)
    const taken = errors.find((each) => each.path === 'profile.name' && each.kind === 'conflict')
    if (taken !== undefined) {
      throw new Refusal(
        `The Harness already has a Profile named ${DEMO_PROFILE} that this demo did not create (${taken.message}). worfy leaves it as it is: remove or rename it, then try again.`,
      )
    }
    throw new Refusal(`The Harness refused the demo project: ${errors.map((each) => each.message).join('; ')}`)
  }
  made.profile = DEMO_PROFILE

  step('Adding the project')
  made.previousActiveId = deps.projects.active()?.id ?? null
  const listed = new Set(deps.projects.list().map((project) => project.id))
  const added = await deps.projects.add(folder, { keepActive: true, localOnly: true })
  if (added.status === 'rejected') throw new Refusal(added.reason)
  const projectId = added.project.id
  if (!listed.has(projectId)) made.projectId = projectId

  step('Opening the Orchestrator')
  await deps.openOrchestrator(projectId, CHEAPER_SETTINGS)
  deps.projects.select(projectId)

  deps.state.setDemo({ projectId, path: folder, profile: DEMO_PROFILE, cost: 'cheaper' })
  return { ok: true, projectId, path: folder }
}

/** Creates the Demo project, or answers with the one there is. Never throws: a failure is `{ ok: false, reason }`. */
export async function createDemo(deps: DemoDeps): Promise<CreateDemoResult> {
  try {
    const record = deps.state.demo()
    if (record !== null && existsSync(record.path)) return await reopen(deps, record)
    refuseTemporary(deps)
    await requireAuthor(deps)
    if (record !== null) await forget(deps, record)
  } catch (error) {
    return { ok: false, reason: messageOf(error) }
  }

  const made: Made = { folder: null, profile: null, projectId: null, previousActiveId: null }
  try {
    return await build(deps, made)
  } catch (error) {
    const left = await undo(deps, made)
    const reason = messageOf(error) || 'the demo project could not be created'
    return { ok: false, reason: left.length > 0 ? `${reason}. Not undone: ${left.join('; ')}.` : reason }
  }
}

/** One creation at a time: a call while one runs gets that one's answer. */
export class DemoCreator {
  private running: Promise<CreateDemoResult> | null = null

  /** `deps` is asked on each creation, so building the creator does no I/O. */
  constructor(private readonly deps: () => DemoDeps) {}

  create(): Promise<CreateDemoResult> {
    this.running ??= createDemo(this.deps()).finally(() => {
      this.running = null
    })
    return this.running
  }
}

/** A live Session of the demo's Orchestrator, as much of it as the cost switch changes. */
export interface CostSession {
  configure(change: SettingsChange): Promise<SessionSettings>
}

export interface CostDeps {
  state: Pick<GettingStartedState, 'demo' | 'setDemo' | 'read'>
  /** The id of the Project's Orchestrator Node in its Layout; null when it has none yet. */
  orchestratorNode: (projectId: string) => string | null
  /** Where the picks of a Node are kept (src/main/agent/session-settings.ts). */
  settings: {
    read(projectId: string, nodeId: string): SessionSettings | undefined
    write(projectId: string, nodeId: string, settings: SessionSettings): void
  }
  /**
   * The live Session of the Orchestrator behind `nodeId`, once one that is starting has started;
   * null when the Orchestrator is not open. Opens none.
   */
  liveSession: (projectId: string, nodeId: string) => Promise<CostSession | null>
}

/** The reason setCost answers when the live Session refused the change; `<reason>` is its error. */
export const costNotAppliedReason = (reason: string): string =>
  `Saved for the next start of the Orchestrator; its running Session kept its settings: ${reason}`

/**
 * Sets the cost of the demo (decision 5): the Node's saved picks, its live Session, the record.
 * Answers the state. When the live Session refuses the change, the pick stays saved and recorded
 * (its next start takes it) and the call rejects with costNotAppliedReason, for the switch's line.
 */
export async function setDemoCost(deps: CostDeps, cost: DemoCost): Promise<GettingStartedSnapshot> {
  const record = deps.state.demo()
  if (record === null) throw new Error('there is no demo project')
  const change = COST_SETTINGS[cost]
  const nodeId = deps.orchestratorNode(record.projectId)
  let refused: string | null = null
  if (nodeId !== null) {
    // Saved before the live Session is looked for: one that starts in between starts with these.
    deps.settings.write(record.projectId, nodeId, { ...(deps.settings.read(record.projectId, nodeId) ?? DEFAULT_SETTINGS), ...change })
    const session = await deps.liveSession(record.projectId, nodeId)
    try {
      await session?.configure(change)
    } catch (error) {
      refused = messageOf(error) || 'no reason given'
    }
  }
  const now = deps.state.demo()
  if (now !== null && now.projectId === record.projectId) deps.state.setDemo({ ...now, cost })
  if (refused !== null) throw new Error(costNotAppliedReason(refused))
  return deps.state.read()
}

/** The cost switch of the app: one call at a time, so of two calls in a row the second one wins. */
export class DemoCostSwitch {
  private last: Promise<unknown> = Promise.resolve()

  /** `deps` is asked on each call, so building the switch does no I/O. */
  constructor(private readonly deps: () => CostDeps) {}

  set(cost: DemoCost): Promise<GettingStartedSnapshot> {
    const task = this.last.catch(() => undefined).then(() => setDemoCost(this.deps(), cost))
    this.last = task
    return task
  }
}
