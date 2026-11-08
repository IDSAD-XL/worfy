// The Harness is the Claude Code plugin `worfy` (ADR-0019); its source is harness/ (ticket
// worfy-harness/02). This test pins the manifest fields the ticket sets and keeps out of harness/
// the files of ~/.claude that are not the Harness: personal scripts, tests of personal profiles'
// code, agents and hooks of single projects, machine state.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { afterAll, describe, expect, it } from 'vitest'
import { SESSION_KIND_VARIABLE } from '../../src/main/vendors/claude/options'
import { removeTestTree } from '../remove'
import { claudeEnv, startMessagesApiStandIn } from './messages-api-stand-in'

const REPO = join(__dirname, '..', '..')
const HARNESS = join(REPO, 'harness')

interface Manifest {
  name?: unknown
  version?: unknown
  description?: unknown
  dependencies?: unknown
}

const readManifest = (): Manifest =>
  JSON.parse(readFileSync(join(HARNESS, '.claude-plugin', 'plugin.json'), 'utf8')) as Manifest

const listFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    // With `/` on every platform: the expectations and patterns below are written with it.
    return entry.isDirectory() ? listFiles(path) : [relative(HARNESS, path).split(sep).join('/')]
  })

describe('harness/.claude-plugin/plugin.json', () => {
  it('names the plugin worfy and describes it', () => {
    const manifest = readManifest()
    expect(manifest.name).toBe('worfy')
    expect(typeof manifest.description).toBe('string')
  })

  // worfy-skills 03: the skills of mattpocock-skills ship inside the plugin (worfy-skills 01), so
  // worfy no longer installs that plugin. The mechanism of ADR-0059 stays in the installer for a
  // future dependency; its tests take a fixture copy with one.
  it('declares no dependencies', () => {
    const deps = readManifest().dependencies
    expect(deps === undefined || (Array.isArray(deps) && deps.length === 0)).toBe(true)
  })

  it('has no version: the build writes it (ticket 04)', () => {
    expect(readManifest()).not.toHaveProperty('version')
  })
})

describe('harness/ holds only the Harness', () => {
  const files = existsSync(HARNESS) ? listFiles(HARNESS) : []

  it('has the imported files', () => {
    expect(files).toEqual(
      expect.arrayContaining([
        'hooks/rules/orchestrator.md',
        'hooks/rules/common.md',
        'hooks/rules/product.md',
        'agents/implementer.md',
        'skills/epic-wave/SKILL.md',
        'bin/profile',
        'hooks/gate.mjs',
        'hooks/gate-paths.mjs',
        'profiles/README.md',
      ]),
    )
  })

  // The ticket's list of what is not imported from ~/.claude.
  const NOT_HARNESS: [string, RegExp][] = [
    ['personal scripts', /(^|\/)(telegram-mcp|auction-staging-db-mcp|agent-time-split)$/],
    ['tests of personal profiles’ code', /(^|\/)(atakama-tickets|production-check)\.test\.sh$/],
    ['agents and hooks of single projects', /(^|\/)(atakama|auction)-[^/]*$/],
    ['machine state', /(^|\/)(settings\.json|gate\/.*|profiles\/(worfy|auction|atakama)\/.*)$/],
    ['synced skills', /^skills\/synced\//],
    // Claude Code loads a CLAUDE.md under harness/ into sessions that edit harness/: the global
    // rules reach sessions through hooks/inject-rules.mjs and hooks/rules/*.md instead (ticket 05).
    ['CLAUDE.md', /(^|\/)CLAUDE\.md$/],
  ]

  it.each(NOT_HARNESS)('has no %s', (_what, pattern) => {
    expect(files.filter((file) => pattern.test(file))).toEqual([])
  })
})

// worfy-product-session ticket 10, the Epic spec's risk 1: the rule set of a Session is chosen by
// WORFY_SESSION_KIND, which worfy puts into the `env` of a Product Session (sessionOptions). That works only
// if the process of a SessionStart hook gets the environment the Agent SDK gave Claude Code. The real
// Claude Code (the Agent SDK's own binary) runs here against the local Messages API stand-in — no model,
// no key, a HOME and config folder of its own, nothing under the real ~/.claude — with one local plugin
// whose SessionStart hooks are the plugin's inject-rules.mjs for the parts orchestrator and product.
describe('the SessionStart hook of a Session gets the environment worfy gives the Session', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'worfy-session-kind-'))
  afterAll(() => removeTestTree(scratch))
  const slash = (path: string) => path.split(sep).join('/')
  const plugin = join(scratch, 'plugin')
  mkdirSync(join(plugin, '.claude-plugin'), { recursive: true })
  mkdirSync(join(plugin, 'hooks'))
  writeFileSync(join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'session-kind-probe', description: 'SessionStart hooks of the session-kind test' }))
  // unscaled: 10 s is the hook timeout of the plugin's own hooks.json, a declaration, not a limit of this test
  const inject = (part: string) => ({ hooks: [{ type: 'command', command: `node "${slash(join(HARNESS, 'hooks', 'inject-rules.mjs'))}" ${part}`, timeout: 10 }] })
  writeFileSync(join(plugin, 'hooks', 'hooks.json'), JSON.stringify({ hooks: { SessionStart: [inject('orchestrator'), inject('product')] } }))

  /** The first lines of the rules each SessionStart hook printed, in no particular order: hooks of one event run in parallel. */
  async function sessionStartRules(kind: string | undefined): Promise<string[]> {
    // A tool no request offers: every answer of the stand-in is a short text.
    const standIn = await startMessagesApiStandIn({ id: 'toolu_none', name: 'NoSuchTool', input: {} })
    const home = mkdtempSync(join(scratch, 'home-'))
    const cwd = mkdtempSync(join(scratch, 'cwd-'))
    const stderr: string[] = []
    const messages: SDKMessage[] = []
    try {
      const env = { ...claudeEnv(standIn, home), HARNESS_HOME: join(home, 'harness'), ...(kind === undefined ? {} : { [SESSION_KIND_VARIABLE]: kind }) }
      const run = query({
        prompt: 'Hi.',
        options: { cwd, env, settingSources: [], plugins: [{ type: 'local', path: plugin }], model: 'claude-sonnet-4-5', stderr: (data) => stderr.push(data) },
      })
      for await (const message of run) {
        messages.push(message)
        if (message.type === 'result') break
      }
      run.close()
    } finally {
      await standIn.close()
    }
    const responses = messages.filter((m): m is Extract<SDKMessage, { subtype: 'hook_response' }> => m.type === 'system' && m.subtype === 'hook_response' && m.hook_event === 'SessionStart')
    expect(responses.map((r) => [r.outcome, r.exit_code]), `SessionStart hooks; stderr: ${stderr.join('')}`).toEqual([
      ['success', 0],
      ['success', 0],
    ])
    return responses
      .filter((r) => r.stdout.trim() !== '')
      .map((r) => (JSON.parse(r.stdout) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext.split('\n')[0]!)
      .sort()
  }

  it('a Product Session (WORFY_SESSION_KIND=product): the hook sees the variable and gives the product rules, not the orchestrator rules', async () => {
    expect(await sessionStartRules('product')).toEqual(['# worfy Harness — product rules'])
  })

  it('a Session without the variable: the orchestrator rules, as before, and no product rules', async () => {
    expect(await sessionStartRules(undefined)).toEqual(['# worfy Harness — orchestrator rules'])
  })
})
