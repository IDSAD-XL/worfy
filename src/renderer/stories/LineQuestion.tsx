// A question about lines of a Code story (Epic worfy-code-stories, ticket 12; spec, owner decisions 11 and 19): the
// field stands after the lines selected in the code of a step; Ask sends the question to main (`stories.ask`), which
// asks the invisible agent — the oneShot of the Project's Vendor, no Session, no Session Node. While it answers, the
// progress bar of the story's build stands in the place of the field, with the agent's lines and Stop; then, in the
// same place, why no answer came: Stop, a failure, or a Vendor without a oneShot. The answer shows after the same
// lines (LineAnswer): the agent's text, what it rests on — or "no support", in the story's words — and the lines of
// code it quotes. main keeps it with the story; the view reads the kept ones once per story (story-answers.ts). The
// words of the field and of the answer follow the story's language (labels.json), as the story's own labels do.
import { useEffect, useState, type KeyboardEvent } from 'react'
import { failureReason } from '../../shared/ipc/channels'
import { STORY_QUESTION_MAX_CHARS, type StoryAnswer, type StoryAnswerSource, type StoryQuestionLines } from '../../shared/ipc/stories'
import { storyLabels, type StoryFile, type StoryLabels, type StoryLanguage } from '../../shared/stories/schema'
import { invoke, subscribe } from '../ipc'
import { Markdown } from '../markdown/Markdown'
import { Button } from '../theme/Button'
import { Chip } from '../theme/Chip'
import { questionName } from './story-answers'
import { SHOWN_LINES } from './story-build'
import './line-question.css'
import './story-progress.css'

/** What the field shows: the question being written, the agent answering, or why no answer came. */
type Run =
  | { kind: 'idle' }
  | { kind: 'running'; questionId: string; lines: string[]; stopping: boolean }
  | { kind: 'stopped' }
  | { kind: 'failed'; reason: string }
  | { kind: 'unavailable'; reason: string }

export interface LineQuestionProps {
  projectId: string
  story: StoryFile
  about: StoryQuestionLines
  /** The text of the selected lines, as the step shows them. */
  code: string
  onAnswer: (answer: StoryAnswer) => void
  onClose: () => void
  /** Told true when the question goes to main, false when its outcome is back: the view keeps the field meanwhile. */
  onBusy?: (busy: boolean) => void
}

