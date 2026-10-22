// What the e2e check "settled, without overlaps" (test/e2e/helpers.ts expectSettledWithoutOverlaps)
// finds in one pass of boxes: test/e2e/box-checks.ts.
import { describe, expect, it } from 'vitest'
import { checkTargets, listProblems, overlaps, passOf, passProblems, translateOf } from '../e2e/box-checks'

const box = (name: string, x: number, y: number, width = 10, height = 10) => ({ name, x, y, width, height })

describe('one pass of boxes (expectSettledWithoutOverlaps)', () => {
  it('names the pairs that overlap; boxes that only touch do not', () => {
    expect(overlaps([box('a', 0, 0), box('b', 5, 5), box('c', 10, 0)])).toEqual(['a and b', 'b and c'])
    expect(overlaps([box('a', 0, 0), box('b', 10, 0), box('c', 0, 10)])).toEqual([])
  })

  it('a clean pass has no problems', () => {
    expect(passProblems({ boxes: [box('a', 0, 0), box('b', 20, 0)], missing: [], ambiguous: [] })).toEqual([])
  })

  it("the page's reads: no match is missing, several matches are ambiguous, exactly one gives its box", () => {
    const at = { x: 1, y: 2, width: 3, height: 4 }
    expect(passOf([
      { name: 'gone', count: 0, box: null },
      { name: 'twice', count: 2, box: null },
      { name: 'one', count: 1, box: at },
    ])).toEqual({ boxes: [{ name: 'one', ...at }], missing: ['gone'], ambiguous: ['twice'] })
  })

  it('fewer than two elements is refused before any pass: no pair could overlap', () => {
    expect(() => checkTargets([], 'cards')).toThrow('needs at least two elements, got 0')
    expect(() => checkTargets([{}], 'cards')).toThrow('got 1')
    expect(() => checkTargets([{}, {}], 'cards')).not.toThrow()
  })

  it('an element not found, a selector with several matches and an empty box are problems', () => {
    const pass = { boxes: [box('flat', 0, 0, 10, 0), box('thin', 20, 0, 0, 10), box('whole', 40, 0)], missing: ['gone'], ambiguous: ['twice'] }
    expect(passProblems(pass)).toEqual(['gone: not found', 'twice: the selector finds several elements', 'flat: an empty box', 'thin: an empty box'])
  })
})

describe('one pass of box lists (settledBoxLists, settledBoxes)', () => {
  const at = { x: 0, y: 0, width: 10, height: 10 }
  const lists = { none: [], one: [at], two: [at, at] }

  it('`one` wants exactly one element per selector', () => {
    expect(listProblems(lists, 'one')).toEqual(['none: not found', 'two: the selector finds 2 elements'])
  })

  it('`some` wants at least one', () => {
    expect(listProblems(lists, 'some')).toEqual(['none: not found'])
  })

  it('`any` takes any number, none included', () => {
    expect(listProblems(lists, 'any')).toEqual([])
  })
})

describe("a Node's place from its transform (flowPositionsInOnePass)", () => {
  it('reads the translate React Flow writes, negative and fractional too', () => {
    expect(translateOf('translate(120px, 40px)')).toEqual({ x: 120, y: 40 })
    expect(translateOf('translate(-12.5px,-3px) scale(1)')).toEqual({ x: -12.5, y: -3 })
  })

  it('a transform without a translate has no place', () => {
    expect(translateOf('')).toBeNull()
    expect(translateOf('scale(2)')).toBeNull()
  })
})
