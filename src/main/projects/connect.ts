// Connecting a Project to the Harness (worfy-harness ticket 24; ADR-0042, ADR-0045): the steps of
// the "Add project" dialog in main.
//
// 1. The folder, only read (`git rev-parse`): a git repository — a subfolder or a linked worktree
//    resolves to its root, as ProjectStore does —, or a folder outside git with at least two git
//    repositories among its direct subfolders (`multi-repo`, like Atakama). A folder the Harness
//    already knows (`bin/profile -C` exits 0; for a multi-repo folder with `_resolved.workspace`)
//    needs no draft: the caller adds it to the list at once.
// 2. The mode: Full or Silent; a multi-repo folder is Silent only.
// 3. The Harness check, from the same installer state as the first-run screen (worfy-harness ticket
//    19): the plugin installed, enabled, of this build's version. Otherwise no Session starts.
// 4. The draft: a Claude Code Session in the folder, first message `/worfy:connect-project <folder>
//    <mode> --draft-only`, the draft schema as its structured output (outputFormat), and Write, Edit,
//    NotebookEdit taken away; a Bash command that is not a known read-only one is refused
//    (draftCanUseTool). The answer is checked against the schema by `bin/project-connect
//    --schema-only`; worfy then sets what it owns (applyChoices) and asks `--check` for the form.
// 5./6. The form's checks and the write go through `bin/project-connect` only (ADR-0002: worfy
//    changes workflow state only with the Harness's tools); worfy writes nothing itself — not in the
//    Harness home and never in the Project's repositories (ADR-0005). After the write `bin/profile -C`
//    must know the folder, and the caller adds it to the list.
//
// Everything that reaches outside — git, the two Harness scripts, the installer, Claude Code, the
// list — comes in through ConnectDeps, so the contract test runs the steps with stand-ins.
import { readdirSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { DEFAULT_SETTINGS } from '../../shared/agent/settings'
import type { HarnessStatus } from '../../shared/ipc/harness'
import type { ConnectFolder, ConnectMode, DraftIssue, ProfileDraft } from '../../shared/ipc/projects'
import type { CanUseToolHandler } from '../agent/permissions'
import type { QueryHandle, QueryRequest } from '../agent/session'
import type { ProfileRunner } from '../workflow/profile'
import type { GitRunner } from './store'

/** The tools the draft Session runs without: it reads the Project and writes nothing (outputFormat answers). */
export const DRAFT_DISALLOWED_TOOLS: readonly string[] = Object.freeze(['Write', 'Edit', 'NotebookEdit'])

/** The structured output a draft Session answers with (SDK option `outputFormat`). */
export interface DraftOutputFormat {
  type: 'json_schema'
  schema: Record<string, unknown>
}

/** A Claude Code query of the draft Session: a Session's request plus the draft's own options. */
export interface DraftRequest extends QueryRequest {
  outputFormat: DraftOutputFormat
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

/** What adding the folder to the list answered (ProjectStore.add, through the caller). */
export type AddOutcome = { status: 'added'; projectId: string; notice: string | null } | { status: 'rejected'; reason: string }

export interface ConnectDeps {
  git: GitRunner
  /** `bin/profile` of the Harness on the machine. */
  profile: ProfileRunner
  /** `bin/project-connect` of the Harness on the machine. */
  connect: ConnectScript
  /** The installer's state (src/main/harness/install.ts), as the first-run screen reads it. */
  harness: () => Promise<HarnessStatus>
  /** Claude Code for the draft Session. */
  query: DraftQueryFactory
  /** harness/profiles/draft.schema.json of the Harness this build carries. */
  draftSchema: () => Record<string, unknown>
  /** `language.reports` by default: the system language (`app.getLocale()`), `ru` or `en`. */
  reportsLanguage: () => 'ru' | 'en'
  /** Puts the folder into the list and makes it active. */
  add: (root: string) => Promise<AddOutcome>
  /** Where a reason goes besides the answer; console.warn by default. */
  log?: (message: string) => void
}

// ── step 1: the folder ─────────────────────────────────────────────────────────

export type FolderInspection = { ok: true; folder: ConnectFolder } | { ok: false; reason: string }

function realpathOrSelf(path: string): string {
  try {
    return realpathSync(path)
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

/** Whether the Harness already knows the folder: `bin/profile -C <root>` exits 0 (a multi-repo folder also needs `_resolved.workspace`). */
export async function profileKnows(folder: ConnectFolder, profile: ProfileRunner): Promise<boolean> {
  let run: ScriptRun
  try {
    run = await profile(folder.root, ['-C', folder.root, '--json'])
  } catch {
    return false
  }
  if (run.code !== 0) return false
  if (folder.kind === 'git') return true
  try {
    const parsed = JSON.parse(run.stdout) as { _resolved?: { workspace?: unknown } }
    return typeof parsed._resolved?.workspace === 'string' && parsed._resolved.workspace !== ''
  } catch {
    return false
  }
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

/** The first message of the draft Session; a folder with a space goes in double quotes. */
export function draftCommand(root: string, mode: ConnectMode): string {
  const folder = /\s/.test(root) ? `"${root}"` : root
  return `/worfy:connect-project ${folder} ${mode} --draft-only`
}

/** Commands a draft Session may run as they are: they only read. */
// Not here on purpose: `uniq` (`uniq in out` writes out), `file` (`file -C` compiles a magic file),
// `tee`, and anything that runs another program.
const READERS = new Set(['ls', 'cat', 'head', 'tail', 'wc', 'jq', 'grep', 'pwd', 'stat', 'test', '[', 'echo', 'basename', 'dirname', 'realpath', 'cut', 'tr', 'which'])
/** Readers with an option that writes or runs another program. */
const WRITING_OPTIONS: Record<string, RegExp> = {
  find: /^-(delete|exec|execdir|ok|okdir|fprint|fprint0|fprintf|fls)$/,
  sort: /^(-o|--output(=.*)?|--compress-program(=.*)?)$/,
  tree: /^-o$/,
  // `rg --pre <command>` runs the command on every file it searches.
  rg: /^--pre(-glob)?(=.*)?$/,
}

/** Whether `git <words>` only reads: the subcommand and its arguments, after `-C <dir>` and `-c <k=v>`. */
function gitReads(words: readonly string[]): boolean {
  let at = 0
  // `-c <key=value>`, `--config-env` and `--exec-path` can make any git command run a program
  // (`git -c diff.external=rm diff`): such a git call is no reader.
  if (words.some((word) => word === '-c' || word.startsWith('--config-env') || word.startsWith('--exec-path'))) return false
  while (words[at] === '-C' || words[at] === '--no-pager') at += words[at] === '--no-pager' ? 1 : 2
  const [sub, ...args] = words.slice(at)
  const flags = args.filter((word) => word.startsWith('-'))
  const positional = args.filter((word) => !word.startsWith('-'))
  // `git diff --output=<file>` and `git log --output` write the file.
  if (flags.some((flag) => flag.startsWith('--output'))) return false
  switch (sub) {
    case 'rev-parse':
    case 'log':
    case 'ls-files':
    case 'show':
    case 'status':
    case 'describe':
    case 'ls-remote':
    case 'diff':
      return true
    case 'symbolic-ref':
      return positional.length <= 1 && !flags.some((flag) => flag === '-d' || flag === '--delete')
    case 'remote':
      return positional.length === 0 || positional[0] === 'show' || positional[0] === 'get-url'
    case 'branch':
      return positional.length === 0 && flags.every((flag) => /^(-a|-r|-v|-vv|-l|--all|--remotes|--verbose|--list|--show-current|--no-color|--format=.*)$/.test(flag))
    case 'config':
      return flags.some((flag) => /^(--get|--get-all|--get-regexp|--list|-l)$/.test(flag))
    case 'tag':
      return args.length === 0 || flags.some((flag) => flag === '-l' || flag === '--list')
    default:
      return false
  }
}

/**
 * Whether a Bash command only reads: every part of a `&&`, `||`, `;` or `|` chain is a known reader
 * without an option that writes, and nothing is redirected into a file or run in a subshell.
 */
export function readOnlyCommand(command: string): boolean {
  // Output thrown away is no write.
  const plain = command.replace(/\d?>\s*\/dev\/null|2>&1/g, ' ')
  if (/[>`]|\$\(|<\(/.test(plain)) return false
  return plain
    // A single `&` ends a command too (it runs the one before in the background).
    .split(/&&|\|\||;|\||&|\n/)
    .map((part) => part.trim())
    .every((part) => {
      if (part === '') return true
      const [head = '', ...args] = part.split(/\s+/)
      if (head === 'git') return gitReads(args)
      const writing = Object.hasOwn(WRITING_OPTIONS, head) ? WRITING_OPTIONS[head] : undefined
      if (writing !== undefined) return !args.some((word) => writing.test(word))
      return READERS.has(head)
    })
}

const DRAFT_DENIED = 'The draft Session only reads the project: worfy writes the profile after the form.'

/** canUseTool of the draft Session: the tools that write and any Bash that is not readOnlyCommand are refused. */
export const draftCanUseTool: CanUseToolHandler = (toolName, input) => {
  if (DRAFT_DISALLOWED_TOOLS.includes(toolName) || toolName === 'MultiEdit') return Promise.resolve({ behavior: 'deny', message: DRAFT_DENIED })
  if (toolName === 'Bash' && !(typeof input.command === 'string' && readOnlyCommand(input.command))) {
    return Promise.resolve({ behavior: 'deny', message: `${DRAFT_DENIED} Only commands that read run here.` })
  }
  return Promise.resolve({ behavior: 'allow', updatedInput: input })
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

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
 * and the profile name in every gate entry. Every other field stays as proposed.
 */
export function applyChoices(draft: ProfileDraft, choices: DraftChoices): ProfileDraft {
  const profile = { ...draft.profile }
  const { folder, mode } = choices
  profile.mode = mode
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

  private log(message: string): void {
    ;(this.deps.log ?? ((text: string) => console.warn(text)))(message)
  }

  /** Step 1: the kind of the folder, and whether the Harness knows it already. */
  async inspect(path: string): Promise<InspectOutcome> {
    const inspected = await inspectFolder(path, this.deps.git)
    if (!inspected.ok) return { status: 'rejected', reason: inspected.reason }
    const known = await profileKnows(inspected.folder, this.deps.profile)
    return { status: known ? 'known' : 'new', folder: inspected.folder }
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
      return { ok: false, output, issues: issues.length > 0 ? issues : [{ path: '', kind: 'write', message: lastLine(run.stderr) || 'project-connect refused the draft' }] }
    }
    throw new Error(`bin/project-connect ${args.join(' ')} failed with exit code ${String(run.code)}: ${lastLine(run.stderr)}`)
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

    const run = { query: null as QueryHandle | null, stopped: false }
    this.running.set(input.draftId, run)
    let raw: unknown
    try {
      const stderr: string[] = []
      const query = await this.deps.query({
        prompt: oneMessage(draftCommand(folder.root, input.mode)),
        cwd: folder.root,
        resume: undefined,
        stderr: (data) => stderr.push(data),
        settings: { ...DEFAULT_SETTINGS, permissionMode: 'default' },
        canUseTool: draftCanUseTool,
        unattended: false,
        outputFormat: { type: 'json_schema', schema: this.deps.draftSchema() },
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

  /** Step 6: the write through bin/project-connect, then the folder into the list. */
  async write(root: string, draft: ProfileDraft): Promise<WriteOutcome> {
    const inspected = await inspectFolder(root, this.deps.git)
    if (!inspected.ok) return { status: 'rejected', reason: inspected.reason }
    const folder = inspected.folder
    if (folder.kind === 'multi-repo' && draft.profile.mode !== 'silent') return { status: 'refused', issues: [{ path: 'profile.mode', kind: 'value', message: MULTI_REPO_FULL }] }

    const written = await this.script([], draft)
    if (!written.ok) return { status: 'refused', issues: written.issues }
    if (!(await profileKnows(folder, this.deps.profile))) {
      return { status: 'rejected', reason: `The profile was written, but the Harness does not find it from ${folder.root} (bin/profile -C). The folder was not added.` }
    }
    const added = await this.deps.add(folder.root)
    if (added.status === 'rejected') return added
    const qmd = isRecord(written.output) && isRecord(written.output.qmd) ? written.output.qmd : null
    const skipped = qmd !== null && qmd.status === 'skipped' && typeof qmd.reason === 'string' ? `qmd collections were not set up: ${qmd.reason}.` : null
    if (skipped !== null) this.log(`[connect] ${folder.root}: ${skipped}`)
    const notice = [folder.notice, added.notice, skipped].filter((text): text is string => text !== null && text !== '').join(' ')
    return { status: 'added', projectId: added.projectId, notice: notice === '' ? null : notice }
  }
}
