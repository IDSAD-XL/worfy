import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { AgentEvent } from '../../shared/agent/events'
import { pickAnswers, type Question, type QuestionPick } from '../../shared/agent/questions'
import { invoke } from '../ipc'
import { Markdown } from '../markdown/Markdown'
import { writeAction } from '../projects/read-only'
import { useReadOnly } from '../projects/useProjects'
import type { QuestionRequestEvent } from './open-requests'
import { answersWithEnter } from './question-keys'
import { useSessionLog } from './store'
import './question-card.css'

// Questions with answer options in the transcript (worfy-ui ticket 17): what Claude Code asks with
// its AskUserQuestion tool, shown like the question window of Claude Code desktop. One question at
// a time, with Back / Next between them when there are several; the header chips above say which
// are answered. A question's options are buttons with the description under the label — one choice,
// or switches for multiSelect — and an "Other" field for the user's own words. The preview of the
// option picked or pointed at shows next to the options, as markdown in a monospaced block.
// "Submit" is active once every question has an answer; "Decline" refuses the call. The answer
// goes to main with `agent.answerQuestion`; once resolved (answered here or from a toast, declined,
// or cancelled by Interrupt or by closing the Session) the card shows the answers and no controls.
//
// Keys, while the focus is in the card: 1–4 pick an option of the question shown; Enter on an option
// or in the "Other" field goes to the next question or, with every question answered, submits (on
// any other button Enter presses that button); Tab moves between the options. On a
// read-only screen (worfy-link ticket 25) the card shows and nothing in it answers.

type Resolution = Extract<AgentEvent, { type: 'question_resolved' }>

export interface QuestionCardProps {
  request: QuestionRequestEvent
  /** The live Session the request belongs to. */
  sessionId: string | null
  projectId?: string | undefined
}

const OUTCOME: Record<Resolution['outcome'], string> = {
  answered: 'Answered',
  declined: 'Declined',
  cancelled: 'Cancelled',
}

const EMPTY: QuestionPick = { selected: [], other: null }

/** How a request was resolved, from the Session's events; null while it is open. */
function useResolution(sessionId: string | null, requestId: string): Resolution | null {
  const { events } = useSessionLog(sessionId)
  return useMemo(() => {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index]
      if (event?.type === 'question_resolved' && event.requestId === requestId) return event
    }
    return null
  }, [events, requestId])
}

/** A pick with `label` chosen: the only one of a single-choice question (the "Other" text goes), one more of a multiSelect one. */
function toggled(question: Question, pick: QuestionPick, label: string): QuestionPick {
  if (!question.multiSelect) return { selected: [label], other: null }
  return { ...pick, selected: pick.selected.includes(label) ? pick.selected.filter((each) => each !== label) : [...pick.selected, label] }
}

/** A pick with the "Other" text typed: for a single-choice question it replaces the option picked. */
function withOther(question: Question, pick: QuestionPick, text: string): QuestionPick {
  if (!question.multiSelect && text.trim() !== '') return { selected: [], other: text }
  return { ...pick, other: text }
}

/** The picks as main takes them: blank "Other" text is none. */
const sent = (picks: readonly QuestionPick[]): QuestionPick[] => picks.map(({ selected, other }) => ({ selected, other: other !== null && other.trim() !== '' ? other : null }))

