// Comments on quotes of an agent's message (worfy-polish ticket 102, src/renderer/session/quote-comments.ts):
// where a quote lies in its message and where it is found again, the rule against overlaps, the order
// of a round, the text the agent gets (the 200-character cut in the middle, `[image N]` marks, the
// limits of 3 and 10 images), how a sent message reads back into quote blocks, and the image scaling.
import { describe, expect, it } from 'vitest'
import { MAX_ATTACHMENTS, type Attachment } from '../../src/shared/agent/attachments'
import {
  COMMENT_IMAGES,
  IMAGE_EDGE,
  MESSAGE_IMAGES,
  QUOTE_FOR_AGENT,
  agentItems,
  agentText,
  anchorRange,
  chipWords,
  clockOf,
  composeRound,
  imageRefusal,
  inTextOrder,
  overlapping,
  parseQuoted,
  quoteAnchor,
  quoteForAgent,
  scaledSize,
  squash,
  trimRange,
  type CommentImage,
  type QuoteComment,
} from '../../src/renderer/session/quote-comments'

const image = (name: string): CommentImage => ({ kind: 'image', name, mediaType: 'image/png', size: 4, data: Buffer.from(name).toString('base64') })

let made = 0
const comment = (fields: Partial<QuoteComment> & Pick<QuoteComment, 'anchor' | 'start' | 'end'>): QuoteComment => ({
  id: `c${(made += 1)}`,
  quote: 'quoted text',
  text: '',
  images: [],
  messageAt: null,
  at: made,
  ...fields,
})

const MESSAGE = 'The build uses two steps. First the lint step, then the test step. The test step is slow.'

describe('where a quote lies', () => {
  it('names a text block by its message id and its place among that message’s blocks', () => {
    expect(quoteAnchor('msg_1', 0)).toBe('msg_1#0')
    expect(quoteAnchor('msg_1', 2)).toBe('msg_1#2')
  })

  it('trims the whitespace at the ends of a selected range; a range of whitespace alone is none', () => {
    const text = 'one  two \n three'
    expect(trimRange(text, 3, 10)).toEqual({ start: 5, end: 8 })
    expect(trimRange(text, 3, 5)).toBeNull()
    expect(trimRange(text, -4, 99)).toEqual({ start: 0, end: text.length })
  })

  it('keeps the offsets while the text there is still the quote', () => {
    const start = MESSAGE.indexOf('the test step')
    expect(anchorRange(MESSAGE, { start, end: start + 13, quote: 'the test step' })).toEqual({ start, end: start + 13 })
  })

  it('finds a moved quote again by its text: the occurrence nearest to where it was', () => {
    const first = MESSAGE.indexOf('test step')
    const second = MESSAGE.lastIndexOf('test step')
    // The message now draws one character more in front (a link note, another renderer).
    const shifted = `>${MESSAGE}`
    expect(anchorRange(shifted, { start: second, end: second + 9, quote: 'test step' })).toEqual({ start: second + 1, end: second + 10 })
    expect(anchorRange(shifted, { start: first, end: first + 9, quote: 'test step' })).toEqual({ start: first + 1, end: first + 10 })
  })

  it('a quote the message no longer holds lies nowhere, and an empty quote never anchors', () => {
    expect(anchorRange(MESSAGE, { start: 0, end: 6, quote: 'deploy' })).toBeNull()
    expect(anchorRange(MESSAGE, { start: 0, end: 0, quote: '' })).toBeNull()
  })
})

describe('the rule against overlaps (owner, answer 1)', () => {
  const drafts = [comment({ anchor: 'm#0', start: 10, end: 20 })]

  it('a range that shares a character with an unsent comment of the same message overlaps it', () => {
    expect(overlapping(drafts, 'm#0', 15, 25)).toBe(drafts[0])
    expect(overlapping(drafts, 'm#0', 5, 11)).toBe(drafts[0])
    expect(overlapping(drafts, 'm#0', 12, 18)).toBe(drafts[0])
    expect(overlapping(drafts, 'm#0', 0, 40)).toBe(drafts[0])
  })

  it('a range right next to it does not: adjacent comments are allowed', () => {
    expect(overlapping(drafts, 'm#0', 20, 30)).toBeNull()
    expect(overlapping(drafts, 'm#0', 0, 10)).toBeNull()
  })

  it('the same offsets in another message do not overlap', () => {
    expect(overlapping(drafts, 'm#1', 10, 20)).toBeNull()
    expect(overlapping(drafts, 'other#0', 10, 20)).toBeNull()
  })
})

