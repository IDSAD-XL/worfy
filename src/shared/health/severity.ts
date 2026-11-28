// The level of a Health check row and the worst level of a report (worfy-auth-check ticket 03; spec,
// the levels table, owner's decisions Q2 and Q3). One table for every row of the Epic:
// the Tickets of the rows (05, 06, 08) read it and do not change it. Pure: main sets `severity` on
// each row with severityOf(), the Health check icon (ticket 04) colours itself with worstLevel().
import type { Check, CheckId, CheckStatus, Severity } from '../ipc/first-run'

/** `github`: critical when a Project of this Machine has its origin on GitHub, else non-critical. */
type Level = Severity | 'github'

const LEVELS: Record<CheckId, Level> = {
  // Without them there is no Session and no Harness script.
  'claude-login': 'critical',
  git: 'critical',
  node: 'critical',
  harness: 'critical',
  'harness-scripts': 'critical',
  // Windows: no Bash for the agent and no environment without them (ADR-0057).
  'git-bash': 'critical',
  powershell: 'critical',
  // The Demo project works without GitHub.
  gh: 'github',
  'gh-auth': 'github',
  // No PR, no push, no PR inbox; except the token from the environment alone (severityOf).
  'github-access': 'critical',
  'claude-version': 'non-critical',
  limits: 'non-critical',
  windows: 'non-critical',
  arch: 'non-critical',
  jq: 'non-critical',
  // Only a warning (onboarding's decision, docs/features/onboarding.md).
  'git-identity': 'non-critical',
  'worfy-update': 'non-critical',
  'legacy-harness': 'non-critical',
  'harness-dependencies': 'non-critical',
  // Whether the Harness hooks hold on a Claude Code version (worfy-harness-guarantees ticket 09): a warning of what
  // the guard and the gate may miss there, not a stop of the work.
  'harness-claude': 'non-critical',
  'harness-claude-terminal': 'non-critical',
  // Search falls back to grep.
  qmd: 'non-critical',
  'qmd-models': 'non-critical',
  'qmd-collections': 'non-critical',
  // Claude Code is the default Vendor (ADR-0094); a Codex Session says so itself (Q11).
  'codex-login': 'non-critical',
  // One check of an agent degrades.
  'browser-profile': 'non-critical',
  // One Linked machine is gone.
  'linked-machine': 'non-critical',
  // One account of one service: its tools answer «Sign-in needed», every other Session works (worfy-integrations ticket 09).
  integration: 'non-critical',
}

/** What a row's level depends on besides its id and status. */
export interface SeverityFacts {
  /** A Project of this Machine has its origin on GitHub: `gh` and `gh-auth` are critical then. */
  githubProject: boolean
  /**
   * GitHub access only: the Profile's `github.account` is empty and the token from the environment
   * works — it works, but on somebody else's variable, so non-critical.
   */
  environmentTokenOnly?: boolean
}

/** The level of a row; `unknown` (it could not be checked) is never critical (Q2). */
export function severityOf(row: { id: CheckId; status: CheckStatus }, facts: SeverityFacts): Severity {
  if (row.status === 'unknown') return 'non-critical'
  if (row.id === 'github-access' && facts.environmentTokenOnly === true) return 'non-critical'
  const level = LEVELS[row.id]
  if (level === 'github') return facts.githubProject ? 'critical' : 'non-critical'
  return level
}

/**
 * The colour of the Health check icon (Q3): `critical` — a critical row is not `ok`; `non-critical` —
 * only non-critical rows are not `ok`; `ok` — every row is; `pending` — no report yet, or "Check
 * again" runs. An `unknown` row never makes it critical, whatever its `severity` says.
 */
export type HealthLevel = 'critical' | 'non-critical' | 'ok' | 'pending'

export function worstLevel(report: { readonly checks: readonly Pick<Check, 'status' | 'severity'>[] } | null, checking = false): HealthLevel {
  if (report === null || checking) return 'pending'
  const open = report.checks.filter((check) => check.status !== 'ok')
  if (open.some((check) => check.status !== 'unknown' && check.severity === 'critical')) return 'critical'
  return open.length > 0 ? 'non-critical' : 'ok'
}
