// The `integrations` domain (worfy-integrations ticket 03; ADR-0111): the Integrations of this Machine and which of
// them a Project uses. Handled in src/main/ipc/integrations.ts.
//
// The marks follow where the secret goes (spec, "decided without the owner", 3): reading the list and the status is
// `project` `read` — a Linked machine with read-only access sees them, and they carry no secret; turning an
// Integration on or off in a Project, its tools filter, «Available to Autopilot» and its label are `project`
// `write` — full access only; Add integration, a secret and Remove are `local` — never open to a Linked machine, so
// no token crosses the link. The screen's own channels (worfy-integrations ticket 08) follow the same rule: the tools
// of an Integration are `project` `read`; Sign out, the Machine's whole list, its clean-up and the gh account's token
// are `local`.
import { z } from 'zod'
import {
  integrationAuthSchema,
  integrationIdSchema,
  integrationLabelSchema,
  integrationSchema,
  integrationSecretPartSchema,
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
 * enabled needs `confirmed`: without it the answer names those Projects and nothing is removed. Without `projectId`
 * (Settings → Integrations) every Project that has it enabled is another one.
 */
export const integrationsRemove = invokeChannel(
  'integrations.remove',
  z.object({ projectId: projectIdSchema.optional(), id: integrationIdSchema, confirmed: z.boolean().optional() }),
  z.discriminatedUnion('status', [z.object({ status: z.literal('removed') }), z.object({ status: z.literal('confirm'), projects: z.array(z.string()) })]),
  'local',
)

/**
 * A tool of the service as the screen counts it, never its schema: its name, whether the service marks it read-only
 * (`readOnlyHint`; null — the service says nothing), and `size` — the length of the JSON of its name, description and
 * schema, the measure of the proxy's toolsCost (src/main/integrations/proxy.ts).
 */
export const integrationToolInfoSchema = z.object({ name: z.string().min(1), readOnly: z.boolean().nullable(), size: z.number().int().nonnegative() })
export type IntegrationToolInfo = z.infer<typeof integrationToolInfoSchema>

/**
 * The Integration's tools as the service lists them now (initialize and tools/list through the proxy, the Test of the
 * screen), before the Project's filter, and the status that answer left. `tools` is null when the service gave no list;
 * `hidden` — tools a Session's server left out for their too long full name.
 */
export const integrationsTools = invokeChannel(
  'integrations.tools',
  z.object({ projectId: projectIdSchema, id: integrationIdSchema }),
  z.object({ status: integrationStatusSchema, tools: z.array(integrationToolInfoSchema).nullable(), hidden: z.array(z.string()) }),
  'project',
  'read',
)

/** Sign out: every secret of the Integration leaves the secret store, and it needs sign-in. */
export const integrationsSignOut = invokeChannel('integrations.signOut', z.object({ id: integrationIdSchema }), z.object({ status: integrationStatusSchema }), 'local')

/** An Integration of the Machine for Settings → Integrations: its status and the Projects that have an entry for it. */
export const machineIntegrationSchema = z.object({
  integration: integrationSchema,
  status: integrationStatusSchema,
  projects: z.array(z.object({ id: projectIdSchema, name: z.string(), enabled: z.boolean() })),
})
export type MachineIntegration = z.infer<typeof machineIntegrationSchema>

/**
 * Every Integration of the Machine and where it is used. `dangling` — the Projects whose settings still name an
 * Integration the Machine no longer has (a Remove cut short), with how many; integrations.cleanUp drops them. Writes nothing.
 */
export const integrationsMachine = invokeChannel(
  'integrations.machine',
  z.void(),
  z.object({ items: z.array(machineIntegrationSchema), dangling: z.array(z.object({ projectId: projectIdSchema, name: z.string(), count: z.number().int().positive() })) }),
  'local',
)

/** Drops from every Project's settings the entries of Integrations the Machine no longer has; the answer is how many. */
export const integrationsCleanUp = invokeChannel('integrations.cleanUp', z.void(), z.object({ removed: z.number().int().nonnegative() }), 'local')

/** The gh account's token offered to a GitHub Integration: the account and its scopes, never the token. */
export const ghTokenOfferSchema = z.object({ account: z.string(), scopes: z.array(z.string()).nullable(), warning: z.string() })

/** The offer of the Project's gh account's token for a GitHub Integration; null when the Project has no GitHub account. */
export const integrationsGhOffer = invokeChannel('integrations.ghOffer', z.object({ projectId: projectIdSchema }), z.object({ offer: ghTokenOfferSchema.nullable() }), 'local')

/** Signs the GitHub Integration in with a copy of the Project's gh account's token, checked like a typed one. */
export const integrationsGhSignIn = invokeChannel(
  'integrations.ghSignIn',
  z.object({ projectId: projectIdSchema, id: integrationIdSchema }),
  z.object({ status: integrationStatusSchema }),
  'local',
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
    'integrations.tools': typeof integrationsTools
    'integrations.signOut': typeof integrationsSignOut
    'integrations.machine': typeof integrationsMachine
    'integrations.cleanUp': typeof integrationsCleanUp
    'integrations.ghOffer': typeof integrationsGhOffer
    'integrations.ghSignIn': typeof integrationsGhSignIn
  }
}
