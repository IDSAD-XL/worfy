// Handlers of the `integrations` domain (src/shared/ipc/integrations.ts; worfy-integrations ticket 03, ADR-0111).
// The Machine's list and secrets are the IntegrationStore's (src/main/integrations/store.ts); which Integrations a
// Project uses is its settings.json (src/main/projects/settings.ts). Nothing else is written: not the Profile, not
// the repository, not `~/.claude.json`, `.mcp.json` or `config.toml`.
//
// The status here is what worfy knows without asking the service again: an Integration without every secret its way
// to sign in needs is `needs-sign-in`; one that signs in with a token over http is `signed-in` only after the
// service's `initialize` let that token in (ticket 04, src/main/integrations/auth/tokens.ts), and `error` with the
// service's text when the last check said so; any other is `signed-in` with its secrets kept. `integrations.setSecret`
// runs that check and answers the status, never the secret. The proxy (ticket 06) adds `checking`. Removing an
// Integration closes the proxy's connection to its service, and the app's quit closes every one (ticket 06), so no
// stdio server worfy started outlives them.
import type { Integration, IntegrationSecretPart, IntegrationStatus, ProjectIntegration } from '../../shared/integrations/types'
import { newProjectIntegration } from '../../shared/integrations/types'
import {
  integrationsAdd,
  integrationsList,
  integrationsRemove,
  integrationsRename,
  integrationsSetAutopilot,
  integrationsSetEnabled,
  integrationsSetSecret,
  integrationsSetTools,
  integrationsStatus,
} from '../../shared/ipc/integrations'
import { app } from 'electron'
import { checkSignIn, checksToken, isCurrentToken, verifyTokenSignIn, type SignInCheck } from '../integrations/auth/tokens'
import { closeIntegrationConnections } from '../integrations/proxy'
import { integrationStore, type IntegrationStore } from '../integrations/store'
import { readProjectIntegrations, writeProjectIntegrations } from '../projects/settings'
import { projectStore } from '../projects/store'
import { defineHandler, type HandlerModule } from './index'

/** The Projects of this Machine, as the handlers need them; ProjectStore is one. */
export interface IntegrationProjects {
  list(): readonly { readonly id: string; readonly name: string }[]
  dataDir(id: string): string
}

export interface IntegrationsHandlersOptions {
  /** The Machine's store; integrationStore() when absent. */
  store?: () => IntegrationStore
  /** The Projects; the app's ProjectStore when absent. */
  projects?: IntegrationProjects
  /** The check of a token with the service's `initialize`; checkSignIn when absent. */
  check?: SignInCheck
  /** Closes the proxy's connection of an Integration, or every one with no id; closeIntegrationConnections when absent. */
  closeConnections?: (id?: string) => Promise<void>
  /** Where the handlers learn that the app quits; none when absent (the module's default export: will-quit). */
  onQuit?: (listener: () => void) => void
}

/** The secrets an Integration needs before it can be used: its token, and every secret variable of a stdio server. */
function neededSecrets(integration: Integration): IntegrationSecretPart[] {
  const token: IntegrationSecretPart[] = integration.auth === 'none' ? [] : ['access']
  const env = integration.transport.kind === 'stdio' ? integration.transport.secretEnv.map((name): IntegrationSecretPart => `env:${name}`) : []
  return [...token, ...env]
}

/** `errors` — the text of the last check of each Integration whose check failed with something other than 401. */
function statusOf(store: IntegrationStore, integration: Integration, errors: ReadonlyMap<string, string>): IntegrationStatus {
  if (!neededSecrets(integration).every((part) => store.hasSecret(integration.id, part))) return { state: 'needs-sign-in' }
  const error = errors.get(integration.id)
  if (error !== undefined) return { state: 'error', message: error }
  if (checksToken(integration) && integration.signIn === null) return { state: 'needs-sign-in' }
  return { state: 'signed-in' }
}

