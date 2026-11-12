import { Dialog } from '@base-ui/react/dialog'
import { Menu } from '@base-ui/react/menu'
import { Popover } from '@base-ui/react/popover'
import { Tooltip } from '@base-ui/react/tooltip'
import { useEffect, useState, type ReactElement } from 'react'
import { create } from 'zustand'
import { Select } from '../theme/Select'
import { SelectPortalContext } from '../theme/select-portal'
import './spike.css'

/*
 * Spike worfy-ui-kit 01 — a throwaway branch, never merged into main. Base UI probes over the real
 * app: Dialog, Popover, Menu and Tooltip over the Canvas, in every Node (Canvas and focus-mode tile),
 * next to Terminal and Browser, and over Settings; three ways of the app's own Select inside a modal
 * Dialog. Nothing shows until a test calls `window.__worfySpike.enable()`, so the other e2e spec
 * files run against the app as it is, with Base UI in the bundle (the start budget counts it).
 * Every open and close is logged with Base UI's reason; test/e2e/spike-base-ui.spec.ts reads the log.
 */

interface SpikeState {
  enabled: boolean
}

const useSpike = create<SpikeState>(() => ({ enabled: false }))

export interface SpikeEntry {
  probe: string
  open: boolean
  reason: string
  /** Read after Base UI's own handler ran: whether the native event was marked handled. */
  defaultPrevented?: boolean
  canceled?: boolean
}

const log: SpikeEntry[] = []
/** Esc presses that reached a bubble listener on window, with defaultPrevented at that point. */
const escapes: { defaultPrevented: boolean; target: string }[] = []

const describe = (target: EventTarget | null): string => {
  if (!(target instanceof HTMLElement)) return String(target)
  return target.dataset.testid ?? `${target.tagName.toLowerCase()}.${target.className}`
}

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') escapes.push({ defaultPrevented: event.defaultPrevented, target: describe(event.target) })
})

;(window as unknown as { __worfySpike: unknown }).__worfySpike = {
  enable: () => useSpike.setState({ enabled: true }),
  log,
  escapes,
  active: () => describe(document.activeElement),
}

interface Details {
  reason: string
  event: Event
  cancel: () => void
  isCanceled: boolean
}

function record(probe: string, open: boolean, details: Details): void {
  const entry: SpikeEntry = { probe, open, reason: details.reason, canceled: details.isCanceled }
  log.push(entry)
  // Base UI calls preventDefault after onOpenChange returns.
  setTimeout(() => {
    entry.defaultPrevented = details.event?.defaultPrevented
  }, 0)
}

/** The kit's planned "close on window blur", for the probes that ask for it. */
function useCloseOnBlur(open: boolean, enabled: boolean, close: () => void): void {
  useEffect(() => {
    if (!open || !enabled) return
    const onBlur = (): void => {
      log.push({ probe: 'window', open: false, reason: 'window-blur' })
      close()
    }
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [open, enabled, close])
}

/** Popups are drawn above Settings (110), focus mode (1000) and the Select list (3000). */
const POPUP_LAYER = 3100
/** A kit Dialog sits below the Select list, as the z-index scale of the spec puts it. */
const DIALOG_LAYER = 200
/**
 * The portal's z-index works only on a positioned box: run 43129431332 had `zIndex` alone, and the
 * Settings backdrop (z-index 110, positioned) covered the popover of Settings.
 */
const LAYER_STYLE = { position: 'relative', zIndex: POPUP_LAYER } as const

export function ProbePopover({ id, closeOnBlur = false, label = 'Popover' }: { id: string; closeOnBlur?: boolean; label?: string }): ReactElement {
  const [open, setOpen] = useState(false)
  useCloseOnBlur(open, closeOnBlur, () => setOpen(false))
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next, details) => {
        record(id, next, details)
        setOpen(next)
      }}
    >
      <Popover.Trigger className="w-spike-button nodrag" data-testid={`${id}-trigger`}>
        {label}
      </Popover.Trigger>
      <Popover.Portal className="w-spike-portal" style={LAYER_STYLE}>
        <Popover.Positioner sideOffset={6}>
          <Popover.Popup className="w-spike-popup nodrag nopan nowheel" data-testid={`${id}-popup`}>
            <Popover.Title className="w-spike-title">{label} probe</Popover.Title>
            <input className="w-spike-input" aria-label={`${label} field`} data-testid={`${id}-input`} />
            <Popover.Close className="w-spike-button" data-testid={`${id}-close`}>
              Close
            </Popover.Close>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

