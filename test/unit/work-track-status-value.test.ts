// The value of a Ticket's `Status:` line, as the git history of the Ticket files holds it
// (src/shared/work-track/status-value.ts; worfy-work-track ticket 07). The forms are the ones research 04
// of worfy-autopilot-queue counted in the history of main and of the remote branches: the Harness form
// with an ISO time or a date, the old form with a dash and a tail, a date and a time with no zone, a
// bare word. A value of an unknown form is null, never an error.
import { describe, expect, it } from 'vitest'
import { parseStatusValue, statusInstant, statusLineValue } from '../../src/shared/work-track/status-value'

describe('parseStatusValue', () => {
  it.each([
    ['open', { state: 'open', time: null }],
    ['claimed 2026-11-05T07:39Z', { state: 'claimed', time: { kind: 'instant', at: '2026-11-05T07:39:00.000Z' } }],
    ['done 2026-11-05T07:39Z', { state: 'done', time: { kind: 'instant', at: '2026-11-05T07:39:00.000Z' } }],
    ['blocked 2026-10-17T09:41Z', { state: 'blocked', time: { kind: 'instant', at: '2026-10-17T09:41:00.000Z' } }],
    ['open 2026-11-01T12:00Z', { state: 'open', time: { kind: 'instant', at: '2026-11-01T12:00:00.000Z' } }],
    ['done 2026-11-05', { state: 'done', time: { kind: 'date', date: '2026-11-05' } }],
    ['claimed 2026-11-05', { state: 'claimed', time: { kind: 'date', date: '2026-11-05' } }],
    ['done — 2026-11-05, [PR #1496](https://github.com/IDSAD-XL/worfy/pull/1496)', { state: 'done', time: { kind: 'date', date: '2026-11-05' } }],
    ['claimed — 2026-11-05', { state: 'claimed', time: { kind: 'date', date: '2026-11-05' } }],
    ['done — 2026-11-05', { state: 'done', time: { kind: 'date', date: '2026-11-05' } }],
    // The old tail in Russian, as the Ticket files of the project wrote it: the date at its head still counts.
    ['done — 2026-10-20, отчёт — [PR #700](https://example.test/700), решение владельца — в «Итог»', { state: 'done', time: { kind: 'date', date: '2026-10-20' } }],
    ['done 2026-11-01 00:00', { state: 'done', time: { kind: 'local', date: '2026-11-01', time: '00:00' } }],
    ['done 2026-11-05 07:39', { state: 'done', time: { kind: 'local', date: '2026-11-05', time: '07:39' } }],
    ['blocked — blocked by 06, 07, 08', { state: 'blocked', time: null }],
    // A Russian reason after the dash: the state is read, a date further in the reason is not the time.
    ['blocked — отложен владельцем 2026-10-12', { state: 'blocked', time: null }],
    ['blocked', { state: 'blocked', time: null }],
    ['in-progress', { state: 'claimed', time: null }],
    ['Done 2026-11-05', { state: 'done', time: { kind: 'date', date: '2026-11-05' } }],
    ['done 2026-11-05T07:39:21Z', { state: 'done', time: { kind: 'instant', at: '2026-11-05T07:39:21.000Z' } }],
    ['done 2026-11-05T09:39:21+02:00', { state: 'done', time: { kind: 'instant', at: '2026-11-05T07:39:21.000Z' } }],
    ['done 2026-11-05T07:39', { state: 'done', time: { kind: 'local', date: '2026-11-05', time: '07:39' } }],
    ['**done — 2026-08-27**', { state: 'done', time: { kind: 'date', date: '2026-08-27' } }],
    ['done   2026-11-05  ', { state: 'done', time: { kind: 'date', date: '2026-11-05' } }],
  ])('reads %j', (value, expected) => {
    expect(parseStatusValue(value)).toEqual(expected)
  })

  it('keeps the state and drops a date that is not a calendar day', () => {
    expect(parseStatusValue('done 2026-13-40')).toEqual({ state: 'done', time: null })
    expect(parseStatusValue('done 2026-02-30')).toEqual({ state: 'done', time: null })
    expect(parseStatusValue('done 2026-11-05T25:00Z')).toEqual({ state: 'done', time: null })
  })

  it.each([
    [''],
    ['   '],
    // Spec status words of the project and other unknown words: no guess.
    ['черновик'],
    ['принят владельцем 2026-11-06'],
    ['ready'],
    ['done-ish 2026-11-05'],
    ['2026-11-05'],
  ])('gives null for the unknown form %j, without an error', (value) => {
    expect(parseStatusValue(value)).toBeNull()
  })
})

describe('statusLineValue', () => {
  it.each([
    ['Status: done 2026-11-05T07:39Z', 'done 2026-11-05T07:39Z'],
    ['**Status:** done — 2026-08-27', 'done — 2026-08-27'],
    ['**Status**: claimed', 'claimed'],
    ['Status:open', 'open'],
    ['Status: done 2026-11-05\r', 'done 2026-11-05'],
  ])('takes the value of %j', (line, value) => {
    expect(statusLineValue(line)).toBe(value)
  })

  it.each([['Statuses: done'], ['The Status: done'], ['- Status: done'], ['Type: task'], ['`Status: done`']])(
    'gives null for %j, which is not a Status line',
    (line) => {
      expect(statusLineValue(line)).toBeNull()
    },
  )
})

describe('statusInstant', () => {
  it('gives the instant of a value with a zone as it is', () => {
    expect(statusInstant({ kind: 'instant', at: '2026-11-05T07:39:00.000Z' }, '2026-11-05T10:00:00+02:00')).toBe('2026-11-05T07:39:00.000Z')
  })

  it('reads a time with no zone in the time zone of the commit that wrote it', () => {
    expect(statusInstant({ kind: 'local', date: '2026-11-01', time: '00:00' }, '2026-11-01T00:15:40+02:00')).toBe('2026-10-31T22:00:00.000Z')
    expect(statusInstant({ kind: 'local', date: '2026-11-05', time: '07:39' }, '2026-11-05T07:40:00Z')).toBe('2026-11-05T07:39:00.000Z')
    expect(statusInstant({ kind: 'local', date: '2026-11-05', time: '07:39' }, '2026-11-05T02:40:00-05:30')).toBe('2026-11-05T13:09:00.000Z')
  })

  it('gives null for a date only or no time: the time of the commit stands in', () => {
    expect(statusInstant({ kind: 'date', date: '2026-11-05' }, '2026-11-05T10:00:00Z')).toBeNull()
    expect(statusInstant(null, '2026-11-05T10:00:00Z')).toBeNull()
  })

  it('gives null when the commit time has no zone to read a local time in', () => {
    expect(statusInstant({ kind: 'local', date: '2026-11-05', time: '07:39' }, 'not a date')).toBeNull()
  })
})