/** The question field after the selected lines, and in its place the progress bar while the agent answers. */
export function LineQuestion({ projectId, story, about, code, onAnswer, onClose, onBusy }: LineQuestionProps) {
  const labels = storyLabels(story.header.language)
  const name = questionName(labels, about)
  const [question, setQuestion] = useState('')
  const [run, setRun] = useState<Run>({ kind: 'idle' })
  const running = run.kind === 'running' ? run.questionId : null

  useEffect(() => {
    if (running === null) return
    return subscribe('stories.activity', ({ storyId, text }) => {
      setRun((now) => (now.kind === 'running' && now.questionId === storyId ? { ...now, lines: [...now.lines, text].slice(-SHOWN_LINES) } : now))
    })
  }, [running])

  const ask = async (): Promise<void> => {
    const text = question.trim()
    if (text === '' || run.kind === 'running') return
    const questionId = crypto.randomUUID()
    setRun({ kind: 'running', questionId, lines: [], stopping: false })
    onBusy?.(true)
    const result = await invoke('stories.ask', { questionId, projectId, story, about, code, question: text })
    onBusy?.(false)
    if (!result.ok) {
      setRun({ kind: 'failed', reason: failureReason('stories.ask', result.error) })
      return
    }
    const outcome = result.value
    switch (outcome.status) {
      case 'answer':
        onAnswer(outcome.answer)
        return
      case 'stopped':
        setRun({ kind: 'stopped' })
        return
      case 'unavailable':
        setRun({ kind: 'unavailable', reason: outcome.reason })
        return
      case 'failed':
        setRun({ kind: 'failed', reason: outcome.reason })
        return
    }
  }

  const stop = (): void => {
    if (run.kind !== 'running' || run.stopping) return
    setRun({ ...run, stopping: true })
    void invoke('stories.stop', { storyId: run.questionId })
  }

  // ⌘↩ or Ctrl+↩ asks; Esc closes the field, and the view stays (it leaves Esc in a text field alone).
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      void ask()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  if (run.kind === 'idle') {
    return (
      <div className="w-line-question" data-testid="line-question">
        <textarea
          className="w-line-question__input"
          aria-label={name}
          placeholder={`${name}…`}
          rows={2}
          maxLength={STORY_QUESTION_MAX_CHARS}
          value={question}
          // The field opens because the person asked for it: the focus goes there at once.
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="w-line-question__actions">
          <Button onClick={onClose}>{labels.cancel}</Button>
          <Button variant="primary" aria-disabled={question.trim() === '' ? 'true' : undefined} onClick={() => void ask()}>
            {labels.ask}
          </Button>
        </div>
      </div>
    )
  }
  if (run.kind === 'running') {
    const lines = run.lines.length > 0 ? run.lines : [labels.starting]
    return (
      <div className="w-story-progress w-line-question" data-testid="line-question-progress" data-state="running">
        <div className="w-story-progress__head">
          <Chip variant="working" label={run.stopping ? labels.stopping : labels.answering} />
          <Button variant="danger" quiet aria-disabled={run.stopping ? 'true' : undefined} onClick={stop}>
            {labels.stop}
          </Button>
        </div>
        <span className="w-story-progress__track" role="progressbar" aria-label={`${labels.answering} ${name}`}>
          <span className="w-story-progress__fill" />
        </span>
        <ol className="w-story-progress__lines" aria-live="polite">
          {lines.map((line, index) => (
            <li key={`${String(index)}:${line}`} className={index === lines.length - 1 ? 'w-story-progress__line w-story-progress__line--last' : 'w-story-progress__line'}>
              {line}
            </li>
          ))}
        </ol>
      </div>
    )
  }
  const [chip, text] =
    run.kind === 'stopped'
      ? [<Chip key="chip" variant="stopped" label={labels.stopped} />, labels.noAnswerKept]
      : run.kind === 'unavailable'
        ? [<Chip key="chip" variant="blocked" label={labels.notAvailable} />, run.reason]
        : [<Chip key="chip" variant="blocked" label={labels.failed} bordered />, run.reason]
  return (
    <div className="w-story-progress w-line-question" data-testid="line-question-progress" data-state={run.kind} role={run.kind === 'stopped' ? 'status' : 'alert'}>
      <div className="w-story-progress__head">
        {chip}
        <Button onClick={onClose}>{labels.close}</Button>
      </div>
      <p className="w-story-progress__reason">{text}</p>
    </div>
  )
}

/** What a source is called on the answer, in the story's words. */
const sourceName = (labels: StoryLabels, source: StoryAnswerSource): string =>
  ({ code: labels.sourceCode, story: labels.sourceStory, pr: labels.sourcePr, verdict: labels.sourceVerdict, none: labels.noSupport })[source]

/**
 * An answer after the lines it was asked about: the question, the agent's text, what it rests on, the lines it quotes.
 * `earlier`: it was asked about an earlier text of the story, and says so.
 */
export function LineAnswer({ answer, language, earlier = false }: { answer: StoryAnswer; language: StoryLanguage; earlier?: boolean }) {
  const labels = storyLabels(language)
  return (
    <section
      className="w-line-answer"
      data-testid="line-answer"
      data-source={answer.source}
      data-earlier={earlier ? 'true' : undefined}
      aria-label={`${labels.answer}: ${questionName(labels, answer.about)}`}
    >
      <div className="w-line-answer__head">
        <span className="w-line-answer__question">{answer.question}</span>
        <Chip variant={answer.source === 'none' ? 'blocked' : 'neutral'} icon={null} label={sourceName(labels, answer.source)} />
      </div>
      {earlier ? <p className="w-line-answer__note">{labels.earlierText}</p> : null}
      <div className="w-line-answer__text">
        <Markdown text={answer.answer} />
      </div>
      {answer.source === 'code' && answer.lines.length === 0 ? <p className="w-line-answer__note">{labels.linesNotLinked}</p> : null}
      {answer.lines.length > 0 ? (
        <div className="w-line-answer__lines">
          <span>{labels.lines}:</span>
          {answer.lines.map((line) => (
            <code key={line} title={line}>
              {line.slice(0, line.lastIndexOf('@'))}
            </code>
          ))}
        </div>
      ) : null}
    </section>
  )
}
