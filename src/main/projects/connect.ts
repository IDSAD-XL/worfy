// Connecting a Project to the Harness (worfy-harness ticket 24; ADR-0042, ADR-0045): the steps of
// the "Add project" dialog in main.
//
// 1. The folder, only read (`git rev-parse`): a git repository — a subfolder or a linked worktree
//    resolves to its root, as ProjectStore does —, or a folder outside git with at least two git
//    repositories among its direct subfolders (`multi-repo`, like Atakama). A folder the Harness
//    already knows (`bin/profile -C` exits 0; for a multi-repo folder with `_resolved.workspace`)
//    needs no draft: the caller adds it to the list at once. A `bin/profile` that gave no answer (not
//    started, no node, stopped at its time limit) is the step's error, not a new folder (profileKnows).
// 2. The mode: Full or Silent; a multi-repo folder is Silent only.
// 3. The Harness check, from the same installer state as the first-run screen (worfy-harness ticket
//    19): the plugin installed, enabled, of this build's version. Otherwise no Session starts.
// 4. The draft: first `bin/project-connect --facts <folder>` reads what only a command could tell
//    (remotes, branches; owner decision 2026-10-09), then a Claude Code Session in the folder gets
//    `/worfy:connect-project <folder> <mode> --draft-only` with those facts as data, the draft schema
//    (without `$schema` and `$id`: sessionSchema) as its structured output (outputFormat), and only
//    Read, Glob and Grep: Bash and every tool that writes or reaches out are taken away
//    (DRAFT_DISALLOWED_TOOLS), and canUseTool refuses anything outside DRAFT_TOOLS. The answer is
//    checked against the whole schema of the file by `bin/project-connect --schema-only`; worfy then
//    sets what it owns (applyChoices: the mode, the Workflow folder, and in Silent mode `attribution`
//    off as the form's starting value) and asks `--check` for the form.
// 5./6. The form's checks and the write go through `bin/project-connect` only (ADR-0002: worfy
//    changes workflow state only with the Harness's tools); worfy writes nothing itself — not in the
//    Harness home and never in the Project's repositories (ADR-0005). After the write `bin/profile -C`
//    must know the folder, and the caller adds it to the list.
//
// The GitHub account of the form (worfy-harness ticket 25): the accounts gh knows for the hosts of
// the folder's `origin` remotes and their write access (src/main/github/accounts.ts). The choice
// goes into the draft and is written with it; there is no write of its own.
//
// Everything that reaches outside — git, gh, the two Harness scripts, the installer, Claude Code,
// the list — comes in through ConnectDeps, so the contract test runs the steps with stand-ins.
// connectScriptRunner is the app's `connect`: it starts bin/project-connect through the shared
// launcher of the Harness scripts (src/main/workflow/profile.ts), as `node <script>`.
import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { DEFAULT_SETTINGS } from '../../shared/agent/settings'
import type { HarnessStatus } from '../../shared/ipc/harness'
import type { ConnectFolder, ConnectMode, DraftIssue, GithubAccountsStep, ProfileDraft } from '../../shared/ipc/projects'
import type { CanUseToolHandler } from '../agent/permissions'
import type { QueryHandle, QueryRequest } from '../agent/session'
import { readGithubAccounts } from '../github/accounts'
import { defaultAttribution } from '../harness/attribution'
import type { GhRunner } from '../github/prs'
import { scriptEnv, type HarnessLocation } from '../harness/locate'
import type { HarnessScriptEnv } from '../harness/script-env'
import { environmentExit, runHarnessScript, scriptFailureDetail, type ProfileRun, type ProfileRunner, type SpawnProcess } from '../workflow/profile'
import type { GitRunner } from './store'

/** The only tools the draft Session uses: it reads files and answers with its structured output. */
export const DRAFT_TOOLS: readonly string[] = Object.freeze(['Read', 'Glob', 'Grep'])

/** The tool Claude Code answers an `outputFormat` turn with; canUseTool lets it through. */
const STRUCTURED_OUTPUT_TOOL = 'StructuredOutput'

/**
 * The tools taken away from the draft Session (and its Subagents): no shell, nothing that writes,
 * nothing that reaches the network or starts other agents.
 */