export function integrationsHandlers(options: IntegrationsHandlersOptions = {}): HandlerModule {
  const store = options.store ?? integrationStore
  const check = options.check ?? ((integration, headers) => checkSignIn(integration, headers))
  // shortcut: in memory, so an error status is gone after a restart: an Integration whose new token was not checked
  // (no answer, 429, 5xx) or was refused shows needs-sign-in, one whose same token could not be re-checked shows
  // signed-in; keep the error in integrations.json if the proxy (ticket 06) needs it across restarts.
  const errors = new Map<string, string>()
  const closeConnections = options.closeConnections ?? closeIntegrationConnections
  const closeQuietly = (id?: string): void => {
    void closeConnections(id).catch((error: unknown) => console.warn('[integrations] closing a connection failed', error instanceof Error ? error.name : 'an error'))
  }
  options.onQuit?.(() => closeQuietly())
  // Looked up on each call: the module's default export is made when main loads it.
  const projectsOf = (): IntegrationProjects => options.projects ?? projectStore()

  /** The data folder of a Project of this Machine; an unknown id throws. */
  const dataDirOf = (projectId: string): string => {
    const projects = projectsOf()
    if (!projects.list().some((project) => project.id === projectId)) throw new Error(`No Project with id ${projectId}`)
    return projects.dataDir(projectId)
  }

  /** An Integration of the Machine; an unknown id throws. */
  const integrationOf = (id: string): Integration => {
    const integration = store().get(id)
    if (integration === undefined) throw new Error(`no Integration ${id} on this Machine`)
    return integration
  }

  /** Changes the Project's entry for Integration `id`, made with the defaults when the Project has none yet. */
  const changeEntry = (projectId: string, id: string, change: (entry: ProjectIntegration) => ProjectIntegration): { project: ProjectIntegration } => {
    integrationOf(id)
    const dataDir = dataDirOf(projectId)
    const entries = readProjectIntegrations(dataDir)
    const current = entries.find((entry) => entry.id === id)
    const next = change(current ?? newProjectIntegration(id))
    writeProjectIntegrations(dataDir, current === undefined ? [...entries, next] : entries.map((entry) => (entry.id === id ? next : entry)))
    return { project: next }
  }

  return [
    defineHandler(integrationsList, ({ projectId }) => {
      const entries = readProjectIntegrations(dataDirOf(projectId))
      return { items: store().list().map((integration) => ({ integration, project: entries.find((entry) => entry.id === integration.id) ?? null })) }
    }),
    defineHandler(integrationsStatus, ({ projectId }) => {
      const machine = store()
      const used = readProjectIntegrations(dataDirOf(projectId))
      const statuses = machine
        .list()
        .filter((integration) => used.some((entry) => entry.id === integration.id))
        .map((integration) => ({ id: integration.id, status: statusOf(machine, integration, errors) }))
      return { statuses }
    }),
    defineHandler(integrationsSetEnabled, ({ projectId, id, enabled }) => changeEntry(projectId, id, (entry) => ({ ...entry, enabled }))),
    defineHandler(integrationsSetTools, ({ projectId, id, tools }) => changeEntry(projectId, id, (entry) => ({ ...entry, tools }))),
    defineHandler(integrationsSetAutopilot, ({ projectId, id, autopilot }) => changeEntry(projectId, id, (entry) => ({ ...entry, autopilot }))),
    defineHandler(integrationsRename, ({ projectId, id, label }) => {
      dataDirOf(projectId)
      return { integration: store().rename(id, label) }
    }),
    defineHandler(integrationsAdd, ({ projectId, service, label, auth, transport, headerName }) => {
      const dataDir = dataDirOf(projectId)
      const integration = store().add({ service, label, auth, ...(transport === undefined ? {} : { transport }), ...(headerName === undefined ? {} : { headerName }) })
      const project = newProjectIntegration(integration.id)
      writeProjectIntegrations(dataDir, [...readProjectIntegrations(dataDir).filter((entry) => entry.id !== integration.id), project])
      return { integration, project }
    }),
    defineHandler(integrationsSetSecret, async ({ id, part, value }) => {
      const machine = store()
      const changed = machine.secret(id, part as IntegrationSecretPart) !== value
      machine.setSecret(id, part as IntegrationSecretPart, value)
      const integration = integrationOf(id)
      if (part !== 'access' || !checksToken(integration)) return { status: statusOf(machine, integration, errors) }
      errors.delete(id)
      const status = await verifyTokenSignIn(machine, id, { check, changed })
      // A token replaced or signed out while the service answered: its error is not the Integration's any more.
      if (status.state === 'error' && isCurrentToken(machine, id, value)) errors.set(id, status.message)
      return { status }
    }),
    defineHandler(integrationsRemove, ({ projectId, id, confirmed }) => {
      dataDirOf(projectId)
      integrationOf(id)
      const projects = projectsOf()
      const others = projects.list().filter((project) => project.id !== projectId)
      const using = others.filter((project) => readProjectIntegrations(projects.dataDir(project.id)).some((entry) => entry.id === id && entry.enabled))
      if (using.length > 0 && confirmed !== true) return { status: 'confirm' as const, projects: using.map((project) => project.name) }
      store().remove(id)
      errors.delete(id)
      closeQuietly(id)
      for (const project of projects.list()) {
        const dataDir = projects.dataDir(project.id)
        const entries = readProjectIntegrations(dataDir)
        if (entries.some((entry) => entry.id === id)) writeProjectIntegrations(dataDir, entries.filter((entry) => entry.id !== id))
      }
      return { status: 'removed' as const }
    }),
  ]
}

export default integrationsHandlers({ onQuit: (listener) => app.on('will-quit', listener) })
