// The cases of the contract set of the Harness (epic worfy-harness-guarantees, ticket 08): what the
// Harness plugin must do on a Claude Code binary, checked on the binary itself with the scripted
// stand-in of the Messages API instead of a model (./runner.ts runs them; worfy's Health, ticket 09,
// and test/contract/harness-guarantees.test.ts run the same list).
//
// This set is the free half of ticket 15 of the epic worfy-harness-eval ("Cases: the guard hook, the
// stop and gate hooks, the scout subagent", docs/product/harness-eval/drafts/worfy-harness-eval.md):
// whether the guard refused and whether Stop holds the turn is answered here, with no model and no
// money — cases 4 and 5, and the refusal cases tickets 03, 05 and 06 add. The paid case 15 keeps only
// what takes a model: what the agent does after the refusal.
//
// A new case is one more entry of CONTRACT_CASES (the runner stays as it is): ticket 06 adds the cases
// of its areas and of ticket 03's rules, ticket 05 the merge case.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gateTag } from '../../gate/state'
import type { RecordedToolResult } from './messages-api-stand-in'
import { git, type CaseRun, type ContractCase } from './runner'

type Line = Record<string, unknown>

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [])

/** The `name` of the plugin's manifest: the prefix of its skills and agents in system/init. */
function pluginName(pluginDir: string): string {
  const manifest = JSON.parse(readFileSync(join(pluginDir, '.claude-plugin', 'plugin.json'), 'utf8')) as { name?: unknown }
  return typeof manifest.name === 'string' ? manifest.name : ''
}

/** The first line of a rules part of the plugin (hooks/rules/<part>.md): its heading. */
const rulesHeading = (pluginDir: string, part: string): string => readFileSync(join(pluginDir, 'hooks', 'rules', `${part}.md`), 'utf8').split('\n')[0]!.trim()

const resultText = (result: RecordedToolResult | undefined): string => (typeof result?.content === 'string' ? result.content : JSON.stringify(result?.content ?? null))

/** 1. The plugin is loaded and Claude Code names no error of it. */
export const PLUGIN_LOADED: ContractCase = {
  id: 'plugin-loaded',
  title: 'The Harness plugin is loaded and system/init names no plugin error',
  prompt: 'CONTRACT-PLUGIN-LOADED',
  check(run) {
    const name = pluginName(run.pluginDir)
    const plugins = Array.isArray(run.init.plugins) ? (run.init.plugins as Line[]) : []
    const errors = Array.isArray(run.init.plugin_errors) ? (run.init.plugin_errors as Line[]) : []
    // A hooks.json that does not parse leaves the plugin in `plugins` and names it in plugin_errors by its folder, not by `name` (spike 01).
    if (errors.length > 0) return `system/init names plugin errors: ${errors.map((e) => `${String(e.plugin)}: ${String(e.type)}: ${String(e.message)}`).join('; ')}`
    if (!plugins.some((plugin) => plugin.name === name)) return `system/init lists no plugin "${name}"; plugins: ${JSON.stringify(plugins.map((p) => p.name))}`
    return null
  },
}

/** 2. The rules of the SessionStart hooks reach the model. */
export const SESSION_START_RULES: ContractCase = {
  id: 'session-start-rules',
  title: 'The rules of the SessionStart hooks reach the model',
  prompt: 'CONTRACT-SESSION-START',
  check(run) {
    // A Session without WORFY_SESSION_KIND gets the orchestrator rules and the common ones (hooks/inject-rules.mjs).
    const first = run.requests.find((request) => request.first.includes('CONTRACT-SESSION-START'))
    if (first === undefined) return 'no turn of the main thread reached the stand-in'
    const said = `${first.system}\n${first.first}`
    const missing = ['orchestrator', 'common'].map((part) => rulesHeading(run.pluginDir, part)).filter((heading) => !said.includes(heading))
    return missing.length === 0 ? null : `the first request carries no ${missing.map((h) => `"${h}"`).join(', ')}`
  },
}

/** 3. The skills and agents of the plugin are in system/init under its name. */
export const SKILLS_AND_AGENTS: ContractCase = {
  id: 'skills-and-agents',
  title: 'The skills and agents of the Harness are in system/init under the plugin name',
  prompt: 'CONTRACT-SKILLS-AGENTS',
  check(run) {
    const name = pluginName(run.pluginDir)
    const skills = readdirSync(join(run.pluginDir, 'skills'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(run.pluginDir, 'skills', entry.name, 'SKILL.md')))
      .map((entry) => `${name}:${entry.name}`)
    const agents = readdirSync(join(run.pluginDir, 'agents'))
      .filter((file) => file.endsWith('.md'))
      .map((file) => `${name}:${file.slice(0, -'.md'.length)}`)
    const listed = new Set([...strings(run.init.skills), ...strings(run.init.agents)])
    const missing = [...skills, ...agents].filter((item) => !listed.has(item))
    return missing.length === 0 ? null : `system/init lists no ${missing.join(', ')}`
  },
}

const RESET_CALL = 'toolu_contract_reset'
const WORK_FILE = 'work.txt'
const UNCOMMITTED = 'an edit nobody committed\n'