export const DRAFT_DISALLOWED_TOOLS: readonly string[] = Object.freeze([
  'Bash',
  'BashOutput',
  'KillShell',
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'WebFetch',
  'WebSearch',
  'Task',
  'Agent',
])

/** The structured output a draft Session answers with (SDK option `outputFormat`). */
export interface DraftOutputFormat {
  type: 'json_schema'
  schema: Record<string, unknown>
}

/** A Claude Code query of the draft Session: a Session's request plus the draft's own options. */
export interface DraftRequest extends QueryRequest {
  outputFormat: DraftOutputFormat
  /** The tools the Session may use without asking. */
  allowedTools: readonly string[]
  disallowedTools: readonly string[]
}

/** Starts the draft Session's Claude Code: the SDK, or the fake agent in tests. */
export type DraftQueryFactory = (request: DraftRequest) => Promise<QueryHandle>

/** One run of a Harness script: its exit code (null when killed) and output. */
export interface ScriptRun {
  code: number | null
  stdout: string
  stderr: string
}

/** Runs `bin/project-connect` with `args` and `stdin`; rejects only when it cannot be started. */
export type ConnectScript = (args: readonly string[], stdin: string) => Promise<ScriptRun>

/** How long bin/project-connect may take for the facts and the checks. */
export const CONNECT_TIMEOUT_MS = 120_000

/**
 * How long the write (bin/project-connect with no arguments) may take: after its commit it may run
 * bin/qmd-collections, which indexes the Project — as long as setupCollections allows that script
 * (src/main/harness/qmd.ts). Killed at 120 s, it would leave the Profile committed and the folder
 * out of the list (worfy-windows ticket 30).
 */
export const CONNECT_WRITE_TIMEOUT_MS = 30 * 60_000

/** The time limit of one bin/project-connect call: the write (no arguments) gets CONNECT_WRITE_TIMEOUT_MS. */
export const connectTimeoutMs = (args: readonly string[]): number => (args.length === 0 ? CONNECT_WRITE_TIMEOUT_MS : CONNECT_TIMEOUT_MS)

export interface ConnectScriptSource {
  /** The Harness on the machine, looked for on every run (src/main/harness/locate.ts). */
  harness: () => HarnessLocation
  /** The login shell's environment (src/main/agent/env.ts): node is on its PATH. */
  env: () => Promise<HarnessScriptEnv>
  /** node's spawn when absent; a test hands one that records the call. */
  spawn?: SpawnProcess
  /** One limit for every call; CONNECT_TIMEOUT_MS, and CONNECT_WRITE_TIMEOUT_MS for the write, when absent. */
  timeoutMs?: number
  /** Asked on each run: a running script is killed when it aborts; the app aborts it on quit (src/main/ipc/projects.ts). */
  signal?: () => AbortSignal
  /** runHarnessScript when absent; a test hands one that records the options a call gets. */
  run?: typeof runHarnessScript
}

/**
 * The app's ConnectScript: `bin/project-connect` of the Harness on the machine, with HARNESS_HOME,
 * started as every Harness script is (runHarnessScript): `node <script> …`, never the file itself,
 * which Windows cannot run by its `#!` line (worfy-windows ticket 30).
 */
export function connectScriptRunner(source: ConnectScriptSource): ConnectScript {
  return async (args, stdin) => {
    const harness = source.harness()
    const env = scriptEnv(harness, await source.env())
    return (source.run ?? runHarnessScript)(join(harness.binDir, 'project-connect'), args, env, {
      stdin,
      timeoutMs: source.timeoutMs ?? connectTimeoutMs(args),
      spawn: source.spawn,
      signal: source.signal?.(),
    })
  }
}

/** What adding the folder to the list answered (ProjectStore.add, through the caller). */
export type AddOutcome = { status: 'added'; projectId: string; notice: string | null } | { status: 'rejected'; reason: string }

