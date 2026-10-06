// The live background tasks of one Claude Code process of a Session (worfy-daily ticket 29,
// ADR-0029): work the Session started and does not wait for in its turn — a subagent of the Agent
// tool or a Bash with run_in_background, a workflow script. Autopilot holds a Wave while any lives,
// and the Orchestrator is not started again (which would kill them) until none does.
//
// Pure: a fold of the Session's events (src/shared/agent/events.ts) into a set.
// - The main source is `background_tasks_changed`, a level: each one replaces the set whole, so a
//   lost end of one task cannot leave it running for ever.
// - Until the process has sent one, the set is made of edges: `subagent` started with
//   isBackgrounded (or moved to the background later, `task_activity` with backgrounded), until its
//   `subagent` finished.
// - Ambient tasks (housekeeping, live-update watchers) are not work and never count.
// - Nothing is sent when a process starts, and a new process has none of the old one's tasks: the
//   Session starts a new fold (emptyTaskFold) for every process, and when one dies.
import type { AgentEvent } from './events'

/** One live background task, as Autopilot shows and journals it. */
export interface BackgroundTask {
  taskId: string
  /** `local_agent`, `local_bash`, `local_workflow`, …; null when Claude Code did not say. */
  taskType: string | null
  description: string | null
}

interface Known extends BackgroundTask {
  backgrounded: boolean
  ambient: boolean
}

export interface TaskFold {
  /** The last `background_tasks_changed` of the process, ambient tasks left out; null before the first. */
  readonly level: readonly BackgroundTask[] | null
  /** Tasks from task_started until their task-notification, foreground ones too (they may move to the background). */
  readonly edges: ReadonlyMap<string, Known>
}

export function emptyTaskFold(): TaskFold {
  return { level: null, edges: new Map() }
}

/** The fold after one event of the Session; the same object when the event changes nothing. */
export function foldTaskEvent(fold: TaskFold, event: AgentEvent): TaskFold {
  switch (event.type) {
    case 'background_tasks_changed':
      return {
        ...fold,
        level: event.tasks.filter((task) => !task.ambient).map((task) => ({ taskId: task.taskId, taskType: task.taskType, description: task.description })),
      }
    case 'subagent': {
      const edges = new Map(fold.edges)
      if (event.phase === 'finished') {
        if (!edges.delete(event.taskId)) return fold
        return { ...fold, edges }
      }
      edges.set(event.taskId, {
        taskId: event.taskId,
        taskType: event.taskType ?? null,
        description: event.description,
        backgrounded: event.isBackgrounded === true,
        ambient: event.ambient === true,
      })
      return { ...fold, edges }
    }
    case 'task_activity': {
      const known = fold.edges.get(event.taskId)
      if (!event.backgrounded || known === undefined || known.backgrounded) return fold
      const edges = new Map(fold.edges)
      edges.set(event.taskId, { ...known, backgrounded: true })
      return { ...fold, edges }
    }
    default:
      return fold
  }
}

/** The live background tasks that count: the last level, or the edges before the first level. */
export function liveTasks(fold: TaskFold): BackgroundTask[] {
  if (fold.level !== null) return fold.level.map((task) => ({ ...task }))
  return [...fold.edges.values()].filter((task) => task.backgrounded && !task.ambient).map(({ taskId, taskType, description }) => ({ taskId, taskType, description }))
}

/** Whether two lists name the same tasks, in the same order, with the same fields. */
export function sameTasks(a: readonly BackgroundTask[], b: readonly BackgroundTask[]): boolean {
  return a.length === b.length && a.every((task, index) => task.taskId === b[index]?.taskId && task.taskType === b[index]?.taskType && task.description === b[index]?.description)
}

/** Whether an event of the Session is about its tasks: a sign that background work is alive (ADR-0029, the limit). */
export function isTaskEvent(event: AgentEvent): boolean {
  return event.type === 'background_tasks_changed' || event.type === 'subagent' || event.type === 'task_activity'
}
