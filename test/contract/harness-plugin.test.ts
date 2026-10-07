// The Harness is the Claude Code plugin `worfy` (ADR-0019); its source is harness/ (ticket
// worfy-harness/02). This test pins the manifest fields the ticket sets and keeps out of harness/
// the files of ~/.claude that are not the Harness: personal scripts, tests of personal profiles'
// code, agents and hooks of single projects, machine state.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
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

// A dependency is "name@marketplace" or { name, marketplace } (both pass `claude plugin validate`).
const dependencyName = (dep: unknown): string | undefined => {
  if (typeof dep === 'string') return dep.split('@')[0]
  if (dep && typeof dep === 'object' && 'name' in dep && typeof dep.name === 'string') return dep.name
  return undefined
}

const listFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? listFiles(path) : [relative(HARNESS, path)]
  })

describe('harness/.claude-plugin/plugin.json', () => {
  it('names the plugin worfy and describes it', () => {
    const manifest = readManifest()
    expect(manifest.name).toBe('worfy')
    expect(typeof manifest.description).toBe('string')
  })

  it('depends on mattpocock-skills from claude-plugins-official', () => {
    const deps = readManifest().dependencies
    expect(Array.isArray(deps)).toBe(true)
    const names = (deps as unknown[]).map(dependencyName)
    expect(names).toContain('mattpocock-skills')
    const dep = (deps as unknown[])[names.indexOf('mattpocock-skills')]
    const marketplace = typeof dep === 'string' ? dep.split('@')[1] : (dep as { marketplace?: unknown }).marketplace
    expect(marketplace).toBe('claude-plugins-official')
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
        'rules/global.md',
        'agents/implementer.md',
        'skills/epic-wave/SKILL.md',
        'bin/profile',
        'hooks/gate.sh',
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
    // rules live in rules/global.md instead.
    ['CLAUDE.md', /(^|\/)CLAUDE\.md$/],
  ]

  it.each(NOT_HARNESS)('has no %s', (_what, pattern) => {
    expect(files.filter((file) => pattern.test(file))).toEqual([])
  })
})
