// The static capabilities of Codex and its driver of stubs (src/main/vendors/codex/; worfy-multi-vendor
// ticket 17): three permission presets in Codex's words, each an approval policy and a sandbox; what
// Codex lacks comes with the reason a tooltip shows; every part that later tickets wire answers that it
// is not wired yet. The models and effort levels of `model/list` (ticket 20), and the preset a Session's
// permission setting means. Nothing here runs Codex.
import { describe, expect, it, vi } from 'vitest'
import { capabilitiesSchema } from '../../src/shared/vendors/capabilities'
import {
  capabilitiesWithModels,
  CODEX_CAPABILITIES,
  CODEX_PERMISSION_PRESETS,
  codexCapabilities,
  codexModelOptions,
  codexModelSource,
  codexPermissionPreset,
  codexPresetFor,
  codexSandboxPolicy,
  codexSettings,
} from '../../src/main/vendors/codex/capabilities'
import { DEFAULT_SETTINGS, OTHER_VENDOR_PRESETS, sessionSettingsSchema } from '../../src/shared/agent/settings'
import type { Model } from '../../src/main/vendors/codex/protocol/ts/v2/Model'
import { codexDriver } from '../../src/main/vendors/codex'
import { PartNotWired } from '../../src/main/vendors/driver'
import type { SessionHandle } from '../../src/main/vendors/session'

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

  it('has the canvas tools (over HTTP, ticket 33), with no reason they are missing', () => {
    expect(CODEX_CAPABILITIES.canvasTools).toBe(true)
    expect(CODEX_CAPABILITIES.unsupported.canvasTools).toBeUndefined()
  })

  it('has Subagents on the canvas (ticket 34), with no reason they are missing', () => {
    expect(CODEX_CAPABILITIES.subagents).toBe(true)
    expect(CODEX_CAPABILITIES.unsupported.subagents).toBeUndefined()
  })

  it('lacks MCP in the app\'s process, hooks and the Harness, each with a reason', () => {
    for (const flag of ['inProcessMcp', 'hooks', 'harness', 'oneShotToolFree', 'commandsComplete'] as const) {
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
  it('is the codex driver, the same object each time, with the static capabilities', async () => {
    const driver = codexDriver()
    expect(driver.id).toBe('codex')
    expect(codexDriver()).toBe(driver)
    expect(await driver.capabilities()).toBe(CODEX_CAPABILITIES)
  })

  it('reaches worfy\'s MCP servers over HTTP', () => {
    expect(codexDriver().mcp.delivery).toBe('http')
  })

  it('answers the part it does not run in the first release with PartNotWired, saying so', async () => {
    const error: unknown = await codexDriver()
      .oneShot('hi', { cwd: '/p' })
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(PartNotWired)
    expect((error as Error).message).toMatch(/oneShot of the codex driver .*first release/)
  })

  it('lists the slash menu only of a Codex Session\'s handle', async () => {
    const handle = {} as Parameters<ReturnType<typeof codexDriver>['commands']['list']>[0]
    await expect(codexDriver().commands.list(handle)).rejects.toThrow(/Session handle of the Codex driver/)
  })
})

describe('the presets of a Session\'s permission setting', () => {
  it('takes a preset of Codex by its id, and stands one in for each permission mode of Claude Code', () => {
    expect(['read-only', 'auto', 'full-access', 'bypassPermissions', 'acceptEdits', 'default', 'plan'].map((setting) => codexPresetFor(setting)?.id)).toEqual([
      'read-only', 'auto', 'full-access', 'full-access', 'auto', 'read-only', 'read-only',
    ])
    expect(codexPresetFor('everything')).toBeUndefined()
    expect(codexPresetFor('')).toBeUndefined()
  })

  // worfy-multi-vendor ticket 25: a Session's settings carry the Vendor's own preset and effort ids.
  it("puts a Session's settings in Codex's terms: a mode of Claude Code becomes its preset, an effort Codex has no name for the default", () => {
    expect(codexSettings(DEFAULT_SETTINGS)).toEqual({ model: null, effort: null, permissionMode: 'full-access' })
    expect(codexSettings({ model: 'gpt-5.5-codex', effort: 'max', permissionMode: 'acceptEdits' })).toEqual({ model: 'gpt-5.5-codex', effort: null, permissionMode: 'auto' })
    const own = { model: null, effort: 'minimal', permissionMode: 'read-only' }
    expect(codexSettings(own)).toBe(own)
  })

  it("takes in a Session's settings every preset id and effort level Codex has, and the settings schema names no other Vendor's", () => {
    expect([...OTHER_VENDOR_PRESETS].sort()).toEqual(CODEX_PERMISSION_PRESETS.map((preset) => preset.id).sort())
    for (const preset of CODEX_PERMISSION_PRESETS) expect(sessionSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, permissionMode: preset.id }).success, preset.id).toBe(true)
    for (const level of ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']) expect(sessionSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, effort: level }).success, level).toBe(true)
  })

  it('gives each sandbox mode the policy of a turn: no network, nothing beyond the workspace', () => {
    expect(codexSandboxPolicy('read-only')).toEqual({ type: 'readOnly', networkAccess: false })
    expect(codexSandboxPolicy('workspace-write')).toEqual({ type: 'workspaceWrite', writableRoots: [], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false })
    expect(codexSandboxPolicy('danger-full-access')).toEqual({ type: 'dangerFullAccess' })
  })
})

