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

describe('review round 1: the globs of the Profile and the paths are read the same way', () => {
  it('reads \\ in a glob as /, as in a path', () => {
    expect(vp.isVerificationPath('test/quarantine/a.ts', ['test\\quarantine\\**'], win)).toBe(true)
    expect(vp.isVerificationPath('test\\quarantine\\a.ts', ['test\\quarantine\\**'], linux)).toBe(true)
    expect(vp.verificationPaths({ verification: { paths: ['test\\quarantine\\**'] } })).toEqual([...DEFAULTS, 'test/quarantine/**'])
  })

  it('writes ./, a leading / and a trailing / of a glob the way it matches: from the root, a folder as folder/**', () => {
    const paths = vp.verificationPaths({ verification: { paths: ['./scripts/**', 'tools/', '/ROOT.md', ' spaced.md '] } })
    expect(paths).toEqual([...DEFAULTS, 'scripts/**', 'tools/**', 'ROOT.md', 'spaced.md'])
    expect(vp.isVerificationPath('scripts/ci.mjs', ['./scripts/**'], linux)).toBe(true)
    expect(vp.isVerificationPath('tools/a/b.sh', ['tools/'], linux)).toBe(true)
    expect(vp.isVerificationPath('ROOT.md', ['/ROOT.md'], linux)).toBe(true)
    expect(vp.verificationProblems({ verification: { paths: ['./scripts/**', 'tools/', '/ROOT.md'] } })).toEqual([])
  })

  it('a glob outside the repository, or one that is only separators, is a problem of the Profile and adds nothing', () => {
    const profile = { verification: { paths: ['../other/**', '/', './', ' !CLAUDE.md'] } }
    expect(vp.verificationProblems(profile).map((problem) => problem.path)).toEqual([
      'verification.paths[0]',
      'verification.paths[1]',
      'verification.paths[2]',
      'verification.paths[3]',
    ])
    expect(vp.verificationPaths(profile)).toEqual(DEFAULTS)
  })

  it('resolves a relative path against the root first, so ../ back into the root counts', () => {
    expect(vp.isVerificationPath('../rev/CLAUDE.md', DEFAULTS, { ...linux, root: '/x/rev' })).toBe(true)
    expect(vp.isVerificationPath('../other/CLAUDE.md', DEFAULTS, { ...linux, root: '/x/rev' })).toBe(false)
    expect(vp.isVerificationPath('..\\Rev\\claude.md', DEFAULTS, { ...win, root: 'C:\\x\\rev' })).toBe(true)
  })

  it('reads a Git Bash path /c/... as c:/... on Windows, in the path and in the root', () => {
    expect(vp.isVerificationPath('/c/Work/Repo/CLAUDE.md', DEFAULTS, { ...win, root: 'C:\\Work\\Repo' })).toBe(true)
    expect(vp.isVerificationPath('C:\\Work\\Repo\\CLAUDE.md', DEFAULTS, { ...win, root: '/c/work/repo' })).toBe(true)
    expect(vp.isVerificationPath('/d/Work/Repo/CLAUDE.md', DEFAULTS, { ...win, root: 'C:\\Work\\Repo' })).toBe(false)
    expect(vp.isVerificationPath('/c/Work/Repo/CLAUDE.md', DEFAULTS, { ...linux, root: 'c:/Work/Repo' })).toBe(false)
  })

  it('a sibling folder whose name starts with the root is outside it', () => {
    expect(vp.isVerificationPath('/work/repoXCLAUDE.md', DEFAULTS, { ...linux, root: '/work/repo' })).toBe(false)
    expect(vp.isVerificationPath('/work/repo-x/CLAUDE.md', DEFAULTS, { ...linux, root: '/work/repo' })).toBe(false)
    expect(vp.isVerificationPath('C:\\Work\\RepoX\\CLAUDE.md', DEFAULTS, { ...win, root: 'c:/work/repo' })).toBe(false)
  })
})

