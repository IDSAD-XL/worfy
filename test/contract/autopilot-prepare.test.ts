// `autopilot.prepare` (worfy-autopilot-queue ticket 09): the facts of the Start Autopilot window, built by
// src/main/autopilot/prepare.ts and answered by the handler of src/main/ipc/autopilot-prepare.ts over
// stand-in sources (no app, no Claude Code, no Codex). The forecast and the Limits are the lines of the
// autopilot_start dialog: the same sources go to autopilotStarter (src/main/autopilot/chat-confirm.ts),
// whose confirmation is a stand-in that keeps the prompt and answers Cancel, and the window's lines must
// be the dialog's. An Orchestrator on Codex names Codex and reads Codex's Waves and weekly window. A
// busy Orchestrator is named with its turn, queue and tasks; Epics and Tickets the Project does not have
// are refused, as a start would be.
import { describe, expect, it, vi } from 'vitest'
import type { LimitsState, LimitWindow } from '../../src/shared/agent/limits'
import type { JournalEvent } from '../../src/shared/autopilot/journal'
import { autopilotPrepare, autopilotPrepareAnswerSchema, type AutopilotPrepareInput } from '../../src/shared/ipc/autopilot-prepare'
import type { Ticket, WorkflowModel } from '../../src/shared/workflow/types'
import type { PrepareSources } from '../../src/main/autopilot/prepare'
import type { OrchestratorBusy } from '../../src/main/agent/orchestrator'
import type { VendorId } from '../../src/shared/vendors/vendor'

vi.mock('electron', () => ({
  app: { on: () => undefined, isPackaged: false, getAppPath: () => '/nowhere' },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [], fromWebContents: () => null },
  dialog: { showMessageBox: () => Promise.reject(new Error('no message box in this test')) },
}))

const PROJECT = 'demo-000000a4'
const PROJECT_NAME = 'Demo shop'
const EPIC = 'demo'
const OTHER = 'later'

const t = (num: number, state: Ticket['state'] = 'open', epic = EPIC, blockedNums: number[] = []): Ticket => ({
  epic,
  num,
  slug: `slug-${num}`,
  title: `T${num}`,
  statusRaw: state,
  state,
  blockedRaw: blockedNums.length > 0 ? blockedNums.join(', ') : '—',
  blockedNums,
  blockedParsed: true,
  files: [],
  filesListed: true,
  fromBranch: null,
})
// demo: 04 done, 05 and 06 ready, 07 after 05 — two Waves; later: 01 ready — one Wave.
const MODEL = {
  root: '/Users/someone/demo',
  epics: [
    { epic: EPIC, hasSpec: true, hasMap: false },
    { epic: OTHER, hasSpec: true, hasMap: false },
  ],
  tickets: [t(4, 'done'), t(5), t(6), t(7, 'open', EPIC, [5]), t(1, 'open', OTHER)],
  error: null,
  branchErrors: [],
} as unknown as WorkflowModel

const HOUR = 3_600_000
const NOW = Date.parse('2026-11-02T12:00:00.000Z')
const RESETS = NOW + 48 * HOUR + 600_000
/** Claude's Limits now: 60 % of the week used, the number fresh. */
const LIMITS: LimitsState = { windows: { seven_day: { utilization: 0.6, resetsAt: RESETS / 1000, status: null, receivedAt: NOW, source: 'usage' } } }

/** One past run of `waves` one-Ticket Waves, an hour each, each 10 % of Claude's week with fresh numbers at both ends. */
function pastRuns(waves: number): JournalEvent[][] {
  const iso = (ms: number): string => new Date(ms).toISOString()
  const common = (ms: number) => ({ at: iso(ms), run: '2026-11-01T10-00-00-000Z-a1b2c3', project: PROJECT, epic: EPIC })
  const week = (utilization: number, ms: number) => ({ five_hour: null, seven_day: { utilization, receivedAt: iso(ms), resetsAt: iso(RESETS) } })
  const events = [{ ...common(NOW - 30 * HOUR), kind: 'run-started' } as JournalEvent]
  for (let wave = 1; wave <= waves; wave += 1) {
    const start = NOW - 24 * HOUR + (wave - 1) * 2 * HOUR
    events.push({ ...common(start), kind: 'wave-started', wave, tickets: ['01'], limits: week((wave - 1) / 10, start) })
    events.push({ ...common(start + HOUR), kind: 'wave-finished', wave, tickets: ['01'], limits: week(wave / 10, start + HOUR) })
  }
  return [events]
}

