// The default list of MCP servers of a Profile, shared by main (src/main/workflow/profile.ts) and the screens that
// show the list (worfy-integrations ticket 08): a Profile with no `mcp.allowed` gets this one, so a screen that shows
// the list must show it too.
import { CANVAS_SERVER_NAME } from '../canvas/tools'

/**
 * The servers the workflow needs: the qmd of the Harness plugin (ADRs, lessons, Tickets), which worfy
 * registers as `plugin_worfy_qmd` (src/main/agent/options.ts, ADR-0048 item 4), and the canvas. The
 * name `qmd` means the user's own server from ~/.claude.json: it is not in the default list, so a
 * Session never gets two qmd servers (worfy-harness ticket 17).
 */
export const DEFAULT_MCP_SERVERS: readonly string[] = Object.freeze(['plugin_worfy_qmd', CANVAS_SERVER_NAME])
