// What a Vendor can do, as the interface reads it (src/shared/vendors/capabilities.ts, ADR-0094 item 2):
// the schema of the capabilities and the static capabilities of Claude Code, taken from today's code.
import { describe, expect, it } from 'vitest'
import { EFFORT_LEVELS, PERMISSION_MODES } from '../../src/shared/agent/settings'
import { CAPABILITY_FLAGS, capabilitiesSchema, CLAUDE_CAPABILITIES, type Capabilities } from '../../src/shared/vendors/capabilities'
import { VENDOR_IDS, VENDOR_LABELS, vendorIdSchema } from '../../src/shared/vendors/vendor'

describe('the capabilities of Claude Code', () => {
  it('offers the four permission modes of the picker as presets, in its order, with the labels it shows', () => {
    expect(CLAUDE_CAPABILITIES.permissionPresets.map((preset) => preset.id)).toEqual(['bypassPermissions', 'acceptEdits', 'default', 'plan'])
    expect(CLAUDE_CAPABILITIES.permissionPresets.map((preset) => preset.id)).toEqual([...PERMISSION_MODES])
    expect(CLAUDE_CAPABILITIES.permissionPresets.map((preset) => preset.label)).toEqual(['Bypass permissions', 'Accept edits', 'Ask before tools', 'Plan only'])
    for (const preset of CLAUDE_CAPABILITIES.permissionPresets) expect(preset.description).not.toBe('')
  })

  it('offers the five effort levels the SDK takes, in their order', () => {
    expect(CLAUDE_CAPABILITIES.effortLevels).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    expect(CLAUDE_CAPABILITIES.effortLevels).toEqual([...EFFORT_LEVELS])
  })

  it('reads the Limits as windows', () => {
    expect(CLAUDE_CAPABILITIES.limitSource).toBe('windows')
  })

  it('has every capability but steer: a message sent during a turn waits in the queue of the Session', () => {
    const missing = CAPABILITY_FLAGS.filter((flag) => !CLAUDE_CAPABILITIES[flag])
    expect(missing).toEqual(['steer'])
    expect(Object.keys(CLAUDE_CAPABILITIES.unsupported)).toEqual(['steer'])
    expect(CLAUDE_CAPABILITIES.unsupported.steer).toMatch(/queue/)
  })

  it('passes its own schema', () => {
    expect(capabilitiesSchema.parse(CLAUDE_CAPABILITIES)).toEqual(CLAUDE_CAPABILITIES)
  })
})

describe('the capabilities schema', () => {
  const valid = (): Capabilities => structuredClone(CLAUDE_CAPABILITIES) as Capabilities

  it('names the eleven flags of the spec', () => {
    expect([...CAPABILITY_FLAGS]).toEqual([
      'subagents',
      'hooks',
      'inProcessMcp',
      'canvasTools',
      'steer',
      'resume',
      'historyList',
      'modelSwitchStable',
      'oneShotToolFree',
      'commandsComplete',
      'harness',
    ])
  })

  it('takes the three Limit sources and nothing else', () => {
    for (const limitSource of ['windows', 'errorOnly', 'none'] as const) expect(capabilitiesSchema.safeParse({ ...valid(), limitSource }).success).toBe(true)
    expect(capabilitiesSchema.safeParse({ ...valid(), limitSource: 'statusline' }).success).toBe(false)
  })

  it('refuses a missing capability without a reason: the tooltip would have nothing to say', () => {
    const result = capabilitiesSchema.safeParse({ ...valid(), hooks: false })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['unsupported', 'hooks'])
  })

  it('takes a missing capability with its reason', () => {
    expect(capabilitiesSchema.safeParse({ ...valid(), hooks: false, unsupported: { ...valid().unsupported, hooks: 'no hooks here' } }).success).toBe(true)
  })

  it('refuses a reason for a capability the Vendor has', () => {
    const result = capabilitiesSchema.safeParse({ ...valid(), unsupported: { ...valid().unsupported, resume: 'cannot resume' } })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['unsupported', 'resume'])
  })

  it('refuses an empty reason', () => {
    expect(capabilitiesSchema.safeParse({ ...valid(), unsupported: { steer: '' } }).success).toBe(false)
  })

  it('refuses a preset without a label, and two presets with one id', () => {
    const [first, second] = valid().permissionPresets
    expect(capabilitiesSchema.safeParse({ ...valid(), permissionPresets: [{ ...first, label: '' }] }).success).toBe(false)
    expect(capabilitiesSchema.safeParse({ ...valid(), permissionPresets: [first, { ...second, id: first?.id }] }).success).toBe(false)
  })
})

describe('the Vendors', () => {
  it('are Claude Code and Codex, each with the label the interface shows', () => {
    expect([...VENDOR_IDS]).toEqual(['claude', 'codex'])
    expect(VENDOR_LABELS).toEqual({ claude: 'Claude Code', codex: 'Codex' })
    expect(vendorIdSchema.safeParse('codex').success).toBe(true)
    expect(vendorIdSchema.safeParse('gemini').success).toBe(false)
  })
})
