// The checks of sources in the running app (worfy-assistant ticket 11): sourceCheckRun over main's own parts — the
// connectors from the MCP inventory's query, Claude Code through the Agent SDK, the app's attention core and usage
// ledger, the Projects of this Machine. A source's ticket registers its recipe on the scheduler of checks:
// `checkScheduler().register(kind, appSourceCheck(recipe))` (src/main/assistant/schedule/app.ts; Slack — ticket 12,
// Jira — ticket 13).
import { appAssistantUsage } from '../budget/ledger'
import { appAttentionCore } from '../core/app'
import { askConnector, claudeConnectorQuery, connectorCheckDir, listConnectors } from '../../vendors/claude/connector-check'
import { sdkInventoryStarter } from '../../vendors/claude/query'
import { projectStore } from '../../projects/store'
import { dataRoot } from '../../storage/paths'
import type { CheckRun } from '../schedule/scheduler'
import { sourceCheckRun, type ConnectorRecipe } from './connector-check'

/**
 * The run of the check of `recipe`'s source in the app. Under WORFY_AGENT=fake (the e2e runs) it refuses to run: the
 * fake agent has no connector, and a real Claude Code must never start there.
 */
export function appSourceCheck(recipe: ConnectorRecipe, env: NodeJS.ProcessEnv = process.env): CheckRun {
  if (env.WORFY_AGENT === 'fake') return () => Promise.reject(new Error(`the ${recipe.kind} check does not run under the fake agent`))
  const folder = (): string => connectorCheckDir(dataRoot())
  return sourceCheckRun(recipe, {
    listConnectors: () => listConnectors(sdkInventoryStarter(undefined, folder), folder()),
    ask: (spec, text) => askConnector(claudeConnectorQuery, spec, text),
    core: {
      ingest: (event) => {
        const core = appAttentionCore()
        if (core === null) throw new Error('the attention core is not running')
        return core.ingest(event)
      },
    },
    ledger: { noteCall: (call) => appAssistantUsage().noteCall(call) },
    projects: () => projectStore().list(),
    log: (line) => console.warn(line),
  })
}
