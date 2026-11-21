// The `integrations` domain (worfy-integrations ticket 03; ADR-0111): the Integrations of this Machine and which of
// them a Project uses. Handled in src/main/ipc/integrations.ts.
//
// The marks follow where the secret goes (spec, "decided without the owner", 3): reading the list and the status is
// `project` `read` — a Linked machine with read-only access sees them, and they carry no secret; turning an
// Integration on or off in a Project, its tools filter, «Available to Autopilot» and its label are `project`
// `write` — full access only, and so is Sign in with OAuth (ticket 05): its window opens on the Machine of the Project
// and its answer carries no token; Add integration, a secret and Remove are `local` — never open to a Linked machine,
// so no token crosses the link.
import { z } from 'zod'
import {
  integrationAuthSchema,
  integrationIdSchema,
  integrationLabelSchema,
  integrationSchema,
  integrationSecretPartSchema,
  integrationSignInSchema,
  integrationStatusSchema,
  integrationToolsSchema,
  integrationTransportSchema,
  projectIntegrationSchema,
} from '../integrations/types'
import { invokeChannel } from './channels'

const projectIdSchema = z.string().min(1)

/** An Integration of the Machine and how the Project uses it; `project` is null for one the Project never enabled. */
export const integrationListItemSchema = z.object({ integration: integrationSchema, project: projectIntegrationSchema.nullable() })
export type IntegrationListItem = z.infer<typeof integrationListItemSchema>

/** Every Integration of the Machine, with the Project's entry for each. Writes nothing. */
export const integrationsList = invokeChannel(
  'integrations.list',
  z.object({ projectId: projectIdSchema }),
  z.object({ items: z.array(integrationListItemSchema) }),
  'project',
  'read',
)

/** Where each Integration the Project uses stands. Writes nothing. */
export const integrationsStatus = invokeChannel(
  'integrations.status',
  z.object({ projectId: projectIdSchema }),
  z.object({ statuses: z.array(z.object({ id: integrationIdSchema, status: integrationStatusSchema })) }),
  'project',
  'read',
)

/** The Project's entry after a change. */
const projectEntryOutput = z.object({ project: projectIntegrationSchema })

/** Turns an Integration of the Machine on or off in the Project: the tick in Integrations. */
export const integrationsSetEnabled = invokeChannel(
  'integrations.setEnabled',
  z.object({ projectId: projectIdSchema, id: integrationIdSchema, enabled: z.boolean() }),
  projectEntryOutput,
  'project',
  'write',
)

/** The tools of the Integration the Project's Sessions get: All, Read only, or the ones named. */
export const integrationsSetTools = invokeChannel(
  'integrations.setTools',
  z.object({ projectId: projectIdSchema, id: integrationIdSchema, tools: integrationToolsSchema }),
  projectEntryOutput,
  'project',
  'write',
)

/** «Available to Autopilot» of the Integration in the Project. */
export const integrationsSetAutopilot = invokeChannel(
  'integrations.setAutopilot',
  z.object({ projectId: projectIdSchema, id: integrationIdSchema, autopilot: z.boolean() }),
  projectEntryOutput,
  'project',
  'write',
)

/** A new label for the Integration, on the whole Machine; one another Integration has is refused. */
export const integrationsRename = invokeChannel(
  'integrations.rename',
  z.object({ projectId: projectIdSchema, id: integrationIdSchema, label: integrationLabelSchema }),
  z.object({ integration: integrationSchema }),
  'project',
  'write',
)

/** Add integration: a new Integration of the Machine, enabled in the Project it was added from. */
export const integrationsAdd = invokeChannel(
  'integrations.add',
  z.object({
    projectId: projectIdSchema,
    /** A key of the catalogue, `custom` for a custom server. */
    service: z.string().min(1),
    label: integrationLabelSchema,
    auth: integrationAuthSchema,
    /** The custom server's address or command; a catalogue service has its own. */
    transport: integrationTransportSchema.optional(),
    headerName: z.string().optional(),
  }),
  z.object({ integration: integrationSchema, project: projectIntegrationSchema }),
  'local',
)

/** Keeps a token, the OAuth client or a secret variable of the Integration; the answer is its status. */
export const integrationsSetSecret = invokeChannel(
  'integrations.setSecret',
  z.object({ id: integrationIdSchema, part: integrationSecretPartSchema, value: z.string().min(1) }),
  z.object({ status: integrationStatusSchema }),
  'local',
)

/**
 * Removes the Integration from the Machine, with its secrets, and from every Project. One another Project has
 * enabled needs `confirmed`: without it the answer names those Projects and nothing is removed.
 */
export const integrationsRemove = invokeChannel(
  'integrations.remove',
  z.object({ projectId: projectIdSchema, id: integrationIdSchema, confirmed: z.boolean().optional() }),
  z.discriminatedUnion('status', [z.object({ status: z.literal('removed') }), z.object({ status: z.literal('confirm'), projects: z.array(z.string()) })]),
  'local',
)

/**
 * Sign in with OAuth (ticket 05): the window of the service's sign-in, or the system browser for single sign-on and
 * passkeys (`via: 'browser'`), on this Machine. Answers when the person has signed in — up to 10 minutes — with what
 * the sign-in shows, never a token. Only a person starts it: an unattended Session never calls it (ticket 09).
 */
export const integrationsSignIn = invokeChannel(
  'integrations.signIn',
  z.object({ projectId: projectIdSchema, id: integrationIdSchema, via: z.enum(['window', 'browser']).optional() }),
  z.object({ signIn: integrationSignInSchema }),
  'project',
  'write',
)

declare module './channels' {
  interface IpcContract {
    'integrations.list': typeof integrationsList
    'integrations.status': typeof integrationsStatus
    'integrations.setEnabled': typeof integrationsSetEnabled
    'integrations.setTools': typeof integrationsSetTools
    'integrations.setAutopilot': typeof integrationsSetAutopilot
    'integrations.rename': typeof integrationsRename
    'integrations.add': typeof integrationsAdd
    'integrations.setSecret': typeof integrationsSetSecret
    'integrations.remove': typeof integrationsRemove
    'integrations.signIn': typeof integrationsSignIn
  }
}