export interface ConnectDeps {
  git: GitRunner
  /** The app's gh, for the GitHub account step: the same executable and environment as its other gh calls. */
  gh: GhRunner
  /** `bin/profile` of the Harness on the machine. */
  profile: ProfileRunner
  /**
   * The gate registry files bin/profile of the same Harness reads, in its order
   * (profileRegistryFiles): when none of them exists, an exit 1 of bin/profile is a fresh Harness,
   * not a failure (profileKnows).
   */
  gateRegistries: () => Promise<readonly string[]>
  /** `bin/project-connect` of the Harness on the machine. */
  connect: ConnectScript
  /** The installer's state (src/main/harness/install.ts), as the first-run screen reads it. */
  harness: () => Promise<HarnessStatus>
  /** Claude Code for the draft Session. */
  query: DraftQueryFactory
  /** harness/profiles/draft.schema.json of the Harness this build carries, as the file has it; the Session gets `sessionSchema` of it. */
  draftSchema: () => Record<string, unknown>
  /** `language.reports` by default: the system language (`app.getLocale()`), `ru` or `en`. */
  reportsLanguage: () => 'ru' | 'en'
  /**
   * Puts the folder into the list and makes it active; with `keepActive` (a Linked machine connects
   * it, worfy-link ticket 11) the active Project of this Machine stays as it is.
   */
  add: (root: string, options: { keepActive: boolean }) => Promise<AddOutcome>
  /** Where a reason goes besides the answer; console.warn by default. */
  log?: (message: string) => void
}

// ── step 1: the folder ─────────────────────────────────────────────────────────

export type FolderInspection = { ok: true; folder: ConnectFolder } | { ok: false; reason: string }

/**
 * The real path in the spelling the disk has, the one git answers: the native realpath turns the
 * 8.3 short name of a long account name, a subst drive or another letter case into it, where the
 * plain one keeps the folder as it was typed and the same folder would compare as another.
 */
function realpathOrSelf(path: string): string {
  try {
    return realpathSync.native(path)
  } catch {
    return path
  }
}

/** The root of the git repository `dir` is the root of, or null when `dir` is no repository root. */
async function repositoryRoot(dir: string, git: GitRunner): Promise<string | null> {
  try {
    const top = await git(['-C', dir, 'rev-parse', '--show-toplevel'])
    return top !== '' && realpathOrSelf(top) === realpathOrSelf(dir) ? realpathOrSelf(dir) : null
  } catch {
    return null
  }
}

/** The kind of the folder the user picked; only reads. */
export async function inspectFolder(folder: string, git: GitRunner): Promise<FolderInspection> {
  try {
    if (!statSync(folder).isDirectory()) return { ok: false, reason: `${folder} is not a folder.` }
  } catch {
    return { ok: false, reason: `${folder} does not exist.` }
  }
  let toplevel: string | null
  let commonDir = ''
  try {
    toplevel = await git(['-C', folder, 'rev-parse', '--show-toplevel'])
    commonDir = await git(['-C', folder, 'rev-parse', '--path-format=absolute', '--git-common-dir'])
  } catch {
    toplevel = null
  }

  if (toplevel !== null) {
    if (toplevel === '') return { ok: false, reason: `${folder} is inside a git repository but not in its working tree.` }
    // A linked worktree shares the main repository's .git folder: its parent is the repository root.
    const root = realpathOrSelf(basename(commonDir) === '.git' ? dirname(commonDir) : toplevel)
    let notice: string | null = null
    if (root !== realpathOrSelf(toplevel)) notice = `${toplevel} is a worktree of ${root}; the repository root is connected instead.`
    else if (realpathOrSelf(folder) !== root) notice = `${folder} is inside the repository ${root}; the repository root is connected instead.`
    return { ok: true, folder: { kind: 'git', root, repos: [{ name: basename(root) || root, path: root }], notice } }
  }

  // Outside git: the direct subfolders that are repository roots.
  const root = realpathOrSelf(folder)
  let names: string[]
  try {
    names = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort()
  } catch (error) {
    return { ok: false, reason: `${folder} cannot be read: ${error instanceof Error ? error.message : String(error)}` }
  }
  const roots = await Promise.all(names.map(async (name) => ({ name, path: await repositoryRoot(join(root, name), git) })))
  const repos = roots.filter((repo): repo is { name: string; path: string } => repo.path !== null)
  if (repos.length >= 2) return { ok: true, folder: { kind: 'multi-repo', root, repos, notice: null } }
  return {
    ok: false,
    reason:
      repos.length === 1
        ? `${folder} is not a git repository and holds only one: choose the repository ${repos[0]?.path ?? ''} itself.`
        : `${folder} is not a git repository and holds no repositories. Choose the folder of a git repository, or the folder above the repositories of one project.`,
  }
}

