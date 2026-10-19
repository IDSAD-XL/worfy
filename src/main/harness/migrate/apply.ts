// The move of the old Harness out of ~/.claude (worfy-harness ticket 14, items 3–8), by the choices
// of the form. Before the first write everything the move takes or changes is copied into
// <harnessHome>/backup-<date>/ with a manifest and restore.mjs (restore.ts). Then, step by step:
//
//   settings     hook records and the status line in settings.json
//   claude-json  the qmd record of .claude.json (the only write outside the two homes)
//   claude-md    the removed sections of CLAUDE.md
//   state        Profiles (schema 2), the Gate registry and markers, worktree locks → <harnessHome>
//   files        the Harness files, and the moved state, out of ~/.claude
//   epic-status  bin/epic-status, last: while it is there worfy sees the old Harness (locate.ts) and
//                starts its Sessions without the plugin inline; removed before the hook records,
//                a Session started in between would run every hook twice (ADR-0049)
//   commit       one commit in ~/.claude when it is a git repository; the Profiles and the Gate
//                registry committed in <harnessHome> (`git init` when needed)
//
// A failed step undoes the move through restore.mjs and names the step. Nothing is written without
// `offered` (the packaged app, or a WORFY_CLAUDE_HOME sandbox), the plugin installed and enabled,
// and `confirm` saying yes; every path written or removed is checked to be inside the Claude home
// or the Harness home, and .claude.json is the one file outside them.
import { execFileSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, parse, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { HarnessState } from '../../../shared/ipc/harness'
import type { MigrationChoice, MigrationResult, MigrationSelection, MigrationStep, ProfileFields } from '../../../shared/ipc/harness-migration'
import { HARNESS_PLUGIN_ID } from '../install'
import { buildPlan, hookRecords, inside, LEGACY_MARKER, type HookRef, type Operation, type PlanOptions } from './plan'
import { jsonText, profileToSchema2, rewriteHarnessPaths } from './profiles'
import { BACKUP_AFTER_DIR, BACKUP_CLAUDE_DIR, PENDING, restoreCommand, RESTORE_SCRIPT, treeHash, writeManifest, writeRestoreFiles, type Manifest } from './restore'
import { removeFile, removeTree } from '../../storage/remove'
import { statusLineCommandOf, withStatusLineCommand } from '../status-line'

export const MIGRATION_STEPS: readonly MigrationStep[] = ['backup', 'settings', 'claude-json', 'claude-md', 'state', 'files', 'epic-status', 'commit']

/** What the consent dialog shows. */
export interface MigrationSummary {
  removed: number
  hooks: number
  sections: number
  moved: number
  statusLine: boolean
  qmd: boolean
  backupDir: string
}

export interface ApplyOptions extends Omit<PlanOptions, 'pluginState'> {
  /** The plugin's state, asked again right before the move (the installer's status()). */
  pluginStatus: () => Promise<HarnessState>
  /** The user's consent; nothing is written unless it resolves true. */
  confirm: (summary: MigrationSummary) => Promise<boolean>
  now?: () => Date
  /** Test seams: run before and after each step; a throw fails that step. */
  beforeStep?: (step: MigrationStep) => void | Promise<void>
  afterStep?: (step: MigrationStep) => void | Promise<void>
}

/** The .gitignore of a Harness home the move makes a git repository: Profiles and the Gate registry are history, the rest is state. */
export const HARNESS_GITIGNORE = `# The history of the Harness state on this machine: the Profiles and the Gate registry.
# The plugin copy, Gate markers, worktree locks and the backups of a move are state, not history.
/*
!/.gitignore
!/projects/
/projects/*/state/
/projects/*/epics/*/task-map.json
!/gate/
/gate/*
!/gate/config.json
`

const COMMIT_MESSAGE = (backup: string): string =>
  `Move the old Harness out of ~/.claude: the plugin worfy carries it now\n\nMade by worfy. To undo: node ${join(backup, RESTORE_SCRIPT)}\n`
const HARNESS_COMMIT_MESSAGE = 'Profiles and the Gate registry moved from ~/.claude by worfy\n'

class StepFailure extends Error {
  constructor(
    readonly step: MigrationStep,
    error: unknown,
  ) {
    super(error instanceof Error ? error.message : String(error))
  }
}

class Refusal extends Error {}

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

/** JSON in the shape the file had: its indent and its final newline. */
export function stringifyLike(original: string, value: unknown): string {
  const indent = /^[{[]\r?\n([ \t]+)/.exec(original)?.[1]
  const text = original.includes('\n') ? JSON.stringify(value, null, indent ?? 2) : JSON.stringify(value)
  return original.endsWith('\n') ? `${text}\n` : text
}

/** Writes through a file next to the target, renamed over it; the mode of the old file is kept. A failed rename removes that file. */
export function writeAtomically(path: string, text: string): void {
  const mode = existsSync(path) ? statSync(path).mode & 0o777 : 0o644
  const temp = `${path}.worfy-move-${process.pid}`
  writeFileSync(temp, text, { mode })
  try {
    chmodSync(temp, mode)
    renameSync(temp, path)
  } catch (error) {
    // A rename refused (on Windows a file held open without delete sharing): no temporary file is left next to it.
    removeFile(temp)
    throw error
  }
}

/** A folder the move may write in: an existing directory, not the disk root and not the user's home folder. */
function checkHome(path: string, what: string): string {
  const real = realpathSync(path)
  if (!statSync(real).isDirectory()) throw new Refusal(`${what} ${path} is not a folder`)
  if (real === parse(real).root || real === realpathSync(homedir())) throw new Refusal(`${what} ${path} is not a folder the move may write in`)
  return real
}

/** `rel` under `root`, refused when it leads outside it (`..`, an absolute path, a symlinked parent). */
function under(root: string, rel: string): string {
  const path = resolve(root, rel)
  if (inside(root, path) === null) throw new Refusal(`refusing ${rel}: outside ${root}`)
  let parent = dirname(path)
  while (!existsSync(parent)) parent = dirname(parent)
  const realParent = realpathSync(parent)
  const realRoot = realpathSync(root)
  if (realParent !== realRoot && inside(realRoot, realParent) === null) throw new Refusal(`refusing ${rel}: its folder leads outside ${root}`)
  return path
}

/** Every file under `dir`, relative to it. */
function filesOf(dir: string, base = ''): string[] {
  const out: string[] = []
  for (const entry of readdirSync(join(dir, base), { withFileTypes: true })) {
    const rel = join(base, entry.name)
    if (entry.isDirectory()) out.push(...filesOf(dir, rel))
    else out.push(rel)
  }
  return out
}

/** The environment of every `git` the move runs (set once per move from ApplyOptions.env). */
let gitEnv: NodeJS.ProcessEnv = process.env

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: gitEnv })
}

