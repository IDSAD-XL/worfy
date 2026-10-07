import { describe, expect, it } from 'vitest'
import { harnessName, subagentTypeLabel } from '../../src/shared/agent/subagent-type'

// The Harness ships as the plugin `worfy` (ADR-0040): its Subagent types read `worfy:implementer`,
// and worfy shows them without the plugin (ticket worfy-harness/10).

describe('subagentTypeLabel', () => {
  it('drops the Harness plugin and keeps every other type as it is', () => {
    expect(subagentTypeLabel('worfy:implementer')).toBe('implementer')
    expect(subagentTypeLabel('worfy:reviewer')).toBe('reviewer')
    expect(subagentTypeLabel('scout')).toBe('scout')
    expect(subagentTypeLabel('mattpocock-skills:x')).toBe('mattpocock-skills:x')
    expect(subagentTypeLabel('workflow')).toBe('workflow')
    expect(subagentTypeLabel(null)).toBeNull()
  })

  it('keeps a type that is the bare prefix or only looks like it', () => {
    expect(subagentTypeLabel('worfy:')).toBe('worfy:')
    expect(subagentTypeLabel('worfyx:implementer')).toBe('worfyx:implementer')
    expect(subagentTypeLabel('other:worfy:implementer')).toBe('other:worfy:implementer')
  })
})

describe('harnessName', () => {
  it('is the name without `worfy:`, the bare name as it is, and null for another plugin', () => {
    expect(harnessName('worfy:epic-wave')).toBe('epic-wave')
    expect(harnessName('epic-wave')).toBe('epic-wave')
    expect(harnessName('other:epic-wave')).toBeNull()
    expect(harnessName('worfyx:epic-wave')).toBeNull()
  })
})
