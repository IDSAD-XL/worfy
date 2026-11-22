// The Health check rows of the Integrations (worfy-integrations ticket 09; spec, implementation decisions, Health
// check; ADR-0109). The proxy (proxy.ts) tells each change of an Integration's status; here it becomes a row `integration`
// of each Project of this Machine that has the Integration enabled: non-critical (src/shared/health/severity.ts),
// «Jira — client A: sign-in needed» or «Jira — client A: <the service's text>», under the row's subject — the
// Integration — so two Integrations of one Project are two rows. An Integration that signs in with OAuth gets Sign in
// (`integration-sign-in`, the renderer's integrations.signIn: only a person presses it); one that signs in with a token
// is told where to put a new one. Signed in again, or its status forgotten after a new sign-in, every row of it goes
// back to ok. The reason passes redactSecrets in the report (src/main/first-run/health-reports.ts); the proxy's texts
// have passed scrubServiceText already.
import type { IntegrationStatus } from '../../shared/integrations/types'
import type { CheckProject } from '../../shared/ipc/first-run'
import type { HealthReports } from '../first-run/health-reports'
import { readProjectIntegrations } from '../projects/settings'
import type { SecretSource } from './auth/tokens'

/** What a Session is told for a token Integration whose sign-in the service refused, and what the row says to do. */
export const TOKEN_STEP = 'Put in a new token in Project settings → Integrations: a Session never signs in itself.'
/** The step of an OAuth Integration's row. */
export const OAUTH_STEP = 'Sign in again: worfy opens the service’s sign-in window. Autopilot never signs in itself.'

/** The Projects of this Machine, as the rows need them. */
export interface HealthProjects {
  list(): readonly CheckProject[]
  dataDir(id: string): string
}

export interface IntegrationHealthOptions {
  reports: Pick<HealthReports, 'reportFailure' | 'reportOk'>
  store: Pick<SecretSource, 'get'>
  projects: () => HealthProjects
}

/** Whether Project `projectId` has Integration `id` on; a settings file that does not read counts as off. */
function enabledIn(projects: HealthProjects, projectId: string, id: string): boolean {
  try {
    return readProjectIntegrations(projects.dataDir(projectId)).some((entry) => entry.id === id && entry.enabled)
  } catch {
    return false
  }
}

/** The listener of the proxy's statuses (IntegrationProxyOptions.onStatus) that keeps the rows. */
export function integrationHealth(options: IntegrationHealthOptions): (id: string, status: IntegrationStatus | null) => void {
  return (id, status) => {
    const integration = options.store.get(id)
    const subject = { id, label: integration?.label ?? id }
    const projects = options.projects()
    const all = projects.list()
    if (status === null || status.state === 'signed-in' || status.state === 'checking' || integration === undefined) {
      for (const project of all) options.reports.reportOk('integration', { id: project.id, name: project.name }, subject)
      return
    }
    const reason = status.state === 'needs-sign-in' ? `${integration.label}: sign-in needed` : `${integration.label}: ${status.message}`
    const oauth = integration.auth === 'oauth'
    const actions = oauth ? [{ id: 'integration-sign-in' as const, label: 'Sign in', integration: id }] : []
    for (const project of all) {
      const where = { id: project.id, name: project.name }
      if (enabledIn(projects, project.id, id)) options.reports.reportFailure('integration', where, reason, oauth ? OAUTH_STEP : TOKEN_STEP, actions, subject)
      else options.reports.reportOk('integration', where, subject)
    }
  }
}
