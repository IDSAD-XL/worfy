// What the e2e check "settled, without overlaps" (test/e2e/helpers.ts expectSettledWithoutOverlaps)
// finds in one pass of boxes: test/e2e/box-checks.ts.
import { describe, expect, it } from 'vitest'
import { overlaps, passProblems } from '../e2e/box-checks'

const box = (name: string, x: number, y: number, width = 10, height = 10) => ({ name, x, y, width, height })

describe('one pass of boxes (expectSettledWithoutOverlaps)', () => {
  it('names the pairs that overlap; boxes that only touch do not', () => {
    expect(overlaps([box('a', 0, 0), box('b', 5, 5), box('c', 10, 0)])).toEqual(['a and b', 'b and c'])
    expect(overlaps([box('a', 0, 0), box('b', 10, 0), box('c', 0, 10)])).toEqual([])
  })

  it('a clean pass has no problems', () => {
    expect(passProblems({ boxes: [box('a', 0, 0), box('b', 20, 0)], missing: [], ambiguous: [] })).toEqual([])
  })

  it('an element not found, a selector with several matches and an empty box are problems', () => {
    const pass = { boxes: [box('flat', 0, 0, 10, 0), box('thin', 20, 0, 0, 10), box('whole', 40, 0)], missing: ['gone'], ambiguous: ['twice'] }
    expect(passProblems(pass)).toEqual(['gone: not found', 'twice: the selector finds several elements', 'flat: an empty box', 'thin: an empty box'])
  })
})
