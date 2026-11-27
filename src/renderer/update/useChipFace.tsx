import { useState, type ReactNode } from 'react'
import type { UpdateSnapshot } from '../../shared/ipc/update'
import { buildVersionTooltip, numberedVersion } from '../../shared/version-number'
import { buildStepText, elapsedText, updateVersionLabel, useTicking, useUpdateStore } from './store'
import { UPDATE_TEXT, updateSignal, type Phase } from './update-signal'

// What the version chip of the footer (shell/footer/VersionChip.tsx) shows for an Update snapshot: see
// UpdateChip.tsx, whose comment names each case.

/** The spinner of an Update under way; it stands still with reduced motion (shell.css). */
const spinner = <span className="w-update-spinner" aria-hidden="true" />

export interface ChipFace {
  /** What the chip shows: the version, or the spinner and the step of an Update under way. */
  content: ReactNode
  /** The Update's own lines of the tooltip (the step, its text and time, the build version); undefined: none. */
  tooltip: string | undefined
  /** `data-update` of the chip: the phase, `restarting`, or undefined without an Update. */
  phase: Phase | 'restarting' | undefined
  /** Whether the dot has its place: not while a spinner stands there. */
  dotShown: boolean
  /** The pointer and the focus on the chip, for the elapsed time. */
  handlers: { onMouseEnter: () => void; onMouseLeave: () => void; onFocus: () => void; onBlur: () => void }
}

/** What the version chip shows for a snapshot. */
export function useChipFace({ version, number, update, now = Date.now }: { version: string; number?: number | undefined; update: UpdateSnapshot | null; now?: () => number }): ChipFace {
  // The pointer or the focus on the chip: its tooltip may be open, so the elapsed time counts on.
  const [pointed, setPointed] = useState(false)
  const [focused, setFocused] = useState(false)
  const starting = useUpdateStore((store) => store.starting)
  const signal = updateSignal(update)
  const shown = numberedVersion(version, number)
  const build = update?.build
  const startedAt = signal?.phase === 'building' ? build?.startedAt : undefined
  const time = useTicking(startedAt !== undefined && (pointed || focused), now)
  const handlers = { onMouseEnter: () => setPointed(true), onMouseLeave: () => setPointed(false), onFocus: () => setFocused(true), onBlur: () => setFocused(false) }
  const built = buildVersionTooltip(version, number)
  if (update?.enabled === true && update.restarting) {
    return { content: <>{spinner}Restarting…</>, tooltip: built, phase: 'restarting', dotShown: false, handlers }
  }
  // The chip stays one button whatever the Update does, so its mouseleave and blur always come: the
  // pointer and the focus need no reset when the Update goes.
  if (signal === null) return { content: `v${shown}`, tooltip: built, phase: undefined, dotShown: true, handlers }
  const step = build === undefined ? undefined : buildStepText(build)
  // Under way: pressed here and not answered yet, or begun and before its first step, or at a step.
  const progress = step !== undefined ? `Updating · ${step}` : starting || signal.phase === 'building' ? 'Starting update…' : undefined
  const said = UPDATE_TEXT[signal.phase](updateVersionLabel(update, signal.version)) + (startedAt === undefined ? '' : ` ${elapsedText(startedAt, time)}`)
  const lines = [progress, said, built].filter((line): line is string => line !== undefined).join('\n')
  if (progress === undefined) return { content: `v${shown}`, tooltip: lines, phase: signal.phase, dotShown: true, handlers }
  return {
    content: (
      <>
        {spinner}
        <span className="w-footer__chip-step">{progress}</span>
        {/* The version alone in a window up to 1100 px wide (shell.css draws it from the attribute): the chip's text stays the step. */}
        <span className="w-footer__chip-narrow" data-version={`v${shown}`} aria-hidden="true" />
      </>
    ),
    tooltip: lines,
    phase: signal.phase,
    dotShown: false,
    handlers,
  }
}
