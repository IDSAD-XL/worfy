// Tests of test/contract/failures-reporter-rerun.test.ts, run only through ./vitest.config.ts. Three
// fail on purpose: the rerun of "a" must not also run "a b", whose name starts with it, nor the "a" in
// the describe block, whose name ends with it.
import { describe, expect, it } from 'vitest'

it('a', () => {
  expect('a').toBe('fails on purpose')
})

it('a b', () => {
  expect('a b').toBe('fails on purpose')
})

it('passes', () => {
  expect(1).toBe(1)
})

describe('group (with) [regex] chars.*', () => {
  it('a', () => {
    expect('group a').toBe('fails on purpose')
  })
})
