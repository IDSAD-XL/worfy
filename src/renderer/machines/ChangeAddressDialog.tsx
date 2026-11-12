// "Change address…" of a Linked machine (worfy-link ticket 37): the address or name and port typed
// by hand, saved through `link.setAddress` (worfy-link ticket 36). Main keeps it only where the
// certificate the Machine was linked with answers; a refusal — another certificate, no answer — is
// shown in the window as main words it, and the address stays as it was.
//
// The frame of this window (MachineDialogFrame) is the frame of the Remove confirmation too
// (MachineDialogs.tsx): a modal Dialog of the kit above Settings, closed by Esc or a click outside.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { formatLinkAddress, parseLinkAddress } from '../../shared/ipc/link'
import { Button } from '../theme/Button'
import { Dialog } from '../theme/kit/Dialog'
import { dialogStyles, MACHINE_WINDOW_LAYER } from './machine-dialogs'
import { setMachineAddress } from './useMachines'

export interface MachineDialogFrameProps {
  title: string
  testId: string
  onClose: () => void
  /** The control that gets the focus when the window opens; the window itself without one. */
  initialFocus?: () => HTMLElement | null
  children: ReactNode
}

/**
 * A modal window of a Linked machine on the kit's Dialog (theme/kit/Dialog.tsx): Esc and a click
 * outside close it, as "Link a machine" does; Tab stays inside, and the focus goes back to what
 * opened it. Its layer is above Settings (MACHINE_WINDOW_LAYER).
 */
export function MachineDialogFrame({ title, testId, onClose, initialFocus, children }: MachineDialogFrameProps) {
  const titleId = useId()
  return (
    <Dialog open onClose={onClose} labelledBy={titleId} className="w-machine-dialog" style={dialogStyles.dialog} layer={MACHINE_WINDOW_LAYER} initialFocus={initialFocus} data-testid={testId}>
      <h2 id={titleId} style={dialogStyles.title}>
        {title}
      </h2>
      {children}
    </Dialog>
  )
}

export interface ChangeAddressDialogProps {
  machine: { id: string; name: string }
  onClose: () => void
}

export function ChangeAddressDialog({ machine, onClose }: ChangeAddressDialogProps) {
  const [address, setAddress] = useState('')
  const [error, setError] = useState<string>()
  const [saving, setSaving] = useState(false)
  const fieldId = useId()
  const field = useRef<HTMLInputElement>(null)
  // An answer after the window closed changes nothing on screen; main has kept or refused it anyway.
  const open = useRef(true)

  useEffect(
    () => () => {
      open.current = false
    },
    [],
  )

  const save = async (): Promise<void> => {
    if (saving) return
    const parsed = parseLinkAddress(address)
    if (!parsed.ok) return setError(parsed.error)
    setSaving(true)
    setError(undefined)
    const result = await setMachineAddress(machine.id, formatLinkAddress(parsed.address))
    if (!open.current) return
    setSaving(false)
    if ('reason' in result) {
      setError(result.reason)
      field.current?.focus()
    } else onClose()
  }

  return (
    <MachineDialogFrame title={`Change address of ${machine.name}`} testId="change-address-dialog" onClose={onClose} initialFocus={() => field.current}>
      <div style={dialogStyles.field}>
        <label htmlFor={fieldId} style={dialogStyles.label}>
          Address
        </label>
        <input
          ref={field}
          id={fieldId}
          type="text"
          spellCheck={false}
          autoComplete="off"
          style={dialogStyles.input}
          value={address}
          placeholder="192.168.1.20:52000"
          data-testid="change-address-input"
          aria-invalid={error !== undefined}
          aria-describedby={error ? `${fieldId}-hint ${fieldId}-error` : `${fieldId}-hint`}
          onChange={(event) => {
            setAddress(event.target.value)
            setError(undefined)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void save()
          }}
        />
        <span id={`${fieldId}-hint`} style={dialogStyles.hint}>
          {`The IP address or name of ${machine.name} and its port, like 192.168.1.20:52000 or someones-mac.local:52000. worfy keeps it only if ${machine.name} answers there as the machine you linked.`}
        </span>
        {error ? (
          <span id={`${fieldId}-error`} role="alert" data-testid="change-address-error" style={dialogStyles.error}>
            {error}
          </span>
        ) : null}
      </div>
      <div style={dialogStyles.actions}>
        <span style={{ flex: 1 }} />
        <Button onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" disabled={saving || address.trim() === ''} onClick={() => void save()}>
          {saving ? 'Checking…' : 'Save'}
        </Button>
      </div>
    </MachineDialogFrame>
  )
}
