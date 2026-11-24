// A click on the notification of a Ticket that waits for the owner (src/main/workflow/waits-notify.ts; the window side
// is src/renderer/canvas/overlays/NotificationTarget.tsx), main a fake preload bridge:
// - worfy-pipeline ticket 06: the Pipeline board of the Ticket's Project, another Project selected first; nothing opens
//   for a Project no longer in the list;
// - worfy-acceptance ticket 06: the Acceptance view on the Ticket when the window's Acceptance queue holds it, with no
//   Project selected; the Pipeline board when it does not; the choice waits for the queue's first answer, and a queue
//   that cannot be read gives the Pipeline board.
// Moved out of test/unit/pipeline-board.test.tsx, which went over 1000 lines. Every Project and Ticket is invented.
import { render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcResult, WorfyBridge } from '../../src/shared/ipc/channels'
import type { ProjectsState } from '../../src/shared/ipc/projects'

const WORFY_ROOT = '/projects/worfy'
const ATALAYA_ROOT = '/projects/atalaya'

const PROJECTS: ProjectsState = {
  projects: [
    { id: 'worfy-00000001', name: 'worfy', path: WORFY_ROOT, branch: 'main' },
    { id: 'atalaya-00000002', name: 'atalaya', path: ATALAYA_ROOT, branch: 'main' },
  ],
  activeId: 'worfy-00000001',
  revision: 1,
}

interface FakeMain {
  calls: { channel: string; input: unknown }[]
}

let main: FakeMain

/**
 * main as the window sees it: the Project list, `projects.select`, an empty Acceptance queue, and what `answers` gives
 * (a value, or a promise of the whole answer that the test settles later); anything else answers `{ closed: true }`.
 */
function preload(options: { projects: ProjectsState; pipelines: Record<string, never>; models: Record<string, never>; answers?: Record<string, () => unknown> }): void {
  let projects = options.projects
  const fake: FakeMain = { calls: [] }
  const answer = (channel: string, input: unknown): IpcResult<unknown> | Promise<IpcResult<unknown>> => {
    const own = options.answers?.[channel]
    if (own !== undefined) {
      const value = own()
      return value instanceof Promise ? (value as Promise<IpcResult<unknown>>) : { ok: true, value }
    }
    switch (channel) {
      case 'projects.list':
        return { ok: true, value: projects }
      case 'projects.select':
        projects = { ...projects, activeId: (input as { id: string }).id, revision: projects.revision + 1 }
        return { ok: true, value: projects }
      case 'acceptance.get':
        return { ok: true, value: { groups: [] } }
      default:
        return { ok: true, value: { closed: true } }
    }
  }
  main = fake
  ;(globalThis as { worfy?: WorfyBridge }).worfy = {
    invoke: (channel, input) => {
      fake.calls.push({ channel, input })
      return Promise.resolve(answer(channel, input) as never)
    },
    on: () => 1,
    off: () => undefined,
  }
}

beforeEach(() => {
  // The pending note, the Projects, the navigation and the Acceptance queue keep their state in modules.
  vi.resetModules()
})

afterEach(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
  vi.restoreAllMocks()
})