/** 4. The guard refuses `git reset --hard` over an uncommitted edit. */
export const GUARD_RESET_HARD: ContractCase = {
  id: 'guard-reset-hard',
  title: 'The guard refuses git reset --hard while the tree has an uncommitted edit',
  prompt: 'CONTRACT-GUARD-RESET',
  chains: [{ marker: 'CONTRACT-GUARD-RESET', calls: [{ id: RESET_CALL, name: 'Bash', input: { command: 'git reset --hard', description: 'Reset the tree' } }] }],
  prepare(context) {
    git(context, ['init', '-q'])
    writeFileSync(join(context.cwd, WORK_FILE), 'committed\n')
    git(context, ['add', WORK_FILE])
    git(context, ['commit', '-q', '-m', 'init'])
    writeFileSync(join(context.cwd, WORK_FILE), UNCOMMITTED)
  },
  check(run) {
    const result = run.toolResult(RESET_CALL)
    if (result === undefined) return 'the scripted Bash call got no result'
    const kept = readFileSync(join(run.cwd, WORK_FILE), 'utf8') === UNCOMMITTED
    if (result.is_error !== true || !kept) return `the guard did not refuse: the edit was ${kept ? 'kept' : 'wiped'}, the result: ${resultText(result).slice(0, 300)}`
    if (!resultText(result).includes('git reset --hard')) return `the call was refused, but not by the guard: ${resultText(result).slice(0, 300)}`
    return null
  },
}

/** The project key the stub resolver names: the case's repository counts as registered under it. */
const GATE_KEY = 'contract-set'

/** 5. The Stop hook holds the turn while the gate is red. */
export const STOP_HOLDS_ON_RED: ContractCase = {
  id: 'stop-holds-on-red',
  title: 'The Stop hook holds the turn while the gate of the tree is red',
  prompt: 'CONTRACT-STOP-RED',
  prepare(context) {
    git(context, ['init', '-q'])
    git(context, ['commit', '-q', '--allow-empty', '-m', 'init'])
    // The gate is a stub: no gate runs. The resolver names the repository as registered, and the red
    // marker of its tree is what a red `gate.mjs fast` leaves (hooks/stop.mjs reads both).
    const resolver = join(context.scratch, 'gate-resolve-stub.mjs')
    writeFileSync(resolver, `process.stdout.write(${JSON.stringify(`${GATE_KEY}\t`)} + process.argv[3] + "\\tnpm\\n")\n`)
    const state = join(context.harnessHome, 'gate', 'state')
    mkdirSync(state, { recursive: true })
    writeFileSync(join(state, `red-${GATE_KEY}-${gateTag(git(context, ['rev-parse', '--show-toplevel']))}`), 'contract set: a red gate\n')
    return { CLAUDE_GATE_RESOLVE: resolver }
  },
  check(run) {
    // A held turn is one more request of the main thread, with the hook's message as its last message.
    const held = run.requests.some((request) => request.first.includes('CONTRACT-STOP-RED') && request.last.includes('The quality gate is red'))
    if (held) return null
    const stops = run.lines.filter((line) => line.type === 'system' && line.subtype === 'hook_response' && line.hook_event === 'Stop')
    return `no turn after Stop carried "The quality gate is red"; Stop hooks: ${JSON.stringify(stops.map((s) => [s.hook_name, s.outcome, s.exit_code, String(s.stderr ?? '').slice(0, 200)]))}`
  },
}

const SUBAGENT_CALL = 'toolu_contract_subagent_bash'

/** 6. A hook of the Harness inside a Subagent sees the Subagent's agent_id. */
export const SUBAGENT_AGENT_ID: ContractCase = {
  id: 'subagent-agent-id',
  title: 'A Harness hook inside a Subagent sees its agent_id',
  prompt: 'CONTRACT-SUBAGENT-MAIN',
  chains: [
    { marker: 'CONTRACT-SUBAGENT-MAIN', calls: [{ id: 'toolu_contract_agent', name: 'Agent', input: { description: 'Echo once', prompt: 'CONTRACT-SUBAGENT-SUB echo once', subagent_type: 'general-purpose' } }] },
    { marker: 'CONTRACT-SUBAGENT-SUB', calls: [{ id: SUBAGENT_CALL, name: 'Bash', input: { command: 'echo subagent', description: 'Echo once' } }] },
  ],
  check(run: CaseRun) {
    if (run.toolResult(SUBAGENT_CALL) === undefined) return 'the Subagent made no Bash call: the stand-in did not drive its turn'
    // hooks/calls.mjs, the PostToolUse hook of the Harness, logs a Subagent's calls to <session>.<agent_id>.jsonl
    // and the main thread's to <session>.jsonl: Claude Code gives agent_id inside a Subagent only (spike 01).
    const calls = join(run.harnessHome, 'gate', 'state', 'calls')
    const logs = existsSync(calls) ? readdirSync(calls).filter((name) => name.endsWith('.jsonl') && name !== 'loops.jsonl') : []
    const session = typeof run.init.session_id === 'string' ? run.init.session_id.replace(/[^A-Za-z0-9_-]/g, '_') : ''
    if (logs.some((name) => name.startsWith(`${session}.`) && name !== `${session}.jsonl`)) return null
    return `no call log of a Subagent: the PostToolUse hook saw no agent_id; logs: ${JSON.stringify(logs)}`
  },
}

/** The contract set, in the order it runs. */
export const CONTRACT_CASES: readonly ContractCase[] = [PLUGIN_LOADED, SESSION_START_RULES, SKILLS_AND_AGENTS, GUARD_RESET_HARD, STOP_HOLDS_ON_RED, SUBAGENT_AGENT_ID]
