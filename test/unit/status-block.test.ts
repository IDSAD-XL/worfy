import { describe, expect, it } from 'vitest'
import { findStatusBlock } from '../../src/shared/agent/status-block'

// Samples shaped like the closing lines of real orchestrator answers: the four-line block of the
// user's CLAUDE.md («— Этап / — Сейчас / — Дальше / — Жду»), often indented as a code block.

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
})
