// Questions of a Session that is not on screen (worfy-ui ticket 17): an `action` toast (toast/toasts.ts,
// worfy-ui ticket 16) with the first question. A simple question — one, with two options, neither
// multiSelect nor a preview — gets its options as buttons that answer it with `agent.answerQuestion`,
// the channel of the card (QuestionCard.tsx); any other only "Open", which shows the Session and its
// card. The toast goes when the question is resolved anywhere: answered here, in the card, in
// another window, or cancelled. A read-only screen (worfy-link ticket 25) gets "Open" only.
//
// "On screen" is the Session view showing that Session (shown-session.ts): the toast is for the
// Canvas, the Pipeline board and the Session view of another Session.
import type { AgentEventEnvelope } from '../../shared/agent/events'
import { ORCHESTRATOR_KIND } from '../../shared/ipc/orchestrator'
import { acceptOrchestratorView } from '../canvas/nodes/orchestrator-view'
import { dismissToast, showToast, type ToastAction } from '../toast/toasts'
import { invoke, showSubscribeError, subscribe, windowMachine } from '../ipc'
import { readOnlyNow } from '../projects/read-only-now'
import { projectsNow } from '../projects/useProjects'
import { useNavigation, type OpenedSession } from './navigation'
import { acceptSessionNodeView } from './node-sessions'
import { notificationTarget } from './notification-target'
import { openSessionInProject } from './open-in-project'
import { useShownSession } from './shown-session'

const toastKey = (requestId: string): string => `question:${requestId}`

/** Whether the Session view of this window shows `sessionId` now. */
function onScreen(sessionId: string): boolean {
  return useNavigation.getState().view === 'session' && useShownSession.getState().sessionId === sessionId
}

/** The Node of the Session among the views this window has now: a Session Node or an Orchestrator; null when none. */
function targetOf(sessionId: string): OpenedSession | null {
  const machine = windowMachine()
  return notificationTarget({ sessionId, projectRoot: null, ...(machine === null ? {} : { machineId: machine }) }, undefined, machine)
}

/**
 * Asks main for the views of every Project of the window's Machine: its Session Nodes, and its
 * Orchestrator found in its Layout. A window loaded after the Session started knows the views of the
 * active Project's Canvas only.
 */
async function loadViews(): Promise<void> {
  const projects = projectsNow()?.projects ?? []
  await Promise.all(
    projects.map(async (project) => {
      const [sessions, layout] = await Promise.all([invoke('sessions.views', { projectId: project.id }), invoke('layout.get', { projectId: project.id })])
      if (sessions.ok) for (const view of sessions.value.views) acceptSessionNodeView(view)
      const orchestrator = layout.ok ? layout.value.layout.nodes.find((node) => node.kind === ORCHESTRATOR_KIND) : undefined
      if (orchestrator === undefined) return
      const result = await invoke('orchestrator.view', { nodeId: orchestrator.id })
      if (result.ok && result.value.view !== null) acceptOrchestratorView(result.value.view)
    }),
  )
}

/**
 * Shows the Session, selecting its Project first when it runs in another one (worfy-polish ticket 127).
 * When this window knows no Node for it, the views of every Project are asked for first; still none,
 * the Session view of the active Project.
 */
function openAsking(sessionId: string): void {
  const target = targetOf(sessionId)
  if (target !== null) {
    openSessionInProject(target)
    return
  }
  void loadViews().then(() => {
    const found = targetOf(sessionId)
    if (found !== null) openSessionInProject(found)
    else useNavigation.setState({ view: 'session' })
  })
}

async function answer(sessionId: string, requestId: string, label: string): Promise<void> {
  const result = await invoke('agent.answerQuestion', { sessionId, requestId, answers: [{ selected: [label], other: null }] })
  if (!result.ok) showToast({ kind: 'error', key: `${toastKey(requestId)}:error`, text: `The answer did not go through: ${result.error}` })
  else if (!result.value.answered) showToast({ kind: 'info', key: `${toastKey(requestId)}:error`, text: 'This question is no longer open' })
}

/** Takes one event of a live Session, as `agent.event` delivers it. */
export function acceptQuestionEvent({ sessionId, event }: AgentEventEnvelope): void {
  if (event.type === 'question_resolved') {
    dismissToast(toastKey(event.requestId))
    return
  }
  if (event.type !== 'question_request' || onScreen(sessionId)) return
  const first = event.questions[0]!
  const open: ToastAction = { label: 'Open', run: () => openAsking(sessionId) }
  const options = first.options
  const simple = event.questions.length === 1 && !first.multiSelect && options.length === 2 && options.every((option) => option.preview === null)
  const pick = (label: string): ToastAction => ({ label, run: () => void answer(sessionId, event.requestId, label) })
  showToast({
    kind: 'action',
    key: toastKey(event.requestId),
    testId: 'question-toast',
    text: `Asks: ${first.question}`,
    actions: simple && readOnlyNow() === null ? [pick(options[0]!.label), pick(options[1]!.label), open] : [open],
  })
}

/** Subscribes the window to the events of live Sessions for their questions; returns the unsubscribe. */
export function installQuestionToasts(): () => void {
  try {
    return subscribe('agent.event', acceptQuestionEvent)
  } catch (error) {
    showSubscribeError('agent.event', error)
    return () => undefined
  }
}
