import { describe, expect, it } from 'vitest'
import { manualChecks } from '../../src/shared/workflow/manual-checks'

const ticket = (done: string, rest = ''): string =>
  ['# 05 — A Ticket', '', 'Status: done', '', '## Что делаем', '', '- [ ] (вручную) not a check: wrong section', '', '## Готово, когда', '', done, '', '## Тесты', '', rest].join('\n')

describe('manual checks of a Ticket', () => {
  it('takes the unchecked and the checked "(вручную)" items of "Готово, когда", in file order', () => {
    const markdown = ticket(['- [ ] Unit tests pass.', '- [ ] (вручную) Stable copy after the merge: the palette lists it.', '- [x] (вручную) The owner saw the frame.', '- [X] (вручную) Upper-case mark.'].join('\n'))
    expect(manualChecks(markdown)).toEqual([
      { text: 'Stable copy after the merge: the palette lists it.', checked: false },
      { text: 'The owner saw the frame.', checked: true },
      { text: 'Upper-case mark.', checked: true },
    ])
  })

  it('takes "(вручную, <note>)" items and keeps the note in parentheses at the start of the text', () => {
    const markdown = ticket(['- [ ] (вручную, владелец) Stable copy: ⌘, opens Settings.', '- [x] (вручную,после влития) done'].join('\n'))
    expect(manualChecks(markdown)).toEqual([
      { text: '(владелец) Stable copy: ⌘, opens Settings.', checked: false },
      { text: '(после влития) done', checked: true },
    ])
  })

  it('skips items without "(вручную)" and items where it is not the first word', () => {
    const markdown = ticket(['- [ ] `pnpm test` exit 0 (вручную not here)', '- [x] Пункт 4 (вручную): not first', '- (вручную) no checkbox'].join('\n'))
    expect(manualChecks(markdown)).toEqual([])
  })

  it('reads no other section', () => {
    const markdown = ticket('- [ ] lint is green', '- [ ] (вручную) in the Tests section\n\n## Итог\n\n- [ ] (вручную) in the result')
    expect(manualChecks(markdown)).toEqual([])
  })

  it('joins the continuation lines of an item with one space and stops at the next item or a blank line', () => {
    const markdown = ticket(
      ['- [ ] (вручную) Stable copy after the merge: open the palette,', '      type «Stable» and pick the row;', '  the Canvas centers the Ticket.', '- [ ] next item', 'lazy line of the next item', '- [ ] (вручную) last', '', 'A paragraph after the list.'].join('\n'),
    )
    expect(manualChecks(markdown)).toEqual([
      { text: 'Stable copy after the merge: open the palette, type «Stable» and pick the row; the Canvas centers the Ticket.', checked: false },
      { text: 'last', checked: false },
    ])
  })

  it('ends an item at a nested list item', () => {
    const markdown = ticket(['- [ ] (вручную) Check both themes:', '  - light', '  - dark'].join('\n'))
    expect(manualChecks(markdown)).toEqual([{ text: 'Check both themes:', checked: false }])
  })

  it('gives [] when there is no "Готово, когда" section, and ignores code fences', () => {
    expect(manualChecks('# 01\n\n## Что делаем\n\n- [ ] (вручную) elsewhere\n')).toEqual([])
    const fenced = ticket('```\n## Готово, когда\n```\n- [ ] (вручную) real', '```md\n- [ ] (вручную) in a fence\n```')
    expect(manualChecks(fenced)).toEqual([{ text: 'real', checked: false }])
  })

  it('reads CRLF files', () => {
    const markdown = ticket('- [ ] (вручную) first,\n  second').replace(/\n/g, '\r\n')
    expect(manualChecks(markdown)).toEqual([{ text: 'first, second', checked: false }])
  })
})
