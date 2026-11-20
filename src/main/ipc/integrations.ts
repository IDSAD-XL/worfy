// Handlers of the `integrations` domain (src/shared/ipc/integrations.ts; worfy-integrations ticket 03, ADR-0111).
// The Machine's list and secrets are the IntegrationStore's (src/main/integrations/store.ts); which Integrations a
// Project uses is its settings.json (src/main/projects/settings.ts). Nothing else is written: not the Profile, not
// the repository, not `~/.claude.json`, `.mcp.json` or `config.toml`.
//
// The status here is what worfy knows without asking the service: an Integration with every secret its way to sign
// in needs is `signed-in`, one without is `needs-sign-in`. The proxy (ticket 06) adds `error` and `checking`.
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
}

/** The secrets an Integration needs before it can be used: its token, and every secret variable of a stdio server. */
function neededSecrets(integration: Integration): IntegrationSecretPart[] {
  const token: IntegrationSecretPart[] = integration.auth === 'none' ? [] : ['access']
  const env = integration.transport.kind === 'stdio' ? integration.transport.secretEnv.map((name): IntegrationSecretPart => `env:${name}`) : []
  return [...token, ...env]
}

function statusOf(store: IntegrationStore, integration: Integration): IntegrationStatus {
  return neededSecrets(integration).every((part) => store.hasSecret(integration.id, part)) ? { state: 'signed-in' } : { state: 'needs-sign-in' }
}

export function integrationsHandlers(options: IntegrationsHandlersOptions = {}): HandlerModule {
  const store = options.store ?? integrationStore
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
        .map((integration) => ({ id: integration.id, status: statusOf(machine, integration) }))
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
    defineHandler(integrationsSetSecret, ({ id, part, value }) => {
      const machine = store()
      machine.setSecret(id, part as IntegrationSecretPart, value)
      return { status: statusOf(machine, integrationOf(id)) }
    }),
    defineHandler(integrationsRemove, ({ projectId, id, confirmed }) => {
      dataDirOf(projectId)
      integrationOf(id)
      const projects = projectsOf()
      const others = projects.list().filter((project) => project.id !== projectId)
      const using = others.filter((project) => readProjectIntegrations(projects.dataDir(project.id)).some((entry) => entry.id === id && entry.enabled))
      if (using.length > 0 && confirmed !== true) return { status: 'confirm' as const, projects: using.map((project) => project.name) }
      store().remove(id)
      for (const project of projects.list()) {
        const dataDir = projects.dataDir(project.id)
        const entries = readProjectIntegrations(dataDir)
        if (entries.some((entry) => entry.id === id)) writeProjectIntegrations(dataDir, entries.filter((entry) => entry.id !== id))
      }
      return { status: 'removed' as const }
    }),
  ]
}

export default integrationsHandlers()
