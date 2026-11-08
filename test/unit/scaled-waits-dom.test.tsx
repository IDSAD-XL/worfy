// The jsdom project runs with the scaled waits too (worfy-polish 70): its own setup file comes on top
// of test/setup-waits.ts, and Testing Library's waitFor and findBy* default to 1 s times the multiplier.

import { getConfig } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { scaledTimeoutOf, WAIT_DEFAULT_TIMEOUT } from '../scaled-waits'
import { ms } from '../time-scale'

describe('the waits of a jsdom test', () => {
  it('vi.waitFor, vi.waitUntil and Testing Library default to 1 s times the run\'s multiplier', () => {
    expect(scaledTimeoutOf(vi.waitFor)).toBe(ms(WAIT_DEFAULT_TIMEOUT))
    expect(scaledTimeoutOf(vi.waitUntil)).toBe(ms(WAIT_DEFAULT_TIMEOUT))
    expect(getConfig().asyncUtilTimeout).toBe(ms(WAIT_DEFAULT_TIMEOUT))
  })
})
