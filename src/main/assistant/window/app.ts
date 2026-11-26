// The Assistant's section in the running app (worfy-assistant ticket 14): one AssistantWindow over the app's attention core,
// duties, proposals, journal of actions and usage ledger, with the section's own file under worfy's data root; and the
// Assistant's system notifications, which follow its view. src/main/ipc/assistant.ts hands the view to the windows;
// src/main/index.ts starts the notifications after the attention core and stops them on `will-quit`.
//
// What waits on the Linked machines (worfy-assistant ticket 18, linked.ts) is read over the link at the start, on every
// look and on every change RemoteCalls tells of (a connection, an unlink, a change of access), and shown read-only.
//
// The conversation reaches the Assistant's Session of ticket 10 (src/main/assistant/session/app.ts, appAssistant) while
// it runs: the switch of Settings → Assistant (ticket 15) starts it; while it is off a message is refused with ASSISTANT_OFF.
import { workHoursOf } from '../../../shared/assistant/schedule/settings'
import { assistantReveal, assistantWaiting } from '../../../shared/ipc/assistant'
import { appLimits } from '../../agent/limits'
import { sharedNodeSessions } from '../../agent/app-node-sessions'
import { sharedRegistry } from '../../agent/app-registry'
import type { Client } from '../../clients'
import { appNow } from '../../clock'
import { emit } from '../../ipc/index'
import { appRemoteCalls, callOn } from '../../link/remote-calls'
import { appLinkService, onAppLinkStart } from '../../link/service'
import { electronWindowNoteDeps, openNote } from '../../notify'
import { projectStore } from '../../projects/store'
import { appSettingsStore } from '../../settings/store'
import { dataRoot } from '../../storage/paths'
import { actionJournalFile, actionJournalPath } from '../actions/journal'
import { appAssistantUsage } from '../budget/ledger'
import { appAttentionCore } from '../core/app'
import { appDuties } from '../duties/app'
import { appProposals } from '../proposals/book'
import { applySettingsChange } from '../settings/panel'
import { appAssistantIntro } from '../intro/app'
import { appAssistant, onAssistantRun } from '../session/app'
import { AssistantNotices } from './notices'
import { LinkedWaits } from './linked'
import { AssistantReveal } from './reveal'
import { windowStateFile, windowStatePath } from './store'
import { AssistantWindow, type AssistantConversation } from './view'

/** How often the section looks again without a change: snoozes that fall due, the journal, the usage, the work hours. */
export const WINDOW_LOOK_MS = 60_000

/** The Vendor of a prepared Session: Claude Code, whose skills the prepared texts name. */
const PREPARED_VENDOR = 'claude'

let shared: AssistantWindow | null = null
let sharedReveal: AssistantReveal<Client> | null = null
let sharedLinked: LinkedWaits | null = null

/**
 * What waits on the Linked machines in the running app: every Linked machine of the link service, online while
 * RemoteCalls has a connection to it; none while the link has not started.
 */
export function appLinkedWaits(): LinkedWaits {
  sharedLinked ??= new LinkedWaits({
    machines: () => {
      const service = appLinkService()
      const calls = appRemoteCalls()
      if (service === undefined || calls === undefined) return []
      const online = new Map(calls.machines().map((machine) => [machine.id, machine.online]))
      return service.linkedMachines().map((machine) => ({ id: machine.id, name: machine.name, online: online.get(machine.id) ?? false }))
    },
    call: (machine) => callOn(machine, assistantWaiting.name),
  })
  return sharedLinked
}

/**
 * The Assistant while it runs; null while it is off (ticket 10, appAssistant). The switch of Settings → Assistant (ticket
 * 15) turns it on; while it is off the section says «Assistant is off on this machine» and refuses a message.
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
    // A card «before → after» reads the settings and the duties as they are, and its Apply changes them (ticket 15).
    settings: {
      now: () => ({ settings: appSettingsStore().get(), duties: appDuties().look([], { countShown: false }).duties, projects: projectStore().list() }),
      apply: (change) => applySettingsChange(change, { duties: appDuties(), setSettings: (patch) => void appSettingsStore().set(patch) }),
    },
    store: windowStateFile(windowStatePath(dataRoot())),
    assistant: runningAssistant,
    nodeOf: (projectId, sessionId) => sharedNodeSessions().list(projectId).find((view) => view.sessionId === sessionId || view.sdkSessionId === sessionId)?.nodeId ?? null,
    start: (projectId, text) => {
      const view = sharedNodeSessions().create(projectId, undefined, PREPARED_VENDOR)
      sharedRegistry().get(view.sessionId).send(text)
      return { nodeId: view.nodeId, sessionId: view.sessionId }
    },
    log: (message, error) => console.warn(message, error),
    linked: () => appLinkedWaits().snapshot(),
    // The one offer to turn the Assistant on (worfy-assistant ticket 16).
    offer: () => appAssistantIntro().offer(),
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

/** Puts the text of each finished wake of the Assistant into the section's conversation; answers the stop. */
export function followAssistantRuns(window: AssistantWindow): () => void {
  return onAssistantRun((run) => {
    try {
      window.noteWakeRun(run)
    } catch (error) {
      console.warn('[assistant] the text of a wake was not kept', error)
    }
  })
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
  const stopRuns = followAssistantRuns(window)
  const stopLook = window.subscribe(look)
  const stopLinked = followLinkedWaits(appLinkedWaits(), window)
  const timer = setInterval(() => {
    try {
      window.tick()
    } catch (error) {
      console.warn('[assistant] the snoozes could not be looked at', error)
    }
    window.changed()
    void appLinkedWaits().refresh()
  }, WINDOW_LOOK_MS)
  timer.unref?.()
  look()
  return () => {
    clearInterval(timer)
    stopLook()
    stopWatch()
    stopRuns()
    stopLinked()
  }
}

/**
 * The section hears of each change of what the Linked machines answered, and reads them afresh now and on every `changed`
 * of RemoteCalls: a connection opened or closed, a Machine unlinked, and its `projects-access` message — so access
 * switched Off, or back to Read only, shows at once. The link service may start after the section. One read runs at a
 * time; a change during it reads once more after it. Answers the function that stops it.
 */
function followLinkedWaits(linked: LinkedWaits, window: AssistantWindow): () => void {
  const stopChanged = linked.subscribe(() => window.changed())
  let running = false
  let again = false
  const read = (): void => {
    if (running) {
      again = true
      return
    }
    running = true
    void linked.refresh().finally(() => {
      running = false
      if (!again) return
      again = false
      read()
    })
  }
  let unfollow: (() => void) | null = null
  const follow = (): void => {
    unfollow?.()
    unfollow = null
    const calls = appRemoteCalls()
    if (calls === undefined) return
    calls.on('changed', read)
    unfollow = () => calls.off('changed', read)
    read()
  }
  const stopStart = onAppLinkStart(follow)
  follow()
  read()
  return () => {
    stopStart()
    unfollow?.()
    stopChanged()
  }
}
