import { describe, expect, it } from 'vitest'
import { checkMindMap, type MindMapCheck } from '../../src/shared/product/mind-map'

/** A valid file: an idea from the topic, a question from Ticket 02 of the map, an accepted decision that replaces a rejected one, an objection. */
const valid = () => ({
  version: 1,
  nodes: [
    { id: 'n1', kind: 'idea', text: 'Split the screen 60 / 40', from: null, advice: true, x: 10, y: 20, collapsed: false },
    { id: 'n2', kind: 'question', text: 'Where do drafts live?', from: 'ticket:02', message: 'msg-1' },
    {
      id: 'n3',
      kind: 'decision',
      text: 'Harness first',
      from: 'n1',
      status: 'rejected',
      reason: 'the owner wants the screen first',
      history: [{ status: 'accepted', reason: 'smaller first step', message: 'msg-2' }],
    },
    { id: 'n4', kind: 'decision', text: 'Mind map 60 / chat 40', from: 'n1', status: 'accepted', reason: 'prototype accepted', replaces: 'n3' },
    { id: 'n5', kind: 'objection', text: 'The rules are near their limit', from: 'n4', source: 'harness/hooks/rules/orchestrator.md', advice: true },
  ],
})

/** The errors of a check that must fail. */
function errorsOf(result: MindMapCheck): { id: string | null; message: string }[] {
  if (result.ok) throw new Error('expected the check to fail')
  return result.errors
}

/** The one error of a check, which must name the node `id` in its text. */
function oneErrorFor(result: MindMapCheck, id: string): string {
  const errors = errorsOf(result)
  expect(errors).toHaveLength(1)
  expect(errors[0]!.id).toBe(id)
  expect(errors[0]!.message).toContain(`"${id}"`)
  return errors[0]!.message
}

describe('checkMindMap', () => {
  it('reads a valid file into its nodes', () => {
    const result = checkMindMap(valid(), [1, 2])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.map.version).toBe(1)
    expect(result.map.nodes.map((node) => node.id)).toEqual(['n1', 'n2', 'n3', 'n4', 'n5'])
    expect(result.map.nodes[3]).toMatchObject({ kind: 'decision', status: 'accepted', replaces: 'n3' })
    expect(result.map.nodes[2]!.history).toEqual([{ status: 'accepted', reason: 'smaller first step', message: 'msg-2' }])
  })

  it('drops keys the format does not declare', () => {
    const file = valid()
    const result = checkMindMap({ ...file, extra: 1, nodes: [{ ...file.nodes[0], colour: 'red' }] }, [])
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.map.nodes[0]).not.toHaveProperty('colour')
  })

  it('refuses an unknown from: neither a node nor a Ticket of the map', () => {
    const file = valid()
    file.nodes[1]!.from = 'ticket:07'
    expect(oneErrorFor(checkMindMap(file, [1, 2]), 'n2')).toContain('ticket:07')

    const other = valid()
    other.nodes[0]!.from = 'nowhere' as never
    expect(oneErrorFor(checkMindMap(other, [1, 2]), 'n1')).toContain('nowhere')
  })

  it('refuses a cycle through from and names the nodes on it', () => {
    const file = valid()
    file.nodes[0]!.from = 'n4' as never
    const errors = errorsOf(checkMindMap(file, [1, 2]))
    expect(errors).toHaveLength(1)
    expect(errors[0]!.message).toMatch(/cycle/)
    for (const id of ['n1', 'n4']) expect(errors[0]!.message).toContain(`"${id}"`)
    expect(['n1', 'n4']).toContain(errors[0]!.id)

    const self = valid()
    self.nodes[1]!.from = 'n2'
    expect(oneErrorFor(checkMindMap(self, [1, 2]), 'n2')).toMatch(/cycle/)
  })

  it('refuses replaces that does not point at a decision', () => {
    const file = valid()
    file.nodes[3]!.replaces = 'n2'
    expect(oneErrorFor(checkMindMap(file, [1, 2]), 'n4')).toContain('"n2"')

    const missing = valid()
    missing.nodes[3]!.replaces = 'gone'
    expect(oneErrorFor(checkMindMap(missing, [1, 2]), 'n4')).toContain('gone')
  })

  it('refuses a decision without a reason or a status', () => {
    const file = valid()
    delete (file.nodes[3] as { reason?: string }).reason
    expect(oneErrorFor(checkMindMap(file, [1, 2]), 'n4')).toMatch(/reason/)

    const blank = valid()
    ;(blank.nodes[3] as { reason?: string }).reason = '   '
    expect(oneErrorFor(checkMindMap(blank, [1, 2]), 'n4')).toMatch(/reason/)

    const noStatus = valid()
    delete (noStatus.nodes[3] as { status?: string }).status
    expect(oneErrorFor(checkMindMap(noStatus, [1, 2]), 'n4')).toMatch(/status/)
  })

  it('refuses an objection without a source', () => {
    const file = valid()
    delete (file.nodes[4] as { source?: string }).source
    expect(oneErrorFor(checkMindMap(file, [1, 2]), 'n5')).toMatch(/source/)
  })

  it('refuses two nodes with one id', () => {
    const file = valid()
    file.nodes[4]!.id = 'n2'
    const message = oneErrorFor(checkMindMap(file, [1, 2]), 'n2')
    expect(message).toMatch(/two nodes|more than one/)
  })

  it('names the node of a wrong field, and gives no id when the file itself is wrong', () => {
    const file = valid()
    ;(file.nodes[2] as { kind: string }).kind = 'wish'
    expect(oneErrorFor(checkMindMap(file, [1, 2]), 'n3')).toContain('kind')

    const wrongVersion = errorsOf(checkMindMap({ ...valid(), version: 2 }, []))
    expect(wrongVersion[0]!.id).toBeNull()
    expect(wrongVersion[0]!.message).toContain('version')

    expect(errorsOf(checkMindMap('not a map', []))[0]!.id).toBeNull()
  })

  it('lists every error, not only the first', () => {
    const file = valid()
    delete (file.nodes[3] as { reason?: string }).reason
    delete (file.nodes[4] as { source?: string }).source
    file.nodes[1]!.from = 'ticket:09'
    expect(errorsOf(checkMindMap(file, [1, 2])).map((error) => error.id).sort()).toEqual(['n2', 'n4', 'n5'])
  })
})
