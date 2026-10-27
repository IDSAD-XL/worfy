// "Change address…" of a Linked machine (worfy-link ticket 37): the address or name and port typed
// by hand, saved through `link.setAddress` (worfy-link ticket 36). Main keeps it only where the
// certificate the Machine was linked with answers; a refusal — another certificate, no answer — is
// shown in the window as main words it, and the address stays as it was.
//
// The frame of this window (MachineDialogFrame) is the frame of the Remove confirmation too
// (MachineDialogs.tsx): a modal above every other layer, Settings included, closed by Esc or a click
// outside.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { formatLinkAddress, parseLinkAddress } from '../../shared/ipc/link'
import { PrimaryButton } from '../theme/primitives'
import { dialogStyles } from './machine-dialogs'
import { setMachineAddress } from './useMachines'

export interface MachineDialogFrameProps {
  title: string
  testId: string
  onClose: () => void
  children: ReactNode
}

/** A modal window of a Linked machine: Esc and a click outside close it, as "Link a machine" does. */
export function MachineDialogFrame({ title, testId, onClose, children }: MachineDialogFrameProps) {
  const titleId = useId()
  return createPortal(
    <div
      style={dialogStyles.backdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={dialogStyles.dialog}
        data-testid={testId}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onClose()
          }
        }}
      >
        <h2 id={titleId} style={dialogStyles.title}>
          {title}
        </h2>
        {children}
      </div>
    </div>,
    document.body,
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

  useEffect(() => {
    field.current?.focus()
    return () => {
      open.current = false
    }
  }, [])

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
    <MachineDialogFrame title={`Change address of ${machine.name}`} testId="change-address-dialog" onClose={onClose}>
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
          {`The IP address or name of ${machine.name} and its port, like 192.168.1.20:52000 or studio.local:52000. worfy keeps it only if ${machine.name} answers there as the machine you linked.`}
        </span>
        {error ? (
          <span id={`${fieldId}-error`} role="alert" data-testid="change-address-error" style={dialogStyles.error}>
            {error}
          </span>
        ) : null}
      </div>
      <div style={dialogStyles.actions}>
        <span style={{ flex: 1 }} />
        <button type="button" style={dialogStyles.secondary} onClick={onClose}>
          Cancel
        </button>
        <PrimaryButton disabled={saving || address.trim() === ''} onClick={() => void save()}>
          {saving ? 'Checking…' : 'Save'}
        </PrimaryButton>
      </div>
    </MachineDialogFrame>
  )
}