/**
 * Whether the Harness already knows the folder: `bin/profile -C <root>` exits 0 (a multi-repo folder
 * also needs `_resolved.workspace`). "Not known" is exit 3 (no registered project), and exit 1 while
 * none of `registries` exists — the gate registry files bin/profile reads, the new one and the old
 * ~/.claude/gate/config.json (profileRegistryFiles): a fresh Harness, whose bin/profile then says
 * its resolver could not read the registry; bin/project-connect creates it with the first Project.
 * A broken old registry is there, so its exit 1 is an error, and no new registry shadows it. Everything else throws (worfy-windows ticket 30), because the folder is then not "new"
 * and the caller says why it cannot tell: the script was not started (no script, no node —
 * HarnessScriptStartError —, ENOENT), the system found no interpreter for it (exit code 127 or 126),
 * it was killed at its time limit or by a signal (code null), or it failed with another code — exit
 * 1 with the registry there is a broken registry, a broken profile.json of a registered project or a
 * crash, and a draft for such a folder would only fail at the write ("the name is taken").
 */
export async function profileKnows(folder: ConnectFolder, profile: ProfileRunner, registries: readonly string[]): Promise<boolean> {
  let run: ProfileRun
  try {
    run = await profile(folder.root, ['-C', folder.root, '--json'])
  } catch (error) {
    throw new Error(`bin/profile could not be run: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
  if (run.code === null) {
    throw new Error(run.signal ? `bin/profile was ended by ${run.signal}` : 'bin/profile did not answer in time and was stopped')
  }
  if (environmentExit(run.code)) {
    const detail = scriptFailureDetail(run.stderr)
    throw new Error(`bin/profile could not be run: exit code ${String(run.code)}${detail ? `: ${detail}` : ''}`)
  }
  if (run.code === 3) return false
  if (run.code === 1 && !registries.some((registry) => existsSync(registry))) return false
  if (run.code !== 0) {
    const detail = scriptFailureDetail(run.stderr)
    throw new Error(`bin/profile failed with exit code ${String(run.code)}${detail ? `: ${detail}` : ''}`)
  }
  if (folder.kind === 'git') return true
  try {
    const parsed = JSON.parse(run.stdout) as { _resolved?: { workspace?: unknown } }
    return typeof parsed._resolved?.workspace === 'string' && parsed._resolved.workspace !== ''
  } catch {
    return false
  }
}

/** profileKnows failed because the profile script is not on disk: no Harness script, or a start that found no file. */
function missingScript(error: unknown): boolean {
  const cause = error instanceof Error ? error.cause : undefined
  return typeof cause === 'object' && cause !== null && (cause as { code?: unknown }).code === 'ENOENT'
}

// ── step 3: the Harness ───────────────────────────────────────────────────────

const lastLine = (text: string): string =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .at(-1) ?? text

/** Why the Harness stops the connection, or null when the plugin of this build is installed and enabled. */
export function harnessBlocker(status: HarnessStatus): string | null {
  const { state } = status
  switch (state.kind) {
    case 'installed':
      return state.enabled ? null : `The Harness plugin ${state.version} is installed but disabled. Enable it on the first-run screen.`
    case 'not-installed':
      return 'The Harness plugin is not installed. Install it on the first-run screen.'
    case 'outdated':
      return `The Harness plugin is ${state.from ?? 'of another version'}, and worfy carries ${state.to}. Update it on the first-run screen.`
    case 'error':
      return `The Harness check failed at "${state.step}": ${lastLine(state.reason)}`
  }
}

// ── step 4: the draft Session ───────────────────────────────────────────────

/**
 * The first message of the draft Session; a folder with a space goes in double quotes. The facts of
 * `bin/project-connect --facts` follow as JSON: what the Session would otherwise need a command for.
 */
export function draftMessage(root: string, mode: ConnectMode, facts: unknown): string {
  const folder = /\s/.test(root) ? `"${root}"` : root
  return [
    `/worfy:connect-project ${folder} ${mode} --draft-only`,
    '',
    'Facts of the repositories, read by bin/project-connect --facts (run no commands; use these):',
    '```json',
    JSON.stringify(facts, null, 2),
    '```',
  ].join('\n')
}

const DRAFT_DENIED = 'The draft Session only reads files with Read, Glob and Grep: worfy writes the profile after the form.'

/** canUseTool of the draft Session: Read, Glob, Grep and its structured answer; anything else is refused. */
export const draftCanUseTool: CanUseToolHandler = (toolName, input) =>
  Promise.resolve(DRAFT_TOOLS.includes(toolName) || toolName === STRUCTURED_OUTPUT_TOOL ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: DRAFT_DENIED })

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

