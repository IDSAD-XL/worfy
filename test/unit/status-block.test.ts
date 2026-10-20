import { describe, expect, it } from 'vitest'
import { findStatusBlock } from '../../src/shared/agent/status-block'

// Samples shaped like the closing lines of real orchestrator answers: the four-line block of the
// orchestrator rules («— Stage / — Now / — Next / — Waiting»), often indented as a code block. The
// old Russian labels («— Этап / — Сейчас / — Дальше / — Жду») are still read for one release.

const ENGLISH_LINES = [
  '— Stage: audit-2026-09-19 · /implement · волна 2',
  '— Now: impl-09 чинит гонку в ставках, PR #412 ждёт CI',
  '— Next: verify-09, затем волна 3',
  '— Waiting: ничего',
]

const BLOCK = [
  '— Этап: audit-2026-09-19 · /implement · волна 2',
  '— Сейчас: impl-09 чинит гонку в ставках, PR #412 ждёт CI',
  '— Дальше: verify-09, затем волна 3',
  '— Жду: ничего',
].join('\n')

describe('findStatusBlock', () => {
  it('finds a block of Russian text at the end of an answer and returns it verbatim', () => {
    const answer = `Волна 2 запущена, три исполнителя работают.\n\n${BLOCK}\n`
    expect(findStatusBlock(answer)).toStrictEqual({
      text: BLOCK,
      stage: 'audit-2026-09-19 · /implement · волна 2',
      now: 'impl-09 чинит гонку в ставках, PR #412 ждёт CI',
      next: 'verify-09, затем волна 3',
      waiting: 'ничего',
    })
  })

  it('finds a block in the middle of the text', () => {
    const answer = `Итог по тикету.\n\n${BLOCK}\n\nЕсли нужно, могу продолжить с волной 3.`
    expect(findStatusBlock(answer)?.text).toBe(BLOCK)
  })

  it('drops the code-block indentation and trailing spaces but keeps the lines as written', () => {
    const indented = BLOCK.split('\n')
      .map((line) => `    ${line}   `)
      .join('\n')
    expect(findStatusBlock(`Готово.\n\n${indented}\n`)?.text).toBe(BLOCK)
  })

  it('accepts a hyphen or an en dash instead of the em dash, extra spaces around the dash and the colon, and CRLF', () => {
    const answer = ['- Этап:  тикет 08', '–Сейчас : пишу тесты', '  -   Дальше:PR', '— Жду:  ничего'].join('\r\n')
    expect(findStatusBlock(answer)).toStrictEqual({
      text: ['- Этап:  тикет 08', '–Сейчас : пишу тесты', '-   Дальше:PR', '— Жду:  ничего'].join('\n'),
      stage: 'тикет 08',
      now: 'пишу тесты',
      next: 'PR',
      waiting: 'ничего',
    })
  })

  it('allows blank lines between the four lines', () => {
    const spaced = BLOCK.split('\n').join('\n\n')
    expect(findStatusBlock(spaced)?.text).toBe(BLOCK)
  })

  it('takes the last of two blocks', () => {
    const later = BLOCK.replace('волна 2', 'волна 3').replace('— Жду: ничего', '— Жду: ключи Stripe от владельца')
    const answer = `Было так:\n${BLOCK}\n\nСтало так:\n${later}`
    expect(findStatusBlock(answer)?.text).toBe(later)
    expect(findStatusBlock(answer)?.waiting).toBe('ключи Stripe от владельца')
  })

  it('finds nothing in an answer without a block', () => {
    expect(findStatusBlock('Готово, тесты зелёные.')).toBeNull()
    expect(findStatusBlock('')).toBeNull()
  })

  it('finds nothing when a line is missing, out of order, or another line breaks the block', () => {
    const lines = BLOCK.split('\n')
    expect(findStatusBlock(lines.slice(0, 3).join('\n'))).toBeNull()
    expect(findStatusBlock([lines[1], lines[0], lines[2], lines[3]].join('\n'))).toBeNull()
    expect(findStatusBlock([lines[0], lines[1], 'и ещё одно', lines[2], lines[3]].join('\n'))).toBeNull()
  })

  it('takes a complete block that follows an incomplete one', () => {
    const lines = BLOCK.split('\n')
    expect(findStatusBlock([lines[0], lines[1], ...lines].join('\n'))?.text).toBe(BLOCK)
  })

  describe('English labels', () => {
    const ENGLISH = ENGLISH_LINES.join('\n')

    it('reads a block with the English labels into the same fields as the Russian one', () => {
      const english = findStatusBlock(`Волна 2 запущена.\n\n${ENGLISH}\n`)
      const russian = findStatusBlock(`Волна 2 запущена.\n\n${BLOCK}\n`)
      expect(english).toStrictEqual({
        text: ENGLISH,
        stage: 'audit-2026-09-19 · /implement · волна 2',
        now: 'impl-09 чинит гонку в ставках, PR #412 ждёт CI',
        next: 'verify-09, затем волна 3',
        waiting: 'ничего',
      })
      expect({ ...english, text: '' }).toStrictEqual({ ...russian, text: '' })
    })

    it('accepts the same dashes, spacing and indentation as with the Russian labels', () => {
      const answer = ['    - Stage:  тикет 08', '–Now : пишу тесты', '  -   Next:PR', '— Waiting:  ничего   '].join('\r\n')
      expect(findStatusBlock(answer)).toStrictEqual({
        text: ['- Stage:  тикет 08', '–Now : пишу тесты', '-   Next:PR', '— Waiting:  ничего'].join('\n'),
        stage: 'тикет 08',
        now: 'пишу тесты',
        next: 'PR',
        waiting: 'ничего',
      })
    })

    it('finds nothing in a block that mixes English and Russian labels, as with lines out of order', () => {
      const english = ENGLISH.split('\n')
      const russian = BLOCK.split('\n')
      expect(findStatusBlock([english[0], russian[1], russian[2], russian[3]].join('\n'))).toBeNull()
      expect(findStatusBlock([russian[0], english[1], english[2], english[3]].join('\n'))).toBeNull()
      expect(findStatusBlock([english[0], english[1], russian[2], english[3]].join('\n'))).toBeNull()
    })

    it('takes a complete block in one language that follows a mixed one', () => {
      const english = ENGLISH.split('\n')
      const russian = BLOCK.split('\n')
      expect(findStatusBlock([english[0], russian[1], ...english].join('\n'))?.text).toBe(ENGLISH)
      expect(findStatusBlock([russian[0], english[1], ...russian].join('\n'))?.text).toBe(BLOCK)
    })

    it('takes the last block when an English block follows a Russian one', () => {
      expect(findStatusBlock(`${BLOCK}\n\n${ENGLISH}`)?.text).toBe(ENGLISH)
      expect(findStatusBlock(`${ENGLISH}\n\n${BLOCK}`)?.text).toBe(BLOCK)
    })

    it('does not take a label written in lower case', () => {
      expect(findStatusBlock(ENGLISH.toLowerCase())).toBeNull()
    })
  })

  describe('what is not a status line', () => {
    it('finds nothing when the lines have no dash before the label', () => {
      const bare = ['Stage: тикет 08', 'Now: пишу тесты', 'Next: PR', 'Waiting: ничего'].join('\n')
      expect(findStatusBlock(bare)).toBeNull()
      expect(findStatusBlock(BLOCK.replaceAll('— ', ''))).toBeNull()
    })

    it('finds nothing when the labels stand in the middle of prose lines', () => {
      const prose = [
        'Итог волны — Stage: тикет 08',
        'а сейчас — Now: пишу тесты',
        'потом — Next: PR',
        'и наконец — Waiting: ничего',
      ].join('\n')
      expect(findStatusBlock(prose)).toBeNull()
    })
  })

  describe('long lines', () => {
    // Parsing runs in the Electron main process on every answer: a line with a long run of spaces
    // must not make the match take seconds. The bound is generous so the test is not flaky.
    const SPACES = ' '.repeat(50_000)

    it('returns quickly, and finds nothing, when a value of a full block is a long run of spaces broken by a carriage return or a line separator', () => {
      // The break is followed by text: a \r right before the \n of the next line is a CRLF ending.
      for (const end of ['\r', '\u2028']) {
        const lines = ENGLISH_LINES.slice()
        lines[1] = `— Now:${SPACES}${end}${SPACES}x`
        const started = performance.now()
        expect(findStatusBlock(lines.join('\n'))).toBeNull()
        expect(performance.now() - started).toBeLessThan(1000)
      }
    })

    it('finds nothing when a value of a full block holds a lone carriage return or a line separator', () => {
      for (const end of ['\r', '\u2028', '\u2029']) {
        const lines = ENGLISH_LINES.slice()
        lines[2] = `— Next: PR${end}и ещё`
        expect(findStatusBlock(lines.join('\n'))).toBeNull()
      }
    })

    it('returns quickly and trims a value padded by long runs of spaces', () => {
      const lines = ENGLISH_LINES.slice()
      lines[1] = `${SPACES}—${SPACES}Now${SPACES}:${SPACES}x${SPACES}`
      const started = performance.now()
      const block = findStatusBlock(lines.join('\n'))
      expect(performance.now() - started).toBeLessThan(1000)
      expect(block?.now).toBe('x')
      expect(block?.text.split('\n')[1]).toBe(`—${SPACES}Now${SPACES}:${SPACES}x`)
    })
  })
})