describe('the order of a round', () => {
  it('reads by place in the agent’s text, not by when the comments were made', () => {
    const late = comment({ anchor: 'b#0', start: 0, end: 4, messageAt: 2_000, at: 1 })
    const secondInA = comment({ anchor: 'a#0', start: 30, end: 40, messageAt: 1_000, at: 2 })
    const firstInA = comment({ anchor: 'a#0', start: 2, end: 8, messageAt: 1_000, at: 3 })
    expect(inTextOrder([late, secondInA, firstInA]).map((each) => each.id)).toEqual([firstInA.id, secondInA.id, late.id])
  })

  it('a given order of the messages (their rows) comes before their times', () => {
    const one = comment({ anchor: 'a#0', start: 0, end: 4, messageAt: 1_000 })
    const two = comment({ anchor: 'b#0', start: 0, end: 4, messageAt: 2_000 })
    const rows = new Map([
      ['a#0', 5],
      ['b#0', 1],
    ])
    expect(inTextOrder([one, two], (anchor) => rows.get(anchor)).map((each) => each.anchor)).toEqual(['b#0', 'a#0'])
  })
})

describe('the quote as the agent gets it (owner, answer 4)', () => {
  it('stays whole up to 200 characters, its whitespace squashed', () => {
    expect(quoteForAgent('two\n  lines')).toBe('two lines')
    const exact = 'x'.repeat(QUOTE_FOR_AGENT)
    expect(quoteForAgent(exact)).toBe(exact)
  })

  it('is cut in the middle past 200: its start, «…», its end', () => {
    const long = `${'a'.repeat(150)} middle ${'z'.repeat(150)}`
    const cut = quoteForAgent(long)
    expect(cut.length).toBeLessThan(QUOTE_FOR_AGENT)
    expect(cut.startsWith('a'.repeat(130))).toBe(true)
    expect(cut.endsWith('z'.repeat(55))).toBe(true)
    expect(cut).toContain(' … ')
    expect(cut).not.toContain('middle')
  })
})

describe('the text the agent gets', () => {
  it('numbers the comments, names each message’s time, indents the comment, marks the images across the message, then «General:»', () => {
    const text = agentText(
      [
        { quote: 'the lint step', text: 'Keep it.\nIt is fast.', images: 2, time: '14:02' },
        { quote: 'The test step is slow.', text: '', images: 1, time: null },
        { quote: 'two steps', text: 'Why two?', images: 0, time: '14:05' },
      ],
      '  Thanks, go on.  ',
    )
    expect(text).toBe(
      [
        'Comments on parts of your messages (3):',
        '',
        '1. > «the lint step» (your message 14:02)',
        '   Keep it.',
        '   It is fast.',
        '   [image 1]',
        '   [image 2]',
        '',
        '2. > «The test step is slow.» (your message)',
        '   [image 3]',
        '',
        '3. > «two steps» (your message 14:05)',
        '   Why two?',
        '',
        'General:',
        'Thanks, go on.',
      ].join('\n'),
    )
  })

  it('without a general text it ends with the last comment; without comments it is the field’s text as it is', () => {
    expect(agentText([{ quote: 'q', text: 'c', images: 0, time: null }], '   ')).toBe('Comments on parts of your messages (1):\n\n1. > «q» (your message)\n   c')
    expect(agentText([], '  as typed \n')).toBe('  as typed \n')
  })

  it('takes a comment’s images and the time of its message from the comment', () => {
    const at = new Date(2026, 10, 10, 9, 7).getTime()
    expect(clockOf(at)).toBe('09:07')
    expect(clockOf(null)).toBeNull()
    expect(agentItems([comment({ anchor: 'm#0', start: 0, end: 1, quote: 'q', text: 't', images: [image('a'), image('b')], messageAt: at })])).toEqual([{ quote: 'q', text: 't', images: 2, time: '09:07' }])
  })
})

describe('reading a sent message back into quote blocks', () => {
  it('reads what agentText wrote: the quotes, their times, comments and image numbers, and the general text', () => {
    const text = agentText(
      [
        { quote: 'the lint step', text: 'Keep it.\n\nIt is fast.', images: 1, time: '14:02' },
        { quote: 'x'.repeat(260), text: '', images: 2, time: null },
      ],
      'Line one\nline two',
    )
    expect(parseQuoted(text)).toEqual({
      quotes: [
        { number: 1, quote: 'the lint step', time: '14:02', text: 'Keep it.\n\nIt is fast.', images: [1] },
        { number: 2, quote: quoteForAgent('x'.repeat(260)), time: null, text: '', images: [2, 3] },
      ],
      general: 'Line one\nline two',
    })
  })

  it('a message of comments alone has an empty general text', () => {
    expect(parseQuoted(agentText([{ quote: 'q', text: 'c', images: 0, time: null }], ''))).toEqual({ quotes: [{ number: 1, quote: 'q', time: null, text: 'c', images: [] }], general: '' })
  })

  it('any other text is no quoted message: the bubble shows it as it is', () => {
    expect(parseQuoted('hello')).toBeNull()
    expect(parseQuoted('')).toBeNull()
    expect(parseQuoted('Comments on parts of your messages (0):\n')).toBeNull()
    // Fewer items than the header names, items out of order, or text in place of «General:».
    expect(parseQuoted('Comments on parts of your messages (2):\n\n1. > «q» (your message)\n   c')).toBeNull()
    expect(parseQuoted('Comments on parts of your messages (1):\n\n2. > «q» (your message)\n   c')).toBeNull()
    expect(parseQuoted('Comments on parts of your messages (1):\n\n1. > «q» (your message)\n   c\n\nSomething else')).toBeNull()
  })
})