/**
 * Whether `dir` is the top of a git work tree (not just inside one). Both sides go through
 * realpathSync.native: on Windows git prints the long name of a folder, while `dir` may come in an
 * 8.3 short spelling (`C:\Users\RUNNER~1\…`) or through a `subst` drive, which the plain
 * realpathSync keeps; on macOS native also settles the letter case. A volume where the native call
 * fails (some RAM or virtual drives) falls back to the plain one, as before: a wrong "not a root" would
 * skip the ~/.claude commit or run `git init` in a live repository.
 */
function isRepoRoot(dir: string): boolean {
  let toplevel: string
  try {
    toplevel = git(dir, ['rev-parse', '--show-toplevel']).trim()
  } catch {
    return false
  }
  const real = (path: string): string => {
    try {
      return realpathSync.native(path)
    } catch {
      return realpathSync(path)
    }
  }
  try {
    return real(toplevel) === real(dir)
  } catch {
    return false
  }
}

/** `git commit` options: no hooks, no signing, and an identity when the machine has none. */
function commitArgs(dir: string): string[] {
  const args = ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false']
  let email: string
  try {
    email = git(dir, ['config', 'user.email']).trim()
  } catch {
    email = ''
  }
  if (email === '') args.push('-c', 'user.name=worfy', '-c', 'user.email=worfy@localhost')
  return args
}

