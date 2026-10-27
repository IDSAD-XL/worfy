// The measure of the first opening of a Canvas (worfy-link ticket 33, src/renderer/canvas/loading-steps.ts):
// every update of the workflow's shared copy and of ELK's answers is counted, with its time, into
// `__worfyStoreUpdates` when the page defined it before the app's scripts ran (the e2e
// linked-opening.spec.ts does); without it nothing is counted.
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowModel } from '../../src/shared/workflow/types'

const ROOT = '/repos/measured'
const model: WorkflowModel = { root: ROOT, epics: [], tickets: [], error: null, branchErrors: [] }

vi.mock('../../src/renderer/ipc', async (original) => ({
  ...(await original<typeof import('../../src/renderer/ipc')>()),
  invoke: (channel: string) => Promise.resolve(channel === 'workflow.open' ? { ok: true, value: model } : { ok: true, value: {} }),
  subscribe: () => () => undefined,
}))

const page = globalThis as { __worfyStoreUpdates?: Record<string, number[]> }

afterEach(() => {
  cleanup()
  delete page.__worfyStoreUpdates
  vi.resetModules()
})

describe('countStoreUpdates', () => {
  it('counts each update of ELK answers and of the workflow copy, one entry per update', async () => {
    const { countStoreUpdates } = await import('../../src/renderer/canvas/loading-steps')
    const { useElkAnswers } = await import('../../src/renderer/canvas/elk/client')
    const { useWorkflow } = await import('../../src/renderer/workflow/useWorkflow')
    const into: Record<string, number[]> = {}
    const stop = countStoreUpdates(into)
    useElkAnswers.setState({ p: {} })
    useElkAnswers.setState({ q: {} })
    expect(into.useElkAnswers).toHaveLength(2)
    const hook = renderHook(() => useWorkflow(ROOT))
    await waitFor(() => expect(hook.result.current.model).toStrictEqual(model))
    expect(into.useWorkflowStore).toHaveLength(1)
    stop()
    useElkAnswers.setState({ r: {} })
    expect(into.useElkAnswers).toHaveLength(2)
  })

  it('is on when the page defined __worfyStoreUpdates before the module loaded, and off otherwise', async () => {
    {
      const { useElkAnswers } = await import('../../src/renderer/canvas/elk/client')
      await import('../../src/renderer/canvas/loading-steps')
      useElkAnswers.setState({ p: {} })
      expect(page.__worfyStoreUpdates).toBeUndefined()
    }
    vi.resetModules()
    page.__worfyStoreUpdates = {}
    const { useElkAnswers } = await import('../../src/renderer/canvas/elk/client')
    await import('../../src/renderer/canvas/loading-steps')
    useElkAnswers.setState({ p: {} })
    expect(page.__worfyStoreUpdates.useElkAnswers).toHaveLength(1)
  })
})
