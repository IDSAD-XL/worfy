// The rows of the move form (worfy-harness ticket 14, item 2), built from what is on disk: files of
// the old Harness in ~/.claude that the installed plugin carries under the same name, the sections
// of CLAUDE.md, the hook records of settings.json that run those files, the status line bridge of
// another build, the qmd group, the machine state and the Profiles. Each row says what it is, which
// choices it offers ("Remove" / "Keep") and which one is the default.
//
// What the old Harness is comes from Q19 of the epic: 3 agents, 7 skills, bin/ without three
// personal scripts, hooks/, the shared rules of CLAUDE.md. Everything else in ~/.claude is personal
// and never becomes a row. Nothing here writes; the plugin state comes from the installer (ticket
// 13) through the caller.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { HarnessState } from '../../../shared/ipc/harness'
import type { ClaudeMdSection, MigrationChoice, MigrationGroup, MigrationPlan, MigrationProfile, MigrationRow } from '../../../shared/ipc/harness-migration'
import { jsonText, profileToSchema2, readLegacyProfiles, rewriteHarnessPaths, type LegacyProfile } from './profiles'

/** Q19: the agents and skills of the old Harness. */
export const HARNESS_AGENTS = ['implementer.md', 'reviewer.md', 'scout.md'] as const
export const HARNESS_SKILLS = ['epic-wave', 'ship-ticket', 'retro', 'qmd', 'overnight-fix-loop', 'continuous-audit', 'tickets-to-tasks'] as const
/** Q19: bin/ of ~/.claude is the Harness's except these. */
export const PERSONAL_BIN = ['telegram-mcp', 'auction-staging-db-mcp', 'agent-time-split'] as const
/** Q15: the qmd scripts; they go or stay with the qmd hook and the qmd record of .claude.json. */
export const QMD_BINS = ['qmd-mcp', 'qmd-refresh', 'qmd-sync-main'] as const
/** The file whose presence makes worfy see the old Harness (locate.ts); the move removes it last. */
export const LEGACY_MARKER = join('bin', 'epic-status')

/**
 * The headings of the shared rules of the old CLAUDE.md, as worfy-harness ticket 02 imported them
 * (harness/rules/global.md before ticket 05 moved the rules into hooks). A section with one of
 * these headings is the Harness's; it is removed by default when the plugin's rules carry it.
 */
export const IMPORTED_CLAUDE_MD_HEADINGS = [
  'Workflow: orchestrator + subagents',
  'Standing authorization',
  'Project profile',
  'Default loop',
  'Answering, not exploring',
  'Plain language',
  'Phase 0 — map before touching anything',
  'Delegate by default',
  'Your own hands — a closed list',
  'Quota',
  'Long output: filter first, delegate second',
  'Subagent contract',
  'Evidence before "green"',
  'Phase 2 — review before reporting',
  'Phase 3 — state, then report',
  'Context hygiene',
] as const

export const QMD_WARNING =
  'The installed plugin does not register qmd yet: until it does, Claude Code sessions have no qmd, and agents search with grep over the qmd.fallback_grep of the Profile.'
export const RUNNING_SESSIONS_WARNING =
  'Claude Code sessions that are already running started with the old hooks and keep them: restart them after the move.'
const NOT_IN_PLUGIN = 'not in the plugin: stays in ~/.claude'

export interface PlanOptions {
  claudeHome: string
  harnessHome: string
  /** Claude Code's .claude.json (claudeJsonPath()). */
  claudeJson: string
  /** What `$HOME` and `~` mean in the commands of settings.json: the HOME Claude Code runs with. */
  userHome: string
  /** <resourcesPath>/statusline-bridge.sh of the packaged app; null in a dev build. */
  bridgeScript: string | null
  /** Whether this run may move (moveOffered()). */
  offered: boolean
  /** The environment of `git` (HOME of the sandbox in tests); process.env by default. */
  env?: NodeJS.ProcessEnv
  /** The installer's state of the plugin; undefined when not asked (the toolbar's offer). */
  pluginState?: HarnessState
}

/** A hook record of settings.json: `hooks[event][group].hooks[index]`. */
export interface HookRef {
  event: string
  group: number
  index: number
  command: string
}

