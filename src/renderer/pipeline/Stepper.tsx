// The stepper of a Ticket (ADR-0067; CONTEXT.md, terms Pipeline and Stage): one dot per Stage of
// the Project's Pipeline — passed, current, future, and a Check passed by a `skipped` mark drawn
// apart — then the current Stage's name and who the Ticket waits for. `blocked` is a flag on the
// current step with its reason in the tooltip; `rework` (Implementing again after a failed mark) is
// a flag on Implementing. A narrow one shows only the current Stage and «N/M». The Stage comes from
// main (`pipeline.get`, usePipeline.ts); the stepper only draws it.
import type { PipelineColumn } from '../../shared/ipc/pipeline'
import type { TicketStage } from '../../shared/workflow/pipeline'
import './stepper.css'

export interface StepperProps {
  /** The Project's Pipeline, in order. */
  pipeline: readonly PipelineColumn[]
  /** The Ticket's Stage in it. */
  stage: TicketStage
  /** Only the current Stage and «N/M»: when the row has no room for the dots. */
  narrow?: boolean
}

type StepState = 'passed' | 'skipped' | 'current' | 'future'

function stepState(column: PipelineColumn, at: number, stage: TicketStage): StepState {
  if (at === stage.index) return 'current'
  if (stage.skipped.includes(column.id)) return 'skipped'
  return stage.passed.includes(column.id) ? 'passed' : 'future'
}

/** The whole picture in words: the stepper may be cut at the Card's edge, and the dots carry no text. */
function stepperTitle(pipeline: readonly PipelineColumn[], stage: TicketStage): string {
  const head = [pipeline[stage.index]?.title ?? stage.stage]
  if (stage.rework) head.push('rework')
  if (stage.sub !== null) head.push(stage.sub)
  if (stage.waits !== null) head.push(`waits for ${stage.waits}`)
  head.push(`Stage ${stage.index + 1} of ${pipeline.length}`)
  const lines = [head.join(' · ')]
  const skipped = pipeline.filter((column) => stage.skipped.includes(column.id)).map((column) => column.title)
  if (skipped.length > 0) lines.push(`skipped: ${skipped.join(', ')}`)
  if (stage.blocked !== null) lines.push(blockedTitle(stage.blocked.reason))
  return lines.join('\n')
}

const blockedTitle = (reason: string | null): string => `blocked: ${reason ?? 'no reason given'}`

export default function Stepper({ pipeline, stage, narrow = false }: StepperProps) {
  const title = pipeline[stage.index]?.title ?? stage.stage
  return (
    <span className="w-stepper" data-testid="ticket-stepper" data-stage={stage.stage} data-kind={stage.kind} data-blocked={stage.blocked !== null ? 'true' : undefined} data-narrow={narrow ? 'true' : undefined} title={stepperTitle(pipeline, stage)}>
      {narrow ? null : (
        <span className="w-stepper__dots" aria-hidden="true">
          {pipeline.map((column, at) => {
            const state = stepState(column, at, stage)
            const current = state === 'current'
            return (
              <span
                key={column.id}
                className={`w-stepper__dot w-stepper__dot--${state}`}
                data-step={column.id}
                data-state={state}
                data-blocked={current && stage.blocked !== null ? 'true' : undefined}
                data-rework={current && stage.rework ? 'true' : undefined}
              />
            )
          })}
        </span>
      )}
      <span className="w-stepper__label" data-testid="stepper-label">
        {title}
      </span>
      {stage.rework ? (
        <span className="w-stepper__flag w-stepper__flag--rework" data-testid="stepper-rework">
          rework
        </span>
      ) : null}
      {stage.blocked !== null ? (
        // A mark, not a word: the Card's own row below already reads «blocked» with the reason.
        <span className="w-stepper__flag w-stepper__flag--blocked" data-testid="stepper-blocked" role="img" aria-label="blocked" title={blockedTitle(stage.blocked.reason)}>
          !
        </span>
      ) : null}
      {narrow ? (
        <span className="w-stepper__count w-mono" data-testid="stepper-count">
          {stage.index + 1}/{pipeline.length}
        </span>
      ) : stage.waits !== null ? (
        <span className="w-stepper__waits" data-testid="stepper-waits">
          {stage.waits}
        </span>
      ) : null}
    </span>
  )
}
