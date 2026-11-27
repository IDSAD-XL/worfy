// The Assistant of the running app (worfy-assistant ticket 10): the decision to wake (ticket 06) and the closed list of
// actions (ticket 08) over the app's attention core, wired to the Sessions of the Assistant on Claude Code
// (src/main/vendors/claude/assistant-session.ts), with the memory file and the usage ledger in worfy's data folder.
//
// The Assistant is off until the user turns it on (ADR-0114, decision 10). With it off, nothing of it runs — no
// decision to wake, no closed list, no Session — and nothing is spent. The switch of Settings → Assistant (ticket 15,
// switch.ts) calls startAssistant() when the user turns it on and the stop it answers when they turn it off. The
// conversation (ticket 14) calls appAssistant().userMessage().
//
// Under WORFY_AGENT=fake (the e2e runs) a Session does not start: it is refused and logged, so a test of the app never
// reaches the model. The e2e scenario with the fake agent is tickets 14–16.
import { publicItemId, wakeItemRecord } from '../../mcp/app-server'
import { appNow } from '../../clock'
import { dataRoot } from '../../storage/paths'
import { claudeAssistantQuery, type AssistantQueryStarter } from '../../vendors/claude/assistant-session'
import { startClosedList } from '../actions/app'
import { appAssistantUsage } from '../budget/ledger'
import { assistantMemoryPath, sessionMemoryStore } from '../duties/memory'
import type { PowerEvents } from '../schedule/scheduler'
import { startAssistantWake } from '../wake/app'
import { readMemoryView, SessionMemory } from './memory'
import { AssistantSessions, composeAssistant, type Assistant, type AssistantRun } from './runner'

let running: Assistant | null = null
let memory: SessionMemory | undefined
const runListeners = new Set<(run: AssistantRun) => void>()

/** Follows the finished runs of the Assistant, a wake's or the user's message's (ticket 14); answers the unsubscribe. */
export function onAssistantRun(listener: (run: AssistantRun) => void): () => void {
  runListeners.add(listener)
  return () => void runListeners.delete(listener)
}

/** The Assistant once started; null while it is off. */
export function appAssistant(): Assistant | null {
  return running
}

/** The Assistant's part of the memory file of the running app, written by `worfy-app` (memory_note, memory_forget). */
export function appSessionMemory(): SessionMemory {
  memory ??= new SessionMemory({ store: sessionMemoryStore(assistantMemoryPath(dataRoot())), now: appNow })
  return memory
}

/** The Claude Code of a Session of the app: the SDK's, or a refusal under the fake agent. */
function appStarter(env: NodeJS.ProcessEnv = process.env): AssistantQueryStarter {
  if (env.WORFY_AGENT === 'fake') return () => Promise.reject(new Error('the Session of the Assistant does not start under the fake agent'))
  return claudeAssistantQuery
}

/**
 * Turns the Assistant on: the decision to wake and the closed list over the app (the attention core must run:
 * startAttentionCore), each wake a new Session (`power`: Electron's powerMonitor). Answers the stop; null when it runs
 * already or the attention core does not.
 */
export function startAssistant(power: PowerEvents): (() => void) | null {
  if (running !== null) return null
  const file = assistantMemoryPath(dataRoot())
  const sessions = new AssistantSessions({
    start: appStarter(),
    memory: () => readMemoryView(file, publicItemId),
    ledger: appAssistantUsage(),
    itemRecord: wakeItemRecord,
  })
  const assistant = composeAssistant({
    sessions,
    startWake: (onWake) => startAssistantWake(onWake, power),
    startClosedList: (escalate) => startClosedList({ escalate, power }),
    onRun: (run) => {
      for (const listener of [...runListeners]) listener(run)
    },
  })
  if (assistant === null) return null
  running = assistant
  return () => {
    assistant.stop()
    if (running === assistant) running = null
  }
}
