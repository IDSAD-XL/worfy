// Whether the Harness in the main branch of worfy's own repository has gone ahead of the Harness
// this build carries (worfy-harness ticket 21, ADR-0047). Autopilot over worfy runs from the Stable
// copy, which is not rebuilt during a run: a lesson merged into harness/ meanwhile reaches the run
// only after `pnpm install:stable`. worfy shows that (AutopilotState.harnessBehind) and the run
// journal says it (`harness-behind`).
//
// - The build's Harness version is `<semver>+<short SHA>[.dirty]` (scripts/build-version.ts), the
//   `version` of the plugin.json of the Harness copy Sessions get inline (src/main/harness/bundled.ts).
// - Only worfy's own repository is checked: its harness/.claude-plugin/plugin.json names the plugin
//   `worfy`, and the build commit is in it. Anything else is `unknown`, with the reason.
// - `main` is `origin/main` when the repository has it, else the local `main`. Newer means that
//   `git rev-list --count <SHA>..<main> -- harness/` is above zero.
// - Read only. No `git fetch`: it writes into the Project's .git, and worfy writes nothing into a
//   Project's repository (ADR-0005). origin/main is fresh because the Orchestrator fetches in the
//   preflight of every Wave.
// - harnessDriftWatch checks a Project at most once in HARNESS_DRIFT_INTERVAL_MS, on packaged builds
//   only: a development build runs the Harness of its own checkout.
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { HarnessBehind } from '../../shared/ipc/autopilot'
import { programStart } from '../program'

/** The Harness plugin's name in harness/.claude-plugin/plugin.json (ADR-0040). */
const PLUGIN_NAME = 'worfy'

/** The build commit in a build version: `<semver>+<short SHA>`, maybe `.dirty` after it. */
const BUILD_SHA = /^\d+\.\d+\.\d+\+([0-9a-f]{7,40})(?:\.dirty)?$/

/** The main branch, in the order looked for: the remote's as of the last fetch, then the local one. */
const MAIN_REFS = [
  { name: 'origin/main', ref: 'refs/remotes/origin/main' },
  { name: 'main', ref: 'refs/heads/main' },
] as const

/** How long a Project's answer is kept before git is asked again. */
export const HARNESS_DRIFT_INTERVAL_MS = 60_000

/** How long one git command may take. */
const GIT_TIMEOUT_MS = 10_000

/** The answer: the Harness in main is newer, by `commits`; it is not; or it cannot be told, and why. */
export type HarnessDrift =
  | { kind: 'newer'; harness: string; main: string; commits: number }
  | { kind: 'same'; harness: string; main: string }
  | { kind: 'unknown'; reason: string }

export interface HarnessDriftInput {
  /** The Project's repository root. */
  root: string
  /** The build's Harness version (bundledHarnessVersion()); undefined when the copy has none. */
  harnessVersion: string | undefined
  /** The git to run; tests pass one that logs its calls, a `.mjs` script (src/main/program.ts). */
  git?: string
}

const firstLine = (text: string): string => text.trim().split('\n')[0] ?? ''

/**
 * Runs a read-only git command in `root`; answers its stdout, or the first line of its error.
 * `override` is the git a test passes; a `.mjs` one starts as a script of worfy's own Node.
 */
function gitIn(override: string | undefined, root: string, args: string[]): Promise<{ ok: true; out: string } | { ok: false; error: string }> {
  const start = programStart(override, 'git')
  // GIT_DIR and friends of the environment worfy was started from would point git elsewhere;
  // GIT_OPTIONAL_LOCKS=0 keeps git from refreshing the index on the way.
  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  env.GIT_OPTIONAL_LOCKS = '0'
  Object.assign(env, start.env)
  return new Promise((done) => {
    execFile(start.file, [...start.args, ...args], { cwd: root, env, encoding: 'utf8', timeout: GIT_TIMEOUT_MS }, (error, stdout, stderr) => {
      if (error === null) done({ ok: true, out: stdout.trim() })
      else done({ ok: false, error: firstLine(stderr) || firstLine(error.message) })
    })
  })
}

/** Whether `<root>/harness/.claude-plugin/plugin.json` names the plugin `worfy`; else why not. */
async function worfyPlugin(root: string): Promise<string | null> {
  const path = join(root, 'harness', '.claude-plugin', 'plugin.json')
  try {
    const manifest: unknown = JSON.parse(await readFile(path, 'utf8'))
    const name = typeof manifest === 'object' && manifest !== null ? (manifest as { name?: unknown }).name : undefined
    return name === PLUGIN_NAME ? null : `${path} does not name the plugin ${PLUGIN_NAME}: not worfy's repository`
  } catch {
    return `${path} is missing or not JSON: not worfy's repository`
  }
}

