import { Button } from '../theme/Button'
import { Chip } from '../theme/Chip'
import { STARTING_LINE, type StoryRun } from './story-build'
import './story-progress.css'

/*
 * The progress bar of a Code story (worfy-code-stories ticket 04; spec, owner decisions 13 and 19): the
 * build is invisible — no Session, no Session Node — and the person sees only this bar, in the place of
 * the button they pressed. It shows the last lines of what the agent does (`stories.activity`, the
 * oneShot's onActivity) in their order, and Stop; then, in the same place, why no story came: Stop, a
 * failure, or a Vendor that cannot build one (its capabilities' reason). The buttons that hold it come
 * with tickets 11 and 12: they render their button while the run is `idle` or `done`, this bar otherwise.
 */


interface StoryProgressProps {
  run: StoryRun
  onStop: () => void
  /** Puts the button back after a Stop or a failure; no Close button without it. */
  onDismiss?: () => void
}

/** The bar in the place of the pressed button; nothing for a run that is `idle` or `done`. */
export function StoryProgress({ run, onStop, onDismiss }: StoryProgressProps) {
  if (run.kind === 'idle' || run.kind === 'done') return null
  if (run.kind === 'running') {
    const lines = run.lines.length > 0 ? run.lines : [STARTING_LINE]
    return (
      <div className="w-story-progress" data-testid="story-progress" data-state="running">
        <div className="w-story-progress__head">
          <Chip variant="working" label={run.stopping ? 'Stopping…' : 'Building story…'} />
          <Button variant="danger" quiet aria-disabled={run.stopping ? 'true' : undefined} onClick={onStop}>
            Stop
          </Button>
        </div>
        <span className="w-story-progress__track" role="progressbar" aria-label="Building the Code story">
          <span className="w-story-progress__fill" />
        </span>
        <ol className="w-story-progress__lines" aria-live="polite" data-testid="story-progress-lines">
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
      ? [<Chip key="chip" variant="stopped" label="Stopped" />, 'No story was written.']
      : run.kind === 'unavailable'
        ? [<Chip key="chip" variant="blocked" label="Not available" />, run.reason]
        : [<Chip key="chip" variant="blocked" label="Failed" bordered />, run.reason]
  return (
    <div className="w-story-progress" data-testid="story-progress" data-state={run.kind} role={run.kind === 'stopped' ? 'status' : 'alert'}>
      <div className="w-story-progress__head">
        {chip}
        {onDismiss !== undefined ? <Button onClick={onDismiss}>Close</Button> : null}
      </div>
      <p className="w-story-progress__reason" data-testid="story-progress-reason">
        {text}
      </p>
    </div>
  )
}
