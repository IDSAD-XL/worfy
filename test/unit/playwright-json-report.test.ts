// playwright.config.ts names the file of its JSON reporter after the output folder of the run:
// test-results/e2e-report.json for `pnpm test:e2e`, test-results/package-report.json for
// `pnpm test:package` (`--output test-results/package`). The file lies outside the output folder,
// which Playwright empties when a run starts. scripts/test-timings.mjs reads both files.
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

const REPO = join(import.meta.dirname, '..', '..')
const argv = process.argv
// A new query for every import, so that the config is evaluated again (digits only: a dot would
// read as a file extension to Vite).
let loads = 0
// The config sets WORFY_QUIET_WINDOWS and WORFY_KEEP_PAINTING for the run when they are not set;
// the test leaves both as they were.
const quiet = process.env.WORFY_QUIET_WINDOWS
const keepPainting = process.env.WORFY_KEEP_PAINTING

afterEach(() => {
  process.argv = argv
  if (quiet === undefined) delete process.env.WORFY_QUIET_WINDOWS
  else process.env.WORFY_QUIET_WINDOWS = quiet
  if (keepPainting === undefined) delete process.env.WORFY_KEEP_PAINTING
  else process.env.WORFY_KEEP_PAINTING = keepPainting
  vi.resetModules()
})

/** The outputFile of the json reporter and the output folder, as the config gives them for this command line. */
async function jsonReport(args: string[]): Promise<{ outputFile: unknown; outputDir: unknown }> {
  process.argv = [argv[0] ?? 'node', 'playwright', 'test', ...args]
  vi.resetModules()
  const config = ((await import(`${pathToFileURL(join(REPO, 'playwright.config.ts')).href}?t=${Date.now()}${++loads}`)) as {
    default: { reporter: [string, Record<string, unknown>?][]; outputDir: string }
  }).default
  const json = config.reporter.find(([name]) => name === 'json')
  return { outputFile: json?.[1]?.outputFile, outputDir: config.outputDir }
}

describe('the JSON report of playwright.config.ts', () => {
  it('without --output: test-results/e2e-report.json, outside the output folder test-results/e2e', async () => {
    const { outputFile, outputDir } = await jsonReport(['--grep-invert', '@packaged'])
    expect(outputDir).toBe('test-results/e2e')
    expect(outputFile).toBe('test-results/e2e-report.json')
  })

  it('--output <folder> (pnpm test:package): <folder>-report.json', async () => {
    expect((await jsonReport(['--grep', '@packaged', '--output', 'test-results/package'])).outputFile).toBe('test-results/package-report.json')
  })

  it('--output=<folder>, with a trailing slash: <folder>-report.json', async () => {
    expect((await jsonReport(['--output=test-results/other/'])).outputFile).toBe('test-results/other-report.json')
  })

  it('keeps the list reporter and the failure-artifacts reporter', async () => {
    process.argv = [argv[0] ?? 'node', 'playwright', 'test']
    const config = ((await import(`${pathToFileURL(join(REPO, 'playwright.config.ts')).href}?t=${Date.now()}${++loads}`)) as { default: { reporter: [string][] } }).default
    expect(config.reporter.map(([name]) => name)).toEqual(['list', './test/e2e/helpers.ts', './test/e2e/flaky-reporter.ts', 'json'])
  })
})

describe('retries of playwright.config.ts', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  /** The retries of the config, loaded anew with CI set to `ci` (undefined: CI unset). */
  async function retries(ci: string | undefined): Promise<unknown> {
    vi.stubEnv('CI', ci)
    process.argv = [argv[0] ?? 'node', 'playwright', 'test']
    vi.resetModules()
    return ((await import(`${pathToFileURL(join(REPO, 'playwright.config.ts')).href}?t=${Date.now()}${++loads}`)) as { default: { retries: unknown } }).default.retries
  }

  it('retries a failed test once in CI, never outside it', async () => {
    expect(await retries('true')).toBe(1)
    expect(await retries(undefined)).toBe(0)
  })
})
