// openPrInboxOf (src/renderer/pr-inbox/open.ts, worfy-pr-inbox ticket 03): the one entry that opens the Pull
// requests view — the toolbar, the palette, the sidebar section, and later the badge of ticket 06 and the
// notification of ticket 07. For the active Project it opens the view at once; for another it selects that
// Project first, and a refusal leaves the view as it was. With a PR it asks the view to open that row; what the
// view then does with the ask (the row open, or "This pull request is not in the inbox") is in
// pr-inbox-view.test.tsx. Tests only: nothing here reaches main.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({
  log: [] as string[],
  /** What openProject answers: undefined — selected, a text — refused. */
  refuse: undefined as string | undefined,
}))

vi.mock('../../src/renderer/ipc', () => ({
  windowMachine: () => null,
  invoke: () => Promise.resolve({ ok: false, error: 'no main in this test' }),
  subscribe: () => () => undefined,
}))
vi.mock('../../src/renderer/projects/useProjects', () => ({
  openProject: (machine: string | null, projectId: string) => {
    calls.log.push(`openProject ${String(machine)} ${projectId}`)
    return Promise.resolve(calls.refuse)
  },
}))
vi.mock('../../src/renderer/session/navigation', () => ({
  setView: (view: string) => calls.log.push(`setView ${view}`),
}))

import { openPrInboxOf } from '../../src/renderer/pr-inbox/open'
import { usePrInboxFocus } from '../../src/renderer/pr-inbox/usePrInbox'

const ACTIVE = 'web-00000001'
const OTHER = 'api-00000002'
const PR = { repo: 'example-org/api', number: 118 }

beforeEach(() => {
  calls.log.length = 0
  calls.refuse = undefined
  usePrInboxFocus.setState({ focus: null })
})
afterEach(() => {
  usePrInboxFocus.setState({ focus: null })
})

describe('openPrInboxOf', () => {
  it('the active Project: the view opens at once on the asked PR, no Project is selected', async () => {
    expect(await openPrInboxOf(ACTIVE, ACTIVE, PR)).toBeUndefined()
    expect(calls.log).toEqual(['setView pull-requests'])
    expect(usePrInboxFocus.getState().focus).toMatchObject({ projectId: ACTIVE, pr: PR, group: null })
  })

  it('without a PR: the view of the Project, at the top or at the asked group', async () => {
    await openPrInboxOf(ACTIVE, ACTIVE)
    expect(usePrInboxFocus.getState().focus).toMatchObject({ projectId: ACTIVE, pr: null, group: null })
    await openPrInboxOf(ACTIVE, ACTIVE, undefined, 'needs-fix')
    expect(usePrInboxFocus.getState().focus).toMatchObject({ projectId: ACTIVE, pr: null, group: 'needs-fix' })
    expect(calls.log).toEqual(['setView pull-requests', 'setView pull-requests'])
  })

  it('another Project: that Project is selected first, on the window Machine, then the view opens on the PR', async () => {
    expect(await openPrInboxOf(OTHER, ACTIVE, PR)).toBeUndefined()
    expect(calls.log).toEqual([`openProject null ${OTHER}`, 'setView pull-requests'])
    expect(usePrInboxFocus.getState().focus).toMatchObject({ projectId: OTHER, pr: PR })
  })

  it('no active Project yet counts as another one', async () => {
    await openPrInboxOf(OTHER, undefined, PR)
    expect(calls.log).toEqual([`openProject null ${OTHER}`, 'setView pull-requests'])
  })

  it('a Project that cannot be selected: the answer says why, the view and the ask stay as they were', async () => {
    calls.refuse = 'the Project folder is gone'
    expect(await openPrInboxOf(OTHER, ACTIVE, PR)).toBe('the Project folder is gone')
    expect(calls.log).toEqual([`openProject null ${OTHER}`])
    expect(usePrInboxFocus.getState().focus).toBeNull()
  })

  it('two asks of the same PR are two asks: the view takes the second one too', async () => {
    await openPrInboxOf(ACTIVE, ACTIVE, PR)
    const first = usePrInboxFocus.getState().focus!.seq
    await openPrInboxOf(ACTIVE, ACTIVE, PR)
    expect(usePrInboxFocus.getState().focus!.seq).toBeGreaterThan(first)
  })
})
