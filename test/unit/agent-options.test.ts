// sessionOptions for an ordinary Session and for one launched unattended (Autopilot, worfy-daily
// ticket 02): the permission mode Claude Code starts in, the flag that lets it skip permissions, and
// the canUseTool the Session hands over.
import { describe, expect, it } from 'vitest'
import { sessionOptions, type RuntimeInfo, type SessionOptionsInput } from '../../src/main/agent/options'
import type { CanUseToolHandler } from '../../src/main/agent/permissions'
import { PERMISSION_MODES, type SessionSettings } from '../../src/shared/agent/settings'

const runtime: RuntimeInfo = { packaged: false, resourcesPath: '/nowhere', platform: 'darwin', arch: 'arm64' }
const env = { PATH: '/usr/bin', HOME: '/Users/me' }
const canUseTool: CanUseToolHandler = () => Promise.resolve({ behavior: 'deny', message: 'no' })
const input = (more: Partial<SessionOptionsInput>): SessionOptionsInput => ({ cwd: '/repo', env, runtime, ...more })
const settings = (permissionMode: SessionSettings['permissionMode']): SessionSettings => ({ model: null, effort: null, permissionMode })

describe('sessionOptions of an ordinary Session', () => {
  it.each(PERMISSION_MODES)('starts in the mode the Session carries: %s', (mode) => {
    const options = sessionOptions(input({ settings: settings(mode), canUseTool }))
    expect(options.permissionMode).toBe(mode)
    expect(options.allowDangerouslySkipPermissions).toBe(true)
    expect(options.canUseTool).toBe(canUseTool)
  })

  it('is the same when `unattended` is false', () => {
    expect(sessionOptions(input({ settings: settings('plan'), unattended: false })).permissionMode).toBe('plan')
  })
})

describe('sessionOptions of an unattended Session', () => {
  it.each(PERMISSION_MODES)('starts in bypassPermissions whatever the settings carry: %s', (mode) => {
    const options = sessionOptions(input({ settings: settings(mode), canUseTool, unattended: true }))
    expect(options.permissionMode).toBe('bypassPermissions')
    expect(options.allowDangerouslySkipPermissions).toBe(true)
    // The Session's own handler, which refuses at once (permissions.ts, unattendedCanUseTool).
    expect(options.canUseTool).toBe(canUseTool)
  })

  it('keeps the model and effort it was given', () => {
    const options = sessionOptions(input({ settings: { model: 'opus', effort: 'low', permissionMode: 'default' }, unattended: true }))
    expect(options).toMatchObject({ model: 'opus', effort: 'low', permissionMode: 'bypassPermissions' })
  })

  it('starts in bypassPermissions without settings too', () => {
    expect(sessionOptions(input({ unattended: true })).permissionMode).toBe('bypassPermissions')
  })
})
