// The `sessionAutocompact` domain (src/shared/ipc/session-autocompact.ts): reads the environment a
// Session gets (agentEnv, the login shell's, captured once per app run) and answers its
// CLAUDE_CODE_AUTO_COMPACT_WINDOW. A variable added to an rc file while worfy runs shows here once
// the environment is captured again (recaptureAgentEnv), which is also when new Sessions get it.
// It also answers `autoCompactWindow` of the user's <claudeHome>/settings.json, read at each call.
import { agentEnv } from '../agent/env'
import { readUserAutoCompactWindow } from '../claude-home/user-model'
import { sessionAutocompactShellOverride, sessionAutocompactUserSettings } from '../../shared/ipc/session-autocompact'
import { defineHandler, type HandlerModule } from './index'

/** The variable Claude Code reads its autocompact window from before any settings. */
export const AUTO_COMPACT_WINDOW_VAR = 'CLAUDE_CODE_AUTO_COMPACT_WINDOW'

export default [
  defineHandler(sessionAutocompactShellOverride, async () => {
    const value = (await agentEnv()).env[AUTO_COMPACT_WINDOW_VAR]
    return { value: value === undefined || value === '' ? null : value }
  }),
  defineHandler(sessionAutocompactUserSettings, () => ({ value: readUserAutoCompactWindow() })),
] satisfies HandlerModule
