// Hook of the spike plugin (ticket worfy-harness/01). One script for every event; the event name
// is the first argument (hooks.json).
//
// - Appends one JSON line per run to $WORFY_SPIKE_OUT/hooks.jsonl: the event and the fields of
//   the hook input that say who it ran for (agent_type, agent_id, source), whether
//   CLAUDE_ENV_FILE was set, and for PreToolUse the Bash command. Without WORFY_SPIKE_OUT it logs
//   nothing.
// - SessionStart and SubagentStart answer with different marks in additionalContext, so an agent
//   can say which of them reached its context.
// - SessionStart with WORFY_SPIKE_GH_ACCOUNT set appends to $CLAUDE_ENV_FILE the line
//   `export GH_TOKEN="$(gh auth token -u <account>)"` literally: the command substitution runs
//   when Claude Code sources the file, never here. The token value never passes through this hook.
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const event = process.argv[2] ?? 'unknown'
const MARKS = {
  SessionStart: 'WORFY_SPIKE_SESSION_MARK=amber-5172',
  SubagentStart: 'WORFY_SPIKE_SUBAGENT_MARK=cobalt-9038',
}

let input = {}
try {
  const raw = readFileSync(0, 'utf8')
  if (raw.trim()) input = JSON.parse(raw)
} catch {
  input = { unreadable_input: true }
}

const envFile = process.env.CLAUDE_ENV_FILE
const account = process.env.WORFY_SPIKE_GH_ACCOUNT
let envFileWritten = false
if (event === 'SessionStart' && account && envFile) {
  appendFileSync(envFile, `export GH_TOKEN="$(gh auth token -u ${account})"\n`)
  envFileWritten = true
}

const out = process.env.WORFY_SPIKE_OUT
if (out) {
  const command = typeof input.tool_input?.command === 'string' ? input.tool_input.command.slice(0, 160) : undefined
  const line = {
    at: new Date().toISOString(),
    event,
    hook_event_name: input.hook_event_name,
    session_id: input.session_id,
    agent_type: input.agent_type ?? null,
    agent_id: input.agent_id ?? null,
    source: input.source ?? null,
    command,
    claude_env_file_set: Boolean(envFile),
    env_file_written: envFileWritten,
    plugin_root: process.env.CLAUDE_PLUGIN_ROOT ?? null,
    input_keys: Object.keys(input).sort(),
  }
  appendFileSync(join(out, 'hooks.jsonl'), `${JSON.stringify(line)}\n`)
}

const mark = MARKS[event]
if (mark) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: mark } }))
