// The renderer's copy of the link state (worfy-link ticket 02): this Machine, its Linked machines,
// "Link a machine", the two switches and the access level of each Linked machine; reconnecting and
// setting the address of a Linked machine (worfy-link ticket 37). Main owns all of it (src/main/ipc/link.ts); this module
// keeps the latest state main sent, for the Machines section of the sidebar and the "Link a machine"
// dialog. One subscription and one state call serve them all.
import { useEffect } from 'react'
import { create } from 'zustand'
import type { AccessLevel, LinkedMachineView, LinkState } from '../../shared/ipc/link'
import type { LinkedMachineInfo } from '../../shared/ipc/linked'
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
/** Dials Linked machine `id` now, without the pause between retries (worfy-link ticket 36). */
export const reconnectMachine = (id: string): Promise<string | undefined> => change(invoke('link.reconnect', { id }))
export const setProjectsAccess = (projectsAccess: boolean): Promise<string | undefined> => change(invoke('link.setAccess', { projectsAccess }))
export const setMachineAccess = (id: string, access: AccessLevel): Promise<string | undefined> => change(invoke('link.setMachineAccess', { id, access }))
export const setKeepAwake = (keepAwake: boolean): Promise<string | undefined> => change(invoke('link.setKeepAwake', { keepAwake }))
export const setTailscale = (tailscale: boolean): Promise<string | undefined> => change(invoke('link.setTailscale', { tailscale }))

/** Links with the worfy at `address`; the reason when it did not link. */
export async function pairWith(address: string, code: string): Promise<{ linked: { id: string; name: string } } | { reason: string }> {
  const result = await invoke('link.pair', { address, code })
  if (!result.ok) return { reason: result.error }
  acceptLinkState(result.value.state)
  return result.value.status === 'linked' ? { linked: result.value.machine } : { reason: result.value.reason }
}

/**
 * Sets the address of Linked machine `id` by hand, `host:port` (worfy-link ticket 36): main keeps it
 * only where the remembered certificate answers. The reason when it did not.
 */
export async function setMachineAddress(id: string, address: string): Promise<{ saved: true } | { reason: string }> {
  const result = await invoke('link.setAddress', { id, address })
  if (!result.ok) return { reason: result.error }
  acceptLinkState(result.value.state)
  return result.value.status === 'saved' ? { saved: true } : { reason: result.value.reason }
}

/**
 * The two access lines of a Linked machine's row (worfy-link ticket 37): whether it shares its
 * Projects with this Machine — only once it said so over the link (`sharing` of `linked.state`,
 * src/shared/ipc/linked.ts) — and whether it may work with the Projects of this one: the switch
 * "Linked machines can work with my Projects" and its own level.
 */
export function machineAccessLines(machine: Pick<LinkedMachineView, 'access'>, projectsAccess: boolean, sharing: LinkedMachineInfo['sharing'] | undefined): string[] {
  const lines: string[] = []
  if (sharing === 'yes') lines.push('Shares its Projects with you')
  else if (sharing === 'no') lines.push("Doesn't share its Projects")
  lines.push(projectsAccess && machine.access !== 'off' ? 'Can work with your Projects' : "Can't see your Projects")
  return lines
}
