// The highlight of the element to press next in Getting started (worfy-onboarding ticket 14; owner's
// decisions Q15–Q17 of 2026-10-31): which one target, if any, the ring goes on, as a pure function.
import { describe, expect, it } from 'vitest'
import type { GettingStartedSnapshot, GettingStartedStep } from '../../src/shared/ipc/getting-started'
import { highlightTarget, type HighlightInput, type HighlightTarget } from '../../src/renderer/getting-started/highlight'

const MARKED = '2026-10-31T10:00:00.000Z'
const NODE = 'orchestrator-node'

/** A snapshot of a new user with the panel shown and `marked` steps marked. */
function snapshot(marked: readonly GettingStartedStep[], more: Partial<GettingStartedSnapshot> = {}): GettingStartedSnapshot {
  return {
    user: 'new',
    section: 'shown',
    steps: Object.fromEntries(marked.map((step) => [step, MARKED])),
    reworkSeen: false,
    noticeShown: false,
    demo: { projectId: 'demo-id', path: '/home/user/worfy-demo', profile: 'worfy-demo', cost: 'cheaper' },
    ...more,
  }
}

/** Everything on screen, the panel expanded, First run closed, nothing being created, no ready text. */
function input(more: Partial<HighlightInput>): HighlightInput {
  return { snapshot: snapshot([]), expanded: true, firstRunOpen: false, creating: false, field: null, onScreen: () => true, ...more }
}

const step = (which: GettingStartedStep): HighlightTarget => ({ kind: 'step', step: which })
const send: HighlightTarget = { kind: 'send', nodeId: NODE }

describe('highlightTarget', () => {
  it.each<[string, Partial<HighlightInput>, HighlightTarget | null]>([
    ['step 1 with First run closed: "Open checks"', {}, step('1')],
    ['step 1 with First run open: "Check again"', { firstRunOpen: true }, { kind: 'check-again' }],
    ['step 2: "Create demo project"', { snapshot: snapshot(['1']) }, step('2')],
    ['step 2 while the demo is being created: nothing', { snapshot: snapshot(['1']), creating: true }, null],
    ['step 3 with no ready text: "Open the Orchestrator"', { snapshot: snapshot(['1', '2']) }, step('3')],
    ['step 3 with the ready text in the field: its Send', { snapshot: snapshot(['1', '2']), field: { step: '3', nodeId: NODE, phase: 'ready' } }, send],
    ['step 3 after the text was sent: nothing', { snapshot: snapshot(['1', '2']), field: { step: '3', nodeId: NODE, phase: 'sent' } }, null],
    ['step 4 with no ready text: "Ship the ticket"', { snapshot: snapshot(['1', '2', '3']) }, step('4')],
    ['step 4 with the ready text in the field: its Send', { snapshot: snapshot(['1', '2', '3']), field: { step: '4', nodeId: NODE, phase: 'ready' } }, send],
    ['step 4 after the text was sent: nothing', { snapshot: snapshot(['1', '2', '3']), field: { step: '4', nodeId: NODE, phase: 'sent' } }, null],
    ['step 4 with the text of step 3 sent: "Ship the ticket"', { snapshot: snapshot(['1', '2', '3']), field: { step: '3', nodeId: NODE, phase: 'sent' } }, step('4')],
    ['step 5: nothing', { snapshot: snapshot(['1', '2', '3', '4']) }, null],
    ['step 6: nothing', { snapshot: snapshot(['1', '2', '3', '4', '5']) }, null],
    ['the screen Done: nothing', { snapshot: snapshot(['1', '2', '3', '4', '5', '6']) }, null],
    ['steps marked out of order: the first unmarked one', { snapshot: snapshot(['1', '3']) }, step('2')],
  ])('%s', (_, more, expected) => {
    expect(highlightTarget(input(more))).toEqual(expected)
  })

  it.each<[string, Partial<HighlightInput>]>([
    ['the panel collapsed into its pill', { expanded: false }],
    ['the panel hidden by Skip', { snapshot: snapshot([], { section: 'hidden' }) }],
    ['the panel not shown yet to an existing user', { snapshot: snapshot([], { user: 'existing', section: 'hidden' }) }],
    ['no state read yet', { snapshot: null }],
    ['the ready text in the field, the panel collapsed', { snapshot: snapshot(['1', '2']), expanded: false, field: { step: '3', nodeId: NODE, phase: 'ready' } }],
  ])('%s: nothing', (_, more) => {
    expect(highlightTarget(input(more))).toBeNull()
  })

  it('a target that is not on screen gives way to the button of the current step', () => {
    const offScreen = (hidden: HighlightTarget['kind']) => (target: HighlightTarget) => target.kind !== hidden
    expect(highlightTarget(input({ snapshot: snapshot(['1', '2']), field: { step: '3', nodeId: NODE, phase: 'ready' }, onScreen: offScreen('send') }))).toEqual(step('3'))
    expect(highlightTarget(input({ snapshot: snapshot(['1', '2', '3']), field: { step: '4', nodeId: NODE, phase: 'ready' }, onScreen: offScreen('send') }))).toEqual(step('4'))
    expect(highlightTarget(input({ firstRunOpen: true, onScreen: offScreen('check-again') }))).toEqual(step('1'))
  })

  it('no ring when neither the target nor the button of the step is on screen', () => {
    expect(highlightTarget(input({ onScreen: () => false }))).toBeNull()
    expect(highlightTarget(input({ snapshot: snapshot(['1', '2']), field: { step: '3', nodeId: NODE, phase: 'ready' }, onScreen: () => false }))).toBeNull()
  })

  it('asks only about the target it would ring and the button of the step', () => {
    const asked: HighlightTarget[] = []
    highlightTarget(input({ snapshot: snapshot(['1', '2']), field: { step: '3', nodeId: NODE, phase: 'ready' }, onScreen: (target) => (asked.push(target), false) }))
    expect(asked).toEqual([send, step('3')])
  })
})
