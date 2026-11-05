import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type RefObject } from 'react'
import type { ModelOption, SettingsChange } from '../../../shared/agent/settings'
import { invoke } from '../../ipc'
import { useReadOnly } from '../../projects/useProjects'
import { Select, SelectChevron, type SelectOption } from '../../theme/Select'
import { useSessionControls } from '../store'
import { useCapabilities } from '../useCapabilities'
import type { ComposerItemProps } from './index'

// The model, effort and permission mode of the Session, under its input field (ticket 19). A
// change goes to main (`agent.configure`), which applies it to the live Session without a restart
// and to every later start of it; the pickers then show what main reports (`settings` events).
// The models come from the Session's Vendor (`agent.models`: Claude Code's supportedModels(), Codex's
// `model/list`, or the model of the last system/init). Claude Code does not report the effort it
// applies (ticket 06), so the effort shown is the level worfy asked for.
//
// What the pickers offer is the Vendor's (`agent.capabilities`, src/shared/vendors/capabilities.ts;
// worfy-multi-vendor ticket 25): the permission presets with the Vendor's labels and descriptions, the
// effort levels in its order. What the Vendor cannot do is shown inactive, its reason in the tooltip:
// a Vendor whose model change does not hold mid-Session (`modelSwitchStable`) has the model picker
// inactive. The interface never names a Vendor: a Session whose capabilities main cannot give is
// taken for Claude Code's, as a Session Node saved without a Vendor is.
//
// The model and the permission mode are lists on the shared Select (theme/Select.tsx). The effort
// is a slider in a popover of its button, with the levels of the picked model as its marks.

export const order = 10

/** The Select value of the default model, which setModel() takes as undefined; `data-value` of the effort button on the model's default too. */
const DEFAULT_VALUE = ''

/** The thumb of the effort slider rests this long before its level is sent. */
const EFFORT_REST_MS = 600

/** A mark of the effort slider: a level, or null for the model's default. */
type EffortMark = string | null
const markName = (mark: EffortMark): string => mark ?? 'default'

/**
 * The marks of the effort slider, left to right: the model's default, then the levels in the
 * Vendor's order (`order`, its `effortLevels`; a level it does not list goes after them) — those the
 * picked model takes, and two more where the model does not list them: the saved level, and the
 * level the thumb was moved to (the list of models may arrive after the thumb moved, and the popover
 * must go on showing the level it will send). No marks at all when there is no level to offer.
 */
