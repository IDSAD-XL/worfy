// One multiplier for every time limit of the test run (worfy-throughput 57): WORFY_TEST_TIMEOUT_SCALE
// is read in one place, and no test writes a limit as a bare number that the multiplier never reaches.

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_TIMEOUT_SCALE, ms, readTimeoutScale, timeScale } from '../time-scale'
import { unscaledLimits } from '../timeout-literals'

const ROOT = join(import.meta.dirname, '..', '..')

// Files whose numbers named timeout are not limits of the run.
const NOT_LIMITS: Record<string, string> = {
  'test/time-scale.ts': 'DEFAULT_TIMEOUT_SCALE is the multiplier itself',
  'test/unit/quarantine.test.ts': 'the timeout values are data of the tests a quarantine entry declares',
}

// Limits a neighbouring change owns, by name, wherever the file that defines them lives.
const OWNED_ELSEWHERE: Array<[RegExp, string]> = [
  [/\bFILE_TIMEOUT_MS\b/, 'the limit of one Harness shell test: worfy-throughput 56 (#1023) moves it, the multiplier follows after'],
]

function sources(folder: string): string[] {
  return readdirSync(join(ROOT, folder), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(ts|tsx|mts)$/.test(entry.name))
    .map((entry) => relative(ROOT, join(entry.parentPath, entry.name)).replaceAll('\\', '/'))
    .filter((file) => !file.startsWith('test/fixtures/'))
}

describe('the multiplier of the time limits of a test run', () => {
  it('is one value on every machine when WORFY_TEST_TIMEOUT_SCALE is unset, never below the Windows 3 it replaced', () => {
    expect(readTimeoutScale(undefined)).toBe(DEFAULT_TIMEOUT_SCALE)
    expect(readTimeoutScale('')).toBe(DEFAULT_TIMEOUT_SCALE)
    expect(DEFAULT_TIMEOUT_SCALE).toBeGreaterThanOrEqual(3)
    expect(readFileSync(join(ROOT, 'test', 'time-scale.ts'), 'utf8')).not.toMatch(/process\.platform/)
  })

  it('takes WORFY_TEST_TIMEOUT_SCALE when it is a number of at least 1, and refuses anything else', () => {
    expect(readTimeoutScale('2.5')).toBe(2.5)
    expect(readTimeoutScale('1')).toBe(1)
    for (const wrong of ['0.5', '0', '-2', 'three', 'Infinity', 'NaN']) {
      expect(() => readTimeoutScale(wrong), wrong).toThrow(/WORFY_TEST_TIMEOUT_SCALE must be a number of at least 1/)
    }
  })

  it('ms multiplies a limit by the run\'s multiplier, rounded to whole milliseconds', () => {
    expect(ms(1_000)).toBe(Math.round(1_000 * timeScale))
    expect(timeScale).toBe(readTimeoutScale(process.env.WORFY_TEST_TIMEOUT_SCALE))
  })
})

describe('the scanner of limits written as bare numbers', () => {
  const found = (source: string): number[] => unscaledLimits(source, 'sample.test.ts').map((each) => each.line)

  it('finds a bare limit in each place a test sets one', () => {
    const source = [
      "it('a', async () => {}, 45_000)",
      "it.skipIf(WINDOWS)('b', { timeout: 20_000 }, async () => {})",
      'await vi.waitFor(() => expect(x).toBe(1), { timeout: 3000, interval: 20 })',
      'await expect(page.getByText("x")).toBeVisible({ timeout: 10_000 })',
      'test.setTimeout(15 * 60_000)',
      'const WAIT_TIMEOUT_MS = 30_000',
      "it('c', async () => {}, WINDOWS ? 60_000 : undefined)",
      'beforeAll(async () => {}, 120_000)',
      'await vi.waitFor(() => expect(x).toBe(1), 5000)',
      'const run = spawnSync(bin, args, { timeout: options.timeout ?? 10_000 })',
    ].join('\n')
    expect(found(source)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('passes a limit through ms, a derived limit, zero, a compared option and a marked line', () => {
    const source = [
      "it('a', async () => {}, ms(45_000))",
      'await vi.waitFor(() => expect(x).toBe(1), { timeout: ms(3000), interval: 20 })',
      "it('b', async () => {}, ROUNDS * 6_000)",
      'const run = spawnSync(bin, args, { timeout: RUN_TIMEOUT })',
      'await expect(locator).toBeVisible({ timeout: 0 })',
      'expect(options).toEqual({ encoding: "utf8", timeout: 10_000 })',
      '// unscaled: the expected error names this bound',
      'await expect(ready({ timeout: 1_000 })).rejects.toThrow(/1000 ms/)',
      'setTimeout(done, 300)',
      "it('c', async () => {})",
    ].join('\n')
    expect(found(source)).toEqual([])
  })
})

describe('every time limit of the test run goes through the multiplier', () => {
  it('no file under test/ and no configuration of the run writes a limit as a bare number', () => {
    const files = [...sources('test'), 'vitest.config.ts', 'playwright.config.ts', 'playwright.acceptance.config.ts']
    const bare = files
      .filter((file) => !(file in NOT_LIMITS))
      .flatMap((file) => unscaledLimits(readFileSync(join(ROOT, file), 'utf8'), file).map((each) => `${file}:${each.line}: ${each.text}`))
      .filter((finding) => !OWNED_ELSEWHERE.some(([name]) => name.test(finding)))
    // A limit of a test goes through ms (test/time-scale.ts). A bound the test expects to run out, or a
    // time budget of the product, keeps its number with `// unscaled: <reason>` on the line or the one before.
    expect(bare).toEqual([])
  })
})
