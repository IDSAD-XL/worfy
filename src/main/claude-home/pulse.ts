// The live state of every Project of this Machine in one answer (worfy-polish ticket 99,
// src/shared/ipc/project-pulse.ts): its live and busy Sessions, the pull requests that need the user and
// the Tickets that wait for a person. One hub for the app, whatever the number of windows and Projects:
//
// - The Sessions come from the registry of live Sessions (~/.claude/sessions/<pid>.json), one folder for
//   every Project. The hub lists it every `pollMs` while anyone is subscribed — names, sizes and times only
//   (ClaudeHomeRegistry.registryStamp) — and reads it again when that changed. A process that died without
//   removing its file changes no file: while a Session is live each poll asks the system whether its pid
//   still runs (a signal 0, no process started; `gone`), and the whole registry, with its start-time check
//   that tells a reused pid apart, is read again every `recheckMs` only. No watcher per
//   Project: a polled folder is what the per-Project watch (registry.ts, WatchOptions.pollMs) falls back on
//   anyway, as macOS drops some events of it. Each Session goes to the Project whose root or worktree holds
//   its cwd, the deepest one when several do; the worktrees of each Project are listed again after
//   `rootsMs` at most.
// - The pull requests come from the app's PR inbox reader (src/main/github/inbox.ts) as it last read them:
//   no call to GitHub is made here.
// - The waits come from the Stages main computes for the windows that show a Pipeline
//   (src/main/workflow/stages.ts): none is started here, so a Project no window shows the Pipeline of has
//   `waits: null`.
//
// Nothing is written anywhere (ADR-0002, ADR-0005).
import { resolve } from 'node:path'
import type { LiveSession } from '../../shared/ipc/claude-home'
import type { ProjectPulse, ProjectPulseState } from '../../shared/ipc/project-pulse'
import { isInsidePath } from './registry'

export interface PulseProject {
  readonly id: string
  readonly path: string
}

export interface PulseSources {
  /** The Projects of this Machine, in the order of its list. */
  projects: () => readonly PulseProject[]
  /** Every live Session of the registry (ClaudeHomeRegistry.liveAll). */
  live: () => Promise<LiveSession[]>
  /** Whether the process of a pid has surely ended; a cheap check without the start time (processGoneNow). */
  gone: (pid: number) => boolean
  /** Equal while the registry folder is unchanged (ClaudeHomeRegistry.registryStamp). */
  stamp: () => Promise<string>
  /** The Project's root and its worktrees (ClaudeHomeRegistry.roots). */
  roots: (path: string) => Promise<string[]>
  /** The pull requests that need the user in the Project's PR inbox as last read; null while it is off. */
  prNeedYou: (projectId: string) => number | null
  /** Calls the listener whenever a Project's PR inbox changed; returns the unsubscribe. */
  onPrChange: (listener: () => void) => () => void
  /** The Tickets that wait for a person, of the Stages main computes for the Project now; null when it computes none. */
  waits: (path: string) => number | null
  /** Calls the listener whenever waits() may answer otherwise; returns the unsubscribe. */
  onWaitsChange: (listener: () => void) => () => void
  /** Calls the listener whenever the Project list changed; returns the unsubscribe. */
  onProjectsChange: (listener: () => void) => () => void
}

export interface PulseTiming {
  /** How often the registry folder is listed while anyone is subscribed. */
  pollMs: number
  /** How often it is read whole again while a Session is live, though no file changed and no pid ended. */
  recheckMs: number
  /** How long a Project's list of worktrees is kept. */
  rootsMs: number
  now: () => number
}

export const PULSE_TIMING: PulseTiming = { pollMs: 1000, recheckMs: 60_000, rootsMs: 30_000, now: () => Date.now() }

export type PulseSend = (state: ProjectPulseState) => void

/** The Project of each live Session: the one whose root or worktree holds its cwd, the deepest when several do. */
export function assignSessions(projects: readonly { id: string; roots: readonly string[] }[], live: readonly LiveSession[]): Map<string, LiveSession[]> {
  const out = new Map<string, LiveSession[]>(projects.map((project) => [project.id, []]))
  for (const session of live) {
    let best: { id: string; depth: number } | null = null
    const cwd = session.cwd.normalize('NFC')
    for (const project of projects) {
      for (const root of project.roots) {
        if (!isInsidePath(cwd, root.normalize('NFC'))) continue
        if (best === null || root.length > best.depth) best = { id: project.id, depth: root.length }
      }
    }
    if (best !== null) out.get(best.id)?.push(session)
  }
  return out
}

export class ProjectPulseHub {
  private readonly subscribers = new Map<number | string, PulseSend>()
  private readonly roots = new Map<string, { at: number; roots: Promise<string[]> }>()
  private state: ProjectPulseState | null = null
  private stamp: string | null = null
  private readAt = 0
  private timer: ReturnType<typeof setInterval> | null = null
  private stops: (() => void)[] = []
  private running: Promise<void> | null = null
  private again = false
  /** Bumped by stop(): a read that started before it keeps nothing (its subscribers are gone). */
  private generation = 0
  /** Reads of the registry made so far; for tests. */
  reads = 0