function effortMarks(order: readonly string[], efforts: readonly string[], saved: string | null, moved: EffortMark): EffortMark[] {
  const wanted = new Set([...efforts, ...(saved === null ? [] : [saved]), ...(moved === null ? [] : [moved])])
  const levels = [...order.filter((level) => wanted.has(level)), ...[...wanted].filter((level) => !order.includes(level))]
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

/**
 * Which of the captions "Model" and "Permissions" the pickers show, and "Modes" of the button next
 * to them in the Orchestrator's bar (Modes.tsx; session.css hides it by the pickers' state).
 */
interface Captions {
  model: boolean
  permissions: boolean
  modes: boolean
}
const ALL_CAPTIONS: Captions = { model: true, permissions: true, modes: true }
const NO_CAPTIONS: Captions = { model: false, permissions: false, modes: false }
/**
 * From the most captions to none. The Modes caption goes first: the button keeps its icons and its
 * tooltip, and its caption gives the pickers room (a bar without the button gets none from it).
 * A bar too narrow cuts the model's value first (session.css), so its caption is the next to go.
 * Each step only gives the values more room, so as the window narrows a caption goes once and stays
 * gone.
 */
const CAPTION_STEPS: readonly Captions[] = [ALL_CAPTIONS, { model: true, permissions: true, modes: false }, { model: false, permissions: true, modes: false }, NO_CAPTIONS]

/** The `data-probe` of the pickers that lays them out with these captions (session.css); "natural": all of them, at full width. */
const probeOf = (captions: Captions | 'natural'): string =>
  captions === 'natural'
    ? 'natural'
    : [captions.model ? '' : 'model', captions.permissions ? '' : 'permissions', captions.modes ? '' : 'modes'].filter((token) => token !== '').join(' ') || 'all'

/**
 * The captions the pickers show, and a ref for their element: the first of CAPTION_STEPS with which
 * no value of a button is cut; none when a value is cut even without them. Each step is laid out and
 * read before the page paints, at a width that does not depend on the captions: while a step is
 * laid out, the pickers' full width with every caption is pinned on their element
 * (--w-pickers-width) and their line does not break (session.css), so the line gives them the room
 * it gives them next to the Modes button and the send group, and that room alone picks the step.
 * Read at the width a step makes itself, a caption would go, free the room it needed, come back and
 * go again.
 */
function useCaptions(): { ref: RefObject<HTMLSpanElement | null>; captions: Captions } {
  const ref = useRef<HTMLSpanElement>(null)
  const [captions, setCaptions] = useState<Captions>(ALL_CAPTIONS)
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
    // Written only when it changes: a size changed inside a ResizeObserver's callback that the
    // observer then has to report again is the "ResizeObserver loop" error.
    if (pickers.style.getPropertyValue('--w-pickers-width') !== `${full}px`) pickers.style.setProperty('--w-pickers-width', `${full}px`)
    const whole = (step: Captions): boolean => {
      pickers.dataset['probe'] = probeOf(step)
      return values.every((value) => value.scrollWidth <= value.clientWidth)
    }
    const chosen = CAPTION_STEPS.find(whole) ?? NO_CAPTIONS
    delete pickers.dataset['probe']
    setCaptions((now) => (now.model === chosen.model && now.permissions === chosen.permissions && now.modes === chosen.modes ? now : chosen))
  }, [])
  // After every render: a new value changes the widths before the page paints.
  useLayoutEffect(measure)
  useLayoutEffect(() => {
    const pickers = ref.current
    if (pickers === null || typeof ResizeObserver === 'undefined') return
    // The pickers' own width follows the room they are given; a button's follows its value (the
    // effort's level). Their line too: with room to spare the pickers are only as wide as what they
    // show, and a wider line can bring a caption back without changing their width.
    // A measure lays the pickers out for each step: done in the observer's callback, the sizes it
    // changes on the way are left for the observer to report again ("ResizeObserver loop completed
    // with undelivered notifications"). So the callback asks for one measure in the next frame.
    let frame: number | null = null
    const observer = new ResizeObserver(() => {
      frame ??= requestAnimationFrame(() => {
        frame = null
        measure()
      })
    })
    observer.observe(pickers)
    for (const child of pickers.children) observer.observe(child)
    const line = pickers.closest('.w-composer__line')
    if (line !== null) observer.observe(line)
    return () => {
      observer.disconnect()
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [measure])
  return { ref, captions }
}

interface EffortPickerProps {
  /** The level main reports; null: the model's default. */
  effort: string | null
  /** The levels the picked model takes; every level of the Vendor while the list of models is empty. */
  efforts: readonly string[]
  /** The Vendor's effort levels, lowest first: the order of the marks. */
  order: readonly string[]
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
function EffortPicker({ effort, efforts, order, disabled, configure }: EffortPickerProps) {
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
  const marks = effortMarks(order, efforts, effort, moved !== undefined ? moved.mark : null)
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
  const { models, refresh: refreshModels } = useModels(sessionId)
  const { capabilities, refresh: refreshCapabilities } = useCapabilities(sessionId)
  const refresh = () => {
    refreshModels()
    refreshCapabilities()
  }
  const [error, setError] = useState<string | null>(null)
  // On a read-only screen (worfy-link ticket 25) the pickers show the settings and change nothing.
  const readOnly = useReadOnly()
  const disabled = sessionId === null || settings === null || capabilities === undefined || readOnly !== null
  const { ref, captions } = useCaptions()
  // A capability the Vendor lacks: the picker is inactive, and its tooltip says why.
  const modelReason = capabilities?.modelSwitchStable === false ? capabilities.unsupported.modelSwitchStable : undefined
  const presets = capabilities?.permissionPresets ?? []
  const presetOptions: SelectOption[] = presets.map((preset) => ({ value: preset.id, label: preset.label, title: preset.description }))
  const permissionMode = settings?.permissionMode ?? presets[0]?.id ?? ''
  const permissionLabel = presets.find((preset) => preset.id === permissionMode)?.label ?? permissionMode
  const effortOrder = capabilities?.effortLevels ?? []

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
  // While the list of models is empty (it has not arrived, or main could not get it) every level of the Vendor is on offer.
  const efforts = models.length === 0 ? effortOrder : (rows.find((row) => row.value === model)?.efforts ?? [])
  const effort = settings?.effort ?? null
  /** A model change; an effort level the new model does not list goes back to the model's default with it. */
  const modelChange = (next: string | null): SettingsChange => {
    const target = models.find((row) => row.value === next)
    return target !== undefined && effort !== null && !target.efforts.includes(effort) ? { model: next, effort: null } : { model: next }
  }

  return (
    <span ref={ref} className="w-pickers" data-testid="pickers" data-modes-caption={captions.modes ? undefined : 'off'}>
      {/* A caption goes where a value would be cut with it; a value still cut is in its button's title in full. */}
      <Select
        className={`w-pickers__select w-pickers__select--model${captions.model ? '' : ' w-pickers__select--bare'}`}
        aria-label="Model"
        data-testid="picker-model"
        prefix="Model"
        title={readOnly ?? modelReason ?? modelOptions.find((option) => option.value === (model ?? DEFAULT_VALUE))?.label}
        mono
        disabled={disabled || modelReason !== undefined}
        value={model ?? DEFAULT_VALUE}
        options={modelOptions}
        onOpen={refresh}
        onChange={(next) => configure(modelChange(next === DEFAULT_VALUE ? null : next))}
      />
      {/* A thumb moved in one Session never goes to another: the picker starts anew with the Session. */}
      <EffortPicker key={sessionId ?? ''} effort={effort} efforts={efforts} order={effortOrder} disabled={disabled} configure={configure} />
      <Select
        className={`w-pickers__select w-pickers__select--permissions${captions.permissions ? '' : ' w-pickers__select--bare'}`}
        aria-label="Permission mode"
        data-testid="picker-permissions"
        prefix="Permissions"
        title={readOnly ?? permissionLabel}
        disabled={disabled}
        value={permissionMode}
        options={presetOptions}
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