/** Commits exactly `paths` (those git knows or may know) in `dir`; returns the commit, or null when nothing changed. */
function commitPaths(dir: string, paths: string[], message: string, tracked: boolean): string | null {
  const known = paths.filter((rel) => {
    if (tracked) return git(dir, ['ls-files', '-z', '--', rel]) !== ''
    try {
      git(dir, ['check-ignore', '-q', '--', rel])
      return false
    } catch {
      return true
    }
  })
  if (known.length === 0) return null
  git(dir, ['add', '-A', '--', ...known])
  if (git(dir, ['diff', '--cached', '--name-only', '--', ...known]).trim() === '') return null
  git(dir, [...commitArgs(dir), 'commit', '-q', '--no-verify', '-m', message, '--', ...known])
  return git(dir, ['rev-parse', 'HEAD']).trim()
}

const stamp = (date: Date): string => date.toISOString().replace(/\.\d+Z$/, '').replace(/:/g, '-').replace('T', '-')


interface Actions {
  removeFiles: string[]
  removeMarker: boolean
  hooks: HookRef[]
  statusLine: string | null
  qmdRecord: boolean
  sections: { start: number; end: number }[]
  /** CLAUDE.md as the plan read it: the sections' lines are counted in this text. */
  claudeMdText: string | null
  states: { from: string; to: string; merge: boolean }[]
  profiles: { name: string; from: string; to: string; fields: ProfileFields }[]
}

/** A file the state step writes under the Harness home: from where (absolute), to where (relative). */
interface StateCopy {
  from: string
  to: string
  profile?: { name: string; fields: ProfileFields }
}

/** What the backup step fixes for the steps after it, so a file appearing meanwhile changes nothing. */
interface Fixed {
  copies: StateCopy[]
  /** Files under the moved state and Profile folders as the backup found them (relative to the Claude home): the files step removes these and no others. */
  stateFiles: string[]
}

let running: Promise<MigrationResult> | null = null

/** Moves by `selection`; see the header of this file. A second call while one runs is refused. */
export function applyMigration(selection: MigrationSelection, options: ApplyOptions): Promise<MigrationResult> {
  if (running !== null) return Promise.resolve({ outcome: 'refused', reason: 'a move is already running' })
  running = run(selection, options).finally(() => {
    running = null
  })
  return running
}

/** Refused when a file the move rewrites in place is a symbolic link: a rename would replace the link with a file. */
function refuseLinks(claudeHome: string, claudeJson: string, actions: Actions): void {
  const rewritten = [
    ...(actions.hooks.length > 0 || actions.statusLine !== null ? [join(claudeHome, 'settings.json')] : []),
    ...(actions.sections.length > 0 ? [join(claudeHome, 'CLAUDE.md')] : []),
    ...(actions.qmdRecord ? [claudeJson] : []),
  ]
  for (const path of rewritten) {
    if (lstatSync(path).isSymbolicLink()) {
      throw new Refusal(`${path} is a symbolic link: the move would replace it with a file. Replace the link with the file it points to, or keep the rows that change it`)
    }
  }
}

