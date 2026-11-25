// A check of an outside source (worfy-assistant ticket 11; spec, the section on checking sources through claude.ai
// connectors): the run the scheduler of checks starts (src/main/assistant/schedule/scheduler.ts) for one kind, over the
// recipe of its source (Slack — ticket 12, Jira — ticket 13).
//
// One run: the user's claude.ai connector of the source, found in the list of MCP servers Claude Code gives
// (listConnectors, no model call); one call of Haiku 5.5 with its read tools only (askConnector, on Claude Code); the
// answer's form checked here (src/shared/assistant/source-items.ts); each item into the attention core as an event of
// its source, with its author, link and the rest as data (seam A); the call into the usage ledger
// (src/main/assistant/budget/ledger.ts) whenever it reached the model. What fails the form becomes no item and is
// written to the journal — main's log until the Assistant's journal (ticket 08) exists — by its fields, never by the
// text a source wrote. The Assistant's Session still sees only the tools of `worfy-app`: the items reach it as data.
//
// A run that could not read its source — no connector, one waiting for a sign-in in claude.ai, a call refused or
// without an answer, an answer outside the form — throws, so the scheduler keeps `since` at the last success and the
// next run covers the same time again. An answer at its cap (SOURCE_ITEMS_MAX) covers the time only up to its newest
// item, and the run says so (CheckRunResult), so the next run asks from there. A usage ledger that cannot be written
// costs a log line, not the items of a paid answer.
import type { AttentionEvent } from '../../../shared/assistant/attention'
import type { CheckKind } from '../../../shared/assistant/schedule/settings'
import { SOURCE_ITEMS_MAX, sourceAnswerJsonSchema, sourceItemsOf, type SourceItem } from '../../../shared/assistant/source-items'
import { readToolsOf, type Connector, type ConnectorCallEnd, type ConnectorCallSpec } from '../../vendors/claude/connector-check'
import type { AssistantUsageLedger } from '../budget/ledger'
import type { AttentionCore } from '../core/attention-core'
import type { CheckRun, CheckRunResult } from '../schedule/scheduler'

/** How far back the first check of a kind reads, when no run has succeeded yet: a day. Decided without the owner. */
export const FIRST_CHECK_LOOKBACK_MS = 24 * 60 * 60_000

/** What a source's check asks its call (tickets 12 and 13 write one per source). */
export interface ConnectorRecipe {
  kind: CheckKind
  /** Whether the claude.ai connector named `name` (`claude.ai Slack`) is this source's. */
  isConnector(name: string): boolean
  /** The connector's read tools the call may use; a tool the connector marks as writing is left out anyway. */
  readTools: readonly string[]
  /** What to look for since `since` (ms since the epoch): the first part of the call's message. */
  task(input: { since: number; now: number }): string
  /**
   * Whether an item that passed the form reaches the attention core; every item when absent. An item left out still
   * counts as read: the time the answer covers does not change (ticket 12: Slack shows only what concerns the user).
   */
  keeps?(item: SourceItem): boolean
}

export interface SourceCheckDeps {
  /** The user's claude.ai connectors, without a model call. */
  listConnectors(): Promise<Connector[]>
  /** One call over a connector with the message `text`. */
  ask(spec: ConnectorCallSpec, text: string): Promise<ConnectorCallEnd>
  core: Pick<AttentionCore, 'ingest'>
  ledger: Pick<AssistantUsageLedger, 'noteCall'>
  /** The Projects of this Machine: their names go into the message, and an item's Project name finds its id. */
  projects(): readonly { id: string; name: string }[]
  /** The journal of the checks. */
  log(line: string): void
}

/** The message of one call: the recipe's task, the cap of the answer, then the user's Projects by name. */
function messageOf(recipe: ConnectorRecipe, since: number, now: number, projects: readonly { name: string }[]): string {
  const names = projects.map((project) => project.name)
  return [
    recipe.task({ since, now }),
    `Report at most ${SOURCE_ITEMS_MAX} messages: when more came, report the ${SOURCE_ITEMS_MAX} oldest; the next check reads the rest.`,
    names.length === 0 ? 'The user has no Projects.' : `The user's Projects: ${names.join(', ')}.`,
  ].join('\n\n')
}

/** The event of the attention core an item of the check of `kind` is: a message of its source, in the scope of the Project it names. */
export function sourceEventOf(item: SourceItem, kind: CheckKind, projects: readonly { id: string; name: string }[]): AttentionEvent {
  const named = item.project?.toLowerCase()
  const project = named === undefined ? undefined : projects.find((each) => each.name.toLowerCase() === named)
  const key = `${kind}:${item.id}`
  return {
    source: kind,
    id: key,
    // A message is written once: its time is its revision, however the call words its text.
    revision: item.at,
    projectId: project?.id ?? null,
    subject: { kind: 'message', id: key, label: item.author },
    kind: item.urgent ? 'urgent-message' : 'message',
    text: item.text,
    at: Date.parse(item.at),
    message: { source: item.source, id: item.id, author: item.author, at: item.at, url: item.url, concernsUser: item.concernsUser, urgent: item.urgent, project: item.project, ticket: item.ticket },
  }
}

/** The run of the check of `recipe`'s source, for the scheduler of checks. */
export function sourceCheckRun(recipe: ConnectorRecipe, deps: SourceCheckDeps): CheckRun {
  const fail = (why: string): never => {
    deps.log(`[assistant] the ${recipe.kind} check: ${why}`)
    throw new Error(`the ${recipe.kind} check: ${why}`)
  }
  return async ({ since, now }) => {
    const connectors = (await deps.listConnectors()).filter((each) => recipe.isConnector(each.name))
    const connector = connectors.find((each) => each.status === 'connected') ?? connectors[0]
    if (connector === undefined) return fail('the user has no claude.ai connector for it')
    if (connector.status !== 'connected') return fail(`its connector is ${connector.status}: it waits in claude.ai`)
    const readTools = readToolsOf(connector, recipe.readTools)
    if (readTools.length === 0) return fail('its connector has no read tool the recipe names')
    const projects = deps.projects()
    const end = await deps.ask({ connector, readTools, outputSchema: sourceAnswerJsonSchema() }, messageOf(recipe, since ?? now - FIRST_CHECK_LOOKBACK_MS, now, projects))
    if (end.kind === 'refused') return fail(`the call was refused before the model: ${end.reason}`)
    try {
      deps.ledger.noteCall({ kind: 'source-check', source: recipe.kind, wakeId: null, model: end.model, usage: end.usage, costUsd: end.costUsd })
    } catch (error) {
      // The answer is paid for already: losing its items to a full disk would cost a second call.
      deps.log(`[assistant] the ${recipe.kind} check: the usage ledger could not note the call: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (end.kind === 'no-answer') return fail(`the call gave no answer (${end.detail})`)
    const check = sourceItemsOf(end.structured, recipe.kind)
    if (check === null) return fail('the answer is not in the form of items')
    for (const refused of check.refused) deps.log(`[assistant] the ${recipe.kind} check: ${refused}`)
    for (const item of check.items) if (recipe.keeps?.(item) ?? true) deps.core.ingest(sourceEventOf(item, recipe.kind, projects))
    if (!check.full) return undefined
    // At its cap the answer covers the time only up to its newest item: the next check asks from there.
    const newest = check.items.at(-1)
    if (newest === undefined) return fail('the answer is full of entries that fail the form')
    return { coveredUntil: Date.parse(newest.at) } satisfies CheckRunResult
  }
}
