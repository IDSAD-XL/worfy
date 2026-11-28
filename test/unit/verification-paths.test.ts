// harness/lib/verification-paths.cjs (worfy-harness-guarantees ticket 02): the list of the files that judge
// work — CI workflows, scope scripts, the Quarantine, test and lint settings, review agents, Harness hooks.
// The defaults hold for every Project; the Profile field verification.paths only adds to them. A path is
// compared with `/` and `\` as one separator, and without letter case where the file system ignores it.
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

type Problem = { path: string; message: string }
type Options = { platform?: string; root?: string }
type VerificationPaths = {
  DEFAULT_VERIFICATION_PATHS: readonly string[]
  verificationPaths: (profile: unknown) => string[]
  verificationProblems: (profile: unknown) => Problem[]
  normalizePath: (file: string, options?: Options) => string | null
  isVerificationPath: (file: string, paths: readonly string[], options?: Options) => boolean
}

const vp = createRequire(import.meta.url)('../../harness/lib/verification-paths.cjs') as VerificationPaths

const DEFAULTS = ['.github/workflows/**', '.github/actions/**', 'CLAUDE.md', 'AGENTS.md', '.claude/**', '.codex/**', '.mcp.json']

// The list the owner's command writes into the Profile of worfy (the summary section of the ticket).
const WORFY = [
  'scripts/ci-*.mjs',
  'scripts/affected-tests*',
  'scripts/e2e-*',
  'scripts/windows-*.mjs',
  'scripts/vitest-electron.mjs',
  'scripts/check-*',
  'test/quarantine.ts',
  'test/quarantine/**',
  'test/e2e/quarantine.ts',
  'test/flaky.ts',
  'test/flaky-reporter.ts',
  'test/e2e/flaky-reporter.ts',
  'vitest.config.ts',
  'playwright*.config.ts',
  'eslint.config.js',
  'tsconfig*.json',
  'harness/agents/reviewer.md',
  'harness/agents/critic.md',
  'harness/hooks/hooks.json',
  'harness/hooks/{guard,gate,gate-*,stop,codex-input}.mjs',
  'harness/hooks/gate.sh',
  'harness/lib/{privacy,verification-paths}.cjs',
  'harness/bin/{land,verdict,silent-check,evidence-check}',
]

const linux = { platform: 'linux' }
const win = { platform: 'win32' }
const mac = { platform: 'darwin' }

describe('the defaults', () => {
  it('are the same list for every Project', () => {
    expect([...vp.DEFAULT_VERIFICATION_PATHS]).toEqual(DEFAULTS)
    expect(vp.verificationPaths({})).toEqual(DEFAULTS)
    expect(vp.verificationPaths(null)).toEqual(DEFAULTS)
  })

  it.each([
    '.github/workflows/ci.yml',
    '.github/workflows/nested/windows.yml',
    '.github/actions/setup/action.yml',
    'CLAUDE.md',
    'AGENTS.md',
    '.claude/settings.json',
    '.claude/agents/x.md',
    '.codex/hooks.json',
    '.mcp.json',
  ])('%s is a verification path', (file) => {
    expect(vp.isVerificationPath(file, DEFAULTS, linux)).toBe(true)
  })

  it.each([
    'src/main/index.ts',
    '.github/CODEOWNERS',
    '.github/workflows',
    'docs/CLAUDE.md',
    'CLAUDE.md.bak',
    'xCLAUDE.md',
    '.mcp.json.old',
    '.claudex/settings.json',
    'README.md',
  ])('%s is not', (file) => {
    expect(vp.isVerificationPath(file, DEFAULTS, linux)).toBe(false)
  })
})

