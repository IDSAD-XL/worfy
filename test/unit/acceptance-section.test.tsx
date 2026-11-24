// The Acceptance section of the sidebar (worfy-acceptance ticket 06, src/renderer/shell/sidebar/AcceptanceSection.tsx)
// over a queue in the shape main sends it (`acceptance.get`, src/shared/ipc/acceptance.ts), main a fake preload bridge:
// - a Project's name, then a row per group that waits for the owner (Ready to check, Update first, Waits for you,
//   Failed) and holds a row of that Project, with its count; In work and Older have no row;
// - the rail badge is the count of Ready to check of the Projects the switcher shows;
// - a click opens the Acceptance view on that Project's first row of that group;
// - "Nothing to check" when no Project has such a row; the reason when the queue could not be read.
// Every Project, Epic and text is invented.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AcceptanceGroupName, AcceptanceItemRow, AcceptanceRow, AcceptanceState } from '../../src/shared/ipc/acceptance'
import type { IpcResult, WorfyBridge } from '../../src/shared/ipc/channels'
import type { ProjectsState } from '../../src/shared/ipc/projects'
import type { EvidenceItem } from '../../src/shared/workflow/types'

const SHOP = 'shop-0000000a'
const DOCS = 'docs-0000000b'
const IDLE = 'idle-0000000c'
const PROJECTS: ProjectsState = {
  projects: [
    { id: SHOP, name: 'shop', path: '/projects/shop', branch: 'main' },
    { id: DOCS, name: 'docs', path: '/projects/docs', branch: 'main' },
    { id: IDLE, name: 'idle', path: '/projects/idle', branch: 'main' },
  ],
  activeId: SHOP,
  revision: 1,
}

const evidenceItem = (index: number, text: string): EvidenceItem => ({
  index,
  text,
  checked: false,
  manual: true,
  needs: null,
  evidence: [],
  errors: [],
  line: 10 + index,
  state: 'not-verified',
  reason: 'no evidence',
})

const ticket = (projectId: string, epic: string, num: number, over: Partial<AcceptanceItemRow['ticket']> = {}): AcceptanceItemRow['ticket'] => ({
  projectId,
  projectName: projectId.split('-')[0]!,
  epic,
  num,
  title: `${String(num).padStart(2, '0')} — Ticket ${num}`,
  state: 'done',
  pr: null,
  blockedReason: null,
  ...over,
})

const item = (projectId: string, epic: string, num: number, index: number): AcceptanceItemRow => ({
  kind: 'item',
  ticket: ticket(projectId, epic, num),
  item: evidenceItem(index, `Check ${num}.${index}`),
  prepared: [],
  sent: null,
  stable: null,
})

function queue(rows: Partial<Record<AcceptanceGroupName, AcceptanceRow[]>>): AcceptanceState {
  const order: AcceptanceGroupName[] = ['ready', 'update', 'waits', 'failed', 'work', 'older']
  return { groups: order.map((group) => ({ group, rows: rows[group] ?? [] })) }
}

const FULL = queue({
  ready: [item(SHOP, 'cart', 3, 2), item(SHOP, 'cart', 4, 1), item(DOCS, 'guide', 7, 1)],
  update: [item(SHOP, 'cart', 5, 1)],
  waits: [{ kind: 'ticket', ticket: ticket(DOCS, 'guide', 8, { state: 'blocked', blockedReason: 'Pick a colour' }) }],
  failed: [item(DOCS, 'guide', 9, 1)],
  work: [item(SHOP, 'cart', 6, 1), item(IDLE, 'later', 1, 1)],
  older: [item(IDLE, 'later', 2, 1)],
})

let calls: { channel: string; input: unknown }[] = []

function preload(state: AcceptanceState | { error: string }): void {
  calls = []
  const answer = (channel: string): IpcResult<unknown> => {
    switch (channel) {
      case 'acceptance.get':
        return 'error' in state ? { ok: false, error: state.error } : { ok: true, value: state }
      case 'projects.list':
        return { ok: true, value: PROJECTS }
      default:
        return { ok: true, value: null }
    }
  }
  ;(globalThis as { worfy?: WorfyBridge }).worfy = {
    invoke: (channel, input) => {
      calls.push({ channel, input })
      return Promise.resolve(answer(channel) as never)
    },
    on: () => 1,
    off: () => undefined,
  }
}

