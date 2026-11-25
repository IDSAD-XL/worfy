// Connects the attention core (attention-core.ts) to its sources (sources.ts) for every Project of this Machine,
// whether a window shows the Project or not (worfy-assistant ticket 03; spec, implementation decisions, the attention core). At the start it
// catches up: the workflow model of each Project, the Health check report and the Limits as they are now, and the
// Autopilot journal lines written since the core first kept the Project, 14 days back at most (catchUpFrom); the keys
// taken drop what it had already.
import type { AgentEvent } from '../../../shared/agent/events'
import type { LimitsState } from '../../../shared/agent/limits'
import type { JournalEvent } from '../../../shared/autopilot/journal'
import type { FirstRunReport } from '../../../shared/ipc/first-run'
import type { PrInboxSnapshot } from '../../../shared/ipc/pr-inbox'
import { followWorkflows, type WaitsHub } from '../../workflow/waits-notify'
import { AttentionCore, type AttentionSettings } from './attention-core'
import { autopilotAttention, healthAttention, limitsAttention, prInboxAttention, projectOfPath, sessionAttention, workflowAttention } from './sources'
import type { AttentionStore } from './store'

/**
 * How often the core looks for «nothing happened» conditions that are due: once a minute. Decided without the owner
 * (ticket 03, result section).
 * shortcut: a timer of its own, not the one scheduler of checks; redo when ticket 04's scheduler lands.
 */
export const ATTENTION_TICK_MS = 60_000

export interface AttentionSources {
  now: () => number
  store: AttentionStore
  settings?: () => AttentionSettings
  projects: () => readonly { id: string; path: string }[]
  sessions: { observe(sink: (sessionId: string, event: AgentEvent) => void): () => void }
  hub: WaitsHub
  prInbox: { snapshot(projectId: string): PrInboxSnapshot; onChange(listener: (projectId: string) => void): () => void }
  health: { subscribe(listener: (report: FirstRunReport) => void): () => void; current(): FirstRunReport | null }
  limits: { subscribe(listener: (state: LimitsState) => void): () => void; snapshot(): LimitsState }
  journal: { onLine(listener: (event: JournalEvent) => void): () => void; recent(projectId: string): Promise<JournalEvent[][]> }
  tickMs?: number
  log?: (message: string, error: unknown) => void
}

/** Starts the core over `sources`; answers it and the function that stops it. */
export function installAttentionCore(sources: AttentionSources): { core: AttentionCore; stop: () => void } {
  const log = sources.log ?? ((message: string, error: unknown) => console.warn(message, error))
  const core = new AttentionCore({ now: sources.now, store: sources.store, projects: () => sources.projects().map((project) => project.id), ...(sources.settings ? { settings: sources.settings } : {}) })
  // A source's failure (an unwritable file) is logged and costs that event only.
  const guard =
    <A extends unknown[]>(what: string, take: (...args: A) => void) =>
    (...args: A): void => {
      try {
        take(...args)
      } catch (error) {
        log(`[assistant] the attention core could not take ${what}`, error)
      }
    }

  const projectOf = (cwd: string): string | null => projectOfPath(sources.projects(), cwd)
  const stops = [
    sources.sessions.observe(guard('a Session event', sessionAttention(core, projectOf, sources.now))),
    followWorkflows(
      sources.hub,
      sources.projects,
      { id: 'assistant-attention', fieldsOnly: true },
      {
        read: guard('a workflow read', (root: string, read: Parameters<typeof workflowAttention>[2]) => {
          const project = sources.projects().find((each) => each.path === root)
          if (project !== undefined) workflowAttention(core, project.id, read)
        }),
        forget: () => undefined,
      },
    ),
    sources.prInbox.onChange(guard('a PR inbox read', (projectId: string) => prInboxAttention(core, sources.prInbox.snapshot(projectId)))),
    sources.health.subscribe(guard('the Health check report', (report: FirstRunReport) => healthAttention(core, report))),
    sources.limits.subscribe(guard('the Limits', (state: LimitsState) => limitsAttention(core, state))),
    sources.journal.onLine(guard('an Autopilot journal line', (line: JournalEvent) => autopilotAttention(core, line))),
  ]

  const report = sources.health.current()
  if (report !== null) guard('the Health check report', healthAttention)(core, report)
  guard('the Limits', limitsAttention)(core, sources.limits.snapshot())
  for (const project of sources.projects()) {
    sources.journal.recent(project.id).then(
      guard('the Autopilot journal', (runs: JournalEvent[][]) => {
        const from = core.catchUpFrom(project.id)
        for (const line of runs.flat()) if (Date.parse(line.at) >= from) autopilotAttention(core, line)
      }),
      (error: unknown) => log(`[assistant] ${project.id}: the Autopilot journal could not be read`, error),
    )
  }
  const tick = guard('a tick', () => core.tick())
  tick()
  const timer = setInterval(tick, sources.tickMs ?? ATTENTION_TICK_MS)
  timer.unref?.()
  return {
    core,
    stop: () => {
      clearInterval(timer)
      for (const stop of stops) stop()
    },
  }
}
