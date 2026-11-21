// The price of an Integration's tools on the screen (worfy-integrations ticket 08; spec, implementation decisions,
// the cost of tools). The cost shown is counted AFTER the Project's tools filter: it is what the Sessions of this Project
// get in every request to the model, because the proxy cuts tools/list by the same filter
// (src/main/integrations/proxy.ts, filterTools). «of N» names the service's whole list. The tokens are the proxy's
// estimate (toolsCost): the length of the JSON of the tools' names, descriptions and schemas over 4; `size` of each
// tool is its part of that JSON, so the sum below gives toolsCost's number for the same tools.
import type { IntegrationToolInfo } from '../../shared/ipc/integrations'
import type { IntegrationTools } from '../../shared/integrations/types'

export interface ToolsCostView {
  count: number
  tokens: number
}

/** The count and tokens of `tools`, as toolsCost counts them: their JSON array (sizes, commas, brackets) over 4. */
export function costOf(tools: readonly IntegrationToolInfo[]): ToolsCostView {
  const json = tools.reduce((sum, tool) => sum + tool.size, 0) + Math.max(tools.length - 1, 0) + 2
  return { count: tools.length, tokens: Math.ceil(json / 4) }
}

/** The tools `filter` lets through, as the proxy's filterTools picks them. */
export function filtered(tools: readonly IntegrationToolInfo[], filter: IntegrationTools): IntegrationToolInfo[] {
  if (filter === 'all') return [...tools]
  if (filter === 'read-only') return tools.filter((tool) => tool.readOnly === true)
  const names = new Set(filter)
  return tools.filter((tool) => names.has(tool.name))
}

/** Whether the service marks any tool read-only or not: without a single readOnlyHint, Read only cannot be told. */
export const hasReadOnlyHints = (tools: readonly IntegrationToolInfo[]): boolean => tools.some((tool) => tool.readOnly !== null)

/** «~90», «~9k», «~1.2k». */
export function tokensText(tokens: number): string {
  if (tokens < 1000) return `~${tokens}`
  return `~${(Math.round(tokens / 100) / 10).toFixed(1).replace(/\.0$/u, '')}k`
}

/** «41 tools · ~9k tokens» for All; «12 of 41 tools · ~3k tokens» for a filter. */
export function costText(tools: readonly IntegrationToolInfo[], filter: IntegrationTools): string {
  const all = costOf(tools)
  const shown = costOf(filtered(tools, filter))
  const noun = (count: number): string => (count === 1 ? 'tool' : 'tools')
  if (filter === 'all') return `${all.count} ${noun(all.count)} · ${tokensText(all.tokens)} tokens`
  return `${shown.count} of ${all.count} ${noun(all.count)} · ${tokensText(shown.tokens)} tokens`
}

/** The name of a filter on its button. */
export function filterName(filter: IntegrationTools): string {
  if (filter === 'all') return 'All'
  if (filter === 'read-only') return 'Read only'
  return `Chosen (${filter.length})`
}