async function run(selection: MigrationSelection, options: ApplyOptions): Promise<MigrationResult> {
  gitEnv = options.env ?? process.env
  let claudeHome: string
  let harnessHome: string
  let actions: Actions
  let touched: string[]
  try {
    if (!options.offered) throw new Refusal('a development build on the real ~/.claude does not move the Harness: start the packaged app, or set WORFY_CLAUDE_HOME to a sandbox')
    claudeHome = checkHome(options.claudeHome, 'the Claude home')
    harnessHome = checkHome(options.harnessHome, 'the Harness home')
    if (basename(options.claudeJson) !== '.claude.json') throw new Refusal(`${options.claudeJson} is not a .claude.json`)
    const pluginState = await options.pluginStatus()
    const built = buildPlan({ ...options, claudeHome, harnessHome, pluginState })
    if (!built.view.available) throw new Refusal(built.view.missing.join('; '))
    actions = resolveActions(selection, built.view, built.operations)
    refuseLinks(claudeHome, options.claudeJson, actions)
    touched = touchedPaths(actions)
    for (const rel of touched) under(claudeHome, rel)
  } catch (error) {
    if (error instanceof Refusal) return { outcome: 'refused', reason: error.message }
    throw error
  }

  const date = (options.now ?? (() => new Date()))()
  let backupDir = join(harnessHome, `backup-${stamp(date)}`)
  for (let n = 2; existsSync(backupDir); n += 1) backupDir = join(harnessHome, `backup-${stamp(date)}-${n}`)

  const summary: MigrationSummary = {
    removed: actions.removeFiles.length + (actions.removeMarker ? 1 : 0),
    hooks: actions.hooks.length,
    sections: actions.sections.length,
    moved: actions.states.length + actions.profiles.length,
    statusLine: actions.statusLine !== null,
    qmd: actions.qmdRecord,
    backupDir,
  }
  if (!(await options.confirm(summary))) return { outcome: 'declined' }

  const manifest: Manifest = {
    version: 1,
    createdAt: date.toISOString(),
    claudeHome,
    harnessHome,
    claudeJson: options.claudeJson,
    plugin: HARNESS_PLUGIN_ID,
    claude: touched,
    afterMove: {},
    created: [],
    createdHashes: {},
    createdDirs: [],
    claudeJsonRecord: null,
    commits: { claudeHome: null, harnessHome: null },
    harnessGitInit: false,
  }
  /** Marks paths of the Claude home the move is about to change: a restore after a crash here compares them with the backup. */
  const touching = (...rels: string[]): void => {
    for (const rel of rels) manifest.afterMove[rel] = PENDING
    writeManifest(backupDir, manifest)
  }
  /** Records what the move left at these paths of the Claude home, for restore.mjs. */
  const left = (...rels: string[]): void => {
    for (const rel of rels) manifest.afterMove[rel] = treeHash(join(claudeHome, rel))
    writeManifest(backupDir, manifest)
  }

  const step = async (name: MigrationStep, body: () => void): Promise<void> => {
    try {
      await options.beforeStep?.(name)
      body()
      await options.afterStep?.(name)
    } catch (error) {
      throw new StepFailure(name, error)
    }
  }

  let fixed: Fixed = { copies: [], stateFiles: [] }
  try {
    await step('backup', () => {
      fixed = backup(backupDir, manifest, actions)
    })
    await step('settings', () => {
      if (writeSettings(claudeHome, actions, () => touching('settings.json'))) left('settings.json')
    })
    await step('claude-json', () => removeClaudeJsonRecord(options.claudeJson, manifest))
    await step('claude-md', () => {
      if (writeClaudeMd(claudeHome, actions, () => touching('CLAUDE.md'))) left('CLAUDE.md')
    })
    await step('state', () => moveState(backupDir, manifest, fixed.copies))
    await step('files', () => {
      const roots = [...actions.states.map((state) => state.from), ...actions.profiles.map((profile) => profile.from)]
      touching(...actions.removeFiles, ...roots)
      for (const rel of actions.removeFiles) removeTree(under(claudeHome, rel))
      removeStateFiles(claudeHome, fixed.stateFiles, roots)
      left(...actions.removeFiles, ...roots)
    })
    await step('epic-status', () => {
      if (!actions.removeMarker) return
      touching(LEGACY_MARKER)
      removeFile(under(claudeHome, LEGACY_MARKER))
      left(LEGACY_MARKER)
    })
    await step('commit', () => commit(claudeHome, harnessHome, backupDir, manifest, actions))
  } catch (error) {
    if (!(error instanceof StepFailure)) throw error
    return rollBack(error, backupDir)
  }
  return { outcome: 'done', backupDir, restoreCommand: restoreCommand(backupDir) }
}

