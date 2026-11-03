// The Codex agents of the Harness (worfy-multi-vendor ticket 35, decision 08). A plugin carries no
// agents in Codex: Codex reads them as TOML files from ~/.codex/agents/ (or a Project's
// .codex/agents/). The installer turns harness/agents/implementer.md, reviewer.md and scout.md of the
// Harness copy into worfy-implementer.toml, worfy-reviewer.toml and worfy-scout.toml, and writes
// them only into the user's <CODEX_HOME>/agents/: worfy writes nothing into a Project's folder
// (ADR-0005). Only the installer writes them; agents never do.
//
// Each file starts with MARK. A `worfy-*.toml` with the mark that this build does not write (an
// agent an older Harness had) is removed; a file without it is the user's own and stays.
//
// On Windows a write (a rename over the old file) or a removal that a file held open refuses is
// tried again for a while (retriedOnWindows of install.ts).
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { retriedOnWindows } from './install'

/** The agents of the Harness copy (harness/agents/<name>.md) that Codex gets. */
export const CODEX_AGENT_SOURCES = ['implementer', 'reviewer', 'scout'] as const

/** The prefix of the Codex agent names and files: `worfy-implementer`, `worfy-implementer.toml`. */
export const CODEX_AGENT_PREFIX = 'worfy-'

/** The first line of every file the installer writes: how a file of worfy is told from the user's own. */
export const CODEX_AGENT_MARK = "# Written by worfy's Harness installer"

/** The placeholder of the plugin folder in the agents' text, as Claude Code fills it in. */
const PLUGIN_ROOT = '${CLAUDE_PLUGIN_ROOT}'

/** `model` values of the Claude agents that name no model Codex has: the Codex agent inherits its parent's model. */
const CLAUDE_MODELS = new Set(['inherit', 'default', 'sonnet', 'opus', 'haiku', 'opusplan', 'best'])

/** The `effort` values Codex takes as `model_reasoning_effort` (protocol ReasoningEffort of the pinned Codex). */
const EFFORTS = new Set(['minimal', 'low', 'medium', 'high', 'xhigh', 'max'])

/** A Codex agent, as its TOML file holds it. */
export interface CodexAgent {
  name: string
  description: string
  developerInstructions: string
  /** null: the agent inherits the model of the session that starts it. */
  model: string | null
  reasoningEffort: string | null
}

/**
 * The Codex agent of one Claude agent file: the frontmatter's `description`, `model` and `effort`,
 * the body as the developer instructions, `${CLAUDE_PLUGIN_ROOT}` replaced by `pluginDir` (the
 * Harness copy Codex installed the plugin from), as a Codex agent's text is not filled in.
 */
export function codexAgentOf(source: string, markdown: string, pluginDir: string): CodexAgent {
  const text = markdown.replace(/\r\n/g, '\n')
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text)
  const fields = new Map<string, string>()
  for (const line of (match?.[1] ?? '').split('\n')) {
    // Top-level `key: value` only; nested keys (`experimental:` and its lines) mean nothing to Codex.
    const field = /^([A-Za-z][\w-]*):[ \t]*(.*)$/.exec(line)
    if (field?.[1] !== undefined && field[2] !== undefined && field[2] !== '') fields.set(field[1], unquoted(field[2].trim()))
  }
  const body = (match === null ? text : text.slice(match[0].length)).trim()
  const fill = (value: string): string => value.split(PLUGIN_ROOT).join(pluginDir)
  const model = fields.get('model')
  const effort = fields.get('effort')
  return {
    name: `${CODEX_AGENT_PREFIX}${source}`,
    description: fill(fields.get('description') ?? ''),
    developerInstructions: fill(body),
    model: model === undefined || CLAUDE_MODELS.has(model) || model.startsWith('claude-') ? null : model,
    reasoningEffort: effort !== undefined && EFFORTS.has(effort) ? effort : null,
  }
}

/** A YAML scalar's text: a double-quoted one with its escapes (JSON's, for the escapes a description uses), a single-quoted one with `''` as `'`. */
function unquoted(value: string): string {
  if (/^".*"$/.test(value)) {
    try {
      return JSON.parse(value) as string
    } catch {
      return value.slice(1, -1)
    }
  }
  return /^'.*'$/.test(value) ? value.slice(1, -1).replace(/''/g, "'") : value
}

/** A TOML basic string: JSON's escapes (`\"`, `\\`, `\n`, `\uXXXX`) are TOML's too. */
const basic = (value: string): string => JSON.stringify(value)