describe('the globs of the Profile', () => {
  const paths = vp.verificationPaths({ verification: { paths: WORFY } })

  it('come after the defaults, each once', () => {
    expect(paths).toEqual([...DEFAULTS, ...WORFY])
    expect(vp.verificationPaths({ verification: { paths: ['CLAUDE.md', 'eslint.config.js', 'eslint.config.js'] } })).toEqual([...DEFAULTS, 'eslint.config.js'])
  })

  it.each([
    'scripts/ci-scope.mjs',
    'scripts/affected-tests.mjs',
    'scripts/affected-tests-map.json',
    'scripts/e2e-shard.mjs',
    'scripts/windows-verdict-scope.mjs',
    'scripts/vitest-electron.mjs',
    'scripts/check-handoff.mjs',
    'test/quarantine.ts',
    'test/quarantine/unit.json',
    'test/quarantine/deep/e2e.json',
    'test/e2e/quarantine.ts',
    'test/flaky-reporter.ts',
    'vitest.config.ts',
    'playwright.config.ts',
    'playwright.acceptance.config.ts',
    'tsconfig.json',
    'tsconfig.test.node.json',
    'harness/agents/reviewer.md',
    'harness/hooks/hooks.json',
    'harness/hooks/guard.mjs',
    'harness/hooks/gate.mjs',
    'harness/hooks/gate-resolve.mjs',
    'harness/hooks/stop.mjs',
    'harness/hooks/codex-input.mjs',
    'harness/hooks/gate.sh',
    'harness/lib/privacy.cjs',
    'harness/lib/verification-paths.cjs',
    'harness/bin/land',
    'harness/bin/evidence-check',
  ])('%s is a verification path of worfy', (file) => {
    expect(vp.isVerificationPath(file, paths, linux)).toBe(true)
  })

  it.each([
    'scripts/ci-scope.ts',
    'scripts/ci/x.mjs',
    'scripts/release.mjs',
    'test/quarantine.json',
    'test/unit/quarantine.ts',
    'harness/hooks/session-start.mjs',
    'harness/hooks/gate-resolve.cjs',
    'harness/hooks/guard.mjs.orig',
    'harness/lib/pipeline.cjs',
    'harness/bin/landing',
    'harness/bin/tests/land.test.sh',
    'src/tsconfig.json',
    'vitest.config.mts',
  ])('%s is not', (file) => {
    expect(vp.isVerificationPath(file, paths, linux)).toBe(false)
  })

  it('reads ? as one character, never a separator, and the other regular expression characters as themselves', () => {
    expect(vp.isVerificationPath('a1.txt', ['a?.txt'], linux)).toBe(true)
    expect(vp.isVerificationPath('a/.txt', ['a?.txt'], linux)).toBe(false)
    expect(vp.isVerificationPath('aXtxt', ['a.txt'], linux)).toBe(false)
    expect(vp.isVerificationPath('a(b).txt', ['a(b).txt'], linux)).toBe(true)
    expect(vp.isVerificationPath('x/y/z.md', ['**/z.md'], linux)).toBe(true)
    expect(vp.isVerificationPath('z.md', ['**/z.md'], linux)).toBe(true)
    expect(vp.isVerificationPath('a/b', ['a/**/b'], linux)).toBe(true)
    expect(vp.isVerificationPath('a/x/y/b', ['a/**/b'], linux)).toBe(true)
    expect(vp.isVerificationPath('a/xb', ['a/**/b'], linux)).toBe(false)
    expect(vp.isVerificationPath('a{b', ['a{b'], linux)).toBe(true)
  })
})

describe('the Profile only adds', () => {
  it('an empty list or null keeps every default', () => {
    expect(vp.verificationPaths({ verification: { paths: [] } })).toEqual(DEFAULTS)
    expect(vp.verificationPaths({ verification: { paths: null } })).toEqual(DEFAULTS)
    expect(vp.verificationPaths({ verification: null })).toEqual(DEFAULTS)
  })

  it('a negated glob removes no default and is a problem of the Profile', () => {
    const profile = { verification: { paths: ['!CLAUDE.md', '!.github/workflows/**', 'scripts/ci-*.mjs'] } }
    const paths = vp.verificationPaths(profile)
    expect(paths).toEqual([...DEFAULTS, 'scripts/ci-*.mjs'])
    expect(vp.isVerificationPath('CLAUDE.md', paths, linux)).toBe(true)
    expect(vp.isVerificationPath('.github/workflows/ci.yml', paths, linux)).toBe(true)
    expect(vp.verificationProblems(profile).map((problem) => problem.path)).toEqual(['verification.paths[0]', 'verification.paths[1]'])
    expect(vp.verificationProblems(profile)[0]?.message).toContain('only adds')
  })

  it('a value of another shape keeps the defaults and is a problem of the Profile', () => {
    for (const verification of [['CLAUDE.md'], 'scripts/**', 3]) {
      expect(vp.verificationPaths({ verification })).toEqual(DEFAULTS)
      expect(vp.verificationProblems({ verification }).map((problem) => problem.path)).toEqual(['verification'])
    }
    for (const paths of ['scripts/**', { a: 1 }, true]) {
      expect(vp.verificationPaths({ verification: { paths } })).toEqual(DEFAULTS)
      expect(vp.verificationProblems({ verification: { paths } }).map((problem) => problem.path)).toEqual(['verification.paths'])
    }
    expect(vp.verificationProblems({ verification: { paths: ['ok/**', '', '  ', 7, null] } }).map((problem) => problem.path)).toEqual([
      'verification.paths[1]',
      'verification.paths[2]',
      'verification.paths[3]',
      'verification.paths[4]',
    ])
    expect(vp.verificationPaths({ verification: { paths: ['ok/**', '', 7] } })).toEqual([...DEFAULTS, 'ok/**'])
  })

  it('a Profile without the field, or with a well-formed one, has no problems', () => {
    expect(vp.verificationProblems({})).toEqual([])
    expect(vp.verificationProblems({ verification: null })).toEqual([])
    expect(vp.verificationProblems({ verification: { paths: WORFY } })).toEqual([])
  })
})

