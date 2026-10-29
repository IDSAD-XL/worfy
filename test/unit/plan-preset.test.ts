// The preset of a subscription plan (worfy-throughput ticket 42): which plan a `subscriptionType`
// names, and which preset worfy offers for it. Pro gets one; Max, the other plans and any string
// the rule does not know get none.
import { describe, expect, it } from 'vitest'
import { PLAN_PRESETS, planOf, presetFor, presetInUse } from '../../src/shared/agent/plan-preset'

const SONNET_MEDIUM = { model: 'sonnet', effort: 'medium' }

describe('planOf', () => {
  it.each([
    // What Claude Code 2.1.289 answers in accountInfo(): "Claude " and the plan, or "Claude <plan_display_name>".
    ['Claude Pro', 'pro'],
    ['Claude Max', 'max'],
    ['Claude Team', 'team'],
    ['Claude Enterprise', 'enterprise'],
    // Max with its tier in the display name.
    ['Claude Max 5x', 'max'],
    ['Claude Max 20x', 'max'],
    // The plan's code alone, as the tests of the first-run checks spell it, and other cases and spaces.
    ['pro', 'pro'],
    ['max', 'max'],
    ['  claude PRO  ', 'pro'],
  ])('%j is %s', (subscriptionType, plan) => {
    expect(planOf(subscriptionType)).toBe(plan)
  })

  it.each([null, undefined, '', 'Claude API', 'Claude', 'Claude Pro Plus', 'Claude Promo', 'Professional', 'Claude Maximum', 'free'])('%j is no plan worfy knows', (subscriptionType) => {
    expect(planOf(subscriptionType)).toBeNull()
  })
})

describe('presetFor', () => {
  it('Pro: eco agents, Sonnet with effort medium for every role, the Autopilot budget on', () => {
    const preset = presetFor('Claude Pro')
    expect(preset).not.toBeNull()
    expect(preset).toBe(PLAN_PRESETS.pro)
    expect(preset?.profile).toEqual({
      'workflow.agents': 'eco',
      agents: { implementer: SONNET_MEDIUM, reviewer: SONNET_MEDIUM, scout: SONNET_MEDIUM, verifier: SONNET_MEDIUM },
    })
    expect(preset?.autopilotBudget).toEqual({ enabled: true })
  })

  it('the Pro preset does not rely on Opus', () => {
    expect(JSON.stringify(PLAN_PRESETS.pro)).not.toMatch(/opus/i)
  })

  it.each(['Claude Max', 'Claude Max 20x', 'max', 'Claude Team', 'Claude Enterprise', 'Claude API', 'Claude Pro Plus', '', null])('%j: no offer', (subscriptionType) => {
    expect(presetFor(subscriptionType)).toBeNull()
  })
})

describe('presetInUse', () => {
  const preset = PLAN_PRESETS.pro!
  const inUse = { fields: { 'workflow.agents': 'eco', agents: preset.profile.agents }, budgetEnabled: true }

  it('the Profile and the budget as the preset has them: in use', () => {
    expect(presetInUse(preset, inUse)).toBe(true)
  })

  it('the keys of the roles in another order are the same value', () => {
    const agents = Object.fromEntries(Object.entries(preset.profile.agents).reverse().map(([role, value]) => [role, { effort: value.effort, model: value.model }]))
    expect(presetInUse(preset, { ...inUse, fields: { ...inUse.fields, agents } })).toBe(true)
  })

  it.each([
    ['the budget off', { ...inUse, budgetEnabled: false }],
    ['workflow.agents absent', { ...inUse, fields: { ...inUse.fields, 'workflow.agents': null } }],
    ['workflow.agents full', { ...inUse, fields: { ...inUse.fields, 'workflow.agents': 'full' } }],
    ['agents absent', { ...inUse, fields: { ...inUse.fields, agents: null } }],
    ['one role on Opus', { ...inUse, fields: { ...inUse.fields, agents: { ...preset.profile.agents, implementer: { model: 'opus', effort: 'medium' } } } }],
  ])('%s: not in use', (_name, current) => {
    expect(presetInUse(preset, current)).toBe(false)
  })
})
