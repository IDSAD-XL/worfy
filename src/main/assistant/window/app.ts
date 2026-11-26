// The Assistant's section in the running app (worfy-assistant ticket 14): one AssistantWindow over the app's attention core,
// duties, proposals, journal of actions and usage ledger, with the section's own file under worfy's data root; and the
// Assistant's system notifications, which follow its view. src/main/ipc/assistant.ts hands the view to the windows;
// src/main/index.ts starts the notifications after the attention core and stops them on `will-quit`.
//
// The conversation reaches the Assistant's Session of ticket 10 (src/main/assistant/session/app.ts, appAssistant) once
// that ticket is in: until then the Assistant is off and a message is refused with ASSISTANT_OFF.
import { workHoursOf } from '../../../shared/assistant/schedule/settings'
import { assistantReveal } from '../../../shared/ipc/assistant'
import { appLimits } from '../../agent/limits'
import { sharedNodeSessions } from '../../agent/app-node-sessions'
import { sharedRegistry } from '../../agent/app-registry'
import type { Client } from '../../clients'
import { appNow } from '../../clock'
import { emit } from '../../ipc/index'
import { electronWindowNoteDeps, openNote } from '../../notify'
import { projectStore } from '../../projects/store'
import { appSettingsStore } from '../../settings/store'
import { dataRoot } from '../../storage/paths'
import { actionJournalFile, actionJournalPath } from '../actions/journal'
import { appAssistantUsage } from '../budget/ledger'
import { appAttentionCore } from '../core/app'
import { appDuties } from '../duties/app'
import { appProposals } from '../proposals/book'
import { appAssistant } from '../session/app'
import { AssistantNotices } from './notices'
import { AssistantReveal } from './reveal'
import { windowStateFile, windowStatePath } from './store'
import { AssistantWindow, type AssistantConversation } from './view'

/** How often the section looks again without a change: snoozes that fall due, the journal, the usage, the work hours. */
export const WINDOW_LOOK_MS = 60_000

/** The Vendor of a prepared Session: Claude Code, whose skills the prepared texts name. */
const PREPARED_VENDOR = 'claude'

let shared: AssistantWindow | null = null
let sharedReveal: AssistantReveal<Client> | null = null

/**
 * The Assistant while it runs; null while it is off (ticket 10, appAssistant). Nothing in the app turns it on before the
 * switch of ticket 15, so until then the section says «Assistant is off on this machine» and refuses a message.
 */
function runningAssistant(): AssistantConversation | null {
  return appAssistant()
}

/** The section of the running app, made on first use. */
export function appAssistantWindow(): AssistantWindow {
  shared ??= new AssistantWindow({
    now: appNow,
    core: appAttentionCore,
    duties: appDuties(),
    projects: () => projectStore().list(),
    proposals: appProposals(),
    journal: () => actionJournalFile(actionJournalPath(dataRoot()), appNow).lines(),
    usage: () => {
      const ledger = appAssistantUsage()
      const summary = ledger.summary()
      return { today: summary.day.total.tokens, week: summary.week.total.tokens, shares: ledger.limitsShare(appLimits().snapshot()) }
    },
    workHours: () => workHoursOf(appSettingsStore().get()),
    store: windowStateFile(windowStatePath(dataRoot())),
    assistant: runningAssistant,
    nodeOf: (projectId, sessionId) => sharedNodeSessions().list(projectId).find((view) => view.sessionId === sessionId || view.sdkSessionId === sessionId)?.nodeId ?? null,
    start: (projectId, text) => {
      const view = sharedNodeSessions().create(projectId, undefined, PREPARED_VENDOR)
      sharedRegistry().get(view.sessionId).send(text)
      return { nodeId: view.nodeId, sessionId: view.sessionId }
    },
    log: (message, error) => console.warn(message, error),
  })
  return shared
}

/** The reveal of a clicked notification in the running app: the windows that follow the section, and what waits. */
export function appAssistantReveal(): AssistantReveal<Client> {
  sharedReveal ??= new AssistantReveal<Client>()
  return sharedReveal
}

/** Raises worfy's window (or opens one) and has it show the Assistant's section. */
function reveal(): void {
  openNote({ title: '', body: '', sessionId: null })
  appAssistantReveal().request((client) => emit(client, assistantReveal, {}))
}

/**
 * Starts the section's watch of the core, the duties and the proposals, a look every WINDOW_LOOK_MS, and the
 * Assistant's system notifications. Answers the function that stops them.
 */
export function startAssistantWindow(): () => void {
  const window = appAssistantWindow()
  const notices = new AssistantNotices({ focused: electronWindowNoteDeps.focused, show: electronWindowNoteDeps.show, reveal })
  const look = (): void => {
    try {
      notices.look(window.view())
    } catch (error) {
      console.warn('[assistant] the notifications could not look at the items', error)
    }
  }
  const stopWatch = window.watch()
  const stopLook = window.subscribe(look)
  const timer = setInterval(() => {
    try {
      window.tick()
    } catch (error) {
      console.warn('[assistant] the snoozes could not be looked at', error)
    }
    window.changed()
  }, WINDOW_LOOK_MS)
  timer.unref?.()
  look()
  return () => {
    clearInterval(timer)
    stopLook()
    stopWatch()
  }
}
