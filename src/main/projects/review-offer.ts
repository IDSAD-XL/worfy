// The team reviewer of a Project (worfy-human-review ticket 09): the offer made after a Project is
// added, and what the "Team reviewer" section of Project settings reads and deletes.
//
// - The offer. Once "Add project" has put a folder new to the list (Connect writes its Profile, or the
//   Harness knows it already), main runs `review-history probe -C <root> --json` of the Harness on the
//   machine in the background, with GH_TOKEN of the Profile's GitHub account and a time limit. The
//   answer `voice: yes` — 30 substantive comments of the team's reviewers in the last 12 months — and
//   an offer never answered (`humanReview.offer` of the Project's settings is not `"later"`) send the
//   event the window shows as a toast. Anything else — `voice: no`, exit code 3 (no origin on GitHub,
//   no gh, no access), another exit code, the time limit, a script that did not start — sends nothing
//   and leaves one line in the log. A Project whose reviewer is built already gets no offer.
// - The private folder: <Profile folder>/state/human-review/ (`bin/profile -C <root> --dir` names the
//   Profile folder). `state/` is outside the git history of the Harness home. The reviewer is built when
//   its skill is there (.claude/skills/human-review/SKILL.md); `meta.json`, which `review-history` writes,
//   gives the counts. worfy only reads the folder (ADR-0005: the Harness's scripts and the generator skill
//   write it) and erases it on "Delete", nothing else.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { TeamReviewerState } from '../../shared/ipc/projects'
import type { HarnessLocation } from '../harness/locate'
import { scriptEnv } from '../harness/locate'
import type { HarnessScriptEnv } from '../harness/script-env'
import { removeTree } from '../storage/remove'
import { runHarnessScript, scriptFailureDetail, type ProfileRun, type ProfileRunner } from '../workflow/profile'

/** The Harness script the offer asks. */
export const REVIEW_HISTORY_SCRIPT = 'review-history'

/** How long the probe may run: it reads pages of 100 pull requests until the 30th substantive comment. */
export const PROBE_TIMEOUT_MS = 120_000

/** The substantive comments that make a voice (spec decision 4); `review-history` has the same number. */
export const VOICE_THRESHOLD = 30

/** The private folder of the team reviewer inside a Profile folder. */
export const privateFolder = (profileDir: string): string => join(profileDir, 'state', 'human-review')

/** The reviewer skill the generator writes into the private folder: its presence means "built". */
export const reviewerSkill = (folder: string): string => join(folder, '.claude', 'skills', 'human-review', 'SKILL.md')

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const count = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null)

/** meta.json of the private folder as an object; null when it is missing or does not read. */
function readMeta(folder: string): Record<string, unknown> | null {
  try {
    const meta: unknown = JSON.parse(readFileSync(join(folder, 'meta.json'), 'utf8'))
    return isRecord(meta) ? meta : null
  } catch {
    return null
  }
}

/**
 * The team reviewer of the private folder `folder`. Built: the skill is there; its date is when the
 * skill file was written, the pull requests those of meta.json's history (`counts.pull_requests`).
 * Short: no skill, and meta.json's last verdict is `voice: no (N of 30)`. None otherwise.
 */
export function readTeamReviewer(folder: string): TeamReviewerState {
  const meta = readMeta(folder)
  const counts = isRecord(meta?.counts) ? meta.counts : {}
  const skill = reviewerSkill(folder)
  if (existsSync(skill)) {
    return { status: 'built', builtAt: statSync(skill).mtime.toISOString(), pullRequests: count(counts.pull_requests) }
  }
  const voice = typeof meta?.voice === 'string' ? meta.voice : ''
  if (voice.startsWith('voice: no')) {
    const named = /\((\d+) of (\d+)\)/u.exec(voice)
    const substantive = count(counts.substantive) ?? (named ? Number(named[1]) : 0)
    const threshold = named ? Number(named[2]) : VOICE_THRESHOLD
    return { status: 'short', substantive: Math.min(substantive, threshold), threshold }
  }
  return { status: 'none' }
}

/**
 * "Delete": erases the private folder of the Profile folder `profileDir`, and nothing else: a link in
 * it is removed as a link, never followed (removeTree).
 */
export function deleteTeamReviewer(profileDir: string): void {
  if (!isAbsolute(profileDir)) throw new Error(`the Profile folder is not an absolute path: ${JSON.stringify(profileDir)}`)
  removeTree(privateFolder(profileDir))
}

/**
 * The Profile folder of the Project at `root`: `bin/profile -C <root> --dir`. Rejects with the reason
 * when the script fails or prints something that is not an absolute path.
 */
