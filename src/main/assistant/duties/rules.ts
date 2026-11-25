// The rules of a Project's settings (worfy-assistant ticket 07; spec, story 36; owner's decision 14): the process of one
// Project — its land, its gate — is never a duty of the code; the user writes it as a rule (projectRuleSchema). A rule
// is armed when its `when` happens — a background task of a Session of the Project whose description holds the text
// ended, or an item of the Project matches — as a «nothing happened» condition of the attention core on the same
// subject: anything that comes on that subject within `quietMinutes` (the Session ends its turn, asks, fails) disarms
// it; else it raises one item of the rule's duty, with the rule's title as its text.
import type { AgentEvent } from '../../../shared/agent/events'
import type { AttentionItem, AttentionSubject } from '../../../shared/assistant/attention'
import { projectRuleDutyId, type ProjectRule } from '../../../shared/assistant/duties'
import type { AttentionCore } from '../core/attention-core'

const MIN = 60_000

const holds = (text: string | null | undefined, part: string): boolean => (text ?? '').toLowerCase().includes(part.toLowerCase())

/** The two sinks of the rules: the Sessions' events (SessionRegistry.observe) and the items the core takes (AttentionCore.onItem). */
export function projectRuleAttention(
  core: Pick<AttentionCore, 'expect'>,
  rulesOf: (projectId: string) => readonly ProjectRule[],
  projectOf: (cwd: string) => string | null,
  now: () => number,
): { session: (sessionId: string, event: AgentEvent) => void; item: (item: AttentionItem) => void } {
  const projects = new Map<string, string | null>()
  const arm = (rule: ProjectRule, projectId: string, subject: AttentionSubject, revision: string, from: number): void => {
    core.expect({
      source: 'rule',
      id: `rule:${rule.id}:${subject.kind}:${subject.id}`,
      revision,
      projectId,
      subject,
      kind: 'rule',
      text: rule.title,
      duty: projectRuleDutyId(projectId, rule.id),
      quietMs: rule.quietMinutes * MIN,
      from,
    })
  }
  return {
    session: (sessionId, event) => {
      if (event.type === 'init') {
        projects.set(sessionId, projectOf(event.cwd))
        return
      }
      if (event.type === 'renamed') {
        projects.set(sessionId, projects.get(event.from) ?? null)
        projects.delete(event.from)
        return
      }
      if (event.type === 'state' && event.state === 'closed') {
        projects.delete(sessionId)
        return
      }
      if (event.type !== 'subagent' || event.phase !== 'finished') return
      const projectId = projects.get(sessionId) ?? null
      if (projectId === null) return
      for (const rule of rulesOf(projectId)) {
        if ('task' in rule.when && holds(event.description, rule.when.task)) arm(rule, projectId, { kind: 'session', id: sessionId, label: sessionId }, event.taskId, event.at ?? now())
      }
    },
    item: (item) => {
      if (item.projectId === null || item.source === 'rule') return
      for (const rule of rulesOf(item.projectId)) {
        if (!('item' in rule.when)) continue
        const { source, kind, text } = rule.when.item
        if ((source === undefined || source === item.source) && (kind === undefined || kind === item.kind) && (text === undefined || holds(item.text, text))) arm(rule, item.projectId, item.subject, item.revision, now())
      }
    },
  }
}
