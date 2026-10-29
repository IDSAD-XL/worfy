// Settings → Plan (src/renderer/settings/PlanSection.tsx, worfy-throughput ticket 42) over the real
// renderer IPC client and a fake preload: the offer of the Pro preset, and no write without the click
// of Apply. What main does with the click — bin/profile-set and the budget — is checked in
// test/contract/plan-preset.test.ts.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PLAN_PRESETS } from '../../src/shared/agent/plan-preset'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { PlanPresetApplyResult, PlanPresetRead } from '../../src/shared/ipc/plan-preset'
import type { AppSettings } from '../../src/shared/settings/app-settings'

const ROOT = '/work/demo'
const FINGERPRINT = `sha256:${'1'.repeat(64)}`
const PRO = PLAN_PRESETS.pro!
const EMPTY = { 'workflow.agents': null, agents: null }

const settings = (budget: boolean): AppSettings => ({
  interfaceScale: 1,
  sidebar: { collapsed: {}, visible: { normal: true, focus: true } },
  autoCompactWindow: { orchestrator: 400_000, other: 500_000 },
  memoryIndicator: true,
  autopilotBudget: { enabled: budget },
  revision: 1,
})

interface FakeMain {
  calls: { channel: string; input: unknown }[]
  read: PlanPresetRead
  apply: PlanPresetApplyResult
}

function preload(read: PlanPresetRead, budget = false): FakeMain {
  const main: FakeMain = { calls: [], read, apply: { status: 'saved', warning: null } }
  const answer = (value: unknown) => Promise.resolve({ ok: true, value } as never)
  const bridge: WorfyBridge = {
    invoke: (channel, input) => {
      main.calls.push({ channel, input })
      switch (channel) {
        case 'planPreset.read':
          return answer(main.read)
        case 'planPreset.apply':
          return answer(main.apply)
        case 'appSettings.get':
          return answer(settings(budget))
        default:
          return Promise.resolve({ ok: false, error: `no ${channel} here` } as never)
      }
    },
    on: () => 1,
    off: () => undefined,
  }
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
  return main
}

const pro = (fields: { 'workflow.agents': unknown; agents: unknown } = EMPTY): PlanPresetRead => ({
  subscriptionType: 'Claude Pro',
  planError: null,
  profile: { available: true, fields, fingerprint: FINGERPRINT },
})

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

async function mount(read: PlanPresetRead, budget = false) {
  const main = preload(read, budget)
  const section = await import('../../src/renderer/settings/PlanSection')
  render(<section.PlanOffer root={ROOT} />)
  return { main, section }
}

const applies = (main: FakeMain) => main.calls.filter((call) => call.channel === 'planPreset.apply')

describe('Settings → Plan', () => {
  it('is a section titled Plan, after Autopilot and before Pipeline', async () => {
    const plan = await import('../../src/renderer/settings/PlanSection')
    const autopilot = await import('../../src/renderer/settings/AutopilotSection')
    const pipeline = await import('../../src/renderer/settings/PipelineSection')
    expect(plan.title).toBe('Plan')
    expect(plan.order).toBeGreaterThan(autopilot.order)
    expect(plan.order).toBeLessThan(pipeline.order)
  })

  it('Pro: the plan and the recommended settings with Apply; nothing is written without the click; no price', async () => {
    const { main } = await mount(pro())
    const offer = await screen.findByTestId('plan-offer')
    expect(offer.textContent).toContain('Plan: Pro')
    expect(offer.textContent).toContain('Recommended settings for Pro')
    for (const line of PRO.summary) expect(offer.textContent).toContain(line)
    expect(offer.textContent).not.toMatch(/\$|USD|€|price/iu)
    expect(screen.getByTestId('plan-apply')).toBeTruthy()
    expect(main.calls.map((call) => call.channel)).toContain('planPreset.read')
    expect(applies(main)).toEqual([])
  })

  it('the click of Apply sends the plan and the fingerprint read, and the section reads again', async () => {
    const { main } = await mount(pro())
    fireEvent.click(await screen.findByTestId('plan-apply'))
    await waitFor(() => expect(applies(main)).toEqual([{ channel: 'planPreset.apply', input: { root: ROOT, plan: 'pro', expected: FINGERPRINT } }]))
    await waitFor(() => expect(main.calls.filter((call) => call.channel === 'planPreset.read')).toHaveLength(2))
  })

  it('the preset already in use, budget on: no Apply', async () => {
    await mount(pro(PRO.profile), true)
    await screen.findByTestId('plan-in-use')
    expect(screen.queryByTestId('plan-apply')).toBeNull()
  })

  it('the Profile in use but the budget off: Apply is offered', async () => {
    await mount(pro(PRO.profile), false)
    await screen.findByTestId('plan-apply')
  })

  it('a conflict: the line and Reload, which reads again', async () => {
    const { main } = await mount(pro())
    main.apply = { status: 'conflict' }
    fireEvent.click(await screen.findByTestId('plan-apply'))
    await screen.findByTestId('plan-conflict')
    fireEvent.click(screen.getByTestId('plan-reload'))
    await waitFor(() => expect(main.calls.filter((call) => call.channel === 'planPreset.read')).toHaveLength(2))
  })

  it.each([
    ['Max', { subscriptionType: 'Claude Max', planError: null, profile: null }, 'Plan: Claude Max. Your settings stay as they are.'],
    ['an unknown plan', { subscriptionType: 'Claude Something New', planError: null, profile: null }, 'Plan: Claude Something New. worfy has no recommended settings for this plan.'],
  ])('%s: the plan, no offer, no Apply', async (_name, read, line) => {
    const { main } = await mount(read)
    expect((await screen.findByTestId('plan-no-offer')).textContent).toBe(line)
    expect(screen.queryByTestId('plan-apply')).toBeNull()
    expect(applies(main)).toEqual([])
  })

  it('Claude Code did not answer: the plan is not known, no offer', async () => {
    await mount({ subscriptionType: null, planError: 'Claude Code did not answer within 20 s', profile: null })
    expect((await screen.findByTestId('plan-unknown')).textContent).toContain('did not answer within 20 s')
    expect(screen.queryByTestId('plan-apply')).toBeNull()
  })

  it('a Harness without profile-set --field: the offer without Apply, and what to do', async () => {
    await mount({ subscriptionType: 'Claude Pro', planError: null, profile: { available: false, reason: 'this Harness has no bin/profile-set --field' } })
    expect((await screen.findByTestId('plan-profile-unavailable')).textContent).toMatch(/too old/u)
    expect(screen.queryByTestId('plan-apply')).toBeNull()
  })
})