// Where a draft-07 schema holds other schemas: one schema or a list of them, and schemas by name.
// Everything else is data — `enum`, `const`, `default`, and the names under `properties`.
const SCHEMA_OR_LIST: ReadonlySet<string> = new Set(['additionalItems', 'additionalProperties', 'allOf', 'anyOf', 'contains', 'else', 'if', 'items', 'not', 'oneOf', 'propertyNames', 'then'])
const SCHEMAS_BY_NAME: ReadonlySet<string> = new Set(['definitions', 'dependencies', 'patternProperties', 'properties'])

const innerSchema = (value: unknown): unknown => (isRecord(value) ? sessionSchema(value) : value)

/**
 * The draft schema as the Session gets it: a copy without `$schema` and `$id`, in the schema and in
 * every schema inside it. Claude Code checks `--json-schema` with a validator that knows draft-07
 * only: on the `$schema` of draft 2020-12 it exits before the first request to the model ("no schema
 * with key or ref …", Claude Code 2.1.291). The file keeps both keys for its other readers
 * (`bin/project-connect`). A field of the draft that is itself called `$id` stays.
 */
export function sessionSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(schema)) {
    if (key === '$schema' || key === '$id') continue
    if (SCHEMA_OR_LIST.has(key)) copy[key] = Array.isArray(value) ? value.map(innerSchema) : innerSchema(value)
    else if (SCHEMAS_BY_NAME.has(key) && isRecord(value)) copy[key] = Object.fromEntries(Object.entries(value).map(([name, inner]) => [name, innerSchema(inner)]))
    else copy[key] = value
  }
  return copy
}

/** The last action of an SDK message, in a few words; null for a message that shows none. */
export function activityOf(message: unknown): string | null {
  if (!isRecord(message)) return null
  if (message.type === 'system' && message.subtype === 'init') return 'Claude Code started'
  if (message.type === 'result') return 'The draft is ready'
  if (message.type !== 'assistant' || !isRecord(message.message) || !Array.isArray(message.message.content)) return null
  const tools = message.message.content.filter((block): block is Record<string, unknown> => isRecord(block) && block.type === 'tool_use')
  const tool = tools.at(-1)
  if (tool === undefined) return null
  const input = isRecord(tool.input) ? tool.input : {}
  const detail = [input.file_path, input.path, input.command, input.pattern, input.skill].find((value): value is string => typeof value === 'string' && value !== '')
  const name = typeof tool.name === 'string' ? tool.name : 'tool'
  return detail === undefined ? name : `${name} ${detail.length > 120 ? `${detail.slice(0, 119)}…` : detail}`
}

/** An input that gives Claude Code one message and then ends. */
function oneMessage(text: string): AsyncIterable<SDKUserMessage> {
  return {
    async *[Symbol.asyncIterator]() {
      await Promise.resolve()
      yield { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null }
    },
  }
}

// ── what worfy owns in a draft ─────────────────────────────────────────────

export interface DraftChoices {
  folder: ConnectFolder
  mode: ConnectMode
  /** The Workflow folder the user chose; null for the default one. */
  workflowFolder: string | null
  reportsLanguage: 'ru' | 'en'
}

const recordAt = (value: Record<string, unknown>, key: string): Record<string, unknown> => (isRecord(value[key]) ? { ...value[key] } : {})

