// The refusals of the Harness's guard hook as the run's Journal keeps them (worfy-harness-guarantees ticket 10).
//
// The guard (harness/hooks/guard.mjs) appends one JSON line per refusal to the file WORFY_GUARD_LOG names, when the
// variable is set; worfy sets it for every Session it starts (src/main/agent/guard-log.ts). The line's format is the
// header of guard.mjs:
//
//   {"time":"<ISO 8601>","rule":"<id>","agent":"<agent_type>"|null,"agent_id":"<id>"|null,
//    "ticket":"<epic>/<NN>"|null,"tool":"<tool_name>","command":"<one line, at most 200 characters>",
//    "session":"<session_id>"|null,"cwd":"<directory>"}
//
// agent_id null is the Session's own call: agent_type alone does not tell a Subagent, since the main thread of a
// Session started with --agent carries it too. A line of another shape is left out (a guard of another version, a
// line cut off by a crash), never guessed at.
//
// Pure: src/main reads the file and appends the Journal lines.
import { z } from 'zod'
import { journalCommand } from './journal'

/** The variable the guard reads the file of its refusals from (the header of harness/hooks/guard.mjs). */
export const GUARD_LOG_VARIABLE = 'WORFY_GUARD_LOG'

const nullableText = z.string().min(1).nullish().catch(null)

const guardLineSchema = z.object({
  time: z.iso.datetime({ offset: true }),
  rule: z.string().min(1),
  agent: nullableText,
  agent_id: nullableText,
  ticket: nullableText,
  tool: z.string().min(1),
  command: z.string(),
  session: nullableText,
})

/** One refusal of the guard, as its line has it. */
export interface GuardRefusal {
  /** When the guard refused (ISO 8601). */
  time: string
  /** The guard's id of the rule: `verification-path`, `uncommitted-work`… */
  rule: string
  /** The Subagent that made the call (its type, else its id); null for the Session's own call (agent_id null). */
  agent: string | null
  /** `<epic>/<NN>` the guard read for the decision, or null. */
  ticket: string | null
  tool: string
  /** The command as the guard cut it: one line, at most 200 characters. */
  command: string
}

/** The refusal of one line of the guard's file; null for a line of another shape. */
export function parseGuardLine(line: string): GuardRefusal | null {
  if (line.trim() === '') return null
  let raw: unknown
  try {
    raw = JSON.parse(line)
  } catch {
    return null
  }
  const parsed = guardLineSchema.safeParse(raw)
  if (!parsed.success) return null
  const value = parsed.data
  const subagent = value.agent_id ?? null
  return {
    time: value.time,
    rule: value.rule,
    agent: subagent === null ? null : (value.agent ?? subagent),
    ticket: value.ticket ?? null,
    tool: value.tool,
    command: value.command,
  }
}

/** The refusals of a text of the guard's lines, in file order; lines of another shape are left out. */
export function parseGuardLines(text: string): GuardRefusal[] {
  return text.split('\n').flatMap((line) => {
    const refusal = parseGuardLine(line)
    return refusal === null ? [] : [refusal]
  })
}

/** The fields of a `guard-deny` line of the Journal: the command as journalCommand keeps it (secrets hidden, the home folder as `~`). */
export function guardDenyFields(refusal: GuardRefusal, session: string | null, home: string) {
  return {
    kind: 'guard-deny' as const,
    session,
    rule: refusal.rule,
    tool: refusal.tool,
    command: journalCommand(refusal.command, home),
    refusedAt: refusal.time,
    ...(refusal.agent === null ? {} : { agent: refusal.agent }),
    ...(refusal.ticket === null ? {} : { ticket: refusal.ticket }),
  }
}

/**
 * The words of the guard's rule ids (the header of harness/hooks/guard.mjs) in the block «Guard» of Run history; a
 * rule this build does not know shows its id.
 */
const RULE_WORDS: Readonly<Record<string, string>> = {
  'read-only-agent': 'write by a read-only agent',
  'interactive-shell': 'interactive command',
  'uncommitted-work': 'loses uncommitted work',
  'pipe-exit-code': 'pipe hides the exit code',
  'workflow-traces': 'workflow traces in the repository',
  'verification-path': 'verification path outside the trail',
  'verification-path-no-ticket': 'verification path without a ticket',
  'verification-path-detached': 'verification path off a ticket branch',
  'ticket-trail-edit': "edit of the ticket's trail",
  'ticket-mark-subagent': 'ticket mark by a Subagent',
  'profile-set-merge-fields': 'profile field the merge depends on',
}

/** «Guard · 2 refused»: how many refusals of the guard a Run's Journal holds. */
export const guardCountText = (count: number): string => `Guard · ${String(count)} refused`

/** The words of a rule of the guard: `verification path outside the trail`, or the id itself. */
export const guardRuleText = (rule: string): string => (Object.hasOwn(RULE_WORDS, rule) ? RULE_WORDS[rule]! : rule)
