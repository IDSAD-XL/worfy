// "Check yourself", the last screen of a Code story with questions (Epic worfy-code-stories, ticket 13; spec, owner
// decision 15, story 20): two or three questions the story's agent wrote about decisions, failures, the data path and
// the boundary of the change. The right answer stays off the page until the person answers — in their own words, or
// with "I don't know" — and then shows with the lines it rests on; a line that a step of the story shows is a link that
// opens that step. Optional: nothing depends on the answers. They are kept in worfy's data with the story's other marks
// (story-marks.ts), so an answered question stays answered after a restart. The words follow the story's language.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { SELF_CHECK_MAX_CHARS, type StorySelfCheck } from '../../shared/ipc/stories'
import { storyLabels, type StoryFile, type StoryLabels, type StoryQuestion } from '../../shared/stories/schema'
import { Markdown } from '../markdown/Markdown'
import { Button } from '../theme/Button'
import { answerSelfCheck, useStoryMarks } from './story-marks'

/** The step of the story that shows a line of an answer: its screen and its name. */
export interface LinesStep {
  index: number
  name: string
}

export interface SelfCheckProps {
  story: StoryFile
  questions: readonly StoryQuestion[]
  projectId: string | undefined
  /** The step that shows `lines` (`path:line` or `path:from-to`); null when no step of the story does. */
  stepOf: (lines: string) => LinesStep | null
  /** Opens screen `index` of the story. */
  onOpen: (index: number) => void
}

/** The questions of "Check yourself", each with its field until it is answered, then with the right answer. */
export function SelfCheck({ story, questions, projectId, stepOf, onOpen }: SelfCheckProps) {
  const labels = storyLabels(story.header.language)
  const { checks } = useStoryMarks(projectId, story)
  return (
    <>
      <p className="w-story__intro">{labels.selfCheckIntro}</p>
      <ol className="w-self-check">
        {questions.map((question, index) => (
          <SelfCheckQuestion
            key={`${String(index)}:${question.question}`}
            number={index + 1}
            question={question}
            kept={checks.find((check) => check.question === question.question) ?? null}
            labels={labels}
            onAnswer={(answer) => answerSelfCheck(story, question.question, answer)}
            stepOf={stepOf}
            onOpen={onOpen}
          />
        ))}
      </ol>
    </>
  )
}

interface QuestionProps {
  number: number
  question: StoryQuestion
  kept: StorySelfCheck | null
  labels: StoryLabels
  onAnswer: (answer: string | null) => void
  stepOf: (lines: string) => LinesStep | null
  onOpen: (index: number) => void
}

function SelfCheckQuestion({ number, question, kept, labels, onAnswer, stepOf, onOpen }: QuestionProps) {
  const [draft, setDraft] = useState('')
  const answered = useRef(false)
  const shown = useRef<HTMLElement>(null)
  // The field and its buttons go when the answer comes: the focus moves to the answer, not to the page.
  useEffect(() => {
    if (kept === null || !answered.current) return
    answered.current = false
    shown.current?.focus()
  }, [kept])
  const answer = (text: string | null): void => {
    answered.current = true
    onAnswer(text)
  }
  const check = (): void => {
    if (draft.trim() !== '') answer(draft.trim())
  }
  // ⌘↩ or Ctrl+↩ checks, as in the question field of a line.
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      check()
    }
  }
  return (
    <li className="w-self-check__item" data-testid="self-check-question" data-answered={kept === null ? 'false' : 'true'}>
      <div className="w-self-check__question">
        <Markdown text={question.question} />
      </div>
      {kept === null ? (
        <div className="w-self-check__form">
          <textarea
            className="w-self-check__input"
            aria-label={labels.yourAnswerTo.replace('{n}', String(number))}
            placeholder={`${labels.yourAnswer}…`}
            rows={2}
            maxLength={SELF_CHECK_MAX_CHARS}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <div className="w-self-check__actions">
            <Button onClick={() => answer(null)}>{labels.dontKnow}</Button>
            <Button variant="primary" aria-disabled={draft.trim() === '' ? 'true' : undefined} onClick={check}>
              {labels.checkAnswer}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="w-self-check__mine" data-testid="self-check-mine">
            <div className="w-story__caption">{labels.yourAnswer}</div>
            <p className={kept.answer === null ? 'w-self-check__dont-know' : undefined}>{kept.answer ?? labels.dontKnow}</p>
          </div>
          <section className="w-self-check__answer" data-testid="self-check-answer" aria-label={`${labels.answer} ${String(number)}`} tabIndex={-1} ref={shown}>
            <div className="w-story__caption">{labels.answer}</div>
            <Markdown text={question.answer} />
            <div className="w-self-check__lines">
              <span>{labels.lines}:</span>
              {question.lines.map((lines) => {
                const step = stepOf(lines)
                return step === null ? (
                  <code key={lines} className="w-self-check__line" title={labels.noStepForLines}>
                    {lines}
                  </code>
                ) : (
                  <Button key={lines} variant="link" className="w-self-check__line" title={`${labels.openLines}: ${step.name}`} onClick={() => onOpen(step.index)}>
                    {lines}
                  </Button>
                )
              })}
            </div>
          </section>
        </>
      )}
    </li>
  )
}