/**
 * The draft with the values worfy owns set over what the Session proposed: the mode and the Workflow
 * folder of step 2 (Full: none; Silent: the chosen one, by default the multi-repo folder itself or
 * null for `<HARNESS_HOME>/projects/<name>/workflow/`), `worktree.root` under the repository's
 * `.claude/worktrees/` (null over several repositories: a tree outside the repository is not
 * supported yet), `language.reports` from the system language, no GitHub account (chosen later),
 * and the profile name in every gate entry. In Silent mode `attribution` starts as the default of the
 * mode, `off`, whatever the Session proposed (ADR-0061): the form shows it, and what the person picks
 * there is written as picked — this runs once, on the Session's answer, never on the form's draft.
 * In Full mode `attribution` and every other field stay as proposed.
 */
export function applyChoices(draft: ProfileDraft, choices: DraftChoices): ProfileDraft {
  const profile = { ...draft.profile }
  const { folder, mode } = choices
  profile.mode = mode
  if (mode === 'silent') profile.attribution = defaultAttribution('silent')
  const workflow = recordAt(profile, 'workflow')
  workflow.folder = mode === 'full' ? null : (choices.workflowFolder ?? (folder.kind === 'multi-repo' ? folder.root : null))
  profile.workflow = workflow
  const worktree = recordAt(profile, 'worktree')
  worktree.root = folder.kind === 'git' ? join(folder.root, '.claude', 'worktrees') + '/' : null
  profile.worktree = worktree
  profile.language = { ...recordAt(profile, 'language'), reports: choices.reportsLanguage }
  profile.github = { ...recordAt(profile, 'github'), account: null }
  const name = profile.name
  const gate = draft.gate.map((entry) => ({ ...entry, profile: name }))
  return { profile, rules: draft.rules, gate }
}

// ── the connector ─────────────────────────────────────────────────────────────

export type InspectOutcome = { status: 'rejected'; reason: string } | { status: 'known'; folder: ConnectFolder } | { status: 'new'; folder: ConnectFolder }

export type DraftOutcome =
  | { status: 'draft'; draft: ProfileDraft; issues: DraftIssue[] }
  | { status: 'harness'; reason: string }
  | { status: 'refused'; reason: string }
  | { status: 'stopped' }
  | { status: 'failed'; reason: string; issues: DraftIssue[] }

export type WriteOutcome =
  | { status: 'added'; projectId: string; notice: string | null }
  | { status: 'refused'; issues: DraftIssue[] }
  | { status: 'rejected'; reason: string }

export interface DraftInput {
  draftId: string
  root: string
  mode: ConnectMode
  workflowFolder: string | null
}

/** The refusal of Full mode for a folder above several repositories (ADR-0045). */
export const MULTI_REPO_FULL =
  'A project over several repositories is always in Silent mode: its workflow files cannot live in one of the repositories.'

const issueList = (value: unknown): DraftIssue[] =>
  isRecord(value) && Array.isArray(value.errors)
    ? value.errors.filter(isRecord).map((issue) => ({ path: String(issue.path ?? ''), kind: String(issue.kind ?? ''), message: String(issue.message ?? '') }))
    : []

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

const describeIssues = (issues: readonly DraftIssue[]): string =>
  issues
    .slice(0, 3)
    .map((issue) => `${issue.path || 'draft'}: ${issue.message}`)
    .join('; ') + (issues.length > 3 ? `; and ${issues.length - 3} more` : '')

export class ProjectConnector {
  /** The draft Sessions running now, by the dialog's draftId. */
  private readonly running = new Map<string, { query: QueryHandle | null; stopped: boolean }>()

  constructor(private readonly deps: ConnectDeps) {}

  /** Whether the Harness step stops the dialog (harnessBlocker); an installer that cannot answer does not count. */
  private async harnessStops(): Promise<boolean> {
    try {
      return harnessBlocker(await this.deps.harness()) !== null
    } catch {
      return false
    }
  }

  private log(message: string): void {
    ;(this.deps.log ?? ((text: string) => console.warn(text)))(message)
  }