/** Compares the build's Harness with harness/ in the main branch of the repository at `root`; only reads. */
export async function checkHarnessDrift(input: HarnessDriftInput): Promise<HarnessDrift> {
  const harness = input.harnessVersion
  const sha = harness === undefined ? undefined : BUILD_SHA.exec(harness)?.[1]
  if (harness === undefined || sha === undefined) {
    return { kind: 'unknown', reason: `the build's Harness version ${harness === undefined ? 'is missing' : `"${harness}" has no +<SHA>`}` }
  }
  const notWorfy = await worfyPlugin(input.root)
  if (notWorfy !== null) return { kind: 'unknown', reason: notWorfy }
  const git = (...args: string[]) => gitIn(input.git, input.root, args)
  const built = await git('cat-file', '-e', `${sha}^{commit}`)
  if (!built.ok) return { kind: 'unknown', reason: `the build commit ${sha} is not in ${input.root}: ${built.error}` }
  let main: { name: string; ref: string } | null = null
  for (const candidate of MAIN_REFS) {
    if ((await git('rev-parse', '--verify', '--quiet', `${candidate.ref}^{commit}`)).ok) {
      main = candidate
      break
    }
  }
  if (main === null) return { kind: 'unknown', reason: `${input.root} has neither origin/main nor main` }
  const counted = await git('rev-list', '--count', `${sha}..${main.ref}`, '--', 'harness/')
  if (!counted.ok) return { kind: 'unknown', reason: `cannot count the commits of ${main.name} after ${sha}: ${counted.error}` }
  const commits = Number.parseInt(counted.out, 10)
  if (!Number.isInteger(commits) || commits < 0) return { kind: 'unknown', reason: `git rev-list --count answered "${counted.out}"` }
  return commits > 0 ? { kind: 'newer', harness, main: main.name, commits } : { kind: 'same', harness, main: main.name }
}

export interface HarnessDriftWatchOptions {
  /** Whether this is a packaged build (app.isPackaged): a development build has no mark. */
  packaged: boolean
  /** The build's Harness version, read on every check (bundledHarnessVersion). */
  harnessVersion(): string | undefined
  /** The comparison (default checkHarnessDrift); tests pass their own. */
  check?(input: HarnessDriftInput): Promise<HarnessDrift>
  /** The clock of the interval, in milliseconds (default Date.now). */
  now?(): number
  /** Where the reason for no mark goes, once per Project and reason (default console.info). */
  log?(line: string): void
}

/**
 * The mark of a newer Harness in main for a Project, or null: none in a development build, none
 * when the Harness is not behind or that cannot be told. A Project is checked at most once in
 * HARNESS_DRIFT_INTERVAL_MS; calls in between, also while a check runs, get its answer.
 */
export function harnessDriftWatch(options: HarnessDriftWatchOptions): (projectId: string, root: string) => Promise<HarnessBehind | null> {
  const check = options.check ?? checkHarnessDrift
  const now = options.now ?? Date.now
  const log = options.log ?? ((line: string) => console.info(line))
  const last = new Map<string, { root: string; at: number; answer: Promise<HarnessBehind | null> }>()
  const logged = new Map<string, string>()

  const ask = async (projectId: string, root: string): Promise<HarnessBehind | null> => {
    let drift: HarnessDrift
    try {
      drift = await check({ root, harnessVersion: options.harnessVersion() })
    } catch (error) {
      drift = { kind: 'unknown', reason: error instanceof Error ? error.message : String(error) }
    }
    if (drift.kind === 'newer') return { harness: drift.harness, main: drift.main, commits: drift.commits }
    if (drift.kind === 'unknown' && logged.get(projectId) !== drift.reason) {
      logged.set(projectId, drift.reason)
      log(`[autopilot] ${projectId}: no Harness mark: ${drift.reason}`)
    }
    return null
  }

  return (projectId, root) => {
    if (!options.packaged) return Promise.resolve(null)
    const at = now()
    const known = last.get(projectId)
    if (known !== undefined && known.root === root && at - known.at < HARNESS_DRIFT_INTERVAL_MS) return known.answer
    const answer = ask(projectId, root)
    last.set(projectId, { root, at, answer })
    return answer
  }
}
