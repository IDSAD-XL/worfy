import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { HarnessStatus as Status } from '../../shared/ipc/harness'
import type { UpdateSnapshot } from '../../shared/ipc/update'
import { invoke, subscribe } from '../ipc'
import { useUpdate } from '../update/store'
import CodexHooksStep from './CodexHooksStep'
import MigrationForm from './MigrationForm'

/** The Harness state of a window and what its lines do; `dialogs` is the move form and the Codex hooks step while open. */
export interface HarnessStatusState {
  status: Status | undefined
  busy: boolean
  /** The last call that failed, shown instead of the state. */
  failure: string | undefined
  onInstall: () => void
  /** Opens the step "Approve the Harness hooks in Codex". */
  onApproveHooks: () => void
  /** Main offers to move the old Harness (`harnessMigration.offer`). */
  migration: boolean
  /** Opens the move form; undefined while no move is offered. */
  onMigrate: (() => void) | undefined
  harnessBehind: UpdateSnapshot['harnessBehind'] | null
  dialogs: ReactNode
}

/**
 * The Harness state from main (`harness.state`, then `harness.changed`), the move offer, and the install
 * through `harness.install`. The version chip of the footer and Settings → Pipeline each hold one. Only the
 * chip opens the Codex hooks step by itself (`opensHooksStep`): both hear the same `harness.changed`, and two
 * steps opened in one commit would be two windows of the kit, the keys in the one drawn under the other
 * (worfy-ui-kit ticket 07).
 */
export function useHarnessStatus({ opensHooksStep = false }: { opensHooksStep?: boolean } = {}): HarnessStatusState {
  const [status, setStatus] = useState<Status>()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string>()
  const [migration, setMigration] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [hooksStep, setHooksStep] = useState(false)
  const update = useUpdate()

  // How many `harnessMigration.changed` events arrived: an offer answer to a call made before the
  // latest event is older than that event and is dropped, as the first `harness.state` answer is.
  const offerEvents = useRef(0)
  const readOffer = useCallback(() => {
    const asked = offerEvents.current
    void invoke('harnessMigration.offer').then((result) => {
      if (offerEvents.current !== asked) return
      setMigration(result.ok && result.value.offered)
    })
  }, [])
  useEffect(readOffer, [readOffer])

  useEffect(() => {
    let active = true
    // An event that arrives before the first answer is newer than that answer: the answer is dropped.
    let heard = false
    void invoke('harness.state').then((result) => {
      if (!active || heard) return
      if (result.ok) setStatus(result.value)
      else setFailure(result.error)
    })
    // No bridge, or one without events (the preload did not run): the lines show what the first
    // answers say rather than taking the window down, as the other views do.
    let stopState = (): void => undefined
    try {
      stopState = subscribe('harness.changed', (next) => {
        heard = true
        setFailure(undefined)
        setStatus(next)
      })
    } catch (error) {
      console.error('harness.changed: cannot subscribe', error)
    }
    let stopOffer = (): void => undefined
    try {
      stopOffer = subscribe('harnessMigration.changed', (next) => {
        offerEvents.current++
        setMigration(next.offered)
      })
    } catch (error) {
      console.error('harnessMigration.changed: cannot subscribe', error)
    }
    return () => {
      active = false
      stopState()
      stopOffer()
    }
  }, [])

  // The step opens by itself when an install or update in Codex leaves hooks to approve, whichever
  // window or screen ran it; once per such install, not on every status that still says so. Only a
  // change seen by this window counts: the first status a window reads only seeds it, so a window
  // opened while hooks wait does not open the step (its "Codex: approve hooks" still does). Only the
  // holder that `opensHooksStep` does this.
  const hooksToApprove = status === undefined ? undefined : status.codex?.hooksToApprove === true
  const hadHooksToApprove = useRef<boolean | undefined>(undefined)
  useEffect(() => {
    if (hooksToApprove === undefined) return
    if (opensHooksStep && hooksToApprove && hadHooksToApprove.current === false) setHooksStep(true)
    hadHooksToApprove.current = hooksToApprove
  }, [hooksToApprove, opensHooksStep])

  const onInstall = (): void => {
    setBusy(true)
    void invoke('harness.install').then((result) => {
      setBusy(false)
      if (result.ok) {
        setFailure(undefined)
        setStatus(result.value.status)
      } else setFailure(result.error)
    })
  }

  const dialogs = (
    <>
      {formOpen ? (
        <MigrationForm
          onClose={() => {
            setFormOpen(false)
            readOffer()
          }}
          onMoved={readOffer}
        />
      ) : null}
      {hooksStep ? (
        <CodexHooksStep
          onClose={() => setHooksStep(false)}
          onStatus={(next) => {
            setFailure(undefined)
            setStatus(next)
          }}
        />
      ) : null}
    </>
  )

  return {
    status,
    busy,
    failure,
    migration,
    onInstall,
    onMigrate: migration ? () => setFormOpen(true) : undefined,
    onApproveHooks: () => setHooksStep(true),
    harnessBehind: update?.enabled ? update.harnessBehind : null,
    dialogs,
  }
}
