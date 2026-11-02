// The static capabilities of Codex and its driver of stubs (src/main/vendors/codex/; worfy-multi-vendor
// ticket 17): three permission presets in Codex's words, each an approval policy and a sandbox; what
// Codex lacks comes with the reason a tooltip shows; every part that later tickets wire answers that it
// is not wired yet. Nothing here runs Codex.
import { describe, expect, it } from 'vitest'
import { capabilitiesSchema } from '../../src/shared/vendors/capabilities'
import { CODEX_CAPABILITIES, CODEX_PERMISSION_PRESETS, codexPermissionPreset } from '../../src/main/vendors/codex/capabilities'
import { codexDriver } from '../../src/main/vendors/codex'
import { PartNotWired } from '../../src/main/vendors/driver'
import type { SessionStart } from '../../src/main/vendors/session'
import { DEFAULT_SETTINGS } from '../../src/shared/agent/settings'

describe('the capabilities of Codex', () => {
  it('pass the schema of capabilities', () => {
    expect(capabilitiesSchema.parse(CODEX_CAPABILITIES)).toEqual(CODEX_CAPABILITIES)
  })

  it('has three presets in Codex\'s words, each an approval policy and a sandbox', () => {
    expect(CODEX_PERMISSION_PRESETS.map(({ id, label, approvalPolicy, sandbox }) => ({ id, label, approvalPolicy, sandbox }))).toEqual([
      { id: 'read-only', label: 'Read only', approvalPolicy: 'on-request', sandbox: 'read-only' },
      { id: 'auto', label: 'Auto', approvalPolicy: 'on-request', sandbox: 'workspace-write' },
      { id: 'full-access', label: 'Full access', approvalPolicy: 'never', sandbox: 'danger-full-access' },
    ])
    expect(CODEX_CAPABILITIES.permissionPresets).toEqual(CODEX_PERMISSION_PRESETS.map(({ id, label, description }) => ({ id, label, description })))
  })

  it('finds a preset by its id, and none for an id of Claude', () => {
    expect(codexPermissionPreset('auto')?.sandbox).toBe('workspace-write')
    expect(codexPermissionPreset('bypassPermissions')).toBeUndefined()
  })

  it('steers, resumes, lists past Sessions, keeps a model change, and has Limit windows', () => {
    expect(CODEX_CAPABILITIES).toMatchObject({ steer: true, resume: true, historyList: true, modelSwitchStable: true, limitSource: 'windows' })
  })

  it('lacks Subagents, MCP in the app\'s process, the canvas tools, hooks and the Harness, each with a reason', () => {
    for (const flag of ['subagents', 'inProcessMcp', 'canvasTools', 'hooks', 'harness', 'oneShotToolFree', 'commandsComplete'] as const) {
      expect(CODEX_CAPABILITIES[flag]).toBe(false)
      expect(CODEX_CAPABILITIES.unsupported[flag]).toMatch(/\w/)
    }
  })

  it('knows no models or effort levels until the running version tells them', () => {
    expect(CODEX_CAPABILITIES.models).toEqual([])
    expect(CODEX_CAPABILITIES.effortLevels).toEqual([])
  })
})

describe('the Codex driver', () => {
  const start: SessionStart = {
    cwd: '/p',
    settings: DEFAULT_SETTINGS,
    unattended: false,
    orchestrator: false,
    permissions: { ask: () => Promise.resolve(null), askQuestions: () => Promise.resolve({ outcome: 'cancelled' }) },
    refused: () => undefined,
    stderr: () => undefined,
    spawned: () => undefined,
  }

  it('is the codex driver, the same object each time, with the static capabilities', async () => {
    const driver = codexDriver()
    expect(driver.id).toBe('codex')
    expect(codexDriver()).toBe(driver)
    expect(await driver.capabilities()).toBe(CODEX_CAPABILITIES)
  })

  it('reaches worfy\'s MCP servers over HTTP', () => {
    expect(codexDriver().mcp.delivery).toBe('http')
  })

  it('answers every part it does not run yet with PartNotWired, naming the ticket that wires it', async () => {
    const { session, history, oneShot } = codexDriver()
    const cases: [Promise<unknown>, RegExp][] = [
      [session.start(start), /session of the codex driver .*ticket 20/],
      [session.resume('t-1', start), /session of the codex driver .*ticket 20/],
      [history.list('/p'), /history of the codex driver .*ticket 22/],
      [history.read('t-1', '/p'), /history of the codex driver .*ticket 22/],
      [oneShot('hi', { cwd: '/p' }), /oneShot of the codex driver .*first release/],
    ]
    for (const [answer, message] of cases) {
      const error: unknown = await answer.catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(PartNotWired)
      expect((error as Error).message).toMatch(message)
    }
  })

  it('answers the slash menu with PartNotWired too', async () => {
    const handle = {} as Parameters<ReturnType<typeof codexDriver>['commands']['list']>[0]
    await expect(codexDriver().commands.list(handle)).rejects.toThrow(/commands of the codex driver .*ticket 22/)
  })
})
