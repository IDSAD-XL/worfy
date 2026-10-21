// @vitest-environment jsdom
// The Epic node source sizes the cards for the Project's real repositories (worfy-canvas ticket 18):
// in a Project of two repositories every card draws a repository chip, «no repo» for a Ticket
// without a `Repo:` line, so the card is laid out as tall as it is drawn even when no Ticket of the
// Epic names a repository.
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { Layout } from '../../src/shared/layout/types'
import type { Ticket, WorkflowModel } from '../../src/shared/workflow/types'
import { cardHeights, epicColumns, TICKET_MIN_HEIGHT } from '../../src/renderer/canvas/epic-layout'
import source from '../../src/renderer/canvas/sources/epics'

// Hoisted: the mocks below run before the module body.
const fixed = vi.hoisted(() => {
  const root = '/two-repos'
  const ticket: Ticket = {
    epic: 'e',
    num: 12,
    slug: 't12',
    title: 'Ticket 12',
    statusRaw: 'claimed',
    state: 'work',
    waits: 'agent',
    blockedRaw: null,
    blockedNums: [],
    blockedParsed: true,
    files: [],
    filesListed: true,
    fromBranch: null,
  }
  const model: WorkflowModel = { root, epics: [{ epic: 'e', hasSpec: true, hasMap: false, title: 'E' }], tickets: [ticket], error: null, branchErrors: [] }
  return { root, ticket, model }
})
vi.mock('../../src/renderer/projects/useProjects', async (original) => ({
  ...(await original<typeof import('../../src/renderer/projects/useProjects')>()),
  useProjects: () => ({ projects: [{ id: 'p-repos', path: fixed.root }] }),
  useReadOnly: () => null,
}))
vi.mock('../../src/renderer/workflow/useWorkflow', () => ({ useWorkflow: () => ({ model: fixed.model }) }))

afterEach(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

describe('the card height follows the Project repositories', () => {
  it('two repositories and no Repo: line in the Epic: the card has room for «no repo»', async () => {
    ;(globalThis as { worfy?: WorfyBridge }).worfy = {
      invoke: (channel: string) => {
        if (channel === 'checks.repos')
          return Promise.resolve({ ok: true, value: { mode: 'full', repos: [{ name: 'api', path: `${fixed.root}/api` }, { name: 'web', path: `${fixed.root}/web` }] } })
        return Promise.resolve({ ok: false, error: 'not in this test' })
      },
      on: () => 1,
      off: () => undefined,
    } as unknown as WorfyBridge
    const layout: Layout = { nodes: [], viewport: { x: 0, y: 0, zoom: 1 } }
    const wrapper = ({ children }: { children: ReactNode }) => <ReactFlowProvider>{children}</ReactFlowProvider>
    const { result } = renderHook(() => source.useNodes({ projectId: 'p-repos', layout } as Parameters<typeof source.useNodes>[0]), { wrapper })
    const height = () => result.current.find((node) => node.type === 'ticket')?.height
    const { ticket } = fixed
    const expected = cardHeights([ticket], epicColumns([ticket]), { severalRepos: true }).get(12)!
    expect(expected).toBeGreaterThan(TICKET_MIN_HEIGHT)
    await vi.waitFor(() => expect(height()).toBe(expected))
  })
})
