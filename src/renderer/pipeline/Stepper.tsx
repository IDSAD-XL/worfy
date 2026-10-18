// The stepper of a Ticket (ADR-0067; CONTEXT.md, terms Pipeline and Stage): one dot per Stage of
// the Project's Pipeline — passed, current, future, and a Check passed by a `skipped` mark drawn
// apart — then the current Stage's name and who the Ticket waits for. `blocked` is a flag on the
// current step with its reason in the tooltip; `rework` (Implementing again after a failed mark) is
// a flag on Implementing. A narrow one shows only the current Stage and «N/M»: when the caller says
// so, and when the full one does not fit — the dots, the Stage's name and its flags measured in the
// box the stepper has, again whenever that box changes width. The Stage comes from main
// (`pipeline.get`, usePipeline.ts); the stepper only draws it.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PipelineColumn } from '../../shared/ipc/pipeline'
import type { TicketStage } from '../../shared/workflow/pipeline'
import './stepper.css'

export interface StepperProps {
  /** The Project's Pipeline, in order. */
  pipeline: readonly PipelineColumn[]
  /** The Ticket's Stage in it. */
  stage: TicketStage
  /** Only the current Stage and «N/M», without measuring: the row is known to have no room for the dots. */
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

const px = (value: string): number => parseFloat(value) || 0

/**
 * Whether `needs` pixels on screen run past an element's content box, in fractional pixels:
 * `scrollWidth` and `clientWidth` round to whole pixels and miss a cut under 1 px («Queued» needs
 * 42.66 px, gets 42, both read 50). The box is the element's rectangle less padding and border, on
 * screen like `needs`, where React Flow's zoom scales both alike.
 */
function runsPast(element: HTMLElement, needs: number): boolean {
  const box = element.getBoundingClientRect().width
  const style = getComputedStyle(element)
  const frame = px(style.paddingLeft) + px(style.paddingRight) + px(style.borderLeftWidth) + px(style.borderRightWidth)
  // The used content width in CSS pixels (box-sizing: content-box), against the box on screen: the zoom.
  const width = parseFloat(style.width)
  const scale = Number.isFinite(width) && width + frame > 0 ? box / (width + frame) : 1
  // Layout positions are multiples of 1/64 px: a smaller difference is rounding, not a cut.
  return needs > box - frame * scale + 0.01
}

/** Whether the text of the Stage's name is cut: a Range's rectangle keeps the whole width of text cut with «…». */
function labelCut(label: HTMLElement): boolean {
  const range = document.createRange()
  // No layout to measure (jsdom): nothing is cut.
  if (typeof range.getBoundingClientRect !== 'function') return false
  range.selectNodeContents(label)
  return runsPast(label, range.getBoundingClientRect().width)
}

/**
 * Whether the dots, the name and the flags run past the stepper's edge: from its first part's left
 * to its last part's right. The parts' own boxes, not their text: who it waits for is meant to be
 * cut with «…» inside its box.
 */
function partsRunPast(stepper: HTMLElement): boolean {
  const parts = Array.from(stepper.children, (part) => part.getBoundingClientRect())
  if (parts.length === 0) return false
  return runsPast(stepper, Math.max(...parts.map((part) => part.right)) - Math.min(...parts.map((part) => part.left)))
}

/** Whether the full stepper does not fit its box: the Stage's name is cut, or the dots and flags run past the edge. */
function overflows(stepper: HTMLElement): boolean {
  const label = stepper.querySelector<HTMLElement>('.w-stepper__label')
  return partsRunPast(stepper) || (label !== null && labelCut(label))
}

/** Everything the full stepper's width depends on, besides its box. */
const shapeOf = (pipeline: readonly PipelineColumn[], stage: TicketStage): string =>
  JSON.stringify([pipeline.map((column) => column.title), stage.index, stage.rework, stage.blocked !== null, stage.waits])

export default function Stepper({ pipeline, stage, narrow = false }: StepperProps) {
  const title = pipeline[stage.index]?.title ?? stage.stage
  const ref = useRef<HTMLSpanElement>(null)
  // What the full form was last measured for, and whether it overflowed. A stale measure draws the
  // full form, which the layout effect measures before the browser paints it.
  const shape = shapeOf(pipeline, stage)
  const [fit, setFit] = useState<{ shape: string; tight: boolean } | null>(null)
  const compact = narrow || (fit !== null && fit.shape === shape && fit.tight)
  useLayoutEffect(() => {
    if (narrow || ref.current === null || (fit !== null && fit.shape === shape)) return
    setFit({ shape, tight: overflows(ref.current) })
  }, [narrow, fit, shape])
  // The box changed width (the Card was resized, a chip beside it came or went): measure again.
  // Its width does not depend on the form drawn in it: the stepper takes the row's free space.
  useEffect(() => {
    const element = ref.current
    if (element === null || typeof ResizeObserver === 'undefined') return
    // Fractional, like the measure: a box narrower by less than a pixel can cut the name.
    const widthOf = () => element.getBoundingClientRect().width
    let width = widthOf()
    const observer = new ResizeObserver(() => {
      if (widthOf() === width) return
      width = widthOf()
      setFit(null)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return (
    <span
      ref={ref}
      className="w-stepper"
      data-testid="ticket-stepper"
      data-stage={stage.stage}
      data-kind={stage.kind}
      data-blocked={stage.blocked !== null ? 'true' : undefined}
      data-narrow={compact ? 'true' : undefined}
      title={stepperTitle(pipeline, stage)}
    >
      {compact ? null : (
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
        {stage.kind === 'done' ? (
          // The check of the shared done chip (theme/primitives.tsx): F-SPEC pairs done with it.
          <svg className="w-stepper__check" width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3.5 8.5l3 3 6-7" />
          </svg>
        ) : null}
        {title}
      </span>
      {stage.rework ? (
        // A mark like blocked's, so the Stage's name keeps the room; the tooltip says the word.
        <span className="w-stepper__flag w-stepper__flag--rework" data-testid="stepper-rework" role="img" aria-label="rework" title="rework: Implementing again after a failed mark">
          ↺
        </span>
      ) : null}
      {stage.blocked !== null ? (
        // A mark, not a word: the Card's own row below already reads «blocked» with the reason.
        <span className="w-stepper__flag w-stepper__flag--blocked" data-testid="stepper-blocked" role="img" aria-label="blocked" title={blockedTitle(stage.blocked.reason)}>
          !
        </span>
      ) : null}
      {compact ? (
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
