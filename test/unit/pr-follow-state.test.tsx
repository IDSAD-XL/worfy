// The hook of the "Fix checks", "Resolve conflicts" and "Address comments" buttons (usePrFollowState,
// src/renderer/canvas/actions/gates.ts, worfy-pr-follow ticket 01): the Project's template from main, the login the PR
// inbox reads as, and a read-only screen make the button's state; Pull requests (ticket 04), the Ticket Node and the
// Command palette (ticket 05) take it. main is replaced: what it answers is set by each test. Every login, repository
// and hash is invented.
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrInboxRow, PrInboxSnapshot } from '../../src/shared/ipc/pr-inbox'
import { defaultActionTemplates, type ActionTemplates } from '../../src/shared/projects/action-templates'

const main = vi.hoisted(() => ({
  templates: undefined as ActionTemplates | undefined,
  viewer: 'dev-me' as string | null,
  readOnly: null as string | null,
}))

vi.mock('../../src/renderer/ipc', () => ({
  invoke: (channel: string) => {
    if (channel === 'projects.settings.get') return main.templates === undefined ? new Promise(() => undefined) : Promise.resolve({ ok: true, value: { actionTemplates: main.templates } })
    if (channel === 'prInbox.get') {
      const snapshot: PrInboxSnapshot = { projectId: PROJECT, enabled: true, viewer: main.viewer, groups: [], readAt: null, nextSearchAt: null, error: null, notice: null }
      return Promise.resolve({ ok: true, value: snapshot })
    }
    return Promise.resolve({ ok: false, error: `no ${channel} in this test` })
  },
  subscribe: () => () => undefined,
}))
vi.mock('../../src/renderer/projects/useProjects', () => ({
  useProjects: () => undefined,
  useReadOnly: () => main.readOnly,
}))

const PROJECT = 'web-00000001'
const SHA = '3f2a9c1d4e5b6a7980123456789abcdef0123456'

const row = (over: Partial<PrInboxRow> = {}): PrInboxRow => ({
  repo: 'owner/web',
  number: 118,
  title: 'Retry on 429',
  url: 'https://github.com/owner/web/pull/118',
  isDraft: false,
  isCrossRepository: false,
  author: 'dev-me',
  headRefName: 'fix/retry-429',
  headRefOid: SHA,
  createdAt: '2026-11-17T10:00:00Z',
  updatedAt: '2026-11-18T10:00:00Z',
  ci: 'failing',
  reviewDecision: null,
  mergeStateStatus: 'CLEAN',
  additions: null,
  deletions: null,
  viaTeam: false,
  unresolvedThreads: 0,
  newSinceSeen: 0,
  lastActivityAt: '2026-11-18T10:00:00Z',
  threads: [],
  comments: [],
  ...over,
})

async function state(pull: PrInboxRow, action: 'fixChecks' | 'resolveConflicts' | 'addressComments' = 'fixChecks') {
  const { usePrFollowState } = await import('../../src/renderer/canvas/actions/gates')
  return renderHook(() => usePrFollowState(PROJECT, pull, action))
}

beforeEach(() => {
  vi.resetModules()
  main.templates = defaultActionTemplates('plugin')
  main.viewer = 'dev-me'
  main.readOnly = null
})

afterEach(cleanup)

describe('usePrFollowState', () => {
  it('is active with the text main would send, once the template and the viewer have come', async () => {
    const { result } = await state(row())
    await waitFor(() => expect(result.current).toEqual({ enabled: true, text: `/worfy:pr-fix checks owner/web#118 ${SHA}` }))
  })

  it('waits for the Project settings with a reason', async () => {
    main.templates = undefined
    const { result } = await state(row())
    expect(result.current).toEqual({ enabled: false, reason: 'Reading the Project settings…' })
  })

  it('is inactive with the hint where to set an empty template', async () => {
    main.templates = defaultActionTemplates('legacy')
    const { result } = await state(row())
    await waitFor(() => expect(result.current).toEqual({ enabled: false, reason: 'Set the Fix checks template in Project settings' }))
  })

  it('is inactive on a read-only screen, with its reason first', async () => {
    main.readOnly = 'Mini gives this Machine read-only access'
    const { result } = await state(row())
    await waitFor(() => expect(result.current).toEqual({ enabled: false, reason: 'Mini gives this Machine read-only access' }))
  })

  it('is inactive with the reason of the verdict: someone else\'s PR, a fork, no reason for the action', async () => {
    const peer = await state(row({ author: 'dev-peer' }))
    await waitFor(() => expect(peer.result.current).toEqual({ enabled: false, reason: 'owner/web#118 is not your pull request' }))
    const fork = await state(row({ isCrossRepository: true }))
    await waitFor(() => expect(fork.result.current).toEqual({ enabled: false, reason: 'owner/web#118 comes from a fork: a Session cannot push to it' }))
    const clean = await state(row(), 'resolveConflicts')
    await waitFor(() => expect(clean.result.current).toEqual({ enabled: false, reason: 'The pull request no longer has a merge conflict on 3f2a9c1' }))
  })

  it('reads the viewer from the PR inbox: before the first search no PR is known to be the user\'s', async () => {
    main.viewer = null
    const { result } = await state(row())
    await waitFor(() => expect(result.current).toEqual({ enabled: false, reason: 'The PR inbox has not read your GitHub login yet' }))
  })
})
