// An Integration (CONTEXT.md, Integration; ADR-0111): one connected account of one service under a label —
// «Jira — client A». It belongs to the Machine and is enabled per Project (owner's answer Q2): the Machine keeps
// the list in `<WORFY_DATA_DIR>/integrations/integrations.json`, a Project keeps which of them it uses in
// `<Project data folder>/settings.json`. Nothing here holds a secret: the tokens, the OAuth client and the secret
// variables of a stdio server live in the secret store of src/main/integrations/store.ts (Q3), under the keys
// `<id>:access`, `<id>:refresh`, `<id>:client` and `<id>:env:<NAME>`.
import { z } from 'zod'

/** How worfy signs in to the service. `none` — the server needs no sign-in (a custom server on this Machine). */
export const INTEGRATION_AUTH = ['oauth', 'bearer', 'basic', 'header', 'none'] as const
export const integrationAuthSchema = z.enum(INTEGRATION_AUTH)
export type IntegrationAuth = z.output<typeof integrationAuthSchema>

/**
 * The id of an Integration: random, made by the Machine's store. Lowercase letters, digits and `-`, so it can
 * stand before `:` in a key of the secret store and in an Electron partition name.
 */
export const integrationIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{3,63}$/u, 'an Integration id is lowercase letters, digits and -')

/** What the user calls the account: «Jira — client A». Unique on the Machine, compared without case. */
export const integrationLabelSchema = z.string().trim().min(1).max(80)

/** The name of an environment variable of a stdio server. */
export const envNameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/u, 'an environment variable name')

/** An address worfy connects to: http or https; the catalogue's own rows are all https. */
const serverUrlSchema = z.url({ protocol: /^https?$/u })

/** How worfy reaches the service: a remote server over streamable HTTP, or a process worfy starts itself. */
export const integrationTransportSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('http'), url: serverUrlSchema }),
  z.object({
    kind: z.literal('stdio'),
    command: z.string().min(1),
    args: z.array(z.string()),
    /** The variables that are not secret, as they are. */
    env: z.record(envNameSchema, z.string()),
    /** The names of the secret variables; their values are in the secret store under `<id>:env:<NAME>`. */
    secretEnv: z.array(envNameSchema),
  }),
])
export type IntegrationTransport = z.output<typeof integrationTransportSchema>

/** What the sign-in showed, never a secret: the account, the site (an Atlassian site), and when. */
export const integrationSignInSchema = z.object({
  account: z.string().nullable(),
  site: z.string().nullable(),
  at: z.iso.datetime(),
})
export type IntegrationSignIn = z.output<typeof integrationSignInSchema>

/** An Integration of the Machine, as integrations.json keeps it and the channels show it. */
export const integrationSchema = z.object({
  id: integrationIdSchema,
  /** A key of the catalogue (src/shared/integrations/catalogue.ts), `custom` for a custom server. */
  service: z.string().min(1),
  label: integrationLabelSchema,
  transport: integrationTransportSchema,
  auth: integrationAuthSchema,
  /** The header the token goes in, for `header`; null for every other way to sign in. */
  headerName: z.string().regex(/^[A-Za-z0-9-]+$/u).nullable(),
  /** The last sign-in; null before the first one and after Sign out. */
  signIn: integrationSignInSchema.nullable(),
})
export type Integration = z.output<typeof integrationSchema>

/**
 * Where an Integration stands. `error` carries the service's own text, with no token in it; `checking` — worfy is
 * asking the service right now.
 */
export const integrationStatusSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('signed-in') }),
  z.object({ state: z.literal('needs-sign-in') }),
  z.object({ state: z.literal('error'), message: z.string() }),
  z.object({ state: z.literal('checking') }),
])
export type IntegrationStatus = z.output<typeof integrationStatusSchema>

/** The tools of an Integration a Project's Sessions get: all, those marked read-only, or the ones named. */
export const integrationToolsSchema = z.union([z.literal('all'), z.literal('read-only'), z.array(z.string().min(1))])
export type IntegrationTools = z.output<typeof integrationToolsSchema>

/** An Integration as a Project uses it, an entry of `integrations` in the Project's settings.json. */
export const projectIntegrationSchema = z.object({
  id: integrationIdSchema,
  enabled: z.boolean(),
  tools: integrationToolsSchema,
  /** «Available to Autopilot»: a Session without a person gets the Integration only with this on (Q7). */
  autopilot: z.boolean(),
})
export type ProjectIntegration = z.output<typeof projectIntegrationSchema>

/** A Project's entry for an Integration it has not touched yet: enabled, all tools, not for Autopilot. */
export function newProjectIntegration(id: string): ProjectIntegration {
  return { id, enabled: true, tools: 'all', autopilot: false }
}

/** The parts of an Integration's secret in the secret store: the key is `<id>:<part>`. */
export const integrationSecretPartSchema = z.union([z.enum(['access', 'refresh', 'client']), z.string().regex(/^env:[A-Za-z_][A-Za-z0-9_]*$/u, 'env:<NAME>')])
export type IntegrationSecretPart = 'access' | 'refresh' | 'client' | `env:${string}`
