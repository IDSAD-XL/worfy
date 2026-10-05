import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { claudeHome, dataRoot } from '../../src/main/storage/paths'

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
})
