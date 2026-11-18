// Hook of the compaction spike plugin (ticket worfy-continuity/01). One script for every event; the
// event name is the first argument (hooks.json).
//
// - Appends one JSON line per run to $WORFY_SPIKE_OUT/hooks.jsonl: the event, who it ran for
//   (agent_id, agent_type, whether transcript_path is a Subagent's), `source` of SessionStart, `trigger` and `custom_instructions` of
//   PreCompact, `compact_summary` of PostCompact and the command of a Bash PreToolUse. Without
//   WORFY_SPIKE_OUT it logs nothing and answers nothing.
// - SessionStart answers with additionalContext: the stand-in for the Harness rules, which reach a
//   session the same way (harness/hooks/inject-rules.mjs). It asks for the RULES mark in a summary.
// - PreCompact prints plain text on stdout: Claude Code joins it to the instructions of the summary
//   (`newCustomInstructions`). It asks for the PRECOMPACT mark.
// Each instruction source asks for its own mark, so the summary tells which ones the model followed.
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const event = process.argv[2] ?? 'unknown'
const out = process.env.WORFY_SPIKE_OUT
if (!out) process.exit(0)

let input = {}
try {
  const raw = readFileSync(0, 'utf8')
  if (raw.trim()) input = JSON.parse(raw)
} catch {
  input = { unreadable_input: true }
}

const line = {
  event,
  at: new Date().toISOString(),
  session_id: input.session_id ?? null,
  agent_id: input.agent_id ?? null,
  agent_type: input.agent_type ?? null,
  // Whether the hook can tell a Subagent by its transcript path (.../<session>/subagents/agent-*.jsonl).
  transcript: typeof input.transcript_path === 'string' ? (input.transcript_path.includes('/subagents/') ? 'subagent' : 'main') : null,
  source: input.source ?? null,
  trigger: input.trigger ?? null,
  custom_instructions: input.custom_instructions ?? null,
  compact_summary: input.compact_summary ?? null,
  tool: input.tool_name ?? null,
  command: input.tool_input?.command ?? null,
}
appendFileSync(join(out, 'hooks.jsonl'), `${JSON.stringify(line)}\n`)

if (event === 'SessionStart') {
  const additionalContext = [
    `Project rules (delivered by the SessionStart hook, source: ${input.source ?? 'unknown'}).`,
    'Whenever you write a summary of this conversation, include the line RULES-MARK: kestrel-17.',
  ].join('\n')
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext } }))
}
if (event === 'PreCompact') process.stdout.write('Include the line PRECOMPACT-MARK: osprey-23 in the summary.')
