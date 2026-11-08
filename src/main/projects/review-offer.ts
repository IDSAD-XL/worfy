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
//   its skill is there (.claude/skills/human-review/SKILL.md); `meta.json` gives its date (`kept_at` of the
//   generator, else `fetched_at` of `review-history`) and the counts. worfy only reads the folder (ADR-0005: the Harness's scripts and the generator skill
//   write it) and erases it on "Delete", nothing else.
// - The reminder (ticket 10, spec Q8 (a)). A window asks when it makes a Project active
//   (projects.reviewer.remind): the reminder is due when the reviewer is built, its date is more than
//   30 days old, and the last reminder, `humanReview.remindedAt` of the Project's settings in worfy's
//   data folder, is more than 30 days old or absent. A due reminder is recorded there before the
//   answer, so another window or the next activation gets none for 30 days. It reads the private
//   folder only: no Harness script, no GitHub, no model.
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

/** A date of meta.json as ISO, or null when the key is missing or is not a date. */
function metaDate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const at = Date.parse(value)
  return Number.isNaN(at) ? null : new Date(at).toISOString()
}

/**
 * The team reviewer of the private folder `folder`. Built: the skill is there (spec: its presence is
 * "built"). Its date is meta.json's `kept_at` — the person's "Keep" of the generator (skill
 * human-review-setup, step 7) — else `fetched_at`, the last whole read of `review-history`, and only
 * when meta.json gives neither the time the skill file was written: a restored or copied Harness home
 * makes that time "today". The pull requests are those of meta.json's history (`counts.pull_requests`),
 * or, after an update the person accepted (ticket 10), its `analysed_pull_requests`: the history's and
 * those of the updates since. An update counts only while its `analysed_through` is later than
 * `fetched_at`: a whole build after it reads the history again, and its count replaces the update's.
 * Short: no skill, and meta.json's last verdict is `voice: no (N of 30)`. None otherwise.
 */
export function readTeamReviewer(folder: string): TeamReviewerState {
  const meta = readMeta(folder)
  const counts = isRecord(meta?.counts) ? meta.counts : {}
  const skill = reviewerSkill(folder)
  if (existsSync(skill)) {
    const builtAt = metaDate(meta?.kept_at) ?? metaDate(meta?.fetched_at) ?? statSync(skill).mtime.toISOString()
    const updated = metaDate(meta?.analysed_through)
    const fetched = metaDate(meta?.fetched_at)
    const sinceUpdate = updated !== null && (fetched === null || Date.parse(updated) > Date.parse(fetched))
    const pullRequests = (sinceUpdate ? count(meta?.analysed_pull_requests) : null) ?? count(counts.pull_requests)
    return { status: 'built', builtAt, pullRequests }
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

/** How old the reviewer and the last reminder must be for the reminder to update it (spec decision 7: once a month). */
export const REFRESH_AFTER_DAYS = 30

const REFRESH_AFTER_MS = REFRESH_AFTER_DAYS * 86_400_000

/** Whether the time `at` (ms) lies more than REFRESH_AFTER_DAYS before `now`; a time after `now` (a clock set back) is not old. */
const olderThanAMonth = (at: number, now: Date): boolean => now.getTime() - at > REFRESH_AFTER_MS

/**
 * Whether the reminder to update the reviewer is due at `now`: the reviewer `state` is built and dated
 * more than 30 days before `now`, and the last reminder `remindedAt` is absent, does not read as a
 * date, or is more than 30 days old.
 */
export function refreshDue(state: TeamReviewerState, remindedAt: string | undefined, now: Date): boolean {
  if (state.status !== 'built' || !olderThanAMonth(Date.parse(state.builtAt), now)) return false
  const last = remindedAt === undefined ? Number.NaN : Date.parse(remindedAt)
  return Number.isNaN(last) || olderThanAMonth(last, now)
}

export interface ReviewReminderDeps {
  /** The Profile folder of the Project at `root` (readProfileDir). */
  profileDir: (root: string) => Promise<string>
  /** `humanReview.remindedAt` of the Project's settings. */
  remindedAt: (projectId: string) => string | undefined
  /** Records `at` as `humanReview.remindedAt` of the Project's settings. */
  remember: (projectId: string, at: Date) => void
  /** The clock; `new Date()` when absent. */
  now?: () => Date
  /** Where the one line about a Profile folder that cannot be found goes; console.warn by default. */
  log?: (line: string) => void
}

/**
 * The reminder for Project `projectId` at `root`, made active now: resolves with whether it is due,
 * and records a due one first (refreshDue). Never rejects: a Profile folder that cannot be found is
 * one line in the log and no reminder.
 */
export async function remindTeamReviewer(deps: ReviewReminderDeps, projectId: string, root: string): Promise<boolean> {
  const now = deps.now?.() ?? new Date()
  let folder: string
  try {
    folder = privateFolder(await deps.profileDir(root))
  } catch (error) {
    ;(deps.log ?? ((line: string) => console.warn(line)))(`[review-offer] ${root}: no reminder to update the team reviewer, because ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
  if (!refreshDue(readTeamReviewer(folder), deps.remindedAt(projectId), now)) return false
  deps.remember(projectId, now)
  return true
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