/** One past run on Codex: each Wave uses 5 % of Plus's weekly `secondary` window. */
function pastCodexRuns(waves: number): JournalEvent[][] {
  const iso = (ms: number): string => new Date(ms).toISOString()
  const common = (ms: number) => ({ at: iso(ms), run: '2026-11-01T09-00-00-000Z-c0d3c0', project: PROJECT, epic: EPIC })
  const window = (id: string, minutes: number, used: number, ms: number) => ({ vendor: 'codex', id, label: id, usedPercent: used, windowMinutes: minutes, resetsAt: iso(RESETS), receivedAt: iso(ms), state: 'ok', source: 'read' })
  const plus = (week: number, ms: number) => ({ windows: [window('primary', 300, 10, ms), window('secondary', 10080, week, ms)] })
  const events = [{ ...common(NOW - 30 * HOUR), kind: 'run-started' } as JournalEvent]
  for (let wave = 1; wave <= waves; wave += 1) {
    const start = NOW - 24 * HOUR + (wave - 1) * 2 * HOUR
    events.push({ ...common(start), kind: 'wave-started', wave, tickets: ['01'], limits: plus(20 + (wave - 1) * 5, start) } as JournalEvent)
    events.push({ ...common(start + HOUR), kind: 'wave-finished', wave, tickets: ['01'], limits: plus(20 + wave * 5, start + HOUR) } as JournalEvent)
  }
  return [events]
}

/** Codex's windows now: 92 % of Plus's week used. */
const codexWindows = (): LimitWindow[] =>
  [
    { vendor: 'codex', id: 'primary', label: 'primary', usedPercent: 10, windowMinutes: 300, resetsAt: Math.floor(RESETS / 1000), receivedAt: NOW, state: 'ok', source: 'read' },
    { vendor: 'codex', id: 'secondary', label: 'secondary', usedPercent: 92, windowMinutes: 10080, resetsAt: Math.floor(RESETS / 1000), receivedAt: NOW, state: 'ok', source: 'read' },
  ] as unknown as LimitWindow[]

interface World {
  model?: WorkflowModel
  runs?: () => Promise<JournalEvent[][]>
  vendor?: VendorId
  busy?: OrchestratorBusy | null
  mode?: 'fastest' | 'budget-aware' | 'start-window'
}

/** The sources of the window: the dialog gets the same ones. */
function sources(world: World = {}): PrepareSources {
  const vendor = world.vendor ?? 'claude'
  return {
    projectName: () => PROJECT_NAME,
    workflow: () => Promise.resolve(world.model ?? MODEL),
    runs: world.runs ?? (() => Promise.resolve(pastRuns(5))),
    limits: () => LIMITS,
    settings: () => ({ run: { mode: world.mode ?? 'budget-aware', window: { from: 21, to: 5 } }, budget: { enabled: true, reserve: 0.05 } }),
    now: () => NOW,
    vendor: () => vendor,
    vendorLimits: () => (vendor === 'claude' ? undefined : { vendor, windows: codexWindows() }),
    session: () => 'a1b2c3d4-0000-4000-8000-000000000001',
    busy: () => world.busy ?? null,
  }
}

/** The forecast lines the autopilot_start dialog shows over the same sources: its prompt, kept by a confirmation that answers Cancel. */
async function dialogForecast(source: PrepareSources, tickets?: number[]): Promise<string[]> {
  const { autopilotStarter, CANCELED_MESSAGE } = await import('../../src/main/autopilot/chat-confirm')
  let shown: string[] | null = null
  const starter = autopilotStarter({
    unattended: () => false,
    awaitsGiveBack: () => false,
    busy: () => null,
    workflow: source.workflow,
    projectName: source.projectName,
    confirm: (prompt) => {
      shown = [...prompt.forecast]
      return Promise.resolve('cancel')
    },
    startFromChat: () => Promise.reject(new Error('nothing starts in this test')),
    forecast: { runs: source.runs, limits: source.limits, settings: source.settings, now: source.now, vendor: source.vendorLimits },
  })
  await expect(starter({ projectId: PROJECT, epic: EPIC, ...(tickets === undefined ? {} : { tickets }), session: 'orch-session' })).rejects.toThrow(CANCELED_MESSAGE)
  if (shown === null) throw new Error('the dialog was not asked')
  return shown
}