  constructor(
    private readonly sources: PulseSources,
    private readonly timing: PulseTiming = PULSE_TIMING,
  ) {}

  /** Subscribes `id` (once; a second call replaces its `send`) and answers the state now. */
  async subscribe(id: number | string, send: PulseSend): Promise<ProjectPulseState> {
    this.subscribers.set(id, send)
    if (this.timer === null) this.start()
    // The first subscriber waits for the first read; a later one gets the last state, read fresh when there is none yet.
    if (this.state === null) await this.refresh()
    return this.state ?? { projects: [] }
  }

  /** Ends `id`'s subscription; the last one to leave stops the polling. False when it was not subscribed. */
  unsubscribe(id: number | string): boolean {
    if (!this.subscribers.delete(id)) return false
    if (this.subscribers.size === 0) this.stop()
    return true
  }

  /** The number of subscribers now; for tests. */
  get subscriberCount(): number {
    return this.subscribers.size
  }

  /** Whether the hub polls the registry now; for tests. */
  get polling(): boolean {
    return this.timer !== null
  }

  close(): void {
    this.subscribers.clear()
    this.stop()
  }

  private start(): void {
    const changed = () => void this.refresh()
    this.stops = [this.sources.onPrChange(changed), this.sources.onWaitsChange(changed), this.sources.onProjectsChange(changed)]
    this.timer = setInterval(() => void this.tick(), this.timing.pollMs)
    this.timer.unref?.()
  }

  private stop(): void {
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
    for (const stop of this.stops) stop()
    this.stops = []
    // Read again from the start by the next subscriber: nothing kept here was watched meanwhile.
    this.generation += 1
    this.state = null
    this.stamp = null
    this.readAt = 0
    this.roots.clear()
  }

  /**
   * One poll: a read when the registry changed; while a Session is live, also when one of its processes ended or
   * the last read is `recheckMs` old.
   */
  private async tick(): Promise<void> {
    let stamp: string
    try {
      stamp = await this.sources.stamp()
    } catch (error) {
      console.error('[pulse] the registry of live Sessions could not be listed', error)
      return
    }
    const pids = this.state?.projects.flatMap((project) => project.live.map((session) => session.pid)) ?? []
    const due = pids.length > 0 && (this.timing.now() - this.readAt >= this.timing.recheckMs || pids.some((pid) => this.sources.gone(pid)))
    if (stamp !== this.stamp || due) await this.refresh(stamp)
  }

  /** Reads the state again; calls that come while one runs fold into one more read. */
  private refresh(stamp?: string): Promise<void> {
    if (this.running) {
      this.again = true
      return this.running
    }
    this.running = (async () => {
      let next = stamp
      do {
        this.again = false
        await this.read(next)
        next = undefined
      } while (this.again && this.subscribers.size > 0)
    })().finally(() => {
      this.running = null
    })
    return this.running
  }

  private rootsOf(path: string): Promise<string[]> {
    const kept = this.roots.get(path)
    if (kept !== undefined && this.timing.now() - kept.at < this.timing.rootsMs) return kept.roots
    // A Project whose worktrees cannot be listed still holds the Sessions of its root.
    const roots = this.sources.roots(path).catch((error: unknown) => {
      console.warn(`[pulse] the worktrees of ${path} could not be listed`, error)
      return [resolve(path)]
    })
    this.roots.set(path, { at: this.timing.now(), roots })
    return roots
  }

  private async read(stamp: string | undefined): Promise<void> {
    if (this.subscribers.size === 0) return
    const generation = this.generation
    this.reads += 1
    let live: LiveSession[]
    let at: string | null
    try {
      // The stamp first: a change after it is seen by the next poll.
      at = stamp ?? (await this.sources.stamp())
      live = await this.sources.live()
    } catch (error) {
      console.error('[pulse] the registry of live Sessions could not be read', error)
      return
    }
    if (generation !== this.generation) return
    const projects = this.sources.projects()
    for (const path of [...this.roots.keys()]) if (!projects.some((project) => project.path === path)) this.roots.delete(path)
    const withRoots = await Promise.all(projects.map(async (project) => ({ id: project.id, path: project.path, roots: await this.rootsOf(project.path) })))
    // The last subscriber left meanwhile: what was read is not watched from here on, so the next one reads afresh.
    if (generation !== this.generation) return
    const sessions = assignSessions(withRoots, live)
    const next: ProjectPulseState = {
      projects: withRoots.map(({ id, path }): ProjectPulse => {
        const own = sessions.get(id) ?? []
        return { projectId: id, live: own, busy: own.filter((session) => session.status === 'busy').length, prNeedYou: this.sources.prNeedYou(id), waits: this.sources.waits(path) }
      }),
    }
    this.stamp = at
    this.readAt = this.timing.now()
    const changed = this.state === null || JSON.stringify(this.state) !== JSON.stringify(next)
    const first = this.state === null
    this.state = next
    if (!changed || first) return
    for (const send of [...this.subscribers.values()]) {
      try {
        send(next)
      } catch (error) {
        console.error('[pulse] a subscriber could not be told', error)
      }
    }
  }
}