/** What a row does when it is removed; apply.ts carries it out. */
export type Operation =
  | { kind: 'file'; rel: string }
  | { kind: 'hook'; hook: HookRef; target: string }
  | { kind: 'status-line'; command: string }
  | { kind: 'qmd'; bins: string[]; hooks: HookRef[]; mcp: boolean }
  | { kind: 'claude-md'; start: number; end: number }
  | { kind: 'state'; from: string; to: string; merge: boolean }
  | { kind: 'profile'; profile: LegacyProfile; to: string }

export interface BuiltPlan {
  view: MigrationPlan
  /** Row id → its operation; rows offering only "Keep" have none. */
  operations: Map<string, Operation>
  /** Whether anything of the old Harness is there for a move to take. */
  legacyFound: boolean
}

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

function readJson(path: string): { text: string; json: Json } | null {
  const text = readText(path)
  if (text === null) return null
  try {
    const json: unknown = JSON.parse(text)
    return isObject(json) ? { text, json } : null
  } catch {
    return null
  }
}

const isDir = (path: string): boolean => {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

const listDir = (path: string): string[] => (isDir(path) ? readdirSync(path).filter((name) => name !== '.DS_Store').sort() : [])

/** The first word of a shell command, quotes removed, and the rest of the command as it is. */
export function splitCommand(command: string): { head: string; rest: string } {
  const text = command.trimStart()
  const quote = text[0]
  if (quote === '"' || quote === "'") {
    const end = text.indexOf(quote, 1)
    if (end > 0) return { head: text.slice(1, end), rest: text.slice(end + 1) }
  }
  const match = /^\S+/.exec(text)
  const head = match?.[0] ?? ''
  return { head, rest: text.slice(head.length) }
}

/** The file a command runs, with `$HOME`, `${HOME}` and `~` expanded; null when it is not an absolute path then. */
export function commandTarget(command: string, userHome: string): string | null {
  let { head } = splitCommand(command)
  if (head === '~' || head.startsWith('~/')) head = join(userHome, head.slice(1))
  else if (head.startsWith('$HOME/')) head = join(userHome, head.slice('$HOME/'.length))
  else if (head.startsWith('${HOME}/')) head = join(userHome, head.slice('${HOME}/'.length))
  return isAbsolute(head) ? resolve(head) : null
}

/** `path` relative to `root` when inside it (not equal), else null. */
export function inside(root: string, path: string): string | null {
  const rel = relative(resolve(root), resolve(path))
  return rel === '' || rel.startsWith('..') || isAbsolute(rel) ? null : rel
}

/** A path for the form: under the user's home folder it starts with `~`. */
function shown(path: string): string {
  const home = homedir()
  return path === home || path.startsWith(home + sep) ? `~${path.slice(home.length)}` : path
}

const quoteIfNeeded = (path: string): string => (/^[\w./+@-]+$/.test(path) ? path : `'${path.replace(/'/g, `'\\''`)}'`)

/** The `##` and `###` sections of a markdown text: the line each starts at; fenced code is skipped. */
export function markdownSections(text: string): { heading: string; start: number; end: number }[] {
  const lines = text.split('\n')
  const starts: { heading: string; start: number }[] = []
  let fence: string | null = null
  lines.forEach((line, index) => {
    const marker = /^\s*(```+|~~~+)/.exec(line)?.[1]
    if (marker !== undefined) {
      if (fence === null) fence = marker[0] ?? null
      else if (marker[0] === fence) fence = null
      return
    }
    if (fence !== null) return
    const heading = /^#{2,3}\s+(.+?)\s*#*\s*$/.exec(line)?.[1]
    if (heading !== undefined) starts.push({ heading, start: index })
  })
  return starts.map((section, i) => ({ ...section, end: starts[i + 1]?.start ?? lines.length }))
}

/** The `##`/`###` headings of the plugin's rules (hooks/rules/*.md): what the plugin now says itself. */
function pluginRuleHeadings(pluginDir: string): Set<string> {
  const out = new Set<string>()
  const dir = join(pluginDir, 'hooks', 'rules')
  for (const name of listDir(dir)) {
    if (!name.endsWith('.md')) continue
    for (const { heading } of markdownSections(readText(join(dir, name)) ?? '')) out.add(heading)
  }
  return out
}

/** Whether the plugin's .mcp.json registers a server named qmd. */
function pluginRegistersQmd(pluginDir: string): boolean {
  const mcp = readJson(join(pluginDir, '.mcp.json'))?.json
  const servers = mcp && isObject(mcp.mcpServers) ? mcp.mcpServers : mcp
  return isObject(servers) && 'qmd' in servers
}

interface RowInput {
  id: string
  group: MigrationGroup
  label: string
  detail?: string | null
  note?: string | null
  /** Whether "Remove" is offered; without it the row offers only "Keep". */
  removable: boolean
  defaultChoice?: MigrationChoice
}

function row(input: RowInput): MigrationRow {
  return {
    id: input.id,
    group: input.group,
    label: input.label,
    detail: input.detail ?? null,
    note: input.note ?? null,
    choices: input.removable ? ['remove', 'keep'] : ['keep'],
    defaultChoice: input.removable ? (input.defaultChoice ?? 'remove') : 'keep',
  }
}

/** The hook records of settings.json, in file order. */
export function hookRecords(settings: Json | undefined): HookRef[] {
  const hooks = settings?.hooks
  if (!isObject(hooks)) return []
  const out: HookRef[] = []
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue
    groups.forEach((group: unknown, groupIndex) => {
      const entries = isObject(group) && Array.isArray(group.hooks) ? group.hooks : []
      entries.forEach((entry: unknown, index) => {
        if (isObject(entry) && typeof entry.command === 'string') out.push({ event, group: groupIndex, index, command: entry.command })
      })
    })
  }
  return out
}

export const hookId = (hook: HookRef): string => `hook:${hook.event}:${hook.group}:${hook.index}:${hook.command}`

/** Builds the rows of the form from the disk; see the header of this file. */
export function buildPlan(options: PlanOptions): BuiltPlan {
  const { claudeHome, harnessHome, claudeJson, userHome } = options
  const pluginDir = join(harnessHome, 'plugin')
  const operations = new Map<string, Operation>()
  const rows: MigrationRow[] = []
  const add = (value: MigrationRow, operation?: Operation): void => {
    rows.push(value)
    if (operation !== undefined && value.choices.includes('remove')) operations.set(value.id, operation)
  }

  // Files and folders of the old Harness that the plugin carries under the same name.
  const fileRows = new Map<string, MigrationRow>()
  for (const dir of ['agents', 'skills', 'bin', 'hooks'] as const) {
    for (const name of listDir(join(claudeHome, dir))) {
      if (dir === 'bin' && ((PERSONAL_BIN as readonly string[]).includes(name) || (QMD_BINS as readonly string[]).includes(name))) continue
      const rel = join(dir, name)
      const inPlugin = existsSync(join(pluginDir, dir, name))
      const harness =
        dir === 'agents' ? (HARNESS_AGENTS as readonly string[]).includes(name) : dir === 'skills' ? (HARNESS_SKILLS as readonly string[]).includes(name) : true
      if (!inPlugin && !harness) continue
      const value = row({ id: `file:${rel}`, group: 'files', label: shown(join(claudeHome, rel)), removable: inPlugin, note: inPlugin ? null : NOT_IN_PLUGIN })
      fileRows.set(rel, value)
      add(value, { kind: 'file', rel })
    }
  }
  const readme = join('profiles', 'README.md')
  if (existsSync(join(claudeHome, readme)) && existsSync(join(pluginDir, readme))) {
    const value = row({ id: `file:${readme}`, group: 'files', label: shown(join(claudeHome, readme)), removable: true })
    fileRows.set(readme, value)
    add(value, { kind: 'file', rel: readme })
  }

  // CLAUDE.md by sections.
  const claudeMdPath = join(claudeHome, 'CLAUDE.md')
  const claudeMdText = readText(claudeMdPath)
  let claudeMd: MigrationPlan['claudeMd'] = null
  if (claudeMdText !== null) {
    const pluginHeadings = pluginRuleHeadings(pluginDir)
    const lines = claudeMdText.split('\n')
    const sections: ClaudeMdSection[] = markdownSections(claudeMdText).map(({ heading, start, end }, index) => {
      const imported = (IMPORTED_CLAUDE_MD_HEADINGS as readonly string[]).includes(heading)
      const carried = imported && pluginHeadings.has(heading)
      const id = `claude-md:${index}:${heading}`
      const value = {
        ...row({
          id,
          group: 'claude-md',
          label: heading,
          removable: true,
          defaultChoice: carried ? 'remove' : 'keep',
          note: imported && !carried ? "a rule of the old Harness that the plugin's rules do not carry: stays by default" : null,
        }),
        text: lines.slice(start, end).join('\n'),
      }
      operations.set(id, { kind: 'claude-md', start, end })
      return value
    })
    claudeMd = { path: shown(claudeMdPath), sections }
  }

  // settings.json: hook records that run a file of the first group, and the status line.
  const settings = readJson(join(claudeHome, 'settings.json'))
  const qmdBins = QMD_BINS.map((name) => join('bin', name)).filter((rel) => existsSync(join(claudeHome, rel)))
  const qmdHooks: HookRef[] = []
  for (const hook of hookRecords(settings?.json)) {
    const target = commandTarget(hook.command, userHome)
    const rel = target === null ? null : inside(claudeHome, target)
    if (rel === null) continue
    const [dir, name] = rel.split(sep)
    if (dir === 'bin' && (QMD_BINS as readonly string[]).includes(name ?? '')) {
      qmdHooks.push(hook)
      continue
    }
    const entry = name === undefined ? rel : join(dir ?? '', name)
    const file = fileRows.get(entry)
    if (file === undefined) continue
    const removable = file.choices.includes('remove')
    add(
      row({
        id: hookId(hook),
        group: 'hooks',
        label: hook.command,
        detail: `${hook.event}: ${JSON.stringify((settings?.json.hooks as Record<string, { hooks: unknown[] }[]>)[hook.event]?.[hook.group]?.hooks[hook.index])}`,
        removable,
        note: removable ? null : `runs ${file.label}, which is not in the plugin`,
      }),
      { kind: 'hook', hook, target: entry },
    )
  }

  const statusLine = settings?.json.statusLine
  if (isObject(statusLine) && typeof statusLine.command === 'string') {
    const { head, rest } = splitCommand(statusLine.command)
    const target = commandTarget(statusLine.command, userHome)
    if (basename(head) === 'statusline-bridge.sh' && target !== options.bridgeScript) {
      const bridge = options.bridgeScript
      const reason =
        bridge === null
          ? 'a development build: it has no status line bridge of its own'
          : existsSync(bridge)
            ? null
            : `this build has no ${bridge}`
      const command = bridge === null ? null : `${quoteIfNeeded(bridge)}${rest}`
      add(
        row({
          id: 'status-line',
          group: 'status-line',
          label: statusLine.command,
          detail: reason === null ? `becomes: ${command ?? ''}` : null,
          removable: reason === null,
          note: reason,
        }),
        command === null ? undefined : { kind: 'status-line', command },
      )
    }
  }

  // The qmd group: three scripts, the hook and the record in .claude.json go or stay together.
  const claudeJsonText = readText(claudeJson)
  let qmdRecord = false
  if (claudeJsonText !== null) {
    try {
      const parsed: unknown = JSON.parse(claudeJsonText)
      const qmd = isObject(parsed) && isObject(parsed.mcpServers) ? parsed.mcpServers.qmd : undefined
      if (isObject(qmd) && typeof qmd.command === 'string') {
        const target = commandTarget(qmd.command, userHome)
        const rel = target === null ? null : inside(claudeHome, target)
        qmdRecord = rel !== null && rel.startsWith(join('bin', 'qmd-'))
      }
    } catch {
      qmdRecord = false
    }
  }
  if (qmdBins.length > 0 || qmdHooks.length > 0 || qmdRecord) {
    const members = [
      ...qmdBins.map((rel) => shown(join(claudeHome, rel))),
      ...qmdHooks.map((hook) => `${hook.event} hook: ${hook.command}`),
      ...(qmdRecord ? [`mcpServers.qmd in ${shown(claudeJson)}`] : []),
    ]
    add(
      row({
        id: 'qmd',
        group: 'qmd',
        label: 'qmd of the old Harness',
        detail: members.join('\n'),
        removable: true,
        note: pluginRegistersQmd(pluginDir) ? null : QMD_WARNING,
      }),
      { kind: 'qmd', bins: qmdBins, hooks: qmdHooks, mcp: qmdRecord },
    )
  }

  // The machine state: Gate registry, Gate markers and worktree locks move into the Harness home.
  const registryRel = join('gate', 'config.json')
  const registryText = readText(join(claudeHome, registryRel))
  const states: { id: string; from: string; to: string; merge: boolean }[] = [
    { id: 'state:gate-config', from: registryRel, to: join('gate', 'config.json'), merge: false },
    { id: 'state:gate-state', from: join('gate', 'state'), to: join('gate', 'state'), merge: true },
    { id: 'state:worktree-sessions', from: 'worktree-sessions', to: 'worktree-sessions', merge: true },
  ]
  for (const state of states) {
    if (!existsSync(join(claudeHome, state.from))) continue
    const taken = !state.merge && existsSync(join(harnessHome, state.to))
    add(
      row({
        id: state.id,
        group: 'state',
        label: `${shown(join(claudeHome, state.from))} → ${shown(join(harnessHome, state.to))}`,
        removable: !taken,
        note: taken ? `${shown(join(harnessHome, state.to))} is already there` : state.merge ? 'files already in the target stay as they are' : null,
      }),
      { kind: 'state', from: state.from, to: state.to, merge: state.merge },
    )
  }

  // Profiles of schema 1 → <harnessHome>/projects/<p>/, schema 2.
  const homes = { claudeHome, harnessHome }
  const profiles: MigrationProfile[] = readLegacyProfiles(claudeHome, registryText, userHome, options.env).map((profile) => {
    const to = join('projects', profile.name)
    const taken = existsSync(join(harnessHome, to))
    const id = `profile:${profile.name}`
    const files = [
      { path: shown(join(profile.dir, 'profile.json')), before: profile.jsonText, after: jsonText(profileToSchema2(profile.json, profile.fields, homes)) },
      ...(profile.rules === null ? [] : [{ path: shown(join(profile.dir, 'rules.md')), before: profile.rules, after: rewriteHarnessPaths(profile.rules, homes) }]),
    ]
    const value: MigrationProfile = {
      ...row({
        id,
        group: 'profiles',
        label: `${shown(profile.dir)} → ${shown(join(harnessHome, to))}`,
        removable: !taken,
        note: taken ? `${shown(join(harnessHome, to))} is already there` : null,
      }),
      name: profile.name,
      fields: profile.fields,
      modeReason: profile.modeReason,
      files,
      carried: profile.carried,
    }
    if (!taken) operations.set(id, { kind: 'profile', profile, to })
    return value
  })

  const missing: string[] = []
  if (!options.offered) missing.push('a development build on the real ~/.claude does not move the Harness: start the packaged app, or set WORFY_CLAUDE_HOME to a sandbox')
  const plugin = options.pluginState
  if (plugin !== undefined) {
    if (plugin.kind === 'not-installed') missing.push('the plugin worfy is not installed: install it first (Install in the toolbar)')
    else if (plugin.kind === 'outdated') missing.push('the plugin worfy is not the version of this build: update it first (Update Harness in the toolbar)')
    else if (plugin.kind === 'error') missing.push(`the plugin worfy reports an error (${plugin.step}): ${plugin.reason}`)
    else if (!plugin.enabled) missing.push('the plugin worfy is disabled in Claude Code: enable it first')
  }
  const legacyFound =
    rows.some((value) => value.choices.includes('remove')) ||
    (claudeMd?.sections.some((section) => (IMPORTED_CLAUDE_MD_HEADINGS as readonly string[]).includes(section.label)) ?? false) ||
    profiles.some((value) => value.choices.includes('remove'))
  if (!legacyFound) missing.push('nothing of the old Harness is left in ~/.claude')

  const warnings = rows.some((value) => value.group === 'hooks') || qmdHooks.length > 0 ? [RUNNING_SESSIONS_WARNING] : []

  return {
    view: {
      offered: options.offered,
      available: missing.length === 0 && plugin !== undefined,
      missing,
      claudeHome,
      harnessHome,
      claudeJson,
      rows,
      claudeMd,
      profiles,
      warnings,
    },
    operations,
    legacyFound,
  }
}

/** Whether the toolbar offers the form: anything of the old Harness that a move would take. Runs no `claude`. */
export function hasLegacyHarness(options: Omit<PlanOptions, 'pluginState'>): boolean {
  return buildPlan(options).legacyFound
}
