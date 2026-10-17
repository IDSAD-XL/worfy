import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type RefObject } from 'react'
import { EFFORT_LEVELS, PERMISSION_MODES, type EffortChoice, type ModelOption, type PermissionModeChoice, type SettingsChange } from '../../../shared/agent/settings'
import { invoke } from '../../ipc'
import { useReadOnly } from '../../projects/useProjects'
import { Select, SelectChevron, type SelectOption } from '../../theme/Select'
import { useSessionControls } from '../store'
import type { ComposerItemProps } from './index'

// The model, effort and permission mode of the Session, under its input field (ticket 19). A
// change goes to main (`agent.configure`), which applies it to the live Session without a restart
// and to every later start of it; the pickers then show what main reports (`settings` events).
// The models come from Claude Code (`agent.models`: supportedModels(), or the model of the last
// system/init). Claude Code does not report the effort it applies (ticket 06), so the effort
// shown is the level worfy asked for.
//
// The model and the permission mode are lists on the shared Select (theme/Select.tsx). The effort
// is a slider in a popover of its button, with the levels of the picked model as its marks.

export const order = 10

const MODE_LABELS: Record<PermissionModeChoice, string> = {
  bypassPermissions: 'Bypass permissions',
  acceptEdits: 'Accept edits',
  default: 'Ask before tools',
  plan: 'Plan only',
}
const MODE_OPTIONS: SelectOption<PermissionModeChoice>[] = PERMISSION_MODES.map((mode) => ({ value: mode, label: MODE_LABELS[mode] }))

/** The Select value of the default model, which setModel() takes as undefined; `data-value` of the effort button on the model's default too. */
const DEFAULT_VALUE = ''

/** The thumb of the effort slider rests this long before its level is sent. */
const EFFORT_REST_MS = 600

/** A mark of the effort slider: a level, or null for the model's default. */
type EffortMark = EffortChoice | null
const markName = (mark: EffortMark): string => mark ?? 'default'

/**
 * The marks of the effort slider, left to right: the model's default, then the levels in the order
 * of EFFORT_LEVELS — those the picked model takes, and two more where the model does not list
 * them: the saved level, and the level the thumb was moved to (the list of models may arrive after
 * the thumb moved, and the popover must go on showing the level it will send). No marks at all
 * when there is no level to offer.
 */
function effortMarks(efforts: readonly EffortChoice[], saved: EffortChoice | null, moved: EffortMark): EffortMark[] {
  const levels = EFFORT_LEVELS.filter((level) => efforts.includes(level) || level === saved || level === moved)
  return levels.length === 0 ? [] : [null, ...levels]
}

/** The models of a Session; fetched again when the list opens, as it may grow after the first turn. */
function useModels(sessionId: string | null): { models: readonly ModelOption[]; refresh: () => void } {
  const [found, setFound] = useState<{ sessionId: string; models: readonly ModelOption[] } | null>(null)
  const refresh = useCallback(() => {
    if (sessionId === null) return
    void invoke('agent.models', { sessionId }).then((result) => {
      if (result.ok) setFound({ sessionId, models: result.value.models })
      else console.error(`agent.models ${sessionId} failed:`, result.error)
    })
  }, [sessionId])
  useEffect(refresh, [refresh])
  return { models: found !== null && found.sessionId === sessionId ? found.models : [], refresh }
}

/** Which of the captions "Model" and "Permissions" the pickers show. */
interface Captions {
  model: boolean
  permissions: boolean
}
const BOTH_CAPTIONS: Captions = { model: true, permissions: true }
const NO_CAPTIONS: Captions = { model: false, permissions: false }
/**
 * From the most captions to none. A bar too narrow cuts the model's value first (session.css), so
 * its caption is the first to go. Each step only gives the values more room, so as the window
 * narrows a caption goes once and stays gone.
 */
const CAPTION_STEPS: readonly Captions[] = [BOTH_CAPTIONS, { model: false, permissions: true }, NO_CAPTIONS]

/** The `data-probe` of the pickers that lays them out with these captions (session.css); "natural": all of them, at full width. */
const probeOf = (captions: Captions | 'natural'): string =>
  captions === 'natural' ? 'natural' : [captions.model ? '' : 'model', captions.permissions ? '' : 'permissions'].filter((token) => token !== '').join(' ') || 'all'