describe('the image limits (owner, answer 3)', () => {
  it('takes 3 images per comment and 10 per message', () => {
    expect(COMMENT_IMAGES).toBe(3)
    expect(MESSAGE_IMAGES).toBe(10)
    expect(imageRefusal(0, 0)).toBeNull()
    expect(imageRefusal(2, 7)).toBeNull()
    expect(imageRefusal(3, 0)).toBe('Up to 3 images per comment.')
    expect(imageRefusal(1, 9)).toBe('Up to 10 images per message.')
    expect(imageRefusal(0, 10)).toBe('Up to 10 images per message.')
  })

  it('scales the long side down to 1568 px, keeping the proportions; a smaller image keeps its size', () => {
    expect(IMAGE_EDGE).toBe(1568)
    expect(scaledSize(3136, 1000)).toEqual({ width: 1568, height: 500, scaled: true })
    expect(scaledSize(900, 2940)).toEqual({ width: 480, height: 1568, scaled: true })
    expect(scaledSize(1568, 1568)).toEqual({ width: 1568, height: 1568, scaled: false })
    expect(scaledSize(640, 480)).toEqual({ width: 640, height: 480, scaled: false })
    expect(scaledSize(20_000, 1)).toEqual({ width: 1568, height: 1, scaled: true })
  })
})

describe('the message a round goes in', () => {
  const field = (text: string, attachments: Attachment[] = []) => ({ text, attachments })

  it('puts the comments in text order before the field’s text, and their images first among the attachments, in that order', () => {
    const second = comment({ anchor: 'a#0', start: 20, end: 30, quote: 'second quote', text: 'two', images: [image('b1'), image('b2')], messageAt: 1_000 })
    const first = comment({ anchor: 'a#0', start: 0, end: 10, quote: 'first quote', text: 'one', images: [image('a1')], messageAt: 1_000 })
    const own: Attachment = { kind: 'file', name: 'notes.txt', path: '/tmp/notes.txt', size: 3, copied: false }
    const composed = composeRound([second, first], field('General words', [own]))
    if ('error' in composed) throw new Error(composed.error)
    expect(composed.round.map((each) => each.id)).toEqual([first.id, second.id])
    expect(composed.message.attachments.map((each) => each.name)).toEqual(['a1', 'b1', 'b2', 'notes.txt'])
    expect(composed.message.text).toContain('1. > «first quote»')
    expect(composed.message.text).toContain('   [image 1]\n\n2. > «second quote»')
    expect(composed.message.text).toContain('   two\n   [image 2]\n   [image 3]')
    expect(composed.message.text.endsWith('General:\nGeneral words')).toBe(true)
  })

  it('without comments the field’s message goes as it is', () => {
    const message = field('plain')
    expect(composeRound([], message)).toEqual({ message, round: [] })
  })

  it('refuses a message past the attachment limit of a message', () => {
    const many = Array.from({ length: MAX_ATTACHMENTS }, (_, index): Attachment => ({ kind: 'file', name: `f${index}`, path: `/tmp/f${index}`, size: 1, copied: false }))
    const composed = composeRound([comment({ anchor: 'a#0', start: 0, end: 1, images: [image('x')] })], field('', many))
    expect(composed).toEqual({ error: `A message takes up to ${MAX_ATTACHMENTS} attachments: remove some from the comments or the field` })
  })
})

describe('the words of a tray chip', () => {
  it('shows the first five words, «…» when there is more', () => {
    expect(chipWords('one two three')).toBe('one two three')
    expect(chipWords('one two three four five six seven')).toBe('one two three four five…')
    expect(chipWords('averyveryverylongwordthatgoesonandonandon')).toBe('averyveryverylongwordthatgoesonan…')
    expect(squash('  a \n b  ')).toBe('a b')
  })
})