  /** Step 1: the kind of the folder, and whether the Harness knows it already. */
  async inspect(path: string): Promise<InspectOutcome> {
    const inspected = await inspectFolder(path, this.deps.git)
    if (!inspected.ok) return { status: 'rejected', reason: inspected.reason }
    let known: boolean
    try {
      known = await profileKnows(inspected.folder, this.deps.profile, await this.deps.gateRegistries())
    } catch (error) {
      // No profile script because no Harness is installed (or it is one the Harness step stops at):
      // the folder goes on to the dialog as before, and its Harness step says what to do.
      if (missingScript(error) && (await this.harnessStops())) return { status: 'new', folder: inspected.folder }
      // Not "new": the form would draft a Profile the Harness may already have (worfy-windows ticket 30).
      return { status: 'rejected', reason: `The Harness could not tell whether it knows ${inspected.folder.root}: ${error instanceof Error ? error.message : String(error)}` }
    }
    return { status: known ? 'known' : 'new', folder: inspected.folder }
  }

  /** The GitHub account step: the accounts of the hosts of the folder's origins and their write access. */
  async accounts(root: string): Promise<GithubAccountsStep> {
    const inspected = await inspectFolder(root, this.deps.git)
    if (!inspected.ok) return { status: 'failed', reason: inspected.reason }
    return readGithubAccounts(inspected.folder.repos, { git: this.deps.git, gh: this.deps.gh })
  }

