// Profiles of schema 1 in ~/.claude/profiles/<p>/ become Profiles of schema 2 in
// <harnessHome>/projects/<p>/ (worfy-harness ticket 14, item 3; the contract is
// harness/profiles/README.md). The four fields that held paths of the old Harness go: the plugin's
// bin/profile answers them with its own scripts. `mode`, `language.docs` and `attribution` are
// proposed here and confirmed by the owner in the form. Paths into the places the move empties are
// rewritten in profile.json and rules.md alike.
//
// Nothing here writes. `mode` is found by reading only: `git rev-parse` in the tickets folder of the
// Project (ADR-0005: the move writes nothing into the repositories of Projects).
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { ProfileFields } from '../../../shared/ipc/harness-migration'

export interface Homes {
  claudeHome: string
  harnessHome: string
}

/** The fields of schema 1 that named scripts of the old Harness (README, "The Harness's own scripts"). */
export const HARNESS_PATH_FIELDS: readonly (readonly [group: string, field: string])[] = [
  ['tickets', 'status_tool'],
  ['tickets', 'epic_status'],
  ['workflow', 'preflight'],
  ['numbering', 'reserve_with'],
]

/** The agents and skills of the old Harness (Q19), the ones the plugin carries. */
const HARNESS_AGENT_NAMES = ['implementer', 'reviewer', 'scout']
const HARNESS_SKILL_NAMES = ['epic-wave', 'ship-ticket', 'retro', 'qmd', 'overnight-fix-loop', 'continuous-audit', 'tickets-to-tasks']

/** Folders of a Profile carried over as they are. */
const CARRIED = ['bin', 'lessons', 'state', 'epics']

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Rewrites the paths that lead into what the move takes out of ~/.claude (ticket 14, item 3):
 * `bin/`, `hooks/` and the Harness's `agents/` and `skills/` → the plugin, `gate/` → <harnessHome>/gate/, `profiles/README.md` → the
 * plugin's contract, `profiles/` → <harnessHome>/projects/. The Claude home may be written as `~`,
 * `$HOME`, `${HOME}` or as its absolute path; the result keeps the form it found when the Harness
 * home is the default one inside the Claude home, and takes the Harness home's absolute path otherwise.
 */
export function rewriteHarnessPaths(text: string, { claudeHome, harnessHome }: Homes): string {
  const standard = resolve(harnessHome) === join(resolve(claudeHome), 'worfy-harness')
  const prefixes = ['~/.claude/', '$HOME/.claude/', '${HOME}/.claude/', `${resolve(claudeHome)}/`]
  // agents/ and skills/ only where they name the Harness's own (or the brace list of its agents):
  // personal skills stay in ~/.claude.
  const agents = `agents/(?=\\{|(?:${HARNESS_AGENT_NAMES.map(escape).join('|')})\\b)`
  const skills = `skills/(?=(?:${HARNESS_SKILL_NAMES.map(escape).join('|')})(?![\\w-]))`
  const pattern = new RegExp(`(${prefixes.map(escape).join('|')})(bin/|hooks/|gate/|profiles/README\\.md|profiles/|${agents}|${skills})`, 'g')
  return text.replace(pattern, (_match, prefix: string, rest: string) => {
    const home = standard ? `${prefix}worfy-harness/` : `${resolve(harnessHome)}/`
    switch (rest) {
      case 'bin/':
        return `${home}plugin/bin/`
      case 'hooks/':
        return `${home}plugin/hooks/`
      case 'gate/':
        return `${home}gate/`
      case 'agents/':
        return `${home}plugin/agents/`
      case 'skills/':
        return `${home}plugin/skills/`
      case 'profiles/README.md':
        return `${home}plugin/profiles/README.md`
      default:
        return `${home}projects/`
    }
  })
}

/** Every string inside a JSON value rewritten by rewriteHarnessPaths. */
function rewriteValue(value: unknown, homes: Homes): unknown {
  if (typeof value === 'string') return rewriteHarnessPaths(value, homes)
  if (Array.isArray(value)) return value.map((item) => rewriteValue(item, homes))
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewriteValue(item, homes)]))
  }
  return value
}

type Json = Record<string, unknown>

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * profile.json of schema 2 from one of schema 1: `schema` 2, the four Harness paths gone, paths
 * rewritten, `mode` and `attribution` after the name and title, `language.docs` added.
 */
export function profileToSchema2(before: Json, fields: ProfileFields, homes: Homes): Json {
  const source = rewriteValue(before, homes) as Json
  for (const [group, field] of HARNESS_PATH_FIELDS) {
    const holder = source[group]
    if (isObject(holder)) delete holder[field]
  }
  const language = typeof source.language === 'string' ? { reports: source.language, team: source.language } : isObject(source.language) ? source.language : {}
  const head: Json = { schema: 2 }
  const rest: Json = {}
  let placed = false
  const keys = Object.keys(source).filter((key) => key !== 'schema' && key !== 'mode' && key !== 'attribution')
  const anchor = keys.includes('title') ? 'title' : keys.includes('name') ? 'name' : null
  if (anchor === null) {
    head.mode = fields.mode
    head.attribution = fields.attribution
    placed = true
  }
  for (const key of keys) {
    const value = key === 'language' ? { ...language, docs: fields.languageDocs } : source[key]
    if (placed) rest[key] = value
    else head[key] = value
    if (key === anchor) {
      head.mode = fields.mode
      head.attribution = fields.attribution
      placed = true
    }
  }
  if (!keys.includes('language')) rest.language = { docs: fields.languageDocs }
  return { ...head, ...rest }
}

