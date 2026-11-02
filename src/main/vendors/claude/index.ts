// The driver of Claude Code (ADR-0094 item 2): today's code behind the parts of VendorDriver, one
// file per part. A ticket that changes a part changes its file, not this one.
import { CLAUDE_CAPABILITIES } from '../../../shared/vendors/capabilities'
import type { VendorDriver } from '../driver'
import { claudeAccount } from './account'
import { claudeCommands } from './commands'
import { claudeHistory } from './history'
import { claudeLimits } from './limits'
import { claudeMcp } from './mcp'
import { claudeOneShot } from './one-shot'
import { claudeSession } from './session'
import { claudeTerminalAi, type ClaudeTerminalAi } from './terminal-ai'

/** The Claude driver, with Terminal AI, which only Claude Code has. */
export interface ClaudeDriver extends VendorDriver {
  readonly terminalAi: ClaudeTerminalAi
}

let driver: ClaudeDriver | null = null

/**
 * The Claude driver, made on first use: src/main/agent/app-registry.ts and session.ts here import
 * each other, so the parts are read at the call, never while the modules load.
 */
export function claudeDriver(): ClaudeDriver {
  driver ??= {
    id: 'claude',
    capabilities: CLAUDE_CAPABILITIES,
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