/**
 * The captions the pickers show, and a ref for their element: the first of CAPTION_STEPS with which
 * no value of a button is cut; none when a value is cut even without them. Each step is laid out and
 * read before the page paints, at a width that does not depend on the captions: the pickers' full
 * width with both captions is pinned on their element (--w-pickers-width), so the bar gives them
 * the room it gave them before any caption went, and that room alone picks the step. Read at the
 * width a step makes itself, a caption would go, free the room it needed, come back and go again.
 */
function useCaptions(): { ref: RefObject<HTMLSpanElement | null>; captions: Captions } {
  const ref = useRef<HTMLSpanElement>(null)
  const [captions, setCaptions] = useState<Captions>(BOTH_CAPTIONS)
  const measure = useCallback(() => {
    const pickers = ref.current
    if (pickers === null) return
    const values = [...pickers.querySelectorAll('.w-pickers__select .w-select__value')]
    pickers.dataset['probe'] = probeOf('natural')
    const full = pickers.getBoundingClientRect().width
    // Not laid out (a hidden view): nothing to measure; the next resize measures again.
    if (full === 0) {
      delete pickers.dataset['probe']
      return
    }
    pickers.style.setProperty('--w-pickers-width', `${full}px`)
    const whole = (step: Captions): boolean => {
      pickers.dataset['probe'] = probeOf(step)
      return values.every((value) => value.scrollWidth <= value.clientWidth)
    }
    const chosen = CAPTION_STEPS.find(whole) ?? NO_CAPTIONS
    delete pickers.dataset['probe']
    setCaptions((now) => (now.model === chosen.model && now.permissions === chosen.permissions ? now : chosen))
  }, [])
  // After every render: a new value changes the widths before the page paints.
  useLayoutEffect(measure)
  useLayoutEffect(() => {
    const pickers = ref.current
    if (pickers === null || typeof ResizeObserver === 'undefined') return
    // The pickers' own width follows the bar; a button's follows its value (the effort's level).
    const observer = new ResizeObserver(measure)
    observer.observe(pickers)
    for (const child of pickers.children) observer.observe(child)
    return () => observer.disconnect()
  }, [measure])
  return { ref, captions }
}

interface EffortPickerProps {
  /** The level main reports; null: the model's default. */
  effort: EffortChoice | null
  /** The levels the picked model takes; every level while the list of models is empty. */
  efforts: readonly EffortChoice[]
  disabled: boolean
  configure: (change: SettingsChange) => void
}

/**
 * The button "Effort <level>" and its popover with a slider. The button shows the level main
 * reports; the popover shows where the thumb is. ← and →, the mouse and touch move the thumb, and
 * one value goes to `configure`: when the popover closes (Esc, Enter, a press outside, the focus
 * leaving it), or EFFORT_REST_MS after the thumb last moved — never on a single move, and never a
 * level main already has. A picker that goes away with the thumb moved sends its level too.
 */
