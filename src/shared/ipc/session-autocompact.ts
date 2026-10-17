// The `sessionAutocompact` domain (worfy-polish ticket 24): what Settings → Sessions needs to know
// besides the app settings. Claude Code takes CLAUDE_CODE_AUTO_COMPACT_WINDOW of its environment
// over the window worfy passes, and a Session's environment is the login shell's
// (src/main/agent/env.ts), which the renderer cannot see; nor can it read the user's
// ~/.claude/settings.json, whose `autoCompactWindow` wins over a window worfy's person never chose
// (worfy-polish ticket 29). `local`: the setting and the Sessions it reaches belong to the screen's
// own Machine.
import { z } from 'zod'
import { invokeChannel } from './channels'

/** CLAUDE_CODE_AUTO_COMPACT_WINDOW of the environment a Session gets, as it is written there; null when it has none. */
export const sessionAutocompactShellOverride = invokeChannel('sessionAutocompact.shellOverride', z.void(), z.object({ value: z.string().nullable() }), 'local')

/**
 * `autoCompactWindow` of the user's <claudeHome>/settings.json, read at each call: a whole positive
 * number of tokens; null when it has none.
 */
export const sessionAutocompactUserSettings = invokeChannel('sessionAutocompact.userSettings', z.void(), z.object({ value: z.number().int().positive().nullable() }), 'local')

declare module './channels' {
  interface IpcContract {
    'sessionAutocompact.shellOverride': typeof sessionAutocompactShellOverride
    'sessionAutocompact.userSettings': typeof sessionAutocompactUserSettings
  }
}
