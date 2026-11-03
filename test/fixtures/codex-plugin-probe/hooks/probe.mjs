// The hook of the probe plugin (test/contract/codex-fake-hooks.test.ts): appends its mode and its input to
// the file PROBE_LOG, one JSON line each, then answers by its mode:
//   record          nothing more
//   context         additionalContext "Harness rules." (SessionStart, SubagentStart)
//   deny-reviewers  PreToolUse deny when agent_type is worfy-reviewer or worfy-scout
//   gate            Stop, SubagentStop: block with the reason "The gate is red." while PROBE_GATE is red and
//                   stop_hook_active is false
//   exit2           exit code 2 with the reason on stderr
//   sleep           waits 30 s
import { appendFileSync } from 'node:fs'
import process from 'node:process'
import { setTimeout } from 'node:timers'

const mode = process.argv[2] ?? 'record'
let text = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => (text += chunk))
process.stdin.on('end', () => {
  const input = JSON.parse(text)
  if (process.env.PROBE_LOG) appendFileSync(process.env.PROBE_LOG, `${JSON.stringify({ mode, input })}\n`)
  if (mode === 'context') {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: input.hook_event_name, additionalContext: 'Harness rules.' } }))
  } else if (mode === 'deny-reviewers' && ['worfy-reviewer', 'worfy-scout'].includes(input.agent_type)) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'A reviewer does not edit files.' } }))
  } else if (mode === 'gate' && process.env.PROBE_GATE === 'red' && input.stop_hook_active !== true) {
    process.stdout.write(JSON.stringify({ decision: 'block', reason: 'The gate is red.' }))
  } else if (mode === 'exit2') {
    process.stderr.write('Refused by exit code 2.\n')
    process.exitCode = 2
  } else if (mode === 'sleep') {
    setTimeout(() => undefined, 30_000)
  }
})
