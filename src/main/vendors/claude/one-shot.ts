// The oneShot part of the Claude driver. Today's single requests run their own Agent SDK query: the
// Project profile draft (src/main/ipc/projects.ts, sdkDraftQuery) and Terminal AI (terminal-ai.ts).
import { PartNotWired } from '../driver'
import type { OneShot } from '../one-shot'

// shortcut: rejects, as the draft's query lives inside the projects IPC handler; worfy-multi-vendor
// ticket 15 moves it here and has the draft call it.
export const claudeOneShot: OneShot = () => Promise.reject(new PartNotWired('claude', 'oneShot', 'worfy-multi-vendor ticket 15'))
