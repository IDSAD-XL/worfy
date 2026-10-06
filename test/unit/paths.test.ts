import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { claudeHome, dataRoot, setBuildKind } from '../../src/main/storage/paths'

describe('storage paths', () => {
  it('uses WORFY_DATA_DIR as the data root when it is set', () => {
    expect(dataRoot({ WORFY_DATA_DIR: '/tmp/worfy-data' })).toBe('/tmp/worfy-data')
  })

  it('defaults the data root to ~/Library/Application Support/worfy', () => {
    expect(dataRoot({})).toBe(join(homedir(), 'Library', 'Application Support', 'worfy'))
  })

  it('ignores an empty WORFY_DATA_DIR', () => {
    expect(dataRoot({ WORFY_DATA_DIR: '' })).toBe(join(homedir(), 'Library', 'Application Support', 'worfy'))
  })

  it('uses WORFY_CLAUDE_HOME as the Claude home when it is set', () => {
    expect(claudeHome({ WORFY_CLAUDE_HOME: '/tmp/claude-home' })).toBe('/tmp/claude-home')
  })

  it('defaults the Claude home to ~/.claude', () => {
    expect(claudeHome({})).toBe(join(homedir(), '.claude'))
  })

  it('resolves a relative override to an absolute path', () => {
    expect(dataRoot({ WORFY_DATA_DIR: 'rel/data' })).toBe(join(process.cwd(), 'rel', 'data'))
  })

  it('ignores an empty WORFY_CLAUDE_HOME', () => {
    expect(claudeHome({ WORFY_CLAUDE_HOME: '' })).toBe(join(homedir(), '.claude'))
  })

  it('resolves a relative WORFY_CLAUDE_HOME to an absolute path', () => {
    expect(claudeHome({ WORFY_CLAUDE_HOME: 'rel/claude' })).toBe(join(process.cwd(), 'rel', 'claude'))
  })
})

describe('data root of the packaged app and of a dev run', () => {
  const applicationSupport = join(homedir(), 'Library', 'Application Support')

  it('gives a dev run worfy-dev and the packaged app worfy, so the two never share limits.json and bindings.json', () => {
    const packaged = dataRoot({}, 'packaged')
    const dev = dataRoot({}, 'dev')
    expect(packaged).toBe(join(applicationSupport, 'worfy'))
    expect(dev).toBe(join(applicationSupport, 'worfy-dev'))
    expect(join(dev, 'limits.json')).not.toBe(join(packaged, 'limits.json'))
    expect(join(dev, 'bindings.json')).not.toBe(join(packaged, 'bindings.json'))
  })

  it('lets WORFY_DATA_DIR win over the build kind, so e2e runs stay in their temporary folder', () => {
    expect(dataRoot({ WORFY_DATA_DIR: '/tmp/worfy-data' }, 'dev')).toBe('/tmp/worfy-data')
    expect(dataRoot({ WORFY_DATA_DIR: '/tmp/worfy-data' }, 'packaged')).toBe('/tmp/worfy-data')
  })

  it('switches the default of every later dataRoot() call once the entry point reports a dev run', () => {
    try {
      expect(dataRoot({})).toBe(join(applicationSupport, 'worfy'))
      setBuildKind('dev')
      expect(dataRoot({})).toBe(join(applicationSupport, 'worfy-dev'))
      setBuildKind('packaged')
      expect(dataRoot({})).toBe(join(applicationSupport, 'worfy'))
    } finally {
      setBuildKind('packaged')
    }
  })
})
