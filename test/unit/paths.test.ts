import { homedir } from 'node:os'
import { join, resolve, win32 } from 'node:path'
import { describe, expect, it } from 'vitest'
import { claudeHome, dataRoot, harnessHome, setBuildKind } from '../../src/main/storage/paths'

describe('storage paths', () => {
  it('uses WORFY_DATA_DIR as the data root when it is set', () => {
    expect(dataRoot({ WORFY_DATA_DIR: '/tmp/worfy-data' })).toBe('/tmp/worfy-data')
  })

  it('defaults the data root to ~/Library/Application Support/worfy', () => {
    expect(dataRoot({}, 'packaged', 'darwin')).toBe(join(homedir(), 'Library', 'Application Support', 'worfy'))
  })

  it('ignores an empty WORFY_DATA_DIR', () => {
    expect(dataRoot({ WORFY_DATA_DIR: '' }, 'packaged', 'darwin')).toBe(join(homedir(), 'Library', 'Application Support', 'worfy'))
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

describe('Harness home (worfy-harness ticket 12)', () => {
  it('uses WORFY_HARNESS_HOME when it is set, resolved to an absolute path', () => {
    expect(harnessHome({ WORFY_HARNESS_HOME: '/tmp/harness-home', WORFY_CLAUDE_HOME: '/tmp/claude-home' })).toBe('/tmp/harness-home')
    expect(harnessHome({ WORFY_HARNESS_HOME: 'rel/harness' })).toBe(join(process.cwd(), 'rel', 'harness'))
  })

  it('defaults to <claudeHome()>/worfy-harness, so a temporary WORFY_CLAUDE_HOME never reaches the real one', () => {
    expect(harnessHome({ WORFY_CLAUDE_HOME: '/tmp/claude-home' })).toBe(join('/tmp/claude-home', 'worfy-harness'))
    expect(harnessHome({})).toBe(join(homedir(), '.claude', 'worfy-harness'))
    expect(harnessHome({ WORFY_HARNESS_HOME: '' })).toBe(join(homedir(), '.claude', 'worfy-harness'))
  })

  it('sits in the Claude home it is given when the variable is not set', () => {
    expect(harnessHome({}, '/tmp/other-claude')).toBe(join('/tmp/other-claude', 'worfy-harness'))
    expect(harnessHome({ WORFY_HARNESS_HOME: '/tmp/harness-home' }, '/tmp/other-claude')).toBe('/tmp/harness-home')
  })
})

describe('data root of the packaged app and of a dev run', () => {
  const applicationSupport = join(homedir(), 'Library', 'Application Support')

  it('gives a dev run worfy-dev and the packaged app worfy, so the two never share limits.json and bindings.json', () => {
    const packaged = dataRoot({}, 'packaged', 'darwin')
    const dev = dataRoot({}, 'dev', 'darwin')
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
      expect(dataRoot({}, undefined, 'darwin')).toBe(join(applicationSupport, 'worfy'))
      setBuildKind('dev')
      expect(dataRoot({}, undefined, 'darwin')).toBe(join(applicationSupport, 'worfy-dev'))
      setBuildKind('packaged')
      expect(dataRoot({}, undefined, 'darwin')).toBe(join(applicationSupport, 'worfy'))
    } finally {
      setBuildKind('packaged')
    }
  })
})

describe('data root on Windows (worfy-windows ticket 08)', () => {
  const appData = 'C:\\Users\\u\\AppData\\Roaming'

  it('is %APPDATA%\\worfy for the packaged app and %APPDATA%\\worfy-dev for a dev run', () => {
    expect(dataRoot({ APPDATA: appData }, 'packaged', 'win32')).toBe('C:\\Users\\u\\AppData\\Roaming\\worfy')
    expect(dataRoot({ APPDATA: appData }, 'dev', 'win32')).toBe('C:\\Users\\u\\AppData\\Roaming\\worfy-dev')
  })

  it('without APPDATA, or with one that is not absolute, is <home>\\AppData\\Roaming\\…', () => {
    for (const env of [{}, { APPDATA: '' }, { APPDATA: 'Roaming' }, { APPDATA: '/x' }, { APPDATA: '\\x' }, { APPDATA: 'C:x' }]) {
      expect(dataRoot(env, 'packaged', 'win32')).toBe(win32.join(homedir(), 'AppData', 'Roaming', 'worfy'))
      expect(dataRoot(env, 'dev', 'win32')).toBe(win32.join(homedir(), 'AppData', 'Roaming', 'worfy-dev'))
    }
  })

  it('lets WORFY_DATA_DIR win on Windows too', () => {
    expect(dataRoot({ APPDATA: appData, WORFY_DATA_DIR: '/tmp/worfy-data' }, 'dev', 'win32')).toBe(resolve('/tmp/worfy-data'))
  })

  it('keeps the macOS folders for darwin and for every other system, so Linux CI does not change', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      expect(dataRoot({ APPDATA: appData }, 'packaged', platform)).toBe(join(homedir(), 'Library', 'Application Support', 'worfy'))
      expect(dataRoot({ APPDATA: appData }, 'dev', platform)).toBe(join(homedir(), 'Library', 'Application Support', 'worfy-dev'))
    }
  })
})