  /** Runs `bin/project-connect` with `args` on `draft`; a code other than 0 and 1 (or no script) throws. */
  private async script(args: readonly string[], draft: unknown): Promise<{ ok: boolean; output: unknown; issues: DraftIssue[] }> {
    let run: ScriptRun
    try {
      run = await this.deps.connect(args, JSON.stringify(draft))
    } catch (error) {
      throw new Error(`bin/project-connect could not be run: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
    }
    const output = parseJson(run.stdout)
    if (run.code === 0) return { ok: true, output, issues: [] }
    if (run.code === 1) {
      const issues = issueList(output)
      return { ok: false, output, issues: issues.length > 0 ? issues : [{ path: '', kind: 'write', message: scriptFailureDetail(run.stderr) || 'project-connect refused the draft' }] }
    }
    throw new Error(`bin/project-connect ${args.join(' ')} failed with exit code ${String(run.code)}: ${scriptFailureDetail(run.stderr)}`)
  }

  /** Steps 2–4: the choice, the Harness, then the draft Session. */
  async draft(input: DraftInput, onActivity: (text: string) => void): Promise<DraftOutcome> {
    if (this.running.has(input.draftId)) return { status: 'failed', reason: `A draft ${input.draftId} is already being written.`, issues: [] }
    const inspected = await inspectFolder(input.root, this.deps.git)
    if (!inspected.ok) return { status: 'refused', reason: inspected.reason }
    const folder = inspected.folder
    if (folder.kind === 'multi-repo' && input.mode === 'full') return { status: 'refused', reason: MULTI_REPO_FULL }

    let blocker: string | null
    try {
      blocker = harnessBlocker(await this.deps.harness())
    } catch (error) {
      blocker = `The Harness could not be checked: ${error instanceof Error ? error.message : String(error)}`
    }
    if (blocker !== null) return { status: 'harness', reason: blocker }

    // Registered before the facts, so a Stop while they are read ends the draft too.
    const run = { query: null as QueryHandle | null, stopped: false }
    this.running.set(input.draftId, run)
    let raw: unknown
    try {
      onActivity('Reading the repositories')
      let facts: unknown
      try {
        const read = await this.script(['--facts', folder.root], null)
        if (!read.ok) return { status: 'failed', reason: `The facts of the folder could not be read: ${describeIssues(read.issues)}`, issues: read.issues }
        facts = read.output
      } catch (error) {
        return { status: 'failed', reason: error instanceof Error ? error.message : String(error), issues: [] }
      }
      if (run.stopped) return { status: 'stopped' }
      const stderr: string[] = []
      const query = await this.deps.query({
        prompt: oneMessage(draftMessage(folder.root, input.mode, facts)),
        cwd: folder.root,
        resume: undefined,
        stderr: (data) => stderr.push(data),
        settings: { ...DEFAULT_SETTINGS, permissionMode: 'default' },
        canUseTool: draftCanUseTool,
        unattended: false,
        outputFormat: { type: 'json_schema', schema: sessionSchema(this.deps.draftSchema()) },
        allowedTools: DRAFT_TOOLS,
        disallowedTools: DRAFT_DISALLOWED_TOOLS,
      })
      run.query = query
      if (run.stopped) query.close()
      let result: Record<string, unknown> | null = null
      for await (const message of query) {
        const activity = activityOf(message)
        if (activity !== null) onActivity(activity)
        if (isRecord(message) && message.type === 'result') {
          result = message
          break
        }
      }
      query.close()
      if (run.stopped) return { status: 'stopped' }
      if (result === null) return { status: 'failed', reason: `Claude Code ended before the draft was ready${stderr.length > 0 ? `: ${lastLine(stderr.join(''))}` : ''}.`, issues: [] }
      if (result.subtype !== 'success' || result.structured_output === undefined) {
        const errors = Array.isArray(result.errors) ? result.errors.map(String).join('; ') : ''
        return { status: 'failed', reason: `The draft Session gave no draft (${String(result.subtype)}${errors ? `: ${errors}` : ''}).`, issues: [] }
      }
      raw = result.structured_output
    } catch (error) {
      if (run.stopped) return { status: 'stopped' }
      return { status: 'failed', reason: `The draft Session failed: ${error instanceof Error ? error.message : String(error)}`, issues: [] }
    } finally {
      this.running.delete(input.draftId)
    }

    try {
      const shape = await this.script(['--schema-only'], raw)
      if (!shape.ok) return { status: 'failed', reason: `The draft does not match the schema: ${describeIssues(shape.issues)}`, issues: shape.issues }
      const draft = applyChoices(raw as ProfileDraft, { folder, mode: input.mode, workflowFolder: input.workflowFolder, reportsLanguage: this.deps.reportsLanguage() })
      return { status: 'draft', draft, issues: (await this.script(['--check'], draft)).issues }
    } catch (error) {
      return { status: 'failed', reason: error instanceof Error ? error.message : String(error), issues: [] }
    }
  }

  /** "Stop": ends the draft Session; false when none runs under `draftId`. */
  stop(draftId: string): boolean {
    const run = this.running.get(draftId)
    if (run === undefined) return false
    run.stopped = true
    run.query?.close()
    return true
  }

  /** Step 5: the problems of an edited draft; writes nothing. */
  async check(draft: ProfileDraft): Promise<DraftIssue[]> {
    return (await this.script(['--check'], draft)).issues
  }

  /**
   * Step 6: the write through bin/project-connect, then the folder into the list. `keepActive`: the
   * caller is a Linked machine, and the active Project of this Machine stays as it is.
   */
  async write(root: string, draft: ProfileDraft, options: { keepActive?: boolean } = {}): Promise<WriteOutcome> {
    const inspected = await inspectFolder(root, this.deps.git)
    if (!inspected.ok) return { status: 'rejected', reason: inspected.reason }
    const folder = inspected.folder
    if (folder.kind === 'multi-repo' && draft.profile.mode !== 'silent') return { status: 'refused', issues: [{ path: 'profile.mode', kind: 'value', message: MULTI_REPO_FULL }] }

    const written = await this.script([], draft)
    if (!written.ok) return { status: 'refused', issues: written.issues }
    let found: boolean
    try {
      found = await profileKnows(folder, this.deps.profile, await this.deps.gateRegistries())
    } catch (error) {
      return { status: 'rejected', reason: `The profile was written, but the Harness could not be asked about ${folder.root}: ${error instanceof Error ? error.message : String(error)}. The folder was not added.` }
    }
    if (!found) {
      return { status: 'rejected', reason: `The profile was written, but the Harness does not find it from ${folder.root} (bin/profile -C). The folder was not added.` }
    }
    const added = await this.deps.add(folder.root, { keepActive: options.keepActive === true })
    if (added.status === 'rejected') return added
    const qmd = isRecord(written.output) && isRecord(written.output.qmd) ? written.output.qmd : null
    const skipped = qmd !== null && qmd.status === 'skipped' && typeof qmd.reason === 'string' ? `qmd collections were not set up: ${qmd.reason}.` : null
    if (skipped !== null) this.log(`[connect] ${folder.root}: ${skipped}`)
    const notice = [folder.notice, added.notice, skipped].filter((text): text is string => text !== null && text !== '').join(' ')
    return { status: 'added', projectId: added.projectId, notice: notice === '' ? null : notice }
  }
}
