// scripts/ci-scope.mjs on a pull request: which e2e spec files macos-e2e and windows-e2e run, and in
// how many shards. A changed spec file runs itself; a path of src/ or harness/ runs the spec files
// scripts/e2e-specs.table.json gives it; any other app path, and a path the table does not know, runs
// every spec file. A push to main runs every spec file in the full shards.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'

const REPO = join(import.meta.dirname, '..', '..')
const SCOPE = join(REPO, 'scripts', 'ci-scope.mjs')

interface Rule {
  paths: string[]
  specs: string[]
  matchers: RegExp[]
}
interface CiScope {
  SPEC_TABLE: string
  E2E_SHARDS: Record<'macos-e2e' | 'windows-e2e', number>
  globRegExp: (glob: string) => RegExp
  readSpecTable: (root: string) => Rule[]
  e2eSpecs: (paths: string[], specs: string[], rules: Rule[] | Error) => { files: string[] | null; why: string }
  e2eShards: (files: string[] | null, specs: string[], seconds: Record<string, number>, full: number) => string[]
}
interface E2eShard {
  listSpecs: (root: string) => string[]
  readTimings: (root: string) => Record<string, number>
  e2eShard: (args: string[], io: { out: (text: string) => void; err: (line: string) => void }) => number
}
const { SPEC_TABLE, E2E_SHARDS, globRegExp, readSpecTable, e2eSpecs, e2eShards } = (await import(pathToFileURL(SCOPE).href)) as CiScope
const { listSpecs, readTimings, e2eShard } = (await import(pathToFileURL(join(REPO, 'scripts', 'e2e-shard.mjs')).href)) as E2eShard

const rulesOf = (rules: Array<{ paths: string[]; specs: string[] }>): Rule[] =>
  rules.map((rule) => ({ ...rule, matchers: rule.paths.map(globRegExp) }))

const SPECS = ['test/e2e/a.spec.ts', 'test/e2e/b.spec.ts', 'test/e2e/c.spec.ts', 'test/e2e/packaged.spec.ts']
const RULES = rulesOf([
  { paths: ['src/main/alpha/**', 'src/renderer/Alpha*.tsx'], specs: ['test/e2e/a.spec.ts'] },
  { paths: ['harness/skills/**'], specs: ['test/e2e/b.spec.ts', 'test/e2e/c.spec.ts'] },
])

