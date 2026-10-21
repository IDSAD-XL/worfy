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
import { dismissToast, showToast, type ToastAction } from '../toast/toasts'
import { invoke, showSubscribeError, subscribe, windowMachine } from '../ipc'
import { readOnlyNow } from '../projects/read-only-now'
import { openSession, useNavigation } from './navigation'
import { notificationTarget } from './notification-target'
import { useShownSession } from './shown-session'

const toastKey = (requestId: string): string => `question:${requestId}`

/** Whether the Session view of this window shows `sessionId` now. */
function onScreen(sessionId: string): boolean {
  return useNavigation.getState().view === 'session' && useShownSession.getState().sessionId === sessionId
}

/** Shows the Session; the Session view of the active Project when this window knows no Node for it. */
function openAsking(sessionId: string): void {
  const machine = windowMachine()
  const target = notificationTarget({ sessionId, projectRoot: null, ...(machine === null ? {} : { machineId: machine }) }, undefined, machine)
  if (target !== null) openSession(target)
  else useNavigation.setState({ view: 'session' })
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
