// The rows of Health check for the Vendors other than Claude Code (worfy-auth-check ticket 08; the
// critic of 2026-11-18, "Alternative": the Codex row lives in a module of its own, and checks.ts only
// adds what this module answers). Claude Code's sign-in stays a row of checks.ts: it is the default
// Vendor (ADR-0094), and its row is critical.
//
// Codex sign-in, always non-critical (owner's decision Q11: a Codex Session says itself what it lacks):
// - no row in a build that cannot start Codex, nor while Codex was never run on this Machine (no
//   CODEX_HOME): a user who never chose Codex gets no yellow dot for it;
// - `ok` with the email and the plan of the ChatGPT sign-in;
// - not signed in: a warning with "Sign in to Codex…", the sign-in of Settings → Vendors
//   (codex/account.ts, startCodexLogin), which the screen starts through `vendors.startLogin`;
// - an app-server that did not start, or did not answer: `unknown`, not a failure — whether Codex is
//   signed in could not be checked.
// Reads only: the account is read on a short-lived app-server, as Settings → Vendors reads it.
import type { CodexSignIn } from '../vendors/codex/account'
import { REPORTED_ROWS } from './health-reports'
import { severityOf } from '../../shared/health/severity'
import type { Check, CheckStatus } from '../../shared/ipc/first-run'
import { redactSecrets } from '../../shared/terminal-ai/redact'

export interface VendorCheckDeps {
  /** Whether this build can start a Codex: the pinned binary, or the fake under WORFY_CODEX=fake. */
  codexInBuild: () => Promise<boolean>
  /** One read of the Codex sign-in (readCodexSignIn). */
  codexSignIn: () => Promise<CodexSignIn>
}

const messageOf = (error: unknown): string => redactSecrets(error instanceof Error ? error.message : String(error))

function codexRow(status: CheckStatus, detail: string, hint = '', actions: Check['actions'] = []): Check {
  return {
    id: 'codex-login',
    ...REPORTED_ROWS['codex-login'],
    status,
    severity: severityOf({ id: 'codex-login', status }, { githubProject: false }),
    detail,
    hint,
    command: null,
    actions,
    opensFirstRun: false,
  }
}

/** The Codex sign-in row, or null when Codex is not in this build or was never run here. Never rejects. */
export async function codexSignInRow(deps: VendorCheckDeps): Promise<Check | null> {
  let read: CodexSignIn
  try {
    if (!(await deps.codexInBuild())) return null
    read = await deps.codexSignIn()
  } catch (error) {
    return codexRow('unknown', `Couldn't check: ${messageOf(error)}`)
  }
  if (read.kind === 'no-home') return null
  if (read.kind === 'not-started') return codexRow('unknown', `Couldn't check: the Codex app-server did not start (${messageOf(read.error)})`)
  const { connection } = read
  if (!connection.signedIn) {
    return codexRow('warn', 'not signed in to Codex', 'Sign in with your ChatGPT account: Codex Sessions need it, Claude Code Sessions do not', [{ id: 'codex-sign-in', label: 'Sign in to Codex…' }])
  }
  const who = [connection.email, connection.plan].filter((part): part is string => typeof part === 'string' && part !== '')
  return codexRow('ok', who.length > 0 ? who.join(' · ') : 'signed in')
}

/** The rows of the Vendors besides Claude Code, for the local checks (runChecks, CheckDeps.vendorRows). */
export async function vendorRows(deps: VendorCheckDeps): Promise<Check[]> {
  const codex = await codexSignInRow(deps)
  return codex === null ? [] : [codex]
}

/** The app's Vendor rows: the Codex of this build, read as Settings → Vendors reads it. */
export async function appVendorRows(): Promise<Check[]> {
  const { appCodexInBuild, appCodexStarter, codexHomeOf, readCodexSignIn } = await import('../vendors/codex/account')
  return vendorRows({ codexInBuild: appCodexInBuild, codexSignIn: () => readCodexSignIn(appCodexStarter, codexHomeOf()) })
}
