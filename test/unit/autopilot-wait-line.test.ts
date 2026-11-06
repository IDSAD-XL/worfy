// The status line of a run that waits for its Orchestrator (worfy-autopilot-queue ticket 07):
// `waiting for the Orchestrator · 4 min`, counted from `waitingSince`; and of a stopped run whose Session went back
// to a person with its tasks still running (ticket 08).
import { describe, expect, it } from 'vitest'
import { autopilotStateSchema, autopilotStatusLine } from '../../src/shared/ipc/autopilot'

const SINCE = Date.UTC(2026, 10, 6, 9, 0)
const waiting = { status: 'waiting' as const, wave: 0, reason: null, resumesAt: null, waitingFor: 'orchestrator' as const, waitingSince: SINCE }

describe('autopilotStatusLine while the run waits for the Orchestrator', () => {
  it('says how many whole minutes the run has waited', () => {
    expect(autopilotStatusLine(waiting, { now: SINCE + 4 * 60_000 + 59_000 })).toBe('waiting for the Orchestrator · 4 min')
    expect(autopilotStatusLine(waiting, { now: SINCE + 95 * 60_000 })).toBe('waiting for the Orchestrator · 95 min')
  })

  it('says no minutes in the first one, and none without waitingSince', () => {
    expect(autopilotStatusLine(waiting, { now: SINCE + 30_000 })).toBe('waiting for the Orchestrator')
    expect(autopilotStatusLine({ ...waiting, waitingSince: undefined }, { now: SINCE + 10 * 60_000 })).toBe('waiting for the Orchestrator')
  })

  it('a waiting state with what keeps the Orchestrator busy is a valid state', () => {
    const state = {
      projectId: 'demo-000000b7',
      epic: 'demo',
      ...waiting,
      backgroundTasks: 0,
      busy: { turn: true, queued: 2, tasks: [{ id: 'task_1', type: 'local_agent', description: 'Draft the release notes' }] },
      message: null,
      resumable: [],
      stopping: false,
      ticketsInWork: 0,
      harnessBehind: null,
      revision: 3,
    }
    expect(autopilotStateSchema.parse(state)).toEqual(state)
  })
})

describe('autopilotStatusLine of a stopped run that gave its Session back as it runs (worfy-autopilot-queue ticket 08)', () => {
  const stopped = { status: 'stopped' as const, wave: 1, reason: 'turn-error' as const, resumesAt: null }

  it('names the background tasks that still run in the Session given back', () => {
    expect(autopilotStatusLine({ ...stopped, backgroundTasks: 3 })).toBe('stopped: turn error · 3 background tasks still run')
    expect(autopilotStatusLine({ ...stopped, backgroundTasks: 1 })).toBe('stopped: turn error · 1 background task still runs')
  })

  it('names none once they ended, or when the state says nothing of them', () => {
    expect(autopilotStatusLine({ ...stopped, backgroundTasks: 0 })).toBe('stopped: turn error')
    expect(autopilotStatusLine(stopped)).toBe('stopped: turn error')
  })
})