export function ProbeMenu({ id, modal = true, nodrag = true, label = 'Menu' }: { id: string; modal?: boolean; nodrag?: boolean; label?: string }): ReactElement {
  const [open, setOpen] = useState(false)
  const [chosen, setChosen] = useState('')
  return (
    <Menu.Root
      open={open}
      modal={modal}
      onOpenChange={(next, details) => {
        record(id, next, details)
        setOpen(next)
      }}
    >
      <Menu.Trigger className={nodrag ? 'w-spike-button nodrag' : 'w-spike-button'} data-testid={`${id}-trigger`} data-chosen={chosen}>
        {label}
      </Menu.Trigger>
      <Menu.Portal className="w-spike-portal" style={LAYER_STYLE}>
        <Menu.Positioner sideOffset={6}>
          <Menu.Popup className="w-spike-popup nodrag nopan nowheel" data-testid={`${id}-popup`}>
            {['One', 'Two', 'Three'].map((item) => (
              <Menu.Item key={item} className="w-spike-item" onClick={() => setChosen(item)}>
                {item}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}

export function ProbeTooltip({ id }: { id: string }): ReactElement {
  return (
    <Tooltip.Root onOpenChange={(next, details) => record(id, next, details)}>
      <Tooltip.Trigger delay={100} className="w-spike-button nodrag" data-testid={`${id}-trigger`} aria-label="Tooltip probe">
        ?
      </Tooltip.Trigger>
      <Tooltip.Portal className="w-spike-portal" style={LAYER_STYLE}>
        <Tooltip.Positioner sideOffset={6}>
          <Tooltip.Popup className="w-spike-tip" data-testid={`${id}-popup`}>
            Tooltip probe
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

const OPTIONS = [
  { value: 'alpha', label: 'Alpha' },
  { value: 'beta', label: 'Beta' },
  { value: 'gamma', label: 'Gamma' },
] as const

/**
 * A kit-like modal window with the app's own Select inside. The three ways of the spec:
 * `body` — as on main, the list in document.body (modal: true); `inside` — the list drawn inside the
 * open window (SelectPortalContext); `trap` — the list in document.body, the window opened with
 * modal 'trap-focus'.
 */
export function ProbeDialog({ id, way }: { id: string; way: 'body' | 'inside' | 'trap' }): ReactElement {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState<string>('alpha')
  const [popup, setPopup] = useState<HTMLElement | null>(null)
  return (
    <Dialog.Root
      open={open}
      modal={way === 'trap' ? 'trap-focus' : true}
      onOpenChange={(next, details) => {
        record(id, next, details)
        setOpen(next)
      }}
    >
      <Dialog.Trigger className="w-spike-button" data-testid={`${id}-trigger`}>
        Dialog ({way})
      </Dialog.Trigger>
      <Dialog.Portal className="w-spike-portal" style={{ position: 'relative', zIndex: DIALOG_LAYER }}>
        <Dialog.Backdrop className="w-spike-backdrop" />
        <Dialog.Popup ref={setPopup} className="w-spike-dialog" data-testid={`${id}-popup`}>
          <Dialog.Title className="w-spike-title">Dialog probe ({way})</Dialog.Title>
          <label className="w-spike-row">
            <span>Field</span>
            <input className="w-spike-input" data-testid={`${id}-input`} />
          </label>
          <div className="w-spike-row">
            <span id={`${id}-select-label`}>Choice</span>
            <SelectPortalContext.Provider value={way === 'inside' ? popup : null}>
              <Select value={value} options={OPTIONS} onChange={setValue} aria-label="Choice" data-testid={`${id}-select`} />
            </SelectPortalContext.Provider>
          </div>
          <output data-testid={`${id}-value`}>{value}</output>
          <ProbePopover id={`${id}-popover`} label="Nested" />
          <Dialog.Close className="w-spike-button" data-testid={`${id}-close`}>
            Close
          </Dialog.Close>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** The probes over the Canvas: a strip in the bottom left corner of the window. */
export function SpikeToolbar(): ReactElement | null {
  const enabled = useSpike((state) => state.enabled)
  if (!enabled) return null
  return (
    <div className="w-spike-toolbar" data-testid="spike-toolbar">
      <ProbePopover id="spike-popover" />
      <ProbePopover id="spike-popover-blur" closeOnBlur label="Popover+blur" />
      <ProbeMenu id="spike-menu" />
      <ProbeTooltip id="spike-tooltip" />
      <ProbeDialog id="spike-dialog-body" way="body" />
      <ProbeDialog id="spike-dialog-inside" way="inside" />
      <ProbeDialog id="spike-dialog-trap" way="trap" />
    </div>
  )
}

/** The probes inside a Node, on the Canvas and in a focus-mode tile: top right of the Node. */
export function SpikeNodeProbes({ nodeId, where }: { nodeId: string; where: 'canvas' | 'tile' }): ReactElement | null {
  const enabled = useSpike((state) => state.enabled)
  if (!enabled) return null
  const id = `spike-${where}-${nodeId}`
  return (
    <div className="w-spike-node" data-testid="spike-node-probes" data-node-id={nodeId} data-where={where}>
      <ProbeMenu id={`${id}-menu`} label="M" />
      <ProbeMenu id={`${id}-menu-nm`} modal={false} label="m" />
      <ProbeMenu id={`${id}-grip`} nodrag={false} label="⋮" />
      <ProbePopover id={`${id}-popover`} label="P" />
      <ProbePopover id={`${id}-popover-blur`} closeOnBlur label="Pb" />
      <ProbeTooltip id={`${id}-tip`} />
    </div>
  )
}

/** The probes inside Settings, next to its Close button. */
export function SpikeSettingsProbes(): ReactElement | null {
  const enabled = useSpike((state) => state.enabled)
  if (!enabled) return null
  return (
    <>
      <ProbePopover id="spike-settings-popover" />
      <ProbeMenu id="spike-settings-menu" />
    </>
  )
}
