import { describe, expect, it } from 'vitest'
import { formatAnswers, type Question } from '../../src/shared/agent/questions'

// The one place that turns the user's picks into the `answers` Claude Code reads (worfy-ui ticket 17;
// the shape is recorded in test/contract/ask-user-question-sdk.test.ts).

const DATABASE: Question = {
  question: 'Which database should the cache use?',
  header: 'Database',
  multiSelect: false,
  options: [
    { label: 'Postgres', description: '', preview: null },
    { label: 'SQLite', description: '', preview: null },
  ],
}

const CHECKS: Question = {
  question: 'Which checks should run first?',
  header: 'Checks',
  multiSelect: true,
  options: [
    { label: 'Lint', description: '', preview: null },
    { label: 'Typecheck', description: '', preview: null },
    { label: 'Unit tests', description: '', preview: null },
  ],
}

describe('formatAnswers', () => {
  it('joins multiSelect labels in the options order, then the trimmed "Other" text', () => {
    expect(formatAnswers([CHECKS], [{ selected: ['Unit tests', 'Lint'], other: '  Format check ' }])).toEqual({ [CHECKS.question]: 'Lint, Unit tests, Format check' })
  })

  it('a blank "Other" next to a picked option is no answer of its own', () => {
    expect(formatAnswers([DATABASE], [{ selected: ['SQLite'], other: '  ' }])).toEqual({ [DATABASE.question]: 'SQLite' })
  })

  it('refuses an option picked twice in a multiSelect question', () => {
    expect(() => formatAnswers([CHECKS], [{ selected: ['Lint', 'Lint'], other: null }])).toThrow(/twice/)
  })

  it('keeps the answer of a question whose text is "__proto__" as an own key', () => {
    const odd: Question = { ...DATABASE, question: '__proto__' }
    const answers = formatAnswers([odd, DATABASE], [
      { selected: ['Postgres'], other: null },
      { selected: ['SQLite'], other: null },
    ])
    expect(Object.keys(answers)).toEqual(['__proto__', DATABASE.question])
    expect(Object.getOwnPropertyDescriptor(answers, '__proto__')?.value).toBe('Postgres')
    expect(Object.getPrototypeOf(answers)).toBe(Object.prototype)
    // What goes to Claude Code over its stdin is JSON: the answer is in it.
    expect(JSON.stringify(answers)).toContain('"__proto__":"Postgres"')
  })
})
