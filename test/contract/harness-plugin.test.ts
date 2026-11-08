// The Harness is the Claude Code plugin `worfy` (ADR-0019); its source is harness/ (ticket
// worfy-harness/02). This test pins the manifest fields the ticket sets and keeps out of harness/
// the files of ~/.claude that are not the Harness: personal scripts, tests of personal profiles'
// code, agents and hooks of single projects, machine state.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

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