/** A multi-line literal string when the text allows one (readable in the file), a basic string otherwise. */
function multiline(value: string): string {
  // A literal string takes no escapes: no `'''` inside and no control character but a tab or a line feed.
  // eslint-disable-next-line no-control-regex
  if (value.includes("'''") || value.endsWith("'") || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(value)) return basic(value)
  return `'''\n${value}'''`
}

/** The TOML file of one agent; `version` is the Harness version that wrote it. */
export function codexAgentToml(agent: CodexAgent, version: string): string {
  const lines = [
    `${CODEX_AGENT_MARK} (Harness ${version}); the next install rewrites or removes this file.`,
    `name = ${basic(agent.name)}`,
    `description = ${basic(agent.description)}`,
  ]
  if (agent.model !== null) lines.push(`model = ${basic(agent.model)}`)
  if (agent.reasoningEffort !== null) lines.push(`model_reasoning_effort = ${basic(agent.reasoningEffort)}`)
  lines.push(`developer_instructions = ${multiline(`${agent.developerInstructions}\n`)}`)
  return `${lines.join('\n')}\n`
}

/** The file of each Codex agent this Harness copy has (`worfy-<name>.toml`), with its text; an agent missing from the copy is skipped. */
export function codexAgentFiles(harnessDir: string, pluginDir: string, version: string): Map<string, string> {
  const files = new Map<string, string>()
  for (const source of CODEX_AGENT_SOURCES) {
    let markdown: string
    try {
      markdown = readFileSync(join(harnessDir, 'agents', `${source}.md`), 'utf8')
    } catch {
      continue
    }
    files.set(`${CODEX_AGENT_PREFIX}${source}.toml`, codexAgentToml(codexAgentOf(source, markdown, pluginDir), version))
  }
  return files
}

/** Whether a file in the agents folder is one the installer wrote: `worfy-*.toml` whose first line is the mark. */
function writtenByWorfy(agentsDir: string, name: string): boolean {
  if (!name.startsWith(CODEX_AGENT_PREFIX) || !name.endsWith('.toml')) return false
  try {
    return readFileSync(join(agentsDir, name), 'utf8').startsWith(CODEX_AGENT_MARK)
  } catch {
    return false
  }
}

/** What the agents folder lacks against `files`: files to write (missing or different) and worfy's files to remove. */
export function codexAgentsDrift(agentsDir: string, files: ReadonlyMap<string, string>): { write: string[]; remove: string[] } {
  const write = [...files].filter(([name, text]) => {
    try {
      return readFileSync(join(agentsDir, name), 'utf8') !== text
    } catch {
      return true
    }
  })
  const present = existsSync(agentsDir) ? readdirSync(agentsDir) : []
  const remove = present.filter((name) => !files.has(name) && writtenByWorfy(agentsDir, name))
  return { write: write.map(([name]) => name), remove }
}

export interface WriteAgentsOptions {
  /** The system the renames and removals are retried for; that of this process by default. */
  platform?: NodeJS.Platform
  /** How long a held-open file is tried again on Windows; retriedOnWindows' own limit by default. */
  retryMs?: number
  /** Renames a file; tests inject one that fails as a file held open on Windows does. */
  renameFile?: (from: string, to: string) => Promise<void>
}

/**
 * Brings the agents folder to `files`: each file that is missing or different is written next to
 * its place and renamed over it, and each `worfy-*.toml` the installer wrote that is not in `files`
 * is removed. A file without the mark is never touched. Throws the first failure.
 */
export async function writeCodexAgents(agentsDir: string, files: ReadonlyMap<string, string>, options: WriteAgentsOptions = {}): Promise<{ written: string[]; removed: string[] }> {
  const { write, remove } = codexAgentsDrift(agentsDir, files)
  const retry = { ...(options.platform === undefined ? {} : { platform: options.platform }), ...(options.retryMs === undefined ? {} : { retryMs: options.retryMs }) }
  await mkdir(agentsDir, { recursive: true })
  for (const name of write) {
    const target = join(agentsDir, name)
    const staging = join(agentsDir, `.${name}.${String(process.pid)}.tmp`)
    await writeFile(staging, files.get(name) ?? '')
    try {
      await retriedOnWindows(() => (options.renameFile ?? rename)(staging, target), retry)
    } catch (error) {
      await rm(staging, { force: true })
      throw error
    }
  }
  for (const name of remove) await retriedOnWindows(() => rm(join(agentsDir, name), { force: true }), retry)
  return { written: write, removed: remove }
}
