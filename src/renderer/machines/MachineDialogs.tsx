// The windows of a Linked machine (worfy-link ticket 37): the confirmation of "Remove" and
// "Change address…". The sidebar's Machines section, Settings → Machines and the command palette
// open them through askRemoveMachine and openChangeAddress (machine-dialogs.ts), without importing a
// window; the shell (AppShell.tsx) shows the one open, so it is there with the sidebar hidden and
// over Settings too.
//
// "Remove" forgets the Machine on both sides (`link.revoke`: the other side loses the link at once
// when connected, else on its next connection); linking it again takes a new code. Nothing is
// called before the user confirms.
import { useEffect, useRef, useState } from 'react'
import { PrimaryButton } from '../theme/primitives'
import { ChangeAddressDialog, MachineDialogFrame } from './ChangeAddressDialog'
import { closeMachineDialog, dialogStyles, useMachineDialog } from './machine-dialogs'
import { revokeMachine, useMachines } from './useMachines'

export interface RemoveMachineDialogProps {
  machine: { id: string; name: string }
  /** It is the only Linked machine: removed, this computer stops listening for links (service.ts, the reason `linked`). */
  last: boolean
  onClose: () => void
}

/** "Remove <name>?": Cancel calls nothing; Remove calls `link.revoke` and shows a refusal in the window. */
export function RemoveMachineDialog({ machine, last, onClose }: RemoveMachineDialogProps) {
  const [error, setError] = useState<string>()
  const [removing, setRemoving] = useState(false)
  const cancel = useRef<HTMLButtonElement>(null)
  const open = useRef(true)

  useEffect(() => {
    // Cancel first: Enter right after opening does not remove.
    cancel.current?.focus()
    return () => {
      open.current = false
    }
  }, [])

  const remove = async (): Promise<void> => {
    if (removing) return
    setRemoving(true)
    setError(undefined)
    const refused = await revokeMachine(machine.id)
    if (!open.current) return
    setRemoving(false)
    if (refused === undefined) onClose()
    else setError(refused)
  }

  return (
    <MachineDialogFrame title={`Remove ${machine.name}?`} testId="remove-machine-dialog" onClose={onClose}>
      <p style={dialogStyles.text}>
        {`${machine.name} will be forgotten here now, and on ${machine.name} the next time it connects to this computer.`}
        {last
          ? ` It is the last linked machine, so this computer stops listening for links: ${machine.name} shows this computer as Offline until you remove it there too, or open Link a machine here.`
          : ''}
        {' To link it again, use Link a machine with a new code.'}
      </p>
      {error ? (
        <p role="alert" data-testid="remove-machine-error" style={{ ...dialogStyles.error, margin: '0 0 var(--space-3)' }}>
          {error}
        </p>
      ) : null}
      <div style={dialogStyles.actions}>
        <span style={{ flex: 1 }} />
        <button ref={cancel} type="button" style={dialogStyles.secondary} onClick={onClose}>
          Cancel
        </button>
        <PrimaryButton disabled={removing} onClick={() => void remove()}>
          Remove
        </PrimaryButton>
      </div>
    </MachineDialogFrame>
  )
}

/** The window open for a Linked machine, if any; it closes by itself when the Machine is gone. */
export function MachineDialogs() {
  const dialog = useMachineDialog((store) => store.dialog)
  const state = useMachines()
  const machine = dialog === undefined ? undefined : state?.linked.find((each) => each.id === dialog.id)

  // Removed meanwhile (here, in another window or by the other side): nothing left to ask about.
  useEffect(() => {
    if (dialog !== undefined && state !== undefined && machine === undefined) closeMachineDialog()
  }, [dialog, state, machine])

  if (dialog === undefined || machine === undefined) return null
  const target = { id: machine.id, name: machine.name }
  return dialog.kind === 'remove' ? (
    <RemoveMachineDialog key={`remove:${machine.id}`} machine={target} last={(state?.linked.length ?? 0) === 1} onClose={closeMachineDialog} />
  ) : (
    <ChangeAddressDialog key={`address:${machine.id}`} machine={target} onClose={closeMachineDialog} />
  )
}
