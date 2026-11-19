// What the GitHub features of main tell Health check (worfy-auth-check ticket 07; spec, the solution, points 4
// and 5): the PR inbox, the PR badges, the gate queue, Flight recorder, the review offer's probe and Send of the
// drafts of replies run gh as a Project's GitHub account, and a sign-in GitHub refused there used to go to the log
// only. Now such a failure puts the Project's GitHub access row (src/main/first-run/checks.ts) out of `ok` at
// once (HealthReports.reportFailure), and the first answer of gh after it takes the row back (reportOk).
//
// - Only a refused sign-in is reported: no gh login for the account, a token GitHub does not take (HTTP 401,
//   "Bad credentials"), gh without any token ("gh auth login"), an organization's SAML enforcement. No network, a
//   timeout, GitHub's 5xx and its rate limit are not the sign-in's fault and change no row.
// - Once per failure: the same reason of a feature for a Project is reported once, so a view that asks every few
//   seconds does not start a re-check each time; the first answer after it reports the success once.
// - The reason is gh's first line with the feature's name, through redactSecrets(), as HealthReports passes it
//   again: a login, a variable's name, an organization's name — never a token.
// - A folder of no Project of this Machine reports nothing.
import { relative, isAbsolute } from 'node:path'
import type { CheckProject, FirstRunReport } from '../../shared/ipc/first-run'
import { redactSecrets } from '../../shared/terminal-ai/redact'
import { healthReports, type HealthReports } from '../first-run/health-reports'
import { projectStore } from '../projects/store'

/** gh's and accountAuth's words of a sign-in GitHub refused. */
const SIGN_IN_FAILURE = [
  // accountAuth (src/main/github/prs.ts): the Profile's account has no gh login, or gh printed no token for it.
  /\bno gh login for\b/u,
  /\bprinted no token\b/u,
  /\bno oauth token found\b/u,
  // A token GitHub does not take: invalid, revoked or expired.
  /\bBad credentials\b/iu,
  /\bHTTP 401\b/u,
  // gh has no token at all (exit 4): "To get started with GitHub CLI, please run: gh auth login".
  /\bgh auth login\b/u,
  // An organization with SAML single sign-on the token is not authorized for.
  /\bSAML\b/u,
]

/** Whether gh's reason is a sign-in GitHub refused, and not the network, a timeout or a rate limit. */
export function isSignInFailure(reason: string | null | undefined): boolean {
  if (reason == null || reason === '') return false
  return SIGN_IN_FAILURE.some((pattern) => pattern.test(reason))
}

/** What a GitHub feature tells Health check, by the folder it ran gh in. */
export interface GithubHealth {
  /** gh failed in the Project at `root`: reported when it is a refused sign-in (isSignInFailure), else nothing. */
  failed(root: string, reason: string): void
  /** The feature cannot work for a reason of the sign-in that is not gh's words (Send without `github.account`). */
  signInFailed(root: string, reason: string): void
  /** gh answered as the Project's account in `root`: the row goes back to `ok` when this feature reported it. */
  answered(root: string): void
  /** The detail of the Project's GitHub access row while it is not `ok`; null otherwise. */
  reason(root: string): string | null
}

/** Reports nothing: a feature built without Health check (most tests). */
export const NO_GITHUB_HEALTH: GithubHealth = { failed: () => undefined, signInFailed: () => undefined, answered: () => undefined, reason: () => null }

export interface GithubHealthOptions {
  /** The feature, as the reason names it ("PR inbox"). */
  feature: string
  reports: Pick<HealthReports, 'reportFailure' | 'reportOk' | 'current'>
  /** The Project of this Machine whose folder `root` is, or lies in; undefined for none. */
  project: (root: string) => CheckProject | undefined
}

/** The first line of gh's reason, without a token. */
const firstLine = (text: string): string => redactSecrets(text.trim().split(/\r?\n/u)[0]?.trim() ?? '')

/** The step of a reported row: what the user does next. */
const stepOf = (feature: string): string => `GitHub refused the sign-in of the ${feature}. Health check checks this row again: follow the fix it then names`

export function githubHealth(options: GithubHealthOptions): GithubHealth {
  /** The reason last reported for each Project, by its id. */
  const reported = new Map<string, string>()
  const report = (root: string, reason: string): void => {
    const project = options.project(root)
    if (project === undefined) return
    const text = `${options.feature}: ${firstLine(reason)}`
    if (reported.get(project.id) === text) return
    reported.set(project.id, text)
    options.reports.reportFailure('github-access', project, text, stepOf(options.feature))
  }
  return {
    failed: (root, reason) => {
      if (isSignInFailure(reason)) report(root, reason)
    },
    signInFailed: report,
    answered: (root) => {
      const project = options.project(root)
      if (project === undefined || !reported.has(project.id)) return
      reported.delete(project.id)
      options.reports.reportOk('github-access', project)
    },
    reason: (root) => {
      const project = options.project(root)
      if (project === undefined) return null
      return accessDetail(options.reports.current(), project.id)
    },
  }
}

/** The detail of the GitHub access row of Project `projectId` while it is not `ok`. */
export function accessDetail(report: FirstRunReport | null, projectId: string): string | null {
  const row = report?.checks.find((check) => check.id === 'github-access' && check.project?.id === projectId)
  return row === undefined || row.status === 'ok' || row.detail === '' ? null : row.detail
}

/** The Project of `projects` whose folder is `root` or holds it (a repository of a Project over several), the deepest first. */
export function projectOfFolder(projects: readonly { id: string; name: string; path: string }[], root: string): CheckProject | undefined {
  let found: { id: string; name: string; path: string } | undefined
  for (const project of projects) {
    const inside = relative(project.path, root)
    if (inside.startsWith('..') || isAbsolute(inside)) continue
    if (found === undefined || project.path.length > found.path.length) found = project
  }
  return found === undefined ? undefined : { id: found.id, name: found.name }
}

/** The app's reporter of a feature: the one Health check report, the Projects of this Machine. */
export function appGithubHealth(feature: string): GithubHealth {
  return githubHealth({ feature, reports: healthReports(), project: (root) => projectOfFolder(projectStore().list(), root) })
}