/** The answer of the handler of `autopilot.prepare`, as the channel's schema reads it. */
async function prepare(source: PrepareSources, input: AutopilotPrepareInput) {
  const { autopilotPrepareHandlers } = await import('../../src/main/ipc/autopilot-prepare')
  const [handler] = autopilotPrepareHandlers(source)
  expect(handler?.channel).toBe(autopilotPrepare)
  const answer = await handler!.handle(autopilotPrepare.input.parse(input), {} as never)
  return autopilotPrepareAnswerSchema.parse(answer)
}

describe('autopilot.prepare: the facts of the Start Autopilot window', () => {
  it('says the Project, the Tickets and Waves left, the Orchestrator, the default Run mode, and that the Orchestrator is free', async () => {
    const answer = await prepare(sources(), { projectId: PROJECT, epics: [EPIC] })
    expect(answer.project).toEqual({ id: PROJECT, name: PROJECT_NAME })
    expect(answer.epics).toEqual([{ epic: EPIC, tickets: [5, 6, 7], waves: 2, accepted: null }])
    expect(answer.orchestrator).toEqual({ vendor: 'claude', session: 'a1b2c3d4-0000-4000-8000-000000000001' })
    expect(answer.mode).toBe('budget-aware')
    expect(answer.window).toEqual({ from: 21, to: 5 })
    expect(answer.budget).toEqual({ enabled: true, reserve: 0.05 })
    expect(answer.busy).toBeNull()
    // Two Waves left, each an hour at p90.
    expect(answer.forecast.waves).toBe(2)
    expect(answer.forecast.duration).toBe(2 * HOUR)
    expect(answer.forecast.range).not.toBeNull()
  })

  it('the forecast and the Limits are the lines of the autopilot_start dialog over the same journals', async () => {
    const source = sources()
    const answer = await prepare(source, { projectId: PROJECT, epics: [EPIC] })
    const lines = await dialogForecast(source)
    expect(lines.length).toBeGreaterThan(1)
    expect(answer.forecast.lines).toEqual(lines)
    expect(answer.limits).toEqual({ utilization: 0.6, text: 'Used now: 60%, resets in 2 d 0 h' })
    // The "Used now" sentence is the one of the forecast line.
    expect(lines[0]).toContain(`${answer.limits.text}.`)
  })

  it('named Tickets: only those count, and the lines are still the dialog\'s', async () => {
    const source = sources()
    const answer = await prepare(source, { projectId: PROJECT, epics: [EPIC], tickets: [6] })
    expect(answer.epics).toEqual([{ epic: EPIC, tickets: [6], waves: 1, accepted: null }])
    expect(answer.forecast.lines).toEqual(await dialogForecast(source, [6]))
  })

  it('an Orchestrator on Codex: the Vendor is Codex, and the forecast and the Limits read Codex\'s Waves and weekly window', async () => {
    const source = sources({ vendor: 'codex', runs: () => Promise.resolve([...pastRuns(5), ...pastCodexRuns(5)]) })
    const answer = await prepare(source, { projectId: PROJECT, epics: [EPIC] })
    expect(answer.orchestrator.vendor).toBe('codex')
    expect(answer.forecast.lines).toEqual(await dialogForecast(source))
    expect(answer.forecast.lines[0]).toContain('The range is wide: this Vendor reports its Limits in whole percents only')
    // Claude's week says 60 %; Codex's weekly window 92 %.
    expect(answer.limits).toEqual({ utilization: 0.92, text: 'Used now: 92%, resets in 2 d 0 h' })
  })

  it('a busy Orchestrator: its turn, its queue and its background tasks by name', async () => {
    const busy: OrchestratorBusy = { turn: true, queued: 2, tasks: [{ taskId: 'task-1', taskType: 'local_agent', description: 'impl-04' }, { taskId: 'task-2', taskType: null, description: null }] }
    const answer = await prepare(sources({ busy }), { projectId: PROJECT, epics: [EPIC] })
    expect(answer.busy).toEqual({
      turn: true,
      queued: 2,
      tasks: [
        { id: 'task-1', type: 'local_agent', description: 'impl-04' },
        { id: 'task-2', type: null, description: null },
      ],
    })
  })

  it('several Epics: each with its own Tickets and Waves, the forecast over all their Waves', async () => {
    const answer = await prepare(sources(), { projectId: PROJECT, epics: [EPIC, OTHER] })
    expect(answer.epics.map(({ epic, tickets, waves }) => ({ epic, tickets, waves }))).toEqual([
      { epic: EPIC, tickets: [5, 6, 7], waves: 2 },
      { epic: OTHER, tickets: [1], waves: 1 },
    ])
    expect(answer.forecast.waves).toBe(3)
  })

  it('three Epics (a queue, worfy-autopilot-queue ticket 16): each with its acceptance date and Waves, the forecast their sum', async () => {
    // demo: two Waves, accepted Nov 4; later: one Wave, accepted Nov 5; third: three Waves (one Ticket after another), not accepted.
    const third = [t(1, 'open', 'third'), t(2, 'open', 'third', [1]), t(3, 'open', 'third', [2])]
    const model = {
      ...MODEL,
      epics: [
        { epic: EPIC, hasSpec: true, hasMap: false, acceptedAt: '2026-11-04' },
        { epic: OTHER, hasSpec: true, hasMap: false, acceptedAt: '2026-11-05' },
        { epic: 'third', hasSpec: true, hasMap: false, acceptedAt: null },
      ],
      tickets: [...MODEL.tickets, ...third],
    } as WorkflowModel
    const source = sources({ model })
    const answer = await prepare(source, { projectId: PROJECT, epics: [OTHER, 'third', EPIC] })
    expect(answer.epics).toEqual([
      { epic: OTHER, tickets: [1], waves: 1, accepted: '2026-11-05' },
      { epic: 'third', tickets: [1, 2, 3], waves: 3, accepted: null },
      { epic: EPIC, tickets: [5, 6, 7], waves: 2, accepted: '2026-11-04' },
    ])
    // The forecast is the sum: 1 + 3 + 2 Waves, each an hour at p90.
    expect(answer.forecast.waves).toBe(6)
    expect(answer.forecast.duration).toBe(6 * HOUR)
    expect(answer.forecast.range).not.toBeNull()
    // Each Epic alone: their Waves and durations add up to the queue's.
    const alone = await Promise.all([OTHER, 'third', EPIC].map((epic) => prepare(source, { projectId: PROJECT, epics: [epic] })))
    expect(alone.map((each) => each.forecast.waves)).toEqual([1, 3, 2])
    expect(alone.reduce((sum, each) => sum + (each.forecast.duration ?? 0), 0)).toBe(answer.forecast.duration)
  })

  it('journals that cannot be read: no forecast lines, the rest of the facts still come', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const answer = await prepare(sources({ runs: () => Promise.reject(new Error('the journals cannot be read')) }), { projectId: PROJECT, epics: [EPIC] })
    expect(answer.forecast).toEqual({ lines: [], waves: 2, range: null, duration: null })
    expect(answer.limits.text).toBe('Used now: 60%, resets in 2 d 0 h')
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it('an Epic or a Ticket the Project does not have is refused, as a start would be; named Tickets go with one Epic only', async () => {
    await expect(prepare(sources(), { projectId: PROJECT, epics: ['nope'] })).rejects.toThrow('The Project has no Epic nope')
    await expect(prepare(sources(), { projectId: PROJECT, epics: [EPIC], tickets: [42] })).rejects.toThrow('Epic demo has no Ticket 42')
    expect(autopilotPrepare.input.safeParse({ projectId: PROJECT, epics: [EPIC, OTHER], tickets: [5] }).success).toBe(false)
    expect(autopilotPrepare.input.safeParse({ projectId: PROJECT, epics: [] }).success).toBe(false)
  })

  it('is a reading channel of a Project: a Linked machine with read-only access may ask it', () => {
    expect(autopilotPrepare.access).toBe('project')
    expect(autopilotPrepare.use).toBe('read')
  })
})