export async function readProfileDir(run: ProfileRunner, root: string): Promise<string> {
  const result = await run(root, ['-C', root, '--dir'])
  const detail = scriptFailureDetail(result.stderr)
  if (result.code === 3) throw new Error(`the folder is in no registered project (profile exit code 3${detail ? `: ${detail}` : ''})`)
  if (result.code !== 0) throw new Error(`the profile script failed with ${result.code === null ? 'no exit code' : `exit code ${result.code}`}${detail ? `: ${detail}` : ''}`)
  const dir = result.stdout.trim()
  if (dir === '' || dir.includes('\n') || !isAbsolute(dir)) throw new Error(`profile --dir printed no absolute path: ${JSON.stringify(dir.slice(0, 200))}`)
  return dir
}

/** What a probe run answered: a voice, or why there is no offer. */
export type ProbeVerdict = { voice: true } | { voice: false; reason: string }

/** The verdict of one run of `review-history probe --json`. */
export function probeVerdict(run: ProfileRun): ProbeVerdict {
  const detail = scriptFailureDetail(run.stderr)
  if (run.code === null) return { voice: false, reason: run.signal ? `the probe was ended by the signal ${run.signal}` : `the probe did not answer within ${PROBE_TIMEOUT_MS / 1000} s` }
  if (run.code === 3) return { voice: false, reason: `the probe is not available here (exit code 3${detail ? `: ${detail}` : ''})` }
  if (run.code !== 0) return { voice: false, reason: `the probe failed with exit code ${run.code}${detail ? `: ${detail}` : ''}` }
  let answer: unknown
  try {
    answer = JSON.parse(run.stdout)
  } catch {
    return { voice: false, reason: `the probe printed something that is not JSON: ${JSON.stringify(run.stdout.slice(0, 200))}` }
  }
  if (!isRecord(answer) || (answer.voice !== 'yes' && answer.voice !== 'no')) return { voice: false, reason: `the probe printed no voice: ${JSON.stringify(run.stdout.slice(0, 200))}` }
  if (answer.voice === 'yes') return { voice: true }
  return { voice: false, reason: typeof answer.line === 'string' ? answer.line : 'voice: no' }
}

/** Where the probe runs from: the app's Harness, environment and GitHub account, or a test's. */
export interface ProbeSource {
  /** The Harness on the machine, looked for on every run (src/main/harness/locate.ts). */
  harness: () => HarnessLocation
  /** The Harness scripts' environment (src/main/harness/script-env.ts): node is on its PATH. */
  env: () => Promise<HarnessScriptEnv>
  /** GH_TOKEN of the Profile's GitHub account for `root` (accountAuth of src/main/github/prs.ts); rejects when gh cannot run as it. */
  ghEnv: (root: string) => Promise<Record<string, string>>
  /** Aborted when the app quits: a probe still running is killed. */
  signal?: () => AbortSignal
  /** PROBE_TIMEOUT_MS when absent. */
  timeoutMs?: number
  /** runHarnessScript when absent. */
  run?: typeof runHarnessScript
}

/** `review-history probe -C <root> --json` of the Harness on the machine, as every Harness script starts (`node <script>`). */
export function probeRunner(source: ProbeSource): (root: string) => Promise<ProfileRun> {
  return async (root) => {
    const harness = source.harness()
    const env = scriptEnv(harness, { ...(await source.env()), ...(await source.ghEnv(root)) })
    return (source.run ?? runHarnessScript)(join(harness.binDir, REVIEW_HISTORY_SCRIPT), ['probe', '-C', root, '--json'], env, {
      timeoutMs: source.timeoutMs ?? PROBE_TIMEOUT_MS,
      signal: source.signal?.(),
    })
  }
}

export interface ReviewOfferDeps {
  /** One probe run for the Project at `root` (probeRunner). */
  probe: (root: string) => Promise<ProfileRun>
  /** The Project's answer to the offer, `humanReview.offer` of its settings. */
  answered: (projectId: string) => boolean
  /** The Profile folder of the Project at `root` (readProfileDir). */
  profileDir: (root: string) => Promise<string>
  /** Tells the windows to show the offer. */
  emit: (projectId: string) => void
  /** Where the one line about a Project without an offer goes; console.warn by default. */
  log?: (line: string) => void
}

/**
 * The offer after Project `projectId` at `root` was added: resolves with whether the event went out.
 * Never rejects: every failure is one line in the log and no event.
 */
export async function offerTeamReviewer(deps: ReviewOfferDeps, projectId: string, root: string): Promise<boolean> {
  const log = deps.log ?? ((line: string) => console.warn(line))
  const none = (reason: string): false => {
    log(`[review-offer] ${root}: no team reviewer offer, because ${reason}`)
    return false
  }
  try {
    if (deps.answered(projectId)) return none('the offer was answered with "Later" before')
    let folder: string | null = null
    try {
      folder = privateFolder(await deps.profileDir(root))
    } catch {
      // No Profile folder: the probe below answers for the Project.
    }
    if (folder !== null && existsSync(reviewerSkill(folder))) return none('the team reviewer is built already')
    const verdict = probeVerdict(await deps.probe(root))
    if (!verdict.voice) return none(verdict.reason)
    deps.emit(projectId)
    return true
  } catch (error) {
    return none(error instanceof Error ? error.message : String(error))
  }
}