describe('scripts/ci-scope.mjs: the e2e spec files of a pull request', () => {
  it('reads a glob of the table as a whole path: ** any folders, none too; * one name', () => {
    const re = globRegExp('src/main/alpha/**')
    expect(re.test('src/main/alpha/x.ts')).toBe(true)
    expect(re.test('src/main/alpha/deep/x.ts')).toBe(true)
    expect(re.test('src/main/alphabet/x.ts')).toBe(false)
    expect(re.test('x/src/main/alpha/x.ts')).toBe(false)
    const star = globRegExp('src/renderer/Alpha*.tsx')
    expect(star.test('src/renderer/AlphaNode.tsx')).toBe(true)
    expect(star.test('src/renderer/Alpha/Node.tsx')).toBe(false)
    expect(globRegExp('harness/**/x.md').test('harness/x.md')).toBe(true)
    expect(globRegExp('src/a.b.ts').test('src/aXb.ts')).toBe(false)
  })

  it('a mapped path runs its spec files; two mapped paths the union, sorted', () => {
    expect(e2eSpecs(['src/main/alpha/run.ts'], SPECS, RULES).files).toEqual(['test/e2e/a.spec.ts'])
    expect(e2eSpecs(['harness/skills/x/SKILL.md', 'src/renderer/AlphaNode.tsx'], SPECS, RULES).files).toEqual([
      'test/e2e/a.spec.ts',
      'test/e2e/b.spec.ts',
      'test/e2e/c.spec.ts',
    ])
  })

  it('a changed spec file runs itself, beside the mapped ones; a deleted one asks for nothing', () => {
    expect(e2eSpecs(['test/e2e/c.spec.ts', 'src/main/alpha/run.ts'], SPECS, RULES).files).toEqual(['test/e2e/a.spec.ts', 'test/e2e/c.spec.ts'])
    // packaged.spec.ts is a build input too, but a spec file runs itself.
    expect(e2eSpecs(['test/e2e/packaged.spec.ts'], SPECS, RULES).files).toEqual(['test/e2e/packaged.spec.ts'])
    expect(e2eSpecs(['test/e2e/gone.spec.ts'], SPECS, RULES)).toEqual({ files: [], why: 'only deleted spec files' })
  })

  it.each([
    ['an unmapped path of src/', 'src/main/beta/run.ts'],
    ['an unmapped path of the Harness the app carries', 'harness/bin/ticket'],
    ['a helper of the e2e tests', 'test/e2e/helpers.ts'],
    ['another helper of the e2e tests', 'test/e2e/wait.ts'],
    ['the measured times of the spec files', 'test/e2e/timings.json'],
    ['a fixture the e2e tests read', 'test/fixtures/agent-scripts/a.jsonl'],
    ['the Playwright config', 'playwright.config.ts'],
    ['package.json', 'package.json'],
    ['a build input', 'electron-builder.yml'],
    ['a tsconfig', 'tsconfig.web.json'],
    ['a file outside test/e2e that the e2e tests import', 'test/quarantine.ts'],
  ])('%s runs every spec file, mapped paths beside it or not', (_name, path) => {
    expect(e2eSpecs([path], SPECS, RULES).files).toBeNull()
    expect(e2eSpecs(['src/main/alpha/run.ts', path], SPECS, RULES).files).toBeNull()
    expect(e2eSpecs([path, 'test/e2e/a.spec.ts'], SPECS, RULES).files).toBeNull()
  })

  it('ignores paths that are not the app: unit and contract tests, other scripts, the Harness tests, fixtures no e2e test reads, workflows', () => {
    const others = ['test/unit/x.test.ts', 'scripts/agent-cost.mjs', 'harness/bin/tests/x.test.sh', 'test/fixtures/eval-stub/claude.cjs', '.github/workflows/windows-tests.yml']
    expect(e2eSpecs(['src/main/alpha/run.ts', ...others], SPECS, RULES).files).toEqual(['test/e2e/a.spec.ts'])
  })

  it('runs every spec file for a path of src/ when the table cannot be read, or names a spec file that does not exist', () => {
    const broken = new Error('no "rules" list')
    expect(e2eSpecs(['src/main/alpha/run.ts'], SPECS, broken)).toEqual({ files: null, why: `${SPEC_TABLE} cannot be read (no "rules" list)` })
    // A spec file alone needs no table.
    expect(e2eSpecs(['test/e2e/a.spec.ts'], SPECS, broken).files).toEqual(['test/e2e/a.spec.ts'])
    const stale = rulesOf([{ paths: ['src/main/alpha/**'], specs: ['test/e2e/gone.spec.ts'] }])
    expect(e2eSpecs(['src/main/alpha/run.ts'], SPECS, stale).files).toBeNull()
  })

  it.each([
    ['no rules list', {}, /no "rules" list/],
    ['a rule without globs', { rules: [{ paths: [], specs: ['test/e2e/a.spec.ts'] }] }, /rule 1: "paths"/],
    ['a rule without spec files', { rules: [{ paths: ['src/**'], specs: [] }] }, /rule 1: "specs"/],
    ['a glob outside src/ and harness/', { rules: [{ paths: ['test/e2e/helpers.ts'], specs: ['test/e2e/a.spec.ts'] }] }, /rule 1: test\/e2e\/helpers\.ts is outside src\/ and harness\//],
    ['a spec that is not a spec file', { rules: [{ paths: ['src/**'], specs: ['test/unit/a.test.ts'] }] }, /rule 1: test\/unit\/a\.test\.ts is not a spec file/],
  ])('refuses a table with %s', (_name, table, reason) => {
    const root = mkdtempSync(join(tmpdir(), 'worfy-ci-scope-table-'))
    try {
      mkdirSync(join(root, 'scripts'))
      writeFileSync(join(root, SPEC_TABLE), JSON.stringify(table))
      expect(() => readSpecTable(root)).toThrow(reason)
    } finally {
      removeTestTree(root)
    }
  })

  it('runs fewer shards for fewer files: about the time of a full shard each, at least 1, never more than the files', () => {
    const seconds = { 'test/e2e/a.spec.ts': 10, 'test/e2e/b.spec.ts': 10, 'test/e2e/c.spec.ts': 70, 'test/e2e/packaged.spec.ts': 10 }
    expect(e2eShards(null, SPECS, seconds, 4)).toEqual(['1/4', '2/4', '3/4', '4/4'])
    expect(e2eShards(['test/e2e/a.spec.ts'], SPECS, seconds, 4)).toEqual(['1/1'])
    // 80 of 100 s in 4 shards of 25 s: 4 shards, but only 2 files.
    expect(e2eShards(['test/e2e/a.spec.ts', 'test/e2e/c.spec.ts'], SPECS, seconds, 4)).toEqual(['1/2', '2/2'])
    // 30 of 100 s in 4 shards of 25 s: 2 shards.
    expect(e2eShards(['test/e2e/a.spec.ts', 'test/e2e/b.spec.ts', 'test/e2e/packaged.spec.ts'], SPECS, seconds, 4)).toEqual(['1/2', '2/2'])
    // Every file in 2 shards stays 2.
    expect(e2eShards(SPECS, SPECS, seconds, 2)).toEqual(['1/2', '2/2'])
    // A file the timings do not know counts as the slowest.
    expect(e2eShards(['test/e2e/new.spec.ts'], [...SPECS, 'test/e2e/new.spec.ts'], seconds, 4)).toEqual(['1/1'])
    expect(e2eShards(['test/e2e/new.spec.ts', 'test/e2e/a.spec.ts'], [...SPECS, 'test/e2e/new.spec.ts'], seconds, 4)).toEqual(['1/2', '2/2'])
  })
})

describe('scripts/e2e-specs.table.json of this repository', () => {
  const rules = readSpecTable(REPO)
  const specs = listSpecs(REPO)

  it('is a table ci-scope.mjs reads, every rule with a reason', () => {
    expect(rules.length).toBeGreaterThan(0)
    const table = JSON.parse(readFileSync(join(REPO, SPEC_TABLE), 'utf8')) as { rules: Array<{ why?: unknown }> }
    for (const [at, rule] of table.rules.entries()) expect(typeof rule.why === 'string' && rule.why.length > 20, `rule ${at + 1}: why`).toBe(true)
  })

  it('gives a pull request that changes only harness/skills/epic-wave/SKILL.md the spec files of the Harness rule alone, in one shard', () => {
    const path = 'harness/skills/epic-wave/SKILL.md'
    const harness = rules.filter((rule) => rule.paths.includes('harness/skills/**'))
    expect(harness).toHaveLength(1)
    expect(rules.filter((rule) => rule.matchers.some((matcher) => matcher.test(path)))).toEqual(harness)
    const files = e2eSpecs([path], specs, rules).files
    expect(files).toEqual([...(harness[0]?.specs ?? [])].sort())
    expect(e2eShards(files, specs, readTimings(REPO), E2E_SHARDS['macos-e2e'])).toEqual(['1/1'])
  })

  it('gives a pull request that changes the first-run checks or actions the spec files of the first-run rule alone, in fewer shards than a full run; src/main/ipc/first-run.ts still runs them all', () => {
    const firstRun = rules.filter((rule) => rule.paths.includes('src/main/first-run/checks.ts'))
    expect(firstRun).toHaveLength(1)
    const specsOfRule = [...(firstRun[0]?.specs ?? [])].sort()
    expect(specsOfRule).toEqual([
      'test/e2e/first-run.spec.ts',
      'test/e2e/harness-migrate.spec.ts',
      'test/e2e/projects-connect.spec.ts',
      'test/e2e/settings-health.spec.ts',
      'test/e2e/settings.spec.ts',
    ])
    for (const path of ['src/main/first-run/checks.ts', 'src/main/first-run/actions.ts']) {
      expect(rules.filter((rule) => rule.matchers.some((matcher) => matcher.test(path))), path).toEqual(firstRun)
      const files = e2eSpecs([path], specs, rules).files
      expect(files, path).toEqual(specsOfRule)
      expect(e2eShards(files, specs, readTimings(REPO), E2E_SHARDS['macos-e2e']).length, path).toBeLessThan(E2E_SHARDS['macos-e2e'])
    }
    // Its neighbour answers firstRun.startup on every launch: it stays out of the table.
    expect(e2eSpecs(['src/main/ipc/first-run.ts'], specs, rules)).toEqual({ files: null, why: `src/main/ipc/first-run.ts is not in ${SPEC_TABLE}` })
  })

  it('names only spec files that exist', () => {
    for (const rule of rules) for (const spec of rule.specs) expect(specs, `${rule.paths.join(' ')} → ${spec}`).toContain(spec)
  })

  it('has no glob that matches no file of the repository: a typo would leave its path to every spec file', () => {
    // git starts here, not while the file loads (test/unit/e2e-no-spawn-on-load.test.ts).
    const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: REPO, encoding: 'utf8' }).split('\0').filter((path) => path !== '')
    for (const rule of rules) for (const [at, matcher] of rule.matchers.entries()) expect(tracked.some((path) => matcher.test(path)), rule.paths[at]).toBe(true)
  })

  // The spec files that use a feature, found in the code of the e2e tests rather than listed by hand:
  // each rule must give every one of them for every file it maps. `root` is the repository, or a copy
  // of its test/e2e in a fixture.
  const e2eText = (root: string, file: string): string => readFileSync(join(root, file), 'utf8')
  /** The text of a file without its comment lines: a comment that names a helper is not a call of it. */
  const codeOf = (text: string): string =>
    text
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
      .join('\n')
  /**
   * The text of a spec file and of every helper of test/e2e it imports, at any depth. `skip` leaves out
   * a helper: test/e2e/helpers.ts defines the link helpers and is imported by nearly every spec.
   */
  function withLocalHelpers(root: string, spec: string, skip: readonly string[] = []): string {
    const seen = new Set<string>(skip)
    const texts: string[] = []
    const visit = (file: string): void => {
      if (seen.has(file)) return
      seen.add(file)
      const text = e2eText(root, file)
      texts.push(text)
      for (const [, name = ''] of text.matchAll(/from '\.\/([\w.-]+)'/g)) {
        const helper = `test/e2e/${name}${name.endsWith('.ts') ? '' : '.ts'}`
        if (existsSync(join(root, helper))) visit(helper)
      }
    }
    visit(spec)
    return texts.join('\n')
  }
  const HELPERS = 'test/e2e/helpers.ts'
  /** The exported names of test/e2e/helpers.ts that link two apps or show the Linked machines settings. */
  function linkHelpers(root: string): string[] {
    const names = [...e2eText(root, HELPERS).matchAll(/^export (?:async function|function|const|interface|type) (\w+)/gm)].map((match) => match[1] ?? '')
    return names.filter((name) => /link|machine|keep_?awake|projects_access/i.test(name))
  }
  interface Family {
    name: string
    path: string
    least: number
    known: string
    uses: (root: string, spec: string) => boolean
  }
  const FAMILIES: Family[] = [
    {
      name: 'the link between machines',
      path: 'src/main/link/service.ts',
      least: 15,
      known: 'test/e2e/family.spec.ts',
      uses: (root, spec) => {
        const text = codeOf(withLocalHelpers(root, spec, [HELPERS]))
        return linkHelpers(root).some((name) => new RegExp(`\\b${name}\\b`).test(text)) || text.includes("'link-machine-button'") || /from '[./]*src\/main\/link\//.test(text)
      },
    },
    {
      name: 'the Harness copy of the build',
      path: 'harness/hooks/gate.mjs',
      least: 9,
      known: 'test/e2e/packaged.spec.ts',
      uses: (root, spec) => /out['"]?\s*,\s*['"]harness|out\/harness|expectHarnessCopy|bundledHarness/.test(withLocalHelpers(root, spec)),
    },
    {
      name: 'the Browser node',
      path: 'src/main/browser/live.ts',
      least: 12,
      known: 'test/e2e/browser.spec.ts',
      // helpers.ts is left out: it turns on the webview tag for every window it launches.
      uses: (root, spec) =>
        /kind: 'browser'|getByTestId\('browser-|webview|from '[./]*src\/(main|renderer|shared)\/browser\//i.test(codeOf(withLocalHelpers(root, spec, [HELPERS]))),
    },
    {
      name: 'the first-run checks',
      path: 'src/main/first-run/checks.ts',
      least: 5,
      known: 'test/e2e/first-run.spec.ts',
      // The doors to the checks: the screen opening by itself (WORFY_FIRST_RUN_AUTO=1), the palette's
      // command or Connect Project's button "First-run checks…", Settings → Health and Settings → Plan,
      // or the firstRun and planPreset channels asked directly.
      uses: (root, spec) =>
        /First-run checks|WORFY_FIRST_RUN_AUTO: '1'|\b(firstRun|planPreset)\.\w|name: '(Health|Plan)'|toHaveText\('(Health|Plan)'\)/.test(codeOf(withLocalHelpers(root, spec))),
    },
  ]
  /** The paths the family's rule maps, and each spec of `used` it leaves out for one of them, as "path → spec". */
  function missedBy(family: Family, used: string[], specList: string[], ruleList: Rule[], tracked: string[]): { mapped: string[]; missed: string[] } {
    const rule = ruleList.find((r) => r.matchers.some((matcher) => matcher.test(family.path)))
    const mapped = rule === undefined ? [] : tracked.filter((path) => rule.matchers.some((matcher) => matcher.test(path)))
    const missed: string[] = []
    for (const path of mapped) {
      const files = e2eSpecs([path], specList, ruleList).files
      // null: every spec file; []: a path the app does not carry (harness/bin/tests).
      if (files === null || files.length === 0) continue
      for (const spec of used) if (!files.includes(spec)) missed.push(`${path} → ${spec}`)
    }
    return { mapped, missed }
  }
  // git starts inside the tests, not while the file loads (test/unit/e2e-no-spawn-on-load.test.ts).
  const trackedFiles = (): string[] => execFileSync('git', ['ls-files', '-z'], { cwd: REPO, encoding: 'utf8' }).split('\0').filter((path) => path !== '')

  it('finds the link helpers of test/e2e/helpers.ts it looks for', () => {
    expect(linkHelpers(REPO)).toEqual(expect.arrayContaining(['linkThroughUi', 'launchLinkedPair', 'openLinkDialog', 'openMachinesSettings', 'machineIdOf']))
  })

  it.each(FAMILIES.map((family) => [family.name, family] as const))('gives every spec file that uses %s for every file of its rule', (_name, family) => {
    const used = specs.filter((spec) => family.uses(REPO, spec))
    const { mapped, missed } = missedBy(family, used, specs, rules, trackedFiles())
    expect(used.length, 'spec files found').toBeGreaterThanOrEqual(family.least)
    expect(used).toContain(family.known)
    expect(mapped, `the rule of ${family.path}`).toContain(family.path)
    expect(missed).toEqual([])
  })

  it('catches a new spec that reaches a feature through a local helper of its own and is missing from the rule', () => {
    const root = mkdtempSync(join(tmpdir(), 'ci-scope-family-'))
    try {
      mkdirSync(join(root, 'test', 'e2e'), { recursive: true })
      writeFileSync(join(root, HELPERS), e2eText(REPO, HELPERS))
      // A helper of its own calls the link helper, and the Browser one adds a Browser node.
      writeFileSync(join(root, 'test/e2e/pair-apps.ts'), "import { linkThroughUi } from './helpers'\nexport const pairApps = linkThroughUi\n")
      writeFileSync(join(root, 'test/e2e/new-pair.spec.ts'), "import { pairApps } from './pair-apps'\nvoid pairApps\n")
      writeFileSync(join(root, 'test/e2e/add-page.ts'), "export const node = { kind: 'browser' }\n")
      writeFileSync(join(root, 'test/e2e/new-page.spec.ts'), "import { node } from './add-page'\nvoid node\n")
      // Only a comment names the link helper, and helpers.ts alone mentions webview: neither counts.
      writeFileSync(join(root, 'test/e2e/plain.spec.ts'), "import { launchApp } from './helpers'\n// not linkThroughUi\nvoid launchApp\n")
      const fresh = ['test/e2e/new-pair.spec.ts', 'test/e2e/new-page.spec.ts', 'test/e2e/plain.spec.ts']
      const [link, , browser] = FAMILIES
      if (link === undefined || browser === undefined) throw new Error('FAMILIES lost a family')
      expect(fresh.filter((spec) => link.uses(root, spec))).toEqual(['test/e2e/new-pair.spec.ts'])
      expect(fresh.filter((spec) => browser.uses(root, spec))).toEqual(['test/e2e/new-page.spec.ts'])
      // The rules of this repository do not name the new spec files, so each is missed for the link path.
      const missed = missedBy(link, ['test/e2e/new-pair.spec.ts'], [...specs, ...fresh], rules, trackedFiles()).missed
      expect(missed).toContain('src/main/link/service.ts → test/e2e/new-pair.spec.ts')
    } finally {
      removeTestTree(root)
    }
  })

  it('reaches every spec file: each runs when it changes, and the full shards of both jobs run them all', () => {
    for (const spec of specs) expect(e2eSpecs([spec], specs, rules).files, spec).toEqual([spec])
    // The full run of macos-e2e: every shard of scripts/e2e-shard.mjs together lists every spec file.
    const listed: string[] = []
    for (const shard of e2eShards(null, specs, readTimings(REPO), E2E_SHARDS['macos-e2e'])) {
      expect(e2eShard([shard], { out: (text) => listed.push(...text.split('\n').filter((line) => line !== '')), err: () => {} }), shard).toBe(0)
    }
    expect(listed.sort()).toEqual(specs)
    expect(E2E_SHARDS).toEqual({ 'macos-e2e': 2, 'windows-e2e': 4 })
  })
})

describe('scripts/ci-scope.mjs: the outputs e2e-files, macos-e2e-shards and windows-e2e-shards', () => {
  let scratch = ''
  let repo = ''
  let base = ''

  const git = (...args: string[]): string =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd: repo, encoding: 'utf8' }).trim()

  /** A commit on top of `base` that changes (or, with a leading "-", deletes) the given files; HEAD is left on it. */
  function commitOnBase(files: string[]): void {
    git('checkout', '-q', '--detach', base)
    for (const file of files) {
      if (file.startsWith('-')) {
        rmSync(join(repo, file.slice(1)))
        continue
      }
      mkdirSync(join(repo, dirname(file)), { recursive: true })
      writeFileSync(join(repo, file), `changed ${Math.random()}\n`)
    }
    git('add', '-A')
    git('commit', '-q', '--allow-empty', '-m', 'change')
  }

  let outputs = 0
  const scope = (env: Record<string, string>) => {
    const output = join(scratch, `output-${++outputs}`)
    writeFileSync(output, '')
    const result = spawnSync(scriptNode(), [SCOPE], { cwd: repo, encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: output, EVENT: '', JOB: '', BASE: '', ...env } })
    const text = readFileSync(output, 'utf8')
    const line = (name: string): string | undefined => new RegExp(`^${name}=(.*)$`, 'm').exec(text)?.[1]
    const expectLine = line('expect')
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      e2e: expectLine === undefined ? undefined : (JSON.parse(expectLine) as Record<string, boolean>)['macos-e2e'],
      windowsE2e: expectLine === undefined ? undefined : (JSON.parse(expectLine) as Record<string, boolean>)['windows-e2e'],
      files: line('e2e-files'),
      macos: JSON.parse(line('macos-e2e-shards') ?? 'null') as unknown,
      windows: JSON.parse(line('windows-e2e-shards') ?? 'null') as unknown,
    }
  }

  const FULL = { files: '', macos: ['1/2', '2/2'], windows: ['1/4', '2/4', '3/4', '4/4'] }
  /** A quarantine entry (test/quarantine/<id>.json) of an e2e test of `file`. */
  const entry = (file: string): string => `${JSON.stringify({ runner: 'playwright', file, test: 'x', platforms: ['win32'], reason: 'r', owner: 'o', since: '2026-10-29', until: '2026-11-12' })}\n`

  /** A commit on top of `base` that writes each file exactly as given; HEAD is left on it. */
  function commitTexts(texts: Record<string, string>): void {
    git('checkout', '-q', '--detach', base)
    for (const [file, text] of Object.entries(texts)) {
      mkdirSync(join(repo, dirname(file)), { recursive: true })
      writeFileSync(join(repo, file), text)
    }
    git('add', '-A')
    git('commit', '-q', '--allow-empty', '-m', 'change')
  }
  const TABLE = {
    rules: [
      { paths: ['src/main/alpha/**'], specs: ['test/e2e/a.spec.ts'], why: 'test table' },
      { paths: ['harness/skills/**'], specs: ['test/e2e/b.spec.ts', 'test/e2e/c.spec.ts'], why: 'test table' },
    ],
  }

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), 'worfy-ci-scope-e2e-'))
    repo = join(scratch, 'repo')
    mkdirSync(join(repo, 'test', 'e2e'), { recursive: true })
    mkdirSync(join(repo, 'scripts'))
    git('init', '-q')
    writeFileSync(join(repo, 'package.json'), '{}\n')
    for (const spec of SPECS) writeFileSync(join(repo, spec), '')
    writeFileSync(join(repo, 'test/e2e/helpers.ts'), '')
    writeFileSync(join(repo, 'test/e2e/timings.json'), JSON.stringify({ seconds: { 'test/e2e/a.spec.ts': 10, 'test/e2e/b.spec.ts': 30, 'test/e2e/c.spec.ts': 30, 'test/e2e/packaged.spec.ts': 30 } }))
    writeFileSync(join(repo, SPEC_TABLE), JSON.stringify(TABLE))
    mkdirSync(join(repo, 'test', 'quarantine'))
    writeFileSync(join(repo, 'test/quarantine/old.json'), entry('test/e2e/b.spec.ts'))
    git('add', '-A')
    git('commit', '-q', '-m', 'base')
    base = git('rev-parse', 'HEAD')
  })

  afterAll(() => {
    removeTestTree(scratch)
  })

  it('a pull request that changes a mapped path runs its spec files in one shard on each system', () => {
    commitOnBase(['src/main/alpha/run.ts'])
    const result = scope({ EVENT: 'pull_request', BASE: base })
    expect(result.status, result.stderr).toBe(0)
    expect([result.e2e, result.windowsE2e]).toEqual([true, true])
    expect(result.files).toBe('test/e2e/a.spec.ts')
    expect(result.macos).toEqual(['1/1'])
    expect(result.windows).toEqual(['1/1'])
    expect(result.stdout).toContain('the e2e jobs run 1 spec files by scripts/e2e-specs.table.json: test/e2e/a.spec.ts')
  })

  it('a pull request with more mapped time gets more shards, never more than a full run', () => {
    // b and c: 60 of 100 s. macOS: 2 shards of 50 s → 2; Windows: 4 of 25 s → 3, but only 2 files.
    commitOnBase(['harness/skills/epic-wave/SKILL.md', 'test/e2e/a.spec.ts'])
    const result = scope({ EVENT: 'pull_request', BASE: base })
    expect(result.status, result.stderr).toBe(0)
    expect(result.files).toBe('test/e2e/a.spec.ts test/e2e/b.spec.ts test/e2e/c.spec.ts')
    expect(result.macos).toEqual(['1/2', '2/2'])
    expect(result.windows).toEqual(['1/3', '2/3', '3/3'])
  })

  it.each([
    ['an unmapped path of src/', ['src/main/beta/run.ts']],
    ['an unmapped path beside a mapped one', ['src/main/alpha/run.ts', 'src/shared/x.ts']],
    ['a helper of the e2e tests', ['test/e2e/helpers.ts']],
    ['the Playwright config', ['playwright.config.ts']],
    ['package.json', ['package.json']],
  ])('a pull request that changes %s runs every spec file in the full shards', (_name, files) => {
    commitOnBase(files)
    const result = scope({ EVENT: 'pull_request', BASE: base })
    expect(result.status, result.stderr).toBe(0)
    expect([result.e2e, result.windowsE2e]).toEqual([true, true])
    expect({ files: result.files, macos: result.macos, windows: result.windows }).toEqual(FULL)
    expect(result.stdout).toContain('so every e2e spec file runs')
  })

  it('a pull request that changes a quarantine entry runs the spec file it names, before and after; a deleted or unreadable entry runs them all', () => {
    commitTexts({ 'test/quarantine/new.json': entry('test/e2e/a.spec.ts') })
    const added = scope({ EVENT: 'pull_request', BASE: base })
    expect(added.status, added.stderr).toBe(0)
    expect({ files: added.files, macos: added.macos }).toEqual({ files: 'test/e2e/a.spec.ts', macos: ['1/1'] })
    // The entry moves from b to c: both spec files call quarantined('old').
    commitTexts({ 'test/quarantine/old.json': entry('test/e2e/c.spec.ts') })
    expect(scope({ EVENT: 'pull_request', BASE: base }).files).toBe('test/e2e/b.spec.ts test/e2e/c.spec.ts')
    // Deleted, not JSON, naming a spec file that does not exist.
    const changes: Array<() => void> = [
      () => commitOnBase(['-test/quarantine/old.json']),
      () => commitOnBase(['test/quarantine/old.json']),
      () => commitTexts({ 'test/quarantine/new.json': entry('test/e2e/gone.spec.ts') }),
    ]
    for (const [at, change] of changes.entries()) {
      change()
      const full = scope({ EVENT: 'pull_request', BASE: base })
      expect(full.e2e, `change ${at + 1}`).toBe(true)
      expect({ files: full.files, macos: full.macos, windows: full.windows }, `change ${at + 1}`).toEqual(FULL)
    }
  })

  it('a pull request that changes a quarantine entry of a vitest test runs no e2e', () => {
    const vitest = `${JSON.stringify({ runner: 'vitest', file: 'test/unit/plain.test.ts', test: 'x', platforms: ['win32'], reason: 'r', owner: 'o', since: '2026-10-29', until: '2026-11-12' })}\n`
    commitTexts({ 'test/quarantine/unit.json': vitest })
    const added = scope({ EVENT: 'pull_request', BASE: base })
    expect(added.status, added.stderr).toBe(0)
    expect([added.e2e, added.windowsE2e]).toEqual([false, false])
  })

  it('a pull request that changes Markdown only, or only deletes a spec file, runs no e2e', () => {
    commitOnBase(['docs/notes.md', 'HANDOFF.md'])
    const docs = scope({ EVENT: 'pull_request', BASE: base })
    expect(docs.status, docs.stderr).toBe(0)
    expect([docs.e2e, docs.windowsE2e]).toEqual([false, false])
    commitOnBase(['-test/e2e/c.spec.ts'])
    const deleted = scope({ EVENT: 'pull_request', BASE: base })
    expect(deleted.status, deleted.stderr).toBe(0)
    expect([deleted.e2e, deleted.windowsE2e]).toEqual([false, false])
    expect(deleted.stdout).toContain('only deleted spec files, so no macos-e2e and no windows-e2e')
  })

  it('a pull request runs every spec file when the table cannot be read', () => {
    commitOnBase([SPEC_TABLE, 'src/main/alpha/run.ts'])
    const result = scope({ EVENT: 'pull_request', BASE: base })
    expect(result.status, result.stderr).toBe(0)
    expect({ files: result.files, macos: result.macos, windows: result.windows }).toEqual(FULL)
    expect(result.stdout).toContain('scripts/e2e-specs.table.json cannot be read')
  })

  it('a push to main and a run by hand run every spec file in the full shards', () => {
    commitOnBase(['src/main/alpha/run.ts'])
    const push = scope({ EVENT: 'push', BASE: base })
    expect(push.status, push.stderr).toBe(0)
    expect([push.e2e, push.windowsE2e]).toEqual([true, true])
    expect({ files: push.files, macos: push.macos, windows: push.windows }).toEqual(FULL)
    const byHand = scope({ EVENT: 'workflow_dispatch', JOB: 'full-macos' })
    expect(byHand.status, byHand.stderr).toBe(0)
    expect(byHand.e2e).toBe(true)
    expect({ files: byHand.files, macos: byHand.macos, windows: byHand.windows }).toEqual(FULL)
  })
})