function EffortPicker({ effort, efforts, disabled, configure }: EffortPickerProps) {
  const popoverId = useId()
  const [open, setOpen] = useState(false)
  /** Where the user put the thumb since the popover opened; undefined: not moved, the thumb is on `effort`. */
  const [moved, setMoved] = useState<{ mark: EffortMark } | undefined>(undefined)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const sliderRef = useRef<HTMLInputElement | null>(null)
  const rest = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** The thumb's mark that was not sent yet. */
  const unsent = useRef<{ mark: EffortMark } | null>(null)
  /** The mark sent last since the popover opened: main may not have reported it yet. */
  const sent = useRef<{ mark: EffortMark } | null>(null)
  /** What the last render got, for the timer and the unmount. */
  const latest = useRef({ effort, configure })
  useEffect(() => {
    latest.current = { effort, configure }
  })

  // The mark the thumb was moved to stays a mark while the thumb stands on it, whatever the model
  // lists by now: the level shown is the level sent.
  const marks = effortMarks(efforts, effort, moved !== undefined ? moved.mark : null)
  const inactive = disabled || marks.length === 0
  // A picker that lost its levels (or its Session's settings) under an open popover closes it for
  // good. A thumb moved before the settings went is still sent when its rest is over.
  if (inactive && open) {
    setOpen(false)
    setMoved(undefined)
  }
  const shown = open && !inactive
  const position = moved !== undefined ? moved.mark : effort
  const index = Math.max(0, marks.indexOf(position))
  const name = markName(marks[index] ?? null)

  /** Sends the thumb's mark, unless main has it or it was sent already. */
  const send = useCallback((): void => {
    if (rest.current !== null) clearTimeout(rest.current)
    rest.current = null
    const waiting = unsent.current
    unsent.current = null
    if (waiting === null) return
    const known = sent.current !== null ? sent.current.mark : latest.current.effort
    if (waiting.mark === known) return
    sent.current = waiting
    latest.current.configure({ effort: waiting.mark })
  }, [])
  // The picker goes away (the view closes, the pickers turn to another Session): the level is not lost.
  useEffect(() => send, [send])

  const close = useCallback(
    (refocus: boolean): void => {
      send()
      setOpen(false)
      setMoved(undefined)
      if (refocus) buttonRef.current?.focus({ preventScroll: true })
    },
    [send],
  )

  const moveTo = (to: number): void => {
    const mark = marks[Math.min(Math.max(to, 0), marks.length - 1)]
    if (mark === undefined || mark === position) return
    unsent.current = { mark }
    setMoved({ mark })
    if (rest.current !== null) clearTimeout(rest.current)
    rest.current = setTimeout(send, EFFORT_REST_MS)
  }

  // The keys move the thumb here rather than in the native slider, so that every move takes one path.
  const onSliderKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    const target = ((): number | null => {
      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowUp':
        case 'PageUp':
          return index + 1
        case 'ArrowLeft':
        case 'ArrowDown':
        case 'PageDown':
          return index - 1
        case 'Home':
          return 0
        case 'End':
          return marks.length - 1
        default:
          return null
      }
    })()
    if (target !== null) {
      event.preventDefault()
      moveTo(target)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      close(true)
    }
  }

  // The slider takes the focus on opening: ← and → work at once.
  useEffect(() => {
    if (shown) sliderRef.current?.focus({ preventScroll: true })
  }, [shown])

  useEffect(() => {
    if (!shown) return
    const onPress = (event: Event): void => {
      const inside = event.target instanceof Node && (buttonRef.current?.parentElement?.contains(event.target) ?? false)
      if (!inside) close(false)
    }
    document.addEventListener('mousedown', onPress, true)
    return () => document.removeEventListener('mousedown', onPress, true)
  }, [shown, close])

  const last = marks.length - 1
  return (
    <span
      className="w-effort"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !shown) return
        // The press that closes the popover does nothing else: the focus mode does not get it.
        event.preventDefault()
        event.stopPropagation()
        close(true)
      }}
      onBlur={(event) => {
        // The focus left the button and the popover: Tab, another window.
        if (shown && !(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) close(false)
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className="w-select w-select--mono w-pickers__select"
        aria-label={inactive ? 'Effort' : `Effort: ${markName(effort)}`}
        aria-haspopup="dialog"
        aria-expanded={shown}
        aria-controls={shown ? popoverId : undefined}
        title="Claude Code does not report the effort it applies: this is the level worfy asked for"
        data-testid="picker-effort"
        data-value={effort ?? DEFAULT_VALUE}
        disabled={inactive}
        onClick={() => {
          if (shown) close(false)
          else {
            // What an earlier opening sent is main's by now, or was refused: the level main reports counts again.
            sent.current = null
            setOpen(true)
          }
        }}
      >
        <span className="w-select__prefix">Effort</span>
        <span className="w-select__value">{inactive ? '—' : markName(effort)}</span>
        <SelectChevron />
      </button>
      {shown ? (
        <div
          id={popoverId}
          role="dialog"
          aria-label="Effort"
          className="w-effort__popover"
          data-testid="effort-popover"
          // A press next to the slider keeps the focus on the slider.
          onMouseDown={(event) => {
            if (event.target !== sliderRef.current) event.preventDefault()
          }}
        >
          <div className="w-effort__head">
            <span className="w-effort__caption">Effort</span>
            {/* For the eye: a screen reader hears the mark as the slider's aria-valuetext. */}
            <span className="w-effort__current w-mono" aria-hidden="true" data-testid="effort-current">
              {name}
            </span>
          </div>
          <input
            ref={sliderRef}
            type="range"
            className="w-effort__slider"
            min={0}
            max={last}
            step={1}
            value={index}
            aria-label="Effort"
            aria-valuetext={name}
            data-testid="effort-slider"
            style={{ '--w-effort-fill': `${(index / last) * 100}%` } as CSSProperties}
            onChange={(event) => moveTo(Number(event.target.value))}
            onKeyDown={onSliderKey}
          />
          <div className="w-effort__marks" aria-hidden="true">
            {marks.map((mark, at) => (
              <span key={markName(mark)} className="w-effort__mark" data-testid="effort-mark" data-mark={markName(mark)} data-reached={at <= index ? '' : undefined} style={{ left: `${(at / last) * 100}%` }} />
            ))}
          </div>
          <div className="w-effort__ends w-mono" aria-hidden="true">
            <span>{markName(marks[0] ?? null)}</span>
            <span>{markName(marks[last] ?? null)}</span>
          </div>
        </div>
      ) : null}
    </span>
  )
}

export default function Pickers({ sessionId }: ComposerItemProps) {
  const { settings } = useSessionControls(sessionId)
  const { models, refresh } = useModels(sessionId)
  const [error, setError] = useState<string | null>(null)
  // On a read-only screen (worfy-link ticket 25) the pickers show the settings and change nothing.
  const readOnly = useReadOnly()
  const disabled = sessionId === null || settings === null || readOnly !== null
  const { ref, captions } = useCaptions()

  const configure = (change: SettingsChange) => {
    if (sessionId === null || readOnly !== null) return
    setError(null)
    void invoke('agent.configure', { sessionId, change }).then((result) => {
      if (!result.ok) setError(result.error)
    })
  }

  const model = settings?.model ?? null
  // A saved model Claude Code no longer lists still shows as picked.
  const rows = model !== null && !models.some((row) => row.value === model) ? [...models, { value: model, displayName: model, efforts: [] }] : models
  const modelOptions: SelectOption[] = [
    ...(rows.some((row) => row.value === null) ? [] : [{ value: DEFAULT_VALUE, label: 'Default model' }]),
    ...rows.map((row) => ({ value: row.value ?? DEFAULT_VALUE, label: row.displayName })),
  ]
  // While the list of models is empty (it has not arrived, or main could not get it) every level is on offer.
  const efforts = models.length === 0 ? EFFORT_LEVELS : (rows.find((row) => row.value === model)?.efforts ?? [])
  const effort = settings?.effort ?? null
  /** A model change; an effort level the new model does not list goes back to the model's default with it. */
  const modelChange = (next: string | null): SettingsChange => {
    const target = models.find((row) => row.value === next)
    return target !== undefined && effort !== null && !target.efforts.includes(effort) ? { model: next, effort: null } : { model: next }
  }

  return (
    <span ref={ref} className="w-pickers" data-testid="pickers">
      {/* A caption goes where a value would be cut with it; a value still cut is in its button's title in full. */}
      <Select
        className={`w-pickers__select w-pickers__select--model${captions.model ? '' : ' w-pickers__select--bare'}`}
        aria-label="Model"
        data-testid="picker-model"
        prefix="Model"
        title={readOnly ?? modelOptions.find((option) => option.value === (model ?? DEFAULT_VALUE))?.label}
        mono
        disabled={disabled}
        value={model ?? DEFAULT_VALUE}
        options={modelOptions}
        onOpen={refresh}
        onChange={(next) => configure(modelChange(next === DEFAULT_VALUE ? null : next))}
      />
      {/* A thumb moved in one Session never goes to another: the picker starts anew with the Session. */}
      <EffortPicker key={sessionId ?? ''} effort={effort} efforts={efforts} disabled={disabled} configure={configure} />
      <Select
        className={`w-pickers__select w-pickers__select--permissions${captions.permissions ? '' : ' w-pickers__select--bare'}`}
        aria-label="Permission mode"
        data-testid="picker-permissions"
        prefix="Permissions"
        title={readOnly ?? MODE_LABELS[settings?.permissionMode ?? 'bypassPermissions']}
        disabled={disabled}
        value={settings?.permissionMode ?? 'bypassPermissions'}
        options={MODE_OPTIONS}
        onChange={(mode) => configure({ permissionMode: mode })}
      />
      {error !== null ? (
        <span className="w-pickers__error" role="alert" title={error} data-testid="pickers-error">
          not applied
        </span>
      ) : null}
    </span>
  )
}
