// The done stacks' state of the view (worfy-week ticket 15): the order Esc folds them in, and the
// check that decides whether a press of Esc on the Canvas is one that folds a stack. The press
// itself is an e2e matter (test/e2e/done-stack.spec.ts): in jsdom `offsetParent` is always null,
// so the Canvas's key listener never takes a key.
import { describe, expect, it, vi } from 'vitest'
import type { Layout } from '../../src/shared/layout/types'
import type { Epic, Ticket, WorkflowModel } from '../../src/shared/workflow/types'
import {
  buildEpicNodes,
  epicNodeId,
  escapeFoldsDoneStack,
  foldHiddenDoneStacks,
  foldLastDoneStack,
  openDoneStacks,
  setDoneStack,
  type EscapePress,
} from '../../src/renderer/canvas/sources/epics'

// The badges and actions on a frame are other tickets' business: none here.
vi.mock('../../src/renderer/canvas/badges', () => ({ actions: [], badges: [] }))

let project = 0
const freshProject = () => `ui-${(project += 1)}`

describe('the order of the open done stacks', () => {
  it('Esc folds the stacks of two Epics in the reverse order of opening, then has nothing to fold', () => {
    const id = freshProject()
    setDoneStack(id, 'a', true)
    setDoneStack(id, 'b', true)
    expect(foldLastDoneStack(id)).toBe(true)
    expect(openDoneStacks(id)).toEqual(['a'])
    expect(foldLastDoneStack(id)).toBe(true)
    expect(openDoneStacks(id)).toEqual([])
    expect(foldLastDoneStack(id)).toBe(false)
  })

  it('opening a stack again puts it last', () => {
    const id = freshProject()
    setDoneStack(id, 'a', true)
    setDoneStack(id, 'b', true)
    setDoneStack(id, 'a', false)
    setDoneStack(id, 'a', true)
    expect(openDoneStacks(id)).toEqual(['b', 'a'])
    setDoneStack(id, 'b', true)
    expect(openDoneStacks(id)).toEqual(['a', 'b'])
    expect(foldLastDoneStack(id)).toBe(true)
    expect(openDoneStacks(id)).toEqual(['a'])
  })

  it('a stack folded by its toggle leaves the order: Esc folds the one before it', () => {
    const id = freshProject()
    setDoneStack(id, 'a', true)
    setDoneStack(id, 'b', true)
    setDoneStack(id, 'b', false)
    expect(openDoneStacks(id)).toEqual(['a'])
    expect(foldLastDoneStack(id)).toBe(true)
    expect(openDoneStacks(id)).toEqual([])
  })

  it('without an open stack there is nothing to fold, and another Project\'s stacks are not this one\'s', () => {
    const id = freshProject()
    const other = freshProject()
    expect(foldLastDoneStack(id)).toBe(false)
    setDoneStack(other, 'a', true)
    expect(foldLastDoneStack(id)).toBe(false)
    expect(openDoneStacks(other)).toEqual(['a'])
  })

  it('a collapsed frame folds its stack; a frame that shows the stack keeps it open', () => {
    const id = freshProject()
    const done = { state: 'done', statusRaw: 'done' } as const
    const workflow = model([ticket('a', 1, done), ticket('a', 2), ticket('b', 1, done), ticket('b', 2)])
    setDoneStack(id, 'a', true)
    setDoneStack(id, 'b', true)
    const layout: Layout = {
      nodes: [{ id: epicNodeId('b'), kind: 'epic-frame', x: 0, y: 0, w: 1, h: 1, hidden: false, locked: true, pinned: false, tags: [], data: { collapsed: true } }],
      viewport: { x: 0, y: 0, zoom: 1 },
    }
    const open = { [`${id}|a`]: true, [`${id}|b`]: true }
    foldHiddenDoneStacks(id, buildEpicNodes(id, '/repo', workflow, layout, open))
    expect(openDoneStacks(id)).toEqual(['a'])
  })

  it('a frame without a done Ticket left folds its stack', () => {
    const id = freshProject()
    setDoneStack(id, 'a', true)
    foldHiddenDoneStacks(id, buildEpicNodes(id, '/repo', model([ticket('a', 1)]), { nodes: [], viewport: { x: 0, y: 0, zoom: 1 } }, { [`${id}|a`]: true }))
    expect(openDoneStacks(id)).toEqual([])
  })
})

describe('escapeFoldsDoneStack', () => {
  const press = (over: Partial<EscapePress> = {}): EscapePress => ({
    key: 'Escape',
    defaultPrevented: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    target: document.body,
    ...over,
  })
  const page = (html = '') => {
    const root = document.createElement('div')
    root.innerHTML = html
    return root
  }

  it('a bare Esc on the Canvas with nothing selected and nothing open folds', () => {
    expect(escapeFoldsDoneStack(press(), 0, page())).toBe(true)
    expect(escapeFoldsDoneStack(press({ target: page('<button>x</button>').firstElementChild }), 0, page())).toBe(true)
  })

  it('another key does not', () => {
    expect(escapeFoldsDoneStack(press({ key: 'Enter' }), 0, page())).toBe(false)
  })

  it('a press somebody took already does not', () => {
    expect(escapeFoldsDoneStack(press({ defaultPrevented: true }), 0, page())).toBe(false)
  })

  it('Esc with a modifier does not', () => {
    for (const modifier of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey'] as const) {
      expect(escapeFoldsDoneStack(press({ [modifier]: true }), 0, page()), modifier).toBe(false)
    }
  })

  it('Esc in a text field does not', () => {
    const fields = page('<input /><textarea></textarea><div contenteditable="true"><span>x</span></div>')
    for (const target of [fields.children[0], fields.children[1], fields.querySelector('span')]) {
      expect(escapeFoldsDoneStack(press({ target }), 0, page())).toBe(false)
    }
  })

  it('Esc with a selection does not: it takes the selection off first', () => {
    expect(escapeFoldsDoneStack(press(), 1, page())).toBe(false)
  })

  it('Esc while a dialog or a menu is open does not: that press closes it', () => {
    expect(escapeFoldsDoneStack(press(), 0, page('<div role="dialog"></div>'))).toBe(false)
    expect(escapeFoldsDoneStack(press(), 0, page('<div role="menu"></div>'))).toBe(false)
  })
})

function ticket(epic: string, num: number, over: Partial<Ticket> = {}): Ticket {
  return {
    epic,
    num,
    slug: `t${num}`,
    title: `${num}`,
    statusRaw: 'open',
    state: 'open',
    blockedRaw: null,
    blockedNums: [],
    blockedParsed: true,
    files: [],
    filesListed: true,
    fromBranch: null,
    ...over,
  }
}

function model(tickets: Ticket[], epics = ['a', 'b']): WorkflowModel {
  const epic = (name: string): Epic => ({ epic: name, hasSpec: true, hasMap: false, title: `${name} title` })
  return { root: '/repo', epics: epics.map(epic), tickets, error: null, branchErrors: [] }
}