/** The operations of the rows the user chose to remove; refused when the choices do not fit the plan read now. */
function resolveActions(selection: MigrationSelection, view: ReturnType<typeof buildPlan>['view'], operations: Map<string, Operation>): Actions {
  const rows = [...view.rows, ...(view.claudeMd?.sections ?? []), ...view.profiles]
  const ids = new Set(rows.map((value) => value.id))
  const chosen = Object.keys(selection.choices)
  if (chosen.length !== ids.size || chosen.some((id) => !ids.has(id))) {
    throw new Refusal('~/.claude changed since the form was opened: open it again')
  }
  const choice = (id: string): MigrationChoice => selection.choices[id] ?? 'keep'
  for (const value of rows) {
    if (!value.choices.includes(choice(value.id))) throw new Refusal(`${value.label}: "${choice(value.id)}" is not offered`)
  }
  const actions: Actions = {
    removeFiles: [],
    removeMarker: false,
    hooks: [],
    statusLine: null,
    qmdRecord: false,
    sections: [],
    claudeMdText: view.claudeMd?.text ?? null,
    states: [],
    profiles: [],
  }
  const removedFiles = new Set<string>()
  const keptHooks: { label: string; target: string }[] = []
  for (const value of rows) {
    const operation = operations.get(value.id)
    if (operation === undefined) continue
    const remove = choice(value.id) === 'remove'
    switch (operation.kind) {
      case 'file':
        if (!remove) break
        removedFiles.add(operation.rel)
        if (operation.rel === LEGACY_MARKER) actions.removeMarker = true
        else actions.removeFiles.push(operation.rel)
        break
      case 'hook':
        if (remove) actions.hooks.push(operation.hook)
        else keptHooks.push({ label: value.label, target: operation.target })
        break
      case 'status-line':
        if (remove) actions.statusLine = operation.command
        break
      case 'qmd':
        if (!remove) break
        actions.removeFiles.push(...operation.bins)
        actions.hooks.push(...operation.hooks)
        actions.qmdRecord = operation.mcp
        break
      case 'claude-md':
        if (remove) actions.sections.push({ start: operation.start, end: operation.end })
        break
      case 'state':
        if (remove) actions.states.push(operation)
        break
      case 'profile': {
        if (!remove) break
        const fields = selection.profiles[operation.profile.name]
        if (fields === undefined) throw new Refusal(`no mode, language.docs and attribution for the Profile ${operation.profile.name}`)
        actions.profiles.push({ name: operation.profile.name, from: join('profiles', operation.profile.name), to: operation.to, fields })
        break
      }
    }
  }
  const broken = keptHooks.find((hook) => removedFiles.has(hook.target))
  if (broken !== undefined) throw new Refusal(`the hook "${broken.label}" runs ${broken.target}, which would be removed: keep the file or remove the hook`)
  const nothing =
    actions.removeFiles.length === 0 &&
    !actions.removeMarker &&
    actions.hooks.length === 0 &&
    actions.statusLine === null &&
    !actions.qmdRecord &&
    actions.sections.length === 0 &&
    actions.states.length === 0 &&
    actions.profiles.length === 0
  if (nothing) throw new Refusal('nothing is chosen to remove or move')
  return actions
}

/** Every path under the Claude home the move removes or changes: the backup holds each. */
function touchedPaths(actions: Actions): string[] {
  const out = [...actions.removeFiles, ...(actions.removeMarker ? [LEGACY_MARKER] : [])]
  if (actions.hooks.length > 0 || actions.statusLine !== null) out.push('settings.json')
  if (actions.sections.length > 0) out.push('CLAUDE.md')
  out.push(...actions.states.map((state) => state.from), ...actions.profiles.map((profile) => profile.from))
  return [...new Set(out)]
}

