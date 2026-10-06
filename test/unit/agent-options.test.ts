// sessionOptions for an ordinary Session and for one launched unattended (Autopilot, worfy-daily
// ticket 02): the permission mode Claude Code starts in, the flag that lets it skip permissions, and
// the canUseTool the Session hands over. And the MCP servers of a Session (worfy-daily ticket 06,
// ADR-0021): in a Project only those on the Profile's list, outside a Project the user's own set.
import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'
import { sessionOptions, type CanvasAttachment, type RuntimeInfo, type SessionOptionsInput } from '../../src/main/agent/options'
import type { CanUseToolHandler } from '../../src/main/agent/permissions'
import { DEFAULT_MCP_SERVERS } from '../../src/main/workflow/profile'
import { PERMISSION_MODES, type SessionSettings } from '../../src/shared/agent/settings'
import { CANVAS_SERVER_NAME } from '../../src/shared/canvas/tools'

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

const canvasServer = { type: 'sdk', name: CANVAS_SERVER_NAME } as unknown as McpServerConfig
const canvas: CanvasAttachment = { server: canvasServer, cardsDir: '/data/project/cards', instructions: 'Use the worfy-canvas tools.' }

describe('MCP servers of a Session in a Project', () => {
  it('with the list [qmd], allows only qmd: the user servers outside the list and worfy-canvas are left out', () => {
    const options = sessionOptions(input({ canvas, mcpAllowlist: ['qmd'] }))
    // The allowlist is the policy tier Claude Code applies to every server the user's settings bring
    // (user, project and local config, plugins, claude.ai connectors); only the Profile's names pass.
    expect(options.managedSettings).toEqual({ allowManagedMcpServersOnly: true, allowedMcpServers: [{ serverName: 'qmd' }] })
    // An SDK server is not covered by that policy, so worfy-canvas is only passed when it is listed.
    expect(options).not.toHaveProperty('mcpServers')
    expect(options.systemPrompt).toEqual({ type: 'preset', preset: 'claude_code' })
    // The user's CLAUDE.md, hooks and skills still come from their settings (ADR-0002).
    expect(options.settingSources).toEqual(['user', 'project', 'local'])
    expect(options).not.toHaveProperty('strictMcpConfig')
  })

  it('with the default list, gets qmd and worfy-canvas with the canvas instructions', () => {
    const options = sessionOptions(input({ canvas, mcpAllowlist: DEFAULT_MCP_SERVERS }))
    expect(options.managedSettings).toEqual({
      allowManagedMcpServersOnly: true,
      allowedMcpServers: [{ serverName: 'qmd' }, { serverName: CANVAS_SERVER_NAME }],
    })
    expect(options.mcpServers).toEqual({ [CANVAS_SERVER_NAME]: canvasServer })
    expect(options.additionalDirectories).toEqual([canvas.cardsDir])
    expect(options.systemPrompt).toEqual({ type: 'preset', preset: 'claude_code', append: canvas.instructions })
  })

  it('with an empty list, allows no MCP server at all', () => {
    const options = sessionOptions(input({ canvas, mcpAllowlist: [] }))
    expect(options.managedSettings).toEqual({ allowManagedMcpServersOnly: true, allowedMcpServers: [] })
    expect(options).not.toHaveProperty('mcpServers')
  })

  it('without a list, works as before: the user servers plus worfy-canvas', () => {
    const options = sessionOptions(input({ canvas }))
    expect(options).not.toHaveProperty('managedSettings')
    expect(options.mcpServers).toEqual({ [CANVAS_SERVER_NAME]: canvasServer })
  })
})

describe('MCP servers of a Session outside a Project', () => {
  it('are the user servers as they are: no allowlist, no worfy-canvas', () => {
    const options = sessionOptions(input({ canvas: null, mcpAllowlist: null }))
    expect(options).not.toHaveProperty('managedSettings')
    expect(options).not.toHaveProperty('mcpServers')
    expect(options.systemPrompt).toEqual({ type: 'preset', preset: 'claude_code' })
  })
})