describe('review round 1: the draft schema refuses what the profile rules refuse', () => {
  type Draft = {
    loadDraftSchema: () => unknown
    fieldSchema: (schema: unknown, field: string) => { schema: unknown }
    validate: (schema: unknown, value: unknown, at?: string) => Problem[]
  }
  const draft = createRequire(import.meta.url)('../../harness/lib/draft-schema.cjs') as Draft
  const profileSchema = (draft.loadDraftSchema() as { properties: { profile: unknown } }).properties.profile
  const problems = (field: string, value: unknown): string[] => draft.validate(draft.fieldSchema(profileSchema, field).schema, value, field).map((p) => p.path)

  it('workflow.ci_check: a blank or multi-line name is refused, a name is taken', () => {
    expect(problems('workflow.ci_check', '   ')).toEqual(['workflow.ci_check'])
    expect(problems('workflow.ci_check', 'a\nb')).toEqual(['workflow.ci_check'])
    expect(problems('workflow.ci_check', 'ci-ok')).toEqual([])
    expect(problems('workflow.ci_check', null)).toEqual([])
  })

  it('verification.paths: a blank or negated glob is refused, with or without spaces before it', () => {
    expect(problems('verification.paths', ['ok/**', '  ', '!x', ' !x'])).toEqual(['verification.paths[1]', 'verification.paths[2]', 'verification.paths[3]'])
    expect(problems('verification.paths', WORFY)).toEqual([])
  })

  it('verification.paths: a glob with a .. segment or made only of /, \\ and . is refused by the schema and by the module alike', () => {
    const refused = ['../x', '/', '\\', 'a/../b', ' .. ', 'a\\..', './', '.', '/./', '.\\.', '//', 'a\nb/../c']
    const taken = ['scripts/**', 'x/./y', 'x/.', '...', '..x/a', 'a../b', '.github/**']
    for (const glob of refused) {
      expect(problems('verification.paths', [glob]), JSON.stringify(glob)).toEqual(['verification.paths[0]'])
      expect(vp.verificationProblems({ verification: { paths: [glob] } }).map((p) => p.path), JSON.stringify(glob)).toEqual(['verification.paths[0]'])
    }
    for (const glob of taken) {
      expect(problems('verification.paths', [glob]), JSON.stringify(glob)).toEqual([])
      expect(vp.verificationProblems({ verification: { paths: [glob] } }), JSON.stringify(glob)).toEqual([])
    }
  })
})

describe('review round 2: a relative root and the . segments of a glob', () => {
  it('takes a relative root from the working directory, so a relative path under it still counts', () => {
    expect(vp.normalizePath('CLAUDE.md', { ...linux, root: '.' })).toBe('CLAUDE.md')
    expect(vp.normalizePath('CLAUDE.md', { ...linux, root: './' })).toBe('CLAUDE.md')
    expect(vp.normalizePath('.github/workflows/ci.yml', { root: '.' })).toBe('.github/workflows/ci.yml')
    expect(vp.isVerificationPath('.claude/agents/x.md', DEFAULTS, { ...linux, root: './' })).toBe(true)
    expect(vp.isVerificationPath('src/a.ts', DEFAULTS, { ...linux, root: '.' })).toBe(false)
    expect(vp.normalizePath(`${process.cwd()}/CLAUDE.md`, { root: '.' })).toBe('CLAUDE.md')
    expect(vp.normalizePath('../x', { ...linux, root: '.' })).toBeNull()
  })

  it('drops a . segment of a glob: x/./y is x/y, x/. is the folder x', () => {
    expect(vp.verificationPaths({ verification: { paths: ['x/./y', 'x/.', 'a/./b/./c.md', '/./r.md'] } })).toEqual([
      ...DEFAULTS,
      'x/y',
      'x/**',
      'a/b/c.md',
      'r.md',
    ])
    expect(vp.isVerificationPath('x/y', ['x/./y'], linux)).toBe(true)
    expect(vp.isVerificationPath('x/a/b.ts', ['x/.'], linux)).toBe(true)
    expect(vp.isVerificationPath('x\\y', ['x\\.\\y'], win)).toBe(true)
  })
})