describe('a click on a notification of a Ticket that waits for the owner (worfy-pipeline ticket 06)', () => {
  it('opens the Pipeline board of its Project: another Project is selected first', async () => {
    preload({
      projects: PROJECTS,
      pipelines: {},
      models: {},
      answers: { 'sessions.views': () => ({ views: [] }), 'notify.pending': () => ({ note: { view: 'pipeline', projectRoot: ATALAYA_ROOT, epic: 'atalaya', num: 3 } }) },
    })
    const { default: NotificationTarget } = await import('../../src/renderer/canvas/overlays/NotificationTarget')
    const { useNavigation } = await import('../../src/renderer/session/navigation')
    expect(useNavigation.getState().view).toBe('canvas')
    render(<NotificationTarget />)
    await waitFor(() => expect(useNavigation.getState().view).toBe('pipeline'))
    expect(main.calls).toContainEqual({ channel: 'projects.select', input: { id: 'atalaya-00000002' } })
  })

  it('of the active Project: only the view changes', async () => {
    preload({
      projects: PROJECTS,
      pipelines: {},
      models: {},
      answers: { 'sessions.views': () => ({ views: [] }), 'notify.pending': () => ({ note: { view: 'pipeline', projectRoot: WORFY_ROOT, epic: 'worfy-pipeline', num: 4 } }) },
    })
    const { default: NotificationTarget } = await import('../../src/renderer/canvas/overlays/NotificationTarget')
    const { useNavigation } = await import('../../src/renderer/session/navigation')
    render(<NotificationTarget />)
    await waitFor(() => expect(useNavigation.getState().view).toBe('pipeline'))
    expect(main.calls.filter((call) => call.channel === 'projects.select')).toEqual([])
  })

  it('of a Project no longer in the list: nothing opens', async () => {
    preload({
      projects: PROJECTS,
      pipelines: {},
      models: {},
      answers: { 'sessions.views': () => ({ views: [] }), 'notify.pending': () => ({ note: { view: 'pipeline', projectRoot: '/projects/gone', epic: 'e', num: 1 } }) },
    })
    const error = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { default: NotificationTarget } = await import('../../src/renderer/canvas/overlays/NotificationTarget')
    const { useNavigation } = await import('../../src/renderer/session/navigation')
    const { usePendingNote } = await import('../../src/renderer/session/notification-target')
    render(<NotificationTarget />)
    await waitFor(() => expect(main.calls.some((call) => call.channel === 'projects.list')).toBe(true))
    await waitFor(() => expect(error).toHaveBeenCalled())
    expect(usePendingNote.getState().pending).toBeNull()
    expect(useNavigation.getState().view).toBe('canvas')
    expect(main.calls.filter((call) => call.channel === 'projects.select')).toEqual([])
  })

  // worfy-acceptance ticket 06: the Acceptance view on the Ticket when its queue holds it, else the Pipeline board.
  const queueWith = (projectId: string, epic: string, num: number) => ({
    groups: [
      {
        group: 'waits',
        rows: [{ kind: 'ticket', ticket: { projectId, projectName: 'atalaya', epic, num, title: `${num} — T`, state: 'blocked', pr: null, blockedReason: 'Pick a colour' } }],
      },
      ...['ready', 'update', 'failed', 'work', 'older'].map((group) => ({ group, rows: [] })),
    ],
  })

  it('of a Ticket in the Acceptance queue: the Acceptance view on that Ticket, no Project selected, no Pipeline', async () => {
    preload({
      projects: PROJECTS,
      pipelines: {},
      models: {},
      answers: {
        'sessions.views': () => ({ views: [] }),
        'acceptance.get': () => queueWith('atalaya-00000002', 'atalaya', 3),
        'notify.pending': () => ({ note: { view: 'pipeline', projectRoot: ATALAYA_ROOT, epic: 'atalaya', num: 3 } }),
      },
    })
    const { default: NotificationTarget } = await import('../../src/renderer/canvas/overlays/NotificationTarget')
    const { useNavigation } = await import('../../src/renderer/session/navigation')
    const { useAcceptanceStore } = await import('../../src/renderer/acceptance/useAcceptance')
    const { usePendingNote } = await import('../../src/renderer/session/notification-target')
    render(<NotificationTarget />)
    await waitFor(() => expect(useNavigation.getState().view).toBe('acceptance'))
    expect(useAcceptanceStore.getState().selected).toBe('atalaya-00000002\natalaya\n3')
    expect(usePendingNote.getState().pending).toBeNull()
    expect(main.calls.filter((call) => call.channel === 'projects.select')).toEqual([])
  })

  it('of a Ticket the Acceptance queue does not hold: the Pipeline board, as before', async () => {
    preload({
      projects: PROJECTS,
      pipelines: {},
      models: {},
      answers: {
        'sessions.views': () => ({ views: [] }),
        // The queue holds the same Epic and number of the other Project: not this Ticket.
        'acceptance.get': () => queueWith('worfy-00000001', 'atalaya', 3),
        'notify.pending': () => ({ note: { view: 'pipeline', projectRoot: ATALAYA_ROOT, epic: 'atalaya', num: 3 } }),
      },
    })
    const { default: NotificationTarget } = await import('../../src/renderer/canvas/overlays/NotificationTarget')
    const { useNavigation } = await import('../../src/renderer/session/navigation')
    render(<NotificationTarget />)
    await waitFor(() => expect(useNavigation.getState().view).toBe('pipeline'))
    expect(main.calls).toContainEqual({ channel: 'projects.select', input: { id: 'atalaya-00000002' } })
  })

  it('waits for the Acceptance queue before it chooses, and opens the Pipeline board when the queue cannot be read', async () => {
    let answerQueue: (value: unknown) => void = () => undefined
    preload({
      projects: PROJECTS,
      pipelines: {},
      models: {},
      answers: {
        'sessions.views': () => ({ views: [] }),
        'acceptance.get': () => new Promise((resolve) => (answerQueue = resolve)),
        'notify.pending': () => ({ note: { view: 'pipeline', projectRoot: WORFY_ROOT, epic: 'worfy-pipeline', num: 4 } }),
      },
    })
    const { default: NotificationTarget } = await import('../../src/renderer/canvas/overlays/NotificationTarget')
    const { useNavigation } = await import('../../src/renderer/session/navigation')
    render(<NotificationTarget />)
    await waitFor(() => expect(main.calls.some((call) => call.channel === 'acceptance.get')).toBe(true))
    await waitFor(() => expect(main.calls.some((call) => call.channel === 'projects.list')).toBe(true))
    expect(useNavigation.getState().view).toBe('canvas')
    answerQueue({ ok: false, error: 'the service stopped' })
    await waitFor(() => expect(useNavigation.getState().view).toBe('pipeline'))
  })
})