/** The files the state step writes under the Harness home, and the state files it takes them from. */
function stateCopies(claudeHome: string, harnessHome: string, actions: Actions): Fixed {
  const copies: StateCopy[] = []
  const stateFiles: string[] = []
  for (const state of actions.states) {
    const source = join(claudeHome, state.from)
    if (!lstatSync(source).isDirectory()) {
      copies.push({ from: source, to: state.to })
      stateFiles.push(state.from)
      continue
    }
    for (const rel of filesOf(source)) {
      stateFiles.push(join(state.from, rel))
      if (state.merge && existsSync(join(harnessHome, state.to, rel))) continue
      copies.push({ from: join(source, rel), to: join(state.to, rel) })
    }
  }
  for (const profile of actions.profiles) {
    const source = join(claudeHome, profile.from)
    for (const rel of filesOf(source)) {
      stateFiles.push(join(profile.from, rel))
      copies.push({ from: join(source, rel), to: join(profile.to, rel), profile: { name: profile.name, fields: profile.fields } })
    }
  }
  return { copies, stateFiles }
}

function backup(backupDir: string, manifest: Manifest, actions: Actions): Fixed {
  const { claudeHome, harnessHome } = manifest
  mkdirSync(backupDir)
  const fixed = stateCopies(claudeHome, harnessHome, actions)
  for (const rel of manifest.claude) {
    const source = join(claudeHome, rel)
    if (!existsSync(source)) continue
    const target = join(backupDir, BACKUP_CLAUDE_DIR, rel)
    mkdirSync(dirname(target), { recursive: true })
    cpSync(source, target, { recursive: true, verbatimSymlinks: true })
  }
  manifest.claude = manifest.claude.filter((rel) => existsSync(join(backupDir, BACKUP_CLAUDE_DIR, rel)))

  const created = fixed.copies.map((copy) => copy.to)
  const willInit = (actions.profiles.length > 0 || actions.states.some((state) => !state.merge)) && !isRepoRoot(harnessHome)
  if (willInit && !existsSync(join(harnessHome, '.gitignore'))) created.push('.gitignore')
  const dirs = new Set<string>()
  for (const rel of created) {
    for (let dir = dirname(rel); dir !== '.' && dir !== ''; dir = dirname(dir)) {
      if (!existsSync(join(harnessHome, dir))) dirs.add(dir)
    }
  }
  manifest.created = created
  manifest.createdDirs = [...dirs].sort((a, b) => b.split(sep).length - a.split(sep).length || b.localeCompare(a))

  if (actions.qmdRecord) {
    const json = JSON.parse(readFileSync(manifest.claudeJson, 'utf8')) as Json
    const servers = isObject(json.mcpServers) ? json.mcpServers : {}
    const index = Object.keys(servers).indexOf('qmd')
    if (index >= 0) manifest.claudeJsonRecord = { key: 'qmd', index, value: servers.qmd }
  }
  writeRestoreFiles(backupDir, manifest)
  return fixed
}

