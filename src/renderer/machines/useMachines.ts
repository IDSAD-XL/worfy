// The renderer's copy of the link state (worfy-link ticket 02): this Machine, its Linked machines,
// "Link a machine", the two switches and the access level of each Linked machine. Main owns all of it (src/main/ipc/link.ts); this module
// keeps the latest state main sent, for the Machines section of the sidebar and the "Link a machine"
// dialog. One subscription and one state call serve them all.
import { useEffect } from 'react'
import { create } from 'zustand'
import type { AccessLevel, LinkState } from '../../shared/ipc/link'
import { invoke, subscribe } from '../ipc'

interface MachinesStore {
  state: LinkState | undefined
}

const useMachinesStore = create<MachinesStore>(() => ({ state: undefined }))

/**
 * Takes a state from main unless a newer one is already here. Broadcasts and call answers can
 * arrive out of order; an equal revision is taken, since it may carry a fresher code.
 */
export function acceptLinkState(state: LinkState): void {
  const current = useMachinesStore.getState().state
  if (!current || state.revision >= current.revision) useMachinesStore.setState({ state })
}

/** Asks main for the state again. */
export async function refreshLinkState(): Promise<void> {
  const result = await invoke('link.state')
  if (result.ok) acceptLinkState(result.value)
  else console.error('link.state failed:', result.error)
}

let started = false

function start(): void {
  if (started) return
  started = true
  try {
    subscribe('link.changed', acceptLinkState)
  } catch (error) {
    // No bridge (the preload did not run): show what the state call returns, as other views do.
    console.error('link.changed: cannot subscribe', error)
  }
  void refreshLinkState()
}

/** The link state; undefined until main has answered once. */
export function useMachines(): LinkState | undefined {
  useEffect(start, [])
  return useMachinesStore((store) => store.state)
}

/** The name of Linked machine `id`; follows the link state only for an id, so a null costs no call. */
export function useMachineName(id: string | null): string | undefined {
  useEffect(() => {
    if (id !== null) start()
  }, [id])
  return useMachinesStore((store) => (id === null ? undefined : store.state?.linked.find((machine) => machine.id === id)?.name))
}

/** The link state as the renderer has it now, outside React; undefined until main has answered once. */
export function linkStateNow(): LinkState | undefined {
  return useMachinesStore.getState().state
}

/** Calls a link channel that answers with the state, and takes the state; the error text otherwise. */
async function change(call: Promise<{ ok: true; value: LinkState } | { ok: false; error: string }>): Promise<string | undefined> {
  const result = await call
  if (!result.ok) return result.error
  acceptLinkState(result.value)
  return undefined
}

export const openLinking = (): Promise<string | undefined> => change(invoke('link.open'))
export const closeLinking = (): Promise<string | undefined> => change(invoke('link.close'))
export const revokeMachine = (id: string): Promise<string | undefined> => change(invoke('link.revoke', { id }))
export const setProjectsAccess = (projectsAccess: boolean): Promise<string | undefined> => change(invoke('link.setAccess', { projectsAccess }))
export const setMachineAccess = (id: string, access: AccessLevel): Promise<string | undefined> => change(invoke('link.setMachineAccess', { id, access }))
export const setKeepAwake = (keepAwake: boolean): Promise<string | undefined> => change(invoke('link.setKeepAwake', { keepAwake }))

/** Links with the worfy at `address`; the reason when it did not link. */
export async function pairWith(address: string, code: string): Promise<{ linked: { id: string; name: string } } | { reason: string }> {
  const result = await invoke('link.pair', { address, code })
  if (!result.ok) return { reason: result.error }
  acceptLinkState(result.value.state)
  return result.value.status === 'linked' ? { linked: result.value.machine } : { reason: result.value.reason }
}
