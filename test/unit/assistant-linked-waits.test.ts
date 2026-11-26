// What waits on the Linked machine, as this Machine's Assistant reads it (src/main/assistant/window/linked.ts;
// worfy-assistant ticket 18; spec, two machines; ADR-0066): one read-only call per Linked machine that is online, its
// answer held to the channel's schema, and a problem in words for a Machine that is offline, refuses or answers outside
// the contract. The link is a stand-in: no connection, no second machine.
import { describe, expect, it, vi } from 'vitest'
import type { IpcResult } from '../../src/shared/ipc/channels'
import { LinkedWaits } from '../../src/main/assistant/window/linked'

const ITEM = {
  id: 'pc-1',
  title: 'Asks: Deploy the docs now?',
  source: 'session',
  sourceLabel: 'Session',
  subject: { kind: 'session', label: 'docs 02' },
  kind: 'question',
  projectId: 'docs-9',
  projectName: 'docs-site',
  duty: 'Waits for you',
  urgent: false,
  startedAt: 1,
  lastAt: 2,
  outside: null,
}
const ANSWER = { projects: [{ id: 'docs-9', name: 'docs-site' }], items: [ITEM] }

type Machine = { id: string; name: string; online: boolean }

function reader(machines: Machine[], answer: (machine: string) => IpcResult<unknown> | Promise<IpcResult<unknown>>) {
  const call = vi.fn((machine: string) => Promise.resolve(answer(machine)))
  return { call, waits: new LinkedWaits({ machines: () => machines, call }) }
}

describe('what waits on the Linked machine', () => {
  it('reads the Projects and the items of each Linked machine that is online', async () => {
    const { waits, call } = reader([{ id: 'pc', name: 'PC', online: true }], () => ({ ok: true, value: ANSWER }))
    expect(await waits.refresh()).toEqual([{ id: 'pc', name: 'PC', online: true, projects: ANSWER.projects, items: [ITEM], problem: null }])
    expect(call).toHaveBeenCalledWith('pc')
    expect(waits.snapshot()).toEqual(await waits.refresh())
  })

  it('calls no Machine that is offline, and says so', async () => {
    const { waits, call } = reader([{ id: 'pc', name: 'PC', online: false }], () => ({ ok: true, value: ANSWER }))
    expect(await waits.refresh()).toEqual([{ id: 'pc', name: 'PC', online: false, projects: [], items: [], problem: 'PC is offline' }])
    expect(call).not.toHaveBeenCalled()
  })

  it('a refusal of the Linked machine is its problem, in its words', async () => {
    const refusal = 'Linked machines cannot work with the Projects of PC: access is off'
    const { waits } = reader([{ id: 'pc', name: 'PC', online: true }], () => ({ ok: false, error: refusal }))
    expect(await waits.refresh()).toEqual([{ id: 'pc', name: 'PC', online: true, projects: [], items: [], problem: refusal }])
  })

  it('an answer outside the contract carries nothing to the window', async () => {
    const { waits } = reader([{ id: 'pc', name: 'PC', online: true }], () => ({ ok: true, value: { projects: [], items: [{ ...ITEM, urgent: 'yes' }] } }))
    const [pc] = await waits.refresh()
    expect(pc).toMatchObject({ items: [], projects: [], problem: 'PC answered outside the contract' })
  })

  it('a call that throws is a problem too, never a rejection', async () => {
    const { waits } = reader([{ id: 'pc', name: 'PC', online: true }], () => Promise.reject(new Error('boom')))
    expect(await waits.refresh()).toEqual([{ id: 'pc', name: 'PC', online: true, projects: [], items: [], problem: 'boom' }])
  })

  it('tells its listeners of a change, and only of a change', async () => {
    let value: unknown = ANSWER
    const { waits } = reader([{ id: 'pc', name: 'PC', online: true }], () => ({ ok: true, value }))
    const heard = vi.fn()
    const stop = waits.subscribe(heard)
    await waits.refresh()
    await waits.refresh()
    expect(heard).toHaveBeenCalledTimes(1)
    value = { projects: ANSWER.projects, items: [] }
    await waits.refresh()
    expect(heard).toHaveBeenCalledTimes(2)
    stop()
    value = ANSWER
    await waits.refresh()
    expect(heard).toHaveBeenCalledTimes(2)
  })

  it('an older read that ends after a newer one does not undo it', async () => {
    const answers: ((result: IpcResult<unknown>) => void)[] = []
    const { waits } = reader([{ id: 'pc', name: 'PC', online: true }], () => new Promise<IpcResult<unknown>>((resolve) => answers.push(resolve)))
    const older = waits.refresh()
    const newer = waits.refresh()
    answers[1]!({ ok: true, value: { projects: ANSWER.projects, items: [] } })
    await newer
    answers[0]!({ ok: true, value: ANSWER })
    await older
    expect(waits.snapshot()[0]!.items).toEqual([])
  })

  it('is empty before the first read and without Linked machines', async () => {
    const { waits } = reader([], () => ({ ok: true, value: ANSWER }))
    expect(waits.snapshot()).toEqual([])
    expect(await waits.refresh()).toEqual([])
  })
})
