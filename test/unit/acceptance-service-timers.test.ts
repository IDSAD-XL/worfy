// The timer of the Acceptance service (src/main/acceptance/service.ts, worfy-acceptance ticket 01): a Sent decision
// turns "Not recorded yet" 24 hours after it was sent inside a running service, and a decision whose time lies far
// ahead never makes the service compute again and again. A stand-in workflow hub answers one Project's model; the
// Sent decisions live in a temporary data folder; the clock is vitest's fake one.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AcceptanceService, NOT_RECORDED_AFTER_MS, type AcceptanceHub } from '../../src/main/acceptance/service'
import { itemTextHash, writeSentDecisions } from '../../src/main/acceptance/sent-store'
import { RETRY_MS } from '../../src/main/acceptance/stable-line'
import type { AcceptanceState } from '../../src/shared/ipc/acceptance'
import { UPDATE_REPO_PAGE } from '../../src/shared/ipc/update'
import type { EvidenceItem, Ticket, WorkflowModel } from '../../src/shared/workflow/types'
import { removeTestTree } from '../remove'

const START = Date.parse('2026-11-23T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000
const PROJECT = 'alpha-0000000a'
const TEXT = 'The chip shows the server.'

const item: EvidenceItem = { index: 1, text: TEXT, checked: false, manual: true, needs: null, evidence: [], errors: [], line: 9, state: 'not-verified', reason: 'no evidence' }
const ticket: Ticket = {
  epic: 'demo',
  num: 1,
  slug: 'first',
  title: '01 — Ticket 1',
  statusRaw: 'done',
  state: 'done',
  statusAt: '2026-11-22T10:00Z',
  blockedRaw: null,
  blockedNums: [],
  blockedParsed: true,
  files: [],
  filesListed: true,
  fromBranch: null,
  evidence: [item],
}
const model: WorkflowModel = { root: '/p/alpha', epics: [], tickets: [ticket], error: null, branchErrors: [] }

let data: string
let projectReads: number

const hub: AcceptanceHub = {
  open: () => Promise.resolve(model),
  close: () => Promise.resolve(true),
  model: () => Promise.resolve(model),
}

function makeService(): AcceptanceService {
  return new AcceptanceService(
    {
      hub,
      projects: () => {
        projectReads += 1
        return [{ id: PROJECT, name: 'Alpha', path: '/p/alpha' }]
      },
      dataDir: (id) => join(data, id),
    },
    { now: () => Date.now(), tickMs: 60_000 },
  )
}

const sentOf = (state: AcceptanceState | undefined) => state?.groups.flatMap((group) => group.rows).find((row) => row.kind === 'item')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  vi.setSystemTime(START)
  data = mkdtempSync(join(tmpdir(), 'worfy-acceptance-timers-'))
  projectReads = 0
})

afterEach(() => {
  vi.useRealTimers()
  removeTestTree(data)
})

describe('the Sent timer of a running service', () => {
  it('sends acceptance.changed with not-recorded once 24 hours have passed since the decision', async () => {
    const service = makeService()
    const sent: AcceptanceState[] = []
    await service.subscribe('w', (state) => sent.push(state))
    service.markSent(PROJECT, { epic: 'demo', num: 1, item: 1, verdict: 'pass' })
    expect(sentOf(sent.at(-1))).toMatchObject({ sent: { state: 'sent' } })
    vi.advanceTimersByTime(NOT_RECORDED_AFTER_MS - 1000)
    expect(sentOf(sent.at(-1))).toMatchObject({ sent: { state: 'sent' } })
    vi.advanceTimersByTime(1000)
    expect(sentOf(sent.at(-1))).toMatchObject({ sent: { verdict: 'pass', state: 'not-recorded' } })
    await service.stop()
  })

  it('a decision dated 30 days ahead does not make the service compute again every millisecond', async () => {
    writeSentDecisions(join(data, PROJECT), [
      { projectId: PROJECT, epic: 'demo', num: 1, item: 1, textHash: itemTextHash(TEXT), verdict: 'fail', at: new Date(START + 30 * DAY).toISOString(), lines: 0 },
    ])
    const service = makeService()
    await service.get()
    const before = projectReads
    // Shorter than the tick of the Project list (60 s): only the Sent timer could compute here.
    vi.advanceTimersByTime(1000)
    expect(projectReads - before).toBeLessThanOrEqual(1)
    await service.stop()
  })
})

describe('the Stable copy line of a running service', () => {
  it('asks again on a tick RETRY_MS after GitHub refused, with no change of the model', async () => {
    const worfy: WorkflowModel = { ...model, repoUrl: UPDATE_REPO_PAGE }
    const still: AcceptanceHub = { open: () => Promise.resolve(worfy), close: () => Promise.resolve(true), model: () => Promise.resolve(worfy) }
    let asked = 0
    const service = new AcceptanceService(
      {
        hub: still,
        projects: () => [{ id: PROJECT, name: 'Alpha', path: '/p/alpha' }],
        dataDir: (id) => join(data, id),
        stable: {
          gh: () => {
            asked += 1
            return Promise.reject(new Error('HTTP 502'))
          },
          git: () => Promise.resolve({ code: 1, stdout: '' }),
          stableCommit: () => 'c'.repeat(40),
        },
      },
      { now: () => Date.now(), tickMs: 60_000 },
    )
    const sent: AcceptanceState[] = []
    await service.subscribe('w', (state) => sent.push(state))
    await vi.advanceTimersByTimeAsync(0)
    expect(asked).toBe(1)
    expect(sentOf(sent.at(-1))).toMatchObject({ stable: { state: 'not-checked', text: 'Stable copy not checked: GitHub did not answer' } })
    await vi.advanceTimersByTimeAsync(RETRY_MS - 60_000)
    expect(asked).toBe(1)
    // The tick after RETRY_MS computes the queue again, and the expired refusal is asked again.
    await vi.advanceTimersByTimeAsync(60_000)
    expect(asked).toBe(2)
    await service.stop()
  })
})