describe('the models of model/list', () => {
  const model = (slug: string, efforts: string[], fields: Partial<Model> = {}): Model =>
    ({
      id: `id-${slug}`,
      model: slug,
      displayName: slug.toUpperCase(),
      description: '',
      hidden: false,
      isDefault: false,
      supportedReasoningEfforts: efforts.map((reasoningEffort) => ({ reasoningEffort, description: reasoningEffort })),
      defaultReasoningEffort: efforts[0] ?? 'medium',
      ...fields,
    }) as Model
  const models = [
    model('b', ['high', 'ultra', 'low']),
    model('a', ['xhigh', 'minimal', 'none', 'turbo'], { isDefault: true }),
    model('hidden', ['medium'], { hidden: true }),
    model('b', ['medium']),
  ]

  it('lists the models it does not hide, each once by its model name, and every effort level lowest first, unknown ones after', () => {
    const capabilities = capabilitiesWithModels(models)
    expect(capabilities.models).toEqual([
      { id: 'b', label: 'B', effortLevels: ['high', 'ultra', 'low'] },
      { id: 'a', label: 'A', effortLevels: ['xhigh', 'minimal', 'none', 'turbo'] },
    ])
    expect(capabilities.effortLevels).toEqual(['none', 'minimal', 'low', 'high', 'xhigh', 'ultra', 'turbo'])
    expect(capabilitiesSchema.parse(capabilities)).toEqual(capabilities)
    expect({ ...capabilities, models: [], effortLevels: [] }).toEqual(CODEX_CAPABILITIES)
  })

  it('a model without effort levels takes none', () => {
    const bare = { ...model('c', []), supportedReasoningEfforts: undefined } as unknown as Model
    expect(capabilitiesWithModels([bare]).models).toEqual([{ id: 'c', label: 'C', effortLevels: [] }])
    expect(codexModelOptions([bare])).toEqual([{ value: 'c', displayName: 'C', efforts: [] }])
  })

  it('gives the picker "Default" for Codex\'s default model first, then each model, with the levels a Session\'s settings take', () => {
    // Codex's own levels (none, minimal) since the pickers read the capabilities (ticket 25); one worfy has no name for is left out.
    expect(codexModelOptions(models)).toEqual([
      { value: null, displayName: 'Default (A)', efforts: ['xhigh', 'minimal', 'none'] },
      { value: 'b', displayName: 'B', efforts: ['high', 'low'] },
      { value: 'a', displayName: 'A', efforts: ['xhigh', 'minimal', 'none'] },
    ])
    expect(codexModelOptions(models.filter((each) => !each.isDefault))[0]?.value).toBe('b')
  })

  it('asks a Codex Session for its models: the static capabilities without one, when it fails and when it lists none', async () => {
    const source = (list: () => Promise<Model[]>) => ({ codexModels: list }) as unknown as SessionHandle
    expect(codexModelSource(undefined)).toBeNull()
    expect(codexModelSource({} as SessionHandle)).toBeNull()
    const handle = source(() => Promise.resolve(models))
    expect(codexModelSource(handle)).toBe(handle)
    expect(await codexCapabilities()).toBe(CODEX_CAPABILITIES)
    expect(await codexCapabilities({} as SessionHandle)).toBe(CODEX_CAPABILITIES)
    expect(await codexCapabilities(handle)).toEqual(capabilitiesWithModels(models))
    expect(await codexCapabilities(source(() => Promise.resolve([models[2] as Model])))).toBe(CODEX_CAPABILITIES)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      expect(await codexCapabilities(source(() => Promise.reject(new Error('gone'))))).toBe(CODEX_CAPABILITIES)
      expect(warn).toHaveBeenCalledOnce()
    } finally {
      warn.mockRestore()
    }
  })
})
