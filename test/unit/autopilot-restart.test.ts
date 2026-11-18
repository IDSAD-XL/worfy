// The continuation of an Autopilot Run after a restart of worfy (worfy-continuity ticket 06), its pure parts: the hour
// rule and its cap (restartDecision), the first state of a continued Run (initialCycle with `from`), the status line
// `cut off by restart · 14:05`, and the Tickets of the cut-off Wave left to a person (heldTickets over a transcript
// read through fake files). The Run itself is checked in test/contract/autopilot-faults-restart.test.ts.
import { describe, expect, it } from 'vitest'
import { heldTickets, type CutOffWave } from '../../src/main/autopilot/held-tickets'
import { MAX_RESTART_CONTINUATIONS, RESTART_HOUR_MS, initialCycle, restartDecision } from '../../src/shared/autopilot/cycle'
import { autopilotStateSchema, autopilotStatusLine } from '../../src/shared/ipc/autopilot'

const NOW = Date.UTC(2026, 10, 18, 14, 30)
const MINUTE = 60_000

describe('restartDecision: the hour rule and its cap', () => {
  it('continues a Run cut off within the hour, with fewer than two continuations in it', () => {
    expect(restartDecision({ cutAt: NOW - 5 * MINUTE, continued: [], now: NOW })).toBe('continue')
    expect(restartDecision({ cutAt: NOW - RESTART_HOUR_MS, continued: [NOW - 20 * MINUTE], now: NOW })).toBe('continue')
  })

  it('leaves a Run cut off more than an hour ago to a person', () => {
    expect(restartDecision({ cutAt: NOW - RESTART_HOUR_MS - 1, continued: [], now: NOW })).toBe('cut-off')
    expect(restartDecision({ cutAt: Number.NaN, continued: [], now: NOW })).toBe('cut-off')
  })

  it('leaves the third continuation within the hour to a person; older ones do not count', () => {
    expect(MAX_RESTART_CONTINUATIONS).toBe(2)
    expect(restartDecision({ cutAt: NOW - MINUTE, continued: [NOW - 30 * MINUTE, NOW - 10 * MINUTE], now: NOW })).toBe('cut-off')
    expect(restartDecision({ cutAt: NOW - MINUTE, continued: [NOW - 2 * RESTART_HOUR_MS, NOW - 10 * MINUTE], now: NOW })).toBe('continue')
  })
})

describe('initialCycle of a continued Run', () => {
  it('starts as any run, its Waves numbered on from the cut-off one, the cut-off Wave\'s Tickets in work its own', () => {
    const state = initialCycle('demo', undefined, { maxContinuations: 2, from: { wave: 3, tickets: [2, 1], continued: { 1: 1 }, setAside: [4] } })
    expect(state).toMatchObject({ epic: 'demo', phase: 'starting', wave: 3, tickets: [2, 1], continued: { 1: 1 }, setAside: [4], maxContinuations: 2 })
  })

  it('leaves out an empty ladder', () => {
    const state = initialCycle('demo', undefined, { from: { wave: 1, tickets: [1], continued: {}, setAside: [] } })
    expect(state).not.toHaveProperty('continued')
    expect(state).not.toHaveProperty('setAside')
  })
})

describe('the status line of a Run a restart cut off', () => {
  const stopped = { projectId: 'demo-000000c6', epic: 'demo', status: 'stopped' as const, wave: 1, backgroundTasks: 0, resumesAt: null, reason: null, message: null, resumable: [1, 2], stopping: false, ticketsInWork: 2, harnessBehind: null, revision: 3 }

  it('says when the restart cut it off', () => {
    const state = { ...stopped, cutOff: { at: Date.UTC(2026, 10, 18, 14, 5), after: 'crash' as const } }
    expect(autopilotStateSchema.safeParse(state).success).toBe(true)
    expect(autopilotStatusLine(state, { timeZone: 'UTC' })).toBe('cut off by restart · 14:05')
  })

  it('a stopped run without cutOff keeps its line', () => {
    expect(autopilotStatusLine({ ...stopped, reason: 'user-stop' }, { timeZone: 'UTC' })).not.toContain('cut off')
  })
})