/** Takes the hook records and the status line out of settings.json; false when there is nothing to change. */
function writeSettings(claudeHome: string, actions: Actions, touching: () => void): boolean {
  if (actions.hooks.length === 0 && actions.statusLine === null) return false
  const path = under(claudeHome, 'settings.json')
  const original = readFileSync(path, 'utf8')
  const settings = JSON.parse(original) as Json
  // The record indices come from the plan: a file changed since (Claude Code, another worfy) fails the step.
  const records = hookRecords(settings)
  for (const hook of actions.hooks) {
    const now = records.find((record) => record.event === hook.event && record.group === hook.group && record.index === hook.index)
    if (now?.command !== hook.command) throw new Error(`settings.json changed during the move: ${hook.event} no longer has "${hook.command}" where the plan found it`)
  }
  const drop = new Set(actions.hooks.map((hook) => `${hook.event}\u0000${hook.group}\u0000${hook.index}`))
  if (drop.size > 0 && isObject(settings.hooks)) {
    const hooks: Json = {}
    for (const [event, groups] of Object.entries(settings.hooks)) {
      if (!Array.isArray(groups)) {
        hooks[event] = groups
        continue
      }
      const kept = groups.flatMap((group: unknown, groupIndex) => {
        if (!isObject(group) || !Array.isArray(group.hooks)) return [group]
        const entries = group.hooks.filter((_entry: unknown, index) => !drop.has(`${event}\u0000${groupIndex}\u0000${index}`))
        if (entries.length === group.hooks.length) return [group]
        return entries.length === 0 ? [] : [{ ...group, hooks: entries }]
      })
      if (kept.length > 0 || groups.length === 0) hooks[event] = kept
    }
    settings.hooks = hooks
  }
  const written = actions.statusLine !== null && isObject(settings.statusLine) ? withStatusLineCommand(settings, actions.statusLine) : settings
  touching()
  writeAtomically(path, stringifyLike(original, written))
  return true
}

/**
 * Sets `statusLine.command` of Claude Code's settings.json to `command` and changes no other key —
 * the "Limits from terminal" action of the first-run screen on Windows (worfy-windows ticket 13),
 * with the same change the move writes above (withStatusLineCommand). `expected` is the command the
 * dialog showed, null for none: a file changed since is refused, not overwritten. A missing
 * settings.json is created with the statusLine key alone.
 */
export function writeStatusLine(settingsFile: string, expected: string | null, command: string): void {
  const original = existsSync(settingsFile) ? readFileSync(settingsFile, 'utf8') : null
  const now = original === null ? null : statusLineCommandOf(original)
  if (now !== expected) throw new Error(`settings.json changed since the dialog: its statusLine command is now ${now === null ? 'not set' : `"${now}"`}`)
  const settings = original === null ? {} : (JSON.parse(original) as Json)
  if (original === null) mkdirSync(dirname(settingsFile), { recursive: true })
  writeAtomically(settingsFile, stringifyLike(original ?? '{\n  "statusLine": null\n}\n', withStatusLineCommand(settings, command)))
}

function removeClaudeJsonRecord(path: string, manifest: Manifest): void {
  if (manifest.claudeJsonRecord === null) return
  const original = readFileSync(path, 'utf8')
  const json = JSON.parse(original) as Json
  if (!isObject(json.mcpServers) || !('qmd' in json.mcpServers)) return
  delete json.mcpServers.qmd
  writeAtomically(path, stringifyLike(original, json))
}

/** Removes the chosen sections; false when there are none. The file must still be the text the plan cut into sections. */
function writeClaudeMd(claudeHome: string, actions: Actions, touching: () => void): boolean {
  if (actions.sections.length === 0) return false
  const path = under(claudeHome, 'CLAUDE.md')
  const text = readFileSync(path, 'utf8')
  if (text !== actions.claudeMdText) throw new Error('CLAUDE.md changed during the move: its sections are no longer where the plan found them')
  const kept = text.split('\n').filter((_line, index) => !actions.sections.some((section) => index >= section.start && index < section.end))
  touching()
  writeAtomically(path, kept.join('\n'))
  return true
}

/** Writes the state copies fixed by the backup step; each file's fingerprint goes into the manifest as it is written. */
function moveState(backupDir: string, manifest: Manifest, copies: StateCopy[]): void {
  const { claudeHome, harnessHome } = manifest
  const homes = { claudeHome, harnessHome }
  for (const copy of copies) {
    const target = under(harnessHome, copy.to)
    if (existsSync(target)) throw new Error(`${target} appeared during the move`)
    mkdirSync(dirname(target), { recursive: true })
    const top = copy.profile === undefined ? null : copy.to.split(sep).slice(2).join(sep)
    if (copy.profile !== undefined && top === 'profile.json') {
      const before = JSON.parse(readFileSync(copy.from, 'utf8')) as Json
      writeFileSync(target, jsonText(profileToSchema2(before, copy.profile.fields, homes)))
    } else if (copy.profile !== undefined && top === 'rules.md') {
      writeFileSync(target, rewriteHarnessPaths(readFileSync(copy.from, 'utf8'), homes))
    } else {
      cpSync(copy.from, target, { verbatimSymlinks: true })
    }
    manifest.createdHashes[copy.to] = treeHash(target) ?? ''
  }
  writeManifest(backupDir, manifest)
}