/** The text a profile.json is written with. */
export const jsonText = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`

/** `~` and `$HOME` at the start of a path, expanded. */
function expandHome(path: string, home: string): string {
  if (path === '~' || path.startsWith('~/')) return join(home, path.slice(1))
  if (path.startsWith('$HOME/')) return join(home, path.slice('$HOME/'.length))
  return path
}

/** The git work tree holding `dir` (or its nearest existing parent); null outside git. Reads only. */
export function gitTopLevel(dir: string, env: NodeJS.ProcessEnv = process.env): string | null {
  let current = resolve(dir)
  while (!existsSync(current) && dirname(current) !== current) current = dirname(current)
  try {
    const top = execFileSync('git', ['-C', current, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...env, GIT_OPTIONAL_LOCKS: '0' },
    }).trim()
    return top === '' ? null : top
  } catch {
    return null
  }
}

/**
 * `full` when the tickets folder (`tickets.root`, `.scratch` by default; relative to the first
 * repository of the Profile in the Gate registry) is inside a git repository, `silent` otherwise
 * (Q24: Atakama keeps `.scratch/` above its three repositories, outside git).
 */
export function proposeMode(
  profile: Json,
  repos: readonly string[],
  userHome: string,
  env: NodeJS.ProcessEnv = process.env,
): { mode: 'full' | 'silent'; reason: string } {
  const tickets = isObject(profile.tickets) ? profile.tickets : {}
  const root = typeof tickets.root === 'string' && tickets.root !== '' ? tickets.root : '.scratch'
  const expanded = expandHome(root, userHome)
  let folder: string
  if (isAbsolute(expanded)) folder = expanded
  else if (repos[0] !== undefined) folder = join(repos[0], expanded)
  else return { mode: 'silent', reason: `the tickets folder ${root} is relative and the Gate registry names no repository of this Profile` }
  const top = gitTopLevel(folder, env)
  return top === null
    ? { mode: 'silent', reason: `the tickets folder ${folder} is outside git` }
    : { mode: 'full', reason: `the tickets folder ${folder} is in the git repository ${top}` }
}

/** `language.docs` proposed: the Profile's `language.reports` (the string form counts as it). */
export function proposeLanguageDocs(profile: Json): 'ru' | 'en' {
  const language = profile.language
  const reports = typeof language === 'string' ? language : isObject(language) ? language.reports : undefined
  return reports === 'ru' ? 'ru' : 'en'
}

/**
 * `attribution` proposed: the value the Profile already names, else the default of the proposed mode —
 * `off` for Silent, `on` for Full (the rule bin/profile applies to a Profile without the field).
 */
export function proposeAttribution(profile: Json, mode: 'full' | 'silent'): 'on' | 'off' {
  if (profile.attribution === 'on' || profile.attribution === 'off') return profile.attribution
  return mode === 'silent' ? 'off' : 'on'
}

/** A Profile of schema 1 found in ~/.claude/profiles/. */
export interface LegacyProfile {
  name: string
  /** ~/.claude/profiles/<name>. */
  dir: string
  json: Json
  jsonText: string
  rules: string | null
  carried: string[]
  fields: ProfileFields
  modeReason: string
}

/** The repositories the Gate registry gives each Profile (`match` of its entries), in order. */
export function registryRepos(registryText: string | null): Map<string, string[]> {
  const out = new Map<string, string[]>()
  if (registryText === null) return out
  let parsed: unknown
  try {
    parsed = JSON.parse(registryText)
  } catch {
    return out
  }
  const repos = isObject(parsed) && Array.isArray(parsed.repos) ? parsed.repos : []
  for (const entry of repos) {
    if (!isObject(entry) || typeof entry.profile !== 'string' || typeof entry.match !== 'string') continue
    out.set(entry.profile, [...(out.get(entry.profile) ?? []), entry.match])
  }
  return out
}

/** The Profiles in <claudeHome>/profiles/: every folder with a readable profile.json object. */
export function readLegacyProfiles(
  claudeHome: string,
  registryText: string | null,
  userHome: string = homedir(),
  env: NodeJS.ProcessEnv = process.env,
): LegacyProfile[] {
  const root = join(claudeHome, 'profiles')
  if (!existsSync(root)) return []
  const repos = registryRepos(registryText)
  const out: LegacyProfile[] = []
  for (const name of readdirSync(root).sort()) {
    const dir = join(root, name)
    const jsonPath = join(dir, 'profile.json')
    if (!statSync(dir).isDirectory() || !existsSync(jsonPath)) continue
    const text = readFileSync(jsonPath, 'utf8')
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      continue
    }
    if (!isObject(json)) continue
    const rulesPath = join(dir, 'rules.md')
    const { mode, reason } = proposeMode(json, repos.get(name) ?? [], userHome, env)
    out.push({
      name,
      dir,
      json,
      jsonText: text,
      rules: existsSync(rulesPath) ? readFileSync(rulesPath, 'utf8') : null,
      carried: CARRIED.filter((folder) => existsSync(join(dir, folder))).map((folder) => `${folder}/`),
      fields: { mode, languageDocs: proposeLanguageDocs(json), attribution: proposeAttribution(json, mode) },
      modeReason: reason,
    })
  }
  return out
}