describe('the separators and the letter case', () => {
  it('reads \\ as / on every platform', () => {
    for (const options of [linux, win, mac]) {
      expect(vp.isVerificationPath('.github\\workflows\\ci.yml', DEFAULTS, options)).toBe(true)
      expect(vp.isVerificationPath('.claude\\settings.json', DEFAULTS, options)).toBe(true)
    }
  })

  it('ignores the letter case on Windows and macOS, and not on Linux', () => {
    expect(vp.isVerificationPath('.GitHub/Workflows/CI.yml', DEFAULTS, win)).toBe(true)
    expect(vp.isVerificationPath('claude.md', DEFAULTS, win)).toBe(true)
    expect(vp.isVerificationPath('.GITHUB\\WORKFLOWS\\ci.yml', DEFAULTS, win)).toBe(true)
    expect(vp.isVerificationPath('claude.md', DEFAULTS, mac)).toBe(true)
    expect(vp.isVerificationPath('.GitHub/Workflows/CI.yml', DEFAULTS, linux)).toBe(false)
    expect(vp.isVerificationPath('claude.md', DEFAULTS, linux)).toBe(false)
  })

  it('takes a path from the root of the repository: ./, .. inside it and doubled separators', () => {
    expect(vp.normalizePath('./CLAUDE.md', linux)).toBe('CLAUDE.md')
    expect(vp.normalizePath('src/../CLAUDE.md', linux)).toBe('CLAUDE.md')
    expect(vp.normalizePath('.github//workflows\\\\ci.yml', linux)).toBe('.github/workflows/ci.yml')
    expect(vp.normalizePath('../CLAUDE.md', linux)).toBeNull()
    expect(vp.normalizePath('..\\CLAUDE.md', win)).toBeNull()
    expect(vp.isVerificationPath('../CLAUDE.md', DEFAULTS, linux)).toBe(false)
    expect(vp.isVerificationPath('src/../CLAUDE.md', DEFAULTS, linux)).toBe(true)
  })

  it('takes an absolute path inside the root, and none outside it or without a root', () => {
    expect(vp.isVerificationPath('/work/repo/.github/workflows/ci.yml', DEFAULTS, { ...linux, root: '/work/repo' })).toBe(true)
    expect(vp.isVerificationPath('/work/repo/.github/workflows/ci.yml', DEFAULTS, { ...linux, root: '/work/repo/' })).toBe(true)
    expect(vp.isVerificationPath('/work/repo2/CLAUDE.md', DEFAULTS, { ...linux, root: '/work/repo' })).toBe(false)
    expect(vp.isVerificationPath('/work/repo/CLAUDE.md', DEFAULTS, linux)).toBe(false)
    expect(vp.isVerificationPath('/work/Repo/CLAUDE.md', DEFAULTS, { ...linux, root: '/work/repo' })).toBe(false)
    expect(vp.isVerificationPath('C:\\Work\\Repo\\.github\\workflows\\ci.yml', DEFAULTS, { ...win, root: 'c:/work/repo' })).toBe(true)
    expect(vp.isVerificationPath('c:/work/repo/CLAUDE.md', DEFAULTS, { ...win, root: 'C:\\Work\\Repo\\' })).toBe(true)
    expect(vp.isVerificationPath('C:\\Work\\Other\\CLAUDE.md', DEFAULTS, { ...win, root: 'C:\\Work\\Repo' })).toBe(false)
    expect(vp.isVerificationPath('C:\\Work\\Repo\\CLAUDE.md', DEFAULTS, win)).toBe(false)
    expect(vp.normalizePath('/work/repo', { ...linux, root: '/work/repo' })).toBeNull()
  })
})