export function QuestionCard({ request, sessionId, projectId }: QuestionCardProps) {
  const resolution = useResolution(sessionId, request.requestId)
  const readOnly = useReadOnly()
  const { questions } = request
  const [picks, setPicks] = useState<QuestionPick[]>(() => questions.map(() => EMPTY))
  const [step, setStep] = useState(0)
  const [pointed, setPointed] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const firstOption = useRef<HTMLButtonElement>(null)
  const open = resolution === null && sessionId !== null
  const question = questions[step] ?? questions[0]!
  const pick = picks[step] ?? EMPTY
  const answered = questions.map((each, index) => pickAnswers(each, picks[index]))
  const complete = answered.every(Boolean)
  const last = step === questions.length - 1

  // A question that arrives while nothing has the focus takes it, so 1–4 and Enter work at once;
  // it never takes the focus from the message field or anything else.
  useEffect(() => {
    if (open && readOnly === null && document.activeElement === document.body) firstOption.current?.focus()
    // Only when the card first appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const change = (next: QuestionPick): void => setPicks((all) => all.map((each, index) => (index === step ? next : each)))

  const go = (to: number): void => {
    setStep(to)
    setPointed(null)
  }

  const send = async (answers: QuestionPick[] | null): Promise<void> => {
    if (sessionId === null || sending) return
    setSending(true)
    setProblem(null)
    const result = await invoke('agent.answerQuestion', { sessionId, requestId: request.requestId, answers })
    setSending(false)
    if (!result.ok) setProblem(result.error)
    else if (!result.value.answered) setProblem('This question is no longer open')
  }

  const submit = (): void => {
    if (complete) void send(sent(picks))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!open || readOnly !== null || event.metaKey || event.ctrlKey || event.altKey) return
    const typing = event.target instanceof HTMLInputElement
    if (event.key === 'Enter') {
      // Enter on Decline, Back, Next or a step chip is that button's own press.
      if (!answersWithEnter(event.target)) return
      event.preventDefault()
      if (complete) submit()
      else if (answered[step] === true && !last) go(step + 1)
      return
    }
    if (typing || !/^[1-4]$/.test(event.key)) return
    const option = question.options[Number(event.key) - 1]
    if (option === undefined) return
    event.preventDefault()
    change(toggled(question, pick, option.label))
  }

  if (!open) {
    return (
      <div className="w-tr__row" data-testid="question-card" data-request-id={request.requestId} data-resolution={resolution?.outcome ?? 'open'}>
        <div className="w-tr__who w-mono w-tr__who--assistant">ask</div>
        <div className="w-tr__body">
          <div className="w-permission w-question" data-open="false">
            <ol className="w-question__answers">
              {questions.map((each) => (
                <li key={each.question} className="w-question__answer" data-testid="question-answer">
                  {each.header !== '' ? <span className="w-question__chip w-mono">{each.header}</span> : null}
                  <span className="w-question__asked">{each.question}</span>
                  <span className="w-question__given" data-testid="question-answer-text">
                    {resolution?.answers[each.question] ?? '—'}
                  </span>
                </li>
              ))}
            </ol>
            <div className="w-permission__resolved w-mono" data-testid="question-resolution">
              {resolution === null ? 'Not answered' : OUTCOME[resolution.outcome]}
            </div>
          </div>
        </div>
      </div>
    )
  }

  const shown = pointed ?? pick.selected.at(-1) ?? null
  const preview = question.options.find((option) => option.label === shown)?.preview ?? null
  // The preview's column stays while the question has previews at all: an option that moved when
  // the pointer came over it would leave the pointer, and the preview would blink.
  const previews = question.options.some((option) => option.preview !== null)
  const hint = readOnly
  return (
    <div className="w-tr__row" data-testid="question-card" data-request-id={request.requestId} data-resolution="open">
      <div className="w-tr__who w-mono w-tr__who--assistant">ask</div>
      <div className="w-tr__body">
        <div className="w-permission w-question" data-open="true" data-read-only={hint !== null ? '' : undefined} onKeyDown={onKeyDown}>
          <div className="w-permission__head">
            <span className="w-permission__title">{questions.length > 1 ? 'Claude Code asks' : 'Claude Code asks a question'}</span>
            {questions.length > 1 ? (
              <span className="w-question__steps" data-testid="question-steps">
                {questions.map((each, index) => (
                  <button
                    key={each.question}
                    type="button"
                    className="w-question__chip w-mono"
                    data-current={index === step}
                    data-answered={answered[index]}
                    aria-current={index === step ? 'step' : undefined}
                    onClick={() => go(index)}
                  >
                    {each.header !== '' ? each.header : `${index + 1}`}
                  </button>
                ))}
              </span>
            ) : question.header !== '' ? (
              <span className="w-question__chip w-mono" data-testid="question-header">
                {question.header}
              </span>
            ) : null}
          </div>
          <div className="w-question__text" data-testid="question-text">
            {question.question}
          </div>
          <div className={`w-question__body${previews ? ' w-question__body--preview' : ''}`}>
            <div className="w-question__options" role={question.multiSelect ? 'group' : 'radiogroup'} aria-label={question.question}>
              {question.options.map((option, index) => {
                const chosen = pick.selected.includes(option.label)
                return (
                  <button
                    key={option.label}
                    ref={index === 0 ? firstOption : undefined}
                    type="button"
                    className="w-question__option"
                    data-testid="question-option"
                    data-chosen={chosen}
                    role={question.multiSelect ? 'checkbox' : 'radio'}
                    aria-checked={chosen}
                    disabled={sending}
                    onMouseEnter={() => setPointed(option.label)}
                    onMouseLeave={() => setPointed(null)}
                    onFocus={() => setPointed(option.label)}
                    onBlur={() => setPointed(null)}
                    {...writeAction(hint, () => change(toggled(question, pick, option.label)))}
                  >
                    <span className="w-question__key w-mono" aria-hidden="true">
                      {index < 4 ? index + 1 : ''}
                    </span>
                    <span className="w-question__mark" aria-hidden="true" data-multi={question.multiSelect} />
                    <span className="w-question__label">
                      <span className="w-question__name">{option.label}</span>
                      {option.description !== '' ? <span className="w-question__description">{option.description}</span> : null}
                    </span>
                  </button>
                )
              })}
              <label className="w-question__other">
                <span className="w-question__other-label">Other</span>
                <input
                  type="text"
                  className="w-question__other-input"
                  data-testid="question-other"
                  placeholder="Type your own answer"
                  value={pick.other ?? ''}
                  readOnly={hint !== null}
                  title={hint ?? undefined}
                  disabled={sending}
                  onChange={(event) => change(withOther(question, pick, event.target.value))}
                />
              </label>
            </div>
            {previews ? (
              <div className="w-question__preview w-mono" data-testid="question-preview" data-empty={preview === null}>
                {preview !== null ? <Markdown text={preview} projectId={projectId} /> : <span className="w-question__preview-hint">Point at an option to see its preview</span>}
              </div>
            ) : null}
          </div>
          <div className="w-permission__actions">
            {questions.length > 1 ? (
              <>
                <button type="button" className="w-permission__button" data-testid="question-back" disabled={step === 0} onClick={() => go(step - 1)}>
                  Back
                </button>
                <button type="button" className="w-permission__button" data-testid="question-next" disabled={last} onClick={() => go(step + 1)}>
                  Next
                </button>
              </>
            ) : null}
            {/* The primary action's look (theme/primitives.tsx, PrimaryButton), with a test id. */}
            <button type="button" className="w-primary" data-testid="question-submit" disabled={!complete || sending} {...writeAction(hint, submit)}>
              Submit
            </button>
            <button type="button" className="w-permission__button w-permission__button--deny" data-testid="question-decline" disabled={sending} {...writeAction(hint, () => void send(null))}>
              Decline
            </button>
          </div>
          {problem !== null ? (
            <div className="w-permission__problem" role="alert">
              {problem}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