beforeEach(() => {
  // The queue's store, the Projects and the badges live in modules: every test starts with fresh ones.
  vi.resetModules()
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

async function section(state: AcceptanceState | { error: string }) {
  preload(state)
  const { default: AcceptanceSection } = await import('../../src/renderer/shell/sidebar/AcceptanceSection')
  const scope = await import('../../src/renderer/shell/sidebar-scope')
  const navigation = await import('../../src/renderer/session/navigation')
  const acceptance = await import('../../src/renderer/acceptance/useAcceptance')
  // What the rail button of the section would show (Sidebar.tsx reads the same hook).
  function Badge() {
    const badge = scope.useRailBadge('AcceptanceSection')
    return <output data-testid="badge">{badge === undefined ? '' : JSON.stringify(badge)}</output>
  }
  render(
    <>
      <AcceptanceSection />
      <Badge />
    </>,
  )
  return { navigation, acceptance }
}

const badge = (): unknown => {
  const text = screen.getByTestId('badge').textContent ?? ''
  return text === '' ? undefined : JSON.parse(text)
}

/** The rows under each Project's name: "<project>: <group> <count>". */
function rows(): string[] {
  return screen.getAllByTestId('acceptance-section-row').map((row) => `${row.dataset.project}: ${row.textContent ?? ''}`)
}

describe('the Acceptance section of the sidebar', () => {
  it('counts by Project: a row per group that waits for the owner, never In work or Older; the rail badge is Ready to check', async () => {
    await section(FULL)
    await waitFor(() => expect(screen.getAllByTestId('acceptance-section-row').length).toBeGreaterThan(0))
    expect(rows()).toEqual([`${SHOP}: Ready to check2`, `${SHOP}: Update first1`, `${DOCS}: Ready to check1`, `${DOCS}: Waits for you1`, `${DOCS}: Failed1`])
    expect(screen.getAllByTestId('acceptance-section-project').map((each) => each.textContent)).toEqual(['shop', 'docs'])
    // The Project with only In work and Older rows has no name in the section.
    expect(screen.queryByText('idle')).toBeNull()
    expect(badge()).toEqual({ tone: 'working', count: 3, label: '3 checks ready to check' })
  })

  it('Ready to check and the badge leave out an item already Sent, as the tab does', async () => {
    const sent: AcceptanceItemRow = { ...item(SHOP, 'cart', 4, 1), sent: { verdict: 'pass', at: '2026-11-24T08:00:00.000Z', state: 'sent' } }
    await section(queue({ ready: [item(SHOP, 'cart', 3, 2), sent], update: [item(SHOP, 'cart', 5, 1)] }))
    await waitFor(() => expect(rows()).toEqual([`${SHOP}: Ready to check1`, `${SHOP}: Update first1`]))
    expect(badge()).toEqual({ tone: 'working', count: 1, label: '1 check ready to check' })
  })

  it('an item whose decision was not recorded in time counts again, as on the tab', async () => {
    const late: AcceptanceItemRow = { ...item(SHOP, 'cart', 4, 1), sent: { verdict: 'pass', at: '2026-11-22T08:00:00.000Z', state: 'not-recorded' } }
    await section(queue({ ready: [item(SHOP, 'cart', 3, 2), late] }))
    await waitFor(() => expect(rows()).toEqual([`${SHOP}: Ready to check2`]))
    expect(badge()).toEqual({ tone: 'working', count: 2, label: '2 checks ready to check' })
  })

  it('under one Project, the section and the badge show that Project alone', async () => {
    localStorage.setItem('worfy.sidebar.scope', 'project')
    await section(FULL)
    await waitFor(() => expect(rows()).toEqual([`${SHOP}: Ready to check2`, `${SHOP}: Update first1`]))
    expect(badge()).toEqual({ tone: 'working', count: 2, label: '2 checks ready to check' })
  })

  it("a click opens the Acceptance view on the Project's first row of that group", async () => {
    const { navigation, acceptance } = await section(FULL)
    await waitFor(() => expect(screen.getAllByTestId('acceptance-section-row').length).toBeGreaterThan(0))
    const docsReady = screen.getAllByTestId('acceptance-section-row').find((row) => row.dataset.project === DOCS && row.dataset.group === 'ready')!
    fireEvent.click(docsReady)
    expect(navigation.useNavigation.getState().view).toBe('acceptance')
    expect(acceptance.useAcceptanceStore.getState().selected).toBe(`${DOCS}\nguide\n7\n1`)
    fireEvent.click(screen.getAllByTestId('acceptance-section-row').find((row) => row.dataset.project === DOCS && row.dataset.group === 'waits')!)
    expect(acceptance.useAcceptanceStore.getState().selected).toBe(`${DOCS}\nguide\n8`)
    // The view is over every Project: no Project is opened for it.
    expect(calls.some((call) => call.channel === 'projects.select')).toBe(false)
  })

  it('says "Nothing to check" with no row to check, and has no badge', async () => {
    await section(queue({ work: [item(SHOP, 'cart', 6, 1)] }))
    await screen.findByTestId('acceptance-section-empty')
    expect(screen.queryAllByTestId('acceptance-section-row')).toEqual([])
    expect(badge()).toBeUndefined()
  })

  it('says why the queue could not be read', async () => {
    await section({ error: 'the service stopped' })
    const message = await screen.findByTestId('acceptance-section-error')
    expect(within(message).getByText(/Acceptance could not be read: .*the service stopped/)).toBeTruthy()
  })
})
