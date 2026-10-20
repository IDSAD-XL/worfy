// worfy's own memory (src/shared/memory.ts): the sum of app.getAppMetrics() by process type, the
// toolbar's "412 MB" / "1.3 GB" and the tooltip with the breakdown.
import { describe, expect, it } from 'vitest'
import { formatMemory, memoryTooltip, memoryUsageSchema, sumAppMetrics, type ProcessMemoryMetric } from '../../src/shared/memory'

const MB = 1024

const metric = (type: string, workingSetSize: number): ProcessMemoryMetric => ({ type, memory: { workingSetSize } })

describe('formatMemory', () => {
  it.each([
    [0, '0 MB'],
    [400, '0 MB'],
    [600, '1 MB'],
    [412 * MB, '412 MB'],
    [1023 * MB, '1023 MB'],
    // 1023.6 MB rounds to 1024 MB, which is already a gigabyte.
    [1023.6 * MB, '1.0 GB'],
    [1024 * MB, '1.0 GB'],
    [1.3 * 1024 * MB, '1.3 GB'],
    [1.96 * 1024 * MB, '2.0 GB'],
    [12.5 * 1024 * MB, '12.5 GB'],
  ])('%d KB is "%s"', (kb, text) => {
    expect(formatMemory(kb)).toBe(text)
  })

  it('a value that is not a finite number or below zero shows as 0 MB', () => {
    expect(formatMemory(Number.NaN)).toBe('0 MB')
    expect(formatMemory(-5)).toBe('0 MB')
    expect(formatMemory(Number.POSITIVE_INFINITY)).toBe('0 MB')
  })
})

describe('sumAppMetrics', () => {
  it('sums every process of the app and splits them into main, windows, GPU and other', () => {
    const usage = sumAppMetrics(
      [metric('Browser', 180 * MB), metric('Tab', 100 * MB), metric('Tab', 60 * MB), metric('GPU', 50 * MB), metric('Utility', 20 * MB), metric('Unknown', 2 * MB)],
      1000,
    )
    expect(usage).toStrictEqual({
      totalKb: 412 * MB,
      byKind: { main: 180 * MB, windows: 160 * MB, gpu: 50 * MB, other: 22 * MB },
      sampledAt: 1000,
    })
    expect(memoryUsageSchema.parse(usage)).toStrictEqual(usage)
  })

  it('an empty list is zero everywhere', () => {
    expect(sumAppMetrics([], 5)).toStrictEqual({ totalKb: 0, byKind: { main: 0, windows: 0, gpu: 0, other: 0 }, sampledAt: 5 })
  })

  it('a size that is not a finite number or below zero counts as zero', () => {
    const usage = sumAppMetrics([metric('Browser', Number.NaN), metric('Tab', -10), metric('GPU', Number.POSITIVE_INFINITY), metric('Tab', 10)], 0)
    expect(usage.totalKb).toBe(10)
    expect(usage.byKind).toStrictEqual({ main: 0, windows: 10, gpu: 0, other: 0 })
  })
})

describe('memoryTooltip', () => {
  it('says what is counted and what is not, and gives the breakdown', () => {
    const usage = sumAppMetrics([metric('Browser', 180 * MB), metric('Tab', 160 * MB), metric('GPU', 50 * MB), metric('Utility', 22 * MB)], 0)
    expect(memoryTooltip(usage)).toBe("Memory used by worfy's own processes (not counting terminal sessions)\nMain 180 MB · Windows 160 MB · GPU 50 MB · Other 22 MB")
  })
})
