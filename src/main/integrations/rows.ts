// The rows of a running Session's Integrations in the chip «MCP n/m» (worfy-integrations ticket 09), the same for the
// Claude driver (vendors/claude/mcp.ts) and the Codex one (vendors/codex/mcp.ts). An Integration's row says what the
// proxy found: a sign-in the service refused is `needs-auth` with «Sign-in needed: <label>…», offering worfy's own Sign
// in (the sign-in window, integrations.signIn) to a person for an Integration that signs in with OAuth — never the
// Vendor's sign-in, and never to Autopilot. An Integration the Project turned on while a Session a person is at runs is a
// row «not started» whose Restart, with the same conversation, gives it to the Session; an unattended Session's set is
// fixed for the Wave (worfy-mcp-live Q6). The facts come from integrationRowFacts (proxy.ts).
import type { McpServerAction, McpServerRow } from '../../shared/agent/mcp-status'
import type { SessionIntegrationName } from './proxy'

/** What the rows of a running Session's Integrations read each time they are asked, for Claude and Codex alike. */
export interface IntegrationRowFacts {
  /** «Sign-in needed: <label>…» while the proxy finds Integration `id`'s sign-in refused; null otherwise. */
  signInError(id: string): string | null
  /** Whether Integration `id` signs in with OAuth: its Sign in is worfy's own window (integrations.signIn). */
  oauth(id: string): boolean
  /** The Integrations a Session of the Project a person is at would get now (sessionIntegrationNames). */
  current(): readonly SessionIntegrationName[]
}

/** The error of an Integration's row «not started»: the Project turned it on after the Session started. */
export const INTEGRATION_JOINED = 'Enabled in this Project after this Session started.'

/** The fields every row of an Integration's server has: its source, label and id. */
function integrationFields(label: string, id: string): Pick<McpServerRow, 'source' | 'sourceWord' | 'label' | 'integrationId'> {
  return { source: 'integration', sourceWord: null, label, integrationId: id }
}

/**
 * The row of an Integration's server over the row the Vendor gave: the source `integration`, the label and the id;
 * with the proxy finding its sign-in refused, `needs-auth` with that text — unless the Vendor has not started the
 * server or turned it off — offering worfy's own Sign in to a person, for an Integration that signs in with OAuth.
 * `vendorActions` — what the Vendor's driver offers for the row otherwise.
 */
export function integrationRow(row: McpServerRow, own: { id: string; label: string }, facts: IntegrationRowFacts, attended: boolean, vendorActions: (row: McpServerRow) => McpServerAction[]): McpServerRow {
  const refused = facts.signInError(own.id)
  const fields = integrationFields(own.label, own.id)
  if (refused !== null && row.status !== 'pending' && row.status !== 'disabled') {
    const needs = { ...row, ...fields, status: 'needs-auth' as const, tools: null, error: refused }
    return { ...needs, actions: [...(attended && facts.oauth(own.id) ? (['sign-in'] as const) : []), ...vendorActions(needs).filter((action) => action !== 'sign-in')] }
  }
  const labelled = { ...row, ...fields }
  return { ...labelled, actions: vendorActions(labelled).filter((action) => action !== 'sign-in') }
}

/**
 * The rows «not started» of the Integrations the Project turned on since the Session started, for a Session a person
 * is at: each offers Restart, with the same conversation, which gives it to the Session. None for an unattended
 * Session, whose set is fixed for the Wave. `have` — the server names and the Integration ids the Session has.
 */
export function joinedIntegrationRows(facts: IntegrationRowFacts, have: { names: ReadonlySet<string>; ids: ReadonlySet<string> }, attended: boolean): McpServerRow[] {
  if (!attended) return []
  return facts
    .current()
    .filter((each) => !have.ids.has(each.id) && !have.names.has(each.name))
    .map((each) => ({ name: each.name, status: 'not-started', tools: null, error: INTEGRATION_JOINED, ...integrationFields(each.label, each.id), actions: ['restart'] }))
}

