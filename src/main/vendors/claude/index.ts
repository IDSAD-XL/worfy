// The driver of Claude Code (ADR-0094 item 2): today's code behind the parts of VendorDriver, one
// file per part. A ticket that changes a part changes its file, not this one.
import { CLAUDE_CAPABILITIES, type Capabilities } from '../../../shared/vendors/capabilities'
import type { VendorDriver } from '../driver'
import type { SessionHandle } from '../session'
import { claudeAccount } from './account'
import { claudeCommands } from './commands'
import { claudeHistory } from './history'
import { claudeLimits } from './limits'
import { claudeMcp } from './mcp'
import { claudeOneShot } from './one-shot'
import { claudeLive, claudeSession } from './session'
import { claudeTerminalAi, type ClaudeTerminalAi } from './terminal-ai'

/** The Claude driver, with Terminal AI, which only Claude Code has. */
export interface ClaudeDriver extends VendorDriver {
  readonly terminalAi: ClaudeTerminalAi
}

/**
 * The static capabilities, with the models of the live Session: supportedModels() as the model
 * picker lists them today (modelOptions; the default model is `default`). Without a live query, or
 * when it lists none, the static ones.
 */
async function claudeCapabilities(session?: SessionHandle): Promise<Capabilities> {
  const query = session === undefined ? null : claudeLive(session)?.query
  if (query === null || query === undefined) return CLAUDE_CAPABILITIES
  try {
    const { modelOptions } = await import('../../agent/session/models')
    const models = modelOptions(await query.supportedModels()).map((model) => ({ id: model.value ?? 'default', label: model.displayName, effortLevels: [...model.efforts] }))
    return models.length === 0 ? CLAUDE_CAPABILITIES : { ...CLAUDE_CAPABILITIES, models }
  } catch (error) {
    console.warn('[vendors] supportedModels of a Claude Session failed', error)
    return CLAUDE_CAPABILITIES
  }
}

let driver: ClaudeDriver | null = null

/**
 * The Claude driver, made on first use: src/main/agent/app-registry.ts and session.ts here import
 * each other, so the parts are read at the call, never while the modules load.
 */
export function claudeDriver(): ClaudeDriver {
  driver ??= {
    id: 'claude',
    capabilities: claudeCapabilities,
    session: claudeSession,
    account: claudeAccount,
    limits: claudeLimits,
    history: claudeHistory,
    commands: claudeCommands,
    mcp: claudeMcp,
    oneShot: claudeOneShot,
    terminalAi: claudeTerminalAi,
  }
  return driver
}