describe('heldTickets: the Tickets of the cut-off Wave whose implementer has an external call without a result', () => {
  const SESSION = 'b2c3d4e5-0000-4000-8000-000000000001'
  const FILE = `/home/projects/demo/${SESSION}.jsonl`
  const SUBAGENTS = `/home/projects/demo/${SESSION}/subagents`
  const cut: CutOffWave = {
    root: '/work/demo',
    run: '2026-11-18T14-00-00-000Z-a1b2c3',
    epic: 'demo',
    vendor: 'claude',
    session: SESSION,
    tickets: [1, 2],
    workflow: { epics: ['demo'], tickets: [1, 2, 3].map((num) => ({ epic: 'demo', num, state: 'work' })) },
  }
  const prompt = { type: 'user', sessionId: SESSION, timestamp: '2026-11-18T14:00:00.000Z', message: { role: 'user', content: '/epic-wave Ticket-ы 01, 02 эпика demo' } }
  const call = (id: string, command: string, agentId?: string) => ({
    type: 'assistant',
    ...(agentId === undefined ? {} : { isSidechain: true, agentId }),
    sessionId: SESSION,
    timestamp: '2026-11-18T14:10:00.000Z',
    message: { id: `m-${id}`, role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] },
  })
  const implementer = (agentId: string, num: number, command: string) => [
    { type: 'user', isSidechain: true, agentId, sessionId: SESSION, timestamp: '2026-11-18T14:01:00.000Z', message: { role: 'user', content: `Implement the ticket .scratch/demo/issues/0${num}-ticket-${num}.md` } },
    call(`t-${agentId}`, command, agentId),
  ]
  /** The fake files: the session's transcript and its Subagents' ones. */
  function files(main: object[], subagents: Record<string, object[]>) {
    const text = (lines: object[]) => lines.map((line) => JSON.stringify(line))
    return {
      transcriptPath: () => Promise.resolve(FILE),
      readLines: (path: string) => {
        if (path === FILE) return Promise.resolve(text(main))
        const name = path.slice(SUBAGENTS.length + 1)
        const own = Object.entries(subagents).find(([agentId]) => name === `agent-${agentId}.jsonl`)
        return Promise.resolve(own === undefined ? null : text(own[1]))
      },
      listFiles: (dir: string) => Promise.resolve(dir === SUBAGENTS ? Object.keys(subagents).map((agentId) => `agent-${agentId}.jsonl`) : []),
    }
  }

  it('an implementer of 01 cut in gh pr merge holds 01 only', async () => {
    expect(await heldTickets(files([prompt], { impl01: implementer('impl01', 1, 'gh pr merge 41 --squash') }), cut)).toEqual([1])
  })

  it('an implementer of a Ticket outside the Wave holds nothing', async () => {
    expect(await heldTickets(files([prompt], { impl03: implementer('impl03', 3, 'git push origin demo/03') }), cut)).toEqual([])
  })

  it('a call of the Orchestrator itself holds every Ticket of the Wave', async () => {
    expect(await heldTickets(files([prompt, call('t-own', 'gh pr merge 41 --squash')], {}), cut)).toEqual([1, 2])
  })

  it('reads nothing for another Vendor, without a session or a transcript', async () => {
    const deps = files([prompt, call('t-own', 'gh pr merge 41 --squash')], {})
    expect(await heldTickets(deps, { ...cut, vendor: 'codex' })).toEqual([])
    expect(await heldTickets(deps, { ...cut, session: null })).toEqual([])
    expect(await heldTickets({ ...deps, transcriptPath: () => Promise.resolve(null) }, cut)).toEqual([])
    expect(await heldTickets({ ...deps, readLines: () => Promise.resolve(null) }, cut)).toEqual([])
  })
})
