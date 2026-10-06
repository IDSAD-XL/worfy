// The fold of a Session's events into its live background tasks (worfy-daily ticket 29, ADR-0029):
// the level of background_tasks_changed replaces the set whole; before the first level the
// task_started / task_notification pairs make it; ambient tasks never count.
import { describe, expect, it } from 'vitest'
import { emptyTaskFold, foldTaskEvent, isTaskEvent, liveTasks, sameTasks, type TaskFold } from '../../src/shared/agent/background-tasks'
import type { AgentEvent } from '../../src/shared/agent/events'

const started = (taskId: string, extra: { isBackgrounded?: boolean; ambient?: boolean; taskType?: string } = {}): AgentEvent => ({
  type: 'subagent',
  phase: 'started',
  taskId,
  toolUseId: `toolu_${taskId}`,
  description: `task ${taskId}`,
  subagentType: 'implementer',
  status: null,
  summary: null,
  isBackgrounded: extra.isBackgrounded ?? true,
  taskType: extra.taskType ?? 'local_agent',
  ambient: extra.ambient ?? null,
  reason: null,
})
const finished = (taskId: string): AgentEvent => ({
  type: 'subagent',
  phase: 'finished',
  taskId,
  toolUseId: null,
  description: null,
  subagentType: null,
  status: 'completed',
  summary: 'done',
  isBackgrounded: null,
  taskType: null,
  ambient: null,
  reason: null,
})
const level = (...tasks: [string, boolean?][]): AgentEvent => ({
  type: 'background_tasks_changed',
  tasks: tasks.map(([taskId, ambient]) => ({ taskId, taskType: 'local_bash', description: `level ${taskId}`, ambient: ambient === true })),
})

const fold = (events: AgentEvent[], from: TaskFold = emptyTaskFold()): TaskFold => events.reduce(foldTaskEvent, from)
const ids = (events: AgentEvent[], from?: TaskFold) => liveTasks(fold(events, from)).map((task) => task.taskId)

describe('the live background tasks of a Session', () => {
  it('starts empty', () => {
    expect(liveTasks(emptyTaskFold())).toEqual([])
  })

  it('takes each background_tasks_changed whole: a lost end cannot leave a task running', () => {
    expect(ids([level(['a'])])).toEqual(['a'])
    expect(ids([level(['a']), level(['a'], ['b'])])).toEqual(['a', 'b'])
    // The end of `a` came only as a level (its task_notification is lost): it is gone all the same.
    expect(ids([level(['a'], ['b']), started('a'), level(['b'])])).toEqual(['b'])
    expect(liveTasks(fold([level(['a'])]))).toEqual([{ taskId: 'a', taskType: 'local_bash', description: 'level a' }])
  })

  it('leaves ambient tasks out, in a level and in the pairs', () => {
    expect(ids([level(['w', true], ['a'])])).toEqual(['a'])
    expect(ids([started('w', { ambient: true }), started('a')])).toEqual(['a'])
  })

  it('without any level, pairs started (in the background) and task-notification by task id', () => {
    expect(ids([started('a'), started('b')])).toEqual(['a', 'b'])
    expect(ids([started('a'), started('b'), finished('a')])).toEqual(['b'])
    expect(ids([started('a'), finished('a')])).toEqual([])
    // A foreground task does not count until it moves to the background.
    expect(ids([started('f', { isBackgrounded: false })])).toEqual([])
    expect(ids([started('f', { isBackgrounded: false }), { type: 'task_activity', taskId: 'f', backgrounded: true }])).toEqual(['f'])
    // A notification of a task never seen, and progress of one, change nothing.
    const before = fold([started('a')])
    expect(foldTaskEvent(before, finished('zzz'))).toBe(before)
    expect(foldTaskEvent(before, { type: 'task_activity', taskId: 'a', backgrounded: false })).toBe(before)
  })

  it('once a level came, the pairs no longer decide', () => {
    expect(ids([level(), started('a')])).toEqual([])
    expect(ids([started('a'), level()])).toEqual([])
  })

  it('a new fold (a new Claude Code process) has none of the tasks of the old one', () => {
    const old = fold([level(['a']), started('b')])
    expect(liveTasks(old).length).toBe(1)
    expect(liveTasks(emptyTaskFold())).toEqual([])
  })

  it('ignores every other event', () => {
    const before = fold([started('a')])
    const others: AgentEvent[] = [
      { type: 'state', state: 'idle', error: null },
      { type: 'text', text: 'x', messageId: 'm', parentToolUseId: null, synthetic: false },
      { type: 'background_tasks', tasks: [] },
    ]
    for (const event of others) expect(foldTaskEvent(before, event)).toBe(before)
  })

  it('tells task events from the rest, and two lists apart', () => {
    const taskEvents: AgentEvent[] = [started('a'), finished('a'), level(), { type: 'task_activity', taskId: 'a', backgrounded: false }]
    expect(taskEvents.every((event) => isTaskEvent(event))).toBe(true)
    expect(isTaskEvent({ type: 'background_tasks', tasks: [] })).toBe(false)
    expect(isTaskEvent({ type: 'state', state: 'idle', error: null })).toBe(false)
    const a = { taskId: 'a', taskType: null, description: null }
    expect(sameTasks([a], [{ ...a }])).toBe(true)
    expect(sameTasks([a], [{ ...a, description: 'x' }])).toBe(false)
    expect(sameTasks([a], [])).toBe(false)
  })
})
