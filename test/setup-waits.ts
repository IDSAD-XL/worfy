// The setup file of every project of the run (vitest.config.ts): vi.waitFor and vi.waitUntil without a
// timeout of their own wait 1 s times the run's multiplier, not vitest's bare 1 s (test/scaled-waits.ts).
import { vi } from 'vitest'
import { scaleWaits } from './scaled-waits'
import { timeScale } from './time-scale'

scaleWaits(vi, timeScale)