/**
 * Removes the state files the backup found (and copied) and then the folders left empty; a file a
 * live Session wrote meanwhile stays where it is, and so does its folder.
 */
function removeStateFiles(claudeHome: string, files: string[], roots: string[]): void {
  for (const rel of files) removeFile(under(claudeHome, rel))
  const prune = (dir: string): void => {
    const path = under(claudeHome, dir)
    if (!existsSync(path) || !lstatSync(path).isDirectory()) return
    for (const entry of readdirSync(path, { withFileTypes: true })) if (entry.isDirectory()) prune(join(dir, entry.name))
    if (readdirSync(path).length === 0) rmdirSync(path)
  }
  for (const root of roots) prune(root)
}

function commit(claudeHome: string, harnessHome: string, backupDir: string, manifest: Manifest, actions: Actions): void {
  if (isRepoRoot(claudeHome)) {
    manifest.commits.claudeHome = commitPaths(claudeHome, manifest.claude, COMMIT_MESSAGE(backupDir), true)
    writeManifest(backupDir, manifest)
  }
  const history = [...actions.profiles.map((profile) => profile.to), ...actions.states.filter((state) => !state.merge).map((state) => state.to)]
  if (history.length === 0) return
  if (!isRepoRoot(harnessHome)) {
    git(harnessHome, ['init', '-q'])
    manifest.harnessGitInit = true
    writeManifest(backupDir, manifest)
    if (manifest.created.includes('.gitignore')) {
      const path = under(harnessHome, '.gitignore')
      writeFileSync(path, HARNESS_GITIGNORE)
      manifest.createdHashes['.gitignore'] = treeHash(path) ?? ''
      writeManifest(backupDir, manifest)
    }
    history.unshift('.gitignore')
  }
  manifest.commits.harnessHome = commitPaths(harnessHome, history, HARNESS_COMMIT_MESSAGE, false)
  writeManifest(backupDir, manifest)
}

/**
 * Undoes a failed move through the backup's restore.mjs. The backup goes once the undo succeeded,
 * unless the undo kept something in its after/ (a file changed during the move): then it stays.
 */
async function rollBack(failure: StepFailure, backupDir: string): Promise<MigrationResult> {
  const reason = failure.message
  try {
    if (failure.step !== 'backup') {
      const module = (await import(/* @vite-ignore */ pathToFileURL(join(backupDir, RESTORE_SCRIPT)).href)) as {
        restore: (dir: string, options: { disablePlugin: boolean; log: (line: string) => void }) => void
      }
      module.restore(backupDir, { disablePlugin: false, log: () => undefined })
    }
    const after = join(backupDir, BACKUP_AFTER_DIR)
    const kept = existsSync(after) ? readdirSync(after).filter((name) => name !== 'harness-git') : []
    if (kept.length === 0) {
      removeTree(backupDir)
      return { outcome: 'failed', step: failure.step, reason, rolledBack: true, rollbackError: null, backupDir: null }
    }
    return { outcome: 'failed', step: failure.step, reason, rolledBack: true, rollbackError: null, backupDir }
  } catch (error) {
    return {
      outcome: 'failed',
      step: failure.step,
      reason,
      rolledBack: false,
      rollbackError: error instanceof Error ? error.message : String(error),
      backupDir: existsSync(backupDir) ? backupDir : null,
    }
  }
}
